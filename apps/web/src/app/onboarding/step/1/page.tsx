"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { submitOnboardingStep, getOnboardingStatus } from "@/lib/api";
import { OnboardingProgress } from "@/components/onboarding-progress";

const COUNTRIES = [
  { code: "BR", label: "Brazil" },
  { code: "US", label: "United States" },
  { code: "PT", label: "Portugal" },
  { code: "ES", label: "Spain" },
  { code: "MX", label: "Mexico" },
  { code: "AR", label: "Argentina" },
  { code: "CO", label: "Colombia" },
  { code: "CL", label: "Chile" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "OTHER", label: "Other" },
];

export default function OnboardingStep1() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("BR");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const status = await getOnboardingStatus(token);
        if (status.onboardingStep >= 4) {
          router.replace("/dashboard");
        }
      } catch {
        // continue
      }
    })();
  }, [getToken, router]);

  const handleSubmit = async () => {
    if (!fullName.trim() || !phone.trim() || !country) {
      setError(t("onboarding.step1.fillRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      await submitOnboardingStep(1, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        country,
      }, token);
      router.push("/onboarding/step/2");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("onboarding.step1.submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = fullName.trim() && phone.trim() && country;

  return (
    <div>
      <OnboardingProgress current={1} />

      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t("onboarding.step1.title")}</h2>
          <p className="text-sm text-gray-400 mt-1">{t("onboarding.step1.subtitle")}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("onboarding.step1.fullName")} *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("onboarding.step1.fullNamePlaceholder")}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("onboarding.step1.phone")} *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("onboarding.step1.country")} *</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-brand-500"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-blocked/10 border border-blocked/20 px-4 py-2 text-sm text-blocked">
            {error}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="px-8 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
          >
            {submitting ? t("common.loading") : t("common.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
