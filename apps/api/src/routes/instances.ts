/**
 * Instance Management Routes
 *
 * Manages OpenClaw instances: status, assignment, spawning, despawning.
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  getInstanceStatus,
  assignUserToInstance,
  removeUserFromInstance,
  getUserInstance,
  spawnInstance,
  despawnInstance,
  deactivateInstance,
  checkAndSpawn,
  isInstanceFull,
  routeUser,
  getRouteForBot,
} from "../services/instance-manager.js";

export async function instanceRoutes(app: FastifyInstance) {
  // ── GET /instances — List all instances with load info ──
  app.get("/api/instances", { preHandler: [requireAuth] }, async () => {
    const instances = await getInstanceStatus();

    const totalCapacity = instances.reduce((sum, i) => sum + i.capacity, 0);
    const totalUsers = instances.reduce((sum, i) => sum + i.currentLoad, 0);
    const utilizationPct = totalCapacity > 0
      ? Math.round((totalUsers / totalCapacity) * 1000) / 10
      : 0;

    return {
      instances: instances.map((i) => ({
        name: i.name,
        load: i.currentLoad,
        capacity: i.capacity,
        status: i.status,
      })),
      totalUsers,
      totalCapacity,
      utilizationPct,
    };
  });

  // ── GET /instances/my — Get current user's assigned instance ──
  app.get("/api/instances/my", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { prisma } = await import("@payjarvis/database");
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const instance = await getUserInstance(user.id);

    if (!instance) {
      return { success: true, data: null, message: "No instance assigned" };
    }

    return { success: true, data: instance };
  });

  // ── POST /instances/assign — Assign current user to an instance ──
  app.post("/api/instances/assign", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { prisma } = await import("@payjarvis/database");
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const result = await assignUserToInstance(user.id);

    if (!result.success) {
      return reply.status(503).send({ success: false, error: result.error });
    }

    return {
      success: true,
      data: {
        instanceId: result.instanceId,
        instanceName: result.instanceName,
        port: result.port,
        spawned: result.spawned,
      },
    };
  });

  // ── DELETE /instances/my — Remove current user from instance (release slot) ──
  app.delete("/api/instances/my", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { prisma } = await import("@payjarvis/database");
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const removed = await removeUserFromInstance(user.id);

    return { success: true, removed };
  });

  // ── POST /instances/spawn — Manually spawn a new instance ──
  app.post("/api/instances/spawn", { preHandler: [requireAuth] }, async (request, reply) => {
    const { capacity } = (request.body as { capacity?: number }) || {};

    const result = await spawnInstance({ capacity });

    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    return {
      success: true,
      data: {
        instanceId: result.instanceId,
        name: result.name,
        port: result.port,
        processName: result.processName,
        dir: result.dir,
      },
    };
  });

  // ── DELETE /instances/:id — Despawn an instance (remove if empty) ──
  app.delete("/api/instances/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await despawnInstance(id);

    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    return { success: true, message: "Instance despawned and removed" };
  });

  // ── POST /instances/:id/deactivate — Take an instance offline (keep files) ──
  app.post("/api/instances/:id/deactivate", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const deactivated = await deactivateInstance(id);

    if (!deactivated) {
      return reply.status(404).send({ success: false, error: "Instance not found" });
    }

    return { success: true, message: `Instance ${id} deactivated` };
  });

  // ── GET /instances/:id/full — Check if instance is full ──
  app.get("/api/instances/:id/full", { preHandler: [requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    const full = await isInstanceFull(id);
    return { success: true, full };
  });

  // ── GET /instances/route — Route current user to their instance endpoint ──
  app.get("/api/instances/route", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { prisma } = await import("@payjarvis/database");
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const result = await routeUser(user.id);

    if (!result.success) {
      return reply.status(503).send({ success: false, error: result.error });
    }

    return { success: true, data: result.route };
  });

  // ── GET /instances/route/bot/:botId — Get endpoint for a specific bot ──
  app.get("/api/instances/route/bot/:botId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { botId } = request.params as { botId: string };

    const result = await getRouteForBot(botId);

    if (!result.success) {
      return reply.status(404).send({ success: false, error: result.error });
    }

    return {
      success: true,
      data: {
        endpoint: result.endpoint,
        instanceName: result.instanceName,
        port: result.port,
      },
    };
  });

  // ── GET /instances/capacity — Check capacity and auto-spawn if all >= 90% ──
  app.get("/api/instances/capacity", { preHandler: [requireAuth] }, async () => {
    const result = await checkAndSpawn();
    return { success: true, data: result };
  });
}
