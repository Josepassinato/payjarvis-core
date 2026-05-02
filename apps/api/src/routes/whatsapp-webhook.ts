/**
 * WhatsApp Webhook Routes — Twilio Production (REST API, no TwiML)
 *
 * Receives WhatsApp messages via Twilio webhook, validates X-Twilio-Signature,
 * processes through Jarvis AI (Gemini), and responds via Twilio REST API.
 *
 * Supports both text and audio (voice) messages:
 * - Text: processed as before via processWhatsAppMessage()
 * - Audio: downloaded from Twilio, transcribed via Gemini STT,
 *   processed as text, then response sent as text + audio (TTS)
 *
 * Endpoint: POST /webhook/whatsapp
 * Content-Type: application/x-www-form-urlencoded (Twilio sends form data)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";
import { processWhatsAppMessage, processWhatsAppImageMessage, isImageResponseSuppressed } from "../services/jarvis-whatsapp.service.js";
import twilio from "twilio";
const { validateRequest } = twilio;
import { sendWhatsAppMessage, sendWhatsAppAudio, sendWhatsAppDocument, sendWhatsAppReaction, getTwilioCredentials } from "../services/twilio-whatsapp.service.js";
import { transcribeAudio, textToSpeech, cleanupFiles } from "../services/audio/index.js";
import { downloadAudio, downloadAudioAsBase64, convertToWav, cleanupFile } from "../services/audio/index.js";
import { readFileSync, existsSync } from "fs";
import { detectPromise, detectResult, registerPromise, fulfillPromise } from "../services/watchdog/promise-tracker.js";

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL || "https://www.payjarvis.com/webhook/whatsapp";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || "https://www.payjarvis.com";

// ─── Temp audio file store (in-memory, short-lived) ───
const audioStore = new Map<string, { path: string; createdAt: number }>();

// ─── Temp document file store (in-memory, 5 min TTL) ───
const docStore = new Map<string, { path: string; mimeType: string; filename: string; createdAt: number }>();

// Cleanup expired audio + doc files every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of audioStore) {
    if (now - entry.createdAt > 120_000) { // 2 min TTL
      cleanupFile(entry.path);
      audioStore.delete(id);
    }
  }
  for (const [id, entry] of docStore) {
    if (now - entry.createdAt > 300_000) { // 5 min TTL
      cleanupFile(entry.path);
      docStore.delete(id);
    }
  }
}, 60_000);

// Export docStore for use by other services
export { docStore };

/**
 * Detect language from WhatsApp phone number (heuristic).
 */
function detectLangFromPhone(from: string): string {
  if (from.includes("+55")) return "pt";
  if (from.includes("+34") || from.includes("+52") || from.includes("+54") || from.includes("+56") || from.includes("+57") || from.includes("+51")) return "es";
  if (from.includes("+33")) return "fr";
  return "en";
}

