"use client";

import { useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Step = "email" | "code" | "new-password" | "success";

export default function ForgotPasswordPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isLoaded) return null;

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn!.create({
        strategy: "reset_password_email_code",
        identifier: email,
      });
      setStep("code");
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || "Erro ao enviar código.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn!.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
      });

      if (result.status === "needs_new_password") {
        setStep("new-password");
      } else {
        setError("Código inválido ou expirado.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || "Código inválido.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }

    setLoading(true);

    try {
      const result = await signIn!.resetPassword({
        password,
        signOutOfOtherSessions: true,
      });

      if (result.status === "complete") {
        await setActive!({ session: result.createdSessionId });
        setStep("success");
        setTimeout(() => router.push("/dashboard"), 2000);
      } else {
        setError("Erro ao redefinir senha. Tente novamente.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || "Erro ao redefinir senha.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Shared layout wrapper
  function AuthWrapper({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="hero-mesh fixed inset-0 pointer-events-none" />
        <div className="grid-pattern fixed inset-0 pointer-events-none opacity-30" />
        <div className="relative w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-display font-bold text-gradient-brand">PayJarvis</h1>
            <p className="text-gray-400 mt-2 font-body text-sm">AI Commerce Governance Platform</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-xl">
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Step 1: Enter email
  if (step === "email") {
    return (
      <AuthWrapper>
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-600/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-display font-semibold text-gray-900 mb-2 text-center">
          Recuperar senha
        </h2>
        <p className="text-gray-400 text-sm text-center mb-6">
          Informe seu email e enviaremos um código de recuperação.
        </p>

        <form onSubmit={handleSendCode} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-200 shadow-lg shadow-brand-600/20"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Enviando...
              </span>
            ) : (
              "Enviar código"
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/sign-in" className="text-sm text-gray-400 hover:text-brand-400 transition-colors">
            Voltar para login
          </Link>
        </div>
      </AuthWrapper>
    );
  }

  // Step 2: Enter verification code
  if (step === "code") {
    return (
      <AuthWrapper>
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-600/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-display font-semibold text-gray-900 mb-2 text-center">
          Verifique seu email
        </h2>
        <p className="text-gray-400 text-sm text-center mb-6">
          Enviamos um código para <span className="text-gray-900 font-medium">{email}</span>
        </p>

        <form onSubmit={handleVerifyCode} className="space-y-5">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1.5">
              Código de recuperação
            </label>
            <input
              id="code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-200 shadow-lg shadow-brand-600/20"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verificando...
              </span>
            ) : (
              "Verificar código"
            )}
          </button>
        </form>

        <div className="mt-4 flex justify-between">
          <button
            onClick={() => { setStep("email"); setError(""); setCode(""); }}
            className="text-sm text-gray-400 hover:text-brand-400 transition-colors"
          >
            Alterar email
          </button>
          <button
            onClick={() => handleSendCode({ preventDefault: () => {} } as React.FormEvent)}
            className="text-sm text-gray-400 hover:text-brand-400 transition-colors"
          >
            Reenviar código
          </button>
        </div>
      </AuthWrapper>
    );
  }

  // Step 3: Set new password
  if (step === "new-password") {
    return (
      <AuthWrapper>
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-display font-semibold text-gray-900 mb-2 text-center">
          Nova senha
        </h2>
        <p className="text-gray-400 text-sm text-center mb-6">
          Set your new password to access PayJarvis.
        </p>

        <form onSubmit={handleResetPassword} className="space-y-5">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
              Nova senha
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
              Confirmar nova senha
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-accent hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed text-surface font-semibold rounded-lg transition-all duration-200 shadow-lg shadow-accent/20"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Redefinindo...
              </span>
            ) : (
              "Redefinir senha"
            )}
          </button>
        </form>
      </AuthWrapper>
    );
  }

  // Step 4: Success
  return (
    <AuthWrapper>
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-full bg-approved/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-approved" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
      </div>

      <h2 className="text-xl font-display font-semibold text-gray-900 mb-2 text-center">
        Senha redefinida!
      </h2>
      <p className="text-gray-400 text-sm text-center mb-6">
        Sua senha foi alterada com sucesso. Redirecionando para o dashboard...
      </p>

      <div className="flex justify-center">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    </AuthWrapper>
  );
}
