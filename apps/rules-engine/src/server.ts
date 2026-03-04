import Fastify from "fastify";
import cors from "@fastify/cors";
import type { RulesEngineRequest, RulesEngineResponse } from "@payjarvis/types";
import { DecisionEngine } from "./services/decision-engine.js";
import { prisma } from "@payjarvis/database";

const app = Fastify({ logger: true });
const engine = new DecisionEngine();

await app.register(cors, { origin: true });

// Health check
app.get("/health", async () => {
  return { status: "ok", service: "rules-engine" };
});

// Evaluate rules
app.post<{
  Body: RulesEngineRequest;
  Reply: RulesEngineResponse;
}>("/evaluate", async (request) => {
  const req = request.body;

  // Get spending totals from database
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [dailyResult, weeklyResult, monthlyResult] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        botId: req.botId,
        decision: "APPROVED",
        createdAt: { gte: startOfDay },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        botId: req.botId,
        decision: "APPROVED",
        createdAt: { gte: startOfWeek },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        botId: req.botId,
        decision: "APPROVED",
        createdAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    }),
  ]);

  const totals = {
    daily: dailyResult._sum.amount ?? 0,
    weekly: weeklyResult._sum.amount ?? 0,
    monthly: monthlyResult._sum.amount ?? 0,
  };

  return engine.evaluate(req, totals);
});

const port = parseInt(process.env.RULES_ENGINE_PORT ?? "3002", 10);

try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Rules engine listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
