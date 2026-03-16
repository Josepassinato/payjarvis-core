"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Badge from "@/components/badge";

export default function BroadcastPage() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/admin/broadcasts").then((d) => setBroadcasts(d.broadcasts || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Broadcast</h1>
        <button
          onClick={() => router.push("/broadcast/new")}
          className="px-3 py-1.5 md:px-4 md:py-2 bg-[#4A9EFF] text-white rounded-lg text-xs md:text-sm font-medium"
        >
          + New
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Title</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Audience</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Status</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Recipients</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Delivered</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-[#64748B]">Loading...</td></tr>
            ) : broadcasts.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-[#64748B]">No broadcasts yet</td></tr>
            ) : (
              broadcasts.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => router.push(`/broadcast/${b.id}`)}
                  className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{b.title}</td>
                  <td className="px-4 py-3"><Badge text={b.audience} /></td>
                  <td className="px-4 py-3"><Badge text={b.status} /></td>
                  <td className="px-4 py-3">{b.totalRecipients}</td>
                  <td className="px-4 py-3">{b.delivered}</td>
                  <td className="px-4 py-3 text-[#64748B]">{new Date(b.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <p className="text-center py-8 text-[#64748B]">Loading...</p>
        ) : broadcasts.length === 0 ? (
          <p className="text-center py-8 text-[#64748B]">No broadcasts yet</p>
        ) : (
          broadcasts.map((b) => (
            <div
              key={b.id}
              onClick={() => router.push(`/broadcast/${b.id}`)}
              className="bg-white rounded-xl border border-[#E2E8F0] p-4 active:bg-[#F8FAFC] cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm truncate mr-2">{b.title}</span>
                <Badge text={b.status} />
              </div>
              <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                <div className="flex gap-2">
                  <Badge text={b.audience} />
                  <span>{b.totalRecipients} recipients</span>
                </div>
                <span>{new Date(b.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
