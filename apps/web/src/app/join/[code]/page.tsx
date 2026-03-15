"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { getSharePreview, cloneSharedBot } from "@/lib/api";
import type { SharePreview } from "@/lib/api";

const skillIcons: Record<string, string> = {
  amazon: "🛒",
  walmart: "🏪",
  target: "🎯",
  cvs: "💊",
  walgreens: "💊",
  publix: "🛒",
  macys: "👗",
  flights: "✈️",
  hotels: "🏨",
  restaurants: "🍽️",
};

function SkillPill({ skill }: { skill: string }) {
  const icon = skillIcons[skill.toLowerCase()] ?? "⚡";
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-sm text-white/90 border border-white/10">
      <span>{icon}</span>
      <span className="capitalize">{skill}</span>
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const label = platform === "WHATSAPP" ? "Bot do WhatsApp" : platform === "TELEGRAM" ? "Bot do Telegram" : `Bot ${platform}`;
  const color = platform === "WHATSAPP" ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-blue-500/20 text-blue-300 border-blue-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${color}`}>
      {platform === "WHATSAPP" ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zm0 14H6l-2 2V4h16v12z" /></svg>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      )}
      {label}
    </span>
  );
}

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const { isSignedIn, getToken } = useAuth();
  const code = params.code as string;

  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  useEffect(() => {
    getSharePreview(code)
      .then(setPreview)
      .catch(() => setError("Link de compartilhamento não encontrado"))
      .finally(() => setLoading(false));
  }, [code]);

  const handleClone = async () => {
    setCloning(true);
    setCloneError(null);
    try {
      const token = await getToken();
      const result = await cloneSharedBot(code, token);

      if (result.alreadyHasBot) {
        router.push("/bots");
        return;
      }

      const botId = (result.bot as any).id;
      if (result.nextStep === "configure_telegram") {
        router.push(`/bots/${botId}?setup=telegram`);
      } else if (result.nextStep === "configure_whatsapp") {
        router.push(`/bots/${botId}?setup=whatsapp`);
      } else {
        router.push(`/bots/${botId}`);
      }
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Erro ao clonar bot");
    } finally {
      setCloning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="h-20 w-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link não encontrado</h1>
          <p className="text-gray-400 mb-6">Este link de compartilhamento não existe ou expirou.</p>
          <a href="/" className="px-6 py-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors text-sm font-medium">
            Ir para o PayJarvis
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950/30 to-gray-950 flex flex-col">
      {/* Top bar */}
      <div className="p-4 sm:p-6">
        <a href="/" className="text-sm font-bold text-white/60 hover:text-white/80 tracking-wider transition-colors">
          PAYJARVIS
        </a>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4 pb-12">
        <div className="max-w-md w-full space-y-6">
          {/* Bot avatar */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/25">
                <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="8.5" cy="16" r="1" />
                  <circle cx="15.5" cy="16" r="1" />
                  <path d="M12 11V5" />
                  <path d="M8 5h8" />
                  <circle cx="12" cy="3.5" r="1.5" />
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 h-6 w-6 bg-green-500 rounded-full border-2 border-gray-950 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="text-center space-y-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
              {preview.sharedByName} está compartilhando o{" "}
              <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                {preview.botName}
              </span>{" "}
              com você
            </h1>
            <PlatformBadge platform={preview.platform} />
          </div>

          {/* Skills */}
          {preview.skills.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {preview.skills.map((skill) => (
                <SkillPill key={skill} skill={skill} />
              ))}
            </div>
          )}

          {/* Social proof */}
          {preview.useCount > 0 && (
            <div className="flex items-center justify-center gap-2 text-sm text-white/50">
              <div className="flex -space-x-2">
                {[...Array(Math.min(preview.useCount, 3))].map((_, i) => (
                  <div key={i} className="h-6 w-6 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 border-2 border-gray-950 flex items-center justify-center text-[10px] text-white/70 font-bold">
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
              </div>
              <span>{preview.useCount} {preview.useCount === 1 ? "pessoa já está usando" : "pessoas já estão usando"}</span>
            </div>
          )}

          {/* Feature card */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wider">O que este bot faz</h3>
            <ul className="space-y-2.5">
              {[
                "Busca produtos automaticamente",
                "Compara preços em múltiplas lojas",
                "Envia link direto para seu carrinho",
                `Aprovação por mensagem no ${preview.platform === "WHATSAPP" ? "WhatsApp" : "Telegram"}`,
                "Limites de gasto configuráveis",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-white/70">
                  <svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          {!preview.valid ? (
            <div className="text-center p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-300 text-sm">Este link expirou ou atingiu o limite de usos.</p>
            </div>
          ) : isSignedIn ? (
            <div className="space-y-3">
              <button
                onClick={handleClone}
                disabled={cloning}
                className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-400 hover:to-purple-500 transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/25 text-base"
              >
                {cloning ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Clonando...
                  </span>
                ) : (
                  "Clonar este Bot"
                )}
              </button>
              {cloneError && (
                <p className="text-center text-sm text-red-400">{cloneError}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <a
                href={`/sign-up?ref=${code}&redirect_url=/join/${code}`}
                className="block w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-400 hover:to-purple-500 transition-all text-center shadow-lg shadow-indigo-500/25 text-base"
              >
                Ativar meu Bot Grátis
              </a>
              <p className="text-center text-sm text-white/40">
                Já tem conta?{" "}
                <a href={`/sign-in?redirect_url=/join/${code}`} className="text-indigo-400 hover:text-indigo-300 underline">
                  Entrar
                </a>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 text-center text-xs text-white/20">
        PayJarvis — Bot Payment Identity
      </div>
    </div>
  );
}
