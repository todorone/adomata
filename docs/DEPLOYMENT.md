# Deployment & Production Access

How Adomata reaches production, and how an AI agent can access it to debug.
Read this before touching anything in production.

## Topology at a glance

- **API** (`apps/api`) runs in Docker on a **shared Hetzner VPS** (`78.46.206.9`,
  ARM64 Ubuntu), managed by **Coolify** (self-hosted PaaS), as its own separate
  app grouping. Public origin: `https://api.adomata.com`.
- **Client** (`apps/client`) is a static SPA served by **Cloudflare** (Workers
  Assets). Public origin: `https://app.adomata.com`. It is built with
  `VITE_API_URL=https://api.adomata.com` and talks to the API directly
  (cross-origin, bearer auth).
- **Scheduler** (`apps/scheduler`) is the separate Cloudflare Worker
  `adomata-scheduler-v1`. Its versioned `*/5 * * * *` Cron Trigger calls the
  API's authenticated `/scheduler` endpoint; it serves no public client traffic.
- **TLS / routing** for the API is handled by Coolify's **Traefik** reverse
  proxy (`coolify-proxy`, ports 80/443), with Let's Encrypt certs. The API
  container also publishes `:3000` on the host, but public traffic comes through
  Traefik on 443.
- **Postgres** (`postgres:18-alpine`) runs as a sibling container, **not**
  published to the host — reachable only on the internal Docker network or via
  `docker exec`.

> ⚠️ **The VPS is shared** — with other unrelated production apps and services
> (WordPress + MariaDB, Umami, Uptime-Kuma, and Coolify itself). Only ever
> touch Adomata's own containers. Coolify assigns each app's containers a
> generic `api-*` / `db-*` name plus a per-app UUID, so **other apps on this
> host may carry the same prefixes** with a different UUID — confirm the exact
> UUID for Adomata's Coolify resource before selecting containers (see below),
> and never touch a container you haven't confirmed belongs to Adomata.

## How deploys happen

The API and Client **auto-deploy on push to `main`**. There is no deploy step in CI
(`.github/workflows/checks.yml` only runs lint / ts / unit tests / e2e).

- **API:** Coolify watches `main` (git webhook) and on each push rebuilds the
  Docker image and runs `docker compose up`. The compose includes a one-shot
  `migrate` service (`bun src/db/migrate.ts`) that applies Drizzle migrations
  **before** the API starts; a failed migration blocks the new API from coming
  up. The API runs with `NODE_ENV=production` / `BUN_ENV=production`, a Docker
  healthcheck on `/health`, and `restart: unless-stopped`, so a crashed Bun
  process is restarted by Docker. The healthcheck marks a wedged or DB-down
  container unhealthy for Coolify visibility; Docker itself does not restart a
  container solely because the healthcheck failed.
- **Client:** Cloudflare's git integration builds and deploys on every push
  (runs the build with the production `VITE_API_URL`, per `apps/client/wrangler.jsonc`'s
  `build.command`). The manual fallback is `pnpm --filter client deploy`
  (`wrangler deploy`).
- **Scheduler:** deploy independently after changing `apps/scheduler` with
  `pnpm --filter @adomata/scheduler deploy`. This must be done by a human with
  Cloudflare deployment access; the versioned Worker configuration and Cron
  Trigger are committed in `apps/scheduler/wrangler.jsonc`.

  > ⚠️ The Worker does **not** auto-deploy, so a change to the endpoint it calls
  > or the secret it sends is only half-shipped until someone runs that command.
  > On 2026-08-25 the API renamed `/heartbeat` to `/scheduler` and
  > `HEARTBEAT_SECRET` to `SCHEDULER_SECRET`; the Worker was not redeployed, so
  > every scheduled invocation 404'd and production ran with **no scheduled
  > synchronization at all** until it was noticed. The API deploy and the Worker
  > deploy have to land together whenever that contract moves — and after either,
  > confirm a real invocation arrives (see "Verifying the scheduler chain").

