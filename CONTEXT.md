# Adomata

A SaaS platform for agencies to run media buying, social media management, and automation on behalf of their clients.

Current prototype scope is narrower: a read-only Fleet Board giving an agency director KPI visibility across every Ad Account, on Meta only. Budget and Budget Exhausted notifications stay in the model but sit behind the board in priority. SMM and rule-based automation are future phases, not yet modeled.

## Language

### Tenancy

**Agency**:
The paying organization on Adomata. Manages one or more Clients.
_Avoid_: Organization, Workspace, Tenant
_Vendor exception_: Better Auth's `organization` plugin (tables, session fields, client hooks) keeps its vendor-given name internally. The leak stops at that boundary — all Adomata-authored code, routes, and UI say Agency.

**Client**:
An end-brand that an Agency manages. The boundary that campaigns, posts, and budgets are scoped to. Flat under Agency — no nesting of Clients within Clients. May have one or more Ad Accounts.
_Avoid_: Brand, Customer, Account

**Ad Account**:
A Meta Ads Manager account the Agency has been granted access to, scoped to exactly one Client — never shared across Clients, even though Meta itself has no notion of Client and would permit it. A Client can have more than one Ad Account — KPIs are monitored both per Ad Account and rolled up per Client. Carries a connection status (pending / connected / access lost) so a broken Meta connection isn't mistaken for a quiet account with no spend, and a newly-discovered account awaiting its first poll isn't mistaken for either. Pending is the state between the Agency granting access and the first successful Account Tier poll; only that first poll flips it to connected. Access lost is not polled again; a future reconnection flow must return it to pending before polling resumes.
_Avoid_: Ads cabinet, Cabinet, Account

**Account Health**:
Meta's own health signal for an Ad Account (`account_status`, `disable_reason`, and billing signals like `balance`/`is_prepay_account`) — vendor-mirrored, not renamed, same treatment as Campaign/Ad Set/Ad. Orthogonal to Ad Account's connection status: connection status is whether *Adomata* can still read the account; Account Health is whether *Meta* considers the account healthy. When connection status is access lost, Account Health is unknown, not red — Adomata can't call the API to check it. Drives the board's traffic light.
_Avoid_: Account status (ambiguous with connection status — always say which one)

