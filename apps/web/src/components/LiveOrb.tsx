"use client";

/**
 * LiveOrb — Premium real-time voice interface with animated orb.
 *
 * Wraps VoiceChat logic (Gemini Live API) in a futuristic orb UI.
 * States: idle, connecting, listening, speaking, error
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type OrbState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface TranscriptEntry {
  role: "user" | "jarvis";
  text: string;
}

interface ChatContext {
  role: "user" | "assistant";
  content: string;
}

export default function LiveOrb({ chatContext = [] }: { chatContext?: ChatContext[] }) {
  const { getToken } = useAuth();
  const [state, setState] = useState<OrbState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
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
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const currentJarvisTextRef = useRef("");

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ─── Audio Playback Queue ───
  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || playQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    setState("speaking");
    // Haptic: Jarvis starts speaking
    if (navigator.vibrate) navigator.vibrate(50);

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
        // Flush accumulated Jarvis text as a single entry
        if (currentJarvisTextRef.current.trim()) {
          setTranscript(prev => [...prev, { role: "jarvis", text: currentJarvisTextRef.current.trim() }]);
          currentJarvisTextRef.current = "";
        }
        setState("listening");
        // Haptic: back to listening
        if (navigator.vibrate) navigator.vibrate(30);
      }
    };
    source.start();
  }, []);

  // ─── Decode and queue audio ───
  const handleAudioData = useCallback(async (base64Audio: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const raw = atob(base64Audio);
    const bytes = new Int16Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }

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
      setTranscript([]);
      setMinutesUsed(0);
      currentJarvisTextRef.current = "";

      const token = await getToken();
      if (!token) { setError("Please sign in first"); setState("idle"); return; }

      const res = await fetch(`${API_URL}/api/voice/realtime-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to create session"); setState("idle"); return; }

      sessionIdRef.current = data.sessionId;

      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const ws = new WebSocket(data.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
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
              parts: [{ text: data.config.systemInstruction + (chatContext.length > 0
                ? "\n\n--- Recent chat context (user was just texting about this) ---\n" +
                  chatContext.map(m => `${m.role === "user" ? "User" : "Jarvis"}: ${m.content}`).join("\n")
                : ""
              ) }],
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
          if (msg.setupComplete) return;

          if (msg.serverContent) {
            const parts = msg.serverContent.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                handleAudioData(part.inlineData.data);
              }
              if (part.text) {
                currentJarvisTextRef.current += part.text;
              }
            }
            if (msg.serverContent.inputTranscription?.text) {
              setTranscript(prev => [...prev, { role: "user", text: msg.serverContent.inputTranscription.text }]);
            }
          }

          if (msg.toolCall) {
            console.log("[LiveOrb] Tool call:", msg.toolCall);
          }
        } catch {
          // Non-JSON
        }
      };

      ws.onerror = () => {
        setError("Connection error");
        setState("error");
      };

      ws.onclose = () => {
        setState("idle");
        cleanup();
      };

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
  }, [getToken, handleAudioData]);

  // ─── Microphone ───
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
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

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
    } catch {
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
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    wsRef.current = null;

    if (sessionIdRef.current) {
      await fetch(`${API_URL}/api/voice/realtime-session/${sessionIdRef.current}/end`, {
        method: "POST",
      }).catch(() => {});
    }

    cleanup();
    setState("idle");
  }, [cleanup]);

  useEffect(() => {
    return () => { endSession(); };
  }, [endSession]);

  // ─── Format timer ───
  const formatTimer = (mins: number) => {
    const m = Math.floor(mins);
    const s = (mins - m) * 60;
    return `${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}`;
  };

  // ─── Timer seconds (for display) ───
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (state === "idle" || state === "error") {
      setSeconds(0);
      return;
    }
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [state]);

  const timerDisplay = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const isActive = state !== "idle" && state !== "error";

  return (
    <div className="flex flex-col items-center h-full relative">
      {/* Background particles/grid */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,191,255,0.03)_0%,transparent_70%)]" />
        <div className="live-grid-pattern absolute inset-0 opacity-[0.03]" />
      </div>

      {/* Top status */}
      <div className="relative z-10 flex items-center gap-2 mt-6 mb-2">
        {isActive && (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium uppercase tracking-wider">
              {state === "connecting" ? "Connecting" : "Live Session"}
            </span>
          </>
        )}
        {!isActive && (
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">
            Real-time Voice
          </span>
        )}
      </div>

      {/* ─── The Orb ─── */}
      <div className="relative z-10 flex-shrink-0 my-auto flex items-center justify-center">
        {/* Outer glow rings */}
        <div className={`absolute w-56 h-56 rounded-full transition-all duration-1000 ${
          state === "speaking"
            ? "bg-gradient-to-br from-cyan-500/20 to-purple-600/20 animate-orb-pulse-fast"
            : state === "listening"
            ? "bg-gradient-to-br from-cyan-500/10 to-purple-600/10 animate-orb-pulse"
            : "bg-gradient-to-br from-cyan-500/5 to-purple-600/5"
        }`} />

        <div className={`absolute w-48 h-48 rounded-full transition-all duration-700 ${
          state === "speaking"
            ? "bg-gradient-to-br from-cyan-400/25 to-purple-500/25 animate-orb-pulse-fast"
            : state === "listening"
            ? "bg-gradient-to-br from-cyan-400/15 to-purple-500/15 animate-orb-pulse"
            : "bg-gradient-to-br from-cyan-400/5 to-purple-500/5"
        }`} style={{ animationDelay: "0.2s" }} />

        {/* Main orb */}
        <button
          onClick={isActive ? endSession : startSession}
          className={`relative w-40 h-40 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            state === "error"
              ? "bg-gradient-to-br from-red-500 to-red-700 shadow-[0_0_60px_rgba(239,68,68,0.4)]"
              : isActive
              ? "bg-gradient-to-br from-cyan-500 via-blue-600 to-purple-700 shadow-[0_0_80px_rgba(0,191,255,0.3)]"
              : "bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 shadow-[0_0_40px_rgba(0,191,255,0.1)] hover:shadow-[0_0_60px_rgba(0,191,255,0.2)]"
          }`}
        >
          {/* Inner glass effect */}
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white/10 to-transparent" />

          {/* Waveform bars inside orb */}
          {isActive && (
            <div className="flex items-center gap-[3px] h-12">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className={`w-[3px] rounded-full transition-all ${
                    state === "speaking"
                      ? "bg-white animate-orb-wave"
                      : state === "listening"
                      ? "bg-white/70 animate-orb-wave-slow"
                      : "bg-white/40"
                  }`}
                  style={{
                    height: isActive ? `${12 + Math.sin(i * 0.7) * 20}px` : "8px",
                    animationDelay: `${i * 0.08}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Idle state icon */}
          {!isActive && (
            <div className="flex flex-col items-center gap-2">
              <svg className="w-10 h-10 text-cyan-400 group-hover:text-cyan-300 transition-colors" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
              <span className="text-xs text-gray-400 group-hover:text-gray-300 font-medium">Tap to start</span>
            </div>
          )}
        </button>

        {/* Rotating ring */}
        {isActive && (
          <div className="absolute w-52 h-52 rounded-full border border-cyan-500/20 animate-spin-slow" style={{ animationDuration: "8s" }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,191,255,0.8)]" />
          </div>
        )}
      </div>

      {/* State label */}
      <div className="relative z-10 text-center mb-2">
        <p className={`text-sm font-medium ${
          state === "speaking" ? "text-cyan-400" :
          state === "listening" ? "text-emerald-400" :
          state === "connecting" ? "text-yellow-400" :
          state === "error" ? "text-red-400" :
          "text-gray-500"
        }`}>
          {state === "idle" && "Talk to Jarvis in real-time"}
          {state === "connecting" && "Connecting..."}
          {state === "listening" && "Listening..."}
          {state === "speaking" && "Jarvis is speaking..."}
          {state === "error" && (error || "Connection error")}
        </p>
        {isActive && (
          <p className="text-xs text-gray-500 mt-1 font-mono">{timerDisplay}</p>
        )}
      </div>

      {/* Transcript */}
      {transcript.length > 0 && (
        <div className="relative z-10 w-full max-w-sm mx-auto mb-4 max-h-36 overflow-y-auto rounded-xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm px-4 py-3 space-y-2 scrollbar-hide">
          {transcript.map((entry, i) => (
            <div key={i} className={`text-xs leading-relaxed ${
              entry.role === "user" ? "text-gray-400" : "text-gray-200"
            }`}>
              <span className={`font-semibold ${
                entry.role === "user" ? "text-cyan-400/70" : "text-purple-400/70"
              }`}>
                {entry.role === "user" ? "You" : "Jarvis"}:
              </span>{" "}
              {entry.text}
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* End session button */}
      {isActive && (
        <button
          onClick={endSession}
          className="relative z-10 flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/[0.06] border border-white/10 text-gray-300 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400 transition-all mb-6"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          <span className="text-sm font-medium">End Session</span>
        </button>
      )}
    </div>
  );
}
