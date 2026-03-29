"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const STEPS = [
  { num: 1, label: "Phone" },
  { num: 2, label: "Verify" },
  { num: 3, label: "Confirmed" },
];

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export default function SetupPhonePage() {
  const { getToken } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — phone number
  const [phoneNumber, setPhoneNumber] = useState("");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  // Step 2 — verification
  const [verificationCode, setVerificationCode] = useState("");
  const [validationCode, setValidationCode] = useState<string | null>(null);

  // Step 3 — confirmed
  const [verifiedNumber, setVerifiedNumber] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // Load existing caller ID status
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/voice/caller-id-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data?.verified && json.data?.phoneNumber) {
            setVerifiedNumber(json.data.phoneNumber);
            setPhoneNumber(json.data.phoneNumber);
            setStep(3);
          }
        }
      } catch {
        // ignore, use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  const handleSendVerification = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/voice/verify-caller-id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phoneNumber,
          disclaimerAccepted: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? json.message ?? "Failed to send verification call");
      }
      setValidationCode(json.data?.validationCode ?? json.validationCode ?? null);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/voice/confirm-caller-id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phoneNumber }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? json.message ?? "Verification failed");
      }
      setVerifiedNumber(phoneNumber);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/voice/verified-caller-id`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? json.message ?? "Failed to remove number");
      }
      setVerifiedNumber(null);
      setPhoneNumber("");
      setDisclaimerAccepted(false);
      setVerificationCode("");
      setValidationCode(null);
      setStep(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-64 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-4 md:py-8">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s) => (
          <div key={s.num} className="flex-1 flex flex-col items-center gap-1.5">
            <div
              className={`w-full h-1.5 rounded-full transition-colors ${
                s.num <= step ? "bg-gray-900" : "bg-gray-200"
              }`}
            />
            <span
              className={`text-[10px] font-medium tracking-wide uppercase ${
                s.num <= step ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}

      {/* --- STEP 1: PHONE NUMBER --- */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Phone Caller ID
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Verify your phone number so it appears as caller ID when Jarvis makes calls.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-6">
            {/* Phone input */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Phone number with country code
              </label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 954 643 2431"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
              />
            </div>

            {/* Disclaimer checkbox */}
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="pt-0.5">
                  <div
                    onClick={() => setDisclaimerAccepted(!disclaimerAccepted)}
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors cursor-pointer ${
                      disclaimerAccepted
                        ? "bg-gray-900 border-gray-900"
                        : "border-gray-300 bg-white"
                    }`}
                  >
                    {disclaimerAccepted && (
                      <svg
                        className="w-3 h-3 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
                <span
                  className="text-xs text-gray-500 leading-relaxed"
                  onClick={() => setDisclaimerAccepted(!disclaimerAccepted)}
                >
                  I authorize PayJarvis to make phone calls on my behalf using my verified phone number as caller ID. I understand that calls will be made by an AI assistant acting on my instructions, my number will appear as the caller ID, I am responsible for all calls made through this service, I can revoke this authorization at any time, and call recordings may be kept for quality and dispute resolution. I confirm this is my personal phone number.
                </span>
              </label>
            </div>
          </div>

          <button
            onClick={handleSendVerification}
            disabled={saving || !disclaimerAccepted || !phoneNumber.trim()}
            className="w-full py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending verification call...
              </span>
            ) : (
              "Send Verification Call"
            )}
          </button>
        </div>
      )}

      {/* --- STEP 2: VERIFY CODE --- */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Verify your number
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Twilio is calling your number now...
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-6">
            {/* Validation code display */}
            {validationCode && (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Enter this code on your phone keypad
                </p>
                <p className="text-3xl font-bold text-gray-900 tracking-widest">
                  {validationCode}
                </p>
              </div>
            )}

            {/* Calling animation */}
            <div className="flex items-center justify-center gap-3 py-2">
              <span className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-sm text-gray-600">
                Calling {formatPhoneDisplay(phoneNumber)}...
              </span>
            </div>

            {/* 6-digit code input */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                6-digit verification code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep(1);
                setVerificationCode("");
                setValidationCode(null);
              }}
              className="flex-1 py-3.5 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || verificationCode.length < 6}
              className="flex-[2] py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying...
                </span>
              ) : (
                "Verify"
              )}
            </button>
          </div>
        </div>
      )}

      {/* --- STEP 3: CONFIRMED --- */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-emerald-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              Your number {formatPhoneDisplay(verifiedNumber ?? phoneNumber)} is verified!
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              Jarvis will now use your number as caller ID.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-3 py-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center bg-emerald-100">
                <svg
                  className="w-3.5 h-3.5 text-emerald-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="flex-1">
                <span className="text-xs text-gray-500">Verified number</span>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {formatPhoneDisplay(verifiedNumber ?? phoneNumber)}
              </span>
            </div>
            <div className="flex items-center gap-3 py-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center bg-emerald-100">
                <svg
                  className="w-3.5 h-3.5 text-emerald-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="flex-1">
                <span className="text-xs text-gray-500">Caller ID</span>
              </div>
              <span className="text-sm font-medium text-gray-900">Active</span>
            </div>
          </div>

          <a
            href="/dashboard"
            className="block w-full py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors text-sm text-center"
          >
            Go to Dashboard
          </a>

          <button
            onClick={handleRemove}
            disabled={removing}
            className="w-full py-3.5 border border-red-200 text-red-600 font-semibold rounded-xl hover:bg-red-50 transition-colors text-sm"
          >
            {removing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />
                Removing...
              </span>
            ) : (
              "Remove Verified Number"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
