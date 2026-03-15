import type { FastifyInstance } from "fastify";
import { prisma, Prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import { getPaymentProvider, getAvailableProviders } from "../services/payments/payment-factory.js";
import { StripeProvider } from "../services/payments/providers/stripe.provider.js";
import { PayPalProvider } from "../services/payments/providers/paypal.provider.js";
import { encrypt } from "../services/payments/vault.js";
import { createAuditLog } from "../services/audit.js";

export async function paymentMethodRoutes(app: FastifyInstance) {
  // GET /payment-methods — list all payment methods for the current user
  app.get("/api/payment-methods", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const methods = await prisma.paymentMethod.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const providers = getAvailableProviders();

    return { success: true, data: { methods, providers } };
  });

  // POST /payment-methods/stripe/connect — save user's Stripe secret key
  app.post("/api/payment-methods/stripe/connect", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { stripeSecretKey } = (request.body as { stripeSecretKey?: string }) ?? {};

    if (!stripeSecretKey || typeof stripeSecretKey !== "string") {
      return reply.status(400).send({ success: false, error: "stripeSecretKey is required" });
    }

    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(stripeSecretKey)) {
      return reply.status(400).send({ success: false, error: "Invalid Stripe secret key format. Must start with sk_test_ or sk_live_" });
    }

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const provider = getPaymentProvider("stripe") as StripeProvider;

    // Validate the key against Stripe API
    const validation = await provider.validateSecretKey(stripeSecretKey);
    if (!validation.valid) {
      return reply.status(400).send({ success: false, error: "Invalid Stripe key — could not authenticate with Stripe API" });
    }

    // Encrypt and store
    const encryptedKey = encrypt(stripeSecretKey);
    const keyHint = stripeSecretKey.slice(0, 7) + "..." + stripeSecretKey.slice(-4);

    await prisma.paymentMethod.upsert({
      where: {
        userId_provider: { userId: user.id, provider: "STRIPE" },
      },
      create: {
        userId: user.id,
        provider: "STRIPE",
        status: "CONNECTED",
        accountId: validation.accountName ?? "Stripe Account",
        credentials: { encrypted: encryptedKey },
        metadata: { keyHint },
      },
      update: {
        status: "CONNECTED",
        accountId: validation.accountName ?? "Stripe Account",
        credentials: { encrypted: encryptedKey },
        metadata: { keyHint },
      },
    });

    await createAuditLog({
      entityType: "payment_method",
      entityId: user.id,
      action: "payment_method.connected",
      actorType: "user",
      actorId: user.id,
      payload: { provider: "stripe", keyHint },
      ipAddress: request.ip,
    });

    return { success: true, data: { connected: true, accountName: validation.accountName, keyHint } };
  });

  // POST /payment-methods/setup-intent — create Stripe SetupIntent for card onboarding
  app.post("/api/payment-methods/setup-intent", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const provider = getPaymentProvider("stripe") as StripeProvider;
    if (!provider.isAvailable) {
      return reply.status(503).send({ success: false, error: "Stripe is not configured on this server" });
    }

    // Get or create Stripe Customer
    const customerId = await provider.getOrCreateCustomer({
      userId: user.id,
      email: user.email,
      name: user.fullName ?? undefined,
      existingCustomerId: user.stripeCustomerId,
    });

    // Save stripeCustomerId if new
    if (customerId !== user.stripeCustomerId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const result = await provider.createSetupIntent({
      customerId,
      userId: user.id,
    });

    await createAuditLog({
      entityType: "payment_method",
      entityId: user.id,
      action: "setup_intent.created",
      actorType: "user",
      actorId: user.id,
      payload: { setupIntentId: result.setupIntentId },
      ipAddress: request.ip,
    });

    return { success: true, data: result };
  });

  // POST /payment-methods/setup-intent/confirm — save the card after SetupIntent succeeds
  app.post("/api/payment-methods/setup-intent/confirm", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { setupIntentId } = (request.body as { setupIntentId?: string }) ?? {};

    if (!setupIntentId) {
      return reply.status(400).send({ success: false, error: "setupIntentId is required" });
    }

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const provider = getPaymentProvider("stripe") as StripeProvider;
    const { paymentMethodId, card } = await provider.getSetupIntentPaymentMethod(setupIntentId);

    // Save as payment method
    await prisma.paymentMethod.upsert({
      where: {
        userId_provider: { userId: user.id, provider: "STRIPE" },
      },
      create: {
        userId: user.id,
        provider: "STRIPE",
        status: "CONNECTED",
        accountId: card ? `${card.brand} ****${card.last4}` : "Card",
        credentials: { paymentMethodId },
        metadata: card ? { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear } : {},
      },
      update: {
        status: "CONNECTED",
        accountId: card ? `${card.brand} ****${card.last4}` : "Card",
        credentials: { paymentMethodId },
        metadata: card ? { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear } : {},
      },
    });

    await createAuditLog({
      entityType: "payment_method",
      entityId: user.id,
      action: "payment_method.card_saved",
      actorType: "user",
      actorId: user.id,
      payload: { setupIntentId, brand: card?.brand, last4: card?.last4 },
      ipAddress: request.ip,
    });

    return {
      success: true,
      data: {
        paymentMethodId,
        card,
      },
    };
  });

  // POST /payment-methods/paypal/connect — save user's PayPal credentials
  app.post("/api/payment-methods/paypal/connect", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { clientId, clientSecret } = (request.body as { clientId?: string; clientSecret?: string }) ?? {};

    if (!clientId || typeof clientId !== "string") {
      return reply.status(400).send({ success: false, error: "clientId is required" });
    }
    if (!clientSecret || typeof clientSecret !== "string") {
      return reply.status(400).send({ success: false, error: "clientSecret is required" });
    }

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const provider = getPaymentProvider("paypal") as PayPalProvider;

    // Validate credentials against PayPal API
    const validation = await provider.validateCredentials(clientId, clientSecret);
    if (!validation.valid) {
      return reply.status(400).send({ success: false, error: "Invalid PayPal credentials — could not authenticate with PayPal API" });
    }

    // Encrypt and store both credentials
    const encryptedClientId = encrypt(clientId);
    const encryptedSecret = encrypt(clientSecret);
    const idHint = clientId.slice(0, 6) + "..." + clientId.slice(-4);

    await prisma.paymentMethod.upsert({
      where: {
        userId_provider: { userId: user.id, provider: "PAYPAL" },
      },
      create: {
        userId: user.id,
        provider: "PAYPAL",
        status: "CONNECTED",
        accountId: `PayPal (${validation.environment})`,
        credentials: { encryptedClientId, encryptedSecret },
        metadata: { idHint, environment: validation.environment },
      },
      update: {
        status: "CONNECTED",
        accountId: `PayPal (${validation.environment})`,
        credentials: { encryptedClientId, encryptedSecret },
        metadata: { idHint, environment: validation.environment },
      },
    });

    await createAuditLog({
      entityType: "payment_method",
      entityId: user.id,
      action: "payment_method.connected",
      actorType: "user",
      actorId: user.id,
      payload: { provider: "paypal", idHint, environment: validation.environment },
      ipAddress: request.ip,
    });

    return { success: true, data: { connected: true, environment: validation.environment, idHint } };
  });

  // GET /payment-methods/:provider/status — check connection status for a provider
  app.get("/api/payment-methods/:provider/status", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { provider: providerName } = request.params as { provider: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const method = await prisma.paymentMethod.findFirst({
      where: { userId: user.id, provider: providerName.toUpperCase() as any },
    });

    if (!method) {
      return reply.status(404).send({ success: false, error: "Payment method not found" });
    }

    return {
      success: true,
      data: {
        provider: method.provider,
        status: method.status,
        accountId: method.accountId,
        createdAt: method.createdAt,
        updatedAt: method.updatedAt,
      },
    };
  });

  // DELETE /payment-methods/:provider — disconnect a payment method
  app.delete("/api/payment-methods/:provider", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { provider: providerName } = request.params as { provider: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const method = await prisma.paymentMethod.findFirst({
      where: { userId: user.id, provider: providerName.toUpperCase() as any },
    });

    if (!method) {
      return reply.status(404).send({ success: false, error: "Payment method not found" });
    }

    // Update status to DISABLED and clear credentials
    await prisma.paymentMethod.update({
      where: { id: method.id },
      data: { status: "DISABLED", accountId: null, credentials: Prisma.JsonNull, metadata: Prisma.JsonNull },
    });

    // If stripe, also clear user.stripeAccountId
    if (providerName.toLowerCase() === "stripe") {
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeAccountId: null },
      });
    }

    await createAuditLog({
      entityType: "payment_method",
      entityId: user.id,
      action: "payment_method.disconnected",
      actorType: "user",
      actorId: user.id,
      payload: { provider: providerName.toLowerCase() },
      ipAddress: request.ip,
    });

    return { success: true, message: "Payment method disconnected" };
  });
}
