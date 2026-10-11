// Isolated browser/database: exercise interrupted mobile saves, never live data.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=await mkdtemp(join(tmpdir(),'rucapture-mobile-save-'));
const {env,database}=await createEnvironment(directory,'mobile-save-ui');
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>{localStorage.setItem('ruchecklist-demo:personal','seen');AbortSignal.timeout=undefined;});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.locator('#login').waitFor({state:'visible'});
  await mkdir('data/screenshots',{recursive:true});await page.screenshot({path:'data/screenshots/login-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#password').fill('mobile-save-ui');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
  const date='2098-03-15T09:00';
  for(const category of ['考试','作业','会议','活动','课程','记录']){
    await page.evaluate(category=>{newTaskCategory=category;openTask();},category);
    await page.locator('#task-title').fill(`手机保存${category}`);
    if(category==='作业')await page.locator('#due-at').fill(date);
    else if(category==='记录')await page.locator('#record-time').fill(date);
    else {await page.locator('#starts-at').fill(date);await page.locator('#ends-at').fill('2098-03-15T10:00');}
    if(category==='记录'){
      await page.locator('#attachment-input').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('mobile attachment')});
      await page.waitForFunction(()=>document.getElementById('upload-state').textContent.includes('上传完成'));
    }
    let requests=0;
    const interrupted=async route=>{
      if(route.request().method()!=='POST')return route.continue();
      requests++;
      if(requests===1){const result=await route.fetch();assert.equal(result.status(),201);return route.abort('failed');}
      return route.continue();
    };
    await page.route('**/api/tasks',interrupted);
    await page.locator('#save-task').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    await page.unroute('**/api/tasks',interrupted);
    assert.equal(requests,2);assert.equal(database.prepare('SELECT COUNT(*) n FROM tasks WHERE title=?').get(`手机保存${category}`).n,1);
  }
  // Both attempts fail before reaching the server: retain the draft for manual retry.
  await page.evaluate(()=>{newTaskCategory='记录';openTask();});await page.locator('#task-title').fill('断网后保留的草稿');
  await page.locator('#record-time').fill(date);await page.locator('#task-content').fill('内容仍在原处');
  const offline=route=>route.abort('failed');await page.route('**/api/tasks',offline);
  await page.locator('#save-task').click();await page.locator('#task-error').filter({hasText:'网络连接中断'}).waitFor();
  assert.equal(await page.locator('#task-content').inputValue(),'内容仍在原处');assert.equal(await page.locator('#save-task').isEnabled(),true);
  await page.unroute('**/api/tasks',offline);await page.locator('#save-task').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
  assert.equal(database.prepare('SELECT COUNT(*) n FROM tasks WHERE title=?').get('断网后保留的草稿').n,1);
  // Read requests recover, too; revisions still protect edits and deleted cards.
  let reads=0;await page.route('**/api/sync',route=>++reads===1?route.abort('failed'):route.continue());
  await page.evaluate(()=>refresh());assert.equal(reads,2);
  const saved=await page.evaluate(()=>tasks.find(t=>t.title==='手机保存记录'));
  const duplicate=await context.request.post(origin+'/api/tasks',{data:{...saved,attachments:saved.attachments.map(f=>f.id)}});assert.equal(duplicate.status(),200);
  const conflict=await context.request.post(origin+'/api/tasks',{data:{...saved,title:'不能覆盖已经保存的卡片',attachments:saved.attachments.map(f=>f.id)}});assert.equal(conflict.status(),409);
  const deleted=await context.request.delete(origin+`/api/tasks/${saved.id}`,{data:{revision:saved.revision}});assert.equal(deleted.status(),200);
  assert.equal((await context.request.post(origin+'/api/tasks',{data:{...saved,attachments:saved.attachments.map(f=>f.id)}})).status(),409);
  assert.deepEqual(errors,[]);console.log('Mobile save passed: six categories, attachments without AbortSignal.timeout, committed-but-lost responses, one retry without duplicates, offline drafts, recoverable refresh, conflict/deletion protection.');
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});
}
