const crypto = require('crypto');
const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const MP_API = 'https://api.mercadopago.com';
const frontendOrigin = () => process.env.FRONTEND_URL || String(process.env.CORS_ORIGIN || '').split(',')[0];
const paymentJsonPaths = ['/mercadopago/subscriptions', '/mercadopago/bricks', '/mercadopago/checkout-pro', '/flow/subscriptions'];
router.use(paymentJsonPaths, express.json({ limit: '100kb' }));

const flowSignature = parameters => {
  const canonical = Object.keys(parameters).sort().map(key => `${key}${parameters[key]}`).join('');
  return crypto.createHmac('sha256', process.env.FLOW_SECRET_KEY || '').update(canonical).digest('hex');
};

async function activePlan(planId) {
  const { data } = await supabase.from('tshow_plans').select('*').eq('id', planId).eq('active', true).maybeSingle();
  return data && Number.isInteger(data.amount_clp) && data.amount_clp > 0 ? data : null;
}

async function createAttempt(accountId, plan, provider, suppliedKey) {
  const idempotencyKey = /^[a-zA-Z0-9._:-]{8,128}$/.test(String(suppliedKey || '')) ? String(suppliedKey) : crypto.randomUUID();
  const row = { account_id: accountId, plan_id: plan.id, provider, interval: plan.interval, amount_clp: Number(plan.amount_clp), idempotency_key: idempotencyKey, status: 'processing' };
  const { data, error } = await supabase.from('tshow_payment_attempts').insert(row).select().single();
  if (!error) return data;
  if (error.code === '23505') {
    const { data: existing } = await supabase.from('tshow_payment_attempts').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing && existing.account_id === accountId && existing.plan_id === plan.id && existing.provider === provider) return existing;
  }
  throw new Error(error.message);
}

async function updateAttempt(id, patch, source = 'reconciliation', requestId = null) {
  const { data: current } = await supabase.from('tshow_payment_attempts').select('status').eq('id', id).maybeSingle();
  const { error } = await supabase.from('tshow_payment_attempts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  if (patch.status && patch.status !== current?.status) {
    const { error: transitionError } = await supabase.from('tshow_payment_transitions').insert({ attempt_id: id, previous_status: current?.status || null, new_status: patch.status, source, request_id: requestId, metadata: { providerStatus: patch.provider_status || null, failureCode: patch.failure_code || null } });
    if (transitionError) throw new Error(transitionError.message);
  }
}

