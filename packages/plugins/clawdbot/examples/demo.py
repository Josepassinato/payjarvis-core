"""
PayJarvis + Clawdbot Demo

Run: python examples/demo.py

Shows a shopping agent making two transactions:
  1. A routine purchase → APPROVED
  2. A risky purchase → BLOCKED
"""


class Agent:
    """Minimal Clawdbot agent stub for demo purposes."""

    def __init__(self, name: str):
        self.name = name

    def use(self, plugin):
        plugin.attach(self)


# ─── Demo ───

from payjarvis_clawdbot import PayJarvisPlugin

# Create agent with financial guardrails
agent = Agent(name="shopping-agent")
agent.use(
    PayJarvisPlugin(
        max_transaction=100,
        daily_limit=500,
        mode="sandbox",
    )
)

print()

# ── Transaction 1: routine purchase ──
print("─" * 50)
print("Agent wants to buy a $29 API subscription...")
print()

result = agent.payjarvis_authorize(
    merchant="OpenAI",
    amount=29.00,
    category="software",
)

print(f"  Decision:       {result.decision.value}")
print(f"  Transaction ID: {result.transaction_id}")
if result.bdit_token:
    print(f"  BDIT Token:     {result.bdit_token[:40]}...")
print()

# ── Transaction 2: risky purchase ──
print("─" * 50)
print("Agent tries to buy $5,000 in GPUs...")
print()

result = agent.payjarvis_authorize(
    merchant="GPU Store",
    amount=5000.00,
    category="electronics",
)

print(f"  Decision:       {result.decision.value}")
print(f"  Reason:         {result.reason}")
print()

# ── Check status after transactions ──
print("─" * 50)
status = agent.payjarvis_status()
print(f"  Agent ID:       {status.agent_id}")
print(f"  Trust Score:    {status.trust_score}")
print(f"  Risk Level:     {status.risk_level.value}")
print(f"  Transactions:   {status.transactions_count}")
print()

# ── Issue AIT for merchant verification ──
print("─" * 50)
ait = agent.issue_ait()
print(f"  AIT Token:      {ait.token[:50]}...")
print(f"  Expires:        {ait.expires_at}")
print()

# ── Check remaining limits ──
print("─" * 50)
limits = agent.payjarvis_limits()
print(f"  Remaining today: ${limits.remaining_today:.2f}")
print(f"  Spent today:     ${limits.spent_today:.2f}")
print()