// ─── Greeting detection for instant cached responses ───
const GREETING_PATTERNS: Record<string, RegExp> = {
  pt: /^(oi|ol[áa]|bom dia|boa tarde|boa noite|e a[íi]|fala|salve|hey|opa)[\s!?.]*$/i,
  en: /^(hi|hello|hey|good morning|good afternoon|good evening|yo|sup|what'?s up)[\s!?.]*$/i,
  es: /^(hola|buenos d[íi]as|buenas tardes|buenas noches|hey|qu[ée] tal)[\s!?.]*$/i,
};

const GREETING_RESPONSES: Record<string, string> = {
  pt: "Olá! Sou o Sniffer, seu farejador de ofertas 🐕 Como posso te ajudar hoje?",
  en: "Hello! I'm Sniffer, your deal-hunting agent 🐕 How can I help you today?",
  es: "¡Hola! Soy Sniffer, tu cazador de ofertas 🐕 ¿En qué puedo ayudarte hoy?",
};

// Pre-generated greeting audio cache (populated lazily on first use)
const greetingAudioCache = new Map<string, string>(); // lang → oggPath
let greetingCacheReady = false;

async function ensureGreetingCache() {
  if (greetingCacheReady) return;
  greetingCacheReady = true; // Set immediately to prevent concurrent init
  for (const [lang, text] of Object.entries(GREETING_RESPONSES)) {
    try {
      const oggPath = await textToSpeech(text, lang);
      if (oggPath) greetingAudioCache.set(lang, oggPath);
    } catch { /* non-blocking — will just skip cache for this lang */ }
  }
  console.log(`[WhatsApp Audio] Greeting cache ready: ${greetingAudioCache.size} languages`);
}

function isGreeting(text: string, lang: string): boolean {
  const pattern = GREETING_PATTERNS[lang] || GREETING_PATTERNS.en;
  return pattern.test(text.trim());
}

// ─── Content-type to MIME type map for Gemini STT ───
const AUDIO_MIME_MAP: Record<string, string> = {
  "audio/ogg": "audio/ogg",
  "audio/opus": "audio/ogg",
  "audio/mpeg": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/amr": "audio/amr",
  "audio/aac": "audio/aac",
};

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.register(async function whatsappPlugin(fastify) {
    // Parse form-urlencoded (Twilio webhook format)
    fastify.addContentTypeParser(
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

    // GET /api/docs/temp/:id — serve temporary document files for Twilio mediaUrl
    fastify.get("/api/docs/temp/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const entry = docStore.get(id);

      if (!entry || !existsSync(entry.path)) {
        return reply.status(404).send({ error: "Document not found or expired" });
      }

      const buffer = readFileSync(entry.path);
      return reply
        .header("Content-Type", entry.mimeType)
        .header("Content-Disposition", `inline; filename="${entry.filename}"`)
        .header("Content-Length", buffer.length)
        .send(buffer);
    });

    // GET /api/audio/temp/:id — serve temporary audio files for Twilio mediaUrl
    fastify.get("/api/audio/temp/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const entry = audioStore.get(id);

      if (!entry || !existsSync(entry.path)) {
        return reply.status(404).send({ error: "Audio not found or expired" });
      }

      const buffer = readFileSync(entry.path);
      return reply.header("Content-Type", "audio/ogg").header("Content-Length", buffer.length).send(buffer);
    });

    // POST /api/whatsapp/send — internal endpoint for sending WhatsApp messages (reminders, proactive)
    fastify.post("/api/whatsapp/send", async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = request.headers["x-bot-api-key"] as string;
      const internalSecret = request.headers["x-internal-secret"] as string;
      const validApiKey = process.env.BOT_API_KEY || process.env.PAYJARVIS_API_KEY || "";
      const validSecret = process.env.INTERNAL_SECRET || "";

      if (apiKey !== validApiKey && internalSecret !== validSecret) {
        return reply.status(401).send({ error: "unauthorized" });
      }

      const { to, body: messageBody } = request.body as { to: string; body: string };
      if (!to || !messageBody) {
        return reply.status(400).send({ error: "missing 'to' and 'body'" });
      }

      try {
        const sid = await sendWhatsAppMessage(to, messageBody);
        return reply.send({ success: true, sid });
      } catch (err) {
        console.error("[WA SEND] Error:", (err as Error).message);
        return reply.status(500).send({ error: (err as Error).message });
      }
    });

    // POST /webhook/whatsapp — receives messages from Twilio
    fastify.post("/webhook/whatsapp", async (request: FastifyRequest, reply: FastifyReply) => {
      // Rate limit: 30 messages per minute per phone number
      const { webhookRateLimiter } = await import("../middleware/rate-limiter.js");
      await webhookRateLimiter(request, reply);
      if (reply.sent) return;

      const body = request.body as Record<string, string>;
      const from = body.From || "";       // e.g. "whatsapp:+19546432431"
      const botNumber = body.To || "";    // e.g. "whatsapp:+17547145921" — which Jarvis number received
      const text = (body.Body || "").trim();
      const profileName = body.ProfileName || "";
      const messageSid = body.MessageSid || "";

      // ─── Auto-detect language from USER number (BR sender single, hotfix 2026-04-29) ───
      // Antes: bot tinha 2 números (BR/US). Agora só US. Inferimos PT pelo telefone do USER.
      const isBrNumber = from.startsWith("whatsapp:+55");
      if (isBrNumber) {
        // Set PT-BR as default for users contacting via BR number (async, non-blocking)
        (async () => {
          try {
            const existing = await prisma.$queryRaw<{ fact_value: string }[]>`
              SELECT fact_value FROM openclaw_user_facts
              WHERE user_id = ${from} AND fact_key = 'language' LIMIT 1
            `;
            // Only set if user has no language preference yet
            if (existing.length === 0) {
              await prisma.$executeRaw`
                INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, confidence)
                VALUES (${from}, 'language', 'pt-BR', 'personal', 'bot_number_detection', 0.8)
                ON CONFLICT (user_id, fact_key) DO NOTHING
              `;
              await prisma.$executeRaw`
                INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, confidence)
                VALUES (${from}, 'preferred_language', 'Portuguese', 'personal', 'bot_number_detection', 0.8)
                ON CONFLICT (user_id, fact_key) DO NOTHING
              `;
              await prisma.$executeRaw`
                INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, confidence)
                VALUES (${from}, 'bot_number', ${botNumber}, 'general', 'auto', 0.9)
                ON CONFLICT (user_id, fact_key) DO UPDATE SET fact_value = ${botNumber}
              `;
              request.log.info({ from, botNumber }, "[WhatsApp] Auto-set language to pt-BR (BR number)");
            }
          } catch { /* non-blocking */ }
        })();
      }

      const numMedia = parseInt(body.NumMedia || "0", 10);
      const mediaUrl0 = body.MediaUrl0 || "";
      const mediaContentType0 = body.MediaContentType0 || "";

      // Validate X-Twilio-Signature
      if (TWILIO_AUTH_TOKEN) {
        const signature = request.headers["x-twilio-signature"] as string;
        if (!signature || !validateRequest(TWILIO_AUTH_TOKEN, signature, WEBHOOK_URL, body)) {
          request.log.warn({ from, signature: !!signature }, "[WhatsApp] Invalid Twilio signature — rejected");
          return reply.status(403).send({ error: "Invalid signature" });
        }
      }

      // ─── ACK rápido com ampulheta animada ──────────────────────────────
      // Envia GIF de ampulheta como sinal "estou trabalhando" antes de processar.
      // Fire-and-forget pra não atrasar a resposta 200 ao Twilio.
      const HOURGLASS_URL = `${BASE_URL}/public/loading-hourglass.gif`;
      sendWhatsAppDocument(from, HOURGLASS_URL).catch(err => {
        request.log.debug({ err: err?.message, from }, "[WhatsApp] hourglass ack failed (non-blocking)");
      });

      const isAudio = numMedia > 0 && mediaContentType0.startsWith("audio/");
      const isImage = numMedia > 0 && mediaContentType0.startsWith("image/");
      const latitude = body.Latitude || "";
      const longitude = body.Longitude || "";
      const isLocation = !!(latitude && longitude);

      // Check for a second media item (e.g. photo + audio in same message)
      const mediaUrl1 = body.MediaUrl1 || "";
      const mediaContentType1 = body.MediaContentType1 || "";

      request.log.info(
        { from, profileName, messageSid, text: text.substring(0, 80), numMedia, isAudio, isImage, isLocation, mediaContentType0 },
        "[WhatsApp] Incoming message"
      );
      console.log(`[DEBUG-WH] Incoming: from=${from} text="${text.substring(0, 40)}" numMedia=${numMedia} isImage=${isImage} isAudio=${isAudio} contentType0=${mediaContentType0}`);

      // Respond 200 immediately to Twilio (prevents 15s timeout retry)
      reply.status(200).send({ status: "processing" });

      // ─── WhatsApp Trial Paywall ───
      try {
        const { checkWhatsAppAccess, sendTrialExpiredMessage } = await import("../services/trial.service.js");
        // Resolve user by phone
        const cleanPhone = from.replace("whatsapp:", "");
        const trialUser = await prisma.user.findFirst({
          where: { OR: [{ phone: cleanPhone }, { phone: cleanPhone.replace("+", "") }] },
          select: { id: true },
        });
        if (trialUser) {
          const { allowed, status } = await checkWhatsAppAccess(trialUser.id, cleanPhone);
          if (!allowed && status.trialExpired) {
            await sendTrialExpiredMessage(cleanPhone);
            return;
          }
        }
        // No user found = new user, let through (onboarding will create trial)
      } catch (err) {
        request.log.error({ err: (err as Error).message }, "[WhatsApp] Trial check error — allowing through");
        // Fail open — don't block messages on trial service errors
      }

      // ─── Location message handling ───
      if (isLocation) {
        try {
          const { saveWhatsAppLocation } = await import("../services/jarvis-whatsapp.service.js");
          await saveWhatsAppLocation(from, parseFloat(latitude), parseFloat(longitude));
          const lang = detectLangFromPhone(from);
          const msgs: Record<string, string> = {
            pt: "📍 Localização salva! Agora posso buscar restaurantes, hotéis e eventos perto de você.",
            es: "📍 ¡Ubicación guardada! Ahora puedo buscar restaurantes, hoteles y eventos cerca de ti.",
            en: "📍 Location saved! Now I can search for restaurants, hotels, and events near you.",
          };
          await sendWhatsAppMessage(from, msgs[lang] || msgs.en, botNumber);
        } catch (err) {
          request.log.error({ err: (err as Error).message, from }, "[WhatsApp] Location save error");
        }
        return;
      }

      // ─── Send reaction emoji on the original message (non-blocking) ───
      const sendProcessingReaction = () => {
        if (messageSid) {
          sendWhatsAppReaction(from, messageSid, "🎧", botNumber).catch(() => {});
        }
      };

      // ─── Image message handling (with optional audio or caption) ───
      if (isImage && mediaUrl0) {
        sendProcessingReaction();
        try {
          await processImageMessage(from, mediaUrl0, mediaContentType0, text, request, {
            audioUrl: isAudio ? mediaUrl0 : (mediaContentType1.startsWith("audio/") ? mediaUrl1 : ""),
            audioContentType: isAudio ? mediaContentType0 : (mediaContentType1.startsWith("audio/") ? mediaContentType1 : ""),
          }, botNumber);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          request.log.error({ err: msg, from }, "[WhatsApp Image] Processing error");
          try {
            await sendWhatsAppMessage(from, "Erro ao processar imagem. Tente novamente.", botNumber);
          } catch { /* silent */ }
        }
        return;
      }

      // ─── Audio + Image combo (audio is first media, image is second) ───
      if (isAudio && mediaContentType1.startsWith("image/") && mediaUrl1) {
        sendProcessingReaction();
        try {
          await processImageMessage(from, mediaUrl1, mediaContentType1, text, request, {
            audioUrl: mediaUrl0,
            audioContentType: mediaContentType0,
          }, botNumber);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          request.log.error({ err: msg, from }, "[WhatsApp Image+Audio] Processing error");
          try {
            await sendWhatsAppMessage(from, "Erro ao processar. Tente novamente.", botNumber);
          } catch { /* silent */ }
        }
        return;
      }

      // ─── Audio message handling ───
      if (isAudio && mediaUrl0) {
        sendProcessingReaction();
        try {
          await processAudioMessage(from, mediaUrl0, mediaContentType0, request, botNumber);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          request.log.error({ err: msg, from }, "[WhatsApp Audio] Processing error");
          try {
            await sendWhatsAppMessage(from, "Erro ao processar áudio. Tente novamente.", botNumber);
          } catch { /* silent */ }
        }
        return;
      }

      // ─── Recommendation feedback via text (before AI processing) ───
      if (text) {
        const lowerText = text.toLowerCase().trim();
        // Check for "stop recommendations" patterns
        const stopPatterns = ["parar dicas", "para dicas", "stop tips", "chega de dicas", "não manda mais dica", "stop recommendations"];
        const isStop = stopPatterns.some(p => lowerText.includes(p));
        if (isStop) {
          try {
            const cleanPhone = from.replace("whatsapp:", "");
            const recUser = await prisma.user.findFirst({
              where: { OR: [{ phone: cleanPhone }, { phone: cleanPhone.replace("+", "") }] },
              select: { id: true },
            });
            if (recUser) {
              await prisma.userNotificationPreferences.upsert({
                where: { userId: recUser.id },
                create: { userId: recUser.id, recommendations: false },
                update: { recommendations: false },
              });
              const lang = detectLangFromPhone(from);
              const msg = lang === "pt"
                ? "Ok! Pausei as dicas de produtos. Se quiser reativar, me diz 'ativar dicas'."
                : "OK! Product tips paused. Say 'enable tips' to reactivate.";
              await sendWhatsAppMessage(from, msg, botNumber);
              return;
            }
          } catch { /* fall through to normal processing */ }
        }

        // Check for "enable recommendations" patterns
        const enablePatterns = ["ativar dicas", "ativa dicas", "enable tips", "quero dicas"];
        const isEnable = enablePatterns.some(p => lowerText.includes(p));
        if (isEnable) {
          try {
            const cleanPhone = from.replace("whatsapp:", "");
            const recUser = await prisma.user.findFirst({
              where: { OR: [{ phone: cleanPhone }, { phone: cleanPhone.replace("+", "") }] },
              select: { id: true },
            });
            if (recUser) {
              await prisma.userNotificationPreferences.upsert({
                where: { userId: recUser.id },
                create: { userId: recUser.id, recommendations: true },
                update: { recommendations: true },
              });
              const lang = detectLangFromPhone(from);
              const msg = lang === "pt"
                ? "🐕 Dicas reativadas! Vou farejar as melhores ofertas pra você."
                : "🐕 Tips reactivated! I'll sniff out the best deals for you.";
              await sendWhatsAppMessage(from, msg, botNumber);
              return;
            }
          } catch { /* fall through */ }
        }
      }

      // ─── Text message handling (original flow) ───
      if (!text) return;

      sendProcessingReaction();
      try {
        const rawResponseText = await processWhatsAppMessage(from, text, botNumber);
        if (rawResponseText) {
          const responseText = rawResponseText.replace(/\[FORMAT:(TEXT|AUDIO)\]\s*/gi, '').trim();
          await sendWhatsAppMessage(from, responseText, botNumber);

          // Watchdog: track promises and fulfillments (non-blocking)
          (async () => {
            try {
              // If this response contains actual results, fulfill any pending promise
              if (detectResult(responseText)) {
                await fulfillPromise(from);
              }
              // If this response contains a promise pattern, register it
              if (detectPromise(responseText)) {
                await registerPromise(from, "whatsapp", responseText, text.substring(0, 100));
              }
            } catch (err) {
              console.error("[WATCHDOG] Promise tracking error:", (err as Error).message);
            }
          })();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        request.log.error({ err: msg, from }, "[WhatsApp] Processing error");
        try {
          await sendWhatsAppMessage(from, "Erro ao processar. Tente novamente.", botNumber);
        } catch { /* silent */ }
      }
    });

    // POST /webhook/whatsapp/status — delivery status callbacks
    fastify.post("/webhook/whatsapp/status", async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const messageSid = body.MessageSid || "";
      const status = body.MessageStatus || "";
      const to = body.To || "";
      const errorCode = body.ErrorCode || "";

      if (errorCode) {
        request.log.warn({ messageSid, status, to, errorCode, errorMessage: body.ErrorMessage }, "[WhatsApp] Delivery error");
      } else {
        request.log.info({ messageSid, status, to }, "[WhatsApp] Status update");
      }

      return reply.status(200).send({ status: "ok" });
    });

    // GET /webhook/whatsapp — health check
    fastify.get("/webhook/whatsapp", async (_request, reply) => {
      return reply.send({ status: "ok", channel: "whatsapp", provider: "twilio", mode: "production", audio: true });
    });

    // ─── TEMPORARY: Meta WhatsApp Verification Call Handler ───
    // Answers incoming voice calls, records them, and sends transcription to admin Telegram
    fastify.all("/webhook/meta-verify", async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body || {}) as Record<string, string>;
      const callSid = body.CallSid || "unknown";
      const from = body.From || "unknown";
      const digits = body.Digits || "";
      const speechResult = body.SpeechResult || "";
      const recordingUrl = body.RecordingUrl || "";
      const transcriptionText = body.TranscriptionText || "";

      request.log.info({ callSid, from, digits, speechResult, recordingUrl, transcriptionText }, "[META-VERIFY] Incoming");

      // If we got speech recognition result, log and notify
      if (speechResult) {
        request.log.info(`[META-VERIFY] SPEECH RESULT: ${speechResult}`);
        try {
          const { sendTelegramNotification } = await import("../services/notifications.js");
          const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
          if (adminChatId) {
            await sendTelegramNotification(adminChatId, `🔐 META VERIFICATION (speech): ${speechResult}\nFrom: ${from}\nCall: ${callSid}`);
          }
        } catch { /* best effort */ }
      }

      // If we got digits (DTMF), log them immediately
      if (digits) {
        request.log.info(`[META-VERIFY] DIGITS RECEIVED: ${digits}`);
        // Send to admin Telegram
        try {
          const { sendTelegramNotification } = await import("../services/notifications.js");
          const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
          if (adminChatId) {
            await sendTelegramNotification(adminChatId, `🔐 META VERIFICATION CODE (DTMF): ${digits}\nFrom: ${from}\nCall: ${callSid}`);
          }
        } catch { /* best effort */ }
      }

      // If transcription came back, send it
      if (transcriptionText) {
        request.log.info(`[META-VERIFY] TRANSCRIPTION: ${transcriptionText}`);
        try {
          const { sendTelegramNotification } = await import("../services/notifications.js");
          const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
          if (adminChatId) {
            await sendTelegramNotification(adminChatId, `🔐 META VERIFICATION (transcription): ${transcriptionText}\nFrom: ${from}`);
          }
        } catch { /* best effort */ }
      }

      // If recording URL, send it
      if (recordingUrl) {
        request.log.info(`[META-VERIFY] RECORDING: ${recordingUrl}`);
        try {
          const { sendTelegramNotification } = await import("../services/notifications.js");
          const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
          if (adminChatId) {
            await sendTelegramNotification(adminChatId, `🎙️ META VERIFICATION RECORDING: ${recordingUrl}.mp3\nFrom: ${from}`);
          }
        } catch { /* best effort */ }
      }

      // Return TwiML: Record from second 0 — capture EVERYTHING Meta says
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record maxLength="120" transcribe="true" transcribeCallback="https://www.payjarvis.com/webhook/meta-verify" playBeep="false" trim="do-not-trim" action="https://www.payjarvis.com/webhook/meta-verify" method="POST"/>
</Response>`;

      return reply.type("text/xml").send(twiml);
    });
  });
}

// ─── Optimized Audio processing pipeline ───
// Improvements over original:
// 1. Skip WAV conversion — send OGG/native format directly to Gemini STT
// 2. Download as buffer (no temp file for STT path)
// 3. Greeting cache — instant response for "oi", "hello", etc.
// 4. Detailed per-stage metrics

async function processAudioMessage(
  from: string,
  mediaUrl: string,
  contentType: string,
  request: FastifyRequest,
  botNumber?: string,
) {
  const t0 = Date.now();
  const { accountSid, authToken } = getTwilioCredentials();
  const lang = detectLangFromPhone(from);
  const mimeType = AUDIO_MIME_MAP[contentType] || "audio/ogg";

  // Ensure greeting cache is ready (lazy init, non-blocking after first call)
  ensureGreetingCache();

  request.log.info({ from, contentType, mimeType }, "[WhatsApp Audio] Processing...");

  // ─── Step 1: Download audio directly as buffer (skip temp file + WAV conversion) ───
  const audioBuffer = await downloadAudioAsBase64(mediaUrl, accountSid, authToken);
  const audioBase64 = audioBuffer.toString("base64");
  const tDownload = Date.now();

  // ─── Step 2: Transcribe via Gemini (native format — no WAV conversion needed) ───
  const transcription = await transcribeAudio(audioBase64, mimeType);
  const tSTT = Date.now();

  if (!transcription) {
    await sendWhatsAppMessage(from, "Não consegui entender o áudio. Pode repetir?", botNumber);
    request.log.warn({ from, downloadMs: tDownload - t0, sttMs: tSTT - tDownload }, "[WhatsApp Audio] STT failed");
    return;
  }

  request.log.info(
    { from, transcription: transcription.substring(0, 100), downloadMs: tDownload - t0, sttMs: tSTT - tDownload },
    "[WhatsApp Audio] Transcribed"
  );

  // ─── Step 2.5: Greeting shortcut — instant cached response ───
  if (isGreeting(transcription, lang)) {
    const cachedOgg = greetingAudioCache.get(lang);
    if (cachedOgg && existsSync(cachedOgg)) {
      const audioId = `greet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // Copy cached file reference (don't delete — it's permanent cache)
      audioStore.set(audioId, { path: cachedOgg, createdAt: Date.now() + 600_000 }); // Long TTL for cache
      const audioUrl = `${BASE_URL}/api/audio/temp/${audioId}`;
      await sendWhatsAppAudio(from, audioUrl, botNumber);
      const totalMs = Date.now() - t0;
      request.log.info(
        { from, totalMs, downloadMs: tDownload - t0, sttMs: tSTT - tDownload, cached: true },
        "[WhatsApp Audio] Greeting — cached response sent"
      );
      return;
    }
  }

  // ─── Step 3: Process transcription through Jarvis LLM ───
  const rawResponse = await processWhatsAppMessage(from, `[voice] ${transcription}`);
  const tLLM = Date.now();

  if (!rawResponse) return;

  // ─── Step 3.5: Determine response format (TEXT vs AUDIO) ───
  const { format, text: responseText } = parseResponseFormat(rawResponse);
  const sendAsAudio = format === "AUDIO";

  request.log.info(
    { from, format, sendAsAudio, hasFormatTag: rawResponse !== responseText },
    "[WhatsApp Audio] Format decision"
  );

  if (!sendAsAudio) {
    // ─── LLM chose TEXT format — send as text message ───
    await sendWhatsAppMessage(from, responseText, botNumber);
    const tSend = Date.now();
    request.log.info(
      {
        from, lang, totalMs: tSend - t0,
        downloadMs: tDownload - t0,
        sttMs: tSTT - tDownload,
        llmMs: tLLM - tSTT,
        sendMs: tSend - tLLM,
      },
      "[WhatsApp Audio] Complete — text sent (FORMAT:TEXT)"
    );
    return;
  }

  // ─── Step 4: TTS — convert response to audio (only for casual/short responses) ───
  let audioSent = false;
  const oggPath = await textToSpeech(responseText, lang);
  const tTTS = Date.now();

  if (oggPath) {
    try {
      const audioId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      audioStore.set(audioId, { path: oggPath, createdAt: Date.now() });

      const audioUrl = `${BASE_URL}/api/audio/temp/${audioId}`;
      await sendWhatsAppAudio(from, audioUrl, botNumber);
      audioSent = true;

      const tSend = Date.now();
      request.log.info(
        {
          from, lang, totalMs: tSend - t0,
          downloadMs: tDownload - t0,
          sttMs: tSTT - tDownload,
          llmMs: tLLM - tSTT,
          ttsMs: tTTS - tLLM,
          sendMs: tSend - tTTS,
        },
        "[WhatsApp Audio] Complete — audio sent (FORMAT:AUDIO)"
      );
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, "[WhatsApp Audio] TTS send failed, falling back to text");
      cleanupFiles(oggPath);
    }
  }

  // Fallback: send text only if audio failed
  if (!audioSent) {
    request.log.info({ from }, "[WhatsApp Audio] TTS unavailable — sending text fallback");
    await sendWhatsAppMessage(from, responseText, botNumber);
  }
}

