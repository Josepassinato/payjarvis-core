"use client";

const pains = [
  {
    title: "The bot is buying things. You have no control.",
    body:
      "When agents drift, get prompt-injected, or simply do what an ill-considered prompt told them to do, they can drain a budget in minutes. PayJarvis runs policy before every transaction: categorical limits, velocity caps, time windows, fail-closed execution, and immutable audit.",
  },
  {
    title: "If the bot screws up, who is responsible?",
    body:
      "Agentic commerce protocols and payment processors do not fully answer accountability. PayJarvis ties every agent to an accountable human or entity through BDIT and verified KYC/KYB.",
  },
  {
    title: "How do you know whether to trust this bot?",
    body:
      "Reputation that follows the agent across merchants, MCPs, and platforms - for better, or for worse. Bots that behave gain trust. Bots that do not lose it.",
  },
];

const pillars = [
  {
    name: "Identity",
    detail: "BDIT credentials bind the agent, operator, jurisdiction, and transaction context.",
  },
  {
    name: "Reputation",
    detail: "Portable trust signals expose clean behavior, disputes, anomalies, and revocation state.",
  },
  {
    name: "Governance",
    detail: "Policy checks, fail-closed execution, analytics, and audit trails run before spend happens.",
  },
];

const flow = ["AI Agent", "Identity", "Reputation", "Policy", "Allow / Deny", "Audit Log"];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f8fb] text-gray-950">
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-950 text-sm font-bold text-white">
              P
            </span>
            <span className="font-display text-lg font-bold">PayJarvis</span>
          </a>
          <div className="hidden items-center gap-7 md:flex">
            <a href="#pains" className="text-sm font-medium text-gray-600 hover:text-gray-950">
              Problems
            </a>
            <a href="#how" className="text-sm font-medium text-gray-600 hover:text-gray-950">
              How it works
            </a>
            <a href="/docs" className="text-sm font-medium text-gray-600 hover:text-gray-950">
              Docs
            </a>
            <a
              href="https://github.com/Josepassinato/Payjarvis"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-gray-600 hover:text-gray-950"
            >
              GitHub
            </a>
          </div>
          <a
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800"
          >
            Get started
          </a>
        </div>
      </nav>

      <section className="relative overflow-hidden border-b border-gray-200 bg-white">
        <div className="absolute inset-0 grid-pattern opacity-50" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="flex flex-col justify-center">
            <p className="mb-5 max-w-fit rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gray-600">
              Identity + Reputation + Governance
            </p>
            <h1 className="max-w-4xl font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Stop your AI agents from going rogue with money.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600 sm:text-xl">
              Identity, reputation, and governance for autonomous AI agents that spend money.
              Open-source policy engine. Managed audit and analytics.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-md bg-brand-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-500"
              >
                Get started
              </a>
              <a
                href="/docs"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-bold text-gray-900 transition hover:border-gray-500"
              >
                Read the docs
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-md border border-gray-200 bg-gray-950 p-5 text-white shadow-2xl shadow-gray-950/20">
              <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Live decision</p>
                  <p className="mt-1 font-display text-2xl font-bold">Agent spend request</p>
                </div>
                <span className="rounded-md bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-300">
                  fail-closed
                </span>
              </div>

              <div className="space-y-3">
                {[
                  ["Merchant", "staples.com"],
                  ["Amount", "$247.50"],
                  ["Intent", "office supplies"],
                  ["Operator", "verified"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-md bg-white/5 px-4 py-3">
                    <span className="text-sm text-gray-400">{label}</span>
                    <span className="font-mono text-sm text-white">{value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {pillars.map((pillar) => (
                  <div key={pillar.name} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
                    <p className="font-bold text-white">{pillar.name}</p>
                    <p className="mt-2 text-xs leading-5 text-gray-400">{pillar.detail}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-md border border-emerald-400/20 bg-emerald-400/10 p-4">
                <p className="text-sm font-bold text-emerald-200">Decision: allow</p>
                <p className="mt-1 text-xs leading-5 text-emerald-100/80">
                  Policy passed, BDIT signed, audit event appended before checkout continues.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pains" className="border-b border-gray-200 bg-[#f7f8fb]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">
              The three pains we solve
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-5xl">
              Money-moving agents need controls before the transaction.
            </h2>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {pains.map((pain, index) => (
              <article
                key={pain.title}
                className="rounded-md border border-gray-200 bg-white p-6 shadow-card transition hover:-translate-y-1 hover:shadow-card-hover"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-950 font-mono text-sm font-bold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-5 font-display text-xl font-bold leading-7">{pain.title}</h3>
                <p className="mt-4 text-sm leading-7 text-gray-600">{pain.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent-dark">How it works</p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-5xl">
                One decision layer between your agent and the payment rail.
              </h2>
              <p className="mt-5 text-base leading-8 text-gray-600">
                PayJarvis evaluates identity, reputation, and policy before the action proceeds.
                The result is an allow or deny decision plus a durable audit event for compliance,
                dispute review, and analytics.
              </p>
            </div>

            <div className="rounded-md border border-gray-200 bg-[#f7f8fb] p-5">
              <div className="grid gap-3 md:grid-cols-6">
                {flow.map((step, index) => (
                  <div key={step} className="relative">
                    <div className="flex min-h-28 items-center justify-center rounded-md border border-gray-200 bg-white p-4 text-center shadow-card">
                      <span className="text-sm font-bold text-gray-900">{step}</span>
                    </div>
                    {index < flow.length - 1 ? (
                      <div className="hidden md:block absolute left-[calc(100%+2px)] top-1/2 h-px w-3 -translate-y-1/2 bg-gray-300" />
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-md border border-gray-200 bg-white p-5">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-gray-500">audit payload</p>
                <pre className="mt-3 overflow-x-auto text-xs leading-6 text-gray-700">
{`{
  "agent": "bot:my-shopper:v1",
  "operator_kyc": "verified",
  "reputation": 87,
  "decision": "allow",
  "reason": "policy_passed",
  "hash_chain": "appended"
}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-gray-200 bg-[#f7f8fb]">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6">
          <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
            <div className="rounded-md border border-gray-200 bg-white p-6">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Used by</p>
              <div className="mt-5 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-gray-950 font-bold text-white">
                  S
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold">SnifferShop</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Autonomous shopping agent built on PayJarvis governance.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-6">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent-dark">Open protocol</p>
              <h3 className="mt-4 font-display text-xl font-bold">Want to be listed?</h3>
              <p className="mt-2 text-sm leading-7 text-gray-600">
                Integrate PayJarvis governance and email hello@payjarvis.com with your agent, platform,
                merchant, or MCP use case.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-gray-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-6 md:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-sm font-bold text-gray-950">
                P
              </span>
              <span className="font-display text-lg font-bold">PayJarvis</span>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-400">
              Built by 12Brain Solutions LLC. Identity verification operated by specialized partners;
              PayJarvis remains co-responsible as data controller.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-5 text-sm text-gray-300">
            <a href="/docs" className="hover:text-white">Docs</a>
            <a href="https://github.com/Josepassinato/Payjarvis" className="hover:text-white">GitHub</a>
            <a href="/security" className="hover:text-white">Security</a>
            <a href="/privacy" className="hover:text-white">Privacy</a>
            <a href="/terms" className="hover:text-white">Terms</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
