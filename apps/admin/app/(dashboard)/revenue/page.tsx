"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import StatCard from "@/components/stat-card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function RevenuePage() {
  const [overview, setOverview] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("/admin/revenue/overview"),
      api("/admin/revenue/chart?period=12m"),
      api("/admin/revenue/transactions"),
    ]).then(([ov, ch, tx]) => {
      setOverview(ov);
      setChart(ch.data || []);
      setTransactions(tx.transactions || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[#64748B] p-4">Loading...</div>;
  if (!overview) return <div className="text-[#EF4444] p-4">Failed to load</div>;

  return (
    <div className="space-y-5 md:space-y-8">
      <h1 className="text-xl md:text-2xl font-bold">Revenue</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="MRR" value={`$${overview.mrr}`} color="#10B981" />
        <StatCard label="ARR" value={`$${overview.arr}`} color="#10B981" />
        <StatCard label="Premium" value={overview.premiumUsers} color="#4A9EFF" />
        <StatCard label="Volume" value={`$${overview.volumeThisMonth?.toFixed(2) || 0}`} color="#F59E0B" />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold mb-4">Revenue & Users (12m)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748B" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#64748B" }} width={35} />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} dot={false} name="Revenue ($)" />
            <Line type="monotone" dataKey="users" stroke="#4A9EFF" strokeWidth={2} dot={false} name="New Users" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Transactions */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold mb-4">Recent Transactions</h2>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                <th className="text-left py-2 text-[#64748B]">Date</th>
                <th className="text-left py-2 text-[#64748B]">User</th>
                <th className="text-left py-2 text-[#64748B]">Package</th>
                <th className="text-left py-2 text-[#64748B]">Amount</th>
                <th className="text-left py-2 text-[#64748B]">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-[#64748B]">No transactions yet</td></tr>
              ) : (
                transactions.map((t: any) => (
                  <tr key={t.id} className="border-b border-[#F1F5F9]">
                    <td className="py-2">{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td className="py-2">{t.userId?.slice(0, 8)}...</td>
                    <td className="py-2">{t.packageId}</td>
                    <td className="py-2">${t.amountUsd}</td>
                    <td className="py-2">{t.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <div className="md:hidden space-y-2">
          {transactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#64748B]">No transactions yet</p>
          ) : (
            transactions.map((t: any) => (
              <div key={t.id} className="flex justify-between items-center py-2.5 border-b border-[#F1F5F9] text-sm">
                <div>
                  <p className="font-medium">${t.amountUsd}</p>
                  <p className="text-xs text-[#94A3B8]">{t.packageId} · {t.status}</p>
                </div>
                <span className="text-xs text-[#94A3B8]">{new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
