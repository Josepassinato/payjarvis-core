"""
PayJarvis BDIT Verification SDK — Python

Verifica BDIT tokens localmente usando JWKS.

Usage:
    from payjarvis_verify import verify_bdit

    result = verify_bdit(
        token=request.headers.get('X-BDIT-Token'),
        merchant_id='your-merchant-id'
    )

    if result['verified']:
        print(f"Bot {result['bot']['id']} authorized")

Requirements:
    pip install PyJWT cryptography requests
"""

import json
import time
from typing import Any, Optional
from urllib.request import urlopen

import jwt  # PyJWT
from jwt import PyJWKClient

DEFAULT_JWKS_URL = "https://api.payjarvis.com/.well-known/jwks.json"

# JWKS client cache
_jwks_clients: dict[str, PyJWKClient] = {}


def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    if jwks_url not in _jwks_clients:
        _jwks_clients[jwks_url] = PyJWKClient(
            jwks_url, cache_jwk_set=True, lifespan=86400
        )
    return _jwks_clients[jwks_url]


def verify_bdit(
    token: str,
    merchant_id: str,
    jwks_url: str = DEFAULT_JWKS_URL,
    min_trust_score: int = 0,
) -> dict[str, Any]:
    """
    Verify a BDIT token.

    Args:
        token: The JWT token string
        merchant_id: Your merchant ID (must match token's merchant_id)
        jwks_url: JWKS endpoint URL (default: PayJarvis production)
        min_trust_score: Minimum trust score required (default: 0)

    Returns:
        dict with 'verified' bool and 'bot'/'authorization' if verified
    """
    if not token:
        return {"verified": False, "error": "No token provided"}

    if not merchant_id:
        return {"verified": False, "error": "No merchant_id provided"}

    try:
        # Get signing key from JWKS
        client = _get_jwks_client(jwks_url)
        signing_key = client.get_signing_key_from_jwt(token)

        # Decode and verify
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer="payjarvis",
            options={"require": ["exp", "iat", "jti", "iss"]},
        )

        # Validate required fields
        for field in ("bot_id", "merchant_id", "jti"):
            if field not in payload:
                return {
                    "verified": False,
                    "error": f"Missing required field: {field}",
                }

        # Merchant match
        if payload["merchant_id"] != merchant_id:
            return {
                "verified": False,
                "error": (
                    f"Merchant mismatch: token has '{payload['merchant_id']}', "
                    f"expected '{merchant_id}'"
                ),
            }

        # Trust score
        trust_score = payload.get("trust_score", 0)
        if trust_score < min_trust_score:
            return {
                "verified": False,
                "error": f"Trust score {trust_score} below minimum {min_trust_score}",
            }

        return {
            "verified": True,
            "bot": {
                "id": payload["bot_id"],
                "owner_id": payload.get("owner_id"),
                "trust_score": trust_score,
                "kyc_level": payload.get("kyc_level", 0),
            },
            "authorization": {
                "amount": payload.get("amount", 0),
                "currency": "USD",
                "category": payload.get("category", ""),
                "merchant_id": payload["merchant_id"],
                "valid_until": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime(payload["exp"])
                ),
                "one_time_use": True,
                "jti": payload["jti"],
            },
        }

    except jwt.ExpiredSignatureError:
        return {"verified": False, "error": "Token expired"}
    except jwt.InvalidIssuerError:
        return {"verified": False, "error": "Invalid issuer (expected 'payjarvis')"}
    except jwt.InvalidTokenError as e:
        return {"verified": False, "error": str(e)}
    except Exception as e:
        return {"verified": False, "error": f"Verification failed: {e}"}


def extract_bdit_token(
    headers: Optional[dict[str, str]] = None,
    cookies: Optional[dict[str, str]] = None,
    body: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """Extract BDIT token from HTTP request sources."""
    if headers:
        if headers.get("X-BDIT-Token"):
            return headers["X-BDIT-Token"]
        if headers.get("X-Payjarvis-Token"):
            return headers["X-Payjarvis-Token"]
        auth = headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:]

    if cookies and cookies.get("bdit_token"):
        return cookies["bdit_token"]

    if body:
        if isinstance(body.get("bditToken"), str):
            return body["bditToken"]
        if isinstance(body.get("payjarvis_token"), str):
            return body["payjarvis_token"]

    return None
