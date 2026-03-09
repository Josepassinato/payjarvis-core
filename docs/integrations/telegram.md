# PayJarvis + Telegram

Add financial governance to any existing Telegram bot in 5 minutes.
Supports **Telegraf** (v4+) and **node-telegram-bot-api**.

## Installation

```bash
npm install @payjarvis/agent-sdk
```

## Telegraf

```typescript
import { Telegraf } from 'telegraf'
import { telegram, buildSystemPromptWithPayJarvis, PAYJARVIS_TOOL_SCHEMA } from '@payjarvis/agent-sdk'

const bot = new Telegraf(process.env.BOT_TOKEN!)

// 1. Register middleware — adds ctx.payjarvis to every handler
bot.use(telegram.createPayJarvisTelegrafMiddleware({
  apiKey: process.env.PAYJARVIS_API_KEY!,
  botId: process.env.PAYJARVIS_BOT_ID!,
}))

// 2. In your handler
bot.on('text', async (ctx) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    system: buildSystemPromptWithPayJarvis('You are a helpful shopping assistant.'),
    messages: [{ role: 'user', content: ctx.message.text }],
    tools: [PAYJARVIS_TOOL_SCHEMA],
  })

  for (const tc of response.choices[0].message.tool_calls ?? []) {
    if (tc.function.name === 'payjarvis_request_approval') {
      const args = JSON.parse(tc.function.arguments)
      const decision = await ctx.payjarvis!.requestApproval(args)
      const { text } = telegram.formatDecisionMessage(decision, {
        amount: args.amount, merchant: args.merchant,
      })
      await ctx.reply(text, { parse_mode: 'Markdown' })
      return
    }
  }

  await ctx.reply(response.choices[0].message.content ?? '')
})

bot.launch()
```

## node-telegram-bot-api

```typescript
import TelegramBot from 'node-telegram-bot-api'
import { telegram, buildSystemPromptWithPayJarvis, PAYJARVIS_TOOL_SCHEMA } from '@payjarvis/agent-sdk'

const bot = new TelegramBot(process.env.BOT_TOKEN!, { polling: true })

const handler = telegram.createPayJarvisTelegramMiddleware(
  { apiKey: process.env.PAYJARVIS_API_KEY!, botId: process.env.PAYJARVIS_BOT_ID! },
  async (msg, auth) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      system: buildSystemPromptWithPayJarvis('You are a helpful shopping assistant.'),
      messages: [{ role: 'user', content: msg.text ?? '' }],
      tools: [PAYJARVIS_TOOL_SCHEMA],
    })

    for (const tc of response.choices[0].message.tool_calls ?? []) {
      if (tc.function.name === 'payjarvis_request_approval') {
        const args = JSON.parse(tc.function.arguments)
        const decision = await auth.requestApproval(args)
        const { text } = telegram.formatDecisionMessage(decision, { amount: args.amount, merchant: args.merchant })
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
        return
      }
    }
    bot.sendMessage(msg.chat.id, response.choices[0].message.content ?? '')
  }
)

bot.on('message', handler)
```

## Expected output

| Decision | Telegram message |
|---|---|
| approved | ✅ *Purchase authorized* $29.99 at Amazon |
| pending | ⏳ *Waiting for your approval* $29.99 at Amazon |
| blocked | 🚫 *Purchase blocked* — exceeds daily limit |

## Troubleshooting

**`ctx.payjarvis` is undefined** → Move `bot.use(...)` before `bot.on(...)`.

**No tool_calls in response** → Verify `PAYJARVIS_TOOL_SCHEMA` is in the `tools` array and the system prompt is present.
