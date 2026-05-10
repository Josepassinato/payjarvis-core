import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";

/**
 * Generate a BDIT signing key pair.
 *
 *   npm run -w @payjarvis/bdit generate-keys                # default: Ed25519
 *   npm run -w @payjarvis/bdit generate-keys -- --alg=rsa   # legacy RSA-2048
 */

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

  if (alg === "rsa") {
    console.log("Generating RS256 (RSA-2048) key pair for BDIT tokens...\n");
    const { publicKey, privateKey } = await generateKeyPair("RS256", { modulusLength: 2048 });
    const privatePem = await exportPKCS8(privateKey);
    const publicPem = await exportSPKI(publicKey);

    console.log("=== PRIVATE KEY (keep secret!) ===");
    console.log(privatePem);
    console.log("=== PUBLIC KEY (share with merchants) ===");
    console.log(publicPem);

    console.log("\n=== For .env file ===");
    console.log(`PAYJARVIS_PRIVATE_KEY="${privatePem.replace(/\n/g, "\\n")}"`);
    console.log(`PAYJARVIS_PUBLIC_KEY="${publicPem.replace(/\n/g, "\\n")}"`);
    console.log(`PAYJARVIS_KEY_ID="payjarvis-rs256-001"`);
    console.log(`# BDIT_SIGNING_ALG=RS256   # uncomment to force RSA signing`);
    return;
  }

  console.log("Generating EdDSA (Ed25519) key pair for BDIT tokens...");
  console.log("This is the default — Concordia-aligned per BDIT-SPEC §10.\n");
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);

  console.log("=== PRIVATE KEY (keep secret!) ===");
  console.log(privatePem);
  console.log("=== PUBLIC KEY (share with merchants) ===");
  console.log(publicPem);

  console.log("\n=== For .env file ===");
  console.log(`PAYJARVIS_PRIVATE_KEY_ED25519="${privatePem.replace(/\n/g, "\\n")}"`);
  console.log(`PAYJARVIS_PUBLIC_KEY_ED25519="${publicPem.replace(/\n/g, "\\n")}"`);
  console.log(`PAYJARVIS_KEY_ID_ED25519="payjarvis-ed25519-001"`);
  console.log(`# BDIT_SIGNING_ALG=EdDSA   # default when Ed25519 keys are present`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
