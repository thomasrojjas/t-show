const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const route = fs.readFileSync(path.join(root, 'backend/routes/operational.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260924023919_operational_evolution.sql'), 'utf8');
const completeness = fs.readFileSync(path.join(root, 'supabase/migrations/20260924033000_operational_completeness.sql'), 'utf8');

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
  const workspace = fs.readFileSync(path.join(root, 'frontend/js/workspace-nav.js'), 'utf8');
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

test('timing adjustment application is version guarded and creates a document snapshot', () => {
  assert.match(route, /expectedDocumentVersion/);
  assert.match(route, /document_version:nextVersion/);
  assert.match(route, /tshow_project_document_versions/);
  assert.match(route, /La pauta cambió durante la aplicación/);
});
