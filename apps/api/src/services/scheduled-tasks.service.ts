/**
 * Scheduled Tasks Service — CRUD + natural language to cron + execution engine.
 *
 * Lets users create recurring tasks like:
 * "Todo dia às 8h me manda as notícias"
 * "Toda segunda às 9h busca o preço do dólar"
 * "A cada 6 horas verifica se o preço do iPhone baixou"
 */

import { prisma } from "@payjarvis/database";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendWhatsAppMessage } from "./twilio-whatsapp.service.js";
import { sendTelegramNotification } from "./notifications.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// ─── Natural Language → Cron Expression ────────────────────

const COMMON_PATTERNS: Record<string, string> = {
  // Portuguese
  "todo dia": "0 9 * * *",
  "todos os dias": "0 9 * * *",
  "toda segunda": "0 9 * * 1",
  "toda terça": "0 9 * * 2",
  "toda quarta": "0 9 * * 3",
  "toda quinta": "0 9 * * 4",
  "toda sexta": "0 9 * * 5",
  "todo sábado": "0 9 * * 6",
  "todo sabado": "0 9 * * 6",
  "todo domingo": "0 9 * * 0",
  "segunda a sexta": "0 9 * * 1-5",
  "dias úteis": "0 9 * * 1-5",
  "dias uteis": "0 9 * * 1-5",
  "todo dia 1 do mês": "0 9 1 * *",
  "todo dia 1 do mes": "0 9 1 * *",
  "todo dia primeiro": "0 9 1 * *",
  // English
  "every day": "0 9 * * *",
  "every monday": "0 9 * * 1",
  "every tuesday": "0 9 * * 2",
  "every wednesday": "0 9 * * 3",
  "every thursday": "0 9 * * 4",
  "every friday": "0 9 * * 5",
  "every saturday": "0 9 * * 6",
  "every sunday": "0 9 * * 0",
  "weekdays": "0 9 * * 1-5",
  "first of the month": "0 9 1 * *",
  "first of month": "0 9 1 * *",
};

/**
 * Parse time from natural language. Returns hour and minute.
 */
function parseTime(text: string): { hour: number; minute: number } | null {
  // Match patterns like "8h", "8am", "8pm", "8:30", "às 8h", "at 8am", "18h", "8h30"
  const patterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
    /(\d{1,2})h(\d{2})?/i,
    /(\d{1,2})\s*(am|pm)/i,
    /às?\s+(\d{1,2})/i,
    /at\s+(\d{1,2})/i,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      let hour = parseInt(m[1], 10);
      const minute = m[2] ? parseInt(m[2], 10) : 0;
      const ampm = m[3]?.toLowerCase();
      if (ampm === "pm" && hour < 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;
      return { hour, minute };
    }
  }
  return null;
}

/**
 * Parse interval like "a cada 6 horas", "every 2 hours", "every 30 minutes"
 */
function parseInterval(text: string): string | null {
  const lower = text.toLowerCase();

  // "a cada X horas" / "every X hours"
  const hourMatch = lower.match(/(?:a cada|every)\s+(\d+)\s*(?:hora|hour|hr|h)/i);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return `0 */${hours} * * *`;
  }

  // "a cada X minutos" / "every X minutes"
  const minMatch = lower.match(/(?:a cada|every)\s+(\d+)\s*(?:minuto|minute|min)/i);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    return `*/${mins} * * * *`;
  }

  return null;
}

/**
 * Convert natural language schedule to cron expression.
 * Uses pattern matching first, falls back to Gemini for complex cases.
 */
