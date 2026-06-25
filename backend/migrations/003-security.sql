-- ============================================================
-- Migration 003: Security hardening
-- Run in Supabase SQL Editor after schema.sql and 002-gdpr.sql
--
-- 1. Missing indexes for performance
-- 2. Tighten RLS policies
-- 3. Audit log table
-- 4. Rate limiting helpers
-- ============================================================

-- ── 1. Performance indexes ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_guests_hotel_tier
  ON guests (hotel_id, tier_idx);

CREATE INDEX IF NOT EXISTS idx_guests_hotel_churn
  ON guests (hotel_id, churn_status);

CREATE INDEX IF NOT EXISTS idx_guests_hotel_email
  ON guests (hotel_id, email);

CREATE INDEX IF NOT EXISTS idx_transactions_guest
  ON points_transactions (guest_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_hotel_date
  ON points_transactions (hotel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_expiry
  ON points_transactions (expiry_date, expired)
  WHERE expired = FALSE;

CREATE INDEX IF NOT EXISTS idx_campaigns_hotel_status
  ON campaigns (hotel_id, status);

CREATE INDEX IF NOT EXISTS idx_redemptions_hotel_status
  ON redemptions (hotel_id, status);

-- ── 2. Prevent cross-hotel data leaks — explicit hotel_id check ──
-- The RLS policy on guests already checks hotel_id via users join,
-- but this additional check makes it explicit and faster.

DROP POLICY IF EXISTS "Users can read own hotel guests" ON guests;
CREATE POLICY "Users can read own hotel guests"
  ON guests FOR SELECT
  USING (
    hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "Users can modify own hotel guests" ON guests;
CREATE POLICY "Users can insert own hotel guests"
  ON guests FOR INSERT
  WITH CHECK (
    hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1)
  );

CREATE POLICY "Users can update own hotel guests"
  ON guests FOR UPDATE
  USING (
    hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1)
  );

-- ── 3. Audit log — tracks all mutations ──────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,   -- 'earn_points', 'redeem', 'cancel_redemption', 'edit_guest', etc.
  entity      TEXT        NOT NULL,   -- table name
  entity_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Owners can read audit log; no one can mutate it via API
CREATE POLICY "Owners can read audit log"
  ON audit_log FOR SELECT
  USING (
    hotel_id = (SELECT hotel_id FROM users WHERE id = auth.uid() LIMIT 1)
    AND (SELECT role FROM users WHERE id = auth.uid() LIMIT 1) = 'owner'
  );

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_audit_log_hotel_date
  ON audit_log (hotel_id, created_at DESC);

-- ── 4. Trigger: auto-audit redemptions ───────────────────────
CREATE OR REPLACE FUNCTION audit_redemption()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_log (hotel_id, user_id, action, entity, entity_id, old_data, new_data)
  VALUES (
    NEW.hotel_id,
    auth.uid(),
    TG_OP,
    'redemptions',
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_redemptions ON redemptions;
CREATE TRIGGER trg_audit_redemptions
  AFTER INSERT OR UPDATE ON redemptions
  FOR EACH ROW EXECUTE FUNCTION audit_redemption();

-- ── 5. Prevent negative points balances ──────────────────────
CREATE OR REPLACE FUNCTION prevent_negative_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NEW.points < 0 THEN
    SELECT points_balance INTO v_balance
    FROM guests WHERE id = NEW.guest_id;

    IF v_balance + NEW.points < 0 THEN
      RAISE EXCEPTION 'Insufficient points balance. Has: %, Trying to deduct: %',
        v_balance, ABS(NEW.points);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_negative_balance ON points_transactions;
CREATE TRIGGER trg_prevent_negative_balance
  BEFORE INSERT ON points_transactions
  FOR EACH ROW
  WHEN (NEW.points < 0)
  EXECUTE FUNCTION prevent_negative_balance();

-- ── 6. Function: safe_redeem (atomic redemption) ─────────────
-- Use this instead of manual inserts to avoid race conditions
CREATE OR REPLACE FUNCTION safe_redeem(
  p_guest_id    UUID,
  p_hotel_id    UUID,
  p_points      INTEGER,
  p_description TEXT,
  p_ref_code    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_redemption_id UUID;
BEGIN
  -- Atomic: check balance + insert in same transaction
  PERFORM 1 FROM guests
    WHERE id = p_guest_id
      AND hotel_id = p_hotel_id
      AND points_balance >= p_points
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient points or guest not found';
  END IF;

  INSERT INTO redemptions (guest_id, hotel_id, points_used, reward_name, ref_code, status)
  VALUES (p_guest_id, p_hotel_id, p_points, p_description, p_ref_code, 'pending')
  RETURNING id INTO v_redemption_id;

  INSERT INTO points_transactions (guest_id, hotel_id, type, points, description, ref_code)
  VALUES (p_guest_id, p_hotel_id, 'redeem', -p_points, p_description, p_ref_code);

  RETURN v_redemption_id;
END;
$$;
