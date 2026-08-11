# Non-active ad creative and image retrieval

**Research date:** 2026-08-11
**Question:** Why does Fleet Board fail to show images or creative details for
non-active ads?

## Finding

The primary failure is local synchronization, not a production-browser image
rendering problem and not an intentional Meta status restriction in the code.
The ad hierarchy imports multiple effective statuses, but creative metadata is
only synchronized for ads whose local status is exactly `ACTIVE`.

`MetaClient.listAds()` requests `ACTIVE`, `PAUSED`, `ARCHIVED`,
`CAMPAIGN_PAUSED`, and `ADSET_PAUSED` ads in
`apps/api/src/meta/client.ts:19-28,272-284`. Later,
`syncInsightsTierAccount()` narrows the database query to
`ad.effectiveStatus = 'ACTIVE'` before calling `metaClient.getCreative()` in
`apps/api/src/sync/account-tier.ts:348-354`.

Therefore a paused, archived, or otherwise non-active ad can exist in the
hierarchy without an `ad_creative` row. This is especially visible for an ad
that was never active: the creative fetch is never attempted and there is no
stored creative ID from which to fetch media.

## Why the UI then has no image

The Fleet Board read model obtains creative IDs only from the persisted
`ad_creative` join (`apps/api/src/fleet-board/read-model.ts:139-165`). For each
ad it assigns `creativeId: creative?.creativeId ?? null`
(`apps/api/src/fleet-board/read-model.ts:270-285`). The client deliberately
renders the image fallback when that ID is null, instead of constructing a
media URL (`apps/client/src/pages/fleet-board/fleet-board.components.tsx:646-659`).

Opening the creative cannot repair this case. `readCreative()` starts from
`ad_creative` and returns `null` when the row is absent
(`apps/api/src/fleet-board/read-model.ts:99-113`), so the creative endpoint
returns 404 (`apps/api/src/routes/fleet-board.ts:89-96`). The media endpoint
also starts from an existing creative row and can only refresh that row
(`apps/api/src/routes/fleet-board.ts:108-120,131-162`). There is no lazy path
that creates the first `ad_creative` row for a non-active ad.

## Production validation

Using the production app at [app.adomata.com](https://app.adomata.com/), I
opened an archived branch under the `posmarket Ad` cabinet. The tree contained
archived ads (`13`, `12`, etc.), proving that the hierarchy/status sync exposes
non-active ads. Opening archived ad `13` showed the production message
“Не вдалося завантажити креатив. Показники оголошення доступні.” and rendered no
image.

For comparison, an active image ad (`18,3 укр`) opened a creative dialog with an
image. Its browser-visible media request was
`https://api.adomata.com/fleet-board/creatives/1409847767629927/media/m0`.
This matches the code path: active ads have a persisted creative ID, while the
archived ad has no usable creative record.

## Secondary image-specific risk

After a creative row exists, image resolution can still fail independently:

- `MetaClient.getCreative()` requests `thumbnail_url` and `image_url`, and
  resolves hashes inside `asset_feed_spec.images` through the ad account's
  `/adimages` edge (`apps/api/src/meta/client.ts:303-326,431-445`).
- `getAdImageUrls()` catches every error and returns an empty map. A missing
  permission, expired/invalid URL, or Graph API failure is therefore converted
  into a creative payload with no resolved asset-feed image URL
  (`apps/api/src/meta/client.ts:431-445`).
- The existing refresh logic can re-fetch an existing creative when its
  asset-feed image has a hash but no URL (`apps/api/src/fleet-board/creative.ts:70-77`),
  but it cannot help when the `ad_creative` row was never created.

Meta's official Business SDK exposes `image_hash`, `image_url`,
`thumbnail_url`, and `video_id` on `AdCreative`, and `hash`, `url`, and
`url_128` on `AdImage`: [AdCreative schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py),
[AdImage schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adimage.py).
The existing repository research also records that Meta's ad-image URLs are
temporary and should be refreshed/proxied server-side:
[Meta creative retrieval research](2026-07-25-meta-creative-retrieval.md).

## Conclusion

The status filter is the first fix to make: creative synchronization must use
the same visibility/status scope as the hierarchy, or explicitly fetch
creative data for every visible ad. The refresh/proxy behavior and image-library
error handling are separate hardening concerns; they do not explain the
consistent production failure for non-active ads that have no `ad_creative`
row.
