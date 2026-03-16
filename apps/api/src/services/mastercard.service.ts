/**
 * Mastercard Service — Buyer Payment Agent + Token Requestor (MDES)
 *
 * OAuth 1.0a with RSA-SHA256 signature using PKCS#12 signing key.
 *
 * Endpoints:
 * - tokenizeCard: MDES tokenization (FPAN → DPAN)
 * - makePayment: Buyer Payment Agent payment execution
 * - getToken: Token status lookup
 * - deleteToken: Token removal
 * - testConnection: Sandbox connectivity check
 */

import { readFileSync } from "fs";
import * as crypto from "crypto";

const BASE_URL =
  process.env.MASTERCARD_BASE_URL || "https://sandbox.api.mastercard.com";
const CLIENT_ID = process.env.MASTERCARD_CLIENT_ID || "";
const KEY_PATH =
  process.env.MASTERCARD_SIGNING_KEY_PATH ||
  "/root/Payjarvis/certs/mastercard-signing.p12";
const KEY_PASSWORD = process.env.MASTERCARD_KEY_PASSWORD || "";
const KEY_ALIAS = process.env.MASTERCARD_KEY_ALIAS || "payjarvis";

let signingKey: crypto.KeyObject | null = null;

function getSigningKey(): crypto.KeyObject {
  if (signingKey) return signingKey;

  try {
    const p12Buffer = readFileSync(KEY_PATH);
    // Node 16+ supports PKCS#12 via createPrivateKey with passphrase
    // Extract private key from PKCS#12 using legacy provider
    const pfx = p12Buffer;
    signingKey = crypto.createPrivateKey({
      key: pfx,
      format: "der",
      type: "pkcs8",
      passphrase: KEY_PASSWORD,
    } as any);
    return signingKey;
  } catch (err) {
    console.error(
      "[Mastercard] Failed to load signing key from",
      KEY_PATH,
      err
    );
    throw new Error("Mastercard signing key not available");
  }
}

function generateOAuthHeader(
  method: string,
  url: string,
  body?: string
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: CLIENT_ID,
    oauth_nonce: nonce,
    oauth_signature_method: "RSA-SHA256",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
  };

  if (body) {
    const bodyHash = crypto
      .createHash("sha256")
      .update(body)
      .digest("base64");
    oauthParams["oauth_body_hash"] = bodyHash;
  }

  // Build base string
  const paramString = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join("&");

  // Sign with RSA-SHA256
  let signature: string;
  try {
    const key = getSigningKey();
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(baseString);
    signature = signer.sign(key, "base64");
  } catch {
    signature = "SIGNING_KEY_NOT_LOADED";
  }

  oauthParams["oauth_signature"] = signature;

  const headerParams = Object.entries(oauthParams)
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ");

  return `OAuth ${headerParams}`;
}

async function mcRequest<T = any>(
  method: string,
  path: string,
  body?: Record<string, any>
): Promise<{ status: number; data: T }> {
  const url = `${BASE_URL}${path}`;
  const bodyStr = body ? JSON.stringify(body) : undefined;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: generateOAuthHeader(method, url, bodyStr),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyStr,
  });

  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

// ── Public API ──────────────────────────────────────────

export async function testConnection(): Promise<{
  connected: boolean;
  message: string;
  environment: string;
}> {
  try {
    const { status } = await mcRequest("POST", "/mdes/digitization/1/0/getTaskStatus", {
      requestId: crypto.randomUUID(),
      tokenRequestorId: CLIENT_ID,
    });

    return {
      connected: status !== 500,
      message: `Mastercard sandbox responded with HTTP ${status}`,
      environment: process.env.MASTERCARD_ENVIRONMENT || "sandbox",
    };
  } catch (error) {
    return {
      connected: false,
      message: String(error),
      environment: process.env.MASTERCARD_ENVIRONMENT || "sandbox",
    };
  }
}

export async function tokenizeCard(cardData: {
  primaryAccountNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cardholderName: string;
}): Promise<{
  tokenUniqueReference: string;
  status: string;
  rawResponse?: any;
}> {
  const requestId = crypto.randomUUID();

  const { status, data } = await mcRequest<any>(
    "POST",
    "/mdes/digitization/1/0/tokenize",
    {
      responseHost: "www.payjarvis.com",
      requestId,
      tokenType: "CLOUD",
      tokenRequestorId: CLIENT_ID,
      taskId: crypto.randomUUID(),
      fundingAccountInfo: {
        encryptedPayload: {
          encryptedData: {
            accountNumber: cardData.primaryAccountNumber,
            expiryMonth: cardData.expiryMonth,
            expiryYear: cardData.expiryYear,
            cardholderName: cardData.cardholderName,
          },
        },
      },
    }
  );

  if (status >= 400) {
    return {
      tokenUniqueReference: "",
      status: `ERROR_${status}`,
      rawResponse: data,
    };
  }

  return {
    tokenUniqueReference: data.tokenUniqueReference || "",
    status: data.token?.status || "PENDING",
  };
}

export async function makePayment(params: {
  tokenUniqueReference: string;
  amount: number;
  currency: string;
  merchantId: string;
  merchantName?: string;
}): Promise<{
  transactionId: string;
  status: string;
  rawResponse?: any;
}> {
  const { status, data } = await mcRequest<any>(
    "POST",
    "/buyers-payment-agent/v1/payments",
    {
      requestId: crypto.randomUUID(),
      paymentToken: {
        tokenUniqueReference: params.tokenUniqueReference,
      },
      transactionAmount: {
        amount: params.amount.toFixed(2),
        currency: params.currency,
      },
      merchant: {
        merchantId: params.merchantId,
        merchantName: params.merchantName || "PayJarvis Merchant",
      },
    }
  );

  if (status >= 400) {
    return {
      transactionId: "",
      status: `ERROR_${status}`,
      rawResponse: data,
    };
  }

  return {
    transactionId: data.transactionId || data.paymentId || "",
    status: data.status || "SUBMITTED",
  };
}

export async function getToken(tokenUniqueReference: string): Promise<{
  status: string;
  token?: any;
}> {
  const { status, data } = await mcRequest<any>(
    "POST",
    "/mdes/digitization/1/0/getToken",
    {
      requestId: crypto.randomUUID(),
      tokenUniqueReference,
    }
  );

  return {
    status: status < 400 ? (data.token?.status || "UNKNOWN") : `ERROR_${status}`,
    token: data.token,
  };
}

export async function deleteToken(tokenUniqueReference: string): Promise<{
  success: boolean;
  status: string;
}> {
  const { status, data } = await mcRequest<any>(
    "POST",
    "/mdes/digitization/1/0/delete",
    {
      requestId: crypto.randomUUID(),
      tokenUniqueReferences: [tokenUniqueReference],
      causedBy: "TOKEN_REQUESTOR",
      reason: "USER_REQUESTED",
    }
  );

  return {
    success: status < 400,
    status: status < 400 ? "DELETED" : `ERROR_${status}`,
  };
}

export const mastercardService = {
  testConnection,
  tokenizeCard,
  makePayment,
  getToken,
  deleteToken,
};