// ─── Response Format Parser ───
// Parses [FORMAT:TEXT] or [FORMAT:AUDIO] tag from LLM response.
// Falls back to content-based heuristic when no tag is present.
function parseResponseFormat(response: string): { format: "TEXT" | "AUDIO"; text: string } {
  // Check for explicit LLM format tag
  const tagMatch = response.match(/^\[FORMAT:(TEXT|AUDIO)\]\s*/i);
  if (tagMatch) {
    return {
      format: tagMatch[1].toUpperCase() as "TEXT" | "AUDIO",
      text: response.slice(tagMatch[0].length),
    };
  }

  // Fallback heuristic: analyze content to decide
  if (shouldForceText(response)) {
    return { format: "TEXT", text: response };
  }

  // Short casual responses → audio
  return { format: "AUDIO", text: response };
}

// Content-based heuristic: returns true if response should be sent as text
function shouldForceText(text: string): boolean {
  // Has prices ($, R$, USD, BRL, €)
  if (/[\$€£]|\d+[.,]\d{2}|R\$|USD|BRL|EUR/i.test(text)) return true;

  // Has URLs or links
  if (/https?:\/\/|www\.|\.com|\.br|\.org/i.test(text)) return true;

  // Has list markers (numbered or bulleted, 3+ items)
  const listItems = text.match(/(?:^|\n)\s*(?:\d+[.)]\s|[-•*]\s)/g);
  if (listItems && listItems.length >= 3) return true;

  // Has emoji-numbered lists (1️⃣, 2️⃣, etc.)
  const emojiList = text.match(/[1-9]️⃣/g);
  if (emojiList && emojiList.length >= 3) return true;

  // Too long for audio (more than ~150 words or 3 lines)
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 3) return true;
  if (text.split(/\s+/).length > 150) return true;

  // Has table-like structure
  if (/\|.*\|.*\|/.test(text)) return true;

  // Has technical data patterns (percentages, measurements)
  const numberMatches = text.match(/\d+/g);
  if (numberMatches && numberMatches.length >= 5) return true;

  return false;
}

