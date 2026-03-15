"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import { getApprovals, respondToApproval } from "@/lib/api";
import type { Approval } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { LoadingSpinner, ErrorBox } from "@/components/loading";
import { currency } from "@/lib/format";

function Countdown({ expiresAt, expiredLabel }: { expiresAt: string; expiredLabel: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(expiredLabel);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${String(secs).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, expiredLabel]);

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
    <div className="fixed bottom-6 right-6 bg-white border-l-2 border-l-blocked border border-blocked/20 rounded-xl px-5 py-3 shadow-2xl shadow-black/30 z-50 animate-slide-in-right">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-blocked shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-blocked">{message}</p>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const { data: approvals, loading, error, refetch } = useApi<Approval[]>((token) => getApprovals(token));
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionTaken, setActionTaken] = useState<Record<string, "approved" | "rejected">>({});
  const [toast, setToast] = useState<string | null>(null);

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
          setToast(t("approvals.expiredToast"));
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
  }, [refetch, t]);

  useEffect(() => {
    if (!approvals || approvals.length === 0) return;

    const checkExpired = () => {
      const now = Date.now();
      for (const a of approvals) {
        if (new Date(a.expiresAt).getTime() < now && !actionTaken[a.id]) {
          setToast(t("approvals.expiredToast"));
          refetch();
          return;
        }
      }
    };

    const id = setInterval(checkExpired, 5000);
    return () => clearInterval(id);
  }, [approvals, actionTaken, refetch, t]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setActionLoading(id);
    try {
      const token = await getToken();
      await respondToApproval(id, action, undefined, token);
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
        <h2 className="text-2xl font-bold text-gray-900">{t("approvals.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {t("approvals.count", { count: list.length })}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400">{t("approvals.none")}</p>
          <p className="text-xs text-gray-600 mt-1">{t("approvals.noneHint")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((approval) => {
            const taken = actionTaken[approval.id];
            const expired = new Date(approval.expiresAt).getTime() < Date.now();
            return (
              <div
                key={approval.id}
                className={`bg-white border rounded-xl p-5 transition-all ${
                  taken === "approved"
                    ? "border-approved/30 opacity-60"
                    : taken === "rejected"
                    ? "border-blocked/30 opacity-60"
                    : expired
                    ? "border-gray-700 opacity-50"
                    : "border-pending/20"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs text-gray-500">{t("approvals.bot")}: {approval.botId.slice(0, 8)}...</span>
                      <span className="w-1 h-1 rounded-full bg-gray-700" />
                      <span className="text-xs text-gray-500">{approval.category}</span>
                    </div>
                    <p className="text-lg font-semibold text-gray-900">{approval.merchantName}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{currency(approval.amount)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">{t("approvals.expiresIn")}</p>
                    <Countdown expiresAt={approval.expiresAt} expiredLabel={t("approvals.expired")} />
                  </div>
                </div>

                {!taken && !expired && (
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-5 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => handleAction(approval.id, "approve")}
                      disabled={actionLoading === approval.id}
                      className="flex-1 py-2.5 bg-approved/10 border border-approved/20 text-approved font-medium text-sm rounded-lg hover:bg-approved/20 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === approval.id ? "..." : t("approvals.approve")}
                    </button>
                    <button
                      onClick={() => handleAction(approval.id, "reject")}
                      disabled={actionLoading === approval.id}
                      className="flex-1 py-2.5 bg-blocked/10 border border-blocked/20 text-blocked font-medium text-sm rounded-lg hover:bg-blocked/20 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === approval.id ? "..." : t("approvals.block")}
                    </button>
                  </div>
                )}

                {taken && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className={`text-sm font-medium ${taken === "approved" ? "text-approved" : "text-blocked"}`}>
                      {taken === "approved" ? t("decisions.approved") : t("decisions.blocked")}
                    </p>
                  </div>
                )}

                {expired && !taken && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-medium text-gray-500">{t("approvals.expiredPurchase")}</p>
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
