/**
 * Scheduled Tasks Routes — CRUD + internal manage endpoint for OpenClaw.
 */

import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  createScheduledTask,
  listScheduledTasks,
  pauseScheduledTask,
  resumeScheduledTask,
  deleteScheduledTask,
  editScheduledTask,
  inferAction,
  cronToHuman,
} from "../services/scheduled-tasks.service.js";

export async function scheduledTaskRoutes(app: FastifyInstance) {
  // ─── Internal endpoint for OpenClaw ───
  app.post("/api/scheduled-tasks/manage", async (request, reply) => {
    const secret = request.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const body = request.body as Record<string, unknown>;
    const action = (body.action as string) || "list";
    const userId = body.userId as string;
    const channel = (body.channel as string) || "telegram";
    const channelId = (body.channelId as string) || userId;

    try {
      switch (action) {
        case "create": {
          const desc = body.description as string;
          const schedule = body.schedule as string;
          if (!desc || !schedule) return reply.status(400).send({ error: "Need description and schedule." });
          const toolParams = body.toolParams ? JSON.parse(body.toolParams as string) : undefined;
          const { action: inferredAction, actionData } = inferAction(desc, body.toolToRun as string, toolParams);
          const lang = channelId.includes("+55") ? "pt" : "en";
          const task = await createScheduledTask({
            userId,
            description: desc,
            schedule,
            action: inferredAction,
            actionData,
            channel,
            channelId,
            language: lang,
          });
          const humanSchedule = cronToHuman(task.schedule, lang);
          return { success: true, taskId: task.id, schedule: humanSchedule, cronExpression: task.schedule, nextRun: task.nextRun?.toISOString() };
        }
        case "list": {
          const tasks = await listScheduledTasks(userId);
          if (tasks.length === 0) return { tasks: [], message: "No scheduled tasks." };
          return {
            tasks: tasks.map(t => ({
              id: t.id,
              description: t.description,
              schedule: cronToHuman(t.schedule, t.language),
              active: t.active,
              runCount: t.runCount,
              lastRun: t.lastRun?.toISOString(),
              nextRun: t.nextRun?.toISOString(),
            })),
          };
        }
        case "pause":
          await pauseScheduledTask(body.taskId as string, userId);
          return { success: true, message: "Task paused." };
        case "resume":
          await resumeScheduledTask(body.taskId as string, userId);
          return { success: true, message: "Task resumed." };
        case "delete":
          await deleteScheduledTask(body.taskId as string, userId);
          return { success: true, message: "Task deleted." };
        case "edit":
          await editScheduledTask(body.taskId as string, userId, {
            description: body.description as string,
            schedule: body.schedule as string,
          });
          return { success: true, message: "Task updated." };
        default:
          return reply.status(400).send({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ─── Authenticated endpoints for dashboard/web ───

  app.get("/api/scheduled-tasks", { preHandler: requireAuth }, async (request) => {
    const userId = (request as any).userId as string;
    const tasks = await listScheduledTasks(userId);
    return {
      tasks: tasks.map(t => ({
        id: t.id,
        description: t.description,
        action: t.action,
        schedule: t.schedule,
        scheduleHuman: cronToHuman(t.schedule, t.language),
        timezone: t.timezone,
        channel: t.channel,
        active: t.active,
        runCount: t.runCount,
        lastRun: t.lastRun,
        nextRun: t.nextRun,
        createdAt: t.createdAt,
      })),
    };
  });

  app.delete("/api/scheduled-tasks/:taskId", { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { taskId } = request.params as { taskId: string };
    const result = await deleteScheduledTask(taskId, userId);
    if (result.count === 0) return reply.status(404).send({ error: "Task not found" });
    return { success: true };
  });

  app.patch("/api/scheduled-tasks/:taskId/pause", { preHandler: requireAuth }, async (request) => {
    const userId = (request as any).userId as string;
    const { taskId } = request.params as { taskId: string };
    await pauseScheduledTask(taskId, userId);
    return { success: true };
  });

  app.patch("/api/scheduled-tasks/:taskId/resume", { preHandler: requireAuth }, async (request) => {
    const userId = (request as any).userId as string;
    const { taskId } = request.params as { taskId: string };
    await resumeScheduledTask(taskId, userId);
    return { success: true };
  });
}
