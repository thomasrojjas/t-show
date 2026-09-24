const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('live guest passes are additive and keep snapshot as the default', () => {
  const migration = read('supabase/migrations/20260916123000_guest_pass_live_mode.sql');
  const operations = read('backend/routes/operations.js');
  assert.match(migration, /add column if not exists access_mode text not null default 'snapshot'/i);
  assert.match(migration, /access_mode in \('snapshot', 'live'\)/i);
  assert.match(operations, /const accessMode=req\.body\.accessMode==='live'\?'live':'snapshot'/);
  assert.match(operations, /select\('id,access_mode,expires_at,revoked_at,locked_until,access_count'\)/);
});

test('workspace exposes a private operational notice tray', () => {
  const chat = read('frontend/js/chat.js');
  const css = read('frontend/css/chat.css');
  assert.match(chat, /operationalNoticeDialog/);
  assert.match(chat, /\/api\/operational-inbox/);
  assert.match(chat, /tshow_operational_notice_recipients/);
  assert.match(css, /\.operational-notice-dialog/);
});

test('chat drafts are isolated by authenticated user and event', () => {
  const chat = read('frontend/js/chat.js');
  assert.match(chat, /draftKey\(projectId\).*currentUserId/);
  assert.match(chat, /\$\{key\}:chat/);
});

