const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function buildHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, options?: RequestInit & { token?: string | null }): Promise<T> {
  const { token, ...fetchOptions } = options ?? {};
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      ...buildHeaders(token),
      ...fetchOptions?.headers,
    },
  });

  const json = await res.json();

  if (!res.ok || json.success === false) {
    throw new ApiError(res.status, json.error ?? json.message ?? "Request failed");
  }

  return json.data as T;
}

async function requestPaginated<T>(path: string, options?: RequestInit & { token?: string | null }): Promise<PaginatedResult<T>> {
  const { token, ...fetchOptions } = options ?? {};
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      ...buildHeaders(token),
      ...fetchOptions?.headers,
    },
  });

  const json = await res.json();

  if (!res.ok || json.success === false) {
    throw new ApiError(res.status, json.error ?? json.message ?? "Request failed");
  }

  return {
    data: json.data as T[],
    total: json.total ?? 0,
    page: json.page ?? 1,
    limit: json.limit ?? 20,
    pages: json.pages ?? 1,
  };
}

// ── Pagination ──

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ── Bots ──

export interface Bot {
  id: string;
  ownerId: string;
  name: string;
  platform: string;
  apiKeyHash: string;
  status: "ACTIVE" | "PAUSED" | "REVOKED";
  trustScore: number;
  totalApproved: number;
  totalBlocked: number;
  createdAt: string;
  updatedAt: string;
  policy: Policy | null;
}

export interface Policy {
  id: string;
  botId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateBotResult extends Bot {
  apiKey: string;
}

export function getBots(token?: string | null): Promise<Bot[]> {
  return request<Bot[]>("/bots", { token });
}

export function getBot(id: string, token?: string | null): Promise<Bot> {
  return request<Bot>(`/bots/${id}`, { token });
}

export function createBot(name: string, platform: string, token?: string | null): Promise<CreateBotResult> {
  return request<CreateBotResult>("/bots", {
    token,
    method: "POST",
    body: JSON.stringify({ name, platform }),
  });
}

export function updateBot(id: string, data: Partial<Pick<Bot, "name" | "platform">>, token?: string | null): Promise<Bot> {
  return request<Bot>(`/bots/${id}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function updateBotStatus(id: string, status: string, token?: string | null): Promise<Bot> {
  return request<Bot>(`/bots/${id}/status`, {
    token,
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// ── Policies ──

export function getPolicy(botId: string, token?: string | null): Promise<Policy> {
  return request<Policy>(`/bots/${botId}/policy`, { token });
}

export function upsertPolicy(botId: string, data: Partial<Omit<Policy, "id" | "botId" | "createdAt" | "updatedAt">>, token?: string | null): Promise<Policy> {
  return request<Policy>(`/bots/${botId}/policy`, {
    token,
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updatePolicy(botId: string, data: Partial<Omit<Policy, "id" | "botId" | "createdAt" | "updatedAt">>, token?: string | null): Promise<Policy> {
  return request<Policy>(`/bots/${botId}/policy`, {
    token,
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── Transactions ──

export interface Transaction {
  id: string;
  botId: string;
  ownerId: string;
  merchantId: string | null;
  merchantName: string;
  bdtJti: string | null;
  amount: number;
  currency: string;
  category: string;
  decision: "APPROVED" | "BLOCKED" | "PENDING_HUMAN";
  decisionReason: string;
  approvalId: string | null;
  approvedByHuman: boolean;
  createdAt: string;
}

export interface TransactionFilters {
  botId?: string;
  dateFrom?: string;
  dateTo?: string;
  decision?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export function getTransactions(filters?: TransactionFilters, token?: string | null): Promise<PaginatedResult<Transaction>> {
  const params = new URLSearchParams();
  if (filters?.botId) params.set("botId", filters.botId);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.decision) params.set("decision", filters.decision);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return requestPaginated<Transaction>(`/transactions${qs ? `?${qs}` : ""}`, { token });
}

export function getTransactionsPdfUrl(filters?: TransactionFilters): string {
  const params = new URLSearchParams();
  if (filters?.botId) params.set("botId", filters.botId);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  return `${API_URL}/transactions/export/pdf${qs ? `?${qs}` : ""}`;
}

// ── Approvals ──

export interface Approval {
  id: string;
  transactionId: string;
  botId: string;
  ownerId: string;
  amount: number;
  merchantName: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

export function getApprovals(token?: string | null): Promise<Approval[]> {
  return request<Approval[]>("/approvals", { token });
}

export function respondToApproval(id: string, action: "approve" | "reject", reason?: string, token?: string | null): Promise<{ status: string; bditToken?: string; expiresAt?: string }> {
  return request(`/approvals/${id}/respond`, {
    token,
    method: "POST",
    body: JSON.stringify({ action, reason }),
  });
}

// ── Notifications ──

export function linkTelegram(token?: string | null): Promise<{ code: string; instructions: string }> {
  return request('/notifications/telegram/link', { token, method: 'POST', body: JSON.stringify({}) });
}

// ── Payments ──

export interface PaymentResult {
  decision: string;
  transactionId: string;
  bditToken?: string;
  approvalId?: string;
  reason?: string;
  ruleTriggered?: string;
  expiresAt?: string;
}

export function requestPayment(botId: string, data: {
  merchantId: string;
  merchantName: string;
  amount: number;
  currency?: string;
  category: string;
}, token?: string | null): Promise<PaymentResult> {
  return request<PaymentResult>(`/bots/${botId}/request-payment`, {
    token,
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Analytics ──

export interface SpendingTrend {
  date: string;
  total: number;
  count: number;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
  count: number;
}

export interface DecisionBreakdown {
  decision: string;
  count: number;
  total: number;
}

export interface BotBreakdown {
  botId: string;
  botName: string;
  total: number;
  count: number;
}

export function getSpendingTrends(token?: string | null): Promise<SpendingTrend[]> {
  return request<SpendingTrend[]>("/analytics/spending-trends", { token });
}

export function getByCategory(token?: string | null): Promise<CategoryBreakdown[]> {
  return request<CategoryBreakdown[]>("/analytics/by-category", { token });
}

export function getDecisions(token?: string | null): Promise<DecisionBreakdown[]> {
  return request<DecisionBreakdown[]>("/analytics/decisions", { token });
}

export function getByBot(token?: string | null): Promise<BotBreakdown[]> {
  return request<BotBreakdown[]>("/analytics/by-bot", { token });
}

// ── Agent Reputation ──

export interface AgentReputation {
  transactionsSuccess: number;
  transactionsBlocked: number;
  totalSpent: number;
  merchantCount: number;
  anomalyEvents: number;
  avgTransactionSize: number;
  successRate: number;
  lastActivityAt: string | null;
  trustScore: number;
}

export function getReputation(botId: string, token?: string | null): Promise<AgentReputation> {
  return request<AgentReputation>(`/bots/${botId}/reputation`, { token });
}
