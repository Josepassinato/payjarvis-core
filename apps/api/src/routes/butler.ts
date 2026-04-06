/**
 * Butler Protocol 🎩 Routes — internal API called by OpenClaw/WhatsApp bots.
 * Auth: x-internal-secret header.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import {
  setupButlerProfile,
  getButlerProfile,
  updateButlerProfile,
  saveCredential,
  getCredential,
  listCredentials,
  generateSecurePassword,
  getButlerAuditLog,
  getButlerStatus,
  logButlerAction,
} from "../services/butler/butler-protocol.service.js";
import { executeAutofill } from "../services/butler/butler-autofill.service.js";

export async function butlerRoutes(app: FastifyInstance) {

  // ─── Internal auth check ───
  function checkInternal(req: any, reply: any): boolean {
    const secret = req.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_SECRET) {
      reply.status(403).send({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  // ─── Resolve userId from chatId/phone/prismaId ───
  async function resolveUserId(rawUserId: string): Promise<string | null> {
    // If already a cuid, use directly
    if (rawUserId.startsWith("c") && rawUserId.length > 20) return rawUserId;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { telegramChatId: rawUserId },
          { phone: rawUserId.replace("whatsapp:", "") },
          { id: rawUserId },
        ],
      },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  // POST /api/butler/profile/setup
  app.post("/api/butler/profile/setup", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, data } = req.body as { userId: string; data: any };
    if (!rawId) return reply.status(400).send({ error: "userId required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    try {
      await setupButlerProfile(userId, data || {});
      const profile = await getButlerProfile(userId);
      return { success: true, profile };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/profile/get
  app.post("/api/butler/profile/get", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId } = req.body as { userId: string };
    if (!rawId) return reply.status(400).send({ error: "userId required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    const profile = await getButlerProfile(userId);
    if (!profile) return { success: false, message: "No Butler Profile. Setup required." };
    return { success: true, profile };
  });

  // POST /api/butler/profile/update
  app.post("/api/butler/profile/update", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, data } = req.body as { userId: string; data: any };
    if (!rawId) return reply.status(400).send({ error: "userId required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    try {
      await updateButlerProfile(userId, data || {});
      const profile = await getButlerProfile(userId);
      return { success: true, profile };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/credential/save
  app.post("/api/butler/credential/save", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, serviceName, serviceUrl, login, password, notes } = req.body as any;
    if (!rawId || !serviceName) return reply.status(400).send({ error: "userId and serviceName required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    try {
      const pwd = password || generateSecurePassword();
      await saveCredential(userId, { serviceName, serviceUrl: serviceUrl || `${serviceName.toLowerCase().replace(/\s/g, "")}.com`, login, password: pwd, notes });
      return { success: true, serviceName, login, passwordGenerated: !password };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/credential/get
  app.post("/api/butler/credential/get", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, serviceName } = req.body as { userId: string; serviceName: string };
    if (!rawId || !serviceName) return reply.status(400).send({ error: "userId and serviceName required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    const cred = await getCredential(userId, serviceName);
    if (!cred) return { success: false, message: `No credential found for ${serviceName}` };
    return { success: true, credential: cred };
  });

  // POST /api/butler/credentials/list
  app.post("/api/butler/credentials/list", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId } = req.body as { userId: string };
    if (!rawId) return reply.status(400).send({ error: "userId required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    const creds = await listCredentials(userId);
    return { success: true, credentials: creds, count: creds.length };
  });

  // POST /api/butler/audit
  app.post("/api/butler/audit", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, limit } = req.body as { userId: string; limit?: number };
    if (!rawId) return reply.status(400).send({ error: "userId required" });
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    const logs = await getButlerAuditLog(userId, limit);
    return { success: true, logs };
  });

  // GET /api/butler/status (admin)
  app.get("/api/butler/status", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const status = await getButlerStatus();
    return { success: true, ...status };
  });

  // ─── Autofill — browser automation via stored credentials ───

  // POST /api/butler/autofill
  app.post("/api/butler/autofill", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, serviceName, action, targetUrl, details } = req.body as {
      userId: string;
      serviceName: string;
      action: string;
      targetUrl?: string;
      details?: Record<string, any>;
    };

    if (!rawId || !serviceName || !action) {
      return reply.status(400).send({ error: "userId, serviceName, and action are required" });
    }

    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    try {
      const result = await executeAutofill({ userId, serviceName, action, targetUrl, details });
      return result;
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ─── Google OAuth (connect Gmail/Calendar/Contacts) ───

  // GET /api/butler/connect-gmail?userId=xxx — Start OAuth flow
  app.get("/api/butler/connect-gmail", async (req: any, reply) => {
    const userId = req.query?.userId as string;
    if (!userId) return reply.status(400).send({ error: "userId required" });

    const resolvedId = await resolveUserId(userId);
    if (!resolvedId) return reply.status(404).send({ error: "User not found" });

    try {
      const { getAuthUrl, isGoogleOAuthConfigured } = await import("../services/butler/google-oauth.service.js");
      if (!isGoogleOAuthConfigured()) {
        return reply.status(503).send({ error: "Google OAuth not configured on server. Admin needs to set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET." });
      }
      const url = getAuthUrl(resolvedId);
      return reply.redirect(url);
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /api/butler/gmail-callback?code=xxx&state=userId — OAuth callback
  app.get("/api/butler/gmail-callback", async (req: any, reply) => {
    const code = req.query?.code as string;
    const userId = req.query?.state as string;

    if (!code || !userId) {
      return reply.type("text/html").send("<h1>Error</h1><p>Missing authorization code. Please try again.</p>");
    }

    try {
      const { handleCallback } = await import("../services/butler/google-oauth.service.js");
      const result = await handleCallback(code, userId);

      // Send success message via Telegram/WhatsApp
      try {
        const { sendTelegramNotification } = await import("../services/notifications.js");
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
        if (user?.telegramChatId) {
          await sendTelegramNotification(user.telegramChatId,
            `✅ Gmail conectado! (${result.email})\n\nAgora eu consigo:\n📩 Ler emails de confirmação\n🔑 Pegar códigos de verificação\n📅 Ver sua agenda\n👥 Ver seus contatos\n\nPara desconectar: "Jarvis, desconecta meu Gmail" 🐕`
          );
        }
      } catch { /* non-blocking */ }

      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html><head><title>Gmail Conectado!</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:system-ui;background:#0f0f19;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
        .card{text-align:center;padding:2rem;background:#1a1a2e;border-radius:1rem;max-width:400px}
        .emoji{font-size:3rem}h1{color:#00bfff}.btn{background:#00bfff;color:#000;padding:.8rem 2rem;border-radius:.5rem;text-decoration:none;display:inline-block;margin-top:1rem;font-weight:bold}</style></head>
        <body><div class="card">
        <div class="emoji">✅🎩</div>
        <h1>Gmail Conectado!</h1>
        <p>Conta: <strong>${result.email}</strong></p>
        <p>O Jarvis agora pode ler seus emails, acessar sua agenda e contatos.</p>
        <a class="btn" href="https://www.payjarvis.com/chat">Voltar para o Jarvis</a>
        </div></body></html>
      `);
    } catch (err) {
      return reply.type("text/html").send(`
        <h1>Erro na conexão</h1><p>${(err as Error).message}</p>
        <p><a href="https://www.payjarvis.com/chat">Voltar</a></p>
      `);
    }
  });

  // POST /api/butler/disconnect-gmail
  app.post("/api/butler/disconnect-gmail", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId } = req.body as { userId: string };
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    try {
      const { disconnectGoogle } = await import("../services/butler/google-oauth.service.js");
      const result = await disconnectGoogle(userId);
      return { success: result, message: result ? "Gmail disconnected" : "No Google account connected" };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/google-status
  app.post("/api/butler/google-status", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId } = req.body as { userId: string };
    const userId = await resolveUserId(rawId);
    if (!userId) return { connected: false };

    const { isGoogleConnected } = await import("../services/butler/google-oauth.service.js");
    return isGoogleConnected(userId);
  });

  // ─── Gmail (per-user or legacy) ───

  // POST /api/butler/gmail/search
  app.post("/api/butler/gmail/search", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, query, maxResults } = req.body as any;
    const userId = await resolveUserId(rawId);
    // Check if user has Gmail connected
    const { isGoogleConnected } = await import("../services/butler/google-oauth.service.js");
    const gStatus = await isGoogleConnected(userId!);
    if (!gStatus.connected) {
      return reply.status(403).send({ error: "Gmail not connected. Say 'Jarvis, conecta meu Gmail' to connect." });
    }
    try {
      const { searchEmails } = await import("../services/butler/gmail.service.js");
      const emails = await searchEmails(query || "is:unread", maxResults || 5, userId!);
      return { success: true, emails, count: emails.length };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/gmail/read
  app.post("/api/butler/gmail/read", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, messageId } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (userId !== "cmmwp38tf000112xsd260qo6h") {
      return reply.status(403).send({ error: "Owner-only" });
    }
    try {
      const { getEmailBody, markAsRead } = await import("../services/butler/gmail.service.js");
      const body = await getEmailBody(messageId, userId!);
      await markAsRead(messageId, userId!);
      return { success: true, body: body.substring(0, 5000) };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/gmail/confirmation-link
  app.post("/api/butler/gmail/confirmation-link", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, messageId } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (userId !== "cmmwp38tf000112xsd260qo6h") {
      return reply.status(403).send({ error: "Owner-only" });
    }
    try {
      const { getConfirmationLink } = await import("../services/butler/gmail.service.js");
      const link = await getConfirmationLink(messageId);
      return { success: true, link };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // POST /api/butler/gmail/unread
  app.post("/api/butler/gmail/unread", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, maxResults } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (userId !== "cmmwp38tf000112xsd260qo6h") {
      return reply.status(403).send({ error: "Owner-only" });
    }
    try {
      const { getUnreadSummary } = await import("../services/butler/gmail.service.js");
      const emails = await getUnreadSummary(maxResults || 5, userId!);
      return { success: true, emails, count: emails.length };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // GET /api/butler/gmail/status
  app.get("/api/butler/gmail/status", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    try {
      const { isGmailConfigured } = await import("../services/butler/gmail.service.js");
      const configured = await isGmailConfigured();
      return { configured, user: configured ? process.env.GMAIL_USER : null };
    } catch (err) {
      return { configured: false, error: (err as Error).message };
    }
  });
}
