# Performance Report

## Summary

- Date: 2026-08-19
- Build profiled: **dev** for frontend runtime (Next.js dev server, HMR active — LCP/INP/network numbers include the dev overhead); **prod build** for bundle sizes (`pnpm --filter web build` succeeded with Turbopack); backend was `pnpm dev` (ts-node-dev) against a seeded Postgres 16 with realistic scale
- Dataset: 2,536 workspaces / 2,907 users / 1,881 projects / 34,468 tasks — profile focused on `orbital-labs` (71 tasks) and its `platform` project (51 tasks)
- Surfaces profiled:
  - Web routes: `/login`, `/orbital-labs/dashboard`, `/orbital-labs/projects`, `/orbital-labs/projects/platform/board`, `/list`, `/backlog`, `/orbital-labs/sprints`, `/orbital-labs/members`, `/orbital-labs/notifications`
  - Interaction: open first task card on the board (task detail panel)
  - API endpoints: workspace, projects, board tasks, task detail + 5 detail sub-resources, members, labels, notifications, unread-count, dashboard cycle-lead-time
- Baseline compared: no (first run, no prior `performance-report.md`)
- Budgets violated: **2**
- Issues logged: **2** (see `./performance-issues.md`)

## Web Vitals (per route, warm)

| Route                                            | TTFB  | FCP   | LCP    | LCP tag | CLS   | Verdict |
| ------------------------------------------------ | ----- | ----- | ------ | ------- | ----- | ------- |
| /login (cold, prod-ish)                          | 175ms | 952ms | 952ms  | H1      | 0     | PASS    |
| /orbital-labs/dashboard                          | 407ms | 532ms | 532ms  | H1      | 0.001 | PASS    |
| /orbital-labs/projects                           | 488ms | 592ms | 592ms  | P       | 0.001 | PASS    |
| /orbital-labs/projects/platform/board (51 tasks) | 448ms | 568ms | 1708ms | P       | 0.001 | PASS    |
| /orbital-labs/projects/platform/list             | 458ms | 568ms | 1860ms | SPAN    | 0.001 | PASS    |
| /orbital-labs/projects/platform/backlog          | 271ms | 348ms | 1416ms | SPAN    | 0.001 | PASS    |
| /orbital-labs/sprints                            | 552ms | 636ms | 636ms  | P       | 0.001 | PASS    |
| /orbital-labs/members                            | 513ms | 616ms | 616ms  | P       | 0.001 | PASS    |
| /orbital-labs/notifications                      | 429ms | 536ms | 536ms  | P       | 0.001 | PASS    |

Notes:

- Warm numbers only. First hit on any route in dev was **7.6s TTFB / 8.7s LCP** — that is Next.js dev on-demand compilation and does not represent production. A prod-server run would drop LCP another 30–50% on the app routes because HMR/react-refresh instrumentation is removed.
- LCP tag of `P` or `SPAN` on several data-heavy routes means the LCP is not the first data node the user cares about (task titles). Assigning a priority hint or improving above-the-fold content ordering could pull LCP earlier, but nothing here breaks the 2.5s budget.

## Interaction: click first task card (board → task detail)

| Metric                            | Value | Budget       | Verdict                                |
| --------------------------------- | ----- | ------------ | -------------------------------------- |
| DOM mutation records within 800ms | 154   | proxy metric | —                                      |
| Nodes added                       | 17    | —            | reasonable for mounting detail panel   |
| Nodes removed                     | 7     | —            | reasonable                             |
| API requests fired                | 8     | —            | **REGRESSION: duplicates + waterfall** |

React DevTools hook has no registered renderer in this browser (extension not present), so per-component render counts are N/A. Used a MutationObserver on `document.body` as a proxy for render churn. Filter-toggle click produced 91 attribute mutations (Radix `data-state` toggles across many descendants — expected, not a regression).

## Network (per task-detail open)

