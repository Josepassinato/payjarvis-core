import type { PayJarvisConfig, ApprovalRequest, ApprovalDecision, SpendingLimits, HandoffRequest, HandoffResult } from "./types.js";

const KNOWN_HARDCODED = ["pj_bot_example_do_not_use", "bot-example-000"];

export class PayJarvis {
  private apiKey: string;
  private botId: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config?: Partial<PayJarvisConfig>) {
    const apiKey = config?.apiKey ?? process.env.PAYJARVIS_API_KEY;
    const botId = config?.botId ?? process.env.PAYJARVIS_BOT_ID;
    const baseUrl = config?.baseUrl ?? process.env.PAYJARVIS_URL ?? "https://api.payjarvis.com";

    if (!apiKey) {
      throw new Error(
        "PAYJARVIS_API_KEY not found. Add it to your .env file.\n" +
        "Example: PAYJARVIS_API_KEY=pj_bot_your_key_here"
      );
    }

    if (!botId) {
      throw new Error(
        "PAYJARVIS_BOT_ID not found. Add it to your .env file.\n" +
        "Example: PAYJARVIS_BOT_ID=your-bot-id"
      );
    }

    if (KNOWN_HARDCODED.includes(apiKey) || KNOWN_HARDCODED.includes(botId)) {
      throw new Error(
        "Hardcoded credentials detected. Use environment variables instead.\n" +
        "Set PAYJARVIS_API_KEY and PAYJARVIS_BOT_ID in your .env file."
      );
    }

    this.apiKey = apiKey;
    this.botId = botId;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeout = config?.timeout ?? 30_000;
  }

  static fromEnv(): PayJarvis {
    return new PayJarvis();
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    const merchantId = req.merchantId ?? req.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const sessionId = crypto.randomUUID();

    const res = await this.fetch(`/bots/${this.botId}/request-payment`, {
      method: "POST",
      body: JSON.stringify({
        merchantId,
        merchantName: req.merchant,
        amount: req.amount,
        ...(req.currency && { currency: req.currency }),
        category: req.category,
        description: req.description,
        sessionId,
      }),
    });

    const json = await res.json() as any;
    if (!json.success) {
      throw new Error(json.error ?? "Payment request failed");
    }

    const d = json.data;
    return {
      approved: d.decision === "APPROVED",
      pending: d.decision === "PENDING_HUMAN",
      blocked: d.decision === "BLOCKED",
      transactionId: d.transactionId,
      approvalId: d.approvalId,
      bditToken: d.bditToken,
      reason: d.reason,
      ruleTriggered: d.ruleTriggered ?? null,
      expiresAt: d.expiresAt,
    };
  }

  async waitForApproval(
    approvalId: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number }
  ): Promise<ApprovalDecision> {
    const interval = opts?.pollIntervalMs ?? 2_000;
    const timeout = opts?.timeoutMs ?? 5 * 60 * 1_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const res = await this.fetch(`/approvals/${approvalId}/status`, { method: "GET" });
      const json = await res.json() as any;

      if (!json.success) {
        throw new Error(json.error ?? "Failed to check approval status");
      }

      const status = json.data.status;
      if (status === "APPROVED") {
        return {
          approved: true,
          pending: false,
          blocked: false,
          transactionId: json.data.transactionId,
          approvalId,
          bditToken: json.data.bditToken,
          expiresAt: json.data.expiresAt,
        };
      }
      if (status === "REJECTED" || status === "EXPIRED") {
        return {
          approved: false,
          pending: false,
          blocked: true,
          transactionId: json.data.transactionId,
          approvalId,
          reason: status === "EXPIRED" ? "Approval expired" : "Rejected by owner",
        };
      }

      await new Promise((r) => setTimeout(r, interval));
    }

    return {
      approved: false,
      pending: false,
      blocked: true,
      transactionId: "",
      approvalId,
      reason: "Timed out waiting for approval",
    };
  }

  async waitForApprovalSSE(
    approvalId: string,
    opts?: { timeoutMs?: number }
  ): Promise<ApprovalDecision> {
    const timeout = opts?.timeoutMs ?? 5 * 60 * 1_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await globalThis.fetch(`${this.baseUrl}/approvals/stream/bot`, {
        method: "GET",
        headers: {
          "X-Bot-Api-Key": this.apiKey,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SSE connection failed: HTTP ${res.status}: ${text || res.statusText}`);
      }

      if (!res.body) {
        throw new Error("SSE response has no readable body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep incomplete last line in buffer
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent === "approval_decided") {
            try {
              const data = JSON.parse(line.slice(6)) as {
                id: string;
                status: string;
                transactionId?: string;
                bditToken?: string;
              };

              if (data.id === approvalId) {
                reader.cancel();
                if (data.status === "APPROVED") {
                  return {
                    approved: true,
                    pending: false,
                    blocked: false,
                    transactionId: data.transactionId ?? "",
                    bditToken: data.bditToken,
                  };
                }
                return {
                  approved: false,
                  pending: false,
                  blocked: true,
                  transactionId: data.transactionId ?? "",
                  reason: data.status === "EXPIRED" ? "Approval expired" : "Rejected by owner",
                };
              }
            } catch {
              // Ignore malformed JSON
            }
            currentEvent = "";
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }

      // Stream ended without a matching event
      return {
        approved: false,
        pending: false,
        blocked: true,
        transactionId: "",
        reason: "SSE stream ended without approval decision",
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return {
          approved: false,
          pending: false,
          blocked: true,
          transactionId: "",
          reason: "Timed out waiting for approval",
        };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async requestHandoff(req: HandoffRequest): Promise<HandoffResult> {
    const res = await this.fetch(`/bots/${this.botId}/request-handoff`, {
      method: "POST",
      body: JSON.stringify({
        sessionUrl: req.sessionUrl,
        obstacleType: req.obstacleType,
        description: req.description,
        metadata: req.metadata,
      }),
    });

    const json = await res.json() as any;
    if (!json.success) {
      throw new Error(json.error ?? "Handoff request failed");
    }

    return {
      handoffId: json.data.handoffId,
      status: json.data.status,
      resolved: false,
      expiresAt: json.data.expiresAt,
    };
  }

  async waitForHandoff(
    handoffId: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number }
  ): Promise<HandoffResult> {
    const interval = opts?.pollIntervalMs ?? 3_000;
    const timeout = opts?.timeoutMs ?? 15 * 60 * 1_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const res = await this.fetch(`/handoffs/${handoffId}/status`, { method: "GET" });
      const json = await res.json() as any;

      if (!json.success) {
        throw new Error(json.error ?? "Failed to check handoff status");
      }

      const status = json.data.status;
      if (status === "RESOLVED") {
        return {
          handoffId,
          status: "RESOLVED",
          resolved: true,
          resolvedNote: json.data.resolvedNote,
          expiresAt: json.data.expiresAt,
        };
      }
      if (status === "EXPIRED" || status === "CANCELLED") {
        return {
          handoffId,
          status,
          resolved: false,
          reason: status === "EXPIRED" ? "Handoff expired" : "Handoff cancelled",
          expiresAt: json.data.expiresAt,
        };
      }

      await new Promise((r) => setTimeout(r, interval));
    }

    return {
      handoffId,
      status: "EXPIRED",
      resolved: false,
      reason: "Timed out waiting for handoff resolution",
    };
  }

  async waitForHandoffSSE(
    handoffId: string,
    opts?: { timeoutMs?: number }
  ): Promise<HandoffResult> {
    const timeout = opts?.timeoutMs ?? 15 * 60 * 1_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await globalThis.fetch(`${this.baseUrl}/handoffs/stream/bot`, {
        method: "GET",
        headers: {
          "X-Bot-Api-Key": this.apiKey,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SSE connection failed: HTTP ${res.status}: ${text || res.statusText}`);
      }

      if (!res.body) {
        throw new Error("SSE response has no readable body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent === "handoff_resolved") {
            try {
              const data = JSON.parse(line.slice(6)) as {
                id: string;
                status: string;
                resolvedNote?: string;
              };

              if (data.id === handoffId) {
                reader.cancel();
                if (data.status === "RESOLVED") {
                  return {
                    handoffId,
                    status: "RESOLVED",
                    resolved: true,
                    resolvedNote: data.resolvedNote,
                  };
                }
                return {
                  handoffId,
                  status: data.status as HandoffResult["status"],
                  resolved: false,
                  reason: data.status === "EXPIRED" ? "Handoff expired" : "Handoff cancelled",
                };
              }
            } catch {
              // Ignore malformed JSON
            }
            currentEvent = "";
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }

      return {
        handoffId,
        status: "EXPIRED",
        resolved: false,
        reason: "SSE stream ended without handoff resolution",
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return {
          handoffId,
          status: "EXPIRED",
          resolved: false,
          reason: "Timed out waiting for handoff resolution",
        };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async cancelHandoff(handoffId: string): Promise<void> {
    const res = await this.fetch(`/handoffs/${handoffId}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    const json = await res.json() as any;
    if (!json.success) {
      throw new Error(json.error ?? "Failed to cancel handoff");
    }
  }

  async checkLimits(): Promise<SpendingLimits> {
    const res = await this.fetch(`/bots/${this.botId}/limits`, { method: "GET" });
    const json = await res.json() as any;
    if (!json.success) {
      throw new Error(json.error ?? "Failed to check limits");
    }
    return json.data as SpendingLimits;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Bot-Api-Key": this.apiKey,
          ...init.headers,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        try {
          const json = JSON.parse(text);
          if (json.error) throw new Error(json.error);
        } catch {
          // not JSON
        }
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }

      return res;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
