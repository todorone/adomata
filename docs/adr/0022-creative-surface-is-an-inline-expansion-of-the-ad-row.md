# The creative surface is an inline expansion of the Ad row, not a panel or a gallery

[Issue #16](https://github.com/todorone/adomata/issues/16) prototyped three creative surfaces on top of
the board ([docs/prototypes/issue-16-creative-browsing.md](../prototypes/issue-16-creative-browsing.md))
and closed with a provisional recommendation, not an owner verdict — the same situation as
[ADR 0021](0021-fleet-board-is-one-tree-table-with-a-depth-dial-over-row-expansion.md), and adopted here
for the same reason: the spec ([#17](https://github.com/todorone/adomata/issues/17)) needs a creative
surface to describe.

## The decision

**Variant A — the Creative renders inline, in a full-width block directly beneath its Ad row.**
Expanding an Ad opens its Creative in place, inside the same table, with the board's columns still
visible above and the sibling Ads still in view. This is the direct consequence of
[ADR 0007](0007-creative-is-a-property-of-an-ad-not-a-tree-level.md): a Creative is a property of an Ad,
not a fifth tree level, so it is not a row with metrics of its own — it is the Ad row's expansion, and
the Ad's numbers stay on the Ad row where they belong.

The block carries, per the [creative retrieval research](../research/2026-07-25-meta-creative-retrieval.md):
primary visual, primary text, headline, CTA, destination link, and the current
[Metric Selection](../../CONTEXT.md#kpis) — the same columns the rest of the board is showing, not a
separate creative-only metric set.

**Multi-asset Ads show every asset, with results attributed to the whole Ad.** A carousel renders all of
its `child_attachments` as a strip — never collapsed to the first card. An `asset_feed_spec` Ad renders
its assets as a labelled variants set. Both carry an explicit label stating the numbers belong to the
Ad, not to any single asset shown. This is a correctness requirement, not a nicety: the research found
that per-asset attribution needs dynamic-creative Insights breakdowns that are limited in metric
coverage and unavailable at ad-account level, so the honest UI is one that shows the assets and declines
to split the results between them.

**Video is thumbnail-first.** Inline playback is a progressive enhancement gated on `video_id`
resolution returning a usable `source` for the authorized token — the research explicitly makes the
thumbnail the V1 contract, since a Graph Video `source` is not guaranteed by the AdCreative schema.

**Media resolves server-side, and a broken asset never hides the Ad's numbers.** Meta documents Ad Image
`url`/`url_128` as *temporary*, so the browser must not hold a long-lived hotlink. A "media unavailable"
placeholder stands in for an expired or failed asset while the Ad's performance row renders unchanged.

## Rejected alternatives

- **B — a dedicated creative panel** beside the account detail. Larger media and more room for copy, but
  it only exists inside variant B's split layout, which
  [ADR 0021](0021-fleet-board-is-one-tree-table-with-a-depth-dial-over-row-expansion.md) rejected.
  Adopting it would mean maintaining a second navigation model just for creatives.
- **C — compact previews under an account card.** Fast to scan, but the prototype's own readout flags
  the previews as likely too small to judge creative quality — which is the entire reason the owner
  wants the surface.
- **A creative gallery grouping the same Creative across Ads and accounts.** This is what
  "which creative works" ultimately wants, and it is deliberately *not* built here: it is creative
  *comparison*, which the map lists under Not-yet-specified, and it needs a cross-Ad creative identity
  (image hash or `effective_object_story_id`) that nothing has yet decided to store as a first-class key.

## What this does not settle

Whether one permanent conversion metric (CPA or ROAS) should ride beside every Creative regardless of
the current Metric Selection. The prototype raised it; the owner never answered. Left as-is — the
Metric Selection governs, with no exception for the creative block.
