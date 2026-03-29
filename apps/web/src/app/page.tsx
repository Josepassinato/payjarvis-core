"use client";

import { useTranslation } from "react-i18next";
import TrustBadges from "@/components/TrustBadges";

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 overflow-hidden">
      {/* ─── HERO ─── */}
      <section className="relative">
        <div className="absolute inset-0 hero-mesh" />
        <div className="absolute inset-0 grid-pattern opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50" />

        {/* Floating orbs */}
        <div className="absolute top-20 left-[10%] w-72 h-72 bg-brand-50 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-20 right-[10%] w-96 h-96 bg-accent/8 rounded-full blur-[140px] animate-float-delay" />

        <div className="relative mx-auto max-w-6xl px-6 pt-32 pb-24 sm:pt-40 sm:pb-32">
          <div className="text-center">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-brand-500/20 bg-brand-600/5 px-5 py-2 backdrop-blur-sm animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              <span className="text-sm font-medium text-gray-700">{t("landing.badge")}</span>
            </div>

            <h1 className="mb-6 font-display text-5xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl opacity-0 animate-fade-in-delay-1">
              <span className="block">{t("landing.heroLine1")}</span>
              <span className="block text-gradient-brand">{t("landing.heroLine2")}</span>
            </h1>

            <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-gray-500 sm:text-xl opacity-0 animate-fade-in-delay-2">
              {t("landing.heroSub")}
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row opacity-0 animate-fade-in-delay-3">
              <a
                href="/sign-up"
                className="group relative inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-300 hover:bg-brand-500 hover:shadow-brand-500/30 hover:scale-[1.03] animate-glow"
              >
                {t("landing.ctaPrimary")}
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-8 py-4 font-semibold text-gray-700 transition-all duration-300 hover:border-gray-500 hover:bg-gray-100"
              >
                {t("landing.ctaSecondary")}
              </a>
            </div>
          </div>

          {/* Hero visual — minimal agent flow */}
          <div className="mt-20 mx-auto max-w-2xl opacity-0 animate-fade-in-delay-3">
            <div className="rounded-2xl border border-gray-200/60 bg-white/50 backdrop-blur-md p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 border border-gray-200">
                    <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-gray-500">{t("landing.flowUser")}</div>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div className="h-px w-12 sm:w-20 bg-gradient-to-r from-gray-200 to-brand-500/50" />
                  <span className="text-[10px] text-gray-500 font-mono">{t("landing.flowCommand")}</span>
                </div>

                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/15 border border-brand-500/30">
                    <span className="text-lg font-bold text-gradient-brand">P</span>
                  </div>
                  <div className="text-sm font-bold text-gradient-brand">PayJarvis</div>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div className="h-px w-12 sm:w-20 bg-gradient-to-r from-brand-500/50 to-accent/50" />
                  <span className="text-[10px] text-gray-500 font-mono">{t("landing.flowExecute")}</span>
                </div>

                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 border border-accent/20">
                    <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0A2.993 2.993 0 017.5 9.35m13.5 0a2.999 2.999 0 00-3.75-.614" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-gray-500">{t("landing.flowMerchant")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PRODUCTS ─── */}
      <section id="how-it-works" className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">{t("landing.productsTag")}</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            {t("landing.productsTitle")}
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500 text-lg">
            {t("landing.productsDesc")}
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                ),
                gradient: "from-brand-600/20 via-brand-500/5 to-transparent",
                borderHover: "hover:border-brand-500/40",
                iconColor: "text-brand-400",
                titleKey: "landing.prod1Title",
                descKey: "landing.prod1Desc",
                ctaKey: "landing.prod1Cta",
                link: "/sign-up",
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
                titleKey: "landing.prod2Title",
                descKey: "landing.prod2Desc",
                ctaKey: "landing.prod2Cta",
                link: "/install",
              },
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                ),
                gradient: "from-purple-500/15 via-purple-500/5 to-transparent",
                borderHover: "hover:border-purple-500/40",
                iconColor: "text-purple-400",
                titleKey: "landing.prod3Title",
                descKey: "landing.prod3Desc",
                ctaKey: "landing.prod3Cta",
                link: "/contact",
              },
            ].map((card) => (
              <a
                key={card.titleKey}
                href={card.link}
                className={`group relative rounded-2xl border border-gray-200 bg-gradient-to-b ${card.gradient} p-8 transition-all duration-300 ${card.borderHover} hover:translate-y-[-4px] hover:shadow-xl hover:shadow-black/20`}
              >
                <div className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100/80 ${card.iconColor}`}>
                  {card.icon}
                </div>
                <h3 className="mb-3 font-display text-xl font-bold text-gray-900">{t(card.titleKey)}</h3>
                <p className="mb-6 text-gray-500 leading-relaxed">{t(card.descKey)}</p>
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${card.iconColor} transition-all group-hover:gap-2.5`}>
                  {t(card.ctaKey)}
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CAPABILITIES ─── */}
      <section className="relative border-t border-gray-200/40 bg-white/30">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            {t("landing.capTitle")}
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500 text-lg">
            {t("landing.capDesc")}
          </p>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { icon: "✈️", key: "landing.cap1" },
              { icon: "🍽️", key: "landing.cap2" },
              { icon: "🛍️", key: "landing.cap3" },
              { icon: "🎟️", key: "landing.cap4" },
              { icon: "🚗", key: "landing.cap5" },
              { icon: "📅", key: "landing.cap6" },
            ].map((item, i) => (
              <div
                key={item.key}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white/60 p-6 transition-all duration-300 hover:border-brand-500/30 hover:bg-gray-100 hover:translate-y-[-2px]"
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <span className="text-3xl transition-transform duration-300 group-hover:scale-110">{item.icon}</span>
                <span className="text-sm font-medium text-gray-700 text-center">{t(item.key)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TRUST ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="absolute inset-0 hero-mesh opacity-40" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-accent">{t("landing.trustTag")}</span>
          </div>
          <h2 className="mb-6 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            {t("landing.trustTitle")}
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-gray-500 text-lg">
            {t("landing.trustDesc")}
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
                titleKey: "landing.trust1Title",
                descKey: "landing.trust1Desc",
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                ),
                color: "text-accent",
                bg: "bg-accent/10",
                titleKey: "landing.trust2Title",
                descKey: "landing.trust2Desc",
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                ),
                color: "text-approved",
                bg: "bg-approved/10",
                titleKey: "landing.trust3Title",
                descKey: "landing.trust3Desc",
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                ),
                color: "text-purple-400",
                bg: "bg-purple-500/10",
                titleKey: "landing.trust4Title",
                descKey: "landing.trust4Desc",
              },
            ].map((card) => (
              <div
                key={card.titleKey}
                className="group rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm p-6 transition-all duration-300 hover:border-gray-300 hover:translate-y-[-2px]"
              >
                <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${card.bg} ${card.color}`}>
                  {card.icon}
                </div>
                <h3 className="mb-2 font-display text-lg font-bold text-gray-900">{t(card.titleKey)}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{t(card.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── INTEGRATIONS ─── */}
      <section className="relative border-t border-gray-200/40 bg-white/30">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <h2 className="mb-4 text-center font-display text-3xl font-bold sm:text-4xl">
            {t("landing.integrationsTitle")}
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500">
            {t("landing.integrationsDesc")}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {[
              "Expedia", "Booking.com", "Amazon", "Mercado Livre",
              "OpenTable", "Yelp", "Ticketmaster", "Fandango", "Viator", "iFood",
            ].map((partner) => (
              <div
                key={partner}
                className="rounded-xl border border-gray-200/60 bg-white/40 px-6 py-3 text-sm font-medium text-gray-500 transition-all duration-300 hover:border-gray-300 hover:text-gray-900 hover:bg-gray-100"
              >
                {partner}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SDK PREVIEW ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-4xl px-6 py-24 sm:py-32">
          <h2 className="mb-4 text-center font-display text-3xl font-bold sm:text-4xl">
            {t("landing.devTitle")}
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-center text-gray-500">
            {t("landing.devDesc")}
          </p>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/30">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-blocked/60" />
              <span className="h-3 w-3 rounded-full bg-pending/60" />
              <span className="h-3 w-3 rounded-full bg-approved/60" />
              <span className="ml-3 text-xs text-gray-500 font-mono">agent.ts</span>
            </div>
            <pre className="overflow-x-auto p-6 text-sm leading-relaxed font-mono">
              <code><span className="code-keyword">{"import"}</span>{" { "}<span className="code-type">{"PayJarvis"}</span>{" } "}<span className="code-keyword">{"from"}</span>{" "}<span className="code-string">{'"@payjarvis/agent-sdk"'}</span>{"\n\n"}<span className="code-keyword">{"const"}</span>{" pj = "}<span className="code-type">{"PayJarvis"}</span>{"."}<span className="code-function">{"fromEnv"}</span>{"()\n\n"}<span className="code-keyword">{"const"}</span>{" booking = "}<span className="code-keyword">{"await"}</span>{" pj."}<span className="code-function">{"execute"}</span>{"({\n  action: "}<span className="code-string">{'"book_flight"'}</span>{",\n  provider: "}<span className="code-string">{'"expedia"'}</span>{",\n  amount: "}<span className="text-amber-300">{"450"}</span>{",\n  currency: "}<span className="code-string">{'"USD"'}</span>{"\n})\n\n"}<span className="code-comment">{"// ✅ Human approved via Telegram"}</span>{"\nconsole.log(booking.status) "}<span className="code-comment">{"// \"confirmed\""}</span></code>
            </pre>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2">
            <span className="text-accent font-mono text-sm">$</span>
            <code className="text-sm text-gray-500 font-mono">npm install @payjarvis/agent-sdk</code>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="relative border-t border-brand-500/20 overflow-hidden">
        <div className="absolute inset-0 hero-mesh opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-50 via-transparent to-gray-50" />
        <div className="relative mx-auto max-w-3xl px-6 py-24 sm:py-32 text-center">
          <h2 className="mb-6 font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            {t("landing.finalTitle")}
          </h2>
          <p className="mb-10 text-lg text-gray-500 sm:text-xl">
            {t("landing.finalDesc")}
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/sign-up"
              className="group inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-300 hover:bg-brand-500 hover:scale-[1.03] animate-glow"
            >
              {t("landing.finalCtaPrimary")}
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="rounded-xl border border-gray-200 px-8 py-4 font-semibold text-gray-700 transition-all duration-300 hover:border-gray-500 hover:bg-gray-100"
            >
              {t("landing.finalCtaSecondary")}
            </a>
          </div>
        </div>
      </section>

      {/* ─── TRUST BADGES ─── */}
      <TrustBadges />

      {/* ─── SECURITY HIGHLIGHT ─── */}
      <section className="relative border-t border-gray-200/40 bg-gradient-to-b from-white/50 to-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="text-center">
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-5 py-2.5">
              <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <span className="text-sm font-semibold text-emerald-700">{t("landing.securityBadge")}</span>
            </div>
            <h2 className="mb-4 font-display text-3xl font-bold sm:text-4xl lg:text-5xl text-gray-900">
              {t("landing.securityTitle")}
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-lg text-gray-500">
              {t("landing.securityDesc")}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                ),
                color: "text-emerald-600",
                bg: "bg-emerald-50 border-emerald-100",
                titleKey: "landing.sec1Title",
                descKey: "landing.sec1Desc",
              },
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                  </svg>
                ),
                color: "text-emerald-600",
                bg: "bg-emerald-50 border-emerald-100",
                titleKey: "landing.sec2Title",
                descKey: "landing.sec2Desc",
              },
              {
                icon: (
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ),
                color: "text-emerald-600",
                bg: "bg-emerald-50 border-emerald-100",
                titleKey: "landing.sec3Title",
                descKey: "landing.sec3Desc",
              },
            ].map((card) => (
              <div
                key={card.titleKey}
                className={`rounded-2xl border ${card.bg} p-8 text-center transition-all duration-300 hover:translate-y-[-2px] hover:shadow-lg`}
              >
                <div className={`mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-white shadow-sm ${card.color}`}>
                  {card.icon}
                </div>
                <h3 className="mb-2 font-display text-lg font-bold text-gray-900">{t(card.titleKey)}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{t(card.descKey)}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <a
              href="/security"
              className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 transition-colors hover:text-emerald-500"
            >
              {t("landing.securityCta")}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-gray-200/50 py-12 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
            <span className="text-sm text-gray-500">{t("landing.footer")}</span>
            <div className="flex flex-wrap items-center justify-center gap-6">
              <a href="/security" className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                Security
              </a>
              <a href="/privacy" className="text-sm text-gray-500 transition-colors hover:text-gray-900">
                Privacy Policy
              </a>
              <a href="/terms" className="text-sm text-gray-500 transition-colors hover:text-gray-900">
                Terms of Service
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
