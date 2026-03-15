"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface StoreInfo {
  store: string;
  label: string;
  url: string;
  icon: string;
}

interface ConnectedStore {
  store: string;
  storeLabel: string;
  storeUrl: string;
  status: string;
  authenticatedAt: string | null;
  lastUsedAt: string;
  botPermissions: Array<{
    botId: string;
    botName: string;
    enabled: boolean;
    maxPerTransaction: number;
    maxPerDay: number;
    maxPerMonth: number;
    autoApproveBelow: number;
    allowedCategories: string[];
  }>;
}

const AVAILABLE_STORES: StoreInfo[] = [
  { store: "amazon", label: "Amazon", url: "https://www.amazon.com", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" },
  { store: "walmart", label: "Walmart", url: "https://www.walmart.com", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { store: "target", label: "Target", url: "https://www.target.com", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
  { store: "bestbuy", label: "Best Buy", url: "https://www.bestbuy.com", icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { store: "ebay", label: "eBay", url: "https://www.ebay.com", icon: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" },
  { store: "costco", label: "Costco", url: "https://www.costco.com", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { store: "homedepot", label: "Home Depot", url: "https://www.homedepot.com", icon: "M11.42 15.17l-5.658-3.26-.013-.008a6.714 6.714 0 01-2.75-5.36c0-3.72 3.015-6.735 6.735-6.735 1.955 0 3.716.835 4.95 2.164A6.698 6.698 0 0119.635.207c3.72 0 6.735 3.016 6.735 6.736 0 2.064-.88 3.924-2.282 5.22l-.013.011-5.656 3.26" },
  { store: "instacart", label: "Instacart", url: "https://www.instacart.com", icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" },
];

function StatusBadge({ status }: { status: string }) {
  const colors = {
    configured: "bg-green-100 text-green-700 border-green-200",
    authenticated: "bg-green-100 text-green-700 border-green-200",
    pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
    expired: "bg-red-100 text-red-700 border-red-200",
  };
  const labels = {
    configured: "Connected",
    authenticated: "Connected",
    pending: "Pending",
    expired: "Expired",
  };
  const cls = colors[status as keyof typeof colors] ?? colors.pending;
  const label = labels[status as keyof typeof labels] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {(status === "configured" || status === "authenticated") && (
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {label}
    </span>
  );
}

export default function StoresPage() {
  const { getToken } = useAuth();
  const [connected, setConnected] = useState<ConnectedStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/stores`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const errJson = JSON.parse(text);
          msg = errJson.error || errJson.message || msg;
        } catch {
          if (text) msg = text;
        }
        setError(msg);
        return;
      }
      const json = await res.json();
      if (json.success) {
        setConnected(json.data.stores);
      } else {
        setError(json.error || "Failed to load stores");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const handleConnect = async (store: StoreInfo) => {
    setConnecting(store.store);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/stores/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          store: store.store,
          storeUrl: store.url,
          storeLabel: store.label,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error);
        setConnecting(null);
        return;
      }

      setJustConnected(store.store);
      await loadStores();
      setTimeout(() => setJustConnected(null), 8000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (store: string) => {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/stores/${store}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      loadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const connectedStoreKeys = new Set(connected.map((s) => s.store));
  const available = AVAILABLE_STORES.filter((s) => !connectedStoreKeys.has(s.store));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold text-gray-900">Connected Stores</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect your store accounts so your bots can search and shop on your behalf.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {justConnected && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-green-800">
                {AVAILABLE_STORES.find(s => s.store === justConnected)?.label} configured!
              </p>
              <p className="text-sm text-green-700 mt-1">
                When your bot finds a product, it will send a direct link on Telegram
                so you can add it to your cart with one click.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Connected Stores */}
      {connected.length > 0 && (
        <div className="mb-10">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Your Stores</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {connected.map((store) => {
              const info = AVAILABLE_STORES.find((s) => s.store === store.store);
              return (
                <div
                  key={store.store}
                  className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={info?.icon ?? ""} />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{store.storeLabel}</h3>
                        <p className="text-xs text-gray-400">{store.storeUrl}</p>
                      </div>
                    </div>
                    <StatusBadge status={store.status} />
                  </div>

                  <div className="mt-3 p-2.5 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">
                      Your bot will send product links via Telegram for you to add to cart directly.
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
                    <span>
                      {store.botPermissions.length} bot{store.botPermissions.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                    <button
                      onClick={() => handleDisconnect(store.store)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Stores */}
      {available.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Available Stores</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((store) => (
              <div
                key={store.store}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={store.icon} />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{store.label}</h3>
                    <p className="text-xs text-gray-400">{store.url}</p>
                  </div>
                </div>

                <button
                  onClick={() => handleConnect(store)}
                  disabled={connecting === store.store}
                  className="w-full py-2 px-4 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {connecting === store.store ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Connecting...
                    </span>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
