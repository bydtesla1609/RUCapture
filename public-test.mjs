import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {sqliteBinding} from './local.mjs';
import {accountStorageSchema,accountDatabase,trialSchema} from './trial-schema.mjs';
import trial,{runTrialCloud} from './trial-worker.mjs';
import {digest} from './worker.mjs';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');

test('public registration preserves legacy login, spans shards, protects admin, caps at 300 and makes persistence opt-in',async()=>{
  const {database,env,client,invites}=await trialFixture();const stores=[];
  try{
    const admin=client(),old=await admin.api('/api/register','POST',{username:'original_admin',password:'Ab1234',invite:invites[0]});assert.equal(old.status,200);
    const oldTask=(await admin.api('/api/tasks','POST',{title:'保留原任务',due_at:'2026-11-01T00:00:00Z'})).data;
    for(const [binding,slot,end] of [['STORE_A',31,120],['STORE_B',121,210],['STORE_C',211,300]]){
      const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(accountStorageSchema(slot,end));env[binding]=sqliteBinding(db);stores.push(db);
    }
    env.PUBLIC_REGISTRATION='true';
    assert.equal((await client().api('/api/login','POST',{username:'original_admin',password:'Ab1234'})).status,200);
    assert.equal((await admin.api('/api/tasks/'+oldTask.id)).data.title,'保留原任务');
    let n=2;const clients=[];
    for(const target of [31,121,211,300]){
      for(;n<target;n++)database.prepare("INSERT INTO trial_users(id,slot,username,status,created_at) VALUES (?,?,?,'active',0)").run('existing-'+n,n,'existing_'+n);
      const c=client(),registered=await c.api('/api/register','POST',{username:'public_'+target,password:'Ab1234',remember:target===31},{'CF-Connecting-IP':'ip-'+target});
      assert.equal(registered.status,200,JSON.stringify(registered.data));assert.equal(registered.data.admin,false);
      assert.equal(registered.headers.get('Set-Cookie').includes('Max-Age=2592000'),target===31);
      const board=(await c.api('/api/board')).data;assert.equal(board.tasks.length,0);
      const axis=(await c.api('/api/axes','POST',{title:'private '+target})).data;
      const task=(await c.api('/api/tasks','POST',{category:'记录',title:'Only '+target,starts_at:'2026-10-06T06:00:00Z',axis_id:axis.id,status:'done'})).data;
      assert.equal(task.status,'done');assert.equal((await c.api('/api/announcements','POST',{content:'cannot publish'})).status,403);
      for(const other of clients)assert.equal((await other.api('/api/tasks/'+task.id)).status,404);
      clients.push(c);n=target+1;
    }
    const stats=(await client().api('/api/session')).data;assert.equal(stats.registered,300);assert.equal(stats.capacity,300);assert.equal(stats.registration_open,false);
    assert.equal((await client().api('/api/register','POST',{username:'over_capacity',password:'Ab1234'})).status,403);
    const session=await client().api('/api/login','POST',{username:'public_31',password:'Ab1234',remember:false});assert.equal(session.status,200);assert.ok(!session.headers.get('Set-Cookie').includes('Max-Age'));
    assert.equal((await clients[0].api('/api/recover','POST',{username:'original_admin',password:'New123',recovery:'invalid'})).status,401);
    assert.throws(()=>accountDatabase(env,301));assert.throws(()=>accountDatabase({...env,STORE_A:null},31));
  }finally{database.close();for(const db of stores)db.close();}
});

