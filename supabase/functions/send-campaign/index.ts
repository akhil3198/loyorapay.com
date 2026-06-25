// ============================================================
// Edge Function: send-campaign  v2
// Column names aligned with schema.sql + migration 004.
// WhatsApp (Meta API) + Email (Resend) stubs ready for #39.
//
// Deploy: supabase functions deploy send-campaign
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function mergeVars(body: string, guest: Record<string, unknown>, hotel: Record<string, unknown>): string {
  return body
    .replace(/\{\{guest_name\}\}/g,     String(guest.name           ?? 'Valued Guest'))
    .replace(/\{\{first_name\}\}/g,     String(guest.name           ?? 'Valued Guest').split(' ')[0])
    .replace(/\{\{points_balance\}\}/g, String(guest.points_balance ?? 0))
    .replace(/\{\{tier_name\}\}/g,      String(guest.tier_name      ?? 'Member'))
    .replace(/\{\{hotel_name\}\}/g,     String(hotel.name           ?? 'our hotel'))
    .replace(/\{\{program_name\}\}/g,   String(hotel.program_name   ?? 'Rewards'))
    .replace(/\{\{membership_id\}\}/g,  String(guest.membership_id  ?? ''));
}

async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  const token   = Deno.env.get('META_WA_TOKEN');
  const phoneId = Deno.env.get('META_WA_PHONE_ID');
  if (!token || !phoneId) { console.warn('META_WA env not set'); return false; }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to:   to.replace(/\D/g, ''),
      type: 'text',
      text: { body },
    }),
  });
  if (!res.ok) console.error('WA send failed:', await res.text());
  return res.ok;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key  = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('FROM_EMAIL') ?? 'LoyoraPay <noreply@loyorapay.com>';
  if (!key) { console.warn('RESEND_API_KEY not set'); return false; }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error('Email send failed:', await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return new Response('Unauthorized', { status: 401 });

  const { data: caller } = await supabase
    .from('users').select('role, hotel_id').eq('id', user.id).single();
  if (!caller || !['owner', 'revenue'].includes(caller.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: { campaign_id: string; dry_run?: boolean };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const { campaign_id, dry_run = false } = body;

  // Load campaign — use schema column names: message (not message_body), audience (not segment_tier)
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, channel, message, message_body, email_subject, audience, segment_tier, segment_churn, status')
    .eq('id', campaign_id)
    .eq('hotel_id', caller.hotel_id)
    .single();

  if (!campaign) return new Response('Campaign not found', { status: 404 });
  if (campaign.status === 'sent') return new Response('Campaign already sent', { status: 400 });

  const { data: hotel } = await supabase
    .from('hotels').select('name, program_name').eq('id', caller.hotel_id).single();

  // Build guest query from segment
  let q = supabase.from('guests').select('*').eq('hotel_id', caller.hotel_id);
  if (campaign.segment_tier !== null && campaign.segment_tier !== undefined) {
    q = q.eq('tier_idx', campaign.segment_tier);
  }
  if (campaign.segment_churn) {
    q = q.eq('churn_status', campaign.segment_churn.toLowerCase());
  }
  const { data: guests } = await q;

  if (!guests || guests.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'No matching guests' }), { status: 200 });
  }

  if (dry_run) {
    return new Response(
      JSON.stringify({ ok: true, dry_run: true, estimate: guests.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Message body: prefer message_body (migration 004), fall back to message
  const msgTemplate = campaign.message_body || campaign.message || '';

  let sent = 0;
  let failed = 0;

  for (const guest of guests) {
    const merged = mergeVars(msgTemplate, guest as Record<string, unknown>, hotel as Record<string, unknown> ?? {});
    let ok = false;

    if (campaign.channel === 'whatsapp' && guest.phone) {
      ok = await sendWhatsApp(guest.phone, merged);
    } else if (campaign.channel === 'email' && guest.email) {
      const subj = mergeVars(
        campaign.email_subject ?? `A message from ${hotel?.name ?? 'us'}`,
        guest as Record<string, unknown>,
        hotel as Record<string, unknown> ?? {}
      );
      ok = await sendEmail(
        guest.email,
        subj,
        `<p style="font-family:sans-serif;font-size:15px;line-height:1.6">${merged.replace(/\n/g,'<br>')}</p>`
      );
    } else if (campaign.channel === 'both') {
      const waOk    = guest.phone  ? await sendWhatsApp(guest.phone,  merged) : false;
      const emailOk = guest.email  ? await sendEmail(guest.email, campaign.email_subject ?? '', `<p>${merged}</p>`) : false;
      ok = waOk || emailOk;
    }

    if (ok) sent++; else failed++;
  }

  // Update campaign with correct schema column names
  await supabase
    .from('campaigns')
    .update({
      status:           'sent',
      sent_at:          new Date().toISOString(),     // schema column: sent_at
      sent_count:       sent,                          // migration 004 column
      last_sent_at:     new Date().toISOString(),      // migration 004 column
      recipient_count:  guests.length,                 // schema column
    })
    .eq('id', campaign_id);

  return new Response(
    JSON.stringify({ ok: true, sent, failed, total: guests.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
