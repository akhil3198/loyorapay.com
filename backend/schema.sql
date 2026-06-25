-- ============================================================
-- LoyaltyPay — Supabase PostgreSQL Schema
-- Multi-tenant: every table has hotel_id + RLS isolation
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- 1. HOTELS  (one row per property)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE hotels (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  city            TEXT,
  country         TEXT,
  star_rating     SMALLINT DEFAULT 5,
  property_type   TEXT DEFAULT 'Hotel',
  rooms           INTEGER DEFAULT 150,
  currency        TEXT DEFAULT 'AED',
  language        TEXT DEFAULT 'English',
  revenue         NUMERIC DEFAULT 3200000,
  program_name    TEXT DEFAULT 'Rewards',
  plan            TEXT DEFAULT 'growth',       -- starter | growth | enterprise
  stripe_customer_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 2. USERS  (staff accounts — linked to hotels + Supabase Auth)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'frontdesk',  -- owner | revenue | frontdesk
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast hotel → user lookups
CREATE INDEX idx_users_hotel ON users(hotel_id);

-- ─────────────────────────────────────────────────────────────
-- 3. GUESTS  (loyalty programme members)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE guests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id            UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  membership_id       TEXT UNIQUE,              -- LP-XXXXX
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  nationality         TEXT,
  tier_idx            SMALLINT DEFAULT 0,       -- 0=Bronze 1=Silver 2=Gold 3=Platinum
  points_balance      INTEGER DEFAULT 0,
  lifetime_points     INTEGER DEFAULT 0,
  lifetime_spend      NUMERIC DEFAULT 0,
  total_stays         INTEGER DEFAULT 0,
  last_stay_date      DATE,
  room                TEXT,
  experience_mode     TEXT,
  churn_status        TEXT DEFAULT 'Active',    -- Active | At Risk | Churned
  ges                 SMALLINT DEFAULT 70,      -- Guest Engagement Score 0-100
  enrolled_at         TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_guests_hotel    ON guests(hotel_id);
CREATE INDEX idx_guests_tier     ON guests(hotel_id, tier_idx);
CREATE INDEX idx_guests_churn    ON guests(hotel_id, churn_status);

-- ─────────────────────────────────────────────────────────────
-- 4. POINTS_TRANSACTIONS  (earn/burn ledger)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE points_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id        UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,               -- earn | redeem | expire | adjust | bonus
  points          INTEGER NOT NULL,            -- positive = earn, negative = redeem/expire
  description     TEXT,
  earn_category   TEXT,                        -- room | fb | spa | golf | activities
  rate_code       TEXT,
  ref_code        TEXT,                        -- e.g. LP-ABC123 for redemptions
  staff_id        UUID REFERENCES users(id),
  expiry_date     DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ptx_guest   ON points_transactions(guest_id);
CREATE INDEX idx_ptx_hotel   ON points_transactions(hotel_id);
CREATE INDEX idx_ptx_expiry  ON points_transactions(hotel_id, expiry_date) WHERE type = 'earn';

-- ─────────────────────────────────────────────────────────────
-- 5. REDEMPTIONS  (redemption requests + log)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE redemptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id        UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  ref_code        TEXT NOT NULL,               -- LP-XXXXXX
  reward_type     TEXT NOT NULL,               -- free-night | upgrade | spa | fb-flex | late-checkout | airline-miles
  reward_name     TEXT,
  points_used     INTEGER NOT NULL,
  bonus_pts       INTEGER DEFAULT 0,
  cash_topup      NUMERIC DEFAULT 0,
  status          TEXT DEFAULT 'approved',     -- pending | approved | declined
  method          TEXT DEFAULT 'agent',        -- agent | remote
  fraud_flag      BOOLEAN DEFAULT FALSE,
  airline_code    TEXT,                        -- EK | EY | QR | SQ | BA
  ffn             TEXT,                        -- frequent flyer number
  miles_awarded   INTEGER,
  agent_id        UUID REFERENCES users(id),
  manager_id      UUID REFERENCES users(id),   -- if PIN required
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_redemp_hotel  ON redemptions(hotel_id);
CREATE INDEX idx_redemp_guest  ON redemptions(guest_id);
CREATE INDEX idx_redemp_status ON redemptions(hotel_id, status);

-- ─────────────────────────────────────────────────────────────
-- 6. CAMPAIGNS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT,                        -- Promotional | Win-back | Tier | Seasonal
  goal            TEXT,
  audience        TEXT DEFAULT 'all',
  message         TEXT,
  channel         TEXT DEFAULT 'whatsapp',     -- whatsapp | email | both
  status          TEXT DEFAULT 'draft',        -- draft | scheduled | sent | paused
  schedule_at     TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  recipient_count INTEGER DEFAULT 0,
  open_count      INTEGER DEFAULT 0,
  reply_count     INTEGER DEFAULT 0,
  template_id     UUID,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_camp_hotel  ON campaigns(hotel_id);
CREATE INDEX idx_camp_status ON campaigns(hotel_id, status);

-- ─────────────────────────────────────────────────────────────
-- 7. TEMPLATES  (message templates library)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT,                        -- pre-arrival | welcome | instay | poststay | tier | winback | milestone | seasonal | ancillary
  channel         TEXT DEFAULT 'whatsapp',     -- whatsapp | email | both
  tone            TEXT DEFAULT 'warm',
  email_subject   TEXT,
  body            TEXT NOT NULL,
  opens_pct       SMALLINT DEFAULT 0,
  replies_pct     SMALLINT DEFAULT 0,
  conv_pct        SMALLINT DEFAULT 0,
  send_count      INTEGER DEFAULT 0,
  is_default      BOOLEAN DEFAULT FALSE,       -- seeded template vs custom
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tmpl_hotel ON templates(hotel_id);

-- ─────────────────────────────────────────────────────────────
-- 8. EARN_CONFIG  (earn rules + matrix — stored as JSONB)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE earn_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL UNIQUE REFERENCES hotels(id) ON DELETE CASCADE,
  base_rates      JSONB DEFAULT '{}',          -- earn rates per category
  behavior_bonuses JSONB DEFAULT '[]',
  group_multipliers JSONB DEFAULT '[]',
  dynamic_rate    JSONB DEFAULT '{}',
  earn_cal        JSONB DEFAULT '{}',          -- 12-month seasonal multipliers
  earn_matrix     JSONB DEFAULT '{}',          -- segment × demand matrix
  rate_suppress   JSONB DEFAULT '[]',          -- suppressed rate codes
  tier_multipliers JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 9. REDEMPTION_CONFIG  (point value, expiry, catalogue)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE redemption_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL UNIQUE REFERENCES hotels(id) ON DELETE CASCADE,
  point_value     NUMERIC DEFAULT 0.01,        -- AED per point
  min_redeem      INTEGER DEFAULT 5000,
  max_pct         SMALLINT DEFAULT 50,         -- max % of bill
  expiry_months   SMALLINT DEFAULT 18,
  expiry_warn_days SMALLINT DEFAULT 30,
  catalogue       JSONB DEFAULT '[]',
  airline_partners JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 10. TIER_CONFIG
-- ─────────────────────────────────────────────────────────────
CREATE TABLE tier_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL UNIQUE REFERENCES hotels(id) ON DELETE CASCADE,
  tiers           JSONB NOT NULL DEFAULT '[]', -- [{name, threshold, multiplier, benefits}]
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — hotel isolation
-- Every table locked to the JWT's hotel_id claim
-- ─────────────────────────────────────────────────────────────

-- Helper: extract hotel_id from JWT
CREATE OR REPLACE FUNCTION auth_hotel_id() RETURNS UUID AS $$
  SELECT (auth.jwt() ->> 'hotel_id')::UUID;
$$ LANGUAGE SQL STABLE;

-- Helper: extract role from JWT
CREATE OR REPLACE FUNCTION auth_role() RETURNS TEXT AS $$
  SELECT auth.jwt() ->> 'role';
$$ LANGUAGE SQL STABLE;

-- Enable RLS on every table
ALTER TABLE hotels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE earn_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemption_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_config      ENABLE ROW LEVEL SECURITY;

-- Hotels: user can only see their own hotel
CREATE POLICY hotel_self ON hotels
  USING (id = auth_hotel_id());

-- Users: see only colleagues at same hotel
CREATE POLICY users_same_hotel ON users
  USING (hotel_id = auth_hotel_id());

-- All data tables: hotel isolation
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'guests','points_transactions','redemptions',
  'campaigns','templates','earn_config',
  'redemption_config','tier_config'
]) LOOP
  EXECUTE format('CREATE POLICY %I_hotel_iso ON %I USING (hotel_id = auth_hotel_id())', t, t);
