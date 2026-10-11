// Account-scoped settings reuse the existing storage and revision checks; no task migration.
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(value,status=200)=>Response.json(value,{status});
export const focusFileSQL="SELECT json_each.value FROM settings,json_each(json_extract(settings.value,'$.record.attachments')) WHERE settings.key LIKE 'focus:%' AND COALESCE(json_extract(settings.value,'$.ends_at'),'9999')>";
const duration=value=>value.duration_seconds ?? value.duration_minutes*60;
const state=(value,time=Date.now())=>value.state==="paused"?"paused":value.state==="finished" || Date.parse(value.ends_at)<=time?"finished":"running";
const remaining=(value,time=Date.now())=>value.state==="paused"?value.remaining_ms:Math.max(0,Date.parse(value.ends_at)-time);
export async function pruneFocus(db,time=Date.now()) {
  await db.prepare("DELETE FROM settings WHERE key LIKE 'focus:%' AND json_extract(value,'$.ends_at')<=?").bind(new Date(time-7*86400000).toISOString()).run();
}
export async function planningState(db) {
  const {results}=await db.prepare("SELECT key,value FROM settings WHERE key LIKE 'quadrant:%' AND EXISTS(SELECT 1 FROM tasks WHERE id=substr(settings.key,10) AND category<>'课程')").all();
  return Object.fromEntries(results.map(row=>[row.key.slice(9),JSON.parse(row.value)]));
}
export async function planningRoute(request,db,{body,validate,fileReferences,FIELDS,stored}) {
  const path=new URL(request.url).pathname,method=request.method;
  const position=path.match(/^\/api\/quadrant\/([a-zA-Z0-9-]{1,50})$/);
  if(position && method==="PUT") {
    const data=await body(request),{revision,x,y}=data;
    const world=data.space==="world";
    // World coordinates have no outer boundary; keep the 254 × 90 card clear of both axes.
    const valid=world?[x,y].every(Number.isFinite) && Math.abs(x)>=139 && Math.abs(y)>=57:[x,y].every(n=>Number.isFinite(n) && Math.abs(n)>=.08 && Math.abs(n)<=1);
    if(!Number.isInteger(revision) || revision<0 || data.space!==undefined && !world || (x!==null || y!==null) && !valid)fail(400,"请把卡片放入象限内，不能放在坐标轴上");
    if(!await db.prepare("SELECT 1 FROM tasks WHERE id=? AND deleted=0 AND archived_at IS NULL AND category<>'课程' AND status<>'done'").bind(position[1]).first())fail(409,"卡片已完成或已移出待处理列表，请刷新");
    const value={revision:revision+1,x,y,...(world?{space:"world"}:{})};
    const row=await db.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM settings WHERE key=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.revision')=? RETURNING value").bind(`quadrant:${position[1]}`,JSON.stringify(value),revision,`quadrant:${position[1]}`,revision).first();
    if(!row)fail(409,"该卡片的位置已在另一页面更新，请重试");return json(value);
  }
  if(!/^\/api\/focus(?:\/|$)/.test(path))return null;
  await pruneFocus(db);
  async function expose(value) {
    value={...value,selected:value.selected.filter(task=>task.category!=="课程")};
    const files=await fileReferences(value.record.attachments,db);
    const status=state(value);
    return {...value,state:status,finalized:value.state==="finished" || !value.state && status==="finished",duration_seconds:duration(value),remaining_ms:status==="finished"?0:remaining(value),focused_seconds:value.focused_seconds ?? (status==="finished"?duration(value):Math.max(0,(duration(value)*1000-remaining(value))/1000)),record:{...value.record,starts_at:value.ends_at,ends_at:value.ends_at,location:"",attachments:[...files.values()]},finished:status==="finished"};
  }
  if(path==="/api/focus" && method==="GET") {
    const {results}=await db.prepare("SELECT value FROM settings WHERE key LIKE 'focus:%' ORDER BY json_extract(value,'$.started_at') DESC").all();
    return json({sessions:await Promise.all(results.map(row=>expose(JSON.parse(row.value)))),server_time:new Date().toISOString()});
  }
  const match=path.match(/^\/api\/focus\/([a-zA-Z0-9-]{1,50})(\/(?:export|pause|resume|finish))?$/);
  const data=await body(request),stamp=new Date().toISOString();
  let previous;
  if(match){
    const row=await db.prepare("SELECT value FROM settings WHERE key=?").bind(`focus:${match[1]}`).first();
    if(!row)fail(404,"专注记录已删除或已超过七天");previous=JSON.parse(row.value);previous.selected=previous.selected.filter(task=>task.category!=="课程");
    if(!Number.isInteger(data.revision) || data.revision!==previous.revision)fail(409,"专注信息已在另一页面更新，请重新打开");
  }
  async function update(value){
    const row=await db.prepare("UPDATE settings SET value=? WHERE key=? AND json_extract(value,'$.revision')=? RETURNING value").bind(JSON.stringify({...value,revision:previous.revision+1}),`focus:${previous.id}`,data.revision).first();
    if(!row)fail(409,"专注记录已更新，请重新打开");return json(await expose(JSON.parse(row.value)));
  }
  async function information(ends_at){
    const recordTime=ends_at || previous?.record.starts_at || stamp;
    const record=validate({...data.record || previous?.record,category:"记录",starts_at:recordTime,ends_at:recordTime,location:""});
    await fileReferences(record.attachments,db);
    if(record.axis_id && !await db.prepare("SELECT 1 FROM axes WHERE id=? AND deleted=0").bind(record.axis_id).first())fail(400,"轴线不存在，请重新选择");
    const ids=data.task_ids ?? previous?.selected.map(task=>task.id);
    if(!Array.isArray(ids) || ids.length>200 || new Set(ids).size!==ids.length || ids.some(id=>typeof id!=="string" || !/^[a-zA-Z0-9-]{1,50}$/.test(id)))fail(400,"请选择最多 200 张任务卡片");
    // An in-progress draft may refer to a card completed or removed during this focus.
    const {results:available}=await db.prepare(`SELECT id,title,category,status,due_at,starts_at,ends_at,completed_at FROM tasks WHERE id IN (SELECT value FROM json_each(?))${previous?"":" AND deleted=0 AND archived_at IS NULL AND status<>'done'"}`).bind(JSON.stringify(ids)).all();
    const byId=new Map([...(previous?.selected || []),...available].map(task=>[task.id,task]));
    const selected=ids.map(id=>{const task=byId.get(id);if(!task)fail(400,"所选卡片已完成或不存在，请重新选择");if(task.category==="课程")fail(400,"课程不能加入专注，请选择作业、考试、会议、活动或记录");return task;});
    return {record,selected};
  }
  if(["/pause","/resume","/finish"].includes(match?.[2]) && method==="POST"){
    const status=state(previous,Date.parse(stamp));
    if(match[2]==="/pause"){
      if(status!=="running")fail(409,"专注已暂停或结束，请刷新状态");
      return update({...previous,state:"paused",remaining_ms:remaining(previous,Date.parse(stamp)),ends_at:null});
    }
    if(match[2]==="/resume"){
      if(status!=="paused")fail(409,"只有暂停中的专注可以继续");
      return update({...previous,state:"running",ends_at:new Date(Date.parse(stamp)+previous.remaining_ms).toISOString(),remaining_ms:null});
    }
    if(status==="running")fail(400,"请先暂停，再主动结束专注");
    if(typeof data.save!=="boolean")fail(400,"请选择是否保存此次专注");
    if(!data.save){
      if(previous.state==="finished")fail(409,"这次专注已经保存，请在记录卡片中删除");
      const result=await db.prepare("DELETE FROM settings WHERE key=? AND json_extract(value,'$.revision')=?").bind(`focus:${previous.id}`,data.revision).run();
      if(!result.meta.changes)fail(409,"专注记录已更新，请重试");return json({discarded:true});
    }
    if(previous.state==="finished")return json(await expose(previous));
    const ends_at=status==="paused"?stamp:previous.ends_at,focused_seconds=status==="paused"?Math.max(0,(duration(previous)*1000-previous.remaining_ms)/1000):duration(previous);
    return update({...previous,...await information(ends_at),state:"finished",ends_at,remaining_ms:0,focused_seconds});
  }
  if(match?.[2]==="/export" && method==="POST") {
    if(state(previous)!=="finished" || previous.state==="running")fail(400,"请先结束专注并保留记录，再导出");
    if(previous.exported_id)return json({id:previous.exported_id,existing:true});
    const record={...previous.record,starts_at:previous.ends_at,ends_at:previous.ends_at,location:""},id=crypto.randomUUID();
    if(record.axis_id && !await db.prepare("SELECT 1 FROM axes WHERE id=? AND deleted=0").bind(record.axis_id).first())record.axis_id=null;
    const updated={...previous,exported_id:id,revision:previous.revision+1};
    const results=await db.batch([
      db.prepare(`INSERT INTO tasks(id,${FIELDS.join(',')},created_at,updated_at,completed_at) SELECT ${Array(FIELDS.length+4).fill('?').join(',')} WHERE EXISTS(SELECT 1 FROM settings WHERE key=? AND json_extract(value,'$.revision')=?)`).bind(id,...FIELDS.map(f=>stored(record,f)),stamp,stamp,record.status==='done'?stamp:null,`focus:${previous.id}`,data.revision),
      db.prepare("UPDATE settings SET value=? WHERE key=? AND json_extract(value,'$.revision')=?").bind(JSON.stringify(updated),`focus:${previous.id}`,data.revision)
    ]);
    if(!results[1].meta.changes)fail(409,"专注记录已更新，请重新打开");return json({id},201);
  }
  if(match && !match[2] && method==="DELETE") {
    const result=await db.prepare("DELETE FROM settings WHERE key=? AND json_extract(value,'$.revision')=?").bind(`focus:${previous.id}`,data.revision).run();
    if(!result.meta.changes)fail(409,"专注记录已更新，请重试");return json({ok:true});
  }
  if((path==="/api/focus" && method==="POST") || (match && !match[2] && method==="PATCH")) {
    const seconds=previous?duration(previous):(data.duration_seconds ?? data.duration_minutes*60);
    if(!Number.isInteger(seconds) || seconds<1 || seconds>43200)fail(400,"专注时长需为 1 秒至 12 小时");
    const ends_at=previous?previous.ends_at:new Date(Date.parse(stamp)+seconds*1000).toISOString(),{record,selected}=await information(ends_at);
    if(previous){
      return update({...previous,record,selected});
    }
    if(typeof data.id!=="string" || !/^[a-zA-Z0-9-]{1,50}$/.test(data.id))fail(400,"缺少本次专注编号");
    const existing=await db.prepare("SELECT value FROM settings WHERE key=?").bind(`focus:${data.id}`).first();
    if(existing)return json(await expose(JSON.parse(existing.value)));
    const session={id:data.id,revision:1,record,selected,state:"running",duration_seconds:seconds,duration_minutes:seconds/60,started_at:stamp,ends_at,exported_id:null};
    const row=await db.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM settings WHERE key LIKE 'focus:%' AND (json_extract(value,'$.state') IN ('paused','running') OR json_extract(value,'$.ends_at')>?)) RETURNING value").bind(`focus:${session.id}`,JSON.stringify(session),stamp).first();
    if(!row)fail(409,"已有正在进行的专注，请先完成本次专注");return json(await expose(session),201);
  }
  fail(404,"专注操作不存在");
}
