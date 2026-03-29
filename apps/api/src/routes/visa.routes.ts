/**
 * Visa Routes — Click to Pay (Secure Remote Commerce)
 *
 * GET  /api/visa/sdk-config  — SDK initialization config for frontend
 * POST /api/visa/checkout    — Decrypt JWE checkout payload from SDK
 * GET  /api/visa/status      — Connection diagnostics
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { visaService } from "../services/visa.service.js";

export async function visaRoutes(app: FastifyInstance) {
  // SDK config — requires auth (returns project-specific init params)
  app.get(
    "/api/visa/sdk-config",
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const config = visaService.getSdkConfig();
      return reply.send({ success: true, data: config });
    }
  );

  // Decrypt checkout payload — requires auth
  app.post(
    "/api/visa/checkout",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { encryptedPayload } = request.body as {
        encryptedPayload?: string;
      };

      if (!encryptedPayload) {
        return reply
          .status(400)
          .send({ success: false, error: "encryptedPayload required" });
      }

      const result = visaService.decryptCheckoutPayload(encryptedPayload);

      if (!result.success) {
        return reply
          .status(422)
          .send({ success: false, error: result.error });
      }

      return reply.send({ success: true, data: result.data });
    }
  );

  // Status — public (no auth) for health checks
  app.get("/api/visa/status", async (_request, reply) => {
    const status = await visaService.testConnection();
    return reply.send({ success: true, ...status });
  });
}
