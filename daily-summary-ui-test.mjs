import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=await mkdtemp(join(tmpdir(),'rucapture-daily-'));
const {env,database}=await createEnvironment(directory,'summary-fixture');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true}),errors=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:950},timezoneId:'America/New_York'});
  await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.stack));
  await page.goto(origin);await page.locator('#password').fill('summary-fixture');await page.locator('#login-form button[type=submit]').click();
  await page.locator('#daily-summary-dialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.daily-summary-quote'));
  assert.equal(await page.locator('#daily-summary-title').textContent(),'昨日总结');
  assert.equal(await page.locator('.daily-summary-total strong').textContent(),'0');
  assert.equal(await page.evaluate(()=>DAILY_ENCOURAGEMENTS.length),50);
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  await page.waitForFunction(async()=> (await api('/api/sync')).summary_seen_date===localInput(new Date().toISOString()).slice(0,10));
  await page.locator('#daily-summary-dialog .primary').click();
  await page.reload();await page.waitForFunction(()=>messageReady);await page.waitForTimeout(200);
  assert.equal(await page.locator('#daily-summary-dialog').isVisible(),false,'same-day reload does not show it again');
  const record=await page.evaluate(async()=>api('/api/tasks','POST',{category:'记录',title:'把一段绕了很久的证明终于理清楚了，也给未来的自己留下了一页笔记',content:'只在卡片中保存',starts_at:new Date().toISOString(),status:'done'}));
  const open=async()=>{await page.locator('#user-menu-toggle').click();await page.locator('#daily-summary-button').click();await page.waitForFunction(()=>document.querySelector('.daily-summary-quote'));};
  await open();assert.equal(await page.locator('#daily-summary-title').textContent(),'今日总结');assert.equal(await page.locator('.daily-summary-total strong').textContent(),'1');assert.match(await page.locator('.daily-summary-total').textContent(),/条记录已完善/);
  const quote=await page.locator('.daily-summary-quote').textContent();
  assert.match(await page.locator('#daily-summary-date').textContent(),new RegExp(today.replaceAll('-',' / ')));
  await page.waitForTimeout(300);await mkdir('data/screenshots',{recursive:true});await page.screenshot({path:'data/screenshots/daily-summary-desktop.png'});
  await page.locator('#daily-summary-dialog .primary').click();await open();assert.notEqual(await page.locator('.daily-summary-quote').textContent(),quote);
  await page.locator('#daily-summary-dialog .primary').click();await page.locator('#user-menu-toggle').click();
  await page.waitForFunction(()=>document.getElementById('user-menu').matches(':popover-open'));await page.waitForTimeout(300);
  const labels=await page.evaluate(()=>['effects-toggle','daily-summary-button','messages-button'].map(id=>{const node=document.getElementById(id);return {icon:node.querySelector('.nav-icon').getBoundingClientRect().x,label:node.querySelector('span').getBoundingClientRect().x};}));
  assert.ok(labels[0].icon>0);assert.ok(labels.every(x=>Math.abs(x.label-labels[0].label)<1 && Math.abs(x.icon-labels[0].icon)<1),'menu icons and labels align');
  await page.screenshot({path:'data/screenshots/daily-summary-menu.png'});await page.locator('#user-menu-toggle').click();
  // Same account on a second device does not repeat yesterday; current summaries still work.
  const phoneContext=await browser.newContext({viewport:{width:320,height:720},isMobile:true,hasTouch:true,storageState:await context.storageState()});
  const phone=await phoneContext.newPage();phone.on('pageerror',error=>errors.push(error.stack));await phone.goto(origin);await phone.waitForFunction(()=>messageReady);
  assert.equal(await phone.locator('#daily-summary-dialog').isVisible(),false);
  await phone.locator('#user-menu-toggle').click();await phone.locator('#daily-summary-button').click();await phone.waitForFunction(()=>document.querySelector('.daily-summary-quote'));
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('#daily-summary-dialog').scrollWidth<=document.querySelector('#daily-summary-dialog').clientWidth));
  await phone.waitForTimeout(300);await phone.screenshot({path:'data/screenshots/daily-summary-mobile.png'});
  await phone.evaluate(()=>applyEffects(false));assert.equal(await phone.locator('.daily-summary-total strong').textContent(),'1');await phone.locator('#daily-summary-dialog .primary').click();
  // A midnight rollover waits for an open editor; it does not steal focus or clear a draft.
  database.prepare("UPDATE settings SET value='1900-01-01' WHERE key='daily_summary_seen'").run();
  await page.evaluate(()=>{dailyAutoAttempted='';document.getElementById('task-dialog').showModal();document.getElementById('task-title').value='还没写完';});
  await page.evaluate(()=>refresh());assert.equal(await page.locator('#daily-summary-dialog').isVisible(),false);assert.equal(await page.locator('#task-title').inputValue(),'还没写完');
  await page.evaluate(()=>document.getElementById('task-dialog').close());await page.locator('#daily-summary-dialog').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('.daily-summary-quote'));await page.locator('#daily-summary-dialog .primary').click();
  // A failed summary request has retry feedback and must not mark the day as read.
  database.prepare("DELETE FROM settings WHERE key='daily_summary_seen'").run();
  await page.route('**/api/daily-summary?period=yesterday',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'稍后再试'})}));
  await page.reload();await page.locator('#daily-summary-retry').waitFor({state:'visible'});assert.equal(database.prepare("SELECT value FROM settings WHERE key='daily_summary_seen'").get(),undefined);
  await page.unroute('**/api/daily-summary?period=yesterday');await page.locator('#daily-summary-retry').click();await page.waitForFunction(()=>document.querySelector('.daily-summary-quote'));await page.locator('#daily-summary-dialog .primary').click();
  assert.deepEqual(await page.locator('.collect-origins>span').allTextContents(),['作 作业网站','课 在线课堂','学 课程平台']);
  assert.doesNotMatch(await page.locator('#sources-dialog').textContent(),/SmartEstu|微人大|数你最灵/);
  assert.deepEqual(await page.evaluate(()=>[websiteName({source:'smartestu'}),websiteName({source:'ruc_courses'}),websiteName({id:'ruc_exams'}),websiteName({generic:true})]),['作业网站','课表与考试网页','考试安排网页','网站页面']);
  assert.deepEqual(errors,[]);console.log('PASS: automatic yesterday summary, daily/account gate, fresh non-repeating encouragement, today completion, aligned menu, 320px layout, quiet mode, draft deferral and retry.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));database.close();await rm(directory,{recursive:true,force:true});}
