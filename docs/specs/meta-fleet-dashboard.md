# Spec: the Meta Fleet Board

**Status**: implementation-ready, with named external dependencies and follow-up work (§11).
**Assembled for** [issue #17](https://github.com/todorone/adomata/issues/17), closing the
[Meta fleet dashboard map](https://github.com/todorone/adomata/issues/2).
**Source of the idea**: the [agency owner interview](../interviews/2026-07-25-agency-owner-fleet-dashboard.md).

Every rule below cites the ADR, research, or resolved planning decision that settled it; external
dependencies and follow-up work appear explicitly in §11 rather than as invented answers. Vocabulary is
[CONTEXT.md](../../CONTEXT.md)'s — terms in **bold** are glossary entries and are used exactly as defined
there.

---

## 1. What the board is, and who it serves

Meta gives each Ad Account its own silo: to see statistics, campaigns, or ad sets you switch into one
account at a time. **There is no tool that shows the state of every Ad Account at once.** That gap is the
product.

The **Fleet Board** is one read-only product surface with three complete, switchable views over every
**Ad Account** an **Agency** touches — health, amount owed, whether campaigns are **Running**, and the
Meta Campaign → Ad Set → Ad → **Creative** hierarchy, with fast KPI controls. Tree, Control Room, and
Signals expose the same data and capabilities through different interaction models so real users can
evaluate them before one is promoted and redundant views are removed ([ADR 0026](../adr/0026-fleet-board-ships-three-complete-views-for-evaluation.md)).
It is v1's core surface; **Budget** and **Budget Exhausted** notifications stay in the model but sit
behind it in priority.

Three personas, and the question each brings:

| Persona                      | Their question                     | What the board owes them                                                                                                                                                            |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Media buyer** (таргетолог) | "Where is the problem, right now?" | Sees the break immediately instead of touring accounts on a schedule. Drives the 5-minute **Account Tier** — a blocked account or stopped campaign is what they need to catch fast. |
| **Project manager**          | "What's the operational picture?"  | Cross-client visibility in one place. The shareable-URL property of **Metric Selection** (§5) serves this persona specifically.                                                     |
| **Agency director**          | "Is this particular client fine?"  | Filters to the Client and scans its Ad Accounts directly, with each account's health and KPIs visible without expanding a Client aggregate.                                         |

None of the three watches the board continuously; all check in opportunistically a few times a day. That
finding is load-bearing — it is why fixed-interval polling suffices instead of streaming, and why the
sync heartbeat can safely ride on the board's own read traffic (§7).

**Scale to design for**: 10–50 Clients, 30–150 Ad Accounts.

---

## 2. The hierarchy and Client metadata

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
- **Creative** is a **property of an Ad, not a tree level** — an Ad has exactly one Creative, opened as
  that Ad's detail rather than listed as siblings ([ADR 0007](../adr/0007-creative-is-a-property-of-an-ad-not-a-tree-level.md)).
  A carousel or Advantage+ asset-feed Ad carries several assets, but those are internal structure of that
  one Creative.

Client is metadata for each Ad Account and a root filter. Every view presents Ad Accounts directly; no
view groups or renders aggregate rows/cards by Client.

### Connection status vs. Account Health

Two orthogonal ideas that must never be conflated:

- **Connection status** (pending / connected / access lost) is whether _Adomata_ can still read the
  account. **Pending** is the state between the Agency granting access and the first successful Account
  Tier poll; only that first poll flips it to connected. **Access lost** is not polled again — a future
  reconnection flow must return it to pending before polling resumes.
- **Account Health** is whether _Meta_ considers the account healthy. When connection status is access
  lost, Account Health is **unknown, not red** — Adomata cannot call the API to check.

---

## 3. The traffic light

Every Ad Account always shows **two things together, never the color alone**: a **Health Color** (small
closed set, scannable without reading) and a **Health Reason** (always-visible short text answering
_why_). Color answers "what kind of state is this?"; reason answers "why?". The split exists because several of
Meta's raw signals — postpay billing above all — are permanent properties of an account rather than
transient problems, and cramming that into color alone would either make the color meaningless or
require a color per nuance ([ADR 0018](../adr/0018-account-health-is-color-plus-reason-not-color-alone.md)).

### The mapping

Evaluated top to bottom; **first match wins**. Inputs are the Ad Account's `connectionStatus` (Adomata's
own) and, from Meta's Account Tier poll, `account_status`, `disable_reason`, and `is_prepay_account`.

| #   | Condition                                                           | Color      | Reason                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `connectionStatus = pending` (no successful poll yet)               | **grey**   | "Awaiting first sync"                                                                                                                                                                                                                                                     |
| 2   | `connectionStatus = access_lost`                                    | **grey**   | "Meta connection lost"                                                                                                                                                                                                                                                    |
| 3   | `account_status ≠ ACTIVE`, `disable_reason` present                 | **red**    | The specific `disable_reason` label, e.g. "Disabled — payment risk" (`RISK_PAYMENT`), "Disabled — integrity policy" (`ADS_INTEGRITY_POLICY`), "Disabled — permanently closed" (`PERMANENT_CLOSE`)                                                                         |
| 4   | `account_status ≠ ACTIVE`, no `disable_reason` (`NONE`/absent)      | **red**    | The `account_status` label, e.g. "Unsettled balance" (`UNSETTLED`), "Pending risk review" (`PENDING_RISK_REVIEW`), "Pending settlement" (`PENDING_SETTLEMENT`), "In grace period" (`IN_GRACE_PERIOD`), "Pending closure" (`PENDING_CLOSURE`), "Account closed" (`CLOSED`) |
| 5   | `account_status = ACTIVE`, `is_prepay_account = false`              | **yellow** | "Postpay account — billed after spend"                                                                                                                                                                                                                                    |
| 6   | `account_status = ACTIVE`, `is_prepay_account = true` or unreadable | **green**  | "Active"                                                                                                                                                                                                                                                                  |

Notes on the inputs:

- `ANY_ACTIVE`/`ANY_CLOSED` are Meta query filter values, never returned as an actual account's
  `account_status` — not part of this table.
- `CLOSED`/`PENDING_CLOSURE` are shown red (row 4), **not filtered off the board**. Adomata can't tell an
  advertiser-initiated wind-down from a Meta-initiated one from this field alone, and silently dropping
  the row risks a director never noticing a client relationship ended without their say-so. Whether to
  eventually stop _syncing_ a closed account is a separate, later decision.
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

## 4. Complete views, depth, and local detail

The board ships three functionally complete presentations over one data and domain layer
([ADR 0026](../adr/0026-fleet-board-ships-three-complete-views-for-evaluation.md)):

| View               | Complete interaction model                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tree** (default) | One comparison-first hierarchy table. Campaign / Ad Set / Ad rows appear indented beneath their parent and share aligned KPI columns. Local row expansion is additive to View Depth.                                               |
| **Control Room**   | A virtualized fleet rail beside one selected Ad Account's hierarchy and detail. The selected Ad Account and Ad are URL-addressable; a missing or stale selection falls back to the first sorted account without rewriting the URL. |
| **Signals**        | Four operational lanes with expandable Ad Account cards: Needs Attention, Postpay, Active, Awaiting Data. Each card carries its Client as metadata.                                                                                |

Every view exposes the same **Time Range**, **Metric Selection**, View Depth, filters, sorting
inputs, freshness, hierarchy levels, and Creative data. A later evidence-based decision may promote one,
retain genuinely distinct secondary workflows, and delete redundant views; the implementation must not
fork domain or data-loading behavior between them.

**View Depth** is a global dial with four positions (Ad Account, Campaign, Ad Set, Ad), defaulting to Ad
Account. It asks every complete view to reveal the hierarchy to that level. Local expansion or selection
adds detail for one branch and lowering View Depth does not discard that local state. Creative is not a
fifth depth: it opens only as Ad detail.

Consequences:

- Every hierarchy level exposes the same KPI selection, but CPA is blank when a row mixes result types
  (§7).
- An opened parent keeps showing its own aggregate; detail never replaces the parent's numbers.
- Tree uses a Health dot beside the always-visible Health Reason. Signals uses operational lanes rather
  than raw color lanes so a lost connection belongs to Needs Attention and yellow stays neutral.
- Sorting and filtering apply to Ad Account roots, never interior Campaign / Ad Set / Ad rows.
  Column headers are the sorting affordance: clicking one sorts by it, clicking it again reverses
  direction, and the active column and direction are shown on the header.
- The brief view is Ad Account depth: Account Health, amount owed, Running state, and selected KPIs. Each
  is its own aligned cell in the table's single column definition — Health (Color dot plus always-visible
  Reason) and Running are two columns, not one, and amount owed is right-aligned and sortable. Interior
  rows leave Health and amount owed empty and carry Meta's `effective_status` in the Running column.
