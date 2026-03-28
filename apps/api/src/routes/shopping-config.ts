/**
 * Shopping Config Routes — /api/shopping-config
 *
 * Simplified endpoints for the setup-shopping wizard.
 * Abstracts bot + policy so the user doesn't need to know their botId.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import { sendWhatsAppMessage } from "../services/twilio-whatsapp.service.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

async function notifyShoppingConfigured(user: { telegramChatId: string | null; phone: string | null }) {
  const msg = "\ud83c\udf89 Shopping configured! You can now ask me to buy anything!";
  try {
    if (user.telegramChatId && TELEGRAM_BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.telegramChatId, text: msg }),
      });
    }
    if (user.phone) {
      await sendWhatsAppMessage(`whatsapp:+${user.phone.replace(/\D/g, "")}`, msg);
    }
  } catch (err) {
    console.error("[ShoppingConfig] Notification error:", (err as Error).message);
  }
}

const CATEGORIES = [
  "groceries",
  "clothing",
  "electronics",
  "food",
  "travel",
  "entertainment",
  "health",
  "home",
  "books",
  "gifts",
] as const;

async function getUserAndBot(clerkId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    include: { bots: { take: 1, orderBy: { createdAt: "asc" } } },
  });
  if (!user) return null;
  const bot = user.bots[0];
  if (!bot) return null;
  return { user, bot };
}

export async function shoppingConfigRoutes(app: FastifyInstance) {
  // GET — current shopping config
  app.get("/api/shopping-config", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const result = await getUserAndBot(clerkId);
    if (!result) return reply.status(404).send({ success: false, error: "User or bot not found" });

    const { bot } = result;
    const policy = await prisma.policy.findUnique({ where: { botId: bot.id } });

    // Check if user has a Stripe payment method
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: { userId: result.user.id, provider: "STRIPE", status: "CONNECTED" },
    });

    return {
      success: true,
      data: {
        autoApproveLimit: policy?.autoApproveLimit ?? 50,
        maxPerDay: policy?.maxPerDay ?? 500,
        maxPerMonth: policy?.maxPerMonth ?? 5000,
        allowedCategories: policy?.allowedCategories ?? [],
        hasPaymentMethod: !!paymentMethod,
        paymentMethodBrand: paymentMethod?.metadata
          ? (paymentMethod.metadata as any).brand ?? null
          : null,
        paymentMethodLast4: paymentMethod?.metadata
          ? (paymentMethod.metadata as any).last4 ?? null
          : null,
        configured: !!policy,
      },
    };
  });

  // PUT — save spending limits + categories
  app.put("/api/shopping-config", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const result = await getUserAndBot(clerkId);
    if (!result) return reply.status(404).send({ success: false, error: "User or bot not found" });

    const body = request.body as {
      autoApproveLimit?: number;
      maxPerDay?: number;
      maxPerMonth?: number;
      allowedCategories?: string[];
    };

    // Validate limits
    const autoApproveLimit = Math.min(Math.max(body.autoApproveLimit ?? 50, 0), 500);
    const maxPerDay = Math.min(Math.max(body.maxPerDay ?? 500, 0), 2000);
    const maxPerMonth = Math.min(Math.max(body.maxPerMonth ?? 5000, 0), 10000);
    const allowedCategories = (body.allowedCategories ?? []).filter((c) =>
      CATEGORIES.includes(c as any)
    );

    const { bot } = result;

    const policy = await prisma.policy.upsert({
      where: { botId: bot.id },
      create: {
        botId: bot.id,
        autoApproveLimit,
        maxPerDay,
        maxPerMonth,
        allowedCategories,
      },
      update: {
        autoApproveLimit,
        maxPerDay,
        maxPerMonth,
        allowedCategories,
      },
    });

    return {
      success: true,
      data: {
        autoApproveLimit: policy.autoApproveLimit,
        maxPerDay: policy.maxPerDay,
        maxPerMonth: policy.maxPerMonth,
        allowedCategories: policy.allowedCategories,
      },
    };
  });

  // POST — create Stripe SetupIntent for adding a card
  app.post("/api/shopping-config/setup-intent", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const result = await getUserAndBot(clerkId);
    if (!result) return reply.status(404).send({ success: false, error: "User or bot not found" });

    // Reuse the existing payment-methods setup-intent endpoint logic
    const { user } = result;

    // Dynamic import stripe
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2024-12-18.acacia" as any,
    });

    // Find or create Stripe customer
    let stripeCustomerId: string | null = null;
    const existingMethod = await prisma.paymentMethod.findFirst({
      where: { userId: user.id, provider: "STRIPE" },
    });

    if (existingMethod?.accountId) {
      stripeCustomerId = existingMethod.accountId;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName,
        metadata: { payjarvisUserId: user.id },
      });
      stripeCustomerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      metadata: { userId: user.id },
    });

    return {
      success: true,
      data: {
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        customerId: stripeCustomerId,
      },
    };
  });

  // POST — confirm card was saved after Stripe setup
  app.post("/api/shopping-config/confirm-card", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const result = await getUserAndBot(clerkId);
    if (!result) return reply.status(404).send({ success: false, error: "User or bot not found" });

    const { setupIntentId } = request.body as { setupIntentId: string };
    if (!setupIntentId) return reply.status(400).send({ success: false, error: "setupIntentId required" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2024-12-18.acacia" as any,
    });

    const si = await stripe.setupIntents.retrieve(setupIntentId, {
      expand: ["payment_method"],
    });

    if (si.status !== "succeeded") {
      return reply.status(400).send({ success: false, error: "Setup not completed" });
    }

    const pm = si.payment_method as any;
    const card = pm?.card ?? {};

    // Upsert payment method
    await prisma.paymentMethod.upsert({
      where: {
        userId_provider_accountId: {
          userId: result.user.id,
          provider: "STRIPE",
          accountId: si.customer as string,
        },
      },
      create: {
        userId: result.user.id,
        provider: "STRIPE",
        status: "CONNECTED",
        accountId: si.customer as string,
        isDefault: true,
        metadata: {
          brand: card.brand ?? "card",
          last4: card.last4 ?? "****",
          expMonth: card.exp_month ?? 0,
          expYear: card.exp_year ?? 0,
          stripePaymentMethodId: pm?.id,
        },
      },
      update: {
        status: "CONNECTED",
        accountId: si.customer as string,
        metadata: {
          brand: card.brand ?? "card",
          last4: card.last4 ?? "****",
          expMonth: card.exp_month ?? 0,
          expYear: card.exp_year ?? 0,
          stripePaymentMethodId: pm?.id,
        },
      },
    });

    // Notify user on their chat platform
    notifyShoppingConfigured(result.user);

    return {
      success: true,
      data: {
        card: {
          brand: card.brand ?? "card",
          last4: card.last4 ?? "****",
          expMonth: card.exp_month ?? 0,
          expYear: card.exp_year ?? 0,
        },
      },
    };
  });
}
