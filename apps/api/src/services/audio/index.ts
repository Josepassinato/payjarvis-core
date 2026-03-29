/**
 * Audio Module — Core audio capabilities for PayJarvis
 *
 * Exports STT, TTS, and converter services.
 * Every bot (WhatsApp, Telegram, future platforms) uses these.
 */

export { transcribeAudio } from "./stt.service.js";
export { textToSpeech, cleanupFiles, readAudioAsBase64 } from "./tts.service.js";
export { convertToWav, downloadAudio, downloadAudioAsBase64, cleanupFile } from "./converter.service.js";