- Each Ad Account carries an **«Відкрити у Meta Ads Manager»** external link, built from the Meta
  identifier already stored and opening in a new tab. The board diagnoses and stays read-only
  ([ADR 0005](../adr/0005-fleet-board-is-read-only.md)); this is navigation, not a write action. Ad
  Account level only — deep links to a selected Campaign / Ad Set / Ad are follow-up work (§11).

All three views remain continuous rather than root-paginated. Virtualized rendering bounds mounted UI,
and descendants are loaded from Adomata's database only when View Depth or local detail needs them. The
initial response contains Client metadata for filtering and all visible Ad Account roots, not the entire
hidden tree. Newly opened parents are batched per hierarchy level; Creative payload and media load only
when an Ad's detail opens.

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
- **Default is Spend + Clicks + CPA** when no param is present. ROAS was the original default alongside
  Spend, but a lead-generation fleet records no purchase value, so it rendered `0×` in every row — a
  missing signal reading as a measured zero. Landing on the default **never rewrites the URL**
  to spell it out, so a bare bookmark keeps tracking "whatever today's default is" rather than freezing it.
- **Column order and width are fixed** to the glossary's canonical KPI order. No drag-to-reorder, no
  resize.
- **One KPI contract at every level.** Zero denominators stay blank, and CPA adds the mixed-result-type
  blank rule in §7; views do not invent level-specific formulas.

