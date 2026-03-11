"""PayJarvis financial guardrails plugin for Clawdbot agents."""

from payjarvis_clawdbot.plugin import PayJarvisPlugin
from payjarvis_clawdbot.client import PayJarvisClient
from payjarvis_clawdbot.types import (
    AuthorizationResult,
    AgentStatus,
    SpendingLimits,
    AitToken,
)

__version__ = "0.1.0"
__all__ = [
    "PayJarvisPlugin",
    "PayJarvisClient",
    "AuthorizationResult",
    "AgentStatus",
    "SpendingLimits",
    "AitToken",
]
