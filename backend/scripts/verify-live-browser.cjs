// Local-only browser QA. All account/project traffic is mocked; no production writes.
// NODE_PATH may point to a bundled Playwright installation. Screenshots go outside the repo.
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const engine = require('../../frontend/js/live-engine');
const root = path.resolve(__dirname,'../..');
const output = process.env.LIVE_QA_OUTPUT || path.join(require('node:os').tmpdir(),'tshow-live-qa');
mkdirSync(output,{recursive:true});
const baseline = process.argv.includes('--baseline');
const now = Date.now(), zone = 'America/Santiago', day = engine.dateInZone(now,zone);
const start = engine.formatTimeSeconds(now - 180000,zone).slice(0,5);
const project = { id:'live-qa', eventName:'Festival de Invierno · Escenario principal', eventDate:day, timeZone:zone,
  convocatoriaDuration:0, doorsDuration:0, showStartMode:'fixed', showStartTimeInput:start, permission:'owner',
  blocks:Array.from({length:105},(_,i)=>({id:'b'+i,type:i%2?'ANIMACIÓN':'SHOW',title:i===0?'Apertura de puertas y bienvenida al Festival de Invierno':i===1?'Presentación del equipo y próxima actuación':'Bloque '+(i+1)+' · Coordinación de escenario',
    duration:10, animator_script:'Buenas noches. Bienvenidos al Festival de Invierno.\n\n'+('Agradecemos al equipo de producción y a quienes nos acompañan esta noche.\n\n').repeat(i===1?25:3),notes:'Confirmar micrófono y señal de iluminación.\nEsperar autorización del director.'})) };
