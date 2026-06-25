// ============================================================
// LoyaltyPay — Supabase Client + Auth + Data Layer
//
// DROP THIS FILE into the HTML as a <script> tag BEFORE the
// main app script. It replaces localStorage with real API calls.
//
// Setup:
//   1. npm install @supabase/supabase-js
//   OR include via CDN:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//
// Replace the two constants below with your project values.
// ============================================================

const SUPABASE_URL  = 'https://togjwxlzieqysyrdbcil.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ2p3eGx6aWVxeXN5cmRiY2lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzODUxNDcsImV4cCI6MjA5Nzk2MTE0N30.N1M819lk4s-Chk-TUxHc-KKvKO1c4yuZhl_8C9HH9WE';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Cached session — set on signIn, used by getRole/getHotelId synchronously
let _cachedSession = null;

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
const Auth = {

  async signIn(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _cachedSession = data.session;
    return data;
  },

  async signUp({ email, password, hotelName, hotelType }) {
    // 1. Create auth user
    const { data: authData, error: authErr } = await _sb.auth.signUp({ email, password });
    if (authErr) throw authErr;

    const userId = authData.user.id;
    _cachedSession = authData.session;

    // 2. Create hotel row (bypass RLS using service role not needed — anon can insert)
    const { data: hotel, error: hotelErr } = await _sb
      .from('hotels')
      .insert({ name: hotelName, property_type: hotelType })
      .select()
      .single();
    if (hotelErr) throw hotelErr;

    // 3. Create user profile
    const { error: userErr } = await _sb
      .from('users')
      .insert({ id: userId, hotel_id: hotel.id, name: email.split('@')[0], email, role: 'owner' });
    if (userErr) throw userErr;

    // 4. Seed default tiers / earn / redemption config
    await _sb.rpc('seed_hotel_defaults', { p_hotel_id: hotel.id });

    return { user: authData.user, hotel };
  },

  async signOut() {
    _cachedSession = null;
    await _sb.auth.signOut();
    window.location.reload();
  },

  async getSession() {
    const { data } = await _sb.auth.getSession();
    _cachedSession = data.session;
    return data.session;
  },

  getHotelId() {
    return _cachedSession?.user?.app_metadata?.hotel_id || null;
  },

  getRole() {
    return _cachedSession?.user?.app_metadata?.role || 'owner';
  },

  async resetPassword(email) {
    const { error } = await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://loyorapay.com'
    });
    if (error) throw error;
  },

  onAuthChange(callback) {
    _sb.auth.onAuthStateChange((event, session) => {
      _cachedSession = session;
      callback(event, session);
    });
  }
};

