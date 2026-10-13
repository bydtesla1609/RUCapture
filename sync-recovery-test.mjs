import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import './extension/parsers.js';
import './extension/ruc-adapters.js';

test('DOM deadlines use valid range ends and reject ambiguous, impossible or reversed dates',()=>{
  const deadline=CampusParsers.deadline;
  for(const separator of [' - ',' 至 ',' ～ ',' — ','，截止时间：'])assert.equal(deadline(`2026-09-29 19:00:00${separator}2026-10-13 23:59:59`),'2026-10-13T15:59:59.000Z');
  assert.equal(deadline('截止：2026年10月13日 23：59'),'2026-10-13T15:59:00.000Z');
  assert.equal(deadline('2026-10-13T23:59:59+08:00'),'2026-10-13T15:59:59.000Z');
  for(const value of ['2026-02-30 10:00','2026-10-13 10:00 - 2026-10-12 10:00','2026-02-30 10:00 - 2026-03-02 10:00','创建于2026-10-01 10:00 修改于2026-10-02 10:00','开始时间：2026-10-01 10:00','2026-10-13'])assert.equal(deadline(value),null,value);
});
test('automatic scans reuse tabs, stop after closure/login errors and skip authorized cloud sources',async()=>{
  const link={source:'smartestu',url:'https://smartestu.cn/assignment'};
  let saved={enabled:true,boardURL:'https://campus-task-board.pages.dev',token:'synthetic'},created=0,navigated=0,reloads=0,read=0;
  const tabs=new Map(),noop={addListener(){}},config={links:[link]};
  const context=vm.createContext({URL,AbortSignal,fetch:async()=>({ok:true,json:async()=>config}),chrome:{
    storage:{local:{get:async()=>structuredClone(saved),set:async data=>Object.assign(saved,structuredClone(data))}},action:{onClicked:noop,setBadgeText:async()=>{}},runtime:{onMessage:noop,onInstalled:noop,onStartup:noop},alarms:{onAlarm:noop},
    tabs:{create:async({url})=>{const tab={id:++created,url,active:false};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw new Error('closed');return tabs.get(id);},update:async(id,{url})=>{navigated++;tabs.get(id).url=url;},reload:async()=>{reloads++;},sendMessage:async()=>{read++;}}
  }});
  vm.runInContext(await readFile(new URL('./extension/background.js',import.meta.url),'utf8'),context);
  const scan=(automatic=true)=>vm.runInContext(`performScan(false,false,undefined,${automatic})`,context);
  await scan();await scan();assert.equal(created,1);assert.equal(reloads,1);
  tabs.get(1).active=true;await scan();assert.equal(created,1);assert.equal(read,1);assert.equal(navigated,1);
  tabs.get(1).active=false;tabs.get(1).url='https://login.example/sso';await scan();await scan();assert.equal(created,1);assert.equal(navigated,1);
  await scan(false);assert.equal(navigated,2,'manual recovery reuses the same tab');
  saved.sourceResults={};tabs.clear();await scan();await scan();assert.equal(created,1,'closed automatic tab never respawns');
  await scan(false);assert.equal(created,2,'user can explicitly reopen');
  saved.sourceResults={smartestu:{error:'登录已失效',time:new Date().toISOString()}};await scan();assert.equal(reloads,1);
  config.cloud_enabled=true;config.cloud_sources={smartestu:{authorized:true}};saved.sourceResults={};tabs.clear();await scan(false);assert.equal(created,2,'cloud synchronization needs no tabs');
});
test('empty supported lists and explicit partial problem progress, without guessing scores or dates',()=>{
  const {parse,progress}=CampusParsers;
  assert.deepEqual(parse('smartestu','/api/homework/student/mark/queryHomeworks',{data:{courseHomeworkDTOList:[]}}),[]);
  assert.equal(parse('smartestu','/api/homework/student/mark/queryHomeworks',{data:{}}),null);
  assert.deepEqual(parse('ketangpai','/FutureV2/CourseMeans/getCourseContent',{data:{list:[{contenttype:2,title:'课件'}]}}),[]);
  assert.throws(()=>parse('ketangpai','/FutureV2/CourseMeans/getCourseContent',{data:{list:[{unknown:true}]}}),/字段发生变化/);
  assert.equal(progress('部分提交'),'doing');assert.equal(progress('已完成 2/5 题'),'doing');assert.equal(progress('2/5题'),'doing');assert.equal(progress('已提交0/5'),'todo');assert.equal(progress('已完成5题，共5题'),'done');
  for(const value of ['2/5','成绩 2/5','2026/10/08','已结束','全班已提交 2/5','已完成6/5','已完成0/0'])assert.equal(progress(value),null,value);
  assert.equal(CampusParsers.chaoxingRows([{url:'https://mooc2-ans.chaoxing.com/work/task?workId=1&courseId=2',title:'练习',status:'已完成 2/5 题',time:''}],'https://mooc2-ans.chaoxing.com/work/list')[0].status,'doing');
});
