/**
 * Visa Service — Click to Pay (Secure Remote Commerce)
 *
 * Architecture:
 * - Frontend: Visa SRC SDK (JavaScript) handles UI, card selection, OTP
 * - Backend (this file): Provides SDK config, decrypts checkout payloads (JWE)
 * - mTLS: Used for Visa Direct and other server-to-server APIs
 *
 * SDK URLs:
 * - Sandbox: https://sandbox-assets.secure.checkout.visa.com/checkout-widget/resources/js/src-i-adapter/visaSdk.js?v2
 * - Production: https://assets.secure.checkout.visa.com/checkout-widget/resources/js/src-i-adapter/visaSdk.js?v2
 *
 * SDK Methods (frontend): init, isRecognized, identityLookup,
 *   initiateIdentityValidation, completeIdentityValidation,
 *   getSrcProfile, checkout, authenticate, unbindAppInstance
 */

import { readFileSync, existsSync } from "fs";
import * as https from "https";
import * as crypto from "crypto";

// ── Config ──────────────────────────────────────────────

const BASE_URL =
  process.env.VISA_BASE_URL || "https://sandbox.api.visa.com";
const USERNAME = process.env.VISA_USERNAME || "";
const SHARED_SECRET = process.env.VISA_SHARED_SECRET || "";
const API_KEY = process.env.VISA_API_KEY || "";
const CERT_PATH =
  process.env.VISA_CERT_PATH || "/root/Payjarvis/certs/visa-cert.pem";
const KEY_PATH =
  process.env.VISA_KEY_PATH || "/root/Payjarvis/certs/visa-private.key";
const CA_BUNDLE_PATH =
  process.env.VISA_CA_BUNDLE_PATH || "/root/Payjarvis/certs/visa-ca-bundle.pem";
const XPAY_PRIVATE_KEY_PATH =
  process.env.VISA_XPAY_KEY_PATH || "/root/Payjarvis/certs/visa-xpay-private.key";

const IS_SANDBOX = (process.env.VISA_ENVIRONMENT || "sandbox") === "sandbox";

const SDK_URL = IS_SANDBOX
  ? "https://sandbox-assets.secure.checkout.visa.com/checkout-widget/resources/js/src-i-adapter/visaSdk.js?v2"
  : "https://assets.secure.checkout.visa.com/checkout-widget/resources/js/src-i-adapter/visaSdk.js?v2";

// ── mTLS Agent (for server-to-server Visa APIs) ────────

let httpsAgent: https.Agent | null = null;

function getHttpsAgent(): https.Agent {
  if (httpsAgent) return httpsAgent;

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: !IS_SANDBOX,
  };

  try {
    if (existsSync(CERT_PATH)) agentOptions.cert = readFileSync(CERT_PATH);
    if (existsSync(KEY_PATH)) agentOptions.key = readFileSync(KEY_PATH);
    if (existsSync(CA_BUNDLE_PATH)) agentOptions.ca = readFileSync(CA_BUNDLE_PATH);
  } catch (err) {
    console.error("[Visa] Failed to load mTLS certificates:", err);
  }

  httpsAgent = new https.Agent(agentOptions);
  return httpsAgent;
}

function getBasicAuthHeader(): string {
  const password = SHARED_SECRET || API_KEY;
  return `Basic ${Buffer.from(`${USERNAME}:${password}`).toString("base64")}`;
}

