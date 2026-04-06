/**
 * Custom Services Routes — Self-configuration API
 *
 * Allows Sniffer to register, list, delete external APIs
 * and execute requests against them.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  configureService,
  listServices,
  deleteService,
  executeApiRequest,
  configureAutomation,
  listAutomations,
  runAutomation,
  deleteAutomation,
} from "../services/integrations/custom-api.service.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

function checkSecret(request: FastifyRequest, reply: FastifyReply): boolean {
  const secret = request.headers["x-internal-secret"] as string;
  if (secret !== INTERNAL_SECRET) {
    reply.status(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export async function customServicesRoutes(app: FastifyInstance) {
  // ─── Service Configuration ─────────────────────────

  app.post("/api/services/configure", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const body = request.body as {
      userId: string;
      name: string;
      displayName?: string;
      baseUrl: string;
      authType?: string;
      credentials?: string;
      headersTemplate?: Record<string, string>;
      description?: string;
    };
    if (!body.userId || !body.name || !body.baseUrl) {
      return reply.status(400).send({ error: "Missing userId, name, or baseUrl" });
    }
    const result = await configureService({
      userId: body.userId,
      name: body.name,
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      authType: (body.authType as "bearer" | "basic" | "api_key" | "header" | "query" | "none") || "bearer",
      credentials: body.credentials,
      headersTemplate: body.headersTemplate,
      description: body.description,
    });
    return reply.send(result);
  });

  app.get("/api/services/list", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const { userId } = request.query as { userId: string };
    if (!userId) return reply.status(400).send({ error: "Missing userId" });
    return reply.send(await listServices(userId));
  });

  app.delete("/api/services/:name", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const { name } = request.params as { name: string };
    const { userId } = request.query as { userId: string };
    if (!userId) return reply.status(400).send({ error: "Missing userId" });
    return reply.send(await deleteService(userId, name));
  });

  // ─── API Request Execution ─────────────────────────

  app.post("/api/services/execute", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const body = request.body as {
      userId: string;
      serviceName?: string;
      url?: string;
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      body?: unknown;
      queryParams?: Record<string, string>;
      timeout?: number;
    };
    if (!body.userId) return reply.status(400).send({ error: "Missing userId" });
    if (!body.serviceName && !body.url) return reply.status(400).send({ error: "Missing serviceName or url" });

    const result = await executeApiRequest({
      userId: body.userId,
      serviceName: body.serviceName,
      url: body.url,
      method: body.method,
      path: body.path,
      headers: body.headers,
      body: body.body,
      queryParams: body.queryParams,
      timeout: body.timeout,
    });
    return reply.send(result);
  });

  // ─── Automations ───────────────────────────────────

  app.post("/api/services/automations/configure", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const body = request.body as {
      userId: string;
      name: string;
      description?: string;
      serviceName?: string;
      triggerType?: string;
      schedule?: string;
      actionMethod?: string;
      actionPath?: string;
      actionBody?: unknown;
      postProcess?: string;
    };
    if (!body.userId || !body.name) return reply.status(400).send({ error: "Missing userId or name" });
    const result = await configureAutomation({
      userId: body.userId,
      name: body.name,
      description: body.description,
      serviceName: body.serviceName,
      triggerType: (body.triggerType as "schedule" | "manual") || "manual",
      schedule: body.schedule,
      actionMethod: body.actionMethod,
      actionPath: body.actionPath,
      actionBody: body.actionBody,
      postProcess: body.postProcess,
    });
    return reply.send(result);
  });

  app.get("/api/services/automations/list", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const { userId } = request.query as { userId: string };
    if (!userId) return reply.status(400).send({ error: "Missing userId" });
    return reply.send(await listAutomations(userId));
  });

  app.post("/api/services/automations/run", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const { userId, name } = request.body as { userId: string; name: string };
    if (!userId || !name) return reply.status(400).send({ error: "Missing userId or name" });
    return reply.send(await runAutomation(userId, name));
  });

  app.delete("/api/services/automations/:name", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkSecret(request, reply)) return;
    const { name } = request.params as { name: string };
    const { userId } = request.query as { userId: string };
    if (!userId) return reply.status(400).send({ error: "Missing userId" });
    return reply.send(await deleteAutomation(userId, name));
  });
}
