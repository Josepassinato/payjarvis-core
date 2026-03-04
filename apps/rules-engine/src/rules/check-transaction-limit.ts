import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkTransactionLimit(
  amount: number,
  policy: PolicyConfig
): RuleEvaluation {
  if (amount > policy.maxPerTransaction) {
    return {
      rule: "checkTransactionLimit",
      passed: false,
      reason: `Amount ${amount} exceeds per-transaction limit of ${policy.maxPerTransaction}`,
    };
  }
  return {
    rule: "checkTransactionLimit",
    passed: true,
    reason: `Amount ${amount} within per-transaction limit of ${policy.maxPerTransaction}`,
  };
}
