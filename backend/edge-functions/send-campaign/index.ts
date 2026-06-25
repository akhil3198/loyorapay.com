// ============================================================
// Edge Function: send-campaign
// Method: POST
// Auth: requires valid JWT (owner or revenue role)
//
// Orchestrates campaign dispatch — WhatsApp via Meta Business
// API and Email via Resend. Both channels go through this
// single function so delivery tracking stays centralised.
//
// Request body:
// {
//   "campaign_id": "uuid",
//   "dry_run": false     // true = estimate only, no sends
// }
//
// ── ENV VARS REQUIRED ────────────────────────────────────────
// META_WA_TOKEN          — Meta Business API permanent token
// META_WA_PHONE_ID       — WhatsApp Business phone number ID
// RESEND_API_KEY         — Resend.com API key
// FROM_EMAIL             — e.g. "LoyoraPay <noreply@loyorapay.com>"
//
// These are NOT yet live — stubs return 501 until wired.
// Deploy now to establish the contract; fill env vars for #39.
//
// Deploy:
//   supabase functions deploy send-campaign
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Merge template variables ──────────────────────────────────
function mergeVars(body: string, guest: Record<string, unknown>, hotel: Record<string, unknown>): string {
  return body
    .replace(/\{\{guest_name\}\}/g,    String(guest.name     ?? 'Valued Guest'))
    .replace(/\{\{first_name\}\}/g,    String(guest.name     ?? 'Valued Guest').split(' ')[0])
    .replace(/\{\{points_balance\}\}/g,String(guest.points_balance ?? 0))
    .replace(/\{\{tier_name\}\}/g,     String(guest.tier_name      ?? 'Bronze'))
    .replace(/\{\{hotel_name\}\}/g,    String(hotel.name           ?? 'our hotel'))
    .replace(/\{\{program_name\}\}/g,  String(hotel.program_name   ?? 'Rewards'))
    .replace(/\{\{membership_id\}\}/g, String(guest.membership_id  ?? ''));
}

// ── WhatsApp send (Meta Business API) ────────────────────────
async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  const token   = Deno.env.get('META_WA_TOKEN');
  const phoneId = Deno.env.get('META_WA_PHONE_ID');

  if (!token || !phoneId) {
    console.warn('WhatsApp env vars not set — skipping send');
    return false;                        // #39 not yet wired
  }

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneId}/messages`,
    {
      method:  'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   to.replace(/\D/g, ''),     // strip non-digits
        type: 'text',
        text: { body },
      }),
    }
  );

  return res.ok;
}

// ── Email send (Resend) ───────────────────────────────────────
async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<boolean> {
  const key  = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('FROM_EMAIL') ?? 'LoyoraPay <noreply@loyorapay.com>';

  if (!key) {
    console.warn('RESEND_API_KEY not set — skipping send');
    return false;                        // #39b not yet wired
  }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html: htmlBody }),
  });

  return res.ok;
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return new Response('Unauthorized', { status: 401 });

  // Role check
  const { data: caller } = await supabase
    .from('users')
    .select('role, hotel_id')
    .eq('id', user.id)
    .single();

  if (!caller || !['owner', 'revenue'].includes(caller.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: { campaign_id: string; dry_run?: boolean };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const { campaign_id, dry_run = false } = body;

  // Load campaign
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaign_id)
    .eq('hotel_id', caller.hotel_id)
    .single();

  if (!campaign) return new Response('Campaign not found', { status: 404 });

  // Load hotel
  const { data: hotel } = await supabase
    .from('hotels')
    .select('name, program_name')
    .eq('id', caller.hotel_id)
    .single();

  // Build guest query from campaign segment definition
  let q = supabase.from('guests').select('*').eq('hotel_id', caller.hotel_id);
  if (campaign.segment_tier !== undefined) q = q.eq('tier_idx', campaign.segment_tier);
  if (campaign.segment_churn)              q = q.eq('churn_status', campaign.segment_churn);
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

  // Send
  let sent = 0;
  let failed = 0;

  for (const guest of guests) {
    const msgBody = mergeVars(campaign.message_body ?? '', guest, hotel ?? {});

    let ok = false;
    if (campaign.channel === 'whatsapp' && guest.phone) {
      ok = await sendWhatsApp(guest.phone, msgBody);
    } else if (campaign.channel === 'email' && guest.email) {
      ok = await sendEmail(
        guest.email,
        mergeVars(campaign.email_subject ?? 'A message from us', guest, hotel ?? {}),
        `<p style="font-family:sans-serif;font-size:15px;line-height:1.6;">${msgBody.replace(/\n/g, '<br>')}</p>`
      );
    }

    if (ok) sent++; else failed++;
  }

  // Update campaign status
  await supabase
    .from('campaigns')
    .update({ status: 'sent', sent_count: sent, last_sent_at: new Date() })
    .eq('id', campaign_id);

  return new Response(
    JSON.stringify({ ok: true, sent, failed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
