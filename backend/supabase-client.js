// ============================================================
// LoyoraPay — Supabase Client + Auth + Data Layer  v2
//
// Fixes applied (vs v1):
//  - getRole()/getHotelId() query users table directly — JWT
//    claims not guaranteed on first session after signUp
//  - DB.getHotel() uses hotel_id from profile, not .single() blindly
//  - DB.getEarnConfig() maps JSONB fields to flat state keys
//  - bootFromDB() maps correct DB column names to state fields
//  - inviteStaff() delegates to invite-staff edge function
//  - all hotel_id filters use _cachedProfile (not JWT claims)
// ============================================================

const SUPABASE_URL  = 'https://togjwxlzieqysyrdbcil.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ2p3eGx6aWVxeXN5cmRiY2lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzODUxNDcsImV4cCI6MjA5Nzk2MTE0N30.N1M819lk4s-Chk-TUxHc-KKvKO1c4yuZhl_8C9HH9WE';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Cached state — set on every signIn / signUp / getSession
let _cachedSession = null;
let _cachedProfile = null;   // { id, hotel_id, name, email, role } from users table

// ── Internal: load user profile from DB ──────────────────────
async function _loadProfile(userId) {
  const { data } = await _sb
    .from('users')
    .select('id, hotel_id, name, email, role')
    .eq('id', userId)
    .single();
  _cachedProfile = data || null;
  return _cachedProfile;
}

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
const Auth = {

  async signIn(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _cachedSession = data.session;
    await _loadProfile(data.user.id);   // always query DB — don't trust JWT claims alone
    return data;
  },

  async signUp({ email, password, hotelName, hotelType }) {
    // 1. Create Supabase auth user
    const { data: authData, error: authErr } = await _sb.auth.signUp({ email, password });
    if (authErr) throw authErr;

    const userId = authData.user.id;
    _cachedSession = authData.session;

    // 2. Create hotel row — INSERT policy in 004-schema-fixes.sql allows this
    const { data: hotel, error: hotelErr } = await _sb
      .from('hotels')
      .insert({ name: hotelName, property_type: hotelType })
      .select()
      .single();
    if (hotelErr) throw hotelErr;

    // 3. Create user profile row
    const { error: userErr } = await _sb
      .from('users')
      .insert({
        id:       userId,
        hotel_id: hotel.id,
        name:     email.split('@')[0],
        email,
        role:     'owner',
      });
    if (userErr) throw userErr;

    // 4. Seed default tier / earn / redemption config
    await _sb.rpc('seed_hotel_defaults', { p_hotel_id: hotel.id });

    // 5. Cache profile immediately so getHotelId()/getRole() work
    _cachedProfile = { id: userId, hotel_id: hotel.id, name: email.split('@')[0], email, role: 'owner' };

    return { user: authData.user, hotel };
  },

  async signOut() {
    _cachedSession = null;
    _cachedProfile = null;
    await _sb.auth.signOut();
    window.location.reload();
  },

  async getSession() {
    const { data } = await _sb.auth.getSession();
    _cachedSession = data.session;
    if (data.session?.user?.id && !_cachedProfile) {
      await _loadProfile(data.session.user.id);
    }
    return data.session;
  },

  // Always reads from DB profile — not JWT claims
  getHotelId() {
    return _cachedProfile?.hotel_id || null;
  },

  getRole() {
    return _cachedProfile?.role || 'owner';
  },

  async resetPassword(email) {
    const { error } = await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://loyorapay.com',
    });
    if (error) throw error;
  },

  onAuthChange(callback) {
    _sb.auth.onAuthStateChange(async (event, session) => {
      _cachedSession = session;
      if (session?.user?.id) {
        await _loadProfile(session.user.id);
      } else {
        _cachedProfile = null;
      }
      callback(event, session);
    });
  },
};

