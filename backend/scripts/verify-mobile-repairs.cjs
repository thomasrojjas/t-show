// Local fixtures only: no production requests, users, payments or passes.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const output=path.join(require('node:os').tmpdir(),'tshow-mobile-repairs');
mkdirSync(output,{recursive:true});
const baseline=process.argv.includes('--baseline');
const project={id:'qa',eventName:'SHOW FIESTAS PATRIAS 2026 · Producción y escenario principal',eventDate:'2026-09-17',location:'Antofagasta',permission:'owner',convocatoriaTime:'18:30',convocatoriaDuration:30,doorsTime:'19:30',doorsDuration:60,showStartMode:'manual',showStartTimeInput:'20:30',blocks:[{id:'b1',type:'SHOW',title:'Presentación del elenco de producción',duration:20,notes:'Nota de prueba',animator_script:'Guion de prueba'}]};
const auth=`window.Auth={requireSession:async()=>({id:'qa-user'}),currentUser:async()=>({id:'qa-user'}),getProfile:async()=>({id:'qa-user',role:'platform_admin',first_name:'QA',last_name:'Local'}),token:async()=>'qa',client:async()=>({channel:()=>({on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},unsubscribe(){}})}),api:async(p,o)=>{const r=await fetch(p,o);return r.json();}};`;
(async()=>{
 const browser=await chromium.launch({headless:true});
 const qr=await require('qrcode').toDataURL('https://tshow.test/guest#token=local-only');
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('tshow_onboarding_v1:qa-user','done'));
  let count=7,lastPass=null,passes=[],saved=null,phase='idle';
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname,method=route.request().method();
   if(url.hostname!=='tshow.test')return route.fulfill({body:''});
   if(p==='/js/auth.js')return route.fulfill({contentType:'application/javascript',body:auth});
   if(p==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:'window.SHOWTIME_API_URL=location.origin;'});
   if(p.startsWith('/api/')){
    if(p==='/api/projects')return route.fulfill({json:{data:Array.from({length:count},(_,i)=>({id:i?'qa'+i:'qa',event_name:project.eventName,payload:project,member_role:'owner'})),meta:{ownedCount:count,limit:20,remaining:20-count}}});
    if(p.endsWith('/live'))return route.fulfill({json:{data:{status:phase,trackingMode:'manual',currentIndex:0},version:0,serverNow:new Date().toISOString()}});
    if(p.includes('/guest-passes')){
     if(method==='POST'){lastPass=route.request().postDataJSON();passes.push({id:'pass'+passes.length,label:lastPass.label,access_mode:'live',expires_at:'2099-01-01'});await new Promise(r=>setTimeout(r,200));return route.fulfill({json:{data:passes.at(-1),url:'https://tshow.test/guest#token=local-only',qr}});}
     if(method==='DELETE')passes=passes.filter(x=>!p.endsWith('/'+x.id));
     return route.fulfill({json:{data:passes}});
    }
    if(p==='/api/projects/qa'){if(method==='PUT'||method==='PATCH')saved=route.request().postDataJSON();return route.fulfill({json:{data:{id:'qa',event_name:project.eventName,payload:project,permission:'owner'}}});}
    return route.fulfill({json:{data:[]}});
   }
   const file='frontend'+(p==='/live'||p==='/live.html'?'/live.html':!path.extname(p)?'/app.html':p);
   try{const body=baseline?execFileSync('git',['show','HEAD:'+file],{cwd:root,stdio:['ignore','pipe','ignore']}):readFileSync(path.join(root,file));return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.woff2')?'font/woff2':'text/html'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const snap=async name=>{if(!name.includes('keyboard')&&!/\d+$/.test(name))await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,(baseline?'before-':'after-')+name+'.png'),fullPage:!name.startsWith('qr')&&!name.startsWith('live')});};
  const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
  await page.goto('https://tshow.test/projects');
  await page.waitForSelector('.project-card[data-project-id]');await page.waitForTimeout(400);
  await snap('projects');
  if(!baseline)for(const width of [360,375,390,414,430]){
   await page.setViewportSize({width,height:844});await page.waitForTimeout(100);await noOverflow();
   const boxes=await page.locator('.project-card[data-project-id]').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,x:r.x}}));
   boxes.slice(1).forEach((b,i)=>{assert(b.top>=boxes[i].bottom+15);assert.equal(b.x,boxes[0].x);});
   assert(!await page.locator('.carousel-next').isVisible());
  }
  if(!baseline)for(count of [0,1,7]){await page.evaluate(()=>WorkspaceShell.navigate('projects',true));assert.equal(await page.locator('.project-card[data-project-id]').count(),count);await noOverflow();}
  await page.goto('https://tshow.test/schedule?project=qa');await page.waitForSelector('#convocatoriaTime');await page.waitForTimeout(400);await snap('schedule');
  if(!baseline)for(const width of [360,375,390,414,430]){
   await page.setViewportSize({width,height:844});await noOverflow();
   for(const id of ['convocatoriaTime','convocatoriaDuration','doorsTime','doorsDuration','showStartMode','showStartTimeInput']){
    assert(await page.locator('#'+id).evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.segment-card').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.height>=44;}),'segment control '+id);
   }
  }
  if(!baseline){
   await page.locator('#convocatoriaTime').fill('17:45');await page.locator('#convocatoriaDuration').fill('35');await page.evaluate(()=>app.saveProject({silent:true}));
   assert.equal(saved.convocatoriaTime,'17:45');assert.equal(Number(saved.convocatoriaDuration),35);
   await page.locator('#convocatoriaDuration').blur();
   await page.waitForTimeout(600);
   if(await page.locator('.block-row-main').first().getAttribute('aria-expanded')!=='true')await page.locator('.block-row-main').first().press('Enter');
   await page.locator('.block-detail [data-field="title"]').fill('Nombre guardado desde móvil');
   await page.locator('.block-detail [data-save]').click();await page.waitForTimeout(300);assert(saved.blocks.some(b=>b.title==='Nombre guardado desde móvil'));
   await page.emulateMedia({reducedMotion:'reduce'});
   for(const width of [768,1024,1366]){
    await page.setViewportSize({width,height:900});
    for(const route of ['projects','schedule']){
     await page.evaluate(r=>WorkspaceShell.navigate(r,true),route);await page.waitForTimeout(300);
     const geometry=()=>[...document.querySelectorAll('.workspace-view.is-active .project-card,.workspace-view.is-active .segment-card,.workspace-view.is-active .project-selector-head')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
     const before=await page.evaluate(geometry);await page.evaluate(()=>document.querySelector('link[href="css/mobile-repairs.css"]').disabled=true);assert.deepEqual(await page.evaluate(geometry),before);await page.evaluate(()=>document.querySelector('link[href="css/mobile-repairs.css"]').disabled=false);
    }
   }
   await page.setViewportSize({width:390,height:844});
  }
  await page.goto('https://tshow.test/live?project=qa');await page.waitForFunction(()=>window.liveApp?.project);await page.waitForTimeout(400);await snap('live');
  if(!baseline)for(const width of [360,375,390,414,430]){
   await page.setViewportSize({width,height:844});await noOverflow();
   const boxes=await page.locator('.live-header').evaluate(n=>['.back-link','.event-identity','.header-meta','.header-actions','.live-theme-switcher'].map(s=>{const r=n.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
   boxes.slice(1).forEach((b,i)=>assert(b.top>=boxes[i].bottom+11,'header overlaps '+width));
   await page.evaluate(()=>liveApp.render());assert.equal(await page.locator('#primaryAction').innerText(),'Iniciar seguimiento');
   assert(!(await page.locator('.mobile-shell-bar').innerText()).includes('undefined'));
  }
  if(!baseline){
   for(const theme of ['light','nocturne','violet','cobalt','ember','emerald','monochrome']){await page.evaluate(t=>liveApp.applyLiveTheme(t,false),theme);await noOverflow();}
   for(const state of ['idle','live','paused']){await page.evaluate(s=>{liveApp.state.status=s;liveApp.render();},state);await noOverflow();}
   await page.evaluate(()=>{liveApp.state.status='idle';liveApp.applyLiveTheme('light',false);});
   await page.locator('#stageButton').click();assert(await page.locator('#stageDialog').evaluate(n=>n.open));await page.locator('#closeStage').click();
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>liveApp.openObserver());await page.waitForTimeout(500);await snap('qr');
  if(!baseline){
   assert(await page.locator('#closeObserver').evaluate(n=>n===document.activeElement));
   await page.locator('#observerLabel').fill('Equipo técnico prueba');await page.locator('#observerDays').selectOption('7');await page.locator('#observerCreate').click();
   await page.locator('#observerLabel').fill('Escritura durante generación');await page.waitForTimeout(350);
   assert.equal(await page.locator('#observerLabel').inputValue(),'Escritura durante generación');assert.equal(lastPass.label,'Equipo técnico prueba');assert.equal(lastPass.days,7);
   await page.locator('#observerLabel').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Nombre nuevo');assert.equal(await page.locator('#observerLabel').inputValue(),'Nombre nuevo');
   await page.setViewportSize({width:390,height:430});assert(await page.locator('#observerLabel').isVisible());await snap('qr-keyboard-height');
   await page.evaluate(()=>{liveApp.confirm=async()=>true;});const passCount=passes.length;await page.locator('[data-revoke-observer]').first().click();await page.waitForTimeout(300);assert.equal(passes.length,passCount-1);await page.locator('#closeObserver').click();
   for(const width of [768,1024,1366]){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
    // Compare rendered geometry with the phone-only stylesheet disabled.
    const geometry=()=>[...document.querySelectorAll('.live-header,.live-header>*,#observerDialog')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
    const before=await page.evaluate(geometry);await page.evaluate(()=>document.querySelector('link[href="css/mobile-repairs.css"]').disabled=true);assert.deepEqual(await page.evaluate(geometry),before);await page.evaluate(()=>document.querySelector('link[href="css/mobile-repairs.css"]').disabled=false);
    await snap('live-'+width);
   }
   assert.deepEqual(errors,[]);
  }
  console.log('PASS '+(baseline?'baseline captures':'mobile geometry, QR input and desktop isolation')+'; '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
