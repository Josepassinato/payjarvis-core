import { evaluatePolicy } from "./policy-engine.js";
import { requestApproval } from "./approval-manager.js";
import { logEvent, AuditEvents } from "./audit-logger.js";

// ─── Types ───

export type ActionType = "SEARCH" | "PURCHASE" | "BOOK" | "RESERVE" | "SEND" | "READ";

export interface ActionRequest {
  botId: string;
  userId: string;
  type: ActionType;
  provider: string;
  layer: 1 | 2 | 3 | 4;
  params: Record<string, unknown>;
  estimatedCost?: number;
  // Fields for approval flow
  merchantName?: string;
  merchantId?: string;
  category?: string;
  transactionId?: string;
  agentId?: string;
}

export interface ActionResult {
  allowed: boolean;
  reason?: string;
  proceed?: boolean;
  awaitingApproval?: boolean;
  approvalId?: string;
  expiresAt?: Date;
}

// Read-only action types that skip policy evaluation
const READ_ONLY_TYPES: Set<ActionType> = new Set(["SEARCH", "READ"]);

/**
 * Central execution point — EVERY action goes through here.
 *
 * Flow:
 * 1. Log BOT_ACTION_REQUESTED
 * 2. If SEARCH/READ → skip policy, return allowed
 * 3. Evaluate policy
 * 4. If requiresApproval → create approval request
 * 5. If denied → return denied
 * 6. If allowed → return proceed
 * 7. Log POLICY_DECISION
 */
export async function execute(request: ActionRequest): Promise<ActionResult> {
  // 1. Log the action request
  await logEvent({
    botId: request.botId,
    userId: request.userId,
    event: AuditEvents.BOT_ACTION_REQUESTED,
    layer: request.layer,
    payload: {
      type: request.type,
      provider: request.provider,
      estimatedCost: request.estimatedCost,
      params: request.params,
    },
  });

  // 2. Read-only actions skip policy
  if (READ_ONLY_TYPES.has(request.type)) {
    await logEvent({
      botId: request.botId,
      event: AuditEvents.POLICY_DECISION,
      layer: request.layer,
      payload: {
        type: request.type,
        decision: "allowed",
        reason: "Read-only action — no policy check required",
      },
    });

    return { allowed: true, proceed: true };
  }

  // 3. Evaluate policy
  const decision = await evaluatePolicy(request.botId, {
    type: request.type,
    amount: request.estimatedCost,
    category: request.category,
    merchantId: request.merchantId,
    provider: request.provider,
  });

  // 4. Requires approval
  if (decision.allowed && decision.requiresApproval) {
    if (!request.transactionId) {
      return { allowed: false, reason: "Transaction ID required for approval flow" };
    }

    const approval = await requestApproval(request.botId, request.userId, {
      type: request.type,
      amount: request.estimatedCost ?? 0,
      merchantName: request.merchantName ?? "Unknown",
      category: request.category ?? "general",
      transactionId: request.transactionId,
      merchantId: request.merchantId,
    });

    await logEvent({
      botId: request.botId,
      event: AuditEvents.POLICY_DECISION,
      layer: request.layer,
      payload: {
        type: request.type,
        decision: "awaiting_approval",
        approvalId: approval.approvalId,
        amount: request.estimatedCost,
      },
    });

    return {
      allowed: true,
      awaitingApproval: true,
      approvalId: approval.approvalId,
      expiresAt: approval.expiresAt,
    };
  }

  // 5. Denied
  if (!decision.allowed) {
    await logEvent({
      botId: request.botId,
      event: AuditEvents.POLICY_DECISION,
      layer: request.layer,
      payload: {
        type: request.type,
        decision: "denied",
        reason: decision.reason,
        amount: request.estimatedCost,
      },
    });

    return { allowed: false, reason: decision.reason };
  }

  // 6. Allowed — proceed
  await logEvent({
    botId: request.botId,
    event: AuditEvents.POLICY_DECISION,
    layer: request.layer,
    payload: {
      type: request.type,
      decision: "allowed",
      reason: decision.reason,
      amount: request.estimatedCost,
    },
  });

  return { allowed: true, proceed: true };
}
