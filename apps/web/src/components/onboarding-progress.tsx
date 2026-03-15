"use client";

import { useTranslation } from "react-i18next";

const STEPS = [
  { key: "basics", label: "onboarding.steps.basics" },
  { key: "payment", label: "onboarding.steps.payment" },
  { key: "limits", label: "onboarding.steps.limits" },
];

export function OnboardingProgress({ current }: { current: number }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((step, i) => {
        const stepNum = i + 1;
        const isCompleted = current > stepNum;
        const isCurrent = current === stepNum;

        return (
          <div key={step.key} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-2 flex-1">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  isCompleted
                    ? "bg-approved text-gray-900"
                    : isCurrent
                    ? "bg-brand-600 text-gray-900"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {isCompleted ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`text-xs hidden sm:block ${
                  isCurrent ? "text-gray-900 font-medium" : "text-gray-500"
                }`}
              >
                {t(step.label)}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px flex-1 min-w-4 ${
                  isCompleted ? "bg-approved" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
