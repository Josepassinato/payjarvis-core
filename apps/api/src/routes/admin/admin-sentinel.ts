/**
 * Admin Sentinel Routes — system health, incidents, fraud, infrastructure
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../services/admin-auth.service.js";
import { execSync } from "child_process";

const prisma = new PrismaClient();

function exec(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, { timeout }).toString().trim();
  } catch {
    return null;
  }
}

export async function adminSentinelRoutes(app: FastifyInstance) {
  // GET /admin/sentinel/status — real-time service status
  app.get("/admin/sentinel/status", { preHandler: [requireAdmin] }, async (_req, reply) => {
    const services = [
      { name: "payjarvis-api", port: 3001 },
      { name: "payjarvis-web", port: 3000 },
      { name: "payjarvis-admin", port: 3005 },
      { name: "openclaw", port: 4000 },
      { name: "payjarvis-kyc", port: 3004 },
      { name: "browser-agent", port: 3003 },
      { name: "payjarvis-rules", port: 3002 },
      { name: "sentinel", port: null },
    ];

    const pm2List = exec("pm2 jlist 2>/dev/null");
    let pm2Procs: any[] = [];
    try { pm2Procs = JSON.parse(pm2List || "[]"); } catch {}

    const results = services.map(svc => {
      const proc = pm2Procs.find((p: any) => p.name === svc.name);
      return {
        name: svc.name,
        status: proc?.pm2_env?.status || "unknown",
        uptime: proc?.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
        restarts: proc?.pm2_env?.restart_time || 0,
        memory: proc?.monit?.memory || 0,
        cpu: proc?.monit?.cpu || 0,
        pid: proc?.pid || null,
      };
    });

    // Overall status
    const allOnline = results.every(r => r.status === "online" || r.status === "unknown");
    const overall = allOnline ? "healthy" : "degraded";

    reply.send({ overall, services: results });
  });

  // GET /admin/sentinel/incidents
  app.get("/admin/sentinel/incidents", { preHandler: [requireAdmin] }, async (req, reply) => {
    const q = (req as any).query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1"));
    const limit = Math.min(100, parseInt(q.limit || "50"));
    const status = q.status || undefined;

    const where: any = {};
    if (status) where.status = status;

    const [incidents, total] = await Promise.all([
      prisma.sentinelIncident.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sentinelIncident.count({ where }),
    ]);

    reply.send({ incidents, total, page, limit });
  });

  // PUT /admin/sentinel/incidents/:id
  app.put("/admin/sentinel/incidents/:id", { preHandler: [requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string; fixDetails?: string };

    const data: any = { updatedAt: new Date() };
    if (body.status) data.status = body.status;
    if (body.fixDetails) data.fixDetails = body.fixDetails;
    if (body.status === "resolved") data.resolvedAt = new Date();

    const incident = await prisma.sentinelIncident.update({ where: { id }, data });
    reply.send({ incident });
  });

  // GET /admin/sentinel/logs
  app.get("/admin/sentinel/logs", { preHandler: [requireAdmin] }, async (req, reply) => {
    const q = (req as any).query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1"));
    const limit = Math.min(100, parseInt(q.limit || "50"));

    const [logs, total] = await Promise.all([
      prisma.sentinelLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sentinelLog.count(),
    ]);

    reply.send({ logs, total, page, limit });
  });

  // GET /admin/sentinel/fraud
  app.get("/admin/sentinel/fraud", { preHandler: [requireAdmin] }, async (req, reply) => {
    const q = (req as any).query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1"));
    const limit = Math.min(100, parseInt(q.limit || "50"));
    const status = q.status || undefined;
    const severity = q.severity || undefined;

    const where: any = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;

    const [alerts, total] = await Promise.all([
      prisma.fraudAlert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.fraudAlert.count({ where }),
    ]);

    reply.send({ alerts, total, page, limit });
  });

  // PUT /admin/sentinel/fraud/:id
  app.put("/admin/sentinel/fraud/:id", { preHandler: [requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string };

    const data: any = { updatedAt: new Date() };
    if (body.status) data.status = body.status;
    if (body.status === "resolved" || body.status === "false_positive") data.resolvedAt = new Date();

    const alert = await prisma.fraudAlert.update({ where: { id }, data });
    reply.send({ alert });
  });

  // GET /admin/sentinel/financial — credit consistency for all users
  app.get("/admin/sentinel/financial", { preHandler: [requireAdmin] }, async (_req, reply) => {
    try {
      const users = await prisma.$queryRaw`
        SELECT u.id, u.email, u."firstName", u."lastName",
               lc."messagesTotal", lc."messagesUsed", lc."messagesRemaining",
               CASE WHEN lc."messagesUsed" + lc."messagesRemaining" = lc."messagesTotal"
                    THEN 'OK' ELSE 'INCONSISTENT' END as status
        FROM "User" u
        JOIN "LlmCredit" lc ON lc."userId" = u.id
        ORDER BY CASE WHEN lc."messagesUsed" + lc."messagesRemaining" != lc."messagesTotal" THEN 0 ELSE 1 END,
                 u."createdAt" DESC
        LIMIT 200
      `;
      reply.send({ users });
    } catch (e: any) {
      reply.send({ users: [], error: e.message });
    }
  });

  // POST /admin/sentinel/services/:name/restart
  app.post("/admin/sentinel/services/:name/restart", { preHandler: [requireAdmin] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const allowed = ["payjarvis-api", "payjarvis-web", "payjarvis-admin", "openclaw", "payjarvis-kyc", "browser-agent", "payjarvis-rules", "sentinel"];
    if (!allowed.includes(name)) {
      return reply.status(400).send({ error: "Service not allowed" });
    }

    const result = exec(`pm2 restart ${name} 2>&1`, 15000);
    const success = result !== null && !result.includes("error");

    reply.send({ success, service: name, output: result?.substring(0, 500) });
  });

  // GET /admin/sentinel/infra — real-time CPU/memory/disk
  app.get("/admin/sentinel/infra", { preHandler: [requireAdmin] }, async (_req, reply) => {
    const disk = parseInt(exec("df / | tail -1 | awk '{print $5}' | tr -d '%'") || "0");
    const memory = parseInt(exec("free | grep Mem | awk '{print int($3/$2 * 100)}'") || "0");
    const cpu = parseInt(exec("top -bn1 | grep 'Cpu(s)' | awk '{print int($2)}'") || "0");
    const uptime = exec("uptime -p") || "unknown";
    const loadAvg = exec("cat /proc/loadavg | cut -d' ' -f1-3") || "0 0 0";

    reply.send({ disk, memory, cpu, uptime, loadAvg });
  });
}
