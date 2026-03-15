export interface PayJarvisConfig {
  apiKey: string;
  botId: string;
  baseUrl?: string;
  timeout?: number;
}

export interface ApprovalRequest {
  merchant: string;
  merchantId?: string;
  amount: number;
  category: string;
  description?: string;
  currency?: string;
}

export interface ApprovalDecision {
  approved: boolean;
  pending: boolean;
  blocked: boolean;
  transactionId: string;
  approvalId?: string;
  bditToken?: string;
  reason?: string;
  ruleTriggered?: string | null;
  expiresAt?: string;
}

export interface HandoffRequest {
  sessionUrl: string;
  obstacleType: "CAPTCHA" | "AUTH" | "NAVIGATION" | "OTHER";
  description: string;
  metadata?: Record<string, unknown>;
}

export interface HandoffResult {
  handoffId: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED" | "EXPIRED" | "CANCELLED";
  resolved: boolean;
  resolvedNote?: string;
  reason?: string;
  expiresAt?: string;
}

export interface StoreProduct {
  asin: string | null;
  title: string | null;
  price: string | null;
  link: string | null;
  rating: string | null;
  image: string | null;
  isPrime: boolean;
}

export interface AddToCartResult {
  added: boolean;
  product: { title: string | null; price: string | null };
  quantity: number;
  cartUrl: string;
}

export interface SpendingLimits {
  perTransaction: number;
  perDay: number;
  perWeek: number;
  perMonth: number;
  spentToday: number;
  spentWeek: number;
  spentMonth: number;
  remainingToday: number;
  remainingWeek: number;
  remainingMonth: number;
}
