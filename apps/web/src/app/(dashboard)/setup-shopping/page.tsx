"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

interface ShoppingConfig {
  autoApproveLimit: number;
  maxPerDay: number;
  maxPerMonth: number;
  allowedCategories: string[];
  hasPaymentMethod: boolean;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  configured: boolean;
}

const CATEGORIES = [
  { id: "groceries", label: "Groceries & Essentials", icon: "\ud83d\uded2" },
  { id: "clothing", label: "Clothing & Fashion", icon: "\ud83d\udc55" },
  { id: "electronics", label: "Electronics & Tech", icon: "\ud83d\udcf1" },
  { id: "food", label: "Food & Restaurants", icon: "\ud83c\udf7d\ufe0f" },
  { id: "travel", label: "Travel & Hotels", icon: "\u2708\ufe0f" },
  { id: "entertainment", label: "Events & Entertainment", icon: "\ud83c\udfab" },
  { id: "health", label: "Health & Pharmacy", icon: "\ud83d\udc8a" },
  { id: "home", label: "Home & Garden", icon: "\ud83c\udfe0" },
  { id: "books", label: "Books & Education", icon: "\ud83d\udcda" },
  { id: "gifts", label: "Gifts", icon: "\ud83c\udf81" },
];

const STEPS = [
  { num: 1, label: "Limits" },
  { num: 2, label: "Categories" },
  { num: 3, label: "Payment" },
  { num: 4, label: "Done" },
];

// ─── Stripe Card Form ───

function CardForm({
  onSuccess,
  onError,
}: {
  onSuccess: (card: { brand: string; last4: string }) => void;
  onError: (msg: string) => void;
}) {
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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      // Create setup intent
      const intentRes = await fetch(`${API_URL}/api/shopping-config/setup-intent`, {
        method: "POST",
        headers,
      });
      const intentJson = await intentRes.json();
      if (!intentRes.ok || !intentJson.success) {
        onError(intentJson.error ?? "Failed to create setup");
        return;
      }

      const { clientSecret, setupIntentId } = intentJson.data;
      const cardEl = elements.getElement(CardElement);
      if (!cardEl) {
        onError("Card element not found");
        return;
      }

      const { error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardEl },
      });

      if (stripeError) {
        onError(stripeError.message ?? "Card setup failed");
        return;
      }

      // Confirm on backend
      const confirmRes = await fetch(`${API_URL}/api/shopping-config/confirm-card`, {
        method: "POST",
        headers,
        body: JSON.stringify({ setupIntentId }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok || !confirmJson.success) {
        onError(confirmJson.error ?? "Card confirmation failed");
        return;
      }

      onSuccess({
        brand: confirmJson.data.card.brand,
        last4: confirmJson.data.card.last4,
      });
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#1f2937",
                fontFamily: '"DM Sans", system-ui, sans-serif',
                "::placeholder": { color: "#9ca3af" },
              },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>
      <button
        type="submit"
        disabled={saving || !stripe}
        className="w-full py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Saving card...
          </span>
        ) : (
          "Save card"
        )}
      </button>
    </form>
  );
}

// ─── Main Page ───

