"use client";

import TrustBadges from "@/components/TrustBadges";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 overflow-hidden">
      {/* ─── NAVBAR ─── */}
      <nav className="sticky top-0 z-50 border-b border-gray-200/60 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <span className="text-sm font-bold text-white">P</span>
            </div>
            <span className="font-display text-lg font-bold text-gray-900">PayJarvis</span>
          </a>

          <div className="hidden items-center gap-8 sm:flex">
            <a href="#features" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">Features</a>
            <a href="#pricing" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">Pricing</a>
            <a href="/docs" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">Docs</a>
            <a
              href="https://github.com/Josepassinato/Payjarvis"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
          </div>

          <a
            href="/sign-in"
            className="inline-flex items-center gap-2 rounded-lg border border-brand-600 bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-500 hover:border-brand-500"
          >
            Dashboard
          </a>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative">
        <div className="absolute inset-0 hero-mesh" />
        <div className="absolute inset-0 grid-pattern opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50" />

        <div className="absolute top-20 left-[10%] w-72 h-72 bg-brand-50 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-20 right-[10%] w-96 h-96 bg-accent/8 rounded-full blur-[140px] animate-float-delay" />

        <div className="relative mx-auto max-w-6xl px-6 pt-32 pb-24 sm:pt-40 sm:pb-32">
          <div className="text-center">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-brand-500/20 bg-brand-600/5 px-5 py-2 backdrop-blur-sm animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-approved opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-approved" />
              </span>
              <span className="text-sm font-medium text-gray-700">Open-source &middot; Apache 2.0 &middot; Production-ready</span>
            </div>

            <h1 className="mb-6 font-display text-5xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl opacity-0 animate-fade-in-delay-1">
              <span className="block">Spending Firewall</span>
              <span className="block text-gradient-brand">for AI Agents</span>
            </h1>

            <p className="mx-auto mb-4 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl opacity-0 animate-fade-in-delay-2">
              Granular spending controls, cryptographic identity (BDIT) with offline verification via JWKS, and dynamic CredScore.
            </p>

            <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-gray-500 opacity-0 animate-fade-in-delay-2">
              PayJarvis lets developers define advanced spending policies per category, monitor agent behavior, and keep human approval in the loop when needed.
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row opacity-0 animate-fade-in-delay-3">
              <a
                href="https://github.com/Josepassinato/Payjarvis"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex items-center gap-2 rounded-xl bg-gray-900 px-8 py-4 font-semibold text-white shadow-lg shadow-gray-900/25 transition-all duration-300 hover:bg-gray-800 hover:scale-[1.03]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Explore on GitHub
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-xl border border-brand-600 bg-brand-600 px-8 py-4 font-semibold text-white transition-all duration-300 hover:bg-brand-500 hover:border-brand-500"
              >
                Try Hosted Free Tier
              </a>
            </div>
          </div>

          {/* Hero visual — agent flow */}
          <div className="mt-20 mx-auto max-w-2xl opacity-0 animate-fade-in-delay-3">
            <div className="rounded-2xl border border-gray-200/60 bg-white/50 backdrop-blur-md p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 border border-gray-200">
                    <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-gray-500">Your Agent</div>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div className="h-px w-12 sm:w-20 bg-gradient-to-r from-gray-200 to-brand-500/50" />
                  <span className="text-[10px] text-gray-500 font-mono">SDK call</span>
                </div>

                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/15 border border-brand-500/30">
                    <span className="text-lg font-bold text-gradient-brand">P</span>
                  </div>
                  <div className="text-sm font-bold text-gradient-brand">PayJarvis</div>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div className="h-px w-12 sm:w-20 bg-gradient-to-r from-brand-500/50 to-accent/50" />
                  <span className="text-[10px] text-gray-500 font-mono">approve</span>
                </div>

                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 border border-accent/20">
                    <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-gray-500">Gateway</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">Platform</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Everything your agent needs to spend securely
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500 text-lg">
            Lightweight SDK, robust governance, and integration with major payment gateways.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                ),
                gradient: "from-brand-600/20 via-brand-500/5 to-transparent",
                borderHover: "hover:border-brand-500/40",
                iconColor: "text-brand-400",
                title: "Spending Firewall",
                desc: "Granular policies by category, merchant, amount, and frequency. Rules Engine evaluates every transaction in real time.",
                cta: "View docs",
                link: "/docs",
              },
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                ),
                gradient: "from-accent/15 via-accent/5 to-transparent",
                borderHover: "hover:border-accent/40",
                iconColor: "text-accent",
                title: "Agent SDK",
                desc: "One line of code to connect your agent. TypeScript-first, full type safety, streaming and webhook support.",
                cta: "Install SDK",
                link: "/docs",
              },
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                  </svg>
                ),
                gradient: "from-purple-500/15 via-purple-500/5 to-transparent",
                borderHover: "hover:border-purple-500/40",
                iconColor: "text-purple-400",
                title: "BDIT Identity",
                desc: "Cryptographic identity per agent with offline verification via JWKS. RS256 signed and auditable tokens.",
                cta: "Learn about BDIT",
                link: "/docs",
              },
            ].map((card) => (
              <a
                key={card.title}
                href={card.link}
                className={`group relative rounded-2xl border border-gray-200 bg-gradient-to-b ${card.gradient} p-8 transition-all duration-300 ${card.borderHover} hover:translate-y-[-4px] hover:shadow-xl hover:shadow-black/20`}
              >
                <div className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100/80 ${card.iconColor}`}>
                  {card.icon}
                </div>
                <h3 className="mb-3 font-display text-xl font-bold text-gray-900">{card.title}</h3>
                <p className="mb-6 text-gray-500 leading-relaxed">{card.desc}</p>
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${card.iconColor} transition-all group-hover:gap-2.5`}>
                  {card.cta}
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECURITY — 4 LAYERS ─── */}
      <section className="relative border-t border-gray-200/40 bg-white/30">
        <div className="absolute inset-0 hero-mesh opacity-40" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">Security</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Four security layers designed for production
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-gray-500 text-lg">
            Every transaction goes through multi-layer verification before execution. Full control over what your agent can spend.
          </p>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                  </svg>
                ),
                color: "text-brand-400",
                bg: "bg-brand-50",
                title: "KYC + Dynamic CredScore",
                desc: "Owner identity verification with a trust score that evolves based on agent behavior.",
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                ),
                color: "text-accent",
                bg: "bg-accent/10",
                title: "Spending Firewall + Rules Engine",
                desc: "Limits per transaction, day, week, and month. Allowed categories, blocked merchants, restricted hours.",
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                ),
                color: "text-approved",
                bg: "bg-approved/10",
                title: "Human-in-the-Loop",
                desc: "Human approval via Telegram or SSE dashboard. Configurable timeout with fallback to block.",
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                ),
                color: "text-purple-400",
                bg: "bg-purple-500/10",
                title: "Immutable Audit Log",
                desc: "Every action logged in append-only format with hash chain. Exportable via API for compliance.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="group rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm p-6 transition-all duration-300 hover:border-gray-300 hover:translate-y-[-2px]"
              >
                <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${card.bg} ${card.color}`}>
                  {card.icon}
                </div>
                <h3 className="mb-2 font-display text-lg font-bold text-gray-900">{card.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CREDSCORE ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">Trust</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Dynamic CredScore
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-gray-500 text-lg">
            Behavioral score from 0 to 100 that evolves with every transaction. Asymmetric: success grows gradually, failure penalizes heavily.
          </p>

          <div className="mx-auto max-w-3xl">
            {/* Score levels */}
            <div className="grid gap-4 sm:grid-cols-4 mb-12">
              {[
                { level: "LOW", range: "0 - 49", color: "bg-red-500", textColor: "text-red-600", bgLight: "bg-red-50 border-red-100", desc: "Requires manual approval" },
                { level: "MEDIUM", range: "50 - 75", color: "bg-amber-500", textColor: "text-amber-600", bgLight: "bg-amber-50 border-amber-100", desc: "Reduced limits" },
                { level: "HIGH", range: "76 - 90", color: "bg-blue-500", textColor: "text-blue-600", bgLight: "bg-blue-50 border-blue-100", desc: "Normal operation" },
                { level: "TRUSTED", range: "91 - 100", color: "bg-emerald-500", textColor: "text-emerald-600", bgLight: "bg-emerald-50 border-emerald-100", desc: "Auto-approval" },
              ].map((item) => (
                <div key={item.level} className={`rounded-xl border ${item.bgLight} p-5 text-center`}>
                  <div className={`mb-2 inline-flex h-3 w-full rounded-full bg-gray-200 overflow-hidden`}>
                    <div className={`${item.color} rounded-full`} style={{ width: item.level === 'LOW' ? '35%' : item.level === 'MEDIUM' ? '62%' : item.level === 'HIGH' ? '83%' : '95%' }} />
                  </div>
                  <div className={`text-lg font-bold ${item.textColor}`}>{item.level}</div>
                  <div className="text-sm font-medium text-gray-700">{item.range}</div>
                  <div className="mt-1 text-xs text-gray-500">{item.desc}</div>
                </div>
              ))}
            </div>

            {/* Score composition */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8">
              <h3 className="mb-6 font-display text-lg font-bold text-gray-900 text-center">Score Composition</h3>
              <div className="space-y-4">
                {[
                  { label: "Transactions", pct: 45, color: "bg-brand-500", desc: "Success rate, volume, cancellations" },
                  { label: "Policies", pct: 22, color: "bg-accent", desc: "Rule adherence by category" },
                  { label: "Behavior", pct: 18, color: "bg-purple-500", desc: "Consistency, anomaly detection" },
                  { label: "External", pct: 15, color: "bg-emerald-500", desc: "Merchant feedback, KYC level" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-gray-700">{item.label}</span>
                      <span className="text-sm font-bold text-gray-900">{item.pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${item.pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{item.desc}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-gray-100 text-center">
                <p className="text-xs text-gray-400">Automatic temporal decay for inactive agents. Minimum score of 30 after decay.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── GATEWAYS SUPORTADOS ─── */}
      <section className="relative border-t border-gray-200/40 bg-white/30">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-brand-400">Payments</span>
          </div>
          <h2 className="mb-4 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Supported Gateways
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500 text-lg">
            Connect your agent to major payment processors. Secure tokenization and automated checkout.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {/* Visa */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 780 500" className="h-10 w-auto">
                  <path d="M293.2 348.7l33.4-195.8h53.3l-33.4 195.8h-53.3zm246.8-191c-10.6-4-27.2-8.3-47.9-8.3-52.8 0-90 26.6-90.2 64.7-.3 28.2 26.5 43.9 46.8 53.3 20.8 9.6 27.8 15.8 27.7 24.4-.1 13.2-16.6 19.2-32 19.2-21.4 0-32.7-3-50.3-10.2l-6.9-3.1-7.5 43.9c12.5 5.5 35.6 10.2 59.6 10.5 56.2 0 92.6-26.3 93-68.2.2-22.7-14.3-40-45.7-54.2-19-9.2-30.7-15.3-30.6-24.7 0-8.3 9.9-17.1 31.2-17.1 17.8-.3 30.7 3.6 40.8 7.6l4.9 2.3 7.4-43.4-.3.3zm137.3-4.8h-41.3c-12.8 0-22.4 3.5-28 16.3l-79.4 179.6h56.2s9.2-24.2 11.3-29.5c6.1 0 60.9.1 68.7.1 1.6 6.9 6.5 29.4 6.5 29.4h49.7l-43.3-196h-.4zm-65.8 126.4c4.4-11.3 21.4-54.8 21.4-54.8-.3.5 4.4-11.4 7.1-18.8l3.6 17s10.3 47 12.5 56.9h-44.6v-.3zM327.1 152.9L275 348.7h-53.5l-31.5-155.6c-1.9-7.2-3.6-9.8-9.4-12.9-9.5-4.9-25.2-9.5-39-12.4l.9-5h86.2c11 .2 19.7 7.2 22 19.7l21.3 107.4 52.6-127.1h56.4z" fill="#1A1F71"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Visa TAP</span>
            </div>

            {/* Mastercard */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 780 500" className="h-10 w-auto">
                  <circle cx="312" cy="250" r="150" fill="#EB001B"/>
                  <circle cx="468" cy="250" r="150" fill="#F79E1B"/>
                  <path d="M390 130.7c38.5 31.1 63.1 78.4 63.1 131.3s-24.6 100.2-63.1 131.3c-38.5-31.1-63.1-78.4-63.1-131.3s24.6-100.2 63.1-131.3z" fill="#FF5F00"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Mastercard AgentPay</span>
            </div>

            {/* Stripe */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 120 50" className="h-8 w-auto">
                  <path d="M112.5 25c0-8.3-4-12.5-11.7-12.5-4.6 0-8 1.6-10 4.3l-.7-3.5H82v37.5l8.8-1.9v-9.1c2 1.4 5 2.3 8 2.3 8 0 13.7-4.6 13.7-17.1zm-8.9 6.8c-2.7 0-4.3-.9-5.4-2.1V21c1.2-1.3 2.8-2.2 5.4-2.2 4.1 0 6.9 3.3 6.9 6.5s-2.8 6.5-6.9 6.5zM67.3 12.5c-4.3 0-7 2-8.5 3.5l-.6-2.7h-8v35l8.8-1.9v-8.5c1.5 1.1 3.8 2.6 7.5 2.6 7.6 0 14.5-5.6 14.5-17.5 0-11-7-10.5-13.7-10.5zm-2.2 22c-2.6 0-4.1-1-5.2-2.1V20.3c1.2-1.3 2.7-2 5.2-2 4.1 0 6.9 3.5 6.9 8s-2.8 8.2-6.9 8.2zM48 8.4l-8.8 1.9V47l8.8-1.9V8.4zm-8.8 7.8h8.8v-2.9h-8.8v2.9zM30.8 16.8l-.6-3.5H22v35l8.8-1.9V25.8c2-2.7 5.5-2.2 6.6-1.8v-8.1c-1.1-.4-5.2-1.2-6.6 1zm-17-1.6L5.5 17l-.1.5C7.2 13 11 12.5 13.2 12.5c7.2 0 10.2 5.3 10.2 11.8V47l-8.7-1.9V25c0-3.5-1.5-5.8-5.1-5.8-2.5 0-4 1.2-5 2.5l-.6-3.1V47L-4.8 45V12.5H5l.6 3.5c2-2.6 5-4.2 8.2-4.2z" fill="#635BFF" transform="translate(8,0)"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Stripe</span>
            </div>

            {/* PayPal */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 124 33" className="h-8 w-auto">
                  <path d="M46.2 6.7h-7c-.5 0-.9.3-1 .8L35 26.1c-.1.3.2.6.6.6h3.4c.5 0 .9-.3 1-.8l.8-5.3c.1-.5.5-.8 1-.8h2.3c4.8 0 7.6-2.3 8.3-6.9.3-2 0-3.6-1-4.7C50.3 7.1 48.5 6.7 46.2 6.7zm.8 6.8c-.4 2.6-2.4 2.6-4.3 2.6h-1.1l.8-4.8c0-.3.3-.5.6-.5h.5c1.3 0 2.5 0 3.2.8.4.4.5 1.1.3 1.9z" fill="#253B80"/>
                  <path d="M68.2 13.4h-3.4c-.3 0-.6.2-.6.5l-.1 1-.3-.4c-.8-1.2-2.6-1.6-4.4-1.6-4.1 0-7.6 3.1-8.3 7.5-.4 2.2.1 4.3 1.4 5.7 1.2 1.3 2.9 1.9 4.9 1.9 3.5 0 5.4-2.2 5.4-2.2l-.2.9c-.1.3.2.6.6.6h3.1c.5 0 .9-.3 1-.8l1.8-12.5c.1-.3-.2-.6-.6-.6zm-5.4 7.2c-.4 2.1-2 3.6-4.2 3.6-1.1 0-1.9-.3-2.5-1-.6-.7-.8-1.6-.6-2.6.3-2.1 2.1-3.6 4.1-3.6 1.1 0 1.9.4 2.5 1 .6.7.8 1.6.7 2.6z" fill="#253B80"/>
                  <path d="M88.4 13.4h-3.4c-.3 0-.7.2-.9.4l-5 7.4-2.1-7.1c-.1-.4-.5-.7-1-.7H72.7c-.4 0-.6.3-.5.7l4 11.7-3.8 5.3c-.3.4 0 .9.4.9h3.4c.3 0 .7-.2.9-.4l12.1-17.5c.3-.3 0-.7-.4-.7z" fill="#253B80"/>
                  <path d="M99.7 6.7h-7c-.5 0-.9.3-1 .8l-3.2 18.6c-.1.3.2.6.6.6h3.6c.3 0 .6-.2.7-.6l.9-5.5c.1-.5.5-.8 1-.8h2.3c4.8 0 7.6-2.3 8.3-6.9.3-2 0-3.6-1-4.7-1.1-1.1-2.9-1.5-5.2-1.5zm.9 6.8c-.4 2.6-2.4 2.6-4.3 2.6h-1.1l.8-4.8c0-.3.3-.5.6-.5h.5c1.3 0 2.5 0 3.2.8.3.4.5 1.1.3 1.9z" fill="#179BD7"/>
                  <path d="M121.7 13.4h-3.4c-.3 0-.6.2-.6.5l-.1 1-.3-.4c-.8-1.2-2.6-1.6-4.4-1.6-4.1 0-7.6 3.1-8.3 7.5-.4 2.2.1 4.3 1.4 5.7 1.2 1.3 2.9 1.9 4.9 1.9 3.5 0 5.4-2.2 5.4-2.2l-.2.9c-.1.3.2.6.6.6h3.1c.5 0 .9-.3 1-.8l1.8-12.5c.2-.3-.1-.6-.5-.6zm-5.4 7.2c-.4 2.1-2 3.6-4.2 3.6-1.1 0-1.9-.3-2.5-1-.6-.7-.8-1.6-.6-2.6.3-2.1 2.1-3.6 4.1-3.6 1.1 0 1.9.4 2.5 1 .7.7.9 1.6.7 2.6z" fill="#179BD7"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">PayPal</span>
            </div>

            {/* Braintree */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <span className="text-base font-bold text-gray-700 tracking-tight">Braintree</span>
              </div>
              <span className="text-xs font-medium text-gray-500">Braintree</span>
            </div>

            {/* Adyen */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <span className="text-lg font-bold text-[#0abf53] tracking-tight">adyen</span>
              </div>
              <span className="text-xs font-medium text-gray-500">Adyen</span>
            </div>
          </div>

          <p className="mt-10 text-center text-sm text-gray-400">
            All payments processed with tokenization. PayJarvis never stores card data. Webhooks from all gateways update CredScore automatically.
          </p>
        </div>
      </section>

      {/* ─── SDK PREVIEW ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-4xl px-6 py-24 sm:py-32">
          <h2 className="mb-4 text-center font-display text-3xl font-bold sm:text-4xl">
            Integrate in minutes
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-center text-gray-500">
            PayJarvis wraps every financial action your agent takes. One SDK. Full coverage.
          </p>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/30">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-blocked/60" />
              <span className="h-3 w-3 rounded-full bg-pending/60" />
              <span className="h-3 w-3 rounded-full bg-approved/60" />
              <span className="ml-3 text-xs text-gray-500 font-mono">agent.ts</span>
            </div>
            <pre className="overflow-x-auto p-6 text-sm leading-relaxed font-mono">
              <code><span className="code-keyword">{"import"}</span>{" { "}<span className="code-type">{"PayJarvis"}</span>{" } "}<span className="code-keyword">{"from"}</span>{" "}<span className="code-string">{'"@payjarvis/agent-sdk"'}</span>{"\n\n"}<span className="code-keyword">{"const"}</span>{" pj = "}<span className="code-type">{"PayJarvis"}</span>{"."}<span className="code-function">{"fromEnv"}</span>{"()\n\n"}<span className="code-keyword">{"const"}</span>{" decision = "}<span className="code-keyword">{"await"}</span>{" pj."}<span className="code-function">{"requestApproval"}</span>{"({\n  amount: "}<span className="text-amber-300">{"450"}</span>{",\n  currency: "}<span className="code-string">{'"USD"'}</span>{",\n  merchant: "}<span className="code-string">{'"stripe"'}</span>{",\n  category: "}<span className="code-string">{'"marketing"'}</span>{",\n  minCredScore: "}<span className="text-amber-300">{"75"}</span>{",\n  purpose: "}<span className="code-string">{'"api_credits"'}</span>{"\n})\n\n"}<span className="code-comment">{"// ✅ Human approved via Telegram"}</span>{"\nconsole.log(decision.status) "}<span className="code-comment">{"// \"approved\""}</span></code>
            </pre>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2">
            <span className="text-accent font-mono text-sm">$</span>
            <code className="text-sm text-gray-500 font-mono">npm install @payjarvis/agent-sdk</code>
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" className="relative border-t border-gray-200/40 bg-white/30">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">Pricing</span>
          </div>
          <h2 className="mb-4 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Same code. You choose how to run it.
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500 text-lg">
            Free self-hosted or managed with SLA. Same API, same security.
          </p>

          <div className="grid gap-8 md:grid-cols-3">
            {/* Self-Hosted */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:shadow-lg">
              <div className="mb-4">
                <h3 className="font-display text-xl font-bold text-gray-900">Self-Hosted</h3>
                <p className="text-sm text-gray-500">For teams with their own infrastructure</p>
              </div>
              <div className="mb-6">
                <span className="font-display text-4xl font-extrabold text-gray-900">$0</span>
                <span className="text-gray-500 ml-1">/forever</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-gray-600">
                {["Full source code (Apache 2.0)", "All features included", "Basic CredScore", "BDIT + JWKS", "GitHub community support", "You manage infra + SSL"].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <svg className="h-5 w-5 text-approved flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="https://github.com/Josepassinato/Payjarvis"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition-all hover:border-gray-500 hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Clone from GitHub
              </a>
            </div>

            {/* Hosted Pro */}
            <div className="rounded-2xl border-2 border-brand-500 bg-white p-8 shadow-lg shadow-brand-500/10 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-brand-600 px-4 py-1 text-xs font-bold text-white">Recommended</span>
              </div>
              <div className="mb-4">
                <h3 className="font-display text-xl font-bold text-gray-900">Hosted Pro</h3>
                <p className="text-sm text-gray-500">For startups and scale-ups</p>
              </div>
              <div className="mb-6">
                <span className="font-display text-4xl font-extrabold text-gray-900">$49</span>
                <span className="text-gray-500 ml-1">/month</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-gray-600">
                {["Everything in Self-Hosted +", "Managed infra + 99.9% SLA", "AI-powered CredScore", "Advanced analytics", "Pre-configured integrations", "Email + Slack support", "Managed SSL + BDIT keys", "Automatic updates"].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <svg className="h-5 w-5 text-brand-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/sign-up"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition-all hover:bg-brand-500"
              >
                Get started
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>

            {/* Enterprise */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:shadow-lg">
              <div className="mb-4">
                <h3 className="font-display text-xl font-bold text-gray-900">Enterprise</h3>
                <p className="text-sm text-gray-500">For large-scale operations</p>
              </div>
              <div className="mb-6">
                <span className="font-display text-4xl font-extrabold text-gray-900">Custom</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-gray-600">
                {["Everything in Hosted Pro +", "Dedicated or on-premise deploy", "Multi-agent governance", "Zero-knowledge proofs", "Custom SLA", "Priority 24/7 support", "Dedicated onboarding", "Compliance + audit reports"].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <svg className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="mailto:enterprise@payjarvis.com"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition-all hover:border-gray-500 hover:bg-gray-50"
              >
                Talk to sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ─── ROADMAP ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-4xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-brand-400">Roadmap</span>
          </div>
          <h2 className="mb-12 text-center font-display text-3xl font-bold sm:text-4xl">
            What&apos;s coming next
          </h2>

          <div className="space-y-6">
            {[
              { quarter: "Q2 2026", title: "Native Payment Gateways", desc: "Stripe + PayPal fully integrated. Visa TAP with CredScore embedded in BDIT payload.", status: "In progress", color: "bg-brand-500" },
              { quarter: "Q3 2026", title: "Analytics + AI", desc: "Advanced analytics dashboard. AI-powered policy optimization suggestions. Predictive alerts.", status: "Planned", color: "bg-amber-500" },
              { quarter: "Q4 2026", title: "Multi-Agent Governance", desc: "Governance for agent fleets. Zero-knowledge proofs for sensitive transactions. A2A Protocol.", status: "Planned", color: "bg-purple-500" },
            ].map((item) => (
              <div key={item.quarter} className="flex gap-6 rounded-2xl border border-gray-200 bg-white p-6 transition-all hover:shadow-md">
                <div className="flex-shrink-0">
                  <span className={`inline-flex items-center rounded-lg ${item.color} px-3 py-1.5 text-xs font-bold text-white`}>
                    {item.quarter}
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-gray-900">{item.title}</h3>
                  <p className="mt-1 text-sm text-gray-500">{item.desc}</p>
                  <span className="mt-2 inline-block text-xs font-medium text-gray-400">{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TRUST BADGES ─── */}
      <TrustBadges />

      {/* ─── CHANNELS ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-brand-400">Channels</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Human-in-the-Loop everywhere
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-gray-500 text-lg">
            Receive approval requests and resolve handoffs across your preferred communication channel.
          </p>

          <div className="mx-auto max-w-3xl grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: "Telegram", status: "live", icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" },
              { name: "SSE / WebSocket", status: "live", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
              { name: "Dashboard", status: "live", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
              { name: "Slack", status: "soon", quarter: "Q2 2026", icon: "M14.5 2c-.83 0-1.5.67-1.5 1.5v5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5zM20 7.5c0-.83-.67-1.5-1.5-1.5h-2v2h2c.83 0 1.5-.67 1.5-1.5zM9.5 22c.83 0 1.5-.67 1.5-1.5v-5c0-.83-.67-1.5-1.5-1.5S8 14.67 8 15.5v5c0 .83.67 1.5 1.5 1.5zM4 16.5c0 .83.67 1.5 1.5 1.5h2v-2h-2c-.83 0-1.5.67-1.5 1.5zM22 14.5c0 .83-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5zM16.5 20v-2h-2v2c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5z" },
              { name: "Email", status: "soon", quarter: "Q2 2026", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
              { name: "Microsoft Teams", status: "soon", quarter: "Q3 2026", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
            ].map((ch) => (
              <div key={ch.name} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:shadow-md">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${ch.status === "live" ? "bg-brand-600/10 text-brand-500" : "bg-gray-100 text-gray-400"}`}>
                  <svg className="h-5 w-5" fill={ch.name === "Telegram" ? "currentColor" : "none"} viewBox="0 0 24 24" stroke={ch.name === "Telegram" ? "none" : "currentColor"} strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={ch.icon} />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{ch.name}</div>
                </div>
                {ch.status === "live" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
                    {ch.quarter}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── INTEGRATIONS STATUS ─── */}
      <section className="relative border-t border-gray-200/40 bg-white/30">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">Integrations</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            Integration Status
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-gray-500 text-lg">
            Full transparency on what&apos;s live, what&apos;s compatible, and what&apos;s coming next.
          </p>

          <div className="mx-auto max-w-3xl space-y-3">
            {[
              { name: "BDIT (RS256 + JWKS)", status: "Live", color: "emerald" },
              { name: "Rules Engine", status: "Live", color: "emerald" },
              { name: "CredScore", status: "Live", color: "emerald" },
              { name: "Visa TAP", status: "Compatible", color: "blue" },
              { name: "Anthropic MCP", status: "Native", color: "purple" },
              { name: "Stripe", status: "Q2 2026", color: "gray" },
              { name: "PayPal", status: "Q2 2026", color: "gray" },
              { name: "Mastercard AgentPay", status: "Registering", color: "amber" },
            ].map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4 transition-all hover:shadow-sm">
                <span className="font-medium text-gray-900">{item.name}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  item.color === "emerald" ? "bg-emerald-50 text-emerald-600" :
                  item.color === "blue" ? "bg-blue-50 text-blue-600" :
                  item.color === "purple" ? "bg-purple-50 text-purple-600" :
                  item.color === "amber" ? "bg-amber-50 text-amber-600" :
                  "bg-gray-100 text-gray-500"
                }`}>
                  {(item.color === "emerald" || item.color === "blue" || item.color === "purple") && (
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      item.color === "emerald" ? "bg-emerald-500" :
                      item.color === "blue" ? "bg-blue-500" :
                      "bg-purple-500"
                    }`} />
                  )}
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── OPEN SOURCE + PROMO ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-4xl px-6 py-24 sm:py-32 text-center">
          <div className="mb-8 inline-flex items-center gap-3">
            <svg className="h-10 w-10 text-gray-900" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Open-source on GitHub</h2>
          </div>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-500">
            Apache 2.0 License &mdash; self-host free forever. Full source code, no vendor lock-in.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="https://github.com/Josepassinato/Payjarvis"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-xl bg-gray-900 px-8 py-4 font-semibold text-white shadow-lg shadow-gray-900/25 transition-all duration-300 hover:bg-gray-800 hover:scale-[1.03]"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Star on GitHub
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </div>

          {/* Promo */}
          <div className="mt-16 rounded-2xl border-2 border-brand-500/30 bg-brand-600/5 p-8 sm:p-10">
            <div className="mb-2 inline-block rounded-full bg-brand-600 px-4 py-1 text-xs font-bold text-white">Early Access</div>
            <h3 className="mb-3 font-display text-2xl font-bold text-gray-900">Free Hosted Tier</h3>
            <p className="mb-6 text-gray-500">Use coupon code at signup for free access to the managed platform.</p>
            <div className="inline-flex items-center gap-3 rounded-xl border-2 border-dashed border-brand-500/40 bg-white px-6 py-3">
              <code className="text-xl font-bold text-brand-600 tracking-wider">JARVIS2026</code>
            </div>
            <p className="mt-4 text-sm text-gray-400">10 bots &middot; 1,000 transactions/month &middot; BDIT + JWKS included</p>
          </div>

          {/* Tech stack badges */}
          <div className="mt-16">
            <p className="mb-6 text-sm font-semibold tracking-widest uppercase text-gray-400">Built with</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              {["Next.js", "Fastify", "Prisma", "PostgreSQL", "Redis", "Clerk", "TypeScript"].map((tech) => (
                <span key={tech} className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm">
                  {tech}
                </span>
              ))}
            </div>
            <p className="mt-8 text-sm text-gray-400">
              Compatible with Anthropic MCP &middot; Visa TAP &middot; Mastercard AgentPay
            </p>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-gray-200/50 py-12 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
            <div className="text-sm text-gray-500">
              <span>Open-source under Apache 2.0 &copy; 2026 PayJarvis</span>
              <span className="block mt-1 text-xs text-gray-400">Built by <a href="https://12brain.org" target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-gray-700 transition-colors">12BRAIN</a> &mdash; Miami / S&atilde;o Paulo</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6">
              <a
                href="https://github.com/Josepassinato/Payjarvis"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900"
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                GitHub
              </a>
              <a href="/docs" className="text-sm text-gray-500 transition-colors hover:text-gray-900">Docs</a>
              <a href="/roadmap" className="text-sm text-gray-500 transition-colors hover:text-gray-900">Roadmap</a>
              <a href="/security" className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                Security
              </a>
              <a href="/privacy" className="text-sm text-gray-500 transition-colors hover:text-gray-900">Privacy</a>
              <a href="/terms" className="text-sm text-gray-500 transition-colors hover:text-gray-900">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
