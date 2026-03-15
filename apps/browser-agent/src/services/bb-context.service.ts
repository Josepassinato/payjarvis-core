/**
 * Browserbase Context Service
 *
 * Central service for Browserbase Context management.
 * Context persists cookies indefinitely — one per user per store.
 * Sessions open temporarily for actions and close immediately after.
 */

import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright-core";

// ─── Singleton ───────────────────────────────────────

let _client: Browserbase | null = null;

function getClient(): Browserbase {
  if (!_client) {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) throw new Error("BROWSERBASE_API_KEY is not set");
    _client = new Browserbase({ apiKey });
  }
  return _client;
}

function getProjectId(): string {
  const id = process.env.BROWSERBASE_PROJECT_ID;
  if (!id) throw new Error("BROWSERBASE_PROJECT_ID is not set");
  return id;
}

// ─── Login status selectors per store ────────────────

const LOGIN_SELECTORS: Record<string, (page: Page) => Promise<{ loggedIn: boolean; userName?: string }>> = {
  amazon: async (page) => {
    const url = page.url();
    // Still on login/verification pages — not logged in yet
    if (url.includes("/ap/signin") || url.includes("/ap/cvf") || url.includes("/ap/mfa")) {
      return { loggedIn: false };
    }
    const result = await page.evaluate(() => {
      // Primary: check account nav element
      const el = document.querySelector("#nav-link-accountList-nav-line-1");
      const text = el?.textContent?.trim() ?? "";
      if (text.length > 0 && !text.includes("Sign in") && !text.includes("Hello, sign in") && !text.includes("Olá, faça seu login")) {
        const userName = text.replace("Hello,", "").replace("Olá,", "").trim();
        return { loggedIn: true, userName: userName || undefined };
      }
      // Fallback: check for sign-out link (present only when logged in)
      const hasSignOut = !!document.querySelector("#nav-item-signout, a[href*='sign-out'], a[href*='logout']");
      return { loggedIn: hasSignOut };
    });
    return result;
  },
  walmart: async (page) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector(".account-text, [data-automation-id='account-flyout'] span");
      const text = el?.textContent?.trim() ?? "";
      const loggedIn = text.length > 0 && !text.toLowerCase().includes("sign in");
      return { loggedIn, userName: loggedIn ? text : undefined };
    });
    return result;
  },
  target: async (page) => {
    const result = await page.evaluate(() => {
      const signInBtn = document.querySelector("[data-test='accountNav-signIn'], a[href*='/account/sign-in']");
      const loggedIn = !signInBtn;
      const nameEl = document.querySelector("[data-test='accountNav-greeting'], .AccountLink__name");
      const userName = nameEl?.textContent?.trim() || undefined;
      return { loggedIn, userName };
    });
    return result;
  },
};

async function defaultLoginCheck(page: Page): Promise<{ loggedIn: boolean; userName?: string }> {
  const result = await page.evaluate(() => {
    const body = document.body?.innerHTML?.toLowerCase() ?? "";
    const hasLogout = body.includes("logout") || body.includes("sign out") || body.includes("log out");
    const hasAccount = body.includes("my account") || body.includes("my profile");
    return { loggedIn: hasLogout || hasAccount };
  });
  return result;
}

// ─── Public API ──────────────────────────────────────

/**
 * Create a new Browserbase Context (persists cookies indefinitely).
 * Called when user connects a new store for the first time.
 */
export async function createContext(): Promise<{ bbContextId: string }> {
  const client = getClient();
  const projectId = getProjectId();

  const t0 = Date.now();
  console.log("[bb-context] Creating Browserbase context...");
  const context = await client.contexts.create({ projectId });
  console.log(`[bb-context] Context created in ${Date.now() - t0}ms — id=${context.id}`);

  return { bbContextId: context.id };
}

/**
 * Open a temporary session using an existing Context.
 * Browser opens with persisted cookies — if user already logged in, stays authenticated.
 * Navigates automatically to storeUrl.
 */
