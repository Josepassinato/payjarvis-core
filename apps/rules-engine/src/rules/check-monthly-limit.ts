import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkMonthlyLimit(
  amount: number,
  monthlyTotal: number,
  policy: PolicyConfig
): RuleEvaluation {
  const projectedTotal = monthlyTotal + amount;
  if (projectedTotal > policy.maxPerMonth) {
    return {
      rule: "checkMonthlyLimit",
      passed: false,
      reason: `Projected monthly total ${projectedTotal} exceeds limit of ${policy.maxPerMonth}`,
    };
  }
  return {
    rule: "checkMonthlyLimit",
    passed: true,
    reason: `Projected monthly total ${projectedTotal} within limit of ${policy.maxPerMonth}`,
  };
}
