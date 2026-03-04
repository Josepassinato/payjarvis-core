/**
 * CDP Monitor — Conecta ao Chrome do OpenClaw via Chrome DevTools Protocol.
 *
 * Monitora eventos de navegação e detecta páginas de checkout
 * em sites de terceiros (Amazon, Expedia, Hotels.com, Booking.com).
 */

import WebSocket from "ws";
import { CheckoutDetector, type CheckoutMatch } from "./checkout-detector.js";

export interface CheckoutEvent {
  url: string;
  site: "amazon" | "expedia" | "hotels" | "booking" | "generic";
  tabId: string;
  frameId: string;
  estimatedAmount?: number;
  currency?: string;
  match: CheckoutMatch;
}

export interface CdpMonitorConfig {
  port?: number;
  payjarvisApiUrl: string;
  botApiKey: string;
  botId: string;
  onCheckoutDetected: (event: CheckoutEvent) => void;
}

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export class CdpMonitor {
  private ws: WebSocket | null = null;
  private port: number;
  private autoDiscover: boolean;
  private detector: CheckoutDetector;
  private config: CdpMonitorConfig;
  private messageId = 0;
  private pendingCallbacks = new Map<number, (result: unknown) => void>();
  private connected = false;
  private monitoredTargets = new Set<string>();

  constructor(config: CdpMonitorConfig) {
    this.config = config;
    this.port = config.port ?? 0;
    this.autoDiscover = !config.port;
    this.detector = new CheckoutDetector();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get cdpPort(): number {
    return this.port;
  }

  /** Descobrir porta CDP automaticamente (18800-18899) */
  async discoverPort(): Promise<number> {
    for (let port = 18800; port <= 18899; port++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 500);
        const res = await fetch(`http://localhost:${port}/json/version`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          if (data.webSocketDebuggerUrl) {
            return port;
          }
        }
      } catch {
        // Porta não responde, tentar próxima
      }
    }
    throw new Error(
      "OpenClaw browser não encontrado nas portas 18800-18899"
    );
  }

  /** Conectar ao Chrome via CDP */
  async connect(): Promise<void> {
    if (this.autoDiscover) {
      this.port = await this.discoverPort();
    }

    // Listar targets disponíveis
    const targets = await this.listTargets();
    const pageTargets = targets.filter((t) => t.type === "page");

    if (pageTargets.length === 0) {
      throw new Error("Nenhuma page target encontrada no Chrome");
    }

    // Conectar ao browser endpoint para monitorar todas as tabs
    const versionRes = await fetch(
      `http://localhost:${this.port}/json/version`
    );
    const versionData = (await versionRes.json()) as Record<string, unknown>;
    const wsUrl = versionData.webSocketDebuggerUrl as string;

    if (!wsUrl) {
      throw new Error("webSocketDebuggerUrl não encontrado");
    }

    this.ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timeout conectando ao CDP")),
        10000
      );
      this.ws!.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.connected = true;

    this.ws.on("message", (data) => {
      this.handleMessage(JSON.parse(data.toString()) as CdpMessage);
    });

    this.ws.on("close", () => {
      this.connected = false;
    });

    // Habilitar monitoramento de targets
    await this.send("Target.setDiscoverTargets", { discover: true });

    // Monitorar pages existentes
    for (const target of pageTargets) {
      await this.attachToTarget(target);
    }
  }

  /** Desconectar do Chrome */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.monitoredTargets.clear();
    this.pendingCallbacks.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Listar targets CDP */
  private async listTargets(): Promise<CdpTarget[]> {
    const res = await fetch(`http://localhost:${this.port}/json/list`);
    return (await res.json()) as CdpTarget[];
  }

  /** Attach a um target para monitorar navegação */
  private async attachToTarget(target: CdpTarget): Promise<void> {
    if (this.monitoredTargets.has(target.id)) return;
    this.monitoredTargets.add(target.id);

    // Verificar URL atual do target
    this.checkUrl(target.url, target.id, "main");
  }

  /** Enviar comando CDP */
  async send(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP não conectado");
    }

    const id = ++this.messageId;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pendingCallbacks.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        },
        15000
      );

      this.pendingCallbacks.set(id, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });

      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Avaliar JavaScript no contexto da página */
  async evaluate(
    targetId: string,
    expression: string
  ): Promise<unknown> {
    return this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      targetId,
    });
  }

  /** Processar mensagens CDP */
  private handleMessage(msg: CdpMessage): void {
    // Resposta a um comando
    if (msg.id !== undefined) {
      const callback = this.pendingCallbacks.get(msg.id);
      if (callback) {
        this.pendingCallbacks.delete(msg.id);
        callback(msg.result ?? msg.error);
      }
      return;
    }

    // Evento CDP
    if (msg.method) {
      this.handleEvent(msg.method, msg.params ?? {});
    }
  }

  /** Processar eventos CDP */
  private handleEvent(
    method: string,
    params: Record<string, unknown>
  ): void {
    switch (method) {
      case "Target.targetInfoChanged": {
        const info = params.targetInfo as {
          targetId: string;
          type: string;
          url: string;
        } | undefined;
        if (info?.type === "page") {
          this.checkUrl(info.url, info.targetId, "main");
        }
        break;
      }

      case "Target.targetCreated": {
        const info = params.targetInfo as {
          targetId: string;
          type: string;
          url: string;
        } | undefined;
        if (info?.type === "page") {
          this.monitoredTargets.add(info.targetId);
          this.checkUrl(info.url, info.targetId, "main");
        }
        break;
      }

      case "Target.targetDestroyed": {
        const targetId = params.targetId as string | undefined;
        if (targetId) {
          this.monitoredTargets.delete(targetId);
        }
        break;
      }

      case "Page.frameNavigated": {
        const frame = params.frame as {
          id: string;
          url: string;
          parentId?: string;
        } | undefined;
        if (frame && !frame.parentId) {
          // Main frame navigation
          this.checkUrl(frame.url, "unknown", frame.id);
        }
        break;
      }
    }
  }

  /** Verificar se uma URL é checkout */
  private checkUrl(url: string, tabId: string, frameId: string): void {
    const match = this.detector.detect(url);

    if (!match) return;

    // Só interceptar payment/confirm com confidence alta/média
    if (match.stage === "cart") return;
    if (match.confidence === "low") return;

    const event: CheckoutEvent = {
      url,
      site: match.site as CheckoutEvent["site"],
      tabId,
      frameId,
      match,
    };

    this.config.onCheckoutDetected(event);
  }
}
