import type { FastifyInstance } from "fastify";
import { importSPKI, exportJWK } from "jose";

export async function jwksRoutes(app: FastifyInstance) {
  app.get("/.well-known/jwks.json", async () => {
    const publicKeyPem = process.env.PAYJARVIS_PUBLIC_KEY!.replace(/\\n/g, "\n");
    const keyId = process.env.PAYJARVIS_KEY_ID ?? "payjarvis-key-001";

    const publicKey = await importSPKI(publicKeyPem, "RS256");
    const jwk = await exportJWK(publicKey);

    return {
      keys: [
        {
          ...jwk,
          kid: keyId,
          alg: "RS256",
          use: "sig",
        },
      ],
    };
  });
}
