/**
 * Payjarvis Interceptor — Lógica principal de interceptação.
 *
 * Quando um checkout é detectado:
 * 1. Pausa a interação do bot
 * 2. Extrai dados da página
 * 3. Verifica com a API do Payjarvis
 * 4. Aplica a decisão (approve/block/pending)
 */

import type { CdpMonitor, CheckoutEvent } from "./cdp-monitor.js";
import { PageInjector } from "./injector.js";
import { AmazonExtractor } from "./sites/amazon.js";
import { ExpediaExtractor } from "./sites/expedia.js";
import { HotelsExtractor } from "./sites/hotels.js";
import { BookingExtractor } from "./sites/booking.js";
import { GenericExtractor } from "./sites/generic.js";
import type { SiteExtractor, ExtractedData } from "./sites/types.js";

export interface InterceptResult {
  decision: "APPROVED" | "BLOCKED" | "PENDING_HUMAN" | "ERROR";
  amount?: number;
  currency?: string;
  reason?: string;
  bditToken?: string;
  transactionId?: string;
}

interface PaymentApiResponse {
  decision?: string;
  amount?: number;
  reason?: string;
  ruleTriggered?: string | null;
  bditToken?: string;
  transactionId?: string;
  approvalId?: string;
}

interface ApprovalApiResponse {
  status?: string;
  bditToken?: string;
  transactionId?: string;
  reason?: string;
}

export interface InterceptorConfig {
  payjarvisApiUrl: string;
  botApiKey: string;
  botId: string;
  cdpMonitor: CdpMonitor;
}

export interface InterceptionRecord {
  event: CheckoutEvent;
  result: InterceptResult;
  timestamp: Date;
  data: ExtractedData | null;
}

export class PayjarvisInterceptor {
  private apiUrl: string;
  private botApiKey: string;
  private botId: string;
  private cdpMonitor: CdpMonitor;
  private extractors: Map<string, SiteExtractor>;
  private activeInterceptions = 0;
  private history: InterceptionRecord[] = [];

  constructor(config: InterceptorConfig) {
    this.apiUrl = config.payjarvisApiUrl;
    this.botApiKey = config.botApiKey;
    this.botId = config.botId;
    this.cdpMonitor = config.cdpMonitor;

    this.extractors = new Map<string, SiteExtractor>([
      ["amazon", new AmazonExtractor()],
      ["expedia", new ExpediaExtractor()],
      ["hotels", new HotelsExtractor()],
      ["booking", new BookingExtractor()],
      ["generic", new GenericExtractor()],
    ]);
  }

  get activeCount(): number {
    return this.activeInterceptions;
  }

  get recentHistory(): InterceptionRecord[] {
    return this.history.slice(-20);
  }

  /** Interceptar um evento de checkout detectado */
  async intercept(event: CheckoutEvent): Promise<InterceptResult> {
    this.activeInterceptions++;
    const injector = new PageInjector(this.cdpMonitor, event.tabId);

    try {
      // 1. PAUSAR — injetar overlay bloqueante
      await injector.injectPauseOverlay(
        "Verificando autoriza\u00e7\u00e3o de pagamento..."
      );

      // 2. EXTRAIR — ler dados da página
      const extractor = this.extractors.get(event.site) ??
        this.extractors.get("generic")!;

      const evaluateFn = (expression: string) =>
        this.cdpMonitor.evaluate(event.tabId, expression);

      let data: ExtractedData;
      try {
        data = await extractor.extract(evaluateFn);
      } catch {
        data = {
          amount: null,
          currency: "USD",
          items: [],
          merchantName: event.site,
        };
      }

      if (data.amount === null || data.amount <= 0) {
        // Não conseguiu extrair valor — liberar com aviso
        await injector.removePauseOverlay();
        const result: InterceptResult = {
          decision: "ERROR",
          reason: "N\u00e3o foi poss\u00edvel extrair o valor da compra",
        };
        this.recordHistory(event, result, data);
        return result;
      }

      // 3. VERIFICAR — chamar API do Payjarvis
      const sessionId = `${event.tabId}_${Date.now()}`;
      const category = data.category ?? extractor.category;

      const apiResult = await this.requestPayment({
        merchantId: this.extractMerchantId(event.url),
        merchantName: data.merchantName,
        amount: data.amount,
        currency: data.currency,
        category,
        description:
          data.items.length > 0
            ? data.items.join(", ").slice(0, 200)
            : `${data.merchantName} purchase`,
        sessionId,
      });

      // 4. APLICAR DECISÃO
      let result: InterceptResult;

      if (apiResult.decision === "APPROVED") {
        result = await this.handleApproved(
          injector, event, data, apiResult
        );
      } else if (apiResult.decision === "PENDING_HUMAN") {
        result = await this.handlePending(
          injector, event, data, apiResult
        );
      } else if (apiResult.decision === "BLOCKED") {
        result = await this.handleBlocked(
          injector, event, data, apiResult
        );
      } else {
        await injector.removePauseOverlay();
        result = {
          decision: "ERROR",
          reason: "Resposta inesperada da API",
        };
      }

      this.recordHistory(event, result, data);
      return result;
    } finally {
      this.activeInterceptions--;
    }
  }

  // ─── Decision Handlers ─────────────────────────────

