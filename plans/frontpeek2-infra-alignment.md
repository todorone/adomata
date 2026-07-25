# Align adomata's infra with frontpeek2, and consolidate dashboard+landing

Adomata's `api`/`dashboard`/`landing` apps and tooling were bootstrapped from `../frontpeek`
(see [`docs/adr/0003-bootstrap-infra-from-frontpeek.md`](../docs/adr/0003-bootstrap-infra-from-frontpeek.md)),
which is now outdated (Cloudflare Workers + D1 for the API). `../frontpeek2` is the same
codebase's current state: Postgres + Docker/Coolify for the API, and a single consolidated
`apps/client` SPA instead of separate dashboard/landing/mobile apps. `apps/api` is already
mid-migration toward frontpeek2's pattern (D1/Workers scaffolding deleted, `drizzle/` +
`db/migrate.ts` added). This plan covers what's left.

Decisions below were made by grilling through both trees file-by-file; see the "Resolved
decisions" summary and rationale inline per section. No ADRs for this round (plan captures
rationale directly) and no CONTEXT.md changes (no new domain vocabulary — this is
infrastructure only).

## 1. Consolidate `apps/dashboard` + `apps/landing` → `apps/client`

**Decision:** Merge into one app, matching frontpeek2's architecture (one SPA, one Cloudflare
Worker). `apps/landing` is dropped outright — it never grew past the default Vite React
template (`react.svg`, boilerplate `App.tsx`), there's no content to migrate, and adomata's
current prototype scope (per `CONTEXT.md`) has no stated need for a public marketing site.
frontpeek2 itself has no marketing/landing routes (invite-only product).

Since `apps/dashboard` is already a real, working app (sidebar, login, super-admin pages, data
hooks, shadcn-derived UI components, TanStack Router), this is a **rename + config update**, not
a rewrite:

- [ ] `git mv apps/dashboard apps/client`
- [ ] `rm -rf apps/landing`
- [ ] Update `apps/client/wrangler.jsonc`:
  - `"name": "client"` (was `"dashboard"`)
  - Add the `build` block frontpeek2 uses to bake `VITE_API_URL` into Cloudflare's
    git-integration build: `"build": { "command": "VITE_API_URL=https://api.adomata.com pnpm run build" }`
  - Add `"vars": { "VITE_API_URL": "https://api.adomata.com" }`
  - Replace the `dash.adomata.com` TODO route with `app.adomata.com` (`custom_domain: true`)
- [ ] `apps/client/package.json`: rename `"name"` to `"client"`
- [ ] Rewrite `apps/client/.env.local` / `.env.production`: `DASHBOARD_URL` → `CLIENT_URL` (also
      update the API's `.env.example` and any route/email code that references `DASHBOARD_URL`,
      e.g. the invitation-accept link builder)
- [ ] Search the codebase for any remaining `dashboard`-specific naming (route comments, CI
      filters) and update to `client`
- [ ] Root `package.json`: any `--filter dashboard` references become `--filter client`

**Not doing:** Porting frontpeek2's mobile-navigation-shell (bottom tabs/stack screens) pattern.
That's a UI/product decision for whenever adomata needs a mobile-optimized layout — out of scope
for this infra pass.

## 2. Root tooling & config

- [ ] **`package.json`**
  - Drop `@cloudflare/vitest-pool-workers` (dead weight — `apps/api` no longer runs on Workers)
  - Rename scripts to match frontpeek2: `types` → `ts`, `unit` → `test`
  - Add `dev:api` (`pnpm --filter api dev`), `dev:client` (`pnpm --filter client dev`), `e2e`
    (`pnpm --filter client e2e`)
  - Update `checks` script to reference the renamed `ts`/`test` scripts
- [ ] **`tsconfig.base.json`** — modernize to frontpeek2's version (ES2024 target/lib,
  `types: ["node"]`, lean `strict: true`, no legacy loosening overrides). Currently this file is
  an untouched copy of old frontpeek's config and nothing in the repo actually extends it.
  - [ ] `apps/api/tsconfig.json`: add `"extends": "../../tsconfig.base.json"`, drop the
        duplicated compiler options now covered by the base (keep app-specific ones: `target`
        can stay `es2021` if Bun requires it — verify; `types: ["node", "bun"]`; `jsx`; `module`;
        `moduleResolution`)
  - [ ] `apps/client/tsconfig.json`: same — extend the base once it exists there too
  - [ ] Run `pnpm --filter api ts` after wiring the extend and fix any fallout from the stricter
        base (expect this to be small — `apps/api/tsconfig.json` already sets `strict: true`
        itself today)
- [ ] **`eslint.config.mjs`**: add `{ ignores: ['**/dist/**', '**/routeTree.gen.ts'] }` (needed
  once `apps/client` has TanStack Router codegen — it already does, carried over from
  `apps/dashboard`). **Do not** copy frontpeek2's version of the `no-restricted-imports` block —
  adomata's version (protecting `apps/api/src/client/**` from importing Hono/Worker runtime) is
  more advanced than frontpeek2's and specific to adomata's `client/` leaf-package pattern (see
  §4). Keep it as-is.
