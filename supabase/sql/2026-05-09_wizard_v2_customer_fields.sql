ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ai_person_name TEXT,
  ADD COLUMN IF NOT EXISTS ai_website_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_forwarding_1_name TEXT,
  ADD COLUMN IF NOT EXISTS ai_forwarding_1_number TEXT,
  ADD COLUMN IF NOT EXISTS ai_forwarding_1_trigger TEXT,
  ADD COLUMN IF NOT EXISTS ai_forwarding_2_name TEXT,
  ADD COLUMN IF NOT EXISTS ai_forwarding_2_number TEXT,
  ADD COLUMN IF NOT EXISTS ai_forwarding_2_trigger TEXT,
  ADD COLUMN IF NOT EXISTS ai_emergency_number TEXT DEFAULT '144',
  ADD COLUMN IF NOT EXISTS ai_online_booking_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_short_description TEXT,
  ADD COLUMN IF NOT EXISTS ai_branch_extra JSONB;
