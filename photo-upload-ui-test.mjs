// Synthetic photo files and disposable accounts only; no production data or personal photos.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import trial from './trial-worker.mjs';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');
const {env,database,invites,client}=await trialFixture();
const account=(await client().api('/api/register','POST',{username:'photo_qa',password:'Ab1234',invite:invites[0]})).data;
const baseline=process.env.PHOTO_BASELINE?execFileSync('git',['show','HEAD:static/app.js']):null;
env.ASSETS={async fetch(request){const name=new URL(request.url).pathname.slice(1)||'index.html';return new Response(name==='app.js' && baseline?baseline:await readFile(new URL(`./static/${name}`,import.meta.url)),{headers:{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'image/svg+xml'}});}};
const server=createServer(async(req,res)=>{
 const response=await trial.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 const headers=Object.fromEntries(response.headers);
 // This fixture is HTTP on loopback; production cookies remain Secure.
 if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].replace('; Secure','');
 res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const engines=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),engine=engines[process.env.MOBILE_BROWSER||'chromium'];let browser;
try{
 browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addInitScript(id=>localStorage.setItem('ruchecklist-demo:'+id,'seen'),account.account);
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await page.locator('#username').fill('photo_qa');await page.locator('#password').fill('Ab1234');await page.locator('#login-form button[type=submit]').tap();await page.locator('#workspace').waitFor();
 await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').tap();
 await page.evaluate(()=>{newTaskCategory='记录';openTask();});await page.locator('#task-title').fill('虚构手机相册验证');
 // A portrait photo with detailed texture and large readable labels, not padded fake JPEG data.
 const photoData=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=3200;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);let seed=13;
  for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);ctx.fillStyle='white';ctx.fillRect(100,100,2200,550);ctx.fillStyle='#203060';ctx.font='bold 100px sans-serif';ctx.fillText('SYNTHETIC PHOTO 123456',180,280);ctx.fillText('Top / portrait orientation',180,450);
  const data=canvas.toDataURL('image/jpeg',.96).split(',')[1];canvas.width=canvas.height=0;return data;
 });
 const original=Buffer.from(photoData,'base64');assert.ok(original.length>1024*1024);
 // Phone JPEGs may store rotation in EXIF rather than rotating their pixel array.
 const exif=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex');
 const rotated=Buffer.concat([original.subarray(0,2),exif,original.subarray(2)]);
 if(!baseline){
  const orientation=await page.evaluate(async base64=>{
   const file=new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'rotated.jpg',{type:'image/jpeg'}),processed=await prepareAttachment(file,1024*1024),url=URL.createObjectURL(processed);
   try{const image=new Image();image.src=url;await image.decode();return [image.naturalWidth,image.naturalHeight];}finally{URL.revokeObjectURL(url);}
  },rotated.toString('base64'));
  assert.ok(orientation[0]>orientation[1],'EXIF rotation must survive compression');
 }
 await page.locator('#attachment-input').setInputFiles({name:'camera.jpg',mimeType:'image/jpeg',buffer:original});await page.waitForFunction(()=>!uploading);
 assert.equal(await page.locator('#attachment-error').textContent(),'','a camera photo above 1 MB must be processed instead of rejected');
 let files=await page.evaluate(()=>draftAttachments);assert.equal(files.length,1);assert.ok(files[0].size>0 && files[0].size<=1024*1024);assert.equal(files[0].type,'image/jpeg');
 // A PNG screenshot and a blank-MIME photo exercise both classification paths.
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=1800;const x=c.getContext('2d');x.fillStyle='#f8f8ff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#172033';x.font='40px sans-serif';for(let i=0;i<30;i++)x.fillText(`Fixture line ${i+1}: algebra 123456`,40,60+i*55);const result=c.toDataURL('image/png').split(',')[1];c.width=c.height=0;return result;});
 const pngBytes=Buffer.from(png,'base64'),largePng=Buffer.concat([pngBytes,Buffer.alloc(1024*1024)]);
 await page.locator('#attachment-input').setInputFiles([{name:'notes.png',mimeType:'image/png',buffer:largePng},{name:'album.JPG',mimeType:'',buffer:original}]);await page.waitForFunction(()=>!uploading);
 assert.equal(await page.locator('#attachment-error').textContent(),'');files=await page.evaluate(()=>draftAttachments);assert.equal(files.length,3);assert.ok(files.every(file=>file.size<=1024*1024));
 // Failed photo decoding and interrupted uploads leave earlier attachments and the editor intact.
 await page.locator('#attachment-input').setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(1024*1024+1)});await page.waitForFunction(()=>!uploading);assert.match(await page.locator('#attachment-error').textContent(),/无法读取/);assert.equal((await page.evaluate(()=>draftAttachments)).length,3);
 await page.locator('#attachment-input').setInputFiles({name:'empty.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(0)});assert.match(await page.locator('#attachment-error').textContent(),/没有读取到内容/);
 const offline=route=>route.abort('failed');await page.route('**/api/files',offline);
 await page.locator('#attachment-input').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry fixture')});await page.waitForFunction(()=>!uploading);assert.match(await page.locator('#attachment-error').textContent(),/上传连接中断/);assert.equal(await page.locator('#task-title').inputValue(),'虚构手机相册验证');
 await page.unroute('**/api/files',offline);await page.locator('#attachment-input').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry fixture')});await page.waitForFunction(()=>!uploading);assert.equal(await page.locator('#attachment-error').textContent(),'');assert.equal((await page.evaluate(()=>draftAttachments)).length,4);
 await mkdir('data/screenshots/mobile-photos',{recursive:true});await page.locator('#attachment-storage').scrollIntoViewIfNeeded();await page.screenshot({path:`data/screenshots/mobile-photos/${process.env.MOBILE_BROWSER||'chromium'}.png`});
 await page.locator('#save-task').tap();await page.locator('#task-dialog').waitFor({state:'hidden'});
 // Read the saved photo through the protected attachment endpoint and decode the result.
 const download=await page.evaluate(async id=>{const response=await fetch('/api/files/'+id);return {status:response.status,type:response.headers.get('content-type'),bytes:[...new Uint8Array(await response.arrayBuffer())]};},files[0].id);assert.equal(download.status,200);assert.equal(download.type,'image/jpeg');
 assert.equal(download.bytes.length,files[0].size);assert.equal(download.bytes[0],255);assert.equal(download.bytes[1],216);
 const dimensions=await page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();return [image.naturalWidth,image.naturalHeight];},origin+`/api/files/${files[0].id}`);assert.ok(dimensions[1]>dimensions[0] && dimensions[1]>=1400,'portrait and readable dimensions preserved');
 assert.equal((await trial.fetch(new Request(origin+`/api/files/${files[0].id}`),env)).status,401);
 await page.reload();await page.locator('#workspace').waitFor();assert.equal(database.prepare("SELECT attachments FROM u1_tasks WHERE title='虚构手机相册验证'").get().attachments,JSON.stringify((await page.evaluate(()=>tasks.find(task=>task.title==='虚构手机相册验证').attachments)).map(file=>file.id)));
 assert.deepEqual(errors,[]);console.log(`PASS ${process.env.MOBILE_BROWSER||'chromium'}: oversized camera photo, EXIF rotation, PNG, missing MIME, sequential photos, bad/empty files, interrupted retry, saved preview, dimensions and private access.`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();}
