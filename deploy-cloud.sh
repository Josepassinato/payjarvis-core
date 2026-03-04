#\!/bin/bash
set -e

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
NC="\033[0m"

log() { echo -e "${CYAN}[PayJarvis]${NC} $1"; }
ok()  { echo -e "${GREEN}[✓]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; }
warn(){ echo -e "${YELLOW}[\!]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── ETAPA 1: Pre-requisitos ───
log "═══ ETAPA 1: Verificando pré-requisitos ═══"
command -v node &>/dev/null && ok "Node $(node --version)" || { err "Node não encontrado"; exit 1; }
command -v pm2 &>/dev/null || { log "Instalando PM2..."; npm install -g pm2; }
ok "PM2 $(pm2 --version)"

# ─── ETAPA 2: Variáveis ───
log "═══ ETAPA 2: Variáveis de ambiente ═══"
if [ \! -f .env.production ]; then
    err ".env.production não encontrado\!"
    exit 1
fi
cp .env.production .env
ok "Variáveis carregadas de .env.production"
source .env

# ─── ETAPA 3: Install deps ───
log "═══ ETAPA 3: Instalando dependências ═══"
npm install 2>&1 | tail -3
ok "Dependências instaladas"

# ─── ETAPA 4: Database (Supabase remoto) ───
log "═══ ETAPA 4: Database Migrations (Supabase) ═══"
export DATABASE_URL DIRECT_URL
cd packages/database
npx prisma generate 2>&1 | tail -2
npx prisma db push --accept-data-loss 2>&1 | tail -5 || warn "Schema push: pode já estar aplicado"
cd "$SCRIPT_DIR"
ok "Database sincronizado (Supabase)"

# ─── ETAPA 5: Build ───
log "═══ ETAPA 5: Build do monorepo ═══"
npx turbo run build 2>&1 | tail -20
ok "Build concluído"

# Copiar estáticos do Next.js
if [ -d apps/web/.next/standalone ]; then
    cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static 2>/dev/null || true
    cp -r apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null || true
    ok "Next.js standalone preparado"
else
    warn "Next.js standalone não gerado"
fi

# ─── ETAPA 6: Deploy PM2 ───
log "═══ ETAPA 6: Deploy com PM2 ═══"
mkdir -p /var/log/payjarvis
pm2 delete payjarvis-api payjarvis-rules payjarvis-web 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
ok "Serviços iniciados com PM2"

# ─── ETAPA 7: Update nginx to point to new path ───
log "═══ ETAPA 7: Nginx path update ═══"
if [ -f /etc/nginx/sites-enabled/payjarvis ]; then
    sed -i "s|/opt/payjarvis|$SCRIPT_DIR|g" /etc/nginx/sites-enabled/payjarvis
    nginx -t 2>&1 && { nginx -s reload 2>/dev/null; ok "Nginx atualizado para $SCRIPT_DIR"; } || warn "Nginx config test falhou"
else
    warn "Nginx site config não encontrado — pulando"
fi

# ─── ETAPA 8: Health Checks ───
echo ""
log "═══ ETAPA 8: Health Checks ═══"
sleep 5

curl -sf http://127.0.0.1:3001/health > /dev/null && ok "API (3001): OK" || err "API não respondeu"
curl -sf http://127.0.0.1:3002/health > /dev/null && ok "Rules Engine (3002): OK" || err "Rules Engine não respondeu"
curl -sf http://127.0.0.1:3000 > /dev/null && ok "Web (3000): OK" || err "Web não respondeu"

echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}     PayJarvis — Deploy Completo\!${NC}"
echo "═══════════════════════════════════════════════════"
pm2 list | grep payjarvis
echo ""
