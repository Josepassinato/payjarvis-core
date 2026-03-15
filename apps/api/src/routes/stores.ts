/**
 * Store Routes — Universal connected store management
 *
 * GET    /api/stores                    — List user's connected stores
 * POST   /api/stores/connect            — Connect a new store (creates Context + login session)
 * GET    /api/stores/:store/status      — Check authentication status
 * DELETE /api/stores/:store             — Disconnect a store
 * PUT    /api/stores/:store/bots/:botId — Update bot permissions for a store
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "@payjarvis/database";

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";

async function browserAgentFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BROWSER_AGENT_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res.json();
}

export async function storeRoutes(app: FastifyInstance) {

  // ── GET /api/stores ─────────────────────────────────
  app.get("/api/stores", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const contexts = await prisma.storeContext.findMany({
      where: { userId: user.id },
      include: {
        botPermissions: {
          include: { bot: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: {
        stores: contexts.map((ctx) => ({
          store: ctx.store,
          storeLabel: ctx.storeLabel,
          storeUrl: ctx.storeUrl,
          status: ctx.status,
          authenticatedAt: ctx.authenticatedAt?.toISOString() ?? null,
          lastUsedAt: ctx.lastUsedAt.toISOString(),
          botPermissions: ctx.botPermissions.map((bp) => ({
            botId: bp.botId,
            botName: bp.bot.name,
            enabled: bp.enabled,
            maxPerTransaction: bp.maxPerTransaction,
            maxPerDay: bp.maxPerDay,
            maxPerMonth: bp.maxPerMonth,
            autoApproveBelow: bp.autoApproveBelow,
            allowedCategories: bp.allowedCategories,
          })),
        })),
      },
    };
  });

  // ── POST /api/stores/connect ────────────────────────
  app.post("/api/stores/connect", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    const userId = user.id;

    const body = request.body as {
      store: string;
      storeUrl: string;
      storeLabel: string;
    };

    if (!body.store || !body.storeUrl || !body.storeLabel) {
      return reply.status(400).send({
        success: false,
        error: "store, storeUrl, and storeLabel are required",
      });
    }

    // Check if already connected
    const existing = await prisma.storeContext.findUnique({
      where: { userId_store: { userId, store: body.store } },
    });

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: `Store ${body.storeLabel} is already connected`,
        storeContextId: existing.id,
      });
    }

    try {
      // Deep-link approach: just save the store config, no Browserbase needed for login
      app.log.info(`[stores] POST /api/stores/connect — deep-link mode for store=${body.store}`);

      const storeContext = await prisma.storeContext.create({
        data: {
          userId,
          store: body.store,
          storeUrl: body.storeUrl,
          storeLabel: body.storeLabel,
          status: "configured",
        },
      });

      app.log.info(`[stores] POST /api/stores/connect — configured store=${body.store} in ${Date.now()}ms`);

      return {
        success: true,
        data: {
          storeContextId: storeContext.id,
          store: body.store,
          storeLabel: body.storeLabel,
          status: "configured",
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect store";
      app.log.error({ err }, `[stores] POST /api/stores/connect — FAILED`);
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── GET /api/stores/:store/status ───────────────────
  app.get("/api/stores/:store/status", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const { store } = request.params as { store: string };

    const ctx = await prisma.storeContext.findUnique({
      where: { userId_store: { userId: user.id, store } },
    });

    if (!ctx) {
      return { success: true, data: { connected: false, authenticated: false, status: "not_connected", store } };
    }

    // Return current DB status — deep-link mode doesn't need live auth checks
    return {
      success: true,
      data: {
        connected: true,
        authenticated: ctx.status === "authenticated" || ctx.status === "configured",
        status: ctx.status,
        store,
        authenticatedAt: ctx.authenticatedAt?.toISOString() ?? null,
      },
    };
  });

  // ── DELETE /api/stores/:store ───────────────────────
  app.delete("/api/stores/:store", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const { store } = request.params as { store: string };

    const ctx = await prisma.storeContext.findUnique({
      where: { userId_store: { userId: user.id, store } },
      include: { sessions: { where: { status: "running" } } },
    });

    if (!ctx) {
      return reply.status(404).send({ success: false, error: "Store not connected" });
    }

    // Clean up Browserbase resources if they exist
    if (ctx.bbContextId) {
      for (const session of ctx.sessions) {
        try {
          await browserAgentFetch(`/browser/context/close-session`, {
            method: "POST",
            body: JSON.stringify({ bbSessionId: session.bbSessionId }),
          });
        } catch {
          // Ignore cleanup errors
        }
      }
      try {
        await browserAgentFetch(`/browser/context/delete`, {
          method: "POST",
          body: JSON.stringify({ bbContextId: ctx.bbContextId }),
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    // Delete from database (cascades to sessions and permissions)
    await prisma.storeContext.delete({ where: { id: ctx.id } });

    return { success: true, data: { store, disconnected: true } };
  });

  // ── PUT /api/stores/:store/bots/:botId ──────────────
  app.put("/api/stores/:store/bots/:botId", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const { store, botId } = request.params as { store: string; botId: string };
    const body = request.body as {
      enabled?: boolean;
      maxPerTransaction?: number;
      maxPerDay?: number;
      maxPerMonth?: number;
      allowedCategories?: string[];
      autoApproveBelow?: number;
    };

    // Verify ownership
    const ctx = await prisma.storeContext.findUnique({
      where: { userId_store: { userId: user.id, store } },
    });

    if (!ctx) {
      return reply.status(404).send({ success: false, error: "Store not connected" });
    }

    const bot = await prisma.bot.findFirst({
      where: { id: botId, ownerId: user.id },
    });

    if (!bot) {
      return reply.status(404).send({ success: false, error: "Bot not found" });
    }

    const permission = await prisma.storeBotPermission.upsert({
      where: { botId_storeContextId: { botId, storeContextId: ctx.id } },
      update: {
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.maxPerTransaction !== undefined && { maxPerTransaction: body.maxPerTransaction }),
        ...(body.maxPerDay !== undefined && { maxPerDay: body.maxPerDay }),
        ...(body.maxPerMonth !== undefined && { maxPerMonth: body.maxPerMonth }),
        ...(body.allowedCategories !== undefined && { allowedCategories: body.allowedCategories }),
        ...(body.autoApproveBelow !== undefined && { autoApproveBelow: body.autoApproveBelow }),
      },
      create: {
        botId,
        storeContextId: ctx.id,
        enabled: body.enabled ?? true,
        maxPerTransaction: body.maxPerTransaction ?? 50,
        maxPerDay: body.maxPerDay ?? 150,
        maxPerMonth: body.maxPerMonth ?? 500,
        allowedCategories: body.allowedCategories ?? [],
        autoApproveBelow: body.autoApproveBelow ?? 25,
      },
    });

    return { success: true, data: permission };
  });
}
