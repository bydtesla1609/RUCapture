// Local, isolated data only. Run MOBILE_LAYOUT_BASELINE=1 to reproduce the previous picker failure.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright'),engine=engines[process.env.MOBILE_BROWSER || 'chromium'];
const directory=await mkdtemp(join(tmpdir(),'rucapture-mobile-layout-')),{env,database}=await createEnvironment(directory,'mobile-layout-test');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
database.prepare("INSERT INTO settings(key,value) VALUES ('daily_summary_seen',?)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const baseline=new Map();
if(process.env.MOBILE_LAYOUT_BASELINE)for(const file of ['index.html','app.js','capture.js','style.css'])baseline.set(file,execFileSync('git',['show','HEAD:static/'+file]));
const server=createServer(async(req,res)=>{
  const name=req.url==='/'?'index.html':req.url.replace('/static/','');
  if(baseline.has(name)){res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(baseline.get(name));return;}
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>{localStorage.setItem('ruchecklist-demo:personal','seen');localStorage.setItem('rucapture-sidebar','collapsed');});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.locator('#password').fill('mobile-layout-test');await page.locator('#login-form button[type=submit]').tap();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').tap();
  await page.evaluate(async()=>{
    for(let i=0;i<14;i++)await api('/api/axes','POST',{title:`复习计划 ${i+1}：把这一学期没弄懂的问题逐个补起来`});
    await refresh();newTaskCategory='记录';openTask();
  });
  await page.locator('#task-title').fill('手机上选择轴线');
  const trigger=page.locator('#task-axis').locator('..').locator('.select-trigger'),picker=page.locator('#task-axis').locator('..').locator('.select-menu');
  await trigger.scrollIntoViewIfNeeded();await trigger.tap();
  // iOS can dispatch focusout with no relatedTarget before the tapped option receives click.
  await trigger.evaluate(node=>node.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:null})));
  assert.equal(await picker.isVisible(),true,'a touch blur must not close the picker before its option click');
  const option=picker.getByRole('option').filter({hasText:'复习计划 12：'});await option.scrollIntoViewIfNeeded();await option.tap();
  const chosen=await page.locator('#task-axis').inputValue();assert.ok(chosen);
  await page.locator('#save-task').tap();await page.locator('#task-dialog').waitFor({state:'hidden'});
  assert.equal(database.prepare('SELECT axis_id FROM tasks WHERE title=?').get('手机上选择轴线').axis_id,chosen);
  await page.evaluate(()=>openTask(tasks.find(t=>t.title==='手机上选择轴线')));await trigger.scrollIntoViewIfNeeded();await trigger.tap();
  const create=picker.getByRole('option',{name:'＋ 新增轴线'});await create.scrollIntoViewIfNeeded();await create.tap();
  await page.locator('#new-axis-title').fill('手机内新建的目标');await page.locator('#new-axis-save').tap();await page.locator('#new-axis-dialog').waitFor({state:'hidden'});
  assert.match(await trigger.innerText(),/手机内新建的目标/);await page.locator('#save-task').tap();await page.locator('#task-dialog').waitFor({state:'hidden'});
  assert.equal(database.prepare('SELECT a.title FROM axes a JOIN tasks t ON t.axis_id=a.id WHERE t.title=?').get('手机上选择轴线').title,'手机内新建的目标');
  await page.setViewportSize({width:390,height:430});await page.evaluate(()=>openTask(tasks.find(t=>t.title==='手机上选择轴线')));
  await trigger.scrollIntoViewIfNeeded();await trigger.tap();const pickerBox=await picker.boundingBox();assert.ok(pickerBox.y>=0 && pickerBox.y+pickerBox.height<=430);
  await picker.getByRole('option',{name:'暂不加入轴线',exact:true}).tap();await page.locator('#task-dialog .close-dialog').first().tap();
  await page.setViewportSize({width:390,height:844});
  const nav=page.locator('#mobile-nav-toggle');
  async function openNav(){if(await nav.getAttribute('aria-expanded')!=='true')await nav.tap();}
  // Native Android-style touch dispatch in Chromium; TouchEvents exercise the same guards in WebKit.
  const touchSession=engine===engines.chromium?await context.newCDPSession(page):null;
  async function swipe(from,to,{cancel=false,target='main'}={}){
    if(touchSession && target==='main'){
      await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from[0],y:from[1]}]});
      for(let i=1;i<=6;i++){await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from[0]+(to[0]-from[0])*i/6,y:from[1]+(to[1]-from[1])*i/6}]});await page.waitForTimeout(16);}
      if(Math.abs(to[1]-from[1])>Math.abs(to[0]-from[0])){await page.waitForTimeout(200);await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to[0],y:to[1]}]});}
      await touchSession.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    }else await page.evaluate(({from,to,cancel,target})=>{
      const node=document.querySelector(target),send=(type,x,y)=>{const touch={identifier:1,target:node,clientX:x,clientY:y},event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:['touchend','touchcancel'].includes(type)?[]:[touch]},changedTouches:{value:[touch]}});node.dispatchEvent(event);};
      send('touchstart',...from);for(let i=1;i<=6;i++)send('touchmove',from[0]+(to[0]-from[0])*i/6,from[1]+(to[1]-from[1])*i/6);send(cancel?'touchcancel':'touchend',...to);
    },{from,to,cancel,target});
  }
  const rest=await nav.boundingBox();assert.ok(await nav.evaluate(n=>Number(getComputedStyle(n).backgroundColor.match(/[\d.]+/g).at(-1))<.1),'navigation button uses a transparent surface');
  await swipe([40,280],[180,282]);assert.equal(await nav.getAttribute('aria-expanded'),'true','right swipe opens');
  let navBox=await nav.boundingBox(),mainBox=await page.locator('main').boundingBox(),drawerBox=await page.locator('#sidebar').boundingBox();
  assert.ok(Math.abs(navBox.x-rest.x-mainBox.x)<1 && Math.abs(mainBox.x-drawerBox.width)<1,'toggle and page move together by the drawer width');
  assert.ok(navBox.x+navBox.width<=390,'open toggle stays on screen');
  await swipe([375,280],[255,282]);assert.equal(await nav.getAttribute('aria-expanded'),'false','left swipe closes from the visible page');
  await swipe([40,280],[64,281]);assert.equal(await nav.getAttribute('aria-expanded'),'false','small accidental movements snap closed');
  await swipe([40,280],[180,281],{cancel:true});assert.equal(await nav.getAttribute('aria-expanded'),'false','cancel restores previous state');
  await swipe([80,330],[82,220]);assert.equal(await nav.getAttribute('aria-expanded'),'false','vertical scrolling does not open navigation');
  await page.evaluate(()=>scrollTo(0,0));await page.locator('[data-view=axes]').tap();
  await page.locator('.axes-canvas svg').waitFor();await swipe([90,340],[220,341],{target:'.axes-canvas svg'});assert.equal(await nav.getAttribute('aria-expanded'),'false','axis panning retains its gesture');
  await page.locator('[data-view=calendar]').tap();
  await page.emulateMedia({reducedMotion:'no-preference'});await nav.tap();
  const motion=await page.evaluate(async()=>{const values=[];for(let i=0;i<42;i++){await new Promise(requestAnimationFrame);values.push({main:main.getBoundingClientRect().x,button:mobileToggle.getBoundingClientRect().x});}return {values,width:sidebar.getBoundingClientRect().width};});
  assert.ok(motion.values.some(value=>value.main>motion.width+.2),'spring transition has a restrained overshoot');
  assert.ok(motion.values.every(value=>Math.abs(value.button-rest.x-value.main)<1),'button remains aligned throughout animation');
  await nav.tap();await page.waitForTimeout(600);await page.emulateMedia({reducedMotion:'reduce'});
  const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must not scroll horizontally');
  const clickable=async locator=>{await locator.scrollIntoViewIfNeeded();assert.ok(await locator.evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===node||node.contains(hit);}));};
  await mkdir('data/screenshots/mobile-layout',{recursive:true});
  for(const [width,height] of [[320,844],[390,844],[430,844],[768,844],[844,390]]){
    await page.setViewportSize({width,height});await fits();assert.equal(await nav.isVisible(),true);
    assert.equal(await page.locator('#sidebar').evaluate(n=>n.inert),true);assert.ok(await page.locator('main').evaluate(n=>n.getBoundingClientRect().width>=innerWidth-1));
    await openNav();assert.equal(await page.locator('main').evaluate(n=>n.inert),true);
    await clickable(page.locator('#categories button').filter({hasText:'记录'}));await page.locator('#categories button').filter({hasText:'记录'}).tap();
    assert.equal(await nav.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('main').evaluate(n=>n.inert),false);
    await openNav();await page.locator('#categories button').filter({hasText:'总览'}).tap();await page.locator('[data-view=calendar]').tap();
    for(const effects of ['on','off']){
      await page.evaluate(value=>document.documentElement.dataset.effects=value,effects);
      const filter=page.locator('.calendar-filter>summary'),previous=page.getByRole('button',{name:'上个月',exact:true});
      const a=await filter.boundingBox(),b=await previous.boundingBox();assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'calendar filter must not overlap navigation');
      await clickable(filter);await filter.tap();await page.locator('#calendar-type-1').uncheck();assert.equal(await page.locator('#calendar-type-1').isChecked(),false);await page.locator('#calendar-type-1').check();
      await page.locator('.calendar-filter>summary').tap();await clickable(previous);await previous.tap();await page.getByRole('button',{name:'下个月',exact:true}).tap();await fits();
    }
    await page.evaluate(()=>delete document.documentElement.dataset.effects);await page.screenshot({path:`data/screenshots/mobile-layout/calendar-${width}.png`,fullPage:true});
    await openNav();await page.screenshot({path:`data/screenshots/mobile-layout/drawer-${width}.png`});
    await page.locator('#focus-button').tap();await page.locator('#task-dialog').waitFor({state:'visible'});assert.equal(await nav.getAttribute('aria-expanded'),'false');
    assert.ok(await page.locator('#task-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.locator('#task-dialog .close-dialog').first().tap();
    await openNav();await page.locator('#user-menu-toggle').tap();await page.locator('#effects-toggle').tap();assert.equal(await nav.getAttribute('aria-expanded'),'true');
    await page.locator('#archive-button').tap();await page.locator('#archive-dialog').waitFor({state:'visible'});assert.equal(await nav.getAttribute('aria-expanded'),'false');await page.locator('#archive-dialog .close-dialog').tap();
    await openNav();await page.keyboard.press('Escape');assert.equal(await nav.getAttribute('aria-expanded'),'false');
    await openNav();await page.touchscreen.tap(width-8,Math.min(300,height-20));assert.equal(await nav.getAttribute('aria-expanded'),'false');
  }
  await page.setViewportSize({width:390,height:844});await openNav();await page.locator('#demo-button').tap();
  for(let step=0;step<11;step++){
    await page.waitForFunction(i=>demoIndex===i,step);assert.ok(await page.locator('#demo-card').evaluate(n=>n.getBoundingClientRect().right<=innerWidth));
    const targetVisible=await page.evaluate(()=>{const target=document.querySelector(demoSteps[demoIndex].target);return !target.closest('.sidebar')||document.querySelector('#workspace').classList.contains('mobile-nav-open');});assert.ok(targetVisible,'tour reveals navigation targets');
    await page.locator('#demo-next').tap();
  }
  await page.locator('#demo-dialog').waitFor({state:'hidden'});assert.equal(await nav.getAttribute('aria-expanded'),'false');
  await page.setViewportSize({width:1440,height:1050});await page.waitForFunction(()=>!mobileNavigation.matches && !document.getElementById('sidebar').inert);assert.equal(await nav.isVisible(),false);assert.equal(await page.locator('#workspace').evaluate(n=>n.classList.contains('sidebar-collapsed')),true);
  await page.locator('#sidebar-toggle').click();assert.equal(await page.locator('#workspace').evaluate(n=>n.classList.contains('sidebar-collapsed')),false);
  assert.deepEqual(errors,[]);console.log(`Mobile layout passed (${engine.name()}): transparent moving toggle, swipe/cancel/vertical scroll, synchronized spring motion, axis selection/create/save, drawer and focus, account menu, calendar filtering/navigation, tour, 320–1440px, effects on/off.`);
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
