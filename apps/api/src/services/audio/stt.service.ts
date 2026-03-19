/**
 * STT Service — Speech-to-Text via Gemini
 *
 * Transcribes audio (WAV base64) to text using Gemini 2.5 Flash.
 * Used by WhatsApp and Telegram voice message handlers.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/**
 * Transcribe audio to text using Gemini.
 * @param audioBase64 - Base64-encoded audio (WAV preferred)
 * @param mimeType - MIME type of the audio (default: audio/wav)
 * @returns Transcribed text, or null on failure
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = "audio/wav"
): Promise<string | null> {
  if (!GEMINI_API_KEY) {
    console.error("[STT] GEMINI_API_KEY not configured");
    return null;
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      },
      "Transcribe this audio to text. Return ONLY the transcribed text, no formatting, no quotes, no explanation. Detect the language automatically.",
    ]);

    const text = result.response.text().trim();
    console.log(`[STT] Transcribed: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
    return text || null;
  } catch (err) {
    console.error("[STT] Gemini transcription failed:", (err as Error).message);
    return null;
  }
}
