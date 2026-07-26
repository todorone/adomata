# Spec: the Meta Fleet Board

**Status**: implementation-ready, with named gaps (§11).
**Assembled for** [issue #17](https://github.com/todorone/adomata/issues/17), closing the
[Meta fleet dashboard map](https://github.com/todorone/adomata/issues/2).
**Source of the idea**: the [agency owner interview](../interviews/2026-07-25-agency-owner-fleet-dashboard.md).

This document adds no decisions of its own. Every rule below is carried from a resolved ticket and cites
the ADR or research that settled it; where something is unresolved it appears in §11 as a gap, never as
an invented answer. Vocabulary is [CONTEXT.md](../../CONTEXT.md)'s — terms in **bold** are glossary
entries and are used exactly as defined there.

---

## 1. What the board is, and who it serves

Meta gives each Ad Account its own silo: to see statistics, campaigns, or ad sets you switch into one
account at a time. **There is no tool that shows the state of every Ad Account at once.** That gap is the
product.

The **Fleet Board** is one read-only tree view showing every **Ad Account** an **Agency** touches —
traffic-light health, amount owed, whether campaigns are running — expandable down through Meta's own
Campaign → Ad Set → Ad → **Creative** hierarchy, with fast metric toggles. It is v1's core surface;
**Budget** and **Budget Exhausted** notifications stay in the model but sit behind it in priority.

Three personas, and the question each brings:

| Persona | Their question | What the board owes them |
| --- | --- | --- |
| **Media buyer** (таргетолог) | "Where is the problem, right now?" | Sees the break immediately instead of touring accounts on a schedule. Drives the 5-minute **Account Tier** — a blocked account or stopped campaign is what they need to catch fast. |
| **Project manager** | "What's the operational picture?" | Cross-client visibility in one place. The shareable-URL property of **Metric Selection** (§5) serves this persona specifically. |
| **Agency director** | "Is this particular client fine?" | Glances at the Client list and reads a rolled-up answer without expanding anything — which is why a **Client-grouped view** row is a real KPI aggregate, not a bare header. |

None of the three watches the board continuously; all check in opportunistically a few times a day. That
finding is load-bearing — it is why fixed-interval polling suffices instead of streaming, and why the
sync heartbeat can safely ride on the board's own read traffic (§7).

**Scale to design for**: 10–50 Clients, 30–150 Ad Accounts.

---

## 2. The hierarchy and the grouping toggle

### The tree

**Agency** → **Client** → **Ad Account** → Campaign → Ad Set → Ad → **Creative**.

- **Agency** is the paying organization; **Client** is an end-brand it manages, flat under Agency with no
  nesting.
- An **Ad Account** is scoped to **exactly one Client** — never shared across Clients, even though Meta
  has no notion of Client and would permit it ([ADR 0006](../adr/0006-ad-account-belongs-to-exactly-one-client.md)).
  A Client may have several Ad Accounts.
- **Campaign / Ad Set / Ad** are vendor-mirrored: Adomata displays and stores Meta's own names as-is
  rather than inventing synonyms, the same vendor-boundary treatment as Better Auth's `organization`
  ([ADR 0004](../adr/0004-better-auth-organization-naming-stays-vendor-internal.md)). Because the board
  never writes back to Meta, the buyer moves between our board and Meta's own UI in Meta's language.
- **Creative** is a **property of an Ad, not a tree level** — an Ad has exactly one Creative, expanded in
  place rather than listed as siblings ([ADR 0007](../adr/0007-creative-is-a-property-of-an-ad-not-a-tree-level.md)).
  A carousel or Advantage+ asset-feed Ad carries several assets, but those are internal structure of that
  one Creative.

### The grouping toggle

Grouping level is itself a view toggle, not a fixed choice:

- **Client-grouped view** nests Ad Accounts under a collapsible Client row that is itself a KPI aggregate.
- **Flat view** removes the nesting and lists every Ad Account directly; Client is demoted to a column and
  a filter, and no Client-level aggregate row is shown.

Both are a presentation choice over the same underlying data. The Client rollup always exists regardless
of which mode is active.

### Connection status vs. Account Health

Two orthogonal ideas that must never be conflated:

- **Connection status** (pending / connected / access lost) is whether *Adomata* can still read the
  account. **Pending** is the state between the Agency granting access and the first successful Account
  Tier poll; only that first poll flips it to connected. **Access lost** is not polled again — a future
  reconnection flow must return it to pending before polling resumes.
- **Account Health** is whether *Meta* considers the account healthy. When connection status is access
  lost, Account Health is **unknown, not red** — Adomata cannot call the API to check.

---

## 3. The traffic light

Every Ad Account always shows **two things together, never the color alone**: a **Health Color** (small
closed set, scannable without reading) and a **Health Reason** (always-visible short text answering
*why*). Color answers "does this need me?"; reason answers "why?". The split exists because several of
Meta's raw signals — postpay billing above all — are permanent properties of an account rather than
transient problems, and cramming that into color alone would either make the color meaningless or
require a color per nuance ([ADR 0018](../adr/0018-account-health-is-color-plus-reason-not-color-alone.md)).

### The mapping

Evaluated top to bottom; **first match wins**. Inputs are the Ad Account's `connectionStatus` (Adomata's
own) and, from Meta's Account Tier poll, `account_status`, `disable_reason`, and `is_prepay_account`.

| # | Condition | Color | Reason |
| - | --- | --- | --- |
| 1 | `connectionStatus = pending` (no successful poll yet) | **grey** | "Awaiting first sync" |
| 2 | `connectionStatus = access_lost` | **grey** | "Meta connection lost" |
| 3 | `account_status ≠ ACTIVE`, `disable_reason` present | **red** | The specific `disable_reason` label, e.g. "Disabled — payment risk" (`RISK_PAYMENT`), "Disabled — integrity policy" (`ADS_INTEGRITY_POLICY`), "Disabled — permanently closed" (`PERMANENT_CLOSE`) |
| 4 | `account_status ≠ ACTIVE`, no `disable_reason` (`NONE`/absent) | **red** | The `account_status` label, e.g. "Unsettled balance" (`UNSETTLED`), "Pending risk review" (`PENDING_RISK_REVIEW`), "Pending settlement" (`PENDING_SETTLEMENT`), "In grace period" (`IN_GRACE_PERIOD`), "Pending closure" (`PENDING_CLOSURE`), "Account closed" (`CLOSED`) |
| 5 | `account_status = ACTIVE`, `is_prepay_account = false` | **yellow** | "Postpay account — billed after spend" |
| 6 | `account_status = ACTIVE`, `is_prepay_account = true` or unreadable | **green** | "Active" |

Notes on the inputs:

- `ANY_ACTIVE`/`ANY_CLOSED` are Meta query filter values, never returned as an actual account's
  `account_status` — not part of this table.
- `CLOSED`/`PENDING_CLOSURE` are shown red (row 4), **not filtered off the board**. Adomata can't tell an
  advertiser-initiated wind-down from a Meta-initiated one from this field alone, and silently dropping
  the row risks a director never noticing a client relationship ended without their say-so. Whether to
  eventually stop *syncing* a closed account is a separate, later decision.
- `balance` (amount owed) **never drives color** — a postpay account normally carries a balance mid-cycle,
  so `balance > 0` alone doesn't mean trouble. It is always displayed as its own informational field,
  regardless of color, per the owner's brief-view request.
- Campaigns running/not running is **its own column**, untouched by Health Color.

**Grey** is categorically different from the other three: it means Adomata has nothing to report
(connection pending or access lost), never a Meta-reported problem.

Yellow is a **neutral label, not a warning**. The research found no credit-limit, next-bill-date, or
"approaching limit" field anywhere in Meta's documented surface
([health research](../research/2026-07-25-meta-ad-account-health-and-money-owed.md)), so the interview's
"deferred payment terms → yellow" cannot be sharpened into a threshold. That reading was unimplementable,
not merely undesirable.

---

## 4. View depth and expansion

**One comparison-first tree table.** Every Ad Account is a row; Campaign / Ad Set / Ad rows appear as
indented rows in that *same* table, sharing its columns. The board is never replaced by a drill-down
view — comparison across accounts is the whole point
([ADR 0021](../adr/0021-fleet-board-is-one-tree-table-with-a-depth-dial-over-row-expansion.md)).

Two controls:

- **View Depth** — a global dial with four positions (Ad Account, Campaign, Ad Set, Ad) setting how deep
  *every* row is opened at once. The owner's "expand the depth of view."
- **Row expansion** — per-row and additive. Clicking any row opens its children regardless of the dial.
  The owner's "click a campaign and see its ad sets."

**The interaction rule**: a row is open if View Depth reaches its level **or** it was individually
expanded. Never the reverse — raising the dial never collapses a hand-opened row, and lowering it does
not discard individual expansions. This is what makes the two controls compose instead of fight.

Consequences:

- **Every level carries the same metric columns.** Guaranteed by
  [ADR 0010](../adr/0010-insights-stored-at-ad-grain-only.md) and
  [ADR 0019](../adr/0019-fleet-board-rollup-rules.md): all six KPIs are defined at every level.
- **An expanded parent keeps showing its own aggregate.** Expanding is not a hand-off to children.
- **Health is a dot on the row**, beside the always-visible Health Reason — not a row tint or a lane. At
  30–150 account rows plus opened descendants, tinting whole rows is unreadable.
- **Sorting and filtering apply to Ad Account roots only.** Sorting a tree by an interior value has no
  well-defined meaning while parents must stay above their children.
- The **brief view** — the owner's stated minimum — is View Depth at Ad Account: active accounts, their
  current amount owed, and whether campaigns are running in them.

---

## 5. Metric configuration

**The pool is the fixed six KPIs**: Spend, Impressions, Clicks, CTR, CPA, ROAS. It is not a default
selection out of a wider Meta vocabulary — it is the whole pool
([ADR 0020](../adr/0020-fleet-board-metric-selection-is-url-encoded-not-stored.md)). Widening it would
reopen [ADR 0010](../adr/0010-insights-stored-at-ad-grain-only.md)'s storage decision: only these six are
roll-up-safe, built entirely from additive components storable at Ad grain. `reach` is the concrete
counter-example — Meta dedupes it at the queried level, so it cannot be summed up the tree.

**Metric Selection** is the subset a view currently shows as columns:

- **Held entirely in the URL** as a search param. Nothing is persisted server-side or in local storage;
  no new schema. The motivating need — a director and a buyer wanting different columns on the same board
  — is satisfied by two people holding two different links, without Adomata remembering anything against
  an identity. It also makes any view shareable, which serves the project-manager persona.
- **Default is Spend + ROAS** when no param is present. Landing on the default **never rewrites the URL**
  to spell it out, so a bare bookmark keeps tracking "whatever today's default is" rather than freezing it.
- **Column order and width are fixed** to the glossary's canonical KPI order. No drag-to-reorder, no
  resize.
- **No per-level behaviour to design.** Because the pool is fixed and every one of the six is defined at
  every tree level, there is no "this metric has no meaning here" case.

Accepted trade-off: a selection does not follow a person across devices, a cleared URL, or a fresh
browser. Adding that later means adding a per-user preferences table (which does not exist today —
`users` is pure Better Auth core with no JSON column) plus a sync between it and the URL: additive work
on top of this decision, not a rework of it.

Presets ("what a buyer checks") are a **future content layer**, not a separate data model — a preset
click would just write its metric list into this same URL-encoded selection. Which metrics each preset
contains is unspecified (§11).

---

## 6. The creative surface

**The Creative renders inline, in a full-width block directly beneath its Ad row** — inside the same
table, with the board's columns still visible above and sibling Ads still in view
([ADR 0022](../adr/0022-creative-surface-is-an-inline-expansion-of-the-ad-row.md)). It is not a row with
metrics of its own; the Ad's numbers stay on the Ad row, which follows directly from Creative being a
property of an Ad rather than a tree level.

The block carries: primary visual, primary text (`message`), headline (`name`), description, CTA,
destination link, and **the current Metric Selection** — the same columns the rest of the board shows,
not a separate creative-only metric set.

### Per creative shape

Read from the Ad's `AdCreative` ([creative research](../research/2026-07-25-meta-creative-retrieval.md)):

| Shape | Source | Rendered as |
| --- | --- | --- |
| Simple image | `image_hash` → Ad Image `url`; `thumbnail_url` as preview fallback | The image. `image_url` is a creation/input field, **not** the canonical rendered asset. |
| Simple video | `creative.video_id`, `creative.thumbnail_url`, `object_story_spec.video_data` | **Thumbnail first.** Inline playback only where resolving `video_id` returns a usable `source` for the authorized token. |
| Link/image/video with copy | `object_story_spec.link_data` / `.video_data` | `message`, `name`, `description`, `link`, `call_to_action`. |
| Carousel | `object_story_spec.link_data.child_attachments` | **All** cards as a strip — never collapsed to the first card. |
| Dynamic / Advantage+ / placement-customized | `asset_feed_spec` | A labelled variants set: images, videos, bodies, titles, descriptions, link URLs, CTAs, plus `asset_customization_rules` mapping placements to asset labels. |
| Existing FB/IG post | `effective_object_story_id`, `effective_instagram_media_id` | Identifier / link-out fallback. |

### Multi-asset attribution — a correctness rule, not a nicety

Multi-asset Ads show every asset **with results explicitly labelled as attributed to the whole Ad, never
split between assets.** Per-asset attribution would need dynamic-creative Insights breakdowns
(`image_asset`, `video_asset`, `body_asset`, …) whose documented metric set is limited and which cannot
run at ad-account level. The performance row stays keyed to `ad_id`. An asset-delivery drill-down is only
possible after validating those breakdowns against real dynamic-creative traffic — it is not in this spec.

### Media handling

Meta documents Ad Image `url` and `url_128` as **temporary URLs**, and no reviewed primary source
promises creative thumbnails or Video `source` are durable or hotlink-safe. Therefore:

1. Persist creative metadata and IDs, and at most the **latest URL as a refreshable cache value** with a
   last-synced time — never as permanent asset identity.
2. **Resolve and refresh media server-side**, then proxy it or return a short-lived product URL. Never
   expose an access token to the browser. On failure, re-fetch the creative/ad-image metadata and retry
   once.
3. Keep a **"media unavailable" state** so a missing or expired asset never hides the Ad's performance row.
4. **Do not store original image/video bytes in v1.** Meta's Platform Terms require deleting Platform Data
   once it is no longer necessary for the authorized purpose — the terms supply no general permanent-asset
   license. Persistent asset copying needs a product/legal decision on authorization, retention, deletion,
   and security first.

Permissions: `ads_read` plus authorization to the ad account. **Do not request `ads_management`** merely
to display creative — the board never writes ([ADR 0005](../adr/0005-fleet-board-is-read-only.md)).

---

## 7. Aggregation and rollup

Every tree level above Ad — Ad Set, Campaign, Ad Account, Client — is a **SQL sum over child Ad rows**,
with ratios re-derived from the summed components rather than summed or averaged directly
([ADR 0010](../adr/0010-insights-stored-at-ad-grain-only.md),
[ADR 0019](../adr/0019-fleet-board-rollup-rules.md)).

- **Spend, Impressions, Clicks** — summed at every level.
- **CTR, CPA, ROAS** — always recomputed from those sums. Never summed, never averaged.

### Zero denominators

CTR, CPA, and ROAS show a **blank (em dash), never `0` or `0%`**, whenever the denominator is zero — 0
impressions, 0 attributed actions, 0 spend — **at every level**, not just Client. A zero-denominator
ratio is undefined, not zero; `0%` would read as "this performed at zero," which isn't what happened.
This also gives ROAS one uniform blank rule instead of two (its "no conversion tracking" nullability plus
a separate zero-spend case).

### Partial ROAS tracking

A Client's ROAS sums `action_values` and `spend` across **all** child Ad Accounts, including untracked
ones — an untracked account contributes $0 to the numerator while its spend still counts toward the
denominator. Chosen over blanking the Client's ROAS or computing it only over tracked accounts with a
coverage badge: both of those force the UI to explain a partial-coverage caveat, while sum-everything
stays consistent with the "always a SQL sum" rule. **It understates rather than hides.** Recorded as a
trade-off to revisit if agencies with real mixed-tracking Clients report it as misleading.

### Health rollup

Health Color rolls up **worst-child-wins**, by strict severity:

| Severity | Color | Wins when |
| --- | --- | --- |
| 1 (worst) | **red** | any child is red |
| 2 | **yellow** | no red child, any child is yellow |
| 3 | **green** | no red or yellow child, at least one child is green |
| 4 | **grey** | *every* child is grey — grey never outranks a real signal |

A single grey child among green siblings does **not** grey out the Client: an account Adomata can't
currently read is not evidence the Client needs attention, and both common-case boards (all-green, and
all-grey because nothing is connected yet) must read unambiguously.

The parent's Health Reason becomes a **count** — "1 of 3 need attention" — of children whose color is
neither green nor grey, not the worst child's Reason text copied up. Three accounts flagged for three
different reasons would be misrepresented by any one of them.

### Running rollup

A parent row shows as running if **any** child is running, recursively up the tree — not a stricter
all-children rule. A director scanning for "is anything live under this Client" wants partial activity
too.

### Currency

**Client rollups assume one currency per Client.** Spend and the values behind CPA/ROAS are summed across
a Client's Ad Accounts with **no conversion**. A Client whose Ad Accounts actually use different
currencies is an **explicit unsupported state to detect and flag**, not a case to silently sum through
([ADR 0012](../adr/0012-client-rollup-assumes-single-currency.md)). Converting at rollup time was
rejected for now — it opens a real design problem (which rate, as of when, whose source) that nothing has
asked for.

### Collapse vs. filter

**Collapsing never changes a number** — expand state is purely a rendering toggle. **Filtering does**: a
parent's rollup sums only its currently filtered-in children. What's on screen is what's summed; a Client
total under a "spend > $0" filter reflects only the matching accounts, not the Client's true total.

---

## 8. Data architecture

### Synced snapshots, not live passthrough

Every figure on the board is read from **Adomata's own database**, populated by the sync loops — never
fetched from Meta synchronously on page load
([ADR 0013](../adr/0013-fleet-board-reads-synced-snapshots-not-meta-live.md)). A board over 30–150
accounts fanning out into a live call per account would put one slow account's latency under every
render, share a single rate-limit budget across every concurrent user, and degrade unpredictably when
Meta is slow. The [rate-limit research](../research/2026-07-25-meta-api-rate-limits-fleet-refresh.md)
confirms the sync side is affordable — roughly 300–750 calls for a full 150-account refresh, comfortably
inside a 5–15 minute floor — so no cost pressure pushes back toward live reads.

**Nothing on the board is fetched live.** The whole tree syncs, including on-expand levels: expanding a
Campaign reads already-synced Ad Sets, it does not call Meta.

### What syncs, and at what grain

| Data | Grain | Cadence | Notes |
| --- | --- | --- | --- |
| Ad Account baseline (`account_status`, `disable_reason`, `is_prepay_account`, `balance`, currency) | Ad Account | **Account Tier — 5 min** | Cheap baseline reads, not Insights calls. |
| Campaigns running / not running | Campaign | **Account Tier — 5 min** | Own column, distinct from Health Color. |
| The tree (Campaign / Ad Set / Ad) | per object | Account Tier | Synced and **soft-deleted**, never fetched on expand. |
| Insights (spend, impressions, clicks, raw `actions` / `action_values`) | **Ad × date** | **Insights Tier — 1 hour** | Every other level is a computed rollup. |

**Insights are stored at Ad grain only.** One row per (Ad, date), keeping the **raw `actions` /
`action_values` arrays** so CPA/ROAS can pick the right `action_type` per campaign *at read time* rather
than baking one in at ingestion. Fetching a separate Insights row per tree level would roughly quadruple
call volume against the same ceiling for no correctness gain on these six KPIs
([ADR 0010](../adr/0010-insights-stored-at-ad-grain-only.md)). The trade-off to remember: Campaign / Ad
Set / Ad Account rows carry **no first-class Insights record of their own** — a future non-roll-up-safe
KPI (like reach) needs its own fetch at its own level, not an extension of this table.

The read pattern is Meta's `insights?level=...` sync endpoint. There is no hard documented minimum
interval; the **undocumented backend throttle is the real ceiling**, so 5–15 minutes is the practical
floor. There is no spend-tier scaling, and **webhooks do not cover spend or insights** — the board is
poll-only by necessity, not by choice.

### Keys, history, and deletion

- **Meta's own id is the primary key** for Ad Account, Campaign, Ad Set, and Ad (e.g.
  `ad_account.id = 'act_123456789'`) — every sync is a plain upsert with no id-mapping table
  ([ADR 0009](../adr/0009-meta-id-as-primary-key-for-synced-tables.md)). These PKs are opaque vendor
  strings, not Adomata's usual id shape.
