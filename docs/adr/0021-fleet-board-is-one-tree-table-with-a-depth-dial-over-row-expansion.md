# The Fleet Board is one comparison tree table: a global depth dial sets breadth, row expansion adds local depth

[Issue #13](https://github.com/todorone/adomata/issues/13) put three genuinely different interaction
models in front of the owner as a throwaway prototype
([docs/prototypes/issue-13-fleet-board.md](../prototypes/issue-13-fleet-board.md)) and closed with a
provisional recommendation rather than an owner verdict. This ADR adopts that recommendation as the
decision so the spec ([#17](https://github.com/todorone/adomata/issues/17)) has an interaction model to
be written against; it is the one product decision in the spec assembly that was made from the
prototype's own readout instead of from an owner review, and it is the cheapest of the three to revisit
because B and C were both built and are both still described in the prototype notes.

## The decision

**Variant A — one comparison-first tree table.** Every Ad Account is a row in a single table, and
Campaign / Ad Set / Ad rows appear as indented rows in that same table, sharing its columns. The board
is never replaced by a drill-down view.

Two controls, with one rule governing how they interact:

- **View Depth** is a global dial with four positions — Ad Account, Campaign, Ad Set, Ad. It sets how
  deep *every* row is opened at once. This is the owner's "expand the depth of view."
- **Row expansion** is per-row and additive. Clicking any row opens its children regardless of where the
  dial sits. This is the owner's "click a campaign and see its ad sets."

**The rule: a row is open if the depth dial reaches its level *or* it has been individually expanded.**
Never the reverse — raising the dial never collapses a row the user opened by hand, and lowering the
dial back does not discard individual expansions. The prototype implements exactly this
(`const campaignOpen = depth > 1 || expanded.has(campaign.id)`), and it is what makes the two controls
composable rather than fighting: the dial answers "how much of the fleet do I want opened," expansion
answers "and this one, further."

Consequences that follow and are not separately negotiable:

- **Every level carries the same metric columns.** A single table means rows at different levels must
  survive the same column set. [ADR 0010](0010-insights-stored-at-ad-grain-only.md) and
  [ADR 0019](0019-fleet-board-rollup-rules.md) already guarantee this: all six KPIs are defined at every
  level. This is why the metric pool could stay fixed at six in
  [ADR 0020](0020-fleet-board-metric-selection-is-url-encoded-not-stored.md) with no
  "metric has no meaning here" case to design for.
- **An expanded parent keeps showing its own aggregate.** Expanding is not a hand-off to children;
  the parent row stays populated. [ADR 0019](0019-fleet-board-rollup-rules.md) already fixes that
  collapsing never changes a number, which only means something if the parent shows numbers while open.
- **Health is a dot on the row, not a row tint or a lane.** At 30–150 Ad Account rows plus their opened
  descendants, tinting whole rows makes the board unreadable; the dot rides beside the always-visible
  Health Reason ([ADR 0018](0018-account-health-is-color-plus-reason-not-color-alone.md)), which is
  what actually carries the specifics.
- **Sorting and filtering apply to Ad Account roots only.** Sorting a tree by a child's value has no
  well-defined meaning while the parent must stay above its children; scoping both to the roots keeps
  "all accounts at once" sortable without inventing an ordering for the interior of the tree. Filtering
  changes the rollups per [ADR 0019](0019-fleet-board-rollup-rules.md).

## Rejected alternatives

- **B — split control room** (a sortable account rail beside a single-account detail pane). Calmer for
  deep inspection, but it moves comparison into a narrow list and shows one account's tree at a time,
  which is the exact silo Meta already imposes and the product exists to remove.
- **C — traffic-light lanes** (accounts grouped into red/yellow/green lanes with inline card expansion).
  The clearest morning-triage path of the three, but it gives up column alignment across levels, so
  numbers stop being comparable between accounts — and it hardcodes health as the only grouping, which
  collides with the Client-grouped / Flat toggle already settled in
  [#10](https://github.com/todorone/adomata/issues/10). Worth revisiting later as a secondary mode or a
  saved preset, not as the core model.
- **A drill-down that replaces the board.** Simpler to build than a tree table and rejected for the same
  reason as B: it loses the comparison that is the whole point.

## What this does not settle

Whether the board's *default* View Depth is Ad Account (the owner's literal "brief view") or Campaign.
The prototype defaults to Ad Account and that is what the spec describes, but the owner never chose, and
it is a one-line change with no downstream dependency. Not tracked as an ADR-level open question.
