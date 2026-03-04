/**
 * OpenClaw Integration — Fase 1 (Function Calling)
 *
 * Tool definitions para injetar no Clawdbot/OpenClaw,
 * permitindo que agentes AI chamem o Payjarvis antes
 * de qualquer transacao financeira.
 */

export const PAYJARVIS_OPENCLAW_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "payjarvis_request_payment",
      description:
        `OBRIGATÓRIO antes de qualquer compra, ` +
        `pagamento ou transação financeira. ` +
        `Solicita autorização ao Payjarvis. ` +
        `Se APPROVED: prossiga com a compra. ` +
        `Se BLOCKED: informe o usuário, não compre. ` +
        `Se PENDING_HUMAN_APPROVAL: aguarde aprovação ` +
        `do usuário no app Payjarvis (poll a cada 10s).`,
      parameters: {
        type: "object" as const,
        required: [
          "merchant_id",
          "merchant_name",
          "amount",
          "category",
          "session_id",
        ],
        properties: {
          merchant_id: {
            type: "string" as const,
            description: "ID do merchant (ex: amazon, uber)",
          },
          merchant_name: {
            type: "string" as const,
            description: "Nome da loja (ex: Amazon, Uber Eats)",
          },
          amount: {
            type: "number" as const,
            description: "Valor exato em USD",
          },
          category: {
            type: "string" as const,
            enum: [
              "food",
              "travel",
              "transport",
              "accommodation",
              "streaming",
              "software",
              "shopping",
              "health",
              "education",
              "electronics",
              "gambling",
              "investment",
              "transfer",
              "subscription",
              "other",
            ],
            description: "Categoria da compra",
          },
          description: {
            type: "string" as const,
            description: "O que está sendo comprado",
          },
          session_id: {
            type: "string" as const,
            description: "ID único desta sessão do agente",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "payjarvis_check_limits",
      description:
        `Consulta limites atuais do bot antes ` +
        `de tentar uma compra. Use para verificar se um ` +
        `valor seria aprovado sem de fato solicitá-lo. ` +
        `Retorna: limites configurados, gasto do dia, ` +
        `da semana, do mês e saldo restante.`,
      parameters: {
        type: "object" as const,
        properties: {
          amount: {
            type: "number" as const,
            description: "Valor que pretende gastar (opcional)",
          },
          category: {
            type: "string" as const,
            description: "Categoria que pretende usar (opcional)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "payjarvis_check_approval",
      description:
        `Verifica status de aprovação pendente. ` +
        `Use quando request_payment retornou ` +
        `PENDING_HUMAN_APPROVAL. Poll a cada 10 segundos. ` +
        `Retorna: approved (com bdit_token), ` +
        `rejected, pending ou expired.`,
      parameters: {
        type: "object" as const,
        required: ["approval_id"],
        properties: {
          approval_id: {
            type: "string" as const,
            description:
              "approval_id retornado pelo request_payment",
          },
        },
      },
    },
  },
] as const;

export interface SystemPromptConfig {
  botName: string;
  trustScore: number;
  limits: {
    perTransaction: number;
    perDay: number;
    autoApprove: number;
  };
}

export function generateSystemPrompt(config: SystemPromptConfig): string {
  return (
    `REGRAS DE PAGAMENTO — PAYJARVIS (OBRIGATÓRIO)\n` +
    `\n` +
    `Você está protegido pelo Payjarvis — sistema de ` +
    `controle financeiro para agentes AI.\n` +
    `\n` +
    `ANTES de qualquer compra, pagamento ou transação:\n` +
    `1. SEMPRE chame payjarvis_request_payment\n` +
    `2. NUNCA execute uma compra sem autorização\n` +
    `\n` +
    `Respostas possíveis:\n` +
    `- APPROVED: prossiga com a compra normalmente\n` +
    `- BLOCKED: informe o usuário o motivo e pare\n` +
    `- PENDING_HUMAN_APPROVAL: aguarde, chame ` +
    `payjarvis_check_approval a cada 10s\n` +
    `\n` +
    `Bot: ${config.botName}\n` +
    `Trust Score: ${config.trustScore}/100\n` +
    `Limite por transação: $${config.limits.perTransaction}\n` +
    `Limite diário: $${config.limits.perDay}\n` +
    `Aprovação automática até: $${config.limits.autoApprove}`
  );
}