  private async handleApproved(
    injector: PageInjector,
    event: CheckoutEvent,
    data: ExtractedData,
    apiResult: PaymentApiResponse
  ): Promise<InterceptResult> {
    // Armazenar BDIT token no localStorage da página
    if (apiResult.bditToken) {
      await this.cdpMonitor.evaluate(
        event.tabId,
        `localStorage.setItem('__payjarvis_bdit', ${JSON.stringify(apiResult.bditToken)})`
      );
    }

    // Remover overlay e mostrar badge verde
    await injector.injectApprovedBadge({
      name: this.botId,
      trustScore: 85, // Será preenchido pela API futuramente
      amount: data.amount!,
      currency: data.currency,
    });

    // Disparar evento para o bot saber
    await this.cdpMonitor.evaluate(
      event.tabId,
      `window.dispatchEvent(new CustomEvent('payjarvis:approved', { detail: ${JSON.stringify({ transactionId: apiResult.transactionId })} }))`
    );

    return {
      decision: "APPROVED",
      amount: data.amount!,
      currency: data.currency,
      bditToken: apiResult.bditToken,
      transactionId: apiResult.transactionId,
    };
  }

  private async handleBlocked(
    injector: PageInjector,
    event: CheckoutEvent,
    data: ExtractedData,
    apiResult: PaymentApiResponse
  ): Promise<InterceptResult> {
    const reason = apiResult.reason ?? "Transa\u00e7\u00e3o n\u00e3o autorizada";

    await injector.injectBlockedBanner(reason);

    // Disparar evento CDP para o bot
    await this.cdpMonitor.evaluate(
      event.tabId,
      `window.dispatchEvent(new CustomEvent('payjarvis:blocked', { detail: ${JSON.stringify({ reason })} }))`
    );

    return {
      decision: "BLOCKED",
      amount: data.amount ?? undefined,
      currency: data.currency,
      reason,
    };
  }

  private async handlePending(
    injector: PageInjector,
    event: CheckoutEvent,
    data: ExtractedData,
    apiResult: PaymentApiResponse
  ): Promise<InterceptResult> {
    const approvalId = apiResult.approvalId;
    if (!approvalId) {
      await injector.removePauseOverlay();
      return { decision: "ERROR", reason: "Sem approvalId" };
    }

    // Mostrar mensagem de aguardando
    await injector.injectPendingMessage();

    // Polling a cada 5s, timeout em 5 minutos
    const maxWait = 300; // 5 min em segundos
    const pollInterval = 5;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await this.sleep(pollInterval * 1000);
      elapsed += pollInterval;

      // Atualizar countdown
      await injector.updatePendingMessage(maxWait - elapsed);

      const status = await this.checkApproval(approvalId);

      if (status.status === "approved") {
        // Aprovado!
        if (status.bditToken) {
          await this.cdpMonitor.evaluate(
            event.tabId,
            `localStorage.setItem('__payjarvis_bdit', ${JSON.stringify(status.bditToken)})`
          );
        }

        await injector.injectApprovedBadge({
          name: this.botId,
          trustScore: 85,
          amount: data.amount!,
          currency: data.currency,
        });

        await this.cdpMonitor.evaluate(
          event.tabId,
          `window.dispatchEvent(new CustomEvent('payjarvis:approved', { detail: ${JSON.stringify({ transactionId: status.transactionId })} }))`
        );

        return {
          decision: "APPROVED",
          amount: data.amount!,
          currency: data.currency,
          bditToken: status.bditToken,
          transactionId: status.transactionId,
        };
      }

      if (status.status === "rejected") {
        const reason = status.reason ?? "Rejeitado pelo propriet\u00e1rio";
        await injector.injectBlockedBanner(reason);
        return { decision: "BLOCKED", reason };
      }

      if (status.status === "expired") {
        await injector.injectBlockedBanner(
          "Aprova\u00e7\u00e3o expirou (timeout de 5 minutos)"
        );
        return { decision: "BLOCKED", reason: "Timeout" };
      }
      // status === "pending" → continuar polling
    }

    // Timeout
    await injector.injectBlockedBanner(
      "Aprova\u00e7\u00e3o expirou (timeout de 5 minutos)"
    );
    return { decision: "BLOCKED", reason: "Timeout" };
  }

  // ─── API Communication ─────────────────────────────

  private async requestPayment(params: {
    merchantId: string;
    merchantName: string;
    amount: number;
    currency: string;
    category: string;
    description: string;
    sessionId: string;
  }): Promise<PaymentApiResponse> {
    try {
      const res = await fetch(
        `${this.apiUrl}/bots/${this.botId}/request-payment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Bot-Api-Key": this.botApiKey,
          },
          body: JSON.stringify(params),
        }
      );

      if (!res.ok) {
        return { decision: "ERROR" };
      }

      return (await res.json()) as PaymentApiResponse;
    } catch {
      return { decision: "ERROR" };
    }
  }

  private async checkApproval(
    approvalId: string
  ): Promise<ApprovalApiResponse> {
    try {
      const res = await fetch(
        `${this.apiUrl}/bots/${this.botId}/approvals/${approvalId}`,
        {
          method: "GET",
          headers: { "X-Bot-Api-Key": this.botApiKey },
        }
      );

      if (!res.ok) return {};
      return (await res.json()) as ApprovalApiResponse;
    } catch {
      return {};
    }
  }

  // ─── Helpers ───────────────────────────────────────

  private extractMerchantId(url: string): string {
    try {
      const hostname = new URL(url).hostname;
      // amazon.com → amazon, hotels.com → hotels_com
      return hostname
        .replace(/^www\./, "")
        .replace(/\.(com|co|com\.br|co\.uk|de|fr|es|it|co\.jp|ca|in)$/g, "")
        .replace(/\./g, "_");
    } catch {
      return "unknown";
    }
  }

  private recordHistory(
    event: CheckoutEvent,
    result: InterceptResult,
    data: ExtractedData | null
  ): void {
    this.history.push({
      event,
      result,
      data,
      timestamp: new Date(),
    });
    // Manter últimos 100
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
