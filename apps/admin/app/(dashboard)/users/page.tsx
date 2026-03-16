"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Badge from "@/components/badge";

interface User {
  id: string;
  fullName: string;
  email: string;
  platform: string;
  planType: string;
  messagesRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchUsers = (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (plan) params.set("plan", plan);

    api(`/admin/users?${params}`).then((data) => {
      setUsers(data.users);
      setPagination(data.pagination);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(1);
  };

  const exportCSV = () => {
    const headers = "Name,Email,Platform,Plan,Messages Remaining,Joined\n";
    const rows = users.map((u) =>
      `"${u.fullName}","${u.email}","${u.platform}","${u.planType}",${u.messagesRemaining},"${u.createdAt}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payjarvis-users.csv";
    a.click();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Users</h1>
        <button onClick={exportCSV} className="px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg hover:bg-[#F1F5F9]">
          Export CSV
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4A9EFF]"
        />
        <div className="flex gap-2">
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm"
          >
            <option value="">All Plans</option>
            <option value="free">Free</option>
            <option value="premium">Premium</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-[#4A9EFF] text-white rounded-lg text-sm font-medium">
            Search
          </button>
        </div>
      </form>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Name</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Email</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Platform</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Msgs Left</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-[#64748B]">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-[#64748B]">No users found</td></tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => router.push(`/users/${u.id}`)}
                  className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{u.fullName}</td>
                  <td className="px-4 py-3 text-[#64748B]">{u.email}</td>
                  <td className="px-4 py-3"><Badge text={u.platform} /></td>
                  <td className="px-4 py-3"><Badge text={u.planType} /></td>
                  <td className="px-4 py-3">{u.messagesRemaining}</td>
                  <td className="px-4 py-3 text-[#64748B]">{new Date(u.createdAt).toLocaleDateString()}</td>
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
        ) : users.length === 0 ? (
          <p className="text-center py-8 text-[#64748B]">No users found</p>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              onClick={() => router.push(`/users/${u.id}`)}
              className="bg-white rounded-xl border border-[#E2E8F0] p-4 active:bg-[#F8FAFC] cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{u.fullName}</span>
                <div className="flex gap-1.5">
                  <Badge text={u.platform} />
                  <Badge text={u.planType} />
                </div>
              </div>
              <p className="text-xs text-[#64748B] truncate">{u.email}</p>
              <div className="flex justify-between mt-2 text-xs text-[#94A3B8]">
                <span>{u.messagesRemaining} msgs left</span>
                <span>{new Date(u.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs md:text-sm text-[#64748B]">
        <span>{pagination.total} users</span>
        <div className="flex gap-2">
          <button
            disabled={pagination.page <= 1}
            onClick={() => fetchUsers(pagination.page - 1)}
            className="px-3 py-1 border border-[#E2E8F0] rounded disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-2 py-1">{pagination.page}/{pagination.pages}</span>
          <button
            disabled={pagination.page >= pagination.pages}
            onClick={() => fetchUsers(pagination.page + 1)}
            className="px-3 py-1 border border-[#E2E8F0] rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
