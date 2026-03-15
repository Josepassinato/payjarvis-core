/**
 * Amazon Login Routes — Automated login with human handoff
 *
 * POST /amazon-login          — Start login flow (email+password)
 * GET  /amazon-login/status/:id — Poll session: completed? needs human?
 * GET  /amazon-login/screenshot/:id — Get current page screenshot
 * POST /amazon-login/input/:id — Submit OTP/CAPTCHA text into current field
 *
 * When Amazon requests verification (CAPTCHA, 2FA, OTP):
 * - Automation STOPS immediately
 * - Session stays open for human to complete
 * - Backend polls every 2s for completion
 * - Cookies captured automatically when login succeeds
 * - Auto-cleanup after 10 min timeout
 *
 * Credentials are NEVER logged or stored.
 */

import type { FastifyInstance } from "fastify";
import { HumanBehavior } from "../human-behavior.js";
import crypto from "crypto";

// ── Types ────────────────────────────────────────────

type SendCmdFn = (
  method: string,
  params?: Record<string, unknown>
) => Promise<Record<string, unknown>>;

interface ActiveSession {
  id: string;
  ws: InstanceType<typeof import("ws").default>;
  sendCmd: SendCmdFn;
  msgId: number;
  status: "logging_in" | "needs_human" | "completed" | "failed" | "expired";
  obstacleType?: string;
  obstacleDescription?: string;
  cookies?: unknown[];
  userAgent: string;
  createdAt: number;
  cleanupTimer: ReturnType<typeof setTimeout>;
}

// Active login sessions — auto-cleaned after 10 min
const sessions = new Map<string, ActiveSession>();

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function cleanupSession(id: string) {
  const session = sessions.get(id);
  if (session) {
    clearTimeout(session.cleanupTimer);
    try { session.ws.close(); } catch { /* ignore */ }
    sessions.delete(id);
  }
}

// ── Detection helpers ────────────────────────────────

async function detectVerification(sendCmd: SendCmdFn): Promise<{
  needsHuman: boolean;
  type: string;
  description: string;
}> {
  const result = await sendCmd("Runtime.evaluate", {
    expression: `(() => {
      const url = window.location.href;
      const body = (document.body?.innerText || '').toLowerCase();

      // CAPTCHA
      if (url.includes('/errors/validateCaptcha') ||
          url.includes('ap/cvf') ||
          document.querySelector('#captchacharacters') ||
          document.querySelector('img[src*="captcha"]') ||
          body.includes('enter the characters you see below') ||
          body.includes('type the characters') ||
          body.includes('solve this puzzle')) {
        return JSON.stringify({ needsHuman: true, type: 'captcha', description: 'Amazon is showing a CAPTCHA' });
      }

      // 2FA / MFA
      if (url.includes('ap/mfa') ||
          url.includes('ap/challenge') ||
          document.querySelector('#auth-mfa-otpcode') ||
          body.includes('enter the otp') ||
          body.includes('verification code') ||
          body.includes('two-step verification') ||
          body.includes('verify your identity') ||
          body.includes('approve the notification')) {
        return JSON.stringify({ needsHuman: true, type: '2fa', description: 'Amazon is requesting verification (2FA/OTP)' });
      }

      // Email/phone verification
      if (url.includes('ap/cvf/approval') ||
          body.includes('approve the notification sent to') ||
          body.includes('we sent a notification') ||
          body.includes('check your email')) {
        return JSON.stringify({ needsHuman: true, type: 'device_approval', description: 'Amazon sent a notification to your device/email for approval' });
      }

      return JSON.stringify({ needsHuman: false, type: 'none', description: '' });
    })()`,
    returnByValue: true,
  });

  try {
    return JSON.parse((result as any)?.result?.value ?? '{"needsHuman":false,"type":"none","description":""}');
  } catch {
    return { needsHuman: false, type: "none", description: "" };
  }
}

async function isLoginCompleted(sendCmd: SendCmdFn): Promise<{
  completed: boolean;
  url: string;
}> {
  const r = await sendCmd("Runtime.evaluate", {
    expression: "window.location.href",
    returnByValue: true,
  });
  const url = (r as any)?.result?.value ?? "";

  // Login is completed when we're on amazon.com but NOT on an auth page
  const isAuthPage =
    url.includes("/ap/signin") ||
    url.includes("/ap/mfa") ||
    url.includes("/ap/challenge") ||
    url.includes("/ap/cvf") ||
    url.includes("/errors/validateCaptcha");

  const isAmazon = url.includes("amazon.com");

  return { completed: isAmazon && !isAuthPage, url };
}

// ── Background monitor ───────────────────────────────

