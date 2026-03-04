#!/bin/bash
set -e

# ═══════════════════════════════════════════════════
# PayJarvis — SSL Setup com Let's Encrypt
# ═══════════════════════════════════════════════════

DOMAIN="${1:-payjarvis.com}"
EMAIL="${2:-admin@your-domain.com}"

echo "[PayJarvis] Configurando SSL para: $DOMAIN"

# Parar nginx temporariamente
docker compose stop nginx 2>/dev/null || true

# Obter certificado
docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# Habilitar SSL no nginx config
NGINX_CONF="infra/nginx/conf.d/payjarvis.conf"

# Descomentar bloco HTTPS
sed -i 's/# listen 443 ssl;/listen 443 ssl;/' "$NGINX_CONF"
sed -i 's/# ssl_certificate /ssl_certificate /' "$NGINX_CONF"
sed -i 's/# ssl_certificate_key /ssl_certificate_key /' "$NGINX_CONF"
sed -i 's/# ssl_protocols /ssl_protocols /' "$NGINX_CONF"
sed -i 's/# ssl_ciphers /ssl_ciphers /' "$NGINX_CONF"

# Atualizar domínio no certificado
sed -i "s/YOUR_VPS_HOSTNAME/$DOMAIN/g" "$NGINX_CONF"

# Reiniciar nginx
docker compose up -d nginx

echo "[✓] SSL configurado para https://$DOMAIN"
echo "[!] Atualize NEXT_PUBLIC_API_URL e WEB_URL em .env.production para usar https://"
