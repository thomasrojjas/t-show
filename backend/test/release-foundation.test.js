const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('release migrations and verifier cover schema versions 21 and 22', () => {
  const foundation = read('backend/db/migrations/021_release_foundation.sql');
  const operations = read('backend/db/migrations/022_release_operations.sql');
  const verifier = read('backend/db/verify/verify_release_schema.sql');
  assert.match(foundation, /tshow_schema_versions[\s\S]*21/i);
  assert.match(operations, /tshow_schema_versions[\s\S]*22/i);
  assert.match(verifier, /missing_migration', '21'/);
  assert.match(verifier, /missing_migration', '22'/);
});

test('sensitive release functions are not executable by public roles', () => {
  const foundation = read('backend/db/migrations/021_release_foundation.sql');
  const operations = read('backend/db/migrations/022_release_operations.sql');
  assert.match(foundation, /revoke\s+(?:all|execute)\s+on function public\.tshow_accept_invitation_service/i);
  assert.match(operations, /revoke\s+(?:all|execute)\s+on function public\.tshow_restore_project_service/i);
});

test('payment activation remains behind provider reconciliation', () => {
  const billing = read('backend/routes/billing.js');
  const bricksRoute = billing.slice(billing.indexOf("router.post('/mercadopago/bricks'"), billing.indexOf("router.post('/mercadopago/subscriptions'"));
  assert.doesNotMatch(bricksRoute, /activateVerifiedAttempt\s*\(/);
  assert.match(bricksRoute, /pending_verification/);
  assert.match(billing, /reconcileMercadoPagoPayment/);
  assert.match(billing, /timingSafeEqual/);
});

test('commercial plans start recurring Mercado Pago subscriptions', () => {
  const landing = read('frontend/index.html');
  const billing = read('frontend/billing.html');
  const interactions = read('frontend/js/landing-interactions.js');
  assert.match(landing, /data-subscribe-plan="pro"/);
  assert.match(landing, /data-subscribe-plan="max"/);
  assert.doesNotMatch(landing, /data-subscribe-plan="(?:pro|max)"[^>]+href="#contacto"/);
  assert.match(interactions, /interval=\$\{period==='annual'\?'year':'month'\}/);
  assert.match(billing, /mercadopago\/subscriptions/);
  assert.match(billing, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(billing, /Se renovará automáticamente/);
});

test('registration confirmation and billing profile recovery remain actionable', () => {
  const invitationFlow = read('frontend/js/invitation-flow.js');
  const billing = read('frontend/billing.html');
  const authStyles = read('frontend/css/auth.css');
  const workspaceStyles = read('frontend/css/workspace-sober.css');
  assert.match(invitationFlow, /Cuenta creada correctamente/);
  assert.match(invitationFlow, /verifica tu correo electrónico/i);
  assert.match(authStyles, /\.auth-toast\{/);
  assert.match(billing, /async function ensureProfile/);
  assert.match(billing, /await Auth\.completeProfile\(values\)/);
  assert.match(workspaceStyles, /is-collapsed \.workspace-nav-account-menu\{left:calc\(100% \+ 10px\)/);
});

test('R2 uploads require finalize verification and private signed downloads', () => {
  const storage = read('backend/routes/storage.js');
  assert.match(storage, /HeadObjectCommand/);
  assert.match(storage, /uploads\/:uploadId\/finalize/);
  assert.match(storage, /GetObjectCommand/);
  assert.match(storage, /expiresIn:\s*300/);
});

test('deployment manifest includes security headers and authenticated routes', () => {
  const manifest = JSON.parse(read('vercel.json'));
  const headers = JSON.stringify(manifest.headers);
  const rewrites = JSON.stringify(manifest.rewrites);
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /Strict-Transport-Security/);
  for (const route of ['/projects', '/summary', '/schedule', '/notes', '/team', '/settings']) assert.match(rewrites, new RegExp(route.replace('/', '\\/')));
});

test('registration migration canonicalizes phone validation and tolerates incomplete profile metadata', () => {
  const migration = read('backend/db/migrations/027_profile_registration_hardening.sql');
  assert.match(migration, /drop constraint if exists profiles_phone_check/i);
  assert.match(migration, /check \(phone ~ E'\^\\\\\+569\[0-9\]\{8\}\$'\)/i);
  assert.match(migration, /phone_value/);
  assert.match(migration, /on conflict \(id\) do nothing/i);
});
