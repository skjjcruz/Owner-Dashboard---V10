// ============================================================
// Owner Dashboard — get-session-token Edge Function
//
// Issues a signed JWT embedding the verified Sleeper username
// in app_metadata so RLS policies can enforce per-user access.
//
// Auth strategies:
//   • Gifted users  → password verified server-side with bcrypt
//                     (legacy SHA-256 hashes are migrated on first use)
//   • Regular users → Sleeper username verified via Sleeper API
//
// DEPLOY:
//   supabase functions deploy get-session-token
//
// REQUIRED SECRETS (set once):
//   supabase secrets set SUPABASE_JWT_SECRET=<your-jwt-secret>
//   (find it: Supabase Dashboard → Settings → API → JWT Secret)
// ============================================================

import * as jose    from 'npm:jose';
import bcrypt       from 'npm:bcryptjs';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const BCRYPT_ROUNDS     = 12;

// Detect legacy SHA-256 hash (64 lowercase hex chars, not a bcrypt hash)
function isLegacySHA256(hash: string): boolean {
    return /^[0-9a-f]{64}$/.test(hash);
}

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const json = (body: object, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    try {
        const { username, password } = await req.json();

        if (!username || typeof username !== 'string') {
            return json({ error: 'username is required' }, 400);
        }

        const jwtSecret  = Deno.env.get('SUPABASE_JWT_SECRET') ?? Deno.env.get('JWT_SECRET');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');

        if (!jwtSecret) {
            return json({ error: 'SUPABASE_JWT_SECRET not configured — see SETUP.md' }, 500);
        }
        if (!serviceKey || !supabaseUrl) {
            return json({ error: 'Supabase service credentials not available' }, 500);
        }

        // ── Look up user row (service role bypasses RLS pre-auth) ──────────
        const admin = createClient(supabaseUrl, serviceKey);
        const { data: userRow } = await admin
            .from('users')
            .select('password_hash, is_gifted')
            .eq('sleeper_username', username)
            .maybeSingle();

        const hasStoredPassword = userRow?.password_hash;
        let isGifted = userRow?.is_gifted ?? false;

        // ── Gifted user — verify password ─────────────────────────────────
        if (hasStoredPassword) {
            if (!password) {
                return json({ error: 'Password required for this account', isGifted: true }, 401);
            }

            let passwordMatch = false;

            if (isLegacySHA256(userRow.password_hash)) {
                // Legacy hash — compare with SHA-256, then silently upgrade to bcrypt
                const inputSha = await sha256Hex(password);
                if (inputSha === userRow.password_hash) {
                    passwordMatch = true;
                    // Migrate to bcrypt
                    const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                    await admin
                        .from('users')
                        .update({ password_hash: newHash })
                        .eq('sleeper_username', username);
                }
            } else {
                // bcrypt hash
                passwordMatch = await bcrypt.compare(password, userRow.password_hash);
            }

            if (!passwordMatch) {
                return json({ error: 'Incorrect password', isGifted: true }, 401);
            }

        } else {
            // ── Regular Sleeper user — verify via Sleeper API ───────────────
            try {
                const resp = await fetch(
                    `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`,
                    { signal: AbortSignal.timeout(5000) }
                );
                const sleeperUser = resp.ok ? await resp.json() : null;
                if (!sleeperUser?.user_id) {
                    return json({ error: 'Sleeper username not found' }, 401);
                }
            } catch {
                return json({ error: 'Could not verify Sleeper username — check your connection' }, 503);
            }
            isGifted = false;
        }

        // ── Issue JWT ──────────────────────────────────────────────────────
        // Extract project ref from SUPABASE_URL
        const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
        const now        = Math.floor(Date.now() / 1000);
        const exp        = now + TOKEN_TTL_SECONDS;

        const payload = {
            iss:           'supabase',
            ref:           projectRef,
            role:          'anon',
            iat:           now,
            exp,
            sub:           username,
            app_metadata:  { sleeper_username: username, is_gifted: isGifted },
        };

        const secret = new TextEncoder().encode(jwtSecret);
        const token  = await new jose.SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256' })
            .sign(secret);

        return json({
            token,
            expiresAt: new Date(exp * 1000).toISOString(),
            isGifted,
        });

    } catch (err: any) {
        console.error('[get-session-token] error:', err);
        return json({ error: err.message || 'Internal server error' }, 500);
    }
});
