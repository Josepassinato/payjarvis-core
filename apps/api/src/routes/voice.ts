/**
 * Voice Call Routes — Twilio Voice webhooks + API endpoints
 *
 * POST /api/voice/call            — Initiate a call (internal auth)
 * POST /api/voice/twiml/:callId   — Twilio fetches TwiML (initial script)
 * POST /api/voice/respond/:callId — Twilio sends speech result
 * POST /api/voice/next/:callId    — Twilio redirect after filler (get real response)
 * POST /api/voice/status/:callId  — Twilio status callback
 * GET  /api/voice/call/:callId    — Get call status
 * GET  /api/voice/audio/:audioId  — Serve TTS audio file
 * POST /api/voice/verify-caller   — Start caller ID verification
 * POST /api/voice/verify-confirm  — Save verified caller ID
 * POST /api/voice/contacts        — Save a contact
 * GET  /api/voice/contacts        — List contacts
 * GET  /api/voice/contacts/lookup  — Lookup contact by name
 * DELETE /api/voice/contacts/:name — Delete contact
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { readFileSync, existsSync } from "fs";
import { prisma } from "@payjarvis/database";
import twilio from "twilio";
const { validateRequest } = twilio;
import {
  makeCall,
  getInitialTwiml,
  handleResponse,
  getNextTwiml,
  handleStatusCallback,
  getCallStatus,
  getAudioFile,
  startCallerIdVerification,
  saveVerifiedCallerId,
  saveContact,
  lookupContact,
  listContacts,
  deleteContact,
  updateContact,
} from "../services/voice/twilio-voice.service.js";

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || "https://www.payjarvis.com";

export async function voiceRoutes(app: FastifyInstance) {
  // Parse form-urlencoded for Twilio webhooks
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 1048576 },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const parsed: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // ─── GET /api/voice/audio/:audioId — Serve TTS audio ───

  app.get("/api/voice/audio/:audioId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { audioId } = request.params as { audioId: string };
    const { path, exists } = getAudioFile(audioId);

    if (!exists) {
      return reply.status(404).send({ error: "Audio not found or expired" });
    }

    const buffer = readFileSync(path);
    const isWav = path.endsWith(".wav");
    const contentType = isWav ? "audio/wav" : "audio/mpeg";

    return reply
      .header("Content-Type", contentType)
      .header("Content-Length", buffer.length)
      .header("Cache-Control", "public, max-age=86400") // Cache for 24h
      .send(buffer);
  });

  // ─── POST /api/voice/call — Initiate a call ───────

  app.post("/api/voice/call", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    const apiKey = request.headers["x-bot-api-key"] as string;

    if (secret !== INTERNAL_SECRET && !apiKey) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const body = request.body as {
      userId: string;
      to: string;
      businessName?: string;
      objective: string;
      details?: string;
      language?: string;
      channel?: string;
      // Briefing fields
      callerIdentity?: string;
      targetName?: string;
      keyMessages?: string[];
      tone?: string;
      canReceiveMessages?: boolean;
      userName?: string;
    };

    if (!body.userId || !body.to || !body.objective) {
      return reply.status(400).send({ error: "Missing required fields: userId, to, objective" });
    }

    try {
      const result = await makeCall({
        userId: body.userId,
        to: body.to,
        businessName: body.businessName,
        objective: body.objective,
        details: body.details,
        language: body.language,
        channel: body.channel || "whatsapp",
        callerIdentity: body.callerIdentity,
        targetName: body.targetName,
        keyMessages: body.keyMessages,
        tone: body.tone,
        canReceiveMessages: body.canReceiveMessages,
        userName: body.userName,
      });

      return reply.send({ success: true, ...result });
    } catch (err) {
      const msg = (err as Error).message;
      request.log.error({ err: msg }, "[Voice] Call initiation failed");
      const status = msg.includes("limit") ? 429 : msg.includes("Invalid") || msg.includes("emergency") ? 400 : 500;
      return reply.status(status).send({ success: false, error: msg });
    }
  });

  // ─── POST /api/voice/twiml/:callId — Twilio fetches initial TwiML ───

  app.post("/api/voice/twiml/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const body = request.body as Record<string, string>;

    if (TWILIO_AUTH_TOKEN) {
      const signature = request.headers["x-twilio-signature"] as string;
      const url = `${BASE_URL}/api/voice/twiml/${callId}`;
      if (!signature || !validateRequest(TWILIO_AUTH_TOKEN, signature, url, body || {})) {
        request.log.warn({ callId }, "[Voice] Invalid Twilio signature on twiml");
        return reply.status(403).send("Forbidden");
      }
    }

    const answeredBy = body?.AnsweredBy || "";
    if (answeredBy === "machine_start" || answeredBy === "fax") {
      request.log.info({ callId, answeredBy }, "[Voice] Machine detected — hanging up");
      return reply
        .header("Content-Type", "text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }

    const twiml = await getInitialTwiml(callId);
    request.log.info({ callId }, "[Voice] Serving initial TwiML (pre-generated audio)");
    return reply.header("Content-Type", "text/xml").send(twiml);
  });

  app.get("/api/voice/twiml/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const twiml = await getInitialTwiml(callId);
    return reply.header("Content-Type", "text/xml").send(twiml);
  });

  // ─── POST /api/voice/respond/:callId — Callee response ───

  app.post("/api/voice/respond/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const body = request.body as Record<string, string>;

    if (TWILIO_AUTH_TOKEN) {
      const signature = request.headers["x-twilio-signature"] as string;
      const url = `${BASE_URL}/api/voice/respond/${callId}`;
      if (!signature || !validateRequest(TWILIO_AUTH_TOKEN, signature, url, body || {})) {
        request.log.warn({ callId }, "[Voice] Invalid Twilio signature on respond");
        return reply.status(403).send("Forbidden");
      }
    }

    const speechResult = body?.SpeechResult || "";
    const confidence = body?.Confidence || "0";

    if (!speechResult) {
      request.log.info({ callId }, "[Voice] No speech detected — ending call");
      return reply
        .header("Content-Type", "text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew-Neural">Thank you for your time. Goodbye.</Say><Hangup/></Response>');
    }

    request.log.info({ callId, speechResult: speechResult.substring(0, 100), confidence }, "[Voice] Processing response (filler → AI)");

    try {
      const twiml = await handleResponse(callId, speechResult, confidence);
      return reply.header("Content-Type", "text/xml").send(twiml);
    } catch (err) {
      request.log.error({ err: (err as Error).message, callId }, "[Voice] Error processing response");
      return reply
        .header("Content-Type", "text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew-Neural">I apologize, I need to go. Thank you for your time.</Say><Hangup/></Response>');
    }
  });

  // ─── POST /api/voice/next/:callId — After filler, serve real response ───

  app.post("/api/voice/next/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };

    // Skip Twilio signature validation for redirects (Twilio doesn't always sign redirects)
    try {
      const twiml = await getNextTwiml(callId);
      request.log.info({ callId }, "[Voice] Serving next TwiML (after filler)");
      return reply.header("Content-Type", "text/xml").send(twiml);
    } catch (err) {
      request.log.error({ err: (err as Error).message, callId }, "[Voice] Error getting next TwiML");
      return reply
        .header("Content-Type", "text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew-Neural">I apologize for the interruption. Thank you for your time.</Say><Hangup/></Response>');
    }
  });

  // Also support GET for redirects
  app.get("/api/voice/next/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    try {
      const twiml = await getNextTwiml(callId);
      return reply.header("Content-Type", "text/xml").send(twiml);
    } catch (err) {
      return reply
        .header("Content-Type", "text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew-Neural">Thank you for your time.</Say><Hangup/></Response>');
    }
  });

  // ─── POST /api/voice/status/:callId — Status callback ───

  app.post("/api/voice/status/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const body = request.body as Record<string, string>;

    const status = body?.CallStatus || "";
    const duration = body?.CallDuration || "";

    request.log.info({ callId, status, duration }, "[Voice] Status update");

    try {
      await handleStatusCallback(callId, status, duration || undefined);
    } catch (err) {
      request.log.error({ err: (err as Error).message, callId }, "[Voice] Status callback error");
    }

    return reply.status(200).send({ status: "ok" });
  });

  // ─── GET /api/voice/call/:callId — Get call details ───

  app.get("/api/voice/call/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { callId } = request.params as { callId: string };
    const call = await getCallStatus(callId);
    if (!call) {
      return reply.status(404).send({ error: "Call not found" });
    }
    return reply.send({ success: true, call });
  });

  // ─── Contact Management Endpoints ──────────────────

  // POST /api/voice/contacts — Save a contact
  app.post("/api/voice/contacts", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { userId, name, phone, relationship, notes } = request.body as {
      userId: string; name: string; phone: string; relationship?: string; notes?: string;
    };

    if (!userId || !name || !phone) {
      return reply.status(400).send({ error: "Missing required fields: userId, name, phone" });
    }

    try {
      const result = await saveContact(userId, name, phone, relationship, notes);
      return reply.send({ success: true, ...result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/voice/contacts — List all contacts for a user
  app.get("/api/voice/contacts", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { userId } = request.query as { userId: string };
    if (!userId) {
      return reply.status(400).send({ error: "Missing userId query param" });
    }

    try {
      const contacts = await listContacts(userId);
      return reply.send({ success: true, contacts });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/voice/contacts/lookup — Lookup contact by name
  app.get("/api/voice/contacts/lookup", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { userId, name } = request.query as { userId: string; name: string };
    if (!userId || !name) {
      return reply.status(400).send({ error: "Missing userId or name query param" });
    }

    try {
      const contact = await lookupContact(userId, name);
      if (!contact) {
        return reply.status(404).send({ success: false, error: "Contact not found" });
      }
      return reply.send({ success: true, contact });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/voice/contacts/:name — Delete contact
  app.delete("/api/voice/contacts/:name", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { name } = request.params as { name: string };
    const { userId } = request.query as { userId: string };
    if (!userId) {
      return reply.status(400).send({ error: "Missing userId query param" });
    }

    try {
      const deleted = await deleteContact(userId, name);
      return reply.send({ success: deleted, message: deleted ? "Contact deleted" : "Contact not found" });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Caller ID Verification ────────────────────────

  app.post("/api/voice/verify-caller", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { userId, phoneNumber, friendlyName } = request.body as { userId: string; phoneNumber: string; friendlyName?: string };

    if (!userId || !phoneNumber) {
      return reply.status(400).send({ error: "Missing userId or phoneNumber" });
    }

    try {
      const result = await startCallerIdVerification(userId, phoneNumber, friendlyName || "PayJarvis User");
      return reply.send({ success: true, validationCode: result.validationCode, callSid: result.callSid });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  app.post("/api/voice/verify-confirm", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (secret !== INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const { userId, phoneNumber } = request.body as { userId: string; phoneNumber: string };

    if (!userId || !phoneNumber) {
      return reply.status(400).send({ error: "Missing userId or phoneNumber" });
    }

    try {
      await saveVerifiedCallerId(userId, phoneNumber);
      return reply.send({ success: true, message: `Caller ID verified: ${phoneNumber}` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Authenticated endpoints for dashboard (Clerk JWT) ───

  app.get("/api/voice/caller-id-status", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: "unauthorized" });

    try {
      const { requireAuth } = await import("../middleware/auth.js");
      await requireAuth(request, reply);
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const userId = (request as any).userId as string;
    try {
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
        select: { verifiedCallerId: true, callerIdVerifiedAt: true, phone: true },
      });
      return reply.send({
        success: true,
        verified: !!user?.verifiedCallerId,
        verifiedNumber: user?.verifiedCallerId || null,
        verifiedAt: user?.callerIdVerifiedAt || null,
        userPhone: user?.phone || null,
      });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  app.post("/api/voice/verify-caller-id", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: "unauthorized" });

    try {
      const { requireAuth } = await import("../middleware/auth.js");
      await requireAuth(request, reply);
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const userId = (request as any).userId as string;
    const { phoneNumber, disclaimerAccepted } = request.body as { phoneNumber: string; disclaimerAccepted: boolean };

    if (!phoneNumber) return reply.status(400).send({ error: "Missing phoneNumber" });
    if (!disclaimerAccepted) return reply.status(400).send({ error: "Disclaimer must be accepted" });

    try {
      const result = await startCallerIdVerification(userId, phoneNumber, "PayJarvis User");

      await prisma.user.update({
        where: { clerkId: userId },
        data: { callerIdDisclaimerAt: new Date() },
      });

      return reply.send({ success: true, validationCode: result.validationCode });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("already verified")) {
        try {
          await prisma.user.update({
            where: { clerkId: userId },
            data: {
              verifiedCallerId: phoneNumber,
              callerIdDisclaimerAt: new Date(),
              callerIdVerifiedAt: new Date(),
            },
          });
          return reply.send({ success: true, alreadyVerified: true });
        } catch (e2) {
          return reply.status(500).send({ success: false, error: (e2 as Error).message });
        }
      }
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  app.post("/api/voice/confirm-caller-id", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: "unauthorized" });

    try {
      const { requireAuth } = await import("../middleware/auth.js");
      await requireAuth(request, reply);
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const userId = (request as any).userId as string;
    const { phoneNumber } = request.body as { phoneNumber: string };

    if (!phoneNumber) return reply.status(400).send({ error: "Missing phoneNumber" });

    try {
      await prisma.user.update({
        where: { clerkId: userId },
        data: {
          verifiedCallerId: phoneNumber,
          callerIdVerifiedAt: new Date(),
        },
      });

      return reply.send({ success: true, verifiedNumber: phoneNumber });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  app.delete("/api/voice/verified-caller-id", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: "unauthorized" });

    try {
      const { requireAuth } = await import("../middleware/auth.js");
      await requireAuth(request, reply);
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const userId = (request as any).userId as string;

    try {
      await prisma.user.update({
        where: { clerkId: userId },
        data: {
          verifiedCallerId: null,
          callerIdVerifiedAt: null,
        },
      });

      return reply.send({ success: true });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // REALTIME VOICE — Gemini Live API
  // ═══════════════════════════════════════════════════════

  // POST /api/voice/realtime-session — Create new realtime voice session
  app.post("/api/voice/realtime-session", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    let userId: string;

    // Accept both Clerk JWT and internal secret
    if (secret === process.env.INTERNAL_SECRET) {
      userId = (request.body as any)?.userId;
    } else {
      try {
        const { requireAuth } = await import("../middleware/auth.js");
        await requireAuth(request, reply);
        if (reply.sent) return;
        userId = (request as any).userId;
      } catch {
        return reply.status(401).send({ error: "Auth required" });
      }
    }

    if (!userId) return reply.status(400).send({ error: "userId required" });

    try {
      const { createRealtimeSession } = await import("../services/voice/realtime-session.service.js");
      const session = await createRealtimeSession({ userId });
      return reply.send({ success: true, ...session });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/voice/realtime-session/:sessionId/tick — Track 1 minute of usage
  app.post<{ Params: { sessionId: string } }>("/api/voice/realtime-session/:sessionId/tick", async (request, reply) => {
    try {
      const { trackRealtimeMinute } = await import("../services/voice/realtime-session.service.js");
      const result = await trackRealtimeMinute(request.params.sessionId);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ ok: false, error: (err as Error).message });
    }
  });

  // POST /api/voice/realtime-session/:sessionId/end — End session, final billing
  app.post<{ Params: { sessionId: string } }>("/api/voice/realtime-session/:sessionId/end", async (request, reply) => {
    try {
      const { endRealtimeSession } = await import("../services/voice/realtime-session.service.js");
      const result = await endRealtimeSession(request.params.sessionId);
      return reply.send({ success: true, ...result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Verification Code Capture (Meta WhatsApp) ─────────────────────
  // Answers incoming call, records audio, transcribes, sends code to José via Telegram

  app.post("/api/webhooks/capture-code", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const from = body.From || "unknown";
    console.log(`[VERIFY-CODE] Incoming call from ${from}`);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3"/>
  <Record maxLength="30" transcribe="true"
    transcribeCallback="https://www.payjarvis.com/api/webhooks/transcription-result"
    recordingStatusCallback="https://www.payjarvis.com/api/webhooks/recording-status"
    playBeep="false"/>
  <Pause length="5"/>
  <Say language="pt-BR">Obrigado.</Say>
</Response>`;

    return reply.type("text/xml").send(twiml);
  });

  app.post("/api/webhooks/transcription-result", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const text = body.TranscriptionText || "";
    console.log(`[VERIFY-CODE] Transcription: "${text}"`);

    // Extract 6-digit code
    const codeMatch = text.match(/(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)/);
    const code = codeMatch ? codeMatch[1].replace(/[\s-]/g, "") : null;

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID;

    if (code && BOT_TOKEN && CHAT_ID) {
      console.log(`[VERIFY-CODE] Code found: ${code}`);
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHAT_ID, text: `🔑 Código de verificação Meta WhatsApp: ${code}` }),
        });
        console.log(`[VERIFY-CODE] Code sent to Telegram`);
      } catch (err) {
        console.error(`[VERIFY-CODE] Failed to send to Telegram:`, (err as Error).message);
      }
    } else {
      // Send full transcription even without code match
      if (BOT_TOKEN && CHAT_ID) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHAT_ID, text: `📞 Transcrição da ligação de verificação:\n"${text}"\n\n(código não detectado automaticamente — verifique manualmente)` }),
        }).catch(() => {});
      }
    }

    return reply.status(200).send({ received: true });
  });

  app.post("/api/webhooks/recording-status", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const recordingUrl = body.RecordingUrl || "";
    const status = body.RecordingStatus || "";
    console.log(`[VERIFY-CODE] Recording ${status}: ${recordingUrl}`);

    if (recordingUrl) {
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID;
      if (BOT_TOKEN && CHAT_ID) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHAT_ID, text: `🎙️ Gravação da verificação: ${recordingUrl}.mp3` }),
        }).catch(() => {});
      }
    }

    return reply.status(200).send({ received: true });
  });
}
