# Video Ads fall back to Meta's hosted Ad Preview, fetched live on demand

A video Ad's Creative surface was showing "media unavailable" for most real accounts. The cause is
not a bug on our side: Meta grants third-party apps no access to the raw video file. The
[creative retrieval research](../research/2026-07-25-meta-creative-retrieval.md) already anticipated
this — it made the thumbnail the V1 contract and inline playback "a progressive enhancement gated on
`video_id` resolution returning a usable `source`", carried into
[ADR 0022](0022-creative-surface-is-an-inline-expansion-of-the-ad-row.md). Against a real authorized
account the enhancement simply does not fire: `GET /{video-id}?fields=source` answers
`(#10) Application does not have permission for this action`, at every access tier. A thumbnail is
not enough for the one thing the Creative surface exists for — judging creative quality — and half
an agency's Ads are video.

## The decision

**A Creative holding a video Adomata cannot stream renders Meta's own hosted Ad Preview
(`GET /{ad-id}/previews`) in an iframe, in place of that video.** This is the only mechanism Meta
offers a third party for showing a video Ad as it actually runs, and it renders the whole Ad — video,
copy, and chrome — not just the file.

**It is fetched live, per Ad, only when the user opens that Ad's Creative.** This is the single
Fleet Board read that reaches Meta rather than a synced snapshot, so it is a deliberate exception to
[ADR 0013](0013-fleet-board-reads-synced-snapshots-not-meta-live.md) rather than a drift from it.
ADR 0013's argument is about the board's figures: a page load over 30–150 Ad Accounts fanning out
into a live call per account, putting one slow account's latency under every render. None of that
holds here — this is one call for one Ad a person deliberately opened, it blocks nothing but its own
iframe, and its absence degrades to the existing "media unavailable" state. Syncing previews instead
would be strictly worse: it means a preview call for every active Ad every hour, against the same
rate-limit budget the [rate-limit research](../research/2026-07-25-meta-api-rate-limits-fleet-refresh.md)
sizes the whole fleet refresh within, for previews almost nobody opens.

**The gate is "there is a video with no media", not "the Creative is a video".** The Creative's kind
is `video` only when a top-level `video_id` is set — an Advantage+ Creative whose videos live in
`asset_feed_spec` is kind `asset_feed`, and would have been missed. The normalizer therefore keeps
an unresolvable video in the asset list with a null media key, which is what both the gate and the
UI read. A Creative with playable images and one unstreamable video keeps its images and gains the
preview as one more variant; a video-only Creative has the preview as its only viewable asset.

**Meta chooses the placement, by probe.** `/{ad-id}/previews` requires an `ad_format` and rejects
one the Ad cannot render, and an Ad's eligible placements are not part of what the board syncs, so
the client walks `MOBILE_FEED_STANDARD → INSTAGRAM_STANDARD → INSTAGRAM_REELS →
FACEBOOK_STORY_MOBILE` and stops at the first that renders. An Ad that renders in none of them
reports no preview and the surface falls back to today's message.

**The preview URL is treated as untrusted input and as a credential.** It arrives as HTML inside a
Graph response and is then handed to a browser as an iframe source, so it is parsed out, entity-
decoded, and rejected unless it is `https` on Meta's own origin. It also carries Meta's own
short-lived preview token, which makes it bearer-capable: it is never logged, and the response is
`Cache-Control: private, max-age=300` — long enough to absorb repeated opens, short enough not to
outlive the token it carries.

## Consequences

- The Fleet Board tree badges video Ads so a video Ad is recognizable before it is opened. That bit
  is stored on the Creative at write time (`ad_creative.has_video`) rather than derived per read:
  the tree needs it for every Ad in the Agency, and deriving it would mean loading every Creative
  payload on every hierarchy request.
- Video quality, controls, and sizing are Meta's, not ours. The iframe is sandboxed and sized from
  the width and height Meta's own markup declares.
- If Meta ever does grant video `source` to third parties, nothing has to be unwound: a resolvable
  video is already preferred, and the preview only fills the gap where one is missing.

## Rejected alternatives

- **Proxying the video file through our media route, as images are proxied.** There is no file to
  proxy — this is the permission that does not exist.
- **`preview_shareable_link`.** Meta-hosted, but a page that requires a Meta login and cannot be
  embedded, so it leaves the board rather than filling the Creative surface.
- **Storing the preview URL during Creative enrichment.** Removes the live call,
  but pays for a preview on every active Ad hourly, and persists a short-lived Meta token whose
  expiry we cannot observe — a snapshot that silently rots is worse than a call that succeeds or
  visibly does not.
