"""Sandbox mode for frictionless local testing without a live PayJarvis API."""

from __future__ import annotations

import random
import string
from typing import Optional

from payjarvis_clawdbot.types import (
    AgentStatus,
    AitToken,
    AuthorizationResult,
    Decision,
    RiskLevel,
    SpendingLimits,
)


def _fake_id(prefix: str = "sandbox") -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
    return f"{prefix}_{suffix}"


class SandboxClient:
    """In-memory mock client for sandbox mode. No network calls."""

    def __init__(
        self,
        max_transaction: float = 100.0,
        daily_limit: float = 500.0,
        trust_score: int = 742,
    ) -> None:
        self._agent_id = f"ag_{_fake_id()}"
        self._max_transaction = max_transaction
        self._daily_limit = daily_limit
        self._trust_score = trust_score
        self._spent_today = 0.0
        self._tx_count = 0

    @property
    def agent_id(self) -> Optional[str]:
        return self._agent_id

    @property
    def bot_id(self) -> str:
        return "sandbox-bot"

    def close(self) -> None:
        pass

    def resolve_agent(self) -> AgentStatus:
        return AgentStatus(
            agent_id=self._agent_id,
            trust_score=self._trust_score,
            risk_level=_risk_level(self._trust_score),
            status="ACTIVE",
            transactions_count=self._tx_count,
            total_spent=self._spent_today,
            owner_verified=True,
            kyc_level=2,
            created_at="2026-01-01T00:00:00.000Z",
        )

    def authorize(
        self,
        merchant: str,
        amount: float,
        category: str,
        currency: str = "USD",
        merchant_id: Optional[str] = None,
    ) -> AuthorizationResult:
        tx_id = _fake_id("tx")

        # Rule: exceeds per-transaction limit
        if amount > self._max_transaction:
            if amount > self._max_transaction * 2:
                return AuthorizationResult(
                    decision=Decision.BLOCKED,
                    transaction_id=tx_id,
                    approved=False,
                    blocked=True,
                    pending=False,
                    reason=f"Amount ${amount:.2f} exceeds max transaction limit ${self._max_transaction:.2f}",
                    rule_triggered="checkTransactionLimit",
                )
            return AuthorizationResult(
                decision=Decision.PENDING_HUMAN,
                transaction_id=tx_id,
                approved=False,
                blocked=False,
                pending=True,
                reason=f"Amount ${amount:.2f} exceeds auto-approve limit",
                approval_id=_fake_id("apr"),
            )

        # Rule: exceeds daily limit
        if self._spent_today + amount > self._daily_limit:
            return AuthorizationResult(
                decision=Decision.BLOCKED,
                transaction_id=tx_id,
                approved=False,
                blocked=True,
                pending=False,
                reason=f"Daily limit ${self._daily_limit:.2f} would be exceeded",
                rule_triggered="checkDailyLimit",
            )

        # Approved
        self._spent_today += amount
        self._tx_count += 1
        self._trust_score = min(1000, self._trust_score + 5)

        return AuthorizationResult(
            decision=Decision.APPROVED,
            transaction_id=tx_id,
            approved=True,
            blocked=False,
            pending=False,
            bdit_token=f"sandbox.bdit.{_fake_id()}",
        )

    def get_limits(self) -> SpendingLimits:
        return SpendingLimits(
            per_transaction=self._max_transaction,
            per_day=self._daily_limit,
            per_week=self._daily_limit * 5,
            per_month=self._daily_limit * 20,
            auto_approve_limit=self._max_transaction * 0.5,
            spent_today=self._spent_today,
            spent_week=self._spent_today,
            spent_month=self._spent_today,
            remaining_today=max(0, self._daily_limit - self._spent_today),
            remaining_week=max(0, self._daily_limit * 5 - self._spent_today),
            remaining_month=max(0, self._daily_limit * 20 - self._spent_today),
        )

    def issue_ait(self, ttl: int = 3600) -> AitToken:
        return AitToken(
            token=f"sandbox.ait.{_fake_id()}",
            agent_id=self._agent_id,
            expires_at="2026-12-31T23:59:59.000Z",
        )


def _risk_level(score: int) -> RiskLevel:
    if score >= 700:
        return RiskLevel.LOW
    if score >= 400:
        return RiskLevel.MEDIUM
    if score >= 200:
        return RiskLevel.HIGH
    return RiskLevel.CRITICAL
