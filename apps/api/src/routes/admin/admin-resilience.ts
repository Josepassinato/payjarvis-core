/**
 * Admin Resilience Routes — circuit breakers, kill switches, feature flags, monitoring.
 *
 * All routes require admin JWT authentication.
 */

import { FastifyInstance } from "fastify";
import { getAllBreakerStates, getBreaker } from "../../services/resilience/circuit-breaker.js";
import { killService, reviveService, getKillSwitchStatus } from "../../services/resilience/kill-switch.js";
import { getAllFlags, setFeatureFlag, isFeatureEnabled } from "../../services/resilience/feature-flags.js";
import { getHealthSummary, getMetricsSummary } from "../../services/monitoring/telegram-alerts.service.js";

export async function adminResilienceRoutes(app: FastifyInstance) {
  // ─── Circuit Breakers ───

  app.get("/admin/resilience/circuit-breakers", async () => {
    return getAllBreakerStates();
  });

  app.post<{ Params: { service: string } }>("/admin/resilience/circuit-breakers/:service/reset", async (req) => {
    const cb = getBreaker(req.params.service);
    cb.recordSuccess(); // Force reset to CLOSED
    return { success: true, service: req.params.service, state: "CLOSED" };
  });

  // ─── Kill Switches ───

  app.get("/admin/resilience/kill-switches", async () => {
    return getKillSwitchStatus();
  });

  app.post<{ Params: { service: string }; Body: { reason?: string; ttlSeconds?: number } }>(
    "/admin/resilience/kill-switches/:service/kill",
    async (req) => {
      const { service } = req.params;
      const { reason, ttlSeconds } = req.body || {};
      await killService(service, reason, ttlSeconds);
      return { success: true, service, status: "killed" };
    }
  );

  app.post<{ Params: { service: string } }>(
    "/admin/resilience/kill-switches/:service/revive",
    async (req) => {
      await reviveService(req.params.service);
      return { success: true, service: req.params.service, status: "active" };
    }
  );

  // ─── Feature Flags ───

  app.get("/admin/resilience/feature-flags", async () => {
    return getAllFlags();
  });

  app.put<{ Params: { flag: string }; Body: { enabled?: boolean; canaryUserIds?: string[]; rolloutPercent?: number } }>(
    "/admin/resilience/feature-flags/:flag",
    async (req) => {
      await setFeatureFlag(req.params.flag, req.body);
      return { success: true, flag: req.params.flag };
    }
  );

  app.get<{ Params: { flag: string }; Querystring: { userId?: string } }>(
    "/admin/resilience/feature-flags/:flag/check",
    async (req) => {
      const enabled = await isFeatureEnabled(req.params.flag, req.query.userId);
      return { flag: req.params.flag, enabled, userId: req.query.userId };
    }
  );

  // ─── Health & Metrics ───

  app.get("/admin/resilience/health", async () => {
    const summary = await getHealthSummary();
    return { html: summary };
  });

  app.get("/admin/resilience/metrics", async () => {
    const summary = await getMetricsSummary();
    return { html: summary };
  });
}
