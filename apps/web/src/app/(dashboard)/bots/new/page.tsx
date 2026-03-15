"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/nextjs";
import { createBot, upsertPolicy, linkTelegram } from "@/lib/api";
import type { CreateBotResult } from "@/lib/api";

const platforms = [
  {
    value: "TELEGRAM",
    label: "Telegram",
    color: "bg-[#0088cc]",
    borderColor: "border-[#0088cc]",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
      </svg>
    ),
  },
  {
    value: "WHATSAPP",
    label: "WhatsApp",
    color: "bg-[#25D366]",
    borderColor: "border-[#25D366]",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" />
      </svg>
    ),
  },
  {
    value: "CUSTOM_API",
    label: "Custom API",
    color: "bg-gray-600",
    borderColor: "border-gray-500",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
      </svg>
    ),
  },
  {
    value: "DISCORD",
    label: "Discord",
    color: "bg-[#5865F2]",
    borderColor: "border-[#5865F2]",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
      </svg>
    ),
  },
  {
    value: "SLACK",
    label: "Slack",
    color: "bg-[#1a1a2e]",
    borderColor: "border-[#611f69]",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 20h-4v-4h4v4zm-6 0h-4v-4h4v4zm-6 0H4v-4h4v4zm12-6h-4v-4h4v4zm-6 0h-4v-4h4v4zm-6 0H4v-4h4v4zm12-6h-4V4h4v4zm-6 0h-4V4h4v4zm-6 0H4V4h4v4z" />
      </svg>
    ),
  },
];

type Step = 1 | 2 | 3 | 4;

