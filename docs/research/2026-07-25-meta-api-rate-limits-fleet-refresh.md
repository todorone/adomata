# Meta API rate limits and the cost of a fleet-wide refresh

Research for [GitHub issue #6](https://github.com/todorone/adomata/issues/6). Question: for a fleet of
30–150 Meta Ad Accounts (each with a Campaign → Ad Set → Ad tree), what do Meta's rate limits allow, and
what is the cheapest read pattern for a fleet-wide refresh?

All claims below are sourced from Meta's own developer documentation (`developers.facebook.com`), fetched
directly and cited inline. Where a fact could not be confirmed on a primary Meta page, it is called out in
the [Open questions](#open-questions--unconfirmed-numbers) section instead of being stated as fact.

## Summary — the numbers the data-architecture decision hangs on

- **Calls per full 150-account refresh: roughly 300–750 calls**, not tens of thousands. Using the
  read pattern below, each ad account costs **2–5 API calls** per refresh: one call (with field
  expansion / pagination) for the campaign→ad-set→ad structure, plus one paginated `GET .../insights`
  call per KPI "level" needed (e.g. one call with `level=ad` returns a row for *every* ad in the account
  in one paginated response — not one call per ad). 150 accounts × ~3–5 calls ≈ 450–750 calls per full
  refresh cycle.
- **Minimum viable refresh interval: cannot be pinned to a hard published number.** The per-ad-account
  Business Use Case (BUC) quotas are generous enough (tens of thousands to hundreds of thousands of
  "points" per hour per account, see [Q2](#2-does-the-limit-scale-with-spend-tier)/[Q5](#5-practical-arithmetic-for-a-150-account-fleet))
  that they are not the binding constraint for a KPI-only refresh at fleet scale. The actual ceiling is an
  **undocumented, adaptive, app-wide backend-capacity throttle** on the Insights endpoints
  (`backend_qps` / `complexity_score`, reported via the `x-fb-ads-insights-throttle` header) that Meta
  explicitly says to back off from rather than plan against with a fixed number
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/),
  [Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)).
  Given that, treat **5–15 minutes as a practical floor for KPI-level refresh**, with the full
  structural tree (campaign/ad-set/ad names, status, creative) reconciled on a slower cadence (e.g.
  hourly), and use the response headers to throttle adaptively rather than trusting a static interval.
- **Recommended read pattern**: synchronous `GET /act_<AD_ACCOUNT_ID>/insights?level=ad` (or
  `level=campaign` / `level=adset` depending on the dashboard's current expand depth) for KPI data — one
  call returns every object at that level in one paginated response
  ([Ad Account insights reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)).
  Use field expansion (`fields=campaigns{adsets{ads{...}}}`, which Meta documents as having **no limit on
  nesting depth**) or the flat per-level list edges for structure/status. Reserve the **async**
  `POST .../insights` + polling pattern only for date ranges/breakdowns that would time out synchronously
  — it is the exception, not the default loop.

---

## 1. How rate limiting actually works for the Marketing API

Meta layers **several independent rate-limit buckets** on top of each other for Marketing API traffic:

- **Platform (app-level) rate limits**: tracked per app, formula `calls per hour = 200 × number of
  users` where "users" is the app's unique daily active user count (falling back to weekly/monthly
  counts in low-engagement periods). This is an aggregate cap, not per-user.
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))
- **Platform (user-level) rate limits**: tracked per user across all apps using a user access token;
  Meta does not disclose the actual call-count values ("for privacy reasons").
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))
- **Business Use Case (BUC) rate limits**: applied specifically to the Marketing API, Instagram
  Platform, and Pages API when using page/system-user tokens (the pattern an agency SaaS like Adomata
  would use). Each ad account gets its own budget per BUC "type" (`ads_management`, `ads_insights`,
  `custom_audience`, etc.) on a **rolling one-hour window**, computed from a formula (see
  [Q2](#2-does-the-limit-scale-with-spend-tier)).
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))
- **Ad-account-level API scoring** (documented as applying to Ads API v3.3 and older, i.e. the
  predecessor to the BUC system above): a real-time score where a read call = 1 point and a write call
  = 3 points; Development tier caps at score 60 with a 300-second decay and a 300-second block on
  exhaustion; Full-access tier caps at score 9000 with a 300-second decay and a 60-second block.
  ([Marketing API rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/))