**Health Color / Health Reason**:
The board's traffic light for an Ad Account is always two things together, never the color alone: Health Color, a small closed set an agency director can scan without reading; and Health Reason, an always-visible short text answering *why*. Health Color answers "does this need me?"; Health Reason answers "why?". This split exists because several of Meta's raw signals (e.g. postpay billing) are permanent properties of an account, not transient problems — cramming that nuance into color alone would either make the color meaningless (everyone's postpay, everyone's the same color) or require a color per nuance. Four colors: green, yellow, red — Meta told us something about this account — and **grey**, a categorically different case meaning Adomata has nothing to report (connection status is pending or access lost), never used for a Meta-reported problem. See [ADR 0018](docs/adr/0018-account-health-is-color-plus-reason-not-color-alone.md).
_Avoid_: Traffic light (as if it's color-only), Status (too vague — say Health Color or Health Reason)

**Campaign / Ad Set / Ad**:
Meta's own tree beneath an Ad Account (Campaign → Ad Set → Ad), each level a list of its children. Vendor-mirrored, not renamed: Adomata displays and stores Meta's own names as-is rather than inventing Adomata-specific terms, the same vendor-boundary treatment as Better Auth's `organization`/`member` (see [ADR 0004](docs/adr/0004-better-auth-organization-naming-stays-vendor-internal.md)). The board never writes back to Meta ([ADR 0005](docs/adr/0005-fleet-board-is-read-only.md)), so the buyer moves directly between our board and Meta's own UI in Meta's language.
_Avoid_: inventing Adomata synonyms for these terms

**Creative**:
A property of an Ad, not a tree level below it — an Ad has exactly one Creative, expanded in place rather than listed as siblings. A carousel or Advantage+ asset-feed Ad carries several assets (images, videos, copy, links), but those are internal structure of that one Creative, not multiple Creatives under the Ad.
_Avoid_: Creative level, Creatives (as a list of children under an Ad)

**User**:
A person who logs into an Agency. Currently sees all of that Agency's Clients and Ad Accounts — no per-Client visibility scoping. The primary persona today is the agency director, monitoring KPIs across every Client.
_Avoid_: Member, Account
_Vendor exception_: Better Auth's `member` table (the User↔Agency join row with a role) keeps its vendor-given name internally, same boundary rule as Agency/Organization above.

### Fleet Board

**Fleet Board**:
The read-only tree view giving an agency director KPI visibility across every Ad Account at once, expandable down through Meta's own Campaign → Ad Set → Ad → Creative hierarchy. Never writes back to Meta ([ADR 0005](docs/adr/0005-fleet-board-is-read-only.md)).
_Avoid_: Fleet dashboard, dashboard

**Client-grouped view / Flat view**:
The Fleet Board's grouping toggle. Client-grouped view nests Ad Accounts under a collapsible Client row that is itself a KPI aggregate — not a bare header — so a director can read a Client's rolled-up numbers without expanding it. Flat view removes the nesting and lists every Ad Account directly; Client is demoted to a column and a filter, and no Client-level aggregate row is shown. Both modes are a presentation choice over the same underlying data — Client's rollup ([see Ad Account](#tenancy)) always exists regardless of which mode is active.
_Avoid_: —

### KPIs

**KPI**:
One of the fixed metrics Adomata tracks per Ad Account and rolls up per Client: Spend, Impressions, Clicks, CTR, CPA, ROAS.
_Avoid_: Metric

**CPA** (Cost per Action):
Spend divided by the number of results Meta attributes to an ad (e.g. leads, purchases). "Action," not "acquisition" — a result isn't always a completed sale.
_Avoid_: Cost per acquisition, CPL

**ROAS** (Return on Ad Spend):
Revenue attributed to an Ad Account divided by its Spend, sourced from Meta's conversion tracking (Pixel/Conversions API). Nullable — a Client without conversion tracking configured has no ROAS; that's an expected state, not an error.
_Avoid_: —

### Monitoring & Alerts

**Budget**:
An Agency-defined spend cap set on a Client for a calendar month, covering total spend across all of that Client's Ad Accounts combined. Resets each month. Tracked by Adomata independently of Meta's own campaign/ad-set budgets.
_Avoid_: Spend cap, Allocation, Limit

**Budget Exhausted**:
The system event that fires when a Client's actual spend across its Ad Accounts reaches its Budget for the current month. Resets with the Budget each month cycle. The only event type in the prototype.
_Avoid_: Alert, Overspend

**Notification**:
An email delivered to an Agency's Users when a system event (currently only Budget Exhausted) occurs.
_Avoid_: Alert

### Freshness

**Account Tier**:
The faster of the Fleet Board's two refresh cadences (5 minutes): Account Health, money owed, and whether a Client's campaigns are running. Backed by cheap baseline Meta Ad Account reads, not Insights calls.
_Avoid_: Operational tier (collides with the owner's own "operational information" for the board as a whole), Health tier (collides with [Account Health](#tenancy) — that's the signal, this is the refresh cadence)

**Insights Tier**:
The slower of the Fleet Board's two refresh cadences (1 hour): Spend and KPIs. Backed by Meta Insights calls, which carry a real rate-limit cost the Account Tier doesn't.
_Avoid_: Performance tier

**Provisional**:
The state of an Insights Tier metric for the current day, while Meta's own attribution is still revising it. Distinct from staleness — a Provisional number can be freshly polled and still change. A prior day's metric is Final once it ages out of the Reconciliation Window.
_Avoid_: Stale, pending (staleness is about the age of Adomata's copy; Provisional is about whether Meta itself has finished computing the number)

**Reconciliation Window**:
The trailing span of prior days that the Insights Tier keeps re-polling and overwriting even though those days already look Final, sized to match whatever attribution window the KPIs use ([issue #14](https://github.com/todorone/adomata/issues/14)). Exists because Meta itself documents that a settled day's number can still move — an advertiser editing an ad set's attribution setting, or a platform-wide attribution change — not just ordinary same-day revision. A day older than the window is stored as-is and never re-checked again; that residual drift risk is accepted, not engineered around, for this scope.
_Avoid_: —
