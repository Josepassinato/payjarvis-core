# payjarvis-clawdbot

Financial guardrails plugin for [Clawdbot](https://clawdbot.com) agents. Powered by [PayJarvis](https://payjarvis.com).

Adds identity verification, trust scoring, and transaction authorization to any Clawdbot agent.

## Install

```bash
pip install payjarvis-clawdbot
```

## Quickstart

```python
from clawdbot import Agent
from payjarvis_clawdbot import PayJarvisPlugin

agent = Agent(name="shopping-agent")
agent.use(
    PayJarvisPlugin(
        api_key="pj_bot_xxx",
        bot_id="your-bot-id",
        max_transaction=100,
        daily_limit=500,
    )
)

result = agent.payjarvis_authorize(
    merchant="Amazon",
    amount=29.99,
    category="shopping",
)

if result.approved:
    print("Purchase authorized:", result.bdit_token)
```

## Sandbox Mode

Test without a live API:

```python
agent.use(
    PayJarvisPlugin(
        max_transaction=100,
        daily_limit=500,
        mode="sandbox",
    )
)
```

Sandbox mode runs entirely in-memory. No network calls, no API key needed.

## Demo

```
$ python examples/demo.py

[PayJarvis] Running in sandbox mode
[PayJarvis] Agent registered: ag_sandbox_abc123
[PayJarvis] Trust Score: 742 (LOW)

──────────────────────────────────────────────────
Agent wants to buy a $29 API subscription...

[PayJarvis] APPROVED $29.00 → OpenAI [tx_xxx]
  Decision:       APPROVED
  Transaction ID: tx_xxx
  BDIT Token:     sandbox.bdit.xxx...

──────────────────────────────────────────────────
Agent tries to buy $5,000 in GPUs...

[PayJarvis] BLOCKED $5000.00 → GPU Store — Amount exceeds max transaction limit
  Decision:       BLOCKED
  Reason:         Amount $5000.00 exceeds max transaction limit $100.00
```

## API

### `PayJarvisPlugin`

```python
PayJarvisPlugin(
    api_key="pj_bot_xxx",      # Bot API key (not needed in sandbox)
    bot_id="your-bot-id",      # Bot ID (not needed in sandbox)
    base_url="https://...",    # API URL (default: api.payjarvis.com)
    max_transaction=100,       # Max per transaction
    daily_limit=500,           # Daily spending limit
    mode="live",               # "live" or "sandbox"
)
```

### Helper methods (bound to agent)

```python
# Authorize a financial action
result = agent.payjarvis_authorize(merchant, amount, category)

# Get agent identity and trust status
status = agent.payjarvis_status()
# → AgentStatus(agent_id, trust_score, risk_level, ...)

# Get current spending limits
limits = agent.payjarvis_limits()
# → SpendingLimits(remaining_today, spent_today, ...)

# Issue Agent Identity Token for merchant verification
ait = agent.issue_ait(ttl=3600)
# → AitToken(token, agent_id, expires_at)
```

### Action interception

The plugin automatically intercepts financial actions when used with Clawdbot's `before_action` hook:

```python
# These action names trigger authorization:
# purchase, buy, checkout, subscribe, pay, payment,
# ad_spend, transfer, tip, donate, rent, book, order
```

### `AuthorizationResult`

```python
result.approved        # bool
result.blocked         # bool
result.pending         # bool (waiting for human approval)
result.decision        # Decision enum (APPROVED, BLOCKED, PENDING_HUMAN)
result.transaction_id  # str
result.bdit_token      # str | None (payment token if approved)
result.reason          # str | None (why blocked/pending)
result.approval_id     # str | None (if pending human)
```

## Trust Score

PayJarvis computes a 0-1000 trust score per agent:

| Score | Risk Level | Behavior |
|-------|-----------|----------|
| 700+ | LOW | Auto-approved |
| 400-699 | MEDIUM | Policy-dependent |
| 200-399 | HIGH | Human approval required |
| 0-199 | CRITICAL | Blocked |

## License

MIT
