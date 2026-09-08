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
  for (const route of ['/projects', '/summary', '/schedule', '/team', '/settings']) assert.match(rewrites, new RegExp(route.replace('/', '\\/')));
});