Accepted trade-off: a selection does not follow a person across devices, a cleared URL, or a fresh
browser. Adding that later means adding a per-user preferences table (which does not exist today —
`users` is pure Better Auth core with no JSON column) plus a sync between it and the URL: additive work
on top of this decision, not a rework of it.

Presets ("what a buyer checks") are a **future content layer**, not a separate data model — a preset
click would just write its metric list into this same URL-encoded selection. Which metrics each preset
contains is unspecified (§11).

### Time Range and shareable view state

The single **Time Range** is Today, Last 7 days, or Month to date, defaulting to **Last 7 days**. Today
was the original default, but a director opening the board in the morning saw a column of `0,00` for a
fleet that was in fact spending. The set of ranges is unchanged. V1 has no
period-over-period comparison. Each Ad Account evaluates the period in its own Meta-configured timezone;
Accounts can therefore have different local period boundaries; the UI keeps each account's timezone
visible through its metadata ([ADR 0023](../adr/0023-fleet-board-time-ranges-are-account-local.md)).

Time Range, Metric Selection, complete view, View Depth, search, filters, and root sorting are
URL-encoded. A missing parameter uses its default without rewriting the URL. Control Room also encodes
its selected Ad Account and Ad because selection is its primary context. Individual Tree / Signals
expansions stay ephemeral so a URL does not accumulate stale object IDs.