export default function NewBotPage() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("CUSTOM_API");

  // Step 2
  const [maxPerPurchase, setMaxPerPurchase] = useState(50);
  const [dailyLimit, setDailyLimit] = useState(200);
  const [autoApprove, setAutoApprove] = useState(25);

  // Step 3
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkInstructions, setLinkInstructions] = useState<string | null>(null);
  const [linkingTelegram, setLinkingTelegram] = useState(false);

  // Step 4
  const [createdBot, setCreatedBot] = useState<CreateBotResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleNext = () => setStep((s) => Math.min(s + 1, 4) as Step);
  const handleBack = () => setStep((s) => Math.max(s - 1, 1) as Step);

  const handleLinkTelegram = async () => {
    setLinkingTelegram(true);
    try {
      const token = await getToken();
      const result = await linkTelegram(token);
      setLinkCode(result.code);
      setLinkInstructions(result.instructions);
      setTelegramEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("newBot.failedTelegram"));
    } finally {
      setLinkingTelegram(false);
    }
  };

  const handleCreateBot = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const result = await createBot(name.trim(), platform, token);

      try {
        await upsertPolicy(result.id, {
          maxPerTransaction: maxPerPurchase,
          maxPerDay: dailyLimit,
          maxPerWeek: dailyLimit * 5,
          maxPerMonth: dailyLimit * 25,
          autoApproveLimit: autoApprove,
          requireApprovalUp: maxPerPurchase,
        }, token);
      } catch {
        // Bot created with default policy
      }

      setCreatedBot(result);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("newBot.failedCreate"));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const steps = [t("newBot.step1"), t("newBot.step2"), t("newBot.step3"), t("newBot.step4")];

  return (
    <div className="max-w-xl mx-auto mt-12">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                i + 1 === step
                  ? "bg-brand-600 text-white"
                  : i + 1 < step
                  ? "bg-approved/20 text-approved"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {i + 1 < step ? "\u2713" : i + 1}
            </div>
            <span className={`text-xs ${i + 1 === step ? "text-gray-900" : "text-gray-500"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="w-4 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-blocked/10 border border-blocked/20 px-4 py-2 text-sm text-blocked">
          {error}
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900">{t("newBot.nameTitle")}</h2>
          <p className="text-sm text-gray-500">{t("newBot.nameDesc")}</p>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("newBot.botName")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("newBot.botNamePlaceholder")}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-2">{t("newBot.platform")}</label>
            <div className="flex flex-wrap gap-3">
              {platforms.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlatform(p.value)}
                  className={`flex flex-col items-center justify-center w-[100px] h-[100px] rounded-xl border-2 transition-all ${
                    platform === p.value
                      ? "border-brand-500 bg-brand-500/10 text-gray-900"
                      : "border-gray-200 bg-gray-50 hover:border-gray-500 text-gray-600 hover:text-gray-800"
                  }`}
                >
                  <div className={`flex items-center justify-center w-12 h-12 rounded-lg mb-1.5 ${
                    platform === p.value ? p.color + " text-white" : "bg-gray-100 text-gray-600"
                  }`}>
                    {p.icon}
                  </div>
                  <span className="text-xs font-medium">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={handleNext}
              disabled={!name.trim()}
              className="px-6 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="text-xl font-bold text-gray-900">{t("newBot.limitsTitle")}</h2>
          <p className="text-sm text-gray-500">{t("newBot.limitsDesc")}</p>

          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-500">{t("newBot.maxPerPurchase")}</label>
              <span className="text-xs text-gray-900 font-medium">${maxPerPurchase}</span>
            </div>
            <input
              type="range"
              min={1}
              max={500}
              value={maxPerPurchase}
              onChange={(e) => setMaxPerPurchase(Number(e.target.value))}
              className="w-full accent-brand-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>$1</span>
              <span>$500</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-500">{t("newBot.dailyLimit")}</label>
              <span className="text-xs text-gray-900 font-medium">${dailyLimit}</span>
            </div>
            <input
              type="range"
              min={10}
              max={2000}
              step={10}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
              className="w-full accent-brand-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>$10</span>
              <span>$2,000</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-500">{t("newBot.autoApproveUpTo")}</label>
              <span className="text-xs text-gray-900 font-medium">${autoApprove}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={autoApprove}
              onChange={(e) => setAutoApprove(Number(e.target.value))}
              className="w-full accent-brand-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>$0</span>
              <span>$100</span>
            </div>
          </div>

          {autoApprove > maxPerPurchase && (
            <div className="rounded-lg bg-pending/10 border border-pending/20 px-3 py-2 text-xs text-pending">
              {t("newBot.autoApproveWarning", { auto: autoApprove, max: maxPerPurchase })}
            </div>
          )}

          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
            <p>{t("newBot.weekly")}: <span className="text-gray-900">${(dailyLimit * 5).toLocaleString()}</span></p>
            <p>{t("newBot.monthly")}: <span className="text-gray-900">${(dailyLimit * 25).toLocaleString()}</span></p>
            <p>{t("newBot.humanApproval")}: <span className="text-gray-900">${autoApprove} — ${maxPerPurchase}</span></p>
            <p>{t("newBot.blocked")}: <span className="text-gray-900">{t("common.above")} ${maxPerPurchase}</span></p>
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={handleBack} className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
              {t("common.back")}
            </button>
            <button
              onClick={handleNext}
              disabled={autoApprove > maxPerPurchase}
              className="px-6 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="text-xl font-bold text-gray-900">{t("newBot.notifTitle")}</h2>
          <p className="text-sm text-gray-500">
            {t("newBot.notifDesc")}
          </p>

          {!linkCode ? (
            <div className="space-y-3">
              <button
                onClick={handleLinkTelegram}
                disabled={linkingTelegram}
                className="w-full py-3 bg-[#0088cc] text-white text-sm font-medium rounded-lg hover:bg-[#0077b5] transition-colors disabled:opacity-50"
              >
                {linkingTelegram ? t("newBot.generatingCode") : t("newBot.connectTelegram")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-[#0088cc]/10 border border-[#0088cc]/20 p-4 text-center">
                <p className="text-xs text-gray-600 mb-2">{t("newBot.linkCode")}</p>
                <p className="text-3xl font-mono font-bold text-gray-900 tracking-widest">{linkCode}</p>
              </div>
              <p className="text-xs text-gray-600">{linkInstructions}</p>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={handleBack} className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
              {t("common.back")}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => handleCreateBot()}
                className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                {t("common.skip")}
              </button>
              <button
                onClick={handleCreateBot}
                disabled={creating}
                className="px-6 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
              >
                {creating ? t("newBot.creating") : t("newBot.createBot")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4 */}
      {step === 4 && createdBot && (
        <div className="bg-white border border-approved/30 rounded-xl p-6 space-y-5">
          {/* Celebration header */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-approved/20 mb-1">
              <svg className="w-8 h-8 text-approved" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-approved">{t("newBot.doneTitle")}</h2>
            <p className="text-sm text-gray-600">
              <span className="text-gray-900 font-medium">{createdBot.name}</span> {t("newBot.doneDesc", { name: "" }).trim()}
            </p>
          </div>

          {/* API Key section */}
          <div>
            <label className="block text-xs font-semibold text-blocked mb-2">
              {t("newBot.apiKeyWarning")}
            </label>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
              <code className="flex-1 text-xs text-gray-900 font-mono break-all select-all">
                {createdBot.apiKey}
              </code>
              <button
                onClick={() => handleCopy(createdBot.apiKey)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors shrink-0 ${
                  copied ? "bg-approved/20 text-approved" : "bg-gray-100 text-gray-600 hover:text-gray-900"
                }`}
              >
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>

          {/* Collapsible developer details */}
          <details className="group">
            <summary className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 hover:text-gray-300 transition-colors select-none">
              <svg className="w-4 h-4 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
              </svg>
              {t("newBot.showDevDetails")}
            </summary>
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-2">{t("newBot.installLabel")}</label>
              <pre className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs text-gray-600 overflow-x-auto">
                <code>{`import { PayJarvis } from "@payjarvis/agent-sdk";

const pj = new PayJarvis({
  apiKey: "${createdBot.apiKey}",
  botId: "${createdBot.id}",
});

const decision = await pj.requestPayment({
  merchantName: "Amazon",
  amount: 29.99,
  currency: "USD",
  category: "shopping",
});

if (decision.approved) {
  // BDIT token em decision.bditToken
  // Apresente ao merchant no checkout
}`}</code>
              </pre>
            </div>
          </details>

          {/* Action buttons */}
          <div className="space-y-2 pt-1">
            <button
              onClick={() => router.push(`/bots/${createdBot.id}`)}
              className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors"
            >
              {t("newBot.testAssistant")}
            </button>
            <button
              onClick={() => router.push("/bots")}
              className="w-full py-2.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 hover:text-gray-900 transition-colors"
            >
              {t("newBot.goToDashboard")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
