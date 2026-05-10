import { jwtVerify, importSPKI, createRemoteJWKSet, decodeProtectedHeader } from "jose";
import type { BditPayload } from "@payjarvis/types";
import {
  type BditAlgorithm,
  VERIFIER_ALGORITHMS,
} from "./keys.js";

export interface VerifyResult {
  valid: boolean;
  payload?: BditPayload;
  algorithm?: BditAlgorithm;
  error?: string;
}

/**
 * BditVerifier — accepts BDIT tokens signed with EITHER RS256 (legacy)
 * or EdDSA / Ed25519 (default for new issuance). The verifier resolves
 * the right algorithm per token from its protected header.
 *
 * Two modes:
 *
 *   1. Local public key — fromPublicKey(pem, alg, issuer?)
 *      Caller knows which algorithm the key represents.
 *
 *   2. Remote JWKS — fromJwks(url, ttl?, issuer?)
 *      The JWKS endpoint exposes all active keys; createRemoteJWKSet
 *      resolves the matching kid + alg automatically.
 */
export class BditVerifier {
  private publicKeyPem?: string;
  private localKeyAlg?: BditAlgorithm;
  private jwksUrl?: string;
  private jwksCache?: ReturnType<typeof createRemoteJWKSet>;
  private jwksCacheCreatedAt = 0;
  private jwksCacheTtlMs: number;
  private issuerName: string;

  /**
   * Local-key verifier. The algorithm is required when working with a
   * single static public key, since SPKI import needs to know it.
   * Defaults to "RS256" for backwards compatibility with the v1.0
   * single-arg call site.
   */
  static fromPublicKey(
    publicKeyPem: string,
    algOrIssuer?: BditAlgorithm | string,
    maybeIssuer?: string
  ): BditVerifier {
    const verifier = new BditVerifier();
    verifier.publicKeyPem = publicKeyPem;
    // Discriminate the overload: alg values are exactly "RS256" | "EdDSA".
    if (algOrIssuer === "RS256" || algOrIssuer === "EdDSA") {
      verifier.localKeyAlg = algOrIssuer;
      if (maybeIssuer) verifier.issuerName = maybeIssuer;
    } else {
      // Legacy 2-arg form: (pem, issuerName?). Default RS256.
      verifier.localKeyAlg = "RS256";
      if (algOrIssuer) verifier.issuerName = algOrIssuer;
    }
    return verifier;
  }

  /** JWKS-based verifier. Accepts both algorithms via the key set. */
  static fromJwks(jwksUrl: string, cacheTtlMs = 24 * 60 * 60 * 1000, issuer?: string): BditVerifier {
    const verifier = new BditVerifier();
    verifier.jwksUrl = jwksUrl;
    verifier.jwksCacheTtlMs = cacheTtlMs;
    if (issuer) verifier.issuerName = issuer;
    return verifier;
  }

  private constructor() {
    this.jwksCacheTtlMs = 24 * 60 * 60 * 1000;
    this.issuerName = "payjarvis";
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    const now = Date.now();
    if (!this.jwksCache || now - this.jwksCacheCreatedAt > this.jwksCacheTtlMs) {
      this.jwksCache = createRemoteJWKSet(new URL(this.jwksUrl!));
      this.jwksCacheCreatedAt = now;
    }
    return this.jwksCache;
  }

  async verify(token: string): Promise<VerifyResult> {
    try {
      let result;
      let alg: BditAlgorithm | undefined;

      if (this.publicKeyPem) {
        const localAlg = this.localKeyAlg ?? "RS256";
        const publicKey = await importSPKI(this.publicKeyPem, localAlg);
        result = await jwtVerify(token, publicKey, {
          issuer: this.issuerName,
          algorithms: [localAlg],
        });
        alg = localAlg;
      } else if (this.jwksUrl) {
        const jwks = this.getJwks();
        try {
          result = await jwtVerify(token, jwks, {
            issuer: this.issuerName,
            algorithms: VERIFIER_ALGORITHMS,
          });
        } catch {
          // On failure, force-refresh JWKS cache and retry once. Common
          // cause: the issuer rotated keys and our cache is stale.
          this.jwksCache = createRemoteJWKSet(new URL(this.jwksUrl));
          this.jwksCacheCreatedAt = Date.now();
          result = await jwtVerify(token, this.jwksCache, {
            issuer: this.issuerName,
            algorithms: VERIFIER_ALGORITHMS,
          });
        }
        // Pull algorithm from the verified header for telemetry/audit.
        try {
          const header = decodeProtectedHeader(token);
          if (header.alg === "RS256" || header.alg === "EdDSA") {
            alg = header.alg;
          }
        } catch {
          // ignore — alg stays undefined
        }
      } else {
        return { valid: false, error: "No verification key configured" };
      }

      const payload = result.payload as unknown as BditPayload;

      if (!payload.bot_id || !payload.jti || !payload.merchant_id) {
        return { valid: false, error: "Missing required BDIT fields" };
      }

      return { valid: true, payload, algorithm: alg };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown verification error";
      return { valid: false, error: message };
    }
  }
}
