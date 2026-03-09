/**
 * PAYJARVIS — Telegram Integration
 *
 * Injects PayJarvis into any existing Telegram bot.
 * Supports Telegraf (v4+) and node-telegram-bot-api.
 *
 * Usage (Telegraf):
 *   bot.use(createPayJarvisTelegrafMiddleware({ apiKey: '...', botId: '...' }))
 *   // ctx.payjarvis.requestApproval(...) is now available in all handlers
 *
 * Usage (node-telegram-bot-api):
 *   bot.on('message', createPayJarvisTelegramMiddleware(config, async (msg, auth) => { ... }))
 */

import { PayJarvis } from '../client.js'
import type { PayJarvisConfig, ApprovalRequest, ApprovalDecision } from '../types.js'
import {
  PAYJARVIS_SYSTEM_PROMPT,
  PAYJARVIS_TOOL_SCHEMA,
  buildSystemPromptWithPayJarvis,
} from '../prompts.js'

export {
  PAYJARVIS_SYSTEM_PROMPT,
  PAYJARVIS_TOOL_SCHEMA,
  buildSystemPromptWithPayJarvis,
}

// ─────────────────────────────────────────
// FORMAT DECISION → TELEGRAM MESSAGE
// ─────────────────────────────────────────

export function formatDecisionMessage(
  decision: ApprovalDecision,
  extra?: { amount?: number; merchant?: string }
): { text: string; parseMode: 'Markdown' } {
  const amountStr = extra?.amount != null ? `$${extra.amount.toFixed(2)}` : ''
  const merchantStr = extra?.merchant ? ` at ${extra.merchant}` : ''
  const context = amountStr ? ` ${amountStr}${merchantStr}` : ''
  const reason = decision.reason ? `\n_${decision.reason}_` : ''

  if (decision.approved) {
    return { text: `✅ *Purchase authorized*${context}${reason}`, parseMode: 'Markdown' }
  }
  if (decision.pending) {
    return {
      text: `⏳ *Waiting for your approval*${context}\nI've sent a notification to the account owner. I will not proceed until confirmed.${reason}`,
      parseMode: 'Markdown',
    }
  }
  return { text: `🚫 *Purchase blocked*${context}${reason}`, parseMode: 'Markdown' }
}

// ─────────────────────────────────────────
// PURCHASE INTENT DETECTION
// Lightweight keyword check — the LLM handles real parsing.
// ─────────────────────────────────────────

const PURCHASE_KEYWORDS = [
  'buy', 'purchase', 'order', 'pay', 'payment', 'checkout',
  'book', 'subscribe', 'get me', 'i want', 'spend',
]

export function hasPurchaseIntent(text: string): boolean {
  const lower = text.toLowerCase()
  return PURCHASE_KEYWORDS.some((kw) => lower.includes(kw))
}

// ─────────────────────────────────────────
// AUTH OBJECT — injected into every handler
// ─────────────────────────────────────────

export interface PayJarvisTelegramAuth {
  requestApproval: (req: ApprovalRequest) => Promise<ApprovalDecision>
  systemPrompt: string
  hasPurchaseIntent: boolean
  client: PayJarvis
}

// ─────────────────────────────────────────
// TELEGRAF MIDDLEWARE (v4+)
// ─────────────────────────────────────────

export interface TelegrafContext {
  message?: { message_id: number; text?: string; chat: { id: number } }
  reply: (text: string, extra?: Record<string, unknown>) => Promise<unknown>
  payjarvis?: PayJarvisTelegramAuth
}

export type TelegrafNext = () => Promise<void>

export function createPayJarvisTelegrafMiddleware(config: PayJarvisConfig) {
  const client = new PayJarvis(config)

  return async (ctx: TelegrafContext, next: TelegrafNext): Promise<void> => {
    const text = ctx.message?.text ?? ''

    ctx.payjarvis = {
      client,
      systemPrompt: PAYJARVIS_SYSTEM_PROMPT,
      hasPurchaseIntent: hasPurchaseIntent(text),
      requestApproval: (req) => client.requestApproval(req),
    }

    await next()
  }
}

// ─────────────────────────────────────────
// NODE-TELEGRAM-BOT-API MIDDLEWARE
// ─────────────────────────────────────────

export interface TelegramMessage {
  message_id: number
  chat: { id: number }
  from?: { id: number; first_name?: string }
  text?: string
}

export function createPayJarvisTelegramMiddleware(
  config: PayJarvisConfig,
  handler: (msg: TelegramMessage, auth: PayJarvisTelegramAuth) => Promise<void>
) {
  const client = new PayJarvis(config)

  return async (msg: TelegramMessage): Promise<void> => {
    const auth: PayJarvisTelegramAuth = {
      client,
      systemPrompt: PAYJARVIS_SYSTEM_PROMPT,
      hasPurchaseIntent: hasPurchaseIntent(msg.text ?? ''),
      requestApproval: (req) => client.requestApproval(req),
    }

    await handler(msg, auth)
  }
}

// ─────────────────────────────────────────
// STANDALONE (no middleware setup required)
// ─────────────────────────────────────────

export async function authorizePayment(
  config: PayJarvisConfig,
  req: ApprovalRequest
): Promise<ApprovalDecision> {
  const client = new PayJarvis(config)
  return client.requestApproval(req)
}
