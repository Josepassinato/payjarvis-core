# BDIT — Bot Digital Identity Token

## Specification v1.0

---

## 1. Overview

BDIT (Bot Digital Identity Token) is an open standard for verifying the identity and authorization of AI agents performing financial transactions. It answers a critical question for merchants:

> "Was this purchase authorized by the human who owns this bot?"

### Why BDIT exists

As AI agents increasingly make purchases on behalf of humans, merchants face new risks:

- **Unauthorized purchases** — A bot buying without the owner's consent
- **Fraudulent bots** — Agents impersonating legitimate users
- **Lack of accountability** — No audit trail for bot-initiated transactions
- **Chargeback risk** — Disputes from purchases the human never authorized

BDIT solves this by providing a cryptographically signed token that proves:

1. The bot is registered and verified
2. The human owner authorized this specific transaction
3. The transaction is within configured limits
4. The token is valid, unexpired, and single-use

---

## 2. How it works

```
  Bot (AI Agent)              PayJarvis              Merchant
  ═══════════════           ═══════════════        ═══════════════
       │                          │                       │
       │  1. Request payment      │                       │
       │  (amount, merchant,      │                       │
       │   category)              │                       │
       │ ─────────────────────►   │                       │
       │                          │                       │
       │                    2. Evaluate rules             │
       │                       - Spending limits          │
       │                       - Category policy          │
       │                       - Time windows             │
       │                       - Trust score              │
       │                          │                       │
       │  3. Decision + BDIT      │                       │
       │     (if APPROVED)        │                       │
       │ ◄─────────────────────   │                       │
       │                          │                       │
       │  4. Proceed with         │                       │
       │     purchase + BDIT      │                       │
       │ ──────────────────────────────────────────────►  │
       │                          │                       │
       │                          │  5. Verify BDIT       │
       │                          │ ◄─────────────────────│
       │                          │                       │
       │                          │  6. Verification      │
       │                          │     result            │
       │                          │ ─────────────────────►│
       │                          │                       │
       │                          │            7. Complete │
       │  8. Confirmation         │               order   │
       │ ◄──────────────────────────────────────────────  │
```

---

## 3. Token structure

BDIT is a standard JWT (RFC 7519) signed with RS256.

### Header

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "payjarvis-key-001"
}
```

### Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `iss` | string | Yes | Issuer. Always `"payjarvis"` |
| `sub` | string | Yes | Subject. The `bot_id` |
| `iat` | number | Yes | Issued at (Unix timestamp) |
| `exp` | number | Yes | Expiration (Unix timestamp). Max 5 minutes from `iat` |
| `jti` | string | Yes | Unique token ID (UUID v4). Single-use enforcement |
| `bot_id` | string | Yes | Unique identifier of the bot |
| `owner_id` | string | Yes | Identifier of the human owner |
| `trust_score` | number | Yes | Bot trust score (0-100) |
| `kyc_level` | number | Yes | Owner's KYC verification level (0-3) |
| `merchant_id` | string | Yes | Target merchant identifier |
| `amount` | number | Yes | Authorized transaction amount |
| `category` | string | Yes | Transaction category |
| `categories` | string[] | Yes | Categories the bot is allowed to transact in |
| `max_amount` | number | Yes | Maximum per-transaction limit |
| `session_id` | string | Yes | Unique session identifier |

### Example payload

```json
{
  "iss": "payjarvis",
  "sub": "bot_abc123",
  "iat": 1709571600,
  "exp": 1709571900,
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "bot_id": "bot_abc123",
  "owner_id": "user_xyz789",
  "trust_score": 94,
  "kyc_level": 2,
  "merchant_id": "amazon",
  "amount": 45.00,
  "category": "shopping",
  "categories": ["shopping", "electronics", "food"],
  "max_amount": 200.00,
  "session_id": "sess_1709571600_a1b2c3"
}
```

### Signature

The token is signed with RS256 (RSASSA-PKCS1-v1_5 using SHA-256). The signing key is published at:

```
https://api.payjarvis.com/.well-known/jwks.json
```

---

## 4. Verification

### Step 1 — Obtain the public key

Fetch the JWKS endpoint and cache for 24 hours:

```
GET https://api.payjarvis.com/.well-known/jwks.json
```

Response:
```json
{
  "keys": [{
    "kty": "RSA",
    "use": "sig",
    "kid": "payjarvis-key-001",
    "alg": "RS256",
    "n": "...",
    "e": "AQAB"
  }]
}
```

### Step 2 — Verify the token

1. Decode the JWT header and match `kid` to a key in the JWKS
2. Verify the RS256 signature
3. Check `iss` equals `"payjarvis"`
4. Check `exp` is in the future
5. Check `merchant_id` matches your merchant ID
6. Optionally check `trust_score` meets your minimum threshold
7. Optionally verify `jti` hasn't been used (one-time use)

### Step 3 — Accept or reject

If all checks pass, the bot is verified. Proceed with the transaction.

---

## 5. Verification examples

### Node.js / TypeScript

```typescript
import { verifyBdit } from '@payjarvis/verify-sdk'

