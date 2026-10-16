// Real MV3 extension, isolated browser profile, synthetic board and teaching sites only.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdtemp,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
execFileSync('python',['package-extension.py'],{stdio:'inherit'});
let extension=fileURLToPath(new URL('./extension/',import.meta.url)),baseline;
if(process.env.SOURCE_STATUS_BASELINE){
  baseline=await mkdtemp(join(tmpdir(),'rucapture-status-baseline-'));await cp(extension,baseline,{recursive:true});extension=baseline;
  for(const name of ['background.js','source-status.js','content.js','capture.js','board-bridge.js'])await writeFile(join(baseline,name),execFileSync('git',['show',`HEAD:extension/${name}`]));
}
const context=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',executablePath:process.env.BROWSER_EXECUTABLE,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
context.setDefaultTimeout(8000);
const boardURL='https://rucapture.pages.dev',site='https://www.ketangpai.com/',second='https://smartestu.cn/assignment',errors=[];
const html=body=>'<!doctype html><meta charset="utf-8"><body>'+body+'</body>';
try{
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/FutureV2/CourseMeans/getCourseContent')return route.fulfill({json:{data:{list:[{contenttype:4,id:1,title:'虚构课堂派作业',endtime:'2026-10-20 22:00:00',mstatus:1,courseid:1}]}}});
    if(url.origin===boardURL)return route.fulfill({contentType:'text/html',body:html(`<a id="site" href="${site}" target="_blank" rel="noopener noreferrer">课堂派</a>`)});
    if(url.origin===new URL(site).origin || url.origin===new URL(second).origin)return route.fulfill({contentType:'text/html',body:html('<h1>隔离测试页面</h1>')});
    return route.abort();
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async({boardURL,site,second})=>{
    globalThis.testConfig={account:'test-account',links:[{source:'ketangpai',url:site},{source:'smartestu',url:second}]};globalThis.imports=[];globalThis.configFailure=false;
    globalThis.fetch=async(address,init)=>{
      if(address.endsWith('/api/collector-config'))return configFailure?Response.json({error:'fixture unavailable'},{status:503}):Response.json(testConfig);
      if(address.endsWith('/api/import')){imports.push(JSON.parse(init.body));return Response.json({changed:1});}
      throw new Error('Unexpected test request');
    };
    await new Promise(resolve=>setTimeout(resolve,500));
    await chrome.storage.local.set({boardURL,account:testConfig.account,token:'a'.repeat(48),enabled:true,configuredSources:['ketangpai','smartestu'],cloudEnabled:false});
  },{boardURL,site,second});
  async function until(check,label){const end=Date.now()+8000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error(label);}
  const board=await context.newPage();await board.goto(boardURL);
  async function command(command,extra={}){
    return board.evaluate(({command,extra})=>new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{removeEventListener('message',reply);reject(new Error('board command timed out'));},5000);
      function reply(event){if(event.data?.kind==='campus-board-reply' && event.data.id===id){clearTimeout(timer);removeEventListener('message',reply);resolve(event.data.result);}}
      addEventListener('message',reply);postMessage({kind:'campus-board-command',id,command,account:'test-account',...extra},location.origin);
    }),{command,extra});
  }
  assert.equal((await command('status')).connected,true);
  const page=await context.newPage();await page.goto(site);
  const status=page.locator('#rucapture-source-status');await status.waitFor();
  await command('configure',{enabled:false});
  await until(async()=>!await status.isVisible(),'pausing must hide the already-mounted card');
  await page.evaluate(()=>fetch('/FutureV2/CourseMeans/getCourseContent'));
  await page.reload();assert.equal(await status.isVisible(),false,'paused navigation stays hidden');
  assert.equal(await worker.evaluate(()=>imports.length),0,'paused pages never import');
  await page.evaluate(()=>fetch('/FutureV2/CourseMeans/getCourseContent'));
  await command('configure',{enabled:true});await status.waitFor();
  await until(async()=>(await worker.evaluate(()=>imports.length))>0,'pending page result imports after enabling');
  await worker.evaluate(()=>{testConfig.links=[];});
  assert.equal((await command('refresh-sources')).ok,true);
  await until(async()=>!await status.isVisible(),'removing the final link hides the live card');
  assert.deepEqual(await worker.evaluate(async()=>(await chrome.storage.local.get('configuredSources')).configuredSources),[]);
  await page.reload();assert.equal(await status.isVisible(),false);
  // Even a scan with no links must clear an old cached source list before reporting the empty configuration.
  await worker.evaluate(()=>chrome.storage.local.set({configuredSources:['ketangpai']}));
  assert.ok((await command('scan')).error);
  await until(async()=>!await status.isVisible(),'empty scan cannot retain a stale enabled card');
  // Initial context checks the server too, including deletion performed in another browser/device.
  await worker.evaluate(()=>chrome.storage.local.set({configuredSources:['ketangpai']}));
  await page.reload();await until(async()=>(await worker.evaluate(async()=>(await chrome.storage.local.get('configuredSources')).configuredSources)).length===0,'navigation refreshes stale configuration');
  assert.equal(await status.isVisible(),false);
  await worker.evaluate(({site,second})=>{testConfig.links=[{source:'ketangpai',url:site},{source:'smartestu',url:second}];},{site,second});
  await command('refresh-sources');await status.waitFor();
  const session=await context.newCDPSession(page);
  const closeCard=async()=>{
    const root=(await session.send('DOM.getDocument',{depth:-1,pierce:true})).root;
    const find=node=>node.nodeName==='BUTTON' && node.attributes?.includes('关闭同步提示')?node:[...(node.children || []),...(node.shadowRoots || [])].map(find).find(Boolean);
    const node=find(root);assert.ok(node,'accessible close button exists');const {model}=await session.send('DOM.getBoxModel',{nodeId:node.nodeId}),q=model.border;
    await page.mouse.click((q[0]+q[4])/2,(q[1]+q[5])/2);
  };
  await page.setViewportSize({width:320,height:640});const box=await status.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=320,'mobile card stays in viewport');
  await closeCard();await until(async()=>!await status.isVisible(),'manual close hides the entire card');
  const key=`source-status-dismissed:${boardURL}|test-account|ketangpai`;
  await until(()=>worker.evaluate(async key=>(await chrome.storage.local.get(key))[key]===true,key),'dismissal persisted');
  await page.evaluate(()=>fetch('/FutureV2/CourseMeans/getCourseContent'));await page.reload();assert.equal(await status.isVisible(),false,'refresh cannot reopen');
  const direct=await context.newPage();await direct.goto(site);assert.equal(await direct.locator('#rucapture-source-status').isVisible(),false,'direct navigation cannot reopen');
  const other=await context.newPage();await other.goto(second);await other.locator('#rucapture-source-status').waitFor();
  await worker.evaluate(async()=>{await scan(false,'ketangpai',true);});
  assert.equal(await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key),true,'automatic scan cannot reset dismissal');
  // A trusted click on a normal noopener board link reopens the card for the paired public account.
  const popupPromise=context.waitForEvent('page');await board.locator('#site').click();const reopened=await popupPromise;await reopened.waitForLoadState();await reopened.locator('#rucapture-source-status').waitFor();
  await page.bringToFront();await status.waitFor();await closeCard();
  await command('configure',{enabled:false});await command('configure',{enabled:true});
  assert.equal(await status.isVisible(),false,'toggling sync never resets manual dismissal');
  await command('scan',{source:'ketangpai'});await status.waitFor();
  await worker.evaluate(()=>{configFailure=true;});await page.reload();
  await page.waitForLoadState();assert.equal(await status.isVisible(),false,'failed configuration check stays hidden');
  assert.deepEqual(errors,[]);
  console.log('PASS: live pause/removal, empty and stale configs, close/reload/direct navigation, background scans, independent sites, board reopen, account binding, mobile fit and failed checks. Extension version remains 1.9.6.');
}finally{
  await context.close();
  if(baseline && resolve(baseline).startsWith(resolve(tmpdir())+String.raw`\rucapture-status-baseline-`))await rm(baseline,{recursive:true});
}
