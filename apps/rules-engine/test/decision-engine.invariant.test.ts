import { describe, it, expect } from "vitest";
import type { PolicyConfig, RulesEngineRequest } from "@payjarvis/types";
import { DecisionEngine } from "../src/services/decision-engine.js";

/**
 * Invariant: "Mandate grants authority, reputation informs only."
 *
 * Property tests assert that reputation/trust scores cannot:
 *   1. Convert APPROVED → BLOCKED
 *   2. Convert BLOCKED  → APPROVED
 *
 * Reputation may only ROUTE (APPROVED → PENDING_HUMAN). All BLOCKED
 * decisions must trace to a mandate rule (category, merchant, amount,
 * limits, time window).
 */

const engine = new DecisionEngine();

const basePolicy: PolicyConfig = {
  maxPerTransaction: 1000,
  maxPerDay: 5000,
  maxPerWeek: 20000,
  maxPerMonth: 50000,
  autoApproveLimit: 500,
  requireApprovalUp: 1000,
  allowedDays: [0, 1, 2, 3, 4, 5, 6],
  allowedHoursStart: 0,
  allowedHoursEnd: 24,
  timezone: "UTC",
  allowedCategories: ["shopping", "food"],
  blockedCategories: [],
  merchantWhitelist: [],
  merchantBlacklist: [],
};

const baseTotals = { daily: 0, weekly: 0, monthly: 0 };

function buildRequest(overrides: Partial<RulesEngineRequest> = {}): RulesEngineRequest {
  return {
    botId: "bot_test",
    ownerId: "user_test",
    merchantId: "amazon",
    merchantName: "Amazon",
    amount: 100,
    category: "shopping",
    policy: basePolicy,
    botTrustScore: 50,
    ...overrides,
  };
}

// Discrete sweep across the full reputation range (0-1000 for agent scale).
// Includes the historical block (400) and human (700) thresholds plus
// extremes; covers the relevant decision boundaries without exhaustive
// brute force.
const TRUST_SAMPLES = [0, 50, 100, 200, 350, 399, 400, 401, 500, 699, 700, 701, 850, 1000];

describe("DecisionEngine — mandate authority invariant", () => {
  it("never BLOCKS a mandate-valid request based on reputation alone", () => {
    // Mandate is valid: amount under autoApproveLimit, category allowed,
    // merchant not blacklisted, time window open.
    for (const trustScore of TRUST_SAMPLES) {
      for (const agentTrust of [...TRUST_SAMPLES, undefined]) {
        const req = buildRequest({
          botTrustScore: trustScore,
          agentTrustScore: agentTrust,
        });
        const result = engine.evaluate(req, baseTotals);

        expect(
          result.decision,
          `expected non-BLOCKED for trust=${trustScore} agentTrust=${agentTrust}, got ${result.decision} (${result.reason})`
        ).not.toBe("BLOCKED");
      }
    }
  });

  it("BLOCKS a mandate-invalid request regardless of reputation (even maxed-out trust)", () => {
    // Mandate violation: category not in allowedCategories.
    for (const trustScore of TRUST_SAMPLES) {
      for (const agentTrust of [...TRUST_SAMPLES, undefined]) {
        const req = buildRequest({
          category: "gambling",
          botTrustScore: trustScore,
          agentTrustScore: agentTrust,
        });
        const result = engine.evaluate(req, baseTotals);

        expect(
          result.decision,
          `expected BLOCKED for invalid category at trust=${trustScore} agentTrust=${agentTrust}`
        ).toBe("BLOCKED");
        // BLOCKED must trace to a mandate rule, never to reputation.
        expect(result.ruleTriggered).toBe("checkCategory");
      }
    }
  });

  it("decision invariance: holding mandate constant, varying reputation yields ⊆ {APPROVED, PENDING_HUMAN}", () => {
    // For an APPROVED-eligible mandate, reputation may only route to
    // PENDING_HUMAN — never BLOCK, never deny.
    const decisions = new Set<string>();
    for (const agentTrust of TRUST_SAMPLES) {
      const req = buildRequest({ agentTrustScore: agentTrust });
      const result = engine.evaluate(req, baseTotals);
      decisions.add(result.decision);
    }
    expect(decisions.has("BLOCKED")).toBe(false);
    expect([...decisions].every(d => d === "APPROVED" || d === "PENDING_HUMAN")).toBe(true);
  });

  it("PENDING_HUMAN by reputation tags the rule as informational routing", () => {
    // Low agent trust + valid mandate → PENDING_HUMAN with the
    // informational-routing rule tag (not a mandate rule).
    const req = buildRequest({ agentTrustScore: 100 });
    const result = engine.evaluate(req, baseTotals);
    expect(result.decision).toBe("PENDING_HUMAN");
    expect(result.ruleTriggered).toBe("trustScoreInformationalRouting");
    expect(result.reason).toContain("informational");
  });

  it("amount-based PENDING_HUMAN traces to mandate rule, not reputation", () => {
    // Amount above autoApproveLimit (500) but mandate-valid otherwise.
    const req = buildRequest({
      amount: 750,
      agentTrustScore: 1000, // max trust — proves the amount routing is mandate-driven
    });
    const result = engine.evaluate(req, baseTotals);
    expect(result.decision).toBe("PENDING_HUMAN");
    expect(result.ruleTriggered).toBe("autoApproveLimit");
  });
});