async function visaRequest<T = any>(
  method: string,
  path: string,
  body?: Record<string, any>
): Promise<{ status: number; data: T }> {
  const url = `${BASE_URL}${path}`;
  const bodyStr = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const agent = getHttpsAgent();

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      agent,
      headers: {
        Authorization: getBasicAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    if (bodyStr) {
      (options.headers as Record<string, string>)["Content-Length"] =
        Buffer.byteLength(bodyStr).toString();
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = { raw: data };
        }
        resolve({ status: res.statusCode || 0, data: parsed as T });
      });
    });

    req.on("error", (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Click to Pay: Frontend SDK Config ───────────────────

/**
 * Returns the configuration the frontend needs to initialize the Visa SRC SDK.
 * The frontend calls visaSdk.init(config) with this data.
 */
export function getSdkConfig(): {
  sdkUrl: string;
  environment: string;
  initParams: {
    srcInitiatorId: string;
    srciDpaId: string;
    srciTransactionId: string;
    dpaTransactionOptions: {
      dpaLocale: string;
      paymentOptions: { dpaPanRequested: boolean };
      transactionAmount: { transactionAmount: number; transactionCurrencyCode: string };
    };
  };
} {
  return {
    sdkUrl: SDK_URL,
    environment: IS_SANDBOX ? "sandbox" : "production",
    initParams: {
      srcInitiatorId: process.env.VISA_PROJECT_ID || "",
      srciDpaId: process.env.VISA_PROJECT_ID || "",
      srciTransactionId: crypto.randomUUID(),
      dpaTransactionOptions: {
        dpaLocale: "en_US",
        paymentOptions: { dpaPanRequested: false },
        transactionAmount: {
          transactionAmount: 0, // Set by frontend per transaction
          transactionCurrencyCode: "USD",
        },
      },
    },
  };
}

// ── Click to Pay: Checkout Payload Decryption ───────────

/**
 * Decrypts the JWE payload returned by the Visa SRC SDK after checkout.
 * The frontend receives an encrypted payload and sends it to our backend.
 */
export function decryptCheckoutPayload(encryptedPayload: string): {
  success: boolean;
  data?: any;
  error?: string;
} {
  try {
    const privateKey = readFileSync(XPAY_PRIVATE_KEY_PATH, "utf-8");

    // JWE format: header.encryptedKey.iv.ciphertext.tag (5 parts, dot-separated)
    const parts = encryptedPayload.split(".");
    if (parts.length !== 5) {
      return { success: false, error: "Invalid JWE format: expected 5 parts" };
    }

    const [headerB64, encKeyB64, ivB64, ciphertextB64, tagB64] = parts;

    // Decode base64url
    const b64decode = (s: string) =>
      Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

    const encryptedKey = b64decode(encKeyB64);
    const iv = b64decode(ivB64);
    const ciphertext = b64decode(ciphertextB64);
    const tag = b64decode(tagB64);
    const aad = Buffer.from(headerB64, "ascii");

    // Decrypt the content encryption key (CEK) with our RSA private key
    const cek = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      encryptedKey
    );

    // Decrypt the payload with AES-GCM using the CEK
    const decipher = crypto.createDecipheriv("aes-256-gcm", cek, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return {
      success: true,
      data: JSON.parse(decrypted.toString("utf-8")),
    };
  } catch (error) {
    return {
      success: false,
      error: `Decryption failed: ${error}`,
    };
  }
}

// ── Visa Direct (server-to-server mTLS) ─────────────────

export async function helloWorld(): Promise<{
  connected: boolean;
  message: string;
  environment: string;
  timestamp: string;
  rawResponse?: any;
}> {
  try {
    const { status, data } = await visaRequest("GET", "/vdp/helloworld");
    return {
      connected: status === 200,
      message: `Visa sandbox responded with HTTP ${status}`,
      environment: IS_SANDBOX ? "sandbox" : "production",
      timestamp: new Date().toISOString(),
      rawResponse: data,
    };
  } catch (error) {
    return {
      connected: false,
      message: String(error),
      environment: IS_SANDBOX ? "sandbox" : "production",
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Status / Diagnostics ────────────────────────────────

export async function testConnection(): Promise<{
  mTLS: { certLoaded: boolean; keyLoaded: boolean; caLoaded: boolean };
  sdkUrl: string;
  environment: string;
  credentialsConfigured: boolean;
  xpayKeyLoaded: boolean;
}> {
  return {
    mTLS: {
      certLoaded: existsSync(CERT_PATH),
      keyLoaded: existsSync(KEY_PATH),
      caLoaded: existsSync(CA_BUNDLE_PATH),
    },
    sdkUrl: SDK_URL,
    environment: IS_SANDBOX ? "sandbox" : "production",
    credentialsConfigured: !!(USERNAME && (SHARED_SECRET || API_KEY)),
    xpayKeyLoaded: existsSync(XPAY_PRIVATE_KEY_PATH),
  };
}

export const visaService = {
  getSdkConfig,
  decryptCheckoutPayload,
  helloWorld,
  testConnection,
};
