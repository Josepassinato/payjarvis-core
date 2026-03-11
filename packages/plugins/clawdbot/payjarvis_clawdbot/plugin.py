"""PayJarvis plugin for Clawdbot agents.

Usage:
    from clawdbot import Agent
    from payjarvis_clawdbot import PayJarvisPlugin

    agent = Agent(name="shopping-agent")
    agent.use(PayJarvisPlugin(api_key="pj_xxx", mode="sandbox"))
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Protocol, Union

from payjarvis_clawdbot import logger
from payjarvis_clawdbot.client import PayJarvisClient
from payjarvis_clawdbot.sandbox import SandboxClient
from payjarvis_clawdbot.types import (
    AgentStatus,
    AitToken,
    AuthorizationResult,
    Decision,
    SpendingLimits,
    FINANCIAL_ACTIONS,
)


class AgentLike(Protocol):
    """Minimal interface a Clawdbot agent must satisfy."""

    name: str


ClientType = Union[PayJarvisClient, SandboxClient]


class PayJarvisPlugin:
    """Financial guardrails plugin for Clawdbot agents.

    Args:
        api_key: PayJarvis bot API key (pj_bot_xxx). Not needed in sandbox mode.
        bot_id: PayJarvis bot ID. Not needed in sandbox mode.
        base_url: PayJarvis API URL. Defaults to https://api.payjarvis.com.
        max_transaction: Max amount per transaction (sandbox default).
        daily_limit: Daily spending limit (sandbox default).
        mode: "live" or "sandbox". Sandbox runs entirely in-memory.
        auto_intercept: If True, intercept agent actions matching financial keywords.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        bot_id: Optional[str] = None,
        base_url: str = "https://api.payjarvis.com",
        max_transaction: float = 100.0,
        daily_limit: float = 500.0,
        mode: str = "live",
        auto_intercept: bool = True,
    ) -> None:
        self._api_key = api_key
        self._bot_id = bot_id
        self._base_url = base_url
        self._max_transaction = max_transaction
        self._daily_limit = daily_limit
        self._mode = mode
        self._auto_intercept = auto_intercept
        self._client: Optional[ClientType] = None
        self._status: Optional[AgentStatus] = None
        self._agent: Optional[Any] = None

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def agent_id(self) -> Optional[str]:
        return self._client.agent_id if self._client else None

    @property
    def status(self) -> Optional[AgentStatus]:
        return self._status

    # ── Plugin lifecycle ──

    def attach(self, agent: Any) -> None:
        """Called by agent.use(). Initializes the plugin and registers the agent."""
        self._agent = agent
        self._init_client()
        self._register()
        self._bind_helpers(agent)

    def __call__(self, agent: Any) -> None:
        """Allow plugin to be used as: agent.use(PayJarvisPlugin(...))"""
        self.attach(agent)

    def detach(self) -> None:
        """Cleanup when plugin is removed."""
        if self._client:
            self._client.close()
            self._client = None

    # ── Core methods ──

    def authorize(
        self,
        merchant: str,
        amount: float,
        category: str = "other",
        currency: str = "USD",
    ) -> AuthorizationResult:
        """Authorize a financial action through PayJarvis.

        Returns an AuthorizationResult with decision, transaction_id, and metadata.
        """
        if not self._client:
            raise RuntimeError("Plugin not initialized. Call agent.use(plugin) first.")

        result = self._client.authorize(
            merchant=merchant,
            amount=amount,
            category=category,
            currency=currency,
        )

        # Log the decision
        if result.approved:
            logger.approved(merchant, amount, result.transaction_id)
        elif result.blocked:
            logger.blocked(merchant, amount, result.reason)
        elif result.pending:
            logger.pending(merchant, amount, result.approval_id)

        # Refresh trust score after transaction
        self._refresh_status()

        return result

    def get_status(self) -> AgentStatus:
        """Get current agent identity and trust status."""
        if not self._client:
            raise RuntimeError("Plugin not initialized.")
        self._refresh_status()
        assert self._status is not None
        return self._status

    def get_limits(self) -> SpendingLimits:
        """Get current spending limits and usage."""
        if not self._client:
            raise RuntimeError("Plugin not initialized.")
        return self._client.get_limits()

    def issue_ait(self, ttl: int = 3600) -> AitToken:
        """Issue an Agent Identity Token for merchant verification."""
        if not self._client:
            raise RuntimeError("Plugin not initialized.")
        token = self._client.issue_ait(ttl=ttl)
        logger.ait_issued(token.agent_id)
        return token

    # ── Action interceptor ──

    def intercept(self, action: str, params: dict[str, Any]) -> Optional[AuthorizationResult]:
        """Check if an action is financial and authorize it.

        Returns None if the action is not financial.
        Returns AuthorizationResult if it is.
        """
        action_lower = action.lower().replace("-", "_").replace(" ", "_")

        # Check if this looks like a financial action
        is_financial = any(keyword in action_lower for keyword in FINANCIAL_ACTIONS)
        if not is_financial:
            return None

        merchant = params.get("merchant", params.get("vendor", params.get("service", "unknown")))
        amount = params.get("amount", params.get("price", params.get("cost", 0)))
        category = params.get("category", "other")
        currency = params.get("currency", "USD")

        if not amount or float(amount) <= 0:
            return None

        return self.authorize(
            merchant=str(merchant),
            amount=float(amount),
            category=str(category),
            currency=str(currency),
        )

    # ── Internal ──

    def _init_client(self) -> None:
        if self._mode == "sandbox":
            self._client = SandboxClient(
                max_transaction=self._max_transaction,
                daily_limit=self._daily_limit,
            )
            logger.sandbox_mode()
        else:
            if not self._api_key:
                raise ValueError("api_key is required in live mode")
            if not self._bot_id:
                raise ValueError("bot_id is required in live mode")
            self._client = PayJarvisClient(
                api_key=self._api_key,
                bot_id=self._bot_id,
                base_url=self._base_url,
            )

    def _register(self) -> None:
        assert self._client is not None
        try:
            self._status = self._client.resolve_agent()
            logger.registered(self._status.agent_id)
            logger.trust_score(self._status.trust_score, self._status.risk_level.value)
        except Exception as e:
            logger.error(f"Registration failed: {e}")
            raise

    def _refresh_status(self) -> None:
        assert self._client is not None
        try:
            self._status = self._client.resolve_agent()
        except Exception:
            pass  # Non-critical — keep last known status

    def _bind_helpers(self, agent: Any) -> None:
        """Bind convenience methods directly onto the agent instance."""
        plugin = self

        def payjarvis_status() -> AgentStatus:
            return plugin.get_status()

        def payjarvis_limits() -> SpendingLimits:
            return plugin.get_limits()

        def issue_ait(ttl: int = 3600) -> AitToken:
            return plugin.issue_ait(ttl=ttl)

        def payjarvis_authorize(
            merchant: str,
            amount: float,
            category: str = "other",
            currency: str = "USD",
        ) -> AuthorizationResult:
            return plugin.authorize(merchant, amount, category, currency)

        # Attach methods to agent
        agent.payjarvis_status = payjarvis_status
        agent.payjarvis_limits = payjarvis_limits
        agent.issue_ait = issue_ait
        agent.payjarvis_authorize = payjarvis_authorize

        # Set up action interception if supported
        if self._auto_intercept and hasattr(agent, "before_action"):
            original_before = getattr(agent, "before_action", None)

            def intercepting_before_action(action: str, params: dict[str, Any]) -> Optional[bool]:
                result = plugin.intercept(action, params)
                if result is not None and result.blocked:
                    return False  # Block the action
                if original_before and callable(original_before):
                    return original_before(action, params)
                return None

            agent.before_action = intercepting_before_action