test('collector pairing spans database boundaries, isolates accounts and preserves authorization on failed renewal',async()=>{
  const {database,env}=await trialFixture(),stores=[];
  const accounts=[];
  const api=async(path,method='GET',headers={},body)=>{
    const response=await trial.fetch(new Request('https://rucapture.pages.dev'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return {status:response.status,data:await response.json()};
  };
  const bearer=token=>({Authorization:'Bearer '+token});
  try{
    for(const [binding,start,end] of [['STORE_A',31,120],['STORE_B',121,210],['STORE_C',211,300]]){
      const store=new DatabaseSync(':memory:');store.exec(accountStorageSchema(start,end));env[binding]=sqliteBinding(store);stores.push(store);
    }
    assert.equal((await api('/api/collector-token','POST',{},{})).status,401);
    for(const slot of [1,30,31,120,121,210,211,300]){
      const id='collector-'+slot,session='session-'+slot,cookie={Cookie:'trial_session='+session};
      database.prepare("INSERT INTO trial_users(id,slot,username,status,created_at) VALUES (?,?,?,'active',0)").run(id,slot,'collector_'+slot);
      database.prepare('INSERT INTO trial_sessions(hash,user_id,expires) VALUES (?,?,?)').run(await digest(session),id,Date.now()+60000);
      const storage=accountDatabase(env,slot);
      // An existing account's old per-account hash must not override the central registry.
      await storage.prepare(`INSERT INTO u${slot}_settings(key,value) VALUES ('collector_hash','legacy-hash')`).run();
      const previous=slot.toString(16).padStart(48,'0');
      database.prepare('INSERT INTO trial_collectors(hash,user_id) VALUES (?,?)').run(await digest(previous),id);
      assert.equal((await api('/api/collector-config','GET',bearer(previous))).data.account,id);
      const issued=await api('/api/collector-token','POST',cookie,{});
      assert.equal(issued.status,200,`slot ${slot}: ${JSON.stringify(issued.data)}`);
      const token=issued.data.token;assert.match(token,/^[a-f0-9]{48}$/);
      assert.equal((await api('/api/collector-config','GET',bearer(previous))).status,401);
      const config=await api('/api/collector-config','GET',bearer(token));
      assert.equal(config.status,200);assert.equal(config.data.account,id);
      accounts.push({id,slot,cookie,token,storage});
    }
    for(const account of accounts){
      assert.equal((await account.storage.prepare(`SELECT value FROM u${account.slot}_settings WHERE key='collector_hash'`).first()).value,'legacy-hash');
      const imported=await api('/api/import','POST',bearer(account.token),{source:'smartestu',tasks:[{external_id:'shared-id',title:account.id,status:'todo'}]});
      assert.equal(imported.status,200);assert.equal(imported.data.changed,1);
      const tasks=await account.storage.prepare(`SELECT title FROM u${account.slot}_tasks`).all();
      assert.deepEqual(tasks.results.map(task=>task.title),[account.id]);
      assert.equal((await api('/api/board','GET',bearer(account.token))).status,401);
      assert.equal((await api('/api/collector-config','GET',account.cookie)).status,401);
      const renewed=await api('/api/collector-token','POST',account.cookie,{});assert.equal(renewed.status,200);
      assert.equal((await api('/api/collector-config','GET',bearer(account.token))).status,401);
      account.token=renewed.data.token;
      assert.equal((await api('/api/collector-config','GET',bearer(account.token))).data.account,account.id);
    }
    const account=accounts.find(account=>account.slot===31),other=accounts[0];
    assert.equal((await api('/api/collector-config','GET',{...other.cookie,...bearer(account.token)})).data.account,account.id);
    database.exec("CREATE TRIGGER fail_collector_renewal BEFORE UPDATE ON trial_collectors BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END;");
    assert.equal((await api('/api/collector-token','POST',account.cookie,{})).status,500);
    assert.equal((await api('/api/collector-config','GET',bearer(account.token))).status,200);
    database.exec('DROP TRIGGER fail_collector_renewal');
    const retried=await api('/api/collector-token','POST',account.cookie,{});assert.equal(retried.status,200);
    account.token=retried.data.token;
    assert.equal((await api('/api/collector-config','GET',bearer(account.token))).status,200);
    database.prepare('DELETE FROM trial_collectors WHERE user_id=?').run(account.id);
    assert.equal((await api('/api/collector-config','GET',bearer(account.token))).status,401);
    assert.equal((await api('/api/collector-config','GET',bearer(other.token))).status,200);
    for(const [path,method] of [['/api/collector-config','GET'],['/api/import','POST'],['/api/academic/timetable','POST'],['/api/cloud-authorize','POST'],['/api/cloud-credentials','POST']]){
      for(const token of [undefined,'f'.repeat(48),account.token]){
        assert.equal((await api(path,method,{...account.cookie,...(token?bearer(token):{})},method==='POST'?{}:undefined)).status,401);
      }
    }
  }finally{database.close();for(const store of stores)store.close();}
});

test('account capacity migration preserves users, existing sessions, collector ownership and feedback foreign keys',async()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec('PRAGMA foreign_keys=ON');db.exec(trialSchema().replace('CHECK(slot BETWEEN 1 AND 300)','CHECK(slot BETWEEN 1 AND 30)'));
    db.exec("INSERT INTO trial_users(id,slot,username,auth_id,recovery_hash,status,created_at) VALUES ('owner',1,'admin','provider-id','keep-hash','active',123); INSERT INTO trial_sessions VALUES ('session-hash','owner',9999999999999); INSERT INTO trial_collectors VALUES ('collector-hash','owner');");
    const before=db.prepare('SELECT * FROM trial_users').all();db.exec('DROP INDEX trial_users_status');db.exec('BEGIN');db.exec(await readFile('migrations/0009_public_accounts.sql','utf8'));db.exec('COMMIT');
    assert.deepEqual(db.prepare('SELECT * FROM trial_users').all(),before);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('SELECT user_id FROM trial_sessions').get().user_id,'owner');assert.equal(db.prepare('SELECT user_id FROM trial_collectors').get().user_id,'owner');
    db.prepare('INSERT INTO trial_users(id,slot,username,created_at) VALUES (?,?,?,0)').run('last',300,'last_user');
  }finally{db.close();}
});

