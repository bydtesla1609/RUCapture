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
const directory=await mkdtemp(join(tmpdir(),'rucapture-launch-ui-'));
const {env,database}=await createEnvironment(directory,'launch-ui');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
database.prepare("INSERT INTO settings(key,value) VALUES ('daily_summary_seen',?)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')writes.push(request.url());});
  await page.goto(origin);await page.locator('#login').waitFor({state:'visible'});await mkdir('data/screenshots',{recursive:true});
  assert.equal(await page.locator('[data-launch-page]').count(),4);
  assert.deepEqual(await page.locator('.launch-eyebrow').allTextContents(),['01 / 收拢待办','02 / 校园日历','03 / 目标轴线','04 / 规划与专注']);
  assert.equal(await page.locator('.launch-question,.launch-note,.demo-caption').count(),0);
  assert.ok(!(await page.locator('#login').innerText()).includes('本阶段名额'));
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    for(let i=0;i<4;i++){
      await page.locator('.launch-nav button').nth(i).click();
      await page.waitForFunction(i=>document.querySelectorAll('.launch-nav button')[i].getAttribute('aria-current')==='step',i);
      const section=page.locator('[data-launch-page]').nth(i);
      const entry=page.getByRole('button',{name:'立即体验',exact:true});assert.ok(await entry.isVisible());const entryBox=await entry.boundingBox();assert.ok(entryBox.y>=0 && entryBox.y+entryBox.height<120,'experience entry floats above every chapter');
      assert.ok(await section.evaluate(node=>node.scrollWidth<=node.clientWidth),`chapter ${i+1} fits at ${width}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const box=await section.locator('h1,h2').first().boundingBox();assert.ok(box.y>=90 && box.y<1000,`chapter heading remains below sticky header: ${i}/${width}`);
      if(width===1440 || width===390)await page.screenshot({path:`data/screenshots/launch-${i+1}-${width}.png`,animations:'disabled'});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.launch-nav button').nth(1).click();await page.locator('[data-demo-day="1"]').click();assert.match(await page.locator('#launch-day-events').innerText(),/第一次小测/);
  await page.locator('[data-demo-day="2"]').click();assert.match(await page.locator('#launch-day-events').innerText(),/概率论/);
  await page.locator('.launch-nav button').nth(2).click();await page.locator('[data-demo-journey="1"]').click();assert.equal(await page.locator('#launch-journey-title').innerText(),'让运动成为习惯');
  await page.locator('[data-demo-journey="2"]').click();assert.equal(await page.locator('#launch-journey-title').innerText(),'沿海旅行随记');
  await page.locator('.launch-nav button').nth(3).click();await page.locator('#launch-clock-toggle').click();await page.waitForFunction(()=>document.getElementById('launch-clock-value').textContent!=='00:25:00');
  await page.locator('#launch-clock-toggle').click();const paused=await page.locator('#launch-clock-value').innerText();assert.equal(await page.locator('#launch-clock-toggle').getAttribute('aria-pressed'),'false');
  assert.deepEqual(writes,[],'tour demos never create tasks or focus sessions');
  // A wheel gesture moves one complete chapter, including a long trackpad tail.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.launch-nav button').nth(2).click();
  const journey=page.locator('.journey-plot path'),shapes=new Set();
  for(let index=0;index<3;index++){
    await page.locator(`[data-demo-journey="${index}"]`).click();shapes.add(await journey.getAttribute('d'));
    assert.ok(await journey.evaluate(node=>node.getAnimations().length===1 && parseFloat(getComputedStyle(node).strokeDashoffset)>.8),'each example redraws from its beginning');
    await page.waitForFunction(()=>{const node=document.querySelector('.journey-plot path'),offset=parseFloat(getComputedStyle(node).strokeDashoffset);return offset>.1 && offset<.7;});
    await page.waitForFunction(()=>document.querySelector('.journey-plot path').getAnimations().length===0);
    assert.equal(await journey.evaluate(node=>parseFloat(getComputedStyle(node).strokeDashoffset)),0);
    await page.screenshot({path:`data/screenshots/journey-example-${index+1}.png`,animations:'disabled'});
  }
  assert.equal(shapes.size,3,'course, sport and travel have distinct paths');
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [320,390]){
    await page.setViewportSize({width,height:1000});
    for(let index=0;index<3;index++){
      await page.locator(`[data-demo-journey="${index}"]`).click();
      const overlaps=await page.locator('.journey-plot').evaluate(plot=>{
        const rects=[...plot.querySelectorAll('.journey-head,.journey-node strong')].map(node=>node.getBoundingClientRect());
        return rects.some((a,i)=>rects.slice(i+1).some(b=>a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom));
      });
      assert.equal(overlaps,false,`journey titles do not overlap at ${width}px, example ${index}`);
      if(width===390)await page.screenshot({path:`data/screenshots/journey-mobile-${index+1}.png`,animations:'disabled'});
    }
  }
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('[data-demo-journey="0"]').click();await page.locator('[data-demo-journey="1"]').click();
  assert.equal(await journey.evaluate(node=>node.getAnimations().length),1,'rapid changes cancel the previous drawing');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-demo-journey="2"]').click();
  assert.equal(await journey.evaluate(node=>node.getAnimations().length),0,'reduced motion shows the full path immediately');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.launch-nav button').nth(0).click();
  const settled=()=>page.waitForFunction(()=>{const current=document.querySelector('.launch-page.is-current'),stage=document.querySelector('.launch-stage');return Math.abs(current.getBoundingClientRect().top-stage.getBoundingClientRect().top)<1;});
  await settled();await page.mouse.move(800,500);await page.mouse.wheel(0,130);
  await page.waitForFunction(()=>document.querySelector('#login').dataset.page==='1');
  const moving=await page.locator('#launch-calendar').boundingBox();assert.ok(moving.y>83,'translation animates rather than jumping');
  // Send the inertial tail in-page: sequential CDP wheel calls can add 200+ ms
  // of rendering latency and accidentally simulate several fresh gestures.
  // The gesture onset and the later, separate gesture still use real wheel input.
  await page.evaluate(async()=>{
    const surface=document.querySelector('.launch-stage');
    for(let i=0;i<16;i++){
      surface.dispatchEvent(new WheelEvent('wheel',{deltaY:45,bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,70));
    }
  });
  await settled();assert.equal(await page.locator('#login').getAttribute('data-page'),'1','inertia cannot skip chapters');
  assert.equal(await page.locator('.launch-page:not(.is-current):not([inert])').count(),0,'inactive forms cannot take keyboard focus');
  await new Promise(resolve=>setTimeout(resolve,250));await page.mouse.wheel(0,90);await settled();assert.equal(await page.locator('#login').getAttribute('data-page'),'2');
  await page.locator('.launch-nav button').nth(2).focus();await page.keyboard.press('PageDown');await settled();assert.equal(await page.locator('#login').getAttribute('data-page'),'3');
  await page.keyboard.press('Home');await settled();assert.equal(await page.locator('#login').getAttribute('data-page'),'0');
  // A tall phone chapter scrolls to its form before an edge gesture turns the page.
  await page.setViewportSize({width:390,height:700});await page.locator('.launch-nav button').nth(0).click();await settled();
  await page.mouse.move(190,400);await page.mouse.wheel(0,240);await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(await page.locator('#login').getAttribute('data-page'),'0');assert.ok(await page.locator('#launch-collect').evaluate(node=>node.scrollTop>0));
  await page.locator('#password').fill('draft stays');await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#login').getAttribute('data-page'),'0','editing does not turn pages');
  await page.locator('#launch-collect').evaluate(node=>node.scrollTop=node.scrollHeight);
  await new Promise(resolve=>setTimeout(resolve,250));await page.mouse.move(190,630);await page.mouse.wheel(0,100);await settled();assert.equal(await page.locator('#login').getAttribute('data-page'),'1');
  // Reproduce a one-finger edge swipe without touching any persistent data.
  await page.locator('.launch-nav button').nth(1).click();await settled();await new Promise(resolve=>setTimeout(resolve,1000));
  await page.locator('#launch-calendar').evaluate(node=>node.scrollTop=node.scrollHeight);
  await page.locator('#launch-calendar').dispatchEvent('touchstart',{touches:[{identifier:1,clientX:180,clientY:590}]});
  await page.locator('#launch-calendar').dispatchEvent('touchend',{touches:[],changedTouches:[{identifier:1,clientX:182,clientY:350}]});
  await settled();assert.equal(await page.locator('#login').getAttribute('data-page'),'2');
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1440,height:1000});
  // Returning to sign-in preserves a draft and brings the actual form into view.
  await page.locator('.landing-header [data-launch-login]').click();await page.locator('#password').fill('launch-ui');
  await page.locator('.launch-nav button').nth(3).click();await page.locator('.landing-header [data-launch-login]').click();assert.equal(await page.locator('#password').inputValue(),'launch-ui');
  // The experience entry returns to the form, including during an interrupted transition.
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const width of [1440,390]){await page.setViewportSize({width,height:844});await page.locator('.launch-nav button').nth(3).click();await page.waitForFunction(()=>document.querySelector('.launch-nav button:last-child').getAttribute('aria-current')==='step');await page.getByRole('button',{name:'立即体验',exact:true}).click();await page.waitForFunction(()=>{const header=document.querySelector('.landing-header').getBoundingClientRect(),form=document.getElementById('login-form').getBoundingClientRect();return form.top>=header.bottom && form.bottom<=innerHeight;});assert.equal(await page.locator('#password').inputValue(),'launch-ui');}
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1440,height:1000});
  await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
  await page.evaluate(async()=>{
    const fixtures=[['一考试','考试',1,1],['一记录','记录',1,1],['二作业','作业',1,-1],['二活动','活动',1,-1],['三会议','会议',-1,1],['三记录','记录',-1,1],['四考试','考试',-1,-1],['四作业','作业',-1,-1],['未安排课程','课程'],['未安排记录','记录']];
    for(const [title,category,x,y] of fixtures){const task=await api('/api/tasks','POST',{title,category,due_at:'2098-03-15T09:00:00+08:00',starts_at:'2098-03-15T09:00:00+08:00',ends_at:'2098-03-15T10:00:00+08:00'});if(x)await api(`/api/quadrant/${task.id}`,'PUT',{revision:0,x:x*.6,y:y*.6});}
    await refresh();calendarSelect('2098-03-15');
  });
  assert.equal(await page.locator('.calendar-event .task-quadrant').count(),8);
  const first=page.locator('.calendar-event').filter({hasText:'一考试'});assert.deepEqual(await first.locator('.task-kind>span').allTextContents(),['考试','紧急且重要']);const kind=await first.locator('.badge').boundingBox(),priority=await first.locator('.task-quadrant').boundingBox();assert.ok(priority.x>kind.x+kind.width && Math.abs(priority.y+priority.height/2-kind.y-kind.height/2)<2);
  await page.screenshot({path:'data/screenshots/priority-calendar.png',fullPage:true});
  for(const type of ['作业','考试','会议','活动','记录']){
    await page.locator('#categories button').filter({has:page.locator('span',{hasText:new RegExp(`^${type}$`)})}).click();assert.ok(await page.locator('#board .task-quadrant').count()>0);
    const headings=await page.locator('#board .column-heading').evaluateAll(nodes=>nodes.map(node=>({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight,dot:!!node.querySelector('.line[aria-hidden=true]')})));
    assert.ok(headings.length>=2);assert.ok(headings.every(node=>node.size==='18.7px' && node.weight==='600' && node.dot),`${type}: same heading and status dot`);
    if(type==='作业' || type==='记录')await page.screenshot({path:`data/screenshots/group-${type==='作业'?'homework':'records'}.png`,fullPage:true});
  }
  await page.locator('#focus-button').click();await page.locator('#focus-settings').waitFor({state:'visible'});
  assert.deepEqual(await page.locator('#focus-tasks strong').allTextContents(),['一考试','一记录','二作业','二活动','三会议','三记录','四考试','四作业','未安排课程','未安排记录']);
  assert.equal(await page.locator('#focus-tasks .task-quadrant').count(),8);
  await page.setViewportSize({width:320,height:900});assert.ok(await page.locator('#task-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth));
  for(const node of await page.locator('#focus-tasks .task-quadrant').all())assert.ok(await node.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.setViewportSize({width:1440,height:1000});await page.locator('#focus-edit-info').click();await page.locator('.focus-choice').filter({hasText:'未安排课程'}).locator('input').check();
  await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='running');assert.equal(await page.evaluate(()=>activeFocus().selected[0].category),'课程');
  await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='paused');await page.locator('#focus-end').click();await page.locator('#focus-end-dialog button[value=discard]').click();await page.waitForFunction(()=>!focusActionBusy && !activeFocus());
  await page.locator('#task-dialog .close-dialog').first().click();
  await page.evaluate(async()=>{const task=tasks.find(t=>t.title==='一记录');await api(`/api/tasks/${task.id}/archive`,'PATCH',{revision:task.revision,archived:true});await loadArchive();document.getElementById('archive-dialog').showModal();});
  assert.equal(await page.locator('#archive-dialog .task-quadrant').count(),0,'archive stays free of priority labels');
  assert.deepEqual(errors,[]);console.log('Launch and priorities passed: whole-page animated wheel/keyboard/swipe navigation, inertia guard, tall-page scrolling, reduced motion, preserved login draft, responsive interactive demos, consistent headings/status dots, quadrant labels/sorting, selectable courses, 320–1440px.');
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
