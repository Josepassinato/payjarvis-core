/**
 * Engagement Routes — notification preferences, gamification stats, push subscriptions.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import { getGamificationStats, trackInteraction, checkAndGrantAchievements } from "../services/engagement/gamification.service.js";
import { registerPushSubscription, removePushSubscription, getVapidPublicKey } from "../services/engagement/push.service.js";
import {
  recordRecommendationClick,
  recordRecommendationConversion,
  recordRecommendationRejection,
  getRecommendationMetrics,
} from "../services/engagement/recommendation-engine.service.js";
import { handleFollowUpCallback, getFollowUpMetrics } from "../services/engagement/purchase-followup.service.js";

export async function engagementRoutes(app: FastifyInstance) {

  // ─── Notification Preferences ───

  // GET /api/engagement/preferences
  app.get("/api/engagement/preferences", { preHandler: requireAuth }, async (req: any, reply) => {
    const userId = req.userId;
    const prefs = await prisma.userNotificationPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return prefs;
  });

  // PUT /api/engagement/preferences
  app.put("/api/engagement/preferences", { preHandler: requireAuth }, async (req: any, reply) => {
    const userId = req.userId;
    const body = req.body as Record<string, any>;

    const allowedFields = [
      "morningBriefing", "priceAlerts", "reengagement", "weeklyReport",
      "smartTips", "achievements", "birthday", "pushEnabled", "timezone",
    ];

    const data: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) data[field] = body[field];
    }

    const prefs = await prisma.userNotificationPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return prefs;
  });

  // ─── Gamification Stats ───

  // GET /api/engagement/gamification
  app.get("/api/engagement/gamification", { preHandler: requireAuth }, async (req: any) => {
    return getGamificationStats(req.userId);
  });

  // ─── Push Subscriptions ───

  // GET /api/engagement/push/vapid-key
  app.get("/api/engagement/push/vapid-key", async () => {
    return { publicKey: getVapidPublicKey() };
  });

  // POST /api/engagement/push/subscribe
  app.post("/api/engagement/push/subscribe", { preHandler: requireAuth }, async (req: any, reply) => {
    const { subscription } = req.body as { subscription: { endpoint: string; keys: { p256dh: string; auth: string } } };
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return reply.status(400).send({ error: "Invalid push subscription" });
    }
    await registerPushSubscription(req.userId, subscription);
    return { ok: true };
  });

  // DELETE /api/engagement/push/unsubscribe
  app.delete("/api/engagement/push/unsubscribe", { preHandler: requireAuth }, async (req: any) => {
    const { endpoint } = req.body as { endpoint: string };
    if (endpoint) await removePushSubscription(req.userId, endpoint);
    return { ok: true };
  });

  // ─── Manage Settings via Chat (Internal — called by OpenClaw bot) ───

  // POST /api/engagement/preferences/manage
  app.post("/api/engagement/preferences/manage", async (req: any, reply) => {
    // Internal secret auth (from OpenClaw)
    const secret = req.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const { userId: chatUserId, action, setting, value } = req.body as {
      userId: string;
      action: string;
      setting?: string;
      value?: string;
      category?: string;
    };

    // Resolve user from telegram chatId or whatsapp phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { telegramChatId: chatUserId },
          { phone: chatUserId.replace("whatsapp:", "") },
        ],
      },
      select: { id: true },
    });
    if (!user) return reply.status(404).send({ error: "User not found" });
    const realUserId = user.id;

    if (action === "get") {
      const prefs = await prisma.userNotificationPreferences.upsert({
        where: { userId: realUserId },
        create: { userId: realUserId },
        update: {},
      });
      return {
        success: true,
        settings: {
          morningBriefing: prefs.morningBriefing,
          priceAlerts: prefs.priceAlerts,
          reengagement: prefs.reengagement,
          weeklyReport: prefs.weeklyReport,
          smartTips: prefs.smartTips,
          achievements: prefs.achievements,
          birthday: prefs.birthday,
          recommendations: prefs.recommendations,
          pushEnabled: prefs.pushEnabled,
          timezone: prefs.timezone,
        },
      };
    }

    if (!setting) return reply.status(400).send({ error: "Specify which setting to change" });

    const boolSettings = ["morningBriefing", "priceAlerts", "reengagement", "weeklyReport", "smartTips", "achievements", "birthday", "recommendations", "pushEnabled"];
    if (boolSettings.includes(setting)) {
      const newValue = action === "enable" ? true : action === "disable" ? false : value === "true";
      await prisma.userNotificationPreferences.upsert({
        where: { userId: realUserId },
        create: { userId: realUserId, [setting]: newValue },
        update: { [setting]: newValue },
      });
      return { success: true, setting, value: newValue, message: `${setting} is now ${newValue ? "enabled" : "disabled"}. To revert, just tell me!` };
    }

    if (setting === "timezone" && value) {
      await prisma.userNotificationPreferences.upsert({
        where: { userId: realUserId },
        create: { userId: realUserId, timezone: value },
        update: { timezone: value },
      });
      return { success: true, setting: "timezone", value, message: `Timezone updated to ${value}` };
    }

    return reply.status(400).send({ error: `Unknown setting: ${setting}. Available: ${boolSettings.join(", ")}, timezone` });
  });

  // ─── Proactive Message History ───

  // GET /api/engagement/messages
  app.get("/api/engagement/messages", { preHandler: requireAuth }, async (req: any) => {
    const userId = req.userId;
    const messages = await prisma.proactiveMessageLog.findMany({
      where: { userId },
      orderBy: { sentAt: "desc" },
      take: 50,
    });
    return messages;
  });

  // ─── Gamification Tracking (Internal — called by OpenClaw bot) ───

  // POST /api/engagement/gamification/track
  app.post("/api/engagement/gamification/track", async (req: any, reply) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const { userId, type, value } = req.body as { userId: string; type: string; value?: number };
    if (!userId || !type) return reply.status(400).send({ error: "userId and type required" });

    // Resolve user from telegram chatId
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { telegramChatId: userId },
          { phone: userId.replace("whatsapp:", "") },
          { id: userId },
        ],
      },
      select: { id: true },
    });
    if (!user) return { ok: false, message: "User not found in Prisma" };

    const stats = await trackInteraction(user.id, type as any, value);
    await checkAndGrantAchievements(user.id);
    return { ok: true, stats };
  });

  // ─── Recommendation Feedback (Internal — called by OpenClaw bot + PWA) ───

  // POST /api/recommendations/:id/feedback
  app.post("/api/recommendations/:id/feedback", async (req: any, reply) => {
    // Accept internal secret OR Clerk auth
    const secret = req.headers["x-internal-secret"];
    const isInternal = secret === process.env.INTERNAL_SECRET;
    if (!isInternal) {
      // Could add Clerk auth check here for PWA, but for now require internal secret
      return reply.status(403).send({ error: "Forbidden" });
    }

    const recId = (req.params as { id: string }).id;
    const { action, userId } = req.body as { action: string; userId?: string };

    if (!recId || !action) {
      return reply.status(400).send({ error: "id and action required" });
    }

    // Fetch recommendation to get product info
    const rec = await prisma.recommendation.findUnique({ where: { id: recId } });
    if (!rec) return reply.status(404).send({ error: "Recommendation not found" });

    try {
      if (action === "click") {
        await recordRecommendationClick(recId);
        return { ok: true, action: "clicked", productUrl: rec.productUrl };
      }

      if (action === "reject") {
        await recordRecommendationRejection(recId);
        return { ok: true, action: "rejected", product: rec.productName };
      }

      if (action === "stop") {
        await recordRecommendationRejection(recId);
        // Disable recommendations for this user
        if (userId) {
          const user = await prisma.user.findFirst({
            where: {
              OR: [
                { telegramChatId: userId },
                { phone: userId.replace("whatsapp:", "") },
                { id: userId },
              ],
            },
            select: { id: true },
          });
          if (user) {
            await prisma.userNotificationPreferences.upsert({
              where: { userId: user.id },
              create: { userId: user.id, recommendations: false },
              update: { recommendations: false },
            });
          }
        }
        return { ok: true, action: "stopped" };
      }

      if (action === "convert") {
        await recordRecommendationConversion(recId);
        return { ok: true, action: "converted" };
      }

      return reply.status(400).send({ error: `Unknown action: ${action}. Use: click, reject, stop, convert` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Feedback failed";
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/recommendations/metrics (admin)
  app.get("/api/recommendations/metrics", async (req: any, reply) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const days = parseInt((req.query as any).days || "14", 10);
    return getRecommendationMetrics(days);
  });

  // ─── Post-Purchase Follow-Up ───

  // POST /api/purchases/:id/followup (Internal — from OpenClaw callbacks)
  app.post("/api/purchases/:id/followup", async (req: any, reply) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const purchaseId = (req.params as { id: string }).id;
    const { action, userId } = req.body as { action: string; userId?: string };
    if (!purchaseId || !action) return reply.status(400).send({ error: "id and action required" });

    const result = await handleFollowUpCallback(purchaseId, action, userId || "");
    return result;
  });

  // GET /api/purchases/metrics (admin)
  app.get("/api/purchases/metrics", async (req: any, reply) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const days = parseInt((req.query as any).days || "30", 10);
    return getFollowUpMetrics(days);
  });
}
