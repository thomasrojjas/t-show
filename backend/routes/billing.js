const crypto = require('crypto');
const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const MP_API = 'https://api.mercadopago.com';
const frontendOrigin = () => process.env.FRONTEND_URL || String(process.env.CORS_ORIGIN || '').split(',')[0];
const paymentJsonPaths = ['/mercadopago/subscriptions', '/mercadopago/bricks', '/mercadopago/checkout-pro', '/flow/subscriptions'];
router.use(paymentJsonPaths, express.json({ limit: '100kb' }));

const paymentsEnabled = () => process.env.PAYMENTS_ENABLED === 'true';
const paymentUnavailable = res => res.status(503).json({ success: false, code: 'PAYMENTS_DISABLED', message: 'La contratación está temporalmente no disponible.' });
const providerUnavailable = res => res.status(503).json({ success: false, code: 'PAYMENT_PROVIDER_DISABLED', message: 'Este medio de pago aún no está habilitado.' });
const providerGuard = (res, provider) => {
  if (!paymentsEnabled()) return paymentUnavailable(res);
  if (provider !== 'mercadopago_subscription') return providerUnavailable(res);
  return null;
};
const providerMessage = status => {
  if (status === 429) return 'Mercado Pago está temporalmente limitado. Espera un minuto antes de intentar nuevamente.';
  if (status === 401 || status === 403) return 'La configuración de Mercado Pago no permite crear la contratación.';
  if (status >= 500) return 'Mercado Pago no está disponible en este momento. Intenta nuevamente más tarde.';
  return 'Mercado Pago rechazó la solicitud. Revisa los datos e intenta nuevamente.';
};
const parseRetryAfter = value => {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.ceil(seconds), 3600);
  const date = Date.parse(String(value || ''));
  if (Number.isFinite(date)) return Math.min(Math.max(Math.ceil((date - Date.now()) / 1000), 1), 3600);
  return 60;
};

async function providerFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function providerFailure(response, body, code, fallback) {
  const retryAfterSeconds = response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : response.status >= 500 ? 60 : null;
  const error = Object.assign(new Error(response.ok ? fallback : providerMessage(response.status)), {
    status: response.status === 429 ? 429 : 502,
    code,
    providerStatus: response.status,
    providerCode: String(body?.error || body?.code || body?.cause?.[0]?.code || ''),
    providerRequestId: response.headers.get('x-request-id') || null,
    retryAfterSeconds
  });
  return error;
}

function timeoutFailure(code) {
  return Object.assign(new Error('Mercado Pago no respondió a tiempo. La operación quedó en revisión; espera antes de intentar nuevamente.'), {
    status: 503,
    code,
    retryAfterSeconds: 60
  });
}

const flowSignature = parameters => {
  const canonical = Object.keys(parameters).sort().map(key => `${key}${parameters[key]}`).join('');
  return crypto.createHmac('sha256', process.env.FLOW_SECRET_KEY || '').update(canonical).digest('hex');
};

async function activePlan(planId) {
  const { data } = await supabase.from('tshow_plans').select('*').eq('id', planId).eq('active', true).maybeSingle();
  return data && Number.isInteger(data.amount_clp) && data.amount_clp > 0 ? data : null;
}

async function reserveAttempt(attempt) {
  const { data: reservation, error } = await supabase.from('tshow_payment_attempt_reservations').insert({ account_id: attempt.account_id, provider: attempt.provider, attempt_id: attempt.id }).select().single();
  if (!error) return attempt;
  if (error.code !== '23505') throw new Error(error.message);
  const { data: current } = await supabase.from('tshow_payment_attempt_reservations').select('attempt_id').eq('account_id', attempt.account_id).eq('provider', attempt.provider).maybeSingle();
  if (current?.attempt_id === attempt.id) return attempt;
  const { data: active } = current?.attempt_id ? await supabase.from('tshow_payment_attempts').select('*').eq('id', current.attempt_id).maybeSingle() : { data: null };
  if (active && active.plan_id === attempt.plan_id && ['processing', 'pending', 'review'].includes(String(active.status))) return active;
  throw Object.assign(new Error('Ya existe una contratación en curso para esta cuenta.'), { status: 409, code: 'PAYMENT_ATTEMPT_ACTIVE' });
}

