"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ReferralLanding() {
  const params = useParams();
  const code = (params.code as string) || "";
  const [referrerName, setReferrerName] = useState("A friend");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) return;
    fetch(`${API_URL}/referrals/resolve/${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setReferrerName(d.data.referrerName);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="hero-mesh fixed inset-0 pointer-events-none" />
      <div className="relative max-w-md w-full animate-fade-in">
        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl shadow-black/10 overflow-hidden">
          {/* Header gradient */}
          <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-8 py-10 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm mb-4">
              <span className="text-3xl">🦀</span>
            </div>
            <h1 className="text-2xl font-display font-bold text-white">
              {loading ? "..." : `${referrerName} invited you!`}
            </h1>
            <p className="text-white/80 mt-2 text-sm font-body">
              Meet Jarvis — your AI shopping assistant
            </p>
          </div>

          {/* Features */}
          <div className="px-8 py-6 space-y-3">
            {[
              { icon: "🔍", text: "Finds the best prices across 50+ stores" },
              { icon: "📊", text: "Compares products and tracks price drops" },
              { icon: "🛒", text: "Shops and checks out for you autonomously" },
              { icon: "🎤", text: "Voice and text — works like a real assistant" },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-3">
                <span className="text-lg flex-shrink-0">{f.icon}</span>
                <span className="text-gray-700 text-sm">{f.text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="px-8 pb-8 space-y-3">
            <a
              href={`/sign-up?ref=${code}`}
              className="block w-full text-center rounded-xl bg-brand-600 px-6 py-4 font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-200 hover:bg-brand-500 hover:scale-[1.02]"
            >
              Start Free
            </a>
            <p className="text-center text-xs text-gray-400">
              Already have an account?{" "}
              <a href="/sign-in" className="text-brand-500 font-medium hover:text-brand-400">
                Sign in
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Free forever. No credit card required.
        </p>
      </div>
    </main>
  );
}
