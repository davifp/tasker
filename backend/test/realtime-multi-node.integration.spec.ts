/**
 * Multi-node Socket.IO adapter integration test skeleton.
 *
 * Requires the docker-compose multi-node profile
 * (`infra/docker-compose.yml` + `infra/docker-compose.multi.yml`) to be up
 * before the suite runs. Both API nodes share the same Redis, so an event
 * emitted on node B should reach a socket.io client subscribed to node A
 * through `@socket.io/redis-adapter`.
 *
 * Full flow, to be filled in when the CI docker layer lands:
 *   1. Onboard a user via API_A_URL, capture the JWT.
 *   2. Fetch a realtime ticket from API_A_URL, connect a socket.io client
 *      to API_A_URL with { ticket, workspaceId }.
 *   3. Trigger a mutation on API_B_URL (e.g., PATCH /tasks/:id).
 *   4. Await the resulting `task.updated` event on the client — must arrive
 *      inside the 1 s realtime SLO.
 *   5. Repeat with the roles reversed (emit on A, subscribe on B).
 *
 * Skipped by default: `describe.skip` mirrors the pattern used by the other
 * integration skeletons in this folder (`metrics.integration`,
 * `roadmap.integration`, `sprints.integration`) — they all wait for a
 * dedicated Testcontainers/docker-compose runner.
 */
import { describe, it } from 'vitest';

describe.skip('Realtime multi-node adapter (integration)', () => {
  it.todo('event emitted on node B reaches a socket subscribed to node A');
  it.todo('event emitted on node A reaches a socket subscribed to node B');
  it.todo('killing node A drops its realtime_connections gauge without evicting node B clients');
  it.todo(
    'ticket redemption on node A cannot be replayed on node B (single-use across the cluster)',
  );
});
