"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";

type Status = "loading" | "ready" | "connecting" | "needs_human" | "connected" | "expired" | "error";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export default function ConnectAmazonPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Human verification
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [obstacle, setObstacle] = useState<string | null>(null);
  const [obstacleMsg, setObstacleMsg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Validate token on load
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Missing token. Ask your Jarvis bot for a new link.");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API}/vault/amazon/verify-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.success) {
          setUserId(data.data.userId);
          // Check if already connected before showing form
          try {
            const statusRes = await fetch(`${API}/vault/amazon/status/${data.data.userId}`);
            const statusData = await statusRes.json();
            if (statusData.success && statusData.data?.connected) {
              setStatus("connected");
              return;
            }
          } catch { /* show form */ }
          setStatus("ready");
        } else {
          setStatus("expired");
          setError(data.error ?? "Link expired. Ask for a new one.");
        }
      } catch {
        setStatus("error");
        setError("Failed to verify link.");
      }
    })();
  }, [token]);

  const startPolling = useCallback((sid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/vault/amazon/login-status/${sid}?userId=${userId}`);
        const data = await res.json();
        if (data.success && data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("connected");
          return;
        }
        if (data.status === "expired" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(data.error ?? "Verification timed out.");
          setStatus("error");
          return;
        }
        if (data.remainingSeconds !== undefined) setRemaining(data.remainingSeconds);
      } catch { /* keep polling */ }
    }, 3000);
  }, [userId]);

  async function checkIfConnected(): Promise<boolean> {
    try {
      const res = await fetch(`${API}/vault/amazon/status/${userId}`);
      const data = await res.json();
      return data.success && data.data?.connected;
    } catch { return false; }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !email || !password) return;
    setStatus("connecting");
    setError(null);
    try {
      const res = await fetch(`${API}/vault/amazon/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email, password }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (data.success) {
        setStatus("connected");
        setPassword("");
        return;
      }
      if (data.status === "NEEDS_HUMAN" && data.sessionId) {
        setSessionId(data.sessionId);
        setObstacle(data.obstacle);
        setObstacleMsg(data.message);
        setStatus("needs_human");
        setRemaining(600);
        startPolling(data.sessionId);
        return;
      }
      setError(data.error ?? "Login failed");
      setStatus("error");
    } catch (err) {
      // Login request timed out — check if it succeeded server-side
      const connected = await checkIfConnected();
      if (connected) {
        setStatus("connected");
        setPassword("");
        return;
      }
      setError("Login is taking longer than expected. Please wait and try again.");
      setStatus("error");
    }
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !code) return;
    setSubmitting(true);
    try {
      await fetch(`${API}/vault/amazon/login-input/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: code, submit: true }),
      });
      setCode("");
    } catch { setError("Failed to submit code"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-orange-50 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Connect Amazon</h1>
          <p className="text-sm text-gray-500 mt-1">PayJarvis will use your account for purchases</p>
        </div>

        {/* Loading */}
        {status === "loading" && (
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 mt-3">Verifying link...</p>
          </div>
        )}

        {/* Expired/Invalid token */}
        {status === "expired" && (
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 bg-red-50 rounded-full flex items-center justify-center">
              <span className="text-2xl">🔗</span>
            </div>
            <h2 className="font-semibold text-gray-900 mb-1">Link expired</h2>
            <p className="text-sm text-gray-500">{error}</p>
            <p className="text-xs text-gray-400 mt-3">Send /conectar to your Jarvis bot for a new link.</p>
          </div>
        )}

        {/* Login form */}
        {(status === "ready" || status === "error") && (
          <>
            <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-100">
              <div className="flex gap-2">
                <span className="text-base">🔒</span>
                <div className="text-xs text-gray-600">
                  <p className="font-medium text-gray-700">Your credentials stay private</p>
                  <p className="mt-0.5">Used only to create a session. Never stored or shared.</p>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-sm text-red-600">{error}</div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amazon Email</label>
                <input
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amazon Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-orange-500 text-white rounded-xl font-medium text-sm hover:bg-orange-600 transition-colors"
              >
                Connect Account
              </button>
            </form>
          </>
        )}

        {/* Connecting */}
        {status === "connecting" && (
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 mt-3">Logging into Amazon...</p>
            <p className="text-xs text-gray-400 mt-1">This may take up to 30 seconds</p>
          </div>
        )}

        {/* Needs human verification */}
        {status === "needs_human" && (
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
              <p className="text-sm font-medium text-orange-700">Amazon needs verification</p>
              <p className="text-xs text-orange-600 mt-1">{obstacleMsg ?? "Check your email/phone for a code."}</p>
              {remaining > 0 && (
                <p className="text-xs text-orange-400 mt-2">
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} remaining
                </p>
              )}
            </div>

            {(obstacle === "2fa" || obstacle === "captcha") && (
              <form onSubmit={handleSubmitCode} className="space-y-3">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={obstacle === "captcha" ? "Type the characters" : "Enter code"}
                  autoComplete="one-time-code"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <button
                  type="submit"
                  disabled={submitting || !code}
                  className="w-full py-3 bg-orange-500 text-white rounded-xl font-medium text-sm disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit Code"}
                </button>
              </form>
            )}

            {obstacle === "device_approval" && (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-gray-600 mt-3">Approve the login on your phone or email</p>
                <p className="text-xs text-gray-400 mt-1">This page updates automatically</p>
              </div>
            )}
          </div>
        )}

        {/* Connected */}
        {status === "connected" && (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Amazon Connected!</h2>
            <p className="text-sm text-gray-500 mb-4">Your Jarvis bot can now make purchases for you.</p>
            <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 text-sm text-gray-600">
              <p>✅ Your saved addresses will be used</p>
              <p>✅ Prime benefits included if you have them</p>
              <p>✅ Every purchase requires your approval</p>
            </div>
            <p className="text-xs text-gray-400 mt-4">You can close this page and return to Telegram.</p>
          </div>
        )}
      </div>
    </div>
  );
}
