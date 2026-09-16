const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = path.resolve(__dirname, '../../frontend');
const read = file => fs.readFileSync(path.join(frontend, file), 'utf8');

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('internal light palette keeps operational text and actions at AA contrast', () => {
  assert.ok(contrast('#202524', '#ffffff') >= 4.5);
  assert.ok(contrast('#58625e', '#ffffff') >= 4.5);
  assert.ok(contrast('#ffffff', '#315ea8') >= 4.5);
  assert.ok(contrast('#f7faf8', '#252b29') >= 4.5);
  assert.ok(contrast('#c0cbc6', '#252b29') >= 4.5);
});

test('authoritative internal theme loads after legacy workspace and operations styles', () => {
  for (const file of ['app.html', 'admin.html', 'command-center.html', 'incidents.html', 'teleprompter.html', 'guest.html']) {
    const html = read(file);
    assert.match(html, /css\/internal-theme\.css/);
    assert.ok(html.lastIndexOf('css/internal-theme.css') > html.lastIndexOf('css/motion-mobile.css'));
  }
  const css = read('css/internal-theme.css');
  assert.match(css, /--theme-bg:#f3f4f4/);
  assert.match(css, /\.segment-card\{background:var\(--theme-surface-strong\)!important/);
  assert.match(css, /:disabled\{background:#dfe3e1!important;color:#46504c!important/);
});

test('all seven visual themes have early bootstrap and complete operational palettes', () => {
  const bootstrap = read('js/theme-bootstrap.js');
  const css = read('css/internal-theme.css');
  const live = read('css/live.css');
  for (const theme of ['light','nocturne','violet','cobalt','ember','emerald','monochrome']) {
    assert.match(bootstrap, new RegExp(`'${theme}'`));
    assert.match(css, new RegExp(`html\\[data-tshow-theme="${theme}"\\].*--theme-bg:`));
    assert.match(live, new RegExp(`html\\[data-tshow-theme="${theme}"\\].*--bg:`));
  }
  assert.match(bootstrap, /tshow_visual_theme_v2/);
  assert.match(bootstrap, /document\.documentElement/);
});

test('platform administration link is mounted in the brand row and targets the admin page', () => {
  const navigation = read('js/workspace-nav.js');
  const admin = read('admin.html');
  assert.match(navigation, /adminLink\.href='\/admin\.html'/);
  assert.match(navigation, /brandRow\?\.classList\.add\('has-admin-link'\)/);
  assert.match(admin, /class="admin-section-link" aria-current="page">Super admin<\/a>/);
  assert.match(admin, /class="admin-session-actions"/);
});

test('collapsed workspace rail keeps the brand clear and exposes the account menu', () => {
  const navigation = read('js/workspace-nav.js');
  const css = read('css/internal-theme.css');
  assert.match(navigation, /live:'<svg/);
  assert.match(navigation, /\$\{navIcons\.live\}<span>Modo en vivo/);
  assert.match(navigation, /files:'<svg[^>]*><path d="M3\.5 6\.5h6/);
  assert.match(navigation, /settings:'<svg[^>]*><path d="M12 8\.5/);
  assert.match(css, /\.workspace-sidebar\{overflow:visible!important\}/);
  assert.match(css, /is-collapsed \.workspace-sidebar-brand \.workspace-nav-brand\{position:absolute!important;left:9px!important/);
  assert.match(css, /is-collapsed \.workspace-nav-account-menu\{position:absolute!important;left:calc\(100% \+ 10px\)!important/);
});
