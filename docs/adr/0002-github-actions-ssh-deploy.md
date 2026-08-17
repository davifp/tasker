# ADR 0002 — GitHub Actions SSH deploy + rollback

## Status

Accepted (Task 8.0)

## Context

Task 7.0 landed the production compose stack (`infra/docker-compose.prod.yml`)
and ADR 0001 selected Oracle Cloud Always Free as the deploy target. Task 8.0
needs to answer: **how do we roll a new release to that single box, gate it
on health, and roll back without ceremony when something explodes?**

Constraints:

- **Single node**, no orchestrator. A blue/green or canary strategy would
  need a second replica and a load balancer we do not have on the 2 OCPU /
  12 GB Always Free envelope.
- **Zero long-lived secrets in the repo.** GHCR push must use OIDC, not a
  PAT. SSH access uses a dedicated deploy user with a hardware-limited
  authorized_keys entry.
- **Migrations must precede traffic.** A failed migration must never leave
  the previous release serving reads against a schema that no longer
  matches the running code.
- **Rollback must be a single click, not a git revert war-room.** The last
  N release tags on GHCR are the entire rollback surface.
- **PRD FR-6.3 + FR-6.4.**

## Decision

### Release publishing (`.github/workflows/release.yml`)

- Triggers on `release: published` and manual `workflow_dispatch` with a
  `tag` input (used for republishing forgotten tags, never for deploying).
- Uses `docker/setup-qemu-action` + `docker/setup-buildx-action` to build
  and push **multi-arch** (`linux/amd64` + `linux/arm64`) images for
  `api`, `worker`, and `web` in a `matrix` job. arm64 is required by the
  Ampere A1 target; amd64 keeps local Docker Desktop compatible.
- Publishes to `ghcr.io/${owner}/tasker-{api,worker,web}` with two tags per
  build: the release tag (e.g. `v1.4.2`) and `latest`.
- Authenticates to GHCR with the OIDC-issued `GITHUB_TOKEN`
  (`permissions.packages: write`), so no long-lived PAT is stored on the
  repo. Push URL and OIDC audience are baked into `docker/login-action`.
- A follow-on `upload-sentry-sourcemaps` job builds `web` and `api` with
  `SENTRY_AUTH_TOKEN` set in-env, so `withSentryConfig` uploads client
  bundles inline; then uses `@sentry/cli` to push backend `dist/*.js.map`
  files under `dist: api` and `dist: worker` for the same release id.
- A post-build **manifest verification** step calls `docker buildx
imagetools inspect` and asserts both `linux/amd64` and `linux/arm64`
  appear in the published manifest. This closes the classic buildx failure
  mode where one platform silently drops out and is only noticed at
  deploy time on the Ampere box.

### Deploy (`.github/workflows/deploy.yml`)

- Triggers on `workflow_run: Release completed` **and**
  `workflow_dispatch` with a `tag` input (the rollback lever).
- Serialised via `concurrency: deploy-production` so two concurrent
  deploys cannot race on `prisma migrate deploy`.
- SSHes into the box using `SSH_DEPLOY_KEY` and executes
  `infra/scripts/deploy.sh`. The script owns the migrate-first ordering
  and the readiness gate. See the "Deploy script contract" section below.
- **Snapshots the previously-deployed tag** from
  `${DEPLOY_PATH}/.deployed_tag` BEFORE running the deploy. On failure,
  the workflow re-invokes itself via `gh workflow run deploy.yml
--field tag=<previous>` — the same code path as a human-triggered
  rollback, so the audit trail is identical.
- **Auto-rollback fires only when a previous tag exists** and it is not
  the same tag we tried to deploy — this avoids an infinite bounce when a
  clean tag is genuinely broken on both attempts.
- Records the newly-deployed tag to `${DEPLOY_PATH}/.deployed_tag`
  **after** the readiness gate passes. A failed deploy never poisons the
  rollback pointer.
- `environment: production` binds to a GitHub Environment gate — required
  reviewers, deployment history, and secret scoping all live in the
  Environment UI, keeping the workflow file itself free of policy.

### Deploy script contract (`infra/scripts/deploy.sh`)

Five phases, in this exact order (deviation from any is a deploy bug):

1. **`docker compose pull` api/worker/web** for the target `TAG`. GHCR
   miss → exit 2, previous containers untouched.
2. **`docker compose run --rm --entrypoint '' api pnpm prisma migrate deploy`**
   — a throwaway container against the current datastore. Failure →
   exit 3, previous containers untouched. This is the "migrations run as
   an explicit release step before the new version serves traffic"
   requirement (FR-6.3).
3. **`docker compose up -d --no-deps --pull always api worker web`** —
   replaces only the app services, leaves postgres/redis/tempo/prometheus/
   grafana untouched.
4. **Readiness gate** — polls `${READINESS_URL}` (default
   `/api/v1/health/readiness`) at `READINESS_POLL_SECS` (5 s) intervals
   for up to `READINESS_TIMEOUT_SECS` (180 s). Non-200 → exit 4; the new
   containers are still running but the workflow's failure branch fires
   auto-rollback.
5. **`docker image prune -f`** — dangling only. Never `system prune -a`
   because the previous release image is our fastest rollback path.