async function createAttempt(accountId, plan, provider, suppliedKey) {
  const idempotencyKey = /^[a-zA-Z0-9._:-]{8,128}$/.test(String(suppliedKey || '')) ? String(suppliedKey) : crypto.randomUUID();
  const { data: existing } = await supabase.from('tshow_payment_attempts').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing) {
    if (existing.account_id !== accountId || existing.plan_id !== plan.id || existing.provider !== provider) throw Object.assign(new Error('La clave de idempotencia ya pertenece a otra contratación.'), { status: 409, code: 'PAYMENT_IDEMPOTENCY_CONFLICT' });
    if (existing.status === 'approved') return existing;
    return reserveAttempt(existing);
  }
  const row = { id: crypto.randomUUID(), account_id: accountId, plan_id: plan.id, provider, interval: plan.interval, amount_clp: Number(plan.amount_clp), idempotency_key: idempotencyKey, status: 'processing' };
  const { data: attempt, error } = await supabase.from('tshow_payment_attempts').insert(row).select().single();
  if (error) {
    if (error.code === '23505') {
      const { data: retried } = await supabase.from('tshow_payment_attempts').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
      if (retried) return reserveAttempt(retried);
    }
    throw new Error(error.message);
  }
  const reserved = await reserveAttempt(attempt);
  if (reserved.id !== attempt.id) {
    await updateAttempt(attempt.id, { status: 'failed', failure_code: 'SUPERSEDED_ACTIVE_ATTEMPT', last_provider_error: null, next_retry_at: null }, 'checkout');
  }
  return reserved;
}

async function updateAttempt(id, patch, source = 'reconciliation', requestId = null) {
  const { data: current } = await supabase.from('tshow_payment_attempts').select('status').eq('id', id).maybeSingle();
  const { error } = await supabase.from('tshow_payment_attempts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  if (patch.status && patch.status !== current?.status) {
    const { error: transitionError } = await supabase.from('tshow_payment_transitions').insert({ attempt_id: id, previous_status: current?.status || null, new_status: patch.status, source, request_id: requestId, metadata: { providerStatus: patch.provider_status || null, failureCode: patch.failure_code || null } });
    if (transitionError) throw new Error(transitionError.message);
  }
  if (['approved', 'failed', 'rejected', 'cancelled', 'refunded'].includes(String(patch.status))) await supabase.from('tshow_payment_attempt_reservations').delete().eq('attempt_id', id);
}

async function markProviderFailure(attempt, error, requestId) {
  if (!attempt) return;
  const uncertain = String(error.code || '').includes('TIMEOUT') || String(error.code || '').includes('UNCERTAIN');
  const retryAfterSeconds = Number(error.retryAfterSeconds) > 0 ? Number(error.retryAfterSeconds) : null;
  await updateAttempt(attempt.id, {
    status: uncertain ? 'review' : 'failed',
    failure_code: String(error.providerCode || error.code || 'PROVIDER_ERROR').slice(0, 120),
    provider_status: error.providerStatus ? String(error.providerStatus) : null,
    provider_request_id: error.providerRequestId || null,
    provider_http_status: Number.isInteger(error.providerStatus) ? error.providerStatus : null,
    last_provider_error: String(error.message || 'Error del proveedor').slice(0, 500),
    next_retry_at: retryAfterSeconds ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString() : null
  }, 'checkout', requestId);
  console.error(JSON.stringify({ level: 'error', operation: 'payment_provider', requestId, attemptId: attempt.id, code: error.code, providerStatus: error.providerStatus || null, providerCode: error.providerCode || null, providerRequestId: error.providerRequestId || null }));
}

async function sendProviderFailure(res, error, attempt = null) {
  const body = { success: false, code: error.code || 'PAYMENT_PROVIDER_ERROR', message: error.message || 'No se pudo iniciar la contratación.', requestId: res.req.requestId };
  if (attempt?.id || error.attemptId) body.attemptId = attempt?.id || error.attemptId;
  if (Number(error.retryAfterSeconds) > 0) body.retryAfterSeconds = Number(error.retryAfterSeconds);
  if (Number(error.retryAfterSeconds) > 0) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterSeconds)));
  return res.status(Number(error.status) >= 400 ? error.status : 502).json(body);
}

