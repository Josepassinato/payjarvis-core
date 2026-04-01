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
                href="https://t.me/Jarvis12Brain_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-300 hover:bg-brand-500 hover:shadow-brand-500/30 hover:scale-[1.03] animate-glow"
              >
                {t("landing.ctaTelegram") || t("landing.ctaPrimary")}
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a
                href="https://wa.me/17547145921?text=Hi%20Jarvis!"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-8 py-4 font-semibold text-gray-700 transition-all duration-300 hover:border-green-500 hover:bg-green-50"
              >
                {t("landing.ctaTrial") || "Try 7 days free on WhatsApp"}
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

      {/* ─── PAYMENT METHODS ─── */}
      <section className="relative border-t border-gray-200/40">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="mb-4 text-center">
            <span className="inline-block text-sm font-semibold tracking-widest uppercase text-brand-400">{t("landing.payTag")}</span>
          </div>
          <h2 className="mb-4 text-center font-display text-3xl font-bold sm:text-4xl lg:text-5xl">
            {t("landing.payTitle")}
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-center text-gray-500 text-lg">
            {t("landing.payDesc")}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {/* Visa */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 780 500" className="h-10 w-auto">
                  <path d="M293.2 348.7l33.4-195.8h53.3l-33.4 195.8h-53.3zm246.8-191c-10.6-4-27.2-8.3-47.9-8.3-52.8 0-90 26.6-90.2 64.7-.3 28.2 26.5 43.9 46.8 53.3 20.8 9.6 27.8 15.8 27.7 24.4-.1 13.2-16.6 19.2-32 19.2-21.4 0-32.7-3-50.3-10.2l-6.9-3.1-7.5 43.9c12.5 5.5 35.6 10.2 59.6 10.5 56.2 0 92.6-26.3 93-68.2.2-22.7-14.3-40-45.7-54.2-19-9.2-30.7-15.3-30.6-24.7 0-8.3 9.9-17.1 31.2-17.1 17.8-.3 30.7 3.6 40.8 7.6l4.9 2.3 7.4-43.4-.3.3zm137.3-4.8h-41.3c-12.8 0-22.4 3.5-28 16.3l-79.4 179.6h56.2s9.2-24.2 11.3-29.5c6.1 0 60.9.1 68.7.1 1.6 6.9 6.5 29.4 6.5 29.4h49.7l-43.3-196h-.4zm-65.8 126.4c4.4-11.3 21.4-54.8 21.4-54.8-.3.5 4.4-11.4 7.1-18.8l3.6 17s10.3 47 12.5 56.9h-44.6v-.3zM327.1 152.9L275 348.7h-53.5l-31.5-155.6c-1.9-7.2-3.6-9.8-9.4-12.9-9.5-4.9-25.2-9.5-39-12.4l.9-5h86.2c11 .2 19.7 7.2 22 19.7l21.3 107.4 52.6-127.1h56.4z" fill="#1A1F71"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Visa</span>
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
              <span className="text-xs font-medium text-gray-500">Mastercard</span>
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

            {/* Apple Pay */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 165.52 105.97" className="h-8 w-auto">
                  <path d="M28.5 0H137c15.7 0 28.5 12.8 28.5 28.5v49c0 15.7-12.8 28.5-28.5 28.5H28.5C12.8 106 0 93.2 0 77.5v-49C0 12.8 12.8 0 28.5 0z" fill="#000"/>
                  <path d="M47.8 35.6c2.3-2.9 3.9-6.8 3.5-10.8-3.4.1-7.5 2.3-9.9 5.1-2.2 2.5-4.1 6.6-3.6 10.5 3.8.3 7.6-1.9 10-4.8zm3.4 5.5c-5.5-.3-10.2 3.1-12.8 3.1s-6.7-3-11-2.9c-5.7.1-10.9 3.3-13.8 8.4-5.9 10.2-1.5 25.3 4.2 33.6 2.8 4.1 6.2 8.7 10.6 8.5 4.2-.2 5.9-2.7 11-2.7s6.6 2.7 11.1 2.6c4.6-.1 7.5-4.2 10.3-8.3 3.2-4.7 4.5-9.2 4.6-9.5-.1-.1-8.8-3.4-8.9-13.4-.1-8.4 6.8-12.4 7.1-12.6-3.9-5.7-9.9-6.4-12-6.5l-.4-.3zM88.5 29.3v52.7h8.2v-18h11.4c10.4 0 17.7-7.1 17.7-17.4s-7.2-17.3-17.5-17.3H88.5zm8.2 7h9.5c7.1 0 11.2 3.8 11.2 10.4 0 6.6-4.1 10.4-11.3 10.4h-9.4V36.3zm47.5 46.2c5.2 0 10-2.6 12.2-6.8h.2v6.4h7.6V55.8c0-7.6-6.1-12.5-15.5-12.5-8.8 0-15.2 5-15.4 11.8h7.4c.6-3.3 3.5-5.4 7.7-5.4 5 0 7.8 2.3 7.8 6.6v2.9l-10.2.6c-9.5.6-14.6 4.5-14.6 11.3 0 6.9 5.2 11.4 12.8 11.4zm2.2-6.3c-4.4 0-7.1-2.1-7.1-5.3 0-5.5 5.7-5.9 10.6-6.2l9.1-.5v3c0 5.3-4.5 9-12.6 9zm28.3 20.4c8 0 11.7-3.1 15-12.3l14.4-40.5h-8.4l-9.6 31.3h-.2L177 43.8h-8.6l13.8 38.3-.7 2.3c-1.2 3.9-3.2 5.4-6.8 5.4-.6 0-1.9-.1-2.4-.2v6.3c.5.2 2.5.3 3.2.3l-.3-.6z" fill="#fff"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Apple Pay</span>
            </div>

            {/* Google Pay */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 435.97 173.13" className="h-7 w-auto">
                  <path d="M206.2 84.6v50.4h-16V7.5h42.4c10.2 0 18.9 3.4 26.1 10.2 7.4 6.8 11.1 15 11.1 24.8s-3.7 18.1-11.1 24.9c-7.1 6.8-15.9 10.2-26.1 10.2h-26.4zm0-61.2v45.3h26.7c6.2 0 11.4-2.2 15.4-6.5 4.2-4.3 6.2-9.5 6.2-15.3 0-5.7-2.1-10.8-6.2-15.1-4-4.5-9.2-6.4-15.4-6.4h-26.7z" fill="#5F6368"/>
                  <path d="M309.8 46.3c11.8 0 21.1 3.2 27.9 9.5 6.8 6.3 10.2 15 10.2 26v52.5h-15.3v-11.8h-.7c-6.6 9.7-15.4 14.5-26.3 14.5-9.3 0-17.1-2.8-23.3-8.3-6.2-5.5-9.4-12.5-9.4-20.8 0-8.8 3.3-15.8 10-21 6.7-5.2 15.6-7.8 26.7-7.8 9.5 0 17.3 1.7 23.4 5.2v-3.7c0-6.2-2.5-11.4-7.4-15.7-5-4.3-10.7-6.4-17.2-6.4-9.9 0-17.8 4.2-23.5 12.5l-14.1-8.9c8.5-12.3 21.1-18.5 37.7-18.5l.3.7zm-20.6 67.5c0 4.7 2.1 8.6 6.2 11.7 4.1 3.2 9 4.7 14.5 4.7 7.8 0 14.6-2.9 20.4-8.8 5.8-5.8 8.7-12.7 8.7-20.5-5-4.1-11.9-6.1-20.9-6.1-6.6 0-12.1 1.6-16.5 4.9-4.5 3.3-6.7 7.2-6.7 11.7l.3 2.4z" fill="#5F6368"/>
                  <path d="M433.2 49l-53.3 122.6h-16.5l19.8-43L352 49h17.4l24.4 58.8h.3L418 49h15.2z" fill="#5F6368"/>
                  <path d="M148.1 72.4c0-4.6-.4-9-1.1-13.3H75.5v25.1h40.8c-1.8 9.5-7.1 17.5-15.1 22.9v19h24.5c14.3-13.2 22.6-32.7 22.6-53.7l-.2 0z" fill="#4285F4"/>
                  <path d="M75.5 135.1c20.4 0 37.6-6.8 50.1-18.4l-24.5-19c-6.8 4.5-15.4 7.2-25.6 7.2-19.7 0-36.4-13.3-42.3-31.2H7.9v19.6c12.5 24.8 38.1 41.8 67.6 41.8z" fill="#34A853"/>
                  <path d="M33.2 73.7c-1.5-4.5-2.4-9.4-2.4-14.4s.9-9.9 2.4-14.4V25.3H7.9C2.8 35.4 0 46.5 0 59.3s2.8 23.9 7.9 34l25.3-19.6z" fill="#FBBC04"/>
                  <path d="M75.5 14c11.1 0 21.1 3.8 29 11.3l21.7-21.7C113.1 1.3 95.9-5.1 75.5-5.1c-29.5 0-55.1 17-67.6 41.8l25.3 19.6C39.1 38 55.8 14 75.5 14z" fill="#EA4335"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Google Pay</span>
            </div>

            {/* Mercado Pago */}
            <div className="flex flex-col items-center gap-3 transition-all duration-300 hover:translate-y-[-2px]">
              <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <svg viewBox="0 0 92 32" className="h-8 w-auto">
                  <path d="M46 2C26.1 2 10 14.5 10 30h72C82 14.5 65.9 2 46 2z" fill="#00B1EA"/>
                  <ellipse cx="32" cy="18" rx="5" ry="7" fill="#fff"/>
                  <ellipse cx="60" cy="18" rx="5" ry="7" fill="#fff"/>
                  <ellipse cx="32" cy="18" rx="3" ry="5" fill="#00B1EA"/>
                  <ellipse cx="60" cy="18" rx="3" ry="5" fill="#00B1EA"/>
                </svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Mercado Pago</span>
            </div>
          </div>

          <p className="mt-10 text-center text-sm text-gray-400">
            {t("landing.payNote")}
          </p>
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