function startMonitoring(session: ActiveSession, app: FastifyInstance) {
  const pollInterval = setInterval(async () => {
    if (session.status === "completed" || session.status === "failed" || session.status === "expired") {
      clearInterval(pollInterval);
      return;
    }

    try {
      const { completed } = await isLoginCompleted(session.sendCmd);
      if (completed) {
        clearInterval(pollInterval);
        app.log.info({ sessionId: session.id }, "[amazon-login] Login completed by user");

        // Capture cookies
        const cookies = await HumanBehavior.saveCookies(session.sendCmd);
        session.cookies = cookies;
        session.status = "completed";

        app.log.info(
          { sessionId: session.id, cookieCount: cookies.length },
          "[amazon-login] Cookies captured after human verification"
        );
      }
    } catch (err) {
      // WS might be closed — stop polling
      clearInterval(pollInterval);
      if (session.status === "needs_human") {
        session.status = "failed";
        app.log.warn({ sessionId: session.id, err }, "[amazon-login] Monitor lost connection");
      }
    }
  }, 2000);

  // Also clear polling on session cleanup
  const origCleanup = session.cleanupTimer;
  clearTimeout(origCleanup);
  session.cleanupTimer = setTimeout(() => {
    clearInterval(pollInterval);
    if (session.status === "needs_human") {
      session.status = "expired";
      app.log.info({ sessionId: session.id }, "[amazon-login] Session expired (10min timeout)");
    }
    cleanupSession(session.id);
  }, SESSION_TIMEOUT_MS);
}

// ── Route registration ───────────────────────────────

