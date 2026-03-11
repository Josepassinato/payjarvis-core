"""Type definitions for PayJarvis plugin."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Decision(str, Enum):
    APPROVED = "APPROVED"
    BLOCKED = "BLOCKED"
    PENDING_HUMAN = "PENDING_HUMAN"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass(frozen=True)
class AuthorizationResult:
    """Result of a PayJarvis authorization check."""

    decision: Decision
    transaction_id: str
    approved: bool
    blocked: bool
    pending: bool
    reason: Optional[str] = None
    rule_triggered: Optional[str] = None
    bdit_token: Optional[str] = None
    approval_id: Optional[str] = None
    expires_at: Optional[str] = None


@dataclass(frozen=True)
class AgentStatus:
    """Current agent identity and trust status."""

    agent_id: str
    trust_score: int
    risk_level: RiskLevel
    status: str
    transactions_count: int
    total_spent: float
    owner_verified: bool
    kyc_level: int
    created_at: str


@dataclass(frozen=True)
class SpendingLimits:
    """Current spending limits and usage."""

    per_transaction: float
    per_day: float
    per_week: float
    per_month: float
    auto_approve_limit: float
    spent_today: float
    spent_week: float
    spent_month: float
    remaining_today: float
    remaining_week: float
    remaining_month: float


@dataclass(frozen=True)
class AitToken:
    """Agent Identity Token for merchant verification."""

    token: str
    agent_id: str
    expires_at: str


# Financial action categories that trigger authorization
FINANCIAL_ACTIONS: set[str] = {
    "purchase",
    "buy",
    "checkout",
    "subscribe",
    "subscription",
    "pay",
    "payment",
    "ad_spend",
    "ad_campaign",
    "transfer",
    "tip",
    "donate",
    "rent",
    "book",
    "order",
}
