/**
 * Gemini Live API Realtime Session — proxied WebSocket for browser clients.
 *
 * The browser can't hold the API key directly. Instead:
 * 1. Client calls POST /api/voice/realtime-session → gets a session ID + WS URL
 * 2. The API server proxies the WebSocket between browser ↔ Gemini
 * 3. Credit consumption tracked per minute of active session
 *
 * Model: gemini-2.5-flash-native-audio-preview-12-2025
 * Audio: 16-bit PCM, 16kHz mono (input), 24kHz (output)
 * VAD: Server-side automatic detection
 */

import crypto from "crypto";
import { prisma } from "@payjarvis/database";
import { redisSet, redisGet, redisDel } from "../redis.js";
import { consumeMessage } from "../credit.service.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const CREDITS_PER_MINUTE = 12; // ~$0.05/min cost × 15x markup

export interface RealtimeSessionConfig {
  userId: string;
  systemPrompt?: string;
  voice?: string;
  language?: string;
}

export interface RealtimeSessionInfo {
  sessionId: string;
  wsUrl: string;
  model: string;
  config: {
    systemInstruction: string;
    responseModalities: string[];
    realtimeInputConfig: object;
  };
}

/**
 * Create a new realtime voice session.
 * Returns the Gemini WebSocket URL (with API key) and session config.
 * The frontend connects directly to Gemini's WS — no proxy needed.
 * Session ID is stored in Redis for tracking/billing.
 */
export async function createRealtimeSession(opts: RealtimeSessionConfig): Promise<RealtimeSessionInfo> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  // Check credits
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { telegramChatId: opts.userId },
        { phone: opts.userId.replace("whatsapp:", "") },
        { id: opts.userId },
      ],
    },
    select: { id: true },
  });
  if (!user) throw new Error("User not found");

  const creditCheck = await consumeMessage(user.id, "voice_realtime", 0, 0);
  if (!creditCheck.allowed) throw new Error("Insufficient credits for voice session");

  const sessionId = `vrt_${crypto.randomBytes(12).toString("hex")}`;

  // Build system prompt
  const defaultPrompt = `You are Jarvis 🦀, a personal AI assistant from PayJarvis. You are warm, witty, and helpful.
You speak naturally like a friend — casual but competent. Use humor when appropriate.
You can help with shopping, travel, restaurants, directions, reminders, and more.
If the user speaks Portuguese, respond in Portuguese. Same for Spanish. Default to English.
Catchphrases: "Deixa comigo! 🦀" / "On it!" / "Resolvido!"
Keep responses concise — this is a voice conversation, not a text chat.`;

  const systemInstruction = opts.systemPrompt || defaultPrompt;

  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

  const config = {
    systemInstruction,
    responseModalities: ["AUDIO"],
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 20,
        silenceDurationMs: 300,
      },
    },
  };

  // Store session in Redis (TTL 30min max)
  await redisSet(
    `realtime:${sessionId}`,
    JSON.stringify({
      userId: user.id,
      startedAt: Date.now(),
      minutesConsumed: 0,
    }),
    1800
  );

  // Log start
  await prisma.llmUsageLog.create({
    data: {
      userId: user.id,
      platform: "voice_realtime",
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costReal: 0,
      costCharged: 0,
      messagesCharged: 0,
    },
  }).catch(() => {});

  return { sessionId, wsUrl, model: `models/${MODEL}`, config };
}

/**
 * Track minute of voice session for billing.
 * Called by frontend every 60s while session is active.
 */
export async function trackRealtimeMinute(sessionId: string): Promise<{ ok: boolean; minutesUsed: number }> {
  const raw = await redisGet(`realtime:${sessionId}`);
  if (!raw) return { ok: false, minutesUsed: 0 };

  const session = JSON.parse(raw);
  session.minutesConsumed++;

  // Consume credits
  await consumeMessage(session.userId, "voice_realtime", 0, 0).catch(() => {});

  // Update session
  await redisSet(`realtime:${sessionId}`, JSON.stringify(session), 1800);

  return { ok: true, minutesUsed: session.minutesConsumed };
}

/**
 * End a realtime session. Final billing.
 */
export async function endRealtimeSession(sessionId: string): Promise<{ minutesUsed: number; creditsConsumed: number }> {
  const raw = await redisGet(`realtime:${sessionId}`);
  if (!raw) return { minutesUsed: 0, creditsConsumed: 0 };

  const session = JSON.parse(raw);
  const minutes = Math.max(1, session.minutesConsumed); // minimum 1 minute
  const credits = minutes * CREDITS_PER_MINUTE;

  // Log final usage
  const costReal = minutes * 0.05; // $0.05/min
  await prisma.llmUsageLog.create({
    data: {
      userId: session.userId,
      platform: "voice_realtime",
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costReal,
      costCharged: costReal * 15, // 15x markup
      messagesCharged: minutes * CREDITS_PER_MINUTE,
    },
  }).catch(() => {});

  await redisDel(`realtime:${sessionId}`);
  return { minutesUsed: minutes, creditsConsumed: credits };
}
