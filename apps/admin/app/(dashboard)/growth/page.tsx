"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface GrowthData {
  signups: { total: number; today: number; week: number; month: number };
  trials: { active: number; expired: number; conversionRate: number };
  plans: { free: number; trial: number; premium: number };
  channels: { telegram: number; whatsapp: number; pwa: number };
  referrals: { total: number; topReferrers: { fullName: string; referralCount: number }[] };
}

interface DailySignup {
  date: string;
  count: number;
}

interface FunnelStage {
  stage: string;
  count: number;
}

export default function GrowthPage() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [daily, setDaily] = useState<DailySignup[]>([]);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("/admin/growth/overview").then((r) => setData(r.data)),
      api("/admin/growth/daily-signups?days=30").then((r) => setDaily(r.data)),
      api("/admin/growth/trial-funnel").then((r) => setFunnel(r.data.funnel)),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-100 rounded w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) return <p className="text-gray-500">Failed to load growth data.</p>;

  const maxDaily = Math.max(...daily.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#0F172A]">Growth Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Users" value={data.signups.total} />
        <Card label="Today" value={data.signups.today} color="green" />
        <Card label="This Week" value={data.signups.week} color="blue" />
        <Card label="This Month" value={data.signups.month} color="purple" />
      </div>

      {/* Plans Breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <Card label="Free (Telegram/PWA)" value={data.plans.free} color="gray" />
        <Card label="Trial (WhatsApp)" value={data.plans.trial} color="yellow" />
        <Card label="Premium (R$30/mo)" value={data.plans.premium} color="green" />
      </div>

      {/* Channel Breakdown */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Channels</h2>
        <div className="grid grid-cols-3 gap-4">
          <ChannelBar label="Telegram" count={data.channels.telegram} total={data.signups.total} color="#0088cc" />
          <ChannelBar label="WhatsApp" count={data.channels.whatsapp} total={data.signups.total} color="#25D366" />
          <ChannelBar label="PWA Only" count={data.channels.pwa} total={data.signups.total} color="#6366f1" />
        </div>
      </div>

      {/* Trial Funnel */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Trial Funnel</h2>
        <div className="space-y-3">
          {funnel.map((stage, i) => {
            const maxCount = Math.max(...funnel.map((f) => f.count), 1);
            const width = Math.max((stage.count / maxCount) * 100, 4);
            return (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-[#64748B]">{stage.stage}</span>
                  <span className="font-semibold text-[#0F172A]">{stage.count}</span>
                </div>
                <div className="h-6 bg-[#F1F5F9] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-[#64748B]">
          Conversion Rate: <span className="font-bold text-[#0F172A]">{data.trials.conversionRate}%</span>
        </p>
      </div>

      {/* Daily Signups Chart */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Daily Signups (30 days)</h2>
        <div className="flex items-end gap-1 h-32">
          {daily.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-blue-400 rounded-t hover:bg-blue-500 transition-colors"
                style={{ height: `${Math.max((d.count / maxDaily) * 100, 2)}%` }}
                title={`${d.date}: ${d.count} signups`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-[#94A3B8] mt-1">
          <span>{daily[0]?.date?.slice(5) || ""}</span>
          <span>{daily[daily.length - 1]?.date?.slice(5) || ""}</span>
        </div>
      </div>

      {/* Top Referrers */}
      {data.referrals.topReferrers.length > 0 && (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Top Referrers ({data.referrals.total} total referrals)
          </h2>
          <div className="space-y-2">
            {data.referrals.topReferrers.map((r, i) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <span className="text-[#334155]">{r.fullName}</span>
                <span className="font-semibold text-[#0F172A]">{r.referralCount} referrals</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color = "blue" }: { label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    blue: "text-blue-600",
    green: "text-green-600",
    purple: "text-purple-600",
    yellow: "text-amber-600",
    gray: "text-gray-600",
  };
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
      <p className="text-xs text-[#64748B] mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors[color] || colors.blue}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function ChannelBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[#64748B]">{label}</span>
        <span className="font-semibold">{count} ({pct}%)</span>
      </div>
      <div className="h-3 bg-[#F1F5F9] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
