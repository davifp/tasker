# Certbot with a bundled cron loop. Runs `certbot renew` daily at 03:00 UTC
# and reloads Nginx via a shared docker socket. Certs land in the
# `nginx_letsencrypt` named volume that Nginx mounts read-only.
FROM certbot/certbot:v3.0.1

# `dcron` is available in Alpine's base repo; the certbot image is Alpine-based.
RUN apk add --no-cache dcron bash docker-cli

COPY infra/scripts/certbot-renew.sh /usr/local/bin/certbot-renew.sh
RUN chmod +x /usr/local/bin/certbot-renew.sh

# Root crontab — runs the renewal script daily at 03:00 UTC. Randomised by a
# 60-minute sleep inside the script so many machines with the same schedule
# don't hit Let's Encrypt simultaneously.
RUN mkdir -p /etc/cron.d /var/log/cron && \
    echo '0 3 * * * /usr/local/bin/certbot-renew.sh >> /var/log/cron/renew.log 2>&1' > /etc/cron.d/renew && \
    crontab /etc/cron.d/renew

# Foreground the cron daemon so the container stays up. `-f` keeps stdout,
# `-l 8` sets log level to info.
ENTRYPOINT ["/bin/sh", "-c", "/usr/local/bin/certbot-renew.sh || true; crond -f -l 8"]
