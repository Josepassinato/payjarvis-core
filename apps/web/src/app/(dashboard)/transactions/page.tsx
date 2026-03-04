"use client";

import { useState } from "react";
import { getBots, getTransactions, getTransactionsPdfUrl } from "@/lib/api";
import type { Bot, Transaction, TransactionFilters, PaginatedResult } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { DecisionBadge } from "@/components/decision-badge";
import { LoadingSpinner, ErrorBox } from "@/components/loading";
import { currency, shortDate } from "@/lib/format";

const decisionOptions = ["", "APPROVED", "BLOCKED", "PENDING_HUMAN"];
const decisionLabels: Record<string, string> = {
  "": "Todas decisões",
  APPROVED: "Aprovadas",
  BLOCKED: "Bloqueadas",
  PENDING_HUMAN: "Pendentes",
};

export default function TransactionsPage() {
  const [botFilter, setBotFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const filters: TransactionFilters = { page, limit: 20 };
  if (botFilter) filters.botId = botFilter;
  if (decisionFilter) filters.decision = decisionFilter;
  if (categoryFilter) filters.category = categoryFilter;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;

  const bots = useApi<Bot[]>(() => getBots());
  const txs = useApi<PaginatedResult<Transaction>>(
    () => getTransactions(filters),
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">Transações</h2>
          <p className="text-sm text-gray-500 mt-1">
            {totalItems} transação(ões) no total
          </p>
        </div>
        <button
          onClick={handleExport}
          className="px-4 py-2.5 bg-surface-card border border-surface-border text-sm text-gray-300 rounded-lg hover:bg-surface-hover transition-colors"
        >
          Exportar PDF
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={botFilter}
          onChange={(e) => { setBotFilter(e.target.value); setPage(1); }}
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
        >
          <option value="">Todos os bots</option>
          {(bots.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select
          value={decisionFilter}
          onChange={(e) => { setDecisionFilter(e.target.value); setPage(1); }}
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
        >
          {decisionOptions.map((opt) => (
            <option key={opt} value={opt}>{decisionLabels[opt]}</option>
          ))}
        </select>
        <input
          type="text"
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          placeholder="Categoria (ex: food,travel)"
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 w-44"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
        />
      </div>

      {txs.error && <ErrorBox message={txs.error} onRetry={txs.refetch} />}

      {!txs.error && (
        <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Bot</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Merchant</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Valor</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Categoria</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Decisão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {transactions.map((tx) => {
                const botName = (bots.data ?? []).find((b) => b.id === tx.botId)?.name ?? tx.botId.slice(0, 8);
                return (
                  <tr key={tx.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-5 py-3.5 text-sm text-gray-400">{shortDate(tx.createdAt)}</td>
                    <td className="px-5 py-3.5 text-sm text-white">{botName}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-300">{tx.merchantName}</td>
                    <td className="px-5 py-3.5 text-sm font-mono text-right text-white">{currency(tx.amount, tx.currency)}</td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 bg-surface-hover rounded text-xs text-gray-400">{tx.category}</span>
                    </td>
                    <td className="px-5 py-3.5"><DecisionBadge decision={tx.decision} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {transactions.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">Nenhuma transação encontrada</div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">
            Página {page} de {totalPages} ({totalItems} transações)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs bg-surface-card border border-surface-border rounded-lg text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs bg-surface-card border border-surface-border rounded-lg text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Próximo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
