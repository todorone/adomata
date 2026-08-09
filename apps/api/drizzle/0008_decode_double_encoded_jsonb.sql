UPDATE "ad_creative"
SET "payload" = ("payload" #>> '{}')::jsonb
WHERE jsonb_typeof("payload") = 'string' AND left("payload" #>> '{}', 1) IN ('{', '[');--> statement-breakpoint

UPDATE "ad_insight"
SET
	"actions" = CASE
		WHEN jsonb_typeof("actions") = 'string' AND left("actions" #>> '{}', 1) IN ('{', '[')
			THEN ("actions" #>> '{}')::jsonb
		ELSE "actions"
	END,
	"action_values" = CASE
		WHEN jsonb_typeof("action_values") = 'string' AND left("action_values" #>> '{}', 1) IN ('{', '[')
			THEN ("action_values" #>> '{}')::jsonb
		ELSE "action_values"
	END
WHERE jsonb_typeof("actions") = 'string' OR jsonb_typeof("action_values") = 'string';
