/**
 * TTS Service — Gemini TTS → ElevenLabs → edge-tts fallback chain
 *
 * Converts text to OGG Opus audio files.
 * Primary: Gemini 2.5 Flash TTS (REST API, included in Gemini billing)
 * Secondary: ElevenLabs (if API key configured)
 * Fallback: edge-tts (free, always available)
 *
 * Used by WhatsApp and Telegram voice reply handlers.
 */

import { execFile } from "child_process";
import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Config ─────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;

const GEMINI_VOICES: Record<string, string> = {
  pt: "Orus",
  en: "Orus",
  es: "Kore",
  fr: "Orus",
  de: "Orus",
  it: "Orus",
  ja: "Orus",
  ko: "Orus",
  zh: "Orus",
  ru: "Orus",
  ar: "Orus",
};

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";

const EDGE_TTS_VOICES: Record<string, string> = {
  pt: "pt-BR-FranciscaNeural",
  en: "en-US-JennyNeural",
  es: "es-MX-DaliaNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
  it: "it-IT-ElsaNeural",
  ja: "ja-JP-NanamiNeural",
  ko: "ko-KR-SunHiNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  ru: "ru-RU-SvetlanaNeural",
  ar: "ar-SA-ZariyahNeural",
};

const MAX_TEXT_LENGTH = 4000;
const TIMEOUT_MS = 30000;

// ─── Helpers ────────────────────────────────────────

function tmpFile(ext: string): string {
  return join(tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

export function cleanupFiles(...files: string[]) {
  for (const f of files) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
}

/** Convert any audio file to OGG Opus via ffmpeg */
function convertToOgg(inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = tmpFile("ogg");
    execFile("ffmpeg", [
      "-i", inputPath,
      "-c:a", "libopus",
      "-b:a", "48k",
      "-ar", "24000",
      "-ac", "1",
      "-y",
      outputPath,
    ], { timeout: 15000 }, (err) => {
      if (err) return reject(new Error(`ffmpeg ogg conversion failed: ${err.message}`));
      resolve(outputPath);
    });
  });
}

/** Convert raw PCM (s16le, 24kHz, mono) to OGG Opus via ffmpeg */
function convertPcmToOgg(pcmPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = tmpFile("ogg");
    execFile("ffmpeg", [
      "-f", "s16le",
      "-ar", "24000",
      "-ac", "1",
      "-i", pcmPath,
      "-c:a", "libopus",
      "-b:a", "48k",
      "-ar", "24000",
      "-ac", "1",
      "-y",
      outputPath,
    ], { timeout: 15000 }, (err) => {
      if (err) return reject(new Error(`ffmpeg pcm→ogg failed: ${err.message}`));
      resolve(outputPath);
    });
  });
}

// ─── Gemini TTS Provider (Primary) ──────────────────

async function geminiTTS(text: string, lang: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const voice = GEMINI_VOICES[lang] || GEMINI_VOICES.en;
  const url = `${GEMINI_TTS_URL}?key=${GEMINI_API_KEY}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: { voice_name: voice },
            },
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini TTS API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as {
      candidates?: Array<{
        content: { parts: Array<{ inlineData?: { data: string; mimeType: string } }> };
      }>;
    };

    const parts = data?.candidates?.[0]?.content?.parts;
    if (!parts) throw new Error("Gemini TTS: no parts in response");

    const audioPart = parts.find(p => p.inlineData);
    if (!audioPart?.inlineData) throw new Error("Gemini TTS: no audio data in response");

    // Decode base64 PCM and save
    const pcmBuffer = Buffer.from(audioPart.inlineData.data, "base64");
    const pcmPath = tmpFile("pcm");
    writeFileSync(pcmPath, pcmBuffer);

    // Convert PCM (s16le, 24kHz, mono) → OGG Opus
    const oggPath = await convertPcmToOgg(pcmPath);
    cleanupFiles(pcmPath);

    return oggPath;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── ElevenLabs Provider (Secondary) ────────────────

async function elevenLabsTTS(text: string, lang: string): Promise<string> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        language_code: lang,
        apply_text_normalization: "auto",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs API ${res.status}: ${body.slice(0, 200)}`);
    }

    const mp3Path = tmpFile("mp3");
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(mp3Path, buffer);

    const oggPath = await convertToOgg(mp3Path);
    cleanupFiles(mp3Path);
    return oggPath;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── edge-tts Fallback (Last Resort) ────────────────

function edgeTTS(text: string, lang: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mp3Path = tmpFile("mp3");
    const voice = EDGE_TTS_VOICES[lang] || EDGE_TTS_VOICES.en;

    execFile("edge-tts", [
      "--voice", voice,
      "--text", text,
      "--write-media", mp3Path,
    ], { timeout: TIMEOUT_MS }, async (err) => {
      if (err) return reject(new Error(`edge-tts failed: ${err.message}`));
      try {
        const oggPath = await convertToOgg(mp3Path);
        cleanupFiles(mp3Path);
        resolve(oggPath);
      } catch (convErr) {
        cleanupFiles(mp3Path);
        reject(convErr);
      }
    });
  });
}

// ─── Strip Markdown ─────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[-*+]\s/g, "")
    .trim();
}

// ─── Public API ─────────────────────────────────────

/**
 * Convert text to OGG Opus voice note.
 * Returns path to temporary .ogg file (caller must delete after use).
 * Chain: Gemini TTS → ElevenLabs → edge-tts
 *
 * @param text - Text to convert
 * @param lang - Language code (pt, en, es, fr, etc.)
 * @returns Path to .ogg file, or null on failure
 */
export async function textToSpeech(text: string, lang = "pt"): Promise<string | null> {
  const truncated = text.length > MAX_TEXT_LENGTH
    ? text.slice(0, MAX_TEXT_LENGTH) + "..."
    : text;

  const clean = stripMarkdown(truncated);
  if (!clean) return null;

  // 1. Try Gemini TTS (primary — best quality, included in Gemini billing)
  if (GEMINI_API_KEY) {
    try {
      const oggPath = await geminiTTS(clean, lang);
      console.log("[TTS] Gemini OK, lang:", lang);
      return oggPath;
    } catch (err) {
      console.error("[TTS] Gemini failed:", (err as Error).message);
    }
  }

  // 2. Try ElevenLabs (secondary)
  if (ELEVENLABS_API_KEY) {
    try {
      const oggPath = await elevenLabsTTS(clean, lang);
      console.log("[TTS] ElevenLabs OK, lang:", lang);
      return oggPath;
    } catch (err) {
      console.error("[TTS] ElevenLabs failed:", (err as Error).message);
    }
  }

  // 3. Fallback: edge-tts (free, always available)
  try {
    const oggPath = await edgeTTS(clean, lang);
    console.log("[TTS] edge-tts OK, lang:", lang);
    return oggPath;
  } catch (err) {
    console.error("[TTS] All TTS providers failed. edge-tts error:", (err as Error).message);
    return null;
  }
}

/**
 * Read an OGG file and return as base64 string.
 * Useful for sending audio via Twilio MediaUrl or inline.
 */
export function readAudioAsBase64(filePath: string): string {
  return readFileSync(filePath).toString("base64");
}