**Rollback:** "Redeploy" a previous deployment from the Coolify UI. This is a
**human** action — agents do not deploy or roll back.

### Production migration recovery

Production migration safety is fail-closed (no separate ADR for this in
Adomata, this doc is the source of truth):

- A production deploy takes a pre-migration Postgres backup (`pre-migration-backup`
  service in `docker-compose.yaml`, `scripts/pre-migration-backup.sh`) before
  running `migrate`. Local/dev compose keeps the same dependency chain with the
  backup disabled by default (`PRE_MIGRATION_BACKUP_ENABLED=false`); production
  sets it to `true`.
- The backup runner uses the `postgres:18-alpine` image, not the API image, and
  runs `pg_dump --format=custom` against the `db` service on the internal Docker
  network.
- The backup file name includes database name, UTC timestamp, and deploy commit
  SHA when available, e.g. `adomata-2026-06-24T09-42-10Z-main-a1b2c3d4.dump`.
- The backup step verifies the dump exists, is non-empty, and is readable with
  `pg_restore --list`. If backup fails, migration does not run.
- If migration fails, the deploy fails and the new API does not start. Restore
  does not happen automatically.
- The latest two successful local pre-migration dumps are kept in the
  `pre_migration_backups` Docker volume; older ones are deleted only after a new
  backup succeeds.
- Set `DEPLOY_COMMIT_SHA` and `DEPLOY_REF_NAME` when the deploy platform exposes
  them; otherwise backups use `unknown` and `main` in the file name.

### Emergency database restore

Restore is a human-approved emergency action only. It may lose writes made after
the selected backup snapshot.

1. Stop the API so no new writes happen.
2. Confirm the exact backup file to restore.
3. Restore into a clean empty `adomata` database; do not overlay a dump onto an
   unknown partially migrated schema.
4. Run `pg_restore --single-transaction --exit-on-error`.
5. Start or redeploy the API version that matches the restored schema.
6. Verify `/health` and one authenticated smoke check.

For stronger recovery with less data loss, add continuous WAL archiving and
point-in-time recovery later. Do not approximate that with automatic dump
restore.

**Secrets / env vars** live in **Coolify** (for the API) and **Cloudflare** (for
the client and Scheduler), not in the repo. The API container's env includes `DATABASE_URL`,
`POSTGRES_*`, `BETTER_AUTH_SECRET`, `SUPERADMIN_EMAIL`, `CLIENT_URL`, the
Cloudflare Email Service credentials (`CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_EMAIL_API_TOKEN`, `EMAIL_FROM`), optional social sign-in
(`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`/`APPLE_CLIENT_SECRET`),
and the `OTEL_*` exporter vars (`OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`) pointing at the external
OpenObserve instance at `https://telemetry.fedir.net` — see `apps/api/.env.example`
for the full list. Meta production uses `META_API_MODE=live` and `SCHEDULER_SECRET`
(the API refuses to start without them); `META_ACCESS_TOKEN` is unused in live
mode — each Agency's own token is stored in `organizationSettings` and set from
its Organization Settings page. Adomata has no `R2_*` or `VAPID_*` vars — there's
no File/Avatar/Push domain yet. To read the live env on the box:
`docker exec <api-container> env`.

## Scheduler Worker

The Scheduler's non-secret API origin is committed as `API_URL` in
`apps/scheduler/wrangler.jsonc`. Before its first deployment, set its required
Cloudflare Worker secret to the exact same value as the API's
`SCHEDULER_SECRET`; never add either value to Git:

```sh
pnpm --filter @adomata/scheduler exec wrangler secret put SCHEDULER_SECRET
pnpm --filter @adomata/scheduler deploy
```

### Verifying the scheduler chain

A failed scheduled invocation is silent from the outside — the API stays healthy
and the board simply stops getting fresher. After deploying either side, confirm
an invocation actually lands rather than trusting `/health`:

