import type {
  RulesEngineRequest,
  RulesEngineResponse,
  RuleEvaluation,
  Decision,
} from "@payjarvis/types";
import {
  TRUST_THRESHOLD_BLOCK,
  TRUST_THRESHOLD_HUMAN,
} from "@payjarvis/types";
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

export class DecisionEngine {
  evaluate(
    request: RulesEngineRequest,
    totals: SpendingTotals
  ): RulesEngineResponse {
    const evaluatedRules: RuleEvaluation[] = [];

    // ─── Agent trust score threshold check ───
    if (request.agentTrustScore !== undefined) {
      const agentTrustCheck: RuleEvaluation = {
        rule: "checkAgentTrustScore",
        passed: request.agentTrustScore >= TRUST_THRESHOLD_BLOCK,
        reason: request.agentTrustScore < TRUST_THRESHOLD_BLOCK
          ? `Agent trust score ${request.agentTrustScore} below block threshold ${TRUST_THRESHOLD_BLOCK}`
          : `Agent trust score ${request.agentTrustScore} above block threshold`,
      };
      evaluatedRules.push(agentTrustCheck);

      if (!agentTrustCheck.passed) {
        return {
          decision: "BLOCKED",
          reason: agentTrustCheck.reason,
          ruleTriggered: "checkAgentTrustScore",
          evaluatedRules,
        };
      }
    }

    // Run all policy rules
    evaluatedRules.push(checkTransactionLimit(request.amount, request.policy));
    evaluatedRules.push(checkDailyLimit(request.amount, totals.daily, request.policy));
    evaluatedRules.push(checkWeeklyLimit(request.amount, totals.weekly, request.policy));
    evaluatedRules.push(checkMonthlyLimit(request.amount, totals.monthly, request.policy));
    evaluatedRules.push(checkCategory(request.category, request.policy));
    evaluatedRules.push(checkMerchant(request.merchantId, request.policy));
    evaluatedRules.push(checkTimeWindow(request.policy));

    // Find first failing rule
    const failedRule = evaluatedRules.find((r) => !r.passed);

    if (failedRule) {
      return {
        decision: "BLOCKED",
        reason: failedRule.reason,
        ruleTriggered: failedRule.rule,
        evaluatedRules,
      };
    }

    // ─── Agent trust score → human approval zone ───
    if (
      request.agentTrustScore !== undefined &&
      request.agentTrustScore < TRUST_THRESHOLD_HUMAN
    ) {
      return {
        decision: "PENDING_HUMAN",
        reason: `Agent trust score ${request.agentTrustScore} below auto-approve threshold ${TRUST_THRESHOLD_HUMAN}`,
        ruleTriggered: "agentTrustHumanReview",
        evaluatedRules,
      };
    }

    // Check if amount requires human approval
    if (request.amount > request.policy.requireApprovalUp) {
      return {
        decision: "PENDING_HUMAN",
        reason: `Amount ${request.amount} exceeds human approval threshold of ${request.policy.requireApprovalUp}`,
        ruleTriggered: "requireApprovalUp",
        evaluatedRules,
      };
    }

    // Check auto-approve limit — between autoApproveLimit and requireApprovalUp needs human
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
      reason: "All rules passed and amount within auto-approve limit",
      ruleTriggered: null,
      evaluatedRules,
    };
  }
}
