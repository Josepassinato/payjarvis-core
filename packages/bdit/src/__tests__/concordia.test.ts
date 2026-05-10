/**
 * Concordia verification tests — shape validation, term extraction,
 * trusted-DID enforcement, mode behavior, and JWKS-backed signature
 * verification roundtrip.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { generateKeyPair, exportPKCS8, exportSPKI, exportJWK } from "jose";
import {
  buildEnvelope,
  signEnvelope,
  type CtefEnvelope,
} from "../ctef.js";
import {
  verifyConcordiaAgreement,
  extractTermsFromEnvelope,
  extractSourceSession,
  loadConcordiaOptionsFromEnv,
} from "../concordia.js";

let edKey: { privatePem: string; publicPem: string; jwk: Record<string, unknown> };

beforeAll(async () => {
  const ed = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = await exportJWK(ed.publicKey);
  edKey = {
    privatePem: await exportPKCS8(ed.privateKey),
    publicPem: await exportSPKI(ed.publicKey),
    jwk: { ...jwk, kid: "concordia-test-kid", alg: "EdDSA", use: "sig" },
  };
});

const CONCORDIA_PROVIDER_DID = "did:web:concordia.example";

function buildAgreementEnvelope(payload: Record<string, unknown>): CtefEnvelope {
  const unsigned = buildEnvelope({
    providerDid: CONCORDIA_PROVIDER_DID,
    providerName: "Concordia",
    providerKid: "concordia-test-kid",
    subjectDid: "did:web:agent-a.example",
    payload,
    references: [
      {
        kind: "source_session",
        urn: "urn:concordia:session:ses_xyz_test",
        hash: "sha256:abcdef0123456789",
        verifier_did: CONCORDIA_PROVIDER_DID,
      },
    ],
    sequenceKey: "ses_xyz_test",
    category: "transactional",
  });
  return signEnvelope(unsigned, edKey.privatePem, "concordia-test-kid");
}

const VALID_TERMS = {
  max_amount: 2050,
  currency: "USD",
  categories: ["electronics", "shopping"],
  amount: 2050,
  category: "electronics",
};

describe("extractSourceSession", () => {
  it("returns urn + hash from envelope.references", () => {
    const env = buildAgreementEnvelope(VALID_TERMS);
    const ref = extractSourceSession(env);
    expect(ref.urn).toBe("urn:concordia:session:ses_xyz_test");
    expect(ref.hash).toBe("sha256:abcdef0123456789");
  });

  it("throws when source_session reference missing", () => {
    const unsigned = buildEnvelope({
      providerDid: CONCORDIA_PROVIDER_DID,
      providerName: "Concordia",
      providerKid: "concordia-test-kid",
      subjectDid: "did:web:agent-a.example",
      payload: VALID_TERMS,
      references: [],
      sequenceKey: "ses_xyz_test",
    });
    const signed = signEnvelope(unsigned, edKey.privatePem, "concordia-test-kid");
    expect(() => extractSourceSession(signed)).toThrow(/source_session/);
  });

  it("throws when reference missing urn or hash", () => {
    const unsigned = buildEnvelope({
      providerDid: CONCORDIA_PROVIDER_DID,
      providerName: "Concordia",
      providerKid: "concordia-test-kid",
      subjectDid: "did:web:agent-a.example",
      payload: VALID_TERMS,
      references: [{ kind: "source_session", urn: "urn:x" }], // no hash
      sequenceKey: "ses_xyz_test",
    });
    const signed = signEnvelope(unsigned, edKey.privatePem, "concordia-test-kid");
    expect(() => extractSourceSession(signed)).toThrow(/urn and hash/);
  });
});

describe("extractTermsFromEnvelope", () => {
  it("extracts canonical terms with explicit fields", () => {
    const env = buildAgreementEnvelope(VALID_TERMS);
    const terms = extractTermsFromEnvelope(env);
    expect(terms).toEqual({
      max_amount: 2050,
      currency: "USD",
      categories: ["electronics", "shopping"],
      amount: 2050,
      category: "electronics",
      merchant_id: undefined,
    });
  });

  it("defaults amount to max_amount and category to categories[0] when missing", () => {
    const env = buildAgreementEnvelope({
      max_amount: 500,
      currency: "USD",
      categories: ["food"],
    });
    const terms = extractTermsFromEnvelope(env);
    expect(terms.amount).toBe(500);
    expect(terms.category).toBe("food");
  });

  it("preserves explicit merchant_id including null (any-merchant binding)", () => {
    const envExplicit = buildAgreementEnvelope({
      ...VALID_TERMS,
      merchant_id: "amazon",
    });
    expect(extractTermsFromEnvelope(envExplicit).merchant_id).toBe("amazon");

    const envNull = buildAgreementEnvelope({ ...VALID_TERMS, merchant_id: null });
    expect(extractTermsFromEnvelope(envNull).merchant_id).toBeNull();
  });

  it("rejects non-finite max_amount", () => {
    const env = buildAgreementEnvelope({
      max_amount: "not a number" as unknown as number,
      currency: "USD",
      categories: ["food"],
    });
    expect(() => extractTermsFromEnvelope(env)).toThrow(/max_amount/);
  });

  it("rejects empty categories", () => {
    const env = buildAgreementEnvelope({
      max_amount: 100,
      currency: "USD",
      categories: [],
    });
    expect(() => extractTermsFromEnvelope(env)).toThrow(/categories/);
  });

  it("rejects non-string category entries", () => {
    const env = buildAgreementEnvelope({
      max_amount: 100,
      currency: "USD",
      categories: ["food", 42 as unknown as string],
    });
    expect(() => extractTermsFromEnvelope(env)).toThrow(/categories/);
  });
});

describe("verifyConcordiaAgreement — shape + reference + DID", () => {
  it("strict mode requires CONCORDIA_JWKS_URL", async () => {
    const env = buildAgreementEnvelope(VALID_TERMS);
    const result = await verifyConcordiaAgreement(env, { mode: "strict" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/CONCORDIA_JWKS_URL/);
  });

  it("permissive mode validates shape without crypto", async () => {
    const env = buildAgreementEnvelope(VALID_TERMS);
    const result = await verifyConcordiaAgreement(env, {
      mode: "permissive",
      trustedProviderDids: [CONCORDIA_PROVIDER_DID],
    });
    expect(result.valid).toBe(true);
    expect(result.signatureVerified).toBe(false); // permissive — signature NOT verified
    expect(result.terms?.max_amount).toBe(2050);
    expect(result.source?.urn).toBe("urn:concordia:session:ses_xyz_test");
  });

  it("rejects unsigned envelopes", async () => {
    const unsigned = buildEnvelope({
      providerDid: CONCORDIA_PROVIDER_DID,
      providerName: "Concordia",
      providerKid: "concordia-test-kid",
      subjectDid: "did:web:agent-a.example",
      payload: VALID_TERMS,
      sequenceKey: "ses_xyz_test",
    });
    const result = await verifyConcordiaAgreement(unsigned as unknown as CtefEnvelope, {
      mode: "permissive",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unsigned/);
  });

  it("rejects untrusted provider DIDs", async () => {
    const env = buildAgreementEnvelope(VALID_TERMS);
    const result = await verifyConcordiaAgreement(env, {
      mode: "permissive",
      trustedProviderDids: ["did:web:other.example"],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in trusted list/);
  });

  it("returns providerDid even on rejection", async () => {
    const env = buildAgreementEnvelope(VALID_TERMS);
    const result = await verifyConcordiaAgreement(env, {
      mode: "permissive",
      trustedProviderDids: ["did:web:other.example"],
    });
    expect(result.providerDid).toBe(CONCORDIA_PROVIDER_DID);
  });

  it("rejects invalid terms in permissive mode", async () => {
    const env = buildAgreementEnvelope({
      max_amount: 100,
      currency: "USD",
      categories: [], // empty
    });
    const result = await verifyConcordiaAgreement(env, { mode: "permissive" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/categories/);
  });
});

describe("verifyConcordiaAgreement — JWKS-backed strict mode", () => {
  it("verifies signature against JWKS in strict mode", async () => {
    // Mock global fetch for JWKS lookup
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [edKey.jwk] }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const env = buildAgreementEnvelope(VALID_TERMS);
      const result = await verifyConcordiaAgreement(env, {
        mode: "strict",
        jwksUrl: "https://concordia.example/.well-known/jwks.json",
      });
      expect(result.valid).toBe(true);
      expect(result.signatureVerified).toBe(true);
      expect(result.terms?.max_amount).toBe(2050);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects when JWKS has no matching kid", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [{ ...edKey.jwk, kid: "different-kid" }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const env = buildAgreementEnvelope(VALID_TERMS);
      const result = await verifyConcordiaAgreement(env, {
        mode: "strict",
        jwksUrl: "https://concordia.example/.well-known/jwks.json",
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/no EdDSA key with kid/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects when signature does not match the JWKS key", async () => {
    // JWKS returns a DIFFERENT public key (not the one that signed)
    const otherEd = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const otherJwk = await exportJWK(otherEd.publicKey);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [{ ...otherJwk, kid: "concordia-test-kid", alg: "EdDSA" }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const env = buildAgreementEnvelope(VALID_TERMS);
      const result = await verifyConcordiaAgreement(env, {
        mode: "strict",
        jwksUrl: "https://concordia.example/.well-known/jwks.json",
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/signature verification failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("loadConcordiaOptionsFromEnv", () => {
  it("parses jwksUrl + trustedDids + mode", () => {
    const env = {
      CONCORDIA_JWKS_URL: "https://x/jwks.json",
      CONCORDIA_TRUSTED_PROVIDER_DIDS: "did:web:a, did:web:b ,did:web:c",
      CONCORDIA_VERIFY_MODE: "permissive",
    } as NodeJS.ProcessEnv;
    const opts = loadConcordiaOptionsFromEnv(env);
    expect(opts.jwksUrl).toBe("https://x/jwks.json");
    expect(opts.trustedProviderDids).toEqual(["did:web:a", "did:web:b", "did:web:c"]);
    expect(opts.mode).toBe("permissive");
  });

  it("defaults mode to strict", () => {
    const opts = loadConcordiaOptionsFromEnv({} as NodeJS.ProcessEnv);
    expect(opts.mode).toBe("strict");
    expect(opts.jwksUrl).toBeUndefined();
    expect(opts.trustedProviderDids).toBeUndefined();
  });
});
