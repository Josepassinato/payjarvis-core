/**
 * BDIT dual-sign tests — RS256 (legacy) and EdDSA / Ed25519 (default
 * for new issuance) must both sign and verify cleanly, and the verifier
 * must accept tokens regardless of which alg minted them.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import { BditIssuer } from "../issuer.js";
import { BditVerifier } from "../verifier.js";
import { activePrivateKey, loadPublicKeys } from "../keys.js";

// ─── Shared key material ─────────────────────────────────

let rsaKey: { privatePem: string; publicPem: string };
let edKey: { privatePem: string; publicPem: string };

beforeAll(async () => {
  const rsa = await generateKeyPair("RS256", { modulusLength: 2048 });
  rsaKey = {
    privatePem: await exportPKCS8(rsa.privateKey),
    publicPem: await exportSPKI(rsa.publicKey),
  };

  const ed = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  edKey = {
    privatePem: await exportPKCS8(ed.privateKey),
    publicPem: await exportSPKI(ed.publicKey),
  };
});

const SAMPLE_PARAMS = {
  botId: "bot_test_001",
  ownerId: "user_test_001",
  trustScore: 85,
  kycLevel: 2,
  categories: ["shopping"],
  maxAmount: 500,
  merchantId: "merchant_test",
  amount: 49.99,
  category: "shopping",
  sessionId: "sess_test_001",
};

describe("BDIT dual-sign — RS256 + EdDSA", () => {
  it("RS256 issuer signs, RS256 verifier accepts (legacy roundtrip)", async () => {
    const issuer = new BditIssuer(rsaKey.privatePem, "test-rs256-001", "test");
    const verifier = BditVerifier.fromPublicKey(rsaKey.publicPem, "RS256", "test");

    expect(issuer.algorithm).toBe("RS256");

    const { token } = await issuer.issue(SAMPLE_PARAMS);
    const result = await verifier.verify(token);

    expect(result.valid).toBe(true);
    expect(result.payload?.bot_id).toBe("bot_test_001");
    expect(result.algorithm).toBe("RS256");
  });

  it("EdDSA issuer signs, EdDSA verifier accepts (Ed25519 roundtrip)", async () => {
    const issuer = new BditIssuer(
      { alg: "EdDSA", pem: edKey.privatePem, kid: "test-ed25519-001" },
      "test"
    );
    const verifier = BditVerifier.fromPublicKey(edKey.publicPem, "EdDSA", "test");

    expect(issuer.algorithm).toBe("EdDSA");

    const { token } = await issuer.issue(SAMPLE_PARAMS);
    const result = await verifier.verify(token);

    expect(result.valid).toBe(true);
    expect(result.payload?.bot_id).toBe("bot_test_001");
    expect(result.algorithm).toBe("EdDSA");
  });

  it("Ed25519 token rejected by RS256-only verifier (key+alg are bound)", async () => {
    const issuer = new BditIssuer(
      { alg: "EdDSA", pem: edKey.privatePem, kid: "test-ed25519-002" },
      "test"
    );
    const verifier = BditVerifier.fromPublicKey(rsaKey.publicPem, "RS256", "test");

    const { token } = await issuer.issue(SAMPLE_PARAMS);
    const result = await verifier.verify(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("legacy 2-arg constructor still works (RS256 default)", async () => {
    // Backwards-compat path that pre-existed this migration.
    const issuer = new BditIssuer(rsaKey.privatePem, "test-rs256-002", "test");
    const verifier = BditVerifier.fromPublicKey(rsaKey.publicPem, "test"); // 2-arg legacy

    const { token } = await issuer.issue(SAMPLE_PARAMS);
    const result = await verifier.verify(token);

    expect(result.valid).toBe(true);
  });
});

describe("activePrivateKey() — env-driven selection", () => {
  it("prefers EdDSA when both keys are configured and BDIT_SIGNING_ALG is unset", () => {
    const env = {
      PAYJARVIS_PRIVATE_KEY: rsaKey.privatePem,
      PAYJARVIS_KEY_ID: "test-rs256",
      PAYJARVIS_PRIVATE_KEY_ED25519: edKey.privatePem,
      PAYJARVIS_KEY_ID_ED25519: "test-ed25519",
    } as NodeJS.ProcessEnv;
    const active = activePrivateKey(env);
    expect(active.alg).toBe("EdDSA");
    expect(active.kid).toBe("test-ed25519");
  });

  it("falls back to RS256 when only RSA is configured", () => {
    const env = {
      PAYJARVIS_PRIVATE_KEY: rsaKey.privatePem,
      PAYJARVIS_KEY_ID: "test-rs256",
    } as NodeJS.ProcessEnv;
    const active = activePrivateKey(env);
    expect(active.alg).toBe("RS256");
  });

  it("BDIT_SIGNING_ALG=RS256 forces RSA even when Ed25519 keys exist", () => {
    const env = {
      BDIT_SIGNING_ALG: "RS256",
      PAYJARVIS_PRIVATE_KEY: rsaKey.privatePem,
      PAYJARVIS_KEY_ID: "test-rs256",
      PAYJARVIS_PRIVATE_KEY_ED25519: edKey.privatePem,
      PAYJARVIS_KEY_ID_ED25519: "test-ed25519",
    } as NodeJS.ProcessEnv;
    const active = activePrivateKey(env);
    expect(active.alg).toBe("RS256");
  });

  it("BDIT_SIGNING_ALG=EdDSA without Ed25519 keys throws (fail-fast)", () => {
    const env = {
      BDIT_SIGNING_ALG: "EdDSA",
      PAYJARVIS_PRIVATE_KEY: rsaKey.privatePem,
      PAYJARVIS_KEY_ID: "test-rs256",
    } as NodeJS.ProcessEnv;
    expect(() => activePrivateKey(env)).toThrow(/no Ed25519 keys configured/i);
  });

  it("no keys configured throws with helpful message", () => {
    expect(() => activePrivateKey({} as NodeJS.ProcessEnv)).toThrow(
      /No BDIT signing key configured/i
    );
  });
});

describe("loadPublicKeys() — JWKS source", () => {
  it("emits both RS256 + EdDSA when both are configured", () => {
    const env = {
      PAYJARVIS_PUBLIC_KEY: rsaKey.publicPem,
      PAYJARVIS_KEY_ID: "test-rs256",
      PAYJARVIS_PUBLIC_KEY_ED25519: edKey.publicPem,
      PAYJARVIS_KEY_ID_ED25519: "test-ed25519",
    } as NodeJS.ProcessEnv;
    const keys = loadPublicKeys(env);
    expect(keys).toHaveLength(2);
    expect(keys.find(k => k.alg === "RS256")?.kid).toBe("test-rs256");
    expect(keys.find(k => k.alg === "EdDSA")?.kid).toBe("test-ed25519");
  });

  it("emits PREV slots alongside CURRENT for grace-period rotation", () => {
    const env = {
      PAYJARVIS_PUBLIC_KEY_ED25519: edKey.publicPem,
      PAYJARVIS_KEY_ID_ED25519: "test-ed25519-current",
      PAYJARVIS_PUBLIC_KEY_ED25519_PREV: edKey.publicPem,
      PAYJARVIS_KEY_ID_ED25519_PREV: "test-ed25519-prev",
    } as NodeJS.ProcessEnv;
    const keys = loadPublicKeys(env);
    expect(keys).toHaveLength(2);
    expect(keys.map(k => k.kid).sort()).toEqual([
      "test-ed25519-current",
      "test-ed25519-prev",
    ]);
  });
});

describe("BditIssuer.fromEnv() — production wiring shortcut", () => {
  it("reads env, picks active alg, returns ready-to-sign issuer", async () => {
    const env = {
      PAYJARVIS_PRIVATE_KEY_ED25519: edKey.privatePem,
      PAYJARVIS_KEY_ID_ED25519: "test-ed25519-env",
      BDIT_ENV: "test",
    } as NodeJS.ProcessEnv;
    const issuer = BditIssuer.fromEnv(env);
    expect(issuer.algorithm).toBe("EdDSA");

    const { token } = await issuer.issue(SAMPLE_PARAMS);
    const verifier = BditVerifier.fromPublicKey(edKey.publicPem, "EdDSA", "payjarvis-test");
    const result = await verifier.verify(token);
    expect(result.valid).toBe(true);
  });
});
