"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useApi } from "@/lib/use-api";
import { LoadingSpinner, ErrorBox } from "@/components/loading";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

const stripeElementsOptions = {
  appearance: {
    theme: "night" as const,
    variables: {
      colorPrimary: "#2563eb",
      colorBackground: "#1e2330",
      colorText: "#e5e7eb",
      colorDanger: "#ef4444",
      fontFamily: '"DM Sans", system-ui, sans-serif',
      borderRadius: "8px",
    },
  },
};

interface PaymentMethodRecord {
  id: string;
  userId: string;
  provider: string;
  status: "CONNECTED" | "PENDING" | "DISABLED";
  accountId: string | null;
  isDefault: boolean;
  metadata: { keyHint?: string; brand?: string; last4?: string; expMonth?: number; expYear?: number } | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderInfo {
  name: string;
  displayName: string;
  available: boolean;
}

interface PaymentMethodsResponse {
  methods: PaymentMethodRecord[];
  providers: ProviderInfo[];
}

async function fetchPaymentMethods(token: string | null): Promise<PaymentMethodsResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/payment-methods`, { headers });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error ?? "Failed to fetch payment methods");
  return json.data ?? json;
}

/** Inline card form — rendered inside <Elements> */
function CardForm({ onSuccess, onError }: { onSuccess: (card: { brand: string; last4: string; expMonth: number; expYear: number }) => void; onError: (msg: string) => void }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const { getToken } = useAuth();
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);

    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const intentRes = await fetch(`${API_URL}/payment-methods/setup-intent`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const intentJson = await intentRes.json();
      if (!intentRes.ok || !intentJson.success) {
        onError(intentJson.error ?? t("paymentMethods.cardSaveFailed"));
        return;
      }

      const { clientSecret, setupIntentId } = intentJson.data;

      const cardEl = elements.getElement(CardElement);
      if (!cardEl) { onError("Card element not found"); return; }

      const { error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardEl },
      });

      if (stripeError) {
        onError(stripeError.message ?? t("paymentMethods.cardSaveFailed"));
        return;
      }

      const confirmRes = await fetch(`${API_URL}/payment-methods/setup-intent/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ setupIntentId }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok || !confirmJson.success) {
        onError(confirmJson.error ?? t("paymentMethods.cardSaveFailed"));
        return;
      }

      onSuccess(confirmJson.data.card ?? { brand: "card", last4: "****", expMonth: 0, expYear: 0 });
    } catch {
      onError(t("paymentMethods.cardSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="bg-gray-100 border border-gray-200 rounded-lg p-3">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                color: "#e5e7eb",
                "::placeholder": { color: "#6b7280" },
              },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>
      <button
        type="submit"
        disabled={saving || !stripe}
        className="w-full px-4 py-2 text-sm rounded-lg bg-brand-600 text-gray-900 hover:bg-brand-500 transition-colors disabled:opacity-50"
      >
        {saving ? t("paymentMethods.savingCard") : t("paymentMethods.addCard")}
      </button>
    </form>
  );
}

