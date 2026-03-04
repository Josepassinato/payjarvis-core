import type { RuleEvaluation } from "@payjarvis/types";
import type { PolicyConfig } from "@payjarvis/types";

export function checkMerchant(
  merchantId: string,
  policy: PolicyConfig
): RuleEvaluation {
  // Check blacklist first
  if (policy.merchantBlacklist.length > 0 && policy.merchantBlacklist.includes(merchantId)) {
    return {
      rule: "checkMerchant",
      passed: false,
      reason: `Merchant "${merchantId}" is blacklisted`,
    };
  }

  // Check whitelist (if defined, only whitelisted merchants are allowed)
  if (policy.merchantWhitelist.length > 0 && !policy.merchantWhitelist.includes(merchantId)) {
    return {
      rule: "checkMerchant",
      passed: false,
      reason: `Merchant "${merchantId}" is not in the whitelist`,
    };
  }

  return {
    rule: "checkMerchant",
    passed: true,
    reason: `Merchant "${merchantId}" is permitted`,
  };
}
