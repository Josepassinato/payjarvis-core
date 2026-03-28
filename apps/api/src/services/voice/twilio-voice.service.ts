/**
 * Twilio Voice Service — AI-powered phone calls on behalf of users
 *
 * LATENCY OPTIMIZATIONS:
 * - Pre-generate greeting audio BEFORE call connects
 * - Filler audio ("Um momento...") played instantly while AI thinks
 * - Redis cache for TTS audio (same phrase = instant replay)
 * - ElevenLabs streaming TTS for ~500ms first-byte
 * - bargeIn enabled so callee can interrupt naturally
 *
 * HUMANIZATION:
 * - Random greeting variations (not always the same opening)
 * - stability 0.4 for more natural voice variation
 * - Confirmation echoing (repeat back key info)
 * - Emotional awareness in Gemini prompts
 * - Micro-pauses via SSML/silence
 *
 * CALL BRIEFING:
 * - Full briefing document generated before each call
 * - Contact lookup from user's saved contacts
 * - Post-call detailed report to user
 *
 * Voice chain: ElevenLabs (streaming) → Gemini TTS → Polly (fallback)
 */

import Twilio from "twilio";
import { prisma } from "@payjarvis/database";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { redisSet, redisGet } from "../redis.js";

// ─── Config ──────────────────────────────────────────

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const DEFAULT_FROM = process.env.TWILIO_VOICE_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER?.replace("whatsapp:", "") || "+17547145921";
const BASE_URL = process.env.PAYJARVIS_PUBLIC_URL || "https://www.payjarvis.com";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";

// ElevenLabs voice: Eric — Smooth, Trustworthy, American male
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_CALL_ID || "cjVigY5qzO86Huf0OWal";

// ─── Rate limits ─────────────────────────────────────

const DAILY_LIMIT_FREE = 5;
const DAILY_LIMIT_PREMIUM = 20;
const MAX_CALL_DURATION_SEC = 300;
const BLOCKED_PREFIXES = ["911", "112", "999", "100", "190", "192", "193"];

// ─── Improvisation Rules (Parte D) ──────────────────

const IMPROVISATION_RULES = `

=== FLEXIBLE CONVERSATION RULES ===

The playbook/briefing above is a GUIDE, not a rigid script. You have an OBJECTIVE and REQUIRED INFO. The PATH to get there is 100% free and adaptive.

IMPROVISATION:
- Always keep the objective in mind, but be flexible in how you get there
- If the conversation goes off-script, bring it back naturally — never abruptly
- If the person gives you info early, acknowledge it and skip ahead
- Match the person's energy and pace at all times

UNEXPECTED INFORMATION — When you receive new info that affects the user's decision:
- DO NOT decide for the user (e.g. don't accept a $45 tasting menu without asking)
- Note the information
- Either ask "Can you hold one moment while I check?" or say "Let me confirm with [owner] and call back"
- Report ALL options to the user afterward

WHAT YOU CAN DECIDE ALONE:
- Accept timing ±30min from requested (19:30 instead of 20:00)
- Give the user's phone number or name
- Choose between equivalent options (table A vs B)
- Accept minor alternatives (bar seating if no tables)

WHAT YOU MUST CONSULT THE USER FIRST:
- Price above expected / any cost commitment
- Time >1 hour different from requested
- Different date than requested
- Cancellation of something existing
- Significant change to the original plan

NEVER DO:
- Give financial info (cards, bank details)
- Accept charges or confirm purchases
- Give home address (unless explicitly authorized)

IVR / AUTOMATED SYSTEMS:
- If you detect an IVR menu, navigate it by saying the option number or "agent"/"representative"
- Try pressing 0 or saying "speak to someone" to reach a human
- If stuck in a loop, hang up and report to the user

=== END RULES ===`;

// ─── Audio file store (in-memory, short-lived) ──────

interface AudioEntry {
  path: string;
  createdAt: number;
}

const audioStore = new Map<string, AudioEntry>();

// Ensure /tmp/voice_fillers exists
const FILLER_DIR = "/tmp/voice_fillers";
try { mkdirSync(FILLER_DIR, { recursive: true }); } catch { /* exists */ }

// Cleanup expired audio files every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of audioStore) {
    if (now - entry.createdAt > 300_000) { // 5 min TTL
      try { unlinkSync(entry.path); } catch { /* ignore */ }
      audioStore.delete(id);
    }
  }
}, 60_000);

/**
 * Get a stored audio file for serving via HTTP.
 */
export function getAudioFile(audioId: string): { path: string; exists: boolean } {
  const entry = audioStore.get(audioId);
  if (!entry || !existsSync(entry.path)) {
    return { path: "", exists: false };
  }
  return { path: entry.path, exists: true };
}

// ─── Filler Audio System ─────────────────────────────

interface FillerSet {
  phrases: string[];
  audioIds: string[]; // populated after generation
}

const FILLER_PHRASES: Record<string, FillerSet> = {
  en: {
    phrases: [
      "Hmm...",
      "I see...",
      "Got it...",
      "Ah, ok...",
      "Right...",
      "Uh huh...",
      "Let me think...",
      "Ok...",
    ],
    audioIds: [],
  },
  pt: {
    phrases: [
      "Hmm...",
      "Entendi...",
      "Ah sim...",
      "Certo...",
      "Ok...",
      "Uhum...",
      "Tá...",
      "Deixa eu ver...",
    ],
    audioIds: [],
  },
  es: {
    phrases: [
      "Hmm...",
      "Entendido...",
      "Ah, ok...",
      "Claro...",
      "Vale...",
      "Ajá...",
      "Déjame ver...",
    ],
    audioIds: [],
  },
  fr: {
    phrases: [
      "Hmm...",
      "D'accord...",
      "Je vois...",
      "Ah oui...",
      "Ok...",
      "Voyons...",
    ],
    audioIds: [],
  },
};

// ─── Greeting Variations ─────────────────────────────

const GREETING_VARIATIONS: Record<string, string[]> = {
  en: ["Hi there!", "Hello!", "Good morning!", "Good afternoon!", "Hey!"],
  pt: ["Olá!", "Oi, tudo bem?", "Bom dia!", "Boa tarde!", "E aí!"],
  es: ["¡Hola!", "¡Buenos días!", "¡Buenas tardes!", "¡Qué tal!"],
  fr: ["Bonjour!", "Salut!", "Bonsoir!", "Coucou!"],
};

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Pre-generate filler audios at startup ───────────

let fillersReady = false;

async function generateFillerAudios(): Promise<void> {
  if (!ELEVENLABS_API_KEY) {
    console.warn("[VOICE-FILLER] No ElevenLabs key — fillers disabled");
    return;
  }

  console.log("[VOICE-FILLER] Generating filler audios...");

  for (const [lang, set] of Object.entries(FILLER_PHRASES)) {
    for (const phrase of set.phrases) {
      try {
        // Check Redis cache first
        const cacheKey = `voice:filler:${hashText(phrase)}`;
        const cachedId = await redisGet(cacheKey);
        if (cachedId) {
          const entry = audioStore.get(cachedId);
          if (entry && existsSync(entry.path)) {
            set.audioIds.push(cachedId);
            continue;
          }
        }

        const audioId = `filler_${lang}_${hashText(phrase)}`;
        const filePath = join(FILLER_DIR, `${audioId}.mp3`);

        // Check if file already exists on disk
        if (existsSync(filePath)) {
          audioStore.set(audioId, { path: filePath, createdAt: Date.now() + 86400_000 }); // 24h TTL
          set.audioIds.push(audioId);
          await redisSet(cacheKey, audioId, 86400);
          continue;
        }

        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: phrase,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.35,       // More natural variation
              similarity_boost: 0.70,
              style: 0.40,           // More expressive
              use_speaker_boost: true,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length > 500) {
            writeFileSync(filePath, buffer);
            audioStore.set(audioId, { path: filePath, createdAt: Date.now() + 86400_000 });
            set.audioIds.push(audioId);
            await redisSet(cacheKey, audioId, 86400);
            console.log(`[VOICE-FILLER] Generated: ${lang} "${phrase}" (${buffer.length}b)`);
          }
        }
      } catch (err) {
        console.warn(`[VOICE-FILLER] Failed: ${phrase} — ${(err as Error).message}`);
      }
    }
  }

  fillersReady = true;
  console.log(`[VOICE-FILLER] Ready: ${Object.entries(FILLER_PHRASES).map(([l, s]) => `${l}=${s.audioIds.length}`).join(", ")}`);
}

// Start generating fillers in background (non-blocking)
setTimeout(() => generateFillerAudios().catch(console.error), 2000);

/**
 * Get a random filler audio URL for a language.
 */
export function getRandomFillerUrl(lang: string): string | null {
  const set = FILLER_PHRASES[lang] || FILLER_PHRASES.en;
  if (set.audioIds.length === 0) return null;
  const audioId = randomPick(set.audioIds);
  return `${BASE_URL}/api/voice/audio/${audioId}`;
}

// ─── TTS Audio Cache (Redis) ─────────────────────────

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function getCachedAudio(text: string): Promise<string | null> {
  const cacheKey = `voice:tts:${hashText(text)}`;
  const cachedId = await redisGet(cacheKey);
  if (!cachedId) return null;

  const entry = audioStore.get(cachedId);
  if (entry && existsSync(entry.path)) {
    console.log(`[VOICE-TTS] Cache HIT: "${text.substring(0, 40)}..."`);
    return `${BASE_URL}/api/voice/audio/${cachedId}`;
  }
  return null;
}

async function cacheAudio(text: string, audioId: string): Promise<void> {
  const cacheKey = `voice:tts:${hashText(text)}`;
  await redisSet(cacheKey, audioId, 86400); // 24h TTL
}

// ─── In-memory call state ────────────────────────────