const result = await verifyBdit({
  token: req.headers['x-bdit-token'],
  merchantId: 'your-merchant-id',
  jwksUrl: 'https://api.payjarvis.com/.well-known/jwks.json'
})

if (result.verified) {
  // Bot authorized — proceed with checkout
  console.log(`Bot ${result.bot.id} authorized for $${result.authorization.amount}`)
}
```

### Python

```python
from payjarvis_verify import verify_bdit

result = verify_bdit(
    token=request.headers.get('X-BDIT-Token'),
    merchant_id='your-merchant-id',
    jwks_url='https://api.payjarvis.com/.well-known/jwks.json'
)

if result['verified']:
    print(f"Bot {result['bot']['id']} authorized")
```

### PHP

```php
use PayJarvis\Verify;

$result = Verify::bdit(
    token: $_SERVER['HTTP_X_BDIT_TOKEN'],
    merchantId: 'your-merchant-id',
    jwksUrl: 'https://api.payjarvis.com/.well-known/jwks.json'
);

if ($result->verified) {
    echo "Bot {$result->bot->id} authorized";
}
```

### Java

```java
import com.payjarvis.BditVerifier;

BditVerifier.Result result = BditVerifier.verify(
    request.getHeader("X-BDIT-Token"),
    "your-merchant-id",
    "https://api.payjarvis.com/.well-known/jwks.json"
);

if (result.isVerified()) {
    System.out.println("Bot " + result.getBot().getId() + " authorized");
}
```

### Go

```go
import "github.com/payjarvis/verify-sdk-go"

result, err := payjarvis.VerifyBdit(payjarvis.VerifyOptions{
    Token:      r.Header.Get("X-BDIT-Token"),
    MerchantID: "your-merchant-id",
    JwksURL:    "https://api.payjarvis.com/.well-known/jwks.json",
})

