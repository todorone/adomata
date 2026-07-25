# Insights API metric vocabulary by level: Campaign / Ad Set / Ad

Research for [GitHub issue #5](https://github.com/todorone/adomata/issues/5). Question: what does Meta's
Marketing API Insights endpoint actually expose at Campaign vs. Ad Set vs. Ad level, how do the fixed KPIs
(`CONTEXT.md`: Spend, Impressions, Clicks, CTR, CPA, ROAS) map onto real Insights fields, and which of them
are safe to roll up the tree (Ad → Ad Set → Campaign) without re-fetching.

All claims below are sourced from Meta's own developer documentation (`developers.facebook.com`) and, for
one structural claim about how fields are organized, Meta's own official Python Business SDK source
(`facebook/facebook-python-business-sdk`, auto-generated from Facebook's API spec) — cited inline at the
point of the claim, with the API version the page displayed at fetch time. The pages fetched consistently
showed **v25.0** in examples/version selectors, except where an older snapshot is called out explicitly
(some default-value and field-reference facts drifted across the v2.5–v9.0 doc history, noted where found).
Anything that could not be pinned to an unambiguous primary sentence is in
[Open questions / caveats](#open-questions--caveats) instead of being stated as fact.

## Summary

- **The metric vocabulary is not actually different per level.** Campaign, Ad Set, and Ad insights are all
  the *same* underlying `AdsInsights` field object, requested via a `level` parameter (`account`,
  `campaign`, `adset`, `ad`) rather than four separate field sets — confirmed structurally in Meta's own
  SDK source ([`adsinsights.py`](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py):
  one `Field` class, one `Level` enum with exactly `account`/`campaign`/`adset`/`ad`) and empirically by
  fetching the per-object reference pages, which return the same performance fields (`spend`,
  `impressions`, `clicks`, `ctr`, `actions`, `action_values`, `cost_per_action_type`, `purchase_roas`,
  `frequency`, `reach`, `cpm`, `cpc`, `cpp`, …) at all three
  ([Campaign](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/insights/),
  [Ad Set](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign/insights),
  [Ad Account](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/) — all v25.0).
  What *does* differ per level is which **identifier/object-attribute fields** are populated and relevant
  (`campaign_id`/`campaign_name`/`objective`/`buying_type` at campaign level and above; `adset_id`/
  `adset_name`/`optimization_goal` at ad set level and above; `ad_id`/`ad_name` only meaningful at ad
  level) — not the performance-metric vocabulary itself.
- **Spend, Impressions, Clicks are additive**; **CTR, CPA, ROAS, and frequency are derived ratios** that
  must be recomputed from their (additive) components at whatever level is displayed — never summed or
  averaged directly. All the components needed for every derived KPI live on the same `AdsInsights` object,
  so **one `fields=` list on one request** gets everything needed to compute all six fixed KPIs at once —
  there is no separate call for `cost_per_action_type` vs. `spend`.
- **Reach is the sharp exception inside "additive."** Meta explicitly dedupes reach for audience overlap
  at the queried level, so a campaign's `reach` is *not* the sum (or even a simple union count you can
  derive) of its ad sets' `reach` values — it must be fetched directly at the display level, not rolled up.
  Frequency (`impressions ÷ reach`) inherits this same restriction.
- **Attribution windows are not fixed and historical numbers can move.** Per Meta's own best-practices
  page: *"Insights refresh every 15 minutes and do not change after 28 days of being reported"* and
  *"Insights metrics may continue to update for a couple of days after an ad has completed"*
  ([Insights best practices, v25.0](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)) —
  meaning a number shown on day 1 is provisional for up to 28 days. On top of that, Meta's own
  "attribution unification" change means the API increasingly defers to the ad set's *current*
  attribution setting in Ads Manager rather than a fixed per-request override, so the same historical date
  range can report different attributed actions after an advertiser edits attribution settings, not just
  because of settling — see [§4](#4-attribution-windows).
- **CPA and ROAS are not single fields** — they require choosing an `action_type` (e.g. `purchase`,
  `lead`) out of the `actions` / `action_values` / `cost_per_action_type` arrays, or (for `purchase_roas`)
  choosing which purchase-attribution variant, before the number means anything.
- **Batching is strictly one (object, level) scope per call.** A single `GET .../insights` request is
  scoped to one ad object and one level; multiple objects *of that type* come back in one paginated
  response (e.g. `level=ad` returns every ad in the account), but multiple *ad accounts* require one call
  per account, optionally bundled into the Graph API batch endpoint (max 50 sub-calls, each still counted
  individually against rate limits) or the async report-run job (also one object per job, just deferred).

---

## 1. Metric vocabulary per level

| Field / concept | Ad Account | Campaign | Ad Set | Ad |
| --- | --- | --- | --- | --- |
| `spend`, `impressions`, `clicks`, `reach`, `frequency`, `cpm`, `cpc`, `cpp`, `ctr` | yes | yes | yes | yes |
| `inline_link_clicks`, `inline_link_click_ctr` | yes | yes | yes | yes |
| `actions`, `action_values`, `cost_per_action_type` | yes | yes | yes | yes |
| `purchase_roas`, `website_purchase_roas`, `mobile_app_purchase_roas` | yes | yes | yes | yes |
| `account_id` / `account_name` | n/a (is the object) | inherited | inherited | inherited |
| `campaign_id` / `campaign_name` | via breakdown/expansion only | is the object | inherited | inherited |
| `objective`, `buying_type`, `deduping_ratio` | — | **campaign-level only** | — | — |
| `adset_id` / `adset_name`, `optimization_goal` | via breakdown/expansion only | — | is the object | inherited |
| `ad_id` / `ad_name` | via breakdown/expansion only | — | — | is the object |

Sources: [Ad Account insights reference (v25.0)](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/),
[Campaign insights reference (v25.0)](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/insights/),
[Ad Set insights reference (v25.0)](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign/insights),
[`adsinsights.py`, `facebook-python-business-sdk`](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py).

**Reading this table**: the performance-metric row (row 1–4) is identical across all four levels — this is
the single `AdsInsights` object Meta's own SDK defines once and queries via the `level` parameter, not four
distinct field sets (confirmed structurally: the SDK source has one `Field` class and a separate `Level`
enum with values `account`, `campaign`, `adset`, `ad` —
[`adsinsights.py`](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)).
The only real per-level difference is which **object-identity / object-attribute fields** are native to
that row: `objective`/`buying_type`/`deduping_ratio` are Campaign-object attributes exposed alongside its
insights row ("`buying_type`: the method by which you pay for and target ads in your campaigns",
"`objective`: the objective reflecting the goal you want to achieve",
"`deduping_ratio`: the total auction removal rate due to audience overlap" — all per the
[Campaign insights reference (v25.0)](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/insights/)),
and `optimization_goal` is an Ad-Set-object attribute ("the optimization goal you selected for your ad
set" — [Ad Set insights reference (v25.0)](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign/insights)).
Ad-level (`adgroup`) fields could not be fully re-fetched during this pass (see
[caveat](#4-ad-level-adgroup-insights-reference-page-could-not-be-retrieved-in-full) below) — its
row above is inferred from the unified SDK field object rather than directly read off its own reference
page, and should be spot-checked before this table is relied on architecturally.

**Product implication**: because the *performance* vocabulary is identical at every level, the fixed KPIs
(Spend, Impressions, Clicks, CTR, CPA, ROAS) are all requestable identically no matter which level the
dashboard is currently expanded to — the "fast toggle" only needs to know *which fields to add to one
`fields=` list*, not switch field names per depth.

## 2. Fixed KPIs mapped onto real Insights fields

| KPI | Real field(s) | Notes |
| --- | --- | --- |
| **Spend** | `spend` | "The estimated total amount of money you've spent on your campaign, ad set or ad" — single, unambiguous, additive. ([Ad Account insights reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)) |
| **Impressions** | `impressions` | "The number of times your ads were on screen" — single, unambiguous, additive. (same source) |
| **Clicks** | `clicks` **vs.** `inline_link_clicks` **vs.** `unique_clicks` | **Ambiguous — flag for the spec.** `clicks` is described as "the number of clicks on your ads" with `ctr` defined as "...performed a click (**all**)" (same source) — i.e. `clicks`/`ctr` count *every* click type (likes, comments, shares, photo-viewer opens, not just outbound link clicks), which inflates the number relative to what a media buyer usually means by "clicks." `inline_link_clicks` is scoped to "clicks on links to select destinations or experiences, on or off Facebook-owned properties" and explicitly uses "a fixed 1-day-click attribution window" regardless of the request's `action_attribution_windows` setting (same source) — a second, narrower attribution rule baked into this one field. `unique_clicks` appears as a valid field name in Meta's own SDK field enum ([`adsinsights.py`](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)) but its description could not be located on the current fields-table docs fetched in this pass — treat as needing empirical confirmation (possibly legacy/thin on current docs). **Recommendation for the spec**: decide explicitly whether "Clicks" means `clicks` (all engagement) or `inline_link_clicks` (link clicks only) — they are not interchangeable and Meta does not treat them as the same metric. |
| **CTR** | `ctr` **vs.** `inline_link_click_ctr` | `ctr` = "the percentage of times Accounts Center accounts saw your ad and performed a click (**all**)" — i.e. all-click CTR, paired with the `clicks` field above, **not** link-CTR. `inline_link_click_ctr` = "the percentage of time Accounts Center accounts saw your ads and performed an inline link click" — the link-CTR most people mean by "CTR" in a media-buying context. ([Ad Account insights reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)) Whichever "Clicks" definition is chosen above should drive which CTR field is used, to keep the two KPIs internally consistent (all-clicks CTR paired with `clicks`, or link-CTR paired with `inline_link_clicks`). |
| **CPA** | **Not a single field.** `cost_per_action_type` (or manually `spend ÷ actions[action_type=X]`) | `cost_per_action_type`: "the average cost of a relevant action" — returned as an **array of `{action_type, value}` objects**, one entry per action type Meta tracked for that row, not a scalar ([Ads Action Stats reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/)). "CPA" only means something once a specific `action_type` is chosen (e.g. `purchase`, `lead`, `omni_purchase`) — matching `CONTEXT.md`'s own definition ("Spend divided by the number of results Meta attributes to an ad"). The action-type vocabulary itself (`link_click`, `offsite_conversion.fb_pixel_purchase`, `mobile_app_install`, `landing_page_view`, `omni_purchase`, `onsite_conversion.messaging_conversation_started_7d`, etc.) is large and per-advertiser-configuration-dependent (same source) — the spec needs to pick (or let the agency configure) which `action_type` counts as "the" result for CPA purposes. |
| **ROAS** | `purchase_roas` (or `website_purchase_roas` / `mobile_app_purchase_roas` for narrower attribution) | "The total return on ad spend (ROAS) from purchases" ([Ad Account insights reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)) — already purchase-scoped, so unlike CPA it doesn't need an `action_type` choice, but it's still returned as an array (one entry per attribution window/breakdown requested) rather than a bare scalar, per the same array-of-objects shape documented for `actions`/`action_values`/`cost_per_action_type` on the [Ads Action Stats reference](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/). `website_purchase_roas` / `mobile_app_purchase_roas` narrow the same ratio to web-only or app-only purchases if the product ever needs that split. Matches `CONTEXT.md`'s ROAS definition and its "nullable — a Client without conversion tracking configured has no ROAS" note: if no purchase action/pixel is configured, this array is simply empty for that row. |

## 3. Additive vs. derived metrics

| Metric | Additive? | Recompute formula (when derived) | All components in one call? |
| --- | --- | --- | --- |
| Spend | **Additive** — sum children's `spend` to get the parent's. | — | — |
| Impressions | **Additive** — sum children's `impressions`. | — | — |
| Clicks (`clicks` or `inline_link_clicks`) | **Additive** — sum children's values. | — | — |
| `actions[action_type=X]` / `action_values[action_type=X]` raw counts/values | **Additive** (they are event counts/sums, not ratios) — sum children's per-action-type counts/values. | — | — |
| CTR | **Derived.** | `CTR = Σclicks ÷ Σimpressions` (or `Σinline_link_clicks ÷ Σimpressions` for link CTR) at the display level — never sum or average child CTR percentages directly. | Yes — `spend`/`impressions`/`clicks`/`ctr`/`inline_link_click_ctr` are all fields on the same `AdsInsights` object, one `fields=` list, one request. |
| CPA | **Derived.** | `CPA = Σspend ÷ Σactions[action_type=X]` at the display level. | Yes — `spend` and `actions`/`cost_per_action_type` come back on the same row of the same request; no second call needed. |
| ROAS | **Derived.** | `ROAS = Σaction_values[action_type=purchase] ÷ Σspend` at the display level. | Yes — `spend` and `action_values`/`purchase_roas` are fields on the same object, same request. |
| Frequency | **Derived, and *not* safely rollable up at all** — see reach caveat below. | `Frequency = impressions ÷ reach` — but only valid using `reach` fetched *at the display level*, not a rolled-up reach. | Yes, `impressions` and `reach` are on the same object/request — but the *rollup* itself is unsafe (next row). |
| Reach | Looks additive but **is not** — Meta deduplicates reach for audience overlap at the level queried. Campaign `reach` ≠ Σ ad-set `reach` (a person reached by two ads in the same campaign is one reach at campaign level, but would be double-counted if summed from below). The `deduping_ratio` field ("the total auction removal rate due to audience overlap," [Campaign insights reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/insights/)) exists precisely because of this overlap effect. | **Must re-fetch at the target level**, not recompute from children — there is no documented formula that reconstructs deduplicated reach from child-level reach values. | Fetch `reach` directly via `level=campaign` (or whatever level is displayed) rather than rolling up from `level=ad`. |

**Rollup implication for the fleet dashboard**: Spend, Impressions, and Clicks (and raw per-`action_type`
counts/values) can be safely summed client-side as the user expands/collapses the tree, with CTR/CPA/ROAS
recomputed from those same summed numbers at whatever level is displayed — no extra API call needed for
those. **Reach and Frequency are the one place this shortcut breaks**: they need a direct fetch at the
currently-displayed level whenever the toggle for them is on, because Meta's own deduplication makes a
"rolled-up" reach number simply wrong, not just imprecise.

## 4. Attribution windows

- `action_attribution_windows` is the parameter that sets which attribution window(s) apply to the
  `actions`/`action_values`/`cost_per_action_type`/`purchase_roas` fields for a given request. Valid values
  per Meta's own SDK enum: `1d_click`, `1d_ev`, `1d_sequenced`, `1d_view`, `7d_click`, `7d_sequenced`,
  `7d_view`, `7d_view_all_conversions`, `7d_view_first_conversion`, `28d_click`, `28d_sequenced`,
  `28d_view`, `28d_view_all_conversions`, `28d_view_first_conversion`, `custom`, `dda`, `default`,
  `incrementality`, `incrementality_all_conversions`, `incrementality_first_conversion`, `skan_click`,
  `skan_click_second_postback`, `skan_click_third_postback`, `skan_view`, `skan_view_second_postback`,
  `skan_view_third_postback` ([`adsinsights.py`](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)).
- **Default value has drifted across doc versions fetched in this pass** — treat as needing live
  verification against whichever API version Adomata actually targets: the current
  [Ad Account insights reference (v25.0)](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)
  states the default is `default`, meaning `["7d_click","1d_view"]`; an older snapshot found via search
  (v2.5-era) stated the default was `28d_click` + `1d_view`; another (v2.8-era) stated `["1d_view",
  "28d_click"]`. This is Meta having changed the default over time (plausibly tied to the 2018–2019
  attribution-window shortening after ad-tracking/regulatory changes), not a live ambiguity in the current
  API — but it means "the default" is not a stable fact to hard-code without pinning to Adomata's actual
  API version.
- Each element inside `actions` / `action_values` / `cost_per_action_type` can itself carry **per-window
  sub-values** — `1d_click`, `7d_click`, `28d_click`, `1d_view`, `7d_view`, `28d_view` (plus `_all_conversions`
  / `_first_conversion` variants) — when multiple `action_attribution_windows` values are requested at
  once, alongside `action_device`, `action_destination`, `action_target_id`, `action_carousel_card_name`,
  and `dda`/`incrementality`/`inline`/`custom` markers
  ([Ads Action Stats reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/)).
- **The sharp question — can the same historical number change later — is directly confirmed by Meta's
  own docs, in the affirmative.** Per the
  [Insights best practices page (v25.0)](https://developers.facebook.com/docs/marketing-api/insights/best-practices/):
  *"Insights refresh every 15 minutes and do not change after 28 days of being reported"* and separately
  *"Insights metrics may continue to update for a couple of days after an ad has completed."* Read together,
  this means a number pulled on day 1 for "yesterday" is **provisional for up to 28 days** — the same
  historical date range queried again a week later can legitimately return a different attributed-action
  count or value than it did on day 1, because attribution is still settling (click-through and
  view-through conversions can land after the fact, within their window). After 28 days, Meta's own
  wording implies the number is frozen.
- **A second, separate mechanism can move historical numbers even after the 28-day freeze**: the same
  best-practices page documents an "attribution unification" change (dated **June 10, 2025** in the page
  fetched) under which `use_unified_attribution_setting` and `action_report_time` request parameters "will
  be disregarded," and API responses instead "follow Ads Manager settings, including mixed attribution
  windows" — i.e., the ad set's *current* attribution configuration in Ads Manager, not a fixed per-request
  override. Practically: if an advertiser (or the agency, on the advertiser's behalf) changes an ad set's
  attribution setting in Ads Manager, a query for the *same historical date range* can report different
  attributed actions after that change than it did before — a second, config-driven source of "the same
  number looks different a week later," distinct from ordinary attribution settling. The precise cutover
  mechanics/versioning of this change were not fully pinned down from the pages fetched in this pass —
  flagged as an open question below.

## 5. Time range parameters

- **`date_preset`**: relative, named ranges — `today`, `yesterday`, `last_3d`, `last_7d`, `last_14d`,
  `last_28d`, `last_30d`, `last_90d`, `this_week_mon_today`, `this_week_sun_today`, `last_week_mon_sun`,
  `last_week_sun_sat`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`,
  `last_year`, `lifetime`, `maximum` (returns up to 37 months). **Default is `last_30d`** if no time
  parameter is given at all. ([Ad Account insights reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/))
- **`time_range`**: a custom range, `{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}`. (same source)
- **`time_increment`**: default `all_days` (one aggregated row for the whole range); `monthly`; or an
  integer `1`–`90` (daily or N-day buckets — each bucket comes back as its own row). (same source)
- **Cost/complexity guidance** (documented, but qualitative rather than a numeric multiplier — see
  [caveat](#5-no-numeric-complexity-multiplier-for-time_incrementdate-range-width) below): the
  [Insights best practices page (v25.0)](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)
  states *"Use `date_preset` if possible. Custom date ranges are less efficient to run in our system"* and
  *"Limit your query by limiting the date range or number of ad ids."* Meta ties query cost to a
  `complexity_score` "driven by date range width, object-ID count, breakdowns, and metrics requested" (per
  the same best-practices material this repo's [rate-limits research](2026-07-25-meta-api-rate-limits-fleet-refresh.md)
  already pulled from [Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)) —
  so a fine `time_increment` (e.g. `1`) over a wide range is exactly the kind of request this guidance
  warns against, even without Meta publishing an exact per-day cost number.
- For the fleet dashboard's fast-toggle use case (current-period KPI values, not historical trend charts),
  `date_preset` with `time_increment=all_days` (the default) is the cheapest, most efficient shape per
  Meta's own stated preference; reserve custom `time_range` + fine `time_increment` for a future
  trend/sparkline feature, not the toggle-level refresh loop.

## 6. Batching scope — request shapes

**A. Single level, single account (the base case, and what the fast-toggle refresh loop should use):**

```
GET /v25.0/act_<AD_ACCOUNT_ID>/insights
  ?level=ad                                  # or campaign / adset
  &fields=spend,impressions,clicks,inline_link_clicks,ctr,inline_link_click_ctr,
          actions,action_values,cost_per_action_type,purchase_roas,reach,frequency
  &date_preset=last_7d
  &action_attribution_windows=7d_click,1d_view
```

One call returns one paginated response with a row **per object at that level** (every ad in the account,
for `level=ad`) — not one call per object.
([Ad Account insights reference, v25.0](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/))

**B. Multiple levels (e.g. dashboard needs both the campaign-level rollup row and the ad-set rows beneath
an expanded campaign) — two separate requests, optionally bundled into one HTTP call via the Graph API
batch endpoint:**

```
POST /v25.0
  ?batch=[
      {"method":"GET","relative_url":"act_<AD_ACCOUNT_ID>/insights?level=campaign&fields=...&date_preset=last_7d"},
      {"method":"GET","relative_url":"act_<AD_ACCOUNT_ID>/insights?level=adset&fields=...&date_preset=last_7d"}
    ]
```

Batching is capped at up to 50 sub-calls per batch request, and **each sub-call is still counted
individually against every rate-limit bucket** — batching saves HTTP round-trips, not rate-limit budget
(confirmed by this repo's prior [rate-limits research](2026-07-25-meta-api-rate-limits-fleet-refresh.md#3-batch-requests-ids-multi-object-reads-and-field-expansion)
against [Graph API: Making Multiple Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests)).
There is no native "multi-level" Insights parameter — `level` takes exactly one value per call.

**C. Multiple ad accounts — one call per account; there is no native cross-account Insights query.**
Search-corroborated language from Meta's Insights documentation states plainly that if you manage multiple
accounts and want an aggregate, you query every account separately and sum client-side — this repo's fetch
of the [Insights API overview page](https://developers.facebook.com/docs/marketing-api/insights/) could not
surface that exact sentence verbatim in this pass (flagged as a sourcing caveat below), but the mechanical
conclusion is corroborated by the request shape itself: `/insights` is always an edge off *one* ad object
(`act_<ID>` / campaign / ad set / ad), never a list of IDs. In practice, for N ad accounts: N separate `GET
.../insights` calls, bundled up to 50-at-a-time into batch requests as in (B) if desired.

**D. Async / large-job Insights (report-run job) — same one-object-per-request scoping, just deferred:**

```
POST /v25.0/<AD_OBJECT_ID>/insights?level=ad&fields=...&time_range={...}&time_increment=1
  → { "report_run_id": "<ID>" }

GET /v25.0/<REPORT_RUN_ID>?fields=async_status,async_percent_completion
  → poll until async_status == "Job Completed" && async_percent_completion == 100

GET /v25.0/<REPORT_RUN_ID>/insights
  → the actual rows
```

Recommended only when a sync call would time out (wide date ranges, many breakdowns) — Meta's own
guidance is *"Try sync calls first and then use async calls in cases where sync calls timeout."* An async
job can take **up to an hour** to complete including Meta's internal retries, and the `report_run_id`
**expires after 30 days** and should not be persisted long-term.
([Insights best practices, v25.0](https://developers.facebook.com/docs/marketing-api/insights/best-practices/))
For the fleet dashboard's fast-toggle KPI use case (short date ranges, a handful of fields, no exotic
breakdowns), sync calls (shape A/B) should never need to fall back to this path — async is for
trend/export-style pulls, not the toggle refresh loop.

## Open questions / caveats

1. **Default `action_attribution_windows` disagrees across doc snapshots** (current v25.0-era page says
   `["7d_click","1d_view"]`; older v2.5/v2.8-era pages said `28d_click`+`1d_view` or `1d_view`+`28d_click`)
   — confirm live against Adomata's actual pinned API version before hard-coding a default in the spec.
2. **`unique_clicks` / `unique_ctr` / `unique_inline_link_clicks`** exist as field names in Meta's own SDK
   field enum but their descriptions could not be located in the current fields-table docs fetched in this
   pass — possibly thinly documented or drifting toward legacy status; confirm behavior empirically (e.g.
   against a live Graph API Explorer call) before relying on them for the Clicks KPI's ambiguity resolution
   in §2.
3. **Attribution-unification cutover mechanics** (the June 10, 2025 change disregarding
   `use_unified_attribution_setting`/`action_report_time` in favor of following Ads Manager's per-ad-set
   setting) is described in one paragraph on the best-practices page but its full before/after behavior,
   and which API versions it applies to, were not fully traceable from the pages fetched here — worth a
   dedicated follow-up read of Meta's dynamic-ads/attribution-setting docs before the spec leans on a
   specific historical-stability guarantee.
4. **Ad-level (`adgroup`) Insights reference page could not be retrieved in full.** Multiple fetch attempts
   against `developers.facebook.com/docs/marketing-api/reference/adgroup/insights/`,
   `developers.facebook.com/docs/graph-api/reference/adgroup/insights/`, and
   `developers.facebook.com/documentation/ads-commerce/marketing-api/reference/adgroup/insights` either
   404'd or returned truncated content during this research pass. The Ad row in the §1 table is inferred
   from the unified `AdsInsights` SDK field object rather than directly read off its own reference page —
   spot-check before treating it as equivalent-to-directly-confirmed.
5. **No numeric complexity multiplier for `time_increment`/date-range width** is published on any page
   fetched — Meta gives qualitative guidance ("limit date range or number of ids," "custom ranges are less
   efficient") and ties cost to a `complexity_score`, but no formula translating "N days of daily
   breakdown" into a concrete cost number was found.
6. **The "query every account separately, sum client-side" statement for multi-account aggregation** is
   well corroborated by independent web-search snippets pointing at
   `developers.facebook.com/docs/marketing-api/insights/`, but this pass's own direct `WebFetch` calls
   against that URL did not surface the exact sentence verbatim (the page appears to render differently
   across fetches, possibly A/B-tested or JS-assembled content) — the conclusion is very likely correct
   (it also matches the request-shape mechanics observed on every other Insights reference page fetched:
   `/insights` is always an edge off exactly one object), but flagging the sourcing gap honestly rather than
   presenting it as a directly-quoted primary fact.
7. **Several reference-page URLs 404'd inconsistently on repeated fetches within the same session**
   (e.g. `.../reference/ads-insights/` never resolved; `.../reference/ad-campaign/insights/` 404'd on a
   trailing-slash variant but succeeded at `.../documentation/ads-commerce/marketing-api/reference/ad-campaign/insights`
   without one). This looks like Meta's docs site serving inconsistent routing/caching behavior to a
   non-browser fetcher rather than genuine page removal — worth re-verifying key URLs in an actual browser
   if a future pass needs pages this one couldn't load.