- **Ad-account-level QPS limits on mutations**: 100 requests/second per (app, ad account) pair, but only
  for create/edit endpoints (campaigns, ad sets, ads) — not relevant to a read-only refresh loop.
  ([Marketing API rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/))
- **A separate, application-level "Ads Insights Platform" throttle**: described as governed by backend
  infrastructure capacity rather than a fixed formula. When triggered it blocks *all* Insights API calls
  for the app (not just one ad account). Meta names two contributing "stability metrics":
  `backend_qps` (actual vs. allotted queries/sec) and `complexity_score` (query cost, driven by date
  range width, object-ID count, breakdowns, and metrics requested) — recommending narrower date ranges,
  fewer object IDs/breakdowns, and spacing queries out rather than giving a numeric ceiling.
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))

**Headers Meta returns to report usage:**

| Header | Fields | Scope |
| --- | --- | --- |
| `X-App-Usage` | `call_count`, `total_cputime`, `total_time` (all % of hourly allotment) | App-level platform limit |
| `X-Ad-Account-Usage` | `acc_id_util_pct`, `reset_time_duration` (seconds to reset), `ads_api_access_tier` | Ad-account limit (v3.3-and-older scoring system) |
| `X-Business-Use-Case-Usage` | Per business-id array of `{type, call_count, total_cputime, total_time, estimated_time_to_regain_access, ads_api_access_tier}` | BUC limits, keyed by use-case type |
| `X-FB-Ads-Insights-Throttle` | `app_id_util_pct`, `acc_id_util_pct`, `ads_api_access_tier` | Insights-specific app/account throttle |
| `X-Fb-Ads-Insights-Reach-Throttle` | Reach-specific utilization | Reach-breakdown-specific throttle |

(Sources: [Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/),
[Marketing API rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/),
[Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))

**Behavior on exhaustion:**

- HTTP error body shape: `{"error": {"message": "...", "type": "OAuthException", "code": <N>, "fbtrace_id": "..."}}`.
- Common codes: `4` (app-level platform limit, no subcode), `17` subcode `2446079` (account-level limit,
  v3.3-and-older), `613` subcode `5044001` (mutation QPS exceeded), `613` subcode `1487742` (too many
  ad-account calls), `613` with no subcode (generic abuse-prevention throttling), `80000`/`80001`/`80003`/
  `80004`/`80008`/`80009`/`80014` (BUC limits per use-case type — Insights/Pages/Custom Audience/Ads
  Management/Ads API v3.3+/Catalog/WhatsApp respectively), `32` (Pages, user token).
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/),
  [Marketing API rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/))
- Block duration: Development tier blocks 300 seconds; Full-access tier blocks 60 seconds (v3.3-and-older
  ad-account scoring system). For BUC limits, the `estimated_time_to_regain_access` field in
  `X-Business-Use-Case-Usage` reports how long until access is restored.
  ([Marketing API rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/))
- Meta's stated best practice: stop calling once a limit is reported as reached (continuing to call
  extends the recovery time), use exponential backoff, and monitor the usage headers proactively rather
  than waiting for a 4xx.
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))

## 2. Does the limit scale with spend tier?

**No official spend-based formula exists in current primary docs.** What Meta actually documents:

