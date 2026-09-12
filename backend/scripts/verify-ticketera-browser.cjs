// All HTTP requests are intercepted. Never touches production data.
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(require('node:os').tmpdir(), 'tshow-ticketera-qa');
mkdirSync(output, { recursive: true });
const project = { id:'qa',eventName:'Evento de prueba',blocks:[],visualTheme:'nocturne',permission:'owner' };
const metrics = {issued:10,checkedIn:2,grossSalesClp:20000,approvedTickets:5,pendingPayments:5,occupancyPercent:10,capacity:100,pendingAttendance:8,ticketTypes:[],zones:[]};
const auth = `window.Auth={requireSession:async()=>({id:'qa-user'}),currentUser:async()=>({id:'qa-user'}),getProfile:async()=>({id:'qa-user',first_name:'QA',role:'account_owner'}),token:async()=>'qa',api:async(p,o)=>{const r=await fetch(p,o);const b=await r.json();if(!r.ok){const e=Error(b.message);e.code=b.code;e.requestId=b.requestId;throw e;}return b;},logout:async()=>{}};`;
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext();
    await context.addInitScript(()=>localStorage.setItem('tshow_onboarding_v1:qa-user','done'));
    let mode='error',catalogCalls=0,release,connected=false;
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(url.hostname!=='tshow.test')return route.fulfill({body:''});
      if(p==='/js/auth.js')return route.fulfill({contentType:'application/javascript',body:auth});
      if(p==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:'window.SHOWTIME_API_URL=location.origin;'});
      if(p.startsWith('/api/')){
        if(p==='/api/integrations/ticketera/events'){
          catalogCalls++;
          const snapshot=mode;
          if(snapshot==='slow')await new Promise(resolve=>{release=resolve;});
          if(snapshot==='error')return route.fulfill({status:502,json:{code:'TICKETERA_INVALID_RESPONSE',message:'Ticketera devolvió una respuesta incompatible. No se han actualizado las cifras.',requestId:'qa-support-123456789'}});
          return route.fulfill({json:{data:snapshot==='empty'?[]:[{id:'1',name:'Evento Ticketera'}]}});
        }
        if(p.endsWith('/integrations/ticketera'))return route.fulfill({json:{data:connected?{external_event_name:'Evento Ticketera'}:null,configured:true,manageable:true}});
        if(p.endsWith('/metrics/ticketera'))return route.fulfill({json:{data:mode==='invalid-metrics'?{}:metrics,connection:{last_synced_at:new Date().toISOString()}}});
        if(p==='/api/projects')return route.fulfill({json:{data:['qa','qa2'].map(id=>({id,event_name:id,payload:{...project,id},member_role:'owner'})),meta:{limit:20}}});
        if(/^\/api\/projects\/qa2?$/.test(p))return route.fulfill({json:{data:{id:p.split('/').pop(),event_name:'QA',payload:{...project,id:p.split('/').pop()},permission:'owner'}}});
        if(p.endsWith('/live'))return route.fulfill({json:{data:{status:'idle'},version:0,serverNow:new Date().toISOString()}});
        return route.fulfill({json:{data:[]}});
      }
      try{return route.fulfill({body:readFileSync(path.join(root,'frontend',!path.extname(p)?'app.html':p)),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.png')?'image/png':'text/html'});}
      catch{return route.fulfill({status:404,body:''});}
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://tshow.test/metrics?project=qa');
    await page.waitForFunction(()=>document.querySelector('#metricsStatus')?.textContent.includes('qa-support'));
    for(const width of [404,1366]){
      await page.setViewportSize({width,height:850});await page.waitForTimeout(350);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow at '+width);
      await page.screenshot({path:path.join(output,'metrics-error-'+width+'.png'),fullPage:true});
    }
    mode='slow';const before=catalogCalls;
    await page.locator('#metricsRefresh').click();
    await page.waitForFunction(()=>document.querySelector('#metricsRefresh').disabled);
    await page.evaluate(()=>{document.getElementById('metricsRefresh').click();document.getElementById('metricsRefresh').click();});
    while(!release)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(catalogCalls,before+1);
    // Change projects while an old catalog response is pending.
    mode='empty';
    await page.evaluate(()=>{history.pushState({},'','/metrics?project=qa2');dispatchEvent(new PopStateEvent('popstate'));});
    await page.waitForFunction(()=>document.getElementById('metricsStatus').textContent.includes('No hay eventos'));
    release();release=null;
    await page.waitForTimeout(150);
    assert.match(await page.locator('#metricsStatus').innerText(),/No hay eventos/);
    assert.equal(await page.locator('#ticketeraEventSelect').count(),0);
    mode='valid';await page.locator('#metricsRefresh').click();
    await page.waitForSelector('#ticketeraEventSelect');
    assert.equal(await page.locator('#ticketeraEventSelect option').count(),2);
    connected=true;mode='invalid-metrics';await page.locator('#metricsRefresh').click();
    await page.waitForFunction(()=>document.getElementById('metricsStatus').textContent.includes('no entregó métricas'));
    assert.equal(await page.locator('#metricsDashboard').isVisible(),false);
    mode='valid';await page.locator('#metricsRefresh').click();
    await page.waitForFunction(()=>document.getElementById('metricsStatus').textContent.includes('Métricas sincronizadas'));
    assert.equal(await page.locator('#metricIssued').innerText(),'10');
    await page.screenshot({path:path.join(output,'metrics-success.png'),fullPage:true});
    // A response after leaving Metrics must not update its DOM.
    connected=false;mode='slow';await page.locator('#metricsRefresh').click();
    while(!release)await new Promise(resolve=>setTimeout(resolve,10));
    await page.evaluate(()=>WorkspaceShell.navigate('notes',true));
    release();await page.waitForTimeout(150);
    assert.equal(await page.locator('#ticketeraEventSelect').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: error/retry, empty catalog, single flight, project change, stale response, metrics validation; screenshots: '+output);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
