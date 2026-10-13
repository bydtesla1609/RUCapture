// Real MV3 extension, synthetic teaching sites/backend, fresh browser profile.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
execFileSync('python',['package-extension.py'],{stdio:'inherit'});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension=fileURLToPath(new URL('./extension/',import.meta.url));
const context=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',executablePath:process.env.BROWSER_EXECUTABLE,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const due='2026-10-13 23:59:59',range=`2026-09-29 19:00:00 - ${due}`;
const sites={weilai:'https://k.ruc.edu.cn/UserClient/homePage.html?v=202507310001',tuoj:'https://ruc.thusaac.com/',smartestu:'https://smartestu.cn/assignment',ketangpai:'https://www.ketangpai.com/',zhifz:'https://www.zhifz.com/#/zuoye',chaoxing:'https://mooc2-ans.chaoxing.com/mooc-ans/mooc2/work/list?courseId=9',yoj:'https://yoj.ruc.edu.cn/index.php/index/course/detail.html'};
let changed=false,readCount=0;
const html=body=>'<!doctype html><html><head><meta charset="utf-8"></head><body>'+body+'</body></html>';
try{
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),json=value=>route.fulfill({json:value});
    if(url.pathname==='/jiakt/adminApi/course/getMyLearnCourse')return json({stat:1,data:[{id:11,name:'课程甲',classesList:[{id:12}]}]});
    if(url.pathname==='/jiakt/historyApi/courseReleaseInfo/studentGlobalSearch'){readCount++;return json({stat:1,data:{totalPages:1,list:[{type:10,courseReleaseInfoId:101,name:'未来课堂作业',endTime:due,submitStatus:changed?1:0}]}});}
    if(url.pathname==='/api/course/list')return json({courses:[{_id:1,role:'student',archieved:false}]});
    if(url.pathname==='/api/course/1/info')return json({info:{title:'课程乙',contests:[{_id:20,title:'TUOJ 作业',status:'ended',endTime:due}]}});
    if(url.pathname==='/api/homework/student/mark/queryHomeworks')return json({data:{courseHomeworkDTOList:[{courseId:1,courseName:'课程丙',studentCourseHomeworkDTOList:[{id:1,name:'SmartEstu 作业',endTime:due,submission_status:changed?'completed':'submitted'}]}]}});
    if(url.pathname==='/FutureV2/CourseMeans/getCourseContent')return json({data:{list:[{contenttype:4,id:1,title:'课堂派作业',endtime:due,mstatus:1,courseid:1}]}});
    if(url.pathname==='/yonghu_ceyan')return json({result:true,data:[{'测验ID':1,'测验名称':'智夫子作业','状态':2,'科目名称':'课程丁','截止时间':due}]});
    if(request.resourceType()!=='document')return route.abort();
    let body='<h1>隔离测试教学网站</h1>';
    if(url.hostname==='k.ruc.edu.cn')body+=url.pathname.startsWith('/UserClient/')?'<iframe id="course" src="/course-frame.html"></iframe>':'<h2>课程中的作业列表</h2>';
    if(url.hostname.includes('chaoxing'))body+=`<div class="ulDiv"><li data="/mooc-ans/mooc2/work/task?courseId=9&workId=1"><p class="overHidden2">学习通作业</p><p class="status">已交</p><div class="time" title="${range}">${range}</div></li></div>`;
    if(url.hostname==='yoj.ruc.edu.cn')body+=`<table><thead><tr><th>作业名称</th><th>截止时间</th><th>完成进度</th></tr></thead><tbody><tr><td><a href="/index.php/index/contest/detail/pno/1.html">YOJ 作业</a></td><td>${range}</td><td>1/3题</td></tr></tbody></table>`;
    return route.fulfill({contentType:'text/html; charset=utf-8',body:html(body)});
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async sites=>{
    globalThis.imports=[];globalThis.rejectImport=false;
    globalThis.fetch=async(address,init)=>{
      if(address.endsWith('/api/collector-config'))return Response.json({account:'personal',links:Object.entries(sites).map(([source,url])=>({source,url}))});
      if(address.endsWith('/api/import')){if(rejectImport)return Response.json({error:'测试：服务暂不可用'},{status:500});imports.push(JSON.parse(init.body));return Response.json({changed:1});}
      throw new Error('Unexpected test request');
    };
    // Wait for extension installation startup before enabling collection, so it cannot open managed tabs during this test.
    await new Promise(resolve=>setTimeout(resolve,500));
    await chrome.storage.local.set({boardURL:'https://campus-task-board.pages.dev',account:'personal',token:'a'.repeat(48),enabled:true,configuredSources:Object.keys(sites),cloudEnabled:false});
  },sites);
  const page=await context.newPage(),session=await context.newCDPSession(page);page.on('pageerror',error=>console.error(error.message));
  const messages=async()=>(await session.send('Accessibility.getFullAXTree')).nodes.map(node=>node.name?.value || '').join('\n');
  async function until(check,label){const until=Date.now()+10000;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(label);}
  const imported=source=>worker.evaluate(source=>imports.filter(value=>value.source===source && value.tasks.length).at(-1),source);
  async function clickCardButton(label){
    const root=(await session.send('DOM.getDocument',{depth:-1,pierce:true})).root;
    const find=node=>node.nodeName==='BUTTON' && node.children?.some(child=>child.nodeValue===label)?node:[...(node.children || []),...(node.shadowRoots || [])].map(find).find(Boolean);
    const node=find(root);assert.ok(node,`visible native card button ${label}`);
    const {model}=await session.send('DOM.getBoxModel',{nodeId:node.nodeId}),quad=model.border;
    await page.mouse.click((quad[0]+quad[4])/2,(quad[1]+quad[5])/2);
  }
  const reread=()=>clickCardButton('重新读取');
  for(const [source,url] of Object.entries(sites)){
    await page.goto(url);await page.locator('#rucapture-source-status').waitFor();
    assert.equal(await page.locator('#rucapture-source-status').count(),1);
    await until(async()=>/已连接|已同步到看板/.test(await messages()),`${source} context`);
    if(source==='weilai'){
      const frame=page.frames().find(frame=>frame.url().endsWith('/course-frame.html'));assert.ok(frame);
      assert.equal(await frame.locator('#rucapture-source-status').count(),0,'status UI is top-level only');
      await frame.evaluate(()=>fetch('/jiakt/adminApi/course/getMyLearnCourse',{method:'POST',headers:{'content-type':'application/json'},body:'{"keyword":""}'}));
    }
    if(source==='tuoj')await page.evaluate(()=>fetch('/api/course/list'));
    if(source==='smartestu')await page.evaluate(()=>fetch('/api/homework/student/mark/queryHomeworks'));
    if(source==='ketangpai')await page.evaluate(()=>fetch('/FutureV2/CourseMeans/getCourseContent',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
    if(source==='zhifz')await page.evaluate(()=>fetch('/yonghu_ceyan?'+new URLSearchParams({UID:'1','类型':'2','状态':'[0,1]'})));
    try{await until(async()=>!!await imported(source),`${source} import`);}catch(error){console.error({readCount,feedback:await messages(),state:await worker.evaluate(async()=>({imports,results:(await chrome.storage.local.get('sourceResults')).sourceResults})),frames:await Promise.all(page.frames().map(frame=>frame.evaluate(()=>({url:location.href,parser:!!globalThis.RUCLists,parsers:!!globalThis.CampusParsers,routes:!!globalThis.CampusCloudRoutes,fetch:String(fetch).slice(0,150)}))))});throw error;}
    const payload=await imported(source);assert.equal(payload.tasks[0].due_at,'2026-10-13T15:59:59.000Z',source);
    assert.equal(payload.tasks.length,1,'replayed list states deduplicate');
    assert.equal(payload.tasks[0].status,{weilai:'todo',smartestu:'doing',ketangpai:'done',zhifz:'done',chaoxing:'done',yoj:'doing'}[source]);
    await until(async()=>(await messages()).includes('已同步到看板'),`${source} top-level feedback`);
    await clickCardButton('展开');assert.ok((await messages()).includes(payload.tasks[0].content));
    if(source==='weilai'){
      changed=true;const before=readCount;await reread();
      await until(async()=>(await imported(source))?.tasks[0].status==='done','iframe reread reaches latest status');assert.ok(readCount>before);changed=false;
      await page.locator('#course').evaluate(frame=>frame.src='/course-frame-next.html');
      await until(()=>Promise.resolve(page.frames().some(frame=>frame.url().endsWith('/course-frame-next.html'))),'iframe navigation');
      const frame=page.frames().find(frame=>frame.url().endsWith('/course-frame-next.html'));
      await frame.evaluate(()=>fetch('/jiakt/adminApi/course/getMyLearnCourse',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
      await until(async()=>(await imported(source))?.tasks[0].status==='todo','capture after iframe navigation');
    }
    if(source==='smartestu'){
      changed=true;await reread();await until(async()=>(await imported(source))?.tasks[0].status==='done','native API reread');
      await worker.evaluate(()=>{globalThis.rejectImport=true;});changed=false;await reread();
      await until(async()=>(await messages()).includes('测试：服务暂不可用'),'upload error must be visible');
      await worker.evaluate(()=>{globalThis.rejectImport=false;});await reread();
      await until(async()=>(await messages()).includes('已同步到看板'),'retry after server recovery');
    }
    console.log(`PASS: ${source} real MV3 collection, deadline, status and visible feedback.`);
  }
  await mkdir('data/screenshots',{recursive:true});await page.screenshot({path:'data/screenshots/source-status-native.png'});
  await page.setViewportSize({width:390,height:844});const box=await page.locator('#rucapture-source-status').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=390);await page.screenshot({path:'data/screenshots/source-status-mobile.png'});
  console.log('PASS: Future Classroom homepage query/child-frame navigation/reread; API retry; server error/recovery. All teaching data and backend responses synthetic.');
}finally{await context.close();}
