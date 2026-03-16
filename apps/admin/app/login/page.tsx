"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api("/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      router.push("/overview");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Bypass — entra direto sem autenticar (temporário)
  const handleBypass = () => {
    setToken("bypass");
    router.push("/overview");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#0F172A]">PayJarvis Admin</h1>
          <p className="text-sm text-[#64748B] mt-1">12Brain Operations</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] focus:border-transparent"
              placeholder="admin@12brain.org"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] focus:border-transparent"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-[#EF4444] bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#4A9EFF] text-white rounded-lg font-medium text-sm hover:bg-[#3B8AE8] transition-colors disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <button
          onClick={handleBypass}
          className="w-full mt-3 py-2 text-sm text-[#64748B] hover:text-[#0F172A] border border-dashed border-[#E2E8F0] rounded-lg transition-colors"
        >
          Enter without login (bypass)
        </button>
      </div>
    </div>
  );
}