V1 filtering is deliberately small: Client / Ad Account name search, Needs Attention, and a Client
selector. Root sorts are Needs Attention, name, and any currently visible KPI. A removed sort KPI falls
back to Needs Attention. Default ordering is Needs Attention first, then name.

---

## 6. Creative detail

Creative is Ad detail, not a row with metrics of its own. All three views carry identical content and
whole-Ad attribution rules through a view-native surface
([ADR 0027](../adr/0027-creative-presentation-is-native-to-each-fleet-board-view.md)):

- Tree renders a full-width block directly beneath the Ad row.
- Control Room renders a dedicated panel for the selected Ad.
- Signals renders full expanded card detail, with no prototype-era four-preview limit.

The surface carries: primary visual, primary text (`message`), headline (`name`), description, CTA,
destination link, and the current **Metric Selection**. The Ad's figures remain attributable to the Ad;
Creative never receives a separate metric grain.

### Per creative shape

Read from the Ad's `AdCreative` ([creative research](../research/2026-07-25-meta-creative-retrieval.md)):

| Shape                                       | Source                                                                        | Rendered as                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simple image                                | `image_hash` → Ad Image `url`; `thumbnail_url` as preview fallback            | The image. `image_url` is a creation/input field, **not** the canonical rendered asset.                                                                      |
| Simple video                                | `creative.video_id`, `creative.thumbnail_url`, `object_story_spec.video_data` | **Thumbnail first.** Inline playback only where resolving `video_id` returns a usable `source` for the authorized token.                                     |
| Link/image/video with copy                  | `object_story_spec.link_data` / `.video_data`                                 | `message`, `name`, `description`, `link`, `call_to_action`.                                                                                                  |
| Carousel                                    | `object_story_spec.link_data.child_attachments`                               | **All** cards as a strip — never collapsed to the first card.                                                                                                |
| Dynamic / Advantage+ / placement-customized | `asset_feed_spec`                                                             | A labelled variants set: images, videos, bodies, titles, descriptions, link URLs, CTAs, plus `asset_customization_rules` mapping placements to asset labels. |
| Existing FB/IG post                         | `effective_object_story_id`, `effective_instagram_media_id`                   | Identifier / link-out fallback.                                                                                                                              |

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
2. **Resolve and refresh media server-side through an authenticated streaming proxy.** The proxy verifies
   Agency ownership, never exposes an access token, and re-fetches creative/ad-image metadata once when a
   temporary URL has expired.
3. Keep a **"media unavailable" state** so a missing or expired asset never hides the Ad's performance row.
4. **Do not store original image/video bytes in v1.** Meta's Platform Terms require deleting Platform Data
   once it is no longer necessary for the authorized purpose — the terms supply no general permanent-asset
   license. Persistent asset copying needs a product/legal decision on authorization, retention, deletion,
   and security first.

Permissions: `ads_read` plus authorization to the ad account. **Do not request `ads_management`** merely
to display creative — the board never writes ([ADR 0005](../adr/0005-fleet-board-is-read-only.md)).

---

## 7. Aggregation and rollup

Every tree level above Ad — Ad Set, Campaign, and Ad Account — is a **SQL sum over child Ad rows**,
with ratios re-derived from the summed components rather than summed or averaged directly
([ADR 0010](../adr/0010-insights-stored-at-ad-grain-only.md),
[ADR 0019](../adr/0019-fleet-board-rollup-rules.md)).

- **Spend, Impressions, Clicks** — summed at every level. Clicks means Meta `inline_link_clicks`, not the
  broad engagement-click field; CTR is re-derived from the same count
  ([ADR 0024](../adr/0024-fleet-board-clicks-mean-inline-link-clicks.md)).
- **CTR, CPA, ROAS** — always recomputed from those sums. Never summed, never averaged.

### Zero denominators

