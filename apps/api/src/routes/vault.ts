/**
 * Vault Routes — Encrypted session management
 *
 * POST   /api/vault/amazon/connect      — Start Amazon login flow
 * POST   /api/vault/amazon/connect-link  — Generate JWT link for Telegram users
 * GET    /api/vault/amazon/status/:userId — Check session status
 * POST   /api/vault/amazon/verify/:userId — Verify session is still valid
 * DELETE /api/vault/amazon/disconnect/:userId — Remove session
 * GET    /api/vault/sessions/:userId     — List all connected providers
 */

import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import {
  saveSession,
  getSession,
  deleteSession,
  listSessions,
  verifySession,
} from "../services/vault/vault.service.js";

const VAULT_LINK_SECRET =
  process.env.VAULT_ENCRYPTION_KEY ?? crypto.randomBytes(32).toString("hex");
const WEB_URL = process.env.WEB_URL ?? "https://www.payjarvis.com";

function generateConnectToken(userId: string): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  const payload = JSON.stringify({
    userId,
    purpose: "amazon-connect",
    exp: expiresAt.getTime(),
  });
  const signature = crypto
    .createHmac("sha256", VAULT_LINK_SECRET)
    .update(payload)
    .digest("hex");
  const token = Buffer.from(payload).toString("base64url") + "." + signature;
  return { token, expiresAt: expiresAt.toISOString() };
}

export function verifyConnectToken(token: string): { userId: string } | null {
  try {
    const [payloadB64, signature] = token.split(".");
    if (!payloadB64 || !signature) return null;

    const payload = Buffer.from(payloadB64, "base64url").toString();
    const expectedSig = crypto
      .createHmac("sha256", VAULT_LINK_SECRET)
      .update(payload)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const data = JSON.parse(payload);
    if (data.purpose !== "amazon-connect") return null;
    if (Date.now() > data.exp) return null;

    return { userId: data.userId };
  } catch {
    return null;
  }
}

const BROWSER_AGENT_URL =
  process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";

