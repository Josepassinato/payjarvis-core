# @payjarvis/merchant-sdk

TypeScript SDK for merchants to verify PayJarvis BDIT tokens and accept AI-agent purchases.

## Install

```bash
npm install @payjarvis/merchant-sdk
```

## Quick Start

```typescript
import { PayjarvisVerifier, extractToken } from "@payjarvis/merchant-sdk";

const verifier = new PayjarvisVerifier({
  merchantId: "your-merchant-id",
  jwksUrl: "https://api.payjarvis.com/.well-known/jwks.json",
  minTrustScore: 50,
});

// In your checkout endpoint
app.post("/checkout", async (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "No PayJarvis token" });

  const result = await verifier.verify(token);
  if (!result.valid) return res.status(403).json({ error: result.reason });

  // Token is valid — process the order
  console.log(`Bot ${result.bot.id} purchasing $${result.bot.amount}`);
});
```

## OpenClaw Integration (AI Agents)

```typescript
import {
  PayjarvisToolHandler,
  PAYJARVIS_OPENCLAW_TOOLS,
  generateSystemPrompt,
} from "@payjarvis/merchant-sdk";

// Add PayJarvis tools to your Gemini/OpenAI function calling
const tools = PAYJARVIS_OPENCLAW_TOOLS;

// Create a tool handler
const handler = new PayjarvisToolHandler({
  apiKey: process.env.PAYJARVIS_API_KEY,
  botId: process.env.PAYJARVIS_BOT_ID,
});

// Handle tool calls from LLM
const result = await handler.handle(toolName, toolArgs);
```

## Browser Integration

```html
<script src="https://api.payjarvis.com/adapter.js" data-merchant="your-merchant-id"></script>
<script>
  const token = PayJarvis.extractToken();
  if (token) {
    PayJarvis.verify(token).then(result => {
      if (result.valid) applyDiscount(result.bot);
    });
  }
</script>
```

## Features

- BDIT token verification (JWT with JWKS rotation)
- Trust score validation
- Merchant ID verification
- Token extraction from headers, cookies, query params
- Browser-side adapter script
- OpenClaw/Gemini function calling tools

## API Reference

### `PayjarvisVerifier(config)`

| Option | Type | Description |
|--------|------|-------------|
| `merchantId` | `string` | Your merchant ID |
| `jwksUrl` | `string?` | JWKS endpoint URL |
| `publicKey` | `string?` | PEM public key (alternative to JWKS) |
| `minTrustScore` | `number?` | Minimum trust score (default: 50) |

### `extractToken(request)`

Extracts BDIT token from `x-payjarvis-token` header, `Authorization: Bearer`, cookies, or request body.

## License

MIT
