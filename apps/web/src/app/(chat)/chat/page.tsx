"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import dynamic from "next/dynamic";

const VoiceChat = dynamic(() => import("@/components/VoiceChat"), { ssr: false });
const LiveOrb = dynamic(() => import("@/components/LiveOrb"), { ssr: false });

type ChatMode = "chat" | "live";

// ── Types ──

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type: "text" | "audio" | "image" | "document";
  mediaUrl?: string;
  timestamp: Date;
}

// ── API ──

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiSendMessage(
  text: string,
  token: string,
  image?: string,
  imageMimeType?: string
): Promise<{ reply: string }> {
  const res = await fetch(`${API_URL}/web-chat/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text, image, imageMimeType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return { reply: json.data?.reply ?? "..." };
}

async function apiLoadHistory(
  token: string,
  limit = 50
): Promise<ChatMessage[]> {
  const res = await fetch(`${API_URL}/web-chat/history?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const msgs = json.data?.messages ?? [];
  return msgs.map((m: { role: string; content: string; timestamp: string }, i: number) => ({
    id: `hist-${i}`,
    role: m.role as "user" | "assistant",
    content: m.content,
    type: "text" as const,
    timestamp: new Date(m.timestamp),
  }));
}

async function apiSendAudio(
  audioBase64: string,
  mimeType: string,
  token: string
): Promise<{ response: string; transcription: string; audioUrl?: string }> {
  const res = await fetch(`${API_URL}/web-chat/audio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ audio: audioBase64, mimeType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

// ── Helpers ──

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // strip data:mime;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Typing Indicator ──

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 max-w-[80%]">
      <div className="w-8 h-8 rounded-full bg-[#1a1a2e] flex items-center justify-center text-sm flex-shrink-0">
        🦀
      </div>
      <div className="bg-[#2D2D2D] rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ──

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""} max-w-[85%] ${isUser ? "ml-auto" : ""}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[#1a1a2e] flex items-center justify-center text-sm flex-shrink-0">
          🦀
        </div>
      )}
      <div className="flex flex-col gap-1">
        {msg.type === "image" && msg.mediaUrl && (
          <img
            src={msg.mediaUrl}
            alt="Shared"
            className="max-w-[240px] rounded-xl"
          />
        )}
        {msg.type === "audio" && msg.mediaUrl && (
          <audio controls src={msg.mediaUrl} className="max-w-[240px]" />
        )}
        {msg.type === "document" && msg.mediaUrl && (
          <div className="flex items-center gap-2 bg-[#1a1a2e] rounded-xl px-3 py-2">
            <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 18h12a2 2 0 002-2V6l-4-4H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm text-gray-300 truncate">Document</span>
          </div>
        )}
        <div
          className={`px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? "bg-[#00BFFF] text-white rounded-2xl rounded-br-md"
              : "bg-[#2D2D2D] text-white rounded-2xl rounded-bl-md"
          }`}
        >
          {msg.content}
        </div>
        <span
          className={`text-[10px] text-gray-500 px-1 ${isUser ? "text-right" : ""}`}
        >
          {formatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ── Invite Modal ──

function InviteModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { getToken } = useAuth();
  const [links, setLinks] = useState<{ pwa: string; telegram: string; whatsapp: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/referrals/my-code`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setLinks(json.data.links);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [open, getToken]);

  if (!open) return null;

  const share = async (platform: "pwa" | "telegram" | "whatsapp") => {
    if (!links) return;
    const url = links[platform];
    const text = platform === "whatsapp"
      ? "" // whatsapp link already has the message
      : `Try Jarvis, my AI shopping assistant! ${url}`;

    // Try native share on mobile
    if (navigator.share && platform !== "whatsapp") {
      try {
        await navigator.share({ text, url });
        return;
      } catch { /* fallback to copy */ }
    }

    if (platform === "whatsapp") {
      window.open(url, "_blank");
      return;
    }

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(platform === "pwa" ? links.pwa : url);
      setCopied(platform);
      setTimeout(() => setCopied(""), 2000);
    } catch { /* silent */ }
  };

  const options = [
    {
      id: "telegram" as const,
      label: "Telegram",
      desc: "Opens Telegram bot directly",
      color: "bg-[#2AABEE]",
      icon: (
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      ),
    },
    {
      id: "whatsapp" as const,
      label: "WhatsApp",
      desc: "Share via WhatsApp message",
      color: "bg-[#25D366]",
      icon: (
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
    },
    {
      id: "pwa" as const,
      label: "PWA Chat",
      desc: "Link to web chat (no app needed)",
      color: "bg-[#00BFFF]",
      icon: (
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      ),
    },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0f0f19] rounded-t-3xl shadow-2xl animate-slide-up safe-area-bottom">
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mt-3" />
        <div className="px-6 pt-4 pb-2">
          <h2 className="text-lg font-semibold text-white">Invite Friends</h2>
          <p className="text-sm text-gray-400 mt-1">Choose how your friend will use Jarvis</p>
        </div>
        <div className="px-6 pb-6 space-y-3">
          {loading ? (
            <div className="py-8 text-center text-gray-500 text-sm">Loading...</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => share(opt.id)}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors"
              >
                <div className={`w-12 h-12 rounded-xl ${opt.color} flex items-center justify-center flex-shrink-0`}>
                  {opt.icon}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-white font-medium text-sm">{opt.label}</div>
                  <div className="text-gray-400 text-xs">{opt.desc}</div>
                </div>
                <div className="text-gray-500 text-xs">
                  {copied === opt.id ? (
                    <span className="text-emerald-400">Copied!</span>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── Menu Drawer ──

function MenuDrawer({
  open,
  onClose,
  onInvite,
}: {
  open: boolean;
  onClose: () => void;
  onInvite: () => void;
}) {
  if (!open) return null;

  const links = [
    { label: "Dashboard", href: "/dashboard", icon: "📊" },
    { label: "Settings", href: "/bots", icon: "⚙️" },
    { label: "Shopping Setup", href: "/setup-shopping", icon: "🛒" },
    { label: "Payment Methods", href: "/payment-methods", icon: "💳" },
    { label: "Transactions", href: "/transactions", icon: "📋" },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-72 bg-[#0f0f19] z-50 shadow-2xl animate-slide-in-right">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <span className="text-lg font-semibold text-white">Menu</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="p-4 space-y-1">
          {/* Invite button — highlighted */}
          <button
            onClick={() => { onClose(); onInvite(); }}
            className="flex items-center gap-3 px-3 py-3 rounded-lg w-full text-left bg-brand-600/10 text-brand-400 hover:bg-brand-600/20 transition-colors"
          >
            <span className="text-lg">🎁</span>
            <span className="text-sm font-medium">Invite Friends</span>
          </button>
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="text-lg">{l.icon}</span>
              <span className="text-sm font-medium">{l.label}</span>
            </a>
          ))}
        </nav>
      </div>
    </>
  );
}

// ── Attach Menu ──

function AttachMenu({
  open,
  onClose,
  onCamera,
  onLiveCamera,
  onFile,
}: {
  open: boolean;
  onClose: () => void;
  onCamera: () => void;
  onLiveCamera: () => void;
  onFile: () => void;
}) {
  if (!open) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 bg-[#1a1a2e] rounded-xl shadow-xl border border-white/10 overflow-hidden">
      <button
        onClick={() => { onCamera(); onClose(); }}
        className="flex items-center gap-3 px-4 py-3 w-full hover:bg-white/10 text-gray-200 text-sm"
      >
        <svg className="w-5 h-5 text-[#00BFFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Take Photo
      </button>
      <button
        onClick={() => { onLiveCamera(); onClose(); }}
        className="flex items-center gap-3 px-4 py-3 w-full hover:bg-white/10 text-gray-200 text-sm"
      >
        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Live Camera
      </button>
      <button
        onClick={() => { onFile(); onClose(); }}
        className="flex items-center gap-3 px-4 py-3 w-full hover:bg-white/10 text-gray-200 text-sm"
      >
        <svg className="w-5 h-5 text-[#FF6B00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        Document
      </button>
    </div>
  );
}

// ── Live Camera Component ──

function LiveCamera({
  onClose,
  onCapture,
  getToken,
}: {
  onClose: () => void;
  onCapture: (file: File) => void;
  getToken: () => Promise<string | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const questionRef = useRef("");

  // Keep questionRef in sync
  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  // Open camera
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch {
        setError("Could not access camera. Please allow camera permissions.");
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Capture frame and analyze
  const captureFrame = useCallback(async () => {
    if (!videoRef.current || isAnalyzing) return;

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, 640, 480);
    const base64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];

    setIsAnalyzing(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API_URL}/web-chat/vision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image: base64,
          mode: "live",
          question: questionRef.current || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.data?.description || "");
      }
    } catch {
      // Silent fail on live frames
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, getToken]);

  // Auto-capture every 3 seconds
  useEffect(() => {
    intervalRef.current = setInterval(captureFrame, 3000);
    // First frame after 1s camera warmup
    const firstCapture = setTimeout(captureFrame, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearTimeout(firstCapture);
    };
  }, [captureFrame]);

  // Take a snapshot photo and send to chat
  const takePhoto = useCallback(() => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.85
    );
  }, [onCapture, onClose]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-4">
        <p className="text-white text-center px-8">{error}</p>
        <button
          onClick={onClose}
          className="px-6 py-3 bg-[#00BFFF] rounded-xl text-white font-medium"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="flex-1 w-full object-cover"
      />

      {/* Analysis overlay */}
      <div className="absolute bottom-40 left-3 right-3 bg-black/75 backdrop-blur-sm rounded-xl p-3 max-h-32 overflow-y-auto">
        {isAnalyzing && !analysis && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <span className="w-2 h-2 bg-[#00BFFF] rounded-full animate-pulse" />
            Analyzing...
          </div>
        )}
        {analysis && (
          <p className="text-white text-sm leading-relaxed">{analysis}</p>
        )}
        {!analysis && !isAnalyzing && (
          <p className="text-gray-400 text-sm">Point your camera at something...</p>
        )}
      </div>

      {/* Question input */}
      <div className="absolute bottom-28 left-3 right-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about what you see..."
          className="w-full bg-black/60 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-400 outline-none focus:border-[#00BFFF]"
        />
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-8 pb-[env(safe-area-inset-bottom)]">
        {/* Close */}
        <button
          onClick={onClose}
          className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
          aria-label="Close camera"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Capture photo */}
        <button
          onClick={takePhoto}
          className="rounded-full bg-white border-4 border-white/40 shadow-lg active:scale-95 transition-transform"
          style={{ width: 72, height: 72 }}
          aria-label="Take photo"
        />

        {/* Placeholder for symmetry */}
        <div className="w-12 h-12" />
      </div>

      {/* Live indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 safe-area-top">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        <span className="text-white text-xs font-medium">LIVE</span>
      </div>

      {/* Close button top right */}
      <div className="absolute top-4 right-4 safe-area-top">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
          aria-label="Close"
        >
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main Chat Page ──

