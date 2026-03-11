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

export interface BditPayload {
  bot_id: string;
  owner_id: string;
  trust_score: number;
  kyc_level: number;
  categories: string[];
  max_amount: number;
  merchant_id: string;
  amount: number;
  category: string;
  session_id: string;
  jti: string;
  iat: number;
  exp: number;
  // Agent identity fields (new)
  agent_id?: string;
  agent_trust_score?: number;    // 0-1000 scale
  owner_verified?: boolean;
  transactions_count?: number;
  total_spent?: number;
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
