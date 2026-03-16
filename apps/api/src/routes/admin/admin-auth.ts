/**
 * Admin Auth Routes — POST /admin/auth/login, POST /admin/auth/logout, GET /admin/auth/me
 */

import type { FastifyInstance } from "fastify";
import { login, logout, requireAdmin } from "../../services/admin-auth.service.js";

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post("/admin/auth/login", async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };
    if (!email || !password) {
      return reply.status(400).send({ success: false, error: "Email and password required" });
    }
    try {
      const result = await login(email, password);
      return reply.send({ success: true, ...result });
    } catch {
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }
  });

  app.post("/admin/auth/logout", { preHandler: [requireAdmin] }, async (request, reply) => {
    const token = (request as any).adminToken as string;
    await logout(token);
    return reply.send({ success: true });
  });

  app.get("/admin/auth/me", { preHandler: [requireAdmin] }, async (request, reply) => {
    return reply.send({ success: true, admin: (request as any).admin });
  });
}
