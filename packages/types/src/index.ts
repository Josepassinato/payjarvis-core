// ─── Categories & Enums ───

export type TransactionCategory =
  | "food"
  | "travel"
  | "transport"
  | "accommodation"
  | "streaming"
  | "software"
  | "shopping"
  | "health"
  | "education"
  | "electronics"
  | "gambling"
  | "investment"
  | "transfer"
  | "subscription"
  | "other";

export type KycLevel = 0 | 1 | 2 | 3;

export type Decision = "APPROVED" | "BLOCKED" | "PENDING_HUMAN";

export type BotPlatform = "openclaw" | "chatgpt" | "claude" | "custom";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// ─── Trust Score Constants (0-1000 scale) ───

export const TRUST_THRESHOLD_BLOCK = 400;
export const TRUST_THRESHOLD_HUMAN = 700;
export const TRUST_SCORE_MAX = 1000;
export const TRUST_SCORE_MIN = 0;
export const TRUST_SCORE_DEFAULT = 500;

// ─── Trust Score Scale Conversion ───

/** Convert bot-scale trust score (0-100) to agent-scale (0-1000) */
export function trustScoreBotToAgent(botScore: number): number {
  return Math.round(Math.max(0, Math.min(1000, botScore * 10)));
}

/** Convert agent-scale trust score (0-1000) to bot-scale (0-100) */
export function trustScoreAgentToBot(agentScore: number): number {
  return Math.round(Math.max(0, Math.min(100, agentScore / 10)) * 10) / 10;
}

/** Derive risk level from agent trust score (0-1000) */
export function getRiskLevel(trustScore: number): RiskLevel {
  if (trustScore >= 700) return "LOW";
  if (trustScore >= 400) return "MEDIUM";
  if (trustScore >= 200) return "HIGH";
  return "CRITICAL";
}

// ─── Agent Identity ───

export interface AgentIdentity {
  agent_id: string;
  owner_id: string;
  name: string;
  status: string;
  trust_score: number;        // 0-1000 scale
  kyc_level: number;
  total_spent: number;
  transactions_count: number;
  created_at: string;
  last_activity_at: string | null;
}

export interface AgentVerifyResult {
  agent_id: string;
  owner_verified: boolean;
  trust_score: number;         // 0-1000
  transactions: number;
  total_spent: number;
  risk_level: RiskLevel;
  kyc_level: number;
  status: string;
  created_at: string;
}

// ─── BDIT Token Payload ───

/**
 * BDIT — Bot Digital Identity Token, payload (RFC 7519 JWT).
 *
 * ─── ARCHITECTURAL INVARIANT ────────────────────────────────────────────
 *   "Mandate grants authority, reputation informs only."
 *
 *   The payload is composed of TWO logically separate sets of claims:
 *
 *     1. MandateClaims  — authoritative. Defines what the bot IS allowed
 *        to do. The rules-engine consults ONLY these to decide
 *        APPROVED / BLOCKED. They derive from an upstream Agreement
 *        (Concordia session, or direct owner mandate).
 *
 *     2. ReputationClaims — informational. Trust scores, KYC level,
 *        transaction history. Routing-only signal (e.g., low trust →
 *        route to human review). The rules-engine MUST NOT use these
 *        to BLOCK; merchant policy filters MAY apply additional
 *        merchant-side gating but that is policy, not BDIT validity.
 *
 *   Justification: in the Concordia stack v0.5.0 this maps to layers —
 *     Settlement (BDIT lives here) verifies mandate.
 *     Trust (Reputation Attestations) is a layer above; it informs the
 *       Agreement layer's decision to issue a mandate, but does NOT
 *       cross into Settlement as authority.
 *
 * ──────────────────────────────────────────────────────────────────────
 *
 * The interface below preserves the historical flat shape for backwards
 * compatibility. New code should extract the logical halves via
 * `extractMandate()` / `extractReputation()` to enforce the separation
 * at compile time.
 */
export interface BditPayload {
  // ─── MandateClaims (authoritative) ───
  bot_id: string;
  owner_id: string;
  categories: string[];
  max_amount: number;
  merchant_id: string;
  amount: number;
  category: string;
  session_id: string;
  // Agreement source (where this mandate came from). When mandate_source
  // is "concordia", concordia_session_urn + concordia_transcript_hash
  // bind the BDIT to a Concordia agreement (§10.4 of Concordia spec).
  mandate_source?: MandateSource;
  concordia_session_urn?: string;       // urn:concordia:session:<id>
  concordia_transcript_hash?: string;   // sha256:<hex>
  concordia_terms_hash?: string;        // optional — hash of derived terms

  // ─── ReputationClaims (informational, NEVER authoritative) ───
  trust_score: number;
  kyc_level: number;
  agent_id?: string;
  agent_trust_score?: number;    // 0-1000 scale
  owner_verified?: boolean;
  transactions_count?: number;
  total_spent?: number;

