/**
 * OpenClaw Tool Handler — Fase 1
 *
 * Processa chamadas de function-calling vindas do
 * agente AI (Clawdbot) e faz proxy para a API do Payjarvis.
 */

/** Shape das respostas da API do Payjarvis */
interface PaymentApiResponse {
  decision?: string;
  amount?: number;
  reason?: string;
  ruleTriggered?: string | null;
  bditToken?: string;
  transactionId?: string;
  approvalId?: string;
}

interface LimitsApiResponse {
  perTransaction?: number;
  perDay?: number;
  perWeek?: number;
  perMonth?: number;
  autoApproveLimit?: number;
  spentToday?: number;
  spentWeek?: number;
  spentMonth?: number;
  remainingToday?: number;
  remainingWeek?: number;
  remainingMonth?: number;
  wouldBeApproved?: boolean;
}

interface ApprovalApiResponse {
  status?: string;
  bditToken?: string;
  transactionId?: string;
  reason?: string;
}

export interface PayjarvisToolHandlerConfig {
  payjarvisApiUrl: string;
  botApiKey: string;
  botId: string;
}

export class PayjarvisToolHandler {
  private apiUrl: string;
  private botApiKey: string;
  private botId: string;

  constructor(config: PayjarvisToolHandlerConfig) {
    this.apiUrl = config.payjarvisApiUrl;
    this.botApiKey = config.botApiKey;
    this.botId = config.botId;
  }

  /** Ponto de entrada principal — roteia para o handler correto */
  async handle(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    switch (toolName) {
      case "payjarvis_request_payment":
        return this.requestPayment(args);
      case "payjarvis_check_limits":
        return this.checkLimits(args);
      case "payjarvis_check_approval":
        return this.checkApproval(args);
      default:
        return JSON.stringify({
          error: `Tool desconhecida: ${toolName}`,
        });
    }
  }

  private async requestPayment(
    args: Record<string, unknown>
  ): Promise<string> {
    const res = await fetch(
      `${this.apiUrl}/bots/${this.botId}/request-payment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bot-Api-Key": this.botApiKey,
        },
        body: JSON.stringify({
          merchantId: args.merchant_id,
          merchantName: args.merchant_name,
          amount: args.amount,
          currency: "USD",
          category: args.category,
          description: args.description,
          sessionId: args.session_id,
        }),
      }
    );

    const data = (await res.json()) as PaymentApiResponse;

    if (data.decision === "APPROVED") {
      return JSON.stringify({
        status: "APPROVED",
        message: `Transação de $${data.amount ?? args.amount} aprovada.`,
        bdit_token: data.bditToken,
        transaction_id: data.transactionId,
        instructions:
          "Prossiga com a compra. Inclua o bdit_token no header " +
          "X-BDIT-Token ao chamar o merchant.",
      });
    }

    if (data.decision === "BLOCKED") {
      return JSON.stringify({
        status: "BLOCKED",
        message: `Transação bloqueada: ${data.reason}`,
        reason: data.reason,
        rule_triggered: data.ruleTriggered ?? null,
        instructions:
          "NÃO prossiga com a compra. Informe o usuário sobre o bloqueio.",
      });
    }

    if (data.decision === "PENDING_HUMAN") {
      return JSON.stringify({
        status: "PENDING_HUMAN_APPROVAL",
        message:
          "Transação requer aprovação humana. " +
          "O dono do bot foi notificado.",
        approval_id: data.approvalId,
        instructions:
          "Aguarde aprovação. Chame payjarvis_check_approval " +
          "com o approval_id a cada 10 segundos. " +
          "Timeout após 5 minutos.",
      });
    }

    // Fallback para respostas inesperadas
    return JSON.stringify({
      status: "ERROR",
      message: "Resposta inesperada do Payjarvis",
      raw: data,
    });
  }

  private async checkLimits(
    args: Record<string, unknown>
  ): Promise<string> {
    const params = new URLSearchParams();
    if (args.amount != null) {
      params.set("amount", String(args.amount));
    }
    if (args.category != null) {
      params.set("category", String(args.category));
    }

    const qs = params.toString();
    const url = `${this.apiUrl}/bots/${this.botId}/limits${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Bot-Api-Key": this.botApiKey,
      },
    });

    const data = (await res.json()) as LimitsApiResponse;

    return JSON.stringify({
      status: "OK",
      limits: {
        per_transaction: data.perTransaction,
        per_day: data.perDay,
        per_week: data.perWeek,
        per_month: data.perMonth,
        auto_approve_up_to: data.autoApproveLimit,
      },
      spent: {
        today: data.spentToday,
        this_week: data.spentWeek,
        this_month: data.spentMonth,
      },
      remaining: {
        today: data.remainingToday,
        this_week: data.remainingWeek,
        this_month: data.remainingMonth,
      },
      would_be_approved:
        args.amount != null ? data.wouldBeApproved : undefined,
      instructions:
        args.amount != null && !data.wouldBeApproved
          ? `Valor $${args.amount} excede os limites. ` +
            `Informe o usuário antes de tentar.`
          : undefined,
    });
  }

  private async checkApproval(
    args: Record<string, unknown>
  ): Promise<string> {
    const res = await fetch(
      `${this.apiUrl}/bots/${this.botId}/approvals/${args.approval_id}`,
      {
        method: "GET",
        headers: {
          "X-Bot-Api-Key": this.botApiKey,
        },
      }
    );

    const data = (await res.json()) as ApprovalApiResponse;

    if (data.status === "approved") {
      return JSON.stringify({
        status: "APPROVED",
        message: "Aprovação recebida! Prossiga com a compra.",
        bdit_token: data.bditToken,
        transaction_id: data.transactionId,
        instructions:
          "Prossiga com a compra. Inclua o bdit_token no header " +
          "X-BDIT-Token ao chamar o merchant.",
      });
    }

    if (data.status === "rejected") {
      return JSON.stringify({
        status: "REJECTED",
        message: `Transação rejeitada pelo dono: ${data.reason ?? "sem motivo informado"}`,
        reason: data.reason ?? null,
        instructions:
          "NÃO prossiga. Informe o usuário que o dono rejeitou.",
      });
    }

    if (data.status === "expired") {
      return JSON.stringify({
        status: "EXPIRED",
        message:
          "Aprovação expirou (timeout de 5 minutos).",
        instructions:
          "Informe o usuário que o tempo expirou. " +
          "Ele pode tentar novamente.",
      });
    }

    // Ainda pendente
    return JSON.stringify({
      status: "PENDING",
      message: "Aguardando aprovação do dono do bot...",
      instructions:
        "Chame payjarvis_check_approval novamente em 10 segundos.",
    });
  }
}