let state = {status:'live',trackingMode:'schedule',currentIndex:0}, version=0;
let failWrite=false, conflictWrite=false;
const authStub = `window.Auth={requireSession:async()=>({id:'qa'}),getProfile:async()=>({role:'platform_admin'}),token:async()=>'test-token',
client:async()=>({channel:()=>({on(){return this},subscribe(cb){if(cb)setTimeout(()=>cb('SUBSCRIBED'),20);return this},unsubscribe(){}})}),
api:async(path,options)=>{const r=await fetch(path,options);const b=await r.json();if(!r.ok)throw Error(b.message);return b;}};`;
(async()=>{
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext();
  let role='owner';
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()), pathname=url.pathname;
    if (url.hostname!=='tshow.test') return route.fulfill({status:200,body:''});
    if(pathname==='/js/auth.js')return route.fulfill({contentType:'application/javascript',body:authStub});
    if(pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:'window.SHOWTIME_API_URL=location.origin;'});
    if(pathname.startsWith('/api/')){
      if(pathname.endsWith('/live')){
        if(route.request().method()==='PUT'){
          const cmd=route.request().postDataJSON();
          if(failWrite){failWrite=false;return route.fulfill({status:503,json:{message:'Error de red simulado'}});}
          if(conflictWrite){conflictWrite=false;version++;return route.fulfill({status:409,json:{message:'Otro operador actualizó la sesión'}});}
          if(cmd.expectedVersion!==version)return route.fulfill({status:409,json:{message:'Conflicto de revisión'}});
          try {state=engine.transition(project,state,cmd,role);version++;}
          catch(e){return route.fulfill({status:400,json:{message:e.message}});}
        }
        return route.fulfill({json:{data:state,version,serverNow:new Date().toISOString()}});
      }
      if(pathname==='/api/projects')return route.fulfill({json:{data:[{id:project.id,event_name:project.eventName,payload:project,member_role:role}]}});
      return route.fulfill({json:{data:{id:project.id,event_name:project.eventName,payload:project,permission:role}}});
    }
    const file=path.join(root,'frontend',pathname==='/live'||pathname==='/live.html'?'live.html':pathname);
    if(!file.startsWith(path.join(root,'frontend')))return route.abort();
    try{
      const body=baseline && /\.(js|css|html)$/.test(file) ? execFileSync('git',['show','7ffae20:'+path.relative(root,file).replaceAll('\\','/')],{cwd:root,maxBuffer:1024*1024*10}) : readFileSync(file);
      const ext=path.extname(file),type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'}[ext]||'application/octet-stream';
      return route.fulfill({body,contentType:type});
    }catch(_){return route.fulfill({status:404,body:'Not found'});}
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://tshow.test/live?project=live-qa');
  await page.waitForTimeout(500);
  if(baseline){
    await page.setViewportSize({width:1366,height:768});
    await page.screenshot({path:path.join(output,'before-console-1366.png'),fullPage:true});
    await page.evaluate(()=>liveApp.openStageConfidenceDisplay());
    await page.screenshot({path:path.join(output,'before-stage-1366.png')});
  }else{
    await page.waitForFunction(()=>window.liveApp?.connected, null, {timeout:10000}).catch(async error=>{
      console.error('Browser diagnostics',errors,await page.locator('body').innerText());throw error;
    });
    for(const [width,height] of [[360,800],[390,844],[768,1024],[1024,768],[1366,768],[1920,1080]]){
      await page.setViewportSize({width,height});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      assert.equal(overflow,false,'horizontal overflow at '+width);
      await page.screenshot({path:path.join(output,`console-${width}.png`)});
      await page.locator('#stageButton').click();
      assert.equal(await page.locator('#stageDialog').evaluate(node=>node.scrollWidth>node.clientWidth),false,'stage overflow at '+width);
      await page.screenshot({path:path.join(output,`stage-${width}.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'stageButton');
      await page.locator('#rundownRows .cue:last-child').scrollIntoViewIfNeeded();
      assert(await page.locator('#rundownRows .cue:last-child').isVisible());
      await page.evaluate(()=>scrollTo(0,0));
    }
    await page.setViewportSize({width:1366,height:768});
    await page.locator('.cue-select').nth(1).click();
    await page.locator('#notesTab').click();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#scriptTab').getAttribute('aria-selected'),'true');
    await page.keyboard.press('ArrowRight');
    const chosen=await page.evaluate(()=>liveApp.selection);
    const handle=await page.locator('.cue-select').nth(1).elementHandle();
    await page.waitForTimeout(31000);
    assert.equal(await page.evaluate(()=>liveApp.selection),chosen,'reading selection must survive ticking');
    assert(await handle.evaluate(node=>node.isConnected),'row nodes must stay stable');
    assert.equal(await page.locator('#notesTab').getAttribute('aria-selected'),'true');
    await page.locator('#returnCurrent').click();
    assert.equal(await page.evaluate(()=>liveApp.follow),true);
    await page.locator('#primaryAction').click();
    await page.waitForFunction(()=>liveApp.state.status==='paused');
    const frozen=await page.locator('#remainingTimer').textContent();
    await page.waitForTimeout(1200);assert.equal(await page.locator('#remainingTimer').textContent(),frozen);
    await page.locator('#primaryAction').click();
    await page.waitForFunction(()=>liveApp.state.status==='live');
    await page.locator('#trackingMode').selectOption('manual');
    await page.locator('#confirmDialog [value=confirm]').click();
    await page.waitForFunction(()=>liveApp.state.trackingMode==='manual');
    await page.locator('#extendButton').click();
    await page.waitForFunction(()=>Object.keys(liveApp.state.blockExtensions).length>0);
    failWrite=true;const before=state.currentBlockId;
    await page.locator('#nextButton').click();
    await page.waitForFunction(()=>!liveApp.connected);
    assert.equal(state.currentBlockId,before);
    assert(await page.locator('#nextButton').isDisabled());
    await page.locator('#retryButton').click();await page.waitForFunction(()=>liveApp.connected);
    conflictWrite=true;await page.locator('#nextButton').click();await page.waitForFunction(()=>!liveApp.connected);
    await page.locator('#retryButton').click();await page.waitForFunction(()=>liveApp.connected);
    await page.locator('#nextButton').click();await page.waitForFunction(()=>liveApp.state.currentBlockId==='b1');
    await page.locator('#stageButton').click();await page.screenshot({path:path.join(output,'stage-1366.png')});
    await page.keyboard.press('Escape');assert.equal(await page.locator('#stageDialog').isVisible(),false);
    await page.locator('#moreMenu summary').click();await page.locator('#finishButton').click();
    await page.locator('#confirmDialog [value=confirm]').click();await page.waitForFunction(()=>liveApp.state.status==='finished');
    assert(await page.locator('#reportDialog').isVisible());await page.locator('#closeReport').click();
    assert.equal(await page.locator('#backLink').getAttribute('href'),'/schedule?project=live-qa');
    await page.reload();await page.waitForFunction(()=>liveApp.connected);assert.equal(await page.evaluate(()=>liveApp.state.status),'finished');
    await page.locator('#moreMenu summary').click();await page.locator('#resetButton').click();
    await page.locator('#confirmDialog [value=confirm]').click();await page.waitForFunction(()=>liveApp.state.status==='idle');
    await page.locator('.cue-select').nth(2).click();await page.locator('.cue-extra button').nth(2).click();
    await page.locator('#confirmDialog [value=confirm]').click();await page.waitForFunction(()=>liveApp.state.mutedBlockIds?.includes('b2'));
    await page.locator('.cue-extra button').nth(2).click();await page.locator('#confirmDialog [value=confirm]').click();
    await page.waitForFunction(()=>!liveApp.state.mutedBlockIds?.includes('b2'));
    await page.locator('#primaryAction').click();await page.waitForFunction(()=>liveApp.state.status==='live');
    const second=await context.newPage();await second.goto('http://tshow.test/live?project=live-qa');
    await second.waitForFunction(()=>liveApp.connected);
    await page.locator('#primaryAction').click();await page.waitForFunction(()=>liveApp.state.status==='paused');
    await second.evaluate(()=>liveApp.refresh());assert.equal(await second.evaluate(()=>liveApp.state.status),'paused');await second.close();
    for(role of ['viewer','editor']){
      state={status:'live',trackingMode:'schedule'};version++;
      await page.reload();await page.waitForFunction(()=>liveApp.connected);
      assert.equal(await page.locator('#primaryAction').isVisible(),role==='editor');
      assert.equal(await page.locator('#finishButton').isVisible(),false);
      assert(await page.locator('#backLink').isVisible());
    }
    await page.setViewportSize({width:683,height:384}); // equivalent layout viewport to 1366 @ 200% zoom
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:1366,height:768});
    await page.evaluate(()=>document.body.style.zoom='2');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'200% CSS zoom');
    await page.evaluate(()=>document.body.style.zoom='1');
    await page.evaluate(()=>{liveApp.project.eventName='Evento con título muy extenso '.repeat(9);liveApp.text('eventName',liveApp.project.eventName);liveApp.render();});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'long event name');
    await page.locator('#backLink').click();assert(page.url().includes('/schedule?project=live-qa'));
    await page.goBack();await page.waitForFunction(()=>liveApp.connected);
    assert.deepEqual(errors,[]);
  }
  await browser.close();console.log('PASS '+(baseline?'baseline screenshots':'responsive, selection, actions, errors, conflict, permissions')+' — '+output);
})().catch(e=>{console.error(e);process.exit(1);});
