/**
 * Butler Autofill Service -- Browser automation for credential-based actions.
 *
 * Retrieves stored credentials from the Butler vault and drives the Browser Agent
 * to fill forms, log in, and execute actions on behalf of the user.
 *
 * Safety rules:
 *   - NEVER auto-retry on CAPTCHA -- return screenshot to user
 *   - NEVER auto-retry on 2FA -- set Redis key, return awaiting state
 *   - Max 3 concurrent sessions per service (Amazon)
 *   - Every credential access and action logged to ButlerAuditLog
 */

import { getCredential, logButlerAction } from "./butler-protocol.service.js";
import { redisGet, redisSet, redisIncr, redisDel } from "../redis.js";

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";
const MAX_CONCURRENT_AMAZON = 3;

// -- Action Templates --

export const ACTION_TEMPLATES: Record<string, { url: string; steps: string[] }> = {
  "amazon:login": {
    url: "https://www.amazon.com/ap/signin",
    steps: ["navigate_to_login", "fill_email", "fill_password", "submit"],
  },
  "amazon:buy": {
    url: "https://www.amazon.com",
    steps: ["navigate_to_product", "add_to_cart", "proceed_to_checkout", "confirm_address", "place_order"],
  },
  "netflix:login": {
    url: "https://www.netflix.com/login",
    steps: ["navigate_to_login", "fill_email", "fill_password", "submit"],
  },
  "netflix:cancel": {
    url: "https://www.netflix.com/account",
    steps: ["login", "navigate_account", "cancel_membership", "confirm_cancel"],
  },
  "publix:login": {
    url: "https://delivery.publix.com",
    steps: ["navigate_to_login", "fill_email", "fill_password", "submit"],
  },
  "publix:order": {
    url: "https://delivery.publix.com",
    steps: ["login", "add_items", "select_delivery_time", "checkout"],
  },
};

// -- Types --

export interface AutofillRequest {
  userId: string;
  serviceName: string;
  action: string;
  targetUrl?: string;
  details?: Record<string, any>;
}

export interface AutofillResult {
  success: boolean;
  status: "completed" | "captcha" | "awaiting_2fa" | "error" | "rate_limited";
  message: string;
  screenshotUrl?: string;
  expiresIn?: number;
  sessionId?: string;
}

// -- Concurrency guard --

async function acquireConcurrencySlot(serviceName: string): Promise<boolean> {
  const key = `butler:active:${serviceName.toLowerCase()}`;
  const current = await redisGet(key);
  const count = current ? parseInt(current, 10) : 0;

  if (serviceName.toLowerCase() === "amazon" && count >= MAX_CONCURRENT_AMAZON) {
    return false;
  }

  await redisIncr(key, 300); // 5-minute TTL auto-cleanup
  return true;
}

async function releaseConcurrencySlot(serviceName: string): Promise<void> {
  const key = `butler:active:${serviceName.toLowerCase()}`;
  const current = await redisGet(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count <= 1) {
    await redisDel(key);
  } else {
    await redisSet(key, String(count - 1), 300);
  }
}

// -- Main autofill orchestrator --

