// ============================================================
// Edge Function: pms-webhook
// Method: POST
// Auth: shared secret header X-LoyoraPay-Secret
//
// Called by Aisency's PMS connector (Mews / Cloudbeds / Apaleo)
// whenever a guest checks in or checks out.
//
// Aisency will POST to:
//   https://togjwxlzieqysyrdbcil.supabase.co/functions/v1/pms-webhook
//
// With header:
//   X-LoyoraPay-Secret: <secret from Supabase env>
//
// ── CHECKOUT EVENT ───────────────────────────────────────────
// {
//   "event":      "checkout",
//   "hotel_id":   "uuid",
//   "pms_guest_id": "string",
//   "email":      "guest@email.com",
//   "name":       "Ahmed Al-Rashid",
//   "phone":      "+971501234567",
//   "nationality": "AE",
//   "stay": {
//     "check_in":  "2025-11-01",
//     "check_out": "2025-11-04",
//     "nights":    3,
//     "room_type": "Deluxe Sea View",
//     "rate_code": "BAR",
//     "spend_aed": 4200.00
//   }
// }
//
// ── CHECKIN EVENT ────────────────────────────────────────────
// {
//   "event":    "checkin",
//   "hotel_id": "uuid",
//   "email":    "guest@email.com",
//   "name":     "Ahmed Al-Rashid"
// }
//
// Deploy:
//   supabase functions deploy pms-webhook
//
// Set secret in Supabase dashboard:
//   Settings → Edge Functions → Environment variables
//   PMS_WEBHOOK_SECRET = <generate a strong random string>
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const WEBHOOK_SECRET = Deno.env.get('PMS_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Verify shared secret
  const secret = req.headers.get('X-LoyoraPay-Secret');
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const { event, hotel_id, email, name } = payload as {
    event: string; hotel_id: string; email: string; name: string;
    pms_guest_id?: string; phone?: string; nationality?: string;
    stay?: { check_in: string; check_out: string; nights: number; room_type: string; rate_code: string; spend_aed: number; };
  };

  if (!event || !hotel_id || !email) {
    return new Response('Missing required fields', { status: 400 });
  }

  // ── CHECKIN ─────────────────────────────────────────────────
  if (event === 'checkin') {
    // Just upsert the guest — no points yet
    await supabase.from('guests').upsert(
      { hotel_id, email, name },
      { onConflict: 'email,hotel_id', ignoreDuplicates: true }
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── CHECKOUT ─────────────────────────────────────────────────
  if (event === 'checkout') {
    const p = payload as typeof payload & {
      pms_guest_id?: string; phone?: string; nationality?: string;
      stay: { check_in: string; check_out: string; nights: number; room_type: string; rate_code: string; spend_aed: number; };
    };
    const { stay } = p;

    if (!stay?.spend_aed) {
      return new Response('Missing stay.spend_aed', { status: 400 });
    }

    // 1. Get earn config for this hotel
    const { data: earnCfg } = await supabase
      .from('earn_config')
      .select('*')
      .eq('hotel_id', hotel_id)
      .single();

    const baseRate = earnCfg?.base_rate_room ?? 10; // points per AED spent

    // 2. Check rate-code suppression
    const suppressed: string[] = earnCfg?.suppressed_rate_codes ?? [];
    if (suppressed.includes(stay.rate_code)) {
      console.log(`Rate code ${stay.rate_code} is suppressed — no points earned`);
      return new Response(JSON.stringify({ ok: true, points: 0, reason: 'suppressed' }), { status: 200 });
    }

    // 3. Upsert guest
    const { data: guest, error: guestErr } = await supabase
      .from('guests')
      .upsert(
        {
          hotel_id,
          email,
          name,
          phone:       p.phone,
          nationality: p.nationality,
          pms_id:      p.pms_guest_id,
        },
        { onConflict: 'email,hotel_id' }
      )
      .select()
      .single();

    if (guestErr || !guest) {
      return new Response(JSON.stringify({ error: 'Guest upsert failed' }), { status: 500 });
    }

    // 4. Calculate points
    const rawPoints = Math.floor(stay.spend_aed * baseRate);

    // 5. Apply tier multiplier
    const tierMultipliers = [1, 1.25, 1.5, 2]; // bronze / silver / gold / platinum
    const tierMultiplier  = tierMultipliers[guest.tier_idx ?? 0] ?? 1;
    const finalPoints     = Math.floor(rawPoints * tierMultiplier);

    // 6. Expiry = 18 months from check-out
    const expiry = new Date(stay.check_out);
    expiry.setMonth(expiry.getMonth() + 18);

    // 7. Insert earn transaction
    await supabase.from('points_transactions').insert({
      guest_id:      guest.id,
      hotel_id,
      type:          'earn',
      points:        finalPoints,
      earn_category: 'room',
      rate_code:     stay.rate_code,
      description:   `Stay ${stay.check_in} → ${stay.check_out} · ${stay.room_type}`,
      expiry_date:   expiry.toISOString().split('T')[0],
    });

    // 8. Update lifetime stats on guest
    await supabase
      .from('guests')
      .update({
        lifetime_spend:  (guest.lifetime_spend ?? 0) + stay.spend_aed,
        total_stays:     (guest.total_stays    ?? 0) + 1,
        last_stay:       stay.check_out,
      })
      .eq('id', guest.id);

    return new Response(
      JSON.stringify({ ok: true, guest_id: guest.id, points: finalPoints }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(`Unknown event: ${event}`, { status: 400 });
});
