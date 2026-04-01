"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed as PWA
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as any).standalone === true;
    setIsStandalone(standalone);

    // Detect iOS
    const ua = navigator.userAgent;
    setIsIos(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    // Check if user previously dismissed
    if (localStorage.getItem("pwa-install-dismissed")) {
      setDismissed(true);
    }

    // Listen for beforeinstallprompt (Chrome, Edge, Samsung)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("pwa-install-dismissed", "1");
  };

  // Don't show if already installed, dismissed, or no prompt available (except iOS)
  if (isStandalone || dismissed) return null;
  if (!deferredPrompt && !isIos) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-brand-200 bg-white p-4 shadow-lg sm:left-auto sm:right-6 sm:bottom-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-xl">
          &#x1F980;
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">Install Jarvis</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {isIos
              ? "Tap the share button, then \"Add to Home Screen\""
              : "Get the app experience — free, fast, with voice chat"}
          </p>
          <div className="mt-3 flex gap-2">
            {!isIos && (
              <button
                onClick={handleInstall}
                className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 transition-colors"
              >
                Install
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {isIos ? "Got it" : "Not now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