export async function executeAutofill(req: AutofillRequest): Promise<AutofillResult> {
  const { userId, serviceName, action, targetUrl, details } = req;

  // 1. Retrieve credential
  const credential = await getCredential(userId, serviceName);
  if (!credential) {
    await logButlerAction(userId, "autofill_attempt", serviceName, "error", {
      reason: "credential_not_found",
      action,
    });
    return {
      success: false,
      status: "error",
      message: `No saved credential for "${serviceName}". Save it first with Butler Protocol.`,
    };
  }

  // 2. Check concurrency
  const slotAcquired = await acquireConcurrencySlot(serviceName);
  if (!slotAcquired) {
    await logButlerAction(userId, "autofill_attempt", serviceName, "rate_limited", { action });
    return {
      success: false,
      status: "rate_limited",
      message: `Too many active sessions for ${serviceName}. Please wait a moment.`,
    };
  }

  try {
    // 3. Resolve target URL from template or credential
    const templateKey = `${serviceName.toLowerCase()}:${action}`;
    const template = ACTION_TEMPLATES[templateKey];
    const url = targetUrl || template?.url || credential.serviceUrl || `https://${serviceName.toLowerCase()}.com`;
    const steps = template?.steps || ["navigate_to_login", "fill_email", "fill_password", "submit"];

    // 4. Log the attempt
    await logButlerAction(userId, "autofill_start", serviceName, "in_progress", {
      action,
      url,
      steps,
    });

    // 5. Call Browser Agent
    const browserResult = await callBrowserAgent({
      url,
      action,
      steps,
      login: credential.login,
      password: credential.password,
      details: details || {},
    });

    // 6. Handle CAPTCHA
    if (browserResult.captcha) {
      await logButlerAction(userId, "autofill_captcha", serviceName, "blocked", {
        action,
        screenshotUrl: browserResult.screenshotUrl,
      });
      return {
        success: false,
        status: "captcha",
        message: "CAPTCHA detected. Please solve it manually. Screenshot attached.",
        screenshotUrl: browserResult.screenshotUrl,
        sessionId: browserResult.sessionId,
      };
    }

    // 7. Handle 2FA
    if (browserResult.requires2fa) {
      const twoFaKey = `butler:2fa:${userId}:${serviceName}`;
      await redisSet(twoFaKey, JSON.stringify({
        sessionId: browserResult.sessionId,
        action,
        startedAt: new Date().toISOString(),
      }), 90);

      await logButlerAction(userId, "autofill_2fa", serviceName, "awaiting_2fa", {
        action,
        sessionId: browserResult.sessionId,
      });

      return {
        success: false,
        status: "awaiting_2fa",
        message: "2FA required. Please provide the code within 90 seconds.",
        expiresIn: 90,
        sessionId: browserResult.sessionId,
      };
    }

    // 8. Success
    await logButlerAction(userId, "autofill_complete", serviceName, "success", {
      action,
      url,
      result: browserResult.result,
    });

    return {
      success: true,
      status: "completed",
      message: `Action "${action}" completed on ${serviceName}.`,
      sessionId: browserResult.sessionId,
    };
  } catch (err) {
    await logButlerAction(userId, "autofill_error", serviceName, "error", {
      action,
      error: (err as Error).message,
    });

    return {
      success: false,
      status: "error",
      message: `Autofill failed: ${(err as Error).message}`,
    };
  } finally {
    await releaseConcurrencySlot(serviceName);
  }
}

// -- Browser Agent bridge --

interface BrowserAgentResult {
  captcha: boolean;
  requires2fa: boolean;
  screenshotUrl?: string;
  sessionId?: string;
  result?: string;
}

async function callBrowserAgent(params: {
  url: string;
  action: string;
  steps: string[];
  login: string;
  password: string;
  details: Record<string, any>;
}): Promise<BrowserAgentResult> {
  try {
    const res = await fetch(`${BROWSER_AGENT_URL}/bb/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "butler_autofill",
        url: params.url,
        steps: params.steps,
        credentials: {
          login: params.login,
          password: params.password,
        },
        details: params.details,
      }),
      signal: AbortSignal.timeout(55000), // 55s to stay under route 60s
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      throw new Error(`Browser Agent returned ${res.status}: ${errText}`);
    }

    const data = await res.json() as Record<string, any>;

    return {
      captcha: data.captcha === true,
      requires2fa: data.requires2fa === true,
      screenshotUrl: data.screenshotUrl ?? undefined,
      sessionId: data.sessionId ?? undefined,
      result: data.result ?? "Action completed",
    };
  } catch (err) {
    if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") {
      throw new Error("Browser action timed out after 55 seconds");
    }
    throw err;
  }
}
