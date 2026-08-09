ALTER TABLE "ad_creative" ADD COLUMN "has_video" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "ad_creative" AS "target" SET "has_video" = true
FROM (
	SELECT
		"id",
		CASE
			WHEN jsonb_typeof("payload") = 'object' THEN "payload"
			WHEN jsonb_typeof("payload") = 'string' AND starts_with("payload" #>> '{}', '{')
				THEN ("payload" #>> '{}')::jsonb
			ELSE '{}'::jsonb
		END AS "spec"
	FROM "ad_creative"
) AS "decoded"
WHERE "decoded"."id" = "target"."id" AND (
	jsonb_typeof("decoded"."spec" -> 'video_id') = 'string'
	OR jsonb_typeof("decoded"."spec" -> 'video_url') = 'string'
	OR (
		jsonb_typeof("decoded"."spec" -> 'asset_feed_spec' -> 'videos') = 'array'
		AND jsonb_array_length("decoded"."spec" -> 'asset_feed_spec' -> 'videos') > 0
	)
);
