import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkWeeklyLimit(
  amount: number,
  weeklyTotal: number,
  policy: PolicyConfig
): RuleEvaluation {
  const projectedTotal = weeklyTotal + amount;
  if (projectedTotal > policy.maxPerWeek) {
    return {
      rule: "checkWeeklyLimit",
      passed: false,
      reason: `Projected weekly total ${projectedTotal} exceeds limit of ${policy.maxPerWeek}`,
    };
  }
  return {
    rule: "checkWeeklyLimit",
    passed: true,
    reason: `Projected weekly total ${projectedTotal} within limit of ${policy.maxPerWeek}`,
  };
}
