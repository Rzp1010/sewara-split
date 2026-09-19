// @ts-nocheck
/**
 * Payment Webhook Handler (Skeleton)
 * 
 * Generic webhook endpoint untuk payment provider (Midtrans/Xendit/Stripe).
 * 
 * NOTE: Ini skeleton saja. Implementasi spesifik per provider dilakukan saat rilis.
 *       Signature verification, idempotency, dan business logic akan ditambahkan nanti.
 * 
 * Flow:
 * 1. Terima webhook dari payment provider
 * 2. Verify signature (prevent spoofing)
 * 3. Log event mentah ke sewara_subscription_events
 * 4. Process event (update subscription, record payment)
 * 5. Return 200 OK (idempotent)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client with service role for admin operations
// ponytail: lazy-init so build doesn't throw on missing env; upgrade to eager init if startup validation wanted.
let _supabase: any;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY // Service role for webhook
    );
  }
  return _supabase;
}

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

export async function POST() {
  // Fail closed until provider integration and signature verification are configured.
  return NextResponse.json(
    {
      error: 'payment_webhook_not_configured',
      message: 'Payment webhook is not configured.',
    },
    { status: 503 }
  );
}

// ============================================================================
// PROVIDER DETECTION
// ============================================================================

function detectProvider(headers, payload) {
  // Midtrans: header x-midtrans-signature
  if (headers['x-midtrans-signature']) {
    return 'midtrans';
  }

  // Xendit: header x-callback-token
  if (headers['x-callback-token']) {
    return 'xendit';
  }

  // Stripe: header stripe-signature
  if (headers['stripe-signature']) {
    return 'stripe';
  }

  // Fallback: detect dari payload structure
  if (payload.transaction_status) return 'midtrans';
  if (payload.event && payload.event.startsWith('charge.')) return 'xendit';
  if (payload.type && payload.data) return 'stripe';

  return null;
}

// ============================================================================
// SIGNATURE VERIFICATION (TODO: implement per provider)
// ============================================================================

async function verifySignature(provider, headers, payload) {
  // TODO: Implement signature verification per provider saat integrasi payment gateway

  /*
  // Midtrans example:
  if (provider === 'midtrans') {
    const signature = headers['x-midtrans-signature'];
    const orderId = payload.order_id;
    const statusCode = payload.status_code;
    const grossAmount = payload.gross_amount;
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    
    const crypto = require('crypto');
    const hash = crypto.createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');
    
    return hash === signature;
  }

  // Xendit example:
  if (provider === 'xendit') {
    const token = headers['x-callback-token'];
    return token === process.env.XENDIT_WEBHOOK_TOKEN;
  }

  // Stripe example:
  if (provider === 'stripe') {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    try {
      const event = stripe.webhooks.constructEvent(
        await request.text(),
        sig,
        endpointSecret
      );
      return true;
    } catch (err) {
      return false;
    }
  }
  */

  // Fail closed until provider-specific signature verification is implemented.
  return false;
}

// ============================================================================
// IDEMPOTENCY CHECK
// ============================================================================

async function checkIdempotency(externalEventId) {
  if (!externalEventId) return false;

  const { data } = await getSupabase()
    .from('sewara_subscription_events')
    .select('id')
    .eq('payload->>external_id', externalEventId)
    .single();

  return !!data;
}

function getExternalEventId(provider, payload) {
  if (provider === 'midtrans') return payload.transaction_id;
  if (provider === 'xendit') return payload.id;
  if (provider === 'stripe') return payload.id;
  return null;
}

// ============================================================================
// EVENT TYPE MAPPING
// ============================================================================

function mapEventType(provider, payload) {
  // Map provider-specific event ke enum_subscription_event
  
  if (provider === 'midtrans') {
    const status = payload.transaction_status;
    if (status === 'capture' || status === 'settlement') return 'payment.succeeded';
    if (status === 'deny' || status === 'cancel' || status === 'expire') return 'payment.failed';
    if (status === 'refund') return 'payment.refunded';
  }

  if (provider === 'xendit') {
    const event = payload.event;
    if (event === 'charge.succeeded') return 'payment.succeeded';
    if (event === 'charge.failed') return 'payment.failed';
    if (event === 'refund.succeeded') return 'payment.refunded';
  }

  if (provider === 'stripe') {
    const type = payload.type;
    if (type === 'invoice.payment_succeeded') return 'payment.succeeded';
    if (type === 'invoice.payment_failed') return 'payment.failed';
    if (type === 'charge.refunded') return 'payment.refunded';
    if (type === 'customer.subscription.created') return 'subscription.created';
    if (type === 'customer.subscription.updated') return 'subscription.updated';
    if (type === 'customer.subscription.deleted') return 'subscription.cancelled';
  }

  return 'payment.succeeded'; // default fallback
}