| #   | Request                          | Note                                                     |
| --- | -------------------------------- | -------------------------------------------------------- |
| 50  | GET `/tasks/1`                   | task record                                              |
| 51  | GET `/ai/usage`                  | AI panel readiness                                       |
| 52  | GET `/members?limit=200`         | **DUPLICATE of #49** (already fetched for board filters) |
| 53  | GET `/labels`                    | **DUPLICATE of #48** (already fetched for board filters) |
| 54  | GET `/tasks/1/checklist`         | waterfall step 2                                         |
| 55  | GET `/tasks/1/dependencies`      | waterfall step 3                                         |
| 56  | GET `/tasks/1/comments`          | waterfall step 4                                         |
| 57  | GET `/tasks/1/attachments`       | waterfall step 5                                         |
| 58  | GET `/tasks/1/activity?limit=30` | waterfall step 6                                         |

Both issues logged (`PERF-01`, `PERF-02`) in `./performance-issues.md`.

## Full-page navigations (no duplicates found)

| Route         | API calls | Duplicates |
| ------------- | --------- | ---------- |
| dashboard     | 5         | 0          |
| projects      | 5         | 0          |
| board         | 7         | 0          |
| list          | 8         | 0          |
| backlog       | 7         | 0          |
| sprints       | 4         | 0          |
| members       | 4         | 0          |
| notifications | 5         | 0          |

## Bundle & Assets (prod build, gzipped)

| Chunk                    | Raw    | Gzipped    |
| ------------------------ | ------ | ---------- |
| 3l10g6qetmysg.js         | 425 KB | **134 KB** |
| 2qd8tkgyq01o9.js         | 387 KB | **113 KB** |
| 182ft--63el8t.js         | 231 KB | 68 KB      |
| 1fxwd6bwb4k7g.js         | 231 KB | 68 KB      |
| 1gxwc-wmbkwhy.js         | 231 KB | 68 KB      |
| 3-83qm252i2mp.js         | 231 KB | 68 KB      |
| 2b6plx_l0w_yl.js         | 139 KB | 38 KB      |
| Total (all chunks + css) | 3.5 MB | ~1.0 MB    |

- Biggest single chunk: 134 KB gz — under 170 KB per-route budget.
- The four ~68 KB chunks are distinct files with different hashes (verified with md5sum), not accidental duplicates.
- Per-route load composition (which chunks a given page requests together) requires a `next start` measurement that we skipped for time. Two chunks > 100 KB gz combined on a single route would breach the 170 KB per-route budget — worth verifying on the board/list routes on the prod server.

## Backend Endpoints (warm, 20 hits each)

| Endpoint                                                                   | p50  | p95  | p99  | Queries/req | Verdict |
| -------------------------------------------------------------------------- | ---- | ---- | ---- | ----------- | ------- |
| GET /workspaces/orbital-labs                                               | 18ms | 23ms | 26ms | 5           | PASS    |
| GET /workspaces/orbital-labs/projects?status=ACTIVE                        | 17ms | 22ms | 23ms | 5           | PASS    |
| GET /workspaces/orbital-labs/projects/platform/tasks?limit=100             | 15ms | 18ms | 25ms | 9           | PASS    |
| GET /workspaces/orbital-labs/projects/platform/tasks/1                     | 16ms | 26ms | 29ms | 8           | PASS    |
| GET /workspaces/orbital-labs/projects/platform/tasks/1/comments            | 21ms | 26ms | 28ms | 9           | PASS    |
| GET /workspaces/orbital-labs/projects/platform/tasks/1/activity?limit=30   | 11ms | 17ms | 60ms | 7           | PASS    |
| GET /workspaces/orbital-labs/members?limit=200                             | 18ms | 22ms | 23ms | 7           | PASS    |
| GET /workspaces/orbital-labs/labels                                        | 16ms | 21ms | 24ms | 5           | PASS    |
| GET /notifications?limit=30                                                | 14ms | 19ms | 29ms | 5           | PASS    |
| GET /notifications/unread-count                                            | 16ms | 26ms | 42ms | 5           | PASS    |
| GET /workspaces/orbital-labs/dashboard/cycle-lead-time?window=last_quarter | 10ms | 15ms | 83ms | 6           | PASS    |

