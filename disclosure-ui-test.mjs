// Local synthetic data only: exercise real mouse and touch event sequences.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright'),engine=engines[process.env.MOBILE_BROWSER || 'chromium'];
const directory=await mkdtemp(join(tmpdir(),'rucapture-disclosures-')),{env,database}=await createEnvironment(directory,'disclosure-test');
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?),('daily_summary_seen',?)").run(RELEASE.version,new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await engine.launch({headless:true});
  for(const width of [1440,390,320]){
    const mobile=width<900,context=await browser.newContext({viewport:{width,height:1000},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const activate=node=>mobile?node.tap():node.click();
    async function repeat(button,panel){
      for(let i=0;i<2;i++){
        await activate(button);assert.equal(await panel.isVisible(),true,`${width}px: first activation opens`);
        const rect=await panel.boundingBox();assert.ok(rect.x>=0 && rect.x+rect.width<=width+1,'panel stays within viewport');
        await activate(button);assert.equal(await panel.isVisible(),false,`${width}px: second activation closes`);
        if(await button.getAttribute('aria-expanded')!==null)assert.equal(await button.getAttribute('aria-expanded'),'false');
      }
    }
    async function picker(select){const wrap=select.locator('..');await repeat(wrap.locator('.select-trigger'),wrap.locator('.select-menu'));}
    await page.goto(origin);await page.locator('#password').fill('disclosure-test');await activate(page.locator('#login-form button[type=submit]'));await page.locator('#workspace').waitFor();await page.waitForFunction(()=>messageReady);
    if(await page.locator('#messages-dialog').isVisible())await activate(page.locator('#messages-read'));
    if(width===1440)await page.evaluate(async()=>{
      await api('/api/axes','POST',{title:'虚构复习计划'});
      for(const category of ['作业','课程'])await api('/api/tasks','POST',{category,title:`虚构${category}`,starts_at:'2099-10-15T08:00:00Z',ends_at:'2099-10-15T09:00:00Z',due_at:'2099-10-15T08:00:00Z'});
      await refresh();
    });
    await page.evaluate(()=>{categoryFilter='作业';render();});
    await picker(page.locator('.task-status'));await picker(page.locator('.card-axis-select'));
    // Switching menus, outside dismissal, and keyboard use must keep working.
    const status=page.locator('.task-status').locator('..'),axis=page.locator('.card-axis-select').locator('..');
    await activate(status.locator('.select-trigger'));await activate(axis.locator('.select-trigger'));
    assert.equal(await status.locator('.select-menu').isVisible(),false);assert.equal(await axis.locator('.select-menu').isVisible(),true);
    await activate(page.locator('#view-title'));assert.equal(await axis.locator('.select-menu').isVisible(),false);
    await status.locator('.select-trigger').focus();await page.keyboard.press('Enter');assert.equal(await status.locator('.select-menu').isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await status.locator('.select-menu').isVisible(),false);
    await page.keyboard.press('ArrowDown');assert.equal(await status.locator('.select-menu').isVisible(),true);await activate(status.locator('.select-trigger'));assert.equal(await status.locator('.select-menu').isVisible(),false);
    await page.evaluate(()=>openTask(tasks.find(t=>t.category==='作业')));
    for(const id of ['status','task-axis'])await picker(page.locator('#'+id));
    await activate(page.locator('#task-dialog .close-dialog').first());
    await page.evaluate(()=>{categoryFilter='课程';render();});
    const courseFilters=await page.locator('#board .custom-select-native').all();assert.ok(courseFilters.length>=2);
    for(const node of courseFilters)await picker(node);
    await page.evaluate(()=>{categoryFilter='全部';overviewView='calendar';render();});
    await repeat(page.locator('#add-task'),page.locator('#add-menu'));
    await repeat(page.locator('.calendar-filter>summary'),page.locator('.calendar-filter-menu'));
    await activate(page.locator('[data-view=axes]'));await repeat(page.locator('.axis-help>summary'),page.locator('.axis-help>p'));
    if(mobile){await activate(page.locator('#mobile-nav-toggle'));await activate(page.locator('#mobile-nav-toggle'));assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'),'false');await activate(page.locator('#mobile-nav-toggle'));}
    else{for(let i=0;i<2;i++)await activate(page.locator('#sidebar-toggle'));assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');}
    await repeat(page.locator('#user-menu-toggle'),page.locator('#user-menu'));
    if(mobile)await activate(page.locator('#mobile-nav-toggle'));
    await page.evaluate(()=>{$('sources-dialog').showModal();setSyncStep(1);});
    await repeat(page.locator('.extension-update>summary'),page.locator('.extension-update>ol'));
    await page.evaluate(()=>setSyncStep(3));await repeat(page.locator('.supported-sites>summary'),page.locator('.supported-sites>p'));
    await activate(page.locator('#sources-dialog .close-dialog').first());
    await page.evaluate(()=>{renderMessages(true);$('messages-dialog').showModal();});
    await repeat(page.locator('.release-more'),page.locator('.release-history'));
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log(`PASS (${engine.name()}): repeated open/close for board/editor/course selects, add menu, calendar filter, account menu, navigation, source help and release history; mouse and touch at 320/390/1440px, switching/outside/Escape/keyboard.`);
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