interface CallTurn {
  speaker: "jarvis" | "callee";
  text: string;
  timestamp: string;
}

interface CallBriefing {
  callerIdentity: string;
  targetName: string;
  targetNumber: string;
  objective: string;
  keyMessages: string[];
  tone: string;
  language: string;
  maxDuration: string;
  canReceiveMessages: boolean;
  userName: string;
  fallbackIfUnavailable: string;
}

interface ActiveCall {
  callId: string;
  userId: string;
  callSid?: string;
  to: string;
  from: string;
  businessName: string;
  objective: string;
  details: string;
  language: string;
  channel: string;
  transcript: CallTurn[];
  plan: string;
  turnCount: number;
  completed: boolean;
  notified: boolean;
  result?: string;
  briefing?: CallBriefing;
  startedAt?: number; // timestamp when call started
  contactIntel?: ContactIntel | null; // pre-loaded intelligence
  preGeneratedGreeting?: string; // Audio URL pre-generated before call
  pendingResponse?: {           // Response being generated in background
    promise: Promise<{ text: string; audioUrl: string | null; done?: boolean; summary?: string }>;
    ready: boolean;
    result?: { text: string; audioUrl: string | null; done?: boolean; summary?: string };
  };
}

const activeCalls = new Map<string, ActiveCall>();

// ─── Twilio Client ───────────────────────────────────

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (!_client) {
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
    }
    _client = Twilio(ACCOUNT_SID, AUTH_TOKEN);
  }
  return _client;
}

// ─── Gemini Client ───────────────────────────────────

let _genai: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genai) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required for voice calls");
    _genai = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return _genai;
}

// ─── TTS: ElevenLabs (streaming) → Gemini → Polly ───

/**
 * Generate speech audio from text. Returns an audio URL or null.
 * Uses Redis cache → ElevenLabs streaming → Gemini TTS → null (Polly fallback)
 */
async function generateSpeech(text: string, callId: string): Promise<string | null> {
  // Check cache first
  const cached = await getCachedAudio(text);
  if (cached) return cached;

  const audioId = `${callId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const filePath = join("/tmp", `voice_${audioId}.mp3`);

  // ─── Try 1: ElevenLabs with streaming ───
  if (ELEVENLABS_API_KEY) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.35,          // More natural variation
            similarity_boost: 0.70,
            style: 0.40,              // More expressive
            use_speaker_boost: true,
          },
          output_format: "mp3_44100_128",
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok && res.body) {
        const chunks: Buffer[] = [];
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 500) {
          writeFileSync(filePath, buffer);
          audioStore.set(audioId, { path: filePath, createdAt: Date.now() });
          await cacheAudio(text, audioId);
          console.log(`[VOICE-TTS] ElevenLabs stream OK (${buffer.length} bytes)`);
          return `${BASE_URL}/api/voice/audio/${audioId}`;
        }
      }
      console.warn(`[VOICE-TTS] ElevenLabs stream failed: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[VOICE-TTS] ElevenLabs error: ${(err as Error).message}`);
    }
  }

  // ─── Try 2: Gemini TTS (Orus voice) ───
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              response_modalities: ["AUDIO"],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: { voice_name: "Orus" },
                },
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (res.ok) {
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> };
        const audioB64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioB64) {
          const wavPath = filePath.replace(".mp3", ".wav");
          writeFileSync(wavPath, Buffer.from(audioB64, "base64"));
          audioStore.set(audioId, { path: wavPath, createdAt: Date.now() });
          await cacheAudio(text, audioId);
          console.log(`[VOICE-TTS] Gemini Orus OK`);
          return `${BASE_URL}/api/voice/audio/${audioId}`;
        }
      }
      console.warn(`[VOICE-TTS] Gemini TTS failed: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[VOICE-TTS] Gemini TTS error: ${(err as Error).message}`);
    }
  }

  // ─── Fallback: return null → caller uses <Say> with Polly ───
  console.warn(`[VOICE-TTS] All TTS failed, falling back to Polly`);
  return null;
}

// ─── Build TwiML with audio or Polly fallback ────────

function buildTwiml(text: string, audioUrl: string | null, lang: string, callId: string, addGather: boolean, liveMode = false): string {
  const voice = getPollyVoice(lang);
  const speechLang = getSpeechLang(lang);

  let speakPart: string;
  if (audioUrl) {
    speakPart = `<Play>${escapeXml(audioUrl)}</Play>`;
  } else {
    speakPart = `<Say voice="${voice}">${escapeXml(text)}</Say>`;
  }

  if (!addGather) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speakPart}
  <Hangup/>
</Response>`;
  }

  const noResponseMsg = getNoResponseMessage(lang);
  // bargeIn="true" allows natural interruption
  // enhanced="true" + speechModel="phone_call" for better recognition on phone audio
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speakPart}
  <Gather input="speech" timeout="${liveMode ? 8 : 5}" speechTimeout="auto" bargeIn="true" enhanced="true" speechModel="phone_call" action="${BASE_URL}/api/voice/respond/${callId}" method="POST" language="${speechLang}">
  </Gather>
  <Say voice="${voice}">${escapeXml(noResponseMsg)}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Build initial TwiML — WAIT FOR THE PERSON TO SPEAK FIRST.
 * Jarvis stays SILENT until the callee says "alô", "hello", etc.
 * Only after hearing them speak does Jarvis respond with the greeting.
 * If nobody speaks in 8 seconds, Jarvis initiates with the greeting as fallback.
 */
function buildInitialTwiml(text: string, audioUrl: string | null, lang: string, callId: string, liveMode: boolean): string {
  const voice = getPollyVoice(lang);
  const speechLang = getSpeechLang(lang);

  // Build the fallback greeting (plays if person doesn't speak within 8s)
  let speakPart: string;
  if (audioUrl) {
    speakPart = `<Play>${escapeXml(audioUrl)}</Play>`;
  } else {
    speakPart = `<Say voice="${voice}">${escapeXml(text)}</Say>`;
  }

  // SILENT FIRST — wait for the person to say "hello"/"alô" before speaking
  // The Gather listens for speech for up to 8 seconds.
  // If they speak → goes to /api/voice/respond/:callId (Jarvis responds contextually)
  // If silence after 8s → falls through to the greeting below
  const noResponseMsg = getNoResponseMessage(lang);
  // Two-party consent recording disclaimer (Florida + other states)
  const disclaimerMap: Record<string, string> = {
    en: "This call may be recorded for quality purposes.",
    pt: "Esta chamada pode ser gravada para fins de qualidade.",
    es: "Esta llamada puede ser grabada con fines de calidad.",
  };
  const disclaimer = disclaimerMap[lang] || disclaimerMap.en;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(disclaimer)}</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" bargeIn="true" enhanced="true" speechModel="phone_call" action="${BASE_URL}/api/voice/respond/${callId}" method="POST" language="${speechLang}">
    <Pause length="8"/>
  </Gather>
  ${speakPart}
  <Gather input="speech" timeout="5" speechTimeout="auto" bargeIn="true" enhanced="true" speechModel="phone_call" action="${BASE_URL}/api/voice/respond/${callId}" method="POST" language="${speechLang}">
  </Gather>
  <Say voice="${voice}">${escapeXml(noResponseMsg)}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Build TwiML that plays a filler then redirects to /api/voice/next/:callId
 * This fills silence while AI generates the real response.
 */
function buildFillerTwiml(lang: string, callId: string): string {
  const fillerUrl = getRandomFillerUrl(lang);
  const voice = getPollyVoice(lang);
  const fillerFallback: Record<string, string> = {
    en: "Hmm...",
    pt: "Hmm...",
    es: "Hmm...",
    fr: "Hmm...",
  };

  const fillerPart = fillerUrl
    ? `<Play>${escapeXml(fillerUrl)}</Play>`
    : `<Say voice="${voice}">${escapeXml(fillerFallback[lang] || fillerFallback.en)}</Say>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${fillerPart}
  <Pause length="1"/>
  <Redirect method="POST">${BASE_URL}/api/voice/next/${callId}</Redirect>
</Response>`;
}

// ─── Contact Management ──────────────────────────────

export async function saveContact(userId: string, name: string, phone: string, relationship?: string, notes?: string): Promise<{ id: string; updated?: boolean }> {
  const id = `uc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Upsert: if contact with same userId+name exists, update phone
  const existing = await prisma.$queryRaw<{ id: string; phone: string }[]>`
    SELECT id, phone FROM user_contacts
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${name})
    LIMIT 1
  `;
  if (existing.length > 0) {
    await prisma.$executeRaw`
      UPDATE user_contacts
      SET phone = ${phone}, relationship = COALESCE(${relationship || null}, relationship),
          notes = COALESCE(${notes || null}, notes), updated_at = now()
      WHERE id = ${existing[0].id}
    `;
    console.log(`[VOICE-CONTACT] Updated: ${name} → ${phone} for user ${userId}`);
    return { id: existing[0].id, updated: true };
  }
  await prisma.$executeRaw`
    INSERT INTO user_contacts (id, user_id, name, phone, relationship, notes, created_at, updated_at)
    VALUES (${id}, ${userId}, ${name}, ${phone}, ${relationship || null}, ${notes || null}, now(), now())
  `;
  console.log(`[VOICE-CONTACT] Saved: ${name} → ${phone} for user ${userId}`);
  return { id };
}

export async function updateContact(userId: string, name: string, phone: string): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE user_contacts SET phone = ${phone}, updated_at = now()
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${name})
  `;
  return result > 0;
}

