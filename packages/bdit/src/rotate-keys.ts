/**
 * BDIT key rotation script — generates the next key pair for either
 * algorithm (RS256 or EdDSA / Ed25519) and prints the env steps for a
 * grace-period rotation.
 *
 *   npm run -w @payjarvis/bdit rotate-keys                # rotates Ed25519 (default)
 *   npm run -w @payjarvis/bdit rotate-keys -- --alg=rsa   # rotates RSA legacy key
 *
 * Rotation flow (per algorithm):
 *
 *   1. Move CURRENT public key to PREV slot, set PREV kid:
 *        PAYJARVIS_PUBLIC_KEY_PREV          ← old public PEM
 *        PAYJARVIS_KEY_ID_PREV              ← old kid
 *      (Or _ED25519_PREV variants for EdDSA.)
 *
 *   2. Set CURRENT to the new key + new kid + new private.
 *
 *   3. Restart payjarvis-api. Both keys are now in JWKS — old tokens
 *      still verify against PREV, new tokens are signed with CURRENT.
 *
 *   4. Wait > token TTL (5 min) for old tokens to expire.
 *
 *   5. Remove the PREV slot from .env and restart again.
 */

import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";

type Alg = "ed25519" | "rsa";

function parseAlg(argv: string[]): Alg {
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--alg(?:=(.+))?$/);
    if (m) {
      const value = (m[1] ?? argv[argv.indexOf(arg) + 1] ?? "").toLowerCase();
      if (value === "rsa" || value === "rs256") return "rsa";
      if (value === "ed25519" || value === "eddsa") return "ed25519";
      throw new Error(`Unknown --alg value: ${value} (expected rsa | ed25519)`);
    }
  }
  return "ed25519";
}

async function main(): Promise<void> {
  const alg = parseAlg(process.argv);
  const env = process.env.BDIT_ENV ?? process.env.NODE_ENV ?? "production";
  const timestamp = Date.now();
  const familyTag = alg === "rsa" ? "rs256" : "ed25519";
  const newKeyId = `payjarvis-${env}-${familyTag}-${timestamp}`;

  console.log(`=== BDIT Key Rotation (${familyTag}) ===\n`);
  console.log(`Environment: ${env}`);
  console.log(`New Key ID: ${newKeyId}\n`);

  const keyPair =
    alg === "rsa"
      ? await generateKeyPair("RS256", { modulusLength: 2048 })
      : await generateKeyPair("EdDSA", { crv: "Ed25519" });

  const privatePem = await exportPKCS8(keyPair.privateKey);
  const publicPem = await exportSPKI(keyPair.publicKey);

  const privEnv = alg === "rsa" ? "PAYJARVIS_PRIVATE_KEY" : "PAYJARVIS_PRIVATE_KEY_ED25519";
  const pubEnv = alg === "rsa" ? "PAYJARVIS_PUBLIC_KEY" : "PAYJARVIS_PUBLIC_KEY_ED25519";
  const kidEnv = alg === "rsa" ? "PAYJARVIS_KEY_ID" : "PAYJARVIS_KEY_ID_ED25519";
  const pubPrevEnv = `${pubEnv}_PREV`;
  const kidPrevEnv = `${kidEnv}_PREV`;

  console.log("── Step 1: Add these to your .env (BEFORE removing old keys) ──\n");

  console.log("# Move current keys to PREV slots:");
  console.log(`${pubPrevEnv}="\${${pubEnv}}"`);
  console.log(`${kidPrevEnv}="\${${kidEnv}}"\n`);

  console.log("# Set new keys:");
  console.log(`${privEnv}="${privatePem.replace(/\n/g, "\\n")}"`);
  console.log(`${pubEnv}="${publicPem.replace(/\n/g, "\\n")}"`);
  console.log(`${kidEnv}="${newKeyId}"\n`);

  console.log("── Step 2: Restart API server ──\n");
  console.log("pm2 restart payjarvis-api\n");

  console.log("── Step 3: Wait > 5 minutes for old tokens to expire ──\n");
  console.log("sleep 360\n");

  console.log("── Step 4: Remove PREV keys from .env ──\n");
  console.log(`# Remove ${pubPrevEnv} and ${kidPrevEnv}\n`);

  console.log("── Step 5: Restart again ──\n");
  console.log("pm2 restart payjarvis-api\n");

  console.log("=== Rotation complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
