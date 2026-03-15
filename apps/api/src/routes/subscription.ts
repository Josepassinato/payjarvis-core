/**
 * Subscription Routes — Jarvis Premium $20/month.
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "@payjarvis/database";
import {
  createSubscription,
  cancelSubscription,
  getPortalUrl,
  getSubscriptionStatus,
} from "../services/subscription.service.js";

export async function subscriptionRoutes(app: FastifyInstance) {
  // POST /api/subscription/create — start a subscription
  app.post("/api/subscription/create", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const { paymentMethodId } = (request.body as { paymentMethodId?: string }) ?? {};

    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const result = await createSubscription(user.id, paymentMethodId);
    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    return { success: true, data: result };
  });

  // GET /api/subscription/status — current subscription status
  app.get("/api/subscription/status", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;

    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const status = await getSubscriptionStatus(user.id);
    return { success: true, data: status };
  });

  // GET /api/subscription/portal — get Customer Portal URL
  app.get("/api/subscription/portal", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const { returnUrl } = request.query as { returnUrl?: string };

    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const result = await getPortalUrl(user.id, returnUrl);
    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    return { success: true, data: { url: result.url } };
  });

  // DELETE /api/subscription/cancel — cancel at end of period
  app.delete("/api/subscription/cancel", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;

    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const result = await cancelSubscription(user.id);
    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    return { success: true, data: { endsAt: result.endsAt } };
  });
}
