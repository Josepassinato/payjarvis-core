"""Tests for PayJarvis Clawdbot plugin in sandbox mode."""

from payjarvis_clawdbot import PayJarvisPlugin
from payjarvis_clawdbot.types import Decision, RiskLevel


class FakeAgent:
    """Minimal Clawdbot agent mock."""

    def __init__(self, name: str = "test-agent"):
        self.name = name


def test_sandbox_registration():
    agent = FakeAgent("shopping-agent")
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100, daily_limit=500)
    plugin.attach(agent)

    assert plugin.agent_id is not None
    assert plugin.agent_id.startswith("ag_")
    assert plugin.status is not None
    assert plugin.status.trust_score >= 0


def test_approve_within_limit():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100, daily_limit=500)
    plugin.attach(agent)

    result = plugin.authorize("Amazon", 29.99, "shopping")

    assert result.approved is True
    assert result.blocked is False
    assert result.decision == Decision.APPROVED
    assert result.transaction_id != ""
    assert result.bdit_token is not None


def test_block_over_limit():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100, daily_limit=500)
    plugin.attach(agent)

    # 250 > 100*2 = blocked (not just pending)
    result = plugin.authorize("GPU Store", 250.0, "electronics")

    assert result.blocked is True
    assert result.approved is False
    assert result.decision == Decision.BLOCKED
    assert "limit" in (result.reason or "").lower()


def test_pending_human_mid_range():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100, daily_limit=500)
    plugin.attach(agent)

    # 150 > 100 but < 200 → pending
    result = plugin.authorize("SaaS Provider", 150.0, "software")

    assert result.pending is True
    assert result.decision == Decision.PENDING_HUMAN
    assert result.approval_id is not None


def test_daily_limit_exhaustion():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100, daily_limit=200)
    plugin.attach(agent)

    r1 = plugin.authorize("Store A", 90, "shopping")
    assert r1.approved is True

    r2 = plugin.authorize("Store B", 90, "shopping")
    assert r2.approved is True

    # 90 + 90 + 50 = 230 > 200
    r3 = plugin.authorize("Store C", 50, "shopping")
    assert r3.blocked is True


def test_helper_methods_bound():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox")
    plugin.attach(agent)

    assert hasattr(agent, "payjarvis_status")
    assert hasattr(agent, "payjarvis_limits")
    assert hasattr(agent, "issue_ait")
    assert hasattr(agent, "payjarvis_authorize")


def test_payjarvis_status():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox")
    plugin.attach(agent)

    status = agent.payjarvis_status()
    assert status.agent_id.startswith("ag_")
    assert status.trust_score > 0
    assert isinstance(status.risk_level, RiskLevel)


def test_payjarvis_limits():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=75, daily_limit=300)
    plugin.attach(agent)

    limits = agent.payjarvis_limits()
    assert limits.per_transaction == 75.0
    assert limits.per_day == 300.0
    assert limits.remaining_today == 300.0


def test_issue_ait():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox")
    plugin.attach(agent)

    ait = agent.issue_ait()
    assert ait.token.startswith("sandbox.ait.")
    assert ait.agent_id.startswith("ag_")


def test_intercept_financial_action():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100)
    plugin.attach(agent)

    result = plugin.intercept("purchase", {"merchant": "Amazon", "amount": 50})
    assert result is not None
    assert result.approved is True


def test_intercept_non_financial_action():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox")
    plugin.attach(agent)

    result = plugin.intercept("search", {"query": "best laptop"})
    assert result is None


def test_trust_score_increases_after_approval():
    agent = FakeAgent()
    plugin = PayJarvisPlugin(mode="sandbox", max_transaction=100, daily_limit=1000)
    plugin.attach(agent)

    initial_score = plugin.status.trust_score

    for _ in range(5):
        plugin.authorize("Shop", 10, "shopping")

    final_status = plugin.get_status()
    assert final_status.trust_score > initial_score
