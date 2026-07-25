# Meta creative retrieval and rendering (issue #7)

**Research date:** 2026-07-25  
**Question:** Can the product pull each Meta ad's creative and show it beside
performance, including video, carousels, dynamic creative, copy, CTA, and
destination? What must be stored?

## Decision

**Yes — this is viable for account-authorized ads.** Treat an ad's creative as
an *asset set* rather than always one image. The initial product can render a
fresh image/thumbnail alongside performance, then expand a carousel or
asset-feed creative into its constituent assets and placement variants.

Meta calls Ad Image `url` and `url_128` **temporary URLs**, and no primary
source reviewed promises that creative thumbnails or Video `source` URLs are
durable or browser-hotlink-safe. Do not make the browser's long-lived direct
hotlink the product contract. Fetch/refresh media through the server (or proxy
a freshly retrieved URL) when it is displayed. Persistent downloaded copies
are optional, but require an explicit retention/rights decision and a
re-validation against Meta's then-current terms.

Insights does document dynamic-creative asset breakdowns. They can identify
image, video, body, CTA, link URL, and title assets involved in delivery, but
the documented metric set is limited and some breakdowns cannot run at
ad-account level. Present this as an asset-delivery view, not a complete,
universally available winner-ranking system; validate it with a production
dynamic-creative account before promising a ranking.

## Access and request shape

The caller needs a Marketing API token whose user/system user has access to the
client ad account and the `ads_read` permission. Meta defines `ads_read` as
read access to ad-account campaigns and ads; it is the read permission, whereas
`ads_management` is for managing ads. Production access also remains subject to
Meta's access/onboarding requirements and the client's account authorization.

Fetch the ad and expand its creative (or request the `adcreatives` edge). Meta's
own Marketing API Postman collection demonstrates requesting ad creative data
from an ad with nested fields, including `id`, `image_hash`, `image_url`,
effective post/media IDs, and CTA. A practical field expansion for a read-only
sync is:

```text
GET /{ad-id}?fields=id,name,creative{
  id,object_type,image_hash,image_url,thumbnail_url,video_id,
  body,title,link_url,call_to_action,call_to_action_type,
  object_story_spec,asset_feed_spec,
  effective_object_story_id,effective_instagram_media_id
}
```

Request only fields that are needed and tolerate absent fields: the creative
format determines which fields Meta supplies. The current official Business
SDK schema contains all of the fields above, including `object_story_spec`,
`asset_feed_spec`, `image_url`, `thumbnail_url`, and `video_id`.

## Field map: Ad to renderable creative

| Creative shape | Read from | What can be displayed |
| --- | --- | --- |
| Simple image | `image_hash` to look up the ad-account image and use its fresh `url`; `thumbnail_url` as a preview fallback | Full image when a fresh URL is returned; retain dimensions and hash for identity/deduplication. `image_url` is a creation/input field saved to the account image library, so do not treat it as the canonical rendered asset. |
| Simple video | `creative.video_id`, `creative.thumbnail_url`, or `object_story_spec.video_data.video_id` | Always show the thumbnail when present. Resolve `video_id` as a Graph Video and request its `source` only as a progressive enhancement; if it is not returned for the authorized token/account, show the thumbnail and link/preview rather than fail the card. |
| Link/image/video ad with copy | `object_story_spec.link_data` or `.video_data` | `message` (primary text), `name` (headline), `description`, `link`, and `call_to_action`; video data supplies `video_id` and often an image/thumbnail reference. |
| Carousel | `object_story_spec.link_data.child_attachments` | Render one card per attachment: its image/hash, name/headline, description, link, and CTA where supplied. Do not collapse a carousel to its first card. |
| Existing Facebook/Instagram post | `effective_object_story_id`, `effective_instagram_media_id`, plus the creative fields | Use these as identifiers/link-out fallbacks. The associated post/media may be the most faithful source for a post-based creative, subject to the token's access. |
| Dynamic / Advantage+ / placement-customized creative | `asset_feed_spec` | Render an asset-set view: `images`, `videos`, `bodies`, `titles`, `descriptions`, `link_urls`, CTA types/actions, and `asset_customization_rules`. Each asset has `adlabels`; rules select an image/video/text/link label for a `customization_spec` (placement). |

### Image resolution

Use `image_hash` to query the account's Ad Image collection/object and request
`url`, `url_128`, `width`, `height`, `original_width`, `original_height`, and
`permalink_url`. Meta's official SDK defines those fields on `AdImage`, and the
official reference identifies `url` and `url_128` as temporary URLs. Although
`image_url` exists on `AdCreative`, it is a creation/input field saved to the
ad account's image library, not the durable display-media contract.

### Video resolution and permission cost

`video_id` is a real `AdCreative` field, and an asset-feed video carries both
`video_id` and `thumbnail_url`. The essential dashboard permission remains
`ads_read` plus authorization to the ad account. Do not request
`ads_management` merely to display creative; request it only if the product
will change campaigns/creatives. A Graph Video `source` is not guaranteed by
the AdCreative schema itself, so playable video must be feature-detected with
a real authorized account. This makes the thumbnail-based video card the V1
contract; inline playback is an enhancement, not a scope blocker.

## Multi-asset semantics and performance

