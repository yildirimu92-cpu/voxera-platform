-- Migration: Idempotency lock + retry-capable failure status for offer acceptance
-- Date: 2026-08-06
--
-- Adds:
--   - offers.accept_claim_key: per-request compare-and-swap lock used by
--     acceptOfferAndEnsureContract() (_lib/offer-acceptance.js) to serialize concurrent
--     accept attempts on the same offer. Mirrors the invite_status='sending' claim
--     pattern already in production in admin-panel/netlify/functions/send-customer-access.js.
--   - offers.status gains 'contract_failed': a non-final, retry-capable status written
--     when the customer's acceptance itself succeeded (consent/signature captured) but
--     contract creation failed, so the offer is never silently left/marked final
--     'accepted' without a contract existing.
--
-- Note on the widened status list: the CHECK constraint tracked in
-- 2026-04-11_offer_status_email_upgrade.sql only allows
-- ('draft','sent','in_review','revision_requested','accepted','rejected','expired'),
-- but admin-panel/netlify/functions/offer-status-update.js has treated
-- ('viewed','declined','active') as canonical statuses since that migration landed
-- (see its ALLOWED/LEGACY_TO_CANONICAL sets). Rather than guess which list is the
-- authoritative one in production, this migration takes the union of both known lists
-- plus the new 'contract_failed' value -- a pure superset, so it can only add
-- previously-missing allowed values and can never invalidate a status value that is
-- valid today.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accept_claim_key text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offers_status_check'
      AND conrelid = 'public.offers'::regclass
  ) THEN
    ALTER TABLE public.offers DROP CONSTRAINT offers_status_check;
  END IF;
END;
$$;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_status_check
  CHECK (status IN (
    'draft', 'sent', 'in_review', 'revision_requested', 'viewed', 'declined', 'active',
    'accepted', 'rejected', 'expired', 'contract_failed'
  ));
