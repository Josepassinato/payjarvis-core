/** Shared types for the browser extension */

export interface PayjarvisConfig {
  apiUrl: string;
  botApiKey: string;
  botId: string;
  enabled: boolean;
}

export interface PaymentRequest {
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  sessionId: string;
  url: string;
}

export interface PaymentDecision {
  status: "APPROVED" | "BLOCKED" | "PENDING_HUMAN_APPROVAL" | "ERROR";
  message: string;
  bditToken?: string;
  transactionId?: string;
  approvalId?: string;
  reason?: string;
}

export interface CheckoutDetection {
  platform: "amazon" | "hotels" | "expedia";
  isCheckout: boolean;
  amount?: number;
  currency?: string;
  description?: string;
  itemCount?: number;
}

/** Messages between content script and background */
export type ExtensionMessage =
  | {
      type: "CHECKOUT_DETECTED";
      payload: CheckoutDetection & { amount: number };
    }
  | {
      type: "REQUEST_PAYMENT_APPROVAL";
      payload: PaymentRequest;
    }
  | {
      type: "PAYMENT_DECISION";
      payload: PaymentDecision;
    }
  | {
      type: "GET_CONFIG";
    }
  | {
      type: "CONFIG_RESPONSE";
      payload: PayjarvisConfig;
    };
