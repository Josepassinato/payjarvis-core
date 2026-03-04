#!/bin/bash
set -e

# ═══════════════════════════════════════════════════
# PayJarvis — Aplicar config Nginx na VPS
# Executar DENTRO da VPS: bash apply-nginx.sh
# ═══════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()  { echo -e "${GREEN}[✓]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; }
log() { echo -e "${CYAN}[PayJarvis]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── ETAPA 1: Verificar SSL ───
log "Verificando certificados SSL..."
if [ ! -f /etc/letsencrypt/live/payjarvis.com/fullchain.pem ]; then
    err "Certificado SSL não encontrado em /etc/letsencrypt/live/payjarvis.com/"
    err "Execute: certbot certonly --nginx -d payjarvis.com -d www.payjarvis.com"
    exit 1
fi
ok "Certificados SSL encontrados"

# ─── ETAPA 2: Remover payjarvis.com do noVNC ───
log "Removendo payjarvis.com do config noVNC..."
NOVNC_CONF=""
for f in /etc/nginx/sites-enabled/novnc /etc/nginx/sites-available/novnc /etc/nginx/conf.d/novnc.conf; do
    if [ -f "$f" ]; then
        NOVNC_CONF="$f"
        break
    fi
done

if [ -n "$NOVNC_CONF" ]; then
    log "Config noVNC encontrado: $NOVNC_CONF"
    # Backup
    cp "$NOVNC_CONF" "${NOVNC_CONF}.bak.$(date +%s)"
    ok "Backup criado"

    # Remover payjarvis.com e www.payjarvis.com do server_name
    sed -i 's/payjarvis\.com//g' "$NOVNC_CONF"
    sed -i 's/www\.payjarvis\.com//g' "$NOVNC_CONF"
    # Limpar espaços duplos no server_name
    sed -i 's/server_name  */server_name /g' "$NOVNC_CONF"
    sed -i 's/server_name ;/server_name _;/' "$NOVNC_CONF"
    ok "payjarvis.com removido do noVNC config"
else
    log "Config noVNC não encontrado — continuando"
fi

# ─── ETAPA 3: Instalar config PayJarvis ───
log "Instalando config PayJarvis..."
cp "$SCRIPT_DIR/sites-available/payjarvis" /etc/nginx/sites-available/payjarvis
ok "Config copiado para /etc/nginx/sites-available/payjarvis"

# ─── ETAPA 4: Ativar site ───
ln -sf /etc/nginx/sites-available/payjarvis /etc/nginx/sites-enabled/payjarvis
ok "Symlink criado em sites-enabled"

# Remover config antigo do conf.d se existir
rm -f /etc/nginx/conf.d/payjarvis.conf 2>/dev/null && log "Removido conf.d/payjarvis.conf antigo" || true

# ─── ETAPA 5: Testar e recarregar ───
log "Testando configuração Nginx..."
if nginx -t 2>&1; then
    ok "Config Nginx válida"
    systemctl reload nginx
    ok "Nginx recarregado"
else
    err "Config Nginx inválida!"
    exit 1
fi

# ─── ETAPA 6: Verificar ───
echo ""
log "═══ Verificação ═══"
sleep 2

echo -n "API health:  "
curl -sk https://payjarvis.com/api/health 2>&1 || echo "FALHOU"

echo ""
echo -n "Dashboard:   "
curl -sk -o /dev/null -w "HTTP %{http_code}" https://payjarvis.com 2>&1 || echo "FALHOU"

echo ""
echo -n "JWKS:        "
curl -sk https://payjarvis.com/.well-known/jwks.json 2>&1 | head -c 80 || echo "FALHOU"

echo ""
echo ""
ok "Config aplicado! payjarvis.com agora serve o PayJarvis"
