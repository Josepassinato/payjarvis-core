/**
 * CTEF outcome receipt emission endpoint.
 *
 *   POST /api/bdit/receipts
 *
 *     body: PaymentOutcomePayload + sessionId + optional subjectDid
 *     auth: Bot API key (X-Bot-Api-Key) — only the bot whose outcome
 *           this attests can request the receipt.
 *
 * Returns a signed CTEF envelope (Ed25519, JSON). Caller persists or
 * forwards to Verascore / Trust-layer consumers.
 *
 * Requires Ed25519 keys to be configured (PAYJARVIS_PRIVATE_KEY_ED25519
 * + PAYJARVIS_KEY_ID_ED25519) — RS256 keys cannot sign CTEF receipts
 * per the spec. If unconfigured, returns 503 with operator instructions.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  buildPaymentOutcomeReceipt,
  type PaymentOutcomePayload,
} from "@payjarvis/bdit";
import { requireBotAuth } from "../middleware/bot-auth.js";

interface ReceiptRequestBody {
  outcome: PaymentOutcomePayload;
  /** Session id (sequence key for the receipt). */
  session_id: string;
  /**
   * Subject DID override. Defaults to "did:payjarvis:bot:<botId>" using
   * the authenticated bot id from X-Bot-Api-Key.
   */
  subject_did?: string;
  /** Receipt category override (defaults to env CTEF_CATEGORY ?? "transactional"). */
  category?: string;
  /** Issuance timestamp override (e.g., bind to actual decision time). */
  issued_at?: string;
  /** Validity duration in seconds. */
  validity_seconds?: number;
}

function loadEd25519Signer():
  | { kid: string; pem: string; providerDid: string; providerName: string }
  | { error: string } {
  const pem = (process.env.PAYJARVIS_PRIVATE_KEY_ED25519 ?? "").replace(/\\n/g, "\n");
  const kid = process.env.PAYJARVIS_KEY_ID_ED25519;
  if (!pem || !kid) {
    return {
      error:
        "Ed25519 signing key not configured. CTEF receipts require " +
        "PAYJARVIS_PRIVATE_KEY_ED25519 + PAYJARVIS_KEY_ID_ED25519. " +
        "Run `npm run -w @payjarvis/bdit generate-keys` and restart.",
    };
  }
  const providerDid = process.env.PAYJARVIS_PROVIDER_DID ?? "did:web:api.payjarvis.com";
  const providerName = process.env.PAYJARVIS_PROVIDER_NAME ?? "PayJarvis";
  return { kid, pem, providerDid, providerName };
}

export async function receiptRoutes(app: FastifyInstance) {
  app.post(
    "/api/bdit/receipts",
    { preHandler: [requireBotAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as ReceiptRequestBody | null;
      if (!body || !body.outcome || !body.session_id) {
        return reply.status(400).send({
          error: "Missing required fields: outcome, session_id",
        });
      }

      const signer = loadEd25519Signer();
      if ("error" in signer) {
        return reply.status(503).send({ error: signer.error });
      }

      // Subject DID: defaults to PayJarvis convention if not supplied.
      const botId = (request as unknown as { botId: string }).botId;
      const subjectDid = body.subject_did ?? `did:payjarvis:bot:${botId}`;

      // Sanity: outcome.approval_id should be present.
      if (!body.outcome.approval_id) {
        return reply.status(400).send({
          error: "outcome.approval_id is required",
        });
      }

      let issuedAt: Date | undefined;
      if (body.issued_at) {
        const d = new Date(body.issued_at);
        if (isNaN(d.getTime())) {
          return reply.status(400).send({ error: "issued_at is not a valid ISO date" });
        }
        issuedAt = d;
      }

      const category =
        body.category ?? process.env.CTEF_CATEGORY ?? "transactional";

      try {
        const receipt = buildPaymentOutcomeReceipt({
          providerDid: signer.providerDid,
          providerName: signer.providerName,
          providerKid: signer.kid,
          privateKeyPem: signer.pem,
          subjectDid,
          outcome: body.outcome,
          sessionId: body.session_id,
          category,
          issuedAt,
          validitySeconds: body.validity_seconds,
        });

        return reply
          .header("Content-Type", "application/json")
          .send(receipt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        request.log.error({ err }, "CTEF receipt sign failed");
        return reply.status(500).send({ error: `receipt sign failed: ${msg}` });
      }
    }
  );
}