export async function vaultRoutes(app: FastifyInstance) {
  // ── Generate connect link for Telegram users ────────
  app.post("/api/vault/amazon/connect-link", async (request, reply) => {
    const body = request.body as { userId?: string };

    if (!body?.userId) {
      return reply
        .status(400)
        .send({ success: false, error: "userId is required" });
    }

    const { token, expiresAt } = generateConnectToken(body.userId);

    return reply.send({
      success: true,
      data: {
        url: `${WEB_URL}/connect/amazon?token=${token}`,
        expiresAt,
      },
    });
  });

  // ── Verify a connect token (for frontend) ──────────
  app.post("/api/vault/amazon/verify-token", async (request, reply) => {
    const body = request.body as { token?: string };

    if (!body?.token) {
      return reply
        .status(400)
        .send({ success: false, error: "token is required" });
    }

    const result = verifyConnectToken(body.token);
    if (!result) {
      return reply.status(401).send({
        success: false,
        error: "Invalid or expired token",
      });
    }

    return reply.send({
      success: true,
      data: { userId: result.userId },
    });
  });

  // ── Automated Amazon login (email+password → cookies) ─
  app.post("/api/vault/amazon/login", async (request, reply) => {
    const body = request.body as {
      userId?: string;
      email?: string;
      password?: string;
    };

    if (!body?.userId || !body?.email || !body?.password) {
      return reply.status(400).send({
        success: false,
        error: "userId, email, and password are required",
      });
    }

    // SECURITY: never log credentials
    request.log.info({ userId: body.userId }, "[VAULT] Amazon login requested");

    try {
      const loginRes = await fetch(`${BROWSER_AGENT_URL}/amazon-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: body.email,
          password: body.password,
        }),
        signal: AbortSignal.timeout(90_000),
      });

      const loginData = (await loginRes.json()) as {
        success: boolean;
        status?: string;
        sessionId?: string;
        data?: { cookies: object[]; cookieCount: number; userAgent: string };
        error?: string;
        obstacle?: string;
        message?: string;
        step?: string;
        screenshot?: string;
      };

      // NEEDS_HUMAN: verification required, session stays open
      if (loginData.status === "NEEDS_HUMAN" && loginData.sessionId) {
        request.log.info(
          { userId: body.userId, obstacle: loginData.obstacle, sessionId: loginData.sessionId },
          "[VAULT] Amazon login needs human verification"
        );

        return reply.status(202).send({
          success: false,
          status: "NEEDS_HUMAN",
          sessionId: loginData.sessionId,
          obstacle: loginData.obstacle,
          message: loginData.message,
          screenshot: loginData.screenshot,
        });
      }

      if (!loginData.success) {
        return reply.status(loginRes.status).send({
          success: false,
          error: loginData.error ?? "Login failed",
          obstacle: loginData.obstacle,
          step: loginData.step,
        });
      }

      // Direct success — save cookies
      const result = await saveSession({
        userId: body.userId,
        provider: "amazon",
        cookies: loginData.data!.cookies,
        userAgent: loginData.data!.userAgent,
      });

      request.log.info(
        { userId: body.userId, cookieCount: loginData.data!.cookieCount },
        "[VAULT] Amazon session saved via login"
      );

      return reply.send({
        success: true,
        data: {
          ...result,
          cookieCount: loginData.data!.cookieCount,
          message: "Amazon account connected successfully.",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login flow failed";
      request.log.error(err, "[VAULT] amazon login error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Poll login session status (used after NEEDS_HUMAN) ─
  app.get("/api/vault/amazon/login-status/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const res = await fetch(`${BROWSER_AGENT_URL}/amazon-login/status/${sessionId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as {
        success: boolean;
        status: string;
        data?: { cookies: object[]; cookieCount: number; userAgent: string };
        error?: string;
      };

      // If completed, save cookies to vault
      if (data.success && data.status === "completed" && data.data) {
        const userId = (request.query as any).userId;
        if (userId) {
          await saveSession({
            userId,
            provider: "amazon",
            cookies: data.data.cookies,
            userAgent: data.data.userAgent,
          });

          request.log.info(
            { userId, cookieCount: data.data.cookieCount },
            "[VAULT] Amazon session saved after human verification"
          );

          return reply.send({
            success: true,
            status: "completed",
            message: "Amazon account connected successfully.",
          });
        }
      }

      return reply.status(res.status).send(data);
    } catch {
      return reply.status(500).send({ success: false, error: "Failed to check login status" });
    }
  });

  // ── Submit verification input (OTP/CAPTCHA) ────────
  app.post("/api/vault/amazon/login-input/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { text?: string; submit?: boolean };

    try {
      const res = await fetch(`${BROWSER_AGENT_URL}/amazon-login/input/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      return reply.status(res.status).send(data);
    } catch {
      return reply.status(500).send({ success: false, error: "Failed to submit input" });
    }
  });

  // ── Get screenshot of current login session ────────
  app.get("/api/vault/amazon/login-screenshot/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const res = await fetch(`${BROWSER_AGENT_URL}/amazon-login/screenshot/${sessionId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return reply.status(res.status).send(data);
    } catch {
      return reply.status(500).send({ success: false, error: "Failed to get screenshot" });
    }
  });

  // ── Start Amazon login flow (legacy/CDP browser) ────
  app.post("/api/vault/amazon/connect", async (request, reply) => {
    const body = request.body as { userId?: string };

    if (!body?.userId) {
      return reply
        .status(400)
        .send({ success: false, error: "userId is required" });
    }

    try {
      // Navigate to Amazon login page via browser-agent
      const navRes = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const navData = (await navRes.json()) as {
        success: boolean;
        url?: string;
        error?: string;
      };

      if (!navData.success) {
        return reply.status(500).send({
          success: false,
          error: navData.error ?? "Failed to open Amazon login",
        });
      }

      // Return the session URL so user can log in
      // The frontend/bot will poll /api/vault/amazon/capture to check login status
      return reply.send({
        success: true,
        data: {
          sessionUrl: navData.url,
          userId: body.userId,
          message:
            "Amazon login page opened. Complete login, then call POST /api/vault/amazon/capture to save session.",
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start login flow";
      request.log.error(err, "[VAULT] connect error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Capture cookies after user logs in ──────────────
  app.post("/api/vault/amazon/capture", async (request, reply) => {
    const body = request.body as { userId?: string };

    if (!body?.userId) {
      return reply
        .status(400)
        .send({ success: false, error: "userId is required" });
    }

    try {
      // Extract cookies from current browser session via CDP
      const extractRes = await fetch(`${BROWSER_AGENT_URL}/extract-cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: ".amazon.com" }),
        signal: AbortSignal.timeout(10_000),
      });

      const extractData = (await extractRes.json()) as {
        success: boolean;
        cookies?: object[];
        userAgent?: string;
        error?: string;
      };

      if (
        !extractData.success ||
        !extractData.cookies ||
        extractData.cookies.length === 0
      ) {
        return reply.status(400).send({
          success: false,
          error: "No Amazon cookies found. User may not be logged in yet.",
        });
      }

      // Check for session cookie that indicates login
      const sessionCookie = (extractData.cookies as any[]).find(
        (c) => c.name === "session-id" || c.name === "at-main" || c.name === "sess-at-main"
      );

      if (!sessionCookie) {
        return reply.status(400).send({
          success: false,
          error: "Amazon session cookie not found. Login may not be complete.",
        });
      }

      // Save encrypted session to vault
      const result = await saveSession({
        userId: body.userId,
        provider: "amazon",
        cookies: extractData.cookies,
        userAgent: extractData.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      });

      return reply.send({
        success: true,
        data: {
          ...result,
          message: "Amazon session saved securely.",
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to capture session";
      request.log.error(err, "[VAULT] capture error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Check session status ────────────────────────────
  app.get("/api/vault/amazon/status/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const session = await getSession(userId, "amazon");

    if (!session) {
      return reply.send({
        success: true,
        data: { connected: false },
      });
    }

    return reply.send({
      success: true,
      data: {
        connected: session.isValid,
        lastVerified: session.lastVerified,
        expiresAt: session.expiresAt,
      },
    });
  });

  // ── Verify session is still valid ───────────────────
  app.post("/api/vault/amazon/verify/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const result = await verifySession(userId, "amazon");

    return reply.send({
      success: true,
      data: { valid: result.valid, error: result.error },
    });
  });

  // ── Disconnect Amazon ───────────────────────────────
  app.delete("/api/vault/amazon/disconnect/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };

    await deleteSession(userId, "amazon");

    return reply.send({ success: true, data: { disconnected: true } });
  });

  // ── List all connected providers ────────────────────
  app.get("/api/vault/sessions/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const sessions = await listSessions(userId);

    return reply.send({
      success: true,
      data: sessions.map((s) => ({
        provider: s.provider,
        connected: s.isValid,
        lastVerified: s.lastVerified,
        expiresAt: s.expiresAt,
      })),
    });
  });
}
