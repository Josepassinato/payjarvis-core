import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";
import type { BditPayload, MandateSource } from "@payjarvis/types";

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

export class BditIssuer {
  private privateKeyPem: string;
  private keyId: string;
  private issuerName: string;

  constructor(privateKeyPem: string, keyId: string, issuerName?: string) {
    this.privateKeyPem = privateKeyPem;
    this.keyId = keyId;
    this.issuerName = issuerName ?? "payjarvis";
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

    const privateKey = await importPKCS8(this.privateKeyPem, "RS256");
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
      .setProtectedHeader({ alg: "RS256", kid: this.keyId, typ: "JWT" })
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