export default function PaymentMethodsPage() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const { data, loading, error, refetch } = useApi<PaymentMethodsResponse>((token) => fetchPaymentMethods(token));
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCardForm, setShowCardForm] = useState(false);

  const PROVIDER_CARDS = [
    {
      id: "stripe",
      name: "Stripe",
      description: t("paymentMethods.stripeDesc"),
      icon: "M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z",
      comingSoon: false,
    },
    {
      id: "paypal",
      name: "PayPal",
      description: t("paymentMethods.paypalDesc"),
      icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      comingSoon: true,
    },
    {
      id: "apple-pay",
      name: "Apple Pay",
      description: t("paymentMethods.applePayDesc"),
      icon: "M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3",
      comingSoon: true,
    },
    {
      id: "google-pay",
      name: "Google Pay",
      description: t("paymentMethods.googlePayDesc"),
      icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 15.75h.008v.008H12v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
      comingSoon: true,
    },
  ];

  const getMethodForProvider = (id: string): PaymentMethodRecord | undefined => {
    const providerKey = id.replace("-", "_").toUpperCase();
    return data?.methods?.find((m) => m.provider === providerKey);
  };

  const isProviderAvailable = (id: string): boolean => {
    const providerKey = id.replace("-", "_").toLowerCase();
    const info = data?.providers?.find((p) => p.name === providerKey);
    return info?.available ?? false;
  };

  const handleDisconnect = async (providerId: string) => {
    setActionLoading(providerId);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_URL}/payment-methods/${providerId}`, {
        method: "DELETE",
        headers,
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error ?? "Failed to disconnect");
      refetch();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  };

  const handleCardSuccess = useCallback(() => {
    setShowCardForm(false);
    setSuccessMessage(t("paymentMethods.cardSaved"));
    setTimeout(() => setSuccessMessage(null), 3000);
    refetch();
  }, [refetch, t]);

  const handleCardError = useCallback((msg: string) => {
    setErrorMessage(msg);
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;

  const stripeMethod = getMethodForProvider("stripe");
  const isStripeConnected = stripeMethod?.status === "CONNECTED";
  const hasCard = isStripeConnected && stripeMethod?.metadata?.last4;

  return (
    <div className="max-w-4xl mx-auto">
      {successMessage && (
        <div className="mb-6 bg-approved/10 border border-approved/20 rounded-xl px-5 py-3 text-sm text-approved">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 bg-blocked/10 border border-blocked/20 rounded-xl px-5 py-3 text-sm text-blocked">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)} className="ml-2 underline text-xs">dismiss</button>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">{t("paymentMethods.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("paymentMethods.subtitle")}</p>
      </div>

      {/* Security notice */}
      <div className="mb-6 bg-emerald-950/30 border border-emerald-800/30 rounded-xl px-5 py-3 flex items-start gap-3">
        <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <p className="text-xs text-emerald-400/80">
          {t("paymentMethods.securityNotice")}{" "}
          <a
            href="https://stripe.com/docs/security"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-400 hover:text-emerald-300"
          >
            {t("paymentMethods.learnMore")}
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        {PROVIDER_CARDS.map((card) => {
          const method = getMethodForProvider(card.id);
          const isConnected = method?.status === "CONNECTED";
          const available = isProviderAvailable(card.id);
          const isLoading = actionLoading === card.id;

          return (
            <div
              key={card.id}
              className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{card.name}</h3>
                      {card.comingSoon && (
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-yellow-500/20 text-yellow-400 rounded-full">
                          {t("common.comingSoon")}
                        </span>
                      )}
                      {!card.comingSoon && isConnected && (
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-approved/20 text-approved rounded-full">
                          {t("paymentMethods.connected")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
                  </div>
                </div>

                {/* Show connected account info */}
                {!card.comingSoon && isConnected && method?.accountId && (
                  <p className="text-xs text-gray-500 mb-1">
                    {t("paymentMethods.account")}: <span className="text-gray-400 font-mono">{method.accountId}</span>
                  </p>
                )}
                {/* Show saved card info */}
                {!card.comingSoon && isConnected && method?.metadata?.last4 && (
                  <p className="text-xs text-gray-500 mb-1">
                    {t("paymentMethods.cardLast4")} <span className="text-gray-400 font-mono">****{method.metadata.last4}</span>
                    {method.metadata.expMonth && method.metadata.expYear && (
                      <span className="ml-2 text-gray-600">
                        {t("paymentMethods.cardExpiry")} {String(method.metadata.expMonth).padStart(2, "0")}/{method.metadata.expYear}
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="mt-3">
                {card.comingSoon ? (
                  <button
                    disabled
                    className="w-full px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                  >
                    {t("common.comingSoon")}
                  </button>
                ) : isConnected ? (
                  <div className="space-y-2">
                    {/* Show Add Card button if no card yet */}
                    {card.id === "stripe" && !hasCard && stripePromise && !showCardForm && (
                      <button
                        onClick={() => { setShowCardForm(true); setErrorMessage(null); }}
                        className="w-full px-4 py-2 text-sm rounded-lg bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 transition-colors border border-brand-600/30"
                      >
                        {t("paymentMethods.addCard")}
                      </button>
                    )}
                    {/* Inline card form */}
                    {card.id === "stripe" && showCardForm && stripePromise && (
                      <div className="space-y-2">
                        <Elements stripe={stripePromise} options={stripeElementsOptions}>
                          <CardForm onSuccess={handleCardSuccess} onError={handleCardError} />
                        </Elements>
                        <button
                          onClick={() => { setShowCardForm(false); setErrorMessage(null); }}
                          className="w-full px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-400 hover:text-gray-900 transition-colors"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => handleDisconnect(card.id)}
                      disabled={isLoading}
                      className="w-full px-4 py-2 text-sm rounded-lg bg-blocked/20 text-blocked hover:bg-blocked/30 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? t("common.disconnecting") : t("common.disconnect")}
                    </button>
                  </div>
                ) : card.id === "stripe" && showCardForm && stripePromise ? (
                  <div className="space-y-2">
                    <Elements stripe={stripePromise} options={stripeElementsOptions}>
                      <CardForm onSuccess={handleCardSuccess} onError={handleCardError} />
                    </Elements>
                    <button
                      onClick={() => { setShowCardForm(false); setErrorMessage(null); }}
                      className="w-full px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-400 hover:text-gray-900 transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : card.id === "stripe" && stripePromise ? (
                  <button
                    onClick={() => { setShowCardForm(true); setErrorMessage(null); }}
                    disabled={isLoading}
                    className="w-full px-4 py-2 text-sm rounded-lg bg-brand-600 text-gray-900 hover:bg-brand-500 transition-colors disabled:opacity-50"
                  >
                    {t("paymentMethods.addCard")}
                  </button>
                ) : !available ? (
                  <button
                    disabled
                    title="Stripe not configured"
                    className="w-full px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                  >
                    {t("common.configure")}
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowCardForm(true); setErrorMessage(null); }}
                    disabled={isLoading}
                    className="w-full px-4 py-2 text-sm rounded-lg bg-brand-600 text-gray-900 hover:bg-brand-500 transition-colors disabled:opacity-50"
                  >
                    {t("paymentMethods.addCard")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
