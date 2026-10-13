import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.route('https://class.example/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="app"></main></body></html>'}));
  await page.goto('https://class.example/exam/my');
  for(const name of ['parsers.js','generic-parser.js'])await page.addScriptTag({content:await readFile(new URL('./extension/'+name,import.meta.url),'utf8')});
  // Screenshot-shaped collapse cards: no table, heading or title link; two date values in one field.
  const result=await page.evaluate(async()=>{
    const card=(n,state='已交卷')=>`<div class="el-collapse-item"><div class="el-collapse-item__header"><div class="title-line"><span class="exam-status">${state}</span><span class="exam-title">2026作业${n}</span></div><div class="exam-meta"><span>总分 20 pts</span><i class="calendar"></i><span class="exam-dates">2026-09-29 19:00:00 - 2026-10-13 23:59:59</span><span>120min</span></div></div><div hidden>隐藏的题目与答案</div></div>`;
    document.getElementById('app').innerHTML=`<h2>高等数学（信息学院）</h2><section>${card('3-1')}${card('3-2','未交卷')}</section><h3>已结束的考试</h3><section>${card('1-1')}</section>`;
    const rule=CampusGeneric.detect();
    const automatic=rule?await CampusGeneric.extract(rule,location.href):null;
    const manual=CampusGeneric.pickTitle(document.querySelector('.exam-title'));
    const due=document.querySelector('.exam-dates'),row=due.closest(manual.rows);
    const repaired=CampusGeneric.pickField({rows:'.title-line',title:':scope > span:nth-of-type(2)'},due,'due');
    const icon=CampusGeneric.pickField(manual,document.querySelector('.calendar'),'due');
    return {automatic,manualCanPickDue:!!row,manual:row?await CampusGeneric.extract(CampusGeneric.pickField(manual,due,'due'),location.href):null,repaired:await CampusGeneric.extract(repaired,location.href),icon:await CampusGeneric.extract(icon,location.href)};
  });
  assert.equal(result.automatic?.length,3,'automatic detection covers current and ended collapse cards');
  assert.equal(result.manualCanPickDue,true,'title picking selects the whole task including sibling deadline metadata');
  for(const tasks of [result.automatic,result.manual,result.repaired,result.icon]){
    assert.equal(tasks[0].title,'2026作业3-1');assert.equal(tasks[0].due_at,'2026-10-13T15:59:59.000Z');assert.equal(tasks[0].status,'done');assert.equal(tasks[1].status,'todo');
    assert.ok(!JSON.stringify(tasks).includes('隐藏的题目'));
  }
  assert.equal(await page.evaluate(async()=>{document.querySelectorAll('.exam-title').forEach(node=>node.removeAttribute('class'));return (await CampusGeneric.extract(CampusGeneric.detect(),location.href)).length;}),3,'plain text titles also support automatic detection');
  assert.equal(await page.evaluate(async()=>{document.querySelectorAll('.el-collapse-item').forEach((node,i)=>{if(i)node.remove();});return (await CampusGeneric.extract(CampusGeneric.detect(),location.href)).length;}),1,'single remaining collapse card is recognizable');
  const deadlines=await page.evaluate(async()=>{
    const values=['2026-09-29 19:00:00 至 2026-10-13 23:59:59','2026/09/29 19:00 ～ 2026/10/13 23:59','截止时间：2026年10月13日 23：59','2026-10-13T23:59:59+08:00','2026-02-30 23:59','创建于2026-09-01 10:00 修改于2026-09-02 10:00','开始时间：2026-10-01 10:00'];
    const results=[];
    for(const value of values){document.getElementById('app').innerHTML=`<article><a href="/task/1">测试作业</a><span>${value}</span></article>`;results.push((await CampusGeneric.extract({rows:'article',title:'a',due:'span'},location.href))[0].due_at);}
    return results;
  });
  assert.deepEqual(deadlines,['2026-10-13T15:59:59.000Z','2026-10-13T15:59:00.000Z','2026-10-13T15:59:00.000Z','2026-10-13T15:59:59.000Z',null,null,null]);
  console.log('PASS: collapse-card automatic/manual recognition, deadline ranges, completed/submitted states, hidden-content exclusion and ambiguous dates.');
}finally{await browser.close();}
