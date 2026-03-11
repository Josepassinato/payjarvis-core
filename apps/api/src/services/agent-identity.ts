import { prisma } from "@payjarvis/database";
import { createAuditLog } from "./audit.js";
import { getRiskLevel, TRUST_SCORE_DEFAULT } from "@payjarvis/types";
import { createId } from "@paralleldrive/cuid2";

/**
 * Generate an agent ID with the ag_ prefix.
 */
function generateAgentId(): string {
  return `ag_${createId()}`;
}

/**
 * Create an Agent Identity record linked to a Bot.
 * Called automatically when a new bot is created.
 */
export async function createAgent(
  botId: string,
  ownerId: string,
  name: string,
  kycLevel: string = "NONE"
): Promise<{ id: string }> {
  const agentId = generateAgentId();

  const agent = await prisma.agent.create({
    data: {
      id: agentId,
      botId,
      ownerId,
      name,
      kycLevel: kycLevel as any,
      trustScore: TRUST_SCORE_DEFAULT,
    },
  });

  // Auto-create empty reputation record
  await prisma.agentReputation.create({
    data: { agentId: agent.id },
  });

  await createAuditLog({
    entityType: "agent",
    entityId: agent.id,
    action: "agent.created",
    actorType: "system",
    actorId: ownerId,
    payload: { botId, name, kycLevel },
  });

  return agent;
}

/**
 * Resolve a bot ID to its agent. Returns null if no agent exists (legacy bot).
 */
export async function getAgentByBotId(botId: string) {
  return prisma.agent.findUnique({
    where: { botId },
    include: { reputation: true },
  });
}

/**
 * Get agent by its ag_ prefixed ID.
 */
export async function getAgentById(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    include: { reputation: true, owner: { select: { kycLevel: true, status: true } } },
  });
}

/**
 * Lightweight lookup: bot ID → agent ID.
 */
export async function resolveAgentId(botId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { botId },
    select: { id: true },
  });
  return agent?.id ?? null;
}

/**
 * Public verification endpoint data.
 * Returns agent identity + reputation summary for merchants.
 */
export async function verifyAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      reputation: true,
      owner: { select: { kycLevel: true, status: true } },
    },
  });

  if (!agent) return null;

  const kycLevelNum = kycLevelToNumber(agent.kycLevel);

  return {
    agent_id: agent.id,
    owner_verified: agent.owner.status === "ACTIVE" && kycLevelNum >= 1,
    trust_score: agent.trustScore,
    transactions: agent.transactionsCount,
    total_spent: Math.round(agent.totalSpent * 100) / 100,
    risk_level: getRiskLevel(agent.trustScore),
    kyc_level: kycLevelNum,
    status: agent.status,
    created_at: agent.createdAt.toISOString(),
  };
}

/**
 * Update agent aggregate counters after a transaction.
 */
export async function updateAgentCounters(
  agentId: string,
  decision: string,
  amount: number
): Promise<void> {
  const data: Record<string, unknown> = {
    lastActivityAt: new Date(),
    transactionsCount: { increment: 1 },
  };

  if (decision === "APPROVED") {
    data.totalSpent = { increment: amount };
  }

  await prisma.agent.update({
    where: { id: agentId },
    data,
  });
}

/**
 * Sync agent status with bot status.
 */
export async function syncAgentStatus(botId: string, newStatus: string): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { botId } });
  if (!agent) return;

  const statusMap: Record<string, string> = {
    ACTIVE: "ACTIVE",
    PAUSED: "SUSPENDED",
    REVOKED: "REVOKED",
  };

  const agentStatus = statusMap[newStatus] ?? "ACTIVE";

  await prisma.agent.update({
    where: { id: agent.id },
    data: { status: agentStatus as any },
  });
}

/**
 * Migrate an existing bot to have an agent identity.
 * Idempotent — skips if agent already exists.
 */
export async function ensureAgentForBot(botId: string): Promise<string | null> {
  const existing = await prisma.agent.findUnique({ where: { botId } });
  if (existing) return existing.id;

  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: { owner: { select: { kycLevel: true } } },
  });
  if (!bot) return null;

  const agent = await createAgent(botId, bot.ownerId, bot.name, bot.owner.kycLevel);
  return agent.id;
}

function kycLevelToNumber(level: string): number {
  const map: Record<string, number> = { NONE: 0, BASIC: 1, VERIFIED: 2, ENHANCED: 3 };
  return map[level] ?? 0;
}
