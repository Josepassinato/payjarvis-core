import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkDailyLimit(
  amount: number,
  dailyTotal: number,
  policy: PolicyConfig
): RuleEvaluation {
  const projectedTotal = dailyTotal + amount;
  if (projectedTotal > policy.maxPerDay) {
    return {
      rule: "checkDailyLimit",
      passed: false,
      reason: `Projected daily total ${projectedTotal} exceeds limit of ${policy.maxPerDay}`,
    };
  }
  return {
    rule: "checkDailyLimit",
    passed: true,
    reason: `Projected daily total ${projectedTotal} within limit of ${policy.maxPerDay}`,
  };
}
