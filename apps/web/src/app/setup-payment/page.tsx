"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

function SetupForm({ clientSecret }: { clientSecret: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;

      setLoading(true);
      setError(null);

      const result = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: window.location.href + "?done=1",
        },
        redirect: "if_required",
      });

      if (result.error) {
        setError(result.error.message ?? "Erro ao adicionar cartão");
        setLoading(false);
      } else {
        setSuccess(true);
        setLoading(false);
      }
    },
    [stripe, elements]
  );

  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="h-16 w-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Cartão adicionado!</h2>
        <p className="text-gray-400 text-sm">
          Pode fechar esta aba e voltar ao Telegram/WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-400 hover:to-purple-500 transition-all disabled:opacity-50 text-base"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Processando...
          </span>
        ) : (
          "Adicionar cartão"
        )}
      </button>
    </form>
  );
}

export default function SetupPaymentPage() {
  const searchParams = useSearchParams();
  const clientSecret = searchParams.get("secret");
  const done = searchParams.get("done");

  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (clientSecret) setReady(true);
  }, [clientSecret]);

  if (done === "1") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 text-center space-y-4">
          <div className="h-16 w-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white">Cartão adicionado!</h2>
          <p className="text-gray-400 text-sm">
            Pode fechar esta aba e voltar ao Telegram/WhatsApp.
          </p>
        </div>
      </div>
    );
  }

  if (!clientSecret || !ready) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 text-center space-y-4">
          <h2 className="text-xl font-bold text-white">Link inválido</h2>
          <p className="text-gray-400 text-sm">
            Este link de pagamento não é válido. Volte ao bot e peça um novo link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950/30 to-gray-950 flex flex-col">
      {/* Header */}
      <div className="p-4 sm:p-6">
        <span className="text-sm font-bold text-white/60 tracking-wider">PAYJARVIS</span>
      </div>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center p-4 pb-12">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="h-14 w-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25">
              <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Adicionar cartão de pagamento</h1>
            <p className="text-gray-400 text-sm">
              Adicione seu cartão para fazer compras pelo bot.
            </p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: "#6366f1",
                    colorBackground: "#1f2937",
                    colorText: "#f9fafb",
                    colorTextSecondary: "#9ca3af",
                    borderRadius: "8px",
                  },
                },
              }}
            >
              <SetupForm clientSecret={clientSecret} />
            </Elements>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-white/30">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
            <span>Seus dados são processados com segurança pelo Stripe. PayJarvis não armazena números de cartão.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
