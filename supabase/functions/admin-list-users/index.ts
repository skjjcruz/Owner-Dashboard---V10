/**
 * admin-list-users — returns paginated user + subscription list
 *
 * GET /functions/v1/admin-list-users?page=0&limit=50&search=foo
 *
 * Requires:
 *   Authorization: Bearer <ADMIN_SECRET>
 *
 * Set the secret once:
 *   supabase secrets set ADMIN_SECRET=<some-strong-secret>
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_SECRET         = Deno.env.get('ADMIN_SECRET')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Auth check ────────────────────────────────────────────
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const url    = new URL(req.url);
    const page   = Math.max(0, parseInt(url.searchParams.get('page')  ?? '0', 10));
    const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
    const search = url.searchParams.get('search')?.trim() ?? '';

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Fetch users (with subscription join) ─────────────────
    let query = admin
      .from('app_users')
      .select(`
        id,
        email,
        display_name,
        created_at,
        subscriptions ( product_slug, tier, status )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (search) {
      query = query.ilike('email', `%${search}%`);
    }

    const { data: users, error, count } = await query;

    if (error) {
      console.error('admin-list-users query error:', error);
      return json({ error: error.message }, 500);
    }

    // ── Shape the response ────────────────────────────────────
    const rows = (users ?? []).map((u: any) => {
      const subs    = u.subscriptions ?? [];
      const active  = subs.filter((s: any) => s.status === 'active');
      const tier    = active.some((s: any) => s.tier === 'pro') ? 'pro' : 'free';
      const products = active.map((s: any) => s.product_slug);
      return {
        id:          u.id,
        email:       u.email,
        displayName: u.display_name,
        tier,
        products,
        createdAt:   u.created_at,
      };
    });

    return json({ users: rows, total: count ?? 0, page, limit });

  } catch (err) {
    console.error('admin-list-users error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