- **Campaign / Ad Set / Ad are soft-deleted**, never hard-deleted — a `deletedAt` marker set the first
  time a sync no longer sees the object ([ADR 0011](../adr/0011-soft-delete-synced-tree-for-rollup-stability.md)).
  A deleted Ad's historical Insights rows stay joinable, so past rollup totals never shrink retroactively
  because an advertiser cleaned up their Ads Manager. **The live tree filters out soft-deleted rows; only
  rollup queries over past dates join through them.**
- Insights history is **daily rollups, not write-once**. Days inside the **Reconciliation Window** keep
  being re-polled and overwritten on every Insights Tier cycle even though they look Final, because
  Meta documents that a settled day's number can still move — an advertiser editing an ad set's
  attribution setting, or a platform-wide attribution change
  ([ADR 0014](../adr/0014-daily-history-with-a-rolling-reconciliation-window.md)). A day older than the
  window is stored as-is and never re-checked; that residual drift risk is **accepted, not engineered
  around**. (Window size is a gap — §11.)
- **First-connect backfill reaches the 1st of the current calendar month**
  ([ADR 0015](../adr/0015-first-connect-backfill-to-start-of-calendar-month.md)). Budget Exhausted tracks
  a Client's actual month-to-date spend, so an account connected on the 20th would silently under-report
  the first 19 days — a Budget could already be exhausted with the board showing otherwise.

