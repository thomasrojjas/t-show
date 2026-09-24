// Browser QA with fixture data only. No production account or event is used.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const project = { id: 'qa-operational', eventName: 'Ensayo operativo ficticio', eventDate: '2026-09-23', permission: 'owner' };
const authStub = `window.Auth={requireSession:async()=>({id:'qa-user'}),currentUser:async()=>({id:'qa-user'}),getProfile:async()=>({id:'qa-user',first_name:'QA',last_name:'Producción',role:'account_owner'}),token:async()=>'qa',api:async(p,o)=>{const r=await fetch(p,o);const b=await r.json();if(!r.ok){const e=Error(b.message);e.code=b.code;throw e;}return b;},logout:async()=>{}};`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const errors = [];
    await context.addInitScript(() => localStorage.setItem('tshow_onboarding_v1:qa-user', 'done'));
    await context.route('**/*', route => {
      const url = new URL(route.request().url()); const requestPath = url.pathname;
      if (url.hostname !== 'tshow.test') return route.fulfill({ body: '' });
      if (requestPath === '/js/auth.js') return route.fulfill({ contentType: 'application/javascript', body: authStub });
      if (requestPath === '/js/config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.SHOWTIME_API_URL=location.origin;' });
      if (requestPath.startsWith('/api/')) {
        if (requestPath === '/api/projects') return route.fulfill({ json: { data: [{ id: project.id, event_name: project.eventName, payload: project, member_role: 'owner' }], meta: { ownedCount: 1, limit: 20, remaining: 19 } } });
        if (requestPath === `/api/projects/${project.id}`) return route.fulfill({ json: { data: { id: project.id, event_name: project.eventName, payload: project, permission: 'owner' } } });
        if (requestPath.endsWith('/production')) return route.fulfill({ json: { success: true, serverTime: '2026-09-23T15:00:00Z', project: { id: project.id, documentVersion: 1 }, data: { areas: [], tasks: [], artists: [], appearances: [], notices: [] }, capabilities: { manageAreas: true, editOperational: true, createRehearsal: true } } });
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
    assert(await page.getByText('Todo listo.').count()); assert(await page.getByRole('tab', { name: 'Preparación' }).count());
    await page.getByRole('tab', { name: 'Preparación' }).click(); await page.waitForFunction(() => document.querySelector('.operational-status')?.textContent.includes('Listo'));
    await page.getByRole('button', { name: 'Preparar consulta sin conexión' }).click(); await page.waitForFunction(() => document.querySelector('#operationalSyncStatus')?.textContent.includes('Consulta local preparada')); 
    assert.equal(errors.length, 0, errors.join('\n')); console.log('operational browser QA passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
