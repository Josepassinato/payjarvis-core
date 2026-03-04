/**
 * OpenClaw Bridge — Descobre e conecta ao browser do OpenClaw.
 *
 * O OpenClaw expõe o Chrome em portas 18800-18899.
 * Este módulo descobre automaticamente a porta ativa
 * e pode registrar o Browser Agent como tool do OpenClaw.
 */

export interface OpenClawBrowserInfo {
  port: number;
  webSocketDebuggerUrl: string;
  browserVersion: string;
  userAgent: string;
}

/**
 * Descobre automaticamente qual porta o OpenClaw está usando
 * para expor o Chrome via CDP (Chrome DevTools Protocol).
 */
export async function discoverOpenClawBrowserPort(): Promise<number> {
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

/**
 * Obtém informações detalhadas do browser do OpenClaw.
 */
export async function getOpenClawBrowserInfo(
  port: number
): Promise<OpenClawBrowserInfo> {
  const res = await fetch(`http://localhost:${port}/json/version`);
  if (!res.ok) {
    throw new Error(`Falha ao conectar na porta ${port}: ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  return {
    port,
    webSocketDebuggerUrl: data.webSocketDebuggerUrl as string,
    browserVersion: (data["Browser"] as string) ?? "unknown",
    userAgent: (data["User-Agent"] as string) ?? "unknown",
  };
}

/**
 * Registrar o Browser Agent como tool do OpenClaw
 * via Tools Invoke API (Gateway).
 */
export async function registerAsOpenClawTool(config: {
  gatewayUrl: string;
  gatewayToken: string;
  browserAgentUrl: string;
}): Promise<void> {
  const toolDefinition = {
    type: "function",
    function: {
      name: "payjarvis_browser_intercept",
      description:
        "Ativa o monitoramento do Payjarvis no browser. " +
        "Quando ativo, todas as tentativas de checkout em " +
        "Amazon, Expedia, Hotels.com e Booking.com serão " +
        "verificadas antes de prosseguir. " +
        "Chame esta tool antes de navegar para sites de compras.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start", "stop", "status"],
            description:
              "start: ativa monitoramento, " +
              "stop: desativa, " +
              "status: verifica se está ativo",
          },
        },
        required: ["action"],
      },
    },
  };

  const res = await fetch(`${config.gatewayUrl}/tools/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.gatewayToken}`,
    },
    body: JSON.stringify({
      tool: toolDefinition,
      callbackUrl: `${config.browserAgentUrl}/openclaw/tool-invoke`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Falha ao registrar tool no OpenClaw: ${res.status} ${body}`
    );
  }
}
