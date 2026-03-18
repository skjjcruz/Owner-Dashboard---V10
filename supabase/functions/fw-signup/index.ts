/**
 * fw-signup — Fantasy Wars email registration
 *
 * POST /functions/v1/fw-signup
 * Body: { email, password, displayName?, productSlug? }
 *
 * Returns: { token, user: { id, email, displayName } }
 *
 * Uses Web Crypto PBKDF2 for password hashing (no external deps).
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT } from 'npm:jose';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET           = Deno.env.get('SUPABASE_JWT_SECRET')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password, displayName, productSlug = 'war_room' } = await req.json();

    // ── Validate inputs ──────────────────────────────────────
    if (!email || !password) {
      return json({ error: 'Email and password are required.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address.' }, 400);
    }
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Check for existing account ────────────────────────────
    const { data: existing } = await admin
      .from('app_users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return json({ error: 'An account with this email already exists.' }, 409);
    }

    // ── Hash password (PBKDF2 via Web Crypto — no external deps) ─
    const passwordHash = await hashPassword(password);

    const { data: newUser, error: insertErr } = await admin
      .from('app_users')
      .insert({
        email:         email.toLowerCase().trim(),
        password_hash: passwordHash,
        display_name:  displayName?.trim() || email.split('@')[0],
      })
      .select('id, email, display_name, created_at')
      .single();

    if (insertErr || !newUser) {
      console.error('Insert error:', insertErr);
      return json({ error: `DB insert failed: ${insertErr?.message ?? insertErr?.code ?? 'unknown'} (${insertErr?.details ?? insertErr?.hint ?? ''})` }, 500);
    }

    // ── Provision free subscription for chosen product ────────
    await admin.from('subscriptions').insert({
      user_id:      newUser.id,
      product_slug: productSlug,
      tier:         'free',
      status:       'active',
    });

    // ── Issue JWT ─────────────────────────────────────────────
    const token = await mintJWT(newUser.id, newUser.email, 'free', [productSlug]);

    return json({
      token,
      user: {
        id:          newUser.id,
        email:       newUser.email,
        displayName: newUser.display_name,
        tier:        'free',
        products:    [productSlug],
      },
    });

  } catch (err) {
    console.error('fw-signup error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────

/** PBKDF2-SHA256 with a random 16-byte salt. Stored as "saltHex:hashHex". */
async function hashPassword(password: string): Promise<string> {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256,
  );
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function mintJWT(
  userId: string,
  email: string,
  tier: string,
  products: string[],
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ role: 'authenticated', app_metadata: { user_id: userId, email, tier, products } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(SUPABASE_URL + '/auth/v1')
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