  // ─── JWT envelope ───
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Where this BDIT's mandate came from.
 *
 * - "concordia": derived from a Concordia session (Agreement layer).
 *                Carries concordia_session_urn + concordia_transcript_hash.
 * - "owner":     direct owner-defined policy (no upstream Agreement).
 * - "direct":    legacy / unspecified (pre-invariant tokens).
 */
export type MandateSource = "concordia" | "owner" | "direct";

/**
 * MandateClaims — the authoritative subset of BDIT.
 *
 * The rules-engine takes ONLY MandateClaims (plus runtime context like
 * spending totals and policy) to produce an APPROVED / BLOCKED decision.
 * Type signature alone prevents accidental authority-by-reputation.
 */
export interface MandateClaims {
  bot_id: string;
  owner_id: string;
  categories: string[];
  max_amount: number;
  merchant_id: string;
  amount: number;
  category: string;
  session_id: string;
  mandate_source?: MandateSource;
  concordia_session_urn?: string;
  concordia_transcript_hash?: string;
  concordia_terms_hash?: string;
}

/**
 * ReputationClaims — informational-only subset of BDIT.
 *
 * Consumers may use these for ROUTING (e.g., low trust → human review)
 * or DISPLAY but MUST NOT use them to deny an otherwise-valid mandate.
 */
export interface ReputationClaims {
  trust_score: number;
  kyc_level: number;
  agent_id?: string;
  agent_trust_score?: number;
  owner_verified?: boolean;
  transactions_count?: number;
  total_spent?: number;
}

/**
 * Extract the mandate (authoritative) subset from a BDIT payload.
 * Authorization code paths should accept MandateClaims (not BditPayload)
 * so the type system prevents reading reputation fields by mistake.
 */
export function extractMandate(p: BditPayload): MandateClaims {
  return {
    bot_id: p.bot_id,
    owner_id: p.owner_id,
    categories: p.categories,
    max_amount: p.max_amount,
    merchant_id: p.merchant_id,
    amount: p.amount,
    category: p.category,
    session_id: p.session_id,
    mandate_source: p.mandate_source,
    concordia_session_urn: p.concordia_session_urn,
    concordia_transcript_hash: p.concordia_transcript_hash,
    concordia_terms_hash: p.concordia_terms_hash,
  };
}

/**
 * Extract the reputation (informational) subset from a BDIT payload.
 * Use only for routing, display, or analytics — never for authorization.
 */
export function extractReputation(p: BditPayload): ReputationClaims {
  return {
    trust_score: p.trust_score,
    kyc_level: p.kyc_level,
    agent_id: p.agent_id,
    agent_trust_score: p.agent_trust_score,
    owner_verified: p.owner_verified,
    transactions_count: p.transactions_count,
    total_spent: p.total_spent,
  };
}

export interface BditVerifyResult {
  valid: boolean;
  payload?: BditPayload;
  reason?: string;
}

// ─── Decision Engine ───

export interface DecisionResult {
  decision: Decision;
  reason?: string;
  ruleTriggered?: string;
  bdtToken?: string;
  approvalId?: string;
  transactionId?: string;
}

export interface PaymentRequest {
  botId: string;
  ownerId: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  category: string;
}

export interface RequestPaymentInput {
  merchantId: string;
  merchantName: string;
  amount: number;
  currency?: string;
  category: TransactionCategory;
  description?: string;
  sessionId: string;
}

// ─── Policy ───

export interface PolicyConfig {
  maxPerTransaction: number;
  maxPerDay: number;
  maxPerWeek: number;
  maxPerMonth: number;
  autoApproveLimit: number;
  requireApprovalUp: number;
  allowedDays: number[];
  allowedHoursStart: number;
  allowedHoursEnd: number;
  timezone: string;
  allowedCategories: string[];
  blockedCategories: string[];
  merchantWhitelist: string[];
  merchantBlacklist: string[];
}

// ─── Bot ───

export interface BotInfo {
  id: string;
  ownerId: string;
  name: string;
  platform: string;
  status: string;
  trustScore: number;
  totalApproved: number;
  totalBlocked: number;
}

// ─── API Responses ───

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ─── Transaction Filters ───

export interface TransactionFilters {
  botId?: string;
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
  decision?: Decision;
  category?: string;
}

// ─── Approval Response ───

export interface ApprovalResponse {
  action: "approve" | "reject";
  reason?: string;
}

// ─── JWKS ───

export interface JwksKey {
  kty: string;
  use: string;
  kid: string;
  alg: string;
  n: string;
  e: string;
}

export interface JwksResponse {
  keys: JwksKey[];
}

// ─── Rules Engine Request/Response ───

export interface RulesEngineRequest {
  botId: string;
  ownerId: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  category: string;
  policy: PolicyConfig;
  botTrustScore: number;
  // Agent identity fields (new)
  agentId?: string;
  agentTrustScore?: number;    // 0-1000 scale
}

export interface RulesEngineResponse {
  decision: Decision;
  reason: string;
  ruleTriggered: string | null;
  evaluatedRules: RuleEvaluation[];
}

export interface RuleEvaluation {
  rule: string;
  passed: boolean;
  reason: string;
}

// ─── Trust Score Events ───

export type TrustScoreEvent =
  | "approved_auto"
  | "approved_human"
  | "blocked_limit"
  | "blocked_category"
  | "blocked_merchant"
  | "approval_expired"
  | "suspicious";
