import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";

async function main() {
  console.log("Generating RS256 key pair for BDIT tokens...\n");

  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    modulusLength: 2048,
  });

  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);

  console.log("=== PRIVATE KEY (keep secret!) ===");
  console.log(privatePem);

  console.log("=== PUBLIC KEY (share with merchants) ===");
  console.log(publicPem);

  console.log("\n=== For .env file ===");
  console.log(
    `PAYJARVIS_PRIVATE_KEY="${privatePem.replace(/\n/g, "\\n")}"`
  );
  console.log(
    `PAYJARVIS_PUBLIC_KEY="${publicPem.replace(/\n/g, "\\n")}"`
  );
  console.log('PAYJARVIS_KEY_ID="payjarvis-key-001"');
}

main().catch(console.error);
