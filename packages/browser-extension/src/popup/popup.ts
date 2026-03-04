/**
 * PayJarvis Extension — Popup Script
 */

const $botId = document.getElementById("botId") as HTMLInputElement;
const $botApiKey = document.getElementById("botApiKey") as HTMLInputElement;
const $apiUrl = document.getElementById("apiUrl") as HTMLInputElement;
const $enabled = document.getElementById("enabled") as HTMLInputElement;
const $saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const $status = document.getElementById("status") as HTMLDivElement;
const $notifications = document.getElementById("notifications") as HTMLDivElement;

// Carregar config
chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (config) => {
  if (config) {
    $botId.value = config.botId ?? "";
    $botApiKey.value = config.botApiKey ?? "";
    $apiUrl.value = config.apiUrl ?? "https://api.payjarvis.com";
    $enabled.checked = config.enabled !== false;
  }
});

// Salvar config
$saveBtn.addEventListener("click", () => {
  const config = {
    botId: $botId.value.trim(),
    botApiKey: $botApiKey.value.trim(),
    apiUrl: $apiUrl.value.trim() || "https://api.payjarvis.com",
    enabled: $enabled.checked,
  };

  chrome.runtime.sendMessage(
    { type: "SAVE_CONFIG", payload: config },
    (response) => {
      if (response?.ok) {
        showStatus("Configuração salva!", "ok");
      } else {
        showStatus("Erro ao salvar", "error");
      }
    }
  );
});

function showStatus(message: string, type: "ok" | "error"): void {
  $status.textContent = message;
  $status.className = `status ${type}`;
  $status.style.display = "block";
  setTimeout(() => {
    $status.style.display = "none";
  }, 3000);
}

// Carregar notificações
chrome.storage.local.get("notifications", (result) => {
  const notifications = (result.notifications ?? []) as Array<{
    title: string;
    message: string;
    timestamp: number;
  }>;

  if (notifications.length === 0) return;

  $notifications.innerHTML = "";

  for (const notif of notifications.slice(0, 10)) {
    const el = document.createElement("div");
    el.className = "notif-item";
    const ago = formatTimeAgo(notif.timestamp);
    el.innerHTML =
      `<div class="title">${escapeHtml(notif.title)}</div>` +
      `<div>${escapeHtml(notif.message)}</div>` +
      `<div class="time">${ago}</div>`;
    $notifications.appendChild(el);
  }
});

// Limpar badge
chrome.action.setBadgeText({ text: "" });

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
