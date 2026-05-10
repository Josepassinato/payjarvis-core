/**
 * CTEF — Cryptographic Trust Evidence Format envelope.
 *
 * Outcome receipts emitted by PayJarvis after a Settlement event
 * (payment authorized, settled, expired, or disputed). Receipts close
 * the loop from Settlement back up to the Trust layer in the Concordia
 * stack v0.5.0:
 *
 *   Settlement (BDIT issued -> rail fires) ─emits─> CTEF receipt
 *                                                       │
 *                                                       ▼
 *                                Trust (Reputation Attestations)
 *                                — Verascore / similar consume the
 *                                receipt as a verifiable attestation
 *                                of the bot's actual transaction
 *                                history; reputation updates flow up.
 *
 * Schema is byte-compatible with the Concordia reference impl
 * (`build_trust_evidence_envelope` in their envelope.py + canonical
 * JSON in signing.py). Signed with EdDSA / Ed25519 — RSA is rejected
 * at sign time because CTEF spec mandates EdDSA across the ecosystem.
 *
 * Encoding: plain JSON (not CBOR / not JSON-LD). Canonical form:
 *   - sorted keys
 *   - no whitespace
 *   - UTF-8 raw
 *   - rejects NaN / Infinity / -0
 */

import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────

export interface CtefReference {
  /** "source_session" | "bdit_token" | "policy" | "transcript" | etc. */
  kind: string;
  urn?: string;
  verified_at?: string;
  verifier_did?: string;
  /** Hash of the referenced artifact (e.g., "sha256:abc...") */
  hash?: string;
}

export interface CtefRefreshHint {
  strategy: "event_driven" | "interval";
  events: string[];
  max_age_seconds: number;
}

export interface CtefValidityTemporal {
  mode: "sequence" | "interval" | "monotonic";
  sequence_key: string;
  baseline: string | null;
  aliasing_risk: string | null;
}

export interface CtefProvider {
  did: string;
  category: string;
  kid: string;
  name: string;
}

export interface CtefSubject {
  did: string;
}

export interface CtefSignature {
  alg: "EdDSA";
  kid: string;
  /** base64url-encoded raw signature bytes. */
  value: string;
}

export interface CtefEnvelope {
  envelope_version: "1.0.0";
  envelope_id: string;
  issued_at: string;
  expires_at: string;
  refresh_hint: CtefRefreshHint;
  validity_temporal: CtefValidityTemporal;
  provider: CtefProvider;
  subject: CtefSubject;
  category: string;
  visibility: "public" | "private" | "scoped";
  references: CtefReference[];
  payload: Record<string, unknown>;
  signature?: CtefSignature;
}

export type UnsignedCtefEnvelope = Omit<CtefEnvelope, "signature">;

// ─── Canonical JSON ─────────────────────────────────────────────────

/**
 * Canonicalize a JSON value per Concordia / CTEF rules.
 *
 * Output is byte-for-byte stable across:
 *   - object key reorderings (we sort keys)
 *   - whitespace differences (we emit compact)
 *   - JSON-stringification of strings (we delegate to JSON.stringify
 *     for proper RFC 8259 escapes — note that the source string MUST
 *     be UTF-8 valid; we don't re-encode)
 *
 * Throws on NaN, Infinity, -0 — CTEF rejects these.
 *
 * Compatible with TypeScript stableStringify reference and Concordia's
 * canonical_json() in signing.py.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalJson: NaN/Infinity not allowed");
    }
    if (Object.is(value, -0)) {
      throw new Error("canonicalJson: -0 not allowed");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

// ─── Envelope construction ──────────────────────────────────────────

export interface BuildEnvelopeParams {
  /** Provider (PayJarvis instance) DID — typically did:web:api.payjarvis.com */
  providerDid: string;
  providerName: string;
  /** Ed25519 key id used to sign — must match a JWK exposed in JWKS. */
  providerKid: string;
  /** Subject (the bot/agent whose outcome this attests) DID. */
  subjectDid: string;
  /** Outcome data — caller-defined schema (amount, decision, rail, etc.). */
  payload: Record<string, unknown>;
  /** External references (BDIT jti, source session, etc.). */
  references?: CtefReference[];
  /**
   * Sequencing key — typically the BDIT session_id or the approval_id.
   * Used by Concordia-style validity_temporal.sequence_key for ordering
   * receipts across a bot's transaction stream.
   */
  sequenceKey: string;
  /** Validity duration in seconds. Default: 7 days (matches Concordia). */
  validitySeconds?: number;
  /** Events that should trigger a fresh receipt. */
  refreshEvents?: string[];
  /**
   * Receipt category. Default "transactional" (Concordia-accepted).
   * "spending-authorization" is the PayJarvis-specific value awaiting
   * spec acceptance — set CTEF_CATEGORY=spending-authorization to flip
   * the default once the spec freeze is lifted.
   */
  category?: string;
  visibility?: "public" | "private" | "scoped";
  /** Override issued_at (e.g., bind to actual decision timestamp). */
  issuedAt?: Date;
  /** Override envelope_id (e.g., for deterministic replay). */
  envelopeId?: string;
}