CTR, CPA, and ROAS show a **blank (em dash), never `0` or `0%`**, whenever the denominator is zero — 0
impressions, 0 attributed actions, 0 spend — **at every level**. A zero-denominator
ratio is undefined, not zero; `0%` would read as "this performed at zero," which isn't what happened.
This also gives ROAS one uniform blank rule instead of two (its "no conversion tracking" nullability plus
a separate zero-spend case). ROAS extends that blank to a computed **zero numerator**: a ROAS of exactly
zero means no purchase value was recorded at all, which is an absent signal rather than a measured zero
return, and on a lead-generation fleet it otherwise fills every row with `0×`. This is a presentation
rule — the stored value stays the computed ratio. Spend of `0,00` is a real measurement and still renders
as a number.

CPA is also blank with a mixed-result-types explanation when a row's spend-contributing descendants use
different or unresolved canonical Meta action types. Total spend divided by purchases plus leads is not
a meaningful cost. CPA and ROAS follow each Ad Set's current Meta Ads Manager attribution setting rather
than a forced Fleet Board-wide window ([ADR 0025](../adr/0025-kpis-follow-meta-ad-set-attribution.md)).

### Partial ROAS tracking

### Account health

Health Color and Health Reason are properties of each Ad Account. Hierarchy rows leave Health empty and
show Meta's effective status instead; no Client health is computed or returned.

### Running rollup

An Ad is **Running** when Meta reports `effective_status = ACTIVE`; this is effective configuration, not
proof of current impression delivery. A parent row is Running if **any** child is Running, recursively up
the tree — not a stricter all-children rule.

### Currency

An Ad Account's amount owed is not a KPI and has no per-level rollup — interior Campaign / Ad Set / Ad rows
carry none. Client currency is metadata used only to identify accounts in the Client filter; the Fleet Board
does not sum money or KPIs across a Client or convert between account currencies.

### Collapse vs. filter

**Collapsing never changes a number** — expand state is purely a rendering toggle. **Filtering does**: a
parent's rollup sums only its currently filtered-in children.

Hiding non-Running interior rows belongs to the **collapse** family, not the filter family: it hides
Campaign / Ad Set / Ad rows from display and never changes any parent's numbers. It exists because
expanding View Depth otherwise floods the table with paused rows when the buyer asked to see what is
running. It never hides Ad Account roots, which stay governed by the root filters above, and it
is URL-encoded like every other view control, defaulting to off. Framing it as a filter would contradict
§4's rule that filtering applies to roots only.

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

| Data                                                                                                                | Grain                       | Cadence                    | Notes                                                 |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------- | ----------------------------------------------------- |
| Ad Account baseline (`account_status`, `disable_reason`, `is_prepay_account`, `balance`, currency, `timezone_name`) | Ad Account                  | **Account Tier — 5 min**   | Cheap baseline reads, not Insights calls.             |
| Campaigns running / not running                                                                                     | Campaign                    | **Account Tier — 5 min**   | Own column, distinct from Health Color.               |
| The tree (Campaign / Ad Set / Ad)                                                                                   | per object                  | Account Tier               | Synced and **soft-deleted**, never fetched on expand. |
| Insights (spend, impressions, `inline_link_clicks`, raw `actions` / `action_values`)                                | **Ad × account-local date** | **Insights Tier — 1 hour** | Every other level is a computed rollup.               |

**Insights are stored at Ad grain only.** One row per (Ad, date), keeping the **raw `actions` /
`action_values` arrays** so CPA can resolve the Ad Set's canonical `action_type` _at read time_ rather
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
- Insights history is **daily rollups, not write-once**. The current account-local day plus the prior 28
  complete days form the **Reconciliation Window** and keep being re-polled and overwritten on every
  Insights Tier cycle because
  Meta documents that a settled day's number can still move — an advertiser editing an ad set's
  attribution setting, or a platform-wide attribution change
  ([ADR 0014](../adr/0014-daily-history-with-a-rolling-reconciliation-window.md)). A day older than the
  window is stored as-is and never re-checked; that residual drift risk is **accepted, not engineered
  around**.
