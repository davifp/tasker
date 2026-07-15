#!/usr/bin/env bash
set -euo pipefail

NETWORK="tasker_test_net"
API_IMAGE="tasker/api:dev"
WORKER_IMAGE="tasker/worker:dev"

cleanup() {
  docker rm -f tasker_api_test tasker_worker_test 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
}
trap cleanup EXIT

echo "→ Building api image..."
docker build -f infra/docker/api.Dockerfile -t "$API_IMAGE" .

echo "→ Building worker image..."
docker build -f infra/docker/worker.Dockerfile -t "$WORKER_IMAGE" .

echo "→ Creating test network..."
docker network create "$NETWORK"

echo "→ Starting api container..."
docker run -d --name tasker_api_test \
  --network "$NETWORK" \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgres://tasker:tasker@localhost:5432/tasker \
  -e REDIS_URL=redis://localhost:6379 \
  -p 13001:3001 \
  "$API_IMAGE"

echo "→ Waiting for api to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:13001/api/v1/health > /dev/null 2>&1; then
    echo "✓ API health check passed"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "✗ API health check timed out"
    docker logs tasker_api_test
    exit 1
  fi
  sleep 2
done

echo "→ Starting worker container..."
docker run -d --name tasker_worker_test \
  --network "$NETWORK" \
  -e NODE_ENV=development \
  "$WORKER_IMAGE"

sleep 3

echo "→ Checking worker boot log..."
if docker logs tasker_worker_test 2>&1 | grep -q "worker booted"; then
  echo "✓ Worker booted successfully"
else
  echo "✗ Worker boot log not found"
  docker logs tasker_worker_test
  exit 1
fi

echo ""
echo "All Docker build checks passed ✓"
