"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

// ─── Provider metadata (icons & categories) ────────────

const CATEGORY_META: Record<string, { emoji: string; labelKey: string; order: number }> = {
  travel:       { emoji: "\u2708\uFE0F", labelKey: "integrations.catTravel",       order: 0 },
  restaurants:  { emoji: "\uD83C\uDF7D\uFE0F", labelKey: "integrations.catRestaurants",  order: 1 },
  events:       { emoji: "\uD83C\uDFAB", labelKey: "integrations.catEvents",       order: 2 },
  marketplace:  { emoji: "\uD83D\uDED2", labelKey: "integrations.catMarketplace",  order: 3 },
  transport:    { emoji: "\uD83D\uDE97", labelKey: "integrations.catTransport",    order: 4 },
  delivery:     { emoji: "\uD83C\uDF55", labelKey: "integrations.catDelivery",     order: 5 },
};

const PROVIDER_EMOJI: Record<string, string> = {
  amadeus: "\u2708\uFE0F",
  airbnb: "\uD83C\uDFE0",
  yelp: "\u2B50",
  opentable: "\uD83C\uDF7D\uFE0F",
  ticketmaster: "\uD83C\uDFAB",
  stubhub: "\uD83C\uDFDF\uFE0F",
  amazon: "\uD83D\uDCE6",
  mercado_livre: "\uD83E\uDD1D",
  uber: "\uD83D\uDE97",
  lyft: "\uD83D\uDE95",
  uber_eats: "\uD83C\uDF54",
  doordash: "\uD83D\uDEF5",
  ifood: "\uD83C\uDF5B",
};

// ─── Types ──────────────────────────────────────────────

export interface ProviderInfo {
  provider: string;
  label: string;
  description: string;
  category: string;
  available: boolean;
}

export interface EnabledState {
  [provider: string]: boolean;
}

interface IntegrationGridProps {
  providers: ProviderInfo[];
  enabled: EnabledState;
  onToggle: (provider: string, category: string, newValue: boolean) => void;
  toggling?: string | null;
}

// ─── Toggle Switch ──────────────────────────────────────

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        disabled
          ? "bg-gray-200 cursor-not-allowed opacity-50"
          : checked
          ? "bg-approved"
          : "bg-gray-200 hover:bg-gray-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Provider Card ──────────────────────────────────────

function ProviderCard({
  provider,
  enabled,
  onToggle,
  isToggling,
}: {
  provider: ProviderInfo;
  enabled: boolean;
  onToggle: () => void;
  isToggling: boolean;
}) {
  const { t } = useTranslation();
  const emoji = PROVIDER_EMOJI[provider.provider] || "\uD83D\uDD17";
  const comingSoon = !provider.available;

  return (
    <div
      className={`relative rounded-xl border p-4 transition-all duration-200 ${
        comingSoon
          ? "border-gray-200 bg-gray-50/50 opacity-60"
          : enabled
          ? "border-brand-600 bg-brand-600/5 ring-1 ring-brand-600/20"
          : "border-gray-200 bg-gray-50 hover:border-gray-600"
      }`}
    >
      {/* Coming Soon badge */}
      {comingSoon && (
        <span className="absolute top-2 right-2 text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
          {t("integrations.comingSoon")}
        </span>
      )}

      {/* Connected badge */}
      {!comingSoon && enabled && (
        <span className="absolute top-2 right-2 text-[10px] font-medium text-approved bg-approved/10 px-2 py-0.5 rounded-full flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {t("integrations.connected")}
        </span>
      )}

      <div className="flex items-start gap-3 mt-1">
        <span className="text-2xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${enabled ? "text-brand-400" : "text-gray-900"}`}>
            {provider.label}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{provider.description}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end">
        {isToggling ? (
          <div className="h-6 w-11 flex items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          </div>
        ) : (
          <Toggle
            checked={enabled}
            disabled={comingSoon}
            onChange={onToggle}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main Grid ──────────────────────────────────────────

export function IntegrationGrid({ providers, enabled, onToggle, toggling }: IntegrationGridProps) {
  const { t } = useTranslation();

  // Group by category
  const grouped: Record<string, ProviderInfo[]> = {};
  for (const p of providers) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  // Sort categories by predefined order
  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
  );

  return (
    <div className="space-y-6">
      {sortedCategories.map((cat) => {
        const meta = CATEGORY_META[cat] || { emoji: "\uD83D\uDD17", labelKey: cat, order: 99 };
        const items = grouped[cat];

        return (
          <div key={cat}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>{meta.emoji}</span>
              {t(meta.labelKey, { defaultValue: cat })}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((provider) => (
                <ProviderCard
                  key={provider.provider}
                  provider={provider}
                  enabled={!!enabled[provider.provider]}
                  onToggle={() => onToggle(provider.provider, provider.category, !enabled[provider.provider])}
                  isToggling={toggling === provider.provider}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
