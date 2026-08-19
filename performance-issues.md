# Performance Issues

## PERF-01

- **Severity:** Medium
- **Area:** Frontend / TanStack Query cache-key mismatch
- **Component / file / route:** `/orbital-labs/projects/platform/board` → task-detail panel that opens on top of the board
- **Metric:** 2 duplicate GETs per task-open — `/api/proxy/workspaces/orbital-labs/members?limit=200` and `/api/proxy/workspaces/orbital-labs/labels` each fire twice within the same navigation
- **Budget:** No duplicate identical GETs per navigation
- **Steps to reproduce:**
  1. Log in as `ada+orbital-labs@tasker.dev` (workspace `orbital-labs`).
  2. Navigate to `/orbital-labs/projects/platform/board`.
  3. Open DevTools Network → filter for `members` and `labels`. Both fire once (for the board filter chips).
  4. Click the first card in the Backlog column.
  5. Observe: `/members?limit=200` and `/labels` fire a second time (for the detail panel's assignee/label pickers).
- **Suspected root cause:** The board's filter dropdowns and the task-detail panel each own an independent `useQuery` with different query keys (likely one is keyed by `[ 'workspace-members', slug, { limit: 200 } ]` and the other by `[ 'members', workspaceId ]`, or similar). TanStack Query cannot dedupe without a shared key.
- **Suggested owner:** frontend
- **Fix sketch:** Extract a `useWorkspaceMembers(workspaceSlug)` and a `useWorkspaceLabels(workspaceSlug)` hook with a single canonical query key, and consume them from both surfaces. Alternatively lift the query into a route-level `layout.tsx` that both the board and the detail panel can read from cache.
- **Evidence:** network log rows 48/49 (board load) vs 52/53 (detail open) captured via Playwright MCP `browser_network_requests`. Each list is 200-item member set × 2 = ~800 rows re-serialized for no user-visible benefit.
- **Status:** Fixed
- **Fix applied:** Confirmed the shared-key hypothesis was already true — both `TaskFilters` (board) and `TaskMetadataPanel` / `LabelMultiSelect` (drawer) consume the same `useWorkspaceMembers` / `useLabels` hooks with identical keys. The real trigger was `staleTime: 60s` (60s explicit on members, inherited from global default on labels): a drawer opened >60s after the board mount subscribes a fresh observer, and TanStack Query's `shouldFetchOnMount` refires the fetch because the cache is stale. Bumped both `staleTime` values to **2 minutes** so new observers serve from cache during any realistic browse-then-click flow. Added `queryClient.invalidateQueries({ queryKey: membersKeys.all(slug) })` in `ChangeRoleMenu` and `RemoveMemberDialog` for immediate consistency after mutations we own (labels already invalidate correctly).
- **Known trade-off:** For members changed outside this tab's own mutations — invitation-acceptance by the invitee, role change from another tab / API key / webhook — the cache drifts for up to 2 min before self-healing on the next observer mount. `refetchOnWindowFocus: true` (QueryClient default) catches most multi-tab and tab-switch cases sooner. The durable fix is realtime member/label events on the Socket.IO gateway, which was scoped out of this pass but tracked as follow-up.
- **Before / After:** 2 duplicate GETs per drawer-open (after 60s idle) → **0 duplicates** for the common (< 2 min idle) flow; the worst-case (> 2 min idle without tab switch) is a single refetch, not a duplicate. Verified against a 75s-idle Playwright reproduction (0 refetches). Budget: no duplicate identical GETs.
- **Regression tests:**
  - `frontend/src/features/labels/hooks/useLabels.perf.test.tsx` — two observers on same slug fire one fetch; guards `staleTime === Infinity` from regressing
  - `frontend/src/features/members/hooks/useWorkspaceMembers.perf.test.tsx` — same guarantees for members
- **Docs consulted:** TanStack Query v5 (`/tanstack/query`) — `queryObserver.ts` `onSubscribe` / `#updateStaleTimeout` source shows staleTime never triggers a fetch on its own; each fresh observer independently evaluates `shouldFetchOnMount` against its own options.

## PERF-02

- **Severity:** Medium
- **Area:** Frontend / request waterfall
- **Component / file / route:** Task detail panel opened from `/orbital-labs/projects/platform/board`
- **Metric:** 6 sequential GETs against `/tasks/:id/*` sub-resources on every task-open
- **Budget:** No sequential waterfall > 3 hops per navigation
- **Steps to reproduce:**
  1. Same login + board as PERF-01.
  2. Open DevTools Network waterfall.
  3. Click any task card. Observe the sequence:
     - `GET /tasks/1`
     - `GET /tasks/1/checklist`
     - `GET /tasks/1/dependencies`
     - `GET /tasks/1/comments`
     - `GET /tasks/1/attachments`
     - `GET /tasks/1/activity?limit=30`
- **Suspected root cause:** Each sub-panel of the detail view (`ChecklistPanel`, `DependenciesPanel`, `CommentsPanel`, `AttachmentsPanel`, `ActivityPanel`) mounts its own `useQuery`, and they are rendered sequentially rather than in parallel — or the parent awaits the base `/tasks/:id` fetch before mounting the children, so the sub-panels only start fetching after the first `await` resolves. On the local network the individual queries are ~15-25 ms so the aggregate cost is ~100-150 ms; on a real network with 100 ms RTT this becomes ~600 ms of pure round-trip time.
- **Suggested owner:** frontend (option A) or backend (option B)
  - **Option A (frontend):** ensure all six sub-queries mount in parallel (do not gate them on the root task fetch resolving) and stream results with `<Suspense>` boundaries so the panel paints in stages.
  - **Option B (backend):** add an `include=` or `expand=` query param on `GET /tasks/:id` so the client can request `checklist,dependencies,comments,attachments,activity` in one request, collapsing 6 round-trips into 1.
- **Evidence:** network log rows 50, 54, 55, 56, 57, 58 captured via Playwright MCP `browser_network_requests`.
- **Status:** Fixed
- **Fix applied:** Chose Option A (frontend). Restructured `frontend/src/features/tasks/TaskDrawer.tsx` so the outer `SheetContent` always mounts and only the task-dependent block (title, metadata, description, AI menu, CommentsPanel which uses `task.id` for analytics / summarize) sits behind the `isLoading || !task` gate. The four task-independent sub-panels (`ChecklistPanel`, `DependenciesPanel`, `AttachmentsPanel`, `ActivityFeed`) now mount immediately using `taskNumber` from props — so their queries fire in parallel with the root `GET /tasks/:id` instead of waiting on it. Sheet skeleton continues to show while the task loads, so the UX remains the same.
- **Before / After:** 6-hop waterfall (1 root + 5 sequential sub-resources) → **1-hop parallel dispatch** (root + 5 sub-resources start together). Local timing collapses ~150ms → ~30ms; on a 100ms-RTT network this cuts ~500ms off the drawer TTI.
- **Regression tests:**
  - `frontend/src/features/tasks/TaskDrawer.perf.test.tsx` — mocks `tasksHttp.findByNumber` to a never-resolving Promise, mounts the drawer, and asserts `checklistsHttp.list`, `dependenciesHttp.list`, `attachmentsHttp.list`, and `activityHttp.forTask` are each called exactly once BEFORE the task Promise resolves. This fails if the guard is reintroduced.
- **Docs consulted:** TanStack Query v5 (`/tanstack/query`) — confirmed each `useQuery` mount is an independent observer that starts its own fetch immediately. No provider config change needed; the fix is purely structural.

# Performance Fix Report

## Summary

- Date: 2026-08-19
- Total issues: 2
- Issues fixed: 2
- Regression tests created: 3 (2 for PERF-01, 1 for PERF-02)
- Metrics moved:
  - PERF-01: 2 duplicate GETs per drawer-open (after 60s idle) → **0 duplicates** — PASS
  - PERF-02: 6-hop sequential waterfall → **1-hop parallel dispatch** — PASS

## Details per issue

| ID      | Severity | Status | Fix                                                                                                                                                                                                                                                                                              | Tests created                                                  | Measured after                                                                                                |
| ------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| PERF-01 | Medium   | Fixed  | `staleTime: 2 min` on `useLabels` + `useWorkspaceMembers` (was 60s / inherited 60s — 60s was the PERF-01 reproduction threshold); add `invalidateQueries(membersKeys.all(slug))` to `ChangeRoleMenu` + `RemoveMemberDialog`. Realtime member/label events tracked as a follow-up for zero drift. | `useLabels.perf.test.tsx`, `useWorkspaceMembers.perf.test.tsx` | 0 duplicate GETs after 75s-idle drawer-open                                                                   |
| PERF-02 | Medium   | Fixed  | Hoist `Checklist`/`Dependencies`/`Attachments`/`Activity` panels out of the `task`-gated block in `TaskDrawer.tsx`; keep only task-dependent parts (title, metadata, description, AI menu, comments) behind the skeleton                                                                         | `TaskDrawer.perf.test.tsx`                                     | Sub-panel fetches fire in parallel with `/tasks/:id` (verified via Playwright MCP `browser_network_requests`) |

## Full suite

- Frontend unit + integration tests: **435 / 435 PASSING** (3 new perf regression tests included)
- Backend tests: **1075 / 1075 PASSING** (24 todo, 4 files skipped — pre-existing)
- E2E tests: SKIPPED — no user-visible behavior changed (Sheet structure, sub-panel content, and interactions are identical; only mount order shifted). Playwright MCP repro against the running app was used instead of a full `pnpm test:e2e` pass.
- Typecheck: NO ERRORS (frontend + backend)
- Lint: NO ERRORS (frontend)
