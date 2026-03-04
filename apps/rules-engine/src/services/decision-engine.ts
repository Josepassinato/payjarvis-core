import type {
  RulesEngineRequest,
  RulesEngineResponse,
  RuleEvaluation,
  Decision,
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

    // Run all rules independently
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
