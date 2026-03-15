"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { LoadingSpinner } from "@/components/loading";

interface LayerStatus {
  layer1: { active: boolean; decisions: number; approvals: number };
  layer2: { active: boolean; searches: number; providers: string[] };
  layer3: { configured: boolean; connectedApps: string[] };
  layer4: { configured: boolean; activeSessions: number };
}

const FALLBACK_DATA: LayerStatus = {
  layer1: { active: true, decisions: 45, approvals: 3 },
  layer2: { active: true, searches: 12, providers: ["Amadeus", "Ticketmaster", "Yelp"] },
  layer3: { configured: false, connectedApps: ["Gmail", "Calendar", "CRM", "Notifications"] },
  layer4: { configured: false, activeSessions: 0 },
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function StatusDot({ status }: { status: "active" | "partial" | "inactive" }) {
  const colors = {
    active: "bg-emerald-400 shadow-emerald-400/40",
    partial: "bg-amber-400 shadow-amber-400/40",
    inactive: "bg-gray-500 shadow-gray-500/20",
  };
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]} shadow-[0_0_6px]`} />
  );
}

export default function LayersPage() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const [data, setData] = useState<LayerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/core/status`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error("API error");
        const json = await res.json();
        if (!cancelled) {
          setData(json.data ?? json);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData(FALLBACK_DATA);
          setWarning(t("layers.fetchWarning"));
          setLoading(false);
        }
      }
    }

    fetchStatus();
    return () => { cancelled = true; };
  }, [getToken, t]);

  if (loading) return <LoadingSpinner />;

  const status = data!;

  const layer1Status: "active" | "partial" | "inactive" = status.layer1.active ? "active" : "inactive";
  const layer2Status: "active" | "partial" | "inactive" = status.layer2.active ? "active" : "inactive";
  const layer3Status: "active" | "partial" | "inactive" = status.layer3.configured ? "partial" : "inactive";
  const layer4Status: "active" | "partial" | "inactive" = status.layer4.configured ? "active" : "inactive";

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-display font-bold text-gray-900">{t("layers.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("layers.subtitle")}</p>
      </div>

      {warning && (
        <div className="mb-6 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 text-sm text-amber-400 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          {warning}
        </div>
      )}

      <div className="space-y-4">
        {/* Layer 1 — PayJarvis Core */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 transition-colors hover:border-gray-300">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <StatusDot status={layer1Status} />
              <div>
                <h3 className="text-gray-900 font-display font-semibold">
                  <span className="text-[#0066FF] text-lg font-bold mr-2">{t("layers.layer1Number")}</span>
                  {t("layers.layer1Name")}
                </h3>
                <p className="text-gray-400 text-sm mt-0.5">{t("layers.layer1Modules")}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-6">
            <p className="text-sm text-gray-300">
              {t("layers.today")}:{" "}
              <span className="font-mono text-[#00D4AA]">{status.layer1.decisions}</span>{" "}
              {t("layers.decisions")}{" · "}
              <span className="font-mono text-[#00D4AA]">{status.layer1.approvals}</span>{" "}
              {t("layers.approvals")}
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Link
              href="/approvals"
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.configurePolicy")}
            </Link>
            <Link
              href="/transactions"
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.viewAuditLog")}
            </Link>
          </div>
        </div>

        {/* Layer 2 — Official APIs */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 transition-colors hover:border-gray-300">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <StatusDot status={layer2Status} />
              <div>
                <h3 className="text-gray-900 font-display font-semibold">
                  <span className="text-[#0066FF] text-lg font-bold mr-2">{t("layers.layer2Number")}</span>
                  {t("layers.layer2Name")}
                </h3>
                <p className="text-gray-400 text-sm mt-0.5">
                  {status.layer2.providers.join(" · ")}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-6">
            <p className="text-sm text-gray-300">
              {t("layers.today")}:{" "}
              <span className="font-mono text-[#00D4AA]">{status.layer2.searches}</span>{" "}
              {t("layers.searches")}
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Link
              href="/integrations"
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.manageApis")}
            </Link>
            <button
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.apiKeys")}
            </button>
          </div>
        </div>

        {/* Layer 3 — Composio */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 transition-colors hover:border-gray-300">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <StatusDot status={layer3Status} />
              <div>
                <h3 className="text-gray-900 font-display font-semibold">
                  <span className="text-[#0066FF] text-lg font-bold mr-2">{t("layers.layer3Number")}</span>
                  {t("layers.layer3Name")}
                </h3>
                <p className="text-gray-400 text-sm mt-0.5">
                  {status.layer3.connectedApps.join(" · ")}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-300">
              {t("layers.status")}:{" "}
              <span className={`font-mono ${status.layer3.configured ? "text-[#00D4AA]" : "text-amber-400"}`}>
                {status.layer3.configured ? t("layers.configured") : t("layers.apiKeyConfigured")}
              </span>
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.connectApps")}
            </button>
            <button
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.viewActions")}
            </button>
          </div>
        </div>

        {/* Layer 4 — Browserbase */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 transition-colors hover:border-gray-300">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <StatusDot status={layer4Status} />
              <div>
                <h3 className="text-gray-900 font-display font-semibold">
                  <span className="text-[#0066FF] text-lg font-bold mr-2">{t("layers.layer4Number")}</span>
                  {t("layers.layer4Name")}
                </h3>
                <p className="text-gray-400 text-sm mt-0.5">{t("layers.layer4Modules")}</p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-300">
              {t("layers.status")}:{" "}
              <span className={`font-mono ${status.layer4.configured ? "text-[#00D4AA]" : "text-gray-500"}`}>
                {status.layer4.configured ? t("layers.configured") : t("layers.notConfigured")}
              </span>
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("common.configure")}
            </button>
            <button
              className="border border-gray-200 hover:border-[#0066FF] rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-gray-900 transition-colors"
            >
              {t("layers.viewSessions")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
