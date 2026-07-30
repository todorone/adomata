# Fleet Board metric selection is URL-encoded per view, not stored per user; the selectable pool stays the fixed six KPIs

[Issue #14](https://github.com/todorone/adomata/issues/14) asked how metric selection — which KPI columns
a Fleet Board view shows — is configured, scoped, and persisted. Meta's own Insights vocabulary is much
wider than `CONTEXT.md`'s fixed six KPIs, but only those six were established as roll-up-safe under
[ADR 0010](0010-insights-stored-at-ad-grain-only.md): they're built entirely from additive components
storable at Ad grain. Widening the selectable pool (e.g. `reach`, which the
[Insights metrics research](../research/insights-metrics-by-level.md) found is *not* roll-up-safe — Meta
dedupes it at the queried level) would reopen that storage decision. So the pool stays the fixed six; a
wider pool is deferred to whichever future ticket actually needs a metric ADR 0010 doesn't cover. Because
the pool is fixed and every one of the six is already defined at every tree level
([ADR 0019](0019-fleet-board-rollup-rules.md)), there's no "metric has no meaning at this level" case to
design for here.

Within that pool, a user picks a **subset** — not all six shown always, not just a reordering — since
narrowing the board's columns is the actual point of the owner's "quick metric toggles" ask (see the
[owner interview](../interviews/2026-07-25-agency-owner-fleet-dashboard.md)). Column order and width stay
fixed to the glossary's canonical KPI order; no drag-to-reorder or resize for this scope.

The selection lives **only in the URL search params** — nothing is persisted server-side or in local
storage, and no new schema was added. This was a deliberate scope cut over the alternative of a per-user
preferences table (which doesn't exist today — `users` is pure Better Auth core with no JSON column): the
motivating need, a director and a buyer wanting different columns on the same board, is already satisfied
by two people holding two different links, without needing Adomata to remember anything against an
identity. A view with no selection param falls back to a hardcoded default (Spend, Clicks, CPA — originally
Spend, ROAS, matching what prototype #13 defaulted to, changed once a real lead-generation fleet showed ROAS
as `0×` in every row); landing on that default never rewrites the URL to spell it out explicitly, so a bare
bookmark keeps tracking "whatever today's default is" rather than freezing it. Which subset is the default
is not part of this decision — the pool stays the fixed six and the selection stays URL-only either way.

The trade-off: a selection does not follow a person across devices, a cleared URL, or a fresh browser.
That's accepted for this scope — adding it later means adding a per-user preferences table and a sync
between it and the URL, additive work on top of this decision rather than a rework of it.

Presets (e.g. "what a buyer checks") are a future content layer, not a separate data model or persistence
shape — a preset click would just write its metric list into this same URL-encoded selection. Which
metrics each preset actually contains is left unspecified here: the owner interview only asked for "quick
toggles" in general and never gave per-persona metric lists to work from.
