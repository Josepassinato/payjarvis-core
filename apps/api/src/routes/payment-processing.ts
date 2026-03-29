/**
 * Payment Processing Routes — endpoints called by OpenClaw tool handlers
 *
 * These routes handle the actual execution of payments via Stripe and PayPal,
 * as opposed to payment-methods.ts which handles wallet CRUD.
 *
 * Auth: X-Bot-Api-Key (bot auth) or x-internal-secret + x-user-id (internal)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";
import { StripeProvider } from "../services/payments/providers/stripe.provider.js";
import { PayPalProvider } from "../services/payments/providers/paypal.provider.js";
import { MercadoPagoProvider } from "../services/payments/providers/mercadopago.provider.js";
import { getUserPaymentMethods, getPaymentOptions } from "../services/payments/payment-wallet.service.js";
import Stripe from "stripe";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

// ─── Auth helper: resolve userId from bot-auth or internal-secret ───

function resolveUserId(request: FastifyRequest, reply: FastifyReply): string | null {
  // Bot auth (set by requireBotAuth middleware)
  const botOwnerId = (request as any).botOwnerId as string | undefined;
  if (botOwnerId) return botOwnerId;

  // Internal secret + x-user-id
  const secret = request.headers["x-internal-secret"] as string;
  const userId = request.headers["x-user-id"] as string;
  if (secret && secret === INTERNAL_SECRET && userId) return userId;

  // Bot API key header (direct)
  const apiKey = request.headers["x-bot-api-key"] as string;
  if (apiKey) {
    // Will be resolved async in the handler
    return null;
  }

  reply.status(401).send({ success: false, error: "Unauthorized" });
  return null;
}

// ─── Resolve user from various ID formats (clerkId, telegramId, DB id) ───

async function findUser(userId: string) {
  // Try clerkId first
  let user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (user) return user;

  // Try by telegramChatId (OpenClaw passes "whatsapp:+..." or telegram chat ID)
  user = await prisma.user.findFirst({ where: { telegramChatId: userId } });
  if (user) return user;

  // Try by DB id
  user = await prisma.user.findUnique({ where: { id: userId } });
  return user;
}

export async function paymentProcessingRoutes(app: FastifyInstance) {

  // ─── GET /api/payments/methods ─────────────────────────────────────────
  // List payment methods for a user (called by OpenClaw get_payment_methods tool)
  app.get("/api/payments/methods", async (request, reply) => {
    const userId = resolveUserId(request, reply);
    if (!userId) return;

    const user = await findUser(userId);
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const methods = await getUserPaymentMethods(user.id);
    const formatted = methods
      .filter((m) => m.status !== "DISABLED")
      .map((m) => ({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName || m.accountId,
        isDefault: m.isDefault,
        status: m.status,
        metadata: m.metadata,
      }));

    return { success: true, methods: formatted };
  });

  // ─── POST /api/payments/stripe/charge ──────────────────────────────────
  // Charge a saved card on file via Stripe (called by stripe_charge_on_file tool)
  app.post("/api/payments/stripe/charge", async (request, reply) => {
    const body = request.body as {
      userId: string;
      botId?: string;
      amount: number;
      currency?: string;
      description?: string;
    };

    const user = await findUser(body.userId);
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    if (!user.stripeCustomerId) {
      return reply.status(400).send({ success: false, error: "No Stripe customer. User needs to add a card first." });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return reply.status(503).send({ success: false, error: "Stripe not configured on server" });
    }

    const stripe = new Stripe(stripeKey);
    const amountCents = Math.round(body.amount * 100);
    const currency = (body.currency || "usd").toLowerCase();

    try {
      // Find saved payment method for this customer
      const savedMethods = await stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: "card",
      });

      if (savedMethods.data.length === 0) {
        return reply.status(400).send({ success: false, error: "No saved card found. Use stripe_create_payment_link instead." });
      }

      const paymentMethod = savedMethods.data[0];

      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency,
        customer: user.stripeCustomerId,
        payment_method: paymentMethod.id,
        off_session: true,
        confirm: true,
        description: body.description || "PayJarvis purchase",
        metadata: {
          payjarvisUserId: user.id,
          botId: body.botId || "",
        },
      });

      return {
        success: true,
        paymentIntentId: intent.id,
        status: intent.status,
        amount: body.amount,
        currency,
        card: paymentMethod.card
          ? { brand: paymentMethod.card.brand, last4: paymentMethod.card.last4 }
          : null,
      };
    } catch (err: any) {
      const msg = err.message || "Stripe charge failed";
      request.log.error({ err: msg, userId: user.id }, "[Stripe Charge] Failed");
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  // ─── POST /api/payments/stripe/payment-link ────────────────────────────
  // Create a Stripe Payment Link for users without a saved card
  app.post("/api/payments/stripe/payment-link", async (request, reply) => {
    const body = request.body as {
      userId: string;
      botId?: string;
      amount: number;
      currency?: string;
      description?: string;
    };

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return reply.status(503).send({ success: false, error: "Stripe not configured" });
    }

    const stripe = new Stripe(stripeKey);
    const amountCents = Math.round(body.amount * 100);
    const currency = (body.currency || "usd").toLowerCase();

    try {
      // Create a one-time price
      const price = await stripe.prices.create({
        unit_amount: amountCents,
        currency,
        product_data: {
          name: body.description || "PayJarvis Purchase",
        },
      });

      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: {
          payjarvisUserId: body.userId,
          botId: body.botId || "",
        },
      });

      return { success: true, url: link.url };
    } catch (err: any) {
      request.log.error({ err: err.message }, "[Stripe Link] Failed");
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── POST /api/payments/paypal/create-order ────────────────────────────
  // Create a PayPal order (called by paypal_create_order tool)
  app.post("/api/payments/paypal/create-order", async (request, reply) => {
    const body = request.body as {
      userId: string;
      botId?: string;
      merchantName?: string;
      amount: number;
      currency?: string;
      description?: string;
    };

    const paypal = new PayPalProvider();
    if (!paypal.isAvailable) {
      return reply.status(503).send({ success: false, error: "PayPal not configured" });
    }

    try {
      const result = await paypal.createPaymentIntent({
        amount: body.amount,
        currency: body.currency || "USD",
        merchantAccountId: body.merchantName || "PayJarvis",
        metadata: {
          userId: body.userId,
          botId: body.botId || "",
          description: body.description || "PayJarvis purchase",
        },
      });

      return {
        success: true,
        orderId: result.id,
        approvalUrl: result.redirectUrl,
        status: result.status,
        amount: body.amount,
        currency: body.currency || "USD",
      };
    } catch (err: any) {
      request.log.error({ err: err.message }, "[PayPal Create Order] Failed");
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── POST /api/payments/paypal/capture ─────────────────────────────────
  // Capture an approved PayPal order (called by paypal_capture_order tool)
  app.post("/api/payments/paypal/capture", async (request, reply) => {
    const body = request.body as {
      orderId: string;
      userId?: string;
      botId?: string;
    };

    if (!body.orderId) {
      return reply.status(400).send({ success: false, error: "orderId is required" });
    }

    const paypal = new PayPalProvider();
    if (!paypal.isAvailable) {
      return reply.status(503).send({ success: false, error: "PayPal not configured" });
    }

    try {
      const result = await paypal.captureOrder(body.orderId);
      return {
        success: true,
        captureId: result.captureId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
      };
    } catch (err: any) {
      request.log.error({ err: err.message, orderId: body.orderId }, "[PayPal Capture] Failed");
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── GET /api/payments/paypal/order-status ─────────────────────────────
  // Check PayPal order status (called by paypal_get_order_status tool)
  app.get("/api/payments/paypal/order-status", async (request, reply) => {
    const { orderId } = request.query as { orderId?: string };

    if (!orderId) {
      return reply.status(400).send({ success: false, error: "orderId query param required" });
    }

    const paypal = new PayPalProvider();
    if (!paypal.isAvailable) {
      return reply.status(503).send({ success: false, error: "PayPal not configured" });
    }

    try {
      const token = await paypal.getAccessToken();

      const env = process.env.PAYPAL_ENVIRONMENT === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

      const res = await fetch(`${env}/v2/checkout/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return reply.status(res.status).send({ success: false, error: text || "Order not found" });
      }

      const order = (await res.json()) as { id: string; status: string };
      return { success: true, orderId: order.id, status: order.status };
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── POST /api/payments/mp/create-preference ────────────────────────────
  // Create a Mercado Pago Checkout Pro preference (link that accepts PIX, card, boleto)
  app.post("/api/payments/mp/create-preference", async (request, reply) => {
    const body = request.body as {
      userId?: string;
      title: string;
      amount: number;
      payerEmail?: string;
      externalReference?: string;
    };

    const mp = new MercadoPagoProvider();
    if (!mp.isAvailable) {
      return reply.status(503).send({ success: false, error: "Mercado Pago not configured" });
    }

    try {
      const result = await mp.createPreference({
        title: body.title || "PayJarvis Purchase",
        amount: body.amount,
        payerEmail: body.payerEmail,
        externalReference: body.externalReference,
      });

      return {
        success: true,
        preferenceId: result.id,
        paymentUrl: result.initPoint,
        amount: body.amount,
        currency: "BRL",
      };
    } catch (err: any) {
      request.log.error({ err: err.message }, "[MP Create Preference] Failed");
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── POST /api/payments/mp/create-pix ──────────────────────────────────
  // Create a direct PIX payment with QR code
  app.post("/api/payments/mp/create-pix", async (request, reply) => {
    const body = request.body as {
      userId?: string;
      amount: number;
      description?: string;
      payerEmail?: string;
      payerCpf?: string;
      payerFirstName?: string;
      payerLastName?: string;
    };

    const mp = new MercadoPagoProvider();
    if (!mp.isAvailable) {
      return reply.status(503).send({ success: false, error: "Mercado Pago not configured" });
    }

    try {
      const result = await mp.createPixPayment({
        amount: body.amount,
        description: body.description || "PayJarvis PIX",
        payerEmail: body.payerEmail,
        payerCpf: body.payerCpf,
        payerFirstName: body.payerFirstName,
        payerLastName: body.payerLastName,
      });

      return {
        success: true,
        paymentId: result.paymentId,
        status: result.status,
        qrCode: result.qrCode,
        qrCodeBase64: result.qrCodeBase64,
        ticketUrl: result.ticketUrl,
        amount: body.amount,
        currency: "BRL",
      };
    } catch (err: any) {
      request.log.error({ err: err.message }, "[MP PIX] Failed");
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── GET /api/payments/mp/status ───────────────────────────────────────
  // Check Mercado Pago payment status
  app.get("/api/payments/mp/status", async (request, reply) => {
    const { paymentId } = request.query as { paymentId?: string };

    if (!paymentId) {
      return reply.status(400).send({ success: false, error: "paymentId query param required" });
    }

    const mp = new MercadoPagoProvider();
    if (!mp.isAvailable) {
      return reply.status(503).send({ success: false, error: "Mercado Pago not configured" });
    }

    try {
      const payment = await mp.getPayment(paymentId);
      return {
        success: true,
        paymentId: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        paymentMethod: payment.payment_method_id,
        paymentType: payment.payment_type_id,
        dateCreated: payment.date_created,
        dateApproved: payment.date_approved,
      };
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // ─── POST /api/payments/smart-checkout ─────────────────────────────────
  // Smart checkout: get options, execute payment, handle fallbacks
  app.post("/api/payments/smart-checkout", async (request, reply) => {
    const body = request.body as {
      userId: string;
      methodId?: string;
      provider?: string;
      amount: number;
      currency?: string;
      store?: string;
      productName?: string;
      description?: string;
      botId?: string;
    };

    const user = await findUser(body.userId);
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const currency = body.currency || "USD";

    // If no method specified, return options
    if (!body.methodId && !body.provider) {
      const options = await getPaymentOptions(user.id, body.amount, currency, body.store);
      return { success: true, action: "choose", ...options };
    }

    // Execute payment with selected method
    const provider = body.provider?.toUpperCase() || "";
    let method = null;

    if (body.methodId) {
      method = await prisma.paymentMethod.findFirst({
        where: { id: body.methodId, userId: user.id, status: "CONNECTED" },
      });
    } else if (provider) {
      method = await prisma.paymentMethod.findFirst({
        where: { userId: user.id, provider: provider as any, status: "CONNECTED" },
      });
    }

    if (!method) {
      return reply.status(404).send({ success: false, error: "Payment method not found or not connected" });
    }

    const description = body.description || body.productName || "PayJarvis purchase";

    // Route to correct provider
    switch (method.provider) {
      case "STRIPE": {
        if (!user.stripeCustomerId) {
          return reply.status(400).send({ success: false, error: "No Stripe customer", fallback: "payment_link" });
        }
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) return reply.status(503).send({ success: false, error: "Stripe not configured" });

        const stripe = new Stripe(stripeKey);
        try {
          const savedMethods = await stripe.paymentMethods.list({
            customer: user.stripeCustomerId,
            type: "card",
          });

          if (savedMethods.data.length === 0) {
            // Fallback: create payment link
            const price = await stripe.prices.create({
              unit_amount: Math.round(body.amount * 100),
              currency: currency.toLowerCase(),
              product_data: { name: description },
            });
            const link = await stripe.paymentLinks.create({
              line_items: [{ price: price.id, quantity: 1 }],
            });
            return { success: true, provider: "STRIPE", action: "payment_link", url: link.url };
          }

          const intent = await stripe.paymentIntents.create({
            amount: Math.round(body.amount * 100),
            currency: currency.toLowerCase(),
            customer: user.stripeCustomerId,
            payment_method: savedMethods.data[0].id,
            off_session: true,
            confirm: true,
            description,
          });

          return {
            success: true,
            provider: "STRIPE",
            action: "charged",
            paymentIntentId: intent.id,
            status: intent.status,
            amount: body.amount,
            currency,
          };
        } catch (err: any) {
          return reply.status(400).send({ success: false, provider: "STRIPE", error: err.message });
        }
      }

      case "PAYPAL": {
        const paypal = new PayPalProvider();
        if (!paypal.isAvailable) return reply.status(503).send({ success: false, error: "PayPal not configured" });

        try {
          const result = await paypal.createPaymentIntent({
            amount: body.amount,
            currency,
            merchantAccountId: body.store || "PayJarvis",
            metadata: { userId: user.id, description },
          });

          return {
            success: true,
            provider: "PAYPAL",
            action: "approve",
            orderId: result.id,
            approvalUrl: result.redirectUrl,
            amount: body.amount,
            currency,
          };
        } catch (err: any) {
          return reply.status(400).send({ success: false, provider: "PAYPAL", error: err.message });
        }
      }

      case "MERCADOPAGO": {
        const mp = new MercadoPagoProvider();
        if (!mp.isAvailable) return reply.status(503).send({ success: false, error: "Mercado Pago not configured" });

        try {
          const pref = await mp.createPreference({
            title: description,
            amount: body.amount,
          });

          return {
            success: true,
            provider: "MERCADOPAGO",
            action: "checkout_pro",
            preferenceId: pref.id,
            paymentUrl: pref.initPoint,
            amount: body.amount,
            currency: "BRL",
          };
        } catch (err: any) {
          return reply.status(400).send({ success: false, provider: "MERCADOPAGO", error: err.message });
        }
      }

      default:
        return reply.status(400).send({
          success: false,
          error: `Provider ${method.provider} execution not yet supported. Use PayPal, Stripe, or Mercado Pago.`,
        });
    }
  });
}