### Where it runs

`apps/api` runs as a **long-lived Bun process in Docker on a shared Hetzner VPS via Coolify, against
Postgres** (`drizzle-orm/bun-sql`). Only the client SPA is on Cloudflare. This **corrects
[ADR 0003](../adr/0003-bootstrap-infra-from-frontpeek.md)'s stale "Cloudflare Workers" premise** for the
API — there is no `wrangler.toml` for it at all
([ADR 0016](../adr/0016-sync-driven-by-heartbeat-not-workers-native-cron.md)).

Sync is therefore driven by a single **authenticated `/heartbeat` endpoint** that checks each tier's
last-refreshed timestamp and fires whichever tier is due. It is called:

- in production, by a **Cloudflare Cron Trigger** on a 5-minute schedule (matching the fastest tier);
- **in-process, as a non-blocking side effect of the board's own read endpoint** — which doubles as the
  entire local-dev trigger (no dev-only scheduling code path) and a production backstop keeping freshness
  correlated with someone actually looking.

A **per-tier lock** prevents cron-triggered and read-triggered heartbeats from double-running a tier. A
host-level cron job was rejected: Coolify assigns container names a fresh UUID on every deploy, so a cron
job addressing a container by name would silently break.

### Meta in dev and test

Meta is faked by **network-level interception inside the API process**, so real client, retry, and
header-parsing code runs unchanged in every environment
([ADR 0014-mock](../adr/0014-meta-api-faked-via-network-interception.md)). Toggled by an **explicit
`META_API_MODE=fake|live` flag, not credential presence**
([ADR 0015-mock](../adr/0015-meta-mock-mode-is-an-explicit-flag-not-credential-presence.md)) — so a
missing credential fails loudly instead of silently serving fixtures. Fixtures are **raw Meta signal
combinations, not hand-set colors**, in a small fixed roster shared by the dev seed script and the tests
([ADR 0016-mock](../adr/0016-meta-fixtures-are-raw-signals-in-a-small-shared-roster.md)) — so the §3
mapping is exercised rather than bypassed. Mock coverage currently **stops at the sync layer**
([ADR 0017](../adr/0017-meta-mock-testing-stops-at-the-sync-layer-for-now.md)); Playwright E2E of the
board itself waits on Onboarding, since no real connect flow exists yet to seed through.

