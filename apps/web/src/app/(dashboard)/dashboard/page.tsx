"use client";

import {
  getBots,
  getTransactions,
  getSpendingTrends,
  getByCategory,
  getDecisions,
  getByBot,
} from "@/lib/api";
import type {
  Bot,
  Transaction,
  PaginatedResult,
  SpendingTrend,
  CategoryBreakdown,
  DecisionBreakdown,
  BotBreakdown,
} from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { StatCard } from "@/components/stat-card";
import { DecisionBadge } from "@/components/decision-badge";
import { LoadingSpinner, ErrorBox } from "@/components/loading";
import { currency, shortDate } from "@/lib/format";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";

const DECISION_COLORS: Record<string, string> = {
  APPROVED: "#22c55e",
  BLOCKED: "#ef4444",
  PENDING_HUMAN: "#eab308",
};

const CATEGORY_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#06b6d4",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#ec4899",
  "#f97316",
  "#6366f1",
  "#14b8a6",
];

function ChartCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-surface-card border border-surface-border rounded-xl ${className}`}
    >
      <div className="px-5 py-4 border-b border-surface-border">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ChartSkeleton({ height = 250 }: { height?: number }) {
  return (
    <div
      className="animate-pulse bg-surface-hover rounded-lg"
      style={{ height }}
    />
  );
}

function formatDateLabel(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}

function SpendingTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400 mb-1">
        {label ? formatDateLabel(label) : ""}
      </p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm text-white font-medium">
          {currency(p.value)}
        </p>
      ))}
    </div>
  );
}

function DecisionTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const decisionLabels: Record<string, string> = {
    APPROVED: "Aprovadas",
    BLOCKED: "Bloqueadas",
    PENDING_HUMAN: "Pendentes",
  };
  return (
    <div className="bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400 mb-1">
        {label ? decisionLabels[label] ?? label : ""}
      </p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm text-white font-medium">
          {p.name === "total" ? currency(p.value) : `${p.value} transacoes`}
        </p>
      ))}
    </div>
  );
}

function BotTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm text-white font-medium">
          {currency(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const bots = useApi<Bot[]>(() => getBots());
  const txs = useApi<PaginatedResult<Transaction>>(() =>
    getTransactions({ limit: 100 })
  );
  const trends = useApi<SpendingTrend[]>(() => getSpendingTrends());
  const categories = useApi<CategoryBreakdown[]>(() => getByCategory());
  const decisions = useApi<DecisionBreakdown[]>(() => getDecisions());
  const botSpending = useApi<BotBreakdown[]>(() => getByBot());

  if (bots.loading || txs.loading) return <LoadingSpinner />;
  if (bots.error)
    return <ErrorBox message={bots.error} onRetry={bots.refetch} />;
  if (txs.error)
    return <ErrorBox message={txs.error} onRetry={txs.refetch} />;

  const allBots = bots.data ?? [];
  const allTxs = txs.data?.data ?? [];

  const activeBots = allBots.filter((b) => b.status === "ACTIVE").length;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyTxs = allTxs.filter(
    (t) => t.decision === "APPROVED" && new Date(t.createdAt) >= startOfMonth
  );
  const monthlySpend = monthlyTxs.reduce((sum, t) => sum + t.amount, 0);
  const pendingCount = allTxs.filter(
    (t) => t.decision === "PENDING_HUMAN"
  ).length;
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const blockedToday = allTxs.filter(
    (t) => t.decision === "BLOCKED" && new Date(t.createdAt) >= todayStart
  ).length;
  const recentTxs = allTxs.slice(0, 5);

  // Suspicious: bots with high block rate
  const suspiciousAlerts = allBots
    .filter((b) => b.totalBlocked > 3)
    .map((b) => ({
      id: b.id,
      name: b.name,
      message: `${b.totalBlocked} transacoes bloqueadas (trust score: ${b.trustScore})`,
    }));

  // Bots near monthly limit
  const nearLimitAlerts = allBots
    .filter((b) => b.policy && b.policy.maxPerMonth > 0)
    .map((b) => {
      const botMonthly = monthlyTxs
        .filter((t) => t.botId === b.id)
        .reduce((s, t) => s + t.amount, 0);
      const pct = b.policy ? (botMonthly / b.policy.maxPerMonth) * 100 : 0;
      return {
        id: b.id,
        name: b.name,
        pct,
        message: `atingiu ${pct.toFixed(0)}% do limite mensal`,
      };
    })
    .filter((a) => a.pct >= 70);

  // Decision data for chart labels
  const decisionLabels: Record<string, string> = {
    APPROVED: "Aprovadas",
    BLOCKED: "Bloqueadas",
    PENDING_HUMAN: "Pendentes",
  };

  const decisionsData = (decisions.data ?? []).map((d) => ({
    ...d,
    label: decisionLabels[d.decision] ?? d.decision,
    fill: DECISION_COLORS[d.decision] ?? "#6b7280",
  }));

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-sm text-gray-500 mt-1">Visao geral do PayJarvis</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Bots Ativos"
          value={activeBots}
          color="text-brand-400"
        />
        <StatCard
          label="Gasto no Mes"
          value={currency(monthlySpend)}
          color="text-approved"
        />
        <StatCard
          label="Aprovacoes Pendentes"
          value={pendingCount}
          color="text-pending"
        />
        <StatCard
          label="Bloqueados Hoje"
          value={blockedToday}
          color="text-blocked"
        />
      </div>

      {/* Row 1: Spending Trends (full width) */}
      <div className="mb-6">
        <ChartCard title="Tendencia de Gastos (30 dias)">
          {trends.loading ? (
            <ChartSkeleton height={300} />
          ) : trends.error ? (
            <p className="text-sm text-blocked">{trends.error}</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart
                data={trends.data ?? []}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="spendGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#2a2a2a"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateLabel}
                  stroke="#6b7280"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `R$${v}`}
                />
                <Tooltip content={<SpendingTooltip />} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#spendGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: Category (pie) + Decisions (bar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Gastos por Categoria">
          {categories.loading ? (
            <ChartSkeleton height={280} />
          ) : categories.error ? (
            <p className="text-sm text-blocked">{categories.error}</p>
          ) : !categories.data?.length ? (
            <p className="text-sm text-gray-500 text-center py-8">
              Sem dados de categorias
            </p>
          ) : (
            <div className="flex items-center">
              <ResponsiveContainer width="60%" height={280}>
                <PieChart>
                  <Pie
                    data={categories.data}
                    dataKey="total"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {categories.data.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0];
                      return (
                        <div className="bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg">
                          <p className="text-xs text-gray-400">{String(item.name)}</p>
                          <p className="text-sm text-white font-medium">{currency(Number(item.value))}</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2 pl-2">
                {categories.data.slice(0, 6).map((cat, i) => (
                  <div key={cat.category} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                      }}
                    />
                    <span className="text-xs text-gray-400 truncate flex-1">
                      {cat.category}
                    </span>
                    <span className="text-xs text-gray-300 font-mono">
                      {currency(cat.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Decisoes">
          {decisions.loading ? (
            <ChartSkeleton height={280} />
          ) : decisions.error ? (
            <p className="text-sm text-blocked">{decisions.error}</p>
          ) : !decisionsData.length ? (
            <p className="text-sm text-gray-500 text-center py-8">
              Sem dados de decisoes
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={decisionsData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#2a2a2a"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="#6b7280"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<DecisionTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "#9ca3af" }}
                  formatter={(value: string) =>
                    value === "count" ? "Quantidade" : "Valor (R$)"
                  }
                />
                <Bar dataKey="count" name="count" radius={[4, 4, 0, 0]}>
                  {decisionsData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3: By Bot (full width) */}
      <div className="mb-6">
        <ChartCard title="Gastos por Bot">
          {botSpending.loading ? (
            <ChartSkeleton height={280} />
          ) : botSpending.error ? (
            <p className="text-sm text-blocked">{botSpending.error}</p>
          ) : !botSpending.data?.length ? (
            <p className="text-sm text-gray-500 text-center py-8">
              Sem dados de bots
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={botSpending.data}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#2a2a2a"
                  vertical={false}
                />
                <XAxis
                  dataKey="botName"
                  stroke="#6b7280"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `R$${v}`}
                />
                <Tooltip content={<BotTooltip />} />
                <Bar
                  dataKey="total"
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={60}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Recent Transactions */}
      <div className="bg-surface-card border border-surface-border rounded-xl mb-6">
        <div className="px-5 py-4 border-b border-surface-border">
          <h3 className="text-sm font-semibold text-gray-300">
            Ultimas Transacoes
          </h3>
        </div>
        {recentTxs.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            Nenhuma transacao ainda
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {recentTxs.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-surface-hover transition-colors"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">
                    {tx.merchantName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {tx.category} &middot; {shortDate(tx.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-gray-200">
                    {currency(tx.amount, tx.currency)}
                  </span>
                  <DecisionBadge decision={tx.decision} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alerts */}
      {(suspiciousAlerts.length > 0 || nearLimitAlerts.length > 0) && (
        <div className="bg-surface-card border border-surface-border rounded-xl">
          <div className="px-5 py-4 border-b border-surface-border">
            <h3 className="text-sm font-semibold text-gray-300">
              Alertas de Comportamento Suspeito
            </h3>
          </div>
          <div className="divide-y divide-surface-border">
            {suspiciousAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 px-5 py-3.5"
              >
                <div className="w-2 h-2 rounded-full bg-blocked" />
                <p className="text-sm text-gray-300">
                  <span className="text-white font-medium">{a.name}</span> —{" "}
                  {a.message}
                </p>
              </div>
            ))}
            {nearLimitAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 px-5 py-3.5"
              >
                <div className="w-2 h-2 rounded-full bg-pending" />
                <p className="text-sm text-gray-300">
                  <span className="text-white font-medium">{a.name}</span>{" "}
                  {a.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