export async function lookupContact(userId: string, name: string): Promise<{ name: string; phone: string; relationship: string | null } | null> {
  const rows = await prisma.$queryRaw<{ name: string; phone: string; relationship: string | null }[]>`
    SELECT name, phone, relationship FROM user_contacts
    WHERE user_id = ${userId} AND LOWER(name) LIKE ${'%' + name.toLowerCase() + '%'}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function listContacts(userId: string): Promise<{ name: string; phone: string; relationship: string | null }[]> {
  return prisma.$queryRaw<{ name: string; phone: string; relationship: string | null }[]>`
    SELECT name, phone, relationship FROM user_contacts
    WHERE user_id = ${userId}
    ORDER BY name ASC
  `;
}

export async function deleteContact(userId: string, name: string): Promise<boolean> {
  const result = await prisma.$executeRaw`
    DELETE FROM user_contacts
    WHERE user_id = ${userId} AND LOWER(name) LIKE ${'%' + name.toLowerCase() + '%'}
  `;
  return result > 0;
}

// ─── Call Briefing System ────────────────────────────

function buildBriefing(params: {
  userName: string;
  callerIdentity: string;
  targetName: string;
  targetNumber: string;
  objective: string;
  keyMessages: string[];
  tone?: string;
  language: string;
  canReceiveMessages?: boolean;
}): CallBriefing {
  return {
    callerIdentity: params.callerIdentity,
    targetName: params.targetName,
    targetNumber: params.targetNumber,
    objective: params.objective,
    keyMessages: params.keyMessages,
    tone: params.tone || "professional_friendly",
    language: params.language,
    maxDuration: "3 minutes",
    canReceiveMessages: params.canReceiveMessages ?? true,
    userName: params.userName,
    fallbackIfUnavailable: "Leave voicemail message",
  };
}

function buildBriefingSystemPrompt(briefing: CallBriefing): string {
  const keyMsgs = briefing.keyMessages.map((m, i) => `   ${i + 1}. ${m}`).join("\n");
  const langName = briefing.language === "pt" ? "Brazilian Portuguese" : briefing.language === "es" ? "Spanish" : briefing.language === "fr" ? "French" : "English";

  return `You are making a PHONE CALL. You must sound EXACTLY like a real human being — not a robot, not an AI, not a script.

You are the personal assistant of ${briefing.userName}.
Your identity: ${briefing.callerIdentity}
Target: ${briefing.targetName}
Language: Speak in ${langName}

OBJECTIVE (deliver ONLY after rapport is built): ${briefing.objective}

Key messages to deliver (ONE AT A TIME, with pauses for reactions):
${keyMsgs}

CRITICAL PHONE RULES:

1. WAIT FOR THEM TO SPEAK FIRST
   - Stay completely silent until they say 'hello', 'alô', 'who is this', etc.
   - Only after hearing them speak, you respond

2. MATCH THEIR ENERGY
   - If they sound rushed → be brief and fast
   - If they sound relaxed → be warm and chatty
   - If they sound confused → slow down and explain
   - If they sound annoyed → be extra polite and quick

3. USE NATURAL SPEECH PATTERNS
   - Start sentences with: 'So...', 'Hey...', 'Look...', 'Actually...'
   - Use fillers naturally: 'um', 'you know', 'like', 'I mean'
   - Pause between thoughts (don't dump everything at once)
   - React to what they say: 'Oh really?', 'No way!', 'Got it!'
   - Laugh when appropriate: 'haha'
   - Show empathy: 'I totally get that', 'That makes sense'

4. NEVER DO THESE:
   - Never say 'As an AI' or 'I am a virtual assistant'
   - Never read a script word-for-word
   - Never use formal/corporate language: 'I would like to inform you that...'
   - Never ignore what they said and continue with your script
   - Never speak for more than 15 seconds without pausing
   - Never use the exact words from the briefing — ALWAYS rephrase naturally

5. CONVERSATION PHASES — follow this order naturally:
   Phase 1 GREETING: "Hi! Is this ${briefing.targetName}?" — wait for confirmation
   Phase 2 RAPPORT: "Hey ${briefing.targetName}! How are you doing?" — wait, react naturally: "Oh great!" / "Good to hear!"
   Phase 3 INTRODUCTION: "So, I'm calling on behalf of ${briefing.userName} — I'm his personal assistant."
   Phase 4 MESSAGE: Rephrase the key messages naturally. NEVER copy them word-for-word.
   Phase 5 CLOSING: Confirm, offer to relay messages, warm goodbye

6. ADAPT THE MESSAGE — ALWAYS rephrase naturally:
   Briefing says: 'Ask if he can meet at 4pm at the church'
   BAD (robotic): 'I am calling to ask if you can meet ${briefing.userName} at 4pm at the church.'
   GOOD (human): 'So hey, ${briefing.userName} wanted me to check with you — are you free around 4 today? He was thinking of meeting up at the church.'

   Briefing says: 'Inform that the meeting is cancelled'
   BAD: 'I am informing you that the meeting has been cancelled.'
   GOOD: 'Hey so... quick heads up — that meeting? It is not happening anymore. ${briefing.userName} asked me to let you know so you don't make the trip.'

7. HANDLE QUESTIONS NATURALLY
   If they ask something unexpected:
   - 'Good question, let me think... I believe...'
   - 'Hmm, I'm not 100% sure about that. Want me to have ${briefing.userName} call you back about it?'
   - 'Oh that's a good point. I'll pass that along to ${briefing.userName}.'

8. CLOSING — Don't be abrupt
   BAD: 'Thank you. Goodbye.'
   GOOD: 'Alright, awesome! I'll let ${briefing.userName} know. You have a great rest of your day! Bye!'

9. IF THEY ASK IF YOU'RE AI
   Be honest but casual: 'Yeah actually I'm an AI assistant! Pretty cool right? But everything I'm telling you comes straight from ${briefing.userName}. He asked me to call you personally.'
   If they're uncomfortable: 'Totally understand! Want me to have ${briefing.userName} give you a call directly instead?'

10. MESSAGE RELAY: If ${briefing.targetName} wants to leave a message for ${briefing.userName}, take note and confirm: "Got it! I'll let ${briefing.userName} know right away."

VOICE BEHAVIOR:
- Speak warmly and friendly, like a trusted personal assistant
- Match the caller's pace — fast or slow
- Use natural fillers: 'Sure!', 'Of course!', 'Got it!', 'Perfect!', 'Awesome!'
- Use ${briefing.targetName}'s name naturally in conversation
- Keep each response under 15 words — this is a phone call, not a text chat
- Tone: ${briefing.tone === "professional_friendly" ? "Professional but friendly" : briefing.tone}`;
}

// ─── Public API ──────────────────────────────────────

/**
 * Initiate a phone call on behalf of a user.
 * Now with pre-generated audio and call briefing.
 */
export async function makeCall(params: {
  userId: string;
  to: string;
  businessName?: string;
  objective: string;
  details?: string;
  language?: string;
  channel: string;
  // New briefing fields
  callerIdentity?: string;
  targetName?: string;
  keyMessages?: string[];
  tone?: string;
  canReceiveMessages?: boolean;
  userName?: string;
}): Promise<{ callId: string; callSid: string; status: string }> {
  const { userId, to, businessName, objective, details, language, channel } = params;

  // Validate phone number
  const cleanNumber = to.replace(/[\s\-\(\)]/g, "");
  if (!cleanNumber.match(/^\+?[1-9]\d{6,14}$/)) {
    throw new Error("Invalid phone number format. Use international format: +1XXXXXXXXXX");
  }

  // Block emergency numbers
  const digits = cleanNumber.replace("+", "");
  for (const prefix of BLOCKED_PREFIXES) {
    if (digits === prefix || digits.endsWith(prefix)) {
      throw new Error("Cannot call emergency numbers. Please dial directly.");
    }
  }

  // Rate limit check
  await checkRateLimit(userId);

  // Resolve caller ID
  const fromNumber = await resolveCallerId(userId);

  // Generate call ID
  const callId = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const lang = language || "en";
  const targetName = params.targetName || businessName || "the recipient";

  // Build briefing if caller identity provided
  let briefing: CallBriefing | undefined;
  if (params.callerIdentity || params.keyMessages) {
    briefing = buildBriefing({
      userName: params.userName || "the user",
      callerIdentity: params.callerIdentity || `assistant of ${params.userName || "the user"}`,
      targetName,
      targetNumber: cleanNumber.startsWith("+") ? cleanNumber : `+${cleanNumber}`,
      objective,
      keyMessages: params.keyMessages || [details || objective],
      tone: params.tone,
      language: lang,
      canReceiveMessages: params.canReceiveMessages,
    });
  }

  // Lookup contact intelligence for adaptive behavior
  const targetPhone = cleanNumber.startsWith("+") ? cleanNumber : `+${cleanNumber}`;
  const contactIntel = await getContactIntelligence(targetPhone);
  if (contactIntel) {
    console.log(`[VOICE-INTEL] Found intelligence for ${targetPhone}: personality=${contactIntel.personalityType}, calls=${contactIntel.totalCalls}`);
  }

  // Detect and load playbook if applicable
  const { detectPlaybookName, findPlaybook, buildPlaybookPrompt } = await import("./call-playbooks.service.js");
  const playbookName = detectPlaybookName(objective);
  let playbookPrompt = "";
  if (playbookName) {
    const playbook = await findPlaybook(playbookName, lang);
    if (playbook) {
      // Build info map from briefing
      const info: Record<string, string> = {};
      if (briefing) {
        info.contact_name = briefing.userName;
        info.restaurant_name = businessName || targetName;
        info.business_name = businessName || targetName;
        info.patient_name = briefing.userName;
        info.reservation_name = briefing.userName;
        info.recipient_name = briefing.userName;
      }
      // Extract info from objective/details using simple patterns
      const sizeMatch = objective.match(/(\d+)\s*(pessoas|people|pax|guests)/i);
      if (sizeMatch) info.party_size = sizeMatch[1];
      const timeMatch = objective.match(/(\d{1,2}[h:]?\d{0,2}\s*(?:am|pm|h)?)/i);
      if (timeMatch) info.time = timeMatch[1];
      // Pass details as service_type/product_or_service
      if (details) {
        info.service_type = details;
        info.product_or_service = details;
      }

      playbookPrompt = buildPlaybookPrompt(playbook, info);
      console.log(`[PLAYBOOK] Using playbook: ${playbookName}/${lang} for call ${callId}`);
    }
  }

  // Build conversation plan with Gemini (inject intelligence + playbook if available)
  let plan = briefing
    ? buildBriefingSystemPrompt(briefing)
    : await buildCallPlan(objective, details || "", businessName || "", lang);

  if (contactIntel) {
    plan += buildIntelligencePrompt(contactIntel);
  }
  if (playbookPrompt) {
    plan += playbookPrompt;
  }

  // Add flexible improvisation rules
  plan += IMPROVISATION_RULES;

  // Create in-memory state
  const callState: ActiveCall = {
    callId,
    userId,
    to: cleanNumber.startsWith("+") ? cleanNumber : `+${cleanNumber}`,
    from: fromNumber,
    businessName: businessName || targetName,
    objective,
    details: details || "",
    language: lang,
    channel,
    transcript: [],
    plan: typeof plan === "string" ? plan : plan,
    turnCount: 0,
    completed: false,
    notified: false,
    briefing,
    startedAt: Date.now(),
    contactIntel,
  };
  activeCalls.set(callId, callState);

  // PRE-GENERATE greeting audio BEFORE the call connects
  const greetingText = buildGreetingText(callState);
  console.log(`[VOICE] Pre-generating greeting audio for ${callId}...`);
  const greetingAudioUrl = await generateSpeech(greetingText, callId);
  callState.preGeneratedGreeting = greetingAudioUrl || undefined;

  // Also pre-generate common filler phrases for this language if not ready
  if (!fillersReady) {
    generateFillerAudios().catch(console.error);
  }

  // Create DB record with briefing
  await prisma.$executeRaw`
    INSERT INTO voice_calls (id, user_id, call_sid, "to", "from", business_name, objective, status, transcript, channel, briefing, created_at, updated_at)
    VALUES (${callId}, ${userId}, ${"pending"}, ${callState.to}, ${fromNumber}, ${callState.businessName}, ${objective}, ${"initiated"}, ${JSON.stringify([])}::jsonb, ${channel}, ${briefing ? JSON.stringify(briefing) : null}::jsonb, now(), now())
  `;

  // Initiate Twilio call — greeting audio is already ready!
  const client = getClient();
  const call = await client.calls.create({
    to: callState.to,
    from: fromNumber,
    url: `${BASE_URL}/api/voice/twiml/${callId}`,
    statusCallback: `${BASE_URL}/api/voice/status/${callId}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    timeout: 30,
    timeLimit: MAX_CALL_DURATION_SEC,
    // machineDetection disabled — was causing false positives on real calls
    // machineDetection: "Enable",
    record: true,
    recordingChannels: "dual",
    recordingStatusCallback: `${BASE_URL}/api/webhooks/twilio-recording`,
    recordingStatusCallbackMethod: "POST" as const,
    recordingStatusCallbackEvent: ["completed"],
  });

  callState.callSid = call.sid;

  await prisma.$executeRaw`
    UPDATE voice_calls SET call_sid = ${call.sid}, status = ${"ringing"}, updated_at = now()
    WHERE id = ${callId}
  `;

  console.log(`[VOICE] Call ${callId} initiated: ${call.sid} → ${callState.to} from ${fromNumber} (${callState.businessName}) — greeting pre-generated: ${!!greetingAudioUrl}`);

  return { callId, callSid: call.sid, status: "ringing" };
}

