// Isolated browser and database. All requests are confined to this local test server.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=await mkdtemp(join(tmpdir(),'rucapture-planning-ui-'));
const {env,database}=await createEnvironment(directory,'isolated-planning-ui');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
database.prepare("INSERT INTO settings(key,value) VALUES ('daily_summary_seen',?)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10));
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce',hasTouch:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.locator('#password').fill('isolated-planning-ui');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
  await page.evaluate(async()=>{
    for(const [title,category,status] of [['高等数学练习','作业','doing'],['读书摘记','记录','todo'],['课程安排','课程','todo'],['已完成练习','作业','done']])await api('/api/tasks','POST',{category,title,status,content:'测试卡片',starts_at:'2026-10-10T08:00:00Z',ends_at:'2026-10-10T09:00:00Z',due_at:'2026-10-11T15:00:00Z'});
    await refresh();
  });
  await page.locator('[data-view=quadrants]').click();assert.equal(await page.locator('.planning-list .planning-card').count(),2);
  const idle=()=>page.waitForFunction(()=>!document.getElementById('board').dataset.busy && !document.querySelector('.camera-moving'));
  async function zoomOut(){await page.getByRole('button',{name:'缩小象限画布',exact:true}).click();await idle();}
  async function directionLabels(){
    const viewport=await page.locator('.quadrant-chart').boundingBox(),labels=await page.locator('.quadrant-direction.drop-active,.quadrant-axis').evaluateAll(nodes=>nodes.map(node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height};}));
    assert.equal(labels.length,2);assert.equal(await page.locator('.quadrant-direction:visible').count(),0,'quadrant captions stay hidden without a dragged card');
    for(const [i,a] of labels.entries()){
      assert.ok(a.x>=viewport.x && a.y>=viewport.y && a.x+a.width<=viewport.x+viewport.width+1 && a.y+a.height<=viewport.y+viewport.height+1,'all direction labels remain visible');
      for(const b of labels.slice(i+1))assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y,'direction and axis labels do not overlap');
    }
  }
  async function drag(locator,x,y){const from=await locator.boundingBox(),plot=await page.locator('.quadrant-chart').boundingBox();await page.mouse.move(from.x+from.width*.5,from.y+from.height*.5);await page.mouse.down();await page.mouse.move(plot.x+plot.width*x,plot.y+plot.height*y,{steps:12});}
  async function dragToWorld(x,y){
    const card=page.locator('.placed-card'),from=await card.boundingBox(),plot=await page.locator('.quadrant-chart').boundingBox();
    const {scale,pan}=await page.evaluate(()=>({scale:quadrantZoom,pan:quadrantPan})),width=254*scale,height=90*scale;
    const target={x:plot.x+plot.width/2+pan.x+x*scale+width*(.33-.5),y:plot.y+plot.height/2+pan.y-y*scale+height*(.6-.5)};
    await page.mouse.move(from.x+from.width*.33,from.y+from.height*.6);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:15});
    const ghost=await page.locator('.planning-ghost').boundingBox();assert.ok(Math.abs(ghost.x+ghost.width*.33-target.x)<1,'pointer retains its horizontal grab point');assert.ok(Math.abs(ghost.y+ghost.height*.6-target.y)<1,'pointer retains its vertical grab point');
    await page.mouse.up();await idle();await page.waitForFunction(ghost=>{const placed=document.querySelector('.placed-card')?.getBoundingClientRect();return placed && Math.abs(placed.x-ghost.x)<1 && Math.abs(placed.y-ghost.y)<1;},ghost);
  }
  await drag(page.locator('.planning-list .planning-card').first(),.75,.25);assert.equal(await page.locator('.quadrant.drop-active').getAttribute('data-quadrant'),'紧急且重要');assert.equal(await page.locator('.quadrant-direction:visible').innerText(),'紧急且重要');await page.mouse.up();await idle();await directionLabels();
  assert.equal(await page.locator('.placed-card').count(),1);const firstPosition=await page.evaluate(()=>JSON.stringify(quadrantPositions));
  await drag(page.locator('.placed-card'),.5,.5);assert.equal(await page.locator('.quadrant.drop-active').count(),0);await page.mouse.up();assert.equal(await page.evaluate(()=>JSON.stringify(quadrantPositions)),firstPosition,'axis drops are rejected');
  await dragToWorld(220,160);
  await zoomOut();await zoomOut();await dragToWorld(-240,160);
  const plotBefore=await page.locator('.quadrant-chart').boundingBox(),cardBefore=await page.locator('.placed-card').boundingBox(),beforePan=await page.evaluate(()=>JSON.stringify(quadrantPositions));
  await page.mouse.move(plotBefore.x+8,plotBefore.y+8);await page.mouse.down();await page.mouse.move(plotBefore.x+128,plotBefore.y+78,{steps:15});await page.mouse.up();await idle();
  const cardAfter=await page.locator('.placed-card').boundingBox();assert.ok(Math.abs(cardAfter.x-cardBefore.x-120)<1 && Math.abs(cardAfter.y-cardBefore.y-70)<1,'blank canvas drags move the whole scene with the pointer');
  assert.equal(await page.evaluate(()=>JSON.stringify(quadrantPositions)),beforePan,'panning does not change card assignments');await directionLabels();await dragToWorld(-220,140);
  const camera=()=>page.evaluate(()=>({pan:quadrantPan,zoom:quadrantZoom})),beforeZoom=await camera(),anchor={x:Math.round(plotBefore.x+plotBefore.width*.62)-plotBefore.x,y:Math.round(plotBefore.y+plotBefore.height*.48)-plotBefore.y};
  await page.mouse.move(plotBefore.x+anchor.x,plotBefore.y+anchor.y);await page.mouse.wheel(0,120);await page.waitForFunction(old=>quadrantZoom<old,beforeZoom.zoom);const afterZoom=await camera();
  for(const [axis,size] of [['x','width'],['y','height']])assert.ok(Math.abs((anchor[axis]-plotBefore[size]/2-beforeZoom.pan[axis])/beforeZoom.zoom-(anchor[axis]-plotBefore[size]/2-afterZoom.pan[axis])/afterZoom.zoom)<.001,`wheel zoom preserves the world point under the cursor: ${JSON.stringify({axis,anchor,plotBefore,beforeZoom,afterZoom})}`);
  await dragToWorld(-240,160);await directionLabels();
  const touch=await context.newCDPSession(page),beforePinch=await camera(),touchPlot=await page.locator('.quadrant-chart').boundingBox(),touchCenter={x:Math.round(touchPlot.x+touchPlot.width/2),y:Math.round(touchPlot.y+touchPlot.height*.68)};
  const fingers=spread=>[1,2].map(id=>({id,x:touchCenter.x+(id===1?-spread:spread),y:touchCenter.y}));
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers(80)});
  for(const spread of [90,100,110,120])await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:fingers(spread)});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();const afterPinch=await camera();
  assert.ok(Math.abs(afterPinch.zoom/beforePinch.zoom-1.5)<.01,'two-finger pinch changes the scene scale');
  const single={id:1,x:Math.round(touchPlot.x+15),y:Math.round(touchPlot.y+15)};await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[single]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...single,x:single.x+35,y:single.y+25}]});await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await idle();
  assert.ok(Math.abs((await camera()).pan.x-afterPinch.pan.x-35)<1,'single-finger pan follows the pointer and cancellation releases the canvas');await touch.detach();
  const viewport=page.locator('.quadrant-viewport');await viewport.focus();
  for(let i=0;i<28;i++)await viewport.press('ArrowRight');for(let i=0;i<25;i++)await viewport.press('ArrowDown');
  await directionLabels();
  assert.equal(await page.locator('.offscreen-arrow').count(),1);
  const edge=await page.locator('.offscreen-arrow').boundingBox(),edgeCanvas=await page.locator('.quadrant-chart').boundingBox();
  assert.ok(edge.x>=edgeCanvas.x && edge.y>=edgeCanvas.y && edge.x+edge.width<=edgeCanvas.x+edgeCanvas.width && edge.y+edge.height<=edgeCanvas.y+edgeCanvas.height);
  await page.locator('.offscreen-arrow').click();await idle();
  assert.equal(await page.locator('.offscreen-arrow').count(),0,'locating the card makes it visible');
  await mkdir('data/screenshots',{recursive:true});await page.locator('.quadrant-viewport').screenshot({path:'data/screenshots/planning-pan-directions.png'});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'复位象限画布'}).click();await idle();assert.deepEqual((await camera()).pan,{x:0,y:0});await directionLabels();await page.emulateMedia({reducedMotion:'reduce'});
  for(let i=0;i<6;i++)await zoomOut();
  await dragToWorld(1000,600);assert.equal(await page.evaluate(()=>Object.values(quadrantPositions).find(p=>p.x!=null).space),'world');
  assert.ok(await page.evaluate(()=>Object.values(quadrantPositions).some(p=>p.x>900 && p.y>500)),'cards can be placed beyond the original viewport');
  const plotAfter=await page.locator('.quadrant-chart').boundingBox();assert.equal(plotAfter.width,plotBefore.width);assert.equal(plotAfter.height,plotBefore.height,'zoom does not shrink the canvas surface');
  assert.equal(await page.locator('.quadrant-corner,.quadrant-feedback,.quadrant-toolbar,.quadrant-area').count(),0);
  const controlBox=await page.locator('.quadrant-viewport .canvas-controls').boundingBox();assert.ok(controlBox.x>=plotAfter.x && controlBox.y+controlBox.height<=plotAfter.y+plotAfter.height);
  for(const id of ['demo-button','sources-button']){
    const icon=await page.locator('#'+id+' .nav-icon').boundingBox(),focusIcon=await page.locator('#focus-button .nav-icon').boundingBox();
    assert.equal(focusIcon.x,icon.x);assert.equal(focusIcon.width,icon.width);
    const label=await page.locator('#'+id+'>span').boundingBox(),focusLabel=await page.locator('#focus-button>span').first().boundingBox();assert.equal(focusLabel.x,label.x);
  }
  await page.getByRole('button',{name:'复位象限画布'}).click();await idle();
  const savedPosition=await page.evaluate(()=>JSON.stringify(quadrantPositions));await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();await page.locator('[data-view=quadrants]').click();assert.equal(await page.evaluate(()=>JSON.stringify(quadrantPositions)),savedPosition);
  assert.equal(await page.locator('.planning-card select').count(),0);
  // Sort fixtures deliberately arrive in reverse type order and mixed time order.
  await page.evaluate(async()=>{
    for(const [i,[x,y]] of [[1,1],[1,-1],[-1,1],[-1,-1]].entries()){
      for(const category of ['记录','活动','会议','作业','考试']){
        const task=await api('/api/tasks','POST',{category,title:`顺序${i+1}-${category}`,status:'todo',due_at:'2026-10-12T08:00:00Z',starts_at:'2026-10-12T08:00:00Z',ends_at:'2026-10-12T09:00:00Z'});
        await api(`/api/quadrant/${task.id}`,'PUT',{revision:0,x:x*.55,y:y*.55});
      }
    }
    for(let i=12;i>=1;i--)await api('/api/tasks','POST',{category:'记录',title:`待安排${i}`,starts_at:`2026-10-${String(i).padStart(2,'0')}T08:00:00Z`});
    await refresh();
  });
  const sidebar=await page.locator('.planning-pending').boundingBox(),canvas=await page.locator('.quadrant-viewport').boundingBox();assert.equal(sidebar.height,canvas.height);assert.equal(sidebar.y,canvas.y);
  assert.ok(await page.locator('.planning-list').evaluate(el=>el.scrollHeight>el.clientHeight),'overflow stays inside the inbox');
  assert.deepEqual(await page.locator('.planning-list .compact-task-info strong').allTextContents(),['待安排1','待安排2','待安排3','待安排4','待安排5','待安排6','待安排7','待安排8','待安排9','待安排10','待安排11','高等数学练习','待安排12']);
  await mkdir('data/screenshots',{recursive:true});await page.screenshot({path:'data/screenshots/planning-desktop.png',fullPage:true});
  await page.evaluate(()=>{
    const course=tasks.find(task=>task.category==='课程');
    localStorage.setItem(focusDraftKey(),JSON.stringify({session_id:null,record:{title:'旧草稿',content:'保留填写的信息'},task_ids:[course.id],duration_seconds:1500}));focusDraft=null;
  });
  await page.locator('#focus-button').click();await page.locator('#focus-settings').waitFor({state:'visible'});
  assert.equal(await page.locator('#focus-tasks [data-category="课程"]').count(),0,'courses cannot be selected or restored from a draft');
  assert.deepEqual(await page.evaluate(()=>focusDraft.task_ids),[]);
  assert.equal(await page.locator('#task-content').inputValue(),'保留填写的信息');
  await page.evaluate(()=>{focusDraft.record.title=focusDefaultTitle();renderFocusInformation();});
  const ordered=(await page.locator('#focus-tasks .compact-task-info strong').allTextContents()).filter(t=>t.startsWith('顺序'));
  assert.deepEqual(ordered,[1,2,3,4].flatMap(i=>['考试','作业','会议','活动','记录'].map(type=>`顺序${i}-${type}`)));
  assert.equal(await page.locator('#task-location').isVisible(),false);assert.equal(await page.locator('#record-time').isVisible(),false);assert.equal(await page.locator('#focus-tools,#focus-new').count(),0);
  assert.equal(await page.locator('#task-content').getAttribute('placeholder'),'这段时间想做什么？做到了哪一步，还有哪里没弄懂？都可以记在这里。');
  assert.match(await page.locator('#task-title').inputValue(),/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);assert.equal(await page.locator('#dialog-title').innerText(),'专注模式');assert.equal(await page.locator('#focus-state,#focus-started').count(),0);assert.equal(await page.locator('#task-form>.dialog-actions').isVisible(),false);assert.equal(await page.locator('#focus-end').isDisabled(),true);
  assert.ok(await page.locator('#focus-targets').evaluate(el=>el.previousElementSibling.id==='task-title'));assert.equal(await page.locator('.focus-target-label').innerText(),'目标卡片（选填，可多选）');
  const informationBefore=await page.evaluate(()=>structuredClone(focusDraft));
  await page.locator('#focus-edit-info').click();assert.equal(await page.locator('#focus-edit-info').isVisible(),false);assert.equal(await page.locator('#focus-save-info').isVisible(),true);
  await page.locator('#task-title').fill('取消的标题');await page.locator('#task-content').fill('取消的内容');await page.locator('#focus-tasks input').first().check();
  await page.getByRole('spinbutton',{name:'专注秒个位',exact:true}).press('ArrowUp');await page.locator('#focus-cancel-info').click();
  assert.equal(await page.locator('#task-title').inputValue(),informationBefore.record.title);assert.equal(await page.locator('#task-content').inputValue(),informationBefore.record.content);assert.equal(await page.locator('#focus-tasks input:checked').count(),0);
  assert.equal(await page.evaluate(()=>focusDuration),informationBefore.duration_seconds+1,'cancel rolls back information, never clock settings');assert.equal(await page.locator('#task-title').getAttribute('readonly'),'');
  assert.equal(await page.locator('#focus-cancel-info').isVisible(),false);assert.equal(await page.locator('#focus-save-info').isVisible(),false);assert.equal(await page.locator('#focus-edit-info').isVisible(),true);
  await page.getByRole('spinbutton',{name:'专注秒个位',exact:true}).press('ArrowDown');
  await page.locator('.focus-clock-panel').screenshot({path:'data/screenshots/focus-clock-desktop.png'});
  await page.locator('#focus-edit-info').click();await page.locator('#task-title').fill('先读书，再解题');await page.locator('#task-content').fill('先梳理概念，再独立尝试。');await page.locator('#focus-tasks input').first().check();
  assert.equal(await page.getByRole('spinbutton').count(),6);
  for(const [name,position] of [['时十位',0],['时个位',1],['分十位',2],['分个位',3],['秒十位',4],['秒个位',5]]){
    const before=await page.getByRole('spinbutton').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-valuenow'))),digit=page.getByRole('spinbutton',{name:`专注${name}`,exact:true});
    await digit.press('ArrowUp');const after=await page.getByRole('spinbutton').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-valuenow')));
    assert.deepEqual(after,before.map((value,index)=>index===position?String(Number(value)+1):value),'each clock position changes independently');await digit.press('ArrowDown');
  }
  const minuteTens=page.getByRole('spinbutton',{name:'专注分十位',exact:true}),digitBox=await minuteTens.boundingBox();
  await page.mouse.move(digitBox.x+digitBox.width/2,digitBox.y+digitBox.height/2);await page.mouse.down();await page.mouse.move(digitBox.x+digitBox.width/2,digitBox.y+digitBox.height/2-30,{steps:8});await page.mouse.up();assert.equal(await minuteTens.getAttribute('aria-valuenow'),'3');await minuteTens.press('ArrowDown');
  for(let i=0;i<2;i++)await minuteTens.press('ArrowDown');for(let i=0;i<4;i++)await page.getByRole('spinbutton',{name:'专注分个位',exact:true}).press('ArrowDown');
  await page.getByRole('button',{name:'增加1秒',exact:true}).click();
  const digits=()=>page.getByRole('spinbutton').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-valuenow')).join(''));
  await page.locator('#focus-reset').click();assert.equal(await digits(),'000000');assert.equal(await page.locator('#focus-toggle').isDisabled(),true);
  await page.getByRole('spinbutton',{name:'专注分个位',exact:true}).press('ArrowUp');await page.getByRole('spinbutton',{name:'专注秒个位',exact:true}).press('ArrowUp');
  const taskCount=await page.evaluate(()=>tasks.length),beforeButton=await page.locator('#focus-button').boundingBox();
  await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus());
  assert.equal(await page.locator('#task-dialog').isVisible(),true);assert.equal(await page.locator('#dialog-title').innerText(),'专注模式');
  assert.equal(await page.locator('#focus-toggle').innerText(),'The World！ 时间，停止吧！');assert.equal(await page.locator('#focus-end').isDisabled(),true);assert.equal(await page.locator('#focus-reset').isDisabled(),true);
  assert.equal(await page.getByRole('spinbutton').first().getAttribute('aria-disabled'),'true');assert.equal(await page.evaluate(()=>tasks.length),taskCount);
  const focus=(await page.evaluate(()=>focusSessions))[0];assert.equal(focus.selected.length,1);assert.equal(focus.duration_seconds,61);
  const runningColor=await page.locator('#focus-countdown').evaluate(el=>getComputedStyle(el).color);
  assert.equal((await page.locator('#focus-button').boundingBox()).y,beforeButton.y);assert.equal((await page.locator('#focus-button').boundingBox()).height,beforeButton.height);
  // Metadata can remain in edit mode throughout timer operations.
  await page.locator('#task-content').fill('计时中写下的内容');await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='paused');
  assert.equal(await page.locator('#focus-toggle').innerText(),'时间，再次流动！');assert.equal(await page.locator('#focus-end').isDisabled(),false);assert.notEqual(await page.locator('#focus-countdown').evaluate(el=>getComputedStyle(el).color),runningColor);
  const frozen=await digits();await page.evaluate(()=>{focusClockOffset+=3600000;tickFocus();});assert.equal(await digits(),frozen,'paused countdown does not advance with wall time');
  await page.locator('#task-content').fill('暂停时未点完成编辑的草稿');
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
  await page.locator('#focus-button').click();await page.locator('#focus-settings').waitFor({state:'visible'});await page.waitForFunction(()=>activeFocus()?.state==='paused');assert.equal(await digits(),frozen);assert.equal(await page.locator('#task-content').inputValue(),'暂停时未点完成编辑的草稿');
  await page.locator('#focus-edit-info').click();await page.locator('#task-content').fill('保存信息不会改变计时');await page.locator('#focus-save-info').click();await page.waitForFunction(()=>!focusActionBusy && !focusEditor.infoEditing);
  assert.equal(await digits(),frozen);assert.equal(await page.evaluate(()=>activeFocus().record.content),'保存信息不会改变计时');
  const savedInformation=await page.evaluate(()=>structuredClone({record:focusDraft.record,task_ids:focusDraft.task_ids}));
  await page.locator('#focus-edit-info').click();await page.locator('#task-title').fill('不会保存的标题');await page.locator('#task-content').fill('不会保存的内容');await page.locator('#focus-tasks input').first().uncheck();await page.locator('#focus-cancel-info').click();
  assert.deepEqual(await page.evaluate(()=>({record:focusDraft.record,task_ids:focusDraft.task_ids})),savedInformation);assert.equal(await digits(),frozen);assert.equal(await page.evaluate(()=>activeFocus().record.content),'保存信息不会改变计时');
  await page.locator('#focus-end').click();await page.locator('#focus-end-dialog').getByRole('button',{name:'关闭结束确认'}).click();
  await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='running');
  assert.equal(await page.locator('#focus-end').isDisabled(),true);assert.equal(await page.locator('#focus-toggle').innerText(),'The World！ 时间，停止吧！');
  await page.locator('#focus-edit-info').click();await page.locator('#task-content').fill('自然结束后选择保留的当前内容');
  // Expire only this disposable test clock, leaving the input in edit mode.
  const stored=JSON.parse(database.prepare('SELECT value FROM settings WHERE key=?').get(`focus:${focus.id}`).value);stored.ends_at=new Date(Date.now()-1000).toISOString();database.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(stored),`focus:${focus.id}`);
  await page.evaluate(()=>loadFocus());await page.locator('#focus-end-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#focus-end-message').innerText(),'要保存这次的用时和填写的内容吗？');
  assert.equal(await page.locator('.focus-history-row').count(),0,'completion waits for the retention decision');
  await page.locator('#focus-end-dialog button[value=save]').click();await page.waitForFunction(()=>!focusActionBusy && focusSessions[0]?.finalized);
  const historyCard=page.locator('.focus-history-row');await historyCard.waitFor();assert.equal(await historyCard.locator('.task-content').innerText(),'自然结束后选择保留的当前内容');
  assert.equal(await digits(),'000101');assert.equal(await page.locator('#dialog-title').innerText(),'专注模式');assert.equal(await page.locator('#focus-history details').count(),0);assert.equal(await page.locator('#focus-countdown').innerText(),'');
  await historyCard.getByRole('button',{name:/^导出为记录：/}).click();await historyCard.getByRole('button',{name:/^已导出为记录：/}).waitFor();
  const exported=await page.evaluate(()=>tasks.find(task=>task.title==='先读书，再解题'));assert.equal(exported.starts_at,stored.ends_at);assert.equal(await historyCard.count(),1);
  const actionBoxes=await historyCard.locator('.task-actions>button').evaluateAll(nodes=>nodes.map(node=>({y:node.getBoundingClientRect().y,height:node.getBoundingClientRect().height})));
  assert.equal(new Set(actionBoxes.map(box=>box.y)).size,1);assert.ok(actionBoxes.every(box=>box.height>=44));
  await page.locator('#focus-edit-info').click();await page.locator('#task-title').fill('下一次专注的草稿');
  await historyCard.getByRole('button',{name:/^编辑：/}).click();await historyCard.locator('.focus-inline-editor input').fill('尚未保存的编辑');
  await page.evaluate(()=>loadFocus());assert.equal(await historyCard.locator('.focus-inline-editor input').inputValue(),'尚未保存的编辑');assert.equal(await page.locator('#task-title').inputValue(),'下一次专注的草稿');
  await historyCard.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await historyCard.locator('.task-title').innerText(),'先读书，再解题');
  await historyCard.getByRole('button',{name:/^编辑：/}).click();await historyCard.locator('.focus-inline-editor input').fill('回顾这次专注');await historyCard.locator('.focus-inline-editor textarea').fill('卡片内补充的复盘');
  await historyCard.getByRole('button',{name:'保存',exact:true}).click();await historyCard.locator('.focus-inline-editor').waitFor({state:'hidden'});assert.equal(await historyCard.locator('.task-title').innerText(),'回顾这次专注');
  assert.equal(await page.locator('#task-title').inputValue(),'下一次专注的草稿');await historyCard.screenshot({path:'data/screenshots/focus-history-inline.png'});
  await historyCard.getByRole('button',{name:/^编辑：/}).click();await historyCard.locator('.focus-inline-editor').getByRole('button',{name:/^删除：/}).click();await page.locator('#action-confirm-accept').click();await page.waitForFunction(()=>focusSessions.length===0);
  assert.equal(await page.evaluate(()=>tasks.filter(task=>task.title==='先读书，再解题').length),1);
  // Explicit end offers save or discard, and includes inputs still being edited.
  for(const save of [true,false]){
    await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='running');
    await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='paused');
    if(!await page.evaluate(()=>focusEditor.infoEditing))await page.locator('#focus-edit-info').click();await page.locator('#task-content').fill('主动结束时的当前内容');
   await page.locator('#focus-end').click();await page.locator(`#focus-end-dialog button[value=${save?'save':'discard'}]`).click();await page.waitForFunction(()=>!focusActionBusy && !activeFocus());
    assert.equal(await page.locator('.focus-history-row').count(),1,'discard adds no history');assert.equal(await digits(),'000101');
    if(save)assert.equal(await page.locator('.focus-history-row .task-content').innerText(),'主动结束时的当前内容');
  }
  await page.locator('#task-dialog .close-dialog').first().click();
  await page.evaluate(()=>openTask(tasks.find(task=>task.category==='记录')));assert.equal(await page.locator('#task-location').isVisible(),false);assert.equal(await page.locator('#task-title').getAttribute('readonly'),null);await page.locator('#task-dialog .close-dialog').first().click();
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:900});await page.locator('[data-view=quadrants]').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no page overflow at ${width}`);await directionLabels();
    const source=page.locator('.planning-list .planning-card').first();await source.scrollIntoViewIfNeeded();await drag(source,.75,.25);await page.mouse.up();await idle();
    await page.locator('#mobile-nav-toggle').click();await page.locator('#focus-button').click();await page.locator('#focus-settings').waitFor({state:'visible'});await page.locator('#focus-edit-info').click();await page.locator('#task-title').fill('小屏专注');assert.ok(await page.evaluate(()=>document.getElementById('task-dialog').scrollWidth<=document.getElementById('task-dialog').clientWidth));
    const idleBounds=await page.locator('#mobile-nav-toggle').boundingBox();
    await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='running');
    const runningBounds=await page.locator('#mobile-nav-toggle').boundingBox();assert.equal(runningBounds.height,idleBounds.height);assert.equal(runningBounds.y,idleBounds.y);
    const fits=await page.locator('#focus-button').evaluate(el=>[...el.querySelectorAll('span')].every(span=>span.scrollWidth<=span.clientWidth));assert.ok(fits,`focus label and countdown fit at ${width}`);
    assert.ok(await page.locator('#task-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`running clock controls fit at ${width}`);
    if(width===390)await page.screenshot({path:'data/screenshots/focus-mobile.png',fullPage:true});
    await page.locator('#focus-toggle').click();await page.waitForFunction(()=>!focusActionBusy && activeFocus()?.state==='paused');await page.locator('#focus-end').click();await page.locator('#focus-end-dialog button[value=discard]').click();await page.waitForFunction(()=>!focusActionBusy && !activeFocus());
    await page.locator('#task-dialog .close-dialog').first().click();
  }
  assert.deepEqual(errors,[]);console.log('Planning UI passed: unbounded canvas pan/zoom, drag-only quadrant captions, accurate drops, six independent clock digits with swipe/keyboard controls, inline focus edit/delete, draft preservation, persistence, sorting, pause/resume, independent metadata cancel/save, natural/manual save/discard, timer/export, record fields, 320–1440px.');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\') || resolve(directory).startsWith(resolve(tmpdir())+'/'));await rm(directory,{recursive:true,force:true});
}
