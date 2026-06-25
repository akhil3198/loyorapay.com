// ============================================================
// Edge Function: expire-points  v2
// Uses points_transactions.expired column (migration 004)
// Schedule: 0 2 * * *  (daily 02:00 UTC)
// Deploy: supabase functions deploy expire-points
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (_req) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Find earn transactions past expiry, not yet expired
    const { data: expiring, error: fetchErr } = await supabase
      .from('points_transactions')
      .select('id, guest_id, hotel_id, points')
      .eq('type',    'earn')
      .eq('expired', false)
      .lt('expiry_date', today)
      .not('expiry_date', 'is', null);

    if (fetchErr) throw fetchErr;
    if (!expiring || expiring.length === 0) {
      return new Response(JSON.stringify({ ok: true, expired: 0 }), { status: 200 });
    }

    // Mark as expired
    const ids = expiring.map((t) => t.id);
    const { error: markErr } = await supabase
      .from('points_transactions')
      .update({ expired: true })
      .in('id', ids);
    if (markErr) throw markErr;

    // Insert debit transactions to reduce points_balance
    // The sync_guest_points trigger will auto-update the guest's balance
    const debits = expiring.map((t) => ({
      guest_id:    t.guest_id,
      hotel_id:    t.hotel_id,
      type:        'expire',
      points:      -(Math.abs(t.points as number)),
      description: 'Points expired',
      expired:     false,
    }));

    const { error: debitErr } = await supabase
      .from('points_transactions')
      .insert(debits);
    if (debitErr) throw debitErr;

    console.log(`Expired ${expiring.length} earn transaction(s).`);
    return new Response(
      JSON.stringify({ ok: true, expired: expiring.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('expire-points error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