const WELCOME_MSG: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Welcome to PayJarvis! I'm your AI commerce assistant.\n\nI can help you with shopping, travel, restaurants, price comparisons, and more. How can I help you today?",
  type: "text",
  timestamp: new Date(),
};

export default function ChatPage() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MSG]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showLiveCamera, setShowLiveCamera] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("chat");
  const [isPremium, setIsPremium] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Load conversation history on mount
  useEffect(() => {
    if (historyLoaded) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const history = await apiLoadHistory(token, 50);
        if (history.length > 0) {
          setMessages([...history, WELCOME_MSG].sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
          ));
        }
      } catch {
        // Non-blocking — use welcome message
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [getToken, historyLoaded]);

  // Check premium status
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/subscription/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          const premium = json.data?.planType === "premium" && json.data?.status === "active";
          setIsPremium(premium);
          if (premium) setChatMode("live");
        }
      } catch { /* non-blocking */ }
    })();
  }, [getToken]);

  // Register push notifications (once, after first login)
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        // Only attempt if push is supported and not yet granted
        if (!("PushManager" in window) || Notification.permission === "denied") return;
        if (Notification.permission === "granted") {
          // Already granted — register silently
          const { subscribeToPush } = await import("@/lib/push");
          await subscribeToPush(token);
        } else {
          // Wait for a good moment to ask (after 3rd message)
          const count = messages.filter(m => m.role === "user").length;
          if (count >= 3 && Notification.permission === "default") {
            const { subscribeToPush } = await import("@/lib/push");
            await subscribeToPush(token);
          }
        }
      } catch { /* non-blocking */ }
    })();
  }, [getToken, messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 100) + "px";
    }
  }, [input]);

  // ── Send Text Message ──

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      type: "text",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const token = await getToken();
      const { reply } = await apiSendMessage(text, token ?? "");
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: reply,
          type: "text",
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
          type: "text",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, getToken]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Send Image ──

  const handleImageSend = useCallback(
    async (file: File) => {
      const localUrl = URL.createObjectURL(file);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "user",
          content: "📷 Photo",
          type: "image",
          mediaUrl: localUrl,
          timestamp: new Date(),
        },
      ]);
      setIsTyping(true);

      try {
        const token = await getToken();
        const base64 = await blobToBase64(file);
        const { reply } = await apiSendMessage(
          "Analyze this image",
          token ?? "",
          base64,
          file.type
        );
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content: reply,
            type: "text",
            timestamp: new Date(),
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content: "Failed to process image. Please try again.",
            type: "text",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [getToken]
  );

  // ── Voice Recording ──

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(blob);

        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "user",
            content: "🎤 Voice message",
            type: "audio",
            mediaUrl: localUrl,
            timestamp: new Date(),
          },
        ]);
        setIsTyping(true);

        try {
          const token = await getToken();
          const audioBase64 = await blobToBase64(blob);
          const result = await apiSendAudio(audioBase64, "audio/webm", token ?? "");

          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "assistant",
              content: result.response,
              type: result.audioUrl ? "audio" : "text",
              mediaUrl: result.audioUrl,
              timestamp: new Date(),
            },
          ]);
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "assistant",
              content: "Failed to process voice message. Please try again.",
              type: "text",
              timestamp: new Date(),
            },
          ]);
        } finally {
          setIsTyping(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      // Permission denied or not available
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  // ── File / Camera Handling ──

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("image/")) {
      handleImageSend(file);
    } else {
      // Non-image files: show locally (backend file processing not yet implemented)
      const url = URL.createObjectURL(file);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "user",
          content: `📎 ${file.name}`,
          type: "document",
          mediaUrl: url,
          timestamp: new Date(),
        },
      ]);
    }
    e.target.value = "";
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0f0f19] text-white">
      {/* ── Header ── */}
      <header className="flex flex-col bg-[#0f0f19] border-b border-white/5 safe-area-top">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00BFFF] to-[#0088cc] flex items-center justify-center text-lg shadow-lg shadow-[#00BFFF]/20">
              🦀
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Jarvis</h1>
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
                Online
              </p>
            </div>
          </div>
          <button
            onClick={() => setMenuOpen(true)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Menu"
          >
            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* ── Mode Toggle (visible to all) ── */}
        <div className="flex items-center justify-center gap-1 px-4 pb-3">
          <div className="flex bg-white/[0.05] rounded-full p-0.5 border border-white/[0.08]">
            <button
              onClick={() => { setChatMode("chat"); setShowUpgradeModal(false); }}
              className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${
                chatMode === "chat"
                  ? "bg-[#00BFFF] text-white shadow-lg shadow-[#00BFFF]/20"
                  : "text-gray-400 hover:text-gray-300"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => {
                if (isPremium) {
                  setChatMode("live");
                } else {
                  setShowUpgradeModal(true);
                }
              }}
              className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all duration-300 flex items-center gap-1.5 ${
                chatMode === "live"
                  ? "bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-lg shadow-purple-500/20"
                  : "text-gray-400 hover:text-gray-300"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${chatMode === "live" ? "bg-white animate-pulse" : "bg-purple-400"}`} />
              Live
            </button>
          </div>
        </div>
      </header>

      {/* ── Live Mode ── */}
      {chatMode === "live" && isPremium ? (
        <div className="flex-1 bg-[#080812] overflow-hidden">
          <LiveOrb chatContext={
            messages
              .filter(m => m.id !== "welcome" && m.type === "text")
              .slice(-5)
              .map(m => ({ role: m.role, content: m.content }))
          } />
        </div>
      ) : (
        <>
          {/* ── Chat Messages ── */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 overscroll-contain">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={chatEndRef} />
          </div>

          {/* ── Voice Chat ── */}
          <div className="border-t border-white/5 bg-[#0f0f19]/80 px-3 py-2">
            <VoiceChat />
          </div>
        </>
      )}

      {/* ── Input Area (Chat mode only) ── */}
      {chatMode === "chat" && (
      <div className="border-t border-white/5 bg-[#0f0f19] px-3 py-3 safe-area-bottom">
        <div className="flex items-end gap-2">
          {/* Attach */}
          <div className="relative">
            <button
              onClick={() => setAttachOpen(!attachOpen)}
              className="p-2.5 rounded-full hover:bg-white/10 transition-colors text-gray-400"
              aria-label="Attach"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <AttachMenu
              open={attachOpen}
              onClose={() => setAttachOpen(false)}
              onCamera={() => cameraInputRef.current?.click()}
              onLiveCamera={() => setShowLiveCamera(true)}
              onFile={() => fileInputRef.current?.click()}
            />
          </div>

          {/* Text Input */}
          <div className="flex-1 bg-[#1a1a2e] rounded-2xl px-4 py-2.5 flex items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Jarvis..."
              rows={1}
              className="flex-1 bg-transparent text-white text-[15px] placeholder-gray-500 resize-none outline-none max-h-[100px] leading-snug"
            />
          </div>

          {/* Mic / Send */}
          {input.trim() ? (
            <button
              onClick={handleSend}
              className="p-2.5 rounded-full bg-[#00BFFF] hover:bg-[#00a8e6] transition-colors shadow-lg shadow-[#00BFFF]/30"
              aria-label="Send"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          ) : (
            <button
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              className={`p-2.5 rounded-full transition-colors ${
                isRecording
                  ? "bg-red-500 animate-pulse shadow-lg shadow-red-500/40"
                  : "hover:bg-white/10 text-gray-400"
              }`}
              aria-label="Record voice"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-14 0m7 7v4m-3 0h6m-3-11V3a3 3 0 00-6 0v4"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
      )}

      {/* ── Live Camera ── */}
      {showLiveCamera && (
        <LiveCamera
          onClose={() => setShowLiveCamera(false)}
          onCapture={handleImageSend}
          getToken={getToken}
        />
      )}

      {/* ── Upgrade Modal (free users clicking Live) ── */}
      {showUpgradeModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-50" onClick={() => setShowUpgradeModal(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 bg-[#0f0f19] rounded-3xl border border-white/10 shadow-2xl max-w-sm mx-auto overflow-hidden animate-scale-in">
            {/* Orb preview */}
            <div className="relative h-48 bg-[#080812] flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,191,255,0.06)_0%,transparent_70%)]" />
              <div className="absolute w-36 h-36 rounded-full bg-gradient-to-br from-cyan-500/15 to-purple-600/15 animate-orb-pulse" />
              <div className="absolute w-28 h-28 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-600/20 animate-orb-pulse" style={{ animationDelay: "0.3s" }} />
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 via-blue-600 to-purple-700 shadow-[0_0_60px_rgba(0,191,255,0.3)] flex items-center justify-center">
                <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white/10 to-transparent" />
                <div className="flex items-center gap-[2px] h-8">
                  {[...Array(7)].map((_, i) => (
                    <div
                      key={i}
                      className="w-[2px] rounded-full bg-white/80 animate-orb-wave-slow"
                      style={{ height: `${8 + Math.sin(i * 0.8) * 12}px`, animationDelay: `${i * 0.1}s` }}
                    />
                  ))}
                </div>
              </div>
              <div className="absolute w-32 h-32 rounded-full border border-cyan-500/20 animate-spin-slow" style={{ animationDuration: "6s" }}>
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,191,255,0.8)]" />
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-5">
              <h3 className="text-lg font-semibold text-white text-center">Real-time Voice</h3>
              <p className="text-sm text-gray-400 text-center mt-2 leading-relaxed">
                Talk to Jarvis in real-time with voice. Ask questions, get instant answers, and shop hands-free.
              </p>

              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  </span>
                  Real-time bidirectional voice
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  </span>
                  Understands your chat context
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </span>
                  Unlimited voice sessions
                </div>
              </div>

              <a
                href="/billing"
                className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold text-sm shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 transition-shadow"
              >
                Upgrade to Premium — $20/mo
              </a>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="mt-2 w-full py-2 text-sm text-gray-500 hover:text-gray-400 transition-colors"
              >
                Maybe later
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Menu Drawer ── */}
      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} onInvite={() => setInviteOpen(true)} />

      {/* ── Invite Modal ── */}
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {/* ── PWA safe-area styles ── */}
      <style jsx global>{`
        .safe-area-top {
          padding-top: max(0.75rem, env(safe-area-inset-top));
        }
        .safe-area-bottom {
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        }
        /* Hide scrollbar but keep scrolling */
        .overflow-y-auto::-webkit-scrollbar {
          display: none;
        }
        .overflow-y-auto {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        /* Prevent pull-to-refresh on chat */
        body {
          overscroll-behavior-y: contain;
        }
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.25s ease-out;
        }
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
