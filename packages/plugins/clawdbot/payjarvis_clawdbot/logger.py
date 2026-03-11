"""Clean terminal logging for PayJarvis plugin."""

from __future__ import annotations

import sys
from typing import Optional

# ANSI colors
_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_RED = "\033[31m"
_CYAN = "\033[36m"
_MAGENTA = "\033[35m"

_PREFIX = f"{_BOLD}{_CYAN}[PayJarvis]{_RESET}"


def _supports_color() -> bool:
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def _strip_ansi(text: str) -> str:
    import re
    return re.sub(r"\033\[[0-9;]*m", "", text)


def _print(msg: str) -> None:
    if _supports_color():
        print(msg, flush=True)
    else:
        print(_strip_ansi(msg), flush=True)


def registered(agent_id: str) -> None:
    _print(f"{_PREFIX} Agent registered: {_BOLD}{agent_id}{_RESET}")


def trust_score(score: int, risk_level: str) -> None:
    if score >= 700:
        color = _GREEN
    elif score >= 400:
        color = _YELLOW
    else:
        color = _RED
    _print(f"{_PREFIX} Trust Score: {color}{_BOLD}{score}{_RESET} {_DIM}({risk_level}){_RESET}")


def approved(merchant: str, amount: float, tx_id: str) -> None:
    _print(
        f"{_PREFIX} {_GREEN}{_BOLD}APPROVED{_RESET} "
        f"${amount:.2f} → {merchant} {_DIM}[{tx_id}]{_RESET}"
    )


def blocked(merchant: str, amount: float, reason: Optional[str] = None) -> None:
    reason_str = f" — {reason}" if reason else ""
    _print(
        f"{_PREFIX} {_RED}{_BOLD}BLOCKED{_RESET} "
        f"${amount:.2f} → {merchant}{reason_str}"
    )


def pending(merchant: str, amount: float, approval_id: Optional[str] = None) -> None:
    id_str = f" {_DIM}[{approval_id}]{_RESET}" if approval_id else ""
    _print(
        f"{_PREFIX} {_YELLOW}{_BOLD}PENDING_HUMAN{_RESET} "
        f"${amount:.2f} → {merchant}{id_str}"
    )


def ait_issued(agent_id: str) -> None:
    _print(f"{_PREFIX} {_MAGENTA}AIT issued{_RESET} for {agent_id}")


def sandbox_mode() -> None:
    _print(f"{_PREFIX} {_YELLOW}Running in sandbox mode{_RESET}")


def info(msg: str) -> None:
    _print(f"{_PREFIX} {msg}")


def error(msg: str) -> None:
    _print(f"{_PREFIX} {_RED}Error:{_RESET} {msg}")