async function activateVerifiedAttempt(attempt, paymentId, providerSubscriptionId, providerStatus, providerPayload) {
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
    provider_subscription_id: providerSubscriptionId ? String(providerSubscriptionId) : null,
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
    provider_payment_id: String(paymentId),
    status: 'approved',
    amount_clp: attempt.amount_clp,
    raw_event: providerPayload,
    paid_at: now
  }, { onConflict: 'provider,provider_payment_id' });
  if (paymentError) throw new Error(paymentError.message);
  const { error: profileError } = await supabase.from('profiles').update({ account_plan: accountPlan, commercial_status: 'active', entitlement_updated_at: now }).eq('id', attempt.account_id);
  if (profileError) throw new Error(profileError.message);
  await updateAttempt(attempt.id, { status: 'approved', provider_object_id: providerSubscriptionId ? String(providerSubscriptionId) : String(paymentId), provider_status: providerStatus, reconciled_at: now, failure_code: null, next_retry_at: null });
  return { ...attempt, status: 'approved' };
}

async function reconcileMercadoPagoPayment(paymentId) {
  if (!process.env.MP_ACCESS_TOKEN) throw new Error('Mercado Pago no está configurado.');
  let result;
  try {
    result = await providerFetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  } catch (error) {
    if (error.name === 'AbortError') throw timeoutFailure('MP_PAYMENT_TIMEOUT');
    throw error;
  }
  const { response, body: payment } = result;
  if (!response.ok) throw providerFailure(response, payment, 'MP_PAYMENT_QUERY_FAILED', 'No se pudo consultar el pago.');
  const attemptId = String(payment.external_reference || '').split(':')[0];
  const { data: attempt } = await supabase.from('tshow_payment_attempts').select('*').eq('id', attemptId).maybeSingle();
  if (!attempt) throw Object.assign(new Error('Intento de pago no encontrado.'), { code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
  if (payment.currency_id !== 'CLP' || Number(payment.transaction_amount) !== Number(attempt.amount_clp)) {
    await updateAttempt(attempt.id, { status: 'review', provider_object_id: String(payment.id), provider_status: payment.status, failure_code: 'PROVIDER_AMOUNT_MISMATCH', reconciled_at: new Date().toISOString() });
    throw Object.assign(new Error('El proveedor devolvió un monto o moneda inesperados.'), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  }
  if (payment.status === 'approved') return activateVerifiedAttempt(attempt, payment.id, payment.preapproval_id || null, payment.status, { status: payment.status, status_detail: payment.status_detail });
  const mapped = payment.status === 'rejected' ? 'rejected' : payment.status === 'cancelled' ? 'cancelled' : payment.status === 'refunded' ? 'refunded' : 'pending';
  await updateAttempt(attempt.id, { status: mapped, provider_object_id: String(payment.id), provider_status: payment.status, reconciled_at: new Date().toISOString(), next_retry_at: mapped === 'pending' ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null });
  return { ...attempt, status: mapped };
}

async function findAttemptByProviderReference(externalReference, providerSubscriptionId) {
  const attemptId = String(externalReference || '').split(':')[0];
  if (attemptId) {
    const { data } = await supabase.from('tshow_payment_attempts').select('*').eq('id', attemptId).maybeSingle();
    if (data) return data;
  }
  if (providerSubscriptionId) {
    const { data } = await supabase.from('tshow_payment_attempts').select('*').eq('provider_object_id', String(providerSubscriptionId)).eq('provider', 'mercadopago_subscription').maybeSingle();
    if (data) return data;
  }
  return null;
}

async function findMercadoPagoSubscriptionByReference(externalReference) {
  let result;
  try {
    result = await providerFetch(`${MP_API}/preapproval/search?external_reference=${encodeURIComponent(externalReference)}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  } catch (error) {
    if (error.name === 'AbortError') throw timeoutFailure('MP_SUBSCRIPTION_SEARCH_TIMEOUT');
    throw error;
  }
  if (!result.response.ok) throw providerFailure(result.response, result.body, 'MP_SUBSCRIPTION_SEARCH_FAILED', 'No se pudo comprobar la contratación anterior.');
  const results = Array.isArray(result.body?.results) ? result.body.results : Array.isArray(result.body?.data) ? result.body.data : [];
  return results.find(item => String(item.external_reference || '') === String(externalReference)) || null;
}

async function reconcileMercadoPagoAuthorizedPayment(authorizedPaymentId) {
  if (!process.env.MP_ACCESS_TOKEN) throw new Error('Mercado Pago no está configurado.');
  let result;
  try {
    result = await providerFetch(`${MP_API}/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  } catch (error) {
    if (error.name === 'AbortError') throw timeoutFailure('MP_AUTHORIZED_PAYMENT_TIMEOUT');
    throw error;
  }
  const { response, body } = result;
  if (!response.ok) throw providerFailure(response, body, 'MP_AUTHORIZED_PAYMENT_QUERY_FAILED', 'No se pudo consultar el cobro recurrente.');
  const payment = body.payment || body;
  const providerSubscriptionId = body.preapproval_id || body.subscription_id || body.preapproval?.id || payment.preapproval_id || null;
  const attempt = await findAttemptByProviderReference(payment.external_reference || body.external_reference, providerSubscriptionId);
  if (!attempt) throw Object.assign(new Error('Intento de suscripción no encontrado.'), { code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
  const amount = payment.transaction_amount ?? payment.amount ?? body.transaction_amount ?? body.amount;
  const currency = payment.currency_id || body.currency_id || 'CLP';
  if (currency !== 'CLP' || Number(amount) !== Number(attempt.amount_clp)) {
    await updateAttempt(attempt.id, { status: 'review', provider_status: payment.status || body.status, failure_code: 'PROVIDER_AMOUNT_MISMATCH', reconciled_at: new Date().toISOString() });
    throw Object.assign(new Error('El proveedor devolvió un monto o moneda inesperados.'), { code: 'PAYMENT_AMOUNT_MISMATCH' });
  }
  const status = String(payment.status || body.status || '').toLowerCase();
  const paymentId = payment.id || body.payment_id || body.id || authorizedPaymentId;
  if (status === 'approved' || status === 'authorized') return activateVerifiedAttempt(attempt, paymentId, providerSubscriptionId, status, { status, authorizedPaymentId });
  const mapped = ['rejected', 'cancelled', 'refunded'].includes(status) ? status : 'pending';
  await updateAttempt(attempt.id, { status: mapped, provider_object_id: providerSubscriptionId || String(paymentId), provider_status: status, reconciled_at: new Date().toISOString(), next_retry_at: mapped === 'pending' ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null });
  return { ...attempt, status: mapped };
}

async function reconcileMercadoPagoSubscription(subscriptionId) {
  if (!process.env.MP_ACCESS_TOKEN) throw new Error('Mercado Pago no está configurado.');
  let result;
  try {
    result = await providerFetch(`${MP_API}/preapproval/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  } catch (error) {
    if (error.name === 'AbortError') throw timeoutFailure('MP_SUBSCRIPTION_QUERY_TIMEOUT');
    throw error;
  }
  const { response, body: subscription } = result;
  if (!response.ok) throw providerFailure(response, subscription, 'MP_SUBSCRIPTION_QUERY_FAILED', 'No se pudo consultar la suscripción.');
  const attempt = await findAttemptByProviderReference(subscription.external_reference, subscription.id || subscriptionId);
  if (!attempt) throw Object.assign(new Error('Intento de suscripción no encontrado.'), { code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
  const { data: currentSubscription } = await supabase.from('tshow_subscriptions').select('status,current_period_end,cancel_at_period_end').eq('account_id', attempt.account_id).maybeSingle();
  const stillPaid = currentSubscription?.status === 'active' && currentSubscription.current_period_end && Date.parse(currentSubscription.current_period_end) > Date.now();
  const providerStatus = String(subscription.status || '').toLowerCase();
  const localStatus = providerStatus === 'cancelled' && !stillPaid ? 'cancelled' : stillPaid ? 'active' : 'pending';
  await supabase.from('tshow_subscriptions').upsert({ account_id: attempt.account_id, plan_id: attempt.plan_id, provider: attempt.provider, provider_subscription_id: String(subscription.id || subscriptionId), status: localStatus, current_period_end: currentSubscription?.current_period_end || null, cancel_at_period_end: providerStatus === 'cancelled' || currentSubscription?.cancel_at_period_end || false, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });
  await updateAttempt(attempt.id, { status: providerStatus === 'cancelled' ? 'cancelled' : 'pending', provider_object_id: String(subscription.id || subscriptionId), provider_status: providerStatus, reconciled_at: new Date().toISOString(), next_retry_at: providerStatus === 'cancelled' ? null : new Date(Date.now() + 15 * 60 * 1000).toISOString() });
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
  if (Number(payment.status) === 2) return activateVerifiedAttempt(attempt, payment.flowOrder || token, null, String(payment.status), { status: payment.status });
  await updateAttempt(attempt.id, { status: Number(payment.status) === 3 || Number(payment.status) === 4 ? 'rejected' : 'pending', provider_object_id: String(payment.flowOrder || token), provider_status: String(payment.status), reconciled_at: new Date().toISOString() });
  return attempt;
}

router.post('/mercadopago/bricks', requireSupabaseAuth, async (req, res, next) => {
  try {
    const blocked = providerGuard(res, 'mercadopago_bricks');
    if (blocked) return blocked;
    const plan = await activePlan(req.body.planId);
    const { token, paymentMethodId, installments = 1, issuerId } = req.body;
    if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ success: false, code: 'MP_NOT_CONFIGURED', message: 'Mercado Pago no está configurado.' });
    if (!plan || !token || !paymentMethodId) return res.status(400).json({ success: false, code: 'PAYMENT_DATA_INVALID', message: 'Plan o datos de pago incompletos.' });
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
  const blocked = providerGuard(res, 'mercadopago_subscription');
  if (blocked) return blocked;
  let attempt = null;
  try {
    const plan = await activePlan(req.body.planId);
    if (!plan) return res.status(400).json({ success: false, code: 'PLAN_UNAVAILABLE', message: 'Plan no disponible.' });
    if (!process.env.MP_ACCESS_TOKEN || !process.env.MP_WEBHOOK_SECRET || !process.env.PUBLIC_API_URL) return res.status(503).json({ success: false, code: 'MP_NOT_CONFIGURED', message: 'Mercado Pago no está configurado para confirmar pagos.' });
    const { data: currentSubscription } = await supabase.from('tshow_subscriptions').select('status,current_period_end').eq('account_id', req.user.id).maybeSingle();
    if (currentSubscription?.status === 'active' && (!currentSubscription.current_period_end || Date.parse(currentSubscription.current_period_end) > Date.now())) return res.status(409).json({ success: false, code: 'SUBSCRIPTION_ACTIVE', message: 'Tu cuenta ya tiene una suscripción activa.' });
    attempt = await createAttempt(req.user.id, plan, 'mercadopago_subscription', req.body.idempotencyKey);
    if (attempt.status === 'approved') return res.status(200).json({ success: true, attemptId: attempt.id, status: 'approved' });
    if (attempt.checkout_url) return res.status(200).json({ success: true, attemptId: attempt.id, status: 'pending', initPoint: attempt.checkout_url, id: attempt.provider_object_id });
    if (attempt.provider_object_id) return res.status(202).json({ success: true, attemptId: attempt.id, status: 'pending_verification', retryAfterSeconds: 60 });
    const failedRetryAt = Date.parse(attempt.next_retry_at || '');
    if (attempt.status === 'failed' && failedRetryAt > Date.now()) return res.status(429).json({ success: false, code: 'PAYMENT_RETRY_LATER', message: 'Mercado Pago rechazó temporalmente la solicitud. Espera antes de intentar nuevamente.', attemptId: attempt.id, retryAfterSeconds: Math.ceil((failedRetryAt - Date.now()) / 1000), requestId: req.requestId });
    if (attempt.status === 'review') {
      const retryAt = Date.parse(attempt.next_retry_at || '');
      if (retryAt > Date.now()) return res.status(429).json({ success: false, code: 'PAYMENT_RETRY_LATER', message: 'Estamos comprobando la solicitud anterior. Espera antes de intentar nuevamente.', attemptId: attempt.id, retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000), requestId: req.requestId });
      const externalReference = `${attempt.id}:${req.user.id}:${plan.id}`;
      try {
        const recovered = await findMercadoPagoSubscriptionByReference(externalReference);
        if (recovered?.id && recovered.init_point) {
          await updateAttempt(attempt.id, { status: 'pending', provider_object_id: String(recovered.id), provider_status: recovered.status || 'pending', checkout_url: recovered.init_point, last_provider_error: null, next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }, 'checkout', req.requestId);
          return res.status(200).json({ success: true, attemptId: attempt.id, status: 'pending', initPoint: recovered.init_point, id: recovered.id });
        }
      } catch (error) {
        await markProviderFailure(attempt, error, req.requestId);
        return sendProviderFailure(res, error, attempt);
      }
      await updateAttempt(attempt.id, { status: 'processing', next_retry_at: null, last_provider_error: null }, 'checkout', req.requestId);
      attempt.status = 'processing';
    }
    const period = plan.interval === 'year' ? 12 : 1;
    let result;
    try {
      result = await providerFetch(`${MP_API}/preapproval`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': attempt.idempotency_key }, body: JSON.stringify({ reason: `T-Show ${plan.name}`, external_reference: `${attempt.id}:${req.user.id}:${plan.id}`, payer_email: req.user.email, auto_recurring: { frequency: period, frequency_type: 'months', transaction_amount: plan.amount_clp, currency_id: 'CLP' }, back_url: `${frontendOrigin()}/billing.html?status=return&attemptId=${encodeURIComponent(attempt.id)}`, status: 'pending' }) });
    } catch (error) {
      if (error.name === 'AbortError') error = timeoutFailure('MP_SUBSCRIPTION_CREATE_TIMEOUT');
      await markProviderFailure(attempt, error, req.requestId);
      return sendProviderFailure(res, error, attempt);
    }
    const { response, body } = result;
    if (!response.ok) {
      const error = providerFailure(response, body, 'MP_SUBSCRIPTION_CREATE_FAILED', 'No se pudo crear la suscripción.');
      await markProviderFailure(attempt, error, req.requestId);
      return sendProviderFailure(res, error, attempt);
    }
    if (!body.id || !body.init_point) {
      const error = Object.assign(new Error('Mercado Pago devolvió una respuesta incompleta.'), { status: 502, code: 'MP_SUBSCRIPTION_INVALID_RESPONSE' });
      await markProviderFailure(attempt, error, req.requestId);
      return sendProviderFailure(res, error, attempt);
    }
    await updateAttempt(attempt.id, { status: 'pending', provider_object_id: String(body.id), provider_status: body.status || 'pending', checkout_url: body.init_point, provider_request_id: result.response.headers.get('x-request-id') || null, provider_http_status: result.response.status, last_provider_error: null, next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }, 'checkout', req.requestId);
    return res.status(201).json({ success: true, attemptId: attempt.id, initPoint: body.init_point, id: body.id });
  } catch (error) { return next(error); }
});

router.post('/mercadopago/checkout-pro', requireSupabaseAuth, async (req, res, next) => {
  try {
    const blocked = providerGuard(res, 'mercadopago_checkout_pro');
    if (blocked) return blocked;
    const plan = await activePlan(req.body.planId);
    if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ success: false, code: 'MP_NOT_CONFIGURED', message: 'Mercado Pago no está configurado.' });
    if (!plan) return res.status(400).json({ success: false, code: 'PLAN_UNAVAILABLE', message: 'Plan no disponible.' });
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
    const blocked = providerGuard(res, 'flow');
    if (blocked) return blocked;
    const plan = await activePlan(req.body.planId);
    if (!process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) return res.status(503).json({ success: false, code: 'FLOW_NOT_CONFIGURED', message: 'Flow no está configurado.' });
    if (!plan) return res.status(400).json({ success: false, code: 'PLAN_UNAVAILABLE', message: 'Plan no disponible.' });
    const attempt = await createAttempt(req.user.id, plan, 'flow', req.body.idempotencyKey);
    const parameters = { apiKey: process.env.FLOW_API_KEY, commerceOrder: `tshow-${attempt.id}`, subject: `T-Show ${plan.name}`, amount: String(plan.amount_clp), currency: 'CLP', email: req.user.email, urlConfirmation: `${process.env.PUBLIC_API_URL}/api/webhooks/flow`, urlReturn: `${frontendOrigin()}/billing.html?status=return`, optional: JSON.stringify({ attemptId: attempt.id }) };
    const response = await fetch(`${process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api'}/payment/create`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...parameters, s: flowSignature(parameters) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || 'No se pudo iniciar Flow.'), { status: 502, code: 'FLOW_CHECKOUT_ERROR' });
    await updateAttempt(attempt.id, { status: 'pending', provider_object_id: String(body.flowOrder || body.token), provider_status: 'created' });
    return res.status(201).json({ success: true, attemptId: attempt.id, redirectUrl: `${body.url}?token=${encodeURIComponent(body.token)}` });
  } catch (error) { return next(error); }
});

router.get('/billing/attempts/:id', requireSupabaseAuth, async (req, res) => {
  const { data: attempt, error } = await supabase.from('tshow_payment_attempts').select('id,plan_id,provider,status,amount_clp,provider_status,failure_code,next_retry_at,created_at,updated_at').eq('id', req.params.id).eq('account_id', req.user.id).maybeSingle();
  if (error) return res.status(503).json({ success: false, code: 'PAYMENT_STATUS_UNAVAILABLE', message: 'No se pudo consultar el estado de la contratación.', requestId: req.requestId });
  if (!attempt) return res.status(404).json({ success: false, code: 'PAYMENT_ATTEMPT_NOT_FOUND', message: 'Intento de pago no encontrado.', requestId: req.requestId });
  const { data: subscription } = await supabase.from('tshow_subscriptions').select('status,current_period_end,cancel_at_period_end').eq('account_id', req.user.id).maybeSingle();
  return res.json({ success: true, data: { ...attempt, subscriptionStatus: subscription?.status || null, currentPeriodEnd: subscription?.current_period_end || null, cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end) }, requestId: req.requestId });
});

router.post('/billing/subscription/cancel', requireSupabaseAuth, async (req, res, next) => {
  const { data: subscription, error: subscriptionError } = await supabase.from('tshow_subscriptions').select('id,provider,provider_subscription_id,status,current_period_end,cancel_at_period_end').eq('account_id', req.user.id).maybeSingle();
  if (subscriptionError) return res.status(503).json({ success: false, code: 'SUBSCRIPTION_STATUS_UNAVAILABLE', message: 'No se pudo consultar la suscripción.', requestId: req.requestId });
  if (!subscription || subscription.provider !== 'mercadopago_subscription' || !subscription.provider_subscription_id) return res.status(404).json({ success: false, code: 'SUBSCRIPTION_NOT_FOUND', message: 'No hay una suscripción de Mercado Pago para cancelar.', requestId: req.requestId });
  if (subscription.cancel_at_period_end) return res.json({ success: true, data: { cancelAtPeriodEnd: true, currentPeriodEnd: subscription.current_period_end }, requestId: req.requestId });
  try {
    if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ success: false, code: 'MP_NOT_CONFIGURED', message: 'Mercado Pago no está configurado.', requestId: req.requestId });
    let result;
    try {
      result = await providerFetch(`${MP_API}/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`, { method: 'PUT', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
    } catch (error) {
      if (error.name === 'AbortError') error = timeoutFailure('MP_SUBSCRIPTION_CANCEL_TIMEOUT');
      return sendProviderFailure(res, error);
    }
    if (!result.response.ok) return sendProviderFailure(res, providerFailure(result.response, result.body, 'MP_SUBSCRIPTION_CANCEL_FAILED', 'No se pudo cancelar la renovación.'));
    const { error } = await supabase.from('tshow_subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('id', subscription.id);
    if (error) throw new Error(error.message);
    return res.json({ success: true, data: { cancelAtPeriodEnd: true, currentPeriodEnd: subscription.current_period_end }, requestId: req.requestId });
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
  const eventType = String(payload.type || payload.action || 'event');
  const eventState = payload.data?.status || payload.status || payload.action || '';
  const eventKey = `${eventType}:${dataId || crypto.createHash('sha256').update(raw).digest('hex')}:${String(eventState)}`;
  let event;
  try {
    event = await recordWebhook('mercadopago', eventKey, payload);
    if (event.repeated) return res.sendStatus(200);
    if (eventType.includes('subscription_authorized_payment')) await reconcileMercadoPagoAuthorizedPayment(dataId);
    else if (eventType.includes('preapproval')) await reconcileMercadoPagoSubscription(dataId);
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
