# Backup sidecar image. Runs the pg_dump → gzip → aws s3 cp pipeline on a
# cron schedule (default hourly) and the periodic restore drill.
#
# Base is postgres:16-alpine because `pg_dump` must be version-compatible
# with the source database; using the same image tag as the primary
# postgres service guarantees version alignment forever (the compose file
# pins both).
#
# Adds:
#   - `aws` CLI v2 (for S3-compatible upload / list)
#   - `dcron` (Alpine's cron implementation) — the base image has no cron
#   - `bash`, `curl` — used by backup.sh / restore-drill.sh
#   - `docker-cli` — restore-drill.sh spins an ephemeral postgres via
#     `docker run` from inside the sidecar; sidecar mounts the host
#     docker.sock in compose (documented tradeoff in ADR 0003).

FROM postgres:16-alpine

# Alpine's default shell is `ash`; the scripts use bash-only builtins.
RUN apk add --no-cache \
      bash \
      curl \
      dcron \
      tini \
      docker-cli \
      python3 \
      py3-pip \
    && pip3 install --no-cache-dir --break-system-packages awscli \
    && rm -rf /var/cache/apk/*

WORKDIR /opt/tasker/backups

COPY infra/backups/backup.sh /opt/tasker/backups/backup.sh
COPY infra/backups/restore-drill.sh /opt/tasker/backups/restore-drill.sh
RUN chmod +x /opt/tasker/backups/*.sh

# Crontab entries:
#   - Backup hourly at :17 to spread load off round-hour scrapes.
#   - Drill weekly on Sunday 04:17 UTC — off the deploy window and gives
#     a full week of restore evidence before it rotates.
# Both write stdout/stderr to container logs via /proc/1/fd/1.
RUN printf '%s\n' \
      '17 * * * * /opt/tasker/backups/backup.sh > /proc/1/fd/1 2>/proc/1/fd/2' \
      '17 4 * * 0 /opt/tasker/backups/restore-drill.sh > /proc/1/fd/1 2>/proc/1/fd/2' \
    > /etc/crontabs/root

# `tini` reaps zombie children left by cron-forked scripts (a common
# problem in cron-in-a-container). The `--` terminator hands the rest of
# the CMD to tini's exec path.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["crond", "-f", "-l", "2"]
