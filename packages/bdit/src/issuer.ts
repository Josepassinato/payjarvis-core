import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";
import type { BditPayload, MandateSource } from "@payjarvis/types";
import {
  type BditAlgorithm,
  type PrivateKeyEntry,
  activePrivateKey,
} from "./keys.js";

export interface IssueTokenParams {
  // ─── Mandate (authoritative — derived from upstream Agreement) ───
  botId: string;
  ownerId: string;
  categories: string[];
  maxAmount: number;
  merchantId: string;
  amount: number;
  category: string;
  sessionId: string;
  /**
   * Agreement source. When "concordia", concordiaSessionUrn +
   * concordiaTranscriptHash MUST be supplied — they bind the BDIT to
   * a specific Concordia session per spec §10.4.
   */
  mandateSource?: MandateSource;
  concordiaSessionUrn?: string;       // urn:concordia:session:<id>
  concordiaTranscriptHash?: string;   // sha256:<hex>
  concordiaTermsHash?: string;        // optional — hash of derived terms

  // ─── Reputation (informational only — never authoritative) ───
  trustScore: number;
  kycLevel: number;
  agentId?: string;
  agentTrustScore?: number;       // 0-1000 scale
  ownerVerified?: boolean;
  transactionsCount?: number;
  totalSpent?: number;
}

/**
 * BditIssuer — signs BDIT tokens using either RS256 (legacy) or
 * EdDSA / Ed25519 (Concordia-aligned, default for new issuance).
 *
 * Construction:
 *
 *   1. Backwards-compat (RS256 only):
 *        new BditIssuer(privKeyPem, kid, issuerName)
 *
 *   2. Algorithm-aware:
 *        new BditIssuer({ alg: "EdDSA", privateKeyPem, kid }, issuerName)
 *
 *   3. From env (recommended for production wiring):
 *        BditIssuer.fromEnv()       // picks active alg per BDIT_SIGNING_ALG
 */
export class BditIssuer {
  private signingKey: PrivateKeyEntry;
  private issuerName: string;

  constructor(privateKeyPem: string, kid: string, issuerName?: string);
  constructor(config: PrivateKeyEntry, issuerName?: string);
  constructor(
    arg1: string | PrivateKeyEntry,
    arg2?: string,
    arg3?: string
  ) {
    if (typeof arg1 === "string") {
      // Legacy positional constructor: defaults to RS256
      this.signingKey = { alg: "RS256", pem: arg1, kid: arg2! };
      this.issuerName = arg3 ?? "payjarvis";
    } else {
      this.signingKey = arg1;
      this.issuerName = (arg2 as string | undefined) ?? "payjarvis";
    }
  }

  /**
   * Construct an issuer from environment variables. Picks the active
   * signing alg according to keys.activePrivateKey() policy.
   *
   * Issuer name derivation (preserves project convention):
   *   1. PAYJARVIS_ISSUER_NAME if set explicitly
   *   2. else "payjarvis" in production, "payjarvis-<env>" otherwise
   *      (env from BDIT_ENV ?? NODE_ENV ?? "development")
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): BditIssuer {
    const explicit = env.PAYJARVIS_ISSUER_NAME;
    const envName = env.BDIT_ENV ?? env.NODE_ENV ?? "development";
    const issuerName =
      explicit ?? (envName === "production" ? "payjarvis" : `payjarvis-${envName}`);
    return new BditIssuer(activePrivateKey(env), issuerName);
  }

  /** Algorithm currently used for signing. */
  get algorithm(): BditAlgorithm {
    return this.signingKey.alg;
  }

  async issue(params: IssueTokenParams): Promise<{ token: string; jti: string; expiresAt: Date }> {
    // Concordia binding requires both URN and transcript hash to be
    // verifiable. Reject ambiguous mandate_source="concordia" without
    // both — fail fast at issue time, not at verify time.
    if (params.mandateSource === "concordia") {
      if (!params.concordiaSessionUrn || !params.concordiaTranscriptHash) {
        throw new Error(
          "mandateSource=concordia requires both concordiaSessionUrn and concordiaTranscriptHash"
        );
      }
    }

    const { alg, pem, kid } = this.signingKey;
    const privateKey = await importPKCS8(pem, alg);
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 300; // 5 minutes

    const payload: Omit<BditPayload, "iat" | "exp"> = {
      // ─── Mandate (authoritative) ───
      bot_id: params.botId,
      owner_id: params.ownerId,
      categories: params.categories,
      max_amount: params.maxAmount,
      merchant_id: params.merchantId,
      amount: params.amount,
      category: params.category,
      session_id: params.sessionId,
      ...(params.mandateSource && { mandate_source: params.mandateSource }),
      ...(params.concordiaSessionUrn && { concordia_session_urn: params.concordiaSessionUrn }),
      ...(params.concordiaTranscriptHash && { concordia_transcript_hash: params.concordiaTranscriptHash }),
      ...(params.concordiaTermsHash && { concordia_terms_hash: params.concordiaTermsHash }),

      // ─── Reputation (informational) ───
      trust_score: params.trustScore,
      kyc_level: params.kycLevel,
      ...(params.agentId && {
        agent_id: params.agentId,
        agent_trust_score: params.agentTrustScore,
        owner_verified: params.ownerVerified,
        transactions_count: params.transactionsCount,
        total_spent: params.totalSpent,
      }),

      // ─── JWT envelope ───
      jti,
    };

    const token = await new SignJWT(payload as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg, kid, typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setIssuer(this.issuerName)
      .setSubject(params.agentId ?? params.botId)
      .sign(privateKey);

    return {
      token,
      jti,
      expiresAt: new Date(exp * 1000),
    };
  }
}
