// Disposable local fixtures only; no production accounts or data.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=await mkdtemp(join(tmpdir(),'rucapture-calendar-ui-'));
const {env,database}=await createEnvironment(directory,'calendar-ui');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.locator('#password').fill('calendar-ui');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
  await page.evaluate(async()=>{
    for(const [i,category] of ['记录','课程','活动','会议','作业','考试'].entries()){
      const start=`2098-03-15T${String(8+i).padStart(2,'0')}:00:00+08:00`,end=`2098-03-15T${String(9+i).padStart(2,'0')}:00:00+08:00`;
      await api('/api/tasks','POST',{category,title:`时间线${category}`,content:'简洁显示，点击编辑',starts_at:start,ends_at:end,due_at:start,todos:[{id:'one',text:'待办测试',done:false}]});
    }
    await api('/api/tasks','POST',{category:'会议',title:'同刻会议',starts_at:'2098-03-15T13:00:00+08:00',ends_at:'2098-03-15T14:00:00+08:00'});
    await api('/api/tasks','POST',{category:'活动',title:'跨日活动',starts_at:'2098-03-14T22:00:00+08:00',ends_at:'2098-03-15T08:00:00+08:00'});
    await refresh();calendarSelect('2098-03-15');
  });
  const order=['考试','作业','会议','活动','课程','记录'],day=page.locator('[data-date="2098-03-15"]'),filter=page.locator('#calendar-type-filter');
  assert.deepEqual(await day.locator('.day-task').allTextContents(),['时间线考试','时间线作业']);
  assert.deepEqual(await page.locator('.agenda-time').allTextContents(),['00:00','08:00','09:00','10:00','11:00','12:00','13:00','13:00']);
  assert.deepEqual(await page.locator('.agenda-row').last().locator('.task-title').allTextContents(),['时间线考试','同刻会议'],'same-time events share a group and use type priority');
  await filter.locator('summary').click();assert.equal(await filter.locator('input:checked').count(),7);
  for(const category of order){
    const titles=await day.locator('.day-task').allTextContents();assert.ok(titles[0].includes(category),'month previews use category priority, not time');
    await filter.getByLabel(category,{exact:true}).uncheck();assert.equal(await page.locator('.calendar-event .badge').filter({hasText:new RegExp(`^${category}$`)}).count(),0);
    assert.equal(await filter.getAttribute('open'),'','multi-select stays open');
  }
  assert.equal(await page.locator('.calendar-event').count(),0);assert.equal(await day.locator('.day-task').count(),0);assert.match(await page.locator('.day-empty').innerText(),/请选择/);
  await filter.locator('summary').press('Escape');await page.getByRole('button',{name:'下个月',exact:true}).click();await page.getByRole('button',{name:'上个月',exact:true}).click();
  assert.equal(await filter.locator('input:checked').count(),0,'filters survive month navigation');
  await day.click();await filter.locator('summary').click();await filter.getByLabel('全部类型',{exact:true}).check();await filter.locator('summary').press('Escape');
  assert.equal(await page.locator('.calendar-event').count(),8);
  await page.evaluate(()=>calendarSelect('2026-10-01'));assert.equal(await page.locator('[data-date="2026-10-01"] .calendar-holiday').innerText(),'国庆');
  await page.evaluate(()=>calendarSelect('2026-09-25'));assert.equal(await page.locator('[data-date="2026-09-25"] .calendar-holiday').innerText(),'中秋');
  await page.evaluate(()=>calendarSelect('2098-03-15'));
  const sameTime=await page.locator('.agenda-row').last().locator('.calendar-event').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));assert.equal(sameTime[0].y,sameTime[1].y,'same-time cards sit side by side on desktop');
  assert.deepEqual(await page.locator('.agenda-row').evaluateAll(rows=>rows.map(row=>row.querySelectorAll('.calendar-event').length)),[3,3,2]);
  assert.equal(await page.locator('.calendar-event .task-footer').count(),8,'full cards retain their actions');assert.equal(await page.locator('.calendar-event .todo-row').count(),6,'full cards retain their todo lists');
  for(const entry of await page.locator('.agenda-entry').all()){const time=await entry.locator('.agenda-time span').boundingBox(),card=await entry.locator('.task').boundingBox();assert.ok(Math.abs(time.x+time.width/2-card.x-card.width/2)<1);}
  for(const row of await page.locator('.agenda-row').all()){const cards=await row.locator('.calendar-event').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));assert.equal(new Set(cards).size,1);}
  await mkdir('data/screenshots',{recursive:true});await page.locator('.day-agenda').screenshot({path:'data/screenshots/calendar-timeline.png'});
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:900});await filter.locator('summary').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no page overflow at ${width}`);
    const bounds=await filter.locator('.calendar-filter-menu').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,`filter fits at ${width}`);
    await filter.locator('summary').press('Escape');
    assert.ok(await page.locator('.calendar-event').first().evaluate(node=>node.scrollWidth<=node.clientWidth),`detailed event fits at ${width}`);
    for(const card of await page.locator('.calendar-event').all()){const footer=card.locator('.task-footer-main'),actions=await footer.locator('.task-actions').boundingBox(),status=footer.locator('.completion-control,.custom-select').first();if(await status.count()){const box=await status.boundingBox();assert.ok(Math.abs(box.y+box.height/2-actions.y-actions.height/2)<1,`footer stays on one line at ${width}`);}assert.ok(await footer.evaluate(n=>n.scrollWidth<=n.clientWidth));}
  }
  await page.setViewportSize({width:1440,height:1100});
  // Editing all six task categories offers deletion; cancellation preserves the draft.
  for(const category of order){
    const event=page.locator('.calendar-event').filter({has:page.locator('.task-title',{hasText:`时间线${category}`})});await event.locator('.task-title').click();
    assert.equal(await page.locator('#dialog-title').innerText(),`编辑${category}`);assert.equal(await page.locator('#editor-delete').isVisible(),true);
    await page.locator('#task-title').fill(`未保存${category}`);await page.locator('#editor-delete').click();assert.equal(await page.locator('#delete-title').innerText(),`删除这张${category}卡片？`);assert.ok(!(await page.locator('#delete-message').innerText()).includes('教学网站'));await page.locator('#delete-dialog').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.locator('#task-title').inputValue(),`未保存${category}`);
    if(category==='考试'){
      await page.locator('#task-dialog').getByRole('button',{name:'编辑待办：待办测试',exact:true}).click();await page.locator('#task-dialog').getByRole('button',{name:'删除待办：待办测试',exact:true}).click();await page.locator('#action-confirm-accept').click();
      await page.locator('#task-todos .todo-row').waitFor({state:'detached'});
    }
    await page.locator('#editor-delete').click();await page.locator('#confirm-delete').click();await page.locator('#task-dialog').waitFor({state:'hidden'});await event.waitFor({state:'detached'});
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM tasks WHERE title=? AND deleted=0').get(`时间线${category}`).count,0);
  }
  await page.locator('#add-task').click();await page.locator('#add-menu').getByRole('button',{name:'＋ 记录',exact:true}).click();assert.equal(await page.locator('#editor-delete').isVisible(),false,'new unsaved cards have no delete');await page.locator('#task-dialog .close-dialog').first().click();
  // Axis editors already support deletion and must continue to retain their cards.
  await page.evaluate(async()=>{const axis=await api('/api/axes','POST',{title:'临时轴线'});await refresh();openAxis(axes.find(a=>a.id===axis.id));});
  assert.equal(await page.locator('#axis-delete').isVisible(),true);await page.locator('#axis-delete').click();await page.locator('#action-confirm-accept').click();await page.locator('#axis-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('.calendar-event').count(),2);
  assert.deepEqual(errors,[]);console.log('Calendar UI passed: type-priority month previews, persistent multi-select, chronological/cross-day/same-time groups, three detailed cards per horizontal timeline row, deletion/cancel from all six editors and inline todos, axis deletion, 320–1440px.');
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
