/**
 * PAYJARVIS — Shared LLM Prompt Constants
 *
 * Single source of truth for all system prompts injected into LLMs.
 * Imported by Telegram, WhatsApp, and any future platform integration.
 * Never duplicated — always import from here.
 */

// ─────────────────────────────────────────
// CORE SYSTEM PROMPT
// Append this to any existing LLM system prompt.
// The LLM must see this to know it has the PayJarvis tool.
// ─────────────────────────────────────────

export const PAYJARVIS_SYSTEM_PROMPT = `
## Financial Authorization — PayJarvis

You have access to the \`payjarvis_request_approval\` tool.

Rules you MUST follow — no exceptions:

1. ALWAYS call \`payjarvis_request_approval\` BEFORE processing any purchase,
   payment, booking, or financial transaction of any kind.

2. If \`approved\` is true:
   - Proceed with the transaction normally.
   - Inform the user the purchase was authorized.

3. If \`pending\` is true:
   - Tell the user: "Your purchase requires approval. I've sent a notification
     to the account owner. Please wait for confirmation."
   - Do NOT proceed with the transaction.
   - Do NOT assume approval. Wait for the user to confirm.

4. If \`blocked\` is true:
   - Tell the user the transaction was blocked and state the reason.
   - Do NOT proceed with the transaction under any circumstance.

5. If PayJarvis is unavailable or throws an error:
   - Tell the user: "I cannot process payments right now. Please try again later."
   - Do NOT proceed with the transaction.

You are NOT authorized to make purchases without PayJarvis approval.
`.trim()

// ─────────────────────────────────────────
// TOOL DESCRIPTION
// ─────────────────────────────────────────

export const PAYJARVIS_TOOL_DESCRIPTION =
  'Authorize a purchase or payment for this AI bot. ALWAYS call this tool BEFORE any financial transaction.'

// ─────────────────────────────────────────
// TOOL SCHEMA (JSON Schema — OpenAI / Anthropic compatible)
// ─────────────────────────────────────────

export const PAYJARVIS_TOOL_SCHEMA = {
  name: 'payjarvis_request_approval',
  description: PAYJARVIS_TOOL_DESCRIPTION,
  parameters: {
    type: 'object' as const,
    properties: {
      merchant: {
        type: 'string',
        description: 'Human-readable merchant name (e.g. "Amazon", "iFood", "Uber")',
      },
      merchantId: {
        type: 'string',
        description: 'Machine-readable merchant identifier (e.g. "amazon", "ifood", "uber")',
      },
      amount: {
        type: 'number',
        description: 'Transaction amount in USD',
      },
      category: {
        type: 'string',
        description: 'Transaction category (e.g. shopping, food, travel, software, subscription)',
      },
      description: {
        type: 'string',
        description: 'Optional description of what is being purchased',
      },
    },
    required: ['merchant', 'amount', 'category'],
  },
} as const

// ─────────────────────────────────────────
// HELPER — append to existing prompt safely
// ─────────────────────────────────────────

export function buildSystemPromptWithPayJarvis(existingPrompt: string): string {
  if (!existingPrompt || existingPrompt.trim() === '') {
    return PAYJARVIS_SYSTEM_PROMPT
  }
  return `${existingPrompt.trimEnd()}\n\n${PAYJARVIS_SYSTEM_PROMPT}`
}
