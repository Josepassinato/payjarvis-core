#!/bin/bash
# =============================================================================
# PayJarvis — Smoke Test Pós-Deploy
# Rodar OBRIGATORIAMENTE após cada deploy: bash scripts/smoke-test.sh
# =============================================================================

set -o pipefail

API="http://localhost:3001"
WEB="https://www.payjarvis.com"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\033[32m✅ $1\033[0m"; }
red()   { echo -e "\033[31m❌ $1\033[0m"; }
yellow(){ echo -e "\033[33m⚠️  $1\033[0m"; }

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    green "$name"
    ((PASS++))
  else
    red "$name"
    ((FAIL++))
  fi
}

check_warn() {
  local name="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    green "$name"
    ((PASS++))
  else
    yellow "$name (non-critical)"
    ((WARN++))
  fi
}

echo "=== PAYJARVIS SMOKE TEST PÓS-DEPLOY ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# ─── 1. API Health ───
echo "--- Core Services ---"
curl -sf "$API/health" | grep -q "ok" 2>/dev/null
check "API Health (/health)" "$?"

# ─── 2. PM2 Processes ───
pm2 pid payjarvis-api > /dev/null 2>&1 && [ "$(pm2 pid payjarvis-api)" != "" ]
check "PM2: payjarvis-api running" "$?"

pm2 pid openclaw > /dev/null 2>&1 && [ "$(pm2 pid openclaw)" != "" ]
check "PM2: openclaw running" "$?"

# ─── 3. WhatsApp Webhook ───
HTTP=$(curl -sf -X POST "$API/webhook/whatsapp" -d "test=1" -o /dev/null -w "%{http_code}" 2>/dev/null)
[ "$HTTP" = "200" ] || [ "$HTTP" = "400" ] || [ "$HTTP" = "403" ]
check "WhatsApp Webhook responds ($HTTP)" "$?"

# ─── 4. Web endpoints ───
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$API/api/web-chat/history" 2>/dev/null)
[ "$HTTP" = "401" ] || [ "$HTTP" = "403" ]
check "Web Chat endpoint (auth required → $HTTP)" "$?"

# ─── 5. Referral link generation test ───
# Test that the referral API endpoint exists
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$API/api/referrals/card?name=Test" 2>/dev/null)
[ "$HTTP" != "404" ]
check "Referral card endpoint exists ($HTTP)" "$?"

# ─── 6. Referral card script ───
CARD_TMP="/tmp/smoke_test_card_$$.png"
python3 /root/Payjarvis/scripts/generate_referral_card.py --name "Test" --lang pt --output "$CARD_TMP" 2>/dev/null && [ -f "$CARD_TMP" ] && [ "$(stat -c%s "$CARD_TMP" 2>/dev/null)" -gt 1000 ]
check "Referral card generation (Python script)" "$?"
rm -f "$CARD_TMP" 2>/dev/null

# ─── 7. QR Code library ───
(cd /root/Payjarvis && node -e "require('qrcode')") 2>/dev/null
check "QR Code library (qrcode)" "$?"

# ─── 8. Static files served ───
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$API/public/banners/" 2>/dev/null)
[ "$HTTP" != "404" ] && [ "$HTTP" != "502" ]
check_warn "Static file serving (/public/)" "$?"

# ─── 9. Voice TwiML ───
echo "--- Voice & Audio ---"
HTTP=$(curl -sf -X POST "$API/api/voice/twiml/test" -o /dev/null -w "%{http_code}" 2>/dev/null)
[ "$HTTP" != "502" ]
check_warn "Voice TwiML endpoint ($HTTP)" "$?"

# ─── 10. Production HTTPS ───
echo "--- Production HTTPS ---"
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$WEB" 2>/dev/null)
[ "$HTTP" = "200" ]
check "Production site HTTPS ($HTTP)" "$?"

HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$WEB/privacy" 2>/dev/null)
[ "$HTTP" = "200" ]
check "Privacy page ($HTTP)" "$?"

HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$WEB/terms" 2>/dev/null)
[ "$HTTP" = "200" ]
check "Terms page ($HTTP)" "$?"

# ─── 11. PWA manifest (served by Next.js on port 3000) ───
curl -sf "http://localhost:3000/manifest.json" 2>/dev/null | grep -q "Jarvis"
check_warn "PWA Manifest" "$?"

# ─── 12. Database connectivity (use API health as proxy — it connects on startup) ───
echo "--- Database ---"
# Source the .env file for DATABASE_URL
DB_URL=$(grep DATABASE_URL /root/Payjarvis/.env 2>/dev/null | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"')
if [ -n "$DB_URL" ]; then
  DATABASE_URL="$DB_URL" node -e "
const { PrismaClient } = require('/root/Payjarvis/node_modules/@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1\`.then(() => { console.log('OK'); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null | grep -q "OK"
  check "PostgreSQL connectivity" "$?"
else
  curl -sf "$API/health" 2>/dev/null | grep -q "ok"
  check "PostgreSQL connectivity (via API health)" "$?"
fi

# ─── 13. Redis ───
redis-cli ping 2>/dev/null | grep -q "PONG"
check "Redis connectivity" "$?"

# ─── 14. Recent errors check ───
echo "--- Error Check ---"
ERROR_COUNT=$(pm2 logs payjarvis-api --lines 50 --nostream 2>&1 | grep -ciE "uncaught|unhandled|fatal|ECONNREFUSED" || true)
ERROR_COUNT=$(echo "$ERROR_COUNT" | tr -d '[:space:]')
[ "${ERROR_COUNT:-0}" -eq 0 ] 2>/dev/null
check_warn "No fatal errors in recent API logs (${ERROR_COUNT:-0} found)" "$?"

OPENCLAW_ERRORS=$(pm2 logs openclaw --lines 50 --nostream 2>&1 | grep -ciE "uncaught|unhandled|fatal|ECONNREFUSED" || true)
OPENCLAW_ERRORS=$(echo "$OPENCLAW_ERRORS" | tr -d '[:space:]')
[ "${OPENCLAW_ERRORS:-0}" -eq 0 ] 2>/dev/null
check_warn "No fatal errors in recent OpenClaw logs (${OPENCLAW_ERRORS:-0} found)" "$?"

# ─── Results ───
echo ""
echo "========================================="
echo "  RESULTADO: $PASS passou, $FAIL falhou, $WARN warnings"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  red "⛔ $FAIL TESTES FALHARAM! Deploy NÃO está saudável."
  red "Investigar e corrigir ANTES de considerar deploy concluído."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo ""
  yellow "$WARN warnings não-críticos. Deploy funcional mas verificar."
  exit 0
else
  echo ""
  green "Todos os testes passaram! Deploy saudável."
  exit 0
fi