export function buildEnvelope(params: BuildEnvelopeParams): UnsignedCtefEnvelope {
  const issuedDate = params.issuedAt ?? new Date();
  const validitySec = params.validitySeconds ?? 7 * 24 * 60 * 60;
  const expiresDate = new Date(issuedDate.getTime() + validitySec * 1000);
  const category = params.category ?? "transactional";

  return {
    envelope_version: "1.0.0",
    envelope_id: params.envelopeId ?? `urn:uuid:${randomUUID()}`,
    issued_at: issuedDate.toISOString(),
    expires_at: expiresDate.toISOString(),
    refresh_hint: {
      strategy: "event_driven",
      events: params.refreshEvents ?? [
        "payment_settled",
        "payment_disputed",
        "mandate_consumed",
        "mandate_expired",
      ],
      max_age_seconds: validitySec,
    },
    validity_temporal: {
      mode: "sequence",
      sequence_key: params.sequenceKey,
      baseline: null,
      aliasing_risk: null,
    },
    provider: {
      did: params.providerDid,
      category,
      kid: params.providerKid,
      name: params.providerName,
    },
    subject: { did: params.subjectDid },
    category,
    visibility: params.visibility ?? "public",
    references: params.references ?? [],
    payload: params.payload,
  };
}

// ─── Signing & verification ─────────────────────────────────────────

/**
 * Sign an unsigned envelope with an Ed25519 private key.
 *
 * Returns a fully signed envelope (the original plus signature field).
 *
 * Throws if the supplied key is not Ed25519 — CTEF spec mandates EdDSA
 * across the entire stack (Concordia, MoltBridge, Verascore). If you
 * want to emit receipts and PayJarvis only has an RS256 key today, run:
 *
 *   npm run -w @payjarvis/bdit generate-keys
 *
 * to provision an Ed25519 keypair, then add the PAYJARVIS_*_ED25519
 * envs to .env and restart the API.
 */
export function signEnvelope(
  unsigned: UnsignedCtefEnvelope,
  privateKeyPem: string,
  kid: string
): CtefEnvelope {
  const privKey = createPrivateKey({ key: privateKeyPem, format: "pem" });
  if (privKey.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `signEnvelope: CTEF receipts require Ed25519, got ${privKey.asymmetricKeyType}. ` +
        `Generate an Ed25519 key with \`npm run -w @payjarvis/bdit generate-keys\`.`
    );
  }

  const canon = canonicalJson(unsigned);
  // Ed25519 in Node: pass null as the digest algorithm — Ed25519 signs
  // raw message bytes (no separate hashing step).
  const sig = nodeSign(null, Buffer.from(canon, "utf-8"), privKey);

  return {
    ...unsigned,
    signature: {
      alg: "EdDSA",
      kid,
      value: sig.toString("base64url"),
    },
  };
}

export interface VerifyEnvelopeResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify a signed envelope's signature against an Ed25519 public key.
 *
 * Does NOT check expires_at, refresh_hint, or any business semantics —
 * caller decides freshness policy. Just answers: is the cryptographic
 * binding intact?
 */
