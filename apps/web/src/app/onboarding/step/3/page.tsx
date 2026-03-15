"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { getOnboardingStatus, generateActivationLink, getActivationStatus } from "@/lib/api";
import { OnboardingProgress } from "@/components/onboarding-progress";

const THRESHOLDS = [
  { value: 25, label: "onboarding.step3.threshold25", desc: "onboarding.step3.threshold25Desc" },
  { value: 50, label: "onboarding.step3.threshold50", desc: "onboarding.step3.threshold50Desc", recommended: true },
  { value: 100, label: "onboarding.step3.threshold100", desc: "onboarding.step3.threshold100Desc" },
  { value: 0, label: "onboarding.step3.thresholdAlways", desc: "onboarding.step3.thresholdAlwaysDesc" },
];

export default function OnboardingStep3() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const router = useRouter();

  const [threshold, setThreshold] = useState(50);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const status = await getOnboardingStatus(token);
        if (status.onboardingStep >= 4) {
          router.replace("/dashboard");
        } else if (status.onboardingStep < 2) {
          router.replace(`/onboarding/step/${status.onboardingStep + 1}`);
        }
      } catch {
        router.replace("/onboarding/step/1");
      }
    })();
  }, [getToken, router]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const token = await getToken();
        const status = await getActivationStatus(token);
        if (status.connected) {
          setConnected(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  }, [getToken]);

  const handleGenerateLink = async () => {
    setGenerating(true);
    setError(null);

    try {
      const token = await getToken();
      const result = await generateActivationLink(
        { approvalThreshold: threshold },
        token
      );
      setLinkUrl(result.url);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("onboarding.step3.linkError"));
    } finally {
      setGenerating(false);
    }
  };

  const handleFinish = () => {
    router.push("/dashboard");
  };

  // Success state
  if (connected) {
    return (
      <div>
        <OnboardingProgress current={4} />
        <div className="bg-white border border-approved/30 rounded-xl p-8 text-center space-y-5">
          <div className="text-5xl">&#9989;</div>
          <h2 className="text-2xl font-bold text-gray-900">{t("onboarding.step3.successTitle")}</h2>
          <p className="text-gray-400">{t("onboarding.step3.successDesc")}</p>
          <button
            onClick={handleFinish}
            className="inline-flex items-center gap-2 px-8 py-3 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors"
          >
            {t("onboarding.step3.goToDashboard")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <OnboardingProgress current={3} />

      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t("onboarding.step3.title")}</h2>
          <p className="text-sm text-gray-400 mt-1">{t("onboarding.step3.subtitle")}</p>
        </div>

        {/* Threshold selector */}
        {!linkUrl && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide">
              {t("onboarding.step3.thresholdLabel")}
            </label>
            {THRESHOLDS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setThreshold(opt.value)}
                className={`w-full text-left rounded-xl border p-4 transition-colors ${
                  threshold === opt.value
                    ? "border-brand-600 bg-brand-600/10"
                    : "border-gray-200 bg-gray-50 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    threshold === opt.value ? "border-brand-600" : "border-gray-600"
                  }`}>
                    {threshold === opt.value && <div className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{t(opt.label)}</p>
                      {opt.recommended && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-600/20 text-brand-400 px-1.5 py-0.5 rounded">
                          {t("onboarding.step3.recommended")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{t(opt.desc)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Generate link / Waiting state */}
        {!linkUrl ? (
          <div className="flex justify-between pt-2">
            <button
              onClick={() => router.push("/onboarding/step/2")}
              className="px-4 py-2.5 text-sm text-gray-400 hover:text-gray-900 transition-colors"
            >
              {t("common.back")}
            </button>
            <button
              onClick={handleGenerateLink}
              disabled={generating}
              className="px-8 py-2.5 bg-approved text-white text-sm font-medium rounded-lg hover:bg-approved/90 transition-colors disabled:opacity-50"
            >
              {generating ? t("common.loading") : t("onboarding.step3.connectTelegram")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Instructions */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-brand-400 text-xs font-bold">1</div>
                <p className="text-sm text-gray-700">{t("onboarding.step3.instruction1")}</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-brand-400 text-xs font-bold">2</div>
                <p className="text-sm text-gray-700">{t("onboarding.step3.instruction2")}</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-brand-400 text-xs font-bold">3</div>
                <p className="text-sm text-gray-700">{t("onboarding.step3.instruction3")}</p>
              </div>
            </div>

            {/* Telegram button */}
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-[#0088cc] text-white text-sm font-medium rounded-lg hover:bg-[#0077b5] transition-colors"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              {t("onboarding.step3.openTelegram")}
            </a>

            {/* Status indicator */}
            <div className="flex items-center justify-center gap-2 py-2">
              <div className="h-2 w-2 rounded-full bg-pending animate-pulse" />
              <p className="text-sm text-gray-400">{t("onboarding.step3.waitingConnection")}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-blocked/10 border border-blocked/20 px-4 py-2 text-sm text-blocked">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
