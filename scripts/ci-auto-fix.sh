#!/bin/bash
# CI Auto-Fix — Checks if last CI run failed and attempts automated fix
# Usage: bash scripts/ci-auto-fix.sh [branch]
# Cron: */30 * * * * cd /root/Payjarvis && bash scripts/ci-auto-fix.sh

set -euo pipefail

BRANCH="${1:-$(git branch --show-current)}"
MAX_ATTEMPTS=2
ATTEMPT_FILE="/tmp/ci-autofix-attempts-${BRANCH//\//-}"
TELEGRAM_CHAT_ID="${ADMIN_TELEGRAM_ID:-1762460701}"
TELEGRAM_TOKEN="${TELEGRAM_ADMIN_BOT_TOKEN:-}"
LOG="/tmp/ci-autofix-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

send_telegram() {
  if [ -n "$TELEGRAM_TOKEN" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="$TELEGRAM_CHAT_ID" \
      -d parse_mode="Markdown" \
      -d text="$1" > /dev/null 2>&1 || true
  fi
}

# 1. Check if latest CI run failed
log "Checking CI status for branch: $BRANCH"
CONCLUSION=$(gh run list --branch "$BRANCH" --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null || echo "unknown")

if [ "$CONCLUSION" != "failure" ]; then
  log "CI status: $CONCLUSION — no action needed"
  rm -f "$ATTEMPT_FILE"
  exit 0
fi

# 2. Check attempt counter
ATTEMPTS=0
if [ -f "$ATTEMPT_FILE" ]; then
  ATTEMPTS=$(cat "$ATTEMPT_FILE")
fi

if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
  log "Already attempted $ATTEMPTS fixes. Alerting José."

  # Get error summary
  ERROR_SUMMARY=$(gh run view --log-failed 2>&1 | grep -i "error" | head -5 | sed 's/build.*Z //')

  send_telegram "🔴 *CI Auto-Fix Failed* (${ATTEMPTS}x)
Branch: \`$BRANCH\`
Erros:
\`\`\`
${ERROR_SUMMARY}
\`\`\`
Precisa intervenção manual."

  exit 1
fi

# 3. Increment attempt counter
ATTEMPTS=$((ATTEMPTS + 1))
echo "$ATTEMPTS" > "$ATTEMPT_FILE"
log "Auto-fix attempt $ATTEMPTS/$MAX_ATTEMPTS"

# 4. Pull latest
log "Pulling latest from $BRANCH"
git checkout "$BRANCH" 2>/dev/null || true
git pull origin "$BRANCH" 2>/dev/null || true

# 5. Get CI errors
log "Fetching CI error log"
gh run view --log-failed 2>&1 > /tmp/ci-errors.txt

# 6. Try local build first
log "Attempting local build"
npx prisma generate --schema packages/database/prisma/schema.prisma 2>/dev/null || true
npx turbo build 2>&1 | tail -50 > /tmp/build-output.txt
BUILD_EXIT=$?

if [ "$BUILD_EXIT" -eq 0 ]; then
  log "Local build passed — CI issue might be env-related"
  # Check if it was a missing script or env issue
  if grep -q "Missing script" /tmp/ci-errors.txt; then
    log "CI failed due to missing script — check ci.yml"
  fi
  exit 0
fi

# 7. Build failed locally too — invoke Claude Code CLI to fix
log "Local build failed. Invoking Claude Code for auto-fix..."

claude --print "O CI do GitHub e o build local falharam na branch $BRANCH.

Erros do CI (em /tmp/ci-errors.txt):
$(cat /tmp/ci-errors.txt | grep -i 'error' | head -20)

Build output (em /tmp/build-output.txt):
$(cat /tmp/build-output.txt | tail -20)

TAREFA:
1. Ler os erros TypeScript
2. Corrigir APENAS os erros de compilação (tipos, imports, syntax)
3. NÃO alterar lógica de negócio
4. Rodar npx tsc --noEmit para verificar
5. Se passar, fazer git add + git commit + git push

Formato do commit: fix(ci): auto-fix TS compilation errors [automated]" 2>&1 | tee -a "$LOG"

# 8. Check if Claude pushed successfully
sleep 5
NEW_CONCLUSION=$(gh run list --branch "$BRANCH" --limit 1 --json conclusion,status -q '.[0].status' 2>/dev/null || echo "unknown")

if [ "$NEW_CONCLUSION" = "in_progress" ] || [ "$NEW_CONCLUSION" = "queued" ]; then
  log "New CI run triggered after fix. Waiting..."
  send_telegram "🔧 *CI Auto-Fix* tentativa $ATTEMPTS
Branch: \`$BRANCH\`
Claude Code aplicou correções. Novo CI rodando..."
else
  log "No new CI run detected. Fix may have failed."
fi

log "Auto-fix attempt $ATTEMPTS complete. Log: $LOG"
