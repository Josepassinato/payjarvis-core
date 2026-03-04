"use client";

import { useState, useEffect, useCallback } from "react";
import { getApprovals, respondToApproval } from "@/lib/api";
import type { Approval } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { LoadingSpinner, ErrorBox } from "@/components/loading";
import { currency } from "@/lib/format";

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Expirado");
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${String(secs).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const diff = new Date(expiresAt).getTime() - Date.now();
  const isExpired = diff <= 0;
  const isUrgent = diff > 0 && diff < 2 * 60 * 1000;

  return (
    <span className={`font-mono text-sm ${isExpired ? "text-gray-500" : isUrgent ? "text-blocked" : "text-pending"}`}>
      {remaining}
    </span>
  );
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 5000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 bg-surface-card border border-blocked/30 rounded-xl px-5 py-3 shadow-lg z-50 animate-pulse">
      <p className="text-sm text-blocked">{message}</p>
    </div>
  );
}

export default function ApprovalsPage() {
  const { data: approvals, loading, error, refetch } = useApi<Approval[]>(() => getApprovals());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionTaken, setActionTaken] = useState<Record<string, "approved" | "rejected">>({});
  const [toast, setToast] = useState<string | null>(null);

  // SSE real-time updates + expiration handling + fallback polling
  useEffect(() => {
    const pollId = setInterval(() => refetch(), 30000);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${apiUrl}/approvals/stream`);
      es.addEventListener("approval_created", () => refetch());
      es.addEventListener("approval_responded", () => refetch());
      es.addEventListener("approval_expired", (event) => {
        refetch();
        try {
          const data = JSON.parse(event.data);
          setToast("Aprovação expirada — compra bloqueada automaticamente");
        } catch {}
      });
      es.onerror = () => {
        es?.close();
        es = null;
      };
    } catch {
      // SSE not available, fallback to polling
    }

    return () => {
      clearInterval(pollId);
      es?.close();
    };
  }, [refetch]);

  // Client-side expiration check — auto-remove expired approvals from display
  useEffect(() => {
    if (!approvals || approvals.length === 0) return;

    const checkExpired = () => {
      const now = Date.now();
      for (const a of approvals) {
        if (new Date(a.expiresAt).getTime() < now && !actionTaken[a.id]) {
          setToast("Aprovação expirada — compra bloqueada automaticamente");
          refetch();
          return;
        }
      }
    };

    const id = setInterval(checkExpired, 5000);
    return () => clearInterval(id);
  }, [approvals, actionTaken, refetch]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setActionLoading(id);
    try {
      await respondToApproval(id, action);
      setActionTaken((prev) => ({ ...prev, [id]: action === "approve" ? "approved" : "rejected" }));
      setTimeout(() => refetch(), 500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !approvals) return <LoadingSpinner />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;

  const list = approvals ?? [];

  return (
    <div>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Aprovações Pendentes</h2>
        <p className="text-sm text-gray-500 mt-1">
          {list.length} compra{list.length !== 1 ? "s" : ""} aguardando sua decisão
        </p>
      </div>

      {list.length === 0 ? (
        <div className="bg-surface-card border border-surface-border rounded-xl p-12 text-center">
          <p className="text-gray-400">Nenhuma aprovação pendente</p>
          <p className="text-xs text-gray-600 mt-1">Seus bots estão operando dentro dos limites</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((approval) => {
            const taken = actionTaken[approval.id];
            const expired = new Date(approval.expiresAt).getTime() < Date.now();
            return (
              <div
                key={approval.id}
                className={`bg-surface-card border rounded-xl p-5 transition-all ${
                  taken === "approved"
                    ? "border-approved/30 opacity-60"
                    : taken === "rejected"
                    ? "border-blocked/30 opacity-60"
                    : expired
                    ? "border-gray-700 opacity-50"
                    : "border-pending/20"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs text-gray-500">Bot: {approval.botId.slice(0, 8)}...</span>
                      <span className="w-1 h-1 rounded-full bg-gray-700" />
                      <span className="text-xs text-gray-500">{approval.category}</span>
                    </div>
                    <p className="text-lg font-semibold text-white">{approval.merchantName}</p>
                    <p className="text-2xl font-bold text-white mt-1">{currency(approval.amount)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">Expira em</p>
                    <Countdown expiresAt={approval.expiresAt} />
                  </div>
                </div>

                {!taken && !expired && (
                  <div className="flex gap-3 mt-5 pt-4 border-t border-surface-border">
                    <button
                      onClick={() => handleAction(approval.id, "approve")}
                      disabled={actionLoading === approval.id}
                      className="flex-1 py-2.5 bg-approved/10 border border-approved/20 text-approved font-medium text-sm rounded-lg hover:bg-approved/20 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === approval.id ? "..." : "APROVAR"}
                    </button>
                    <button
                      onClick={() => handleAction(approval.id, "reject")}
                      disabled={actionLoading === approval.id}
                      className="flex-1 py-2.5 bg-blocked/10 border border-blocked/20 text-blocked font-medium text-sm rounded-lg hover:bg-blocked/20 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === approval.id ? "..." : "BLOQUEAR"}
                    </button>
                  </div>
                )}

                {taken && (
                  <div className="mt-4 pt-3 border-t border-surface-border">
                    <p className={`text-sm font-medium ${taken === "approved" ? "text-approved" : "text-blocked"}`}>
                      {taken === "approved" ? "Aprovado" : "Bloqueado"}
                    </p>
                  </div>
                )}

                {expired && !taken && (
                  <div className="mt-4 pt-3 border-t border-surface-border">
                    <p className="text-sm font-medium text-gray-500">Expirado — compra bloqueada</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
