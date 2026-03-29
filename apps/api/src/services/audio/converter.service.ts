/**
 * Audio Converter Service — ffmpeg wrappers for audio format conversion
 *
 * Handles downloading audio from URLs and converting between formats.
 * Used by WhatsApp webhook to process incoming voice messages.
 */

import { execFile } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function tmpFile(ext: string): string {
  return join(tmpdir(), `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

export function cleanupFile(filePath: string) {
  try { unlinkSync(filePath); } catch { /* ignore */ }
}

/**
 * Convert any audio file to WAV 16kHz mono (optimal for STT).
 */
export function convertToWav(inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = tmpFile("wav");
    execFile("ffmpeg", [
      "-i", inputPath,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      "-y",
      outputPath,
    ], { timeout: 15000 }, (err) => {
      if (err) return reject(new Error(`ffmpeg wav conversion failed: ${err.message}`));
      resolve(outputPath);
    });
  });
}

/**
 * Download audio from a URL (e.g., Twilio MediaUrl) and save to temp file.
 * Supports Twilio Basic Auth via accountSid/authToken.
 */
export async function downloadAudio(
  url: string,
  ext: string,
  accountSid?: string,
  authToken?: string
): Promise<string> {
  const headers: Record<string, string> = {};
  if (accountSid && authToken) {
    headers["Authorization"] = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Failed to download audio: HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const filePath = tmpFile(ext);
  writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Download audio from URL and return as Buffer directly.
 * Skips writing to disk — useful when sending straight to Gemini STT
 * (Gemini accepts audio/ogg natively, no WAV conversion needed).
 */
export async function downloadAudioAsBase64(
  url: string,
  accountSid?: string,
  authToken?: string
): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (accountSid && authToken) {
    headers["Authorization"] = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Failed to download audio: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
