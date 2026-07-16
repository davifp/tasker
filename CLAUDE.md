# Skills → actions

Invoke the global Claude Code skills via `/<skill-name>` before implementing or reviewing.

| Skill                              | Trigger for…                                                                                                                                                                       | Do not use if…                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `code-standards-en`                | English names, PR, CQS, early return, method/class size                                                                                                                            | Policy requires localized identifiers                                              |
| `nodejs-typescript-conventions`    | Strict TS/Node, ESM, pnpm, async/await, no `any`                                                                                                                                   | Pure JS project or package manager ≠ pnpm                                          |
| `nestjs-best-practices`            | NestJS modules, DI, `WorkspaceGuard`/`RolesGuard`, interceptors (audit/activity), `ValidationPipe` + Zod, exception filters (Problem Details), Prisma multi-tenant                 | Module is not NestJS                                                               |
| `vercel-react-best-practices`      | React/Next.js App Router: RSC, Server Actions, streaming, data fetching with TanStack Query, bundle optimization, `next/image`, Suspense                                           | Does not use React/Next.js                                                          |
| `react-frontend-conventions`       | React FC, TSX, Tailwind, hooks, shadcn/ui, React Hook Form + Zod, TanStack Query, dnd-kit                                                                                          | Class components, styled-components, no Tailwind                                   |
| `next-dev-loop`                    | Validate Next.js runtime after editing code (`next dev` running) — confirm the change works in the browser, not just compiles                                                     | No `next dev` running or outside a Next.js app                                     |
| `ui-ux-pro-max`                    | UI design/review (components, pages, palettes, typography, landing/dashboard, a11y, charts with Recharts/Tremor); see `SKILL.md` for `scripts/search.py` and `--design-system`     | Backend/API/data-only task without UI; scope with no visual or UX decisions        |
| `claude-api`                       | `ai` module: Anthropic SDK, prompt caching per workspace, tool use, thinking, migration between versions (4.6 → 4.7), token/rate limit guardrails                                  | Code uses OpenAI SDK or another provider as default                                |
| `vitest-testing`                   | Vitest, `vi`, AAA, timers, HTTP integration, Testcontainers (Postgres/Redis) for repository and route tests                                                                        | Jest/Sinon as the main mocking stack                                               |
| `review`                           | Functional PR review (changes in the current branch)                                                                                                                               | Outside a PR flow                                                                  |
| `security-review`                  | Security review of the current branch: OWASP Top 10, CSRF, CSP, Markdown sanitization (DOMPurify), `pnpm audit`                                                                    | No changes with a security surface                                                 |

**Suggested order by task:**

- **NestJS backend (modules, use-cases, guards, Prisma)** → `nestjs-best-practices` → `nodejs-typescript-conventions` → `code-standards-en`. Tests → `vitest-testing`.
- **Next.js frontend (pages, features, components)** → `ui-ux-pro-max` (design/UX and visual system) → `vercel-react-best-practices` → `react-frontend-conventions` → `nodejs-typescript-conventions` → `code-standards-en`. After editing, run `next-dev-loop` to validate runtime.
- **Real time (Socket.IO gateway + events)** → `nestjs-best-practices` → `nodejs-typescript-conventions` → `vitest-testing`.
- **AI module (`ai`, Anthropic/OpenAI adapters)** → `claude-api` → `nestjs-best-practices` → `code-standards-en`. Tests → `vitest-testing` (mock the provider).
- **Public API / webhooks / integrations** → `nestjs-best-practices` → `nodejs-typescript-conventions` → `code-standards-en`.
- **Tests** → `vitest-testing` + skill of the layer under test. E2E → **E2E Tests (Playwright)** section below.
- **Review** → `review` (functional) → `security-review` (security).

# Plan Mode Persistence

<plan_file>`.codex/plans/[timestamp]-[plan-slug].md`</plan_file>

- **ABSOLUTELY MANDATORY**: In Plan mode, after the user accepts a plan, **ALWAYS** write the accepted plan to a Markdown file inside <plan_file>.
- **MANDATORY**: If the accepted plan is later updated, update or add the corresponding Markdown file in <plan_file>.

# Product architecture (quick reference)

Full details in `project_scope.md`. Keep these points in mind when working:

- **Backend**: NestJS + Prisma + PostgreSQL 16 + Redis 7 + BullMQ + Socket.IO. Clean Architecture layers (`domain/`, `application/`, `infrastructure/`, `presentation/`).
- **Frontend**: Next.js (App Router) + React + strict TS + Tailwind + shadcn/ui + TanStack Query + React Hook Form + Zod.
- **Multi-tenancy**: shared database/shared schema with mandatory `workspaceId`; `WorkspaceGuard` + `PrismaTenantMiddleware` to prevent tenant leakage.
- **API**: `/api/v1` prefix, errors in **Problem Details (RFC 7807)**, cursor pagination, `Idempotency-Key` on sensitive POSTs.
- **AI**: `LlmProvider` as a *port*; default Anthropic adapter, OpenAI fallback; per-workspace prompt caching; token guardrail.
- **Infra**: multi-stage Docker (API, Worker, Web) + Nginx + GitHub Actions (`ci.yml`, `release.yml`, `deploy.yml`).

# E2E Tests (Playwright)

- Mandatory minimum flows: signup → workspace → project → task; member invitation; sprint planning; comment with mention.
- `playwright.config.ts` at the root brings up `api` (NestJS) and `web` (Next.js) in parallel via `webServer`, with Postgres/Redis via `docker-compose`.
- Specs in `e2e/`; fixtures in `e2e/fixtures/`; helpers in `e2e/support/`.
- Mock external integrations (Anthropic/OpenAI, S3/R2, SES/Resend) via `page.route` so no real calls leak in CI.
- Run locally: `pnpm install` at the root, `pnpm exec playwright install chromium`, `pnpm test:e2e`. UI mode: `pnpm test:e2e:ui`.
