"""HTTP client for PayJarvis API."""

from __future__ import annotations

from typing import Any, Optional

import httpx

from payjarvis_clawdbot.types import (
    AgentStatus,
    AitToken,
    AuthorizationResult,
    Decision,
    RiskLevel,
    SpendingLimits,
)


class PayJarvisClient:
    """Low-level client for the PayJarvis API."""

    def __init__(
        self,
        api_key: str,
        bot_id: str,
        base_url: str = "https://api.payjarvis.com",
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._bot_id = bot_id
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={
                "Content-Type": "application/json",
                "X-Bot-Api-Key": api_key,
            },
            timeout=timeout,
        )
        self._agent_id: Optional[str] = None

    @property
    def agent_id(self) -> Optional[str]:
        return self._agent_id

    @property
    def bot_id(self) -> str:
        return self._bot_id

    def close(self) -> None:
        self._client.close()

    # ── Registration ──

    def resolve_agent(self) -> AgentStatus:
        """Resolve the bot's agent identity and return status."""
        resp = self._get(f"/bots/{self._bot_id}/reputation/sdk")
        data = resp.get("data", {})

        # Also fetch agent info from the bot endpoint
        bot_resp = self._get(f"/bots/{self._bot_id}/limits/sdk")
        bot_data = bot_resp.get("data", {})

        # Get agent verification data
        agent_resp = self._post(f"/bots/{self._bot_id}/agent-token", {"ttl": 60})
        agent_data = agent_resp.get("data", {})
        self._agent_id = agent_data.get("agentId")

        # Get full verification
        if self._agent_id:
            verify_resp = self._get_public(f"/v1/agents/{self._agent_id}/verify")
            verify = verify_resp.get("data", {})
            return AgentStatus(
                agent_id=self._agent_id,
                trust_score=verify.get("trust_score", 500),
                risk_level=RiskLevel(verify.get("risk_level", "MEDIUM")),
                status=verify.get("status", "ACTIVE"),
                transactions_count=verify.get("transactions", 0),
                total_spent=verify.get("total_spent", 0.0),
                owner_verified=verify.get("owner_verified", False),
                kyc_level=verify.get("kyc_level", 0),
                created_at=verify.get("created_at", ""),
            )

        # Fallback if no agent found
        return AgentStatus(
            agent_id="unknown",
            trust_score=500,
            risk_level=RiskLevel.MEDIUM,
            status="ACTIVE",
            transactions_count=0,
            total_spent=0.0,
            owner_verified=False,
            kyc_level=0,
            created_at="",
        )

    # ── Authorization ──

    def authorize(
        self,
        merchant: str,
        amount: float,
        category: str,
        currency: str = "USD",
        merchant_id: Optional[str] = None,
    ) -> AuthorizationResult:
        """Request payment authorization from PayJarvis."""
        m_id = merchant_id or merchant.lower().replace(" ", "-")

        resp = self._post(f"/bots/{self._bot_id}/request-payment", {
            "merchantId": m_id,
            "merchantName": merchant,
            "amount": amount,
            "currency": currency,
            "category": category,
        })

        data = resp.get("data", {})
        decision = Decision(data.get("decision", "BLOCKED"))

        return AuthorizationResult(
            decision=decision,
            transaction_id=data.get("transactionId", ""),
            approved=decision == Decision.APPROVED,
            blocked=decision == Decision.BLOCKED,
            pending=decision == Decision.PENDING_HUMAN,
            reason=data.get("reason"),
            rule_triggered=data.get("ruleTriggered"),
            bdit_token=data.get("bditToken"),
            approval_id=data.get("approvalId"),
            expires_at=data.get("expiresAt"),
        )

    # ── Limits ──

    def get_limits(self) -> SpendingLimits:
        """Get current spending limits and usage."""
        resp = self._get(f"/bots/{self._bot_id}/limits/sdk")
        data = resp.get("data", {})
        return SpendingLimits(
            per_transaction=data.get("perTransaction", 0),
            per_day=data.get("perDay", 0),
            per_week=data.get("perWeek", 0),
            per_month=data.get("perMonth", 0),
            auto_approve_limit=data.get("autoApproveLimit", 0),
            spent_today=data.get("spentToday", 0),
            spent_week=data.get("spentWeek", 0),
            spent_month=data.get("spentMonth", 0),
            remaining_today=data.get("remainingToday", 0),
            remaining_week=data.get("remainingWeek", 0),
            remaining_month=data.get("remainingMonth", 0),
        )

    # ── AIT ──

    def issue_ait(self, ttl: int = 3600) -> AitToken:
        """Issue an Agent Identity Token."""
        resp = self._post(f"/bots/{self._bot_id}/agent-token", {"ttl": ttl})
        data = resp.get("data", {})
        return AitToken(
            token=data.get("token", ""),
            agent_id=data.get("agentId", self._agent_id or ""),
            expires_at=data.get("expiresAt", ""),
        )

    # ── HTTP helpers ──

    def _get(self, path: str) -> dict[str, Any]:
        resp = self._client.get(path)
        resp.raise_for_status()
        return resp.json()

    def _get_public(self, path: str) -> dict[str, Any]:
        """GET without bot auth header (public endpoints)."""
        resp = httpx.get(
            f"{self._base_url}{path}",
            headers={"Content-Type": "application/json"},
            timeout=self._client.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = self._client.post(path, json=body)
        resp.raise_for_status()
        return resp.json()
