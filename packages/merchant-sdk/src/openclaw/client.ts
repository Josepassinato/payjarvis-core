/**
 * OpenClaw Client — conversa com agente AI via gateway OpenClaw
 * com interceptação automática de function calls do Payjarvis.
 */

import { PAYJARVIS_OPENCLAW_TOOLS } from "./tools.js";
import { PayjarvisToolHandler } from "./handler.js";

export interface OpenClawClientConfig {
  openclawGatewayUrl: string;
  openclawToken: string;
  payjarvisApiUrl: string;
  botApiKey: string;
  botId: string;
  agentId?: string;
}

export interface ChatOptions {
  userId?: string;
  extraTools?: unknown[];
  systemPrompt?: string;
}

export interface ChatResult {
  response: string;
  toolCallsMade: string[];
  paymentsApproved: number;
  paymentsBlocked: number;
  paymentsPending: number;
}

interface OutputItem {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string | Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  role?: string;
}

export class OpenClawPayjarvisClient {
  private handler: PayjarvisToolHandler;

  constructor(private config: OpenClawClientConfig) {
    this.handler = new PayjarvisToolHandler({
      payjarvisApiUrl: config.payjarvisApiUrl,
      botApiKey: config.botApiKey,
      botId: config.botId,
    });
  }

  async chat(input: string, options?: ChatOptions): Promise<ChatResult> {
    const allTools = [
      ...PAYJARVIS_OPENCLAW_TOOLS,
      ...(options?.extraTools || []),
    ];

    const toolCallsMade: string[] = [];
    let paymentsApproved = 0;
    let paymentsBlocked = 0;
    let paymentsPending = 0;

    const messages: unknown[] = [];
    if (options?.systemPrompt) {
      messages.push({
        type: "message",
        role: "developer",
        content: options.systemPrompt,
      });
    }
    messages.push({ type: "message", role: "user", content: input });

    // Agentic loop — processa tool calls até resposta final
    while (true) {
      const res = await fetch(
        `${this.config.openclawGatewayUrl}/v1/responses`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.openclawToken}`,
            "Content-Type": "application/json",
            "x-openclaw-agent-id": this.config.agentId || "main",
          },
          body: JSON.stringify({
            model: "openclaw",
            input: messages,
            tools: allTools,
            user: options?.userId,
          }),
        }
      );

      const data = (await res.json()) as {
        error?: { message?: string };
        output?: OutputItem[];
      };
      if (!res.ok) {
        throw new Error(data.error?.message || "OpenClaw API error");
      }

      const output: OutputItem[] = data.output || [];

      // Coletar function_calls
      const functionCalls = output.filter(
        (item) => item.type === "function_call"
      );

      if (functionCalls.length === 0) {
        // Sem mais tool calls — extrair resposta final
        const textOutput = output.find((item) => item.type === "message");
        const text =
          textOutput?.content
            ?.filter((c) => c.type === "output_text")
            ?.map((c) => c.text)
            ?.join("") || "";

        return {
          response: text,
          toolCallsMade,
          paymentsApproved,
          paymentsBlocked,
          paymentsPending,
        };
      }

      // Adicionar output ao histórico
      messages.push(...output);

      // Processar cada function_call
      const toolOutputs: unknown[] = [];
      for (const call of functionCalls) {
        toolCallsMade.push(call.name!);
        const args =
          typeof call.arguments === "string"
            ? JSON.parse(call.arguments)
            : call.arguments ?? {};

        const result = await this.handler.handle(call.name!, args);
        const parsed = JSON.parse(result);

        // Contabilizar pagamentos
        if (call.name === "payjarvis_request_payment") {
          if (parsed.status === "APPROVED") paymentsApproved++;
          if (parsed.status === "BLOCKED") paymentsBlocked++;
          if (parsed.status === "PENDING_HUMAN_APPROVAL") paymentsPending++;
        }

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result,
        });
      }

      messages.push(...toolOutputs);
    }
  }
}