export async function naturalLanguageToCron(text: string): Promise<string> {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Try interval patterns first
  const interval = parseInterval(text);
  if (interval) return interval;

  // Try common patterns
  let baseCron: string | null = null;
  for (const [pattern, cron] of Object.entries(COMMON_PATTERNS)) {
    const normalizedPattern = pattern.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (lower.includes(normalizedPattern)) {
      baseCron = cron;
      break;
    }
  }

  // Extract time and apply to base cron
  const time = parseTime(text);
  if (baseCron && time) {
    const parts = baseCron.split(" ");
    parts[0] = String(time.minute);
    parts[1] = String(time.hour);
    return parts.join(" ");
  }
  if (baseCron) return baseCron;
  if (time) return `${time.minute} ${time.hour} * * *`;

  // Fallback: use Gemini for complex expressions
  if (GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent(
        `Convert this schedule to a cron expression. Reply ONLY with the cron expression, nothing else.\n\nSchedule: "${text}"\n\nExamples:\n"every day at 8am" → "0 8 * * *"\n"every Monday at 9am" → "0 9 * * 1"\n"every 6 hours" → "0 */6 * * *"\n"first of month at 9am" → "0 9 1 * *"\n"weekdays at 7am" → "0 7 * * 1-5"`
      );
      const cron = result.response.text().trim();
      // Validate it looks like a cron expression
      if (/^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+$/.test(cron)) {
        return cron;
      }
    } catch (err) {
      console.error("[SCHEDULED-TASKS] Gemini cron parse failed:", err);
    }
  }

  // Ultimate fallback: daily at 9am
  return "0 9 * * *";
}

/**
 * Map a task description to an action type and params.
 */
export function inferAction(description: string, toolToRun?: string, toolParams?: Record<string, unknown>): { action: string; actionData: Record<string, unknown> } {
  if (toolToRun) {
    return { action: "run_tool", actionData: { tool: toolToRun, params: toolParams || {} } };
  }

  const lower = description.toLowerCase();

  if (/not[ií]cia|news|manchete|headline/i.test(lower)) {
    return { action: "search_news", actionData: { query: description } };
  }
  if (/pre[cç]o|price|cota[cç][aã]o|d[oó]lar|dollar|euro|bitcoin|btc/i.test(lower)) {
    return { action: "web_search", actionData: { query: description } };
  }
  if (/clima|weather|temperatura|previs[aã]o/i.test(lower)) {
    return { action: "check_weather", actionData: {} };
  }
  if (/restaurante|restaurant|comida|food/i.test(lower)) {
    return { action: "search_restaurants", actionData: { query: description } };
  }
  if (/produto|product|pre[cç]o.*baixou|price.*drop/i.test(lower)) {
    return { action: "search_products", actionData: { query: description } };
  }
  if (/gasto|spending|despesa|expense|resumo.*financ|financial.*summary/i.test(lower)) {
    return { action: "financial_summary", actionData: {} };
  }

  return { action: "web_search", actionData: { query: description } };
}

// ─── CRUD ──────────────────────────────────────────────────

export async function createScheduledTask(params: {
  userId: string;
  description: string;
  schedule: string;
  action: string;
  actionData?: Record<string, unknown>;
  timezone?: string;
  channel: string;
  channelId: string;
  language?: string;
  maxRuns?: number;
}) {
  // Parse cron schedule from natural language
  const cronExpr = await naturalLanguageToCron(params.schedule);

  const nextRun = getNextRunFromCron(cronExpr, params.timezone || "America/New_York");

  const task = await prisma.scheduledTask.create({
    data: {
      userId: params.userId,
      description: params.description,
      action: params.action,
      actionData: (params.actionData || {}) as any,
      schedule: cronExpr,
      timezone: params.timezone || "America/New_York",
      channel: params.channel,
      channelId: params.channelId,
      language: params.language || "pt",
      nextRun,
      maxRuns: params.maxRuns || null,
    },
  });

  console.log(`[SCHEDULED-TASKS] Created task ${task.id}: "${params.description}" [${cronExpr}] next=${nextRun?.toISOString()}`);
  return task;
}