// ─────────────────────────────────────────────────────────────
// DATA LAYER  (replaces persistState / loadPersistedState)
// All functions are async — call with await or .then()
// ─────────────────────────────────────────────────────────────
const DB = {

  // ── Hotel ──────────────────────────────────────────────────
  async getHotel() {
    const { data, error } = await _sb.from('hotels').select('*').single();
    if (error) throw error;
    return data;
  },

  async updateHotel(fields) {
    const { error } = await _sb.from('hotels').update(fields).eq('id', Auth.getHotelId());
    if (error) throw error;
  },

  // ── Guests ─────────────────────────────────────────────────
  async getGuests({ search, tierIdx, churnStatus, limit = 500, offset = 0 } = {}) {
    let q = _sb.from('guests').select('*').order('lifetime_spend', { ascending: false });
    if (search)      q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,membership_id.ilike.%${search}%`);
    if (tierIdx !== undefined) q = q.eq('tier_idx', tierIdx);
    if (churnStatus) q = q.eq('churn_status', churnStatus);
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
    const { data, error } = await _sb.from('guests').upsert(guest).select().single();
    if (error) throw error;
    return data;
  },

  async bulkUpsertGuests(guests) {
    // Used by Data Upload screen
    const { data, error } = await _sb.from('guests').upsert(guests, { onConflict: 'membership_id' });
    if (error) throw error;
    return data;
  },

  // ── Points transactions ────────────────────────────────────
  async addTransaction(tx) {
    // tx: { guest_id, type, points, description, earn_category, rate_code, ref_code, expiry_date }
    const { data, error } = await _sb
      .from('points_transactions')
      .insert({ ...tx, hotel_id: Auth.getHotelId() })
      .select()
      .single();
    if (error) throw error;
    return data;  // balance auto-updated by DB trigger
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

  // Earn points for a stay (called after check-out sync from PMS)
  async earnPoints({ guestId, points, category, rateCode, description }) {
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 18);  // 18-month default
    return DB.addTransaction({
      guest_id: guestId, type: 'earn', points,
      earn_category: category, rate_code: rateCode,
      description, expiry_date: expiryDate.toISOString().split('T')[0]
    });
  },

  // ── Redemptions ────────────────────────────────────────────
  async createRedemption(redemption) {
    const { data, error } = await _sb
      .from('redemptions')
      .insert({ ...redemption, hotel_id: Auth.getHotelId() })
      .select()
      .single();
    if (error) throw error;

    // Deduct points
    await DB.addTransaction({
      guest_id: redemption.guest_id,
      type: 'redeem',
      points: -(redemption.points_used),
      description: redemption.reward_name,
      ref_code: redemption.ref_code
    });

    return data;
  },

  async getRedemptions({ status, limit = 100 } = {}) {
    let q = _sb.from('redemptions')
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

  // ── Campaigns ──────────────────────────────────────────────
  async getCampaigns(status) {
    let q = _sb.from('campaigns').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async upsertCampaign(campaign) {
    const { data, error } = await _sb
      .from('campaigns')
      .upsert({ ...campaign, hotel_id: Auth.getHotelId() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── Templates ──────────────────────────────────────────────
  async getTemplates() {
    const { data, error } = await _sb.from('templates').select('*').order('send_count', { ascending: false });
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

  // ── Earn config ────────────────────────────────────────────
  async getEarnConfig() {
    const { data, error } = await _sb.from('earn_config').select('*').single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updateEarnConfig(fields) {
    const { error } = await _sb
      .from('earn_config')
      .upsert({ ...fields, hotel_id: Auth.getHotelId(), updated_at: new Date() });
    if (error) throw error;
  },

  // ── Redemption config ──────────────────────────────────────
  async getRedemptionConfig() {
    const { data, error } = await _sb.from('redemption_config').select('*').single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updateRedemptionConfig(fields) {
    const { error } = await _sb
      .from('redemption_config')
      .upsert({ ...fields, hotel_id: Auth.getHotelId(), updated_at: new Date() });
    if (error) throw error;
  },

  // ── Tier config ────────────────────────────────────────────
  async getTierConfig() {
    const { data, error } = await _sb.from('tier_config').select('*').single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updateTierConfig(tiers) {
    const { error } = await _sb
      .from('tier_config')
      .upsert({ hotel_id: Auth.getHotelId(), tiers, updated_at: new Date() });
    if (error) throw error;
  },

  // ── Staff ──────────────────────────────────────────────────
  async getStaff() {
    const { data, error } = await _sb.from('users').select('id, name, email, role, created_at');
    if (error) throw error;
    return data;
  },

  async inviteStaff({ name, email, role }) {
    // Supabase invite sends email with magic link
    const { data, error } = await _sb.auth.admin.inviteUserByEmail(email, {
      data: { name, role }
    });
    if (error) throw error;
    return data;
  },

  async removeStaff(userId) {
    const { error } = await _sb.from('users').delete().eq('id', userId);
    if (error) throw error;
  }
};

// ─────────────────────────────────────────────────────────────
// INTEGRATION HOOKS  (wire into existing app functions)
//
// In the HTML, find these functions and replace/extend:
//
// 1. persistState()  →  await DB.updateEarnConfig(...)  etc.
//    (each section saves its own table instead of one blob)
//
// 2. loadPersistedState()  →  load from DB on boot
//    const hotel    = await DB.getHotel();
//    const guests   = await DB.getGuests();
//    const config   = await DB.getEarnConfig();
//    ... merge into state object
//
// 3. login() / logout()  →  Auth.signIn() / Auth.signOut()
//
// 4. The onboarding "New Property" form  →  Auth.signUp()
// ─────────────────────────────────────────────────────────────

// Boot helper: call this at app start instead of loadPersistedState()
async function bootFromDB() {
  const session = await Auth.getSession();
  if (!session) {
    // Not logged in — show login screen
    go('login');
    return;
  }

  try {
    // Load everything in parallel
    const [hotel, guests, earnCfg, redemCfg, tierCfg, templates, campaigns] = await Promise.all([
      DB.getHotel(),
      DB.getGuests(),
      DB.getEarnConfig(),
      DB.getRedemptionConfig(),
      DB.getTierConfig(),
      DB.getTemplates(),
      DB.getCampaigns()
    ]);

    // Merge into existing state object
    if (hotel) {
      state.hotel         = { ...state.hotel, ...hotel };
      state.programName   = hotel.program_name;
      state.plan          = hotel.plan;
    }
    if (guests)    state.guests        = guests;
    if (tierCfg)   state.tierConfig    = tierCfg.tiers;
    if (earnCfg)   Object.assign(state, earnCfg);
    if (redemCfg) {
      state.redemption = {
        ...state.redemption,
        pointValue:       redemCfg.point_value,
        minRedeem:        redemCfg.min_redeem,
        maxPct:           redemCfg.max_pct,
        expiryMonths:     redemCfg.expiry_months,
        expiryWarningDays: redemCfg.expiry_warn_days
      };
    }

    // Set role from JWT
    state.role = Auth.getRole();

    boot();  // existing app boot function
  } catch (err) {
    console.error('bootFromDB failed:', err);
    // Fall back to localStorage demo mode
    loadPersistedState();
    boot();
  }
}

// Export for use in HTML
window.LP = { Auth, DB, bootFromDB };
