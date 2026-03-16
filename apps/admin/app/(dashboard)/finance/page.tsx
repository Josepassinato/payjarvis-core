"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ── Helpers ──────────────────────────────────────────────────────────
function fmt(n: number | undefined | null): string {
  if (n == null) return "$0.00";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n: number | undefined | null): string {
  if (n == null) return "0";
  return n.toLocaleString("en-US");
}

function fmtPct(n: number | undefined | null): string {
  if (n == null) return "0%";
  return n.toFixed(1) + "%";
}

function marginColor(margin: number): string {
  if (margin > 60) return "#10B981";
  if (margin > 40) return "#F59E0B";
  return "#EF4444";
}

function severityColor(severity: string): { bg: string; text: string } {
  switch (severity) {
    case "critical":
      return { bg: "bg-red-100", text: "text-[#EF4444]" };
    case "warning":
      return { bg: "bg-yellow-100", text: "text-[#F59E0B]" };
    default:
      return { bg: "bg-blue-100", text: "text-[#4A9EFF]" };
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  LLM: "#8B5CF6",
  VPS: "#4A9EFF",
  Stripe: "#6366F1",
  Twilio: "#F59E0B",
  Browserbase: "#10B981",
};

// ── Skeleton ─────────────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-[#E2E8F0] rounded ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-7 w-28" />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function FinancePage() {
  const [overview, setOverview] = useState<any>(null);
  const [revenueChart, setRevenueChart] = useState<any[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [llm, setLlm] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [chartPeriod, setChartPeriod] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch chart data independently so period changes don't reload everything
  const fetchChart = useCallback(async (period: string) => {
    try {
      const [rev, costs] = await Promise.all([
        api<any>(`/admin/cfo/chart/revenue?period=${period}`),
        api<any>(`/admin/cfo/chart/costs?period=${period}`),
      ]);
      setRevenueChart(rev?.data || rev || []);
      setCostBreakdown(costs?.categories || costs?.data || []);
    } catch {
      // keep whatever was loaded
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [ov, rev, costs, usr, al, llmData, fc] = await Promise.all([
          api<any>("/admin/cfo/overview").catch(() => null),
          api<any>("/admin/cfo/chart/revenue?period=30d").catch(() => null),
          api<any>("/admin/cfo/chart/costs?period=30d").catch(() => null),
          api<any>("/admin/cfo/users/profitability").catch(() => null),
          api<any>("/admin/cfo/alerts").catch(() => null),
          api<any>("/admin/cfo/llm/optimization").catch(() => null),
          api<any>("/admin/cfo/forecast?days=90").catch(() => null),
        ]);
        setOverview(ov);
        setRevenueChart(rev?.data || rev || []);
        setCostBreakdown(costs?.categories || costs?.data || []);
        setUsers(usr?.users || usr || []);
        setAlerts(al?.alerts || al || []);
        setLlm(llmData);
        setForecast(fc);
      } catch (e: any) {
        setError(e.message || "Failed to load finance data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!loading) fetchChart(chartPeriod);
  }, [chartPeriod, loading, fetchChart]);

  const acknowledgeAlert = async (id: string) => {
    try {
      await api(`/admin/cfo/alerts/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "acknowledged" }),
      });
      setAlerts((prev) => prev.filter((a: any) => a.id !== id));
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !overview) {
    return <div className="text-[#EF4444] p-4">{error}</div>;
  }

  const revenue = overview?.revenue ?? 0;
  const costs = overview?.costs ?? 0;
  const margin = overview?.margin ?? (revenue > 0 ? ((revenue - costs) / revenue) * 100 : 0);
  const mrr = overview?.mrr ?? 0;
  const arr = mrr * 12;
  const activeUsers = overview?.activeUsers ?? 0;
  const newUsers = overview?.newUsers ?? 0;

  return (
    <div className="space-y-6 md:space-y-8">
      {/* ── 1. Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-[#0F172A]">Finance Intelligence</h1>
        <p className="text-sm text-[#64748B] mt-1">CFO Agent — Real-time P&L</p>
      </div>

      {/* ── 2. P&L Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
          <p className="text-sm text-[#64748B] mb-1">Revenue This Month</p>
          <p className="text-2xl font-bold text-[#10B981]">{fmt(revenue)}</p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
          <p className="text-sm text-[#64748B] mb-1">Costs This Month</p>
          <p className="text-2xl font-bold text-[#EF4444]">{fmt(costs)}</p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
          <p className="text-sm text-[#64748B] mb-1">Margin</p>
          <p className="text-2xl font-bold" style={{ color: marginColor(margin) }}>
            {fmtPct(margin)}
          </p>
        </div>
      </div>

      {/* ── 3. MRR / ARR Row ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">MRR</p>
          <p className="text-lg font-semibold text-[#0F172A]">{fmt(mrr)}</p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">ARR</p>
          <p className="text-lg font-semibold text-[#0F172A]">{fmt(arr)}</p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">Active Users</p>
          <p className="text-lg font-semibold text-[#0F172A]">{fmtNum(activeUsers)}</p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">New Users (this month)</p>
          <p className="text-lg font-semibold text-[#0F172A]">{fmtNum(newUsers)}</p>
        </div>
      </div>

      {/* ── 4. Revenue vs Cost Chart ──────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
          <h2 className="text-base md:text-lg font-semibold text-[#0F172A]">Revenue vs Cost</h2>
          <div className="flex gap-2">
            {["30d", "90d", "6m", "12m"].map((p) => (
              <button
                key={p}
                onClick={() => setChartPeriod(p)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  chartPeriod === p
                    ? "bg-[#4A9EFF] text-white"
                    : "bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0] hover:bg-[#E2E8F0]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {revenueChart.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={revenueChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748B" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#64748B" }} width={50} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }}
                formatter={(value: unknown) => fmt(Number(value) || 0)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} dot={false} name="Revenue" />
              <Line type="monotone" dataKey="cost" stroke="#EF4444" strokeWidth={2} dot={false} name="Cost" />
              <Line type="monotone" dataKey="margin" stroke="#4A9EFF" strokeWidth={2} dot={false} name="Margin" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-[#94A3B8] text-center py-12">No chart data available</p>
        )}
      </div>

      {/* ── 5. Cost Breakdown ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold text-[#0F172A] mb-4">Cost Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                <th className="text-left py-2 text-[#64748B] font-medium">Category</th>
                <th className="text-right py-2 text-[#64748B] font-medium">Amount</th>
                <th className="text-right py-2 text-[#64748B] font-medium">% of Total</th>
                <th className="text-right py-2 text-[#64748B] font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {costBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[#94A3B8]">No data</td>
                </tr>
              ) : (
                costBreakdown.map((c: any, i: number) => {
                  const catColor = CATEGORY_COLORS[c.category] || "#64748B";
                  return (
                    <tr key={i} className="border-b border-[#F1F5F9]">
                      <td className="py-2.5">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: catColor }}
                        >
                          {c.category}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#0F172A]">{fmt(c.amount)}</td>
                      <td className="py-2.5 text-right text-[#64748B]">{fmtPct(c.percentage)}</td>
                      <td className="py-2.5 text-right">
                        {c.trend != null ? (
                          <span className={c.trend > 0 ? "text-[#EF4444]" : "text-[#10B981]"}>
                            {c.trend > 0 ? "+" : ""}{c.trend.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[#94A3B8]">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 6. User Profitability ─────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[#0F172A]">User Profitability</h2>
          {users.length > 20 && (
            <span className="text-xs text-[#4A9EFF] cursor-pointer hover:underline">View all</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                <th className="text-left py-2 text-[#64748B] font-medium">User</th>
                <th className="text-right py-2 text-[#64748B] font-medium">Revenue</th>
                <th className="text-right py-2 text-[#64748B] font-medium">Cost</th>
                <th className="text-right py-2 text-[#64748B] font-medium">Profit</th>
                <th className="text-right py-2 text-[#64748B] font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#94A3B8]">No data</td>
                </tr>
              ) : (
                users.slice(0, 20).map((u: any, i: number) => {
                  const profit = (u.revenue ?? 0) - (u.cost ?? 0);
                  const profitable = profit > 0;
                  return (
                    <tr key={i} className="border-b border-[#F1F5F9]">
                      <td className="py-2.5 text-[#0F172A]">
                        {u.name || u.email || u.userId?.slice(0, 12) || `User ${i + 1}`}
                      </td>
                      <td className="py-2.5 text-right text-[#0F172A]">{fmt(u.revenue)}</td>
                      <td className="py-2.5 text-right text-[#0F172A]">{fmt(u.cost)}</td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            profitable ? "bg-green-100 text-[#10B981]" : "bg-red-100 text-[#EF4444]"
                          }`}
                        >
                          {fmt(profit)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#64748B]">
                        {u.roi != null ? fmtPct(u.roi) : u.cost > 0 ? fmtPct((profit / u.cost) * 100) : "--"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 7. Growth Metrics ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">LTV</p>
          <p className="text-lg font-semibold text-[#0F172A]">
            {overview?.ltv != null ? fmt(overview.ltv) : "--"}
          </p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">CAC</p>
          <p className="text-lg font-semibold text-[#0F172A]">
            {overview?.cac != null ? fmt(overview.cac) : "--"}
          </p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">Conversion Rate</p>
          <p className="text-lg font-semibold text-[#0F172A]">
            {overview?.conversionRate != null ? fmtPct(overview.conversionRate) : "--"}
          </p>
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-xs text-[#94A3B8] mb-1">Viral Coefficient</p>
          <p className="text-lg font-semibold text-[#0F172A]">
            {overview?.viralCoefficient != null ? overview.viralCoefficient.toFixed(2) : "--"}
          </p>
        </div>
      </div>

      {/* ── 8. Forecast ───────────────────────────────────────── */}
      {forecast && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
            <p className="text-xs text-[#94A3B8] mb-1">MRR End of Month</p>
            <p className="text-lg font-semibold text-[#0F172A]">
              {forecast.mrrEndOfMonth != null ? fmt(forecast.mrrEndOfMonth) : "--"}
            </p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
            <p className="text-xs text-[#94A3B8] mb-1">Revenue 90 Days</p>
            <p className="text-lg font-semibold text-[#0F172A]">
              {forecast.revenue90d != null ? fmt(forecast.revenue90d) : "--"}
            </p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5">
            <p className="text-xs text-[#94A3B8] mb-1">Growth Rate MoM</p>
            <p className="text-lg font-semibold" style={{ color: (forecast.growthRateMoM ?? 0) >= 0 ? "#10B981" : "#EF4444" }}>
              {forecast.growthRateMoM != null ? (
                <>
                  {forecast.growthRateMoM >= 0 ? "+" : ""}{forecast.growthRateMoM.toFixed(1)}%
                </>
              ) : "--"}
            </p>
          </div>
        </div>
      )}

      {/* ── 9. CFO Alerts ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold text-[#0F172A] mb-4">CFO Alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-[#94A3B8] text-center py-8">No active alerts</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert: any) => {
              const sev = severityColor(alert.severity);
              return (
                <div
                  key={alert.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]"
                >
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${sev.bg} ${sev.text} w-fit`}>
                    {alert.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0F172A]">{alert.title}</p>
                    {alert.description && (
                      <p className="text-xs text-[#64748B] mt-0.5">{alert.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 sm:flex-shrink-0">
                    {alert.createdAt && (
                      <span className="text-xs text-[#94A3B8]">
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </span>
                    )}
                    <button
                      onClick={() => acknowledgeAlert(alert.id)}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-[#4A9EFF] text-white hover:bg-[#3B8FEE] transition-colors"
                    >
                      Acknowledge
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 10. LLM Optimization ──────────────────────────────── */}
      {llm && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base md:text-lg font-semibold text-[#0F172A] mb-4">LLM Optimization</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <p className="text-xs text-[#94A3B8] mb-1">Avg Cost / Message</p>
              <p className="text-lg font-semibold text-[#0F172A]">
                {llm.avgCostPerMessage != null ? fmt(llm.avgCostPerMessage) : "--"}
              </p>
            </div>
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <p className="text-xs text-[#94A3B8] mb-1">Avg Tokens / Message</p>
              <p className="text-lg font-semibold text-[#0F172A]">
                {llm.avgTokensPerMessage != null ? fmtNum(llm.avgTokensPerMessage) : "--"}
              </p>
            </div>
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <p className="text-xs text-[#94A3B8] mb-1">Total LLM Spend (30d)</p>
              <p className="text-lg font-semibold text-[#0F172A]">
                {llm.totalSpend30d != null ? fmt(llm.totalSpend30d) : "--"}
              </p>
            </div>
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <p className="text-xs text-[#94A3B8] mb-1">Cost Trend (WoW)</p>
              <p
                className="text-lg font-semibold"
                style={{
                  color: llm.costTrendPct != null
                    ? llm.costTrendPct <= 0 ? "#10B981" : "#EF4444"
                    : "#0F172A",
                }}
              >
                {llm.costTrendPct != null ? (
                  <>
                    {llm.costTrendPct > 0 ? "\u2191" : "\u2193"} {Math.abs(llm.costTrendPct).toFixed(1)}%
                  </>
                ) : "--"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
