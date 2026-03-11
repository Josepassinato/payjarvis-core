import { prisma } from "@payjarvis/database";
import { createAuditLog } from "./audit.js";
import {
  recordSuccess,
  recordBlocked,
  recordFailed,
  recordAnomaly,
} from "./reputation.js";
import {
  trustScoreBotToAgent,
  trustScoreAgentToBot,
  TRUST_SCORE_MAX,
  TRUST_SCORE_MIN,
} from "@payjarvis/types";
import { syncAgentStatus } from "./agent-identity.js";

// ─── Agent-scale deltas (0-1000) ───

const AGENT_DELTAS: Record<string, number> = {
  auto_approved: 5,
  human_approved: 10,
  blocked_limit: -20,
  blocked_category: -30,
  blocked_merchant: -20,
  blocked_anomaly: -50,
  approval_timeout: -10,
  chargeback: -100,
};

const ANOMALY_RULES = new Set(["checkTimeWindow", "blocked_anomaly"]);

export function getAgentScoreDelta(
  decision: string,
  ruleTriggered: string | null,
  approvedByHuman: boolean
): number {
  if (decision === "APPROVED") {
    return approvedByHuman ? AGENT_DELTAS.human_approved : AGENT_DELTAS.auto_approved;
  }

  if (decision === "BLOCKED") {
    if (ruleTriggered === "checkCategory") return AGENT_DELTAS.blocked_category;
    if (ruleTriggered === "checkMerchant") return AGENT_DELTAS.blocked_merchant;
    if (ruleTriggered === "checkTimeWindow") return AGENT_DELTAS.blocked_anomaly;
    if (ruleTriggered === "approval_timeout") return AGENT_DELTAS.approval_timeout;
    return AGENT_DELTAS.blocked_limit;
  }

  return 0;
}

/** Legacy wrapper — returns bot-scale delta (0-100) */
export function getScoreDelta(
  decision: string,
  ruleTriggered: string | null,
  approvedByHuman: boolean
): number {
  const agentDelta = getAgentScoreDelta(decision, ruleTriggered, approvedByHuman);
  return agentDelta / 10; // agent→bot scale
}

/**
 * Compute reputation-adjusted trust score on the agent scale (0-1000).
 * Called every N transactions for drift correction.
 */
function computeReputationAdjustment(rep: {
  successfulTransactions: number;
  blockedTransactions: number;
  failedTransactions: number;
  chargebacks: number;
  anomalyEvents: number;
}): number {
  const total = rep.successfulTransactions + rep.blockedTransactions + rep.failedTransactions;
  if (total === 0) return 0;

  const successRate = rep.successfulTransactions / total;
  const chargebackPenalty = rep.chargebacks * 50;
  const anomalyPenalty = rep.anomalyEvents * 20;

  // Base reputation contribution: success rate maps to 0-200 range
  const reputationBonus = Math.round(successRate * 200) - chargebackPenalty - anomalyPenalty;
  return Math.max(-300, Math.min(200, reputationBonus));
}

/**
 * Update trust score for an agent (primary) and sync to its bot (legacy).
 *
 * This is the main entry point after a transaction decision.
 */
export async function updateTrustScore(
  botId: string,
  decision: string,
  ruleTriggered: string | null,
  approvedByHuman: boolean,
  actorId: string,
  transactionAmount?: number,
  merchantId?: string | null
): Promise<{ newScore: number; agentScore: number; suspended: boolean }> {
  const agentDelta = getAgentScoreDelta(decision, ruleTriggered, approvedByHuman);
  if (agentDelta === 0) return { newScore: -1, agentScore: -1, suspended: false };

  // ─── Resolve agent for this bot ───
  const agent = await prisma.agent.findUnique({ where: { botId } });
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) return { newScore: -1, agentScore: -1, suspended: false };

  const agentId = agent?.id;

  // ─── Update reputation metrics (agent-linked) ───
  if (agentId) {
    if (decision === "APPROVED") {
      await recordSuccess(agentId, transactionAmount ?? 0, merchantId ?? null);
    } else if (decision === "BLOCKED") {
      await recordBlocked(agentId);
      if (ruleTriggered && ANOMALY_RULES.has(ruleTriggered)) {
        await recordAnomaly(agentId, ruleTriggered, actorId);
      }
    }
  }

  // ─── Compute new agent trust score (0-1000) ───
  const oldAgentScore = agent?.trustScore ?? trustScoreBotToAgent(bot.trustScore);
  let newAgentScore = Math.max(
    TRUST_SCORE_MIN,
    Math.min(TRUST_SCORE_MAX, oldAgentScore + agentDelta)
  );

  // Reputation drift correction every 10 transactions
  if (agentId) {
    const rep = await prisma.agentReputation.findUnique({ where: { agentId } });
    if (rep) {
      const totalTx = rep.successfulTransactions + rep.blockedTransactions + rep.failedTransactions;
      if (totalTx > 0 && totalTx % 10 === 0) {
        const adjustment = computeReputationAdjustment(rep);
        const baseScore = 500;
        const reputationScore = baseScore + adjustment;
        // Blend: 60% delta-based, 40% reputation-based
        newAgentScore = Math.round(newAgentScore * 0.6 + reputationScore * 0.4);
        newAgentScore = Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, newAgentScore));
      }
    }
  }

  // ─── Convert to bot scale for backward compatibility ───
  const newBotScore = trustScoreAgentToBot(newAgentScore);
  const suspended = newAgentScore < 200; // CRITICAL threshold on agent scale

  // ─── Update agent record ───
  if (agent) {
    const agentUpdate: Record<string, unknown> = { trustScore: newAgentScore };
    if (suspended && agent.status === "ACTIVE") {
      agentUpdate.status = "SUSPENDED";
    }
    await prisma.agent.update({ where: { id: agent.id }, data: agentUpdate });
  }

  // ─── Update bot record (legacy) ───
  const botUpdate: Record<string, unknown> = { trustScore: newBotScore };
  if (suspended && bot.status === "ACTIVE") {
    botUpdate.status = "PAUSED";
  }
  await prisma.bot.update({ where: { id: botId }, data: botUpdate });

  // ─── Audit logs ───
  await createAuditLog({
    entityType: agentId ? "agent" : "bot",
    entityId: agentId ?? botId,
    action: "trust_score.changed",
    actorType: "system",
    actorId,
    payload: {
      oldScore: oldAgentScore,
      newScore: newAgentScore,
      botScore: newBotScore,
      delta: agentDelta,
      decision,
      ruleTriggered,
      suspended,
      scale: "agent_0_1000",
    },
  });

  if (suspended && (bot.status === "ACTIVE" || agent?.status === "ACTIVE")) {
    await createAuditLog({
      entityType: agentId ? "agent" : "bot",
      entityId: agentId ?? botId,
      action: agentId ? "agent.suspended" : "bot.suspended",
      actorType: "system",
      actorId,
      payload: { reason: "trust_score_below_threshold", agentScore: newAgentScore, botScore: newBotScore },
    });
  }

  return { newScore: newBotScore, agentScore: newAgentScore, suspended };
}
