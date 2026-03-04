import { jwtVerify, importSPKI, createRemoteJWKSet } from "jose";
import type { BditPayload } from "@payjarvis/types";

export interface VerifyResult {
  valid: boolean;
  payload?: BditPayload;
  error?: string;
}

export class BditVerifier {
  private publicKeyPem?: string;
  private jwksUrl?: string;
  private jwksCache?: ReturnType<typeof createRemoteJWKSet>;
  private jwksCacheCreatedAt = 0;
  private jwksCacheTtlMs: number;

  /**
   * Create a verifier using a local public key (no API call needed)
   */
  static fromPublicKey(publicKeyPem: string): BditVerifier {
    const verifier = new BditVerifier();
    verifier.publicKeyPem = publicKeyPem;
    return verifier;
  }

  /**
   * Create a verifier using a JWKS endpoint with 24h cache
   */
  static fromJwks(jwksUrl: string, cacheTtlMs = 24 * 60 * 60 * 1000): BditVerifier {
    const verifier = new BditVerifier();
    verifier.jwksUrl = jwksUrl;
    verifier.jwksCacheTtlMs = cacheTtlMs;
    return verifier;
  }

  private constructor() {
    this.jwksCacheTtlMs = 24 * 60 * 60 * 1000;
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

      if (this.publicKeyPem) {
        const publicKey = await importSPKI(this.publicKeyPem, "RS256");
        result = await jwtVerify(token, publicKey, {
          issuer: "payjarvis",
          algorithms: ["RS256"],
        });
      } else if (this.jwksUrl) {
        const jwks = this.getJwks();
        try {
          result = await jwtVerify(token, jwks, {
            issuer: "payjarvis",
            algorithms: ["RS256"],
          });
        } catch (err) {
          // On failure, force-refresh JWKS cache and retry once
          this.jwksCache = createRemoteJWKSet(new URL(this.jwksUrl));
          this.jwksCacheCreatedAt = Date.now();
          result = await jwtVerify(token, this.jwksCache, {
            issuer: "payjarvis",
            algorithms: ["RS256"],
          });
        }
      } else {
        return { valid: false, error: "No verification key configured" };
      }

      const payload = result.payload as unknown as BditPayload;

      if (!payload.bot_id || !payload.jti || !payload.merchant_id) {
        return { valid: false, error: "Missing required BDIT fields" };
      }

      return { valid: true, payload };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown verification error";
      return { valid: false, error: message };
    }
  }
}