- **First-connect backfill reaches the earlier of the account-local month start or 28 days before today**
  ([ADR 0015](../adr/0015-first-connect-backfill-to-start-of-calendar-month.md)). Budget Exhausted tracks
  a Client's actual month-to-date spend, so an account connected on the 20th would silently under-report
  the first 19 days — a Budget could already be exhausted with the board showing otherwise — while the
  earlier boundary keeps the Reconciliation Window and Last 7 days complete across month boundaries.

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

| Tier              | Target        | Covers                                                    | Why                                                                                                                                                   |
| ----------------- | ------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account Tier**  | **5 minutes** | Account Health, money owed, campaigns running/not running | A blocked account or stopped campaign is a break the media buyer needs to catch fast. Cheap baseline reads.                                           |
| **Insights Tier** | **1 hour**    | Spend and the KPIs                                        | Tolerable because no persona watches continuously. Insights calls compete against the undocumented backend throttle that is the fleet's real ceiling. |

A single uniform interval would either poll Account Tier data too slowly to catch a break, or poll
Insights needlessly often against the more constrained budget. **The split is hard to unwind** — the sync
architecture (two loops, two schedules, per-tier timestamps) assumes it.

### Staleness is shown, not silent

The board header displays the **oldest successful refresh among currently visible Ad Accounts** for each
tier, so one failed account cannot hide behind a newer fleet timestamp. An Ad Account that has **never**
successfully synced a tier is **excluded** from that tier's oldest-refresh calculation rather than nulling
it, and is instead reported as its own per-tier count — "nothing has synced" and "one new account has not
synced yet" are different facts and must read differently. The tier timestamp is empty only when no
visible Ad Account has ever synced it, which is the one case where «ще не синхронізовано» is the truth.
The rule is a pure function in the Fleet Board domain module alongside the health and rollup rules; the
read model calls it. Each stale or failed account is also marked individually. Account Tier becomes Stale after 10 minutes and Insights Tier after 2 hours —
twice their target cadence. The UI shows a generic Ukrainian failure message; raw Meta errors stay in
server logs.

### Provisional is not staleness

**Provisional** is the state of an aggregate containing any day inside the Reconciliation Window. It is
tracked and surfaced **separately from staleness**: a Provisional number can be freshly polled and still
change. An aggregate is Final only when every included day has aged out. Because all three v1 Time Ranges
include today, the UI shows one range-level Ukrainian notice instead of repeating a badge in every cell.

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

## 11. External dependencies and follow-up work

These do not change the Fleet Board core defined above, but each needs its own delivery decision or
validation gate.

1. **Onboarding.** How an Agency connects a Meta Business Manager and maps discovered Ad Accounts onto
   Adomata Clients. It creates the pending state and blocks real-flow Playwright setup
   ([ADR 0017](../adr/0017-meta-mock-testing-stops-at-the-sync-layer-for-now.md)). The board is developed
   against the existing fake roster and API/component tests until this exists.
2. **Reconnection.** How an access-lost Ad Account returns to pending. Without it, the board correctly
   surfaces the account under Needs Attention but cannot repair access.
3. **Budget on the board.** Whether Client rows surface Adomata Budget / Budget Exhausted beside Meta
   data. Budget remains in the domain but outside this board delivery.
4. **Creative comparison.** Cross-Ad ranking needs a durable cross-Ad Creative identity and validation
   of dynamic-creative breakdowns. The three complete views display identical Creative data; they do not
   rank assets or assign per-asset results.
5. **Per-persona defaults and visibility.** Every User still sees every Client in the active Agency. Saved
   presets, role-based defaults, and Client-level scoping remain separate work.
