// ============================================================
// Edge Function: pms-webhook  v2
// Method: POST
// Auth: shared secret header X-LoyoraPay-Secret
//
// Called by Aisency's PMS connector on checkout.
// Column names aligned with schema.sql + migration 004.
//
// Deploy: supabase functions deploy pms-webhook
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const WEBHOOK_SECRET = Deno.env.get('PMS_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = req.headers.get('X-LoyoraPay-Secret');
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const { event, hotel_id, email, name } = payload as {
    event: string; hotel_id: string; email: string; name: string;
    pms_guest_id?: string; phone?: string; nationality?: string;
    stay?: { check_in: string; check_out: string; nights: number; room_type: string; rate_code: string; spend_aed: number };
  };

  if (!event || !hotel_id || !email) {
    return new Response('Missing required fields: event, hotel_id, email', { status: 400 });
  }

  // ── CHECKIN ──────────────────────────────────────────────
  if (event === 'checkin') {
    await supabase.from('guests').upsert(
      { hotel_id, email, name: name || 'Guest' },
      { onConflict: 'email,hotel_id', ignoreDuplicates: true }
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── CHECKOUT ─────────────────────────────────────────────
  if (event === 'checkout') {
    const p = payload as typeof payload & {
      pms_guest_id?: string; phone?: string; nationality?: string;
      stay: { check_in: string; check_out: string; nights: number; room_type: string; rate_code: string; spend_aed: number };
    };
    const { stay } = p;
    if (!stay?.spend_aed) return new Response('Missing stay.spend_aed', { status: 400 });

    // 1. Load earn config — flat columns (migration 004)
    const { data: earnCfg } = await supabase
      .from('earn_config')
      .select('base_rate_room, suppressed_rate_codes, dynamic_enabled, dynamic_threshold')
      .eq('hotel_id', hotel_id)
      .single();

    const baseRate:   number   = earnCfg?.base_rate_room         ?? 10;
    const suppressed: string[] = earnCfg?.suppressed_rate_codes  ?? [];

    // 2. Check rate-code suppression
    if (suppressed.includes(stay.rate_code)) {
      console.log(`Rate code ${stay.rate_code} suppressed — no points`);
      return new Response(JSON.stringify({ ok: true, points: 0, reason: 'suppressed' }), { status: 200 });
    }

    // 3. Upsert guest — use schema column names: last_stay_date, pms_id
    const { data: guest, error: guestErr } = await supabase
      .from('guests')
      .upsert(
        {
          hotel_id,
          email,
          name:          name || 'Guest',
          phone:         p.phone         || undefined,
          nationality:   p.nationality   || undefined,
          pms_id:        p.pms_guest_id  || undefined,   // migration 004 adds this column
          last_stay_date: stay.check_out,                 // correct schema column name
          total_stays:   1,                               // will be incremented below
        },
        { onConflict: 'email,hotel_id' }
      )
      .select('id, tier_idx, total_stays, lifetime_spend')
      .single();

    if (guestErr || !guest) {
      console.error('Guest upsert failed:', guestErr);
      return new Response(JSON.stringify({ error: 'Guest upsert failed' }), { status: 500 });
    }

    // 4. Increment total_stays and lifetime_spend atomically
    await supabase
      .from('guests')
      .update({
        last_stay_date:  stay.check_out,
        lifetime_spend:  (guest.lifetime_spend as number ?? 0) + stay.spend_aed,
        total_stays:     (guest.total_stays    as number ?? 0) + 1,
      })
      .eq('id', guest.id);

    // 5. Calculate points
    const tierMultipliers = [1.0, 1.25, 1.5, 2.0]; // matches default tier_config
    const tierMult  = tierMultipliers[(guest.tier_idx as number) ?? 0] ?? 1;
    const finalPts  = Math.floor(stay.spend_aed * baseRate * tierMult);

    // 6. Expiry = 18 months from check-out
    const expiry = new Date(stay.check_out);
    expiry.setMonth(expiry.getMonth() + 18);

    // 7. Insert earn transaction (trigger auto-updates points_balance)
    const { error: txErr } = await supabase.from('points_transactions').insert({
      guest_id:      guest.id,
      hotel_id,
      type:          'earn',
      points:        finalPts,
      earn_category: 'room',
      rate_code:     stay.rate_code,
      description:   `Stay ${stay.check_in} → ${stay.check_out} · ${stay.room_type}`,
      expiry_date:   expiry.toISOString().split('T')[0],
      expired:       false,
    });

    if (txErr) {
      console.error('Transaction insert failed:', txErr);
      return new Response(JSON.stringify({ error: 'Points insert failed' }), { status: 500 });
    }

    return new Response(
      JSON.stringify({ ok: true, guest_id: guest.id, points: finalPts }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(`Unknown event: ${event}`, { status: 400 });
});
