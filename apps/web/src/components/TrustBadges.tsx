"use client";

const badges = [
  {
    title: "Visa Trusted Agent Protocol",
    description:
      "Credenciado para transacoes autonomas com cartoes Visa. Identificacao verificavel via TAP standard.",
    gradient: "from-[#1A1F71] to-[#2A2F91]",
    status: "Integrado",
    statusColor: "bg-emerald-500/20 text-emerald-400",
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
        />
      </svg>
    ),
  },
  {
    title: "Mastercard AgentPay",
    description:
      "Processamento seguro via AgentPay protocol. Limites dinamicos por agente.",
    gradient: "from-[#EB001B] to-[#FF5F00]",
    status: "Em registro",
    statusColor: "bg-amber-500/20 text-amber-400",
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
        />
      </svg>
    ),
  },
  {
    title: "Anthropic MCP",
    description:
      "Model Context Protocol para comunicacao segura entre LLMs e ferramentas de pagamento.",
    gradient: "from-[#1a1a2e] to-[#16213e]",
    status: "Integrado",
    statusColor: "bg-emerald-500/20 text-emerald-400",
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
        />
      </svg>
    ),
  },
  {
    title: "Cloudflare Verified Bot",
    description:
      "Bot verificado no registro Cloudflare. Rate limits prioritarios e bypass de WAF.",
    gradient: "from-[#F48120] to-[#FAAD3F]",
    status: "Integrado",
    statusColor: "bg-emerald-500/20 text-emerald-400",
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
];

export default function TrustBadges() {
  return (
    <section className="relative border-t border-gray-200/40 bg-gray-50">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-gray-50 to-transparent" />
      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="mb-4 text-center">
          <span className="inline-block text-sm font-semibold tracking-widest uppercase text-amber-400">
            Agentic Commerce
          </span>
        </div>
        <h2 className="mb-6 text-center font-display text-3xl font-bold text-gray-900 sm:text-4xl lg:text-5xl">
          Credenciado pelos padroes globais de agentic commerce
        </h2>
        <p className="mx-auto mb-16 max-w-2xl text-center text-gray-600 text-lg">
          PayJarvis opera com os protocolos mais recentes de pagamento autonomo,
          garantindo seguranca e conformidade em cada transacao.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {badges.map((badge) => (
            <div
              key={badge.title}
              className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white backdrop-blur-sm transition-all duration-300 hover:border-gray-300 hover:translate-y-[-4px] hover:shadow-2xl hover:shadow-gray-200/40"
            >
              {/* Gradient header */}
              <div
                className={`bg-gradient-to-r ${badge.gradient} p-6 pb-8`}
              >
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur-sm">
                  {badge.icon}
                </div>
                <h3 className="font-display text-lg font-bold text-white">
                  {badge.title}
                </h3>
              </div>

              {/* Content */}
              <div className="p-6 pt-4">
                <p className="mb-4 text-sm leading-relaxed text-gray-600">
                  {badge.description}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${badge.statusColor}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {badge.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
