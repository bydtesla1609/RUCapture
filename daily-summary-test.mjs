import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');

test('daily summaries use Beijing completion dates, include archives, isolate accounts and store only the seen date',async()=>{
  const {database,client,invites}=await trialFixture();
  try{
    const desktop=client(),phone=client(),other=client(),anonymous=client();
    assert.equal((await anonymous.api('/api/daily-summary')).status,401);
    await desktop.api('/api/register','POST',{username:'summary_user',password:'Ab1234',invite:invites[0]});
    await phone.api('/api/login','POST',{username:'summary_user',password:'Ab1234'});
    await other.api('/api/register','POST',{username:'summary_other',password:'Ab1234',invite:invites[1]});
    const stamp=Date.now(),today=new Date(stamp+8*3600000).toISOString().slice(0,10),start=Date.parse(`${today}T00:00:00+08:00`);
    const add=async(title,time,flags={})=>{
      const response=await desktop.api('/api/tasks','POST',{category:'记录',title,starts_at:new Date(stamp).toISOString(),status:'done'});
      assert.equal(response.status,201);
      database.prepare('UPDATE u1_tasks SET completed_at=?,archived_at=?,deleted=?,status=? WHERE id=?').run(new Date(time).toISOString(),flags.archived?new Date(stamp).toISOString():null,flags.deleted?1:0,flags.reopened?'todo':'done',response.data.id);
      return response.data.id;
    };
    await add('昨天零点',start-86400000);
    await add('昨天最后一刻，已归档',start-1,{archived:true});
    await add('前天最后一刻',start-86400001);
    await add('今天零点',start);
    const completed=await add('刚刚完成',stamp);
    await add('将来的时间不计入',stamp+86400000);
    await add('已删除',stamp,{deleted:true});await add('重新开始',stamp,{reopened:true});
    const before=database.prepare('SELECT * FROM u1_settings ORDER BY key').all();
    const yesterday=(await desktop.api('/api/daily-summary?period=yesterday')).data;
    assert.deepEqual(yesterday.tasks.map(t=>t.title),['昨天零点','昨天最后一刻，已归档']);assert.ok(yesterday.tasks[1].archived_at);
    const current=(await phone.api('/api/daily-summary')).data;
    assert.equal(current.day,today);assert.deepEqual(current.tasks.map(t=>t.title),['今天零点','刚刚完成']);
    assert.deepEqual(database.prepare('SELECT * FROM u1_settings ORDER BY key').all(),before,'viewing a summary writes nothing');
    assert.deepEqual((await other.api('/api/daily-summary')).data.tasks,[]);
    assert.equal((await desktop.api('/api/daily-summary?period=arbitrary')).status,400);
    assert.equal((await desktop.api('/api/daily-summary/seen','POST',{day:'1900-01-01'})).status,400);
    assert.equal((await desktop.api('/api/daily-summary/seen','POST',{day:today})).status,200);
    const snapshot=(await phone.api('/api/sync')).data;
    assert.equal(snapshot.summary_seen_date,today);
    assert.equal((await other.api('/api/sync')).data.summary_seen_date,null);
    assert.equal((await phone.api('/api/sync?revision='+snapshot.sync_revision)).data.summary_seen_date,today,'seen state reaches idle devices too');
    assert.deepEqual(database.prepare("SELECT key,value FROM u1_settings WHERE key LIKE 'daily_summary%'").all().map(x=>({...x})),[{key:'daily_summary_seen',value:today}]);
    database.prepare("UPDATE u1_tasks SET status='todo',completed_at=NULL WHERE id=?").run(completed);
    assert.equal((await desktop.api('/api/daily-summary')).data.tasks.length,1,'each open derives fresh results, not a saved report');
  }finally{database.close();}
});