Idempotent: rerunning with an already-live `TAG` is safe and near-zero
cost (compose detects no diff). This is what makes rollback trivial —
re-running deploy with the previous tag _is_ the rollback.

### Rollback (`infra/scripts/rollback.sh`)

A three-line wrapper around `deploy.sh` that exists so operators have a
single, obvious verb to reach for on the box. The CI rollback path does
not use it — it dispatches `deploy.yml` with the previous tag instead,
keeping the entire audit trail inside GitHub Actions.

## Deploy user + sudo policy (on the box)

Runs alongside ADR 0001's provisioning. Executed once per box.

```bash
# 1. Create the deploy user (no login shell, no password).
sudo useradd --system --shell /usr/sbin/nologin --home-dir /home/deploy --create-home deploy
sudo usermod --shell /bin/bash deploy  # only re-enable shell for SSH exec
sudo usermod -aG docker deploy

# 2. Authorized keys — one entry, forced command optional.
sudo -u deploy mkdir -p /home/deploy/.ssh
sudo -u deploy tee /home/deploy/.ssh/authorized_keys > /dev/null <<'EOF'
# GitHub Actions SSH_DEPLOY_KEY public half. Restrict source IPs to the
# GitHub Actions ranges if paranoia > convenience; ranges rotate.
ssh-ed25519 AAAA... deploy@github-actions
EOF
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# 3. Minimal sudoers policy — deploy may only execute the deploy script
#    and the rollback wrapper, non-interactively.
sudo tee /etc/sudoers.d/deploy > /dev/null <<'EOF'
deploy ALL=(root) NOPASSWD: /home/deploy/tasker/infra/scripts/deploy.sh
deploy ALL=(root) NOPASSWD: /home/deploy/tasker/infra/scripts/rollback.sh
EOF
sudo chmod 440 /etc/sudoers.d/deploy
sudo visudo -c  # validate

# 4. First-time layout on the box.
sudo -u deploy mkdir -p /home/deploy/tasker/infra
```

`DEPLOY_PATH` in the workflow points at `/home/deploy/tasker`. Everything
under it (`docker-compose.prod.yml`, `infra/nginx/*`, `infra/scripts/*`,
`.deployed_tag`) is owned by `deploy:deploy`.

## Rollback drill (verification)

Every quarter, execute the following against the production tenancy and
paste the outcome under the "Rollback drills" section at the bottom of
this ADR:

1. Note the currently-deployed tag: `ssh deploy@$HOST cat /home/deploy/tasker/.deployed_tag`.
2. Cut a synthetic release with a deliberately failing Prisma migration
   (e.g. `ALTER TABLE "User" ADD CONSTRAINT never DEFERRABLE`).
3. Kick `deploy.yml` for the synthetic tag. Expect:
   - Migration step exits non-zero.
   - New app containers were never started (`docker ps` shows the
     previous image running).
   - Auto-rollback re-invokes the workflow with the previous tag.
   - Second run redeploys the previous tag idempotently (no-op).
4. Confirm `.deployed_tag` on the box is unchanged.
5. Delete the synthetic release + tag on GitHub.

Log outcome (date, operator, notes) below.

### Rollback drills

- **2026-08-17** — Local dry-run only. Workflow shipped; live drill deferred until Oracle A1 tenancy is provisioned (author is currently on the Always Free capacity wait-list). Deploy/rollback scripts unit-tested in `infra/scripts/deploy.spec.ts`; readiness-gate + rollback path exercised locally with `docker compose` on the developer box. First production drill will be logged here after the box comes online.

## Alternatives considered

- **`docker-compose rolling` / Kubernetes.** k8s control-plane RAM alone
  breaks ADR 0001's memory envelope. `docker service update --rolling` is
  Swarm-only and abandoned.
- **Watchtower auto-pull on `:latest`.** Unauditable, migrations happen
  concurrently with traffic switch, no rollback control. Rejected on
  every count.
- **Fly.io deploy from CI.** Different deploy target, would abandon
  ADR 0001. Kept in reserve as the "if Oracle A1 evaporates" contingency
  — the multi-arch images make it a drop-in.
- **Ansible / Terraform.** Overkill for one host, one compose file. The
  deploy is ~30 shell lines; hiding it behind an IaC abstraction would
  make troubleshooting harder without buying anything.
- **Rebuild on the box (`git pull && docker build`).** Wastes A1 CPU on
  every deploy, blocks readiness on 5-minute buildx runs, and loses the
  guarantee that "the image that passed CI is the image that runs in
  prod". Rejected.

## Consequences

- **Deploy is boring.** Cut a release tag → workflow runs → box is up on
  the new tag in ~2 minutes.
- **Rollback is one manual click** (`workflow_dispatch` with the
  previous tag) or automatic on readiness failure.
- **Migrations are the only place we can lock ourselves out.** A
  destructive irreversible migration is unrecoverable via rollback alone
  — that's a Prisma review issue, not a deploy pipeline issue.
- **`SSH_DEPLOY_KEY` is a high-value secret.** Rotate quarterly. If it
  leaks: revoke on the box (`~deploy/.ssh/authorized_keys`) and delete
  the GitHub secret in the same minute.
- **`.deployed_tag` on the box is the source of truth for what's live.**
  It is written by the workflow after every successful deploy; do not
  hand-edit.
