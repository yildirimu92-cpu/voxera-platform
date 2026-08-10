-- Call Intake hardening
-- Adds database-level idempotency for ElevenLabs post-call retries and
-- lookup indexes used by the fallback matcher.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    elevenlabs_conversation_id,
    row_number() OVER (
      PARTITION BY elevenlabs_conversation_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.calls
  WHERE elevenlabs_conversation_id IS NOT NULL
    AND btrim(elevenlabs_conversation_id) <> ''
)
UPDATE public.calls AS calls
SET
  elevenlabs_conversation_id = NULL,
  updated_at = now(),
  notes = concat_ws(
    E'\n',
    nullif(calls.notes, ''),
    '[SYSTEM] Duplicate ElevenLabs conversation id cleared before idempotency index.'
  )
FROM ranked
WHERE calls.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_elevenlabs_conversation_id
  ON public.calls (elevenlabs_conversation_id)
  WHERE elevenlabs_conversation_id IS NOT NULL
    AND btrim(elevenlabs_conversation_id) <> '';

CREATE INDEX IF NOT EXISTS idx_calls_phone_pair_created_at
  ON public.calls (caller_phone, called_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_customer_duration_created_at
  ON public.calls (customer_id, duration_seconds, created_at DESC);

COMMIT;