test('saved axis layout is per-account and revision guarded, including all node kinds and viewport',async()=>{
  const {database,client,invites}=await trialFixture();try{
    const a=client(),b=client();for(const [i,c] of [a,b].entries())await c.api('/api/register','POST',{username:'layout_'+i,password:'Ab1234',invite:invites[i]});
    const axis=(await a.api('/api/axes','POST',{title:'Saved'})).data;
    const layout={camera:{x:123,y:45,z:.8},pivot:0,anchor:0,lines:[{id:axis.id,nodes:[{id:'head',x:-32,y:90},{id:'tail',x:230,y:155}]}]};
    assert.equal((await b.api('/api/axis-layout','PUT',{layout,revision:0})).status,400);
    const saved=await a.api('/api/axis-layout','PUT',{layout,revision:0});assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
    assert.deepEqual((await a.api('/api/board')).data.axis_layout.layout,layout);assert.equal((await b.api('/api/board')).data.axis_layout.layout,null);
    assert.equal((await a.api('/api/axis-layout','PUT',{layout,revision:0})).status,409);
    assert.equal((await a.api('/api/axis-layout','PUT',{layout:{...layout,camera:{...layout.camera,z:5}},revision:1})).status,400);
    assert.equal((await a.api('/api/axis-layout','PUT',{layout,revision:1})).status,200);
  }finally{database.close();}
});

test('cloud dispatcher distributes active accounts over 60 minutes and internal endpoint rejects public calls',async()=>{
  const {database,env,client}=await trialFixture();try{
    for(const slot of [1,31,121,211,300])database.prepare("INSERT INTO trial_users(id,slot,username,status,created_at) VALUES (?,?,?,'active',0)").run('user-'+slot,slot,'cloud_'+slot);
    const seen=[];env.CLOUD_ENCRYPTION_KEY='12'.repeat(32);env.CLOUD_DISPATCH={async fetch(request){seen.push(Number(new URL(request.url).pathname.split('/').at(-1)));assert.match(request.headers.get('X-Sync-Signature'),/^[a-f0-9]{64}$/);return Response.json({ok:true});}};
    for(let minute=0;minute<60;minute++)await runTrialCloud(env,minute*60000);
    assert.deepEqual(seen.sort((a,b)=>a-b),[1,31,121,211,300]);
    assert.equal((await trial.fetch(new Request('https://rucapture.pages.dev/internal/sync/1',{method:'POST'}),env)).status,404);
    assert.equal((await client().api('/api/board')).status,401);
  }finally{database.close();}
});
