import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkCategory(
  category: string,
  policy: PolicyConfig
): RuleEvaluation {
  // Check blacklist first
  if (policy.blockedCategories.length > 0 && policy.blockedCategories.includes(category)) {
    return {
      rule: "checkCategory",
      passed: false,
      reason: `Category "${category}" is in the blocked list`,
    };
  }

  // Check whitelist (if defined, only whitelisted categories are allowed)
  if (policy.allowedCategories.length > 0 && !policy.allowedCategories.includes(category)) {
    return {
      rule: "checkCategory",
      passed: false,
      reason: `Category "${category}" is not in the allowed list`,
    };
  }

  return {
    rule: "checkCategory",
    passed: true,
    reason: `Category "${category}" is permitted`,
  };
}
