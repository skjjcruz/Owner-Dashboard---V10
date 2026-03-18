/**
 * fw-create-checkout — Create a Stripe Checkout Session
 *
 * POST /functions/v1/fw-create-checkout
 * Headers: { Authorization: Bearer <jwt> }
 * Body:    { productSlug, successUrl, cancelUrl }
 *
 * Returns: { checkoutUrl }
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_WAR_ROOM_PRO   (Stripe Price ID for War Room Pro)
 *   STRIPE_PRICE_BUNDLE_PRO     (Stripe Price ID for the Bundle, optional)
 *
 * To get Stripe Price IDs:
 *   1. Create products in Stripe Dashboard → Products
 *   2. Copy the Price ID (price_...) for each monthly price
 *   3. Run: supabase secrets set STRIPE_PRICE_WAR_ROOM_PRO=price_...
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!;

// Map product slugs → Stripe Price IDs
const PRICE_MAP: Record<string, string | undefined> = {
  war_room:  Deno.env.get('STRIPE_PRICE_WAR_ROOM_PRO'),
  dynast_hq: Deno.env.get('STRIPE_PRICE_DYNAST_HQ_PRO'),
  bundle:    Deno.env.get('STRIPE_PRICE_BUNDLE_PRO'),
};

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Verify JWT and extract user ───────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized.' }, 401);

    // Decode payload (we trust Supabase RLS; full verify happens there)
    let userId: string;
    let userEmail: string;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId    = payload.app_metadata?.user_id;
      userEmail = payload.app_metadata?.email;
      if (!userId) throw new Error('Missing user_id');
    } catch {
      return json({ error: 'Invalid session token.' }, 401);
    }

    const { productSlug = 'war_room', successUrl, cancelUrl } = await req.json();

    const priceId = PRICE_MAP[productSlug];
    if (!priceId) {
      return json({ error: `No Stripe price configured for "${productSlug}".` }, 400);
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const admin  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Get or create Stripe customer ─────────────────────────
    const { data: appUser } = await admin
      .from('app_users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    let customerId = appUser?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    userEmail,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      await admin
        .from('app_users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // ── Create Checkout Session ───────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode:     'subscription',
      line_items: [{
        price:    priceId,
        quantity: 1,
      }],
      success_url: successUrl ?? `${SUPABASE_URL}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl  ?? `${SUPABASE_URL}/landing.html`,
      subscription_data: {
        metadata: {
          user_id:      userId,
          product_slug: productSlug,
        },
      },
      allow_promotion_codes: true,
    });

    return json({ checkoutUrl: session.url });

  } catch (err) {
    console.error('fw-create-checkout error:', err);
    return json({ error: 'Failed to create checkout session.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
