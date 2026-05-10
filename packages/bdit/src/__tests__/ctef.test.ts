/**
 * CTEF envelope tests — canonical JSON determinism, sign/verify
 * roundtrip, schema shape, and provider/subject DID structure.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import {
  canonicalJson,
  buildEnvelope,
  signEnvelope,
  verifyEnvelope,
  buildPaymentOutcomeReceipt,
  type CtefEnvelope,
  type UnsignedCtefEnvelope,
} from "../ctef.js";

let edKey: { privatePem: string; publicPem: string };
let rsaKey: { privatePem: string; publicPem: string };

beforeAll(async () => {
  const ed = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  edKey = {
    privatePem: await exportPKCS8(ed.privateKey),
    publicPem: await exportSPKI(ed.publicKey),
  };
  const rsa = await generateKeyPair("RS256", { modulusLength: 2048 });
  rsaKey = {
    privatePem: await exportPKCS8(rsa.privateKey),
    publicPem: await exportSPKI(rsa.publicKey),
  };
});

const SAMPLE_BUILD_PARAMS = {
  providerDid: "did:web:api.payjarvis.com",
  providerName: "PayJarvis",
  providerKid: "payjarvis-ed25519-001",
  subjectDid: "did:payjarvis:bot:bot_test_001",
  payload: {
    approval_id: "appr_abc123",
    decision: "approved",
    amount: 49.99,
    currency: "USD",
    merchant_id: "merchant_test",
    category: "shopping",
  },
  sequenceKey: "sess_test_001",
};

describe("canonicalJson — determinism + edge cases", () => {
  it("sorts object keys", () => {
    const a = canonicalJson({ b: 1, a: 2 });
    const b = canonicalJson({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it("recursively sorts nested objects + arrays", () => {
    const x = canonicalJson({ outer: { z: [3, 1], a: 1 } });
    const y = canonicalJson({ outer: { a: 1, z: [3, 1] } });
    expect(x).toBe(y);
    expect(x).toBe('{"outer":{"a":1,"z":[3,1]}}');
  });

  it("preserves array order (arrays are sequence-significant)", () => {
    const x = canonicalJson([3, 1, 2]);
    expect(x).toBe("[3,1,2]");
  });

  it("emits no whitespace", () => {
    const c = canonicalJson({ a: 1, b: { c: 2 } });
    expect(c).not.toMatch(/\s/);
  });

  it("rejects NaN", () => {
    expect(() => canonicalJson({ x: NaN })).toThrow(/NaN/);
  });

  it("rejects Infinity", () => {
    expect(() => canonicalJson({ x: Infinity })).toThrow(/Infinity/);
    expect(() => canonicalJson({ x: -Infinity })).toThrow(/Infinity/);
  });

  it("rejects -0", () => {
    expect(() => canonicalJson({ x: -0 })).toThrow(/-0/);
  });

  it("handles null + booleans + strings + numbers", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hello")).toBe('"hello"');
  });

  it("escapes strings per JSON spec (compatible with stableStringify)", () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson("a\nb")).toBe('"a\\nb"');
  });
});

describe("buildEnvelope — shape", () => {
  it("produces all required CTEF fields", () => {
    const env = buildEnvelope(SAMPLE_BUILD_PARAMS);
    expect(env.envelope_version).toBe("1.0.0");
    expect(env.envelope_id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(env.issued_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(env.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(env.refresh_hint.strategy).toBe("event_driven");
    expect(env.refresh_hint.events).toContain("payment_settled");
    expect(env.validity_temporal.mode).toBe("sequence");
    expect(env.validity_temporal.sequence_key).toBe("sess_test_001");
    expect(env.provider).toEqual({
      did: "did:web:api.payjarvis.com",
      category: "transactional",
      kid: "payjarvis-ed25519-001",
      name: "PayJarvis",
    });
    expect(env.subject.did).toBe("did:payjarvis:bot:bot_test_001");
    expect(env.category).toBe("transactional");
    expect(env.visibility).toBe("public");
    expect(env.references).toEqual([]);
    expect(env.payload).toEqual(SAMPLE_BUILD_PARAMS.payload);
  });

  it("validity window defaults to 7 days, overridable", () => {
    const issuedAt = new Date("2026-05-10T00:00:00.000Z");
    const env = buildEnvelope({ ...SAMPLE_BUILD_PARAMS, issuedAt });
    const expiresMs = new Date(env.expires_at).getTime();
    const issuedMs = new Date(env.issued_at).getTime();
    expect(expiresMs - issuedMs).toBe(7 * 24 * 60 * 60 * 1000);

    const envCustom = buildEnvelope({
      ...SAMPLE_BUILD_PARAMS,
      issuedAt,
      validitySeconds: 60,
    });
    expect(new Date(envCustom.expires_at).getTime() - issuedMs).toBe(60_000);
  });

  it("category override applies to both provider.category and top-level category", () => {
    const env = buildEnvelope({ ...SAMPLE_BUILD_PARAMS, category: "spending-authorization" });
    expect(env.category).toBe("spending-authorization");
    expect(env.provider.category).toBe("spending-authorization");
  });
});

describe("signEnvelope + verifyEnvelope — Ed25519 roundtrip", () => {
  it("signs an unsigned envelope and verifies cleanly", () => {
    const unsigned = buildEnvelope(SAMPLE_BUILD_PARAMS);
    const signed = signEnvelope(unsigned, edKey.privatePem, "kid-test");

    expect(signed.signature?.alg).toBe("EdDSA");
    expect(signed.signature?.kid).toBe("kid-test");
    expect(signed.signature?.value).toBeTruthy();
    // base64url has no padding, no +, no /, no =
    expect(signed.signature?.value).not.toMatch(/[+/=]/);

    const result = verifyEnvelope(signed, edKey.publicPem);
    expect(result.valid).toBe(true);
  });

  it("verify rejects tampered payload", () => {
    const unsigned = buildEnvelope(SAMPLE_BUILD_PARAMS);
    const signed = signEnvelope(unsigned, edKey.privatePem, "kid-test");

    // Tamper: change amount in payload after signing
    const tampered: CtefEnvelope = {
      ...signed,
      payload: { ...signed.payload, amount: 99999 },
    };
    const result = verifyEnvelope(tampered, edKey.publicPem);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature mismatch/);
  });

  it("verify rejects wrong-key signature", async () => {
    const otherEd = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const otherPubPem = await exportSPKI(otherEd.publicKey);

    const unsigned = buildEnvelope(SAMPLE_BUILD_PARAMS);
    const signed = signEnvelope(unsigned, edKey.privatePem, "kid-test");

    const result = verifyEnvelope(signed, otherPubPem);
    expect(result.valid).toBe(false);
  });

  it("verify rejects envelope without signature", () => {
    const unsigned = buildEnvelope(SAMPLE_BUILD_PARAMS);
    const result = verifyEnvelope(unsigned as unknown as CtefEnvelope, edKey.publicPem);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no signature/);
  });

  it("sign rejects RSA private key (CTEF mandates Ed25519)", () => {
    const unsigned = buildEnvelope(SAMPLE_BUILD_PARAMS);
    expect(() => signEnvelope(unsigned, rsaKey.privatePem, "kid-rsa")).toThrow(
      /require[s]? Ed25519/i
    );
  });

  it("verify rejects RSA public key (CTEF mandates Ed25519)", () => {
    const unsigned = buildEnvelope(SAMPLE_BUILD_PARAMS);
    const signed = signEnvelope(unsigned, edKey.privatePem, "kid-test");
    const result = verifyEnvelope(signed, rsaKey.publicPem);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expected ed25519/i);
  });

  it("signature is invariant across object-key reorderings of the unsigned envelope", () => {
    // Build the same envelope structurally — signature should be identical
    // because canonicalJson sorts keys before hashing.
    const issuedAt = new Date("2026-05-10T12:00:00.000Z");
    const envelopeId = "urn:uuid:11111111-2222-3333-4444-555555555555";

    const aSigned = signEnvelope(
      buildEnvelope({ ...SAMPLE_BUILD_PARAMS, issuedAt, envelopeId }),
      edKey.privatePem,
      "kid-test"
    );

    // Rebuild with the same params but in different declaration order;
    // since the actual fields of the envelope come from the same builder,
    // the canonical bytes are the same and signatures should match.
    const bSigned = signEnvelope(
      buildEnvelope({
        sequenceKey: SAMPLE_BUILD_PARAMS.sequenceKey,
        payload: SAMPLE_BUILD_PARAMS.payload,
        subjectDid: SAMPLE_BUILD_PARAMS.subjectDid,
        providerKid: SAMPLE_BUILD_PARAMS.providerKid,
        providerName: SAMPLE_BUILD_PARAMS.providerName,
        providerDid: SAMPLE_BUILD_PARAMS.providerDid,
        issuedAt,
        envelopeId,
      }),
      edKey.privatePem,
      "kid-test"
    );

    expect(aSigned.signature?.value).toBe(bSigned.signature?.value);
  });
});

describe("buildPaymentOutcomeReceipt — PayJarvis convenience helper", () => {
  it("includes BDIT + Concordia references when present", () => {
    const r = buildPaymentOutcomeReceipt({
      providerDid: "did:web:api.payjarvis.com",
      providerName: "PayJarvis",
      providerKid: "payjarvis-ed25519-001",
      privateKeyPem: edKey.privatePem,
      subjectDid: "did:payjarvis:bot:bot_test_001",
      outcome: {
        approval_id: "appr_abc",
        decision: "approved",
        amount: 49.99,
        currency: "USD",
        merchant_id: "amazon",
        category: "shopping",
        bdit_jti: "550e8400-e29b-41d4-a716-446655440000",
        concordia_session_urn: "urn:concordia:session:ses_xyz",
        mandate_source: "concordia",
      },
      sessionId: "sess_001",
    });

    const refs = r.references;
    expect(refs).toHaveLength(3);
    expect(refs.find((x) => x.kind === "bdit_token")?.urn).toBe(
      "urn:payjarvis:bdit:550e8400-e29b-41d4-a716-446655440000"
    );
    expect(refs.find((x) => x.kind === "source_session")?.urn).toBe(
      "urn:concordia:session:ses_xyz"
    );
    expect(refs.find((x) => x.kind === "approval")?.urn).toBe(
      "urn:payjarvis:approval:appr_abc"
    );

    const v = verifyEnvelope(r, edKey.publicPem);
    expect(v.valid).toBe(true);
  });

  it("works without optional Concordia binding (mandate_source=owner)", () => {
    const r = buildPaymentOutcomeReceipt({
      providerDid: "did:web:api.payjarvis.com",
      providerName: "PayJarvis",
      providerKid: "payjarvis-ed25519-001",
      privateKeyPem: edKey.privatePem,
      subjectDid: "did:payjarvis:bot:bot_test_002",
      outcome: {
        approval_id: "appr_owner_only",
        decision: "blocked",
        amount: 1000,
        currency: "USD",
        merchant_id: "casino_xyz",
        category: "gambling",
        reason: "category_not_allowed",
      },
      sessionId: "sess_002",
    });

    expect(r.references.find((x) => x.kind === "bdit_token")).toBeUndefined();
    expect(r.references.find((x) => x.kind === "source_session")).toBeUndefined();
    expect(r.references.find((x) => x.kind === "approval")).toBeDefined();

    const v = verifyEnvelope(r, edKey.publicPem);
    expect(v.valid).toBe(true);
  });
});
