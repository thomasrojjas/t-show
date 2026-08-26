const crypto = require('crypto');
const express = require('express');
const { supabase } = require('../supabaseClient');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();
const apiUrl = 'https://api.mercadopago.com';
const origin = () => process.env.FRONTEND_URL || process.env.CORS_ORIGIN;
const hmac = (value, secret) => crypto.createHmac('sha256', secret || '').update(value).digest('hex');
// Only checkout creation endpoints need JSON. Webhook handlers below retain their raw/form body.
router.use(['/mercadopago/subscriptions', '/mercadopago/checkout-pro', '/flow/subscriptions'], express.json({ limit: '100kb' }));

async function activePlan(planId) {
  const { data } = await supabase.from('tshow_plans').select('*').eq('id', planId).eq('active', true).maybeSingle();
  return data;
}
async function saveSubscription(accountId, plan, provider, providerId, status = 'pending') {
  const { data, error } = await supabase.from('tshow_subscriptions').upsert({ account_id: accountId, plan_id: plan.id, provider, provider_subscription_id: String(providerId), status }, { onConflict: 'account_id' }).select().single();
  if (error) throw new Error(error.message); return data;
}

// Automatic Mercado Pago renewal. Checkout Pro/Bricks are intentionally not used here:
// Mercado Pago's subscription endpoint performs the recurring authorization.
router.post('/mercadopago/subscriptions', requireSupabaseAuth, async (req, res) => {
  const plan = await activePlan(req.body.planId);
  if (!plan) return res.status(400).json({ success: false, message: 'Plan no disponible.' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ success: false, message: 'Mercado Pago no está configurado.' });
  const period = plan.interval === 'year' ? 12 : 1;
  const response = await fetch(`${apiUrl}/preapproval`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: `T-Show ${plan.name}`, external_reference: `${req.user.id}:${plan.id}`, payer_email: req.user.email, auto_recurring: { frequency: period, frequency_type: 'months', transaction_amount: plan.amount_clp, currency_id: 'CLP' }, back_url: `${origin()}/index.html?billing=mercadopago`, status: 'pending' }) });
  const body = await response.json();
  if (!response.ok) return res.status(400).json({ success: false, message: body.message || 'No se pudo crear la suscripción.' });
  await saveSubscription(req.user.id, plan, 'mercadopago_subscription', body.id);
  res.status(201).json({ success: true, initPoint: body.init_point, id: body.id });
});

// Hosted manual payment fallback; it grants only the selected term after a verified webhook.
router.post('/mercadopago/checkout-pro', requireSupabaseAuth, async (req, res) => {
  const plan = await activePlan(req.body.planId);
  if (!plan || !process.env.MP_ACCESS_TOKEN) return res.status(400).json({ success: false, message: 'Plan o Mercado Pago no disponible.' });
  const response = await fetch(`${apiUrl}/checkout/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ title: `T-Show ${plan.name}`, quantity: 1, currency_id: 'CLP', unit_price: plan.amount_clp }], external_reference: `${req.user.id}:${plan.id}:manual`, back_urls: { success: `${origin()}/index.html?billing=success`, failure: `${origin()}/index.html?billing=failure`, pending: `${origin()}/index.html?billing=pending` }, notification_url: `${process.env.PUBLIC_API_URL}/api/webhooks/mercadopago` }) });
  const body = await response.json();
  if (!response.ok) return res.status(400).json({ success: false, message: body.message || 'No se pudo crear Checkout Pro.' });
  res.status(201).json({ success: true, initPoint: body.init_point, preferenceId: body.id });
});

// Flow subscriptions are created server-side and redirect the customer to Flow's authorization URL.
router.post('/flow/subscriptions', requireSupabaseAuth, async (req, res) => {
  const plan = await activePlan(req.body.planId);
  if (!plan || !process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) return res.status(400).json({ success: false, message: 'Plan o Flow no disponible.' });
  const commerceOrder = `tshow-${req.user.id}-${Date.now()}`;
  const params = new URLSearchParams({ apiKey: process.env.FLOW_API_KEY, commerceOrder, subject: `T-Show ${plan.name}`, amount: String(plan.amount_clp), currency: 'CLP', email: req.user.email, urlConfirmation: `${process.env.PUBLIC_API_URL}/api/webhooks/flow`, urlReturn: `${origin()}/index.html?billing=flow`, optional: JSON.stringify({ accountId: req.user.id, planId: plan.id, interval: plan.interval }) });
  params.set('s', hmac(params.toString(), process.env.FLOW_SECRET_KEY));
  const response = await fetch(`${process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api'}/payment/create`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const body = await response.json();
  if (!response.ok) return res.status(400).json({ success: false, message: body.message || 'No se pudo iniciar Flow.' });
  res.status(201).json({ success: true, redirectUrl: `${body.url}?token=${encodeURIComponent(body.token)}` });
});

async function recordWebhook(provider, eventKey, payload) {
  const { error } = await supabase.from('tshow_webhook_events').insert({ provider, event_key: eventKey, payload });
  return !error; // false means repeated event: acknowledge without side effects
}
router.post('/webhooks/mercadopago', express.raw({ type: '*/*' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body || {});
  const signature = req.get('x-signature') || '';
  if (process.env.MP_WEBHOOK_SECRET && !signature.includes(hmac(raw, process.env.MP_WEBHOOK_SECRET))) return res.status(401).send('invalid signature');
  let payload; try { payload = JSON.parse(raw); } catch { return res.status(400).send('invalid json'); }
  const eventKey = `${payload.type || payload.action || 'event'}:${payload.data?.id || payload.id || crypto.createHash('sha256').update(raw).digest('hex')}`;
  await recordWebhook('mercadopago', eventKey, payload);
  res.sendStatus(200); // provider API reconciliation is intentionally asynchronous/idempotent.
});
router.post('/webhooks/flow', express.urlencoded({ extended: false }), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('missing token');
  const accepted = await recordWebhook('flow', `payment:${token}`, req.body);
  res.status(accepted ? 200 : 200).send('OK');
});
module.exports = router;
