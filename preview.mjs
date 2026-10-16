// Local review only: isolated synthetic data, loopback binding, no cloud credentials.
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const directory=fileURLToPath(new URL('./data/planning-preview/',import.meta.url));
const {env,database}=await createEnvironment(directory);

const port=Number(process.env.PREVIEW_PORT || 8766),origin=`http://127.0.0.1:${port}`;
const api=async(path,method='GET',data)=>{
  const response=await worker.fetch(new Request(origin+path,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),{...env,TRIAL_AUTHENTICATED:true});
  const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
};
if(!database.prepare("SELECT 1 FROM settings WHERE key='planning_preview_seed'").get()){
  await api('/api/source-links','PUT',{urls:[]});await api('/api/notices/read','POST',{version:RELEASE.version});
  const stamp=new Date().toISOString(),day=offset=>new Date(Date.now()+offset*86400000).toISOString();
  const examples=[['高等数学 · 第三章练习','作业','doing','已完成前两题，接下来处理证明题。'],['整理本周课程笔记','作业','todo','先补全课堂例题，再整理疑问。'],['读书摘记：如何安排时间','记录','todo','想把一周中重要但不紧急的事安排下来。'],['周五学习交流会','活动','todo','带上本周遇到的一个问题。'],['准备期中复习提纲','考试','todo','先按章节归纳知识点。'],['今天的一点观察','记录','todo','待补充一段感受。']];
  const cards=[];
  for(const [title,category,status,content] of examples)cards.push(await api('/api/tasks','POST',{title,category,status,content,due_at:day(2),starts_at:category==='记录'?stamp:day(3),ends_at:day(3)}));
  for(const [index,x,y] of [[0,.58,.66],[2,-.7,.65],[3,.5,-.5]])await api(`/api/quadrant/${cards[index].id}`,'PUT',{revision:0,x,y});
  const focus=await api('/api/focus','POST',{id:'preview-focus',duration_minutes:25,task_ids:[cards[0].id],record:{category:'记录',title:'示例专注：整理证明思路',content:'总结与反思：先画出条件之间的关系，再尝试证明。',location:'图书馆',starts_at:stamp}});
  const stored=JSON.parse(database.prepare('SELECT value FROM settings WHERE key=?').get(`focus:${focus.id}`).value);stored.state="finished";stored.focused_seconds=1500;stored.started_at=new Date(Date.now()-31*60000).toISOString();stored.ends_at=new Date(Date.now()-6*60000).toISOString();
  database.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(stored),`focus:${focus.id}`);
  database.prepare("INSERT INTO settings(key,value) VALUES ('planning_preview_seed','1')").run();
}
const assets=env.ASSETS;
env.ASSETS={async fetch(request){
  const response=await assets.fetch(request),path=new URL(request.url).pathname;
  if(path==='/')return new Response((await response.text()).replace('id="app-version">v3.1.6','id="app-version">本地预览 · 规划与专注'),{headers:response.headers});
  if(path==='/app.js')return new Response('localStorage.setItem("ruchecklist-demo:personal","seen");sessionStorage.setItem("rucapture-focus:personal:preview-focus","1");\n'+await response.text(),{headers:response.headers});
  return response;
}};
const server=createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end('Local preview only');return;}
  try{
    const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Preview request failed');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local preview: ${origin}\nSynthetic data only; saved in data/planning-preview. No deployment.`));
