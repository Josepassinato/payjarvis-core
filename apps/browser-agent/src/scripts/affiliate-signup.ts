/**
 * Affiliate Auto-Signup Scripts
 *
 * Automated registration flows for partner developer portals.
 * Each script navigates the partner portal, creates an application,
 * and pauses for human approval via Telegram before finalizing.
 *
 * Usage: /affiliate <partner>
 * Example: /affiliate ifood
 */

import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import {
  createSession,
  getSessionLiveURLs,
  closeSession,
  isConfigured,
} from "../services/browserbase-client.js";

// ─── Types ───────────────────────────────────────────

export interface AffiliateSignupResult {
  status: "COMPLETED" | "NEEDS_HANDOFF" | "FAILED";
  partner: string;
  sessionId: string;
  liveViewURL?: string;
  credentials?: {
    clientId?: string;
    clientSecret?: string;
    merchantId?: string;
    notes?: string;
  };
  error?: string;
}

// ─── iFood Developer Portal Signup ──────────────────

async function signupIFood(
  page: Page,
  sessionId: string
): Promise<AffiliateSignupResult> {
  console.log("[AffiliateSignup] Starting iFood developer portal signup...");

  // 1. Navigate to iFood developer portal
  await page.goto("https://developer.ifood.com.br", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // 2. Check if login is required
  const needsLogin =
    (await page.$('input[type="email"]')) !== null ||
    (await page.$('input[type="password"]')) !== null ||
    page.url().includes("/login") ||
    page.url().includes("/signin");

  if (needsLogin) {
    // Hand off to human for login
    let liveViewURL: string | undefined;
    try {
      const urls = await getSessionLiveURLs(sessionId);
      liveViewURL = urls.debuggerFullscreenUrl;
    } catch {
      // ignore
    }

    return {
      status: "NEEDS_HANDOFF",
      partner: "ifood",
      sessionId,
      liveViewURL,
      credentials: {
        notes:
          "Login required at developer.ifood.com.br — please log in, then the script will continue to create the application and capture credentials.",
      },
    };
  }

  // 3. Look for "Create Application" or similar button
  const createBtn = await page.$(
    'button:has-text("Criar"), button:has-text("Create"), a:has-text("Criar aplicativo"), a:has-text("New Application")'
  );

  if (createBtn) {
    console.log("[AffiliateSignup] Found create button, clicking...");
    await createBtn.click();
    await page.waitForTimeout(2000);
  }

  // 4. Take screenshot for Telegram approval
  const screenshot = await page.screenshot({ type: "png" });

  // 5. Try to extract any visible credentials
  const pageText = await page.evaluate(() => document.body.innerText || "");

  let clientId: string | undefined;
  let clientSecret: string | undefined;

  // Look for Client ID patterns
  const clientIdMatch = pageText.match(
    /Client\s*ID[:\s]*([a-f0-9-]{36}|[a-zA-Z0-9_-]{20,})/i
  );
  if (clientIdMatch) clientId = clientIdMatch[1];

  // Look for Client Secret patterns
  const secretMatch = pageText.match(
    /Client\s*Secret[:\s]*([a-f0-9-]{36}|[a-zA-Z0-9_-]{20,})/i
  );
  if (secretMatch) clientSecret = secretMatch[1];

  // 6. Get live view URL for manual review
  let liveViewURL: string | undefined;
  try {
    const urls = await getSessionLiveURLs(sessionId);
    liveViewURL = urls.debuggerFullscreenUrl;
  } catch {
    // ignore
  }

  return {
    status: "NEEDS_HANDOFF",
    partner: "ifood",
    sessionId,
    liveViewURL,
    credentials: {
      clientId,
      clientSecret,
      notes: [
        "iFood Developer Portal opened.",
        "Steps remaining:",
        "1. Accept Terms of Use if prompted",
        "2. Create application (name: PayJarvis)",
        "3. Copy Client ID + Client Secret",
        "4. Set env vars: IFOOD_CLIENT_ID, IFOOD_CLIENT_SECRET",
        "",
        "Note: iFood merchant API is for POS/restaurant management.",
        "Consumer orders will use Layer 4 (Browserbase).",
      ].join("\n"),
    },
  };
}

// ─── Router ──────────────────────────────────────────

const SIGNUP_HANDLERS: Record<
  string,
  (page: Page, sessionId: string) => Promise<AffiliateSignupResult>
> = {
  ifood: signupIFood,
};

// ─── Main Entry Point ────────────────────────────────

export async function affiliateSignup(
  partner: string
): Promise<AffiliateSignupResult> {
  const normalizedPartner = partner.toLowerCase().trim();

  const handler = SIGNUP_HANDLERS[normalizedPartner];
  if (!handler) {
    return {
      status: "FAILED",
      partner: normalizedPartner,
      sessionId: "",
      error: `No signup handler for partner: ${partner}. Available: ${Object.keys(SIGNUP_HANDLERS).join(", ")}`,
    };
  }

  if (!isConfigured()) {
    return {
      status: "FAILED",
      partner: normalizedPartner,
      sessionId: "",
      error:
        "Browserbase is not configured (missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID)",
    };
  }

  let browser: Browser | null = null;
  let sessionId = "";

  try {
    // Create Browserbase session
    const session = await createSession({
      keepAlive: true,
      timeout: 600, // 10 min — signup flows take time
      browserSettings: { blockAds: true },
    });

    sessionId = session.sessionId;
    console.log(
      `[AffiliateSignup] Session created: ${sessionId} for partner: ${normalizedPartner}`
    );

    // Connect Playwright
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    const page = context?.pages()[0] ?? (await context.newPage());

    // Run partner-specific handler
    const result = await handler(page, sessionId);

    // Don't close session on NEEDS_HANDOFF — human needs it
    if (result.status !== "NEEDS_HANDOFF") {
      await browser.close();
      try {
        await closeSession(sessionId);
      } catch {
        // ignore
      }
    } else {
      // Disconnect Playwright but keep cloud session alive
      await browser.close();
    }

    return result;
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error during signup";
    console.error(`[AffiliateSignup] Error:`, err);

    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    if (sessionId) {
      try {
        await closeSession(sessionId);
      } catch {
        // ignore
      }
    }

    return {
      status: "FAILED",
      partner: normalizedPartner,
      sessionId,
      error: errorMessage,
    };
  }
}