- **App-wide access tier** (currently named "Standard Access" vs. "Advanced Access" in some doc
  snapshots, and "Limited Access" vs. "Full Access" in others — Meta appears to have renamed this more
  than once) is earned by **API call volume and reliability**, not spend: an app needs "at least 500
  successful Marketing API calls in the last 15 days" and an error rate below 15% across its last 500
  calls to reach the higher tier. Ad account spend is not mentioned as a qualifying factor anywhere on
  this page. ([Marketing API access](https://developers.facebook.com/docs/marketing-api/access))
- Historically (2014), Meta's original three-tier system (Development → Basic → Standard, capped at 5
  and 25 ad accounts respectively before becoming unlimited) was gated on **API integration maturity and
  a business review**, not on ad account spend either.
  ([Introducing Ads API Access Levels, 2014](https://developers.facebook.com/blog/post/2014/10/22/introducing-ads-api-access-levels/))
- What *does* scale per-ad-account is the count of **active objects in that account**, which is a proxy
  correlated with size but is explicitly "Active ads" / "Active audiences," not spend:
  - `ads_management`: `300 + 40 × Active ads` per hour (Standard/Limited access) or `100,000 + 40 ×
    Active ads` (Advanced/Full access).
  - `ads_insights`: `600 + 400 × Active ads − 0.001 × User Errors` per hour (Standard/Limited) or
    `190,000 + 400 × Active ads` (Advanced/Full).
  - `custom_audience`: `5,000 + 40 × Active audiences` per hour (Standard/Limited, capped at 700,000) or
    `190,000 + 40 × Active audiences` (Advanced/Full).
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))

**Conclusion for the issue's premise**: a fleet of 150 small accounts and a fleet of 150 high-spend
accounts do *not* get meaningfully different quotas from Meta's documented mechanics, except indirectly
through the `Active ads` term — and a higher-spend account with more running ads does get a somewhat
larger `ads_management`/`ads_insights` budget than a dormant one under the same formula. There is no
separate "spend-tier multiplier" Meta publishes; treat any claim of one as unconfirmed/secondary (see
[Open questions](#open-questions--unconfirmed-numbers)).

## 3. Batch requests, `?ids=`, and field expansion

- **Batch requests**: capped at **50 operations per batch** call. Each call inside the batch is
  **counted individually** against every rate-limit bucket — "a batch of 10 API calls will count as 10
  calls," with no discount for batching. The benefit of batching is fewer HTTP round-trips and
  parallel/dependent execution ordering, not a rate-limit discount. Marketing API batches also have a
  documented structural restriction: they cannot include multiple ad sets under the same campaign in one
  batch. ([Graph API: Making Multiple Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests))
- **`?ids=` multi-object reads**: syntax is `GET /?ids=<id1>,<id2>,...`. Meta's own FAQ example states
  plainly: `GET https://graph.facebook.com/photos?ids=4,5,6` **is 3 API calls**, i.e. each ID in the
  list counts separately against rate limits — same non-discount behavior as batching.
  ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))
- **Field expansion** (nesting edges inside one request, e.g.
  `?fields=campaigns{adsets{ads{name,status}}}`, with `.limit(n)` on any level to bound result size):
  Meta states explicitly **"there is no limitation to the amount of nesting of levels that can occur
  here."** However, the same page adds an important caveat: **"Certain resources, including most of
  Marketing API, are unable to utilize field expansion on some or all connections"** — meaning the
  campaign→ad-set→ad chain should be validated empirically per edge rather than assumed to fully nest.
  ([Graph API: Field Expansion](https://developers.facebook.com/docs/graph-api/guides/field-expansion/))
- **The real collapsing mechanism for KPI reads is not field expansion — it's the Insights `level`
  parameter.** `GET /act_<AD_ACCOUNT_ID>/insights?level=ad` returns **one row per ad for every ad in the
  account**, paginated, in a single call — confirmed on the ad-account insights reference page. The same
  applies to `level=campaign` and `level=adset`. This means KPI data for an entire account's ad tree can
  be fetched in one paginated call per level, regardless of how many campaigns/ad sets/ads exist.
  ([Ad Account insights reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/))
- Pagination itself: Meta documents `limit` as "the maximum number of objects that *may* be returned"
  but does not give a universal default or maximum — "some edges may also have a maximum on the `limit`
  value for performance reasons," varying by endpoint (unconfirmed as a single number; see
  [Open questions](#open-questions--unconfirmed-numbers)).
  ([Graph API: pagination](https://developers.facebook.com/docs/graph-api/results))

## 4. Async insights jobs vs. synchronous reads

- Meta's stated default: **"Try sync calls first and then use async calls in cases where sync calls
  timeout."** Sync `GET .../insights` calls risk out-of-memory or timeout errors on large data volumes;
  async is recommended (not strictly required by a hard published threshold) once that risk appears.
  ([Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))
- **One explicit hard trigger is documented**: applying breakdowns to `reach` values on data **older
  than 13 months** requires the async path, and is additionally capped at **10 requests per ad account
  per day** for that specific case.
  ([Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))
- Async mechanics: `POST` to an ad object's `/insights` edge (account, campaign, ad set, or ad) returns
  a `report_run_id`; poll the `async_status` field until it reads `"Job Completed"` with
  `async_percent_completion: 100` (other states: Job Not Started, Job Started, Job Running, Job Failed,
  Job Skipped). An async job **can take up to an hour to complete**, including Meta's own internal
  retries. The `report_run_id` **expires after 30 days** and should not be persisted long-term.
  ([Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))
- Meta does not publish polling-interval guidance (no "poll every N seconds" number found).
- **No general concurrent-async-job-per-account cap is documented** beyond the specific 10/day
  reach-breakdown case above — flagged as an open question below.
- Rate limiting applies to sync and async `/insights` calls **combined** against the same app- and
  ad-account-level buckets — async does not carve out a separate quota.
  ([Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))
- Query-splitting guidance Meta gives to avoid needing async at all: avoid account-level queries with
  high-cardinality breakdowns (e.g. `action_target_id`, `product_id`) combined with wide date ranges;
  request "unique metrics in a separate call"; prefer querying at the lower-level object directly over
  broad account-wide requests when possible.
  ([Insights best practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))
- Breakdown combinations are restricted to a fixed table of permitted permutations ("due to storage
  constraints, only some permutations of breakdowns are available"), with specific incompatibilities
  called out (e.g. `video_*` fields cannot combine with hourly-stats breakdowns).
  ([Insights breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/))

## 5. Practical arithmetic for a 150-account fleet

Using the read pattern established above (sync `GET .../insights?level=...` for KPIs, one call per level
per account; field-expansion or flat list edges for structure), here is the call budget:

**Per-account cost, per refresh:**

| Purpose | Calls | Basis |
| --- | --- | --- |
| Structure (campaigns → ad sets → ads: names, status, ids) | 1 (+ 1 per ~page of results if the account has enough objects to paginate) | Field expansion / flat list edges, unbounded nesting depth documented |
| KPI insights, e.g. at ad level | 1 (+ 1 per page) | `level=ad` returns every ad's row in one paginated call |
| KPI insights rolled up at campaign/ad-set level (for the "brief"/"expand a level" dashboard views) | 1–2 more, only if a different `level` or breakdown set is needed than what's cached from the ad-level pull | `level=campaign` / `level=adset` |

Call it **2–5 calls per account** depending on how many of the dashboard's "view depths" need distinct
`level`/breakdown combinations. For 150 accounts:

```
150 accounts × 2 calls (minimum: 1 structure + 1 insights)  =   300 calls
150 accounts × 5 calls (structure + 3 insight levels + 1 pagination overflow) = 750 calls
```

**Headroom against documented quotas**: even at the low (Standard/Limited-access) `ads_insights` BUC
formula of `600 + 400 × Active ads` per hour **per ad account**, a single account making ~5 insights
calls in a refresh cycle is nowhere near its own hourly budget unless it has an unusually large number of
active ads relative to that base. The binding constraint is not the per-account BUC math — it's the
undocumented app-wide Insights backend-capacity throttle described in
[Q1](#1-how-rate-limiting-actually-works-for-the-marketing-api), which applies across the whole fleet at
once, not per account, and for which Meta gives no closed-form number.

**Minimum viable refresh interval — reasoning, not a guarantee:**

- 300–750 calls spread across, say, a 5-minute refresh window is 1–2.5 calls/second sustained — trivial
  next to the *documented* per-account QPS mutation limit of 100/sec (which doesn't even apply to reads)
  and nowhere near the lowest published BUC hourly base (300–600 per account per hour).
- The actual pacing risk is the **complexity_score** / **backend_qps** stability throttle on Insights
  specifically, which Meta says is driven by date-range width, object-ID count, breakdowns, and metrics
  per call — all of which argue for **narrow, per-level, unbroken-down calls** (exactly the pattern
  above) rather than wide account-level calls with many breakdowns.
- Given Meta explicitly declines to publish a numeric ceiling for that throttle and instead says to
  monitor `x-fb-ads-insights-throttle` and back off adaptively, **the only defensible "floor" is
  operational, not arithmetic**: start conservative (e.g. every 5–15 minutes for KPI-only refreshes,
  hourly for full structural reconciliation), watch the usage-percentage headers on every response, and
  have the refresh loop widen its own interval automatically as utilization approaches 100%, rather than
  hard-coding a single "safe" number into the architecture.

## 6. Webhooks / change notifications

- The Graph API Webhooks Reference lists exactly **nine subscribable top-level object types**: **Ad
  Account, Application, Catalog, Instagram, Managed Meta Account, Page, Permissions, User, WhatsApp
  Business Account.** ([Webhooks reference](https://developers.facebook.com/docs/graph-api/webhooks/reference))
- The **Ad Account** webhook object's subscribable fields are: `ads_async_creation_request`,
  `creative_fatigue`, `ad_recommendations`, `in_process_ad_objects`, `product_set_issue`,
  `with_issues_ad_objects`. **None of these cover spend, insights/performance metrics, budget changes, or
  campaign/ad-set/ad state changes** — they're limited to async-creation-job status, creative-fatigue
  warnings, recommendation nudges, processing status, and catalog/product-set issues.
  ([Webhooks reference: Ad Account](https://developers.facebook.com/docs/graph-api/webhooks/reference/ad-account))

**Confirmed conclusion**: fleet-wide spend/KPI monitoring is **poll-only**. Meta's webhook surface for
ad accounts is operational/status signaling, not a substitute for polling insights or budget/spend data —
there is no push mechanism that would reduce the refresh-loop call volume computed above.

## Open questions / unconfirmed numbers

These could not be pinned to an unambiguous primary-doc statement and should not be treated as settled:

- **No numeric ceiling for the "Ads Insights Platform" backend-capacity throttle** (`backend_qps`,
  `complexity_score`). Meta describes the *existence* and *contributing factors* of this throttle but
  publishes no formula or threshold — this is the single biggest reason the "minimum viable refresh
  interval" above is a recommendation, not a guarantee.
- **No general concurrent-async-insights-job cap per ad account** is documented, aside from the specific
  "10 requests/day" limit for reach breakdowns on data older than 13 months. Whether there's an implicit
  concurrency cap for ordinary async jobs is not stated in primary docs; community forum threads discuss
  this but were excluded here as secondary sources.
- **Default/maximum pagination `limit` (page size)** is explicitly stated by Meta to vary "by endpoint
  for performance reasons," with no single universal number given — the exact page size for
  `/insights` or the campaign/ad-set/ad list edges specifically was not found on a primary page during
  this research pass.
- **Whether field expansion fully nests through the Marketing API's campaign→ad-set→ad edges** is
  ambiguous: Meta's own Field Expansion doc says nesting depth is unlimited in general, but in the same
  breath warns "most of Marketing API" cannot use field expansion on "some or all connections," without
  naming which connections are excluded. Treat as needing empirical verification against Adomata's
  actual account structures before relying on it architecturally.
- **The exact unit and reliability of `estimated_time_to_regain_access`** (in `X-Business-Use-Case-Usage`)
  is described as a time-to-recovery signal but the doc excerpts fetched did not pin down its unit with
  full certainty in every version of the page.
- **Correspondence between the 2014-era tier names (Development/Basic/Standard) and the current
  Standard/Advanced (a.k.a. Limited/Full) access tiers** is not documented in one continuous page — the
  2014 blog post is historical context only and should not be read as describing current mechanics.
- The claim in the issue prompt that "Meta has historically tied ad account rate limits to a
  ... spend-based multiplier" could not be substantiated on any primary page found, including the 2014
  historical post — flagging this explicitly as **not confirmed**, and likely a conflation with the
  `Active ads`/`Active audiences` object-count scaling that does exist (see [Q2](#2-does-the-limit-scale-with-spend-tier)).
