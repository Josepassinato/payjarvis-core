/**
 * Tracking Routes — Package tracking API
 *
 * GET  /api/tracking/:code     — Track a package
 * POST /api/tracking/watch     — Add code to watchlist
 * DELETE /api/tracking/watch/:code — Remove from watchlist
 * GET  /api/tracking/watched   — List watched packages
 */

import type { FastifyInstance } from "fastify";
import {
  trackPackage,
  detectCarrier,
} from "../services/tracking/tracking-service.js";

// In-memory watchlist (per user via bot API key)
// In production, move to PostgreSQL/Redis
const watchlist = new Map<
  string,
  Array<{ code: string; carrier: string; addedAt: string }>
>();

export async function trackingRoutes(app: FastifyInstance) {
  // ── Track a package ──────────────────────────────
  app.get("/api/tracking/:code", async (request, reply) => {
    const { code } = request.params as { code: string };

    if (!code || code.trim().length < 5) {
      return reply
        .status(400)
        .send({ success: false, error: "Invalid tracking code" });
    }

    try {
      const result = await trackPackage(code);
      return reply.send({
        success: result.success,
        data: result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tracking failed";
      request.log.error(err, "[TRACKING] Error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Add to watchlist ─────────────────────────────
  app.post("/api/tracking/watch", async (request, reply) => {
    const body = request.body as { code: string; userId?: string };

    if (!body?.code) {
      return reply
        .status(400)
        .send({ success: false, error: "code is required" });
    }

    const code = body.code.trim().replace(/\s/g, "");
    const userId = body.userId ?? "default";
    const carrier = detectCarrier(code);

    if (!watchlist.has(userId)) {
      watchlist.set(userId, []);
    }

    const userList = watchlist.get(userId)!;

    // Check if already watching
    if (userList.some((w) => w.code === code)) {
      return reply.send({
        success: true,
        data: { code, carrier, message: "Already watching" },
      });
    }

    // Max 20 per user
    if (userList.length >= 20) {
      return reply.status(400).send({
        success: false,
        error: "Maximum 20 tracked packages. Remove old ones first.",
      });
    }

    userList.push({ code, carrier, addedAt: new Date().toISOString() });

    return reply.send({
      success: true,
      data: { code, carrier, message: "Added to watchlist" },
    });
  });

  // ── Remove from watchlist ────────────────────────
  app.delete("/api/tracking/watch/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const userId =
      (request.query as { userId?: string })?.userId ?? "default";

    const userList = watchlist.get(userId);
    if (!userList) {
      return reply
        .status(404)
        .send({ success: false, error: "Code not found in watchlist" });
    }

    const idx = userList.findIndex((w) => w.code === code);
    if (idx === -1) {
      return reply
        .status(404)
        .send({ success: false, error: "Code not found in watchlist" });
    }

    userList.splice(idx, 1);
    return reply.send({ success: true, data: { code, message: "Removed" } });
  });

  // ── List watched packages ────────────────────────
  app.get("/api/tracking/watched", async (request, reply) => {
    const userId =
      (request.query as { userId?: string })?.userId ?? "default";
    const userList = watchlist.get(userId) ?? [];

    // Optionally fetch current status for each
    const withStatus =
      (request.query as { status?: string })?.status === "true";

    if (!withStatus) {
      return reply.send({ success: true, data: userList });
    }

    // Fetch all statuses in parallel
    const results = await Promise.allSettled(
      userList.map(async (w) => {
        const result = await trackPackage(w.code);
        return {
          ...w,
          status: result.status,
          statusLabel: result.statusLabel,
          lastEvent: result.lastEvent,
          estimatedDelivery: result.estimatedDelivery,
        };
      })
    );

    const data = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { ...userList[i], status: "error", statusLabel: "Erro" }
    );

    return reply.send({ success: true, data });
  });
}
