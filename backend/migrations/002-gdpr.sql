-- ============================================================
-- Migration 002: GDPR / PDPA compliance fields
-- Run in Supabase SQL Editor
--
-- Adds consent tracking, data deletion request handling,
-- and marketing opt-in to the guests table.
-- Required for UK/EU hotels and PDPA (Singapore/Thailand).
-- ============================================================

-- ── Consent + GDPR fields on guests ─────────────────────────
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS consent_given          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_date           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_source         TEXT,        -- 'web', 'pms', 'front_desk', 'email'
  ADD COLUMN IF NOT EXISTS marketing_opt_in       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deletion_requested     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deletion_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_retention_months  INTEGER     NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS anonymised             BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anonymised_at          TIMESTAMPTZ;

-- ── Consent log table (immutable audit trail) ─────────────────
CREATE TABLE IF NOT EXISTS consent_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id    UUID        REFERENCES guests(id) ON DELETE SET NULL,
  email       TEXT        NOT NULL,
  event       TEXT        NOT NULL,  -- 'consent_given', 'consent_withdrawn', 'deletion_requested', 'anonymised'
  channel     TEXT,                  -- 'email', 'web', 'pms', 'front_desk'
  ip_address  INET,
  user_agent  TEXT,
  recorded_by UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff can read own consent_log"
  ON consent_log FOR SELECT
  USING (hotel_id IN (SELECT hotel_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Hotel staff can insert consent_log"
  ON consent_log FOR INSERT
  WITH CHECK (hotel_id IN (SELECT hotel_id FROM users WHERE id = auth.uid()));

-- ── Data deletion request handler (stored procedure) ─────────
CREATE OR REPLACE FUNCTION request_guest_deletion(p_guest_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_hotel_id UUID;
  v_email    TEXT;
BEGIN
  SELECT hotel_id, email INTO v_hotel_id, v_email
  FROM guests WHERE id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;

  -- Mark deletion requested
  UPDATE guests
  SET deletion_requested = TRUE,
      deletion_requested_at = NOW()
  WHERE id = p_guest_id;

  -- Log it
  INSERT INTO consent_log (hotel_id, guest_id, email, event, channel)
  VALUES (v_hotel_id, p_guest_id, v_email, 'deletion_requested', 'dashboard');
END;
$$;

-- ── Anonymise guest (GDPR right to erasure) ──────────────────
-- Replaces PII with anonymised values, retains aggregated stats
CREATE OR REPLACE FUNCTION anonymise_guest(p_guest_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_hotel_id UUID;
  v_email    TEXT;
BEGIN
  SELECT hotel_id, email INTO v_hotel_id, v_email
  FROM guests WHERE id = p_guest_id;

  UPDATE guests SET
    name              = 'Anonymised Guest',
    email             = p_guest_id || '@deleted.invalid',
    phone             = NULL,
    nationality       = NULL,
    pms_id            = NULL,
    language          = NULL,
    anonymised        = TRUE,
    anonymised_at     = NOW(),
    deletion_requested = FALSE
  WHERE id = p_guest_id;

  -- Log
  INSERT INTO consent_log (hotel_id, guest_id, email, event)
  VALUES (v_hotel_id, p_guest_id, v_email, 'anonymised');
END;
$$;

-- ── Daily cron: process pending deletion requests ─────────────
-- Automatically anonymises guests who requested deletion > 30 days ago
-- Set up as a pg_cron job in Supabase dashboard:
--   SELECT cron.schedule('0 3 * * *', $$
--     SELECT anonymise_guest(id)
--     FROM guests
--     WHERE deletion_requested = TRUE
--       AND deletion_requested_at < NOW() - INTERVAL '30 days'
--       AND anonymised = FALSE;
--   $$);

-- ── Index for deletion processing ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_guests_deletion_requested
  ON guests (deletion_requested, deletion_requested_at)
  WHERE deletion_requested = TRUE AND anonymised = FALSE;
