/**
 * Concordia agreement verification + term extraction.
 *
 * Supports the Agreement → Settlement bridge per BDIT-SPEC §10.1:
 * an upstream Concordia session reaches a signed agreement; PayJarvis
 * mints a BDIT whose mandate claims are DERIVED from the agreement
 * payload, not free-form caller input. The caller cannot inflate
 * mandate beyond what was agreed.
 *
 * Concordia agreements are CTEF-shaped envelopes (Concordia is the
 * reference impl of the CTEF format we adopted in §11). We reuse
 * `verifyEnvelope` from ./ctef.ts as the cryptographic primitive.
 *
 * ─── VERIFICATION TIERS ───────────────────────────────────────────
 *
 *   Strict (production):
 *     - CONCORDIA_JWKS_URL set → fetch JWKS, resolve kid, Ed25519-verify
 *     - CONCORDIA_TRUSTED_PROVIDER_DIDS set → enforce provider.did allow-list
 *     - All shape + reference checks
 *
 *   Permissive (dev/integration without Concordia JWKS yet):
 *     - CONCORDIA_VERIFY_MODE=permissive → skip cryptographic verification
 *     - Still enforces shape + source_session reference + (optional) trusted DIDs
 *     - Logs a warning. Refuses to operate by default.
 *
 *   Off (default with no envs):
 *     - returns valid:false with operator instructions
 *     - prevents accidentally minting BDIT on unverified agreements
 *
 * The seam is intentionally narrow: replacing the verification block
 * (lines marked CONCORDIA-VERIFY) with a richer impl (DID resolution,
 * multi-signer, etc.) is mechanical when the spec lands.
 */

import { exportSPKI, importJWK, type JWK } from "jose";
import { verifyEnvelope, type CtefEnvelope } from "./ctef.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface ConcordiaSourceRef {
  /** The session URN — typically "urn:concordia:session:<id>". */
  urn: string;
  /** Hash of the underlying session transcript. Provided by Concordia. */
  hash: string;
}

export interface ConcordiaAgreementTerms {
  /** Maximum amount the agreement permits (cap on BDIT.max_amount). */
  max_amount: number;
  currency: string;
  /** Category whitelist agreed for the executing agent. */
  categories: string[];
  /** Specific transaction amount (defaults to max_amount). */
  amount?: number;
  /** Category for this specific transaction (defaults to categories[0]). */
  category?: string;
  /** Optional merchant binding (null/undefined = "any merchant within categories"). */
  merchant_id?: string | null;
}

export interface ConcordiaVerificationOptions {
  /**
   * JWKS URL for Concordia issuer's signing keys. When set, signatures
   * are cryptographically verified against the matching kid.
   */
  jwksUrl?: string;
  /**
   * Allow-list of provider DIDs (envelope.provider.did) accepted as
   * valid Concordia issuers. Empty = accept any DID (dangerous in prod).
   */
  trustedProviderDids?: string[];
  /**
   * "strict" (default) | "permissive". Permissive skips cryptographic
   * verification but still enforces shape + references. Use only when
   * Concordia JWKS is not yet exposed publicly.
   */
  mode?: "strict" | "permissive";
}

export interface ConcordiaVerificationResult {
  valid: boolean;
  reason?: string;
  source?: ConcordiaSourceRef;
  terms?: ConcordiaAgreementTerms;
  /** True only when Ed25519 signature was actually verified (not skipped). */
  signatureVerified: boolean;
  /** Provider DID from the envelope (after shape check). */
  providerDid?: string;
}

// ─── Extractors (pure) ──────────────────────────────────────────────

export function extractSourceSession(envelope: CtefEnvelope): ConcordiaSourceRef {
  const ref = envelope.references.find((r) => r.kind === "source_session");
  if (!ref) {
    throw new Error("envelope.references must contain a source_session entry");
  }
  if (!ref.urn || !ref.hash) {
    throw new Error("source_session reference must include both urn and hash");
  }
  return { urn: ref.urn, hash: ref.hash };
}

export function extractTermsFromEnvelope(
  envelope: CtefEnvelope
): ConcordiaAgreementTerms {
  const p = envelope.payload as Record<string, unknown>;

  if (typeof p.max_amount !== "number" || !Number.isFinite(p.max_amount)) {
    throw new Error("envelope.payload.max_amount must be a finite number");
  }
  if (typeof p.currency !== "string" || !p.currency) {
    throw new Error("envelope.payload.currency must be a non-empty string");
  }
  if (!Array.isArray(p.categories) || p.categories.length === 0) {
    throw new Error("envelope.payload.categories must be a non-empty array");
  }
  for (const c of p.categories) {
    if (typeof c !== "string") {
      throw new Error("envelope.payload.categories must contain only strings");
    }
  }

  return {
    max_amount: p.max_amount,
    currency: p.currency,
    categories: p.categories as string[],
    amount: typeof p.amount === "number" ? p.amount : p.max_amount,
    category:
      typeof p.category === "string" ? p.category : (p.categories as string[])[0],
    merchant_id:
      typeof p.merchant_id === "string"
        ? p.merchant_id
        : p.merchant_id === null
          ? null
          : undefined,
  };
}

// ─── JWKS-backed signature verification ─────────────────────────────

