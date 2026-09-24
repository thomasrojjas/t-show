// Browser QA with fixture data only. No production account or event is used.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const project = { id: 'qa-operational', eventName: 'Ensayo operativo ficticio', eventDate: '2026-09-23', permission: 'owner', blocks: [{ id: 'block-1', position: 1, title: 'Apertura', start_time: '20:00' }] };
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
        if (requestPath.endsWith('/members')) return route.fulfill({ json: { success: true, data: [{ user_id: 'member-1', profiles: { id: 'member-1', first_name: 'Operador', last_name: 'QA', email: 'operador@example.test' } }, { user_id: 'member-2', profiles: { id: 'member-2', first_name: 'Editor', last_name: 'QA', email: 'editor@example.test' } }] } });
        if (requestPath.endsWith('/areas')) return route.fulfill({ json: { success: true, data: [{ id: 'area-1', name: 'Sonido', area_key: 'sound', status: 'active', responsible_id: null, tshow_project_area_members: [{ user_id: 'member-1', can_update: true }] }] } });
        if (requestPath.endsWith('/production')) return route.fulfill({ json: { success: true, serverTime: '2026-09-23T15:00:00Z', project: { id: project.id, documentVersion: 1 }, data: { areas: [], tasks: [], artists: [], appearances: [], notices: [] }, capabilities: { manageAreas: browserRole === 'owner', editOperational: browserRole === 'owner', areaUpdate: browserRole === 'owner' || browserRole === 'area_operator', createRehearsal: browserRole === 'owner' } } });
        if (requestPath.endsWith('/readiness')) return route.fulfill({ json: { success: true, data: [{ id: 'r1', status: 'ready', updated_at: '2026-09-23T14:59:00Z', confirmed_by: 'qa-user', note: '', tshow_project_blocks: { title: 'Apertura', start_time: '20:00' }, tshow_project_areas: { name: 'Sonido' } }] } });
        if (requestPath.endsWith('/technical-cues')) return route.fulfill({ json: { success: true, data: [{ id: 'cue-1', body: 'Revisar micrófonos', area_id: 'area-1', block_id: 'block-1' }] } });
        if (requestPath.endsWith('/notices') || requestPath.endsWith('/rehearsals')) return route.fulfill({ json: { success: true, data: [] } });
        if (requestPath.endsWith('/artists')) return route.fulfill({ json: { success: true, data: [{ id: 'artist-1', name: 'Agrupación QA', kind: 'artist', tshow_artist_appearances: [{ id: 'appearance-1', status: 'expected', call_time: '18:00', dressing_room: 'A' }, { id: 'appearance-2', status: 'ready', call_time: '20:00', dressing_room: 'B' }] }] } });
        if (requestPath.endsWith('/tasks')) return route.fulfill({ json: { success: true, data: [{ id: 'task-1', title: 'Revisar micrófonos', description: 'Prueba de sonido', status: 'pending', area_id: 'area-1', assigned_to: 'member-1', due_at: '2026-09-23T17:30:00Z' }] } });
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
    await page.getByRole('tab', { name: 'Preparación' }).click(); await page.waitForFunction(() => document.querySelector('.operational-status')?.textContent.includes('Listo')); assert(await page.locator('[data-operational-readiness]').count()); const readinessRow=page.locator('section[aria-labelledby="operationalReadinessTitle"] .operational-row').first(); assert((await readinessRow.innerText()).includes('Actualizado')); assert((await readinessRow.innerText()).includes('Responsable/operador')); assert.equal(await page.locator('[data-operational-area-member-remove]').count(), 1); assert.equal(await page.locator('[data-operational-area-member-add]').count(), 1);
    await page.locator('[data-operational-readiness]').selectOption('preparing'); await page.waitForTimeout(50); assert(requests.some(item => item.path.endsWith('/readiness/r1')));
    await page.getByRole('tab', { name: 'Checklist' }).click(); await page.waitForSelector('[data-operational-task-new]'); assert.equal(await page.locator('[data-operational-task-area-filter]').count(), 1); assert((await page.locator('.operational-checklist-progress').innerText()).includes('0 de 1')); assert((await page.locator('.operational-row').first().innerText()).includes('Responsable: Operador QA')); await page.locator('[data-operational-task-status-filter]').selectOption('completed'); assert((await page.locator('.operational-list').innerText()).includes('No hay tareas para este filtro.'));
    await page.getByRole('button', { name: 'Aplicar plantilla' }).click(); await page.waitForTimeout(50); assert(requests.some(item => item.path.endsWith('/tasks/apply-template')));
    await page.getByRole('tab', { name: 'Indicaciones' }).click(); await page.waitForSelector('[data-operational-cue-new]'); assert((await page.locator('.operational-row').first().innerText()).includes('Bloque 01 · Apertura · 20:00'));
    await page.getByRole('tab', { name: 'Artistas' }).click(); await page.waitForSelector('[data-operational-artist-new]'); assert.equal(await page.locator('[data-operational-appearance]').count(), 2, 'all artist appearances must be independently visible'); assert.equal(await page.locator('[data-operational-appearance-history]').count(), 2, 'all appearance histories must be available');
    await page.getByRole('tab', { name: 'Avisos' }).click(); await page.waitForSelector('[data-operational-notice]'); await page.locator('[data-operational-notice-form] input[name="title"]').fill('Borrador QA'); await page.locator('[data-operational-notice-form] textarea[name="body"]').fill('Mensaje guardado localmente'); await page.getByRole('tab', { name: 'Checklist' }).click(); await page.getByRole('tab', { name: 'Avisos' }).click(); assert.equal(await page.locator('[data-operational-notice-form] input[name="title"]').inputValue(), 'Borrador QA'); assert.equal(await page.locator('[data-operational-notice-form] textarea[name="body"]').inputValue(), 'Mensaje guardado localmente');
    await page.getByRole('tab', { name: 'Atrasos' }).click(); await page.waitForSelector('[data-operational-preview]');
    await page.getByRole('tab', { name: 'Ensayos' }).click(); await page.waitForSelector('[data-operational-rehearsal]');
    await page.getByRole('button', { name: 'Preparar consulta sin conexión' }).click(); await page.waitForFunction(() => document.querySelector('#operationalSyncStatus')?.textContent.includes('Consulta local preparada')); await context.setOffline(true); await page.waitForFunction(() => document.querySelector('#operationalSyncStatus')?.textContent.includes('Sin conexión')); await page.getByRole('tab', { name: 'Checklist' }).click(); await page.waitForSelector('[data-operational-task-new][disabled]'); await context.setOffline(false);
    browserRole = 'viewer'; await page.reload(); await page.waitForSelector('[data-route="production"]', { state: 'attached' }); await page.evaluate(() => window.WorkspaceShell.navigate('production', true)); await page.waitForFunction(() => document.querySelector('#view-production')?.classList.contains('is-active')); await page.getByRole('tab', { name: 'Preparación' }).click(); assert.equal(await page.locator('[data-operational-area-new]').isVisible().catch(() => false), false, 'viewer area controls must be hidden'); await page.getByRole('tab', { name: 'Checklist' }).click(); assert.equal(await page.locator('[data-operational-task-new]').isVisible().catch(() => false), false, 'viewer task controls must be hidden');
    browserRole = 'area_operator'; await page.reload(); await page.waitForSelector('[data-route="production"]', { state: 'attached' }); await page.evaluate(() => window.WorkspaceShell.navigate('production', true)); await page.waitForFunction(() => document.querySelector('#view-production')?.classList.contains('is-active')); await page.getByRole('tab', { name: 'Indicaciones' }).click(); await page.waitForSelector('[data-operational-cue-new]', { state: 'visible' }); assert.equal(await page.locator('[data-operational-cue-new]').isVisible(), true, 'area operator cue controls must remain available'); assert.equal(await page.locator('[data-operational-area-new]').count(), 0, 'area operator cannot manage areas');
    assert.equal(errors.length, 0, errors.join('\n')); console.log('operational browser QA passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