export async function listScheduledTasks(userId: string) {
  return prisma.scheduledTask.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function pauseScheduledTask(taskId: string, userId: string) {
  return prisma.scheduledTask.updateMany({
    where: { id: taskId, userId },
    data: { active: false },
  });
}

export async function resumeScheduledTask(taskId: string, userId: string) {
  const task = await prisma.scheduledTask.findFirst({ where: { id: taskId, userId } });
  if (!task) return null;

  const nextRun = getNextRunFromCron(task.schedule, task.timezone);
  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: { active: true, nextRun },
  });
}

export async function deleteScheduledTask(taskId: string, userId: string) {
  return prisma.scheduledTask.deleteMany({
    where: { id: taskId, userId },
  });
}

export async function editScheduledTask(taskId: string, userId: string, updates: {
  description?: string;
  schedule?: string;
  action?: string;
  actionData?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (updates.description) data.description = updates.description;
  if (updates.action) data.action = updates.action;
  if (updates.actionData) data.actionData = updates.actionData;
  if (updates.schedule) {
    const cronExpr = await naturalLanguageToCron(updates.schedule);
    data.schedule = cronExpr;
    const task = await prisma.scheduledTask.findFirst({ where: { id: taskId, userId } });
    data.nextRun = getNextRunFromCron(cronExpr, task?.timezone || "America/New_York");
  }

  return prisma.scheduledTask.updateMany({
    where: { id: taskId, userId },
    data,
  });
}

// ─── Cron Helpers ──────────────────────────────────────────

/**
 * Calculate next run time from a cron expression.
 * Simple parser — supports standard 5-field cron.
 */
export function getNextRunFromCron(cronExpr: string, timezone: string): Date {
  const now = new Date();
  const parts = cronExpr.split(/\s+/);
  if (parts.length !== 5) return new Date(now.getTime() + 3600000); // fallback: 1h from now

  // Simple approach: scan forward minute by minute up to 48h
  const maxIterations = 48 * 60; // 48 hours of minutes
  for (let i = 1; i <= maxIterations; i++) {
    const candidate = new Date(now.getTime() + i * 60000);
    // Convert to timezone
    const tzDate = new Date(candidate.toLocaleString("en-US", { timeZone: timezone }));

    if (matchesCron(parts, tzDate)) {
      return candidate;
    }
  }

  // Fallback
  return new Date(now.getTime() + 3600000);
}

function matchesCron(parts: string[], date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  return (
    matchesCronField(parts[0], minute) &&
    matchesCronField(parts[1], hour) &&
    matchesCronField(parts[2], dayOfMonth) &&
    matchesCronField(parts[3], month) &&
    matchesCronField(parts[4], dayOfWeek)
  );
}

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  // Handle comma-separated values
  const parts = field.split(",");
  for (const part of parts) {
    // Handle range (e.g., 1-5)
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (value >= start && value <= end) return true;
      continue;
    }
    // Handle step (e.g., */6)
    if (part.includes("/")) {
      const [base, step] = part.split("/");
      const stepNum = parseInt(step, 10);
      const baseNum = base === "*" ? 0 : parseInt(base, 10);
      if ((value - baseNum) % stepNum === 0 && value >= baseNum) return true;
      continue;
    }
    // Exact match
    if (parseInt(part, 10) === value) return true;
  }

  return false;
}

/**
 * Format a cron expression to human-readable text.
 */
