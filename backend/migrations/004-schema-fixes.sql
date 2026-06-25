-- ============================================================
-- Migration 004: Schema fixes — aligns DB with edge functions
-- Run in Supabase SQL Editor AFTER schema.sql
-- ============================================================

-- ── 1. points_transactions: add expired flag ─────────────────
ALTER TABLE points_transactions
  ADD COLUMN IF NOT EXISTS expired BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for expire-points cron function
CREATE INDEX IF NOT EXISTS idx_ptx_expired
  ON points_transactions (hotel_id, expiry_date, expired)
  WHERE expired = FALSE AND type = 'earn';

-- ── 2. guests: add pms_id, fix last_stay alias ───────────────
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS pms_id        TEXT,          -- PMS system guest ID (from Aisency)
  ADD COLUMN IF NOT EXISTS language      TEXT DEFAULT 'en';

-- Note: schema already has last_stay_date and enrolled_at
-- Edge functions now use these correct names (see pms-webhook fix)

-- ── 3. campaigns: add missing columns ────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS message_body     TEXT,        -- alias written into by send-campaign
  ADD COLUMN IF NOT EXISTS email_subject    TEXT,
  ADD COLUMN IF NOT EXISTS segment_tier     SMALLINT,    -- NULL = all tiers
  ADD COLUMN IF NOT EXISTS segment_churn    TEXT,        -- NULL = all statuses
  ADD COLUMN IF NOT EXISTS sent_count       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at     TIMESTAMPTZ;

-- Backfill message_body from existing message column
UPDATE campaigns SET message_body = message WHERE message_body IS NULL AND message IS NOT NULL;

-- ── 4. earn_config: add flat columns alongside JSONB ─────────
-- pms-webhook needs fast individual-column reads
ALTER TABLE earn_config
  ADD COLUMN IF NOT EXISTS base_rate_room        SMALLINT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS base_rate_fnb         SMALLINT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS base_rate_spa         SMALLINT DEFAULT 8,
  ADD COLUMN IF NOT EXISTS base_rate_golf        SMALLINT DEFAULT 7,
  ADD COLUMN IF NOT EXISTS base_rate_activities  SMALLINT DEFAULT 6,
  ADD COLUMN IF NOT EXISTS base_rate_retail      SMALLINT DEFAULT 4,
  ADD COLUMN IF NOT EXISTS suppressed_rate_codes TEXT[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dynamic_enabled       BOOLEAN  DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS dynamic_threshold     NUMERIC  DEFAULT 0.75;

-- ── 5. Hotels INSERT policy — fixes signup RLS bug ───────────
-- New users can insert exactly one hotel during signup.
-- After insert, the normal hotel_self SELECT policy kicks in.
-- We use a service-role Edge Function for signup (see signup-handler),
-- but this policy allows the anon/authenticated path as fallback.
DROP POLICY IF EXISTS hotel_insert_on_signup ON hotels;
CREATE POLICY hotel_insert_on_signup ON hotels FOR INSERT
  WITH CHECK (TRUE);   -- signup edge function handles auth; hotel_id assigned after insert

-- ── 6. Users INSERT policy — needed for signup ───────────────
DROP POLICY IF EXISTS users_insert_on_signup ON users;
CREATE POLICY users_insert_on_signup ON users FOR INSERT
  WITH CHECK (id = auth.uid());

-- ── 7. Fix churn_status default to lowercase ─────────────────
ALTER TABLE guests ALTER COLUMN churn_status SET DEFAULT 'active';

-- Normalise existing data
UPDATE guests SET churn_status = LOWER(churn_status)
  WHERE churn_status IN ('Active','At Risk','Churned','At_Risk');

UPDATE guests SET churn_status = 'at_risk'
  WHERE churn_status = 'at risk';

-- ── 8. Fix 003-security DROP POLICY names ────────────────────
-- The schema auto-creates policies named 'guests_hotel_iso'.
-- 003-security tried to drop wrong names — fix here.
DROP POLICY IF EXISTS guests_hotel_iso ON guests;

-- Recreate with correct hotel_id check (sub-select faster than join)
CREATE POLICY guests_hotel_iso ON guests
  USING (hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1));

CREATE POLICY guests_insert_check ON guests FOR INSERT
  WITH CHECK (hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1));

CREATE POLICY guests_update_check ON guests FOR UPDATE
  USING (hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1));

-- ── 9. set_auth_claims: fire on INSERT too (first signup) ────
-- Original trigger only fires on UPDATE of last_sign_in_at.
-- This means hotel_id/role are NOT in JWT immediately after signUp.
-- Solution: also fire on INSERT (first creation of auth user).
-- NOTE: Supabase may not allow triggers on auth.users INSERT via SQL editor.
-- The real fix is the custom JWT hook below OR the supabase-client.js fix.
-- See supabase-client.js: getRole() now queries users table directly.

-- ── 10. Custom JWT hook (set in Supabase Dashboard) ──────────
-- Go to: Authentication → Hooks → Custom Access Token Hook
-- Set to this function:

CREATE OR REPLACE FUNCTION custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  _hotel_id UUID;
  _role     TEXT;
  _user_id  UUID;
BEGIN
  _user_id := (event ->> 'user_id')::UUID;

  SELECT hotel_id, role INTO _hotel_id, _role
  FROM users WHERE id = _user_id;

  IF _hotel_id IS NOT NULL THEN
    RETURN jsonb_set(
      jsonb_set(event, '{claims,hotel_id}', to_jsonb(_hotel_id::TEXT)),
      '{claims,role}', to_jsonb(_role)
    );
  END IF;

  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;
