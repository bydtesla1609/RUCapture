// Isolated trial accounts and D1-style trigger counts; never uses a real user's browser or files.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {readFile,mkdir} from "node:fs/promises";
import trial from "./trial-worker.mjs";
import {sqliteBinding} from "./local.mjs";
process.env.TRIAL_UI_FIXTURE="1";
const {trialFixture}=await import("./trial-test.mjs");
const {env,database,invites,client}=await trialFixture();
env.DB=sqliteBinding(database,{includeTriggerChanges:true});
const account=(await client().api("/api/register","POST",{username:"attachment_qa",password:"Ab1234",invite:invites[0]})).data;
env.ASSETS={async fetch(request){const name=new URL(request.url).pathname.slice(1)||"index.html";return new Response(await readFile(new URL(`./static/${name}`,import.meta.url)),{headers:{"Content-Type":name.endsWith(".html")?"text/html":name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"image/svg+xml"}});}};
const server=createServer(async(req,res)=>{
  const result=await trial.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!["GET","HEAD"].includes(req.method)?{body:req,duplex:"half"}:{})}),env);
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,"127.0.0.1");await once(server,"listening");const origin=`http://localhost:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||"playwright");let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),page=await context.newPage(),errors=[];
  await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(id=>localStorage.setItem("ruchecklist-demo:"+id,"seen"),account.account);
  await page.goto(origin);await page.locator("#username").fill("attachment_qa");await page.locator("#password").fill("Ab1234");
  await page.locator("#login-form button[type=submit]").click();await page.locator("#workspace").waitFor();
  await page.waitForFunction(()=>messageReady);if(await page.locator("#messages-dialog").isVisible())await page.locator("#messages-read").click();
  await page.evaluate(()=>{newTaskCategory="记录";openTask();});await page.locator("#task-title").fill("附件空间验证");
  await page.locator("#attachment-storage").filter({hasText:"已用 0 KB / 5 MB"}).waitFor();
  assert.equal(await page.locator("#file-limit-hint").textContent(),"单个文件 ≤ 1 MB");
  await page.locator("#attachment-input").setInputFiles({name:"note.txt",mimeType:"text/plain",buffer:Buffer.alloc(14250)});
  await page.locator("#upload-state").filter({hasText:"上传完成"}).waitFor();
  assert.match(await page.locator("#attachment-storage").textContent(),/已用 14 KB/);
  let uploadRequests=0;page.on("request",request=>{if(request.method()==="POST"&&request.url().endsWith("/api/files"))uploadRequests++;});
  await page.locator("#attachment-input").setInputFiles({name:"too-large.txt",mimeType:"text/plain",buffer:Buffer.alloc(1024*1024+1)});
  await page.locator("#attachment-error").filter({hasText:"单个文件最多 1 MB"}).waitFor();assert.equal(uploadRequests,0);
  await page.locator("#attachment-input").setInputFiles(Array.from({length:5},(_,i)=>({name:`part-${i}.txt`,mimeType:"text/plain",buffer:Buffer.alloc(1024*1024)})));
  await page.locator("#attachment-error").filter({hasText:"账号附件空间不足"}).waitFor();
  await page.waitForFunction(()=>!uploading);assert.equal(uploadRequests,5);assert.equal(await page.locator("#task-attachments .resource-row").count(),5);
  assert.equal(await page.locator("#task-error").textContent(),"");assert.equal(await page.locator("#save-task").isEnabled(),true);
  assert.match(await page.locator("#attachment-storage").textContent(),/已用 4\.0 MB \/ 5 MB/);
  await mkdir("data/attachment-fix-20261011",{recursive:true});
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});await page.locator("#attachment-error").evaluate(node=>node.scrollIntoView({block:"center"}));
    const storage=await page.locator("#attachment-storage").boundingBox(),error=await page.locator("#attachment-error").boundingBox(),files=await page.locator("#task-attachments").boundingBox(),input=await page.locator("#attachment-input").boundingBox();
    assert.ok(storage.y<error.y&&error.y<files.y&&error.y<input.y,"usage and error precede files and picker");
    assert.ok(await page.evaluate(()=>document.getElementById("task-dialog").scrollWidth<=document.getElementById("task-dialog").clientWidth),"no horizontal overflow");
    await page.screenshot({path:`data/attachment-fix-20261011/attachments-${width}.png`});
  }
  await page.locator("#save-task").click();await page.locator("#task-dialog").waitFor({state:"hidden"});
  const saved=database.prepare("SELECT attachments FROM u1_tasks WHERE title='附件空间验证'").get();assert.equal(JSON.parse(saved.attachments).length,5);
  await page.evaluate(()=>{newTaskCategory="记录";openTask();});assert.equal(await page.locator("#attachment-error").textContent(),"");
  assert.match(await page.locator("#attachment-storage").textContent(),/已用 4\.0 MB/);assert.deepEqual(errors,[]);
  console.log("PASS: mobile/desktop quota and error placement, account scope, 1 MB preflight, partial uploads retained and saved, fresh editor clears error.");
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();}