export function cronToHuman(cron: string, lang: string = "pt"): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, , dow] = parts;
  const timeStr = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

  const dayNames: Record<string, string[]> = {
    pt: ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"],
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  };
  const days = dayNames[lang] || dayNames.en;

  // Every N hours
  if (hour.includes("/")) {
    const step = hour.split("/")[1];
    return lang === "pt" ? `a cada ${step} horas` : `every ${step} hours`;
  }

  // Every N minutes
  if (min.includes("/")) {
    const step = min.split("/")[1];
    return lang === "pt" ? `a cada ${step} minutos` : `every ${step} minutes`;
  }

  // Specific day of month
  if (dom !== "*") {
    return lang === "pt" ? `todo dia ${dom} às ${timeStr}` : `${dom}th of every month at ${timeStr}`;
  }

  // Specific day of week
  if (dow !== "*") {
    if (dow === "1-5") return lang === "pt" ? `seg-sex às ${timeStr}` : `weekdays at ${timeStr}`;
    if (dow === "0-6" || dow === "*") return lang === "pt" ? `todo dia às ${timeStr}` : `every day at ${timeStr}`;
    const dayList = dow.split(",").map(d => days[parseInt(d, 10)] || d).join(", ");
    return lang === "pt" ? `${dayList} às ${timeStr}` : `${dayList} at ${timeStr}`;
  }

  // Every day
  return lang === "pt" ? `todo dia às ${timeStr}` : `every day at ${timeStr}`;
}

// ─── Task Execution ────────────────────────────────────────

/**
 * Execute a scheduled task's action and return the result text.
 */
export async function executeTaskAction(task: {
  action: string;
  actionData: unknown;
  userId: string;
  language: string;
  channel: string;
  channelId: string;
}): Promise<string> {
  const data = (task.actionData || {}) as Record<string, unknown>;

  // Use Gemini to execute the action and format a nice response
  if (!GEMINI_API_KEY) return "Scheduled task skipped: no AI key configured.";

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ googleSearch: {} } as any],
    });

    let prompt = "";

    switch (task.action) {
      case "search_news":
        prompt = `Search for the latest news about: ${data.query || "top headlines"}. Write a concise briefing with 3-5 bullet points. Include source names. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;

      case "web_search":
        prompt = `Search for: ${data.query}. Provide a concise, useful answer. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;

      case "check_weather": {
        // Try to get user location
        const user = await prisma.user.findFirst({
          where: { OR: [{ phone: task.channelId }, { telegramChatId: task.channelId }] },
          select: { latitude: true, longitude: true },
        });
        const loc = user?.latitude && user?.longitude ? `${user.latitude},${user.longitude}` : "New York";
        prompt = `What's the current weather in ${loc}? Include temperature, conditions, and what to wear. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;
      }

      case "search_restaurants":
        prompt = `Search for highly rated restaurants: ${data.query || "near me"}. List top 3 with ratings and price range. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;

      case "search_products":
        prompt = `Search for products: ${data.query}. List top 3 deals with current prices and where to buy. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;

      case "financial_summary":
        prompt = `Generate a brief financial tip or money-saving insight for today. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;

      case "custom_message":
        return (data.message as string) || "Custom task executed.";

      case "run_tool":
        prompt = `Execute this task: ${data.tool} with parameters ${JSON.stringify(data.params)}. Provide a concise result. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
        break;

      default:
        prompt = `Execute this scheduled task: "${data.query || task.action}". Provide useful, concise information. Language: ${task.language === "pt" ? "Portuguese" : "English"}.`;
    }

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error("[SCHEDULED-TASKS] Execution error:", err);
    return `Task failed: ${(err as Error).message}`;
  }
}

/**
 * Send task result to user via their preferred channel.
 */
export async function deliverTaskResult(task: {
  channel: string;
  channelId: string;
  description: string;
  language: string;
}, result: string) {
  const prefix = task.language === "pt"
    ? `📋 *Tarefa agendada:* ${task.description}\n\n`
    : `📋 *Scheduled task:* ${task.description}\n\n`;

  const message = prefix + result;

  try {
    if (task.channel === "whatsapp") {
      await sendWhatsAppMessage(task.channelId, message);
    } else if (task.channel === "telegram") {
      // Strip markdown for telegram (use HTML)
      const htmlMsg = message.replace(/\*([^*]+)\*/g, "<b>$1</b>");
      await sendTelegramNotification(task.channelId, htmlMsg);
    }
  } catch (err) {
    console.error(`[SCHEDULED-TASKS] Failed to deliver to ${task.channel}:${task.channelId}:`, err);
  }
}
