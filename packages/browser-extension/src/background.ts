/**
 * PayJarvis Browser Extension — Background Service Worker
 *
 * Gerencia a comunicação entre content scripts e a API
 * do Payjarvis. Intercepta checkouts em sites de terceiros
 * (Amazon, Hotels.com, Expedia) e solicita autorização.
 */

import type {
  PayjarvisConfig,
  PaymentRequest,
  PaymentDecision,
  ExtensionMessage,
} from "./types.js";

const DEFAULT_CONFIG: PayjarvisConfig = {
  apiUrl: "https://api.payjarvis.com",
  botApiKey: "",
  botId: "",
  enabled: true,
};

// ─── Config Management ───────────────────────────────

async function getConfig(): Promise<PayjarvisConfig> {
  const result = await chrome.storage.sync.get("payjarvis_config");
  return { ...DEFAULT_CONFIG, ...(result.payjarvis_config as Partial<PayjarvisConfig>) };
}

async function saveConfig(config: Partial<PayjarvisConfig>): Promise<void> {
  const current = await getConfig();
  await chrome.storage.sync.set({
    payjarvis_config: { ...current, ...config },
  });
}

// ─── API Communication ───────────────────────────────

async function requestPaymentApproval(
  request: PaymentRequest
): Promise<PaymentDecision> {
  const config = await getConfig();

  if (!config.enabled || !config.botApiKey || !config.botId) {
    return {
      status: "ERROR",
      message: "PayJarvis não está configurado. Abra a extensão para configurar.",
    };
  }

  try {
    const res = await fetch(
      `${config.apiUrl}/bots/${config.botId}/request-payment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bot-Api-Key": config.botApiKey,
        },
        body: JSON.stringify({
          merchantId: request.merchantId,
          merchantName: request.merchantName,
          amount: request.amount,
          currency: request.currency,
          category: request.category,
          description: request.description,
          sessionId: request.sessionId,
        }),
      }
    );

    if (!res.ok) {
      return {
        status: "ERROR",
        message: `API retornou ${res.status}`,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;

    if (data.decision === "APPROVED") {
      return {
        status: "APPROVED",
        message: `Transação de $${request.amount} aprovada.`,
        bditToken: data.bditToken as string | undefined,
        transactionId: data.transactionId as string | undefined,
      };
    }

    if (data.decision === "BLOCKED") {
      return {
        status: "BLOCKED",
        message: `Bloqueado: ${data.reason as string}`,
        reason: data.reason as string | undefined,
      };
    }

    if (data.decision === "PENDING_HUMAN") {
      // Iniciar polling para aprovação humana
      const approvalId = data.approvalId as string;
      startApprovalPolling(config, approvalId, request);
      return {
        status: "PENDING_HUMAN_APPROVAL",
        message: "Aguardando aprovação do dono do bot...",
        approvalId,
      };
    }

    return {
      status: "ERROR",
      message: "Resposta inesperada da API",
    };
  } catch (err) {
    return {
      status: "ERROR",
      message: `Erro de conexão: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

// ─── Approval Polling ────────────────────────────────

function startApprovalPolling(
  config: PayjarvisConfig,
  approvalId: string,
  originalRequest: PaymentRequest
): void {
  // Usar chrome.alarms para polling a cada 10s
  const alarmName = `approval_${approvalId}`;

  // Guardar dados para o alarm handler
  chrome.storage.local.set({
    [`pending_${approvalId}`]: {
      config,
      approvalId,
      originalRequest,
      attempts: 0,
      maxAttempts: 30, // 5 minutos
    },
  });

  chrome.alarms.create(alarmName, { periodInMinutes: 1 / 6 }); // ~10s
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("approval_")) return;

  const approvalId = alarm.name.replace("approval_", "");
  const stored = await chrome.storage.local.get(`pending_${approvalId}`);
  const pending = stored[`pending_${approvalId}`] as {
    config: PayjarvisConfig;
    approvalId: string;
    originalRequest: PaymentRequest;
    attempts: number;
    maxAttempts: number;
  } | undefined;

  if (!pending) {
    chrome.alarms.clear(alarm.name);
    return;
  }

  if (pending.attempts >= pending.maxAttempts) {
    chrome.alarms.clear(alarm.name);
    await chrome.storage.local.remove(`pending_${approvalId}`);
    await showNotification(
      "PayJarvis — Expirado",
      "Aprovação expirou após 5 minutos."
    );
    return;
  }

  try {
    const res = await fetch(
      `${pending.config.apiUrl}/bots/${pending.config.botId}/approvals/${approvalId}`,
      {
        method: "GET",
        headers: {
          "X-Bot-Api-Key": pending.config.botApiKey,
        },
      }
    );

    const data = (await res.json()) as Record<string, unknown>;

    if (data.status === "approved") {
      chrome.alarms.clear(alarm.name);
      await chrome.storage.local.remove(`pending_${approvalId}`);
      await showNotification(
        "PayJarvis — Aprovado",
        `Transação de $${pending.originalRequest.amount} foi aprovada!`
      );
    } else if (data.status === "rejected") {
      chrome.alarms.clear(alarm.name);
      await chrome.storage.local.remove(`pending_${approvalId}`);
      await showNotification(
        "PayJarvis — Rejeitado",
        `Transação rejeitada: ${(data.reason as string) ?? "sem motivo"}`
      );
    } else {
      // Ainda pendente, incrementar
      pending.attempts++;
      await chrome.storage.local.set({
        [`pending_${approvalId}`]: pending,
      });
    }
  } catch {
    pending.attempts++;
    await chrome.storage.local.set({
      [`pending_${approvalId}`]: pending,
    });
  }
});

// ─── Notifications ───────────────────────────────────

async function showNotification(title: string, message: string): Promise<void> {
  // Enviar para popup se aberto, senão usar badge
  try {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  } catch {
    // Ignorar se não suportar badges
  }

  // Armazenar notificação para o popup exibir
  const stored = await chrome.storage.local.get("notifications");
  const notifications = (stored.notifications as Array<{ title: string; message: string; timestamp: number }>) ?? [];
  notifications.unshift({ title, message, timestamp: Date.now() });
  // Manter últimas 20
  await chrome.storage.local.set({
    notifications: notifications.slice(0, 20),
  });
}

// ─── Message Handler ─────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "GET_CONFIG") {
      getConfig().then((config) => sendResponse(config));
      return true; // async
    }

    if (message.type === "REQUEST_PAYMENT_APPROVAL") {
      requestPaymentApproval(message.payload).then((decision) =>
        sendResponse(decision)
      );
      return true; // async
    }

    return false;
  }
);

// Listener para mudanças de config via popup
chrome.runtime.onMessage.addListener(
  (message: { type: string; payload?: Partial<PayjarvisConfig> }, _sender, sendResponse) => {
    if (message.type === "SAVE_CONFIG" && message.payload) {
      saveConfig(message.payload).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  }
);

// Limpar badge quando popup é aberto
chrome.action.onClicked.addListener(async () => {
  await chrome.action.setBadgeText({ text: "" });
});
