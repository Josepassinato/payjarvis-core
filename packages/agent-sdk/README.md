# @payjarvis/agent-sdk

TypeScript SDK for building AI agents that can make purchases through PayJarvis.

## Install

```bash
npm install @payjarvis/agent-sdk
```

## Quick Start

```typescript
import { PayJarvis } from "@payjarvis/agent-sdk";

const pj = new PayJarvis({
  apiKey: process.env.PAYJARVIS_API_KEY,
  botId: process.env.PAYJARVIS_BOT_ID,
});

// Request a purchase
const approval = await pj.requestPayment({
  amount: 29.99,
  merchantName: "Amazon",
  category: "electronics",
  description: "Wireless earbuds",
});

// Check approval status
const status = await pj.checkApproval(approval.id);
```

## LLM Integration

```typescript
import { PAYJARVIS_TOOL_SCHEMA, buildSystemPromptWithPayJarvis } from "@payjarvis/agent-sdk";

// Add PayJarvis tools to your LLM
const tools = [PAYJARVIS_TOOL_SCHEMA];
const systemPrompt = buildSystemPromptWithPayJarvis("Your base prompt here");
```

## Platform Integrations

```typescript
import { telegram, whatsapp } from "@payjarvis/agent-sdk";
```

## Features

- Purchase requests with automatic approval workflow
- BDIT token-based transaction verification
- Trust score tracking
- Spending limit management
- Telegram and WhatsApp integrations
- LLM tool schemas for function calling

## API Reference

### `PayJarvis(config)`

| Option | Type | Description |
|--------|------|-------------|
| `apiKey` | `string` | Your bot API key |
| `botId` | `string` | Your bot ID |
| `baseUrl` | `string?` | API base URL (default: `https://api.payjarvis.com`) |

### Methods

- `requestPayment(params)` — Request a purchase approval
- `checkApproval(id)` — Poll approval status
- `getSpendingLimits()` — Get current spending limits
- `requestHandoff(params)` — Hand off to human agent
- `checkHealth()` — Check API connectivity

## License

MIT
