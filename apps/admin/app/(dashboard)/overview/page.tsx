"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import StatCard from "@/components/stat-card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function OverviewPage() {
  const [data, setData] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("/admin/overview"),
      api("/admin/revenue/chart?period=12m"),
    ]).then(([overview, chartData]) => {
      setData(overview);
      setChart(chartData.data || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[#64748B] p-4">Loading...</div>;
  if (!data) return <div className="text-[#EF4444] p-4">Failed to load data</div>;

  return (
    <div className="space-y-5 md:space-y-8">
      <h1 className="text-xl md:text-2xl font-bold">Overview</h1>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Total Users" value={data.users.total} sub={`+${data.users.newToday} today`} />
        <StatCard label="Active (7d)" value={data.users.active7d} color="#10B981" />
        <StatCard label="MRR" value={`$${data.revenue.mrr}`} color="#10B981" sub={`ARR $${data.revenue.arr}`} />
        <StatCard label="Purchases" value={data.engagement.purchasesThisMonth} color="#F59E0B" />
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold mb-4">Revenue (12 months)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748B" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#64748B" }} width={35} />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#4A9EFF" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="users" stroke="#10B981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Platform & Engagement */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base md:text-lg font-semibold mb-3">Platform</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">Telegram</span>
              <span className="font-medium">{data.users.byPlatform.telegram}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">WhatsApp</span>
              <span className="font-medium">{data.users.byPlatform.whatsapp}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">Paying</span>
              <span className="font-medium">{data.users.paying}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">Free</span>
              <span className="font-medium">{data.users.free}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base md:text-lg font-semibold mb-3">Engagement</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">Msgs Today</span>
              <span className="font-medium">{data.engagement.messagesToday}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">Msgs This Week</span>
              <span className="font-medium">{data.engagement.messagesThisWeek}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#64748B]">Avg Msgs/User</span>
              <span className="font-medium">{data.credits.avgMessagesPerUser}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sequence Stats */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold mb-3">Onboarding Sequence</h2>
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 md:gap-4">
          {Object.entries(data.sequence.byStep as Record<string, number>).map(([step, count]) => (
            <div key={step} className="bg-[#F8FAFC] rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-center">
              <p className="text-[10px] md:text-xs text-[#64748B]">Step {step}</p>
              <p className="text-base md:text-lg font-bold text-[#0F172A]">{count}</p>
            </div>
          ))}
          <div className="bg-[#F8FAFC] rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-center">
            <p className="text-[10px] md:text-xs text-[#64748B]">Paused</p>
            <p className="text-base md:text-lg font-bold text-[#F59E0B]">{data.sequence.paused}</p>
          </div>
          <div className="bg-[#F8FAFC] rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-center">
            <p className="text-[10px] md:text-xs text-[#64748B]">Done</p>
            <p className="text-base md:text-lg font-bold text-[#10B981]">{data.sequence.completed}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