// ============================================================================
// EXTRACT SUBSCRIPTION ID
// ============================================================================

function extractSubscriptionId(provider, payload) {
  // TODO: Extract subscription_id dari metadata/custom_field
  // Saat create payment, simpan sewara_subscription_id di metadata
  
  if (provider === 'midtrans') {
    return payload.custom_field1 || null; // contoh: simpan subscription_id di custom_field1
  }

  if (provider === 'xendit') {
    return payload.metadata?.subscription_id || null;
  }

  if (provider === 'stripe') {
    return payload.data?.object?.metadata?.subscription_id || null;
  }

  return null;
}

// ============================================================================
// PROCESS EVENT (Business Logic)
// ============================================================================

async function processEvent(eventId, provider, eventType, payload) {
  try {
    const subscriptionId = extractSubscriptionId(provider, payload);

    if (!subscriptionId) {
      console.error('No subscription_id in webhook payload');
      return false;
    }

    // Handle berdasarkan event type
    switch (eventType) {
      case 'payment.succeeded':
        await handlePaymentSucceeded(subscriptionId, provider, payload);
        break;

      case 'payment.failed':
        await handlePaymentFailed(subscriptionId, provider, payload);
        break;

      case 'payment.refunded':
        await handlePaymentRefunded(subscriptionId, provider, payload);
        break;

      case 'subscription.created':
      case 'subscription.updated':
        await handleSubscriptionUpdated(subscriptionId, payload);
        break;

      case 'subscription.cancelled':
        await handleSubscriptionCancelled(subscriptionId);
        break;

      default:
        console.log('Unhandled event type:', eventType);
    }

    // Mark event as processed
    await getSupabase()
      .from('sewara_subscription_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq('id', eventId);

    return true;

  } catch (error) {
    console.error('processEvent error:', error);
    
    // Mark event with error
    await getSupabase()
      .from('sewara_subscription_events')
      .update({
        processed: false,
        error_message: error.message,
      })
      .eq('id', eventId);

    return false;
  }
}

// ============================================================================
// BUSINESS LOGIC HANDLERS (TODO: implement detail)
// ============================================================================

async function handlePaymentSucceeded(subscriptionId, provider, payload) {
  // 1. Record payment di sewara_subscription_payments
  const amount = extractAmount(provider, payload);
  const externalPaymentId = extractPaymentId(provider, payload);

  await getSupabase().from('sewara_subscription_payments').insert({
    subscription_id: subscriptionId,
    amount: amount,
    currency: 'IDR',
    status: 'succeeded',
    payment_provider: provider,
    external_payment_id: externalPaymentId,
    paid_at: new Date().toISOString(),
    metadata: payload,
  });

  // 2. Update subscription status ke 'active'
  await getSupabase()
    .from('sewara_subscriptions')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  // 3. Extend period (jika renewal)
  // TODO: calculate new period_end

  console.log('Payment succeeded for subscription:', subscriptionId);
}

async function handlePaymentFailed(subscriptionId, provider, payload) {
  // 1. Record failed payment
  const amount = extractAmount(provider, payload);
  const externalPaymentId = extractPaymentId(provider, payload);

  await getSupabase().from('sewara_subscription_payments').insert({
    subscription_id: subscriptionId,
    amount: amount,
    currency: 'IDR',
    status: 'failed',
    payment_provider: provider,
    external_payment_id: externalPaymentId,
    failed_at: new Date().toISOString(),
    metadata: payload,
  });

  // 2. Update subscription status ke 'past_due'
  await getSupabase()
    .from('sewara_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  console.log('Payment failed for subscription:', subscriptionId);
}

async function handlePaymentRefunded(subscriptionId, provider, payload) {
  // Record refund
  const externalPaymentId = extractPaymentId(provider, payload);

  await getSupabase()
    .from('sewara_subscription_payments')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    })
    .eq('external_payment_id', externalPaymentId);

  console.log('Payment refunded:', externalPaymentId);
}

async function handleSubscriptionUpdated(subscriptionId, payload) {
  // TODO: Update subscription details jika ada perubahan plan
  console.log('Subscription updated:', subscriptionId);
}

async function handleSubscriptionCancelled(subscriptionId) {
  await getSupabase()
    .from('sewara_subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  console.log('Subscription cancelled:', subscriptionId);
}

// ============================================================================
// EXTRACT HELPERS
// ============================================================================

function extractAmount(provider, payload) {
  if (provider === 'midtrans') return parseInt(payload.gross_amount);
  if (provider === 'xendit') return payload.amount;
  if (provider === 'stripe') return payload.data?.object?.amount_paid || 0;
  return 0;
}

function extractPaymentId(provider, payload) {
  if (provider === 'midtrans') return payload.transaction_id;
  if (provider === 'xendit') return payload.id;
  if (provider === 'stripe') return payload.data?.object?.id;
  return null;
}
