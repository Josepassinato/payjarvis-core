import * as jose from 'jose';
import { randomUUID } from 'crypto';

export interface BDITPayload {
  agentId: string;
  ownerId: string;
  agentName?: string;
  credScore: number;
  credScoreLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'TRUSTED';
  kycLevel: 'NONE' | 'BASIC' | 'VERIFIED' | 'ENHANCED';
  amount: number;
  currency: string;
  maxAmount?: number;
  category: string;
  merchant?: string;
  purpose: string;
  policyId?: string;
  tapCompatible?: boolean;
  consumerRecognition?: {
    hasAccount?: boolean;
    loyaltyId?: string;
    lastInteraction?: string;
  };
}

export async function generateBDIT(
  payload: BDITPayload,
  privateKey: jose.KeyLike,
  keyId = 'payjarvis-key-2026-04'
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new jose.SignJWT({
    iss: 'https://payjarvis.com',
    sub: payload.agentId,
    ownerId: payload.ownerId,
    agentName: payload.agentName,
    credScore: payload.credScore,
    credScoreLevel: payload.credScoreLevel,
    kycLevel: payload.kycLevel,
    amount: payload.amount,
    currency: payload.currency,
    maxAmount: payload.maxAmount,
    category: payload.category,
    merchant: payload.merchant,
    purpose: payload.purpose,
    policyId: payload.policyId,
    tapCompatible: payload.tapCompatible ?? true,
    consumerRecognition: payload.consumerRecognition,
    rulesApplied: ['category_limit', 'credscore_threshold'],
    iat: now,
    exp: now + 300,
    jti: `bdit_${randomUUID().slice(0, 16)}`,
    aud: ['merchants', 'stripe', 'visa_tap'],
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: keyId })
    .sign(privateKey);
}