- [ ] **`.gitignore`**: add Playwright artifacts (`test-results`, `playwright-report`,
  `**/e2e/.auth`) ahead of §5's e2e scaffolding; add `.claude`. Drop `.sentry` (dead — no Sentry
  usage anywhere in the codebase, confirmed via grep). Keep `**/.wrangler` — still relevant since
  `apps/client` deploys via wrangler, even though frontpeek2's own `.gitignore` no longer lists it.
- [ ] Add a `CLAUDE.md -> AGENTS.md` symlink at the repo root (frontpeek2 and old frontpeek both
  have this; adomata doesn't yet)

## 3. Observability: API-side OTEL, external OpenObserve

**Decision:** Bring over the API's OTEL wiring, but point it at your existing external
OpenObserve instance (`https://telemetry.fedir.net`) rather than self-hosting a sibling
container like frontpeek2 does. The API's telemetry code is pure env-var driven (standard
`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` / `OTEL_SERVICE_NAME`, read
automatically by the OTel SDK) — no code changes needed to point it externally. Client-side
browser telemetry (frontpeek2's `src/lib/logger.ts` + `POST /client-logs`) is deferred — get the
API-side pipeline working first.

- [ ] Copy `apps/api/src/core/telemetry.ts`, `core/logger.ts`, `core/dbTracing.ts` from
      frontpeek2 as-is
- [ ] `apps/api/src/index.ts`: import `./core/telemetry` first (before `./app`), matching
      frontpeek2's entry-point ordering, so `NodeSDK#start()` runs before any instrumented code
- [ ] Add `@opentelemetry/*` deps to `apps/api/package.json` (api, sdk-node, sdk-logs,
      exporter-logs-otlp-http, exporter-trace-otlp-http, `@hono/otel`) matching frontpeek2's
      versions
- [ ] **Do not** port the `openobserve` service, `openobserve_data` volume, or
      `ZO_ROOT_USER_EMAIL`/`ZO_ROOT_USER_PASSWORD` vars into `docker-compose.yaml` — there's no
      self-hosted instance to run
- [ ] `.env.example` / Coolify prod env: add `OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.fedir.net`,
      `OTEL_EXPORTER_OTLP_HEADERS` (auth for that instance — confirm the header format
      telemetry.fedir.net expects), `OTEL_SERVICE_NAME=adomata-api`
- [ ] Wire `httpInstrumentationMiddleware()` from `@hono/otel` into `app.ts` (see §4 — this
      lands alongside the OpenAPIHono conversion)

## 4. API: adopt `@hono/zod-openapi`, starting with `/health`

**Decision:** Convert the root `app.ts` from plain `Hono` to `OpenAPIHono`, and build the
(currently missing) `/health` route the frontpeek2 way. This establishes OpenAPI-first routes as
the convention going forward; existing routes (`admin.ts`, `auth.ts`, `me.ts`, `invitation.ts`)
stay as plain-Hono routers mounted via `.route()` — `OpenAPIHono` is a drop-in superset, no
forced rewrite of existing routes.

**Found bug:** `apps/api/Dockerfile`'s `HEALTHCHECK` already does
`wget -qO- http://localhost:3000/health`, but no `/health` route exists in `app.ts` today — the
container healthcheck is currently always failing.

- [ ] Add `@hono/zod-openapi` and `@hono/swagger-ui` to `apps/api/package.json`
- [ ] `apps/api/src/routes/health.ts`: port frontpeek2's version, adapted to adomata's schema —
      query adomata's own lightweight table (e.g. `organization`, which exists per
      `CONTEXT.md`'s vendor-exception note on Better Auth's org table) instead of frontpeek2's
      `organization` import path
  - Use adomata's existing `ApiErrorCode` catalog (`apps/api/src/client/error.ts`) for the 503
    case if it fits, rather than introducing frontpeek2's `SERVICE_UNAVAILABLE` code — check
    whether `NO_ACTIVE_ORGANIZATION`-style codes cover this or whether a new code is warranted
