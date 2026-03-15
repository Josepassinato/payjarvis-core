#!/usr/bin/env bash
# PM2 wrapper for payjarvis-web
# Ensures static assets are in place BEFORE the Next.js server starts.
# This runs on every PM2 start/restart, solving the missing-CSS problem permanently.

set -euo pipefail

WEB="/root/Payjarvis/apps/web"
STANDALONE="$WEB/.next/standalone"
STANDALONE_WEB="$STANDALONE/apps/web"

# --- Copy .next/static ---
if [ -d "$WEB/.next/static" ]; then
  rm -rf "$STANDALONE_WEB/.next/static"
  cp -r "$WEB/.next/static" "$STANDALONE_WEB/.next/static"
fi

# --- Copy public/ (if exists) ---
if [ -d "$WEB/public" ]; then
  rm -rf "$STANDALONE_WEB/public"
  cp -r "$WEB/public" "$STANDALONE_WEB/public"
fi

echo "[start-web] Static assets synced at $(date '+%H:%M:%S')"

# --- Load .env.local (standalone mode doesn't auto-load it) ---
if [ -f "$WEB/.env.local" ]; then
  set -a
  source "$WEB/.env.local"
  set +a
  echo "[start-web] Loaded .env.local"
fi

# --- Start the server (exec replaces shell so PM2 manages the node process directly) ---
exec node "$STANDALONE_WEB/server.js"
