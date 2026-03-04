import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkTimeWindow(policy: PolicyConfig): RuleEvaluation {
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sunday, 6=Saturday
  const currentHour = now.getHours();

  // Check allowed days
  if (!policy.allowedDays.includes(currentDay)) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return {
      rule: "checkTimeWindow",
      passed: false,
      reason: `Transactions not allowed on ${dayNames[currentDay]}`,
    };
  }

  // Check allowed hours
  if (currentHour < policy.allowedHoursStart || currentHour >= policy.allowedHoursEnd) {
    return {
      rule: "checkTimeWindow",
      passed: false,
      reason: `Current hour ${currentHour} is outside allowed window ${policy.allowedHoursStart}-${policy.allowedHoursEnd}`,
    };
  }

  return {
    rule: "checkTimeWindow",
    passed: true,
    reason: `Current time is within allowed window`,
  };
}
