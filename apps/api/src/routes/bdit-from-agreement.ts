/**
 * Concordia → BDIT bridge endpoint.
 *
 *   POST /api/bdit/from-agreement
 *
 * Mints a BDIT whose mandate claims are DERIVED from a verified
 * Concordia agreement envelope. Caller submits the agreement (CTEF
 * envelope signed by Concordia) + bot_id; PayJarvis verifies and mints.
 *
 * Per BDIT-SPEC §10.1: caller cannot inflate mandate beyond the
 * agreement. max_amount, categories, and merchant_id come from the
 * verified envelope payload, not from request body free-form input.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  BditIssuer,
  verifyConcordiaAgreement,
  loadConcordiaOptionsFromEnv,
  type CtefEnvelope,
} from "@payjarvis/bdit";
import { prisma } from "@payjarvis/database";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { redisExists } from "../services/redis.js";

interface FromAgreementRequestBody {
  /**
   * The Concordia agreement envelope — a CTEF-shaped JSON object
   * signed by Concordia. PayJarvis verifies the signature and extracts
   * the mandate terms from envelope.payload.
   */
  concordia_envelope: CtefEnvelope;
  /**
   * Optional client-provided session id used as the BDIT session_id.
   * Defaults to the source_session URN's tail.
   */
  session_id?: string;
}

export async function bditFromAgreementRoutes(app: FastifyInstance) {
  app.post(
    "/api/bdit/from-agreement",
    { preHandler: [requireBotAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as FromAgreementRequestBody | null;
      if (!body || !body.concordia_envelope) {
        return reply
          .status(400)
          .send({ error: "Missing required field: concordia_envelope" });
      }

      const botId = (request as unknown as { botId: string }).botId;

      // ─── Bot precheck ───────────────────────────────────────────
      const revoked = await redisExists(`revoked:bot:${botId}`);
      if (revoked) {
        return reply.status(403).send({ error: "Bot is revoked or paused" });
      }
      const bot = await prisma.bot.findFirst({ where: { id: botId } });
      if (!bot) {
        return reply.status(404).send({ error: "Bot not found" });
      }
      if (bot.status !== "ACTIVE") {
        return reply.status(403).send({ error: "Bot is not active" });
      }

      // ─── Verify Concordia agreement ─────────────────────────────
      const options = loadConcordiaOptionsFromEnv();
      const verification = await verifyConcordiaAgreement(
        body.concordia_envelope,
        options
      );
      if (!verification.valid) {
        request.log.warn(
          {
            botId,
            reason: verification.reason,
            providerDid: verification.providerDid,
            sigVerified: verification.signatureVerified,
          },
          "Concordia agreement rejected"
        );
        return reply.status(400).send({
          error: "Concordia agreement verification failed",
          reason: verification.reason,
        });
      }

      const { source, terms } = verification;
      if (!source || !terms) {
        // Should be impossible when valid:true, but guard for completeness.
        return reply
          .status(500)
          .send({ error: "Internal: verification returned no source/terms" });
      }

      // ─── Mint BDIT — mandate claims come from verified envelope ────
      // Caller never sees a free-form mandate input here; max_amount /
      // categories / merchant_id flow from envelope.payload only.
      let issuer: BditIssuer;
      try {
        issuer = BditIssuer.fromEnv();
      } catch (err) {
        return reply.status(503).send({
          error: "BDIT signing key not configured",
          reason: err instanceof Error ? err.message : String(err),
        });
      }

      const sessionId = body.session_id ?? sourceUrnTail(source.urn);

      try {
        const issued = await issuer.issue({
          // Mandate (derived from agreement, NOT caller input)
          botId: bot.id,
          ownerId: bot.ownerId,
          categories: terms.categories,
          maxAmount: terms.max_amount,
          merchantId: terms.merchant_id ?? "*",
          amount: terms.amount ?? terms.max_amount,
          category: terms.category ?? terms.categories[0],
          sessionId,
          mandateSource: "concordia",
          concordiaSessionUrn: source.urn,
          concordiaTranscriptHash: source.hash,

          // Reputation snapshot — informational, copied from current bot state
          // (read-only here; not used by issuer for authorization).
          trustScore: bot.trustScore ?? 0,
          kycLevel: 0,
        });

        request.log.info(
          {
            botId: bot.id,
            jti: issued.jti,
            concordiaSessionUrn: source.urn,
            sigVerified: verification.signatureVerified,
            providerDid: verification.providerDid,
            mode: options.mode,
          },
          "BDIT issued from Concordia agreement"
        );

        return reply.send({
          token: issued.token,
          jti: issued.jti,
          expires_at: issued.expiresAt.toISOString(),
          mandate_source: "concordia",
          concordia_session_urn: source.urn,
          concordia_transcript_hash: source.hash,
          signature_verified: verification.signatureVerified,
        });
      } catch (err) {
        request.log.error({ err }, "BDIT mint from Concordia failed");
        return reply.status(500).send({
          error: "Failed to mint BDIT",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );
}

function sourceUrnTail(urn: string): string {
  // urn:concordia:session:ses_xyz → ses_xyz
  const idx = urn.lastIndexOf(":");
  return idx >= 0 ? urn.substring(idx + 1) : urn;
}
