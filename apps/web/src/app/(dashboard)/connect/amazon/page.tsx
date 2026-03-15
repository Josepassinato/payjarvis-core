"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "needs_human"
  | "connected"
  | "error";

export default function ConnectAmazonPage() {
  const { userId: clerkUserId } = useAuth();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");
  const legacyUserId = searchParams.get("userId");

  const [resolvedUserId, setResolvedUserId] = useState<string | null>(
    legacyUserId
  );
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Human verification state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [obstacle, setObstacle] = useState<string | null>(null);
  const [obstacleMessage, setObstacleMessage] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Validate JWT token on load
  useEffect(() => {
    if (tokenParam) {
      validateToken(tokenParam);
    } else if (clerkUserId) {
      setResolvedUserId(clerkUserId);
      setTokenValid(true);
    } else if (legacyUserId) {
      setTokenValid(true);
    }
  }, [tokenParam, clerkUserId, legacyUserId]);

  // Check existing connection once userId is resolved
  useEffect(() => {
    if (resolvedUserId && tokenValid) {
      checkStatus();
    }
  }, [resolvedUserId, tokenValid]);

  async function validateToken(token: string) {
    try {
      const res = await fetch(`${apiUrl}/vault/amazon/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.success) {
        setResolvedUserId(data.data.userId);
        setTokenValid(true);
      } else {
        setTokenValid(false);
        setError(
          data.error ?? "Invalid or expired link. Ask your bot for a new one."
        );
      }
    } catch {
      setTokenValid(false);
      setError("Failed to validate link.");
    }
  }

  async function checkStatus() {
    if (!resolvedUserId) return;
    try {
      const res = await fetch(
        `${apiUrl}/vault/amazon/status/${resolvedUserId}`
      );
      const data = await res.json();
      if (data.success && data.data.connected) {
        setStatus("connected");
        setLastVerified(data.data.lastVerified);
      }
    } catch {
      // Not connected
    }
  }

  // Start polling for session completion
  const startPolling = useCallback(
    (sid: string) => {
      if (pollRef.current) clearInterval(pollRef.current);

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `${apiUrl}/vault/amazon/login-status/${sid}?userId=${resolvedUserId}`
          );
          const data = await res.json();

          if (data.success && data.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("connected");
            setLastVerified(new Date().toISOString());
            setSessionId(null);
            setPassword("");
            setEmail("");
            return;
          }

          if (data.status === "expired" || data.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(
              data.error ?? "Verification timed out. Please try again."
            );
            setStatus("error");
            setSessionId(null);
            return;
          }

          if (data.remainingSeconds !== undefined) {
            setRemaining(data.remainingSeconds);
          }
        } catch {
          // Network error — keep polling
        }
      }, 3000);
    },
    [apiUrl, resolvedUserId]
  );

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (!resolvedUserId) {
      setError("Missing userId");
      return;
    }
    if (!email || !password) {
      setError("Please enter your Amazon email and password.");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/vault/amazon/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: resolvedUserId,
          email,
          password,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus("connected");
        setLastVerified(new Date().toISOString());
        setPassword("");
        setEmail("");
        return;
      }

      // NEEDS_HUMAN — verification required
      if (data.status === "NEEDS_HUMAN" && data.sessionId) {
        setSessionId(data.sessionId);
        setObstacle(data.obstacle);
        setObstacleMessage(data.message);
        setStatus("needs_human");
        setRemaining(600);
        startPolling(data.sessionId);
        return;
      }

      setError(data.error ?? "Login failed");
      setStatus("error");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStatus("error");
    }
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !verificationCode) return;

    setSubmittingCode(true);
    try {
      await fetch(`${apiUrl}/vault/amazon/login-input/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: verificationCode, submit: true }),
      });
      setVerificationCode("");
    } catch {
      setError("Failed to submit code");
    } finally {
      setSubmittingCode(false);
    }
  }

  async function disconnect() {
    if (!resolvedUserId) return;
    try {
      await fetch(`${apiUrl}/vault/amazon/disconnect/${resolvedUserId}`, {
        method: "DELETE",
      });
      setStatus("disconnected");
      setLastVerified(null);
    } catch {
      setError("Failed to disconnect");
    }
  }

  async function verifySession() {
    if (!resolvedUserId) return;
    try {
      const res = await fetch(
        `${apiUrl}/vault/amazon/verify/${resolvedUserId}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.success && data.data.valid) {
        setStatus("connected");
        setLastVerified(new Date().toISOString());
      } else {
        setStatus("disconnected");
        setError("Session expired. Please reconnect.");
      }
    } catch {
      setError("Verification failed");
    }
  }

  // Token validation failed
  if (tokenValid === false) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-red-800 bg-zinc-900 p-8 text-center">
          <span className="text-4xl mb-4 block">🔗</span>
          <h1 className="text-xl font-bold text-white mb-2">
            Link expired or invalid
          </h1>
          <p className="text-zinc-400 mb-4">
            {error ?? "This connection link is no longer valid."}
          </p>
          <p className="text-zinc-500 text-sm">
            Ask your Jarvis bot for a new connection link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="text-2xl font-bold text-white mb-2">
          Connect your Amazon account
        </h1>
        <p className="text-zinc-400 mb-6">
          Your assistant will use your account to make purchases on your behalf.
        </p>

        {/* Security notice */}
        <div className="mb-6 rounded-lg bg-zinc-800/50 p-4 border border-zinc-700">
          <div className="flex items-start gap-2">
            <span className="text-lg">🔒</span>
            <div className="text-sm text-zinc-300">
              <p className="font-medium mb-1">
                Your credentials are never stored
              </p>
              <p className="text-zinc-400">
                Your email and password are used only to generate a session
                token. They are never saved or transmitted to any third party.
              </p>
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="mb-6 flex items-center gap-2">
          <span className="text-sm text-zinc-400">Status:</span>
          {status === "connected" && (
            <span className="flex items-center gap-1 text-green-400 text-sm font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
              Connected
            </span>
          )}
          {status === "disconnected" && (
            <span className="flex items-center gap-1 text-zinc-500 text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-zinc-500" />
              Not connected
            </span>
          )}
          {status === "connecting" && (
            <span className="flex items-center gap-1 text-yellow-400 text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              Connecting...
            </span>
          )}
          {status === "needs_human" && (
            <span className="flex items-center gap-1 text-orange-400 text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
              Verification needed
            </span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1 text-red-400 text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
              Error
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/20 border border-red-800 p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Login form */}
        {(status === "disconnected" || status === "error") && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="amazon-email"
                className="block text-sm font-medium text-zinc-300 mb-1"
              >
                Amazon Email
              </label>
              <input
                id="amazon-email"
                type="text"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <div>
              <label
                htmlFor="amazon-password"
                className="block text-sm font-medium text-zinc-300 mb-1"
              >
                Amazon Password
              </label>
              <input
                id="amazon-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your Amazon password"
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 px-4 transition-colors"
            >
              🔗 Connect Account
            </button>
          </form>
        )}

        {/* Connecting state */}
        {status === "connecting" && (
          <div className="text-center text-zinc-400 text-sm py-4">
            <div className="inline-block w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="mb-1">Logging into Amazon...</p>
            <p className="text-zinc-500">This may take up to 30 seconds.</p>
          </div>
        )}

        {/* Human verification needed */}
        {status === "needs_human" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-orange-900/20 border border-orange-800 p-4">
              <p className="text-orange-300 text-sm font-medium mb-2">
                🔐 Amazon is requesting verification
              </p>
              <p className="text-zinc-400 text-sm">
                {obstacleMessage ??
                  "Amazon needs additional verification to complete the login."}
              </p>
              {remaining > 0 && (
                <p className="text-zinc-500 text-xs mt-2">
                  Time remaining: {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </p>
              )}
            </div>

            {/* OTP/CAPTCHA input */}
            {(obstacle === "2fa" || obstacle === "captcha") && (
              <form onSubmit={handleSubmitCode} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    {obstacle === "captcha"
                      ? "Enter CAPTCHA text"
                      : "Enter verification code"}
                  </label>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder={
                      obstacle === "captcha" ? "Type the characters" : "123456"
                    }
                    autoComplete="one-time-code"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingCode || !verificationCode}
                  className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 px-4 text-sm transition-colors disabled:opacity-50"
                >
                  {submittingCode ? "Submitting..." : "Submit code"}
                </button>
              </form>
            )}

            {/* Device approval — just waiting */}
            {obstacle === "device_approval" && (
              <div className="text-center py-4">
                <div className="inline-block w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-zinc-300 text-sm">
                  Check your phone or email and approve the login request.
                </p>
                <p className="text-zinc-500 text-xs mt-2">
                  This page will update automatically when approved.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Connected state */}
        {status === "connected" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-zinc-800/50 p-4 space-y-2 text-sm text-zinc-300">
              <p>✅ Purchases will be made on your account</p>
              <p>✅ Your saved addresses will be used</p>
              <p>✅ Prime benefits if you have them</p>
              {lastVerified && (
                <p className="text-zinc-500 mt-2">
                  Last verified:{" "}
                  {new Date(lastVerified).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={verifySession}
                className="flex-1 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-300 py-2 px-4 text-sm transition-colors"
              >
                Verify session
              </button>
              <button
                onClick={disconnect}
                className="flex-1 rounded-lg border border-red-800 hover:bg-red-900/30 text-red-400 py-2 px-4 text-sm transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* No userId warning */}
        {!resolvedUserId && tokenValid === null && !tokenParam && (
          <div className="mt-4 rounded-lg bg-yellow-900/20 border border-yellow-800 p-3 text-yellow-300 text-sm">
            Missing userId parameter. This link should be generated by your
            Jarvis bot.
          </div>
        )}
      </div>
    </div>
  );
}
