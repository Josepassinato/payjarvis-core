/**
 * BDIT key loading — central environment → KeyEntry resolution.
 *
 * Supports dual-signing across RS256 (legacy) and EdDSA / Ed25519
 * (Concordia-aligned, default for new issuance per BDIT-SPEC §10).
 *
 * Each algorithm has CURRENT and optional PREV slots for grace-period
 * key rotation:
 *
 *   RS256:   PAYJARVIS_PRIVATE_KEY            PAYJARVIS_PUBLIC_KEY            PAYJARVIS_KEY_ID
 *            PAYJARVIS_PUBLIC_KEY_PREV                                        PAYJARVIS_KEY_ID_PREV
 *
 *   EdDSA:   PAYJARVIS_PRIVATE_KEY_ED25519    PAYJARVIS_PUBLIC_KEY_ED25519    PAYJARVIS_KEY_ID_ED25519
 *            PAYJARVIS_PUBLIC_KEY_ED25519_PREV                                PAYJARVIS_KEY_ID_ED25519_PREV
 *
 * The active signing algorithm is selected by BDIT_SIGNING_ALG
 * ("EdDSA" | "RS256"). Default precedence: EdDSA if Ed25519 keys exist,
 * else RS256. Verifiers ALWAYS accept both.
 */

export type BditAlgorithm = "RS256" | "EdDSA";

export interface PublicKeyEntry {
  kid: string;
  alg: BditAlgorithm;
  pem: string;     // SPKI PEM
}

export interface PrivateKeyEntry {
  kid: string;
  alg: BditAlgorithm;
  pem: string;     // PKCS8 PEM
}

function unescape(pem: string | undefined): string | undefined {
  return pem?.replace(/\\n/g, "\n");
}

/**
 * Load all public keys configured in env (current + prev for both algs).
 * Used by the JWKS endpoint to expose every active verification key.
 */
export function loadPublicKeys(env: NodeJS.ProcessEnv = process.env): PublicKeyEntry[] {
  const keys: PublicKeyEntry[] = [];

  // RS256 current
  const rsaPem = unescape(env.PAYJARVIS_PUBLIC_KEY);
  const rsaKid = env.PAYJARVIS_KEY_ID;
  if (rsaPem && rsaKid) {
    keys.push({ kid: rsaKid, alg: "RS256", pem: rsaPem });
  }
  // RS256 prev (rotation grace)
  const rsaPemPrev = unescape(env.PAYJARVIS_PUBLIC_KEY_PREV);
  const rsaKidPrev = env.PAYJARVIS_KEY_ID_PREV;
  if (rsaPemPrev && rsaKidPrev) {
    keys.push({ kid: rsaKidPrev, alg: "RS256", pem: rsaPemPrev });
  }

  // EdDSA current
  const edPem = unescape(env.PAYJARVIS_PUBLIC_KEY_ED25519);
  const edKid = env.PAYJARVIS_KEY_ID_ED25519;
  if (edPem && edKid) {
    keys.push({ kid: edKid, alg: "EdDSA", pem: edPem });
  }
  // EdDSA prev (rotation grace)
  const edPemPrev = unescape(env.PAYJARVIS_PUBLIC_KEY_ED25519_PREV);
  const edKidPrev = env.PAYJARVIS_KEY_ID_ED25519_PREV;
  if (edPemPrev && edKidPrev) {
    keys.push({ kid: edKidPrev, alg: "EdDSA", pem: edPemPrev });
  }

  return keys;
}

/**
 * Resolve the ACTIVE signing key from env. Default policy:
 *
 *   1. If BDIT_SIGNING_ALG is explicitly set, use that algorithm.
 *      (Throws if requested alg has no configured key.)
 *   2. Else, prefer EdDSA if Ed25519 keys are configured.
 *   3. Else, fall back to RS256.
 *   4. Else, throw — no signing key available.
 *
 * This is the only place that decides "which alg signs new tokens";
 * consumers call activePrivateKey() instead of reading env directly.
 */
export function activePrivateKey(env: NodeJS.ProcessEnv = process.env): PrivateKeyEntry {
  const explicit = (env.BDIT_SIGNING_ALG ?? "").trim();
  const explicitNorm =
    explicit.toLowerCase() === "eddsa" ? "EdDSA" :
    explicit.toUpperCase() === "RS256" ? "RS256" : "";

  const rsaPriv = unescape(env.PAYJARVIS_PRIVATE_KEY);
  const rsaKid = env.PAYJARVIS_KEY_ID;
  const edPriv = unescape(env.PAYJARVIS_PRIVATE_KEY_ED25519);
  const edKid = env.PAYJARVIS_KEY_ID_ED25519;

  const haveRsa = Boolean(rsaPriv && rsaKid);
  const haveEd = Boolean(edPriv && edKid);

  if (explicitNorm === "EdDSA") {
    if (!haveEd) {
      throw new Error(
        "BDIT_SIGNING_ALG=EdDSA but no Ed25519 keys configured " +
          "(PAYJARVIS_PRIVATE_KEY_ED25519 + PAYJARVIS_KEY_ID_ED25519)"
      );
    }
    return { kid: edKid!, alg: "EdDSA", pem: edPriv! };
  }
  if (explicitNorm === "RS256") {
    if (!haveRsa) {
      throw new Error(
        "BDIT_SIGNING_ALG=RS256 but no RSA keys configured " +
          "(PAYJARVIS_PRIVATE_KEY + PAYJARVIS_KEY_ID)"
      );
    }
    return { kid: rsaKid!, alg: "RS256", pem: rsaPriv! };
  }

  // No explicit setting — prefer EdDSA, fall back to RS256.
  if (haveEd) {
    return { kid: edKid!, alg: "EdDSA", pem: edPriv! };
  }
  if (haveRsa) {
    return { kid: rsaKid!, alg: "RS256", pem: rsaPriv! };
  }
  throw new Error(
    "No BDIT signing key configured. Run `npm run -w @payjarvis/bdit generate-keys` " +
      "and set the resulting PAYJARVIS_PRIVATE_KEY[_ED25519] / PAYJARVIS_KEY_ID[_ED25519] envs."
  );
}

/**
 * Algorithms accepted for verification — both supported during the
 * dual-sign migration window. Verifiers should always accept both so
 * that tokens issued by either alg validate seamlessly.
 */
export const VERIFIER_ALGORITHMS: BditAlgorithm[] = ["RS256", "EdDSA"];
