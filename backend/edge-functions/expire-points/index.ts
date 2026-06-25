// ============================================================
// Edge Function: expire-points
// Schedule: daily at 02:00 UTC (set in Supabase dashboard)
//
// Marks all points past their expiry_date as 'expired' and
// creates a compensating debit transaction so balances stay
// accurate without touching the guest's points_balance directly.
//
// Deploy:
//   supabase functions deploy expire-points
//
// Cron (Supabase dashboard → Edge Functions → expire-points → Schedule):
//   0 2 * * *
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!   // service role — bypasses RLS
);

Deno.serve(async (_req) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Find all earn transactions past expiry that haven't been expired yet
    const { data: expiring, error: fetchErr } = await supabase
      .from('points_transactions')
      .select('id, guest_id, hotel_id, points')
      .eq('type', 'earn')
      .eq('expired', false)
      .lt('expiry_date', today);

    if (fetchErr) throw fetchErr;
    if (!expiring || expiring.length === 0) {
      return new Response(JSON.stringify({ expired: 0 }), { status: 200 });
    }

    // 2. Mark transactions as expired
    const ids = expiring.map((t) => t.id);
    const { error: markErr } = await supabase
      .from('points_transactions')
      .update({ expired: true })
      .in('id', ids);

    if (markErr) throw markErr;

    // 3. Insert debit transactions to reduce balances
    const debits = expiring.map((t) => ({
      guest_id:    t.guest_id,
      hotel_id:    t.hotel_id,
      type:        'expire',
      points:      -(Math.abs(t.points)),
      description: 'Points expired',
      expired:     false,
    }));

    const { error: debitErr } = await supabase
      .from('points_transactions')
      .insert(debits);

    if (debitErr) throw debitErr;

    console.log(`Expired ${expiring.length} transaction(s).`);
    return new Response(
      JSON.stringify({ expired: expiring.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('expire-points error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