---

## 9. Freshness and staleness

Two tiers, not one interval ([ADR 0008](../adr/0008-two-tier-freshness-for-fleet-board.md)):

| Tier | Target | Covers | Why |
| --- | --- | --- | --- |
| **Account Tier** | **5 minutes** | Account Health, money owed, campaigns running/not running | A blocked account or stopped campaign is a break the media buyer needs to catch fast. Cheap baseline reads. |
| **Insights Tier** | **1 hour** | Spend and the KPIs | Tolerable because no persona watches continuously. Insights calls compete against the undocumented backend throttle that is the fleet's real ceiling. |

A single uniform interval would either poll Account Tier data too slowly to catch a break, or poll
Insights needlessly often against the more constrained budget. **The split is hard to unwind** — the sync
architecture (two loops, two schedules, per-tier timestamps) assumes it.

### Staleness is shown, not silent

The board displays a **per-tier last-refreshed timestamp**. Every figure is only as fresh as its last
poll, and the user must be able to see which poll that was.

### Provisional is not staleness

**Provisional** is the state of an Insights Tier metric for the **current day**, while Meta's own
attribution is still revising it. It is tracked and surfaced **separately from staleness**: a Provisional
number can be freshly polled and still change. A prior day's metric becomes **Final** once it ages out of
the Reconciliation Window. Conflating the two would tell a user their number is old when the real
situation is that Meta hasn't finished computing it.

