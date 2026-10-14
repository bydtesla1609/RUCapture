// Isolated synthetic data and deliberately delayed writes; never contacts a real account.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright'),engine=engines[process.env.MOBILE_BROWSER || 'chromium'];
const directory=await mkdtemp(join(tmpdir(),'rucapture-quadrant-drag-')),{env,database}=await createEnvironment(directory,'quadrant-drag-test');
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?),('daily_summary_seen',?)").run(RELEASE.version,new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const baseline=new Map();if(process.env.QUADRANT_DRAG_BASELINE)for(const name of ['app.js','planning.js','style.css'])baseline.set('/static/'+name,execFileSync('git',['show','HEAD:static/'+name]));
const server=createServer(async(req,res)=>{
  if(baseline.has(req.url)){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':'text/css'});res.end(baseline.get(req.url));return;}
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await engine.launch({headless:true});
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1100},hasTouch:true,isMobile:width<900,reducedMotion:'reduce'});
    context.setDefaultTimeout(10000);
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.locator('#password').fill('quadrant-drag-test');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>messageReady);
    if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
    const ids=await page.evaluate(async width=>{
      lastPoll=Date.now();const ids=[];for(let i=0;i<2;i++)ids.push((await api('/api/tasks','POST',{category:'作业',title:`虚构拖动 ${width}-${i}`,due_at:'2099-10-15T08:00:00Z'})).id);
      await refresh();overviewView='quadrants';render();return ids;
    },width);
    await page.locator('#board').evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-16));
    await page.evaluate(()=>{window.originalChart=document.querySelector('.quadrant-chart');window.originalCards=[...document.querySelectorAll('.planning-card')];});
    const card=id=>page.locator(`.planning-card[data-task-id="${id}"]`),state=id=>page.evaluate(id=>quadrantPositions[id],id);
    const saved=id=>JSON.parse(database.prepare('SELECT value FROM settings WHERE key=?').get(`quadrant:${id}`).value);
    const touch=width<900 && engine===engines.chromium?await context.newCDPSession(page):null;
    const send=(type,p)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:p?[p]:[]});
    async function drag(id,x,y,{release=true}={}){
      await card(id).scrollIntoViewIfNeeded();const box=await card(id).boundingBox(),plot=await page.locator('.quadrant-chart').boundingBox();
      const from={x:box.x+box.width/2,y:box.y+box.height/2},to={x:plot.x+plot.width*x,y:plot.y+plot.height*y};
      if(touch){await send('touchStart',from);await send('touchMove',{x:from.x,y:from.y+30});}
      else{await page.mouse.move(from.x,from.y);await page.mouse.down();}
      for(let i=1;i<=8;i++){
        const p={x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8};if(touch)await send('touchMove',p);else await page.mouse.move(p.x,p.y);
      }
      await page.evaluate(()=>new Promise(requestAnimationFrame));
      assert.equal(await card(id).evaluate(n=>getComputedStyle(n).opacity),'0','the original card must be invisible during dragging');
      assert.equal(await page.locator('.planning-ghost').count(),1);
      const ghost=await page.locator('.planning-ghost').boundingBox();assert.ok(Math.abs(ghost.x+ghost.width/2-to.x)<2 && Math.abs(ghost.y+ghost.height/2-to.y)<2,'preview follows the pointer');
      if(release){if(touch)await send('touchEnd');else await page.mouse.up();}
      return ghost;
    }
    let staleRoute,staleResponse;await page.route('**/api/sync',async route=>{staleRoute=route;staleResponse=await route.fetch();});
    await page.evaluate(()=>{window.delayedRefresh=refresh();});
    for(let i=0;!staleResponse && i<300;i++)await page.waitForTimeout(10);assert.ok(staleResponse);
    const held=[];await page.route('**/api/quadrant/*',route=>{held.push(route);});
    async function waitRequests(count,requests=held){for(let i=0;requests.length<count && i<300;i++)await page.waitForTimeout(10);assert.equal(requests.length,count,'expected save requests arrive');}
    const first=await drag(ids[0],.77,.25);
    let actual=await card(ids[0]).boundingBox();assert.ok(Math.abs(actual.x-first.x)<2 && Math.abs(actual.y-first.y)<2,'drop lands immediately while request is held');
    assert.equal(await page.locator('.planning-ghost').count(),0);assert.equal(await page.locator('#board').getAttribute('data-busy'),null);
    await drag(ids[0],.23,.25);await drag(ids[0],.77,.75);const latest=await state(ids[0]);
    const lastPreview=await drag(ids[1],.23,.75);actual=await card(ids[1]).boundingBox();
    assert.ok(Math.abs(actual.x-lastPreview.x)<2 && Math.abs(actual.y-lastPreview.y)<2,'placing the last inbox card must not shift the canvas');await waitRequests(2);
    await page.evaluate(()=>refresh({poll:true}));assert.equal(await page.evaluate(()=>originalChart===document.querySelector('.quadrant-chart')),true,'polling cannot replace a pending scene');
    await held[0].continue();await page.waitForFunction(id=>quadrantPositions[id]?.revision===1,ids[0]);
    assert.equal((await state(ids[0])).x,latest.x,'an older response must not undo the newest drop');assert.equal((await state(ids[0])).y,latest.y);
    await waitRequests(3);assert.equal(held[2].request().postDataJSON().revision,1,'next write uses the acknowledged revision');
    await held[1].continue();await held[2].continue();await page.waitForFunction(()=>!quadrantWrites.size);await page.unroute('**/api/quadrant/*');
    assert.equal(saved(ids[0]).revision,2);assert.equal(saved(ids[0]).x,latest.x);assert.equal(saved(ids[0]).y,latest.y);
    await staleRoute.fulfill({response:staleResponse});await page.evaluate(()=>delayedRefresh);await page.unroute('**/api/sync');
    assert.equal((await state(ids[0]))?.revision,2,'a refresh started before dragging cannot overwrite completed saves');
    assert.equal(await page.evaluate(()=>originalChart===document.querySelector('.quadrant-chart') && originalCards.every(n=>n.isConnected)),true,'successful saves preserve the scene and card nodes');
    // A user-requested refresh (for example after editing a card) runs after pending moves.
    held.length=0;await page.route('**/api/quadrant/*',route=>{held.push(route);});await drag(ids[0],.77,.25);await waitRequests(1);
    await page.evaluate(async id=>{const task=tasks.find(t=>t.id===id);await api(`/api/tasks/${id}`,'PATCH',{revision:task.revision,title:'虚构卡片已编辑'});await refresh();},ids[0]);
    await held[0].continue();await page.waitForFunction(()=>!quadrantWrites.size && !syncBusy);await page.unroute('**/api/quadrant/*');
    assert.equal(await page.evaluate(id=>tasks.find(t=>t.id===id).title,ids[0]),'虚构卡片已编辑','deferred refresh preserves edits made during a move save');
    // Invalid/cancelled drags keep the last saved location; failures restore it.
    const before=await state(ids[0]);await drag(ids[0],.5,.5);assert.deepEqual(await state(ids[0]),before);
    await drag(ids[0],.23,.25,{release:false});if(touch)await send('touchCancel');else await card(ids[0]).dispatchEvent('pointercancel',{pointerId:1});
    if(!touch)await page.mouse.up();assert.deepEqual(await state(ids[0]),before);assert.equal(await page.locator('.planning-ghost').count(),0);
    await page.route('**/api/quadrant/*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败'})}));
    await drag(ids[0],.23,.25);await page.waitForFunction(()=>!quadrantWrites.size && !syncBusy);assert.deepEqual(await state(ids[0]),before);assert.match(await page.locator('#toast').innerText(),/位置未保存/);await page.unroute('**/api/quadrant/*');
    const remote={...before,revision:before.revision+1,x:-200,y:150};database.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(remote),`quadrant:${ids[0]}`);
    await drag(ids[0],.77,.75);await page.waitForFunction(({id,revision})=>!quadrantWrites.size && quadrantPositions[id]?.revision===revision,{id:ids[0],revision:remote.revision});assert.deepEqual(await state(ids[0]),remote,'conflicts recover the other device position');
    await page.reload();await page.locator('#workspace').waitFor();assert.deepEqual(await state(ids[0]),remote,'position persists after reload');
    await page.evaluate(()=>{overviewView='quadrants';render();});await page.locator('#board').evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-16));
    const late=[];await page.route('**/api/quadrant/*',route=>{late.push(route);});await drag(ids[0],.77,.75);await page.waitForFunction(()=>quadrantWrites.size===1);
    await waitRequests(1,late);await page.evaluate(()=>showLogin());await late[0].continue();await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>quadrantPositions),{});assert.equal(await page.evaluate(()=>quadrantWrites.size),0,'late responses cannot affect a logged-out session');
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log(`PASS (${engine.name()}): hidden origin, pointer-following preview, immediate drops without scene replacement, rapid queued drags, independent cards, delayed responses, cancel/invalid drop, rollback/conflict, reload and session isolation at desktop/mobile widths.`);
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
