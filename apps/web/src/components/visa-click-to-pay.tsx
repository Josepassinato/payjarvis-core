"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type FlowStep = "loading" | "init" | "lookup" | "otp" | "cards" | "checkout" | "success" | "error";

interface SdkConfig {
  sdkUrl: string;
  environment: string;
  initParams: {
    srcInitiatorId: string;
    srciDpaId: string;
    srciTransactionId: string;
    dpaTransactionOptions: Record<string, any>;
  };
}

interface VisaClickToPayProps {
  amount?: number;
  currency?: string;
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

declare global {
  interface Window {
    vAdaptor?: any;
  }
}

export default function VisaClickToPay({
  amount = 0,
  currency = "USD",
  onSuccess,
  onError,
}: VisaClickToPayProps) {
  const { getToken } = useAuth();
  const [step, setStep] = useState<FlowStep>("loading");
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<SdkConfig | null>(null);
  const [recognized, setRecognized] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [cards, setCards] = useState<any[]>([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const sdkRef = useRef<any>(null);
  const scriptLoaded = useRef(false);

  // 1. Fetch SDK config from backend
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_URL}/visa/sdk-config`, { headers });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load Visa config");

        setConfig(json.data);
        setStep("init");
      } catch (err) {
        setError(String(err));
        setStep("error");
      }
    })();
  }, [getToken]);

  // 2. Load Visa SDK script
  useEffect(() => {
    if (!config || scriptLoaded.current) return;

    const script = document.createElement("script");
    script.src = config.sdkUrl;
    script.async = true;
    script.onload = () => {
      scriptLoaded.current = true;
      initSdk();
    };
    script.onerror = () => {
      setError("Failed to load Visa Click to Pay SDK");
      setStep("error");
    };
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // 3. Initialize SDK
  const initSdk = useCallback(async () => {
    if (!config || !window.vAdaptor) return;

    try {
      const sdk = window.vAdaptor;
      sdkRef.current = sdk;

      const initParams = {
        ...config.initParams,
        dpaTransactionOptions: {
          ...config.initParams.dpaTransactionOptions,
          transactionAmount: {
            transactionAmount: amount.toFixed(2),
            transactionCurrencyCode: currency,
          },
        },
      };

      await sdk.init(initParams);

      // Check if user is recognized (returning customer)
      const recognizedResult = await sdk.isRecognized();
      setRecognized(recognizedResult?.recognized ?? false);

      if (recognizedResult?.recognized) {
        // Skip to cards if recognized
        await loadCards();
      } else {
        setStep("lookup");
      }
    } catch (err: any) {
      setError(err?.message ?? "SDK initialization failed");
      setStep("error");
    }
  }, [config, amount, currency]);

  // 4. Identity lookup by email
  const handleLookup = async () => {
    if (!sdkRef.current || !email) return;
    setProcessing(true);

    try {
      const result = await sdkRef.current.identityLookup({
        consumerIdentity: {
          identityProvider: "SRC",
          identityValue: email,
          type: "EMAIL_ADDRESS",
        },
      });

      if (result?.consumerPresent) {
        // Consumer found — send OTP
        await sdkRef.current.initiateIdentityValidation();
        setStep("otp");
      } else {
        setError("No Click to Pay account found for this email. Please enroll at your bank first.");
        setStep("error");
      }
    } catch (err: any) {
      setError(err?.error?.message ?? err?.message ?? "Identity lookup failed");
      setStep("error");
    } finally {
      setProcessing(false);
    }
  };

  // 5. Validate OTP
  const handleOtp = async () => {
    if (!sdkRef.current || !otp) return;
    setProcessing(true);

    try {
      await sdkRef.current.completeIdentityValidation({ validationData: otp });
      await loadCards();
    } catch (err: any) {
      setError(err?.error?.message ?? "OTP validation failed");
      setStep("error");
    } finally {
      setProcessing(false);
    }
  };

  // 6. Load saved cards
  const loadCards = async () => {
    if (!sdkRef.current) return;

    try {
      const profile = await sdkRef.current.getSrcProfile();
      const profileCards = profile?.profiles?.[0]?.maskedCards ?? [];
      setCards(profileCards);
      if (profileCards.length > 0) {
        setSelectedCard(profileCards[0].srcDigitalCardId);
      }
      setStep("cards");
    } catch (err: any) {
      setError(err?.error?.message ?? "Failed to load cards");
      setStep("error");
    }
  };

  // 7. Checkout with selected card
  const handleCheckout = async () => {
    if (!sdkRef.current || !selectedCard || !config) return;
    setProcessing(true);

    try {
      const checkoutResult = await sdkRef.current.checkout({
        srciTransactionId: config.initParams.srciTransactionId,
        srcDigitalCardId: selectedCard,
        dpaTransactionOptions: {
          transactionAmount: {
            transactionAmount: amount.toFixed(2),
            transactionCurrencyCode: currency,
          },
        },
      });

      if (checkoutResult?.checkoutResponse) {
        // Send encrypted payload to backend for decryption
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_URL}/visa/checkout`, {
          method: "POST",
          headers,
          body: JSON.stringify({ encryptedPayload: checkoutResult.checkoutResponse }),
        });
        const json = await res.json();

        if (json.success) {
          setStep("success");
          onSuccess?.(json.data);
        } else {
          // Even if decryption fails, checkout may have succeeded
          // The raw checkoutResponse can be used as proof
          setStep("success");
          onSuccess?.({ raw: checkoutResult, decrypted: false });
        }
      } else if (checkoutResult?.dcfActionCode === "COMPLETE") {
        setStep("success");
        onSuccess?.(checkoutResult);
      } else {
        setError("Checkout was not completed");
        setStep("error");
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? "Checkout failed";
      setError(msg);
      setStep("error");
      onError?.(msg);
    } finally {
      setProcessing(false);
    }
  };

  // ── Render ─────────────────────────────

  if (step === "loading") {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="ml-2 text-sm text-gray-400">Loading Visa Click to Pay...</span>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="bg-red-950/30 border border-red-800/30 rounded-xl px-5 py-4">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => { setError(null); setStep("init"); initSdk(); }}
          className="mt-2 text-xs text-red-300 underline hover:text-red-200"
        >
          Try again
        </button>
      </div>
    );
  }

  if (step === "init") {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="ml-2 text-sm text-gray-400">Initializing Visa SDK...</span>
      </div>
    );
  }

  if (step === "lookup") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-400">Enter your email to find your Click to Pay cards:</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
        />
        <button
          onClick={handleLookup}
          disabled={processing || !email}
          className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {processing ? "Looking up..." : "Continue with Click to Pay"}
        </button>
      </div>
    );
  }

  if (step === "otp") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-400">
          We sent a verification code to <span className="text-gray-200">{email}</span>
        </p>
        <input
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="Enter verification code"
          maxLength={8}
          className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none text-center tracking-widest"
          onKeyDown={(e) => e.key === "Enter" && handleOtp()}
        />
        <button
          onClick={handleOtp}
          disabled={processing || !otp}
          className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {processing ? "Verifying..." : "Verify"}
        </button>
      </div>
    );
  }

  if (step === "cards") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-400">Select a card:</p>
        <div className="space-y-2">
          {cards.map((card) => (
            <button
              key={card.srcDigitalCardId}
              onClick={() => setSelectedCard(card.srcDigitalCardId)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                selectedCard === card.srcDigitalCardId
                  ? "border-blue-500 bg-blue-950/30"
                  : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
              }`}
            >
              <div className="w-10 h-7 bg-gradient-to-br from-blue-600 to-blue-800 rounded flex items-center justify-center">
                <span className="text-[10px] font-bold text-white">VISA</span>
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-200">
                  {card.panDescription ?? "Visa"} ****{card.panLastFour ?? "????"}
                </p>
                {card.panExpirationMonth && card.panExpirationYear && (
                  <p className="text-xs text-gray-500">
                    Expires {card.panExpirationMonth}/{card.panExpirationYear}
                  </p>
                )}
              </div>
              {selectedCard === card.srcDigitalCardId && (
                <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
        {amount > 0 && (
          <button
            onClick={handleCheckout}
            disabled={processing || !selectedCard}
            className="w-full px-4 py-3 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {processing
              ? "Processing..."
              : `Pay $${amount.toFixed(2)} ${currency} with Click to Pay`}
          </button>
        )}
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="bg-emerald-950/30 border border-emerald-800/30 rounded-xl px-5 py-4 text-center">
        <svg className="w-8 h-8 text-emerald-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-emerald-400 font-medium">Payment completed with Click to Pay</p>
      </div>
    );
  }

  return null;
}