export async function amazonLoginRoutes(app: FastifyInstance) {
  // ── POST /amazon-login — Start login flow ──────────
  app.post("/amazon-login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };

    if (!body.email || !body.password) {
      return reply.status(400).send({
        success: false,
        error: "email and password are required",
      });
    }

    app.log.info("[amazon-login] Starting automated login flow");

    const cdpPort = parseInt(process.env.OPENCLAW_CDP_PORT ?? "18800", 10);

    let targets: Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
    try {
      const res = await fetch(`http://localhost:${cdpPort}/json/list`);
      targets = (await res.json()) as typeof targets;
    } catch {
      return reply.status(500).send({
        success: false,
        error: "CDP not connected. Chrome may not be running.",
      });
    }

    const pageTarget = targets.find((t) => t.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) {
      return reply.status(500).send({
        success: false,
        error: "No page target available in Chrome",
      });
    }

    const { default: WS } = await import("ws");
    const ws = new WS(pageTarget.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
      ws.on("open", () => { clearTimeout(timeout); resolve(); });
      ws.on("error", (err: Error) => { clearTimeout(timeout); reject(err); });
    });

    const sessionId = crypto.randomBytes(8).toString("hex");
    let msgIdCounter = 0;

    const sendCmd: SendCmdFn = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++msgIdCounter;
        const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
        const handler = (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            clearTimeout(timeout);
            ws.off("message", handler);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result ?? {});
          }
        };
        ws.on("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });

    const waitForLoad = () =>
      new Promise<void>((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 20000);
        const handler = (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.method === "Page.loadEventFired") {
            clearTimeout(timeout);
            ws.off("message", handler);
            if (!resolved) { resolved = true; resolve(); }
          }
        };
        ws.on("message", handler);
      });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const focusAndClear = async (selector: string) => {
      await sendCmd("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector('${selector}');
          if (el) { el.focus(); el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})); }
          return !!el;
        })()`,
        returnByValue: true,
      });
      await sleep(300 + Math.random() * 200);
    };

    const clickElement = async (selector: string) => {
      const posResult = await sendCmd("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
        })()`,
        returnByValue: true,
      });
      const pos = JSON.parse((posResult as any)?.result?.value ?? "null");
      if (pos) {
        await HumanBehavior.humanClick(sendCmd, pos.x, pos.y);
      }
      await sleep(500 + Math.random() * 300);
    };

    // Create session early so we can store it if handoff needed
    const session: ActiveSession = {
      id: sessionId,
      ws,
      sendCmd,
      msgId: msgIdCounter,
      status: "logging_in",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      createdAt: Date.now(),
      cleanupTimer: setTimeout(() => cleanupSession(sessionId), SESSION_TIMEOUT_MS),
    };

    try {
      await sendCmd("Page.enable");
      await sendCmd("Network.enable");
      await HumanBehavior.applyStealthProfile(sendCmd);

      // Step 1: Navigate to Amazon sign-in
      app.log.info("[amazon-login] Navigating to sign-in page");
      await sendCmd("Page.navigate", {
        url: "https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
      });
      await waitForLoad();
      await sleep(1500 + Math.random() * 1000);

      // Check for pre-login verification
      const preCheck = await detectVerification(sendCmd);
      if (preCheck.needsHuman) {
        session.status = "needs_human";
        session.obstacleType = preCheck.type;
        session.obstacleDescription = preCheck.description;
        sessions.set(sessionId, session);
        startMonitoring(session, app);

        app.log.info({ sessionId, obstacle: preCheck.type }, "[amazon-login] Pre-login verification detected");
        return {
          success: false,
          status: "NEEDS_HUMAN",
          sessionId,
          obstacle: preCheck.type,
          message: preCheck.description,
        };
      }

      // Step 2: Type email
      app.log.info("[amazon-login] Entering email");
      await focusAndClear("#ap_email");
      await HumanBehavior.humanType(sendCmd, body.email);
      await sleep(500 + Math.random() * 300);

      // Click Continue
      await clickElement("#continue");
      await waitForLoad();
      await sleep(1500 + Math.random() * 1000);

      // Check email result
      const emailUrl = await sendCmd("Runtime.evaluate", {
        expression: "window.location.href",
        returnByValue: true,
      });
      const currentUrl = (emailUrl as any)?.result?.value ?? "";

      // Check for verification after email
      const postEmailCheck = await detectVerification(sendCmd);
      if (postEmailCheck.needsHuman) {
        session.status = "needs_human";
        session.obstacleType = postEmailCheck.type;
        session.obstacleDescription = postEmailCheck.description;
        sessions.set(sessionId, session);
        startMonitoring(session, app);

        app.log.info({ sessionId, obstacle: postEmailCheck.type }, "[amazon-login] Post-email verification detected");
        return {
          success: false,
          status: "NEEDS_HUMAN",
          sessionId,
          obstacle: postEmailCheck.type,
          message: postEmailCheck.description,
        };
      }

      if (currentUrl.includes("/ap/signin")) {
        const hasPasswordField = await sendCmd("Runtime.evaluate", {
          expression: "!!document.querySelector('#ap_password')",
          returnByValue: true,
        });
        if (!(hasPasswordField as any)?.result?.value) {
          const errorMsg = await sendCmd("Runtime.evaluate", {
            expression: `(document.querySelector('.a-alert-content')?.textContent?.trim() || document.querySelector('#auth-error-message-box')?.textContent?.trim() || '')`,
            returnByValue: true,
          });
          const err = (errorMsg as any)?.result?.value ?? "";
          cleanupSession(sessionId);
          return reply.status(400).send({
            success: false,
            error: err || "Email not accepted by Amazon.",
            step: "email",
          });
        }
      }

      // Step 3: Type password
      app.log.info("[amazon-login] Entering password");
      await focusAndClear("#ap_password");
      await HumanBehavior.humanType(sendCmd, body.password);
      await sleep(500 + Math.random() * 300);

      // Click Sign-In
      await clickElement("#signInSubmit");
      await waitForLoad();
      await sleep(2000 + Math.random() * 1000);

      // Step 4: Check result
      const finalUrlResult = await sendCmd("Runtime.evaluate", {
        expression: "window.location.href",
        returnByValue: true,
      });
      const finalUrl = (finalUrlResult as any)?.result?.value ?? "";
      app.log.info({ url: finalUrl }, "[amazon-login] Post-login URL");

      // Check for ANY verification requirement after login
      const postLoginCheck = await detectVerification(sendCmd);
      if (postLoginCheck.needsHuman) {
        session.status = "needs_human";
        session.obstacleType = postLoginCheck.type;
        session.obstacleDescription = postLoginCheck.description;
        sessions.set(sessionId, session);
        startMonitoring(session, app);

        // Take a screenshot for context
        let screenshot: string | undefined;
        try {
          const ssResult = await sendCmd("Page.captureScreenshot", { format: "png", quality: 60 });
          screenshot = (ssResult as any)?.data;
        } catch { /* non-critical */ }

        app.log.info({ sessionId, obstacle: postLoginCheck.type }, "[amazon-login] Post-login verification detected — waiting for human");
        return {
          success: false,
          status: "NEEDS_HUMAN",
          sessionId,
          obstacle: postLoginCheck.type,
          message: postLoginCheck.description,
          screenshot,
          url: finalUrl,
        };
      }

      // Check for wrong password (still on signin page, no verification)
      if (finalUrl.includes("/ap/signin")) {
        const errorMsg = await sendCmd("Runtime.evaluate", {
          expression: `(document.querySelector('.a-alert-content')?.textContent?.trim() || document.querySelector('#auth-error-message-box')?.textContent?.trim() || '')`,
          returnByValue: true,
        });
        const err = (errorMsg as any)?.result?.value ?? "";
        cleanupSession(sessionId);

        if (err.toLowerCase().includes("password") || err.toLowerCase().includes("incorrect")) {
          return reply.status(401).send({
            success: false,
            error: "Incorrect password.",
            step: "password",
          });
        }

        return reply.status(400).send({
          success: false,
          error: err || "Login failed.",
          step: "unknown",
        });
      }

      // Step 5: Success — extract cookies
      app.log.info("[amazon-login] Login successful, extracting cookies");
      const cookies = await HumanBehavior.saveCookies(sendCmd);

      const sessionCookie = cookies.find(
        (c: any) => c.name === "session-id" || c.name === "at-main" || c.name === "sess-at-main"
      );

      cleanupSession(sessionId);

      if (!sessionCookie || cookies.length < 5) {
        return reply.status(400).send({
          success: false,
          error: "Login appeared successful but no session cookies captured.",
        });
      }

      app.log.info({ cookieCount: cookies.length }, "[amazon-login] Cookies captured");

      return {
        success: true,
        data: {
          cookies,
          cookieCount: cookies.length,
          userAgent: session.userAgent,
        },
      };
    } catch (err) {
      cleanupSession(sessionId);
      const message = err instanceof Error ? err.message : "Login flow failed";
      app.log.error({ err }, "[amazon-login] Error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── GET /amazon-login/status/:id — Poll session ────
  app.get("/amazon-login/status/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);

    if (!session) {
      return reply.status(404).send({
        success: false,
        status: "not_found",
        error: "Session not found or expired",
      });
    }

    if (session.status === "completed" && session.cookies) {
      const cookies = session.cookies;
      const userAgent = session.userAgent;
      cleanupSession(id);

      return {
        success: true,
        status: "completed",
        data: {
          cookies,
          cookieCount: (cookies as any[]).length,
          userAgent,
        },
      };
    }

    if (session.status === "expired") {
      cleanupSession(id);
      return {
        success: false,
        status: "expired",
        error: "Session expired. Please try again.",
      };
    }

    if (session.status === "failed") {
      cleanupSession(id);
      return {
        success: false,
        status: "failed",
        error: "Session failed.",
      };
    }

    // Still waiting
    const elapsed = Math.round((Date.now() - session.createdAt) / 1000);
    const remaining = Math.round((SESSION_TIMEOUT_MS - (Date.now() - session.createdAt)) / 1000);

    return {
      success: false,
      status: session.status,
      obstacle: session.obstacleType,
      message: session.obstacleDescription,
      elapsedSeconds: elapsed,
      remainingSeconds: Math.max(0, remaining),
    };
  });

  // ── GET /amazon-login/screenshot/:id ───────────────
  app.get("/amazon-login/screenshot/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);

    if (!session || session.status === "completed" || session.status === "expired") {
      return reply.status(404).send({
        success: false,
        error: "Session not found or already completed",
      });
    }

    try {
      const result = await session.sendCmd("Page.captureScreenshot", {
        format: "png",
        quality: 70,
      });
      const base64 = (result as any)?.data;

      if (!base64) {
        return reply.status(500).send({ success: false, error: "Screenshot failed" });
      }

      return {
        success: true,
        screenshot: base64,
        status: session.status,
        obstacle: session.obstacleType,
      };
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: "Failed to capture screenshot",
      });
    }
  });

  // ── POST /amazon-login/input/:id — Submit text ─────
  app.post("/amazon-login/input/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { text?: string; submit?: boolean };
    const session = sessions.get(id);

    if (!session || session.status !== "needs_human") {
      return reply.status(404).send({
        success: false,
        error: "Session not found or not waiting for input",
      });
    }

    if (!body.text) {
      return reply.status(400).send({
        success: false,
        error: "text is required",
      });
    }

    try {
      // Type the text into whatever field is currently focused
      app.log.info({ sessionId: id }, "[amazon-login] Typing human input");
      await HumanBehavior.humanType(session.sendCmd, body.text);

      // Optionally submit (press Enter or click submit button)
      if (body.submit !== false) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));

        // Try clicking known submit buttons
        await session.sendCmd("Runtime.evaluate", {
          expression: `(() => {
            const btn = document.querySelector('#auth-mfa-remember-device input[type="submit"]')
              || document.querySelector('input[type="submit"]')
              || document.querySelector('button[type="submit"]')
              || document.querySelector('#cvf-submit-otp-button');
            if (btn) btn.click();
            return !!btn;
          })()`,
          returnByValue: true,
        });

        app.log.info({ sessionId: id }, "[amazon-login] Submitted input");
      }

      return { success: true, message: "Input submitted" };
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: "Failed to submit input",
      });
    }
  });
}