---

## 10. Non-goals

Ruled beyond this destination. These never graduate into scope — a reader should not have to guess.

- **Write actions against Meta.** No pausing or resuming campaigns, no editing budgets, no topping up
  balances, no creative edits. **The board diagnoses; the buyer still goes into Meta to act.**
  ([ADR 0005](../adr/0005-fleet-board-is-read-only.md).) This is why the integration requests `ads_read`
  and not `ads_management`.
- **Platforms other than Meta** — Google Ads, TikTok, LinkedIn. Settled by
  [ADR 0001](../adr/0001-meta-only-for-v1.md).
- **SMM / organic content management and rule-based automation.** Future phases per CONTEXT.md, not
  modeled.
- **Removing Budget / Budget Exhausted from v1.** Considered and rejected while scoping: the board leads,
  the notifications stay.
- **Persistent storage of creative asset bytes** as a permanent library — see §6.4.
- **Per-asset performance attribution** inside a carousel or asset-feed Ad — see §6.

---

## 11. Known gaps

Carried forward as gaps, not quietly omitted. Each needs its own ticket; none is answered here.

1. **Time range and comparison controls.** Every metric on the board implies a window (today / 7d /
   month-to-date, vs. previous period) and the board currently specifies none. The interview never
   mentions one. **This is the largest gap in the spec** — §5 fixes *which* columns show, but not *over
   what period*, and every number in §7 inherits the ambiguity.