test('live observer API returns a compact snapshot and never the published document', () => {
  const operations = read('backend/routes/operations.js');
  assert.match(operations, /router\.get\('\/guest-passes\/live\/:sessionToken'/);
  assert.match(operations, /Cache-Control','no-store/);
  assert.match(operations, /current:compact\(snapshot\.currentItem\),next,/);
  assert.doesNotMatch(operations.slice(operations.indexOf("router.get('/guest-passes/live/")), /published_snapshot/);
  assert.match(operations, /router\.post\('\/guest-passes\/live\/:sessionToken\/renew'/);
});

test('observer URL opens the dedicated read-only screen and can survive reload', () => {
  const guest = read('frontend/guest.html');
  const observer = read('frontend/guest-live.html');
  const app = read('frontend/js/guest-live-app.js');
  assert.match(guest, /exchanged\.accessMode === 'live'/);
  assert.match(guest, /guest-live\.html#session=/);
  assert.match(observer, /Vista de escenario/);
  assert.doesNotMatch(observer, /Guion|Notas|Equipo|Administración/);
  assert.match(app, /sessionStorage\.getItem\('tshow_guest_live_session'\)/);
  assert.match(app, /setInterval\(\(\) => \{ if \(!document\.hidden\) fetchState\(\); \}, 5000\)/);
});

test('live console exposes the observer action and a separate next-block panel', () => {
  const html = read('frontend/live.html');
  const app = read('frontend/js/live-app.js');
  assert.match(html, /id="shareObserver"/);
  assert.match(html, /class="block-neighbors"/);
  assert.match(html, /id="previousPanelName"/);
  assert.match(html, /id="nextPanelName"/);
  assert.match(html, /id="previousButton"/);
  assert.match(html, /id="stagePrevious"/);
  assert.match(html, /class="stage-brand"/);
  assert.match(html, /id="nextHeaderCountdown"/);
  assert.match(html, /id="productionLink"/);
  assert.match(html, /id="liveReadinessSummary"/);
  assert.match(html, /id="camarinesButton"/);
  assert.match(html, /id="camarinesRows"/);
  assert.match(html, /id="camarinesCountdown"/);
  assert.match(html, /id="camarinesPreviousTitle"/);
  assert.match(html, /id="camarinesPreviousMeta"/);
  assert.match(html, /id="camarinesNextTitle"/);
  assert.match(html, /Hora actual/);
  assert.doesNotMatch(html, /id="sessionStatus"/);
  assert.doesNotMatch(html, /id="connectionStatus"/);
  assert.doesNotMatch(html, /id="zoneLabel"/);
  assert.doesNotMatch(html, /\/ Operación/);
  assert.match(html, /id="observerQr"/);
  assert.match(app, /accessMode:'live'/);
  assert.match(app, /const previous = snap.currentItem/);
  assert.match(app, /previousPanelName/);
  assert.match(app, /nextPanelName/);
  assert.match(app, /action:'previous'/);
  assert.match(app, /stageStatus\.dataset\.active/);
  assert.match(app, /renderCamarines\(snap, current, timer, timerLabel, labels\)/);
  assert.match(app, /readiness-summary/);
  assert.match(app, /renderReadiness\(snap\)/);
  assert.match(app, /escape\(value\)/);
  assert.match(app, /productionLink.*hidden = !this\.operator/);
  assert.match(app, /const previousItem = snap\.previousItem/);
  assert.match(app, /camarinesPreviousTitle/);
  assert.match(app, /camarinesNextTitle/);
  assert.match(app, /\['live','paused'\]\.includes\(snap\.status\)/);
  assert.match(app, /const remaining = snap\.items\.filter\(row => row\.num >= startNum\)/);
});

test('manual live advance warns and audits pending area preparation', () => {
  const live = fs.readFileSync(path.join(__dirname, '../../frontend/js/live-app.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '../routes/saas.js'), 'utf8');
  assert.match(live, /Avanzar con preparación pendiente/);
  assert.match(live, /readinessOverride/);
  assert.match(api, /live\.next_with_readiness_warning/);
});

test('project selector uses equal horizontal pages and hides pagination on mobile', () => {
  const nav = read('frontend/js/workspace-nav.js');
  const sober = read('frontend/css/workspace-sober.css');
  const mobile = read('frontend/css/mobile-repairs.css');
  assert.match(nav, /const starts=Array\.from\(\{length:totalPages\}/);
  assert.match(nav, /targetPage=Math\.max\(1,Math\.min\(totalPages,current\+direction\)\)/);
  assert.match(nav, /width<1024\?2:3/);
  assert.match(sober, /grid-auto-columns:calc\(\(100% - 48px\)\/3\)/);
  assert.match(sober, /grid-auto-columns:calc\(\(100% - 24px\)\/2\)/);
  assert.match(mobile, /body\.workspace-surface\.project-selector-active \.carousel-arrow,\s*body\.workspace-surface\.project-selector-active \.project-carousel-status\s*\{display:none!important\}/);
});

test('live theme switcher is local per event and accessible', () => {
  const html = read('frontend/live.html');
  const app = read('frontend/js/live-app.js');
  const bootstrap = read('frontend/js/theme-bootstrap.js');
  const css = read('frontend/css/live.css');
  assert.match(html, /data-live-theme="true"/);
  assert.match(html, /id="liveThemeOptions"/);
  assert.doesNotMatch(html, /liveThemeReset/);
  assert.match(app, /aria-pressed/);
  assert.match(app, /rememberLive/);
  assert.match(bootstrap, /forgetLive/);
  assert.match(app, /liveOverrideFor/);
  assert.match(bootstrap, /tshow_live_theme_v1/);
  assert.match(bootstrap, /value && themes\.has\(value\) \? value : null/);
  for (const theme of ['light','nocturne','violet','cobalt','ember','emerald','monochrome']) {
    assert.match(css, new RegExp(`data-theme=${theme}`));
  }
  assert.match(css, /\.live-theme-option\{[^}]*min-width:44px/);
  assert.match(css, /\.neighbor-panel\{[^}]*padding:20px 24px/);
});

test('stage view is isolated and timeline widths use visible block content', () => {
  const liveCss = read('frontend/css/live.css');
  const app = read('frontend/js/app.js');
  assert.match(liveCss, /\.stage-dialog\{position:fixed;inset:0/);
  assert.match(liveCss, /\.stage-dialog::backdrop\{background:var\(--bg\)\}/);
  assert.match(liveCss, /\.stage-dialog\[open\].*animation:none!important/);
  assert.match(liveCss, /\.block-neighbors\{grid-area:neighbors/);
  assert.match(app, /result\.tableRows\.reduce\(\(sum, row\) => sum \+ Math\.max/);
});