```sh
ssh root@78.46.206.9 'docker exec -i $(docker ps -q --filter name=^db-i11au6d81dnkewufg0hu91vx) \
  psql -U adomata -d adomata -c "SELECT max(received_at) FROM sync_invocation;"'
```

Cron fires every five minutes, so that timestamp should never be more than a few
minutes old. If it is stale while `/health` returns 200, the Worker is failing —
check its route and secret against the API before looking anywhere else.

The Worker throws when the API responds outside the 2xx range, which makes a
rejected scheduling attempt visible in the Cloudflare invocation logs rather
than silently accepting it.

## Accessing production to debug

### SSH (root) — host shell

```sh
ssh root@78.46.206.9
```

Uses the maintainer's key from `~/.ssh`. Agents running locally may use it for
**read-only debugging** within the limits below.

### Selecting the Adomata containers

Names carry a Coolify UUID and a per-deploy suffix, so they change on every
deploy, and the `api-`/`db-` prefixes alone are ambiguous on this shared VPS
(other apps' containers use the same prefixes). Adomata's Coolify resource
UUID is **`i11au6d81dnkewufg0hu91vx`** — confirm it hasn't changed in the
Coolify dashboard before relying on it, and never select by the bare
`api-`/`db-` prefix alone on this host:

```sh
api=$(ssh root@78.46.206.9 'docker ps -q --filter name=^api-i11au6d81dnkewufg0hu91vx')
db=$(ssh root@78.46.206.9  'docker ps -q --filter name=^db-i11au6d81dnkewufg0hu91vx')
```

### Logs

```sh
ssh root@78.46.206.9 'docker logs --tail 200 $(docker ps -aq --filter name=^api-i11au6d81dnkewufg0hu91vx)'
```

> The `-a` matters here: after a container exhausts Coolify's restart limit it
> stops (and may be removed on the next deploy/teardown) rather than staying
> up, so `docker ps` alone can come back empty even though the app is down.

The API uses the `logger` service (`apps/api/src/core/logger.ts`), so structured
app logs go to stdout/stderr and show up here.

### Health & black-box API checks

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://api.adomata.com/health   # expect 200
```

For authenticated checks, sign in over HTTPS with the **production superadmin**
account (`pmahotsava@gmail.com` — see the "Testing accounts" section in
`AGENTS.md` for the password, and `SUPERADMIN_EMAIL` in `apps/api/.env.example`
for how the API grants it access) and call the API with the returned bearer
token. Prefer this black-box path over the DB for verifying behavior.

### Read-only database access

Postgres isn't exposed to the host; reach it via `docker exec`. Prod db/user are
both `adomata` (password is in the container env, not here):

```sh
ssh root@78.46.206.9 'docker exec -i $(docker ps -q --filter name=^db-i11au6d81dnkewufg0hu91vx) \
  psql -U adomata -d adomata -c "SELECT count(*) FROM \"user\";"'
```

**SELECTs only.** No writes, no DDL.

## Guardrails (agent blast radius)

1. **Default to read-only debugging:** `docker logs`, `docker ps`, `/health` +
   authenticated API curls, and read-only `psql` (`SELECT`) via `docker exec`.
2. **Never touch non-Adomata containers** — this includes other apps' `api-*` /
   `db-*` containers on the same host, plus WordPress, MariaDB, Umami,
   Uptime-Kuma, Coolify, and Traefik.
3. **No manual `docker` deploys or image builds on the box.** Deploys happen only
   via push-to-`main` (Coolify auto-deploy).
4. **Destructive operations require explicit human go-ahead every time** — this
   includes any DB write/DDL, migrations, and `docker restart` / `stop` / `down`
   on the API or DB containers.

## Reference (human-only logins, not for agents)

- **Coolify dashboard** — manages the API app, env vars, deploy logs, redeploy /
  rollback. Served on the VPS (Coolify container, host port 8000).
- **Cloudflare** — Workers project `adomata` for the `app.adomata.com` client;
  account `3a1d7c1556e16babeb41e8677fa02feb`.
