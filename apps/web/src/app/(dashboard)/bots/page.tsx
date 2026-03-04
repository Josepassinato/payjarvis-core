"use client";

import { useState } from "react";
import Link from "next/link";
import { getBots, updateBotStatus } from "@/lib/api";
import type { Bot } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TrustBar } from "@/components/trust-bar";
import { LoadingSpinner, ErrorBox } from "@/components/loading";

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-approved/10 text-approved",
  PAUSED: "bg-pending/10 text-pending",
  REVOKED: "bg-blocked/10 text-blocked",
};
const statusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  REVOKED: "Revogado",
};

export default function BotsPage() {
  const { data: bots, loading, error, refetch } = useApi<Bot[]>(() => getBots());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleStatusChange = async (bot: Bot, newStatus: string) => {
    if (newStatus === "REVOKED" && !confirm(`Revogar bot "${bot.name}"? Essa ação é irreversível.`)) return;
    setActionLoading(bot.id);
    try {
      await updateBotStatus(bot.id, newStatus);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao atualizar status");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">Bots</h2>
          <p className="text-sm text-gray-500 mt-1">{(bots ?? []).length} bot(s) registrado(s)</p>
        </div>
        <Link
          href="/bots/new"
          className="px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors"
        >
          + Novo Bot
        </Link>
      </div>

      {(bots ?? []).length === 0 ? (
        <div className="bg-surface-card border border-surface-border rounded-xl p-12 text-center">
          <p className="text-gray-400">Nenhum bot registrado</p>
          <p className="text-xs text-gray-600 mt-1">Clique em "+ Novo Bot" para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(bots ?? []).map((bot) => (
            <div key={bot.id} className="bg-surface-card border border-surface-border rounded-xl p-5 hover:border-surface-hover transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <Link href={`/bots/${bot.id}`} className="text-base font-semibold text-white hover:text-brand-400 transition-colors">
                    {bot.name}
                  </Link>
                  <p className="text-xs text-gray-500 mt-0.5">{bot.platform}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyles[bot.status] ?? ""}`}>
                  {statusLabels[bot.status] ?? bot.status}
                </span>
              </div>

              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-1.5">Trust Score</p>
                <TrustBar score={bot.trustScore} />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="text-xs text-gray-500">Aprovadas</p>
                  <p className="text-sm font-mono text-approved">{bot.totalApproved}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Bloqueadas</p>
                  <p className="text-sm font-mono text-blocked">{bot.totalBlocked}</p>
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-surface-border">
                <Link href={`/bots/${bot.id}`} className="px-3 py-1.5 text-xs text-brand-400 bg-brand-600/10 rounded hover:bg-brand-600/20 transition-colors">
                  Configurar
                </Link>
                {bot.status === "ACTIVE" && (
                  <button
                    onClick={() => handleStatusChange(bot, "PAUSED")}
                    disabled={actionLoading === bot.id}
                    className="px-3 py-1.5 text-xs text-pending bg-pending/10 rounded hover:bg-pending/20 transition-colors disabled:opacity-50"
                  >
                    Pausar
                  </button>
                )}
                {bot.status === "PAUSED" && (
                  <button
                    onClick={() => handleStatusChange(bot, "ACTIVE")}
                    disabled={actionLoading === bot.id}
                    className="px-3 py-1.5 text-xs text-approved bg-approved/10 rounded hover:bg-approved/20 transition-colors disabled:opacity-50"
                  >
                    Reativar
                  </button>
                )}
                {bot.status !== "REVOKED" && (
                  <button
                    onClick={() => handleStatusChange(bot, "REVOKED")}
                    disabled={actionLoading === bot.id}
                    className="px-3 py-1.5 text-xs text-blocked bg-blocked/10 rounded hover:bg-blocked/20 transition-colors disabled:opacity-50"
                  >
                    Revogar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
