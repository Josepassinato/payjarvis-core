import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";
import { prisma } from "@payjarvis/database";
import { getRiskLevel } from "@payjarvis/types";

export interface AitPayload {
  agent_id: string;
  owner_verified: boolean;
  trust_score: number;         // 0-1000
  risk_level: string;
  transactions_count: number;
  total_spent: number;
  kyc_level: number;
  status: string;
  jti: string;
  iss: string;
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Generate a signed Agent Identity Token (AIT).
 * Allows merchants/external services to verify an AI agent's identity and trust level.
 */
export async function issueAit(
  agentId: string,
  ttlSeconds: number = 3600
): Promise<{ token: string; expiresAt: Date } | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      owner: { select: { kycLevel: true, status: true } },
    },
  });

  if (!agent) return null;

  const privateKeyPem = (process.env.PAYJARVIS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const keyId = process.env.PAYJARVIS_KEY_ID ?? "payjarvis-key-001";
  const privateKey = await importPKCS8(privateKeyPem, "RS256");

  const kycMap: Record<string, number> = { NONE: 0, BASIC: 1, VERIFIED: 2, ENHANCED: 3 };
  const kycLevel = kycMap[agent.kycLevel] ?? 0;
  const ownerVerified = agent.owner.status === "ACTIVE" && kycLevel >= 1;

  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const payload = {
    agent_id: agent.id,
    owner_verified: ownerVerified,
    trust_score: agent.trustScore,
    risk_level: getRiskLevel(agent.trustScore),
    transactions_count: agent.transactionsCount,
    total_spent: Math.round(agent.totalSpent * 100) / 100,
    kyc_level: kycLevel,
    status: agent.status,
    jti,
  };

  const token = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "AIT+JWT" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer("payjarvis")
    .setSubject(agent.id)
    .sign(privateKey);

  return {
    token,
    expiresAt: new Date(exp * 1000),
  };
}
