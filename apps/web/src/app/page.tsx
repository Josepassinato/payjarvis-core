"use client";

import { useTranslation } from "react-i18next";

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* ─── SECTION 1: HERO ─── */}
      <section className="relative overflow-hidden">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand-900/40 via-gray-950 to-gray-950" />
        <div className="relative mx-auto max-w-5xl px-6 py-28 text-center">
          <span className="mb-6 inline-block rounded-full border border-brand-500/30 bg-brand-600/10 px-4 py-1.5 text-sm font-medium text-brand-400">
            {t("landing.badge")}
          </span>
          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
            {t("landing.title")}
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-gray-400">
            {t("landing.subtitle")}
          </p>
          <div className="mb-16 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/sign-up"
              className="rounded-lg bg-brand-600 px-8 py-3.5 font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-500 hover:shadow-brand-500/30"
            >
              {t("landing.cta1")}
            </a>
            <a
              href="https://github.com/Josepassinato/Payjarvis"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-700 px-8 py-3.5 font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:bg-gray-800/50"
            >
              {t("landing.cta2")}
            </a>
          </div>

          {/* Hero flow diagram */}
          <div className="mx-auto flex max-w-lg items-center justify-center gap-3 text-sm sm:gap-5 sm:text-base">
            <div className="rounded-lg border border-gray-700 bg-gray-900/80 px-4 py-3 font-medium text-gray-200">
              {t("landing.flowAgent")}
            </div>
            <div className="text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <div className="rounded-lg border border-brand-500/40 bg-brand-600/15 px-4 py-3 font-bold text-brand-400">
              PayJarvis
            </div>
            <div className="text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-900/80 px-4 py-3 font-medium text-gray-200">
              {t("landing.flowMerchant")}
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 2: THE PROBLEM ─── */}
      <section className="border-t border-gray-800/50">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
            {t("landing.problemTitle")}
          </h2>
          <p className="mx-auto mb-14 max-w-2xl text-center text-lg text-gray-400">
            {t("landing.problemDesc")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              t("landing.can1"),
              t("landing.can2"),
              t("landing.can3"),
              t("landing.can4"),
              t("landing.can5"),
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3">
                <span className="text-brand-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
                <span className="text-sm text-gray-300">{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <p className="text-lg text-gray-300">
              {t("landing.problemWarning")}
            </p>
          </div>
        </div>
      </section>

      {/* ─── SECTION 3: THE SOLUTION ─── */}
      <section className="border-t border-gray-800/50 bg-gray-900/30">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
            {t("landing.solutionTitle")}
          </h2>
          <p className="mx-auto mb-14 max-w-xl text-center text-gray-400">
            {t("landing.solutionDesc")}
          </p>

          {/* Vertical flow diagram */}
          <div className="mx-auto mb-14 flex max-w-xs flex-col items-center gap-2">
            <div className="w-full rounded-lg border border-gray-700 bg-gray-900 px-6 py-4 text-center font-medium">
              {t("landing.flowAgent")}
            </div>
            <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <div className="w-full rounded-lg border border-brand-500/40 bg-brand-600/15 px-6 py-4 text-center font-bold text-brand-400">
              PayJarvis
            </div>
            <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <div className="w-full rounded-lg border border-gray-700 bg-gray-900 px-6 py-4 text-center font-medium">
              {t("landing.flowTarget")}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: t("landing.sol1Title"), desc: t("landing.sol1Desc") },
              { title: t("landing.sol2Title"), desc: t("landing.sol2Desc") },
              { title: t("landing.sol3Title"), desc: t("landing.sol3Desc") },
              { title: t("landing.sol4Title"), desc: t("landing.sol4Desc") },
            ].map((card) => (
              <div key={card.title} className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
                <h3 className="mb-2 font-semibold text-white">{card.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTION 4: AI AGENT TRUST SCORE ─── */}
      <section className="border-t border-gray-800/50">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
            {t("landing.trustTitle")}
          </h2>
          <p className="mx-auto mb-14 max-w-2xl text-center text-gray-400">
            {t("landing.trustDesc")}
          </p>

          <div className="grid items-start gap-10 lg:grid-cols-2">
            {/* Trust score factors */}
            <div className="space-y-4">
              {[
                { label: t("landing.trust1"), color: "text-green-400" },
                { label: t("landing.trust2"), color: "text-green-400" },
                { label: t("landing.trust3"), color: "text-blue-400" },
                { label: t("landing.trust4"), color: "text-yellow-400" },
                { label: t("landing.trust5"), color: "text-purple-400" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/50 px-5 py-3">
                  <span className={item.color}>
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <span className="text-gray-300">{item.label}</span>
                </div>
              ))}
            </div>

            {/* Trust score card mock */}
            <div className="mx-auto w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-8 shadow-2xl">
              <div className="mb-1 text-sm text-gray-500">{t("landing.trustCardLabel")}</div>
              <div className="mb-6 text-6xl font-bold text-brand-400">720</div>
              {/* Score bar */}
              <div className="mb-6 h-3 w-full overflow-hidden rounded-full bg-gray-800">
                <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-brand-600 to-brand-400" />
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                  <span className="text-gray-400">{t("landing.trustHigh")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
                  <span className="text-gray-400">{t("landing.trustLow")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 5: DEMO EXAMPLES ─── */}
      <section className="border-t border-gray-800/50 bg-gray-900/30">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-14 text-center text-3xl font-bold sm:text-4xl">
            {t("landing.demoTitle")}
          </h2>

          <div className="grid gap-8 md:grid-cols-2">
            {/* Blocked example */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-6">
              <div className="mb-4 text-sm text-gray-500">{t("landing.demoScenario1")}</div>
              <div className="mb-6 text-gray-300">{t("landing.demoDesc1")}</div>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                  <span className="font-bold text-red-400">{t("landing.demoBlocked")}</span>
                </div>
                <div className="text-sm text-red-300/70">{t("landing.demoBlockedReason")}</div>
              </div>
            </div>

            {/* Approved example */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-6">
              <div className="mb-4 text-sm text-gray-500">{t("landing.demoScenario2")}</div>
              <div className="mb-6 text-gray-300">{t("landing.demoDesc2")}</div>
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                  <span className="font-bold text-green-400">{t("landing.demoApproved")}</span>
                </div>
                <div className="text-sm text-green-300/70">{t("landing.demoApprovedReason")}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 6: FOR DEVELOPERS ─── */}
      <section className="border-t border-gray-800/50">
        <div className="mx-auto max-w-4xl px-6 py-24">
          <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
            {t("landing.devTitle")}
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-center text-gray-400">
            {t("landing.devDesc")}
          </p>
          <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
            {/* Code window header */}
            <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-500/60" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
              <span className="h-3 w-3 rounded-full bg-green-500/60" />
              <span className="ml-3 text-xs text-gray-600">agent.ts</span>
            </div>
            <pre className="overflow-x-auto p-6 text-sm leading-relaxed">
              <code>{`import { PayJarvis } from "@payjarvis/agent-sdk"

const pj = PayJarvis.fromEnv()

const decision = await pj.authorize({
  merchant: "Amazon",
  amount: 120,
  category: "electronics"
})

if (decision.approved) {
  completePurchase()
}`}</code>
            </pre>
          </div>
          <p className="mt-6 text-center text-sm text-gray-500">
            npm install @payjarvis/agent-sdk
          </p>
        </div>
      </section>

      {/* ─── SECTION 7: FUTURE OF AI COMMERCE ─── */}
      <section className="border-t border-gray-800/50 bg-gray-900/30">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
            {t("landing.futureTitle")}
          </h2>
          <p className="mx-auto mb-14 max-w-2xl text-center text-gray-400">
            {t("landing.futureDesc")}
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: t("landing.future1Title"), desc: t("landing.future1Desc") },
              { title: t("landing.future2Title"), desc: t("landing.future2Desc") },
              { title: t("landing.future3Title"), desc: t("landing.future3Desc") },
              { title: t("landing.future4Title"), desc: t("landing.future4Desc") },
            ].map((card) => (
              <div key={card.title} className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 text-center">
                <h3 className="mb-2 font-semibold text-white">{card.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="border-t border-brand-500/20 bg-gradient-to-b from-brand-900/30 to-gray-950">
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
            {t("landing.ctaTitle")}
          </h2>
          <p className="mb-8 text-lg text-gray-400">
            {t("landing.ctaDesc")}
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/sign-up"
              className="rounded-lg bg-brand-600 px-8 py-3.5 font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-500"
            >
              {t("landing.ctaButton")}
            </a>
            <a
              href="https://github.com/Josepassinato/Payjarvis"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-700 px-8 py-3.5 font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:bg-gray-800/50"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-gray-800/50 py-8 text-center text-sm text-gray-600">
        {t("landing.footer")}
      </footer>
    </main>
  );
}
