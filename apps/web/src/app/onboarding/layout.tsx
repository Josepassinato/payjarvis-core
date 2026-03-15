"use client";

import { useTranslation } from "react-i18next";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-sm">
            PJ
          </div>
          <span className="text-gray-900 font-semibold text-lg">PayJarvis</span>
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center py-8 px-4">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
