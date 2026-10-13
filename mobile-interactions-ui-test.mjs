// Real touch input against an isolated local database; no production account access.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=await mkdtemp(join(tmpdir(),'rucapture-mobile-interactions-')),{env,database}=await createEnvironment(directory,'mobile-interactions');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
database.prepare("INSERT INTO settings(key,value) VALUES ('daily_summary_seen',?)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.locator('#password').fill('mobile-interactions');await page.locator('#login-form button[type=submit]').tap();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').tap();
  await page.evaluate(async()=>{
    for(let i=1;i<=8;i++)await api('/api/tasks','POST',{category:'作业',title:`手机作业${i}`,due_at:'2098-03-15T09:00:00Z',todos:[{id:'a',text:'阅读',done:false},{id:'b',text:'练习',done:false},{id:'c',text:'检查',done:false}]});
    await refresh();
  });
  await page.locator('[data-view=quadrants]').tap();
  const touch=await context.newCDPSession(page);
  const send=(type,points)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const idle=()=>page.waitForFunction(()=>!document.getElementById('board').dataset.busy && !document.querySelector('.camera-moving'));
  const center=box=>({x:box.x+box.width/2,y:box.y+box.height/2});
  async function move(from,to){for(let i=1;i<=12;i++){await send('touchMove',[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]);await page.waitForTimeout(16);}}
  // End a deliberate drag at rest, so the next tap tests activation rather than stopping a fling.
  async function release(point){await page.waitForTimeout(200);await send('touchMove',[point]);await send('touchEnd',[]);}
  await page.locator('.planning-list .planning-card').first().scrollIntoViewIfNeeded();
  const first=center(await page.locator('.planning-list .planning-card').first().boundingBox());
  await send('touchStart',[first]);await move(first,{x:first.x,y:first.y+45});
  assert.equal(await page.locator('.planning-ghost').count(),1,'dragging the card body with a finger must start a drag');
  await send('touchCancel',[]);assert.equal(await page.locator('.planning-ghost').count(),0);
  async function boardTop(){await page.locator('#board').evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-16));}
  async function drop(locator,x,y,{cancel=false}={}){
    const from=center(await locator.boundingBox());await send('touchStart',[from]);
    // Inbox cards drag downward; horizontal swipes retain their native list-scrolling meaning.
    const via=await locator.evaluate(n=>n.parentElement.classList.contains('planning-list'))?{x:from.x,y:from.y+35}:from;
    if(via!==from)await move(from,via);await move(via,{x,y});
    await send(cancel?'touchCancel':'touchEnd',[]);await idle();
    assert.equal(await page.locator('.planning-ghost').count(),0);assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'),'false','card dragging must never open navigation');
  }
  const position=id=>page.evaluate(id=>quadrantPositions[id],id);
  for(const width of [320,390,430,768]){
    await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'复位象限画布'}).tap();await idle();await boardTop();
    // A horizontal swipe still scrolls the inbox instead of assigning or editing a card.
    await page.locator('.planning-list').evaluate(n=>n.scrollLeft=0);
    const inbox=await page.locator('.planning-list').boundingBox(),from={x:inbox.x+inbox.width-24,y:inbox.y+45},to={x:inbox.x+24,y:inbox.y+45};
    await send('touchStart',[from]);await move(from,to);await page.waitForTimeout(200);await send('touchMove',[to]);await send('touchEnd',[]);
    assert.ok(await page.locator('.planning-list').evaluate(n=>n.scrollLeft)>0,'inbox swipes reveal more cards');assert.equal(await page.locator('#task-dialog').isVisible(),false);
    await page.locator('.planning-list').evaluate(n=>n.scrollLeft=0);
    const card=page.locator('.planning-list .planning-card').first(),id=await card.getAttribute('data-task-id');
    for(const [x,y] of [[1,1],[-1,1],[-1,-1],[1,-1]]){
      const plot=await page.locator('.quadrant-chart').boundingBox();
      await drop(page.locator(`[data-task-id="${id}"]`),plot.x+plot.width*(x>0?.77:.23),plot.y+plot.height*(y>0?.25:.75));
      const placed=await position(id);assert.equal(Math.sign(placed?.x),x,`${width}px: touch reaches the chosen horizontal quadrant`);assert.equal(Math.sign(placed?.y),y);
    }
    const saved=await position(id),plot=await page.locator('.quadrant-chart').boundingBox();
    await drop(page.locator(`[data-task-id="${id}"]`),plot.x+plot.width/2,plot.y+plot.height/2);
    assert.deepEqual(await position(id),saved,'axis drop does not lose the last valid position');
    await drop(page.locator(`[data-task-id="${id}"]`),plot.x+plot.width*.23,plot.y+plot.height*.25,{cancel:true});
    assert.deepEqual(await position(id),saved,'cancelled touch does not save');
    await page.locator(`[data-task-id="${id}"]`).tap();await page.locator('#task-dialog').waitFor({state:'visible'});assert.match(await page.locator('#task-title').inputValue(),/手机作业/);await page.locator('#task-dialog .close-dialog').first().tap();
    const back=center(await page.locator('.planning-list').boundingBox());await drop(page.locator(`[data-task-id="${id}"]`),back.x,back.y);assert.equal((await position(id)).x,null,'touch can return a card to the inbox');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  }
  await mkdir('data/screenshots',{recursive:true});await page.setViewportSize({width:390,height:844});await boardTop();await page.screenshot({path:'data/screenshots/mobile-quadrants.png'});
  await page.getByRole('button',{name:'复位象限画布'}).tap();await idle();await boardTop();
  const plot=await page.locator('.quadrant-chart').boundingBox(),panStart={x:plot.x+25,y:plot.y+50};
  const camera=()=>page.evaluate(()=>({pan:{...quadrantPan},zoom:quadrantZoom})),beforePan=await camera();
  await send('touchStart',[panStart]);await move(panStart,{x:panStart.x+35,y:panStart.y+30});await send('touchEnd',[]);await idle();
  assert.ok(Math.abs((await camera()).pan.x-beforePan.pan.x-35)<1,'touch pans the canvas');
  const beforePinch=await camera(),mid=center(plot),fingers=spread=>[{id:1,x:mid.x-spread,y:mid.y},{id:2,x:mid.x+spread,y:mid.y}];
  await send('touchStart',fingers(45));for(const spread of [50,55,60,65])await send('touchMove',fingers(spread));await send('touchEnd',[]);await idle();assert.ok((await camera()).zoom>beforePinch.zoom*1.4,'pinch zoom works on mobile');
  await page.getByRole('button',{name:'复位象限画布'}).tap();await idle();assert.deepEqual((await camera()).pan,{x:0,y:0});
  // A short landscape viewport needs edge scrolling while the finger still holds the card.
  await page.setViewportSize({width:844,height:390});await boardTop();await page.locator('.planning-list').evaluate(n=>n.scrollLeft=0);
  const landscapeCard=page.locator('.planning-list .planning-card').first(),landscapeId=await landscapeCard.getAttribute('data-task-id'),landscapeStart=center(await landscapeCard.boundingBox());
  await send('touchStart',[landscapeStart]);await move(landscapeStart,{x:landscapeStart.x,y:382});
  await page.waitForFunction(()=>document.querySelector('.quadrant-chart').getBoundingClientRect().top<60);
  await move({x:landscapeStart.x,y:382},{x:landscapeStart.x,y:195});
  const scrolled=await page.locator('.quadrant-chart').boundingBox(),landing={x:scrolled.x+scrolled.width*.75,y:scrolled.y+scrolled.height*.25};
  await move({x:landscapeStart.x,y:195},landing);
  const landscapeDrop=await page.evaluate(()=>({feedback:document.querySelector('.quadrant-status').textContent,chart:document.querySelector('.quadrant-chart').getBoundingClientRect().toJSON(),pan:quadrantPan,zoom:quadrantZoom,ghost:!!document.querySelector('.planning-ghost')}));
  await send('touchEnd',[]);await idle();assert.ok((await position(landscapeId)).x>0,'edge scrolling makes the lower canvas reachable: '+JSON.stringify({landscapeStart,landing,landscapeDrop,position:await position(landscapeId)}));
  const persisted=await position(landscapeId);await page.reload();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>messageReady);await page.locator('[data-view=quadrants]').tap();
  assert.deepEqual(await position(landscapeId),persisted,'touch placement survives reload');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mobile-nav-toggle').tap();await page.locator('#categories button').filter({hasText:'作业'}).tap();
  const task=page.locator('.task').filter({has:page.locator('.task-title',{hasText:'手机作业1'})}).first();await task.scrollIntoViewIfNeeded();
  const handle=task.locator('.drag-handle').first(),last=task.locator('.todo-row').last();await handle.scrollIntoViewIfNeeded();
  const todoFrom=center(await handle.boundingBox()),lastBox=await last.boundingBox(),todoTo={x:todoFrom.x,y:lastBox.y+lastBox.height-3};await send('touchStart',[todoFrom]);await move(todoFrom,todoTo);await release(todoTo);
  await page.waitForFunction(()=>!document.querySelector('.checklist[data-busy]'));assert.deepEqual(await task.locator('.todo-text').allTextContents(),['练习','检查','阅读'],'native touch reorders todos');
  const checked=page.waitForResponse(r=>r.url().includes('/api/tasks/') && r.request().method()==='PATCH');await task.getByRole('checkbox',{name:'完成：阅读',exact:true}).tap();assert.equal((await checked).status(),200);await page.waitForFunction(()=>!document.querySelector('.checklist[data-busy]'));assert.equal(await task.getByRole('checkbox',{name:'完成：阅读',exact:true}).isChecked(),true);
  await page.locator('#mobile-nav-toggle').tap();await page.locator('#focus-button').tap();await page.locator('#focus-settings').waitFor({state:'visible'});
  const digit=page.locator('.clock-value[data-digit="3"]');await digit.scrollIntoViewIfNeeded();const duration=await page.evaluate(()=>focusDuration),clockFrom=center(await digit.boundingBox());
  const clockTo={x:clockFrom.x,y:clockFrom.y-24};await send('touchStart',[clockFrom]);await move(clockFrom,clockTo);await release(clockTo);assert.equal(await page.evaluate(()=>focusDuration),duration+60,'touch adjusts the focus minute wheel');
  await page.locator('#focus-toggle').tap();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='running');await page.locator('#focus-toggle').tap();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='paused');
  await page.locator('#focus-end').tap();await page.locator('#focus-end-dialog button[value=discard]').tap();await page.waitForFunction(()=>!focusActionBusy && !activeFocus());await page.locator('#task-dialog .close-dialog').first().tap();
  await page.evaluate(async()=>{const axis=await api('/api/axes','POST',{title:'手机目标'});await api('/api/tasks','POST',{category:'记录',title:'轴线触摸卡片',axis_id:axis.id,starts_at:'2098-03-15T09:00:00Z'});await refresh();});
  await page.locator('#mobile-nav-toggle').tap();await page.locator('#categories button').filter({hasText:'总览'}).tap();await page.locator('[data-view=axes]').tap();await boardTop();
  await page.locator('.axis-head').tap();await page.locator('#axis-dialog').waitFor({state:'visible'});await page.locator('#axis-dialog .close-dialog').first().tap();
  const dot=page.locator('.axis-card circle').first(),nodeFrom=center(await dot.boundingBox()),nodeBefore=await page.locator('.axis-card').getAttribute('transform');
  const nodeTo={x:nodeFrom.x+10,y:nodeFrom.y+45};await send('touchStart',[nodeFrom]);await move(nodeFrom,nodeTo);await release(nodeTo);
  assert.notEqual(await page.locator('.axis-card').getAttribute('transform'),nodeBefore,'a finger can move axis nodes');assert.equal(await page.locator('#task-dialog').isVisible(),false);
  await page.locator('#save-layout').tap();await page.waitForFunction(()=>!axisScene.dirty);
  await dot.tap();await page.locator('#task-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#task-title').inputValue(),'轴线触摸卡片');await page.locator('#task-dialog .close-dialog').first().tap();
  await page.locator('.axes-canvas').scrollIntoViewIfNeeded();
  const axisPlot=await page.locator('.axes-canvas').boundingBox(),axisFrom={x:axisPlot.x+35,y:axisPlot.y+axisPlot.height*.6},axisBefore=await page.evaluate(()=>({...axisScene.camera}));
  const axisHit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName,axisFrom);
  await send('touchStart',[axisFrom]);await move(axisFrom,{x:axisFrom.x+30,y:axisFrom.y-25});await send('touchEnd',[]);
  const axisAfter=await page.evaluate(()=>({...axisScene.camera}));assert.ok(Math.abs(axisAfter.x-axisBefore.x-30)<1,JSON.stringify({axisBefore,axisAfter,axisFrom,axisPlot,axisHit,scale:await page.evaluate(()=>visualViewport.scale)}));
  const axisMiddle={x:axisPlot.x+axisPlot.width/2,y:axisPlot.y+axisPlot.height*.6},axisFingers=spread=>[{id:1,x:axisMiddle.x-spread,y:axisMiddle.y},{id:2,x:axisMiddle.x+spread,y:axisMiddle.y}],axisZoom=await page.evaluate(()=>axisScene.camera.z);
  await send('touchStart',axisFingers(40));for(const spread of [45,50,55,60])await send('touchMove',axisFingers(spread));await send('touchEnd',[]);assert.ok(await page.evaluate(()=>axisScene.camera.z)>axisZoom*1.4);
  assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'),'false');
  assert.deepEqual(errors,[]);console.log('Mobile touch passed: body drag and inbox swipe, all four quadrants at 320/390/430/768px, return/cancel/axis rejection, pan/pinch/reset, landscape edge scroll, persistence, card editing, todo reorder/check, focus wheel/start/pause/end, axis node editing/drag/save/pan/pinch.');
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
