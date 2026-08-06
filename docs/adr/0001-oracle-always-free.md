# ADR 0001 — Oracle Always Free as the production target

## Status

Accepted (Task 7.0)

## Context

The Tasker portfolio deploy needs a public, always-on production target that
recruiters and automated evaluators can reach without cost to the author.
Constraints:

- **Budget**: $0/month steady state.
- **Latency**: primary audience in Brazil, but occasional traffic from any
  region — no distributed CDN in v1 (all traffic hits the origin directly).
- **Stack fit**: the container stack (Nginx + Postgres 16 + Redis 7 + API +
  worker + web + Tempo + Prometheus + Grafana + certbot) needs at minimum
  ~2 vCPU / 8 GB RAM to run without swap thrash.
- **Data residency**: nothing sensitive (public demo dataset only), so
  region choice is optimisation not compliance.

## Decision

Deploy on **Oracle Cloud Infrastructure Always Free** — a single
`VM.Standard.A1.Flex` instance (Ampere ARM64) sized at **2 OCPU / 12 GB
RAM** (the current Always Free ceiling as of mid-2026, halved from the
original 4/24 offering). Ubuntu 22.04 aarch64 for host OS.

Runbook lives in the ["Provisioning" section](#provisioning) below.

## Alternatives considered

- **DigitalOcean São Paulo droplet ($24/mo)** — instant provisioning, no
  capacity issues, but breaks the $0 budget constraint.
- **Hetzner Cloud CAX11 (€3.79/mo)** — better price/perf than A1 and
  reliably available, but Finland/Germany DC means +180 ms latency from
  Brazil. Acceptable for a demo, unnecessary if A1 works.
- **AWS Lightsail ($5/mo minimum)** — 2 GB RAM ceiling on the free tier is
  insufficient for the full observability stack.
- **Fly.io free tier** — 3× shared-cpu-1x with 256 MB each. Cannot run
  Postgres 16 in that budget.
- **Kubernetes (OKE, EKS-on-Fargate)** — control-plane overhead alone
  (~1.5 GB RAM / 0.5 OCPU) eats 15% of the box before the app boots.
  Single-node K8s adds operational overhead without HA benefits.

## Known limitations

- **A1 capacity is oversubscribed** in most regions (especially São Paulo);
  provisioning can take hours to weeks of retry-loop patience. See the
  retry recipe under [Provisioning](#provisioning).
- **7-day idle reclaim**: Always Free compute is stopped after ~7 days of
  low CPU + network activity. Once the app is deployed, any real traffic
  (Prometheus scraping every 15 s, health probes, real visitors) prevents
  this. Detected + documented; no code mitigation needed while the app
  serves traffic.
- **A1 shape ceiling was halved mid-2026** from 4/24 to 2/12; techspec
  and compose resource limits assume the new ceiling.
- **Region eligibility**: Always Free tier is tied to the account's home
  region chosen at signup. Resources in other regions bill at list price.

## Provisioning

### One-time OCI setup

1. **Sign up** at oracle.com/cloud/free/ — the free trial (US$300 for 30
   days) runs concurrently with the Always Free tier. Do NOT click
   "Upgrade to Pay As You Go" after trial ends unless you consciously
   want billed capacity.
2. **VCN** — Networking → Virtual Cloud Networks → _Start VCN Wizard_ →
   "Create VCN with Internet Connectivity". Defaults are fine.
3. **Security list** — add ingress rules for TCP :80 and :443 from
   `0.0.0.0/0`. SSH :22 is already open.
4. **DNS** — point an A record for the demo hostname (e.g.
   `tasker.example.com`) at the instance's reserved public IPv4.

### Launching the A1 instance

Because A1 capacity is scarce, script the launch in a retry loop. Run in a
`tmux` session so it survives disconnects:

```bash
COMPARTMENT_OCID="ocid1.tenancy.oc1..xxx"
AD_NAME="XXXX:SA-SAOPAULO-1-AD-1"
SUBNET_OCID="ocid1.subnet.oc1..xxx"
IMAGE_OCID="ocid1.image.oc1.sa-saopaulo-1..."  # Ubuntu 22.04 aarch64
SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"

until oci compute instance launch \
  --availability-domain "$AD_NAME" \
  --compartment-id "$COMPARTMENT_OCID" \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus":2,"memoryInGBs":12}' \
  --subnet-id "$SUBNET_OCID" \
  --image-id "$IMAGE_OCID" \
  --assign-public-ip true \
  --ssh-authorized-keys-file "$SSH_KEY_PATH" \
  --display-name "tasker-a1" \
  --wait-for-state RUNNING; do
  echo "Out of capacity at $(date) — retrying in 60s"
  sleep 60
done
```

### Post-boot host prep

Ubuntu ARM ships with a locked-down `iptables` — Oracle security lists
alone don't open :80/:443:

```bash
ssh ubuntu@<public-ip>
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent  # persists rules across reboot
```

Then install Docker + Compose plugin:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

### First deploy

1. Clone the repository and `cp .env.example .env` on the host.
2. Populate secrets in `.env`: `POSTGRES_PASSWORD`, `JWT_SECRET`,
   `RT_TICKET_SECRET`, `SESSION_COOKIE_SECRET`, `STORAGE_*`, Sentry DSNs,
   `LE_DOMAIN`, `LE_EMAIL`.
3. Bring up the whole stack. Nginx starts with a self-signed placeholder
   cert seeded by `infra/nginx/entrypoint/00-init-cert.sh` on an empty
   letsencrypt volume, so it can bind :80 and :443 immediately — no
   chicken-egg with certbot:
   ```bash
   docker compose -f infra/docker-compose.prod.yml up -d
   ```
4. Trigger the first real cert issuance (certbot's daily cron will do this
   automatically at 03:00 UTC, but you probably do not want to wait):
   ```bash
   docker compose -f infra/docker-compose.prod.yml exec \
     -e SKIP_SPLAY=1 certbot /usr/local/bin/certbot-renew.sh
   ```
   The script detects the placeholder, requests a real cert via HTTP-01
   through nginx, and SIGHUPs the nginx container via the mounted docker
   socket. Browsers see the trusted Let's Encrypt cert within ~30 s.
5. Verify: `curl -v https://<LE_DOMAIN>/api/v1/health/liveness` → 200 with
   `Verify return code: 0 (ok)` in the TLS handshake.

### Cost verification

Post-deploy, check **Governance → Cost Analysis** daily for the first
week. Any non-zero forecast → identify the SKU under **Billing → Usage
Reports**. Set a **Governance → Budgets** alarm at $1/month as a tripwire.

## Consequences

- **Cost**: $0/month steady state (confirmed by billing dashboard).
- **Latency**: Brazil users get ~30 ms to São Paulo AD-1. Non-Brazilian
  users pay 150–200 ms; acceptable for a demo.
- **Vendor lock**: none of consequence — the stack is standard
  Ubuntu + Docker + Compose, portable to any other VPS in an afternoon.
- **Ops burden**: A1 idle-reclaim is the only recurring surprise. Once
  Prometheus is scraping and the site serves any traffic, the risk is
  effectively zero.
