"use client";

import { useTranslation } from "react-i18next";

export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 border-2 border-brand-500/20 rounded-full" />
        <div className="absolute inset-0 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-xs text-gray-500 mt-4 font-mono tracking-wider">LOADING</p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-blocked/5 border-l-2 border-l-blocked border border-blocked/20 rounded-xl p-5 animate-fade-in">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-blocked shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <div>
          <p className="text-sm text-blocked">{message}</p>
          {onRetry && (
            <button onClick={onRetry} className="mt-3 px-4 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:text-gray-900 hover:bg-gray-200 transition-colors">
              {t("common.tryAgain")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-12 text-center animate-fade-in">
      <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
      <p className="text-gray-400">{message}</p>
      {sub && <p className="text-xs text-gray-600 mt-1.5">{sub}</p>}
    </div>
  );
}
