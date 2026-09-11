// Browser fixtures intercept every request: never use production accounts or content.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), output=path.join(require('node:os').tmpdir(),'tshow-overview-qa');
mkdirSync(output,{recursive:true});
const project={id:'qa',eventName:'Show de aniversario · Producción y escenario principal',eventDate:'2026-09-11',location:'Antofagasta',projectType:'concert',visualTheme:'emerald',permission:'owner',convocatoriaTime:'18:30',convocatoriaDuration:30,doorsTime:'20:00',doorsDuration:60,showStartMode:'fixed',showStartTimeInput:'21:00',blocks:Array.from({length:17},(_,i)=>({id:'b'+i,type:i%2?'ANIMACIÓN':'SHOW',title:'Presentación del bloque '+(i+1),duration:20,bis:i===0?10:0,animator_script:i%2?'':'Guion de bienvenida',notes:'Confirmar micrófonos'}))};
const authStub=`window.Auth={requireSession:async()=>({id:'qa-user'}),currentUser:async()=>({id:'qa-user'}),getProfile:async()=>({id:'qa-user',first_name:'Equipo',last_name:'Producción',role:'account_owner'}),token:async()=>'qa',api:async(p,o)=>{const r=await fetch(p,o);const b=await r.json();if(!r.ok){const e=Error(b.message);e.code=b.code;throw e;}return b;},logout:async()=>{}};`;
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext();const errors=[];
    await context.addInitScript(()=>localStorage.setItem('tshow_onboarding_v1:qa-user','done'));
    let liveStatus='idle',failTeam=false;
    await context.route('**/*',route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(url.hostname!=='tshow.test')return route.fulfill({body:''});
      if(p==='/js/auth.js')return route.fulfill({contentType:'application/javascript',body:authStub});
      if(p==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:'window.SHOWTIME_API_URL=location.origin;'});
      if(p.startsWith('/api/')){
        if(p==='/api/projects')return route.fulfill({json:{data:[{id:project.id,event_name:project.eventName,payload:project,member_role:'owner'}],meta:{ownedCount:1,limit:20,remaining:19}}});
        if(p==='/api/projects/qa')return route.fulfill({json:{data:{id:'qa',event_name:project.eventName,payload:project,permission:project.permission}}});
        if(p.endsWith('/live'))return route.fulfill({json:{data:{status:liveStatus},version:0,serverNow:'2026-09-12T00:05:00Z'}});
        if(p.endsWith('/members'))return route.fulfill(failTeam?{status:503,json:{message:'test failure'}}:{json:{data:[{role:'owner',profiles:{id:'qa-user',first_name:'Equipo',last_name:'Producción',email:'qa@example.invalid'}}]}});
        if(p.endsWith('/notes'))return route.fulfill({json:{data:project.blocks}});
        return route.fulfill({json:{data:[]}});
      }
      const asset=path.join(root,'frontend',p==='/'||!path.extname(p)?'app.html':p);
      try {return route.fulfill({body:readFileSync(asset),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.png')?'image/png':p.endsWith('.webp')?'image/webp':'text/html'});}
      catch{return route.fulfill({status:404,body:''});}
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://tshow.test/summary?project=qa');
    await page.waitForFunction(()=>document.querySelector('#overviewLive')?.textContent.includes('En espera'));
    for(const [w,h] of [[390,844],[768,1024],[1366,900],[1920,1080]]){
      await page.setViewportSize({width:w,height:h});
      await page.waitForTimeout(350);
      if(w===390) assert.equal(await page.locator('.workspace-shell').evaluate(n=>Math.round(n.getBoundingClientRect().width)),390);
      await page.screenshot({path:path.join(output,'summary-'+w+'.png'),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'summary overflow '+w);
    }
    await page.evaluate(()=>WorkspaceShell.navigate('notes',true));
    await page.waitForFunction(()=>!document.querySelector('#view-summary').classList.contains('is-leaving'));
    await page.setViewportSize({width:1366,height:900});
    const rects=await page.locator('#view-notes .shell-page-head').evaluate(h=>[...h.querySelectorAll('.shell-eyebrow,h1,p')].map(x=>({y:x.getBoundingClientRect().y,b:x.getBoundingClientRect().bottom})));
    assert(rects[0].b<=rects[1].y && rects[1].b<=rects[2].y,'heading vertical order');
    await page.screenshot({path:path.join(output,'notes.png'),fullPage:true});
    await page.evaluate(()=>WorkspaceShell.navigate('schedule',true));
    await page.waitForFunction(()=>!document.querySelector('#view-notes').classList.contains('is-leaving'));
    await page.screenshot({path:path.join(output,'schedule.png'),fullPage:true});
    await page.evaluate(()=>{window.print=()=>{};PrintExportManager.triggerPrint();});
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#printRoot .timing-table td').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)');
    await page.pdf({path:path.join(output,'schedule.pdf'),preferCSSPageSize:true,printBackground:true});
    await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({media:'screen'});
    await page.evaluate(()=>{document.getElementById('eventName').value='Edición local pendiente';window.app.calculateTiming();});
    await page.evaluate(()=>WorkspaceShell.navigate('summary',true));
    await page.waitForFunction(()=>document.getElementById('overviewTitle').textContent==='Edición local pendiente');
    liveStatus='paused';failTeam=true;
    await page.evaluate(()=>WorkspaceShell.navigate('summary',true));
    await page.waitForFunction(()=>document.getElementById('overviewTeam').textContent.includes('no disponible'));
    assert.match(await page.locator('#overviewLive').innerText(),/Pausado/);
    for(const [status,label] of [['live','En vivo'],['finished','Finalizado']]){
      liveStatus=status;await page.evaluate(()=>WorkspaceShell.navigate('summary',true));
      assert.match(await page.locator('#overviewLive').innerText(),new RegExp(label));
    }
    await page.evaluate(()=>{document.body.style.zoom='2';});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'zoom overflow');
    await page.evaluate(()=>{document.body.style.zoom='1';});
    for(const theme of ['nocturne','violet','cobalt','ember','emerald','monochrome']){
      await page.evaluate(t=>document.body.dataset.visualTheme=t,theme);
      assert.match(await page.locator('#overviewTitle').evaluate(n=>getComputedStyle(n).fontFamily),/IBM Plex/);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: responsive overview, heading order, unsaved edits, independent failures, six themes. Screenshots: '+output);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
