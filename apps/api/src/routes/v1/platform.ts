/**
 * Platform Integration Routes — /v1/platform/*
 *
 * Endpoints para grandes plataformas que querem
 * integrar com o Payjarvis:
 * - Registro de webhooks
 * - Verificação em lote
 * - Estatísticas de bots
 */

import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { BditVerifier } from "@payjarvis/bdit";
import { prisma } from "@payjarvis/database";

export async function platformRoutes(app: FastifyInstance) {
  const publicKeyPem = process.env.PAYJARVIS_PUBLIC_KEY?.replace(
    /\\n/g,
    "\n"
  );
  const verifier = publicKeyPem
    ? BditVerifier.fromPublicKey(publicKeyPem)
    : BditVerifier.fromJwks(
        "https://api.payjarvis.com/.well-known/jwks.json"
      );

  // ─── POST /v1/platform/register ───────────────────
  app.post("/v1/platform/register", async (request, reply) => {
    const body = request.body as {
      platform: string;
      webhookUrl: string;
      events: string[];
      contactEmail?: string;
    };

    if (!body.platform || !body.webhookUrl || !body.events?.length) {
      return reply.status(400).send({
        success: false,
        error: "platform, webhookUrl, and events are required",
      });
    }

    // Validate URL format
    try {
      new URL(body.webhookUrl);
    } catch {
      return reply.status(400).send({
        success: false,
        error: "Invalid webhookUrl format",
      });
    }

    const validEvents = [
      "bot.purchase.verified",
      "bot.purchase.blocked",
      "bot.purchase.pending",
      "bot.trust_score.changed",
    ];

    const invalidEvents = body.events.filter(
      (e) => !validEvents.includes(e)
    );
    if (invalidEvents.length > 0) {
      return reply.status(400).send({
        success: false,
        error: `Invalid events: ${invalidEvents.join(", ")}`,
        validEvents,
      });
    }

    // Generate HMAC secret for webhook signing
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

    const registration = await prisma.platformRegistration.create({
      data: {
        platformType: body.platform,
        webhookUrl: body.webhookUrl,
        events: body.events,
        secret,
        contactEmail: body.contactEmail ?? null,
        isActive: false,
      },
    });

    // Fire verification ping in background (non-blocking)
    verifyWebhookUrl(registration.id, body.webhookUrl, secret).catch(
      (err) => app.log.error({ err, id: registration.id }, "Webhook verification ping failed")
    );

    return {
      success: true,
      data: {
        platformId: registration.id,
        platform: registration.platformType,
        webhookUrl: registration.webhookUrl,
        events: registration.events,
        secret,
        status: "pending_verification",
        message:
          "Registrado. Enviamos um webhook de teste para " +
          "verificar a URL. Responda com HTTP 200 para ativar.",
      },
    };
  });

  // ─── GET /v1/platform/registrations ─────────────────
  app.get("/v1/platform/registrations", async (_request, reply) => {
    const registrations = await prisma.platformRegistration.findMany({
      orderBy: { createdAt: "desc" },
    });

    return reply.send({
      success: true,
      data: registrations.map((r) => ({
        id: r.id,
        platformType: r.platformType,
        webhookUrl: r.webhookUrl,
        events: r.events,
        contactEmail: r.contactEmail,
        isActive: r.isActive,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });

  // ─── POST /v1/platform/verify-batch ────────────────
  app.post("/v1/platform/verify-batch", async (request, reply) => {
    const body = request.body as { tokens: string[] };

    if (!body.tokens?.length) {
      return reply.status(400).send({
        success: false,
        error: "tokens array is required",
      });
    }

    if (body.tokens.length > 100) {
      return reply.status(400).send({
        success: false,
        error: "Maximum 100 tokens per batch request",
      });
    }

    const results = await Promise.all(
      body.tokens.map(async (token) => {
        const result = await verifier.verify(token);

        if (!result.valid || !result.payload) {
          return {
            verified: false,
            error: result.error ?? "Invalid token",
          };
        }

        const p = result.payload;
        return {
          verified: true,
          bot: {
            id: p.bot_id,
            trustScore: p.trust_score,
          },
          authorization: {
            amount: p.amount,
            category: p.category,
            merchantId: p.merchant_id,
            validUntil: new Date(p.exp * 1000).toISOString(),
          },
        };
      })
    );

    return reply
      .header("Cache-Control", "no-store")
      .send({
        success: true,
        data: {
          total: results.length,
          verified: results.filter((r) => r.verified).length,
          failed: results.filter((r) => !r.verified).length,
          results,
        },
      });
  });

  // ─── GET /v1/platform/stats/:merchantId ────────────
  app.get(
    "/v1/platform/stats/:merchantId",
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };

      const [
        totalVerified,
        totalBlocked,
        totalPending,
        avgTrustScoreResult,
        topBotsResult,
      ] = await Promise.all([
        prisma.transaction.count({
          where: { merchantId, decision: "APPROVED" },
        }),
        prisma.transaction.count({
          where: { merchantId, decision: "BLOCKED" },
        }),
        prisma.transaction.count({
          where: { merchantId, decision: "PENDING_HUMAN" },
        }),
        prisma.transaction.aggregate({
          where: { merchantId, decision: "APPROVED" },
          _avg: {
            amount: true,
          },
        }),
        prisma.transaction.groupBy({
          by: ["botId"],
          where: { merchantId },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        }),
      ]);

      // Fetch bot platforms for top bots
      const topBotIds = topBotsResult.map((b: any) => b.botId);
      const bots = topBotIds.length > 0
        ? await prisma.bot.findMany({
            where: { id: { in: topBotIds } },
            select: { id: true, platform: true },
          })
        : [];

      const platformCounts = new Map<string, number>();
      for (const bot of bots) {
        const count = platformCounts.get(bot.platform) ?? 0;
        platformCounts.set(bot.platform, count + 1);
      }

      const topBotPlatforms = [...platformCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([platform]) => platform);

      return reply
        .header("Cache-Control", "public, max-age=300")
        .send({
          success: true,
          data: {
            merchantId,
            totalVerified,
            totalBlocked,
            totalPending,
            avgTransactionAmount:
              avgTrustScoreResult._avg?.amount ?? 0,
            topBotPlatforms,
            uniqueBots: topBotsResult.length,
          },
        });
    }
  );

  // ─── Load active registrations on startup ───────────
  const active = await prisma.platformRegistration.findMany({
    where: { isActive: true },
  });
  app.log.info(
    { count: active.length },
    "Loaded active platform registrations"
  );
}

// ─── Helpers ────────────────────────────────────────────

/** Send a verification ping to the webhook URL; activate on 2xx */
async function verifyWebhookUrl(
  registrationId: string,
  webhookUrl: string,
  secret: string
): Promise<void> {
  const payload = JSON.stringify({
    event: "verification",
    registrationId,
    timestamp: new Date().toISOString(),
  });

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PayJarvis-Signature": signature,
      },
      body: payload,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      await prisma.platformRegistration.update({
        where: { id: registrationId },
        data: { isActive: true },
      });
    }
  } catch {
    clearTimeout(timeout);
    // Verification failed — stays inactive, can retry later
  }
}
