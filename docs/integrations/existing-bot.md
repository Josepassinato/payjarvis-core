# Connecting PayJarvis to an Existing Bot

Your bot says **"I can't make purchases"**? This guide explains why and fixes it in under 10 minutes.

## Why the bot doesn't know it can make purchases

The LLM only knows what you tell it in the **system prompt** and **tools** array.
If neither includes PayJarvis, the model has no idea a payment tool exists.

Two things required:
1. **System prompt** — tells the LLM it has a PayJarvis tool and the rules for using it
2. **Tool registration** — makes `payjarvis_request_approval` callable by the LLM

---

## Diagnosing your bot

- [ ] Is `PAYJARVIS_SYSTEM_PROMPT` present in the string passed to `system`?
- [ ] Is `PAYJARVIS_TOOL_SCHEMA` listed in the `tools` array of your LLM call?
- [ ] When the LLM returns a tool call, does your code execute it and return the result?

If any box is unchecked, that's your fix.

---

## Step 1 — Install

```bash
npm install @payjarvis/agent-sdk
```

---

## Step 2 — Add the system prompt

```typescript
import { buildSystemPromptWithPayJarvis, PAYJARVIS_TOOL_SCHEMA } from '@payjarvis/agent-sdk'

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  // Appends PayJarvis rules without overwriting your existing prompt
  system: buildSystemPromptWithPayJarvis('You are a helpful shopping assistant.'),
  messages,
  tools: [PAYJARVIS_TOOL_SCHEMA],
})
```

---

## Step 3 — Handle the tool call

```typescript
import { PayJarvis } from '@payjarvis/agent-sdk'

const pj = new PayJarvis({
  apiKey: process.env.PAYJARVIS_API_KEY,
  botId: process.env.PAYJARVIS_BOT_ID,
})

for (const tc of response.choices[0].message.tool_calls ?? []) {
  if (tc.function.name === 'payjarvis_request_approval') {
    const args = JSON.parse(tc.function.arguments)
    const decision = await pj.requestApproval(args)

    messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(decision),
    })
  }
}
```

---

## Testing

```bash
# Get your free API key at payjarvis.com/start — no credit card required
PAYJARVIS_API_KEY=your_key PAYJARVIS_BOT_ID=my-bot node your-bot.js
```

---

## Common mistakes

**Bot still says it can't make purchases**
→ Both system prompt AND tool schema are required. Check both are present.

**LLM calls the tool but nothing happens**
→ Your message loop is not processing `tool_calls`. Check `response.choices[0].message.tool_calls`.

**Decision is always blocked**
→ Test with amounts under $50. Configure real limits after creating a free account.

---

## Platform-specific guides
- [Telegram →](./telegram.md)
- [WhatsApp →](./whatsapp.md)