export async function openSession(
  bbContextId: string,
  storeUrl: string,
  purpose?: string,
): Promise<{
  bbSessionId: string;
  liveUrl: string;
  page: Page;
  browser: Browser;
}> {
  const client = getClient();
  const projectId = getProjectId();
  const apiKey = process.env.BROWSERBASE_API_KEY!;
  const totalStart = Date.now();

  // keepAlive=true for login sessions so iframe stays alive after CDP disconnect
  const isLoginSession = purpose === "login";
  const t1 = Date.now();
  console.log(`[bb-context] openSession(purpose=${purpose}) — Creating BB session for context=${bbContextId.slice(0,8)}... keepAlive=${isLoginSession}`);
  const session = await client.sessions.create({
    projectId,
    browserSettings: { context: { id: bbContextId, persist: true } },
    keepAlive: isLoginSession,
    timeout: 1800, // 30 min max
  });
  const bbSessionId = session.id;
  console.log(`[bb-context] BB session created in ${Date.now() - t1}ms — sessionId=${bbSessionId.slice(0,8)}`);

  // Connect via Playwright CDP
  const t2 = Date.now();
  console.log(`[bb-context] Connecting via CDP...`);
  const connectUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${bbSessionId}`;
  const browser = await chromium.connectOverCDP(connectUrl);
  const defaultContext = browser.contexts()[0];
  const page = defaultContext.pages()[0] || (await defaultContext.newPage());
  console.log(`[bb-context] CDP connected in ${Date.now() - t2}ms`);

  // Navigate to store
  const t3 = Date.now();
  console.log(`[bb-context] Navigating to ${storeUrl}...`);
  await page.goto(storeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log(`[bb-context] Navigation completed in ${Date.now() - t3}ms`);

  // Get live URL
  const t4 = Date.now();
  const liveUrls = await client.sessions.debug(bbSessionId);
  const liveUrl = liveUrls.debuggerFullscreenUrl;
  console.log(`[bb-context] Live URL fetched in ${Date.now() - t4}ms — url=${liveUrl?.slice(0, 60)}...`);
  console.log(`[bb-context] openSession TOTAL: ${Date.now() - totalStart}ms (purpose=${purpose})`);

  return { bbSessionId, liveUrl, page, browser };
}

/**
 * Close session and release browser. ALWAYS call after finishing.
 */
export async function closeSession(
  bbSessionId: string,
  browser: Browser,
): Promise<void> {
  const t0 = Date.now();
  console.log(`[bb-context] Closing session ${bbSessionId.slice(0,8)}...`);
  try {
    await browser.close();
  } catch {
    // Silently ignore — browser may already be closed
  }

  try {
    const client = getClient();
    await client.sessions.update(bbSessionId, { status: "REQUEST_RELEASE" });
  } catch {
    // Silently ignore — session may already be released
  }
  console.log(`[bb-context] Session closed in ${Date.now() - t0}ms`);
}

/**
 * Check if the current page is authenticated in the store.
 */
export async function checkLoginStatus(
  page: Page,
  store: string,
): Promise<{ loggedIn: boolean; userName?: string }> {
  const t0 = Date.now();
  console.log(`[bb-context] Checking login status for store=${store}...`);
  const checker = LOGIN_SELECTORS[store] ?? defaultLoginCheck;
  try {
    const result = await checker(page);
    console.log(`[bb-context] Login check completed in ${Date.now() - t0}ms — loggedIn=${result.loggedIn}, userName=${result.userName ?? 'N/A'}`);
    return result;
  } catch (err) {
    console.error(`[bb-context] Login check FAILED in ${Date.now() - t0}ms — error=${err instanceof Error ? err.message : err}`);
    return { loggedIn: false };
  }
}

/**
 * Get live URL for a session (fullscreen view for iframe).
 */
export async function getLiveUrl(bbSessionId: string): Promise<string> {
  const client = getClient();
  const liveUrls = await client.sessions.debug(bbSessionId);
  return liveUrls.debuggerFullscreenUrl;
}

/**
 * Delete a Context from Browserbase (when user disconnects a store).
 */
export async function deleteContext(bbContextId: string): Promise<void> {
  try {
    const client = getClient();
    await client.contexts.delete(bbContextId);
  } catch {
    // Silently ignore
  }
}