async function verifyEnvelopeViaJwks(
  envelope: CtefEnvelope,
  jwksUrl: string
): Promise<{ valid: boolean; reason?: string }> {
  if (!envelope.signature) {
    return { valid: false, reason: "envelope unsigned" };
  }
  const kid = envelope.signature.kid;

  let jwksJson: { keys: Array<Record<string, unknown>> };
  try {
    const r = await fetch(jwksUrl);
    if (!r.ok) {
      return { valid: false, reason: `JWKS fetch failed: HTTP ${r.status}` };
    }
    jwksJson = (await r.json()) as { keys: Array<Record<string, unknown>> };
  } catch (err) {
    return {
      valid: false,
      reason: `JWKS fetch error: ${err instanceof Error ? err.message : err}`,
    };
  }

  const matchingKey = jwksJson.keys.find(
    (k) => k.kid === kid && k.alg === "EdDSA"
  );
  if (!matchingKey) {
    return {
      valid: false,
      reason: `no EdDSA key with kid=${kid} in JWKS at ${jwksUrl}`,
    };
  }

  let pem: string;
  try {
    // matchingKey shape is from JWKS JSON; cast to JWK after kid + alg confirmed.
    const cryptoKey = await importJWK(matchingKey as unknown as JWK, "EdDSA");
    if (!("type" in cryptoKey)) {
      return { valid: false, reason: "imported JWK is not a CryptoKey" };
    }
    pem = await exportSPKI(cryptoKey);
  } catch (err) {
    return {
      valid: false,
      reason: `failed to import JWK: ${err instanceof Error ? err.message : err}`,
    };
  }

  return verifyEnvelope(envelope, pem);
}

// ─── Main entry point ───────────────────────────────────────────────

/**
 * Verify a Concordia agreement envelope.
 *
 * Returns valid:true with extracted terms + source ref only when:
 *   - envelope shape is valid (signature present, EdDSA alg)
 *   - source_session reference present with urn + hash
 *   - provider.did is in trustedProviderDids (when configured)
 *   - mode === "strict": Ed25519 signature verifies against JWKS
 *     mode === "permissive": signature check skipped (dev only)
 *   - terms can be extracted from payload
 *
 * On any failure, returns valid:false with a specific reason. Caller
 * MUST gate BDIT issuance on result.valid.
 */
export async function verifyConcordiaAgreement(
  envelope: CtefEnvelope,
  options: ConcordiaVerificationOptions = {}
): Promise<ConcordiaVerificationResult> {
  const mode = options.mode ?? "strict";

  // 1. Shape
  if (!envelope.signature) {
    return { valid: false, reason: "envelope is unsigned", signatureVerified: false };
  }
  if (envelope.signature.alg !== "EdDSA") {
    return {
      valid: false,
      reason: `unsupported signature alg: ${envelope.signature.alg} (Concordia requires EdDSA)`,
      signatureVerified: false,
    };
  }
  const providerDid = envelope.provider?.did;
  if (!providerDid) {
    return { valid: false, reason: "envelope.provider.did missing", signatureVerified: false };
  }

  // 2. Provider DID allow-list
  if (options.trustedProviderDids && options.trustedProviderDids.length > 0) {
    if (!options.trustedProviderDids.includes(providerDid)) {
      return {
        valid: false,
        reason: `provider.did ${providerDid} not in trusted list`,
        signatureVerified: false,
        providerDid,
      };
    }
  }

  // 3. source_session reference
  let source: ConcordiaSourceRef;
  try {
    source = extractSourceSession(envelope);
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "invalid source_session",
      signatureVerified: false,
      providerDid,
    };
  }

  // 4. Cryptographic verification (CONCORDIA-VERIFY seam)
  let signatureVerified = false;
  if (mode === "strict") {
    if (!options.jwksUrl) {
      return {
        valid: false,
        reason:
          "strict mode requires CONCORDIA_JWKS_URL to be configured. " +
          "Set it to enable Ed25519 verification, OR explicitly opt into " +
          "CONCORDIA_VERIFY_MODE=permissive for non-production integration.",
        signatureVerified: false,
        providerDid,
      };
    }
    const sigResult = await verifyEnvelopeViaJwks(envelope, options.jwksUrl);
    if (!sigResult.valid) {
      return {
        valid: false,
        reason: `signature verification failed: ${sigResult.reason}`,
        signatureVerified: false,
        providerDid,
      };
    }
    signatureVerified = true;
  }
  // mode === "permissive": signatureVerified stays false; caller responsible
  // for the audit trail / explicit acknowledgement that this is unsafe.

  // 5. Terms extraction
  let terms: ConcordiaAgreementTerms;
  try {
    terms = extractTermsFromEnvelope(envelope);
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "invalid terms",
      signatureVerified,
      providerDid,
    };
  }

  return {
    valid: true,
    source,
    terms,
    signatureVerified,
    providerDid,
  };
}

// ─── Env-driven default options ─────────────────────────────────────

export function loadConcordiaOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ConcordiaVerificationOptions {
  const trusted = env.CONCORDIA_TRUSTED_PROVIDER_DIDS;
  const mode = env.CONCORDIA_VERIFY_MODE;
  return {
    jwksUrl: env.CONCORDIA_JWKS_URL,
    trustedProviderDids: trusted ? trusted.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    mode: mode === "permissive" ? "permissive" : "strict",
  };
}
