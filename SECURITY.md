# Security Policy

PayJarvis handles payment authorization and cryptographic tokens. We take security seriously.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues to: **security@payjarvis.com**

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could achieve)
- Suggested fix (if you have one)
- Your contact information for follow-up

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within 48 hours |
| Triage and assessment | Within 7 days |
| Fix development | Within 30 days (critical: 7 days) |
| Public disclosure | After fix is released |

## Scope

### In Scope

- API authentication and authorization bypass
- BDIT token forgery, replay, or manipulation
- RS256 key exposure or weaknesses
- SQL injection, XSS, CSRF
- Privilege escalation (bot accessing other bot's data)
- Trust score manipulation
- Approval flow bypass
- Audit log tampering
- Sensitive data exposure in API responses

### Out of Scope

- Denial of service attacks
- Social engineering
- Physical security
- Attacks requiring compromised Clerk or Supabase accounts
- Vulnerabilities in third-party dependencies (report to the dependency maintainer)
- Issues in the development/demo environment only

## BDIT Token Security

The BDIT (Bot Digital Identity Token) is a critical security component:

- Tokens use RS256 (asymmetric) signatures — the private key never leaves the server
- Tokens are one-time use, enforced via JTI tracking in Redis
- Tokens expire after 5 minutes
- Merchants verify tokens using the public JWKS endpoint

If you discover a way to forge, replay, or bypass BDIT token verification, this is a critical vulnerability.

## Recognition

We maintain a hall of fame for security researchers who responsibly disclose vulnerabilities. With your permission, we will credit you in our security advisories.

## Safe Harbor

We will not pursue legal action against researchers who:

- Act in good faith
- Avoid accessing or modifying other users' data
- Report vulnerabilities promptly
- Do not publicly disclose before a fix is available
