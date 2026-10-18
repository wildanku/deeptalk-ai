-- Read-only check for why production returns CONSENT_UNAVAILABLE.
-- A production gateway only serves approved content; drafts are intentionally ignored.
SELECT
  version,
  status,
  body ->> 'type' AS consent_type,
  (
    body ->> 'type' = 'service'
    AND jsonb_typeof(body -> 'title') = 'string'
    AND jsonb_typeof(body -> 'summary') = 'array'
    AND jsonb_array_length(
      CASE
        WHEN jsonb_typeof(body -> 'summary') = 'array' THEN body -> 'summary'
        ELSE '[]'::jsonb
      END
    ) > 0
    AND jsonb_typeof(body -> 'body') = 'string'
    AND jsonb_typeof(body -> 'min_accepted_version') = 'number'
  ) AS required_fields_valid,
  (
    body #> '{translations,en}' IS NOT NULL
    AND jsonb_typeof(body #> '{translations,en,title}') = 'string'
    AND jsonb_typeof(body #> '{translations,en,summary}') = 'array'
    AND jsonb_typeof(body #> '{translations,en,body}') = 'string'
  ) AS has_english_translation,
  created_at
FROM ai_content_versions
WHERE kind = 'consent_text'
  AND ref_id = 'service'
ORDER BY version DESC;
