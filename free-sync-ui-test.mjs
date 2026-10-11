import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=await mkdtemp(join(tmpdir(),'rucapture-free-sync-'));
const {env,database}=await createEnvironment(directory,'sync-fixture');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
database.prepare("INSERT INTO settings(key,value) VALUES ('daily_summary_seen',?)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true}),errors=[];
try{
  const pages=[];
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:950},isMobile:width===390,hasTouch:width===390});
    await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.stack));
    await page.goto(origin);await page.locator('#password').fill('sync-fixture');
    assert.equal(await page.locator('.launch-contact').getAttribute('href'),'https://xhslink.cn/o/5JLJ8hb11TH');
    await page.locator('#login-form button[type=submit]').click();await page.waitForFunction(()=>messageReady);
    if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-dialog .close-dialog').click();
    pages.push(page);
  }
  const [desktop,phone]=pages;
  const task=await desktop.evaluate(async()=>api('/api/tasks','POST',{category:'记录',title:'电脑写下的记录',starts_at:new Date().toISOString(),content:'同一条记录，两个设备。'}));
  await phone.evaluate(()=>refresh({poll:true}));assert.ok(await phone.evaluate(()=>tasks.some(x=>x.title==='电脑写下的记录')));
  await phone.evaluate(async task=>{await api('/api/tasks/'+task.id,'PATCH',{revision:task.revision,title:'手机补充的记录'});},task);
  await desktop.evaluate(()=>refresh({poll:true}));assert.ok(await desktop.evaluate(()=>tasks.some(x=>x.title==='手机补充的记录')));
  const idle=await desktop.evaluate(async()=>api('/api/sync?revision='+syncRevision));assert.equal(idle.unchanged,true);assert.equal(idle.tasks,undefined);
  await desktop.evaluate(()=>{categoryFilter='记录';render();});
  await mkdir('data/screenshots',{recursive:true});
  await desktop.screenshot({path:'data/screenshots/free-records-lights-on.png',fullPage:true});
  await desktop.locator('#user-menu-toggle').click();await desktop.locator('#effects-toggle').click();
  await desktop.waitForFunction(()=>!effectsSaving && document.documentElement.dataset.effects==='off');await desktop.waitForTimeout(700);
  assert.equal(await desktop.locator('.workspace-scene').evaluate(el=>getComputedStyle(el).display),'none');
  await desktop.screenshot({path:'data/screenshots/free-lights-menu-off.png',fullPage:true});
  await phone.evaluate(()=>refresh({poll:true}));assert.equal(await phone.locator('html').getAttribute('data-effects'),'off');
  // The quiet view remains the same app: edits survive and can sync back to a lit view.
  await phone.evaluate(async()=>{const record=tasks.find(x=>x.category==='记录');await api('/api/tasks/'+record.id,'PATCH',{revision:record.revision,content:'关灯后继续编辑'});});
  await desktop.locator('#effects-toggle').click();await desktop.waitForFunction(()=>!effectsSaving);
  await desktop.evaluate(()=>refresh());assert.ok(await desktop.evaluate(()=>tasks.some(x=>x.content==='关灯后继续编辑')));
  await desktop.locator('#user-menu-toggle').click();
  for(const width of [390,320]){
    await phone.setViewportSize({width,height:844});await phone.evaluate(()=>{applyEffects(true);categoryFilter='记录';render();});
    assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`record overflow ${width}`);
    await phone.screenshot({path:`data/screenshots/free-records-${width}.png`,fullPage:true});
    await phone.evaluate(()=>showLogin());
    assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`login overflow ${width}`);
    const contact=await phone.locator('.launch-contact').boundingBox(),cta=await phone.locator('.launch-signin').boundingBox();
    assert.ok(contact.x+contact.width<=cta.x+1);assert.ok(cta.x+cta.width<=width);
    await phone.screenshot({path:`data/screenshots/free-contact-${width}.png`});
    await phone.reload();await phone.waitForFunction(()=>messageReady);if(await phone.locator('#messages-dialog').isVisible())await phone.locator('#messages-dialog .close-dialog').click();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile shared edits, unchanged lightweight snapshots, persisted light switch, functional quiet view, contact placement and 320/390 px layouts. Isolated data only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));database.close();await rm(directory,{recursive:true,force:true});}
