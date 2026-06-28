// ONE-TIME admin password reset — DELETE AFTER USE
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const { email, new_password, secret } = await req.json();

  // Simple one-time secret guard
  if (secret !== 'loyorapay-reset-2026') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Find user by email
  const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) return new Response(JSON.stringify({ error: listErr.message }), { status: 500 });

  const user = users.users.find(u => u.email === email);
  if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });

  // Update password
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: new_password
  });
  if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });

  return new Response(JSON.stringify({ success: true, email, id: user.id }), { status: 200 });
});
