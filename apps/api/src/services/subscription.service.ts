/**
 * Subscription Service — Jarvis Premium $20/month recurring billing.
 *
 * Premium subscribers get unlimited messages.
 * Uses Stripe Subscriptions + Customer Portal.
 */

import Stripe from "stripe";
import { prisma } from "@payjarvis/database";

const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY || "";
const STRIPE_PORTAL_CONFIG_ID = process.env.STRIPE_PORTAL_CONFIG_ID || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key);
}

// ─── Notification helper ─────────────────────────────────

async function notifyUser(userId: string, text: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, phone: true },
  });
  if (!user) return;

  try {
    if (user.telegramChatId && TELEGRAM_BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.telegramChatId, text }),
      });
    } else if (user.phone && TWILIO_ACCOUNT_SID) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: TWILIO_WHATSAPP_NUMBER,
          To: `whatsapp:${user.phone}`,
          Body: text,
        }).toString(),
      });
    }
  } catch (err) {
    console.error("[Subscription] notify error:", (err as Error).message);
  }
}

// ─── Core Functions ──────────────────────────────────────

export async function createSubscription(
  userId: string,
  paymentMethodId?: string,
): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
  const stripe = getStripe();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, error: "User not found" };

  if (user.subscriptionStatus === "active") {
    return { success: false, error: "Already subscribed" };
  }

  // Ensure Stripe Customer exists
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.fullName ?? undefined,
      metadata: { payjarvisUserId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
  }

  // Attach payment method if provided
  if (paymentMethodId) {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: STRIPE_PRICE_ID }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: { payjarvisUserId: userId },
    });

    const status = subscription.status;

    await prisma.user.update({
      where: { id: userId },
      data: {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: status,
        planType: status === "active" ? "premium" : "free",
        subscriptionEndsAt: new Date(subscription.current_period_end * 1000),
      },
    });

    if (status === "active") {
      notifyUser(userId, "Welcome to Jarvis Premium! Unlimited messages activated.").catch(() => {});
    }

    console.log(`[Subscription] Created ${subscription.id} for ${userId} — status: ${status}`);

    // If incomplete, return client_secret for frontend confirmation
    const invoice = subscription.latest_invoice as Stripe.Invoice | null;
    const pi = invoice?.payment_intent as Stripe.PaymentIntent | null;

    return {
      success: true,
      subscriptionId: subscription.id,
      ...(pi?.client_secret ? { clientSecret: pi.client_secret } : {}),
    } as { success: boolean; subscriptionId: string; error?: string };
  } catch (err) {
    console.error("[Subscription] Create error:", (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
}

export async function cancelSubscription(
  userId: string,
): Promise<{ success: boolean; error?: string; endsAt?: Date }> {
  const stripe = getStripe();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeSubscriptionId) {
    return { success: false, error: "No active subscription" };
  }

  try {
    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const endsAt = new Date(updated.current_period_end * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionEndsAt: endsAt },
    });

    const lang = user.phone?.startsWith("+55") ? "pt" : "en";
    const msg = lang === "pt"
      ? `Sua assinatura será cancelada em ${endsAt.toLocaleDateString("pt-BR")}. Você continua com acesso ilimitado até lá.`
      : `Your subscription will end on ${endsAt.toLocaleDateString("en-US")}. You keep unlimited access until then.`;
    notifyUser(userId, msg).catch(() => {});

    console.log(`[Subscription] Canceled at period end: ${user.stripeSubscriptionId}`);
    return { success: true, endsAt };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getPortalUrl(
  userId: string,
  returnUrl: string = "https://www.payjarvis.com/billing",
): Promise<{ success: boolean; url?: string; error?: string }> {
  const stripe = getStripe();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeCustomerId) {
    return { success: false, error: "No Stripe customer" };
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
      ...(STRIPE_PORTAL_CONFIG_ID ? { configuration: STRIPE_PORTAL_CONFIG_ID } : {}),
    });
    return { success: true, url: session.url };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getSubscriptionStatus(userId: string): Promise<{
  planType: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: Date | null;
  messagesRemaining: number;
  unlimited: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { planType: true, subscriptionStatus: true, subscriptionEndsAt: true },
  });

  const credit = await prisma.llmCredit.findUnique({ where: { userId } });

  const isActive = user?.subscriptionStatus === "active";

  return {
    planType: user?.planType ?? "free",
    subscriptionStatus: user?.subscriptionStatus ?? null,
    subscriptionEndsAt: user?.subscriptionEndsAt ?? null,
    messagesRemaining: credit?.messagesRemaining ?? 0,
    unlimited: isActive,
  };
}

// ─── Webhook Handlers ────────────────────────────────────

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) {
    console.warn(`[Subscription] invoice.paid: no user for customer ${customerId}`);
    return;
  }

  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  const endsAt = periodEnd ? new Date(periodEnd * 1000) : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: "active",
      planType: "premium",
      ...(endsAt ? { subscriptionEndsAt: endsAt } : {}),
    },
  });

  notifyUser(user.id, "Subscription renewed. Unlimited messages active.").catch(() => {});
  console.log(`[Subscription] invoice.paid for ${user.id}, ends ${endsAt?.toISOString()}`);
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { subscriptionStatus: "past_due" },
  });

  const lang = user.phone?.startsWith("+55") ? "pt" : "en";
  const msg = lang === "pt"
    ? "Pagamento da assinatura falhou.\n\nAtualize seu cartão para continuar:\npayjarvis.com/billing"
    : "Payment failed for your Jarvis subscription.\n\nUpdate your card to continue:\npayjarvis.com/billing";
  notifyUser(user.id, msg).catch(() => {});
  console.log(`[Subscription] invoice.payment_failed for ${user.id}`);
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return;

  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return;

  const credit = await prisma.llmCredit.findUnique({ where: { userId: user.id } });
  const remaining = credit?.messagesRemaining ?? 0;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: "canceled",
      planType: "free",
      stripeSubscriptionId: null,
    },
  });

  const lang = user.phone?.startsWith("+55") ? "pt" : "en";
  const msg = lang === "pt"
    ? `Sua assinatura Premium foi cancelada.\n\nVocê ainda tem ${remaining} mensagens disponíveis.\n\nReative quando quiser: payjarvis.com/upgrade`
    : `Your Jarvis Premium subscription has been canceled.\n\nYou still have ${remaining} messages available.\n\nReactivate anytime: payjarvis.com/upgrade`;
  notifyUser(user.id, msg).catch(() => {});
  console.log(`[Subscription] deleted for ${user.id}`);
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return;

  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: subscription.status,
      subscriptionEndsAt: new Date(subscription.current_period_end * 1000),
      planType: subscription.status === "active" ? "premium" : user.planType,
      stripeSubscriptionId: subscription.id,
    },
  });

  console.log(`[Subscription] updated ${user.id} → ${subscription.status}`);
}
