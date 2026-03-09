/**
 * PAYJARVIS — WhatsApp Integration
 *
 * Compatible with Evolution API (webhook) and Baileys (direct connection).
 *
 * Usage (Evolution API):
 *   app.post('/webhook', async (req, res) => {
 *     await handler(req.body)
 *     res.sendStatus(200)
 *   })
 *
 * Usage (Baileys):
 *   sock.ev.on('messages.upsert', createPayJarvisBaileysHandler(config, async (msg, auth) => { ... }))
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
// EVOLUTION API — WEBHOOK PAYLOAD
// ─────────────────────────────────────────

export interface EvolutionWebhookPayload {
  event: string
  instance: string
  data: {
    key: {
      remoteJid: string
      fromMe: boolean
      id: string
    }
    message?: {
      conversation?: string
      extendedTextMessage?: { text: string }
      imageMessage?: { caption?: string }
    }
    pushName?: string
    messageType: string
    instanceId: string
  }
}

export interface ParsedWhatsAppMessage {
  text: string
  sender: string
  messageId: string
  instanceId: string
  pushName?: string
}

// ─────────────────────────────────────────
// PARSE EVOLUTION API PAYLOAD
// Returns null for outbound, empty, or non-text messages.
// ─────────────────────────────────────────

export function parseWebhookPayload(
  payload: EvolutionWebhookPayload
): ParsedWhatsAppMessage | null {
  const { data } = payload
  if (!data?.message || data.key.fromMe) return null

  const text =
    data.message.conversation ??
    data.message.extendedTextMessage?.text ??
    data.message.imageMessage?.caption ??
    ''

  if (!text.trim()) return null

  return {
    text,
    sender: data.key.remoteJid,
    messageId: data.key.id,
    instanceId: data.instanceId,
    pushName: data.pushName,
  }
}

// ─────────────────────────────────────────
// FORMAT DECISION → WHATSAPP MESSAGE
// Different emoji set from Telegram for visual distinction.
// ─────────────────────────────────────────

export function formatDecisionMessage(
  decision: ApprovalDecision,
  extra?: { amount?: number; merchant?: string }
): string {
  const amountStr = extra?.amount != null ? `$${extra.amount.toFixed(2)}` : ''
  const merchantStr = extra?.merchant ? ` at ${extra.merchant}` : ''
  const context = amountStr ? ` ${amountStr}${merchantStr}` : ''
  const reason = decision.reason ? `\n${decision.reason}` : ''

  if (decision.approved) return `💳 *Payment authorized*${context}${reason}`
  if (decision.pending) {
    return `🔔 *Approval required*${context}\nI've sent a notification to the account owner. I will not proceed until confirmed.${reason}`
  }
  return `⛔ *Payment blocked*${context}${reason}`
}

// ─────────────────────────────────────────
// AUTH OBJECT
// ─────────────────────────────────────────

export interface PayJarvisWhatsAppAuth {
  requestApproval: (req: ApprovalRequest) => Promise<ApprovalDecision>
  systemPrompt: string
  client: PayJarvis
}

// ─────────────────────────────────────────
// EVOLUTION API HANDLER
// ─────────────────────────────────────────

export function createPayJarvisWhatsAppHandler(
  config: PayJarvisConfig,
  handler: (msg: ParsedWhatsAppMessage, auth: PayJarvisWhatsAppAuth) => Promise<void>
) {
  const client = new PayJarvis(config)

  return async (payload: EvolutionWebhookPayload): Promise<void> => {
    const msg = parseWebhookPayload(payload)
    if (!msg) return

    const auth: PayJarvisWhatsAppAuth = {
      client,
      systemPrompt: PAYJARVIS_SYSTEM_PROMPT,
      requestApproval: (req) => client.requestApproval(req),
    }

    await handler(msg, auth)
  }
}

// ─────────────────────────────────────────
// BAILEYS HANDLER
// ─────────────────────────────────────────

export interface BaileysMessage {
  key: { remoteJid?: string; fromMe?: boolean; id?: string }
  message?: {
    conversation?: string
    extendedTextMessage?: { text: string }
  }
  pushName?: string
}

export interface BaileysUpsertEvent {
  messages: BaileysMessage[]
  type: 'notify' | 'append'
}

export function createPayJarvisBaileysHandler(
  config: PayJarvisConfig,
  handler: (msg: ParsedWhatsAppMessage, auth: PayJarvisWhatsAppAuth) => Promise<void>
) {
  const client = new PayJarvis(config)

  return async (event: BaileysUpsertEvent): Promise<void> => {
    if (event.type !== 'notify') return

    for (const raw of event.messages) {
      if (raw.key.fromMe) continue

      const text =
        raw.message?.conversation ??
        raw.message?.extendedTextMessage?.text ??
        ''

      if (!text.trim()) continue

      const msg: ParsedWhatsAppMessage = {
        text,
        sender: raw.key.remoteJid ?? '',
        messageId: raw.key.id ?? '',
        instanceId: '',
        pushName: raw.pushName,
      }

      const auth: PayJarvisWhatsAppAuth = {
        client,
        systemPrompt: PAYJARVIS_SYSTEM_PROMPT,
        requestApproval: (req) => client.requestApproval(req),
      }

      await handler(msg, auth)
    }
  }
}

// ─────────────────────────────────────────
// STANDALONE
// ─────────────────────────────────────────

export async function authorizePayment(
  config: PayJarvisConfig,
  req: ApprovalRequest
): Promise<ApprovalDecision> {
  const client = new PayJarvis(config)
  return client.requestApproval(req)
}
