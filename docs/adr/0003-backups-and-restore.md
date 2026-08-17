# ADR 0003 — Postgres backups + validated restore drill

## Status

Accepted (Task 9.0). First production drill deferred until Oracle A1
tenancy is provisioned — see the "Drill log" section below.

## Context

Task 8.0 landed the deploy pipeline; the next accident to plan for is a
Postgres corruption / accidental `DROP TABLE` / disk loss on the Ampere
A1 box. The single-node deploy has no replication, so **backups off-host
are the only recovery path**, and they are only credible if we regularly
prove we can restore them.

Constraints:

- **Off-host, on the free tier.** Backups must land in Oracle Object
  Storage (same Always Free tenancy — no second vendor to bill or audit).
- **Encrypted at rest** — Oracle OCS applies AES-256 by default, but the
  script forwards `--sse` so operators can force server-side headers
  explicitly for provider-independent auditability.
- **Restore drill is non-negotiable.** PRD FR-7.2 requires the restore
  procedure to have run against an isolated environment "at least once,
  outcome recorded." An untested backup is not a backup.
- **Alerting.** If backups silently stop, we lose the whole guarantee.
  Missing backup for > 26 h fires a Grafana alert (see ADR 0001 §
  Provisioning for oncall channel routing).

## Decision

### Pipeline (`infra/backups/backup.sh`)

`pg_dump --format=plain --clean --if-exists | gzip -9 | aws --endpoint-url $S3_ENDPOINT s3 cp -`.

Rationale for each flag:

- `--format=plain` — human-readable SQL. `--format=custom` would enable
  parallel restore, but the drill target is a single ephemeral
  container; the ~2× ingest speedup is worth less than the ability to
  eyeball the dump with `zless`.
- `--clean --if-exists` — the dump can be applied to a non-empty db
  without erroring on already-existing objects. Matches the drill
  contract.
- `--no-owner --no-privileges` — the drill container runs as `drill`,
  not `tasker`. Ownership metadata would break the restore.
- `gzip -9` — CPU is cheap on the Ampere A1; egress + storage cost more.
  ~4× compression on our schema.
- `aws s3 cp -` — streams stdin, no temp file. Keeps disk usage flat and
  lets us fail loud if pg_dump breaks mid-stream (via `pipefail`).

### Object key convention

```
s3://${BACKUP_BUCKET}/${BACKUP_ENV}/${YYYY}/${MM}/${DD}/tasker-${YYYYMMDDHHMM}.sql.gz
```

- Minute precision means an hourly cron can never collide with itself
  even under clock skew.
- Nested `/YYYY/MM/DD/` keeps `aws s3 ls` output paginated tolerably
  after months of retention.
- `${BACKUP_ENV}` prefix separates prod / staging / local drills in the
  same bucket without cross-namespace risk.

### Bucket lifecycle

30-day retention rule at the bucket level (Oracle Object Storage
Lifecycle Policy → Delete Objects after 30 days). Chosen over the
techspec's earlier "14 d + 4 weekly" because Oracle's Always Free
egress quota (10 TB/mo) makes weekly restore drills basically free —
we don't need to hoard old dumps as pseudo-versioning.

### Restore drill (`infra/backups/restore-drill.sh`)

Runs weekly on the `backup` sidecar (Sunday 04:17 UTC). Contract:

1. `aws s3 ls --recursive`, filter `.sql.gz`, sort, pick last → newest.
2. Download + `gunzip` to a temp path.
3. `docker run` an ephemeral `postgres:16-alpine` container (name
   `tasker-restore-drill-<ts>`).
4. `psql --set ON_ERROR_STOP=on` the dump inside the container.
5. Row-count sanity: `SELECT count(*) FROM {User,Workspace,Task,Project}`.
6. Append an entry to `backups/drill-YYYY-MM-DD.log` — one section per
   drill, with status + counts + source key.
7. Trap-cleanup: temp dir removed, ephemeral container `docker rm -f`ed.

Never runs against the production database. The ephemeral container has
no published port and shares no volume with prod.

### Metric + alerting

- **Metric.** `backup_last_success_timestamp_seconds` — a Gauge pushed
  to a Pushgateway sidecar (`prom/pushgateway`, ~50 MB RAM) after each
  successful upload. Labels: `env`.
- **Scrape.** New `pushgateway` scrape job in `infra/prometheus/
prometheus.yml` with `honor_labels: true` so the `env` label survives.
- **Alerts.** Two in `infra/grafana/alerts/platform.yaml`:
  - `BackupMissing` (severity: page) — fires when
    `time() - metric > 26 h`. 26 h leaves headroom for one skipped
    hourly cron without false-paging.
  - `BackupNeverObserved` (severity: ticket) — `absent()` guard for the
    fresh-deploy case where no series has ever been ingested.

## Integration points

### Oracle Object Storage — one-time setup

Runs from the OCI CLI on the same account as ADR 0001. Deferred in this
repo's history: Oracle A1 tenancy not yet provisioned as of 2026-08-17,
so this section is a runbook for the operator, not a "done" checkbox.

