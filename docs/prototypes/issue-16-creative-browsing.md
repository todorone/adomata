# Prototype #16 — Creative browsing at Ad level

Question: what does the creative layer look like at the bottom of the fleet
board, when the useful unit is an ad with its results rather than an image by
itself?

Run the client and open:

`http://localhost:5173/prototype/fleet-board?variant=A`

Use the existing depth control to reach **Оголошення**, then expand an ad row.
The floating switcher or `?variant=A|B|C` changes the creative surface while
keeping the issue #13 board interaction model and in-memory data.

## Variants tried

- **A — Дерево**: an ad row expands inline inside the comparison table. The
  image, copy, CTA, destination, selected metrics, and all carousel/asset-feed
  assets remain aligned with the board.
- **B — Пульт**: selecting an ad in the account detail opens a dedicated
  creative panel. The ad list stays visible, so comparison is between a calm
  detail surface and the account context.
- **C — Сигнали**: opening an account card reveals compact creative previews
  underneath its signal metrics. Up to four ads can be scanned without leaving
  the triage lanes.

The fake roster includes static images, a video thumbnail with a play marker,
four-card carousels, five-asset placement feeds, and an expired media state.
Carousel and asset-feed results are explicitly labelled as attributed to the
whole ad, not to an individual asset. The metric chips from the board apply to
each creative preview.

## Current readout

No owner verdict has been captured yet. The prototype is intended for reaction.
The strongest candidate to test first is **A — Дерево**, because it preserves
the board's comparison context while making the creative a first-class expansion
of the ad row. **B** is the candidate if the owner wants larger media and copy;
**C** is the candidate for fast morning triage, but its compact previews may be
too small for judging creative quality.

## To resolve after review

- Which surface makes “which creative works” answerable fastest: inline row,
  dedicated panel, or compact signal preview?
- Should the selected metric chips remain the only numbers beside the creative,
  or should one permanent conversion metric be added?
- Is showing every carousel card the right default, and should asset-feed
  placements stay visible as a labelled set?
- Is a thumbnail-only video preview sufficient for V1, with playback deferred
  until the authorized integration can return a usable source?
