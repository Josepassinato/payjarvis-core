"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface SubscriptionStatus {
  planType: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  messagesRemaining: number;
  unlimited: boolean;
}

interface CreditPackage {
  id: string;
  messages: number;
  priceUsd: number;
  label: string;
}

export default function BillingPage() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const [statusRes, packagesRes] = await Promise.all([
      fetch(`${API_URL}/api/subscription/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_URL}/api/credits/packages`),
    ]);

    if (statusRes.ok) {
      const data = await statusRes.json();
      setStatus(data.data);
    }
    if (packagesRes.ok) {
      const data = await packagesRes.json();
      setPackages(data.data?.packages ?? []);
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubscribe = async () => {
    setActionLoading(true);
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/subscription/create`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (res.ok) {
      await fetchData();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create subscription");
    }
    setActionLoading(false);
  };

  const handleManage = async () => {
    setActionLoading(true);
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/subscription/portal`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.data?.url) {
        window.location.href = data.data.url;
        return;
      }
    }
    alert("Could not open billing portal");
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm("Cancel your subscription? You'll keep access until the end of the billing period.")) return;
    setActionLoading(true);
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/subscription/cancel`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      await fetchData();
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-48 mb-8" />
        <div className="h-48 bg-gray-200 rounded-xl mb-6" />
        <div className="h-32 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  const isPremium = status?.planType === "premium" && status?.subscriptionStatus === "active";
  const isPastDue = status?.subscriptionStatus === "past_due";

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-8">Billing</h1>

      {/* Current Plan */}
      <div className={`rounded-xl border p-6 mb-6 ${isPremium ? "border-brand-200 bg-brand-50/50" : isPastDue ? "border-red-200 bg-red-50/50" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isPremium ? "Jarvis Premium" : isPastDue ? "Payment Issue" : "Free Plan"}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {isPremium
                ? "Unlimited messages — all features"
                : isPastDue
                ? "Update your payment method to continue"
                : `${status?.messagesRemaining?.toLocaleString() ?? 0} messages remaining`}
            </p>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            isPremium ? "bg-brand-100 text-brand-700" : isPastDue ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
          }`}>
            {isPremium ? "Active" : isPastDue ? "Past Due" : "Free"}
          </div>
        </div>

        {status?.subscriptionEndsAt && (
          <p className="text-xs text-gray-400 mb-4">
            {status.subscriptionStatus === "active"
              ? `Renews ${new Date(status.subscriptionEndsAt).toLocaleDateString()}`
              : `Access until ${new Date(status.subscriptionEndsAt).toLocaleDateString()}`}
          </p>
        )}

        <div className="flex gap-3">
          {isPremium ? (
            <>
              <button
                onClick={handleManage}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Manage Subscription
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : isPastDue ? (
            <button
              onClick={handleManage}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              Update Payment Method
            </button>
          ) : null}
        </div>
      </div>

      {/* Upgrade Card — shown only for free users */}
      {!isPremium && !isPastDue && (
        <div className="rounded-xl border-2 border-brand-300 bg-gradient-to-br from-brand-50 to-white p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Jarvis Premium</h2>
              <p className="text-sm text-gray-600 mt-1 mb-4">
                Unlimited messages. Priority support. All features unlocked.
              </p>
              <ul className="space-y-2 text-sm text-gray-600 mb-6">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  WhatsApp unlimited
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Phone calls with Jarvis
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Shopping, travel, health, finance
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Priority support
                </li>
              </ul>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-gray-900">R$30</p>
              <p className="text-sm text-gray-500">/month</p>
            </div>
          </div>
          <button
            onClick={handleSubscribe}
            disabled={actionLoading}
            className="w-full py-3 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {actionLoading ? "Processing..." : "Upgrade to Premium"}
          </button>
        </div>
      )}

      {/* Free Channels — always shown for non-premium */}
      {!isPremium && (
        <div className="rounded-xl border border-green-200 bg-green-50/50 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Free Forever</h2>
          <p className="text-sm text-gray-600 mb-4">Use Jarvis for free on these channels — no limits, no credit card</p>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="https://t.me/Jarvis12Brain_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 border border-green-200 rounded-lg p-4 hover:border-green-400 transition-colors bg-white"
            >
              <span className="text-2xl">&#x1F4AC;</span>
              <div>
                <p className="font-semibold text-gray-900">Telegram</p>
                <p className="text-xs text-gray-500">Unlimited, all features</p>
              </div>
            </a>
            <a
              href="/chat"
              className="flex items-center gap-3 border border-green-200 rounded-lg p-4 hover:border-green-400 transition-colors bg-white"
            >
              <span className="text-2xl">&#x1F4F1;</span>
              <div>
                <p className="font-semibold text-gray-900">App (PWA)</p>
                <p className="text-xs text-gray-500">Voice chat, install as app</p>
              </div>
            </a>
          </div>
        </div>
      )}

      {/* Message Packs — shown for free users */}
      {!isPremium && packages.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Message Packs</h2>
          <p className="text-sm text-gray-500 mb-4">One-time purchase — no subscription required</p>
          <div className="grid grid-cols-2 gap-3">
            {packages.map((pkg) => (
              <div key={pkg.id} className="border border-gray-200 rounded-lg p-4 text-center hover:border-brand-300 transition-colors">
                <p className="text-2xl font-bold text-gray-900">{(pkg.messages / 1000).toFixed(0)}k</p>
                <p className="text-xs text-gray-500 mb-2">messages</p>
                <p className="text-lg font-semibold text-brand-600">${pkg.priceUsd}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
