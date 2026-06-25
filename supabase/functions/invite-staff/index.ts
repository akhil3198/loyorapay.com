// ============================================================
// Edge Function: invite-staff
// Method: POST
// Auth: requires valid JWT (owner role only)
//
// Sends a Supabase magic-link invite to a new staff member.
// The anon key cannot call auth.admin — this Edge Function
// runs with the service role key to do it safely server-side.
//
// Request body:
//   { name: string, email: string, role: 'owner'|'revenue'|'frontdesk' }
//
// Deploy:
//   supabase functions deploy invite-staff
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 1. Verify caller is authenticated + is an owner
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return new Response('Unauthorized', { status: 401 });

  // 2. Check role in users table
  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('role, hotel_id')
    .eq('id', user.id)
    .single();

  if (!caller || caller.role !== 'owner') {
    return new Response('Forbidden — owner role required', { status: 403 });
  }

  // 3. Parse request body
  let body: { name?: string; email?: string; role?: string };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const { name, email, role } = body;
  if (!name || !email || !role) {
    return new Response('Missing name, email, or role', { status: 400 });
  }
  if (!['owner', 'revenue', 'frontdesk'].includes(role)) {
    return new Response('Invalid role', { status: 400 });
  }

  // 4. Send invite
  const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    email,
    {
      data: { name, role, hotel_id: caller.hotel_id },
      redirectTo: 'https://loyorapay.com',
    }
  );
  if (inviteErr) {
    return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400 });
  }

  // 5. Pre-create users row so they appear in the staff list immediately
  await supabaseAdmin.from('users').upsert({
    id:       inviteData.user.id,
    hotel_id: caller.hotel_id,
    name,
    email,
    role,
  });

  return new Response(
    JSON.stringify({ ok: true, userId: inviteData.user.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
