import type { FastifyInstance } from "fastify";
import { importSPKI, exportJWK } from "jose";
import { loadPublicKeys } from "@payjarvis/bdit";

export async function jwksRoutes(app: FastifyInstance) {
  app.get("/.well-known/jwks.json", async (_request, reply) => {
    const keyEntries = loadPublicKeys();

    if (keyEntries.length === 0) {
      return reply.status(503).send({ error: "No signing keys configured" });
    }

    // Each entry already carries its algorithm — RS256 (legacy) and
    // EdDSA (Concordia-aligned, default for new issuance) are both
    // emitted so verifiers can resolve any kid on the wire.
    const jwkKeys = await Promise.all(
      keyEntries.map(async (entry) => {
        const publicKey = await importSPKI(entry.pem, entry.alg);
        const jwk = await exportJWK(publicKey);
        return {
          ...jwk,
          kid: entry.kid,
          alg: entry.alg,
          use: "sig",
        };
      })
    );

    return reply
      .header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
      .send({ keys: jwkKeys });
  });
}