// ─── Image processing pipeline ───

async function processImageMessage(
  from: string,
  imageMediaUrl: string,
  imageContentType: string,
  caption: string,
  request: FastifyRequest,
  audio: { audioUrl: string; audioContentType: string },
  botNumber?: string,
) {
  const { accountSid, authToken } = getTwilioCredentials();

  request.log.info({ from, imageContentType, hasCaption: !!caption, hasAudio: !!audio.audioUrl }, "[WhatsApp Image] Processing...");

  // 1. Download image from Twilio
  const headers: Record<string, string> = {};
  if (accountSid && authToken) {
    headers["Authorization"] = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }
  const imgRes = await fetch(imageMediaUrl, { headers, signal: AbortSignal.timeout(30000) });
  if (!imgRes.ok) {
    throw new Error(`Failed to download image: HTTP ${imgRes.status}`);
  }
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const imageBase64 = imgBuffer.toString("base64");

  request.log.info({ from, imageSize: imgBuffer.length }, "[WhatsApp Image] Downloaded");

  // 2. If audio accompanies the image, transcribe it (optimized — skip WAV)
  let userText = caption || "";
  if (audio.audioUrl) {
    try {
      const audioBuf = await downloadAudioAsBase64(audio.audioUrl, accountSid, authToken);
      const audioMime = AUDIO_MIME_MAP[audio.audioContentType] || "audio/ogg";
      const transcription = await transcribeAudio(audioBuf.toString("base64"), audioMime);
      if (transcription) {
        userText = userText ? `${userText} — ${transcription}` : transcription;
        request.log.info({ from, transcription: transcription.substring(0, 100) }, "[WhatsApp Image] Audio transcribed");
      }
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, "[WhatsApp Image] Audio transcription failed, proceeding with image only");
    }
  }

  // 3. Process image through Gemini Vision via jarvis-whatsapp service (with 60s safety timeout)
  const mimeType = imageContentType || "image/jpeg";
  const IMAGE_PIPELINE_TIMEOUT_MS = 60_000;
  const imgStart = Date.now();

  console.log(`[DEBUG-IMG] 1. Image received from ${from}, size=${imgBuffer.length}, caption="${userText.substring(0, 60)}"`);

  let responseText: string;
  try {
    console.log(`[DEBUG-IMG] 2. Calling processWhatsAppImageMessage...`);
    const processingPromise = processWhatsAppImageMessage(from, imageBase64, mimeType, userText);
    const timeoutPromise = new Promise<string>((resolve) =>
      setTimeout(() => {
        console.log(`[DEBUG-IMG] TIMEOUT! Pipeline exceeded ${IMAGE_PIPELINE_TIMEOUT_MS}ms. Sending fallback.`);
        resolve("A análise da imagem demorou mais que o esperado. Me diz o nome do produto que eu busco pra você! 🐕");
      }, IMAGE_PIPELINE_TIMEOUT_MS)
    );
    responseText = await Promise.race([processingPromise, timeoutPromise]);
    console.log(`[DEBUG-IMG] 3. Got response (${Date.now() - imgStart}ms): "${responseText.substring(0, 150)}..."`);
  } catch (err) {
    console.log(`[DEBUG-IMG] ERROR! Pipeline threw: ${(err as Error).message}`);
    request.log.error({ err: (err as Error).message, from }, "[WhatsApp Image] Pipeline error");
    responseText = "Erro ao processar a imagem. Tenta mandar de novo ou me diz o que procura! 🐕";
  }

  if (responseText) {
    // Check if the text handler already merged image context + text and will deliver the answer
    if (isImageResponseSuppressed(from)) {
      console.log(`[DEBUG-IMG] 4. SUPPRESSED — text handler already merged image+text and will respond. Skipping image response.`);
    } else {
      responseText = responseText.replace(/\[FORMAT:(TEXT|AUDIO)\]\s*/gi, '').trim();
      console.log(`[DEBUG-IMG] 4. Sending response to WhatsApp (${responseText.length} chars)...`);
      try {
        await sendWhatsAppMessage(from, responseText, botNumber);
        console.log(`[DEBUG-IMG] 5. Response SENT to ${from} (total ${Date.now() - imgStart}ms)`);
      } catch (sendErr) {
        console.error(`[DEBUG-IMG] SEND FAILED: ${(sendErr as Error).message}`);
      }
    }
  } else {
    console.error(`[DEBUG-IMG] NO RESPONSE TEXT! Pipeline returned empty/null.`);
  }
}