- [ ] `apps/api/src/app.ts`:
  - Swap `new Hono()` → `new OpenAPIHono({ defaultHook: ... })` (route existing `apiError` calls
    through the `defaultHook` for validation failures, matching frontpeek2's pattern)
  - Add `base.onError(...)`: record exceptions to the active OTEL span
    (`trace.getActiveSpan()?.recordException(err)` / `.setStatus(...)`), log via `core/logger`,
    return a generic 500 through `apiError`
  - Mount `httpInstrumentationMiddleware()` from `@hono/otel` (no-op outside production, gated
    the same way `core/telemetry.ts` is)
  - Non-production only: `base.doc('/doc', ...)` + `base.get('/ui', swaggerUI({ url: '/doc' }))`
  - Add `.route('/health', healthRoutes)`
- [ ] **Preserve** the existing `apps/api/src/client/` leaf-package pattern (`app-type.ts`,
      `error.ts`) and its eslint `no-restricted-imports` guard — this is adomata-specific and
      already more disciplined than frontpeek2's inline `export type AppType = typeof app`. New
      code (health route, etc.) must not violate it.

## 5. Finish the `apiError` convention

Adomata already has its own `apiError` helper (`apps/api/src/logic/apiError.ts`) and
`ApiErrorCode` catalog (`apps/api/src/client/error.ts`, including an adomata-specific
`NO_ACTIVE_ORGANIZATION` code) — this is further along than initially assumed, not something to
import from frontpeek2. It's currently only used in `admin.ts`.

- [ ] Migrate `auth.ts`, `invitation.ts`, `me.ts` to return errors through `apiError` instead of
      ad-hoc Hono responses, for consistency with `admin.ts` and the new `onError` handler in §4

## 6. CI

**Decision:** Add e2e workflow scaffolding (live Postgres + API + Playwright), skip the security
suite for now — adomata's authz model doesn't have the Role/Permission richness frontpeek2's
security suite tests against yet (`CONTEXT.md` has no Role/Permission vocabulary).

**Found bug:** `.github/workflows/checks.yml` triggers on `push`/`pull_request` to `master`, but
the repo's actual default branch is `main`. CI has not been running.

- [ ] Fix `checks.yml`: `master` → `main` in both `push` and `pull_request` triggers
- [ ] Add an `e2e` job to `checks.yml` (or a separate workflow), modeled on frontpeek2's: spin up
      a `postgres:18-alpine` service, run `bun src/db/migrate.ts`, start the API, wait on
      `/health` (§4), install Playwright chromium, run `pnpm e2e`
  - This requires a minimal Playwright project under `apps/client/e2e` (stack bring-up +
    `fixtures.ts` seeding pattern) even before there are real specs — track as a follow-up if
    it's more than this pass should absorb; at minimum wire the CI job so it's ready
- [ ] Do **not** add `security.yml` or `apps/client/e2e/security/` — revisit once adomata has a
      real permission model to test

## 7. Docker / Coolify deployment

Adomata's `docker-compose.yaml` and `scripts/pre-migration-backup.sh` reference already assume
the frontpeek2 pattern (pre-migration backup service, env-var-renamed to `adomata` defaults) —
whoever set this up already ported the shape from frontpeek2. What's missing:

- [ ] `scripts/pre-migration-backup.sh` doesn't exist yet — copy from frontpeek2's
      `scripts/pre-migration-backup.sh`, renaming `frontpeek` → `adomata` references
- [ ] Fix `Dockerfile` comment: `# @fp/domain is a workspace dependency; node_modules/@ado/domain
      symlinks here...` — first half still says `@fp/domain`, should say `@ado/domain`
      (copy-paste leftover; the actual `COPY` paths are already correct)
- [ ] Port `docs/adr/0006-production-migration-recovery.md`'s content into a short adomata
      equivalent, or reference the pattern directly in `docs/DEPLOYMENT.md` (§ below) — the
      backup-before-migrate behavior is already implemented in `docker-compose.yaml`, it just
      isn't documented yet

**Decision: same shared Hetzner VPS/Coolify instance as frontpeek.** Port `docs/DEPLOYMENT.md`
from frontpeek2, adapted for adomata:

- [ ] New `docs/DEPLOYMENT.md`: topology (API in Docker via Coolify, `apps/client` static SPA on
      Cloudflare Workers Assets), how deploys happen (push-to-`main` auto-deploy, no CI deploy
      step), the shared-VPS guardrails section (list adomata's own container name prefix
      alongside frontpeek's — confirm the prefix Coolify will assign, likely `api-*`/`db-*` under
      a different app grouping), secrets/env var inventory (`DATABASE_URL`, `POSTGRES_*`,
      `BETTER_AUTH_SECRET`, the new `OTEL_*` vars from §3 — no `R2_*`/`VAPID_*`, adomata has no
      File/Avatar/Push domain), SSH/log/psql access notes mirrored from frontpeek2's doc

## Explicitly out of scope for this pass

- Mobile-navigation-shell pattern (bottom tabs/stack) — product/UI decision, not infra
- Client-side browser telemetry (`src/lib/logger.ts`, `POST /client-logs`) — revisit after §3's
  API-side pipeline is confirmed working
- Security test suite (ADR-0004-style) — needs a real Role/Permission model first
- R2 storage / Avatar / VAPID push — no corresponding domain concepts in adomata yet
- Formal ADRs for the `apps/client` consolidation or OpenAPIHono adoption — captured here instead
  for this round; revisit if either decision needs a durable record later
