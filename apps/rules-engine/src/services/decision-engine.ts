import type {
  RulesEngineRequest,
  RulesEngineResponse,
  RuleEvaluation,
} from "@payjarvis/types";
import { TRUST_THRESHOLD_HUMAN } from "@payjarvis/types";
import {
  checkTransactionLimit,
  checkDailyLimit,
  checkWeeklyLimit,
  checkMonthlyLimit,
  checkCategory,
  checkMerchant,
  checkTimeWindow,
} from "../rules/index.js";

interface SpendingTotals {
  daily: number;
  weekly: number;
  monthly: number;
}

/**
 * DecisionEngine — evaluates a payment request against owner-defined policy.
 *
 * ─── ARCHITECTURAL INVARIANT ──────────────────────────────────────────
 *   "Mandate grants authority, reputation informs only."
 *
 *   evaluate() runs in two phases:
 *
 *     Phase 1 — evaluateMandate()
 *       Mandate-only rules: amount limits, category, merchant, time window,
 *       daily/weekly/monthly totals. Outputs APPROVED, BLOCKED, or
 *       PENDING_HUMAN (only when amount thresholds require approval).
 *       This phase NEVER reads reputation/trust scores.
 *
 *     Phase 2 — applyReputationRouting()
 *       May DEMOTE an APPROVED to PENDING_HUMAN when reputation is low.
 *       Cannot promote BLOCKED to APPROVED. Cannot demote APPROVED to
 *       BLOCKED. Reputation is informational routing only.
 *
 *   Concordia stack v0.5.0 mapping: BDIT lives in Settlement; Reputation
 *   Attestations live in the Trust layer (one above). Reputation feeds
 *   the Agreement layer's decision to grant a mandate, but does NOT
 *   cross down into Settlement as authority. This is the structural
 *   reason BLOCKED-by-reputation is removed from this engine.
 * ──────────────────────────────────────────────────────────────────────
 */
export class DecisionEngine {
  evaluate(
    request: RulesEngineRequest,
    totals: SpendingTotals
  ): RulesEngineResponse {
    // Phase 1 — mandate-only evaluation. Reputation is intentionally
    // not in scope; this method ignores agentTrustScore / botTrustScore.
    const mandateResult = this.evaluateMandate(request, totals);

    // Mandate violation: reputation cannot rescue. Return as-is.
    if (mandateResult.decision === "BLOCKED") {
      return mandateResult;
    }

    // Phase 2 — reputation routing on top of a valid mandate. Demote-only.
    return this.applyReputationRouting(mandateResult, request);
  }

  /**
   * Phase 1: evaluate mandate claims + runtime context. NEVER reads
   * reputation/trust fields.
   */
  private evaluateMandate(
    request: RulesEngineRequest,
    totals: SpendingTotals
  ): RulesEngineResponse {
    const evaluatedRules: RuleEvaluation[] = [];

    evaluatedRules.push(checkTransactionLimit(request.amount, request.policy));
    evaluatedRules.push(checkDailyLimit(request.amount, totals.daily, request.policy));
    evaluatedRules.push(checkWeeklyLimit(request.amount, totals.weekly, request.policy));
    evaluatedRules.push(checkMonthlyLimit(request.amount, totals.monthly, request.policy));
    evaluatedRules.push(checkCategory(request.category, request.policy));
    evaluatedRules.push(checkMerchant(request.merchantId, request.policy));
    evaluatedRules.push(checkTimeWindow(request.policy));

    const failedRule = evaluatedRules.find((r) => !r.passed);
    if (failedRule) {
      return {
        decision: "BLOCKED",
        reason: failedRule.reason,
        ruleTriggered: failedRule.rule,
        evaluatedRules,
      };
    }

    // Amount-based human review thresholds — still mandate territory
    // (these are owner-policy thresholds, not reputation gating).
    if (request.amount > request.policy.requireApprovalUp) {
      return {
        decision: "PENDING_HUMAN",
        reason: `Amount ${request.amount} exceeds human approval threshold of ${request.policy.requireApprovalUp}`,
        ruleTriggered: "requireApprovalUp",
        evaluatedRules,
      };
    }
    if (request.amount > request.policy.autoApproveLimit) {
      return {
        decision: "PENDING_HUMAN",
        reason: `Amount ${request.amount} exceeds auto-approve limit of ${request.policy.autoApproveLimit}`,
        ruleTriggered: "autoApproveLimit",
        evaluatedRules,
      };
    }

    return {
      decision: "APPROVED",
      reason: "All mandate rules passed and amount within auto-approve limit",
      ruleTriggered: null,
      evaluatedRules,
    };
  }

  /**
   * Phase 2: apply reputation as ROUTING only. Demote-only operation:
   *
   *   APPROVED (low trust)        → PENDING_HUMAN
   *   APPROVED (sufficient trust) → APPROVED
   *   PENDING_HUMAN               → PENDING_HUMAN  (already routing)
   *   BLOCKED                     → never reached (early-returned in evaluate())
   *
   * INVARIANT: reputation cannot turn APPROVED into BLOCKED. Merchants
   * who want stricter reputation gating apply their own filter via
   * merchant-sdk's MerchantPolicy.minTrustScore (documented as policy,
   * not BDIT validity).
   */
  private applyReputationRouting(
    mandateResult: RulesEngineResponse,
    request: RulesEngineRequest
  ): RulesEngineResponse {
    // Already routing or blocked — no-op.
    if (mandateResult.decision !== "APPROVED") {
      return mandateResult;
    }

    // Low agent trust → route to human review (informational only).
    if (
      request.agentTrustScore !== undefined &&
      request.agentTrustScore < TRUST_THRESHOLD_HUMAN
    ) {
      return {
        decision: "PENDING_HUMAN",
        reason:
          `Routing to human review: agent trust score ${request.agentTrustScore} ` +
          `below auto-approve threshold ${TRUST_THRESHOLD_HUMAN} ` +
          `(informational — mandate is valid)`,
        ruleTriggered: "trustScoreInformationalRouting",
        evaluatedRules: mandateResult.evaluatedRules,
      };
    }

    return mandateResult;
  }
}
