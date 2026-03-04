import { prisma } from "@payjarvis/database";
import { createAuditLog } from "./audit.js";

interface TrustScoreChange {
  botId: string;
  reason: string;
  delta: number;
  ruleTriggered?: string;
}

const SCORE_DELTAS: Record<string, number> = {
  "auto_approved": 0.5,
  "human_approved": 1.0,
  "blocked_limit": -2.0,
  "blocked_category": -3.0,
  "blocked_merchant": -2.0,
  "blocked_anomaly": -5.0,
};

export function getScoreDelta(decision: string, ruleTriggered: string | null, approvedByHuman: boolean): TrustScoreChange["delta"] {
  if (decision === "APPROVED") {
    return approvedByHuman ? SCORE_DELTAS.human_approved : SCORE_DELTAS.auto_approved;
  }

  if (decision === "BLOCKED") {
    if (ruleTriggered === "checkCategory") return SCORE_DELTAS.blocked_category;
    if (ruleTriggered === "checkMerchant") return SCORE_DELTAS.blocked_merchant;
    if (ruleTriggered === "checkTimeWindow") return SCORE_DELTAS.blocked_anomaly;
    if (ruleTriggered === "approval_timeout") return -1.0; // Expiration penalty
    return SCORE_DELTAS.blocked_limit;
  }

  return 0;
}

export async function updateTrustScore(
  botId: string,
  decision: string,
  ruleTriggered: string | null,
  approvedByHuman: boolean,
  actorId: string
): Promise<{ newScore: number; suspended: boolean }> {
  const delta = getScoreDelta(decision, ruleTriggered, approvedByHuman);
  if (delta === 0) return { newScore: -1, suspended: false };

  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) return { newScore: -1, suspended: false };

  const oldScore = bot.trustScore;
  const newScore = Math.max(0, Math.min(100, oldScore + delta));
  const suspended = newScore < 20;

  const updateData: Record<string, unknown> = { trustScore: newScore };
  if (suspended && bot.status === "ACTIVE") {
    updateData.status = "PAUSED";
  }

  await prisma.bot.update({
    where: { id: botId },
    data: updateData,
  });

  await createAuditLog({
    entityType: "bot",
    entityId: botId,
    action: "trust_score.changed",
    actorType: "system",
    actorId,
    payload: {
      oldScore,
      newScore,
      delta,
      decision,
      ruleTriggered,
      suspended,
    },
  });

  if (suspended && bot.status === "ACTIVE") {
    await createAuditLog({
      entityType: "bot",
      entityId: botId,
      action: "bot.suspended",
      actorType: "system",
      actorId,
      payload: { reason: "trust_score_below_threshold", trustScore: newScore },
    });
  }

  return { newScore, suspended };
}
