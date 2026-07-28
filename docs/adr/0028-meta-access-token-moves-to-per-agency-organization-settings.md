# Meta access token moves to per-Agency Organization Settings

[Issue #23](https://github.com/todorone/adomata/issues/23) needed real Agencies to sync with their own
Meta credentials. Meta access tokens were previously one shared, process-wide env var
(`META_ACCESS_TOKEN`), read once at startup into a single `MetaClient` used for every Agency's sync. That
worked only for the single fixture/demo Agency this project launched with — it can't support two
Agencies with different Meta System User tokens at once.

Decided: move the token into a new `organizationSettings` table, one row per Agency, set from an
Organization Settings page only the Agency's `owner` role can view or edit.

## Naming exception

`organizationSettings` (table name `organization_settings`) is a deliberate, isolated exception to the
Agency-not-Organization naming convention ([ADR 0004](0004-better-auth-organization-naming-stays-vendor-internal.md) —
Better Auth's `organization` plugin table stays named `organization` because renaming it fights the
vendor library). This new table sits directly on top of that same Better Auth table
(`organizationId` references `organization.id`), so naming it `agencySettings` while every column and
foreign key underneath still says `organization` would be more confusing, not less. Do not generalize
this naming to other tables — everywhere else, "Agency" is the domain term (see `CONTEXT.md`).

## Mode-scope decision: per-token, not per-mode

**Scope**: one Meta token per **Agency** (not per Client), matching Meta's own System User token model —
a System User token is already scoped to everything the Business Manager can reach, so a finer Client-level
split would be fake precision.

**`META_API_MODE` stays a global, per-process env flag**, unchanged. Splitting fake/live per Agency was
considered and rejected: it would mean two Agencies running side by side in different modes, which
multiplies the sync loop's branching (and its tests) for a capability nothing in this project's roadmap
asks for. Fake mode bypasses `organizationSettings` entirely — it never reads or writes the table, and a
saved token in a fake-mode environment is accepted but ignored by the sync loop.

**Columns are typed, not a JSONB blob.** YAGNI — the only setting today is the Meta token; add a column
later if another setting shows up rather than speculatively generalizing to a blob now.

## Storage and access

- Plaintext token, matching the existing `account.accessToken` OAuth columns — not a new pattern for this
  codebase, and out of scope for this issue to change project-wide.
- **Write-only field**: `GET` never returns the raw token — only `hasToken`, `updatedAt`, `lastValidatedAt`.
  The UI field is always blank/masked; the owner can only overwrite, never read back a previously-saved
  token.
- **Save validates synchronously** against `GET /me?fields=id,name` on the real Meta Graph API before
  persisting — rejects immediately on an invalid token rather than waiting for the next heartbeat to fail
  and surface a confusing, delayed error.
- No token clear/remove action (overwrite-only) and no per-Agency mode switch — neither has a driving use
  case yet.

## Missing-token handling

**Missing-token Ad Accounts** (live mode, Agency has no `organizationSettings` row or no token set) are
skipped in that heartbeat run with a distinct `skipped_no_token` outcome and a clear `lastPollError`, but
`connectionStatus` is left alone — it is **not** flipped to `access_lost`. `access_lost` stays reserved for
a real Meta auth rejection (`MetaApiError` code 10): a missing token is a configuration gap the Agency
owner can fix any time, not a revoked grant, and conflating the two would make a freshly-onboarded Agency
with no token yet look identical to one that used to work and got cut off.

## No backfill

No live-mode Agency in production currently depends on the shared env token, so no data migration was
needed alongside the schema migration.
