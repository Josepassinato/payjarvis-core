/**
 * Public BDIT Verification Endpoint — /v1/verify
 *
 * Qualquer merchant pode chamar sem autenticação.
 * Verifica um BDIT token e retorna informações do bot
 * e da autorização de pagamento.
 *
 * Rate limit: 1000 req/min por IP
 * Cache: resposta cacheável por 60s
 */

import type { FastifyInstance } from "fastify";
import { BditVerifier } from "@payjarvis/bdit";
import { prisma } from "@payjarvis/database";
import { redisExists } from "../../services/redis.js";

export async function publicVerifyRoutes(app: FastifyInstance) {
  const verifier = BditVerifier.fromJwks(
    process.env.JWKS_PUBLIC_URL ??
      "https://api.payjarvis.com/.well-known/jwks.json",
    24 * 60 * 60 * 1000 // 24h cache
  );

  // Fallback: use local public key if available
  const publicKeyPem = process.env.PAYJARVIS_PUBLIC_KEY?.replace(
    /\\n/g,
    "\n"
  );
  const localVerifier = publicKeyPem
    ? BditVerifier.fromPublicKey(publicKeyPem)
    : null;

  // ─── GET /v1/verify ────────────────────────────────
  app.get("/v1/verify", async (request, reply) => {
    const token =
      (request.headers["x-bdit-token"] as string) ??
      extractBearerToken(request.headers.authorization as string | undefined);

    const merchantId = request.headers["x-merchant-id"] as
      | string
      | undefined;

    if (!token) {
      return reply.status(400).send({
        verified: false,
        error: "Missing token. Send via X-BDIT-Token header or Authorization: Bearer <token>",
      });
    }

    // Verify with local key first (faster), fallback to JWKS
    const v = localVerifier ?? verifier;
    const result = await v.verify(token);

    if (!result.valid || !result.payload) {
      return reply
        .header("Cache-Control", "public, max-age=10")
        .send({
          verified: false,
          error: result.error ?? "Invalid token",
        });
    }

    const payload = result.payload;

    // Merchant ID mismatch check
    if (merchantId && payload.merchant_id !== merchantId) {
      return reply
        .header("Cache-Control", "public, max-age=10")
        .send({
          verified: false,
          error: `Token merchant '${payload.merchant_id}' does not match '${merchantId}'`,
        });
    }

    // Check if token was already used (one-time use)
    const used = await redisExists(`bdit:used:${payload.jti}`);
    if (used) {
      return reply
        .header("Cache-Control", "no-store")
        .send({
          verified: false,
          error: "Token already used (one-time use)",
        });
    }

    // Fetch bot info
    const bot = await prisma.bot.findFirst({
      where: { id: payload.bot_id },
      select: {
        id: true,
        name: true,
        platform: true,
        trustScore: true,
        status: true,
        createdAt: true,
        owner: {
          select: {
            kycLevel: true,
          },
        },
      },
    });

    return reply
      .header("Cache-Control", "public, max-age=60")
      .send({
        verified: true,
        bot: {
          id: payload.bot_id,
          name: bot?.name ?? "Unknown",
          platform: bot?.platform ?? "unknown",
          trustScore: payload.trust_score,
          ownerVerified: (bot?.owner?.kycLevel ?? "NONE") !== "NONE",
          certifiedAt: bot?.createdAt?.toISOString() ?? null,
        },
        authorization: {
          amount: payload.amount,
          currency: "USD",
          category: payload.category,
          merchantId: payload.merchant_id,
          validUntil: new Date(payload.exp * 1000).toISOString(),
          oneTimeUse: true,
        },
        payjarvis: {
          version: "1.0",
          issuer: "payjarvis.com",
          jwks: "https://api.payjarvis.com/.well-known/jwks.json",
        },
      });
  });

  // ─── POST /v1/verify (convenience) ────────────────
  app.post("/v1/verify", async (request, reply) => {
    const body = request.body as {
      token?: string;
      merchantId?: string;
    };

    if (!body.token) {
      return reply.status(400).send({
        verified: false,
        error: "Missing 'token' in request body",
      });
    }

    // Reuse GET logic by setting headers and forwarding
    request.headers["x-bdit-token"] = body.token;
    if (body.merchantId) {
      request.headers["x-merchant-id"] = body.merchantId;
    }

    // Re-invoke the GET handler via inject
    const res = await app.inject({
      method: "GET",
      url: "/v1/verify",
      headers: {
        "x-bdit-token": body.token,
        "x-merchant-id": body.merchantId ?? "",
      },
    });

    return reply
      .status(res.statusCode)
      .headers(Object.fromEntries(
        Object.entries(res.headers).filter(([, v]) => v !== undefined) as [string, string][]
      ))
      .send(JSON.parse(res.body));
  });
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}
