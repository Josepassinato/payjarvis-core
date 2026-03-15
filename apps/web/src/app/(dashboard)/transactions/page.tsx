"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getBots, getTransactions, getTransactionsPdfUrl } from "@/lib/api";
import type { Bot, Transaction, TransactionFilters, PaginatedResult } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { DecisionBadge } from "@/components/decision-badge";
import { LoadingSpinner, ErrorBox } from "@/components/loading";
import { currency, shortDate } from "@/lib/format";

const decisionOptions = ["", "APPROVED", "BLOCKED", "PENDING_HUMAN"];

export default function TransactionsPage() {
  const { t } = useTranslation();
  const [botFilter, setBotFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const decisionLabels: Record<string, string> = {
    "": t("transactions.allDecisions"),
    APPROVED: t("decisions.approved"),
    BLOCKED: t("decisions.blocked"),
    PENDING_HUMAN: t("decisions.pending"),
  };

  const filters: TransactionFilters = { page, limit: 20 };
  if (botFilter) filters.botId = botFilter;
  if (decisionFilter) filters.decision = decisionFilter;
  if (categoryFilter) filters.category = categoryFilter;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;

  const bots = useApi<Bot[]>((token) => getBots(token));
  const txs = useApi<PaginatedResult<Transaction>>(
    (token) => getTransactions(filters, token),
    [botFilter, decisionFilter, categoryFilter, dateFrom, dateTo, page]
  );

  const handleExport = () => {
    window.open(getTransactionsPdfUrl(filters), "_blank");
  };

  const result = txs.data;
  const transactions = result?.data ?? [];
  const totalPages = result?.pages ?? 1;
  const totalItems = result?.total ?? 0;

  if (txs.loading && !txs.data) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 md:mb-8">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">{t("transactions.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("transactions.count", { count: totalItems })}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="px-4 py-2.5 bg-white border border-gray-200 text-sm text-gray-300 rounded-lg hover:bg-gray-100 transition-colors self-start sm:self-auto"
        >
          {t("transactions.exportPdf")}
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2 md:gap-3 mb-6">
        <select
          value={botFilter}
          onChange={(e) => { setBotFilter(e.target.value); setPage(1); }}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-brand-500"
        >
          <option value="">{t("transactions.allBots")}</option>
          {(bots.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select
          value={decisionFilter}
          onChange={(e) => { setDecisionFilter(e.target.value); setPage(1); }}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-brand-500"
        >
          {decisionOptions.map((opt) => (
            <option key={opt} value={opt}>{decisionLabels[opt]}</option>
          ))}
        </select>
        <input
          type="text"
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          placeholder={t("transactions.category")}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 col-span-2 md:col-span-1 md:w-44"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-brand-500"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-brand-500"
        />
      </div>

      {txs.error && <ErrorBox message={txs.error} onRetry={txs.refetch} />}

      {!txs.error && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("transactions.date")}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("transactions.bot")}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("transactions.merchant")}</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("transactions.amount")}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("transactions.category")}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("transactions.decision")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transactions.map((tx) => {
                  const botName = (bots.data ?? []).find((b) => b.id === tx.botId)?.name ?? tx.botId.slice(0, 8);
                  return (
                    <tr key={tx.id} className="hover:bg-gray-100 transition-colors">
                      <td className="px-5 py-3.5 text-sm text-gray-400">{shortDate(tx.createdAt)}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-900">{botName}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-300">{tx.merchantName}</td>
                      <td className="px-5 py-3.5 text-sm font-mono text-right text-gray-900">{currency(tx.amount, tx.currency)}</td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-400">{tx.category}</span>
                      </td>
                      <td className="px-5 py-3.5"><DecisionBadge decision={tx.decision} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {transactions.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">{t("transactions.noTx")}</div>
            )}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {transactions.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm">
                {t("transactions.noTx")}
              </div>
            ) : (
              transactions.map((tx) => {
                const botName = (bots.data ?? []).find((b) => b.id === tx.botId)?.name ?? tx.botId.slice(0, 8);
                return (
                  <div key={tx.id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{tx.merchantName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{botName} &middot; {tx.category}</p>
                      </div>
                      <DecisionBadge decision={tx.decision} />
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-gray-500">{shortDate(tx.createdAt)}</span>
                      <span className="text-sm font-mono font-semibold text-gray-900">{currency(tx.amount, tx.currency)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">
            {t("transactions.page", { page, total: totalPages, items: totalItems })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t("common.previous")}
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
