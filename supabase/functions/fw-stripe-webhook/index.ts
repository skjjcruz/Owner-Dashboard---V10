/**
 * fw-stripe-webhook — Handle Stripe subscription lifecycle events
 *
 * POST /functions/v1/fw-stripe-webhook
 * (No Authorization header — Stripe signs the request with STRIPE_WEBHOOK_SECRET)
 *
 * Handles:
 *   - checkout.session.completed     → activate pro subscription
 *   - customer.subscription.updated  → sync tier / status changes
 *   - customer.subscription.deleted  → downgrade to free
 *   - invoice.payment_failed         → mark past_due
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET   (from Stripe Dashboard → Webhooks → Signing secret)
 *
 * Setup in Stripe Dashboard:
 *   Webhooks → Add endpoint → https://<project>.supabase.co/functions/v1/fw-stripe-webhook
 *   Events to listen for:
 *     checkout.session.completed
 *     customer.subscription.updated
 *     customer.subscription.deleted
 *     invoice.payment_failed
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const admin  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  // ── Verify Stripe signature ───────────────────────────────
  const sig  = req.headers.get('stripe-signature') ?? '';
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Webhook Error: Invalid signature', { status: 400 });
  }

  // ── Route event ───────────────────────────────────────────
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error(`Error handling event ${event.type}:`, err);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Handlers ──────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== 'subscription') return;

  const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
  const userId       = subscription.metadata.user_id;
  const productSlug  = subscription.metadata.product_slug ?? 'war_room';

  if (!userId) {
    console.error('No user_id in subscription metadata');
    return;
  }

  await admin.from('subscriptions').upsert({
    user_id:               userId,
    product_slug:          productSlug,
    tier:                  'pro',
    status:                'active',
    stripe_subscription_id: subscription.id,
    stripe_price_id:       subscription.items.data[0]?.price.id,
    current_period_start:  new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end:    new Date(subscription.current_period_end   * 1000).toISOString(),
    cancel_at_period_end:  subscription.cancel_at_period_end,
  }, { onConflict: 'user_id,product_slug' });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const { data: sub } = await admin
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  if (!sub) return;

  const status = mapStripeStatus(subscription.status);
  await admin
    .from('subscriptions')
    .update({
      status,
      tier:                 status === 'active' ? 'pro' : 'free',
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end:   new Date(subscription.current_period_end   * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await admin
    .from('subscriptions')
    .update({
      tier:   'free',
      status: 'canceled',
      cancel_at_period_end: false,
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return;
  await admin
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', invoice.subscription as string);
}

// ── Utility ───────────────────────────────────────────────────

function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active':   return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'active';
  }
}
