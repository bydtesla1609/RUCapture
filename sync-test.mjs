import test from 'node:test';
import assert from 'node:assert/strict';
import {syncSchema} from './sync.mjs';
import trial,{runTrialCloud} from './trial-worker.mjs';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');

test('incremental snapshots isolate accounts, capture device/import changes and skip unchanged board scans',async()=>{
  const {database,client,env,invites}=await trialFixture();
  try{
    const desktop=client(),phone=client(),other=client();
    await desktop.api('/api/register','POST',{username:'sync_user',password:'Ab1234',invite:invites[0]});
    await phone.api('/api/login','POST',{username:'sync_user',password:'Ab1234'});
    await other.api('/api/register','POST',{username:'sync_other',password:'Ab1234',invite:invites[1]});
    const first=(await phone.api('/api/sync')).data;assert.ok(first.sync_revision);assert.deepEqual(first.tasks,[]);
    const task=(await desktop.api('/api/tasks','POST',{category:'记录',title:'电脑新增',starts_at:'2026-10-10T00:00:00Z'})).data;
    let snapshot=(await phone.api('/api/sync?revision='+first.sync_revision)).data;
    assert.equal(snapshot.tasks[0].title,'电脑新增');assert.equal((await other.api('/api/sync')).data.tasks.length,0);
    await phone.api('/api/tasks/'+task.id,'PATCH',{revision:task.revision,title:'手机修改'});
    snapshot=(await desktop.api('/api/sync?revision='+snapshot.sync_revision)).data;assert.equal(snapshot.tasks[0].title,'手机修改');
    const persisted=database.prepare('SELECT * FROM u1_tasks').all(),marker=snapshot.sync_revision;
    database.exec(syncSchema('u1_'));database.exec(syncSchema('u1_'));
    assert.deepEqual(database.prepare('SELECT * FROM u1_tasks').all(),persisted);
    assert.equal(database.prepare("SELECT value FROM u1_settings WHERE key='sync_revision'").get().value,marker);
    const calls=[],base=env.DB;env.DB={...base,prepare(sql){calls.push(sql);return base.prepare(sql);}};
    for(let i=0;i<30;i++){
      const idle=(await phone.api('/api/sync?revision='+snapshot.sync_revision)).data;
      assert.equal(idle.unchanged,true);assert.equal(idle.tasks,undefined);assert.equal(idle.focus,undefined);
    }
    assert.ok(!calls.some(sql=>/FROM u1_tasks/i.test(sql)),'idle snapshots never scan the task table');env.DB=base;
    await desktop.api('/api/preferences','PUT',{effects:false});
    snapshot=(await phone.api('/api/sync?revision='+snapshot.sync_revision)).data;
    assert.equal(snapshot.effects,false);assert.equal((await other.api('/api/sync')).data.effects,true);
    const token=(await desktop.api('/api/collector-token','POST',{})).data.token;
    await desktop.api('/api/source-links','PUT',{urls:['https://smartestu.cn/assignment']});
    const collector=client(),payload={source:'smartestu',tasks:[{external_id:'fixture',title:'网站新作业',source_url:'https://smartestu.cn/assignment'}]};
    await collector.api('/api/import','POST',payload,{Authorization:'Bearer '+token});
    snapshot=(await phone.api('/api/sync?revision='+snapshot.sync_revision)).data;assert.ok(snapshot.tasks.some(x=>x.title==='网站新作业'));
    await collector.api('/api/import','POST',payload,{Authorization:'Bearer '+token});
    assert.equal((await phone.api('/api/sync?revision='+snapshot.sync_revision)).data.unchanged,true);
    assert.equal((await phone.api('/api/tasks/'+task.id,'DELETE',{revision:snapshot.tasks.find(x=>x.id===task.id).revision})).status,200);
    assert.ok(!(await desktop.api('/api/sync')).data.tasks.some(x=>x.id===task.id));
    assert.equal((await client().api('/api/sync')).status,401);
  }finally{database.close();}
});

test('300 cloud accounts run once per hour, five per minute, across consecutive hours',async()=>{
  const {database,env}=await trialFixture();
  try{
    for(let slot=1;slot<=300;slot++)database.prepare("INSERT INTO trial_users(id,slot,username,status,created_at) VALUES (?,?,?,'active',0)").run('u'+slot,slot,'user'+slot);
    let seen=[];env.CLOUD_ENCRYPTION_KEY='12'.repeat(32);env.CLOUD_DISPATCH={async fetch(request){seen.push(Number(new URL(request.url).pathname.split('/').at(-1)));return Response.json({ok:true});}};
    for(let hour=0;hour<2;hour++){
      seen=[];for(let minute=hour*60;minute<(hour+1)*60;minute++)assert.equal((await runTrialCloud(env,minute*60000)).length,5);
      assert.equal(seen.length,300);assert.equal(new Set(seen).size,300);assert.equal(Math.max(...seen),300);
    }
  }finally{database.close();}
});
