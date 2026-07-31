# Adomata

A SaaS platform for agencies to run media buying, social media management, and automation on behalf of their clients.

Current product scope is narrower: a read-only Fleet Board giving an agency director KPI visibility across every Ad Account, on Meta only. Budget and Budget Exhausted notifications stay in the model but sit behind the board in priority. SMM and rule-based automation are future phases, not yet modeled.

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
Meta's own health signal for an Ad Account (`account_status`, `disable_reason`, and billing signals like `balance`/`is_prepay_account`) — vendor-mirrored, not renamed, same treatment as Campaign/Ad Set/Ad. Orthogonal to Ad Account's connection status: connection status is whether _Adomata_ can still read the account; Account Health is whether _Meta_ considers the account healthy. When connection status is access lost, Account Health is unknown, not red — Adomata can't call the API to check it. Drives the board's traffic light.
_Avoid_: Account status (ambiguous with connection status — always say which one)

**Health Color / Health Reason**:
The board's traffic light for an Ad Account is always two things together, never the color alone: Health Color, a small closed set an agency director can scan without reading; and Health Reason, an always-visible short text answering _why_. Health Color answers "what kind of state is this?"; Health Reason answers "why?". Red needs attention; yellow is the neutral fact that an active account uses postpay; green is active prepay; grey means Adomata has nothing to report because the connection is pending or lost. This split exists because permanent properties such as postpay billing must remain visible without being mislabeled as problems. See [ADR 0018](docs/adr/0018-account-health-is-color-plus-reason-not-color-alone.md). A Client row rolls these up from its Ad Accounts — worst color wins, while its Reason counts red children needing attention or, when there are no red children, summarizes yellow postpay children — see [ADR 0019](docs/adr/0019-fleet-board-rollup-rules.md).
_Avoid_: Traffic light (as if it's color-only), Status (too vague — say Health Color or Health Reason)

**Campaign / Ad Set / Ad**:
Meta's own tree beneath an Ad Account (Campaign → Ad Set → Ad), each level a list of its children. Vendor-mirrored, not renamed: Adomata displays and stores Meta's own names as-is rather than inventing Adomata-specific terms, the same vendor-boundary treatment as Better Auth's `organization`/`member` (see [ADR 0004](docs/adr/0004-better-auth-organization-naming-stays-vendor-internal.md)). The board never writes back to Meta ([ADR 0005](docs/adr/0005-fleet-board-is-read-only.md)), so the buyer moves directly between our board and Meta's own UI in Meta's language.
_Avoid_: inventing Adomata synonyms for these terms

**Creative**:
A property of an Ad, not a tree level below it — an Ad has exactly one Creative, opened as that Ad's detail rather than listed as siblings. A carousel or Advantage+ asset-feed Ad carries several assets (images, videos, copy, links), but those are internal structure of that one Creative, not multiple Creatives under the Ad. Each Fleet Board view presents the same Creative content in its native detail surface: inline beneath the Ad row in Tree, in the selected-Ad detail panel in Control Room, and in expanded card detail in Signals. Multi-asset Ads show every asset with results explicitly attributed to the whole Ad, never split between assets ([ADR 0027](docs/adr/0027-creative-presentation-is-native-to-each-fleet-board-view.md)).
_Avoid_: Creative level, Creatives (as a list of children under an Ad)

**User**:
A person who logs into an Agency. Currently sees all of that Agency's Clients and Ad Accounts — no per-Client visibility scoping. The primary persona today is the agency director, monitoring KPIs across every Client.
_Avoid_: Member, Account
_Vendor exception_: Better Auth's `member` table (the User↔Agency join row with a role) keeps its vendor-given name internally, same boundary rule as Agency/Organization above.

### Fleet Board

**Fleet Board**:
The read-only surface giving an agency director KPI visibility across every Ad Account at once through three switchable, functionally complete views: Tree, Control Room, and Signals. Each view reaches Meta's Campaign → Ad Set → Ad → Creative hierarchy and never writes back to Meta ([ADR 0005](docs/adr/0005-fleet-board-is-read-only.md)).
_Avoid_: Fleet dashboard, dashboard

**Tree view / Control Room view / Signals view**:
The Fleet Board's three functionally complete presentations over the same data and controls. Tree is a comparison-first hierarchy table and the default; Control Room is a fleet rail beside one selected Ad Account's detail; Signals groups Ad Accounts into operational lanes with expandable cards. The active view is URL-encoded so interview links reproduce it. After user evaluation, a separate decision promotes the strongest default, preserves only distinct secondary workflows, and removes redundant views.
_Avoid_: Variant, Prototype

**View Depth**:
The Fleet Board's global dial over how deeply each complete view reveals the hierarchy — four positions: Ad Account, Campaign, Ad Set, Ad. Distinct from local expansion or selection, which adds detail for one branch without lowering the global depth elsewhere. Depth is a rendering control only — it never changes a number, since every level's figures are rollups that exist whether or not the row is on screen ([ADR 0019](docs/adr/0019-fleet-board-rollup-rules.md)). See [ADR 0026](docs/adr/0026-fleet-board-ships-three-complete-views-for-evaluation.md).
_Avoid_: Zoom, Level setting, Drill-down (the board never replaces itself with a detail view)

**Client-grouped view / Flat view**:
The Fleet Board's grouping toggle, defaulting to Client-grouped view in every complete view. Client-grouped view makes Client a KPI aggregate above its Ad Accounts: a collapsible row in Tree, a group in the Control Room rail, or a card placed into a Signals lane by its rolled-up operational state. Flat view removes that level and presents every Ad Account directly; Client becomes metadata and a filter, and no Client aggregate is shown. Both modes are presentation choices over the same underlying data — Client's rollup ([see Ad Account](#tenancy)) always exists regardless of which mode is active. In Client-grouped view a Client with exactly **one** Ad Account is drawn as a single merged row rather than a group row above a near-identical child, since its rollup is by definition equal to that Ad Account's own values — a rendering choice that recomputes nothing.
_Avoid_: —

**Running-rows toggle**:
The Fleet Board control that hides non-Running Campaign, Ad Set and Ad rows from display. It belongs to the **collapse** family, not the filter family: it changes which interior rows are drawn and never changes any parent's numbers, and it never hides Ad Account or Client roots, which stay governed by the root filters. Named and placed apart from Filters for exactly that reason — filtering applies to roots only and does change rollups. URL-encoded like every other view control, defaulting to off.
_Avoid_: Paused filter, Hide paused filter (calling it a filter contradicts what it does)

**Amount owed**:
What an Ad Account owes Meta, mirrored from the account's balance and shown as its own right-aligned, sortable column at Ad Account depth. A Client carries the sum across its Ad Accounts under the same single-currency assumption as its Spend — blank when the Client mixes currencies ([ADR 0012](docs/adr/0012-client-rollup-assumes-single-currency.md)) — so a director can scan every Client's debt down one column and sort by it. Interior Campaign / Ad Set / Ad rows have none: it is an Ad Account property, not a per-level rollup.
_Avoid_: Balance (that's Meta's raw field), Debt

**Needs Attention**:
The Fleet Board classification for an Ad Account with red Account Health or a lost Meta connection. Yellow postpay, green health, pending first sync, and a merely non-running campaign do not qualify. A Client Needs Attention when at least one child Ad Account does.
_Avoid_: Yellow, Warning, Unhealthy (a lost connection has unknown Account Health)

**Signals Lane**:
One of four operational groups in Signals view: Needs Attention, Postpay, Active, or Awaiting Data. Needs Attention includes red Account Health and lost Meta connections; Postpay is yellow without an attention claim; Active is green; Awaiting Data is pending first sync. A Client card uses the highest-priority lane represented by its Ad Accounts in that order.
_Avoid_: Traffic-light lane, Grey lane

**Running**:
The board's interpretation of Meta `effective_status = ACTIVE` for an Ad, rolled up with any-active-child-wins through Ad Set, Campaign, Ad Account, and Client. It describes Meta's effective configuration state, not proof that impressions are being delivered at this moment.
_Avoid_: Delivering, Live delivery

### KPIs

**KPI**:
One of the fixed metrics Adomata tracks per Ad Account and rolls up per Client: Spend, Impressions, Clicks, CTR, CPA, ROAS. Spend, Impressions, and Clicks are summed at every tree level; CTR, CPA, and ROAS are always recomputed from those sums, never summed or averaged directly, and show blank when their denominator is zero. CPA is also blank when a row mixes result action types — see [ADR 0019](docs/adr/0019-fleet-board-rollup-rules.md).
_Avoid_: Metric

**Clicks / CTR**:
Clicks means Meta inline link clicks: clicks on links to destinations or experiences, excluding broad engagement such as likes, comments, shares, and image opens. CTR is Clicks divided by Impressions at the displayed tree level.
_Avoid_: All clicks, Engagement clicks

**CPA** (Cost per Action):
Spend divided by the number of results Meta attributes to one canonical action type (e.g. leads or purchases), following the Ad Set's current attribution setting in Meta Ads Manager. A row whose spend-contributing descendants use different or unresolved result action types has no CPA; mixing unlike results would make the ratio meaningless. "Action," not "acquisition" — a result isn't always a completed sale.
_Avoid_: Cost per acquisition, CPL

**ROAS** (Return on Ad Spend):
Revenue attributed to an Ad Account divided by its Spend, sourced from Meta's conversion tracking (Pixel/Conversions API) and following the Ad Set's current attribution setting in Meta Ads Manager. Nullable — a Client without conversion tracking configured has no ROAS; that's an expected state, not an error. A ROAS of exactly zero means no purchase value was recorded at all, so it is **displayed as no data rather than `0×`**: on a lead-generation fleet every row would otherwise read as a measured zero return. Spend of `0,00` is a genuine measurement and keeps rendering as a number.
_Avoid_: —

**Metric Selection**:
The subset of the fixed KPI list a Fleet Board view currently shows as columns, chosen from all six but never expanded beyond them. Held entirely in the URL as a search param — not stored against a User or Agency — so it's per view, not per person: two people can hold different links to the same board showing different columns. A view with no selection param shows the default (Spend, Clicks, CPA). Column order and width are fixed to the KPI list's order above, not part of the selection. See [ADR 0020](docs/adr/0020-fleet-board-metric-selection-is-url-encoded-not-stored.md).
_Avoid_: Metric toggle, Column selection (implementation-level phrasing, not the concept)

**Time Range**:
The single period whose KPI values the Fleet Board currently shows: a named preset (Today, Last 7 days, Last 14 days, Last 30 days, This Week, Last Week, This Month, Last Month) or a Custom Range picked from a calendar. Last 7 days is the default. A named preset's period follows each Ad Account's own Meta-configured timezone, so a Client rollup may combine accounts whose period boundaries differ ([ADR 0023](docs/adr/0023-fleet-board-time-ranges-are-account-local.md)); a Custom Range is picked as absolute calendar days and applied identically to every Ad Account regardless of timezone ([ADR 0030](docs/adr/0030-fleet-board-custom-time-ranges-are-absolute-calendar-days.md)). V1 does not compare the selected period with a previous period.
_Avoid_: Comparison period

### Monitoring & Alerts

**Budget**:
An Agency-defined spend cap set on a Client for a calendar month, covering total spend across all of that Client's Ad Accounts combined. Resets each month. Tracked by Adomata independently of Meta's own campaign/ad-set budgets.
_Avoid_: Spend cap, Allocation, Limit

**Budget Exhausted**:
The system event that fires when a Client's actual spend across its Ad Accounts reaches its Budget for the current month. Resets with the Budget each month cycle. The only event type in the current scope.
_Avoid_: Alert, Overspend

**Notification**:
An email delivered to an Agency's Users when a system event (currently only Budget Exhausted) occurs.
_Avoid_: Alert

### Freshness

**Stale**:
An Ad Account whose last successful Account Tier refresh is more than 10 minutes old or whose last successful Insights Tier refresh is more than 2 hours old — twice the target cadence of the respective tier. The Fleet Board summarizes each tier using the oldest successful refresh among currently visible Ad Accounts and marks stale or failed accounts individually. An Ad Account that has **never** successfully synced a tier is excluded from that summary and counted separately, because "nothing has synced" and "one new account has not synced yet" are different facts; the tier's timestamp is empty only when no visible Ad Account has ever synced it. Stale is also distinct from a **failed sync** — a sync failure is Adomata's inability to read Meta, never evidence that Meta considers the account unhealthy.
_Avoid_: Provisional (a freshly synced current-day KPI can still be Provisional)

**Account Tier**:
The faster of the Fleet Board's two refresh cadences (5 minutes): Account Health, money owed, and whether a Client's campaigns are running. Backed by cheap baseline Meta Ad Account reads, not Insights calls.
_Avoid_: Operational tier (collides with the owner's own "operational information" for the board as a whole), Health tier (collides with [Account Health](#tenancy) — that's the signal, this is the refresh cadence)

**Insights Tier**:
The slower of the Fleet Board's two refresh cadences (1 hour): Spend and KPIs. Backed by Meta Insights calls, which carry a real rate-limit cost the Account Tier doesn't.
_Avoid_: Performance tier

**Provisional**:
The state of an Insights Tier metric whose Time Range includes any day inside the Reconciliation Window, while Meta may still revise it. Distinct from staleness — a Provisional number can be freshly polled and still change. A day becomes Final only after it ages out of the Reconciliation Window; an aggregate is Provisional when any included day is Provisional.
_Avoid_: Stale, pending (staleness is about the age of Adomata's copy; Provisional is about whether Meta itself has finished computing the number)

**Reconciliation Window**:
The current day plus the 28 complete prior days that the Insights Tier keeps re-polling and overwriting while they remain Provisional. Exists because Meta documents that Insights may change for 28 days after being reported, and because an advertiser editing an ad set's attribution setting or a platform-wide attribution change can also move historical results. A day older than the window is stored as-is and never re-checked again; that residual drift risk is accepted, not engineered around, for this scope.
_Avoid_: —