export default function SetupShoppingPage() {
  const { getToken } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — limits
  const [autoApproveLimit, setAutoApproveLimit] = useState(50);
  const [dailyLimit, setDailyLimit] = useState(200);
  const [monthlyLimit, setMonthlyLimit] = useState(1000);

  // Step 2 — categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    CATEGORIES.map((c) => c.id)
  );
  const [allCategories, setAllCategories] = useState(true);

  // Step 3 — payment
  const [cardBrand, setCardBrand] = useState<string | null>(null);
  const [cardLast4, setCardLast4] = useState<string | null>(null);
  const [hasCard, setHasCard] = useState(false);

  // Load existing config
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/shopping-config`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          const d = json.data as ShoppingConfig;
          setAutoApproveLimit(d.autoApproveLimit);
          setDailyLimit(d.maxPerDay);
          setMonthlyLimit(d.maxPerMonth);
          if (d.allowedCategories.length > 0) {
            setSelectedCategories(d.allowedCategories);
            setAllCategories(
              d.allowedCategories.length === CATEGORIES.length
            );
          }
          if (d.hasPaymentMethod) {
            setHasCard(true);
            setCardBrand(d.paymentMethodBrand);
            setCardLast4(d.paymentMethodLast4);
          }
        }
      } catch {
        // ignore, use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/shopping-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          autoApproveLimit,
          maxPerDay: dailyLimit,
          maxPerMonth: monthlyLimit,
          allowedCategories: selectedCategories,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [getToken, autoApproveLimit, dailyLimit, monthlyLimit, selectedCategories]);

  const handleNext = async () => {
    if (step === 1 || step === 2) {
      await saveConfig();
      if (!error) setStep(step + 1);
    } else if (step === 3) {
      setStep(4);
    }
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) => {
      const next = prev.includes(id)
        ? prev.filter((c) => c !== id)
        : [...prev, id];
      setAllCategories(next.length === CATEGORIES.length);
      return next;
    });
  };

  const toggleAll = () => {
    if (allCategories) {
      setSelectedCategories([]);
      setAllCategories(false);
    } else {
      setSelectedCategories(CATEGORIES.map((c) => c.id));
      setAllCategories(true);
    }
  };

  const exampleText = (amount: number, label: string) => {
    if (amount <= autoApproveLimit) {
      return (
        <span className="text-emerald-600">
          {label} ${amount} &rarr; auto-approved
        </span>
      );
    }
    return (
      <span className="text-amber-600">
        {label} ${amount} &rarr; asks you first
      </span>
    );
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-64 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-4 md:py-8">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s) => (
          <div key={s.num} className="flex-1 flex flex-col items-center gap-1.5">
            <div
              className={`w-full h-1.5 rounded-full transition-colors ${
                s.num <= step ? "bg-gray-900" : "bg-gray-200"
              }`}
            />
            <span
              className={`text-[10px] font-medium tracking-wide uppercase ${
                s.num <= step ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}

      {/* ─── STEP 1: SPENDING LIMITS ─── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              How much can Jarvis spend without asking?
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Set your comfort level. You can change this anytime.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-6">
            {/* Auto-approve slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  Auto-approve up to
                </label>
                <span className="text-lg font-bold text-gray-900">
                  ${autoApproveLimit}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={500}
                step={5}
                value={autoApproveLimit}
                onChange={(e) => setAutoApproveLimit(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-900"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>$0</span>
                <span>$250</span>
                <span>$500</span>
              </div>
            </div>

            {/* Daily limit */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Daily spending limit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  max={2000}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  className="w-full pl-7 pr-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Monthly limit */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Monthly spending limit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={monthlyLimit}
                  onChange={(e) => setMonthlyLimit(Number(e.target.value))}
                  className="w-full pl-7 pr-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                />
              </div>
            </div>
          </div>

          {/* Examples */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Examples
            </p>
            <div className="text-sm space-y-1.5">
              <div>{exampleText(5, "Coffee")}</div>
              <div>{exampleText(35, "Groceries")}</div>
              <div>{exampleText(120, "New shoes")}</div>
              <div>{exampleText(450, "Flight ticket")}</div>
            </div>
          </div>

          <button
            onClick={handleNext}
            disabled={saving}
            className="w-full py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
        </div>
      )}

      {/* ─── STEP 2: CATEGORIES ─── */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              What can Jarvis buy for you?
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Choose which categories Jarvis is allowed to shop in.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            {/* Toggle all */}
            <button
              onClick={toggleAll}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                allCategories
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
              }`}
            >
              <span className="text-sm font-medium">Allow ALL categories</span>
              <div
                className={`w-10 h-6 rounded-full relative transition-colors ${
                  allCategories ? "bg-white/20" : "bg-gray-300"
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
                    allCategories
                      ? "right-1 bg-white"
                      : "left-1 bg-white"
                  }`}
                />
              </div>
            </button>

            <div className="h-px bg-gray-100" />

            {/* Category list */}
            <div className="grid grid-cols-1 gap-2">
              {CATEGORIES.map((cat) => {
                const active = selectedCategories.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => toggleCategory(cat.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                      active
                        ? "border-gray-300 bg-white shadow-sm"
                        : "border-transparent bg-gray-50 opacity-60"
                    }`}
                  >
                    <span className="text-lg">{cat.icon}</span>
                    <span className="text-sm font-medium text-gray-800 flex-1">
                      {cat.label}
                    </span>
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                        active
                          ? "bg-gray-900 border-gray-900"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {active && (
                        <svg
                          className="w-3 h-3 text-white"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3.5 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              disabled={saving || selectedCategories.length === 0}
              className="flex-[2] py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: PAYMENT METHOD ─── */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Add a payment card
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Your card is securely stored by Stripe. We never see your card
              number.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            {hasCard ? (
              <div className="text-center space-y-3">
                <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                  <svg
                    className="w-7 h-7 text-emerald-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Card saved
                  </p>
                  <p className="text-sm text-gray-500">
                    {cardBrand
                      ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} ending ${cardLast4}`
                      : `Card ending ${cardLast4}`}
                  </p>
                </div>
                <button
                  onClick={() => setHasCard(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  Replace card
                </button>
              </div>
            ) : stripePromise ? (
              <Elements
                stripe={stripePromise}
                options={{
                  appearance: {
                    theme: "stripe",
                    variables: {
                      colorPrimary: "#111827",
                      borderRadius: "8px",
                    },
                  },
                }}
              >
                <CardForm
                  onSuccess={(card) => {
                    setCardBrand(card.brand);
                    setCardLast4(card.last4);
                    setHasCard(true);
                  }}
                  onError={(msg) => setError(msg)}
                />
              </Elements>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">
                Stripe is not configured. Please contact support.
              </p>
            )}
          </div>

          {/* Security badge */}
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
            <span>PCI DSS Level 1 Compliant &mdash; Powered by Stripe</span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3.5 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              disabled={!hasCard}
              className="flex-[2] py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              Continue
            </button>
          </div>

          {/* Skip option */}
          <button
            onClick={() => setStep(4)}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
          >
            Skip for now &mdash; I&apos;ll add a card later
          </button>
        </div>
      )}

      {/* ─── STEP 4: CONFIRMATION ─── */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-emerald-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              You&apos;re all set!
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Jarvis is ready to shop for you.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <SummaryRow
              icon="check"
              label="Auto-approve"
              value={`up to $${autoApproveLimit}`}
            />
            <SummaryRow
              icon="check"
              label="Daily limit"
              value={`$${dailyLimit.toLocaleString()}`}
            />
            <SummaryRow
              icon="check"
              label="Monthly limit"
              value={`$${monthlyLimit.toLocaleString()}`}
            />
            <SummaryRow
              icon="check"
              label="Categories"
              value={
                selectedCategories.length === CATEGORIES.length
                  ? "All enabled"
                  : `${selectedCategories.length} of ${CATEGORIES.length}`
              }
            />
            <SummaryRow
              icon={hasCard ? "check" : "warning"}
              label="Payment"
              value={
                hasCard
                  ? `${
                      cardBrand
                        ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)
                        : "Card"
                    } ending ${cardLast4}`
                  : "No card added yet"
              }
            />
          </div>

          <a
            href="/dashboard"
            className="block w-full py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors text-sm text-center"
          >
            Go to Dashboard
          </a>

          <p className="text-center text-xs text-gray-400">
            Tell Jarvis to buy anything &mdash; he&apos;s ready!
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: "check" | "warning";
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center ${
          icon === "check" ? "bg-emerald-100" : "bg-amber-100"
        }`}
      >
        {icon === "check" ? (
          <svg
            className="w-3.5 h-3.5 text-emerald-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            className="w-3.5 h-3.5 text-amber-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}