async function activateVerifiedAttempt(attempt, externalId, providerStatus, providerPayload) {
  if (!attempt || attempt.status === 'approved') return attempt;
  const { data: plan } = await supabase.from('tshow_plans').select('*').eq('id', attempt.plan_id).maybeSingle();
  if (!plan || Number(plan.amount_clp) !== Number(attempt.amount_clp)) {
    await updateAttempt(attempt.id, { status: 'review', provider_status: providerStatus, failure_code: 'PLAN_AMOUNT_MISMATCH', reconciled_at: new Date().toISOString() });
    throw Object.assign(new Error('El monto verificado no coincide con el catálogo.'), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  }
  const periodEnd = new Date();
  if (plan.interval === 'year') periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const accountPlan = String(plan.code || '').startsWith('max') ? 'max' : String(plan.code || '').startsWith('pro') ? 'pro' : null;
  if (!accountPlan) throw Object.assign(new Error('El plan no tiene un nivel comercial válido.'), { code: 'PLAN_ENTITLEMENT_INVALID' });

  const now = new Date().toISOString();
  const { data: subscription, error: subscriptionError } = await supabase.from('tshow_subscriptions').upsert({
    account_id: attempt.account_id,
    plan_id: plan.id,
    provider: attempt.provider,
    provider_subscription_id: String(externalId),
    status: 'active',
    current_period_end: periodEnd.toISOString(),
    grace_ends_at: null,
    updated_at: now
  }, { onConflict: 'account_id' }).select().single();
  if (subscriptionError) throw new Error(subscriptionError.message);
  const { error: paymentError } = await supabase.from('tshow_payments').upsert({
    subscription_id: subscription.id,
    account_id: attempt.account_id,
    provider: attempt.provider,
    provider_payment_id: String(externalId),
    status: 'approved',
    amount_clp: attempt.amount_clp,
    raw_event: providerPayload,
    paid_at: now
  }, { onConflict: 'provider,provider_payment_id' });
  if (paymentError) throw new Error(paymentError.message);
  const { error: profileError } = await supabase.from('profiles').update({ account_plan: accountPlan, commercial_status: 'active', entitlement_updated_at: now }).eq('id', attempt.account_id);
  if (profileError) throw new Error(profileError.message);
  await updateAttempt(attempt.id, { status: 'approved', provider_object_id: String(externalId), provider_status: providerStatus, reconciled_at: now, failure_code: null, next_retry_at: null });
  return { ...attempt, status: 'approved' };
}

async function reconcileMercadoPagoPayment(paymentId) {
  if (!process.env.MP_ACCESS_TOKEN) throw new Error('Mercado Pago no está configurado.');
  const response = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  const payment = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payment.message || 'No se pudo consultar el pago.');
  const attemptId = String(payment.external_reference || '').split(':')[0];
  const { data: attempt } = await supabase.from('tshow_payment_attempts').select('*').eq('id', attemptId).maybeSingle();
  if (!attempt) throw Object.assign(new Error('Intento de pago no encontrado.'), { code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
  if (payment.currency_id !== 'CLP' || Number(payment.transaction_amount) !== Number(attempt.amount_clp)) {
    await updateAttempt(attempt.id, { status: 'review', provider_object_id: String(payment.id), provider_status: payment.status, failure_code: 'PROVIDER_AMOUNT_MISMATCH', reconciled_at: new Date().toISOString() });
    throw Object.assign(new Error('El proveedor devolvió un monto o moneda inesperados.'), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  }
  if (payment.status === 'approved') return activateVerifiedAttempt(attempt, payment.id, payment.status, { status: payment.status, status_detail: payment.status_detail });
  const mapped = payment.status === 'rejected' ? 'rejected' : payment.status === 'cancelled' ? 'cancelled' : payment.status === 'refunded' ? 'refunded' : 'pending';
  await updateAttempt(attempt.id, { status: mapped, provider_object_id: String(payment.id), provider_status: payment.status, reconciled_at: new Date().toISOString(), next_retry_at: mapped === 'pending' ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null });
  return { ...attempt, status: mapped };
}

async function reconcileMercadoPagoSubscription(subscriptionId) {
  const response = await fetch(`${MP_API}/preapproval/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  const subscription = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(subscription.message || 'No se pudo consultar la suscripción.');
  const attemptId = String(subscription.external_reference || '').split(':')[0];
  const { data: attempt } = await supabase.from('tshow_payment_attempts').select('*').eq('id', attemptId).maybeSingle();
  if (!attempt) throw new Error('Intento de suscripción no encontrado.');
  if (subscription.status === 'authorized') return activateVerifiedAttempt(attempt, subscription.id, subscription.status, { status: subscription.status });
  await updateAttempt(attempt.id, { status: subscription.status === 'cancelled' ? 'cancelled' : 'pending', provider_object_id: String(subscription.id), provider_status: subscription.status, reconciled_at: new Date().toISOString() });
  return attempt;
}

async function reconcileFlow(token) {
  if (!process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) throw new Error('Flow no está configurado.');
  const parameters = { apiKey: process.env.FLOW_API_KEY, token };
  const query = new URLSearchParams({ ...parameters, s: flowSignature(parameters) });
  const response = await fetch(`${process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api'}/payment/getStatus?${query}`);
  const payment = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payment.message || 'No se pudo consultar Flow.');
  let optional = {};
  try { optional = typeof payment.optional === 'string' ? JSON.parse(payment.optional) : payment.optional || {}; } catch { optional = {}; }
  const { data: attempt } = await supabase.from('tshow_payment_attempts').select('*').eq('id', optional.attemptId).maybeSingle();
  if (!attempt) throw new Error('Intento Flow no encontrado.');
  if (Number(payment.amount) !== Number(attempt.amount_clp)) throw Object.assign(new Error('Monto Flow no coincide.'), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  if (Number(payment.status) === 2) return activateVerifiedAttempt(attempt, payment.flowOrder || token, String(payment.status), { status: payment.status });
  await updateAttempt(attempt.id, { status: Number(payment.status) === 3 || Number(payment.status) === 4 ? 'rejected' : 'pending', provider_object_id: String(payment.flowOrder || token), provider_status: String(payment.status), reconciled_at: new Date().toISOString() });
  return attempt;
}

router.post('/mercadopago/bricks', requireSupabaseAuth, async (req, res, next) => {
  try {
    if (process.env.PAYMENTS_ENABLED !== 'true') return res.status(503).json({ success: false, code: 'PAYMENTS_DISABLED', message: 'Los pagos aún no están habilitados.' });
    const plan = await activePlan(req.body.planId);
    const { token, paymentMethodId, installments = 1, issuerId } = req.body;
    if (!plan || !process.env.MP_ACCESS_TOKEN || !token || !paymentMethodId) return res.status(400).json({ success: false, code: 'PAYMENT_DATA_INVALID', message: 'Plan o datos de pago incompletos.' });
    const attempt = await createAttempt(req.user.id, plan, 'mercadopago_bricks', req.body.idempotencyKey);
    if (attempt.provider_object_id) return res.status(202).json({ success: true, paymentId: attempt.provider_object_id, status: attempt.status, attemptId: attempt.id });
    const paymentBody = { transaction_amount: Number(plan.amount_clp), token: String(token), description: `T-Show ${plan.name}`, installments: Number(installments), payment_method_id: String(paymentMethodId), payer: { email: req.user.email }, external_reference: `${attempt.id}:${req.user.id}:${plan.id}` };
    if (issuerId) paymentBody.issuer_id = String(issuerId);
    const response = await fetch(`${MP_API}/v1/payments`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': attempt.idempotency_key }, body: JSON.stringify(paymentBody) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { await updateAttempt(attempt.id, { status: 'failed', failure_code: String(body.cause?.[0]?.code || body.status || 'PROVIDER_ERROR') }); return res.status(502).json({ success: false, code: 'PAYMENT_PROVIDER_ERROR', message: 'Mercado Pago no pudo procesar la solicitud.', requestId: req.requestId }); }
    await updateAttempt(attempt.id, { status: body.status === 'rejected' ? 'rejected' : 'pending', provider_object_id: String(body.id), provider_status: body.status, next_retry_at: new Date(Date.now() + 60 * 1000).toISOString() });
    // Deliberately do not activate here. Webhook/reconciliation is authoritative.
    return res.status(202).json({ success: true, attemptId: attempt.id, paymentId: body.id, status: 'pending_verification', providerStatus: body.status });
  } catch (error) { return next(error); }
});

router.post('/mercadopago/subscriptions', requireSupabaseAuth, async (req, res, next) => {
  try {
    const plan = await activePlan(req.body.planId);
    if (!plan) return res.status(400).json({ success: false, code: 'PLAN_UNAVAILABLE', message: 'Plan no disponible.' });
    if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ success: false, code: 'MP_NOT_CONFIGURED', message: 'Mercado Pago no está configurado.' });
    const attempt = await createAttempt(req.user.id, plan, 'mercadopago_subscription', req.body.idempotencyKey);
    const period = plan.interval === 'year' ? 12 : 1;
    const response = await fetch(`${MP_API}/preapproval`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: `T-Show ${plan.name}`, external_reference: `${attempt.id}:${req.user.id}:${plan.id}`, payer_email: req.user.email, auto_recurring: { frequency: period, frequency_type: 'months', transaction_amount: plan.amount_clp, currency_id: 'CLP' }, back_url: `${frontendOrigin()}/billing.html?status=return`, status: 'pending' }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || 'No se pudo crear la suscripción.'), { status: 502, code: 'MP_SUBSCRIPTION_ERROR' });
    await updateAttempt(attempt.id, { status: 'pending', provider_object_id: String(body.id), provider_status: body.status });
    return res.status(201).json({ success: true, attemptId: attempt.id, initPoint: body.init_point, id: body.id });
  } catch (error) { return next(error); }
});

router.post('/mercadopago/checkout-pro', requireSupabaseAuth, async (req, res, next) => {
  try {
    const plan = await activePlan(req.body.planId);
    if (!plan || !process.env.MP_ACCESS_TOKEN) return res.status(400).json({ success: false, code: 'PLAN_UNAVAILABLE', message: 'Plan o Mercado Pago no disponible.' });
    const attempt = await createAttempt(req.user.id, plan, 'mercadopago_checkout_pro', req.body.idempotencyKey);
    const response = await fetch(`${MP_API}/checkout/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ title: `T-Show ${plan.name}`, quantity: 1, currency_id: 'CLP', unit_price: plan.amount_clp }], external_reference: `${attempt.id}:${req.user.id}:${plan.id}`, back_urls: { success: `${frontendOrigin()}/billing.html?status=return`, failure: `${frontendOrigin()}/billing.html?status=return`, pending: `${frontendOrigin()}/billing.html?status=return` }, notification_url: `${process.env.PUBLIC_API_URL}/api/webhooks/mercadopago` }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || 'No se pudo crear Checkout Pro.'), { status: 502, code: 'MP_CHECKOUT_ERROR' });
    await updateAttempt(attempt.id, { status: 'pending', provider_object_id: String(body.id), provider_status: 'preference_created' });
    return res.status(201).json({ success: true, attemptId: attempt.id, initPoint: body.init_point, preferenceId: body.id });
  } catch (error) { return next(error); }
});

router.post('/flow/subscriptions', requireSupabaseAuth, async (req, res, next) => {
  try {
    const plan = await activePlan(req.body.planId);
    if (!plan || !process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) return res.status(400).json({ success: false, code: 'FLOW_UNAVAILABLE', message: 'Plan o Flow no disponible.' });
    const attempt = await createAttempt(req.user.id, plan, 'flow', req.body.idempotencyKey);
    const parameters = { apiKey: process.env.FLOW_API_KEY, commerceOrder: `tshow-${attempt.id}`, subject: `T-Show ${plan.name}`, amount: String(plan.amount_clp), currency: 'CLP', email: req.user.email, urlConfirmation: `${process.env.PUBLIC_API_URL}/api/webhooks/flow`, urlReturn: `${frontendOrigin()}/billing.html?status=return`, optional: JSON.stringify({ attemptId: attempt.id }) };
    const response = await fetch(`${process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api'}/payment/create`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...parameters, s: flowSignature(parameters) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || 'No se pudo iniciar Flow.'), { status: 502, code: 'FLOW_CHECKOUT_ERROR' });
    await updateAttempt(attempt.id, { status: 'pending', provider_object_id: String(body.flowOrder || body.token), provider_status: 'created' });
    return res.status(201).json({ success: true, attemptId: attempt.id, redirectUrl: `${body.url}?token=${encodeURIComponent(body.token)}` });
  } catch (error) { return next(error); }
});

async function recordWebhook(provider, eventKey, payload) {
  const { data, error } = await supabase.from('tshow_webhook_events').insert({ provider, event_key: eventKey, payload, status: 'received' }).select('id').single();
  if (error?.code === '23505') return { repeated: true };
  if (error) throw new Error(error.message);
  return { id: data.id, repeated: false };
}

async function finishWebhook(id, error) {
  if (!id) return;
  await supabase.from('tshow_webhook_events').update(error ? { status: 'failed', last_error: String(error.message || error).slice(0, 500), next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() } : { status: 'processed', processed_at: new Date().toISOString(), last_error: null }).eq('id', id);
}

router.post('/webhooks/mercadopago', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
  let payload; try { payload = JSON.parse(raw); } catch { return res.status(400).send('invalid json'); }
  const signature = req.get('x-signature') || '';
  const requestId = req.get('x-request-id') || '';
  if (!process.env.MP_WEBHOOK_SECRET) return res.status(503).send('webhook secret missing');
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=')));
  const dataId = String(payload.data?.id || payload.id || '').toLowerCase();
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts || ''};`;
  const expected = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  const valid = parts.v1 && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  if (!valid) return res.status(401).send('invalid signature');
  const eventKey = `${payload.type || payload.action || 'event'}:${dataId || crypto.createHash('sha256').update(raw).digest('hex')}`;
  let event;
  try {
    event = await recordWebhook('mercadopago', eventKey, payload);
    if (event.repeated) return res.sendStatus(200);
    if (String(payload.type || payload.action || '').includes('preapproval')) await reconcileMercadoPagoSubscription(dataId);
    else await reconcileMercadoPagoPayment(dataId);
    await finishWebhook(event.id);
    return res.sendStatus(200);
  } catch (error) {
    await finishWebhook(event?.id, error);
    console.error(JSON.stringify({ level: 'error', requestId: req.requestId, operation: 'mercadopago_webhook', message: error.message }));
    return res.sendStatus(200);
  }
});

router.post('/webhooks/flow', express.urlencoded({ extended: false, limit: '50kb' }), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('missing token');
  let event;
  try {
    event = await recordWebhook('flow', `payment:${token}`, { token });
    if (!event.repeated) { await reconcileFlow(token); await finishWebhook(event.id); }
  } catch (error) {
    await finishWebhook(event?.id, error);
    console.error(JSON.stringify({ level: 'error', requestId: req.requestId, operation: 'flow_webhook', message: error.message }));
  }
  return res.status(200).send('OK');
});

router.post('/billing/reconcile', express.json({ limit: '20kb' }), async (req, res) => {
  const secret = req.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ success: false, code: 'CRON_UNAUTHORIZED', message: 'Acceso denegado.' });
  const { data: attempts, error } = await supabase.from('tshow_payment_attempts').select('*').in('status', ['processing', 'pending', 'failed']).lte('next_retry_at', new Date().toISOString()).limit(50);
  if (error) return res.status(500).json({ success: false, code: 'RECONCILIATION_QUERY_FAILED', message: 'No se pudo iniciar la conciliación.' });
  const results = [];
  for (const attempt of attempts || []) {
    try {
      if (!attempt.provider_object_id) continue;
      if (attempt.provider === 'flow') await reconcileFlow(attempt.provider_object_id);
      else if (attempt.provider === 'mercadopago_subscription') await reconcileMercadoPagoSubscription(attempt.provider_object_id);
      else await reconcileMercadoPagoPayment(attempt.provider_object_id);
      results.push({ id: attempt.id, success: true });
    } catch (reconcileError) {
      await updateAttempt(attempt.id, { retry_count: attempt.retry_count + 1, next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), failure_code: String(reconcileError.code || 'RECONCILIATION_FAILED') });
      results.push({ id: attempt.id, success: false });
    }
  }
  const now = new Date();
  const graceCutoff = now.toISOString();
  const { data: expiredSubscriptions } = await supabase.from('tshow_subscriptions').select('id,account_id,status,current_period_end,grace_ends_at').in('status', ['active', 'past_due']).lt('current_period_end', graceCutoff);
  const lifecycle = [];
  for (const subscription of expiredSubscriptions || []) {
    const graceEnd = subscription.grace_ends_at ? new Date(subscription.grace_ends_at) : new Date(new Date(subscription.current_period_end).getTime() + 3 * 86400000);
    const inGrace = graceEnd > now;
    const status = inGrace ? 'past_due' : 'read_only';
    await supabase.from('tshow_subscriptions').update({ status, grace_ends_at: graceEnd.toISOString(), updated_at: now.toISOString() }).eq('id', subscription.id);
    await supabase.from('profiles').update({ commercial_status: inGrace ? 'active' : 'read_only', entitlement_updated_at: now.toISOString() }).eq('id', subscription.account_id);
    lifecycle.push({ subscriptionId: subscription.id, status });
  }
  return res.json({ success: true, processed: results.length, results, lifecycle });
});

module.exports = router;
