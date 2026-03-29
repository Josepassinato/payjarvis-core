"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";

type Status =
  | "loading"
  | "ready"
  | "starting_session"
  | "live_login"
  | "checking_login"
  | "connected"
  | "expired"
  | "error"
  | "fallback_form"
  | "fallback_connecting"
  | "needs_human";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-orange-50 rounded-2xl flex items-center justify-center">
          <svg className="w-8 h-8 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Connect Amazon</h1>
        <p className="text-sm text-gray-500 mt-1">Loading...</p>
      </div>
    </div>
  );
}

function ConnectAmazonContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [bbContextId, setBbContextId] = useState<string | null>(null);
  const [bbSessionId, setBbSessionId] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);

  // Fallback form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [obstacle, setObstacle] = useState<string | null>(null);
  const [obstacleMsg, setObstacleMsg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    };
  }, []);

  // 1. Validate token on load
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Missing token. Ask your Jarvis bot for a new link.");
      return;
    }
    (async () => {
      try {
        console.log("[CONNECT-AMAZON] Token received, verifying...");
        const res = await fetch(`${API}/vault/amazon/verify-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.success) {
          console.log(`[CONNECT-AMAZON] Token valid, userId=${data.data.userId}`);
          setUserId(data.data.userId);
          // Check if already connected
          try {
            const statusRes = await fetch(`${API}/vault/amazon/status/${data.data.userId}`);
            const statusData = await statusRes.json();
            if (statusData.success && statusData.data?.connected) {
              setStatus("connected");
              return;
            }
          } catch { /* proceed to login */ }
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

  // 2. Auto-start live login session when ready
  useEffect(() => {
    if (status !== "ready" || !userId) return;
    startLiveLogin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId]);

  async function startLiveLogin() {
    if (!userId) return;
    setStatus("starting_session");
    setError(null);

    try {
      console.log("[CONNECT-AMAZON] Starting live login session...");
      const res = await fetch(`${API}/vault/amazon/start-live-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();

      if (!data.success) {
        console.error("[CONNECT-AMAZON] Failed to start live login:", data.error);
        // Fallback to form
        setStatus("fallback_form");
        return;
      }

      // Already logged in
      if (data.data.alreadyLoggedIn) {
        console.log("[CONNECT-AMAZON] Already logged in!");
        setAccountName(data.data.userName ?? null);
        setStatus("connected");
        return;
      }

      console.log(`[CONNECT-AMAZON] Live session ready: liveUrl=${data.data.liveUrl?.slice(0, 80)}`);
      setLiveUrl(data.data.liveUrl);
      setBbContextId(data.data.bbContextId);
      setBbSessionId(data.data.bbSessionId ?? null);
      setStatus("live_login");

      // Start polling for login completion (pass bbSessionId for reconnection)
      startLoginPolling(data.data.bbContextId, data.data.bbSessionId);

      // Set iframe load timeout — if iframe doesn't load in 5s, switch to form
      iframeTimerRef.current = setTimeout(() => {
        if (!iframeLoaded) {
          console.log("[CONNECT-AMAZON] iFrame load timeout — switching to fallback form");
          setIframeFailed(true);
          // Auto-switch to form after 8s total
          setTimeout(() => {
            if (!iframeLoaded) setStatus("fallback_form");
          }, 3_000);
        }
      }, 5_000);
    } catch (err) {
      console.error("[CONNECT-AMAZON] Live login error:", err);
      setStatus("fallback_form");
    }
  }

  // 3. Poll for login completion every 8s
  const startLoginPolling = useCallback((contextId: string, sessionId?: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Wait 15s before first check (give user time to type credentials)
    const timeout = setTimeout(() => {
      pollRef.current = setInterval(async () => {
        try {
          console.log("[CONNECT-AMAZON] Checking if login completed...");
          const params = new URLSearchParams({ userId: userId! });
          if (sessionId) params.set("bbSessionId", sessionId);
          const res = await fetch(`${API}/vault/amazon/check-live-login/${contextId}?${params}`);
          const data = await res.json();
          if (data.success && data.data?.loggedIn) {
            console.log(`[CONNECT-AMAZON] Login verified! accountName=${data.data.userName}`);
            if (pollRef.current) clearInterval(pollRef.current);
            setAccountName(data.data.userName ?? null);
            setStatus("connected");
          }
        } catch {
          // Keep polling
        }
      }, 8_000);
    }, 15_000);
    // Cleanup timeout on unmount
    return () => clearTimeout(timeout);
  }, [userId]);

  // 4. Fallback: open live view in new tab
  function openInNewTab() {
    if (liveUrl) {
      window.open(liveUrl, "_blank");
    }
  }

  // 5. Switch to fallback form
  function switchToForm() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus("fallback_form");
  }

  // Fallback form handlers (same as before)
  const startFallbackPolling = useCallback((sid: string) => {
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

  async function handleFallbackLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !email || !password) return;
    setStatus("fallback_connecting");
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
        startFallbackPolling(data.sessionId);
        return;
      }
      setError(data.error ?? "Login failed");
      setStatus("fallback_form");
    } catch {
      setError("Login is taking longer than expected. Please wait and try again.");
      setStatus("fallback_form");
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
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header — compact for iframe mode */}
      {status !== "live_login" && (
        <div className="flex items-center justify-center p-4">
          <div className="w-full max-w-md text-center">
            <div className="w-12 h-12 mx-auto mb-3 bg-orange-50 rounded-2xl flex items-center justify-center">
              <svg className="w-6 h-6 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Connect Amazon</h1>
            <p className="text-sm text-gray-500 mt-1">PayJarvis will use your account for purchases</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {status === "loading" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 mt-3">Verifying link...</p>
          </div>
        </div>
      )}

      {/* Starting session */}
      {status === "starting_session" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 mt-3">Opening Amazon login...</p>
            <p className="text-xs text-gray-400 mt-1">This may take a few seconds</p>
          </div>
        </div>
      )}

      {/* LIVE LOGIN — iframe with BrowserBase live view */}
      {status === "live_login" && liveUrl && (
        <div className="flex-1 flex flex-col">
          {/* Mini header */}
          <div className="flex items-center justify-between px-4 py-2 bg-orange-50 border-b border-orange-100">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-orange-700">Log in on Amazon below</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={openInNewTab}
                className="text-xs text-orange-600 underline hover:text-orange-800"
              >
                Open in new tab
              </button>
              <button
                onClick={switchToForm}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Use form instead
              </button>
            </div>
          </div>

          {/* iframe */}
          <div className="flex-1 relative">
            {!iframeLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                <div className="text-center">
                  <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-gray-500 mt-3">Loading Amazon...</p>
                </div>
              </div>
            )}
            <iframe
              src={liveUrl}
              className="w-full h-full border-none"
              style={{ minHeight: "80vh" }}
              onLoad={() => {
                setIframeLoaded(true);
                if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
              }}
              onError={() => setIframeFailed(true)}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              allow="clipboard-read; clipboard-write"
            />
          </div>

          {/* iframe failed fallback */}
          {iframeFailed && !iframeLoaded && (
            <div className="absolute bottom-4 left-4 right-4 bg-white border border-orange-200 rounded-xl p-4 shadow-lg z-20">
              <p className="text-sm font-medium text-gray-700 mb-2">Browser preview didn&apos;t load?</p>
              <div className="flex gap-2">
                <button
                  onClick={openInNewTab}
                  className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium"
                >
                  Open in new tab
                </button>
                <button
                  onClick={switchToForm}
                  className="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm"
                >
                  Use form
                </button>
              </div>
            </div>
          )}

          {/* Footer status */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500">
              Your credentials go directly to Amazon. PayJarvis never sees them.
            </p>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block ml-1" />
            <span className="text-xs text-gray-400 ml-1">Checking for login...</span>
          </div>
        </div>
      )}

      {/* Expired */}
      {status === "expired" && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 bg-red-50 rounded-full flex items-center justify-center">
              <span className="text-2xl">&#128279;</span>
            </div>
            <h2 className="font-semibold text-gray-900 mb-1">Link expired</h2>
            <p className="text-sm text-gray-500">{error}</p>
            <p className="text-xs text-gray-400 mt-3">Send /conectar to your Jarvis bot for a new link.</p>
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md text-center py-6">
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-sm text-red-600">{error}</div>
            <button
              onClick={() => { setError(null); setStatus("ready"); }}
              className="px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Fallback form */}
      {(status === "fallback_form") && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-100">
              <div className="flex gap-2">
                <span className="text-base">&#128274;</span>
                <div className="text-xs text-gray-600">
                  <p className="font-medium text-gray-700">Your credentials stay private</p>
                  <p className="mt-0.5">Used only to create a session. Never stored or shared.</p>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-sm text-red-600">{error}</div>
            )}

            <form onSubmit={handleFallbackLogin} className="space-y-4">
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
              <button type="submit" className="w-full py-3 bg-orange-500 text-white rounded-xl font-medium text-sm hover:bg-orange-600 transition-colors">
                Connect Account
              </button>
            </form>

            {liveUrl && (
              <button onClick={() => setStatus("live_login")} className="w-full mt-3 py-2 text-sm text-orange-600 underline">
                Back to live browser view
              </button>
            )}
          </div>
        </div>
      )}

      {/* Fallback connecting */}
      {status === "fallback_connecting" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 mt-3">Logging into Amazon...</p>
            <p className="text-xs text-gray-400 mt-1">This may take up to 30 seconds</p>
          </div>
        </div>
      )}

      {/* Needs human verification (fallback) */}
      {status === "needs_human" && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4">
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
                <button type="submit" disabled={submitting || !code} className="w-full py-3 bg-orange-500 text-white rounded-xl font-medium text-sm disabled:opacity-50">
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
        </div>
      )}

      {/* Connected */}
      {status === "connected" && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md text-center py-6">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Amazon Connected!</h2>
            {accountName && <p className="text-sm text-gray-600 mb-2">Welcome, {accountName}</p>}
            <p className="text-sm text-gray-500 mb-4">Your Jarvis bot can now make purchases for you.</p>
            <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 text-sm text-gray-600">
              <p>&#9989; Your saved addresses will be used</p>
              <p>&#9989; Prime benefits included if you have them</p>
              <p>&#9989; Every purchase requires your approval</p>
            </div>
            <p className="text-xs text-gray-400 mt-4">You can close this page and return to Telegram.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConnectAmazonPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ConnectAmazonContent />
    </Suspense>
  );
}
