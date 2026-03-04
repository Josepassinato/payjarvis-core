# Contributing to PayJarvis

Thank you for your interest in contributing to PayJarvis! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ (or Supabase free tier)
- Redis 7+ (or Upstash free tier, or skip — falls back to in-memory)
- Clerk account (free tier)

### Getting Started

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/Payjarvis.git
cd Payjarvis

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Generate BDIT RS256 keys
openssl genrsa 2048 > /tmp/private.pem
openssl rsa -in /tmp/private.pem -pubout > /tmp/public.pem
# Copy key contents into .env (use \n for newlines)

# Set up database
npm run db:generate
npx --workspace=packages/database prisma db push

# Start all services in development mode
npm run dev
```

This starts:
- API on http://localhost:3001
- Rules Engine on http://localhost:3002
- Web Dashboard on http://localhost:3000

### Project Structure

```
apps/api/          → Fastify REST API
apps/rules-engine/ → Policy evaluation service
apps/web/          → Next.js dashboard
packages/agent-sdk/    → SDK for bot integration
packages/merchant-sdk/ → SDK for merchant verification
packages/bdit/         → BDIT token issuance/verification
packages/database/     → Prisma schema and client
packages/types/        → Shared TypeScript interfaces
```

## Making Changes

### Branch Naming

- `feature/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `chore/description` — Maintenance, deps, CI

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add webhook delivery for merchant events
fix: prevent duplicate BDIT token issuance
docs: add merchant SDK integration guide
chore: update prisma to v6
```

For scoped changes:
```
feat(rules-engine): add custom rule plugin support
fix(web): correct timezone in approval countdown
```

### Pull Request Process

1. Fork the repo and create your branch from `main`
2. Make your changes
3. Ensure the build passes: `npm run build`
4. Update documentation if needed
5. Submit a PR against `main`
6. Fill out the PR template

### Code Style

- **TypeScript** strict mode is enabled
- **Prettier** handles formatting (configured in repo)
- Run `npm run build` to verify type checking across all packages
- No `any` types — use proper TypeScript types
- Async/await for all I/O operations

## Areas Welcoming Contributions

| Area | Examples | Difficulty |
|------|----------|------------|
| Documentation | API examples, deployment guides, SDK docs | Easy |
| Tests | Unit tests, integration tests, E2E tests | Easy-Medium |
| Dashboard UI | Charts, filters, mobile responsiveness | Medium |
| SDK Improvements | Better error messages, retry logic, new languages | Medium |
| Merchant Integrations | WooCommerce, Shopify plugins | Medium |
| Rules Engine | Custom rule plugins, complex conditions | Medium-Hard |
| Performance | Query optimization, caching strategies | Hard |

## Issue Labels

- `good-first-issue` — Great for newcomers
- `help-wanted` — We need community help
- `bug` — Something isn't working
- `feature` — New feature request
- `documentation` — Docs improvements

## Code Review

- All PRs require at least one review
- We aim to review PRs within 3 business days
- Be open to feedback — we want to help you succeed
- Small, focused PRs are reviewed faster than large ones

## Questions?

Open a [Discussion](https://github.com/Josepassinato/Payjarvis/discussions) for questions that aren't bugs or feature requests.
