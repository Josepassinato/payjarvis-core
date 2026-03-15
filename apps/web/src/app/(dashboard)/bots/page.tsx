"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import { getBots, updateBotStatus, deleteBot } from "@/lib/api";
import type { Bot } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TrustBar } from "@/components/trust-bar";
import { LoadingSpinner, ErrorBox } from "@/components/loading";

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-approved/10 text-approved",
  PAUSED: "bg-pending/10 text-pending",
  REVOKED: "bg-blocked/10 text-blocked",
};

const statusDotColors: Record<string, string> = {
  ACTIVE: "bg-approved",
  PAUSED: "bg-pending",
  REVOKED: "bg-blocked",
};

const platformColors: Record<string, string> = {
  TELEGRAM: "bg-blue-500",
  WHATSAPP: "bg-green-500",
  CUSTOM_API: "bg-gray-500",
  DISCORD: "bg-purple-500",
  SLACK: "bg-gray-700",
};

function PlatformIcon({ platform }: { platform: string }) {
  switch (platform) {
    case "TELEGRAM":
      return (
        <svg className="w-4 h-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      );
    case "WHATSAPP":
      return (
        <svg className="w-4 h-4 text-green-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zm0 14H6l-2 2V4h16v12z" />
        </svg>
      );
    case "CUSTOM_API":
      return (
        <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
        </svg>
      );
    case "DISCORD":
      return (
        <svg className="w-4 h-4 text-purple-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15 7.5V2H9v5.5l3 3 3-3zM7.5 9H2v6h5.5l3-3-3-3zM9 16.5V22h6v-5.5l-3-3-3 3zM16.5 9l-3 3 3 3H22V9h-5.5z" />
        </svg>
      );
    case "SLACK":
      return (
        <svg className="w-4 h-4 text-gray-300 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 20h-4V4h4v16zM4 20V4h4v16H4zm6-6V4h4v10h-4z" />
        </svg>
      );
    default:
      return null;
  }
}

function BotAvatar({ name, platform }: { name: string; platform: string }) {
  const color = platformColors[platform] ?? "bg-gray-500";
  const letter = (name ?? "B").charAt(0).toUpperCase();
  return (
    <div className={`${color} h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0`}>
      {letter}
    </div>
  );
}

export default function BotsPage() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const { data: bots, loading, error, refetch } = useApi<Bot[]>((token) => getBots(token));
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const statusLabels: Record<string, string> = {
    ACTIVE: t("bots.statusActive"),
    PAUSED: t("bots.statusPaused"),
    REVOKED: t("bots.statusRevoked"),
  };

  const handleStatusChange = async (bot: Bot, newStatus: string) => {
    if (newStatus === "REVOKED" && !confirm(t("bots.revokeConfirm", { name: bot.name }))) return;
    setActionLoading(bot.id);
    try {
      const token = await getToken();
      await updateBotStatus(bot.id, newStatus, token);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("bots.failedUpdate"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      await deleteBot(deleteTarget.id, token);
      setDeleteTarget(null);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("bots.failedDelete"));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 md:mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("bots.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">{t("bots.count", { count: (bots ?? []).length })}</p>
        </div>
        <Link
          href="/bots/new"
          className="px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors"
        >
          {t("bots.newBot")}
        </Link>
      </div>

      {(bots ?? []).length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-16 text-center flex flex-col items-center">
          <div className="h-20 w-20 rounded-full bg-brand-600/10 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="8.5" cy="16" r="1" />
              <circle cx="15.5" cy="16" r="1" />
              <path d="M12 11V5" />
              <path d="M8 5h8" />
              <circle cx="12" cy="3.5" r="1.5" />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-600 mb-1">{t("bots.noBots")}</p>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">{t("bots.noBotsHint")}</p>
          <Link
            href="/bots/new"
            className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors"
          >
            {t("bots.newBot")}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(bots ?? []).map((bot) => (
            <div key={bot.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-100 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <BotAvatar name={bot.name} platform={bot.platform} />
                  <div>
                    <Link href={`/bots/${bot.id}`} className="text-base font-semibold text-gray-900 hover:text-brand-400 transition-colors">
                      {bot.name}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <PlatformIcon platform={bot.platform} />
                      <p className="text-xs text-gray-500">{bot.platform}</p>
                    </div>
                  </div>
                </div>
                <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusStyles[bot.status] ?? ""}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDotColors[bot.status] ?? ""}`} />
                  {statusLabels[bot.status] ?? bot.status}
                </span>
              </div>

              <div className="mb-4 flex items-center gap-3">
                <div className="flex-1">
                  <TrustBar score={bot.trustScore} />
                </div>
                <span className="text-sm font-mono text-gray-600 shrink-0">{bot.trustScore}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="text-xs text-gray-500">{t("decisions.approved")}</p>
                  <p className="text-sm font-mono text-approved">{bot.totalApproved}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t("decisions.blocked")}</p>
                  <p className="text-sm font-mono text-blocked">{bot.totalBlocked}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
                <Link href={`/bots/${bot.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-brand-400 bg-brand-600/10 rounded hover:bg-brand-600/20 transition-colors">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                  {t("common.configure")}
                </Link>
                {bot.status === "ACTIVE" && (
                  <button
                    onClick={() => handleStatusChange(bot, "PAUSED")}
                    disabled={actionLoading === bot.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-pending bg-pending/10 rounded hover:bg-pending/20 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                    {t("bots.pause")}
                  </button>
                )}
                {bot.status === "PAUSED" && (
                  <button
                    onClick={() => handleStatusChange(bot, "ACTIVE")}
                    disabled={actionLoading === bot.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-approved bg-approved/10 rounded hover:bg-approved/20 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    {t("bots.reactivate")}
                  </button>
                )}
                {bot.status !== "REVOKED" && (
                  <button
                    onClick={() => handleStatusChange(bot, "REVOKED")}
                    disabled={actionLoading === bot.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-blocked bg-blocked/10 rounded hover:bg-blocked/20 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>
                    {t("bots.deactivate")}
                  </button>
                )}
                <button
                  onClick={() => setDeleteTarget(bot)}
                  disabled={actionLoading === bot.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 bg-red-900/10 rounded hover:bg-red-900/20 transition-colors disabled:opacity-50 ml-auto"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                  {t("bots.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("bots.deleteTitle")}</h3>
            <p className="text-sm text-gray-600 mb-6">
              {t("bots.deleteConfirm", { name: deleteTarget.name })}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:text-gray-900 transition-colors disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {deleting ? "..." : t("bots.deleteAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