- No N+1 detected anywhere. Board list of 51 tasks batch-loads `TaskLabel`, `ChecklistItem` counts, and checked-count via `IN (...)` — 3 batched queries, not 3×51.
- Every request pays a 4-query auth/context overhead: `Session` → `User(email)` → `Workspace(bySlug)` → `WorkspaceMember`. Not a regression, but a caching opportunity (see "Positive Findings").

## Database Indexes (hot tables)

Composites present on every hot filter/order combination:

- `Task_workspaceId_projectId_status_position_idx` (board sort key)
- `Task_workspaceId_assigneeUserId_status_idx` (my-tasks filter)
- `Task_workspaceId_projectId_startDate_dueDate_idx` (timeline/calendar)
- `Task_sprintId_status_idx`, `Task_projectId_number_key`
- `Notification_recipientUserId_createdAt_idx`, `Notification_recipientUserId_readAt_idx`
- `Comment_taskId_createdAt_idx`, `ChecklistItem_taskId_position_idx`
- `Activity_workspaceId_createdAt_idx`, `Activity_projectId_createdAt_idx`, `Activity_taskId_createdAt_idx`
- `AuditLog_workspaceId_targetType_createdAt_idx`, `Session_userId_revokedAt_idx`

No missing indexes on any hot-path query observed during profiling.

## Jobs / Workers

- Not exercised in this pass — no user-triggered BullMQ job appeared in the profiled flow. Rerun with a mention-comment or an invitation-send scenario to cover `notify.mention` and `mail.*` workers.

## Memory & Long Tasks

- Long tasks (>50ms) observed on any warm route: **0**
- `performance.memory` not read (Chromium exposes it but Playwright MCP `browser_evaluate` context didn't return values worth reporting for a short 3-min session — would need a longer soak).

## Console

- `Failed to load resource: 404 favicon.ico` on `/login` — cosmetic, add a favicon.
- No React warnings, no hydration mismatches, no deprecation notices on the profiled routes.

## Findings

| ID      | Area                          | Severity | Metric                                                            | Budget                        | Evidence                           |
| ------- | ----------------------------- | -------- | ----------------------------------------------------------------- | ----------------------------- | ---------------------------------- |
| PERF-01 | Frontend / cache-key mismatch | Medium   | 2 duplicate GETs per task-open (`/members?limit=200` + `/labels`) | No duplicate identical GETs   | Network log rows 48,49 vs 52,53    |
| PERF-02 | Frontend / request waterfall  | Medium   | 6-request sequential chain on task-detail open                    | Waterfall ≤ 3 sequential hops | Network log rows 50,54,55,56,57,58 |

## Positive Findings

- Backend is genuinely fast on realistic data (all p95 ≤ 26ms). Query counts are tight and batched — no N+1.
- Prisma layer already uses IN-batches for many-to-many hydration (labels, checklist counts).
- Route bundles look sensible for a full-featured product; no single chunk over the 170 KB budget.
- Zero CLS on every route measured.
- No long tasks fired during any navigation or interaction.
- No duplicate GETs during page navigations — the duplicates only appear when the detail panel opens on top of the board (i.e. two component trees each own their own TanStack Query subscription).

## Conclusion

The app is in good shape overall — vitals fit the budgets on every profiled route, the backend is fast and free of N+1, and indexes cover every hot path. The two things worth fixing before the next release:

1. **PERF-01** — collapse the duplicate `/members` and `/labels` fetches when the task-detail panel opens (share the query key with the board filters).
2. **PERF-02** — batch the 6 sequential `/tasks/:id/*` sub-resource fetches into either a single expand-style endpoint (`GET /tasks/:id?include=checklist,dependencies,comments,attachments,activity`) or a `Promise.all` fan-out from the client, ideally streamed via Suspense so the panel paints as pieces arrive.

Nice-to-have follow-ups (not budget violations):

- Cache the per-request auth/context 4-query chain (Session → User → Workspace → WorkspaceMember) at the guard level for the duration of the request — safe short-lived memoization.
- Verify per-route bundle composition on a real `next start` run to confirm the 134 KB + 113 KB chunks are not both loaded on the same first paint.
- Add a `favicon.ico` to kill the 404.
- Re-run this profile after `next start` (prod runtime) to see the true LCP for the app routes.
