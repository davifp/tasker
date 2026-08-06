#!/usr/bin/env bash
# Idempotent Let's Encrypt bootstrap + renewal loop.
#
# Bootstrap sequence:
#   1. Nginx starts with a self-signed placeholder cert seeded by
#      infra/nginx/entrypoint/00-init-cert.sh.
#   2. This script (first run) detects the placeholder and forces a real
#      cert via HTTP-01, using nginx's already-live :80 as the webroot.
#   3. The nginx container is SIGHUP'd via the mounted docker socket so it
#      swaps the placeholder for the real cert without a restart.
# Subsequent daily runs: `certbot renew` acts only if the cert is within
# 30 days of expiry; the deploy-hook fires the same SIGHUP.
#
# Env:
#   LE_DOMAIN        — fully-qualified hostname (e.g. tasker.example.com)
#   LE_EMAIL         — Let's Encrypt account email for expiry notifications
#   NGINX_CONTAINER  — name of the nginx container to SIGHUP (default
#                      matches `docker compose` naming convention)
#   SKIP_SPLAY       — set to "1" to skip the anti-thundering-herd sleep
#                      (useful for the initial bootstrap on the host)
#
# Runbook: docs/adr/0001-oracle-always-free.md.

set -euo pipefail

: "${LE_DOMAIN:?LE_DOMAIN is required}"
: "${LE_EMAIL:?LE_EMAIL is required}"
NGINX_CONTAINER="${NGINX_CONTAINER:-tasker-nginx-1}"

LE_LIVE_DIR="/etc/letsencrypt/live/tasker"
WEBROOT="/var/www/certbot"

# Random splay up to 60 min so many machines on the same daily cron do not
# hit the LE ACME rate limits simultaneously. First-boot invocation from
# the compose entrypoint should export SKIP_SPLAY=1.
if [[ "${SKIP_SPLAY:-}" != "1" ]]; then
  sleep $((RANDOM % 3600))
fi

reload_nginx() {
  # Cross-container reload: the certbot compose service mounts the docker
  # socket read-only so it can send SIGHUP to nginx. If the socket is not
  # available (bare-metal cron path) we print a directive for the operator.
  if [[ -S /var/run/docker.sock ]]; then
    docker kill -s HUP "$NGINX_CONTAINER" 2>/dev/null || \
      echo "[$(date -u +%FT%TZ)] warn: could not SIGHUP $NGINX_CONTAINER — reload manually"
  else
    echo "[$(date -u +%FT%TZ)] docker socket unavailable — run 'docker compose exec nginx nginx -s reload' on the host"
  fi
}

# Detect the placeholder (self-signed, subject CN = 'tasker-placeholder')
# vs a real Let's Encrypt cert. Both live at the same path.
IS_PLACEHOLDER=0
if [[ -f "$LE_LIVE_DIR/fullchain.pem" ]]; then
  if openssl x509 -in "$LE_LIVE_DIR/fullchain.pem" -noout -subject 2>/dev/null | grep -q 'tasker-placeholder'; then
    IS_PLACEHOLDER=1
  fi
fi

if [[ $IS_PLACEHOLDER -eq 1 || ! -f "$LE_LIVE_DIR/fullchain.pem" ]]; then
  echo "[$(date -u +%FT%TZ)] No real cert on disk (placeholder or empty) — issuing initial cert for $LE_DOMAIN"
  # `--webroot` because nginx is up serving /var/www/certbot on :80 (thanks
  # to the placeholder cert that lets it boot). `--force-renewal` overwrites
  # the placeholder in place. `--cert-name tasker` keeps the on-disk path
  # stable across domain rotations.
  certbot certonly \
    --webroot -w "$WEBROOT" \
    --non-interactive --agree-tos \
    --email "$LE_EMAIL" \
    --cert-name tasker \
    --force-renewal \
    -d "$LE_DOMAIN"
  reload_nginx
else
  echo "[$(date -u +%FT%TZ)] Existing cert — running renewal check"
  # Deploy-hook fires only on actual renewal. Uses the same docker-socket
  # SIGHUP path as reload_nginx (kept inline so certbot exits with the hook
  # in its own error handling).
  certbot renew \
    --webroot -w "$WEBROOT" \
    --non-interactive \
    --deploy-hook "/bin/sh -c 'docker kill -s HUP $NGINX_CONTAINER 2>/dev/null || true'"
fi
