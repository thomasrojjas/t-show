const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const http=require('node:http');
const root=path.resolve(__dirname,'../../frontend');
const sdk=`window.supabase={createClient:()=>({auth:{
 getSession:async()=>({data:{session:sessionStorage.getItem('qa-auth')?{access_token:'qa'}:null}}),
 getUser:async()=>({data:{user:sessionStorage.getItem('qa-auth')?{id:'qa'}:null}}),
 signInWithPassword:async()=>{sessionStorage.setItem('qa-auth','yes');return {data:{user:{id:'qa'}}};},
 signOut:async()=>{sessionStorage.removeItem('qa-auth');return {};},
 resetPasswordForEmail:async()=>({}),
 signUp:async()=>({data:{session:null}})
}})};`;
(async()=>{
 const server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost');
   if(['/invite.html','/login.html','/register.html'].includes(url.pathname)){res.writeHead(308,{Location:url.pathname.replace('.html','')+url.search});res.end();return;}
   const file=['/invite','/login','/register'].includes(url.pathname)?url.pathname+'.html':url.pathname;
   try{res.setHeader('Content-Type','text/html');res.end(readFileSync(path.join(root,file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();let mode='INVITATION_EMAIL_MISMATCH',accepts=0,profileSaves=0,cleanUrls=true;
  const reads=[];
  await context.route('**/*',route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({body:sdk,contentType:'application/javascript'});
   if(url.origin!==origin)return route.fulfill({body:''});
   if(cleanUrls && ['/invite.html','/login.html','/register.html'].includes(p))return route.continue();
   if(p==='/js/config.js')return route.fulfill({body:'window.SHOWTIME_API_URL=location.origin;',contentType:'application/javascript'});
   if(p==='/api/config')return route.fulfill({json:{supabaseUrl:'https://unused.invalid',supabaseAnonKey:'qa'}});
   if(p==='/api/profile'){profileSaves++;mode='ok';return route.fulfill({json:{success:true}});}
   if(p.endsWith('/accept')){
    accepts++;
    return route.fulfill(mode==='ok'?{json:{success:true,projectId:'shared',role:'viewer'}}:{status:403,json:{code:mode,message:mode==='PROFILE_NOT_FOUND'?'Completa tu perfil.':'Inicia sesión con el correo invitado.'}});
   }
   if(p==='/api/invitations/invalid')return route.fulfill({status:404,json:{message:'El enlace de invitación no existe.'}});
   if(p.startsWith('/api/invitations/'))return new Promise(resolve=>setTimeout(resolve,200)).then(()=>route.fulfill({json:{data:{email:'qa@example.invalid',project_name:'<img src=x onerror=alert(1)>',role:'viewer'}}}));
   if(p.startsWith('/api/projects')){reads.push(p);return route.fulfill({json:{data:[]}});}
   if(p==='/summary'||p==='/projects')return route.fulfill({body:'<h1>Destino autenticado</h1>',contentType:'text/html'});
   const asset=['/invite','/login','/register'].includes(p)?p+'.html':p;
   try{return route.fulfill({body:readFileSync(path.join(root,asset)),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'});}
   catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/invite');
  assert.match(await page.locator('#inviteMessage').innerText(),/incompleto/);
  assert.equal(await page.locator('#inviteActions').isVisible(),false,'missing token hides actions');
  await page.goto(origin+'/invite?token=invalid');
  await page.waitForFunction(()=>document.getElementById('inviteMessage').textContent.includes('no existe'));
  assert.equal(await page.locator('#inviteActions').isVisible(),false,'invalid token hides actions');
  for(const route of ['/invite?token=clean','/invite?invite=legacy','/invite.html?token=html']){
    cleanUrls=false;
    await page.goto(origin+route);
    await page.waitForSelector('#inviteActions:not([hidden])');
    assert.equal(await page.locator('#inviteActions').isVisible(),true);
  }
  await page.evaluate(()=>sessionStorage.clear());
  cleanUrls=true;
  await page.goto(origin+'/invite.html?token=test');
  assert.equal(new URL(page.url()).pathname,'/invite','production strips html extension');
  await page.waitForSelector('#inviteActions:not([hidden])');
  assert.equal(await page.locator('#inviteDetails img').count(),0,'event content must be text');
  await page.locator('#existingAccount').click();
  await page.locator('#email').fill('qa@example.invalid');await page.locator('#password').fill('example123');
  await page.locator('#loginBtn').click();
  await page.waitForSelector('#acceptRecovery');
  assert.equal(accepts,1);
  assert.equal(await page.locator('#loginBtn').isEnabled(),true);
  mode='ok';await page.getByRole('button',{name:'Reintentar aceptación'}).click();
  await page.waitForURL('**/summary?project=shared');
  assert(reads.includes('/api/projects/shared')&&reads.includes('/api/projects'),'refresh project and directory');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('tshow_pending_invite')),null);
  mode='PROFILE_NOT_FOUND';
  await page.goto(origin+'/login.html?invite=profile-test');
  await page.waitForSelector('#acceptRecovery form');
  for(const [name,value] of [['firstName','Prueba'],['lastName','Usuario'],['rut','98765432-5'],['phone','+56911111111']])await page.locator('#acceptRecovery [name='+name+']').fill(value);
  await page.getByRole('button',{name:'Completar perfil y continuar'}).click();
  await page.waitForURL('**/summary?project=shared');assert.equal(profileSaves,1);
  // Confirmation in the same tab recovers the pending context without a query.
  await page.evaluate(()=>sessionStorage.setItem('tshow_pending_invite','confirmation-test'));
  await page.goto(origin+'/login.html');await page.waitForURL('**/summary?project=shared');
  assert.deepEqual(errors,[]);
  console.log('PASS: safe invitation text, login failure recovery, retry, refreshed projects, profile completion, confirmation context.');
 } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
