"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import StatCard from "@/components/stat-card";
// Badge uses text prop: <Badge text="free" />
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface SnifferMetrics {
  users: { total: number; free: number; pro: number; business: number; newToday: number; newWeek: number };
  revenue: { mrr: number; arr: number; today: number; month: number };
  usage: { searchesToday: number; purchasesToday: number; avgSearchesPerUser: number };
  churn: { rate: number; churned30d: number };
  channels: { whatsapp: number; telegram: number; pwa: number };
}

interface DailyMetric {
  date: string;
  signups: number;
  revenue: number;
  searches: number;
}

interface PlanBreakdown {
  plan: string;
  count: number;
  revenue: number;
}

const PLAN_COLORS: Record<string, string> = {
  free: "#94A3B8",
  pro: "#F59E0B",
  business: "#4A9EFF",
};

export default function SnifferShopPage() {
  const [metrics, setMetrics] = useState<SnifferMetrics | null>(null);
  const [daily, setDaily] = useState<DailyMetric[]>([]);
  const [plans, setPlans] = useState<PlanBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api("/admin/sniffershop/overview").then((r) => setMetrics(r.data)),
      api(`/admin/sniffershop/daily?period=${period}`).then((r) => setDaily(r.data)),
      api("/admin/sniffershop/plans").then((r) => setPlans(r.data)),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-100 rounded w-56" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!metrics) return <p className="text-[#64748B]">Failed to load SnifferShop data.</p>;

  const planData = plans.map((p) => ({
    ...p,
    fill: PLAN_COLORS[p.plan] || "#94A3B8",
  }));

  return (
    <div className="space-y-5 md:space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[#0F172A]">
            🐕 SnifferShop
          </h1>
          <p className="text-xs md:text-sm text-[#64748B] mt-0.5">B2C AI Shopping Agent</p>
        </div>
        <a
          href="https://sniffershop.com"
          target="_blank"
          rel="noopener"
          className="px-3 py-1.5 bg-[#F59E0B] text-white rounded-lg text-xs font-medium hover:bg-[#D97706] transition-colors"
        >
          Ver Site →
        </a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Usuarios Total"
          value={metrics.users.total.toLocaleString()}
          sub={`+${metrics.users.newToday} hoje`}
          color="#4A9EFF"
        />
        <StatCard
          label="MRR"
          value={`R$ ${metrics.revenue.mrr.toFixed(2)}`}
          sub={`ARR: R$ ${metrics.revenue.arr.toFixed(2)}`}
          color="#10B981"
        />
        <StatCard
          label="Buscas Hoje"
          value={metrics.usage.searchesToday.toLocaleString()}
          sub={`${metrics.usage.avgSearchesPerUser.toFixed(1)} por usuario`}
          color="#F59E0B"
        />
        <StatCard
          label="Churn Rate"
          value={`${metrics.churn.rate.toFixed(1)}%`}
          sub={`${metrics.churn.churned30d} cancelaram (30d)`}
          color={metrics.churn.rate > 5 ? "#EF4444" : "#10B981"}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Free" value={metrics.users.free.toLocaleString()} color="#94A3B8" />
        <StatCard label="Pro (R$29,90)" value={metrics.users.pro.toLocaleString()} color="#F59E0B" />
        <StatCard label="Business (R$79,90)" value={metrics.users.business.toLocaleString()} color="#4A9EFF" />
        <StatCard
          label="Compras Hoje"
          value={metrics.usage.purchasesToday.toLocaleString()}
          color="#10B981"
        />
      </div>

      {/* Period selector + Charts */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[#0F172A]">
            Metricas Diarias
          </h2>
          <div className="flex gap-1">
            {(["7d", "30d", "90d"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-[#4A9EFF] text-white"
                    : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#94A3B8" }}
              tickFormatter={(d) => d.slice(5)}
            />
            <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} />
            <Tooltip
              contentStyle={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Line
              type="monotone"
              dataKey="signups"
              stroke="#4A9EFF"
              strokeWidth={2}
              dot={false}
              name="Novos usuarios"
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#10B981"
              strokeWidth={2}
              dot={false}
              name="Receita (R$)"
            />
            <Line
              type="monotone"
              dataKey="searches"
              stroke="#F59E0B"
              strokeWidth={2}
              dot={false}
              name="Buscas"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Plan distribution + Channel breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Plan pie chart */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base font-semibold text-[#0F172A] mb-4">
            Distribuicao de Planos
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={planData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="count"
                nameKey="plan"
              >
                {planData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  `${value} usuarios`,
                  String(name).charAt(0).toUpperCase() + String(name).slice(1),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {planData.map((p) => (
              <div key={p.plan} className="flex items-center gap-1.5 text-xs text-[#64748B]">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: p.fill }}
                />
                {p.plan} ({p.count})
              </div>
            ))}
          </div>
        </div>

        {/* Channel breakdown */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base font-semibold text-[#0F172A] mb-4">
            Canais
          </h2>
          <div className="space-y-4">
            {[
              { label: "WhatsApp", value: metrics.channels.whatsapp, color: "#25D366", icon: "💬" },
              { label: "Telegram", value: metrics.channels.telegram, color: "#2AABEE", icon: "📱" },
              { label: "PWA / Web", value: metrics.channels.pwa, color: "#F59E0B", icon: "🌐" },
            ].map((ch) => {
              const total = metrics.channels.whatsapp + metrics.channels.telegram + metrics.channels.pwa;
              const pct = total > 0 ? (ch.value / total) * 100 : 0;
              return (
                <div key={ch.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[#0F172A] font-medium">
                      {ch.icon} {ch.label}
                    </span>
                    <span className="text-sm text-[#64748B]">
                      {ch.value} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: ch.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-[#F1F5F9]">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Receita por Plano</h3>
            <div className="space-y-2">
              {plans.map((p) => (
                <div key={p.plan} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.plan === "free" ? "bg-gray-100 text-gray-600" :
                      p.plan === "pro" ? "bg-yellow-100 text-yellow-700" :
                      "bg-blue-100 text-blue-700"
                    }`}>{p.plan}</span>
                    <span className="text-[#64748B]">{p.count} usuarios</span>
                  </div>
                  <span className="font-semibold text-[#0F172A]">
                    R$ {p.revenue.toFixed(2)}/mes
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
