"use client";

import { useState, useCallback } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useApi } from "@/lib/use-api";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

interface WalletStatus {
  hasCard: boolean;
  cardBrand?: string;
  cardLast4?: string;
  spentToday: number;
  spentThisMonth: number;
  limits: { perTransaction: number; daily: number; monthly: number };
  status: "ready" | "needs_card" | "error";
}

async function fetchWalletStatus(token: string): Promise<WalletStatus> {
  const res = await fetch(`${API_URL}/api/wallet/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { hasCard: false, spentToday: 0, spentThisMonth: 0, limits: { perTransaction: 100, daily: 500, monthly: 2000 }, status: "error" };
  return res.json();
}

function formatUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function CardForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError("");

    try {
      const token = await getToken();

      // 1. Create SetupIntent
      const setupRes = await fetch(`${API_URL}/api/wallet/setup-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: user?.id,
          email: user?.primaryEmailAddress?.emailAddress,
          name: user?.fullName,
        }),
      });
      const setupData = await setupRes.json();
      if (!setupData.success) throw new Error(setupData.error || "Failed to setup");

      // 2. Confirm card with Stripe
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error: stripeError } = await stripe.confirmCardSetup(setupData.clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) throw new Error(stripeError.message);

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to save card");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4 bg-white">
        <CardElement options={{
          style: {
            base: { fontSize: "16px", color: "#1f2937", "::placeholder": { color: "#9ca3af" } },
          },
        }} />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={saving || !stripe}
        className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all duration-200 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 active:scale-[0.98] disabled:opacity-60 shadow-lg shadow-orange-500/25"
      >
        {saving ? "Salvando..." : "Salvar Cartao"}
      </button>
      <p className="text-[11px] text-gray-400 text-center">
        Processado com seguranca pelo Stripe. O PayJarvis nunca ve seus dados.
      </p>
    </form>
  );
}

export default function WalletSetupPage() {
  const { data: wallet, loading, refetch } = useApi(fetchWalletStatus);
  const [showCardForm, setShowCardForm] = useState(false);

  const hasCard = wallet?.hasCard ?? false;
  const limits = wallet?.limits ?? { perTransaction: 100, daily: 500, monthly: 2000 };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Carteira de Compras</h1>
        <p className="text-sm text-gray-500 mt-1">
          {hasCard ? "Sua carteira esta pronta para compras pelo Jarvis" : "Adicione um cartao para fazer compras pelo Jarvis"}
        </p>
      </div>

      {/* Main Card */}
      <div className="rounded-2xl bg-gradient-to-br from-[#1a1a2e] to-[#16213e] p-6 text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            {loading ? (
              <div className="h-10 w-40 bg-white/10 rounded-lg animate-pulse" />
            ) : hasCard ? (
              <>
                <p className="text-sm text-gray-400 uppercase tracking-wider">Metodo de Pagamento</p>
                <p className="text-2xl font-bold mt-1 tracking-tight">
                  {wallet?.cardBrand?.toUpperCase() || "CARD"} ****{wallet?.cardLast4 || "????"}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400 uppercase tracking-wider">Nenhum cartao</p>
                <p className="text-xl font-bold mt-1">Adicione um cartao para comecar</p>
              </>
            )}
          </div>
          <div className="text-5xl select-none" aria-hidden>{"\u{1F980}"}</div>
        </div>

        {/* Status badge */}
        <div className="mt-4 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            hasCard ? "bg-emerald-500/20 text-emerald-300" : "bg-yellow-500/20 text-yellow-300"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hasCard ? "bg-emerald-400" : "bg-yellow-400"}`} />
            {hasCard ? "Pronta" : "Configurar"}
          </span>
        </div>

        {/* Add/Change card button */}
        {!showCardForm && (
          <button
            onClick={() => setShowCardForm(true)}
            className="mt-5 w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 active:scale-[0.98] shadow-lg shadow-orange-500/25"
          >
            {hasCard ? "Trocar Cartao" : "Adicionar Cartao"}
          </button>
        )}
      </div>

      {/* Card Form */}
      {showCardForm && stripePromise && (
        <div className="rounded-xl bg-white border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-4">
            {hasCard ? "Trocar cartao" : "Adicionar cartao de pagamento"}
          </h2>
          <Elements stripe={stripePromise} options={{ appearance: { theme: "stripe" } }}>
            <CardForm onSuccess={() => { setShowCardForm(false); refetch(); }} />
          </Elements>
        </div>
      )}

      {/* Spending Summary */}
      {hasCard && wallet && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Gasto hoje</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatUSD(wallet.spentToday)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">limite: {formatUSD(limits.daily)}/dia</p>
          </div>
          <div className="rounded-xl bg-white border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Gasto este mes</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatUSD(wallet.spentThisMonth)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">limite: {formatUSD(limits.monthly)}/mes</p>
          </div>
        </div>
      )}

      {/* Limits */}
      <div className="rounded-xl bg-white border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 text-sm">Limites de Compra</h2>
        <div className="mt-3 space-y-3">
          {[
            { label: "Por compra", value: limits.perTransaction },
            { label: "Por dia", value: limits.daily },
            { label: "Por mes", value: limits.monthly },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{item.label}</span>
              <span className="text-sm font-medium text-gray-900">{formatUSD(item.value)}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Para alterar, diga ao Jarvis: &quot;aumenta meu limite para $200 por compra&quot;
        </p>
      </div>

      {/* How it works */}
      <div className="rounded-xl bg-white border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 text-sm">Como funciona</h2>
        <div className="mt-3 space-y-2.5">
          {[
            { step: "1", text: "Adicione um cartao acima" },
            { step: "2", text: "Peca ao Jarvis para buscar um produto" },
            { step: "3", text: "Confirme a compra no chat" },
            { step: "4", text: "Jarvis cobra do seu cartao + 5% taxa de servico" },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-xs font-bold flex items-center justify-center">{s.step}</span>
              <span className="text-sm text-gray-600 pt-0.5">{s.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Security Notice */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-5 py-4 flex items-start gap-3">
        <svg className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <div>
          <p className="text-xs font-medium text-gray-700">Pagamentos seguros</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Seus dados sao processados pelo Stripe com encriptacao bancaria.
            O PayJarvis nunca armazena ou ve seus dados de cartao.
          </p>
        </div>
      </div>

      <button onClick={refetch} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        Atualizar
      </button>
    </div>
  );
}
