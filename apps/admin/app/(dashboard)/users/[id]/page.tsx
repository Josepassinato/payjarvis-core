"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import StatCard from "@/components/stat-card";
import Badge from "@/components/badge";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api(`/admin/users/${id}`),
      api(`/admin/users/${id}/messages`),
      api(`/admin/users/${id}/transactions`),
    ]).then(([userData, msgData, txData]) => {
      setData(userData);
      setMessages(msgData.messages || []);
      setTransactions(txData);
    }).finally(() => setLoading(false));
  }, [id]);

  const changePlan = async (planType: string) => {
    await api(`/admin/users/${id}/plan`, { method: "PUT", body: JSON.stringify({ planType }) });
    setData((d: any) => ({ ...d, user: { ...d.user, planType } }));
  };

  const addCredits = async () => {
    const amount = prompt("How many messages to add?");
    if (!amount) return;
    await api(`/admin/users/${id}/credits`, { method: "PUT", body: JSON.stringify({ amount: parseInt(amount) }) });
    const refreshed = await api(`/admin/users/${id}`);
    setData(refreshed);
  };

  const deleteUser = async () => {
    if (!confirm("Delete this user permanently? This cannot be undone.")) return;
    await api(`/admin/users/${id}`, { method: "DELETE" });
    router.push("/users");
  };

  if (loading) return <div className="text-[#64748B] p-4">Loading...</div>;
  if (!data) return <div className="text-[#EF4444] p-4">User not found</div>;

  const { user, credit, sequence, stats } = data;
  const platform = user.telegramChatId ? "telegram" : user.notificationChannel || "web";

  return (
    <div className="space-y-4 md:space-y-6">
      <button onClick={() => router.back()} className="text-sm text-[#64748B] hover:text-[#0F172A]">
        &larr; Back
      </button>

      {/* Header — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#4A9EFF]/10 flex items-center justify-center text-lg md:text-xl font-bold text-[#4A9EFF] flex-shrink-0">
            {user.fullName?.charAt(0) || "?"}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-2xl font-bold truncate">{user.fullName}</h1>
            <p className="text-xs md:text-sm text-[#64748B] truncate">{user.email}</p>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap sm:ml-auto">
          <Badge text={platform} />
          <Badge text={user.planType} />
          <Badge text={user.status} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Total Messages" value={credit?.messagesUsed || 0} />
        <StatCard label="Messages Left" value={credit?.messagesRemaining || 0} color="#10B981" />
        <StatCard label="Purchases" value={stats.totalTransactions} />
        <StatCard label="Total Spent" value={`$${stats.totalSpent.toFixed(2)}`} color="#F59E0B" />
      </div>

      {/* Credits Bar */}
      {credit && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base md:text-lg font-semibold mb-3">Credits</h2>
          <div className="w-full bg-[#F1F5F9] rounded-full h-3">
            <div
              className="bg-[#4A9EFF] h-3 rounded-full transition-all"
              style={{ width: `${Math.min(100, ((credit.messagesUsed || 0) / (credit.messagesTotal || 1)) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-[#64748B] mt-2">
            {credit.messagesUsed} / {credit.messagesTotal} used
          </p>
        </div>
      )}

      {/* Sequence */}
      {sequence && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
          <h2 className="text-base md:text-lg font-semibold mb-3">Onboarding Sequence</h2>
          <div className="flex gap-4 flex-wrap">
            <div>
              <p className="text-xs text-[#64748B]">Step</p>
              <p className="text-xl font-bold">{sequence.currentStep}</p>
            </div>
            <div>
              <p className="text-xs text-[#64748B]">Status</p>
              <Badge text={sequence.active ? "active" : "inactive"} />
            </div>
            <div>
              <p className="text-xs text-[#64748B]">Next Send</p>
              <p className="text-sm">{sequence.nextSendAt ? new Date(sequence.nextSendAt).toLocaleString() : "—"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6">
        <h2 className="text-base md:text-lg font-semibold mb-3">Messages ({messages.length})</h2>
        <div className="space-y-2 max-h-60 md:max-h-80 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-[#64748B]">No messages yet</p>
          ) : (
            messages.map((m: any) => (
              <div key={m.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-2 border-b border-[#F1F5F9] text-sm gap-1">
                <span className="text-[#64748B]">{m.platform} · {m.model}</span>
                <div className="flex justify-between sm:gap-4">
                  <span>{m.totalTokens} tokens</span>
                  <span className="text-[#94A3B8] text-xs">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 md:p-6 overflow-x-auto">
        <h2 className="text-base md:text-lg font-semibold mb-3">Transactions</h2>
        <table className="w-full text-sm min-w-[360px]">
          <thead>
            <tr className="border-b border-[#E2E8F0]">
              <th className="text-left py-2 text-[#64748B]">Date</th>
              <th className="text-left py-2 text-[#64748B]">Type</th>
              <th className="text-left py-2 text-[#64748B]">Amount</th>
              <th className="text-left py-2 text-[#64748B]">Status</th>
            </tr>
          </thead>
          <tbody>
            {(transactions?.purchases || []).map((p: any) => (
              <tr key={p.id} className="border-b border-[#F1F5F9]">
                <td className="py-2">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="py-2">Credit Pack</td>
                <td className="py-2">${p.amountUsd}</td>
                <td className="py-2"><Badge text={p.status} /></td>
              </tr>
            ))}
            {(transactions?.transactions || []).slice(0, 20).map((t: any) => (
              <tr key={t.id} className="border-b border-[#F1F5F9]">
                <td className="py-2">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="py-2 truncate max-w-[120px]">{t.merchantName}</td>
                <td className="py-2">${t.amount}</td>
                <td className="py-2"><Badge text={t.decision} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions — stacks on mobile */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <button
          onClick={() => changePlan(user.planType === "premium" ? "free" : "premium")}
          className="px-4 py-2.5 bg-[#4A9EFF] text-white rounded-lg text-sm font-medium"
        >
          {user.planType === "premium" ? "Downgrade to Free" : "Upgrade to Premium"}
        </button>
        <button onClick={addCredits} className="px-4 py-2.5 border border-[#E2E8F0] rounded-lg text-sm">
          Add Credits
        </button>
        <button onClick={deleteUser} className="px-4 py-2.5 bg-[#EF4444] text-white rounded-lg text-sm font-medium">
          Delete User
        </button>
      </div>
    </div>
  );
}