6. **Real Meta validation.** Access to a real agency Business Manager
   ([#3](https://github.com/todorone/adomata/issues/3)) is required before production release to verify
   Ad Account ID normalization, `balance` denomination/display, result-action mapping, pagination,
   account timezone behavior, video `source`, temporary media refresh, and asset-feed shapes. No code may
   guess the undocumented `balance` scale.
7. **Post-interview view consolidation.** Tree, Control Room, and Signals remain complete during
   evaluation. Structured interviews use equivalent tasks and URL-addressed views without adding an
   analytics system. A follow-up ADR chooses the new default, retains only distinct workflows, and
   deletes redundant views.

---

## Provenance

| Section                          | Settled by                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 personas, scope               | [interview](../interviews/2026-07-25-agency-owner-fleet-dashboard.md), [#9](https://github.com/todorone/adomata/issues/9)                                                                                                                                                                                                                     |
| §2 hierarchy, Client metadata    | [#10](https://github.com/todorone/adomata/issues/10), ADR [0004](../adr/0004-better-auth-organization-naming-stays-vendor-internal.md) · [0006](../adr/0006-ad-account-belongs-to-exactly-one-client.md) · [0007](../adr/0007-creative-is-a-property-of-an-ad-not-a-tree-level.md)                                                            |
| §3 traffic light                 | [#11](https://github.com/todorone/adomata/issues/11), [ADR 0018](../adr/0018-account-health-is-color-plus-reason-not-color-alone.md), [health research](../research/2026-07-25-meta-ad-account-health-and-money-owed.md)                                                                                                                      |
| §4 complete views, depth, scale  | [#13](https://github.com/todorone/adomata/issues/13), [ADR 0026](../adr/0026-fleet-board-ships-three-complete-views-for-evaluation.md)                                                                                                                                                                                                        |
| §5 KPI, Time Range, URL controls | [#14](https://github.com/todorone/adomata/issues/14), ADR [0020](../adr/0020-fleet-board-metric-selection-is-url-encoded-not-stored.md) · [0023](../adr/0023-fleet-board-time-ranges-are-account-local.md) · [0024](../adr/0024-fleet-board-clicks-mean-inline-link-clicks.md), [insights research](../research/insights-metrics-by-level.md) |
| §6 Creative detail               | [#16](https://github.com/todorone/adomata/issues/16), [ADR 0027](../adr/0027-creative-presentation-is-native-to-each-fleet-board-view.md), [#7 creative research](../research/2026-07-25-meta-creative-retrieval.md)                                                                                                                          |
| §7 rollup                        | [#15](https://github.com/todorone/adomata/issues/15), ADR [0010](../adr/0010-insights-stored-at-ad-grain-only.md) · [0019](../adr/0019-fleet-board-rollup-rules.md) · [0025](../adr/0025-kpis-follow-meta-ad-set-attribution.md)                                                                                                              |
| §8 data architecture             | [#12](https://github.com/todorone/adomata/issues/12) · [#18](https://github.com/todorone/adomata/issues/18) · [#19](https://github.com/todorone/adomata/issues/19), ADR 0009–0017, [rate-limit research](../research/2026-07-25-meta-api-rate-limits-fleet-refresh.md)                                                                        |
| §9 freshness                     | [#8](https://github.com/todorone/adomata/issues/8), [ADR 0008](../adr/0008-two-tier-freshness-for-fleet-board.md)                                                                                                                                                                                                                             |
| §10 non-goals                    | [map #2](https://github.com/todorone/adomata/issues/2) Out-of-scope, [ADR 0001](../adr/0001-meta-only-for-v1.md) · [0005](../adr/0005-fleet-board-is-read-only.md)                                                                                                                                                                            |
| §11 dependencies                 | [map #2](https://github.com/todorone/adomata/issues/2), [ADR 0017](../adr/0017-meta-mock-testing-stops-at-the-sync-layer-for-now.md), [ADR 0026](../adr/0026-fleet-board-ships-three-complete-views-for-evaluation.md)                                                                                                                        |

The earlier prototype-only decisions in ADR 0021 and ADR 0022 are superseded by ADR 0026 and ADR 0027.
Tree, Control Room, and Signals now ship as complete views for equivalent-task user interviews, not as
throwaway prototypes or unequal feature subsets.