// ─────────────────────────────────────────────────────────────
// DATA LAYER
// ─────────────────────────────────────────────────────────────
const DB = {

  // ── Hotel ─────────────────────────────────────────────────
  async getHotel() {
    const hotelId = Auth.getHotelId();
    if (!hotelId) return null;
    const { data, error } = await _sb
      .from('hotels')
      .select('*')
      .eq('id', hotelId)
      .single();
    if (error) throw error;
    return data;
  },

  async updateHotel(fields) {
    const { error } = await _sb
      .from('hotels')
      .update(fields)
      .eq('id', Auth.getHotelId());
    if (error) throw error;
  },

  // ── Guests ────────────────────────────────────────────────
  async getGuests({ search, tierIdx, churnStatus, limit = 500, offset = 0 } = {}) {
    let q = _sb
      .from('guests')
      .select('*')
      .order('lifetime_spend', { ascending: false });
    if (search)                q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,membership_id.ilike.%${search}%`);
    if (tierIdx !== undefined) q = q.eq('tier_idx', tierIdx);
    if (churnStatus)           q = q.eq('churn_status', churnStatus.toLowerCase());
    q = q.range(offset, offset + limit - 1);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async getGuest(id) {
    const { data, error } = await _sb.from('guests').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async upsertGuest(guest) {
    const { data, error } = await _sb
      .from('guests')
      .upsert(guest)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async bulkUpsertGuests(guests) {
    const { data, error } = await _sb
      .from('guests')
      .upsert(guests, { onConflict: 'membership_id' });
    if (error) throw error;
    return data;
  },

  // ── Points transactions ───────────────────────────────────
  async addTransaction(tx) {
    const hotelId = Auth.getHotelId();
    if (!hotelId) throw new Error('Not authenticated');
    const { data, error } = await _sb
      .from('points_transactions')
      .insert({ ...tx, hotel_id: hotelId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getTransactions(guestId, limit = 50) {
    const { data, error } = await _sb
      .from('points_transactions')
      .select('*')
      .eq('guest_id', guestId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async earnPoints({ guestId, points, category, rateCode, description }) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 18);
    return DB.addTransaction({
      guest_id:      guestId,
      type:          'earn',
      points,
      earn_category: category,
      rate_code:     rateCode,
      description,
      expiry_date:   expiry.toISOString().split('T')[0],
    });
  },

  // ── Redemptions ───────────────────────────────────────────
  async createRedemption(redemption) {
    const hotelId = Auth.getHotelId();
    const { data, error } = await _sb
      .from('redemptions')
      .insert({ ...redemption, hotel_id: hotelId })
      .select()
      .single();
    if (error) throw error;

    await DB.addTransaction({
      guest_id:    redemption.guest_id,
      type:        'redeem',
      points:      -(Math.abs(redemption.points_used)),
      description: redemption.reward_name,
      ref_code:    redemption.ref_code,
    });

    return data;
  },

  async getRedemptions({ status, limit = 100 } = {}) {
    let q = _sb
      .from('redemptions')
      .select('*, guests(name, tier_idx)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async updateRedemptionStatus(id, status, managerId) {
    const { error } = await _sb
      .from('redemptions')
      .update({ status, manager_id: managerId })
      .eq('id', id);
    if (error) throw error;
  },

  // ── Campaigns ─────────────────────────────────────────────
  async getCampaigns(status) {
    let q = _sb.from('campaigns').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async upsertCampaign(campaign) {
    const hotelId = Auth.getHotelId();
    // Normalise: message_body → message (schema column)
    const row = {
      ...campaign,
      hotel_id:     hotelId,
      message:      campaign.message_body || campaign.message,
      message_body: campaign.message_body || campaign.message,
    };
    const { data, error } = await _sb
      .from('campaigns')
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Templates ─────────────────────────────────────────────
  async getTemplates() {
    const { data, error } = await _sb
      .from('templates')
      .select('*')
      .order('send_count', { ascending: false });
    if (error) throw error;
    return data;
  },

  async upsertTemplate(tpl) {
    const { data, error } = await _sb
      .from('templates')
      .upsert({ ...tpl, hotel_id: Auth.getHotelId() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Earn config ───────────────────────────────────────────
  // Schema stores earn rates as JSONB (base_rates) AND flat columns
  // This returns both so callers can use either
  async getEarnConfig() {
    const hotelId = Auth.getHotelId();
    if (!hotelId) return null;
    const { data, error } = await _sb
      .from('earn_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  // Accepts flat state keys — maps to correct DB columns
  async updateEarnConfig(stateFields) {
    const hotelId = Auth.getHotelId();
    if (!hotelId) return;

    // Map state keys → DB columns
    const row = {
      hotel_id:               hotelId,
      updated_at:             new Date(),
      // JSONB fields
      base_rates:             stateFields.earnSegments      || undefined,
      behavior_bonuses:       stateFields.behaviorBonuses   || undefined,
      group_multipliers:      stateFields.groupMultipliers  || undefined,
      dynamic_rate:           stateFields.dynamicRate       || undefined,
      earn_cal:               stateFields.earnCal           || undefined,
      earn_matrix:            stateFields.earnMatrix        || undefined,
      rate_suppress:          stateFields.rateSuppress      || undefined,
      tier_multipliers:       stateFields.tierMultipliers   || undefined,
      // Flat columns (from migration 004)
      base_rate_room:         stateFields.base_rate_room    || undefined,
      base_rate_fnb:          stateFields.base_rate_fnb     || undefined,
      base_rate_spa:          stateFields.base_rate_spa     || undefined,
      suppressed_rate_codes:  stateFields.suppressed_rate_codes || undefined,
    };

    // Remove undefined keys
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);

    const { error } = await _sb.from('earn_config').upsert(row);
    if (error) throw error;
  },

  // ── Redemption config ─────────────────────────────────────
  async getRedemptionConfig() {
    const hotelId = Auth.getHotelId();
    if (!hotelId) return null;
    const { data, error } = await _sb
      .from('redemption_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updateRedemptionConfig(fields) {
    const { error } = await _sb
      .from('redemption_config')
      .upsert({ ...fields, hotel_id: Auth.getHotelId(), updated_at: new Date() });
    if (error) throw error;
  },

  // ── Tier config ───────────────────────────────────────────
  async getTierConfig() {
    const hotelId = Auth.getHotelId();
    if (!hotelId) return null;
    const { data, error } = await _sb
      .from('tier_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updateTierConfig(tiers) {
    const { error } = await _sb
      .from('tier_config')
      .upsert({ hotel_id: Auth.getHotelId(), tiers, updated_at: new Date() });
    if (error) throw error;
  },

  // ── Staff ─────────────────────────────────────────────────
  async getStaff() {
    const { data, error } = await _sb
      .from('users')
      .select('id, name, email, role, created_at');
    if (error) throw error;
    return data;
  },

  // Calls invite-staff edge function (needs service role — can't call auth.admin from anon)
  async inviteStaff({ name, email, role }) {
    const session = _cachedSession;
    if (!session) throw new Error('Not authenticated');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-staff`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, role }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Invite failed');
    }
    return res.json();
  },

  async removeStaff(userId) {
    const { error } = await _sb.from('users').delete().eq('id', userId);
    if (error) throw error;
  },

  // ── Campaign send ─────────────────────────────────────────
  async sendCampaign(campaignId, dryRun = false) {
    const session = _cachedSession;
    if (!session) throw new Error('Not authenticated');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-campaign`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ campaign_id: campaignId, dry_run: dryRun }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Send failed');
    }
    return res.json();
  },
};

// ─────────────────────────────────────────────────────────────
// DB → STATE MAPPERS
// DB uses snake_case; HTML state uses camelCase
// ─────────────────────────────────────────────────────────────
function _mapChurnStatus(dbStatus) {
  const map = { 'active': 'Active', 'at_risk': 'At Risk', 'churned': 'Churned' };
  return map[(dbStatus || '').toLowerCase()] || 'Active';
}

function _mapDbGuest(g) {
  const now = new Date();
  const lastStayDate = g.last_stay_date ? new Date(g.last_stay_date) : null;
  const lastStayDays = lastStayDate
    ? Math.max(0, Math.round((now - lastStayDate) / (1000 * 60 * 60 * 24)))
    : 999;

  return {
    // Keep all original DB fields (for writes back to DB)
    ...g,
    // camelCase aliases the HTML UI reads
    pointsBalance:  g.points_balance  || 0,
    tierIdx:        g.tier_idx        || 0,
    lastStayDays:   lastStayDays,
    membershipId:   g.membership_id   || '',
    churn:          _mapChurnStatus(g.churn_status),
    lifetimeSpend:  g.lifetime_spend  || 0,
    totalStays:     g.total_stays     || 0,
    ges:            g.ges             || 50,
    // Hotel mapping
    name:           g.name            || 'Member',
    email:          g.email           || '',
    phone:          g.phone           || '',
    nationality:    g.nationality     || '',
  };
}

function _mapDbHotel(h) {
  return {
    ...h,
    // camelCase aliases
    name:         h.name          || '',
    city:         h.city          || '',
    country:      h.country       || '',
    starRating:   h.star_rating   || 5,
    propertyType: h.property_type || 'Hotel',
    rooms:        h.rooms         || 150,
    currency:     h.currency      || 'AED',
    language:     h.language      || 'English',
    revenue:      h.revenue       || 3200000,
    programName:  h.program_name  || 'Rewards',
    plan:         h.plan          || 'growth',
  };
}

// ─────────────────────────────────────────────────────────────
// BOOT HELPER
// ─────────────────────────────────────────────────────────────
async function bootFromDB() {
  const session = await Auth.getSession();
  if (!session) {
    go('login');
    return;
  }

  try {
    const [hotel, guests, earnCfg, redemCfg, tierCfg] = await Promise.all([
      DB.getHotel(),
      DB.getGuests(),
      DB.getEarnConfig(),
      DB.getRedemptionConfig(),
      DB.getTierConfig(),
    ]);

    if (hotel) {
      const mapped = _mapDbHotel(hotel);
      state.hotel       = { ...(state.hotel || {}), ...mapped };
      state.programName = mapped.programName || state.programName;
      state.plan        = mapped.plan        || state.plan;
    }

    if (guests && guests.length) {
      state.guests = guests.map(_mapDbGuest);
    }

    if (tierCfg?.tiers) {
      state.tierConfig = tierCfg.tiers;
    }

    if (earnCfg) {
      // Map JSONB fields → state keys
      if (earnCfg.base_rates)        state.earnSegments     = earnCfg.base_rates;
      if (earnCfg.behavior_bonuses)  state.behaviorBonuses  = earnCfg.behavior_bonuses;
      if (earnCfg.group_multipliers) state.groupMultipliers = earnCfg.group_multipliers;
      if (earnCfg.dynamic_rate)      state.dynamicRate      = earnCfg.dynamic_rate;
      if (earnCfg.earn_cal)          state.earnCal          = earnCfg.earn_cal;
      if (earnCfg.earn_matrix)       state.earnMatrix       = earnCfg.earn_matrix;
      if (earnCfg.rate_suppress)     state.rateSuppress     = earnCfg.rate_suppress;
    }

    if (redemCfg) {
      state.redemption = {
        ...(state.redemption || {}),
        pointValue:        redemCfg.point_value,
        minRedeem:         redemCfg.min_redeem,
        maxPct:            redemCfg.max_pct,
        expiryMonths:      redemCfg.expiry_months,
        expiryWarningDays: redemCfg.expiry_warn_days,
      };
    }

    state.role = Auth.getRole();

    boot();
  } catch (err) {
    console.error('bootFromDB failed — falling back to localStorage:', err);
    loadPersistedState();
    boot();
  }
}

window.LP = { Auth, DB, bootFromDB, mapDbGuest: _mapDbGuest };
