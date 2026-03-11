import { prisma } from "@payjarvis/database";
import { createAuditLog } from "./audit.js";

export interface ReputationData {
  successfulTransactions: number;
  blockedTransactions: number;
  failedTransactions: number;
  chargebacks: number;
  anomalyEvents: number;
  merchantCount: number;
  totalSpent: number;
  averageTransaction: number;
  lastTransactionAt: string | null;
  trustScore: number;          // 0-1000 agent scale
}

/**
 * Record a successful transaction in the agent's reputation.
 */
export async function recordSuccess(
  agentId: string,
  amount: number,
  merchantId: string | null
): Promise<void> {
  const rep = await ensureReputation(agentId);

  const merchants = rep.merchants as string[];
  const newMerchants = merchantId && !merchants.includes(merchantId)
    ? [...merchants, merchantId]
    : merchants;

  const newSuccessCount = rep.successfulTransactions + 1;
  const newTotalSpent = rep.totalSpent + amount;
  const newAvg = newTotalSpent / newSuccessCount;

  await prisma.agentReputation.update({
    where: { agentId },
    data: {
      successfulTransactions: newSuccessCount,
      totalSpent: newTotalSpent,
      merchants: newMerchants,
      merchantCount: newMerchants.length,
      averageTransaction: Math.round(newAvg * 100) / 100,
      lastTransactionAt: new Date(),
    },
  });
}

/**
 * Record a blocked transaction in the agent's reputation.
 */
export async function recordBlocked(agentId: string): Promise<void> {
  await ensureReputation(agentId);

  await prisma.agentReputation.update({
    where: { agentId },
    data: {
      blockedTransactions: { increment: 1 },
      lastTransactionAt: new Date(),
    },
  });
}

/**
 * Record a failed transaction (e.g. payment failed after approval).
 */
export async function recordFailed(agentId: string): Promise<void> {
  await ensureReputation(agentId);

  await prisma.agentReputation.update({
    where: { agentId },
    data: {
      failedTransactions: { increment: 1 },
      lastTransactionAt: new Date(),
    },
  });
}

/**
 * Record a chargeback event.
 */
export async function recordChargeback(agentId: string, actorId: string): Promise<void> {
  await ensureReputation(agentId);

  await prisma.agentReputation.update({
    where: { agentId },
    data: {
      chargebacks: { increment: 1 },
      lastTransactionAt: new Date(),
    },
  });

  await createAuditLog({
    entityType: "agent",
    entityId: agentId,
    action: "reputation.chargeback",
    actorType: "system",
    actorId,
    payload: {},
  });
}

/**
 * Record an anomaly event (time window violation, spending spike, etc.)
 */
export async function recordAnomaly(
  agentId: string,
  anomalyType: string,
  actorId: string
): Promise<void> {
  const rep = await ensureReputation(agentId);

  await prisma.agentReputation.update({
    where: { agentId },
    data: {
      anomalyEvents: rep.anomalyEvents + 1,
      lastTransactionAt: new Date(),
    },
  });

  await createAuditLog({
    entityType: "agent",
    entityId: agentId,
    action: "reputation.anomaly",
    actorType: "system",
    actorId,
    payload: { anomalyType, totalAnomalies: rep.anomalyEvents + 1 },
  });
}

/**
 * Get the full reputation data for an agent.
 */
export async function getReputation(agentId: string): Promise<ReputationData | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { trustScore: true },
  });
  if (!agent) return null;

  const rep = await ensureReputation(agentId);

  return {
    successfulTransactions: rep.successfulTransactions,
    blockedTransactions: rep.blockedTransactions,
    failedTransactions: rep.failedTransactions,
    chargebacks: rep.chargebacks,
    anomalyEvents: rep.anomalyEvents,
    merchantCount: rep.merchantCount,
    totalSpent: Math.round(rep.totalSpent * 100) / 100,
    averageTransaction: rep.averageTransaction,
    lastTransactionAt: rep.lastTransactionAt?.toISOString() ?? null,
    trustScore: agent.trustScore,
  };
}

/**
 * Ensure a reputation record exists for the agent, creating one if needed.
 */
async function ensureReputation(agentId: string) {
  let rep = await prisma.agentReputation.findUnique({ where: { agentId } });
  if (!rep) {
    rep = await prisma.agentReputation.create({
      data: { agentId },
    });
  }
  return rep;
}
