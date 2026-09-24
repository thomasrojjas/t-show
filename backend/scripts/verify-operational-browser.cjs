// Browser QA with fixture data only. No production account or event is used.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const project = { id: 'qa-operational', eventName: 'Ensayo operativo ficticio', eventDate: '2026-09-23', permission: 'owner' };
let browserRole = 'owner';
const authStub = `window.Auth={requireSession:async()=>({id:'qa-user'}),currentUser:async()=>({id:'qa-user'}),getProfile:async()=>({id:'qa-user',first_name:'QA',last_name:'Producción',role:'account_owner'}),token:async()=>'qa',api:async(p,o)=>{const r=await fetch(p,o);const b=await r.json();if(!r.ok){const e=Error(b.message);e.code=b.code;throw e;}return b;},logout:async()=>{}};`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const errors = [];
    const requests = [];
    await context.addInitScript(() => localStorage.setItem('tshow_onboarding_v1:qa-user', 'done'));
    await context.route('**/*', route => {
      const url = new URL(route.request().url()); const requestPath = url.pathname;
      if (url.hostname !== 'tshow.test') return route.fulfill({ body: '' });
      if (requestPath === '/js/auth.js') return route.fulfill({ contentType: 'application/javascript', body: authStub });
      if (requestPath === '/js/config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.SHOWTIME_API_URL=location.origin;' });
      if (requestPath.startsWith('/api/')) {
        if (route.request().method() !== 'GET') requests.push({ method: route.request().method(), path: requestPath });
        if (requestPath === '/api/projects') return route.fulfill({ json: { data: [{ id: project.id, event_name: project.eventName, payload: { ...project, permission: browserRole }, member_role: browserRole }], meta: { ownedCount: browserRole === 'owner' ? 1 : 0, limit: 20, remaining: 19 } } });
        if (requestPath === '/api/chat/summary') return route.fulfill({ json: { success: true, data: { events: [{ id: project.id, name: project.eventName, canWrite: true, lastReadSequence: 0, unreadCount: 0 }], soundEnabled: false } } });
        if (requestPath === '/api/operational-inbox') return route.fulfill({ json: { success: true, data: [], unreadCount: 0 } });
        if (requestPath.endsWith('/chat/messages')) return route.fulfill({ json: { success: true, data: { messages: [] } } });
        if (requestPath === `/api/projects/${project.id}`) return route.fulfill({ json: { data: { id: project.id, event_name: project.eventName, payload: { ...project, permission: browserRole }, permission: browserRole } } });
        if (requestPath.endsWith('/production')) return route.fulfill({ json: { success: true, serverTime: '2026-09-23T15:00:00Z', project: { id: project.id, documentVersion: 1 }, data: { areas: [], tasks: [], artists: [], appearances: [], notices: [] }, capabilities: { manageAreas: browserRole === 'owner', editOperational: browserRole === 'owner', createRehearsal: browserRole === 'owner' } } });
        if (requestPath.endsWith('/readiness')) return route.fulfill({ json: { success: true, data: [{ id: 'r1', status: 'ready', tshow_project_blocks: { title: 'Apertura', start_time: '20:00' }, tshow_project_areas: { name: 'Sonido' } }] } });
        if (requestPath.endsWith('/technical-cues') || requestPath.endsWith('/artists') || requestPath.endsWith('/notices') || requestPath.endsWith('/rehearsals')) return route.fulfill({ json: { success: true, data: [] } });
        return route.fulfill({ json: { data: [] } });
      }
      const asset = path.join(root, 'frontend', requestPath === '/' || !path.extname(requestPath) ? 'app.html' : requestPath);
      try { const contentType = requestPath.endsWith('.js') ? 'application/javascript' : requestPath.endsWith('.css') ? 'text/css' : 'text/html'; return route.fulfill({ body: readFileSync(asset), contentType }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`https://tshow.test/summary?project=${project.id}`);
    await page.waitForSelector('[data-route="production"]', { state: 'attached' }); await page.evaluate(() => window.WorkspaceShell.navigate('production', true));
    await page.waitForFunction(() => document.querySelector('#view-production')?.classList.contains('is-active'));
    await page.waitForSelector('#workspaceChatButton'); assert(await page.getByRole('button', { name: 'Chat' }).count()); await page.locator('#workspaceChatButton').click(); await page.waitForFunction(() => !document.querySelector('#chatPanel')?.hidden); assert(await page.getByRole('heading', { name: 'Chat del equipo' }).count()); await page.waitForSelector('.chat-event-option'); await page.locator('#chatDraft').fill('Borrador de prueba'); await page.waitForFunction(() => sessionStorage.getItem('tshow_chat_draft:qa-user:qa-operational') === 'Borrador de prueba'); await page.locator('#chatClose').click();
    assert(await page.getByText('Todo listo.').count()); assert(await page.getByRole('tab', { name: 'Preparación' }).count());
    await page.getByRole('tab', { name: 'Preparación' }).click(); await page.waitForFunction(() => document.querySelector('.operational-status')?.textContent.includes('Listo')); assert(await page.locator('[data-operational-readiness]').count());
    await page.locator('[data-operational-readiness]').selectOption('preparing'); await page.waitForTimeout(50); assert(requests.some(item => item.path.endsWith('/readiness/r1')));
    await page.getByRole('tab', { name: 'Checklist' }).click(); await page.waitForSelector('[data-operational-task-new]');
    await page.getByRole('button', { name: 'Aplicar plantilla' }).click(); await page.waitForTimeout(50); assert(requests.some(item => item.path.endsWith('/tasks/apply-template')));
    await page.getByRole('tab', { name: 'Indicaciones' }).click(); await page.waitForSelector('[data-operational-cue-new]');
    await page.getByRole('tab', { name: 'Artistas' }).click(); await page.waitForSelector('[data-operational-artist-new]');
    await page.getByRole('tab', { name: 'Avisos' }).click(); await page.waitForSelector('[data-operational-notice]');
    await page.getByRole('tab', { name: 'Atrasos' }).click(); await page.waitForSelector('[data-operational-preview]');
    await page.getByRole('tab', { name: 'Ensayos' }).click(); await page.waitForSelector('[data-operational-rehearsal]');
    await page.getByRole('button', { name: 'Preparar consulta sin conexión' }).click(); await page.waitForFunction(() => document.querySelector('#operationalSyncStatus')?.textContent.includes('Consulta local preparada')); await context.setOffline(true); await page.waitForFunction(() => document.querySelector('#operationalSyncStatus')?.textContent.includes('Sin conexión')); await page.getByRole('tab', { name: 'Checklist' }).click(); await page.waitForSelector('[data-operational-task-new][disabled]'); await context.setOffline(false);
    browserRole = 'viewer'; await page.reload(); await page.waitForSelector('[data-route="production"]', { state: 'attached' }); await page.evaluate(() => window.WorkspaceShell.navigate('production', true)); await page.waitForFunction(() => document.querySelector('#view-production')?.classList.contains('is-active')); await page.getByRole('tab', { name: 'Preparación' }).click(); assert.equal(await page.locator('[data-operational-area-new]').isVisible().catch(() => false), false, 'viewer area controls must be hidden'); await page.getByRole('tab', { name: 'Checklist' }).click(); assert.equal(await page.locator('[data-operational-task-new]').isVisible().catch(() => false), false, 'viewer task controls must be hidden');
    assert.equal(errors.length, 0, errors.join('\n')); console.log('operational browser QA passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