`asset_feed_spec` explicitly has arrays for images, videos, body text, titles,
descriptions, link URLs, carousels, CTAs, and asset-customization rules. The
official schema for each member includes `adlabels`; each customization rule
references the corresponding `image_label`, `video_label`, `body_label`,
`title_label`, `description_label`, and `link_url_label`. Therefore the
correct model is:

```text
Ad -> AdCreative -> asset_feed_spec
                  -> assets (labelled images/videos/copy/links)
                  -> customization rules (placement -> selected labels)
```

An ad-level result cannot automatically be attributed to one of these possible
combinations. Meta does document the `ad_format_asset`, `image_asset`,
`video_asset`, `body_asset`, `call_to_action_asset`, `link_url_asset`, and
`title_asset` Insights breakdowns for dynamic creative. The documented
dynamic-creative results are limited to `impressions`, `clicks`, `spend`,
`reach`, `actions`, and `action_values`; `image_asset` and `video_asset` do
not run at ad-account level. Keep the normal performance row keyed to `ad_id`;
add an explicit asset-delivery drill-down only after validating the required
breakdowns at the appropriate scope with dynamic creative traffic.

## Hotlinking, caching, and redisplay

`thumbnail_url`, fresh Ad Image `url`, and asset-feed thumbnail URLs are useful
media URLs, but browser hotlinking is not a durable integration boundary.
In particular, Meta's Ad Image reference calls `url` and `url_128` temporary;
the reviewed primary references provide no durability or CORS guarantee for
creative thumbnail URLs or Video `source`. Never expose an access token to the
browser. The implementation should therefore:

1. Persist creative metadata/IDs and, at most, the latest URL as a refreshable
   cache value (with last-synced time), not as a permanent asset identity.
2. Resolve/refresh media server-side when the UI needs it, then proxy it or
   return a short-lived product URL; on a failure, re-fetch the
   creative/ad-image metadata and retry once.
3. Keep a thumbnail/"media unavailable" state so a missing asset never hides
   the ad's performance row.
4. Do not store original image/video bytes in V1 unless the proxy's short-lived
   cache is technically necessary. If persistent asset copying is needed,
   obtain a product/legal decision on client authorization, retention,
   deletion, and data security first.

Meta's Platform Terms require deletion of Platform Data when it is no longer
necessary for a legitimate, terms-consistent business purpose. That supports
the narrow, account-authorized dashboard use case but rules out treating
downloaded creative assets as an unrestricted permanent library. The terms do
not supply a general permanent-asset license in the material reviewed here.

## Recommended V1 presentation

- One ad card/table row: primary visual (image or video thumbnail), primary
  copy/headline/CTA/destination when present, and ad-level metrics.
- Carousel: an expandable strip of all cards.
- Asset feed: expandable "variants" list grouped by image/video and placement
  rule; show that it is a set of possible delivered combinations.
- Video: thumbnail first; use an inline player only when resolving `video_id`
  returns a usable source in the client's authorized integration.
- Keep raw Graph IDs and the last successful sync timestamp for diagnosis and
  URL refreshes.

## Sources (primary)

1. [Issue #7: acceptance question and required deliverable](https://github.com/todorone/adomata/issues/7).
2. [Meta's official Facebook Marketing API Postman collection — ad retrieval field expansion](https://www.postman.com/meta/facebook-marketing-api/request/k9k7887/retrieving-ad-details-l1).
3. [Meta Business SDK `AdCreative` schema](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-creative.js) — supported creative fields, including image, thumbnail, story, asset feed, CTA, URL, and video ID.
4. [Meta Business SDK `AdAssetFeedSpec` schema](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-asset-feed-spec.js), [image member](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-asset-feed-spec-image.js), [video member](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-asset-feed-spec-video.js), and [customization rule](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-asset-feed-spec-asset-customization-rule.js) — supported asset arrays, labels, and placement mapping.
5. [Meta Business SDK `AdImage` schema](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-image.js) — image URLs, hashes, dimensions, and permalink fields; [Meta Ad Image reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-image) — `url` and `url_128` are temporary URLs.
6. [Meta `ads_read` permission reference](https://developers.facebook.com/docs/permissions/reference/ads_read/) and [Marketing API authorization](https://developers.facebook.com/docs/marketing-api/get-started/authorization/) — read authorization/access requirements.
7. [Meta Ad Creative reference](https://developers.facebook.com/docs/marketing-api/reference/ad-creative/), [Meta asset-feed documentation](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-creative/asset-feed-spec), [Meta Asset Feed Spec reference](https://developers.facebook.com/docs/marketing-api/reference/ad-asset-feed-spec/), [Meta Graph Video reference](https://developers.facebook.com/docs/graph-api/reference/video/), and [Insights API breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns) — current API and reporting boundaries.
8. [Meta Platform Terms](https://developers.facebook.com/terms/) — Platform Data retention and deletion obligations.

## Validation before implementation is committed

Use a non-production client account containing: a static image, a video, a
carousel, and a dynamic/Advantage+ creative. Record the requested fields and
response shapes (with tokens and asset URLs redacted), test whether the
authorized `video_id` returns `source`, and deliberately retry an old URL after
the next sync. This verifies account-specific access and URL behavior without
turning undocumented assumptions into product guarantees.
