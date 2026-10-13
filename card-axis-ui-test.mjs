// Isolated synthetic data; this test never contacts a live account.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright'),engine=engines[process.env.MOBILE_BROWSER || 'chromium'];
const root=resolve(tmpdir()),directory=await mkdtemp(join(root,'rucapture-card-axis-'));
const {env,database}=await createEnvironment(directory,'card-axis-test');
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?),('daily_summary_seen',?)").run(RELEASE.version,new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const baseline=new Map();if(process.env.CARD_AXIS_BASELINE)for(const name of ['app.js','capture.js','style.css'])baseline.set('/static/'+name,execFileSync('git',['show','HEAD:static/'+name]));
const server=createServer(async(req,res)=>{
 if(baseline.has(req.url)){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':'text/css'});res.end(baseline.get(req.url));return;}
 const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await page.locator('#password').fill('card-axis-test');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>messageReady);
 if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
 const fixture=await page.evaluate(async()=>{
  const a=await api('/api/axes','POST',{title:'学习计划'}),b=await api('/api/axes','POST',{title:'我的摄影练习与漫长的探索之旅 · 这是完整的轴线标题'}),items=[];
  for(const category of ['作业','考试','活动','会议','记录','课程'])items.push(await api('/api/tasks','POST',{category,title:`虚构${category}`,content:'归属变化时保留这段内容',status:category==='记录'?'done':'todo',due_at:'2099-10-15T08:00:00Z',starts_at:'2099-10-15T08:00:00Z',ends_at:'2099-10-15T09:00:00Z',todos:[{id:'one',text:'这条待办也要保留',done:false}],axis_id:category==='记录'?a.id:null}));
  await refresh();return {a,b,items};
 });
 const task=fixture.items[0],card=()=>page.locator(`article[data-task-id="${task.id}"]`),picker=()=>card().locator('.card-axis-select').locator('..');
 const row=id=>database.prepare('SELECT title,content,status,todos,due_at,starts_at,ends_at,axis_id FROM tasks WHERE id=?').get(id);
 const before=row(task.id);const {axis_id:unused,...untouched}=before;
 async function category(name){await page.evaluate(name=>{categoryFilter=name;render();},name);}
 async function choose(title){await picker().locator('.select-trigger').tap();await picker().getByRole('option',{name:title,exact:true}).tap();await page.waitForFunction(()=>!document.getElementById('board').dataset.busy);}
 await category('作业');assert.equal(await card().locator('.card-axis-select').count(),1,'non-course board cards need an axis selector');
 assert.equal(await picker().locator('.select-value').textContent(),'所属轴线');
 await choose(fixture.a.title);assert.equal(row(task.id).axis_id,fixture.a.id);
 // No other card fields change when an axis is chosen.
 assert.deepEqual((({axis_id,...rest})=>rest)(row(task.id)),untouched);
 await choose(fixture.b.title);assert.equal(row(task.id).axis_id,fixture.b.id);
 await choose('暂不加入轴线');assert.equal(row(task.id).axis_id,null);await choose(fixture.a.title);
 // Failure restores the original selection; a stale revision cannot overwrite new data.
 await page.route(`**/api/tasks/${task.id}`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟网络暂不可用'})}));
 await choose(fixture.b.title);assert.equal(row(task.id).axis_id,fixture.a.id);assert.equal(await card().locator('.card-axis-select').inputValue(),fixture.a.id);await page.unroute(`**/api/tasks/${task.id}`);
 await page.evaluate(async id=>{const t=tasks.find(t=>t.id===id);await api(`/api/tasks/${id}`,'PATCH',{content:'另一设备刚保存的内容',revision:t.revision});},task.id);
 await choose(fixture.b.title);assert.equal(row(task.id).axis_id,fixture.a.id);assert.equal(row(task.id).content,'另一设备刚保存的内容');
 await page.waitForFunction(id=>tasks.find(t=>t.id===id).content==='另一设备刚保存的内容',task.id);await choose(fixture.b.title);assert.equal(row(task.id).axis_id,fixture.b.id);
 // Pending writes prevent overlapping edits without dimming the rest of the board.
 let held;await page.route(`**/api/tasks/${task.id}`,route=>{held=route;});
 await picker().locator('.select-trigger').tap();await picker().getByRole('option',{name:fixture.a.title,exact:true}).tap();
 await page.waitForFunction(()=>document.getElementById('board').dataset.busy);assert.equal(await card().locator('.task-status').isDisabled(),true);
 assert.equal(await page.locator('#board').evaluate(el=>getComputedStyle(el).opacity),'1');await held.continue();await page.unroute(`**/api/tasks/${task.id}`);await page.waitForFunction(()=>!document.getElementById('board').dataset.busy);
 // Creating/cancelling an axis returns to this card. A background render must be safe.
 async function openCreate(){await picker().locator('.select-trigger').tap();await picker().locator('.select-create-axis').tap();await page.locator('#new-axis-dialog').waitFor();}
 await openCreate();await page.locator('#new-axis-dialog').getByRole('button',{name:'取消',exact:true}).tap();assert.equal(row(task.id).axis_id,fixture.a.id);
 await openCreate();await page.locator('#new-axis-title').fill('从看板创建的轴线');await page.evaluate(()=>render());await page.locator('#new-axis-save').tap();await page.locator('#new-axis-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.getElementById('board').dataset.busy);
 const created=database.prepare('SELECT id FROM axes WHERE title=?').get('从看板创建的轴线');assert.equal(row(task.id).axis_id,created.id);
 // Existing editor creation still changes only the unsaved draft.
 await card().getByRole('button',{name:`编辑：${task.title}`,exact:true}).tap();await page.locator('#task-title').fill('尚未保存的标题');
 await page.locator('#task-axis').locator('..').locator('.select-trigger').tap();await page.locator('#task-axis').locator('..').locator('.select-create-axis').tap();
 await page.locator('#new-axis-title').fill('编辑器中创建的轴线');await page.locator('#new-axis-save').tap();await page.locator('#new-axis-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#task-title').inputValue(),'尚未保存的标题');assert.equal(row(task.id).axis_id,created.id);assert.equal(await page.locator('#task-axis option:checked').textContent(),'编辑器中创建的轴线');await page.locator('#task-dialog .close-dialog').first().tap();
 // Five categories and the calendar share the same control; courses stay unchanged.
 for(const item of fixture.items.filter(t=>t.category!=='课程')){
  await category(item.category);const node=page.locator(`article[data-task-id="${item.id}"]`);assert.equal(await node.locator('.card-axis-select').count(),1);
  if(item.category==='记录')assert.equal(await node.locator('.task-status').isChecked(),true);
  const oldState=row(item.id).status,axisPicker=node.locator('.card-axis-select').locator('..');await axisPicker.locator('.select-trigger').tap();await axisPicker.getByRole('option',{name:fixture.b.title,exact:true}).tap();await page.waitForFunction(()=>!document.getElementById('board').dataset.busy);assert.equal(row(item.id).axis_id,fixture.b.id);assert.equal(row(item.id).status,oldState);
  for(const width of [320,390,768,1024,1440]){
   await page.setViewportSize({width,height:1000});
   const aligned=await node.evaluate(el=>{const controls=el.querySelector('.card-state-controls'),parts=[...controls.children].map(n=>n.getBoundingClientRect()),actions=el.querySelector('.task-actions').getBoundingClientRect(),r=controls.getBoundingClientRect();return parts.length===2 && parts[0].right<=parts[1].left && Math.abs((parts[0].top+parts[0].bottom-parts[1].top-parts[1].bottom)/2)<2 && parts[1].right<=el.getBoundingClientRect().right && (actions.left>=r.right || actions.top>=r.bottom) && el.querySelector(".task-footer").scrollWidth<=el.querySelector(".task-footer").clientWidth;});
   if(!aligned){await mkdir('data/screenshots',{recursive:true});await page.screenshot({path:'data/screenshots/card-axis-layout-failure.png',fullPage:true});console.log(await node.evaluate(el=>({scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,overflow:[...el.querySelectorAll('*')].filter(n=>n.scrollWidth>n.clientWidth).map(n=>({tag:n.tagName,cls:n.className,width:n.clientWidth,scroll:n.scrollWidth,overflow:getComputedStyle(n).overflow,rect:n.getBoundingClientRect().toJSON()})),parts:[...el.querySelector('.card-state-controls').children].map(n=>n.getBoundingClientRect().toJSON()),rects:Object.fromEntries(['.task-footer','.task-footer-main','.card-state-controls','.task-actions','.card-state-controls .custom-select'].map(selector=>[selector,el.querySelector(selector)?.getBoundingClientRect().toJSON()]))})));}
   assert.equal(aligned,true,`${item.category}: controls align at ${width}px`);
  }
 }
 await page.evaluate(()=>{categoryFilter='全部';overviewView='calendar';selectedDay='2099-10-15';calendarMonth='2099-10';render();});
 assert.equal(await page.locator('.day-agenda .card-axis-select').count(),5);assert.equal(await page.locator('article[data-category="课程"] .card-axis-select').count(),0);
 // Calendar cards also open an editor on body click. Child controls must never do that,
 // including clicks on text/arrows that are replaced while opening the picker.
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});const activate=node=>width===1440?node.click():node.tap();
  for(const item of fixture.items.filter(t=>t.category!=='课程')){
   const node=page.locator(`article[data-task-id="${item.id}"]`),axis=node.locator('.card-axis-select').locator('..');
   for(const select of item.category==='作业'?[node.locator('.task-status').locator('..'),axis]:[axis]){
    for(const part of ['.select-value','.select-arrow']){
     await activate(select.locator(part).first());assert.equal(await page.locator('#task-dialog').isVisible(),false,'first click on a calendar control must not open the editor');assert.equal(await select.locator('.select-menu').isVisible(),true);
     await activate(select.locator(part).first());assert.equal(await page.locator('#task-dialog').isVisible(),false);assert.equal(await select.locator('.select-menu').isVisible(),false);
    }
   }
   await activate(axis.locator('.select-value').first());await activate(axis.getByRole('option',{name:fixture.a.title,exact:true}));await page.waitForFunction(()=>!document.getElementById('board').dataset.busy);
   assert.equal(await page.locator('#task-dialog').isVisible(),false);assert.equal(row(item.id).axis_id,fixture.a.id);
   if(item.category==='作业'){
    const state=node.locator('.task-status').locator('..');await activate(state.locator('.select-value').first());await activate(state.getByRole('option',{name:'进行中',exact:true}));
   }else await activate(node.locator('.completion-control'));
   await page.waitForFunction(()=>!document.querySelector('.task[data-busy]'));assert.equal(await page.locator('#task-dialog').isVisible(),false,'status changes stay on the calendar');
   await activate(node.locator('.task-title'));assert.equal(await page.locator('#task-dialog').isVisible(),true,'card body still opens the editor');await activate(page.locator('#task-dialog .close-dialog').first());
  }
 }
 // Long labels truncate on the card and remain readable in the popover, including touch.
 await category('作业');await choose(fixture.b.title);await mkdir('data/screenshots',{recursive:true});
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:1000});await picker().locator('.select-trigger').scrollIntoViewIfNeeded();
  assert.equal(await picker().locator('.select-trigger').getAttribute('title'),fixture.b.title);
  await page.screenshot({path:`data/screenshots/card-axis-${engine.name()}-${width}.png`,fullPage:true});
  await picker().locator('.select-trigger').tap();assert.equal(await picker().locator('.select-menu').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && el.scrollWidth<=el.clientWidth;}),true);
  await picker().getByRole('option',{name:fixture.b.title,exact:true}).tap();
 }
 await page.reload();await page.locator('#workspace').waitFor();await category('作业');assert.equal(await card().locator('.card-axis-select').inputValue(),fixture.b.id);
 assert.deepEqual(errors,[]);console.log(`PASS (${engine.name()}): direct axis assign/switch/detach/persistence, unchanged content/status/todos, failure and conflict recovery, busy guard, inline create/cancel, editor drafts, calendar/course exclusion, long labels and aligned 320–1440px layouts.`);
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
 if(dirname(resolve(directory))!==root)throw Error('Unsafe cleanup path');await rm(directory,{recursive:true,force:true});
}
