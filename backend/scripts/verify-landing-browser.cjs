const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../frontend'),output=path.join(require('node:os').tmpdir(),'tshow-landing-qa');
mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='landing.test')return route.fulfill({body:''});
   try{return route.fulfill({body:readFileSync(path.join(root,url.pathname==='/'?'index.html':url.pathname)),contentType:url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.webp')?'image/webp':url.pathname.endsWith('.woff2')?'font/woff2':'text/html'});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://landing.test/');
  for(const width of [390,404,1366]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(350);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);
   await page.screenshot({path:path.join(output,'landing-'+width+'.png'),fullPage:true});
  }
  assert(!/Ticketera|Tickera/.test(await page.locator('body').innerText()));
  assert.equal(await page.locator('a[href*="ticketera.ar"]').count(),0);
  for(const image of await page.locator('img[src]').all()){await image.scrollIntoViewIfNeeded();assert(await image.evaluate(n=>n.complete&&n.naturalWidth>0),'image failed');}
  const button=page.locator('.screenshot-open').first();await button.focus();await page.keyboard.press('Enter');
  assert(await page.locator('#screenshotDialog').isVisible());await page.keyboard.press('Escape');
  assert(!await page.locator('#screenshotDialog').isVisible());assert(await button.evaluate(n=>document.activeElement===n));
  await page.evaluate(()=>document.body.style.zoom='2');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'zoom overflow');
  assert.deepEqual(errors,[]);console.log('PASS landing responsive, assets, naming, keyboard dialog and zoom: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
