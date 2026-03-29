"use client";

/**
 * VoiceChat — Realtime voice conversation with Jarvis via Gemini Live API.
 *
 * Flow:
 * 1. User clicks "Talk to Jarvis" → POST /api/voice/realtime-session
 * 2. Opens WebSocket to Gemini Live API (wss://generativelanguage...)
 * 3. Sends config message (model, systemInstruction, responseModalities)
 * 4. Captures mic audio → PCM 16kHz → base64 → sends to WS
 * 5. Receives audio chunks from Gemini → plays via AudioContext
 * 6. VAD is server-side (Gemini detects when user stops talking)
 * 7. Billing: tick every 60s, end on close
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

export default function VoiceChat() {
  const { getToken } = useAuth();
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [minutesUsed, setMinutesUsed] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionIdRef = useRef<string>("");
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // ─── Audio Playback Queue ───

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || playQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    setState("speaking");

    const buffer = playQueueRef.current.shift()!;
    const ctx = audioContextRef.current;
    if (!ctx) { isPlayingRef.current = false; return; }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      if (playQueueRef.current.length > 0) {
        playNextInQueue();
      } else {
        setState("listening");
      }
    };
    source.start();
  }, []);

  // ─── Decode and queue audio from Gemini ───

  const handleAudioData = useCallback(async (base64Audio: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const raw = atob(base64Audio);
    const bytes = new Int16Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }

    // Convert Int16 → Float32 at 24kHz
    const float32 = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      float32[i] = bytes[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);
    playQueueRef.current.push(audioBuffer);
    playNextInQueue();
  }, [playNextInQueue]);

  // ─── Start Session ───

  const startSession = useCallback(async () => {
    try {
      setState("connecting");
      setError("");
      setTranscript("");
      setMinutesUsed(0);

      const token = await getToken();
      if (!token) { setError("Please sign in first"); setState("idle"); return; }

      // 1. Create session on backend
      const res = await fetch(`${API_URL}/api/voice/realtime-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to create session"); setState("idle"); return; }

      sessionIdRef.current = data.sessionId;

      // 2. Create AudioContext
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      // 3. Connect to Gemini Live WS
      const ws = new WebSocket(data.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send config message
        const configMsg = {
          setup: {
            model: data.model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
              }
            },
            systemInstruction: {
              parts: [{ text: data.config.systemInstruction }],
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
                prefixPaddingMs: 20,
                silenceDurationMs: 300,
              },
            },
          },
        };
        ws.send(JSON.stringify(configMsg));
        startMicrophone(ctx);
        setState("listening");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Setup complete
          if (msg.setupComplete) return;

          // Server content (audio + text)
          if (msg.serverContent) {
            const parts = msg.serverContent.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                handleAudioData(part.inlineData.data);
              }
              if (part.text) {
                setTranscript(prev => prev + part.text);
              }
            }
            // Input transcription
            if (msg.serverContent.inputTranscription?.text) {
              setTranscript(prev => prev + "\n🎤 " + msg.serverContent.inputTranscription.text);
            }
          }

          // Tool calls (future: connect to PayJarvis tools)
          if (msg.toolCall) {
            console.log("[VoiceChat] Tool call:", msg.toolCall);
          }
        } catch {
          // Non-JSON message, ignore
        }
      };

      ws.onerror = () => {
        setError("Connection error");
        setState("error");
      };

      ws.onclose = () => {
        if (state !== "idle") {
          setState("idle");
        }
        cleanup();
      };

      // 4. Start billing tick
      tickIntervalRef.current = setInterval(async () => {
        setMinutesUsed(prev => prev + 1);
        await fetch(`${API_URL}/api/voice/realtime-session/${data.sessionId}/tick`, {
          method: "POST",
        }).catch(() => {});
      }, 60000);

    } catch (err: any) {
      setError(err.message);
      setState("error");
    }
  }, [getToken, handleAudioData, state]);

  // ─── Microphone Capture ───

  const startMicrophone = useCallback(async (ctx: AudioContext) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 → Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert to base64
        const uint8 = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
          },
        }));
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    } catch (err: any) {
      setError("Microphone access denied");
      setState("error");
    }
  }, []);

  // ─── Cleanup ───

  const cleanup = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    playQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // ─── End Session ───

  const endSession = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    wsRef.current = null;

    if (sessionIdRef.current) {
      await fetch(`${API_URL}/api/voice/realtime-session/${sessionIdRef.current}/end`, {
        method: "POST",
      }).catch(() => {});
    }

    cleanup();
    setState("idle");
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { endSession(); };
  }, [endSession]);

  // ─── UI ───

  const stateLabel: Record<VoiceState, string> = {
    idle: "Talk to Jarvis",
    connecting: "Connecting...",
    listening: "Listening...",
    speaking: "Jarvis is speaking...",
    error: "Error — Tap to retry",
  };

  const stateColor: Record<VoiceState, string> = {
    idle: "bg-gradient-to-r from-cyan-500 to-blue-600",
    connecting: "bg-yellow-500 animate-pulse",
    listening: "bg-green-500 animate-pulse",
    speaking: "bg-cyan-500 animate-pulse",
    error: "bg-red-500",
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Main button */}
      <button
        onClick={state === "idle" || state === "error" ? startSession : endSession}
        className={`${stateColor[state]} text-white font-semibold px-6 py-3 rounded-full shadow-lg transition-all duration-300 flex items-center gap-2`}
      >
        {state === "idle" || state === "error" ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
            {stateLabel[state]}
          </>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
            End Call
          </>
        )}
      </button>

      {/* Status indicators */}
      {state === "listening" && (
        <div className="flex gap-1 items-end h-6">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-green-400 rounded-full animate-bounce"
              style={{
                height: `${8 + Math.random() * 16}px`,
                animationDelay: `${i * 0.1}s`,
                animationDuration: "0.6s",
              }}
            />
          ))}
        </div>
      )}

      {state === "speaking" && (
        <div className="flex gap-1 items-end h-6">
          {[...Array(7)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-cyan-400 rounded-full animate-bounce"
              style={{
                height: `${4 + Math.random() * 20}px`,
                animationDelay: `${i * 0.08}s`,
                animationDuration: "0.4s",
              }}
            />
          ))}
        </div>
      )}

      {/* Timer */}
      {state !== "idle" && state !== "error" && (
        <span className="text-xs text-gray-400">{minutesUsed}m elapsed</span>
      )}

      {/* Error */}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Transcript */}
      {transcript && (
        <div className="mt-2 max-h-32 overflow-y-auto text-xs text-gray-500 bg-gray-900/50 rounded-lg p-2 w-full">
          {transcript}
        </div>
      )}
    </div>
  );
}
