import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";

const SKYFIRE_BASE = "https://api.skyfire.xyz";
const SKYFIRE_APP = "https://app.skyfire.xyz";

async function skyfireFetchLocal(path: string): Promise<any> {
  const key = process.env.SKYFIRE_API_KEY || "";
  if (!key) return null;
  const res = await fetch(`${SKYFIRE_BASE}${path}`, {
    headers: { "skyfire-api-key": key },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function skyfireRoutes(app: FastifyInstance) {

  // ─── GET /api/wallet/status — User's wallet (card + spending) ───
  app.get("/api/wallet/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Extract userId from Clerk JWT or x-internal-secret
      const userId = (request.query as any)?.userId as string | undefined;

      if (!userId) {
        // Return generic status (master wallet health check)
        const data = await skyfireFetchLocal("/api/v1/agents/balance");
        return reply.send({
          hasCard: false,
          systemReady: !!data && parseFloat(data.available || "0") > 0,
          status: "no_user",
        });
      }

      const { getUserWalletStatus } = await import("../services/purchase-orchestrator.service.js");
      const status = await getUserWalletStatus(userId);
      return reply.send({
        ...status,
        status: status.hasCard ? "ready" : "needs_card",
        setupUrl: "https://www.payjarvis.com/wallet/setup",
      });
    } catch (err) {
      return reply.send({ hasCard: false, status: "error", error: (err as Error).message });
    }
  });

  // ─── GET /api/wallet/balance — System wallet health (backward compat) ───
  app.get("/api/wallet/balance", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await skyfireFetchLocal("/api/v1/agents/balance");
      if (!data) {
        return reply.send({ balance: 0, currency: "USD", status: "not_configured" });
      }
      return reply.send({
        balance: parseFloat(data.available || "0"),
        held: parseFloat(data.heldAmount || "0"),
        pending: parseFloat(data.pendingDeposits || "0"),
        currency: "USD",
        status: parseFloat(data.available || "0") > 0 ? "funded" : "empty",
      });
    } catch {
      return reply.send({ balance: 0, currency: "USD", status: "error" });
    }
  });

  // ─── POST /api/wallet/setup-card — Create Stripe SetupIntent for card ───
  app.post("/api/wallet/setup-card", async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, email, name } = (request.body as any) || {};
    if (!userId) return reply.status(400).send({ error: "userId required" });

    try {
      const { StripeProvider } = await import("../services/payments/providers/stripe.provider.js");
      const stripe = new StripeProvider();

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true, email: true, fullName: true },
      });

      const customerId = await stripe.getOrCreateCustomer({
        userId,
        email: email || user?.email || "",
        name: name || user?.fullName || "",
        existingCustomerId: user?.stripeCustomerId,
      });

      // Save customer ID if new
      if (!user?.stripeCustomerId || user.stripeCustomerId !== customerId) {
        await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
      }

      const { clientSecret, setupIntentId } = await stripe.createSetupIntent({ customerId, userId });
      return reply.send({ success: true, clientSecret, setupIntentId, customerId });
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
  // ─── Skyfire Webhook (future: card registration callback) ───
  app.post("/api/skyfire/webhook", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    console.log("[SKYFIRE WEBHOOK]", JSON.stringify(body).substring(0, 500));

    // Future: Skyfire will POST here when user registers a card
    // Expected payload: { userId, token, last4, brand, event: "card_registered" }
    const event = body.event as string;

    if (event === "card_registered" || event === "wallet_funded") {
      const userId = body.userId as string;
      const last4 = body.last4 as string;
      const brand = body.brand as string;

      if (userId) {
        // Store as PaymentMethod
        try {
          await prisma.paymentMethod.upsert({
            where: { userId_provider_accountId: { userId, provider: "SKYFIRE", accountId: "skyfire-wallet" } },
            create: {
              userId,
              provider: "SKYFIRE",
              status: "CONNECTED",
              accountId: "skyfire-wallet",
              metadata: { last4, brand, fundedAt: new Date().toISOString() },
            },
            update: {
              status: "CONNECTED",
              accountId: "skyfire-wallet",
              metadata: { last4, brand, fundedAt: new Date().toISOString() },
            },
          });
          console.log(`[SKYFIRE WEBHOOK] Card registered for user ${userId}: ${brand} ****${last4}`);
        } catch (err) {
          console.error("[SKYFIRE WEBHOOK] Failed to store payment method:", (err as Error).message);
        }
      }
    }

    return reply.status(200).send({ received: true });
  });

  // ─── Get wallet registration URL ───
  app.get("/api/skyfire/register-url", async (request, reply) => {
    const { userId } = request.query as { userId?: string };
    const url = `https://app.skyfire.xyz${userId ? `?ref=payjarvis&uid=${encodeURIComponent(userId)}` : ""}`;
    return reply.send({ url });
  });

  // ─── Spending summary for dashboard ───
  app.get("/api/skyfire/spending/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const [todayResult, monthResult, limitsResult, recentPurchases] = await Promise.all([
        prisma.$queryRaw<{ total: number }[]>`
          SELECT COALESCE(SUM(price), 0) as total FROM purchase_transactions
          WHERE user_id = ${userId} AND status = 'COMPLETED' AND created_at >= CURRENT_DATE
        `,
        prisma.$queryRaw<{ total: number }[]>`
          SELECT COALESCE(SUM(price), 0) as total FROM purchase_transactions
          WHERE user_id = ${userId} AND status = 'COMPLETED' AND created_at >= date_trunc('month', CURRENT_DATE)
        `,
        prisma.$queryRaw<{ per_transaction: number; daily: number; monthly: number }[]>`
          SELECT per_transaction, daily, monthly FROM spending_limits WHERE user_id = ${userId} LIMIT 1
        `,
        prisma.$queryRaw<any[]>`
          SELECT id, product_name, price, merchant, status, created_at FROM purchase_transactions
          WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 5
        `,
      ]);

      const limits = limitsResult[0] || { per_transaction: 100, daily: 500, monthly: 2000 };

      return reply.send({
        spentToday: Number(todayResult[0]?.total || 0),
        spentThisMonth: Number(monthResult[0]?.total || 0),
        limits: { perTransaction: limits.per_transaction, daily: limits.daily, monthly: limits.monthly },
        recentPurchases: recentPurchases.map(p => ({
          id: p.id,
          product: p.product_name,
          price: p.price,
          merchant: p.merchant,
          status: p.status,
          date: p.created_at,
        })),
      });
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
