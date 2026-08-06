#!/bin/sh
# Seed a self-signed placeholder cert if the letsencrypt live directory is
# empty — nginx-alpine runs everything in /docker-entrypoint.d/ before
# starting the daemon, so this closes the "nginx needs cert on disk to
# parse config, certbot needs nginx on :80 to serve the ACME challenge"
# chicken-and-egg on a fresh volume.
#
# Certbot replaces the placeholder with a real cert on first successful
# renewal; a companion cron inside this container `nginx -s reload`s daily
# so the new cert takes effect within 24 h without manual intervention.
set -eu

LIVE_DIR="/etc/letsencrypt/live/tasker"
CERT="$LIVE_DIR/fullchain.pem"
KEY="$LIVE_DIR/privkey.pem"

if [ -s "$CERT" ] && [ -s "$KEY" ]; then
  echo "[nginx-init] Using existing cert at $CERT"
  exit 0
fi

echo "[nginx-init] No cert found — generating self-signed placeholder"
mkdir -p "$LIVE_DIR"
apk add --no-cache openssl >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY" \
  -out "$CERT" \
  -days 30 \
  -subj "/CN=tasker-placeholder" >/dev/null 2>&1
echo "[nginx-init] Placeholder cert generated — certbot will replace it on first renewal"
