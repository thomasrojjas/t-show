const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
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
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();let mode='INVITATION_EMAIL_MISMATCH',accepts=0,profileSaves=0;
  const reads=[];
  await context.route('**/*',route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({body:sdk,contentType:'application/javascript'});
   if(url.hostname!=='tshow.test')return route.fulfill({body:''});
   if(p==='/js/config.js')return route.fulfill({body:'window.SHOWTIME_API_URL=location.origin;',contentType:'application/javascript'});
   if(p==='/api/config')return route.fulfill({json:{supabaseUrl:'https://unused.invalid',supabaseAnonKey:'qa'}});
   if(p==='/api/profile'){profileSaves++;mode='ok';return route.fulfill({json:{success:true}});}
   if(p.endsWith('/accept')){
    accepts++;
    return route.fulfill(mode==='ok'?{json:{success:true,projectId:'shared',role:'viewer'}}:{status:403,json:{code:mode,message:mode==='PROFILE_NOT_FOUND'?'Completa tu perfil.':'Inicia sesión con el correo invitado.'}});
   }
   if(p.startsWith('/api/invitations/'))return route.fulfill({json:{data:{email:'qa@example.invalid',project_name:'<img src=x onerror=alert(1)>',role:'viewer'}}});
   if(p.startsWith('/api/projects')){reads.push(p);return route.fulfill({json:{data:[]}});}
   if(p==='/summary'||p==='/projects')return route.fulfill({body:'<h1>Destino autenticado</h1>',contentType:'text/html'});
   try{return route.fulfill({body:readFileSync(path.join(root,p)),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'});}
   catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://tshow.test/invite.html?token=test');
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
  await page.goto('https://tshow.test/login.html?invite=profile-test');
  await page.waitForSelector('#acceptRecovery form');
  for(const [name,value] of [['firstName','Prueba'],['lastName','Usuario'],['rut','98765432-5'],['phone','+56911111111']])await page.locator('#acceptRecovery [name='+name+']').fill(value);
  await page.getByRole('button',{name:'Completar perfil y continuar'}).click();
  await page.waitForURL('**/summary?project=shared');assert.equal(profileSaves,1);
  // Confirmation in the same tab recovers the pending context without a query.
  await page.evaluate(()=>sessionStorage.setItem('tshow_pending_invite','confirmation-test'));
  await page.goto('https://tshow.test/login.html');await page.waitForURL('**/summary?project=shared');
  assert.deepEqual(errors,[]);
  console.log('PASS: safe invitation text, login failure recovery, retry, refreshed projects, profile completion, confirmation context.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
