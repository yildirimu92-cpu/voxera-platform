-- Migration: Persist AI setup fields + static ai_summary on customers
-- Date: 2026-04-10
-- Goal: Single-source summary field for downstream email tools (e.g. Make)

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS ai_business_description text,
  ADD COLUMN IF NOT EXISTS ai_services text,
  ADD COLUMN IF NOT EXISTS ai_location_hours text,
  ADD COLUMN IF NOT EXISTS ai_booking_faq text,
  ADD COLUMN IF NOT EXISTS ai_instructions text,
  ADD COLUMN IF NOT EXISTS ai_fallback_escalation text,
  ADD COLUMN IF NOT EXISTS ai_response_constraints text,
  ADD COLUMN IF NOT EXISTS ai_internal_notes text,
  ADD COLUMN IF NOT EXISTS ai_summary text;