export function verifyEnvelope(
  envelope: CtefEnvelope,
  publicKeyPem: string
): VerifyEnvelopeResult {
  if (!envelope.signature) {
    return { valid: false, error: "envelope has no signature" };
  }
  if (envelope.signature.alg !== "EdDSA") {
    return {
      valid: false,
      error: `unsupported signature alg: ${envelope.signature.alg}`,
    };
  }

  let pubKey;
  try {
    pubKey = createPublicKey({ key: publicKeyPem, format: "pem" });
  } catch (err) {
    return {
      valid: false,
      error: `failed to parse public key: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (pubKey.asymmetricKeyType !== "ed25519") {
    return {
      valid: false,
      error: `public key is ${pubKey.asymmetricKeyType}, expected ed25519`,
    };
  }

  const { signature, ...unsigned } = envelope;
  const canon = canonicalJson(unsigned);
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signature.value, "base64url");
  } catch (err) {
    return {
      valid: false,
      error: `failed to decode signature: ${err instanceof Error ? err.message : err}`,
    };
  }

  try {
    const ok = nodeVerify(null, Buffer.from(canon, "utf-8"), pubKey, sigBytes);
    return ok ? { valid: true } : { valid: false, error: "signature mismatch" };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "verify error",
    };
  }
}

// ─── PayJarvis-specific helper ──────────────────────────────────────

export interface PaymentOutcomePayload {
  /** PayJarvis approval/transaction id. */
  approval_id: string;
  /** "approved" | "blocked" | "pending_human" | "settled" | "expired" | "disputed" */
  decision: string;
  /** Mandate origin — "concordia" | "owner" | "direct" */
  mandate_source?: string;
  /** Concordia source binding when applicable. */
  concordia_session_urn?: string;
  /** BDIT jti this receipt attests to. */
  bdit_jti?: string;
  /** Settled amount + currency (or attempted amount). */
  amount: number;
  currency: string;
  /** Merchant identifier the bot transacted with. */
  merchant_id: string;
  /** Category the transaction was classified as. */
  category: string;
  /** Settlement rail used (e.g., "stripe", "x402", "celcoin"). */
  rail?: string;
  /** Rail-side identifier (e.g., Stripe payment_intent id). */
  rail_reference?: string;
  /** Decision timestamp (separate from receipt issued_at). */
  decided_at?: string;
  /** Reason for blocked/expired/disputed outcomes. */
  reason?: string;
}

export interface PaymentOutcomeReceiptParams {
  providerDid: string;
  providerName: string;
  providerKid: string;
  privateKeyPem: string;
  /** Bot DID — convention "did:payjarvis:bot:<bot_id>". */
  subjectDid: string;
  outcome: PaymentOutcomePayload;
  /** session_id from the BDIT (acts as sequence key). */
  sessionId: string;
  /** Optional category override (defaults to env CTEF_CATEGORY ?? "transactional"). */
  category?: string;
  /** Issuance time — bind to outcome decision_at for immutability. */
  issuedAt?: Date;
  validitySeconds?: number;
}

/**
 * Build + sign a PayJarvis payment outcome receipt. Convenience wrapper
 * over buildEnvelope/signEnvelope with PayJarvis schema choices baked in.
 */
export function buildPaymentOutcomeReceipt(
  params: PaymentOutcomeReceiptParams
): CtefEnvelope {
  const refs: CtefReference[] = [];
  if (params.outcome.bdit_jti) {
    refs.push({
      kind: "bdit_token",
      urn: `urn:payjarvis:bdit:${params.outcome.bdit_jti}`,
    });
  }
  if (params.outcome.concordia_session_urn) {
    refs.push({
      kind: "source_session",
      urn: params.outcome.concordia_session_urn,
    });
  }
  refs.push({
    kind: "approval",
    urn: `urn:payjarvis:approval:${params.outcome.approval_id}`,
  });

  const unsigned = buildEnvelope({
    providerDid: params.providerDid,
    providerName: params.providerName,
    providerKid: params.providerKid,
    subjectDid: params.subjectDid,
    payload: params.outcome as unknown as Record<string, unknown>,
    references: refs,
    sequenceKey: params.sessionId,
    category: params.category,
    issuedAt: params.issuedAt,
    validitySeconds: params.validitySeconds,
  });

  return signEnvelope(unsigned, params.privateKeyPem, params.providerKid);
}
