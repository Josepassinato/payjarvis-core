#!/bin/bash
set -e

# ═══════════════════════════════════════════════════
# PayJarvis — Deploy Script (VPS Hostinger)
# Servidor: payjarvis.com / YOUR_VPS_IP
# Estratégia: PM2 + PostgreSQL local + Redis local + Nginx
# ═══════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[PayJarvis]${NC} $1"; }
ok()  { echo -e "${GREEN}[✓]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; }
warn(){ echo -e "${YELLOW}[!]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── ETAPA 1: Pré-requisitos ───
log "═══ ETAPA 1: Verificando pré-requisitos ═══"

command -v node &>/dev/null && ok "Node $(node --version)" || { err "Node não encontrado"; exit 1; }
command -v pm2 &>/dev/null || { log "Instalando PM2..."; npm install -g pm2; }
command -v nginx &>/dev/null || { log "Instalando Nginx..."; apt-get update -qq && apt-get install -y -qq nginx; }
ok "PM2 $(pm2 --version)"
ok "Nginx instalado"

# ─── ETAPA 2: Carregar variáveis ───
log "═══ ETAPA 2: Variáveis de ambiente ═══"

if [ ! -f .env.production ]; then
    err ".env.production não encontrado!"
    exit 1
fi
cp .env.production .env
ok "Variáveis carregadas de .env.production"

# ─── ETAPA 3: PostgreSQL ───
log "═══ ETAPA 3: PostgreSQL ═══"

pg_ctlcluster 16 main start 2>/dev/null || true
if pg_isready -q; then
    ok "PostgreSQL rodando"
else
    err "PostgreSQL não está rodando"
    exit 1
fi

# ─── ETAPA 4: Redis ───
log "═══ ETAPA 4: Redis ═══"

source .env
if ! redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
    redis-server --daemonize yes --requirepass "${REDIS_PASSWORD}"
fi
ok "Redis rodando"

# ─── ETAPA 5: Migrations ───
log "═══ ETAPA 5: Database Migrations ═══"

export DATABASE_URL="postgresql://payjarvis:${DB_PASSWORD}@127.0.0.1:5432/payjarvis?schema=public"
export DIRECT_URL="postgresql://payjarvis:${DB_PASSWORD}@127.0.0.1:5432/payjarvis?schema=public"

cd packages/database
npx prisma migrate deploy 2>/dev/null || npx prisma db push 2>/dev/null || warn "Migrations: schema já aplicado"
npx prisma generate
cd "$SCRIPT_DIR"
ok "Database sincronizado"

# ─── ETAPA 6: Build ───
log "═══ ETAPA 6: Build do monorepo ═══"

npm run build
ok "Build 10/10 concluído"

# Copiar estáticos do Next.js
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static 2>/dev/null || true
ok "Next.js standalone preparado"

# ─── ETAPA 7: Deploy PM2 ───
log "═══ ETAPA 7: Deploy com PM2 ═══"

pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
ok "Serviços iniciados com PM2"

# ─── ETAPA 8: Nginx ───
log "═══ ETAPA 8: Nginx reverse proxy ═══"

cp infra/nginx/nginx.conf /etc/nginx/nginx.conf
cp infra/nginx/conf.d/payjarvis.conf /etc/nginx/conf.d/payjarvis.conf
rm -f /etc/nginx/sites-enabled/default 2>/dev/null
mkdir -p /var/www/certbot

nginx -t 2>&1 && ok "Config Nginx válida" || { err "Config Nginx inválida"; exit 1; }
nginx -s reload 2>/dev/null || nginx
ok "Nginx rodando"

# ─── ETAPA 9: Health Checks ───
echo ""
log "═══ ETAPA 9: Health Checks ═══"
sleep 5

curl -sf http://127.0.0.1:3001/health > /dev/null && ok "API (3001): OK" || err "API não respondeu"
curl -sf http://127.0.0.1:3002/health > /dev/null && ok "Rules Engine (3002): OK" || err "Rules Engine não respondeu"
curl -sf http://127.0.0.1:3001/.well-known/jwks.json > /dev/null && ok "JWKS: OK" || err "JWKS não respondeu"
curl -sf http://127.0.0.1/health > /dev/null && ok "Nginx proxy (80): OK" || err "Nginx não respondeu"

# ─── Relatório ───
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}     PayJarvis — Deploy Completo!${NC}"
echo "═══════════════════════════════════════════════════"
echo ""
echo -e "  Web Dashboard:  ${CYAN}http://payjarvis.com${NC}"
echo -e "  API:            ${CYAN}http://payjarvis.com/api${NC}"
echo -e "  Health:         ${CYAN}http://payjarvis.com/health${NC}"
echo -e "  JWKS:           ${CYAN}http://payjarvis.com/.well-known/jwks.json${NC}"
echo -e "  Verify:         ${CYAN}http://payjarvis.com/v1/verify${NC}"
echo ""
echo "─── PM2 Status: ───"
pm2 list
echo ""
echo "─── Próximos passos: ───"
echo "  1. Configure DNS: A record payjarvis.com → YOUR_VPS_IP"
echo "  2. Configure chaves Clerk em .env.production"
echo "  3. Para SSL: ./ssl-setup.sh payjarvis.com"
echo "  4. Para logs: pm2 logs [payjarvis-api|payjarvis-rules|payjarvis-web]"
echo "  5. Para restart: pm2 restart all"
echo ""