1. **Bucket.** Console → Storage → Buckets → Create.
   - Name: `tasker-backups`
   - Compartment: same as ADR 0001's `tasker` compartment.
   - Storage tier: Standard.
   - Auto-tiering: off (defeats predictability).
   - Object versioning: **enabled**. Cheap insurance if a bad script
     ever overwrites a good backup.
   - Encryption: OCI-managed key (default).
2. **Pre-authenticated request** — do NOT use one. Backups authenticate
   via a scoped IAM user (below) so the credential is revocable.
3. **IAM user.** Console → Identity → Users → Create.
   - Name: `tasker-backups-writer`
   - Group: `tasker-backups`
   - Policy on the compartment:
     ```
     Allow group tasker-backups to manage objects in compartment tasker
       where target.bucket.name='tasker-backups'
     Allow group tasker-backups to read buckets in compartment tasker
       where target.bucket.name='tasker-backups'
     ```
   - Generate a **Customer Secret Key** (this is the S3-compatible
     access-key/secret pair — NOT an OCI API key).
4. **Lifecycle rule.** Bucket → Lifecycle Rules → Create.
   - Action: **Delete**
   - Target: all objects
   - Days since creation: **30**
5. **S3-compatible endpoint** for `S3_ENDPOINT`:

   ```
   https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
   ```

   `<namespace>` is under Tenancy Details → Object Storage Namespace.

6. **GitHub Environment secrets** (used by `deploy.yml`'s rsync and by
   the box's `.env`):
   - `BACKUP_ACCESS_KEY_ID` — Customer Secret Key access-key half.
   - `BACKUP_SECRET_ACCESS_KEY` — Customer Secret Key secret half.
   - `BACKUP_S3_ENDPOINT` — the URL above.
   - `BACKUP_BUCKET` — `tasker-backups`.
   - `BACKUP_S3_REGION` — `sa-saopaulo-1` (matches ADR 0001).

### Local + CI drills (MinIO)

For local dev + CI, the same scripts point at the MinIO service already
running under `infra/docker-compose.yml`:

```
BACKUP_S3_ENDPOINT=http://minio:9000
BACKUP_S3_REGION=us-east-1
BACKUP_ACCESS_KEY_ID=minioadmin
BACKUP_SECRET_ACCESS_KEY=minioadmin
BACKUP_BUCKET=tasker-backups
BACKUP_ENV=local
```

MinIO has no lifecycle-policy engine that matches OCS 1:1, but for CI /
local drills it's not needed — the ephemeral runner throws away the
volume on teardown.

## Known risks

- **`/var/run/docker.sock` mounted read-write in the `backup` sidecar.**
  Needed because `restore-drill.sh` invokes `docker run` to stand up an
  ephemeral postgres. Any code that runs inside the sidecar has full
  API-level control of every container on the host. Acceptable for a
  single-tenant portfolio deploy where the only code in the sidecar is
  the two shipped shell scripts + `awscli` + `pg_dump`. **Would NOT be
  acceptable in a multi-tenant environment.** Reviewed and accepted per
  ADR 0001's tenancy model.
- **Pushgateway persistence.** The pushed metric is stored in a volume
  (`pushgateway_data`). If the volume is wiped, the "backup missing"
  alert loses its history; the `BackupNeverObserved` alert catches this
  fresh-slate case within 30 min.
- **Encryption at rest is provider-side.** Backups are treated as
  sensitive; anyone with the IAM credentials can read them. Rotate the
  Customer Secret Key quarterly.
- **`--format=plain` restore is single-threaded.** On a full production
  database this is slower than `--format=custom` + `pg_restore -j`. Add
  a second path later if restore time becomes a bottleneck; the drill
  currently completes on our seed dataset in under 20 s.

## Alternatives considered

- **`pg_basebackup` + WAL archiving.** Point-in-time recovery is the
  gold standard, but wal-e / wal-g needs a separate archive process
  co-tenant with postgres, plus an S3 upload pipeline that survives
  restarts. `pg_dump` hourly is simpler and its recovery window (1 h
  worst case) is acceptable for a portfolio-scale product.
- **Barman / pgBackRest.** Powerful but heavy on the 12 GB budget and
  overkill for our RTO/RPO.
- **`node_exporter` textfile collector for the freshness metric.** Adds
  another sidecar plus a shared volume for one value. Pushgateway is
  smaller and specifically designed for this cron-job pattern.

## Consequences

- **RPO ≤ 1 h** (hourly cron; if the tick fires and succeeds, we lose
  at most the previous hour of writes).
- **RTO ≈ (download + gunzip + psql) ≈ minutes on the seed dataset,
  minutes-to-tens-of-minutes at real production size**. Fast enough for
  a portfolio recovery.
- **Every backup is auditable via the object key** — the timestamp is
  literally in the filename.
- **A silent breakage of the cron / upload / pushgateway path pages
  within 26 h**, not "never."

## Drill log

Restore drills append to this file:

- **2026-08-17 — Local drill (MinIO)** — first end-to-end validation of
  `backup.sh` + `restore-drill.sh` executed against the local
  `infra/docker-compose.yml` MinIO service. Outcome: **PASS**. Full log
  in `backups/drill-2026-08-17.log`.
- **First production drill** — deferred; will be executed and logged
  here on the day Oracle A1 tenancy provisions.
