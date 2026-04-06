"use client";

import { useTranslation } from "react-i18next";
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
  "#0066FF",
  "#00D4AA",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
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
      className={`bg-white border border-gray-200 rounded-xl transition-all duration-200 hover:border-gray-300 ${className}`}
    >
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-sm font-display font-semibold text-gray-300">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ChartSkeleton({ height = 250 }: { height?: number }) {
  return (
    <div
      className="animate-pulse bg-gray-100 rounded-lg"
      style={{ height }}
    />
  );
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}

function SpendingTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-50border border-gray-200 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400 mb-1">{label ?? ""}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm text-gray-900 font-medium">
          {currency(p.value)}
        </p>
      ))}
    </div>
  );
}

function BotTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-50border border-gray-200 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm text-gray-900 font-medium">
          {currency(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();

  const localeMap: Record<string, string> = { en: "en-US", pt: "pt-BR", es: "es-ES" };
  const formatDateLabel = (date: string): string => {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(localeMap[i18n.language] ?? "en-US", { day: "2-digit", month: "2-digit" });
  };

  const decisionLabels: Record<string, string> = {
    APPROVED: t("decisions.approved"),
    BLOCKED: t("decisions.blocked"),
    PENDING_HUMAN: t("decisions.pending"),
  };

  function DecisionTooltip({ active, payload, label }: ChartTooltipProps) {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-gray-50border border-gray-200 rounded-lg px-3 py-2 shadow-lg">
        <p className="text-xs text-gray-400 mb-1">
          {label ? decisionLabels[label] ?? label : ""}
        </p>
        {payload.map((p, i) => (
          <p key={i} className="text-sm text-gray-900 font-medium">
            {p.name === "total" ? currency(p.value) : t("dashboard.txCount", { count: p.value })}
          </p>
        ))}
      </div>
    );
  }

  const bots = useApi<Bot[]>((token) => getBots(token));
  const txs = useApi<PaginatedResult<Transaction>>((token) =>
    getTransactions({ limit: 100 }, token)
  );
  const trends = useApi<SpendingTrend[]>((token) => getSpendingTrends(token));
  const categories = useApi<CategoryBreakdown[]>((token) => getByCategory(token));
  const decisions = useApi<DecisionBreakdown[]>((token) => getDecisions(token));
  const botSpending = useApi<BotBreakdown[]>((token) => getByBot(token));

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

  const suspiciousAlerts = allBots
    .filter((b) => b.totalBlocked > 3)
    .map((b) => ({
      id: b.id,
      name: b.name,
      message: t("dashboard.blockedTx", { count: b.totalBlocked, score: b.trustScore }),
    }));

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
        message: t("dashboard.nearLimit", { pct: pct.toFixed(0) }),
      };
    })
    .filter((a) => a.pct >= 70);

  const decisionsData = (decisions.data ?? []).map((d) => ({
    ...d,
    label: decisionLabels[d.decision] ?? d.decision,
    fill: DECISION_COLORS[d.decision] ?? "#6b7280",
  }));

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h2 className="text-2xl font-display font-bold text-gray-900">{t("dashboard.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("dashboard.subtitle")}</p>
      </div>

      {/* SnifferShop CTA — only when user has no bots */}
      {allBots.length === 0 && (
        <a
          href="https://sniffershop.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-8 flex items-center gap-4 rounded-xl border border-brand-500/20 bg-gradient-to-r from-brand-600/10 to-orange-500/10 p-5 transition-all hover:border-brand-500/40 hover:shadow-lg"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-2xl">
            🐕
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">
              {t("dashboard.snifferCtaTitle")}
            </h3>
            <p className="mt-0.5 text-sm text-gray-500">
              {t("dashboard.snifferCtaDesc")}
            </p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </a>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
        <StatCard
          label={t("dashboard.activeBots")}
          value={activeBots}
          color="text-brand-400"
        />
        <StatCard
          label={t("dashboard.monthlySpend")}
          value={currency(monthlySpend)}
          color="text-approved"
        />
        <StatCard
          label={t("dashboard.pendingApprovals")}
          value={pendingCount}
          color="text-pending"
        />
        <StatCard
          label={t("dashboard.blockedToday")}
          value={blockedToday}
          color="text-blocked"
        />
      </div>

      {/* Row 1: Spending Trends (full width) */}
      <div className="mb-6">
        <ChartCard title={t("dashboard.spendingTrend")}>
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
                    <stop offset="5%" stopColor="#0066FF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0066FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#21262D"
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
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip content={<SpendingTooltip />} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#0066FF"
                  strokeWidth={2}
                  fill="url(#spendGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: Category (pie) + Decisions (bar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        <ChartCard title={t("dashboard.byCategory")}>
          {categories.loading ? (
            <ChartSkeleton height={280} />
          ) : categories.error ? (
            <p className="text-sm text-blocked">{categories.error}</p>
          ) : !categories.data?.length ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {t("dashboard.noCategoryData")}
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
                        <div className="bg-gray-50border border-gray-200 rounded-lg px-3 py-2 shadow-lg">
                          <p className="text-xs text-gray-400">{String(item.name)}</p>
                          <p className="text-sm text-gray-900 font-medium">{currency(Number(item.value))}</p>
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

        <ChartCard title={t("dashboard.decisionsChart")}>
          {decisions.loading ? (
            <ChartSkeleton height={280} />
          ) : decisions.error ? (
            <p className="text-sm text-blocked">{decisions.error}</p>
          ) : !decisionsData.length ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {t("dashboard.noDecisionData")}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={decisionsData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#21262D"
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
                    value === "count" ? t("dashboard.quantity") : `${t("transactions.amount")} ($)`
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
        <ChartCard title={t("dashboard.byBot")}>
          {botSpending.loading ? (
            <ChartSkeleton height={280} />
          ) : botSpending.error ? (
            <p className="text-sm text-blocked">{botSpending.error}</p>
          ) : !botSpending.data?.length ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {t("dashboard.noBotData")}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={botSpending.data}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#21262D"
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
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip content={<BotTooltip />} />
                <Bar
                  dataKey="total"
                  fill="#0047FF"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={60}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white border border-gray-200 rounded-xl mb-6">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-300">
            {t("dashboard.recentTx")}
          </h3>
        </div>
        {recentTxs.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {t("dashboard.noTx")}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {recentTxs.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
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
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="text-sm font-display font-semibold text-gray-300">
              {t("dashboard.alerts")}
            </h3>
          </div>
          <div className="divide-y divide-gray-200">
            {suspiciousAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 px-5 py-3.5 border-l-2 border-l-blocked"
              >
                <svg className="w-4 h-4 text-blocked shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-gray-300">
                  <span className="text-gray-900 font-medium">{a.name}</span> — {a.message}
                </p>
              </div>
            ))}
            {nearLimitAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 px-5 py-3.5 border-l-2 border-l-pending"
              >
                <svg className="w-4 h-4 text-pending shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-300">
                  <span className="text-gray-900 font-medium">{a.name}</span> {a.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
