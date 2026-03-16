/**
 * Admin Broadcast Routes — create, list, send, schedule broadcasts.
 */

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../services/admin-auth.service.js";
import { getRecipientCount, sendBroadcast, scheduleBroadcast } from "../../services/broadcast.service.js";

const prisma = new PrismaClient();

export async function adminBroadcastRoutes(app: FastifyInstance) {
  // GET /admin/broadcasts — list all
  app.get("/admin/broadcasts", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const broadcasts = await prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send({ success: true, broadcasts });
  });

  // POST /admin/broadcasts — create new
  app.post("/admin/broadcasts", { preHandler: [requireAdmin] }, async (request, reply) => {
    const admin = (request as any).admin;
    const { title, message, imageUrl, audience } = request.body as {
      title: string; message: string; imageUrl?: string; audience?: string;
    };

    if (!title || !message) {
      return reply.status(400).send({ success: false, error: "Title and message required" });
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        title,
        message,
        imageUrl: imageUrl || null,
        audience: audience || "all",
        createdBy: admin.id,
      },
    });
    return reply.send({ success: true, broadcast });
  });

  // GET /admin/broadcasts/:id — details + metrics
  app.get("/admin/broadcasts/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const broadcast = await prisma.broadcast.findUnique({
      where: { id },
      include: {
        logs: { orderBy: { sentAt: "desc" }, take: 100 },
      },
    });
    if (!broadcast) return reply.status(404).send({ success: false, error: "Not found" });
    return reply.send({ success: true, broadcast });
  });

  // POST /admin/broadcasts/:id/send — send immediately
  app.post("/admin/broadcasts/:id/send", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // Fire and forget — returns immediately, sends in background
      sendBroadcast(id).catch((err) => console.error("Broadcast send error:", err));
      return reply.send({ success: true, message: "Broadcast sending started" });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // POST /admin/broadcasts/:id/schedule — schedule for later
  app.post("/admin/broadcasts/:id/schedule", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { scheduledAt } = request.body as { scheduledAt: string };
    if (!scheduledAt) {
      return reply.status(400).send({ success: false, error: "scheduledAt required" });
    }
    await scheduleBroadcast(id, new Date(scheduledAt));
    return reply.send({ success: true, message: "Broadcast scheduled" });
  });

  // DELETE /admin/broadcasts/:id — cancel draft
  app.delete("/admin/broadcasts/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const broadcast = await prisma.broadcast.findUnique({ where: { id } });
    if (!broadcast) return reply.status(404).send({ success: false, error: "Not found" });
    if (broadcast.status !== "draft") {
      return reply.status(400).send({ success: false, error: "Can only delete drafts" });
    }
    await prisma.broadcast.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // GET /admin/broadcasts/preview?audience=X — recipient count
  app.get("/admin/broadcasts/preview", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { audience } = request.query as { audience?: string };
    const count = await getRecipientCount(audience || "all");
    return reply.send({ success: true, audience: audience || "all", recipientCount: count });
  });
}
