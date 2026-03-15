"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import {
  getBots,
  getBotIntegrations,
  getAvailableIntegrations,
  toggleBotIntegration,
  connectTelegramBot,
  getTelegramBotStatus,
  disconnectTelegramBot,
  type Bot,
  type BotIntegration,
  type AvailableProvider,
  type TelegramStatus,
} from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { LoadingSpinner, ErrorBox } from "@/components/loading";
import { IntegrationGrid, type EnabledState } from "@/components/integration-grid";


export default function IntegrationsPage() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const { data: bots, loading: botsLoading, error: botsError } = useApi<Bot[]>((token) => getBots(token));

  const [selectedBot, setSelectedBot] = useState("");
  const [providers, setProviders] = useState<AvailableProvider[]>([]);
  const [enabled, setEnabled] = useState<EnabledState>({});
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Telegram bot token state
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramSuccess, setTelegramSuccess] = useState<string | null>(null);

  // Auto-select first bot
  useEffect(() => {
    if (bots && bots.length > 0 && !selectedBot) {
      setSelectedBot(bots[0].id);
    }
  }, [bots, selectedBot]);

  // Load integrations when bot changes
  const loadIntegrations = useCallback(async (botId: string) => {
    if (!botId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const [available, existing] = await Promise.all([
        getAvailableIntegrations(token),
        getBotIntegrations(botId, token),
      ]);
      setProviders(available);

      const enabledMap: EnabledState = {};
      for (const integration of existing) {
        enabledMap[integration.provider] = integration.enabled;
      }
      setEnabled(enabledMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (selectedBot) loadIntegrations(selectedBot);
  }, [selectedBot, loadIntegrations]);

  // Load Telegram status when bot changes
  const selectedBotData = bots?.find((b) => b.id === selectedBot);
  const isTelegramBot = selectedBotData?.platform === "TELEGRAM";

  useEffect(() => {
    if (!selectedBot || !isTelegramBot) {
      setTelegramStatus(null);
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        const status = await getTelegramBotStatus(selectedBot, token);
        setTelegramStatus(status);
      } catch {
        setTelegramStatus(null);
      }
    })();
  }, [selectedBot, isTelegramBot, getToken]);

  const handleConnectTelegram = async () => {
    if (!selectedBot || !telegramToken.trim()) return;
    setTelegramLoading(true);
    setTelegramError(null);
    setTelegramSuccess(null);
    try {
      const token = await getToken();
      const result = await connectTelegramBot(selectedBot, telegramToken.trim(), token);
      setTelegramStatus({
        connected: true,
        username: result.username,
        name: result.name,
        connectedAt: new Date().toISOString(),
      });
      setTelegramToken("");
      setTelegramSuccess(
        result.username
          ? t("integrations.telegramConnected", { username: `@${result.username}` })
          : t("integrations.telegramConnectedGeneric")
      );
      setTimeout(() => setTelegramSuccess(null), 5000);
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : t("integrations.telegramConnectFailed"));
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    if (!selectedBot) return;
    setTelegramLoading(true);
    setTelegramError(null);
    try {
      const token = await getToken();
      await disconnectTelegramBot(selectedBot, token);
      setTelegramStatus({ connected: false });
      setTelegramToken("");
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : t("integrations.telegramDisconnectFailed"));
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleToggle = async (provider: string, category: string, newValue: boolean) => {
    if (!selectedBot) return;
    setToggling(provider);
    setSaveMessage(null);

    // Optimistic update
    setEnabled((prev) => ({ ...prev, [provider]: newValue }));

    try {
      const token = await getToken();
      await toggleBotIntegration(selectedBot, provider, category, newValue, token);
      setSaveMessage(t("integrations.saved"));
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      // Revert on error
      setEnabled((prev) => ({ ...prev, [provider]: !newValue }));
      setError(err instanceof Error ? err.message : "Failed to toggle integration");
    } finally {
      setToggling(null);
    }
  };

  if (botsLoading) return <LoadingSpinner />;
  if (botsError) return <ErrorBox message={botsError} />;

  const enabledCount = Object.values(enabled).filter(Boolean).length;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">{t("integrations.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("integrations.dashboardSubtitle")}</p>
      </div>

      {/* Bot selector */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <label className="block text-xs text-gray-500 mb-1">{t("integrations.selectBot")}</label>
          <select
            value={selectedBot}
            onChange={(e) => setSelectedBot(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-brand-500"
          >
            <option value="">{t("integrations.chooseBot")}</option>
            {(bots ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.platform})
              </option>
            ))}
          </select>
        </div>

        {saveMessage && (
          <span className="text-sm text-approved flex items-center gap-1 mt-5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {saveMessage}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-blocked/10 border border-blocked/20 px-4 py-2 text-sm text-blocked">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-xs">dismiss</button>
        </div>
      )}

      {/* Telegram Bot Token Connection */}
      {selectedBot && isTelegramBot && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>🤖</span>
            {t("integrations.telegramBotTitle", { defaultValue: "Telegram Bot" })}
          </h3>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            {telegramStatus?.connected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-gray-900 font-medium">
                    {t("integrations.telegramStatusConnected", { defaultValue: "Connected" })}
                  </span>
                  {telegramStatus.username && (
                    <span className="text-sm text-brand-400 font-mono">@{telegramStatus.username}</span>
                  )}
                  {telegramStatus.name && (
                    <span className="text-xs text-gray-500">({telegramStatus.name})</span>
                  )}
                </div>
                {telegramStatus.connectedAt && (
                  <p className="text-xs text-gray-500">
                    {t("integrations.telegramConnectedSince", { defaultValue: "Connected since" })}{" "}
                    {new Date(telegramStatus.connectedAt).toLocaleDateString()}
                  </p>
                )}
                <button
                  onClick={handleDisconnectTelegram}
                  disabled={telegramLoading}
                  className="text-xs text-blocked hover:text-red-400 underline transition-colors disabled:opacity-50"
                >
                  {telegramLoading ? t("common.disconnecting") : t("common.disconnect")}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  {t("integrations.telegramBotDesc", {
                    defaultValue: "Paste your Telegram Bot Token from @BotFather to connect your bot.",
                  })}
                </p>
                <div className="flex gap-3">
                  <input
                    type="password"
                    value={telegramToken}
                    onChange={(e) => {
                      setTelegramToken(e.target.value);
                      setTelegramError(null);
                    }}
                    placeholder={t("integrations.telegramTokenPlaceholder", {
                      defaultValue: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
                    })}
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 font-mono"
                    disabled={telegramLoading}
                  />
                  <button
                    onClick={handleConnectTelegram}
                    disabled={telegramLoading || !telegramToken.trim()}
                    className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-gray-900 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {telegramLoading
                      ? t("common.loading")
                      : t("integrations.telegramValidateAndSave", { defaultValue: "Validate & Save" })}
                  </button>
                </div>
                <p className="text-xs text-gray-600">
                  {t("integrations.telegramBotHint", {
                    defaultValue:
                      "Open Telegram, message @BotFather, create a bot with /newbot, and paste the token here.",
                  })}
                </p>
              </div>
            )}

            {telegramError && (
              <div className="mt-3 rounded-lg bg-blocked/10 border border-blocked/20 px-4 py-2 text-sm text-blocked">
                {telegramError}
              </div>
            )}
            {telegramSuccess && (
              <div className="mt-3 rounded-lg bg-approved/10 border border-approved/20 px-4 py-2 text-sm text-approved flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {telegramSuccess}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connected Stores */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>🛒</span>
          Connected Stores
        </h3>
        <div className="bg-white border border-gray-200 rounded-xl p-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Manage your connected stores</p>
            <p className="text-xs text-gray-500 mt-1">Connect Amazon, Walmart, Target and more — no passwords stored</p>
          </div>
          <a href="/stores" className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-gray-900 text-sm font-medium rounded-lg transition-colors">
            Manage Stores →
          </a>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : selectedBot && providers.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
          {/* Summary bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="h-6 w-6 rounded-full bg-brand-600 text-gray-900 text-xs font-bold flex items-center justify-center">
                {enabledCount}
              </span>
              {t("integrations.activeServices", { count: enabledCount })}
            </div>
          </div>

          <IntegrationGrid
            providers={providers}
            enabled={enabled}
            onToggle={handleToggle}
            toggling={toggling}
          />
        </div>
      ) : selectedBot ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-500">{t("integrations.noProviders")}</p>
        </div>
      ) : null}
    </div>
  );
}
