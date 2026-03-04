export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gray-950 text-white">
        <div className="mx-auto max-w-5xl px-6 py-24 text-center">
          <span className="mb-6 inline-block rounded-full bg-brand-600/20 px-4 py-1.5 text-sm font-medium text-brand-400">
            Protegendo donos de agentes IA em produção
          </span>
          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
            Controle o que seus agentes IA podem gastar
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-gray-400">
            Defina limites, aprove compras em tempo real e resolva obstáculos dos seus bots.
            Alertas no Telegram, aprovação instantânea e suporte humano quando o bot precisar.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="/bots/new"
              className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700 transition-colors"
            >
              Configurar seu firewall
            </a>
            <a
              href="/dashboard"
              className="rounded-lg border border-gray-700 px-6 py-3 font-medium text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Dashboard
            </a>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-4 text-center text-3xl font-bold text-gray-900">
          Seus agentes IA estão gastando dinheiro. Você tem controle?
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-gray-600">
          Agentes IA fazem compras de forma autônoma. Sem um firewall de gastos,
          você não tem visibilidade, limites ou processo de aprovação.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Gastos descontrolados",
              desc: "Agentes podem drenar orçamentos sem limites por compra ou tetos diários.",
            },
            {
              title: "Sem alertas em tempo real",
              desc: "Você só descobre gastos excessivos depois que acontecem — tarde demais.",
            },
            {
              title: "Sem processo de aprovação",
              desc: "Compras de alto valor passam sem revisão ou autorização humana.",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-xl border border-gray-200 p-6">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">{card.title}</h3>
              <p className="text-gray-600">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="bg-gray-50 py-16">
        <div className="mx-auto grid max-w-4xl gap-8 px-6 md:grid-cols-3">
          {[
            { value: "$0", label: "Gastos não supervisionados", sub: "com PayJarvis ativo" },
            { value: "<2s", label: "Tempo de resposta", sub: "via alertas Telegram" },
            { value: "100%", label: "Visibilidade de compras", sub: "toda transação registrada" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-4xl font-bold text-brand-600">{stat.value}</div>
              <div className="mt-1 font-medium text-gray-900">{stat.label}</div>
              <div className="text-sm text-gray-500">{stat.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">
          Como funciona
        </h2>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: "1",
              title: "Registre seu bot",
              desc: "Crie um perfil, defina limites de gasto e thresholds de auto-aprovação.",
            },
            {
              step: "2",
              title: "Instale o SDK",
              desc: "Adicione @payjarvis/agent-sdk ao seu agente. Uma chamada de função controla cada compra.",
            },
            {
              step: "3",
              title: "Receba alertas e aprove",
              desc: "Notificações no Telegram para compras de alto valor. Aprove ou rejeite em segundos.",
            },
            {
              step: "4",
              title: "Resolva obstáculos",
              desc: "Captcha, login, navegação complexa? O bot pede ajuda, você resolve e devolve o controle.",
            },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white font-bold">
                {item.step}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">{item.title}</h3>
              <p className="text-gray-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Code example */}
      <section className="bg-gray-950 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-8 text-center text-2xl font-bold text-white">
            Controle de gastos + suporte humano em poucas linhas
          </h2>
          <pre className="overflow-x-auto rounded-xl bg-gray-900 p-6 text-sm leading-relaxed text-gray-300">
            <code>{`import { PayJarvis } from "@payjarvis/agent-sdk";

const pj = new PayJarvis({
  apiKey: "pj_bot_...",
  botId: "your-bot-id",
});

const decision = await pj.requestApproval({
  merchant: "AWS",
  amount: 149.99,
  category: "cloud_services",
});

if (decision.approved) {
  // prosseguir com a compra
} else if (decision.pending) {
  // aguardar aprovação humana
  const final = await pj.waitForApproval(decision.approvalId!);
}

// Bot travou? Peça ajuda ao dono:
const handoff = await pj.requestHandoff({
  sessionUrl: "https://browser.example.com/session/abc",
  obstacleType: "CAPTCHA",
  description: "Captcha no checkout da AWS",
});
const result = await pj.waitForHandoff(handoff.handoffId);`}</code>
          </pre>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">
          Tudo que você precisa para controlar gastos de IA
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Aprovação por compra", desc: "Toda compra acima do seu threshold requer aprovação humana antes de prosseguir." },
            { title: "Limites de gasto", desc: "Defina tetos por transação, diário, semanal e mensal. Bloqueio automático quando excedido." },
            { title: "Alertas Telegram", desc: "Notificações instantâneas no Telegram. Aprove ou rejeite direto do celular." },
            { title: "Trilha de auditoria", desc: "Toda decisão registrada com timestamps, valores e detalhes do merchant." },
            { title: "Agent SDK", desc: "SDK TypeScript drop-in. Uma chamada de função para controlar qualquer compra." },
            { title: "Auto-aprovação", desc: "Defina um threshold para aprovação automática. Apenas compras de alto valor precisam de revisão." },
            { title: "Human Handoff", desc: "Seu bot travou em um captcha ou login? Ele pede sua ajuda, você resolve e devolve o controle." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-gray-200 p-6">
              <h3 className="mb-2 font-semibold text-gray-900">{f.title}</h3>
              <p className="text-sm text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-600 py-16 text-center text-white">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="mb-4 text-3xl font-bold">
            Pare de deixar seus bots gastarem sem controle
          </h2>
          <p className="mb-8 text-brand-100">
            Configure seu firewall de gastos em menos de 5 minutos. Grátis para começar.
          </p>
          <a
            href="/bots/new"
            className="inline-block rounded-lg bg-white px-8 py-3 font-medium text-brand-700 hover:bg-brand-50 transition-colors"
          >
            Comece grátis
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 text-center text-sm text-gray-500">
        PayJarvis — Firewall de Gastos para Agentes IA
      </footer>
    </main>
  );
}