/**
 * Build the greeting text — ONLY the initial greeting, no identity or message.
 * The goal is to sound like a real person: "Hi! Is this [name]?"
 * Identity and message come in later turns after rapport is built.
 */
function buildGreetingText(call: ActiveCall): string {
  const isLive = call.objective === "live_conversation";

  if (isLive) {
    const greetings: Record<string, string[]> = {
      en: [
        "Hey, this is Jarvis. How can I help you?",
        "Hi there! Jarvis here. What can I do for you?",
        "Hello! It's Jarvis. What's on your mind?",
      ],
      pt: [
        "Oi, aqui é o Jarvis. Como posso te ajudar?",
        "E aí! Jarvis aqui. No que posso ajudar?",
        "Olá! Aqui é o Jarvis. O que você precisa?",
      ],
      es: [
        "Hola, soy Jarvis. ¿En qué puedo ayudarte?",
        "¡Hola! Jarvis aquí. ¿Qué necesitas?",
      ],
      fr: [
        "Salut, c'est Jarvis. Comment puis-je vous aider?",
        "Bonjour! Jarvis à votre service. Que puis-je faire?",
      ],
    };
    return randomPick(greetings[call.language] || greetings.en);
  }

  // Briefed call — ONLY ask if they are the target. Nothing else.
  if (call.briefing) {
    const target = call.briefing.targetName;

    if (call.language === "pt") {
      return randomPick([
        `Oi! É ${target}?`,
        `Olá! Falo com ${target}?`,
        `Oi! Tudo bem? É ${target}?`,
      ]);
    } else if (call.language === "es") {
      return randomPick([
        `¡Hola! ¿Hablo con ${target}?`,
        `¡Hola! ¿Es ${target}?`,
      ]);
    } else if (call.language === "fr") {
      return randomPick([
        `Bonjour! C'est bien ${target}?`,
        `Bonjour! Je parle à ${target}?`,
      ]);
    } else {
      return randomPick([
        `Hi! Is this ${target}?`,
        `Hey! Is this ${target}?`,
        `Hello! Am I speaking with ${target}?`,
      ]);
    }
  }

  // Standard call plan — extract opening line
  const openingLine = call.plan.split("\n").find((l) => l.trim().startsWith("OPENING:"))?.replace("OPENING:", "").trim();
  if (openingLine) return openingLine;

  // Fallback with variation
  const greeting = randomPick(GREETING_VARIATIONS[call.language] || GREETING_VARIATIONS.en);
  return `${greeting} I'm calling about ${call.objective}.`;
}

/**
 * Generate initial TwiML for when the call is answered.
 * Now waits in SILENCE for the person to speak first ("alô?").
 * Pre-generated greeting is stored but only used as fallback if nobody speaks.
 */
export async function getInitialTwiml(callId: string): Promise<string> {
  const call = activeCalls.get(callId);
  if (!call) {
    return buildTwiml("Sorry, this call session has expired.", null, "en", callId, false);
  }

  const isLive = call.objective === "live_conversation";
  const firstLine = buildGreetingText(call);

  // DON'T add greeting to transcript yet — it will only play as fallback
  // The greeting text and audio are passed to buildInitialTwiml for fallback use

  // Use pre-generated audio if available (instant! no latency!)
  const audioUrl = call.preGeneratedGreeting || await generateSpeech(firstLine, callId);

  // SILENT FIRST — wait for person to speak, fallback to greeting after 8s
  return buildInitialTwiml(firstLine, audioUrl, call.language, callId, isLive);
}

// ─── Voicemail Detection ─────────────────────────────

const VOICEMAIL_KEYWORDS = [
  "voicemail", "leave a message", "leave your message", "not available",
  "after the tone", "after the beep", "record your message", "at the tone",
  "please leave", "can't come to the phone", "unable to take your call",
  "mailbox", "caixa postal", "deixe sua mensagem", "após o sinal",
  "no se encuentra disponible", "deje su mensaje", "après le bip",
  "laissez votre message",
];

