import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";
import type { BditPayload } from "@payjarvis/types";

export interface IssueTokenParams {
  botId: string;
  ownerId: string;
  trustScore: number;
  kycLevel: number;
  categories: string[];
  maxAmount: number;
  merchantId: string;
  amount: number;
  category: string;
  sessionId: string;
  // Agent identity fields
  agentId?: string;
  agentTrustScore?: number;       // 0-1000 scale
  ownerVerified?: boolean;
  transactionsCount?: number;
  totalSpent?: number;
}

export class BditIssuer {
  private privateKeyPem: string;
  private keyId: string;

  constructor(privateKeyPem: string, keyId: string) {
    this.privateKeyPem = privateKeyPem;
    this.keyId = keyId;
  }

  async issue(params: IssueTokenParams): Promise<{ token: string; jti: string; expiresAt: Date }> {
    const privateKey = await importPKCS8(this.privateKeyPem, "RS256");
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 300; // 5 minutes

    const payload: Omit<BditPayload, "iat" | "exp"> = {
      bot_id: params.botId,
      owner_id: params.ownerId,
      trust_score: params.trustScore,
      kyc_level: params.kycLevel,
      categories: params.categories,
      max_amount: params.maxAmount,
      merchant_id: params.merchantId,
      amount: params.amount,
      category: params.category,
      session_id: params.sessionId,
      jti,
      // Agent identity fields (included when agent exists)
      ...(params.agentId && {
        agent_id: params.agentId,
        agent_trust_score: params.agentTrustScore,
        owner_verified: params.ownerVerified,
        transactions_count: params.transactionsCount,
        total_spent: params.totalSpent,
      }),
    };

    const token = await new SignJWT(payload as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "RS256", kid: this.keyId, typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setIssuer("payjarvis")
      .setSubject(params.agentId ?? params.botId)
      .sign(privateKey);

    return {
      token,
      jti,
      expiresAt: new Date(exp * 1000),
    };
  }
}
