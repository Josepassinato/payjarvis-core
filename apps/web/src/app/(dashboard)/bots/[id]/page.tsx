"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import { getBot, upsertPolicy, linkTelegram, getReputation } from "@/lib/api";
import type { Bot, Policy, AgentReputation } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TrustBar } from "@/components/trust-bar";
import { LoadingSpinner, ErrorBox } from "@/components/loading";

type PolicyForm = Omit<Policy, "id" | "botId" | "createdAt" | "updatedAt">;

const defaultPolicy: PolicyForm = {
  maxPerTransaction: 100,
  maxPerDay: 500,
  maxPerWeek: 2000,
  maxPerMonth: 5000,
  autoApproveLimit: 50,
  requireApprovalUp: 200,
  allowedDays: [1, 2, 3, 4, 5],
  allowedHoursStart: 8,
  allowedHoursEnd: 22,
  allowedCategories: [],
  blockedCategories: [],
  merchantWhitelist: [],
  merchantBlacklist: [],
};

export default function BotDetailPage({ params }: { params: { id: string } }) {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const { data: bot, loading, error, refetch } = useApi<Bot>((token) => getBot(params.id, token), [params.id]);
  const { data: reputation } = useApi<AgentReputation>((token) => getReputation(params.id, token), [params.id]);
  const [policy, setPolicy] = useState<PolicyForm>(defaultPolicy);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newAllowedCat, setNewAllowedCat] = useState("");
  const [newBlockedCat, setNewBlockedCat] = useState("");
  const [newWhitelist, setNewWhitelist] = useState("");
  const [newBlacklist, setNewBlacklist] = useState("");

  const [telegramLinking, setTelegramLinking] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkInstructions, setLinkInstructions] = useState<string | null>(null);

  const dayNames = [t("days.sun"), t("days.mon"), t("days.tue"), t("days.wed"), t("days.thu"), t("days.fri"), t("days.sat")];

  useEffect(() => {
    if (bot?.policy) {
      const { id, botId, createdAt, updatedAt, ...rest } = bot.policy;
      setPolicy(rest);
    }
  }, [bot]);

  const updateField = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) => {
    setPolicy((p) => ({ ...p, [key]: value }));
    setSaved(false);
    setSaveError(null);
  };

  const toggleDay = (day: number) => {
    updateField(
      "allowedDays",
      policy.allowedDays.includes(day)
        ? policy.allowedDays.filter((d) => d !== day)
        : [...policy.allowedDays, day].sort()
    );
  };

  const addToList = (key: "allowedCategories" | "blockedCategories" | "merchantWhitelist" | "merchantBlacklist", value: string, setter: (v: string) => void) => {
    if (value.trim() && !policy[key].includes(value.trim())) {
      updateField(key, [...policy[key], value.trim()]);
      setter("");
    }
  };

  const removeFromList = (key: "allowedCategories" | "blockedCategories" | "merchantWhitelist" | "merchantBlacklist", value: string) => {
    updateField(key, policy[key].filter((v) => v !== value));
  };

  const hasValidationErrors =
    policy.autoApproveLimit > policy.maxPerTransaction ||
    policy.requireApprovalUp > policy.maxPerTransaction ||
    policy.autoApproveLimit > policy.requireApprovalUp ||
    policy.maxPerDay < policy.maxPerTransaction;

  const handleSave = async () => {
    if (!bot || hasValidationErrors) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getToken();
      await upsertPolicy(bot.id, policy, token);
      setSaved(true);
      refetch();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("botDetail.failedSave"));
    } finally {
      setSaving(false);
    }
  };

  const handleLinkTelegram = async () => {
    setTelegramLinking(true);
    try {
      const token = await getToken();
      const result = await linkTelegram(token);
      setLinkCode(result.code);
      setLinkInstructions(result.instructions);
    } catch {
      setSaveError(t("botDetail.failedTelegram"));
    } finally {
      setTelegramLinking(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;
  if (!bot) return <ErrorBox message="Bot not found" />;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">{bot.name}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {bot.platform} &middot; ID: {bot.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-xs text-blocked">{saveError}</span>}
          <button
            onClick={handleSave}
            disabled={saving || hasValidationErrors}
            className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              saved
                ? "bg-approved/20 text-approved"
                : "bg-brand-600 text-white hover:bg-brand-500"
            } disabled:opacity-50`}
          >
            {saving ? t("botDetail.saving") : saved ? t("botDetail.saved") : t("botDetail.saveChanges")}
          </button>
        </div>
      </div>

      {/* Trust Score + Reputation */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">{t("bots.trustScore")}</h3>
          <span className="text-2xl font-bold font-mono text-white">{Math.round(bot.trustScore)}</span>
        </div>
        <TrustBar score={bot.trustScore} />
        {reputation ? (
          <div className="grid grid-cols-5 gap-3 mt-4 pt-4 border-t border-surface-border">
            <div className="text-center">
              <div className="text-lg font-bold text-approved">{reputation.transactionsSuccess}</div>
              <div className="text-[10px] text-gray-500">{t("reputation.success")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blocked">{reputation.transactionsBlocked}</div>
              <div className="text-[10px] text-gray-500">{t("reputation.blocked")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">${reputation.totalSpent.toLocaleString()}</div>
              <div className="text-[10px] text-gray-500">{t("reputation.totalSpent")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-brand-400">{reputation.merchantCount}</div>
              <div className="text-[10px] text-gray-500">{t("reputation.merchants")}</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${reputation.anomalyEvents > 0 ? "text-pending" : "text-gray-500"}`}>{reputation.anomalyEvents}</div>
              <div className="text-[10px] text-gray-500">{t("reputation.anomalies")}</div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500 mt-2">
            {bot.totalApproved} {t("botDetail.approvedCount")} &middot; {bot.totalBlocked} {t("botDetail.blockedCount")}
          </p>
        )}
      </div>

      {/* Simplified: 3 main limit cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {([
          ["maxPerTransaction", t("botDetail.maxPerPurchase"), "$"],
          ["maxPerDay", t("botDetail.dailyLimit"), "$"],
          ["autoApproveLimit", t("botDetail.autoApproveUpTo"), "$"],
        ] as const).map(([key, label, prefix]) => (
          <div key={key} className="bg-surface-card border border-surface-border rounded-xl p-5">
            <label className="block text-xs text-gray-500 mb-2">{label}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{prefix}</span>
              <input
                type="number"
                value={policy[key]}
                onChange={(e) => updateField(key, Number(e.target.value))}
                className="w-full bg-surface border border-surface-border rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Telegram toggle */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">{t("botDetail.telegramNotif")}</h3>
            <p className="text-xs text-gray-500 mt-1">{t("botDetail.telegramDesc")}</p>
          </div>
          {!linkCode ? (
            <button
              onClick={handleLinkTelegram}
              disabled={telegramLinking}
              className="px-4 py-2 bg-[#0088cc] text-white text-xs font-medium rounded-lg hover:bg-[#0077b5] transition-colors disabled:opacity-50"
            >
              {telegramLinking ? "..." : t("common.connect")}
            </button>
          ) : (
            <div className="text-right">
              <p className="text-2xl font-mono font-bold text-white tracking-widest">{linkCode}</p>
              <p className="text-xs text-gray-500 mt-1">{linkInstructions}</p>
            </div>
          )}
        </div>
      </div>

      {/* Validation warnings */}
      {policy.autoApproveLimit > policy.maxPerTransaction && (
        <div className="rounded-lg bg-pending/10 border border-pending/20 px-4 py-2 text-xs text-pending mb-6">
          {t("botDetail.autoApproveWarning", { auto: policy.autoApproveLimit, max: policy.maxPerTransaction })}
        </div>
      )}
      {policy.requireApprovalUp > policy.maxPerTransaction && (
        <div className="rounded-lg bg-pending/10 border border-pending/20 px-4 py-2 text-xs text-pending mb-6">
          {t("botDetail.approvalLimitWarning", { approval: policy.requireApprovalUp, max: policy.maxPerTransaction })}
        </div>
      )}
      {policy.autoApproveLimit > policy.requireApprovalUp && (
        <div className="rounded-lg bg-pending/10 border border-pending/20 px-4 py-2 text-xs text-pending mb-6">
          {t("botDetail.autoVsApprovalWarning", { auto: policy.autoApproveLimit, approval: policy.requireApprovalUp })}
        </div>
      )}
      {policy.maxPerDay < policy.maxPerTransaction && (
        <div className="rounded-lg bg-pending/10 border border-pending/20 px-4 py-2 text-xs text-pending mb-6">
          {t("botDetail.dailyLimitWarning", { daily: policy.maxPerDay, max: policy.maxPerTransaction })}
        </div>
      )}

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {t("botDetail.advancedSettings")}
      </button>

      {showAdvanced && (
        <>
          {/* Full Financial Limits */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">{t("botDetail.financialLimits")}</h3>
            <div className="grid grid-cols-2 gap-4">
              {([
                ["maxPerTransaction", t("botDetail.maxPerTx")],
                ["maxPerDay", t("botDetail.maxPerDay")],
                ["maxPerWeek", t("botDetail.maxPerWeek")],
                ["maxPerMonth", t("botDetail.maxPerMonth")],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      value={policy[key]}
                      onChange={(e) => updateField(key, Number(e.target.value))}
                      className="w-full bg-surface border border-surface-border rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Autonomy */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">{t("botDetail.autonomy")}</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-approved/5 border border-approved/10 rounded-lg">
                <div className="w-3 h-3 rounded-full bg-approved" />
                <div className="flex-1">
                  <p className="text-sm text-white">{t("botDetail.automatic")}</p>
                  <p className="text-xs text-gray-500">{t("botDetail.automaticDesc")}</p>
                </div>
                <span className="text-sm text-gray-400">{t("common.until")}</span>
                <div className="relative w-32">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                  <input
                    type="number"
                    value={policy.autoApproveLimit}
                    onChange={(e) => updateField("autoApproveLimit", Number(e.target.value))}
                    className="w-full bg-surface border border-surface-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-pending/5 border border-pending/10 rounded-lg">
                <div className="w-3 h-3 rounded-full bg-pending" />
                <div className="flex-1">
                  <p className="text-sm text-white">{t("botDetail.requireApproval")}</p>
                  <p className="text-xs text-gray-500">{t("botDetail.requireApprovalDesc")}</p>
                </div>
                <span className="text-sm text-gray-400">{t("common.until")}</span>
                <div className="relative w-32">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                  <input
                    type="number"
                    value={policy.requireApprovalUp}
                    onChange={(e) => updateField("requireApprovalUp", Number(e.target.value))}
                    className="w-full bg-surface border border-surface-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-blocked/5 border border-blocked/10 rounded-lg">
                <div className="w-3 h-3 rounded-full bg-blocked" />
                <div className="flex-1">
                  <p className="text-sm text-white">{t("botDetail.blockedLabel")}</p>
                  <p className="text-xs text-gray-500">{t("botDetail.blockedDesc")}</p>
                </div>
                <span className="text-sm text-gray-400">{t("common.above")} ${policy.requireApprovalUp.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-surface-card border border-surface-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("botDetail.allowedCategories")}</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {policy.allowedCategories.length === 0 && <span className="text-xs text-gray-600">{t("botDetail.allAllowed")}</span>}
                {policy.allowedCategories.map((cat) => (
                  <span key={cat} className="inline-flex items-center gap-1 px-2 py-1 bg-approved/10 text-approved text-xs rounded">
                    {cat}
                    <button onClick={() => removeFromList("allowedCategories", cat)} className="hover:text-white">&times;</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newAllowedCat} onChange={(e) => setNewAllowedCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addToList("allowedCategories", newAllowedCat, setNewAllowedCat)} placeholder={t("common.add")} className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />
                <button onClick={() => addToList("allowedCategories", newAllowedCat, setNewAllowedCat)} className="px-2 py-1.5 text-xs bg-surface-hover text-gray-400 rounded-lg hover:text-white">+</button>
              </div>
            </div>
            <div className="bg-surface-card border border-surface-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("botDetail.blockedCategories")}</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {policy.blockedCategories.length === 0 && <span className="text-xs text-gray-600">{t("botDetail.noneBlocked")}</span>}
                {policy.blockedCategories.map((cat) => (
                  <span key={cat} className="inline-flex items-center gap-1 px-2 py-1 bg-blocked/10 text-blocked text-xs rounded">
                    {cat}
                    <button onClick={() => removeFromList("blockedCategories", cat)} className="hover:text-white">&times;</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newBlockedCat} onChange={(e) => setNewBlockedCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addToList("blockedCategories", newBlockedCat, setNewBlockedCat)} placeholder={t("common.add")} className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />
                <button onClick={() => addToList("blockedCategories", newBlockedCat, setNewBlockedCat)} className="px-2 py-1.5 text-xs bg-surface-hover text-gray-400 rounded-lg hover:text-white">+</button>
              </div>
            </div>
          </div>

          {/* Merchants */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-surface-card border border-surface-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("botDetail.merchantWhitelist")}</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {policy.merchantWhitelist.length === 0 && <span className="text-xs text-gray-600">{t("botDetail.allMerchants")}</span>}
                {policy.merchantWhitelist.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 px-2 py-1 bg-approved/10 text-approved text-xs rounded">
                    {m}
                    <button onClick={() => removeFromList("merchantWhitelist", m)} className="hover:text-white">&times;</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newWhitelist} onChange={(e) => setNewWhitelist(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addToList("merchantWhitelist", newWhitelist, setNewWhitelist)} placeholder={t("common.add")} className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />
                <button onClick={() => addToList("merchantWhitelist", newWhitelist, setNewWhitelist)} className="px-2 py-1.5 text-xs bg-surface-hover text-gray-400 rounded-lg hover:text-white">+</button>
              </div>
            </div>
            <div className="bg-surface-card border border-surface-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("botDetail.merchantBlacklist")}</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {policy.merchantBlacklist.length === 0 && <span className="text-xs text-gray-600">{t("botDetail.noMerchantBlocked")}</span>}
                {policy.merchantBlacklist.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 px-2 py-1 bg-blocked/10 text-blocked text-xs rounded">
                    {m}
                    <button onClick={() => removeFromList("merchantBlacklist", m)} className="hover:text-white">&times;</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newBlacklist} onChange={(e) => setNewBlacklist(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addToList("merchantBlacklist", newBlacklist, setNewBlacklist)} placeholder={t("common.add")} className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />
                <button onClick={() => addToList("merchantBlacklist", newBlacklist, setNewBlacklist)} className="px-2 py-1.5 text-xs bg-surface-hover text-gray-400 rounded-lg hover:text-white">+</button>
              </div>
            </div>
          </div>

          {/* Time Window */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">{t("botDetail.timeWindow")}</h3>
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-2">{t("botDetail.allowedDays")}</p>
              <div className="flex gap-2">
                {dayNames.map((dayName, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                      policy.allowedDays.includes(i)
                        ? "bg-brand-600 text-white"
                        : "bg-surface-hover text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {dayName}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t("botDetail.start")}</label>
                <select value={policy.allowedHoursStart} onChange={(e) => updateField("allowedHoursStart", Number(e.target.value))} className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
              <span className="text-gray-500 mt-5">{t("common.until")}</span>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t("botDetail.end")}</label>
                <select value={policy.allowedHoursEnd} onChange={(e) => updateField("allowedHoursEnd", Number(e.target.value))} className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
