/**
 * @payjarvis/verify-sdk — Node.js / TypeScript
 *
 * Verifica BDIT tokens localmente usando JWKS.
 * Nenhuma chamada de API necessária — apenas a chave pública.
 *
 * @example
 * ```typescript
 * import { verifyBdit } from '@payjarvis/verify-sdk'
 *
 * const result = await verifyBdit({
 *   token: req.headers['x-bdit-token'],
 *   merchantId: 'your-merchant-id',
 *   jwksUrl: 'https://api.payjarvis.com/.well-known/jwks.json'
 * })
 *
 * if (result.verified) {
 *   console.log(`Bot ${result.bot.id} authorized for $${result.authorization.amount}`)
 * }
 * ```
 */

import { createRemoteJWKSet, jwtVerify, importSPKI } from "jose";
import type { JWTPayload, KeyLike, FlattenedJWSInput, JWSHeaderParameters, GetKeyFunction } from "jose";

// ─── Types ───────────────────────────────────────────

export interface VerifyOptions {
  /** The BDIT JWT token to verify */
  token: string;
  /** Your merchant ID (must match token's merchant_id) */
  merchantId: string;
  /** JWKS URL for public key fetching (default: PayJarvis production) */
  jwksUrl?: string;
  /** Alternative: provide a PEM public key directly */
  publicKey?: string;
  /** Minimum trust score required (default: 0) */
  minTrustScore?: number;
  /** Expected issuer (default: "payjarvis") */
  issuer?: string;
}

export interface VerifyResult {
  verified: boolean;
  error?: string;
  bot?: {
    id: string;
    ownerId: string;
    trustScore: number;
    kycLevel: number;
  };
  authorization?: {
    amount: number;
    currency: string;
    category: string;
    merchantId: string;
    validUntil: string;
    oneTimeUse: boolean;
    jti: string;
  };
}

interface BditPayload extends JWTPayload {
  bot_id: string;
  owner_id: string;
  trust_score: number;
  kyc_level: number;
  merchant_id: string;
  amount: number;
  category: string;
  categories: string[];
  max_amount: number;
  session_id: string;
}

// ─── JWKS Cache with TTL ─────────────────────────────

interface JwksCacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  createdAt: number;
}

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const jwksCache = new Map<string, JwksCacheEntry>();

function getJwks(url: string, forceRefresh = false): ReturnType<typeof createRemoteJWKSet> {
  const now = Date.now();
  const cached = jwksCache.get(url);

  if (cached && !forceRefresh && (now - cached.createdAt) < JWKS_CACHE_TTL_MS) {
    return cached.jwks;
  }

  const jwks = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, { jwks, createdAt: now });
  return jwks;
}

// ─── Main Verify Function ────────────────────────────

const DEFAULT_JWKS_URL =
  "https://api.payjarvis.com/.well-known/jwks.json";

/**
 * Verify a BDIT token.
 *
 * Performs local RS256 signature verification using JWKS
 * (no API calls to PayJarvis needed — only the public key).
 */
export async function verifyBdit(
  options: VerifyOptions
): Promise<VerifyResult> {
  const { token, merchantId, minTrustScore = 0 } = options;

  if (!token) {
    return { verified: false, error: "No token provided" };
  }

  if (!merchantId) {
    return { verified: false, error: "No merchantId provided" };
  }

  try {
    // Determine key source
    type JwksKeyFunc = GetKeyFunction<JWSHeaderParameters, FlattenedJWSInput>;
    let key: KeyLike | JwksKeyFunc;
    const jwksUrl = options.jwksUrl ?? DEFAULT_JWKS_URL;
    const expectedIssuer = options.issuer ?? "payjarvis";

    if (options.publicKey) {
      key = await importSPKI(options.publicKey, "RS256");
    } else {
      key = getJwks(jwksUrl);
    }

    // Verify JWT — retry with refreshed JWKS on failure (handles key rotation)
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, key as unknown as KeyLike, {
        issuer: expectedIssuer,
        algorithms: ["RS256"],
      });
      payload = result.payload;
    } catch (firstError) {
      // If using JWKS (not static key), retry with forced refresh
      if (!options.publicKey) {
        key = getJwks(jwksUrl, true);
        const result = await jwtVerify(token, key as unknown as KeyLike, {
          issuer: expectedIssuer,
          algorithms: ["RS256"],
        });
        payload = result.payload;
      } else {
        throw firstError;
      }
    }

    const p = payload as unknown as BditPayload;

    // Validate required fields
    if (!p.bot_id || !p.merchant_id || !p.jti) {
      return {
        verified: false,
        error: "Missing required BDIT fields (bot_id, merchant_id, jti)",
      };
    }

    // Merchant match
    if (p.merchant_id !== merchantId) {
      return {
        verified: false,
        error: `Merchant mismatch: token has '${p.merchant_id}', expected '${merchantId}'`,
      };
    }

    // Trust score check
    if (p.trust_score < minTrustScore) {
      return {
        verified: false,
        error: `Trust score ${p.trust_score} below minimum ${minTrustScore}`,
      };
    }

    return {
      verified: true,
      bot: {
        id: p.bot_id,
        ownerId: p.owner_id,
        trustScore: p.trust_score,
        kycLevel: p.kyc_level,
      },
      authorization: {
        amount: p.amount,
        currency: "USD",
        category: p.category,
        merchantId: p.merchant_id,
        validUntil: new Date(p.exp! * 1000).toISOString(),
        oneTimeUse: true,
        jti: p.jti!,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Verification failed";
    return { verified: false, error: message };
  }
}

/**
 * Extract BDIT token from common HTTP sources.
 */
export function extractBditToken(request: {
  headers?: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  query?: Record<string, string | undefined>;
}): string | null {
  // X-BDIT-Token header
  if (request.headers?.["x-bdit-token"]) {
    return request.headers["x-bdit-token"];
  }

  // X-Payjarvis-Token header
  if (request.headers?.["x-payjarvis-token"]) {
    return request.headers["x-payjarvis-token"];
  }

  // Authorization Bearer
  const auth = request.headers?.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  // Cookie
  if (request.cookies?.bdit_token) {
    return request.cookies.bdit_token;
  }

  // Body
  if (typeof request.body?.bditToken === "string") {
    return request.body.bditToken;
  }
  if (typeof request.body?.payjarvis_token === "string") {
    return request.body.payjarvis_token;
  }

  // Query param
  if (request.query?.payjarvis_token) {
    return request.query.payjarvis_token;
  }

  return null;
}