function detectVoicemail(speechResult: string): boolean {
  const lower = speechResult.toLowerCase();
  return VOICEMAIL_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildVoicemailMessage(call: ActiveCall): string {
  const name = call.briefing?.targetName || call.businessName;
  const userName = call.briefing?.userName || "José";
  const briefSummary = call.briefing?.keyMessages?.[0] || call.objective;

  if (call.language === "pt") {
    return randomPick([
      `Oi ${name}! Tô ligando da parte do ${userName}. Ele queria te falar sobre ${briefSummary}. Me liga de volta ou manda mensagem pro ${userName} quando puder! Valeu!`,
      `E aí ${name}! Aqui é o assistente do ${userName}. É sobre ${briefSummary}. Quando puder, retorna pro ${userName}! Abraço!`,
    ]);
  } else if (call.language === "es") {
    return `Hola ${name}! Te llamo de parte de ${userName}. Quería hablarte sobre ${briefSummary}. Llámalo cuando puedas. Gracias!`;
  } else {
    return randomPick([
      `Hey ${name}! Calling on behalf of ${userName}. He wanted to talk to you about ${briefSummary}. Give him a call back or send him a message when you get a chance! Thanks!`,
      `Hi ${name}! This is ${userName}'s assistant. Just reaching out about ${briefSummary}. Call ${userName} back when you can! Have a great day!`,
    ]);
  }
}

/**
 * Process callee's response — plays filler immediately, generates real response in background.
 * Now handles: first-turn greeting (person spoke first), voicemail detection, goodbye detection.
 */
export async function handleResponse(callId: string, speechResult: string, confidence: string): Promise<string> {
  const call = activeCalls.get(callId);
  if (!call) {
    return buildTwiml("Sorry, this call session has expired.", null, "en", callId, false);
  }

  const isLive = call.objective === "live_conversation";

  // ─── VOICEMAIL DETECTION ───
  if (detectVoicemail(speechResult)) {
    console.log(`[VOICE] Voicemail detected on ${callId}: "${speechResult}"`);
    const vmMsg = buildVoicemailMessage(call);
    call.transcript.push({ speaker: "callee", text: `[VOICEMAIL] ${speechResult}`, timestamp: new Date().toISOString() });
    call.transcript.push({ speaker: "jarvis", text: vmMsg, timestamp: new Date().toISOString() });
    call.result = "Voicemail — left message.";
    call.completed = true;
    await updateTranscript(call);
    await prisma.$executeRaw`
      UPDATE voice_calls SET result = ${call.result}, status = ${"completed"}, updated_at = now()
      WHERE id = ${call.callId}
    `;
    const audioUrl = await generateSpeech(vmMsg, callId);
    return buildTwiml(vmMsg, audioUrl, call.language, callId, false);
  }

  // ─── FIRST TURN: Person spoke first (e.g. "Alô?"), Jarvis hasn't greeted yet ───
  if (call.turnCount === 0) {
    call.transcript.push({ speaker: "callee", text: speechResult, timestamp: new Date().toISOString() });
    call.turnCount++;

    // Now respond with the greeting (pre-generated)
    const greetingText = buildGreetingText(call);
    call.transcript.push({ speaker: "jarvis", text: greetingText, timestamp: new Date().toISOString() });
    call.turnCount++;

    const audioUrl = call.preGeneratedGreeting || await generateSpeech(greetingText, callId);
    await updateTranscript(call);
    return buildTwiml(greetingText, audioUrl, call.language, callId, true, isLive);
  }

  call.transcript.push({ speaker: "callee", text: speechResult, timestamp: new Date().toISOString() });
  call.turnCount++;

  // Detect goodbye phrases
  if (isLive) {
    const lowerSpeech = speechResult.toLowerCase().trim();
    const goodbyePhrases = ["bye", "goodbye", "tchau", "até mais", "até logo", "obrigado é só isso", "that's all", "that is all", "thanks that's it", "adiós", "chao"];
    if (goodbyePhrases.some((p) => lowerSpeech.includes(p))) {
      call.result = "Live conversation ended by user.";
      return await endCallWithSummary(call, "user_goodbye");
    }
  }

  const maxTurns = isLive ? 60 : 20;
  if (call.turnCount > maxTurns) {
    return await endCallWithSummary(call, "max_turns_reached");
  }

  // START generating response in background
  const responsePromise = generateResponseWithAudio(call, speechResult);
  call.pendingResponse = {
    promise: responsePromise,
    ready: false,
  };

  // Track when it's ready
  responsePromise.then((result) => {
    if (call.pendingResponse) {
      call.pendingResponse.ready = true;
      call.pendingResponse.result = result;
    }
  }).catch((err) => {
    console.error(`[VOICE] Background response generation failed for ${callId}:`, (err as Error).message);
  });

  // If fillers are available, play filler + redirect to /next/:callId
  if (fillersReady && FILLER_PHRASES[call.language]?.audioIds.length > 0) {
    return buildFillerTwiml(call.language, callId);
  }

  // No fillers available — wait for response directly (original behavior)
  const { text, audioUrl } = await responsePromise;
  return buildTwiml(text, audioUrl, call.language, callId, true, isLive);
}

/**
 * Generate AI response + TTS audio in parallel (used as background task).
 */
async function generateResponseWithAudio(call: ActiveCall, speechResult: string): Promise<{ text: string; audioUrl: string | null; done?: boolean; summary?: string }> {
  const nextResponse = await getNextResponse(call, speechResult);

  if (nextResponse.done) {
    call.result = nextResponse.summary;
    // For done responses, we still need audio for the closing
    const audioUrl = await generateSpeech(nextResponse.text, call.callId);
    return { text: nextResponse.text, audioUrl, done: true, summary: nextResponse.summary };
  }

  call.transcript.push({ speaker: "jarvis", text: nextResponse.text, timestamp: new Date().toISOString() });
  call.turnCount++;
  await updateTranscript(call);

  const audioUrl = await generateSpeech(nextResponse.text, call.callId);
  return { text: nextResponse.text, audioUrl };
}

/**
 * Endpoint called after filler plays — returns the real response.
 * Waits up to 8s for the response to be ready.
 */
export async function getNextTwiml(callId: string): Promise<string> {
  const call = activeCalls.get(callId);
  if (!call) {
    return buildTwiml("Sorry, this call session has expired.", null, "en", callId, false);
  }

  const isLive = call.objective === "live_conversation";

  // Wait for the background response to be ready (max 8s)
  if (call.pendingResponse) {
    if (!call.pendingResponse.ready) {
      try {
        const result = await Promise.race([
          call.pendingResponse.promise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);

        if (result) {
          call.pendingResponse.ready = true;
          call.pendingResponse.result = result;
        }
      } catch (err) {
        console.error(`[VOICE] Error waiting for response on ${callId}:`, (err as Error).message);
      }
    }

    if (call.pendingResponse.ready && call.pendingResponse.result) {
      const { text, audioUrl, done, summary } = call.pendingResponse.result;
      call.pendingResponse = undefined;

      if (done) {
        call.result = summary;
        call.completed = true;
        await updateTranscript(call);
        await prisma.$executeRaw`
          UPDATE voice_calls SET result = ${call.result || "Call completed"}, status = ${"completed"}, updated_at = now()
          WHERE id = ${call.callId}
        `;
        return buildTwiml(text, audioUrl, call.language, callId, false);
      }

      return buildTwiml(text, audioUrl, call.language, callId, true, isLive);
    }
  }

  // Response still not ready — play another filler and redirect again
  if (fillersReady && FILLER_PHRASES[call.language]?.audioIds.length > 0) {
    return buildFillerTwiml(call.language, callId);
  }

  // Absolute fallback
  const fallbackMsg: Record<string, string> = {
    en: "Just a moment...",
    pt: "Só um momento...",
    es: "Solo un momento...",
    fr: "Juste un moment...",
  };
  const voice = getPollyVoice(call.language);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(fallbackMsg[call.language] || fallbackMsg.en)}</Say>
  <Pause length="2"/>
  <Redirect method="POST">${BASE_URL}/api/voice/next/${callId}</Redirect>
</Response>`;
}

/**
 * Handle call status updates from Twilio.
 * CRITICAL: Must work even if activeCalls Map is empty (after restart/crash).
 */
export async function handleStatusCallback(callId: string, status: string, duration?: string): Promise<void> {
  const call = activeCalls.get(callId);
  const durationSec = duration ? parseInt(duration, 10) : null;

  await prisma.$executeRaw`
    UPDATE voice_calls SET status = ${status}, duration = ${durationSec}, updated_at = now()
    WHERE id = ${callId}
  `;

  if (status === "completed" || status === "busy" || status === "no-answer" || status === "failed" || status === "canceled") {
    if (call) {
      // ── In-memory path (normal flow) ──
      // Generate summary if not done yet
      if (!call.completed) {
        call.completed = true;
        if (call.transcript.length > 0 && !call.result) {
          call.result = await generateCallSummary(call);
        }
        // Analyze call and learn (async, don't block notification)
        if (call.transcript.length > 0) {
          analyzeCallAndLearn(call).catch(err =>
            console.error(`[VOICE-INTEL] Post-call analysis error:`, (err as Error).message)
          );
        }
      }

      // Always save final state to DB
      await prisma.$executeRaw`
        UPDATE voice_calls
        SET result = ${call.result || `Call ${status}`},
            transcript = ${JSON.stringify(call.transcript)}::jsonb,
            duration = COALESCE(${durationSec}, duration),
            updated_at = now()
        WHERE id = ${callId}
      `;

      // Notify user ONCE — even if call was already marked completed by endCallWithSummary
      if (!call.notified) {
        await notifyUser(call, status);
      }

      setTimeout(() => activeCalls.delete(callId), 300_000);
    } else {
      // ── DB fallback path (after restart/crash — call not in memory) ──
      console.warn(`[VOICE] Call ${callId} not in memory — recovering from DB for notification`);
      try {
        await notifyUserFromDb(callId, status, durationSec);
      } catch (err) {
        console.error(`[VOICE] DB fallback notification failed for ${callId}:`, (err as Error).message);
      }
    }

    console.log(`[VOICE] Call ${callId} ended: ${status} (${durationSec || 0}s)`);
  }
}

/**
 * Fallback notification when call is not in activeCalls Map (post-restart/crash).
 * Loads call data from DB and sends notification.
 */
async function notifyUserFromDb(callId: string, status: string, durationSec: number | null): Promise<void> {
  const rows = await prisma.$queryRaw<{
    user_id: string;
    business_name: string;
    objective: string;
    channel: string;
    transcript: CallTurn[] | null;
    result: string | null;
    briefing: CallBriefing | null;
  }[]>`
    SELECT user_id, business_name, objective, channel, transcript, result, briefing
    FROM voice_calls WHERE id = ${callId}
  `;

  const dbCall = rows[0];
  if (!dbCall) {
    console.error(`[VOICE] Call ${callId} not found in DB — cannot notify`);
    return;
  }

  // If no result yet and we have transcript, generate summary via Gemini
  let result = dbCall.result;
  const transcript = (dbCall.transcript || []) as CallTurn[];

  if (!result && transcript.length > 0 && status === "completed") {
    try {
      const transcriptText = transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");
      const briefingContext = dbCall.briefing
        ? `\nORIGINAL REQUEST: ${dbCall.briefing.objective || ""} ${dbCall.briefing.keyMessages?.join(", ") || ""}`
        : "";

      result = await geminiGenerate(`Resuma o resultado desta chamada telefônica em 2-3 frases objetivas.
O que foi resolvido? O que a pessoa disse de relevante? Há ações pendentes?

OBJETIVO: ${dbCall.objective}
PESSOA: ${dbCall.business_name}${briefingContext}

TRANSCRIÇÃO:
${transcriptText}

Resumo (seja específico — inclua nomes, horários, confirmações mencionadas):`);
      result = (result || "Call completed.").trim();

      // Save summary to DB
      await prisma.$executeRaw`
        UPDATE voice_calls SET result = ${result}, updated_at = now()
        WHERE id = ${callId}
      `;
    } catch (err) {
      console.error(`[VOICE] Failed to generate summary for ${callId}:`, (err as Error).message);
      result = "Call completed (summary unavailable — server restarted during call).";
    }
  }

  // Build a minimal ActiveCall-like object for notifyUser
  const fakeCall: ActiveCall = {
    callId,
    userId: dbCall.user_id,
    to: "",
    from: "",
    businessName: dbCall.business_name,
    objective: dbCall.objective,
    details: "",
    language: "en", // Will be overridden by transcript language detection
    channel: dbCall.channel || "whatsapp",
    transcript,
    plan: "",
    turnCount: transcript.length,
    completed: true,
    notified: false,
    result: result || `Call ${status}`,
    briefing: dbCall.briefing || undefined,
  };

  // Detect language from briefing or transcript
  if (dbCall.briefing?.language) {
    fakeCall.language = dbCall.briefing.language;
  }

  await notifyUser(fakeCall, status);
  console.log(`[VOICE] DB fallback notification sent for ${callId} to ${dbCall.channel}:${dbCall.user_id}`);
}

/**
 * Get call status from DB.
 */
export async function getCallStatus(callId: string): Promise<Record<string, unknown> | null> {
  const rows = await prisma.$queryRaw<{ id: string; status: string; result: string | null; duration: number | null; transcript: unknown; briefing: unknown }[]>`
    SELECT id, status, result, duration, transcript, briefing FROM voice_calls WHERE id = ${callId}
  `;
  return rows[0] || null;
}

export function getActiveCall(callId: string): ActiveCall | undefined {
  return activeCalls.get(callId);
}

// ─── Verified Caller ID ──────────────────────────────

export async function startCallerIdVerification(userId: string, phoneNumber: string, friendlyName: string): Promise<{ validationCode: string; callSid: string }> {
  const client = getClient();
  const result = await client.validationRequests.create({
    phoneNumber,
    friendlyName,
  });
  console.log(`[VOICE] Caller ID verification started for ${userId}: ${phoneNumber} (code: ${result.validationCode})`);
  return {
    validationCode: result.validationCode,
    callSid: result.callSid,
  };
}

async function resolveCallerId(userId: string): Promise<string> {
  try {
    const cleanPhone = userId.replace("whatsapp:", "");
    const rows = await prisma.$queryRaw<{ verifiedCallerId: string | null }[]>`
      SELECT "verifiedCallerId" FROM users
      WHERE id = ${userId} OR phone = ${cleanPhone}
      LIMIT 1
    `;
    if (rows[0]?.verifiedCallerId) {
      return rows[0].verifiedCallerId;
    }
  } catch {
    // Column may not exist yet — fall through to default
  }
  return DEFAULT_FROM;
}

export async function saveVerifiedCallerId(userId: string, phoneNumber: string): Promise<void> {
  const cleanPhone = userId.replace("whatsapp:", "");
  await prisma.$executeRaw`
    UPDATE users SET "verifiedCallerId" = ${phoneNumber}, updated_at = now()
    WHERE id = ${userId} OR phone = ${cleanPhone}
  `;
  console.log(`[VOICE] Verified caller ID saved for ${userId}: ${phoneNumber}`);
}

// ─── Gemini Conversation Engine ──────────────────────

async function geminiGenerate(prompt: string): Promise<string> {
  const genai = getGenAI();
  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  return result.response?.text() || "";
}

async function buildCallPlan(objective: string, details: string, businessName: string, language: string): Promise<string> {
  const langName = { en: "English", pt: "Portuguese", es: "Spanish", fr: "French" }[language] || "English";

  const text = await geminiGenerate(`You are planning a phone call to "${businessName || "a business"}".

OBJECTIVE: ${objective}
DETAILS: ${details || "None provided"}
LANGUAGE: Speak in ${langName}

Create a brief call script with:
OPENING: The first thing to say when they pick up (1-2 sentences, polite and direct)
KEY_POINTS: What information to convey or ask for (bullet points)
CLOSING: How to end the call politely

Keep it natural and conversational. Do not be robotic.
The opening line is what will be spoken first — make it sound human.
Keep responses SHORT — maximum 15 words per sentence. This is a phone call.`);

  return text || `OPENING: Hi, I'm calling about ${objective}.\nKEY_POINTS: ${details}\nCLOSING: Thank you for your help.`;
}

async function getNextResponse(call: ActiveCall, calleeResponse: string): Promise<{ text: string; done: boolean; summary?: string }> {
  const langName = { en: "English", pt: "Portuguese", es: "Spanish", fr: "French" }[call.language] || "English";
  const isLive = call.objective === "live_conversation";

  const conversationHistory = call.transcript
    .map((t) => `${t.speaker === "jarvis" ? "YOU" : "THEM"}: ${t.text}`)
    .join("\n");

  let prompt: string;

  if (isLive) {
    prompt = `You are Jarvis, a personal AI assistant in a LIVE PHONE CALL with your user.

LANGUAGE: ${langName}
TURN: ${call.turnCount}

CONVERSATION SO FAR:
${conversationHistory}

USER JUST SAID: "${calleeResponse}"

Rules:
- You are in a LIVE phone call with the USER (not a business). Speak warmly and naturally in ${langName}.
- Keep responses SHORT — 1-2 sentences max, under 15 words. This is a phone call, not a text chat.
- When you acknowledge what they said, briefly echo back key details to confirm understanding.
  Example: They say "Can we move it to 5 instead of 4?" → You say "At 5, got it."
- Adapt your tone: if they seem rushed, be more direct. If confused, explain simply.
- You have access to ALL your tools: search restaurants, flights, hotels, products, track packages, set reminders, etc.
- When you need to use a tool, say "Let me check that..." then give the result concisely.
- If the user says goodbye/tchau/bye, respond with DONE: followed by a summary of what you discussed.
- Be warm, efficient, helpful. You know the user personally.
- Never say you are an AI.

VOICE BEHAVIOR:
- Speak warmly and friendly, like a trusted personal assistant
- Match the user's pace: if they speak slowly, speak slowly. If quickly, be concise.
- Use natural conversational fillers: 'Sure!', 'Of course!', 'Got it!', 'Perfect!'
- If the user seems confused, simplify and slow down
- NEVER sound robotic, scripted, or rushed
- End sentences with warmth: 'Is there anything else?' not 'Anything else?'

If the conversation should end, start your response with "DONE:" followed by a brief summary.
Otherwise, just write what to say next (SHORT! Phone call!).`;
  } else if (call.briefing) {
    // Determine conversation phase based on turn count and history
    const jarvisTurns = call.transcript.filter((t) => t.speaker === "jarvis").length;
    const calleeTurns = call.transcript.filter((t) => t.speaker === "callee").length;
    const hasIntroduced = call.transcript.some((t) =>
      t.speaker === "jarvis" && (
        t.text.toLowerCase().includes("behalf of") ||
        t.text.toLowerCase().includes("em nome de") ||
        t.text.toLowerCase().includes("assistente") ||
        t.text.toLowerCase().includes("assistant") ||
        t.text.toLowerCase().includes(call.briefing!.userName.toLowerCase())
      )
    );
    const hasDeliveredMessage = call.transcript.some((t) =>
      t.speaker === "jarvis" && (
        t.text.toLowerCase().includes("reason i'm calling") ||
        t.text.toLowerCase().includes("motivo da ligação") ||
        t.text.toLowerCase().includes("te avisar") ||
        t.text.toLowerCase().includes("let you know") ||
        t.text.toLowerCase().includes("wanted me to")
      )
    );

    let phase: string;
    let phaseInstruction: string;

    if (!hasIntroduced && jarvisTurns <= 2) {
      if (jarvisTurns <= 1) {
        phase = "rapport";
        const rapportExamples: Record<string, string> = {
          en: `They just responded to your "Is this ${call.briefing.targetName}?" greeting.
React naturally to what they said, then ask how they're doing.
Examples: "Hey ${call.briefing.targetName}! How are you doing? I hope I'm not catching you at a bad time!"
Keep it warm and natural. Do NOT introduce yourself yet. Do NOT mention the message yet.`,
          pt: `Eles acabaram de responder à sua saudação "É ${call.briefing.targetName}?".
Reaja naturalmente e pergunte como estão.
Exemplos: "Oi ${call.briefing.targetName}! Tudo bem? Espero que não esteja te pegando em má hora!"
Mantenha caloroso e natural. NÃO se apresente ainda. NÃO mencione a mensagem.`,
          es: `Acaban de responder a tu saludo "¿Hablo con ${call.briefing.targetName}?".
Reacciona naturalmente y pregunta cómo están.
Ejemplo: "¡Hola ${call.briefing.targetName}! ¿Cómo estás? Espero no molestarte."
NO te presentes aún. NO menciones el mensaje.`,
          fr: `Ils viennent de répondre à votre "C'est bien ${call.briefing.targetName}?".
Réagissez naturellement et demandez comment ils vont.
Exemple: "Salut ${call.briefing.targetName}! Comment allez-vous?"
NE vous présentez PAS encore. NE mentionnez PAS le message.`,
        };
        phaseInstruction = rapportExamples[call.language] || rapportExamples.en;
      } else {
        phase = "introduction";
        const introExamples: Record<string, string> = {
          en: `Now introduce yourself naturally.
React to what they just said first ("Oh great!" / "Good to hear!"), then say something like:
"So, I'm calling on behalf of ${call.briefing.userName} — I'm his personal assistant."
If they seem surprised, add: "Yeah! ${call.briefing.userName} has me helping with scheduling and calls."
Let them react before delivering the message. Do NOT deliver the message in this turn.`,
          pt: `Agora se apresente naturalmente.
Reaja ao que disseram ("Que bom!" / "Fico feliz!"), depois diga algo como:
"Então, estou ligando em nome do ${call.briefing.userName} — sou o assistente pessoal dele."
Se parecerem surpresos: "É! O ${call.briefing.userName} me pediu pra te ligar."
NÃO entregue a mensagem neste turno.`,
          es: `Ahora preséntate naturalmente.
Reacciona primero ("¡Qué bien!" / "¡Me alegro!"), luego di algo como:
"Bueno, te llamo de parte de ${call.briefing.userName} — soy su asistente personal."
NO entregues el mensaje en este turno.`,
          fr: `Maintenant, présentez-vous naturellement.
Réagissez d'abord ("Oh super!" / "Content de l'entendre!"), puis dites:
"Alors, j'appelle de la part de ${call.briefing.userName} — je suis son assistant personnel."
NE délivrez PAS le message dans ce tour.`,
        };
        phaseInstruction = introExamples[call.language] || introExamples.en;
      }
    } else if (!hasDeliveredMessage) {
      phase = "message";
      const msgExamples: Record<string, string> = {
        en: `Now transition to the message naturally.
Say something like: "So the reason I'm calling is..."
Deliver ONE key point at a time. After each point, PAUSE and let them respond.
NEVER dump all information at once.`,
        pt: `Agora faça a transição para a mensagem naturalmente.
Diga algo como: "Então, o motivo da ligação é..."
Entregue UM ponto de cada vez. Depois de cada ponto, PARE e deixe responderem.
NUNCA despeje toda informação de uma vez.`,
        es: `Ahora haz la transición al mensaje naturalmente.
Di algo como: "Bueno, el motivo de la llamada es..."
Entrega UN punto a la vez. NUNCA des toda la información de golpe.`,
        fr: `Maintenant, passez au message naturellement.
Dites: "Alors, la raison de mon appel c'est..."
UN point à la fois. JAMAIS tout d'un coup.`,
      };
      phaseInstruction = msgExamples[call.language] || msgExamples.en;
    } else {
      phase = "conversation";
      phaseInstruction = `Continue the conversation naturally. Respond to what they said, acknowledge their reactions, deliver remaining key points one at a time, or close the call warmly if everything is covered.
If ${call.briefing.targetName} wants to leave a message for ${call.briefing.userName}: "Got it! I'll let ${call.briefing.userName} know right away."`;
    }

    prompt = `${call.plan}

CURRENT PHASE: ${phase}
PHASE INSTRUCTION: ${phaseInstruction}

CONVERSATION SO FAR:
${conversationHistory}

THEY JUST SAID: "${calleeResponse}"

CRITICAL: Follow the phase instruction above. Keep response under 15 words. Be warm and human.
TURN: ${call.turnCount}

If the objective is fully accomplished and the call should end, start with "DONE:" followed by a summary.
Otherwise, just write what to say next (SHORT! This is a phone call!).`;
  } else {
    prompt = `You are a personal assistant making a phone call. You are NOT a robot or recorded message.

BUSINESS: ${call.businessName}
OBJECTIVE: ${call.objective}
DETAILS: ${call.details}
LANGUAGE: ${langName}
TURN: ${call.turnCount}

CONVERSATION SO FAR:
${conversationHistory}

THEY JUST SAID: "${calleeResponse}"

CRITICAL RULES:
- Have a CONVERSATION, not a monologue. One point at a time, wait for reactions.
- Respond naturally to what they said — acknowledge before moving on.
- Keep responses under 15 words — this is a phone call.
- Use natural fillers: "So...", "Hey", "Great", "Got it", "Perfect"
- If they ask who you are: "I'm calling on behalf of a client" — keep it human.
- Echo back details to confirm: "At 5, got it" / "Room 302, perfect"
- Match their pace and mood — rushed = be direct, confused = slow down.
- If they seem annoyed, be extra polite.
- NEVER dump all info at once. NEVER sound robotic or scripted.

If the objective is met, start with "DONE:" followed by a summary.
Otherwise, just write what to say next.`;
  }

  const text = (await geminiGenerate(prompt)).trim();

  if (text.startsWith("DONE:")) {
    const summary = text.replace("DONE:", "").trim();
    const closings: Record<string, string[]> = {
      en: [
        "Perfect, thank you so much! Have a great day.",
        "Wonderful, thanks for your help! Take care.",
        "Great, appreciate it! Have a good one.",
      ],
      pt: [
        "Perfeito, muito obrigado! Tenha um ótimo dia.",
        "Maravilha, obrigado pela ajuda! Bom dia pra você.",
        "Ótimo, valeu! Tenha um excelente dia.",
      ],
      es: [
        "Perfecto, muchas gracias. Que tenga un buen día.",
        "Excelente, gracias por su ayuda. Que le vaya bien.",
      ],
      fr: [
        "Parfait, merci beaucoup! Bonne journée.",
        "Excellent, merci pour votre aide! À bientôt.",
      ],
    };
    const closing = randomPick(closings[call.language] || closings.en);
    return { text: closing, done: true, summary };
  }

  return { text, done: false };
}

async function generateCallSummary(call: ActiveCall): Promise<string> {
  const transcript = call.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");

  const briefingContext = call.briefing
    ? `\nORIGINAL REQUEST: ${call.briefing.objective || ""} ${call.briefing.keyMessages?.join(", ") || ""}`
    : "";

  const text = await geminiGenerate(`Resuma o resultado desta chamada telefônica em 2-3 frases objetivas.
O que foi resolvido? O que a pessoa disse de relevante? Há ações pendentes?

OBJETIVO: ${call.objective}
PESSOA: ${call.businessName}${briefingContext}

TRANSCRIÇÃO:
${transcript}

Resumo (seja específico — inclua nomes, horários, confirmações mencionadas):`);

  return (text || "Call completed.").trim();
}

// ─── Notify User (Enhanced Post-Call Report) ─────────

async function notifyUser(call: ActiveCall, status: string): Promise<void> {
  call.notified = true; // Prevent duplicate notifications
  console.log(`[VOICE] Sending post-call report for ${call.callId} to ${call.channel}:${call.userId}`);

  const statusEmojis: Record<string, string> = {
    completed: "✅",
    busy: "📵",
    "no-answer": "📱",
    failed: "❌",
    canceled: "🚫",
  };

  const emoji = statusEmojis[status] || "📞";
  let message: string;

  if (status === "completed" && call.result) {
    // Enhanced post-call report — get real duration from DB
    const dbRows = await prisma.$queryRaw<{ duration: number | null }[]>`
      SELECT duration FROM voice_calls WHERE id = ${call.callId}
    `;
    const realDuration = dbRows[0]?.duration;
    const duration = realDuration
      ? (realDuration >= 60 ? `${Math.floor(realDuration / 60)}min ${realDuration % 60}s` : `${realDuration}s`)
      : (call.transcript.length > 0 ? `~${Math.ceil(call.turnCount / 2 * 15)}s` : "unknown");

    // Extract key points from transcript
    const calleeMessages = call.transcript
      .filter((t) => t.speaker === "callee")
      .map((t) => t.text);

    let report = `📞 *Ligação concluída com ${call.businessName}* (${duration})\n\n`;
    report += `${emoji} ${call.result}\n`;

    // If there were notable callee messages, include them
    if (calleeMessages.length > 0) {
      const notable = calleeMessages.filter((m) => m.length > 10).slice(-3);
      if (notable.length > 0) {
        report += `\n💬 *O que ${call.businessName} disse:*\n`;
        notable.forEach((m) => {
          report += `  • "${m}"\n`;
        });
      }
    }

    report += `\nPrecisa de mais alguma coisa?`;
    message = report;
  } else if (status === "busy") {
    message = `${emoji} *${call.businessName}* — Linha ocupada. Quer que eu tente novamente?`;
  } else if (status === "no-answer") {
    message = `${emoji} *${call.businessName}* — Não atendeu. Quer que eu tente de novo em 30 minutos?`;
  } else if (status === "failed") {
    message = `${emoji} *${call.businessName}* — Chamada falhou. O número pode ser inválido.`;
  } else {
    message = `${emoji} *${call.businessName}* — Chamada ${status}.`;
  }

  try {
    if (call.channel === "whatsapp") {
      const { sendWhatsAppMessage } = await import("../twilio-whatsapp.service.js");
      // userId may be "whatsapp:+1234" — strip prefix to get clean phone for sendWhatsAppMessage
      const cleanPhone = call.userId.replace(/^whatsapp:/, "");
      await sendWhatsAppMessage(cleanPhone, message);
    } else if (call.channel === "telegram") {
      const res = await fetch(`http://localhost:4000/api/premium/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
        body: JSON.stringify({ userId: call.userId, text: `[SYSTEM] Call result: ${message}`, platform: "telegram" }),
      });
      if (!res.ok) console.error(`[VOICE] Failed to notify via Telegram: ${res.status}`);
    }
  } catch (err) {
    console.error(`[VOICE] Failed to notify user ${call.userId}:`, (err as Error).message);
  }
}

// ─── Rate Limiting ───────────────────────────────────

async function checkRateLimit(userId: string): Promise<void> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM voice_calls
    WHERE user_id = ${userId} AND created_at > now() - interval '24 hours'
  `;
  const count = rows[0]?.count || 0;

  const cleanPhone = userId.replace("whatsapp:", "");
  const userRows = await prisma.$queryRaw<{ planType: string | null }[]>`
    SELECT "planType" FROM users WHERE id = ${userId} OR phone = ${cleanPhone}
    LIMIT 1
  `;
  const isPremium = userRows[0]?.planType === "premium";
  const limit = isPremium ? DAILY_LIMIT_PREMIUM : DAILY_LIMIT_FREE;

  if (count >= limit) {
    throw new Error(`Daily call limit reached (${limit}/day). ${isPremium ? "Try again tomorrow." : "Upgrade to Premium for more calls."}`);
  }
}

// ─── End Call ────────────────────────────────────────

async function endCallWithSummary(call: ActiveCall, reason: string): Promise<string> {
  call.completed = true;

  if (!call.result) {
    call.result = await generateCallSummary(call);
  }

  await updateTranscript(call);
  await prisma.$executeRaw`
    UPDATE voice_calls SET result = ${call.result}, status = ${"completed"}, updated_at = now()
    WHERE id = ${call.callId}
  `;

  const closings: Record<string, string[]> = {
    en: [
      "Thank you so much for your help! Have a great day.",
      "Thanks a lot! Take care, bye.",
      "Appreciate your help! Have a wonderful day.",
    ],
    pt: [
      "Muito obrigado pela ajuda! Tenha um ótimo dia.",
      "Valeu pela ajuda! Bom dia pra você.",
      "Obrigado! Tenha um excelente dia.",
    ],
    es: [
      "Muchas gracias por su ayuda. Que tenga un buen día.",
      "Gracias por todo. Que le vaya bien.",
    ],
    fr: [
      "Merci beaucoup pour votre aide! Bonne journée.",
      "Merci! Passez une bonne journée.",
    ],
  };

  const closing = randomPick(closings[call.language] || closings.en);
  const audioUrl = await generateSpeech(closing, call.callId);
  return buildTwiml(closing, audioUrl, call.language, call.callId, false);
}

async function updateTranscript(call: ActiveCall): Promise<void> {
  await prisma.$executeRaw`
    UPDATE voice_calls SET transcript = ${JSON.stringify(call.transcript)}::jsonb, updated_at = now()
    WHERE id = ${call.callId}
  `;
}

// ─── TwiML Helpers ───────────────────────────────────

function getPollyVoice(lang: string): string {
  const voices: Record<string, string> = {
    en: "Polly.Matthew-Neural",
    pt: "Polly.Camila-Neural",
    es: "Polly.Sergio-Neural",
    fr: "Polly.Remi-Neural",
  };
  return voices[lang] || voices.en;
}

function getSpeechLang(lang: string): string {
  const langs: Record<string, string> = {
    en: "en-US",
    pt: "pt-BR",
    es: "es-US",
    fr: "fr-FR",
  };
  return langs[lang] || langs.en;
}

function getNoResponseMessage(lang: string): string {
  const msgs: Record<string, string> = {
    en: "I didn't hear a response. Thank you for your time, goodbye.",
    pt: "Não recebi resposta. Obrigado pelo seu tempo, até logo.",
    es: "No recibí respuesta. Gracias por su tiempo, adiós.",
    fr: "Je n'ai pas reçu de réponse. Merci pour votre temps, au revoir.",
  };
  return msgs[lang] || msgs.en;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Call Intelligence: Adaptive Learning ──────────────

interface ContactIntel {
  contactPhone: string;
  contactName: string | null;
  totalCalls: number;
  personalityType: string | null;
  speaksLanguage: string | null;
  preferredGreeting: string | null;
  bestTimeToCall: string | null;
  notes: string | null;
  lastCallOutcome: string | null;
  lastCallMood: string | null;
}

/** Fetch intelligence about a contact before calling them */
export async function getContactIntelligence(phone: string): Promise<ContactIntel | null> {
  try {
    const rows = await prisma.$queryRaw<ContactIntel[]>`
      SELECT "contactPhone", "contactName", "totalCalls", "personalityType",
             "speaksLanguage", "preferredGreeting", "bestTimeToCall", "notes",
             "lastCallOutcome", "lastCallMood"
      FROM call_intelligence
      WHERE "contactPhone" = ${phone}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch {
    return null;
  }
}

/** Build adaptive prompt section from contact intelligence */
function buildIntelligencePrompt(intel: ContactIntel): string {
  const lines: string[] = ["\n\n=== CONTACT INTELLIGENCE (from previous calls) ==="];

  if (intel.totalCalls > 0) {
    lines.push(`You have called this person ${intel.totalCalls} time(s) before.`);
  }
  if (intel.personalityType) {
    lines.push(`Personality: ${intel.personalityType}`);
    if (intel.personalityType === "impatient") {
      lines.push("STRATEGY: Skip small talk. Get to the point FAST. Short sentences. No fillers.");
    } else if (intel.personalityType === "friendly") {
      lines.push("STRATEGY: Be warm and chatty. Build rapport. Ask how they are. Take your time.");
    } else if (intel.personalityType === "suspicious" || intel.personalityType === "skeptical") {
      lines.push("STRATEGY: Be transparent immediately. State who you are and why you're calling in the first 5 seconds. Don't be pushy.");
    } else if (intel.personalityType === "hostile") {
      lines.push("STRATEGY: Be extremely polite. Keep it very brief. If they seem upset, offer to have the owner call back. Don't push.");
    } else if (intel.personalityType === "playful") {
      lines.push("STRATEGY: Match their energy. Joke along lightly. Be fun but still deliver the message.");
    }
  }
  if (intel.preferredGreeting) {
    lines.push(`Preferred greeting: "${intel.preferredGreeting}"`);
  }
  if (intel.speaksLanguage) {
    lines.push(`Language: ${intel.speaksLanguage}`);
  }
  if (intel.notes) {
    lines.push(`Notes: ${intel.notes}`);
  }
  if (intel.lastCallOutcome) {
    lines.push(`Last call result: ${intel.lastCallOutcome} (mood: ${intel.lastCallMood || "unknown"})`);
  }

  lines.push("=== END INTELLIGENCE ===");
  return lines.join("\n");
}

/** Analyze a completed call and update intelligence */
export async function analyzeCallAndLearn(call: ActiveCall): Promise<void> {
  if (!call.transcript || call.transcript.length === 0) return;

  const transcript = call.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  const phone = call.to;

  try {
    // Ask Gemini to analyze the call
    const analysis = await geminiGenerate(`Analyze this phone call transcript and classify it.

TRANSCRIPT:
${transcript}

Respond in EXACTLY this JSON format (no markdown, no explanation):
{
  "callOutcome": "completed|voicemail|rejected|no_answer|detected_as_bot",
  "personMood": "friendly|impatient|suspicious|playful|hostile|neutral",
  "personalityType": "formal|casual|impatient|friendly|skeptical|playful",
  "detectedAsBot": true/false,
  "botDetectionMoment": "description of when they detected AI, or null",
  "adaptationNotes": "1-2 sentences about what to do differently next time",
  "preferredGreeting": "how this person seems to prefer being greeted",
  "speaksLanguage": "en|pt|es"
}`);

    if (!analysis) return;

    // Parse JSON from Gemini response
    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || "{}");
    } catch {
      console.warn("[VOICE-INTEL] Failed to parse Gemini analysis");
      return;
    }

    const outcome = (parsed.callOutcome as string) || "completed";
    const mood = (parsed.personMood as string) || "neutral";
    const personality = (parsed.personalityType as string) || "casual";
    const detectedBot = Boolean(parsed.detectedAsBot);
    const botMoment = (parsed.botDetectionMoment as string) || null;
    const notes = (parsed.adaptationNotes as string) || null;
    const greeting = (parsed.preferredGreeting as string) || null;
    const lang = (parsed.speaksLanguage as string) || "en";

    // Update call_recordings with analysis
    await prisma.$executeRaw`
      UPDATE call_recordings
      SET "callOutcome" = ${outcome}, "personMood" = ${mood},
          "adaptationNotes" = ${notes}, "detectedAsBot" = ${detectedBot},
          "botDetectionMoment" = ${botMoment}
      WHERE "callSid" = ${call.callSid || ""}
    `;

    // Upsert call_intelligence for this contact
    const duration = call.transcript.length > 0 ? Math.floor((Date.now() - (call.startedAt || Date.now())) / 1000) : 0;
    const isSuccess = outcome === "completed" && !detectedBot;

    await prisma.$executeRaw`
      INSERT INTO call_intelligence (id, "contactPhone", "contactName", "totalCalls", "avgDurationSeconds",
        "successfulCalls", "preferredGreeting", "personalityType", "speaksLanguage",
        "notes", "lastCallOutcome", "lastCallMood", "lastCallAt", "createdAt", "updatedAt")
      VALUES (
        ${`ci_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`},
        ${phone}, ${call.businessName || null}, 1, ${duration},
        ${isSuccess ? 1 : 0}, ${greeting}, ${personality}, ${lang},
        ${notes}, ${outcome}, ${mood}, now(), now(), now()
      )
      ON CONFLICT ("contactPhone") DO UPDATE SET
        "contactName" = COALESCE(EXCLUDED."contactName", call_intelligence."contactName"),
        "totalCalls" = call_intelligence."totalCalls" + 1,
        "avgDurationSeconds" = (call_intelligence."avgDurationSeconds" * call_intelligence."totalCalls" + ${duration}) / (call_intelligence."totalCalls" + 1),
        "successfulCalls" = call_intelligence."successfulCalls" + ${isSuccess ? 1 : 0},
        "preferredGreeting" = COALESCE(EXCLUDED."preferredGreeting", call_intelligence."preferredGreeting"),
        "personalityType" = EXCLUDED."personalityType",
        "speaksLanguage" = EXCLUDED."speaksLanguage",
        "notes" = CASE
          WHEN call_intelligence.notes IS NULL THEN EXCLUDED.notes
          ELSE call_intelligence.notes || E'\n' || COALESCE(EXCLUDED.notes, '')
        END,
        "lastCallOutcome" = EXCLUDED."lastCallOutcome",
        "lastCallMood" = EXCLUDED."lastCallMood",
        "lastCallAt" = now(),
        "updatedAt" = now()
    `;

    console.log(`[VOICE-INTEL] Call to ${phone} analyzed: outcome=${outcome}, mood=${mood}, personality=${personality}, bot_detected=${detectedBot}`);
  } catch (err) {
    console.error(`[VOICE-INTEL] Analysis failed for ${phone}:`, (err as Error).message);
  }
}
