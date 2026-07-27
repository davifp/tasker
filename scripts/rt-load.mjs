#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Local realtime load smoke — opens N concurrent Socket.IO clients against a
 * running API, waits for every client to connect and join a shared room,
 * emits a broadcast event, and reports the P95 client-observed latency.
 *
 * Run against a stack booted via `pnpm --filter api dev` (or the multi-node
 * docker-compose profile). Not wired into CI: the intent is to run this on
 * a developer laptop before a release to catch adapter or serialisation
 * regressions.
 *
 * Usage:
 *   node scripts/rt-load.mjs \
 *     --api http://localhost:3001 \
 *     --token <bearer-jwt> \
 *     --workspace <workspaceId> \
 *     --clients 100
 *
 * The bearer JWT + workspaceId can be lifted from a browser session
 * (see the `Authorization` header on any /api/v1 request after logging in).
 */

import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

// socket.io-client only lives inside the frontend workspace under pnpm's
// isolated node_modules — resolve it from there so this script doesn't
// require a repo-level dependency change.
const require = createRequire(new URL('../frontend/', import.meta.url));
const { io } = require('socket.io-client');

function parseArgs(argv) {
  const out = { clients: 100, workspace: null, api: null, token: null, timeoutMs: 30_000 };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--api':
        out.api = value;
        i++;
        break;
      case '--token':
        out.token = value;
        i++;
        break;
      case '--workspace':
        out.workspace = value;
        i++;
        break;
      case '--clients':
        out.clients = Number(value);
        i++;
        break;
      case '--timeout-ms':
        out.timeoutMs = Number(value);
        i++;
        break;
      default:
        break;
    }
  }
  if (!out.api || !out.token || !out.workspace) {
    console.error('Missing required flags: --api --token --workspace');
    process.exit(2);
  }
  return out;
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((sortedMs.length * p) / 100));
  return sortedMs[idx];
}

async function fetchTicket(api, token) {
  const response = await fetch(`${api}/api/v1/realtime/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    throw new Error(`ticket fetch failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).ticket;
}

async function main() {
  const args = parseArgs(process.argv);
  const sockets = [];
  const latencies = [];
  const errors = { connect: 0, timeout: 0 };

  console.log(
    `rt-load: opening ${args.clients} clients against ${args.api} (workspace=${args.workspace})`,
  );

  const openedAt = performance.now();
  for (let i = 0; i < args.clients; i++) {
    // Each socket needs its own ticket — tickets are single-use.
    const ticket = await fetchTicket(args.api, args.token).catch(() => null);
    if (!ticket) {
      errors.connect++;
      continue;
    }
    const socket = io(args.api, {
      transports: ['websocket'],
      auth: { ticket, workspaceId: args.workspace },
      reconnection: false,
    });
    sockets.push(socket);
  }

  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            errors.timeout++;
            resolve();
          }, args.timeoutMs);
          socket.once('connect', () => {
            clearTimeout(timer);
            resolve();
          });
          socket.once('connect_error', () => {
            clearTimeout(timer);
            errors.connect++;
            resolve();
          });
        }),
    ),
  );

  const connected = sockets.filter((s) => s.connected).length;
  console.log(
    `rt-load: ${connected}/${args.clients} connected in ${Math.round(performance.now() - openedAt)}ms`,
  );

  // Trigger a broadcast: the API instance emits a `test.ping` to every
  // socket in the workspace room. Time-stamp every arrival relative to the
  // POST that fired it.
  const emittedAt = performance.now();
  const arrivals = sockets.map(
    (socket) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), args.timeoutMs);
        socket.once('test.ping', () => {
          clearTimeout(t);
          resolve(performance.now() - emittedAt);
        });
      }),
  );
  const trigger = await fetch(`${args.api}/api/v1/realtime/ping`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!trigger.ok) {
    console.error(`ping trigger failed: ${trigger.status}`);
    process.exit(1);
  }

  const observed = (await Promise.all(arrivals)).filter((v) => v !== null);
  observed.sort((a, b) => a - b);
  latencies.push(...observed);

  for (const socket of sockets) socket.close();

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  console.log(
    `rt-load: arrivals=${latencies.length}/${sockets.length}  p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  p99=${p99.toFixed(1)}ms`,
  );
  console.log(`rt-load: errors  connect=${errors.connect}  timeout=${errors.timeout}`);

  // SLO gate — matches the 500 ms target from the techspec.
  const slo = Number(process.env.RT_LOAD_P95_SLO_MS ?? 500);
  if (p95 > slo) {
    console.error(`rt-load: FAIL — p95 ${p95.toFixed(1)}ms exceeded SLO ${slo}ms`);
    process.exit(1);
  }
  console.log('rt-load: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
