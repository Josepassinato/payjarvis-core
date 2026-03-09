# PayJarvis + WhatsApp

Add financial governance to any existing WhatsApp bot in 7 minutes.
Supports **Evolution API** and **Baileys**.

## Installation

```bash
npm install @payjarvis/agent-sdk
```

## Evolution API (webhook)

```typescript
import express from 'express'
import { whatsapp, buildSystemPromptWithPayJarvis, PAYJARVIS_TOOL_SCHEMA } from '@payjarvis/agent-sdk'

const app = express()
app.use(express.json())

const handler = whatsapp.createPayJarvisWhatsAppHandler(
  { apiKey: process.env.PAYJARVIS_API_KEY!, botId: process.env.PAYJARVIS_BOT_ID! },
  async (msg, auth) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      system: buildSystemPromptWithPayJarvis('You are a helpful shopping assistant.'),
      messages: [{ role: 'user', content: msg.text }],
      tools: [PAYJARVIS_TOOL_SCHEMA],
    })

    for (const tc of response.choices[0].message.tool_calls ?? []) {
      if (tc.function.name === 'payjarvis_request_approval') {
        const args = JSON.parse(tc.function.arguments)
        const decision = await auth.requestApproval(args)
        const text = whatsapp.formatDecisionMessage(decision, { amount: args.amount, merchant: args.merchant })
        await evolutionClient.sendText(msg.sender, text)
        return
      }
    }
    await evolutionClient.sendText(msg.sender, response.choices[0].message.content ?? '')
  }
)

app.post('/webhook', async (req, res) => {
  await handler(req.body)
  res.sendStatus(200)
})
```

## Test with cURL

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "my-instance",
    "data": {
      "key": { "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "test-1" },
      "message": { "conversation": "order pizza for $20" },
      "messageType": "conversation",
      "instanceId": "my-instance"
    }
  }'
```

## Expected output

| Decision | WhatsApp message |
|---|---|
| approved | 💳 *Payment authorized* $20.00 at iFood |
| pending | 🔔 *Approval required* — notification sent |
| blocked | ⛔ *Payment blocked* — exceeds daily limit |
