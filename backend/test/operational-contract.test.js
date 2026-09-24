const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const route = fs.readFileSync(path.join(root, 'backend/routes/operational.js'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'frontend/js/workspace-nav.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260924023919_operational_evolution.sql'), 'utf8');
const completeness = fs.readFileSync(path.join(root, 'supabase/migrations/20260924033000_operational_completeness.sql'), 'utf8');
const appearanceHistory = fs.readFileSync(path.join(root, 'supabase/migrations/20260924130000_artist_appearance_history.sql'), 'utf8');

test('operational API keeps internal access, feature gating and delegated area writes explicit', () => {
  assert.match(route, /tshow_operational_feature_flags/);
  assert.match(route, /feature_disabled/);
  assert.match(route, /area operators may update their assigned checklist/i);
  assert.match(route, /tshow_project_area_members/);
  assert.match(route, /async function areaOperator/);
  assert.match(route, /Delegated area operators may maintain their own technical cues/i);
  assert.match(route, /technical-cues/);
  assert.match(route, /No tienes permisos para actualizar tareas/);
  assert.match(route, /router\.get\('\/operational-inbox'/);
  assert.match(route, /seen_at.*null/);
  assert.match(route, /visibleNotices/);
  assert.match(route, /recipient\.user_id===req\.user\.id/);
});

test('operational API exposes idempotent checklist templates and rehearsal snapshots', () => {
  assert.match(route, /readiness:readiness\.data\|\|\[\]/);
  assert.match(route, /tasks\/apply-template/);
  assert.match(route, /task_kind.*template/);
  assert.match(route, /snapshot:source/);
  assert.match(route, /current_index:0/);
  assert.match(route, /action==='next'/);
  assert.match(route, /action==='previous'/);
  assert.match(route, /action==='reset'/);
  assert.match(route, /action==='seek'/);
  const realtime = fs.readFileSync(path.join(root, 'frontend/js/operational-realtime.js'), 'utf8');
  assert.match(workspace, /Reloj simulado/);
  assert.match(workspace, /elapsed_seconds/);
  assert.match(workspace, /operationalOfflineMode=true/);
  assert.match(workspace, /solo consulta/);
  assert.match(workspace, /lockOperationalControls/);
  assert.match(workspace, /data-operational-cue-filter/);
  assert.match(workspace, /Filtrar indicaciones por área/);
  assert.match(workspace, /areaName\(item\.area_id\)/);
  assert.match(workspace, /data-operational-artist-search/);
  assert.match(workspace, /Filtrar artistas por estado/);
  assert.match(realtime, /subscribedProject/);
  assert.match(realtime, /removeChannel/);
});

test('operational storage is additive and preserves rehearsal isolation', () => {
  assert.match(migration, /create table if not exists public\.tshow_rehearsals/);
  assert.match(migration, /create table if not exists public\.tshow_timing_adjustments/);
  assert.match(completeness, /add column if not exists snapshot/);
  assert.match(completeness, /add column if not exists current_index/);
});

test('artist appearance transitions retain an isolated audit history', () => {
  assert.match(appearanceHistory, /create table if not exists public\.tshow_artist_appearance_events/);
  assert.match(appearanceHistory, /enable row level security/);
  assert.match(appearanceHistory, /tshow_can_access_internal_project/);
  assert.match(route, /tshow_artist_appearance_events/);
  assert.match(route, /fromStatus/);
  assert.match(route, /appearances\/:appearanceId\/history/);
  assert.match(workspace, /data-operational-appearance-history/);
  assert.match(workspace, /Historial de estados/);
  assert.match(workspace, /data-operational-area-responsible/);
  assert.match(workspace, /\/members`/);
  assert.match(workspace, /data-action="finish"/);
  assert.match(workspace, /paquete completo/);
  assert.match(workspace, /timing-adjustments/);
});

test('timing adjustment application is version guarded and creates a document snapshot', () => {
  assert.match(route, /expectedDocumentVersion/);
  assert.match(route, /document_version:nextVersion/);
  assert.match(route, /tshow_project_document_versions/);
  assert.match(route, /La pauta cambió durante la aplicación/);
});

test('offline cache invalidates stale assets and includes the operational shell', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'frontend/service-worker.js'), 'utf8');
  assert.match(serviceWorker, /tshow-static-v3/);
  assert.match(serviceWorker, /\/js\/chat\.js/);
  assert.match(serviceWorker, /\/js\/workspace-nav\.js/);
  assert.match(serviceWorker, /\/css\/chat\.css/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
});