if result.Verified {
    fmt.Printf("Bot %s authorized\n", result.Bot.ID)
}
```

---

## 6. Token delivery

The BDIT token can be delivered to the merchant via:

| Method | Header/Field | Priority |
|--------|-------------|----------|
| HTTP Header | `X-BDIT-Token: <token>` | Recommended |
| HTTP Header | `Authorization: Bearer <token>` | Alternative |
| Cookie | `bdit_token=<token>` | Browser flows |
| POST body | `{ "bditToken": "<token>" }` | API calls |
| URL param | `?payjarvis_token=<token>` | Redirects |

---

## 7. Security considerations

- **Short-lived**: Tokens expire after 5 minutes
- **Single-use**: Each `jti` can only be used once
- **Merchant-scoped**: Token is bound to a specific `merchant_id`
- **Amount-bound**: Token authorizes a specific `amount`
- **Key rotation**: JWKS supports multiple keys via `kid`
- **Fail-open optional**: Merchants can choose to allow transactions if verification service is unavailable

---

## 8. Becoming a certified issuer

Currently, PayJarvis is the sole issuer of BDIT tokens. In the future, we plan to support third-party issuers through a certification program:

1. **Apply** — Submit your platform for review
2. **Audit** — Pass security audit of your signing infrastructure
3. **Register** — Register your JWKS endpoint with the BDIT registry
4. **Issue** — Begin issuing BDIT tokens with your own keys

Interested? Contact: partners@payjarvis.com

---

## 9. Architectural invariants

These are properties that any BDIT issuer or verifier MUST preserve.
They are non-negotiable design constraints — violations indicate either
a bug or a deliberate breaking change that requires a major version
bump and migration plan.

### 9.1. Mandate grants authority, reputation informs only

A BDIT carries two logically separate sets of claims:

| Set | Authority | Examples |
|-----|-----------|----------|
| **Mandate** | Authoritative | `categories`, `max_amount`, `merchant_id`, `amount`, `category`, `session_id`, time windows, daily/weekly/monthly limits |
| **Reputation** | Informational | `trust_score`, `kyc_level`, `agent_trust_score`, `owner_verified`, `transactions_count`, `total_spent` |

**Authoritative rules:**

1. The decision to APPROVE or BLOCK a transaction MUST derive solely
   from mandate claims plus runtime context (spending totals, current
   time, merchant data). Reputation MUST NOT be a denial criterion.
2. Reputation MAY route an APPROVED decision to PENDING_HUMAN review,
   but MAY NOT downgrade APPROVED to BLOCKED.
3. Merchants MAY apply additional reputation-based filters via the
   merchant SDK (`MerchantPolicy.minTrustScore`); this is documented as
   merchant policy, not BDIT validity.

**Property test (must hold for any conformant verifier):**

> For any BDIT payload `P` with valid mandate claims and runtime
> context yielding `evaluate(P) = APPROVED`, varying any subset of
> reputation claims (`trust_score`, `kyc_level`, `agent_trust_score`,
> `owner_verified`, `transactions_count`, `total_spent`) over their
> entire valid range MUST NOT produce `evaluate(P') = BLOCKED`.

The reference implementation in `apps/rules-engine` enforces this via
a two-phase split: `evaluateMandate()` (authoritative) followed by
`applyReputationRouting()` (demote-only). See
`apps/rules-engine/test/decision-engine.invariant.test.ts`.

### 9.2. Single-use enforcement

Each `jti` MUST be rejected on second presentation. Stateless verifiers
MAY rely on the merchant's own replay-cache; PayJarvis-hosted verify
endpoints maintain a short-lived `jti` set in Redis.

### 9.3. Mandate-merchant binding

`merchant_id` MUST be checked against the resource being purchased.
Tokens are not transferable between merchants.

### 9.4. Mandate-amount binding

`amount` MUST equal the transaction amount the merchant attempts to
charge, within precision rounding.

---

## 10. Concordia stack mapping

BDIT composes with the Concordia agreement protocol (spec v0.5.0).
Concordia operates at the **Agreement** layer; BDIT operates at the
**Settlement** layer:

```
Communication  A2A · HTTPS · JSON-RPC
Trust          Reputation Attestations          ← informs Agreement; not authoritative for Settlement
Agreement      Concordia                         ← negotiates terms; produces "intent mandate"
Settlement     [ BDIT → ]  ACP · AP2 · x402 · Stripe · Lightning
                  ↑
                  authorization-of-execution: BDIT proves the agent
                  is authorized to execute within the agreed terms
                  before the payment rail fires.
```

Per Concordia spec §10.4: *"The Concordia agreement serves as the
'intent mandate' in AP2's authorization flow. The agreed terms define
the scope and limits of what the payment agent is authorized to do."*

BDIT realizes this in concrete form: when issued from a Concordia
session, the mandate claims are derived from the agreement terms, and
the binding is preserved by these claims:

| BDIT claim | Purpose |
|---|---|
| `mandate_source` | `"concordia"` when sourced from a Concordia agreement |
| `concordia_session_urn` | `urn:concordia:session:<id>` — references the source session |
| `concordia_transcript_hash` | `sha256:<hex>` — verifies session integrity (hash binding) |
| `concordia_terms_hash` | Optional — hash of the derived terms for tamper detection |

### 10.1. Concordia → BDIT issuance flow

```
1. Agent A ↔ Agent B negotiate via Concordia, reaching agreement T
   with session_id = ses_xyz, transcript_hash = sha256:abc...

2. Authorized party (or PayJarvis as integrated issuer) submits the
   agreement reference to PayJarvis:

       POST /bdit/from-agreement
       {
         "concordia_session_urn":     "urn:concordia:session:ses_xyz",
         "concordia_transcript_hash": "sha256:abc...",
         "bot_id":                    "bot_executor_42"
       }

3. PayJarvis verifies the Concordia session (signature, integrity),
   derives the mandate claims from the agreed terms (max_amount,
   categories, merchant_id, amount, category) and issues a BDIT
   carrying mandate_source="concordia" plus the URN + hash.

4. Bot presents the BDIT to the payment rail. The rail verifies the
   JWS signature against PayJarvis's JWKS and consumes the mandate
   claims to authorize execution.
```

The caller of `/bdit/from-agreement` cannot inflate mandate beyond
what the agreement permits — mandate is **derived**, not free-form
input. This is the structural enforcement of invariant 9.1 across the
Agreement → Settlement boundary.

### 10.2. Reputation Attestations (Trust layer)

Reputation Attestations live in the layer above Agreement and are
consumed by Concordia (and other Agreement-layer protocols) when
deciding whether to grant the mandate. Reputation does not cross down
into Settlement — once a mandate exists, Settlement evaluates it on
its own terms. Outcome receipts emitted by Settlement (CTEF-compatible
receipts, §11) flow back up to update Reputation Attestations, closing
the loop.

---

## 11. CTEF outcome receipts

After Settlement (whether the payment rail succeeded, was denied,
expired, or got disputed), PayJarvis emits a **CTEF outcome receipt** —
a cryptographically signed envelope that any consumer (Verascore,
merchant, auditor) can verify offline. Receipts are the canonical
artifact that flows from Settlement back up to the Trust layer.

### 11.1. Format

The envelope schema is byte-compatible with the Concordia reference
implementation (`build_trust_evidence_envelope` in `envelope.py` +
canonical JSON in `signing.py`). Plain JSON (not CBOR, not JSON-LD).
Signature: **EdDSA / Ed25519 only** — RSA is rejected at sign time per
the CTEF spec.

```json
{
  "envelope_version": "1.0.0",
  "envelope_id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "issued_at": "2026-05-10T05:48:55.000Z",
  "expires_at": "2026-05-17T05:48:55.000Z",
  "refresh_hint": {
    "strategy": "event_driven",
    "events": ["payment_settled", "payment_disputed", "mandate_consumed", "mandate_expired"],
    "max_age_seconds": 604800
  },
  "validity_temporal": {
    "mode": "sequence",
    "sequence_key": "sess_xyz",
    "baseline": null,
    "aliasing_risk": null
  },
  "provider": {
    "did": "did:web:api.payjarvis.com",
    "category": "transactional",
    "kid": "payjarvis-ed25519-001",
    "name": "PayJarvis"
  },
  "subject": { "did": "did:payjarvis:bot:bot_abc123" },
  "category": "transactional",
  "visibility": "public",
  "references": [
    { "kind": "bdit_token",     "urn": "urn:payjarvis:bdit:550e8400-e29b-..." },
    { "kind": "source_session", "urn": "urn:concordia:session:ses_xyz" },
    { "kind": "approval",       "urn": "urn:payjarvis:approval:appr_abc" }
  ],
  "payload": {
    "approval_id": "appr_abc",
    "decision": "settled",
    "amount": 49.99,
    "currency": "USD",
    "merchant_id": "amazon",
    "category": "shopping",
    "rail": "stripe",
    "rail_reference": "pi_3OAB...",
    "mandate_source": "concordia",
    "concordia_session_urn": "urn:concordia:session:ses_xyz",
    "decided_at": "2026-05-10T05:48:54.000Z"
  },
  "signature": {
    "alg": "EdDSA",
    "kid": "payjarvis-ed25519-001",
    "value": "<base64url Ed25519 signature over canonical JSON>"
  }
}
```

> **Category note**: `"transactional"` is the Concordia-accepted value.
> `"spending-authorization"` is the PayJarvis-specific category awaiting
> spec acceptance; flip via `CTEF_CATEGORY=spending-authorization` once
> the freeze lifts.

### 11.2. Canonicalization

Signing operates over a canonical JSON serialization:

- Object keys sorted lexicographically (recursive)
- No whitespace
- Arrays preserve declaration order (sequence-significant)
- UTF-8 raw output
- `NaN`, `Infinity`, `-0` are rejected at canonicalize time

This matches Concordia's `signing.py canonical_json()` and TypeScript
`stableStringify` byte-for-byte. The reference Node implementation is
`canonicalJson()` in `@payjarvis/bdit/ctef.ts`.

### 11.3. Issuance endpoint

```
POST /api/bdit/receipts
  Headers: X-Bot-Api-Key: <bot_api_key>
  Body:
    {
      "outcome":      <PaymentOutcomePayload>,   // see §11.4
      "session_id":   "<bdit session_id, used as sequence_key>",
      "subject_did":  "<optional override; defaults to did:payjarvis:bot:<botId>>",
      "category":     "<optional; defaults to env CTEF_CATEGORY ?? 'transactional'>",
      "issued_at":    "<optional ISO date; binds receipt to actual decision time>",
      "validity_seconds": <optional; default 604800>
    }

  Returns: 200 application/json
    <Signed CTEF envelope>

  Errors:
    400 — missing required fields (outcome, session_id, outcome.approval_id)
    401 — invalid or missing bot API key
    503 — Ed25519 signing key not configured (operator must run
          `npm run -w @payjarvis/bdit generate-keys` and add the
          PAYJARVIS_*_ED25519 envs)
```

### 11.4. PaymentOutcomePayload

| Field | Required | Description |
|---|---|---|
| `approval_id` | Yes | PayJarvis approval/transaction id |
| `decision` | Yes | `"approved"` \| `"blocked"` \| `"pending_human"` \| `"settled"` \| `"expired"` \| `"disputed"` |
| `amount` | Yes | Amount in `currency` units |
| `currency` | Yes | ISO 4217 |
| `merchant_id` | Yes | Merchant the bot transacted with |
| `category` | Yes | Transaction category at decision time |
| `mandate_source` | No | Mirror of BDIT mandate_source (`"concordia"` \| `"owner"` \| `"direct"`) |
| `concordia_session_urn` | No | When `mandate_source="concordia"` |
| `bdit_jti` | No | The BDIT jti this outcome attests to |
| `rail` | No | Settlement rail (`"stripe"`, `"x402"`, `"celcoin"`, etc.) |
| `rail_reference` | No | Rail-side identifier (Stripe payment_intent id, etc.) |
| `decided_at` | No | ISO timestamp of the decision |
| `reason` | No | Reason string for blocked/expired/disputed |

### 11.5. Verification

Consumers verify the receipt with:

1. Strip `signature` from the envelope.
2. Apply canonical JSON to the remainder.
3. Resolve `signature.kid` to a public key via PayJarvis JWKS:
   `GET /.well-known/jwks.json` → match `kid` → `{kty: "OKP", crv: "Ed25519", x: <base64url>}`
4. Ed25519-verify the signature against the canonical bytes.

The `@payjarvis/bdit` package exports `verifyEnvelope(env, publicKeyPem)`
as a reference implementation.

### 11.6. Composition with Verascore / Trust layer

CTEF receipts are designed to be consumed verbatim by Trust-layer
reputation systems (Verascore et al.). A reputation system that
follows the convention:

- accepts CTEF envelopes whose `category ∈ {"transactional", "spending-authorization"}`
- resolves `provider.did` to a known issuer (PayJarvis, others)
- validates the signature against the issuer's JWKS
- aggregates `payload.decision == "settled"` events as positive evidence

…will receive a verifiable transaction history per agent without
trusting any central party beyond the issuer's JWKS. This is the
structural completion of the loop sketched in §10.2.

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-04 | Initial specification |
| 1.1-draft | 2026-05-10 | Added §9 Architectural invariants (mandate grants authority, reputation informs only). Added §10 Concordia stack mapping (`mandate_source`, `concordia_session_urn`, `concordia_transcript_hash`, `concordia_terms_hash` claims). DecisionEngine refactored into `evaluateMandate()` + `applyReputationRouting()` (demote-only). |
| 1.2-draft | 2026-05-10 | Added §11 CTEF outcome receipts (Concordia-compatible signed envelopes, EdDSA / Ed25519). New endpoint `POST /api/bdit/receipts`. Added §10.2 cross-reference and §11.6 Verascore consumption note. RS256 → Ed25519 dual-sign migration available via `BDIT_SIGNING_ALG=EdDSA`. |

---

**PayJarvis** — Trust and identity layer for AI payment agents.

https://payjarvis.com | https://api.payjarvis.com/.well-known/jwks.json