2. **Reconciliation Window size.** Both [CONTEXT.md](../../CONTEXT.md#freshness) and
   [ADR 0014](../adr/0014-daily-history-with-a-rolling-reconciliation-window.md) defer this to "whatever
   attribution window issue #14 settles on" — but
   [#14](https://github.com/todorone/adomata/issues/14) resolved metric *selection* and never touched
   attribution windows. **That citation is dangling and the window has no owner.** It blocks nothing
   until the sync writes history, but it must be sized before the Insights Tier ships. Coupled to gap 1:
   the window is meant to match the KPIs' attribution window, which is itself unchosen.
3. **Onboarding.** How an Agency connects a Meta Business Manager and maps discovered Ad Accounts onto
   Adomata Clients. Depends on the access model. Note this also blocks Playwright E2E of the board
   ([ADR 0017](../adr/0017-meta-mock-testing-stops-at-the-sync-layer-for-now.md)) and is what puts an
   Ad Account into **pending** in the first place.
4. **Reconnection flow.** CONTEXT.md states an access-lost Ad Account "is not polled again; a future
   reconnection flow must return it to pending before polling resumes" — that flow is unspecified.
   Without it, an access-lost account is permanently grey.
5. **Budget on the board.** Whether a Client row surfaces its Adomata **Budget** / **Budget Exhausted**
   state alongside Meta's own spend caps, and how the two read together without confusing anyone.
6. **Creative comparison.** The owner's real question is "which creative produces results" — ranking or
   comparing creatives is a step beyond displaying them. It needs a cross-Ad creative identity (image
   hash or `effective_object_story_id`) that nothing yet stores as a first-class key, plus validation of
   dynamic-creative Insights breakdowns against real traffic. **§6 displays creatives; it does not rank
   them.**
7. **Rendering at real scale.** Virtualization, pagination, lazy expansion. At View Depth = Ad and 150
   accounts the tree is large; the depth model (§4) and data architecture (§8) now exist, so this is
   answerable.
8. **Per-persona defaults and visibility.** Three personas are named, and CONTEXT.md currently gives
   every **User** sight of every Client with no scoping. Whether they get different default views, or
   scoped access, is unspecified. Related: §5 defers *which metrics* each preset would contain.
9. **Default View Depth.** Ad Account (the owner's literal "brief view") or Campaign. The prototype and
   §4 assume Ad Account. One line, no downstream dependency.
10. **Meta Marketing API access to a real agency Business Manager**
    ([#3](https://github.com/todorone/adomata/issues/3)) does not exist yet. Everything in §6 about video
    `source` resolution and asset-feed breakdowns is **documented but unvalidated against live traffic**.

---

## Provenance

| Section | Settled by |
| --- | --- |
| §1 personas, scope | [interview](../interviews/2026-07-25-agency-owner-fleet-dashboard.md), [#9](https://github.com/todorone/adomata/issues/9) |
| §2 hierarchy, grouping | [#10](https://github.com/todorone/adomata/issues/10), ADR [0004](../adr/0004-better-auth-organization-naming-stays-vendor-internal.md) · [0006](../adr/0006-ad-account-belongs-to-exactly-one-client.md) · [0007](../adr/0007-creative-is-a-property-of-an-ad-not-a-tree-level.md) |
| §3 traffic light | [#11](https://github.com/todorone/adomata/issues/11), [ADR 0018](../adr/0018-account-health-is-color-plus-reason-not-color-alone.md), [health research](../research/2026-07-25-meta-ad-account-health-and-money-owed.md) |
| §4 depth and expansion | [#13](https://github.com/todorone/adomata/issues/13) prototype → [ADR 0021](../adr/0021-fleet-board-is-one-tree-table-with-a-depth-dial-over-row-expansion.md) |
| §5 metric configuration | [#14](https://github.com/todorone/adomata/issues/14), [ADR 0020](../adr/0020-fleet-board-metric-selection-is-url-encoded-not-stored.md), [insights research](../research/insights-metrics-by-level.md) |
| §6 creative surface | [#16](https://github.com/todorone/adomata/issues/16) prototype → [ADR 0022](../adr/0022-creative-surface-is-an-inline-expansion-of-the-ad-row.md), [#7 creative research](../research/2026-07-25-meta-creative-retrieval.md) |
| §7 rollup | [#15](https://github.com/todorone/adomata/issues/15), ADR [0010](../adr/0010-insights-stored-at-ad-grain-only.md) · [0012](../adr/0012-client-rollup-assumes-single-currency.md) · [0019](../adr/0019-fleet-board-rollup-rules.md) |
| §8 data architecture | [#12](https://github.com/todorone/adomata/issues/12) · [#18](https://github.com/todorone/adomata/issues/18) · [#19](https://github.com/todorone/adomata/issues/19), ADR 0009–0017, [rate-limit research](../research/2026-07-25-meta-api-rate-limits-fleet-refresh.md) |
| §9 freshness | [#8](https://github.com/todorone/adomata/issues/8), [ADR 0008](../adr/0008-two-tier-freshness-for-fleet-board.md) |
| §10 non-goals | [map #2](https://github.com/todorone/adomata/issues/2) Out-of-scope, [ADR 0001](../adr/0001-meta-only-for-v1.md) · [0005](../adr/0005-fleet-board-is-read-only.md) |
| §11 gaps | [map #2](https://github.com/todorone/adomata/issues/2) Not-yet-specified, plus gaps 2, 4, 9 found while assembling |

**Two decisions in this spec were adopted from prototype readouts rather than an owner verdict** — §4
(ADR 0021) and §6 (ADR 0022). Both prototypes remain runnable at
`/prototype/fleet-board?variant=A|B|C`, and both ADRs record what B and C were and why they lost, so an
owner review can still overturn either without re-deriving the alternatives.