END LOOP; END $$;

-- Write restrictions: frontdesk cannot write campaigns or earn rules
CREATE POLICY guests_write ON guests FOR INSERT WITH CHECK (
  hotel_id = auth_hotel_id()
);
CREATE POLICY campaigns_no_frontdesk ON campaigns FOR INSERT WITH CHECK (
  hotel_id = auth_hotel_id() AND auth_role() IN ('owner','revenue')
);
CREATE POLICY earn_no_frontdesk ON earn_config FOR UPDATE USING (
  hotel_id = auth_hotel_id() AND auth_role() IN ('owner','revenue')
);

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: set JWT claims on login (called by auth trigger)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_auth_claims()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _hotel_id UUID;
  _role TEXT;
BEGIN
  SELECT hotel_id, role INTO _hotel_id, _role
  FROM users WHERE id = NEW.id;

  IF _hotel_id IS NOT NULL THEN
    NEW.raw_app_meta_data = NEW.raw_app_meta_data ||
      jsonb_build_object('hotel_id', _hotel_id, 'role', _role);
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger fires after each login to stamp claims onto JWT
CREATE TRIGGER on_auth_user_login
  BEFORE UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION set_auth_claims();

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: auto-generate membership_id for new guests
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_membership_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.membership_id IS NULL THEN
    NEW.membership_id := 'LP-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT), 1, 5));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_membership_id
  BEFORE INSERT ON guests
  FOR EACH ROW EXECUTE FUNCTION generate_membership_id();

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: update guest balance on points transaction
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_guest_points()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE guests SET
    points_balance  = points_balance + NEW.points,
    lifetime_points = CASE WHEN NEW.points > 0
                      THEN lifetime_points + NEW.points ELSE lifetime_points END
  WHERE id = NEW.guest_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER after_points_insert
  AFTER INSERT ON points_transactions
  FOR EACH ROW EXECUTE FUNCTION sync_guest_points();

-- ─────────────────────────────────────────────────────────────
-- SEED: default tier config (applied when hotel onboards)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_hotel_defaults(p_hotel_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tier_config(hotel_id, tiers) VALUES (p_hotel_id, '[
    {"name":"Bronze","threshold":0,    "multiplier":1.0,"color":"#CD7F32"},
    {"name":"Silver","threshold":5000, "multiplier":1.5,"color":"#A8A9AD"},
    {"name":"Gold",  "threshold":15000,"multiplier":2.0,"color":"#D4AF37"},
    {"name":"Platinum","threshold":30000,"multiplier":3.0,"color":"#E5E4E2"}
  ]') ON CONFLICT (hotel_id) DO NOTHING;

  INSERT INTO earn_config(hotel_id) VALUES (p_hotel_id)
    ON CONFLICT (hotel_id) DO NOTHING;

  INSERT INTO redemption_config(hotel_id) VALUES (p_hotel_id)
    ON CONFLICT (hotel_id) DO NOTHING;
END;
$$;
