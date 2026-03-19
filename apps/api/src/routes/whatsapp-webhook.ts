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
import { processWhatsAppMessage } from "../services/jarvis-whatsapp.service.js";
import twilio from "twilio";
const { validateRequest } = twilio;
import { sendWhatsAppMessage, sendWhatsAppAudio, getTwilioCredentials } from "../services/twilio-whatsapp.service.js";
import { transcribeAudio, textToSpeech, cleanupFiles } from "../services/audio/index.js";
import { downloadAudio, convertToWav, cleanupFile } from "../services/audio/index.js";
import { readFileSync, existsSync } from "fs";

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL || "https://www.payjarvis.com/webhook/whatsapp";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || "https://www.payjarvis.com";

// ─── Temp audio file store (in-memory, short-lived) ───
const audioStore = new Map<string, { path: string; createdAt: number }>();

// Cleanup expired audio files every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of audioStore) {
    if (now - entry.createdAt > 120_000) { // 2 min TTL
      cleanupFile(entry.path);
      audioStore.delete(id);
    }
  }
}, 60_000);

/**
 * Detect language from WhatsApp phone number (heuristic).
 */
function detectLangFromPhone(from: string): string {
  if (from.includes("+55")) return "pt";
  if (from.includes("+34") || from.includes("+52") || from.includes("+54") || from.includes("+56") || from.includes("+57") || from.includes("+51")) return "es";
  if (from.includes("+33")) return "fr";
  return "en";
}

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

    // POST /webhook/whatsapp — receives messages from Twilio
    fastify.post("/webhook/whatsapp", async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const from = body.From || "";       // e.g. "whatsapp:+19546432431"
      const text = (body.Body || "").trim();
      const profileName = body.ProfileName || "";
      const messageSid = body.MessageSid || "";
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

      const isAudio = numMedia > 0 && mediaContentType0.startsWith("audio/");

      request.log.info(
        { from, profileName, messageSid, text: text.substring(0, 80), numMedia, isAudio, mediaContentType0 },
        "[WhatsApp] Incoming message"
      );

      // Respond 200 immediately to Twilio (prevents 15s timeout retry)
      reply.status(200).send({ status: "processing" });

      // ─── Audio message handling ───
      if (isAudio && mediaUrl0) {
        try {
          await processAudioMessage(from, mediaUrl0, mediaContentType0, request);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          request.log.error({ err: msg, from }, "[WhatsApp Audio] Processing error");
          try {
            await sendWhatsAppMessage(from, "Erro ao processar áudio. Tente novamente.");
          } catch { /* silent */ }
        }
        return;
      }

      // ─── Text message handling (original flow) ───
      if (!text) return;

      try {
        const responseText = await processWhatsAppMessage(from, text);
        if (responseText) {
          await sendWhatsAppMessage(from, responseText);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        request.log.error({ err: msg, from }, "[WhatsApp] Processing error");
        try {
          await sendWhatsAppMessage(from, "Erro ao processar. Tente novamente.");
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
  });
}

// ─── Audio processing pipeline ───

async function processAudioMessage(
  from: string,
  mediaUrl: string,
  contentType: string,
  request: FastifyRequest
) {
  const startTime = Date.now();
  const { accountSid, authToken } = getTwilioCredentials();

  // 1. Determine file extension from content type
  const extMap: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "audio/aac": "aac",
  };
  const ext = extMap[contentType] || "ogg";

  request.log.info({ from, contentType, ext }, "[WhatsApp Audio] Downloading...");

  // 2. Download audio from Twilio
  const audioPath = await downloadAudio(mediaUrl, ext, accountSid, authToken);

  try {
    // 3. Convert to WAV for STT
    const wavPath = await convertToWav(audioPath);
    cleanupFile(audioPath);

    try {
      // 4. Transcribe via Gemini
      const wavBase64 = readFileSync(wavPath).toString("base64");
      cleanupFile(wavPath);

      const transcription = await transcribeAudio(wavBase64, "audio/wav");
      if (!transcription) {
        await sendWhatsAppMessage(from, "Não consegui entender o áudio. Pode repetir?");
        return;
      }

      const sttMs = Date.now() - startTime;
      request.log.info({ from, transcription: transcription.substring(0, 100), sttMs }, "[WhatsApp Audio] Transcribed");

      // 5. Process transcription through normal Jarvis flow
      const responseText = await processWhatsAppMessage(from, `[voice] ${transcription}`);
      if (!responseText) return;

      // 6. Send text response
      await sendWhatsAppMessage(from, responseText);

      // 7. Generate TTS and send audio response
      const lang = detectLangFromPhone(from);
      const oggPath = await textToSpeech(responseText, lang);
      if (oggPath) {
        try {
          // Store audio temporarily and serve via public URL
          const audioId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
          audioStore.set(audioId, { path: oggPath, createdAt: Date.now() });

          const audioUrl = `${BASE_URL}/api/audio/temp/${audioId}`;
          await sendWhatsAppAudio(from, audioUrl);

          const totalMs = Date.now() - startTime;
          request.log.info({ from, sttMs, totalMs, lang }, "[WhatsApp Audio] Complete — text + audio sent");
        } catch (err) {
          // Audio send failed — text was already sent, just log
          request.log.warn({ err: (err as Error).message }, "[WhatsApp Audio] TTS send failed (text was sent)");
          cleanupFiles(oggPath);
        }
      }
    } catch (err) {
      cleanupFile(wavPath);
      throw err;
    }
  } catch (err) {
    cleanupFile(audioPath);
    throw err;
  }
}
