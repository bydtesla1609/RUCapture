"use strict";
let quadrantPositions={},quadrantZoom=null,focusSessions=[],focusEditor=null,focusLoading=false,focusClockOffset=0,focusPending=null;
let focusDraft=null,focusDuration=1500,focusActionBusy=false,focusClockKey="",focusRetryAt=0,focusPrompted=null;
let quadrantPan={x:0,y:0},quadrantResize=null;
const QUADRANTS=[{x:1,y:1,title:"紧急且重要"},{x:1,y:-1,title:"紧急且不重要"},{x:-1,y:1,title:"不紧急且重要"},{x:-1,y:-1,title:"不紧急且不重要"}];
const pendingCards=()=>tasks.filter(task=>task.category!=="课程" && task.status!=="done" && !task.archived_at);
const quadrantOf=(x,y)=>QUADRANTS.find(q=>Math.sign(x)===q.x && Math.sign(y)===q.y);
const planningTime=task=>task.completed_at || deadline(task) || task.starts_at;
const byPlanningTime=(a,b)=>(Date.parse(planningTime(a)) || Infinity)-(Date.parse(planningTime(b)) || Infinity) || a.title.localeCompare(b.title,"zh-CN");
function compactCard(task,showQuadrant=false){
  const info=element("span",null,"compact-task-info"),meta=element("span",null,"compact-task-meta");
  meta.append(element("span",task.category,"compact-task-type"));
  const quadrant=showQuadrant?taskQuadrantBadge(task):null;if(quadrant)meta.append(quadrant);
  meta.append(element("span",task.category==="记录"?"待完善":STATES[task.status] || "待开始"));
  info.append(element("strong",task.title),meta,element("small",`${task.completed_at?"完成":task.category==="作业"?"截止":"时间"} · ${formatTime(planningTime(task))}`,"compact-task-time"));return info;
}
const PLANNING_CARD={width:254,height:90,gap:12};
// Legacy normalized positions stay in their quadrants; new positions use an unbounded plane.
const quadrantPoint=p=>p.space==="world"?p:{x:Math.sign(p.x)*(145+Math.abs(p.x)*200),y:Math.sign(p.y)*(63+Math.abs(p.y)*160)};
async function placeCard(task,x,y){
  const board=$("board");board.dataset.busy="true";
  try{quadrantPositions[task.id]=await api(`/api/quadrant/${task.id}`,"PUT",{revision:quadrantPositions[task.id]?.revision || 0,x,y,space:"world"});}
  catch(error){notice(error.message);}
  finally{delete board.dataset.busy;if(categoryFilter==="全部" && overviewView==="quadrants")renderQuadrants();await refresh();}
}
function renderQuadrants(){
  quadrantResize?.disconnect();
  const board=$("board");board.className="quadrant-board";
  const sidebar=element("section",null,"planning-pending"),list=element("div",null,"compact-task-list planning-list");
  const items=pendingCards().sort(byPlanningTime),unplaced=items.filter(task=>quadrantPositions[task.id]?.x==null);
  sidebar.append(element("h3",`待安排 · ${unplaced.length}`),list);
  const viewport=element("div",null,"axes-canvas quadrant-viewport"),chart=element("section",null,"quadrant-chart"),world=element("div",null,"quadrant-world");chart.setAttribute("aria-label","紧急性与重要性坐标图");
  const offscreen=element("div",null,"quadrant-offscreen"),panels=[],labels=[],axisY=element("span","重要性 ↑","quadrant-axis axis-y"),axisX=element("span","紧急性 →","quadrant-axis axis-x");
  for(const q of QUADRANTS){
    const panel=element("section",null,"quadrant");panel.dataset.quadrant=q.title;chart.append(panel);panels.push({q,node:panel});
    const label=element("span",q.title,"quadrant-direction");label.setAttribute("aria-hidden","true");label.dataset.quadrant=q.title;labels.push({q,node:label});
  }
  chart.append(world,axisY,axisX,...labels.map(label=>label.node),offscreen);
  const feedback=element("span",null,"quadrant-status");feedback.setAttribute("role","status");
  const controls=element("div",null,"canvas-controls"),zoomOut=element("button","−"),zoomReset=element("button","复位"),zoomIn=element("button","＋");
  for(const [button,label] of [[zoomOut,"缩小象限画布"],[zoomReset,"复位象限画布"],[zoomIn,"放大象限画布"]]){button.type="button";button.setAttribute("aria-label",label);}
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  let frame=0,animation=0;const pointers=new Map(),markerNodes=new Map();
  function paint(){
    frame=0;if(!viewport.isConnected)return;
    const {width,height}=chart.getBoundingClientRect(),ox=width/2+quadrantPan.x,oy=height/2+quadrantPan.y;
    world.style.transform=`translate3d(${quadrantPan.x}px,${quadrantPan.y}px,0) scale(${quadrantZoom})`;
    chart.style.setProperty("--origin-x",`${ox}px`);chart.style.setProperty("--origin-y",`${oy}px`);
    let spacing=26*quadrantZoom;while(spacing<12)spacing*=5;
    chart.style.backgroundSize=`${spacing}px ${spacing}px`;chart.style.backgroundPosition=`${ox}px ${oy}px`;
    for(const {q,node} of panels){
      const x=q.x<0?0:clamp(ox,0,width),y=q.y>0?0:clamp(oy,0,height);
      node.style.left=`${x}px`;node.style.top=`${y}px`;node.style.width=`${q.x<0?clamp(ox,0,width):width-x}px`;node.style.height=`${q.y>0?clamp(oy,0,height):height-y}px`;
    }
    // Paired edge constraints prevent labels colliding when several quadrants leave the viewport.
    const {width:labelWidth,height:labelHeight}=labels[0].node.getBoundingClientRect(),pad=12,gap=8;
    const left=clamp(ox-width/2+pad,pad,width-2*labelWidth-gap-pad),right=clamp(ox+width/2-labelWidth-pad,left+labelWidth+gap,width-labelWidth-pad);
    const top=clamp(oy-height/2+34,34,height-2*labelHeight-48-66),bottom=clamp(oy+height/2-labelHeight-66,top+labelHeight+48,height-labelHeight-66);
    for(const {q,node} of labels){
      node.style.transform=`translate3d(${q.x<0?left:right}px,${q.y>0?top:bottom}px,0)`;
    }
    axisY.style.left=`${clamp(ox,75,width-75)}px`;axisX.style.top=`${clamp(oy,top+labelHeight+12,bottom-12)}px`;
    axisY.classList.toggle("axis-offscreen",ox<0 || ox>width);axisX.classList.toggle("axis-offscreen",oy<0 || oy>height);
    zoomOut.disabled=quadrantZoom<=.05;zoomIn.disabled=quadrantZoom>=4;
    const markers=[];
    for(const task of items){
      const placed=quadrantPositions[task.id];if(placed?.x==null)continue;
      const p=quadrantPoint(placed),x=ox+p.x*quadrantZoom,y=oy-p.y*quadrantZoom,w=PLANNING_CARD.width*quadrantZoom/2,h=PLANNING_CARD.height*quadrantZoom/2;
      if(x-w>=0 && x+w<=width && y-h>=0 && y+h<=height)continue;
      let dx=x-width/2,dy=y-height/2;if(Math.abs(dx)+Math.abs(dy)<1)dx=1;
      const ratio=Math.min((width/2-22)/Math.max(.001,Math.abs(dx)),(height/2-22)/Math.max(.001,Math.abs(dy)));
      const px=clamp(width/2+dx*ratio,22,width-22);let py=clamp(height/2+dy*ratio,22,height-22);
      if(px>width-170 && py>height-66)py=height-76;
      const near=markers.find(m=>Math.hypot(m.x-px,m.y-py)<32);
      if(near){near.tasks.push(task);continue;}markers.push({x:px,y:py,p,tasks:[task],angle:Math.atan2(dy,dx)*180/Math.PI});
    }
    const visible=new Set();
    for(const m of markers){
      const key=m.tasks[0].id;visible.add(key);let button=markerNodes.get(key);
      if(!button){button=element("button",null,"offscreen-arrow");button.type="button";button.append(element("span","➜"));markerNodes.set(key,button);offscreen.append(button);}
      button.style.transform=`translate3d(${m.x}px,${m.y}px,0) translate(-50%,-50%)`;button.firstChild.style.transform=`rotate(${m.angle}deg)`;
      button.title=m.tasks.map(task=>task.title).join("、");button.setAttribute("aria-label",`定位画布外卡片：${button.title}`);
      if(m.tasks.length>1){let count=button.querySelector("small");if(!count){count=element("small");button.append(count);}count.textContent=String(m.tasks.length);}else button.querySelector("small")?.remove();
      button.onclick=()=>{const z=Math.min(quadrantZoom,(width-80)/PLANNING_CARD.width,(height-80)/PLANNING_CARD.height);animateCamera({x:-m.p.x*z,y:m.p.y*z,z});};
    }
    for(const [key,node] of markerNodes)if(!visible.has(key)){node.remove();markerNodes.delete(key);}
  }
  const draw=()=>{if(!frame)frame=requestAnimationFrame(paint);};
  function stopAnimation(){cancelAnimationFrame(animation);animation=0;if(!pointers.size)viewport.classList.remove("camera-moving");}
  function zoom(value,point){
    const {width,height}=chart.getBoundingClientRect(),next=clamp(value,.05,4),ratio=next/quadrantZoom;point ||= {x:width/2,y:height/2};
    quadrantPan.x=point.x-width/2-(point.x-width/2-quadrantPan.x)*ratio;
    quadrantPan.y=point.y-height/2-(point.y-height/2-quadrantPan.y)*ratio;
    quadrantZoom=next;draw();
  }
  function animateCamera(target){
    stopAnimation();const from={...quadrantPan,z:quadrantZoom},start=performance.now();
    const duration=matchMedia("(prefers-reduced-motion: reduce)").matches?0:170;viewport.classList.add("camera-moving");
    function step(now){
      if(!viewport.isConnected)return;
      const progress=duration?Math.min(1,(now-start)/duration):1,eased=1-(1-progress)**3;
      quadrantPan={x:from.x+(target.x-from.x)*eased,y:from.y+(target.y-from.y)*eased};quadrantZoom=from.z+(target.z-from.z)*eased;paint();
      if(progress<1)animation=requestAnimationFrame(step);else{animation=0;viewport.classList.remove("camera-moving");}
    }
    animation=requestAnimationFrame(step);
  }
  const fit=()=>{
    const points=items.filter(task=>quadrantPositions[task.id]?.x!=null).map(task=>quadrantPoint(quadrantPositions[task.id]));
    return Math.min(1,...points.map(p=>Math.min(viewport.clientWidth/(2*(Math.abs(p.x)+PLANNING_CARD.width/2+24)),viewport.clientHeight/(2*(Math.abs(p.y)+PLANNING_CARD.height/2+24)))));
  };
  function zoomButton(factor){const z=clamp(quadrantZoom*factor,.05,4),ratio=z/quadrantZoom;animateCamera({x:quadrantPan.x*ratio,y:quadrantPan.y*ratio,z});}
  zoomOut.onclick=()=>zoomButton(1/1.2);zoomIn.onclick=()=>zoomButton(1.2);zoomReset.onclick=()=>animateCamera({x:0,y:0,z:clamp(fit(),.05,4)});
  viewport.addEventListener("wheel",event=>{
    if(event.target.closest(".canvas-controls"))return;
    event.preventDefault();if(board.querySelector(".planning-card.dragging"))return;
    stopAnimation();const rect=chart.getBoundingClientRect(),delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?chart.clientHeight:1);
    zoom(quadrantZoom*Math.exp(-delta*.0015),{x:event.clientX-rect.left,y:event.clientY-rect.top});
  },{passive:false});
  viewport.tabIndex=0;viewport.setAttribute("aria-label","象限画布，拖动空白处平移，滚轮缩放，Home 复位");
  viewport.onkeydown=event=>{
    if(event.target!==viewport)return;
    if(event.key==="Home"){event.preventDefault();zoomReset.click();return;}
    if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
    event.preventDefault();stopAnimation();quadrantPan.x+=event.key==="ArrowLeft"?40:event.key==="ArrowRight"?-40:0;quadrantPan.y+=event.key==="ArrowUp"?40:event.key==="ArrowDown"?-40:0;draw();
  };
  const local=event=>{const rect=chart.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
  const center=points=>({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
  viewport.onpointerdown=event=>{
    if(event.button!==0 || event.target.closest(".planning-card,.canvas-controls,.offscreen-arrow") || board.dataset.busy || board.querySelector(".planning-card.dragging") || pointers.size>=2)return;
    event.preventDefault();stopAnimation();viewport.setPointerCapture(event.pointerId);pointers.set(event.pointerId,local(event));viewport.classList.add("camera-moving","panning");
  };
  viewport.onpointermove=event=>{
    if(!pointers.has(event.pointerId))return;
    const before=[...pointers.values()],previous=pointers.get(event.pointerId),point=local(event);pointers.set(event.pointerId,point);
    if(pointers.size===1){quadrantPan.x+=point.x-previous.x;quadrantPan.y+=point.y-previous.y;}
    else{
      const after=[...pointers.values()],a=center(before),b=center(after),distance=points=>Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
      if(distance(before)>0)zoom(quadrantZoom*distance(after)/distance(before),a);quadrantPan.x+=b.x-a.x;quadrantPan.y+=b.y-a.y;
    }
    draw();
  };
  const endPan=event=>{pointers.delete(event.pointerId);if(!pointers.size)viewport.classList.remove("camera-moving","panning");};
  viewport.onpointerup=viewport.onpointercancel=viewport.onlostpointercapture=endPan;
  controls.append(zoomOut,zoomReset,zoomIn);viewport.append(chart,feedback,controls);board.replaceChildren(sidebar,viewport);quadrantZoom ??= clamp(fit(),.05,4);paint();
  const resize=new ResizeObserver(()=>{if(viewport.isConnected)draw();else resize.disconnect();});resize.observe(viewport);quadrantResize=resize;
  function row(task){
    const node=element("div",null,"planning-card"),handle=element("span","⠿","planning-handle");handle.setAttribute("aria-hidden","true");
    node.dataset.taskId=task.id;node.append(handle,compactCard(task));node.title=task.title;node.ondblclick=()=>openTask(task);
    node.onpointerdown=event=>{
      if(event.button!==0 || board.dataset.busy || pointers.size)return;
      if(event.pointerType==="touch" && !event.target.closest(".planning-handle"))return;
      event.preventDefault();stopAnimation();node.setPointerCapture(event.pointerId);node.classList.add("dragging");
      const initial=node.getBoundingClientRect(),grab={x:(event.clientX-initial.left)/initial.width,y:(event.clientY-initial.top)/initial.height};
      const ghost=node.cloneNode(true);ghost.classList.remove("placed-card","dragging");ghost.classList.add("planning-ghost");ghost.setAttribute("aria-hidden","true");document.body.append(ghost);
      let point=null,inList=false,moved=false;const start={x:event.clientX,y:event.clientY};
      function move(e){
        moved ||= Math.hypot(e.clientX-start.x,e.clientY-start.y)>5;
        const rect=chart.getBoundingClientRect(),bounds=sidebar.getBoundingClientRect();
        const inside=r=>e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
        const inChart=inside(rect);inList=inside(bounds);point=null;
        const scale=inChart?quadrantZoom:node.classList.contains("placed-card")?quadrantZoom:1;
        const width=inChart?PLANNING_CARD.width*scale:initial.width,height=inChart?PLANNING_CARD.height*scale:initial.height;
        const left=e.clientX-grab.x*width,top=e.clientY-grab.y*height;
        if(inChart){
          const x=(left+width/2-rect.left-rect.width/2-quadrantPan.x)/quadrantZoom,y=(rect.top+rect.height/2+quadrantPan.y-top-height/2)/quadrantZoom;
          if(Math.abs(x)>=PLANNING_CARD.width/2+PLANNING_CARD.gap && Math.abs(y)>=PLANNING_CARD.height/2+PLANNING_CARD.gap)point={x,y};
        }
        ghost.style.width=`${width/scale}px`;ghost.style.height=`${height/scale}px`;ghost.style.transform=`scale(${scale})`;ghost.style.left=`${left}px`;ghost.style.top=`${top}px`;
        const q=point?quadrantOf(point.x,point.y):null;
        chart.querySelectorAll(".quadrant").forEach(panel=>panel.classList.toggle("drop-active",panel.dataset.quadrant===q?.title));sidebar.classList.toggle("drop-active",inList);
        labels.forEach(label=>{label.node.classList.toggle("drop-active",label.q===q);label.node.setAttribute("aria-hidden",String(label.q!==q));});
        feedback.textContent=q?`${q.title}，松手放置`:inList?"松手移回待安排":"不能放在坐标轴上";
      }
      function finish(e){
        node.removeEventListener("pointermove",move);node.removeEventListener("pointerup",finish);node.removeEventListener("pointercancel",finish);node.removeEventListener("lostpointercapture",finish);
        ghost.remove();node.classList.remove("dragging");chart.querySelectorAll(".drop-active").forEach(el=>el.classList.remove("drop-active"));labels.forEach(label=>label.node.setAttribute("aria-hidden","true"));sidebar.classList.remove("drop-active");feedback.textContent="";
        if(e.type==="pointerup" && moved && (point || inList))placeCard(task,inList?null:point.x,inList?null:point.y);
      }
      node.addEventListener("pointermove",move);node.addEventListener("pointerup",finish);node.addEventListener("pointercancel",finish);node.addEventListener("lostpointercapture",finish);move(event);
    };
    return node;
  }
  for(const task of items){
    const p=quadrantPositions[task.id],node=row(task);
    if(p?.x==null)list.append(node);
    else{const point=quadrantPoint(p);node.classList.add("placed-card");node.style.left=`${point.x-PLANNING_CARD.width/2}px`;node.style.top=`${-point.y-PLANNING_CARD.height/2}px`;world.append(node);}
  }
  if(!unplaced.length)list.append(element("p",items.length?"卡片都已安排。":"还没有待处理卡片。","hint"));
}
const focusNow=()=>Date.now()+focusClockOffset;
const activeFocus=()=>focusSessions.find(item=>item.state==="paused" || !item.finalized && (item.state==="running" || item===focusSessions[0]));
const durationOf=item=>item.duration_seconds ?? item.duration_minutes*60;
const clockText=seconds=>[Math.floor(seconds/3600),Math.floor(seconds/60)%60,Math.floor(seconds)%60].map(n=>String(n).padStart(2,"0")).join(":");
const focusDefaultTitle=()=>localInput(new Date()).replace("T"," ");
const focusDraftKey=()=>`rucapture-focus-draft:${boardAccount}`;
function storeFocusDraft(){try{localStorage.setItem(focusDraftKey(),JSON.stringify(focusDraft));}catch{}}
function ensureFocusDraft(item=activeFocus()){
  if(!focusDraft){try{focusDraft=JSON.parse(localStorage.getItem(focusDraftKey()));}catch{}}
  if(!focusDraft || focusDraft.session_id!==(item?.id || null)){
    focusDraft={session_id:item?.id || null,record:{title:item?.record.title || focusDefaultTitle(),content:item?.record.content || ""},task_ids:item?.selected.map(task=>task.id) || [],duration_seconds:item?durationOf(item):focusDuration};
  }
  focusDuration=item?durationOf(item):focusDraft.duration_seconds || 0;
  return focusDraft;
}
function captureFocusInformation(){
  if(!focusEditor || !focusDraft)return;
  focusDraft.record={title:$("task-title").value,content:$("task-content").value};
  focusDraft.task_ids=[...$("focus-tasks").querySelectorAll("input:checked")].map(input=>input.value);storeFocusDraft();
}
function clearFocusEditor(){
  captureFocusInformation();focusEditor=null;focusClockKey="";$("task-dialog").classList.remove("focus-mode");
  $("task-title").readOnly=$("task-content").readOnly=false;$("focus-history-list").replaceChildren();
  for(const id of ["focus-intro","focus-settings","focus-targets","focus-info-actions","focus-history"])$(id).hidden=true;
  $("save-task").textContent="保存卡片";
}
function resetPlanning(){
  clearFocusEditor();quadrantPositions={};quadrantZoom=null;quadrantPan={x:0,y:0};quadrantResize?.disconnect();focusSessions=[];focusDraft=null;focusDuration=1500;focusLoading=false;focusActionBusy=false;focusPending=null;focusRetryAt=0;focusPrompted=null;
  $("focus-countdown").textContent="";$("focus-button").classList.remove("focus-paused");
}
function applyFocus(data){
  focusClockOffset=Date.parse(data.server_time)-Date.now();focusSessions=data.sessions;
  if(focusEditor)renderFocusHistory();tickFocus();
}
async function loadFocus(){
  if(focusLoading || $("workspace").hidden)return;
  const session=syncSession;focusLoading=true;
  try{
    const data=await api("/api/focus");if(session!==syncSession)return;
    applyFocus(data);
  }catch(error){if(session===syncSession)$("focus-error").textContent=error.message;}
  finally{if(session===syncSession)focusLoading=false;}
}
// Seven-segment digits need no downloaded font and stay sharp at every size.
function clockDigits(value){
  const segments=["abcdef","bc","abdeg","abcdg","bcfg","acdfg","acdefg","abc","abcdefg","abcdfg"];
  return [...String(value)].map(digit=>{
    const node=element("span",null,"clock-digit");for(const key of "abcdefg")node.append(element("i",null,`segment segment-${key}${segments[Number(digit)].includes(key)?" lit":""}`));return node;
  });
}
function renderFocusClock(seconds,locked){
  const values=clockText(seconds).replaceAll(":","").split("").map(Number);
  $("focus-duration").replaceChildren(...["时","分","秒"].map((label,index)=>{
    const unit=element("div",null,"clock-unit"),pair=element("div",null,"clock-wheel-pair");
    for(let place=0;place<2;place++){
      const position=index*2+place,weight=[36000,3600,600,60,10,1][position],maximum=Math.min(place?9:index?5:1,Math.floor((43200-seconds+values[position]*weight)/weight));
      const wheel=element("div",null,"clock-wheel"),up=element("button","⌃","clock-step"),down=element("button","⌄","clock-step"),face=element("div",null,"clock-value");
      face.setAttribute("role","spinbutton");face.tabIndex=locked?-1:0;face.dataset.digit=String(position);face.setAttribute("aria-label",`专注${label}${place?"个位":"十位"}`);face.setAttribute("aria-valuemin","0");face.setAttribute("aria-valuemax",String(maximum));face.setAttribute("aria-valuenow",String(values[position]));face.setAttribute("aria-disabled",String(locked));
      const digit=element("span",null,"clock-digits");digit.setAttribute("aria-hidden","true");digit.append(...clockDigits(values[position]));face.append(digit);
      up.type=down.type="button";up.disabled=locked || values[position]>=maximum;down.disabled=locked || values[position]<=0;up.setAttribute("aria-label",`增加${place?1:10}${label}`);down.setAttribute("aria-label",`减少${place?1:10}${label}`);
      function step(delta){
        const next=[...values];next[position]=Math.max(0,Math.min(maximum,next[position]+delta));
        focusDuration=Math.min(43200,(next[0]*10+next[1])*3600+(next[2]*10+next[3])*60+next[4]*10+next[5]);
        focusDraft.duration_seconds=focusDuration;storeFocusDraft();focusClockKey="";renderFocusTimer();$("focus-duration").querySelector(`[data-digit="${position}"]`).focus({preventScroll:true});
      }
      up.onclick=()=>step(1);down.onclick=()=>step(-1);face.onkeydown=event=>{if(!locked && ["ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();step(event.key==="ArrowUp"?1:-1);}};
      face.addEventListener("wheel",event=>{if(locked)return;event.preventDefault();if(event.deltaY)step(event.deltaY<0?1:-1);},{passive:false});
      let drag=null;
      face.onpointerdown=event=>{if(locked || event.button!==0)return;event.preventDefault();face.setPointerCapture(event.pointerId);drag={id:event.pointerId,y:event.clientY};face.classList.add("adjusting");};
      face.onpointermove=event=>{if(drag?.id===event.pointerId)digit.style.transform=`translateY(${Math.max(-14,Math.min(14,event.clientY-drag.y))}px)`;};
      const finish=event=>{if(drag?.id!==event.pointerId)return;const delta=Math.round((drag.y-event.clientY)/24);drag=null;face.classList.remove("adjusting");digit.style.transform="";if(event.type==="pointerup" && delta)step(delta);};
      face.onpointerup=face.onpointercancel=face.onlostpointercapture=finish;
      wheel.append(up,face,down);pair.append(wheel);
    }
    unit.append(pair,element("small",label));return unit;
  }));
}
function focusTaskOrder(a,b){
  const rank=task=>{const p=quadrantPositions[task.id],q=p?.x!=null?QUADRANTS.indexOf(quadrantOf(p.x,p.y)):-1;return q<0?4:q;};
  const types=["考试","作业","会议","活动","课程","记录"];
  return rank(a)-rank(b) || types.indexOf(a.category)-types.indexOf(b.category) || byPlanningTime(a,b);
}
function renderFocusInformation(){
  const item=activeFocus(),draft=ensureFocusDraft(item),selected=new Set(draft.task_ids),available=new Map(tasks.filter(task=>task.status!=="done" && !task.archived_at).map(task=>[task.id,task]));
  for(const task of [...tasks.filter(task=>selected.has(task.id)),...(item?.selected || [])])if(!available.has(task.id))available.set(task.id,task);
  $("task-title").value=draft.record.title;$("task-content").value=draft.record.content;
  $("focus-tasks").replaceChildren(...[...available.values()].sort(focusTaskOrder).map(task=>{
    const row=element("label",null,"focus-choice"),checkbox=element("input");row.dataset.category=task.category;checkbox.type="checkbox";checkbox.value=task.id;checkbox.checked=selected.has(task.id);row.append(checkbox,compactCard(task,true));return row;
  }));
  if(!available.size)$("focus-tasks").append(element("p","没有可选卡片，直接开始也可以。","hint"));
  setFocusEditing(focusEditor.infoEditing);
}
function setFocusEditing(value){
  if(!focusEditor)return;
  if(value && !focusEditor.infoEditing)focusEditor.infoBefore=structuredClone({record:focusDraft.record,task_ids:focusDraft.task_ids});
  if(!value)delete focusEditor.infoBefore;
  focusEditor.infoEditing=value;
  $("task-title").readOnly=$("task-content").readOnly=!value;
  $("focus-tasks").querySelectorAll("input").forEach(input=>input.disabled=!value);
  $("focus-edit-info").hidden=value;$("focus-cancel-info").hidden=$("focus-save-info").hidden=!value;
}
function openFocus(){
  if(hasDraft() || uploading){notice("请先保存当前编辑，再打开专注模式。");return;}
  ensureFocusDraft();newTaskCategory="记录";openTask();editing=null;focusEditor={infoEditing:false};
  $("task-dialog").classList.add("focus-mode");
  for(const id of ["focus-intro","focus-settings","focus-targets","focus-info-actions","focus-history"])$(id).hidden=false;
  $("record-time").required=false;$("dialog-title").textContent="专注模式";
  $("task-content").placeholder="这段时间想做什么？做到了哪一步，还有哪里没弄懂？都可以记在这里。";
  $("editor-delete").hidden=true;$("focus-error").textContent="";
  renderFocusInformation();renderFocusTimer();renderFocusHistory();$("task-dialog").scrollTop=0;
}
function focusPayload(item){
  captureFocusInformation();const draft=ensureFocusDraft(item);
  return {record:{...item?.record,...draft.record,title:draft.record.title.trim() || focusDefaultTitle(),attachments:(item?.record.attachments || []).map(file=>file.id)},task_ids:draft.task_ids};
}
function replaceFocus(saved){focusSessions=[saved,...focusSessions.filter(item=>item.id!==saved.id)].sort((a,b)=>b.started_at.localeCompare(a.started_at));}
async function focusAction(action){
  if(focusActionBusy)return;focusActionBusy=true;renderFocusTimer();const session=syncSession;$("focus-error").textContent="";
  try{await action(session);}
  catch(error){if(session===syncSession){$("focus-error").textContent=error.message;focusRetryAt=Date.now()+15000;if(error.status===409)await loadFocus();}}
  finally{if(session===syncSession){focusActionBusy=false;tickFocus();}}
}
async function saveFocusInformation(){
  captureFocusInformation();
  await focusAction(async session=>{
    const item=activeFocus();
    if(item){const saved=await api(`/api/focus/${item.id}`,"PATCH",{revision:item.revision,...focusPayload(item)});if(session!==syncSession)return;replaceFocus(saved);}
    setFocusEditing(false);
  });
}
function renderFocusTimer(){
  const item=activeFocus(),paused=item?.state==="paused",seconds=item?Math.max(0,Math.ceil((paused?item.remaining_ms:Date.parse(item.ends_at)-focusNow())/1000)):focusDuration;
  $("focus-countdown").textContent=item?clockText(seconds):"";$("focus-button").classList.toggle("focus-paused",!!paused);
  $("focus-button").setAttribute("aria-label",`专注模式${item?`，${paused?"已暂停":"剩余"} ${clockText(seconds)}`:""}`);
  if(!focusEditor)return;
  const key=`${seconds}:${!!item}:${focusActionBusy}`;
  if(key!==focusClockKey){renderFocusClock(seconds,!!item || focusActionBusy);focusClockKey=key;}
  $("focus-reset").disabled=!!item || focusActionBusy;$("focus-end").disabled=!(paused || item && !seconds) || focusActionBusy;
  $("focus-toggle").disabled=focusActionBusy || !item && !seconds;
  $("focus-toggle").textContent=!item?"开始专注":!seconds?"选择是否保存":paused?"时间，再次流动！":"The World！ 时间，停止吧！";
  for(const id of ["focus-edit-info","focus-save-info","focus-cancel-info"])$(id).disabled=focusActionBusy;
}
async function finishFocus(item,save,natural=false){
  await focusAction(async session=>{
    const saved=await api(`/api/focus/${item.id}/finish`,"POST",{revision:item.revision,save,...(save?focusPayload(item):{})});
    if(session!==syncSession)return;
    if(save)replaceFocus(saved);else focusSessions=focusSessions.filter(value=>value.id!==item.id);
    focusDuration=durationOf(item);
    focusDraft={session_id:null,record:{title:focusDefaultTitle(),content:""},task_ids:[],duration_seconds:focusDuration};storeFocusDraft();
    if(focusEditor){focusEditor.infoEditing=false;renderFocusInformation();renderFocusHistory();}
    else if(natural)focusPending=item.id;
    notice(save?"此次专注已保存":"此次专注已结束，未保存");
  });
}
$("focus-reset").onclick=()=>{if(activeFocus() || focusActionBusy)return;focusDuration=0;focusDraft.duration_seconds=0;storeFocusDraft();renderFocusTimer();};
$("focus-toggle").onclick=()=>{const item=activeFocus();if(item && item.state!=="paused" && Date.parse(item.ends_at)<=focusNow())return promptFocusEnd(item,true);return focusAction(async session=>{
  const item=activeFocus();let saved;
  if(item)saved=await api(`/api/focus/${item.id}/${item.state==="paused"?"resume":"pause"}`,"POST",{revision:item.revision});
  else saved=await api("/api/focus","POST",{id:crypto.randomUUID(),duration_seconds:focusDuration,...focusPayload(null)});
  if(session!==syncSession)return;replaceFocus(saved);focusDraft.session_id=saved.id;focusDraft.duration_seconds=durationOf(saved);storeFocusDraft();
});};
async function promptFocusEnd(item,natural=false){
  const session=syncSession;if(!item || focusActionBusy || $("focus-end-dialog").open)return;
  if(natural)focusPrompted=item.id;$("focus-end-title").textContent=natural?"本次专注已完成":"本次专注已结束";$("focus-end-message").textContent="要保存这次的用时和填写的内容吗？";
  const dialog=$("focus-end-dialog");dialog.returnValue="";
  const choice=await new Promise(resolve=>{dialog.addEventListener("close",()=>resolve(dialog.returnValue),{once:true});dialog.showModal();});
  if(session===syncSession && ["save","discard"].includes(choice))await finishFocus(activeFocus() || item,choice==="save",natural);
}
$("focus-end").onclick=()=>{const item=activeFocus();if(item)promptFocusEnd(item,item.state!=="paused");};
$("focus-edit-info").onclick=()=>{
  if(!focusEditor || focusActionBusy)return;
  setFocusEditing(true);if(!$("task-title").value.trim())$("task-title").value=focusDefaultTitle();$("focus-error").textContent="";$("task-title").focus({preventScroll:true});
};
$("focus-save-info").onclick=saveFocusInformation;
$("focus-cancel-info").onclick=()=>{
  if(!focusEditor?.infoBefore || focusActionBusy)return;
  // Only metadata rolls back; clock changes and a running session remain independent.
  Object.assign(focusDraft,structuredClone(focusEditor.infoBefore));storeFocusDraft();
  setFocusEditing(false);renderFocusInformation();$("focus-error").textContent="";
};
for(const id of ["task-title","task-content"])$(id).addEventListener("input",captureFocusInformation);
$("focus-tasks").addEventListener("change",captureFocusInformation);
function renderFocusHistory(){
  const list=$("focus-history-list");
  // Background refreshes must not replace an editor or its focused input.
  if(list.querySelector("[data-dirty], [data-busy]"))return;
  const finished=focusSessions.filter(item=>item.state==="finished" && item.finalized);
  list.replaceChildren(...finished.map(focusHistoryCard));
  if(!finished.length)list.append(element("p","完成第一段专注后，会在这里留下记录。","hint"));
}
async function deleteFocus(item,row=null){
  const drafts=[...document.querySelectorAll("#focus-history-list [data-dirty], #focus-history-list [data-busy]")];
  if(drafts.some(node=>node!==row) || row?.dataset.busy || hasDraft() && !row?.dataset.dirty){notice("请先保存或取消正在编辑的内容。");return;}
  if(!await confirmAction("删除这张专注卡片？",`“${item.record.title}”将被删除。\n已导出的记录会继续保留。`,"删除卡片"))return;
  if(row)row.dataset.busy="true";
  try{
    await api(`/api/focus/${item.id}`,"DELETE",{revision:item.revision});row?.remove();focusSessions=focusSessions.filter(value=>value.id!==item.id);
    await loadFocus();
  }catch(error){$("focus-error").textContent=error.message;}
  finally{if(row)delete row.dataset.busy;}
}
function focusHistoryCard(item){
  const row=element("article",null,"task focus-history-row"),meta=element("div",null,"task-meta"),title=element("h3",item.record.title,"task-title");row.dataset.focusId=item.id;row.dataset.category="记录";
  meta.append(element("span","专注","badge cat-5"),element("span",clockText(item.focused_seconds ?? durationOf(item)),"focus-history-duration"));
  const time=element("div",null,"task-time");time.append(element("p","结束时间","time-label"),element("p",formatTime(item.ends_at,true)));
  const content=element("p",item.record.content,"task-content"),details=element("div",null,"focus-history-details");
  if(item.selected.length){const selection=element("div",null,"focus-selected");item.selected.forEach(task=>{const chip=element("span",null,"task-kind"),quadrant=taskQuadrantBadge(task);chip.append(element("span",task.category));if(quadrant)chip.append(quadrant);chip.append(element("span",task.title));selection.append(chip);});details.append(selection);}
  if(item.record.todos.length){const list=element("ul");item.record.todos.forEach(todo=>list.append(element("li",`${todo.done?"☑":"☐"} ${todo.text}`)));details.append(list);}
  item.record.attachments.forEach(file=>details.append(fileRow(file)));item.record.links.forEach(link=>{const p=element("p");p.append(externalLink(link.label || link.url,link.url));details.append(p);});
  const footer=element("div",null,"task-footer"),actions=element("div",null,"task-actions"),edit=element("button","编辑","edit-task"),remove=element("button","删除","delete-task"),exported=element("button",item.exported_id?"已导出为记录":"导出为记录","archive-task");
  edit.type=remove.type=exported.type="button";exported.disabled=!!item.exported_id;
  for(const [button,label] of [[edit,"编辑"],[remove,"删除"],[exported,item.exported_id?"已导出为记录":"导出为记录"]])button.setAttribute("aria-label",`${label}：${item.record.title}`);
  actions.append(edit,exported,remove);footer.append(actions);row.append(meta,title,time,content,details,footer);
  edit.onclick=()=>{
    if($("focus-history-list").querySelector("[data-dirty], [data-busy]")){notice("请先保存或取消当前专注编辑。");return;}
    row.dataset.dirty="true";
    const form=element("form",null,"focus-inline-editor"),titleLabel=element("label","标题"),titleInput=element("input"),contentLabel=element("label","内容"),contentInput=element("textarea"),error=element("p",null,"error");
    titleInput.id=`focus-title-${item.id}`;titleInput.maxLength=4000;titleInput.required=true;titleInput.value=item.record.title;titleLabel.htmlFor=titleInput.id;
    contentInput.id=`focus-content-${item.id}`;contentInput.maxLength=10000;contentInput.rows=5;contentInput.value=item.record.content;contentInput.placeholder="这段时间想做什么？做到了哪一步，还有哪里没弄懂？都可以记在这里。";contentLabel.htmlFor=contentInput.id;error.setAttribute("role","alert");
    const buttons=element("div",null,"task-actions"),cancel=element("button","取消","text-button"),save=element("button","保存","primary"),remove=element("button","删除","text-button editor-delete");cancel.type=remove.type="button";save.type="submit";
    remove.setAttribute("aria-label",`删除：${item.record.title}`);remove.onclick=()=>deleteFocus(item,row);
    buttons.append(remove,cancel,save);form.append(titleLabel,titleInput,contentLabel,contentInput,error,buttons);
    title.hidden=content.hidden=details.hidden=footer.hidden=true;row.append(form);titleInput.focus({preventScroll:true});
    cancel.onclick=()=>{row.replaceWith(focusHistoryCard(focusSessions.find(value=>value.id===item.id) || item));};
    form.onsubmit=async event=>{
      event.preventDefault();row.dataset.busy="true";error.textContent="";form.querySelectorAll("input,textarea,button").forEach(node=>node.disabled=true);
      const session=syncSession;
      try{
        const record={...item.record,title:titleInput.value.trim(),content:contentInput.value.trim(),attachments:item.record.attachments.map(file=>file.id)};
        const saved=await api(`/api/focus/${item.id}`,"PATCH",{revision:item.revision,record,task_ids:item.selected.map(task=>task.id)});
        if(session!==syncSession)return;
        focusSessions=focusSessions.map(value=>value.id===saved.id?saved:value);
        row.replaceWith(focusHistoryCard(saved));notice("专注信息已保存");
      }catch(problem){error.textContent=problem.message;}
      finally{delete row.dataset.busy;form.querySelectorAll("input,textarea,button").forEach(node=>node.disabled=false);}
    };
  };
  remove.onclick=()=>deleteFocus(item);
  exported.onclick=async()=>{
    if(hasDraft()){notice("请先保存或取消正在编辑的内容。");return;}
    exported.disabled=true;
    try{await api(`/api/focus/${item.id}/export`,"POST",{revision:item.revision});await loadFocus();await refresh();notice("已加入记录板块，专注历史仍保留。");}
    catch(error){$("focus-error").textContent=error.message;exported.disabled=false;}
  };
  return row;
}
function tickFocus(){
  if($("workspace").hidden)return;
  renderFocusTimer();
  const recent=focusSessions[0];
  if(recent && recent.state!=="paused" && !recent.finalized && Date.parse(recent.ends_at)<=focusNow() && !focusActionBusy && Date.now()>=focusRetryAt){
    if(focusPrompted!==recent.id && !document.hidden && !document.querySelector("dialog[open]:not(#task-dialog)") && (!$("task-dialog").open || focusEditor))promptFocusEnd(recent,true);return;
  }
  if(focusPending && !document.hidden && !document.querySelector("dialog[open]") && !hasDraft()){
    focusPending=null;openFocus();
  }
}
$("focus-button").onclick=async()=>{await loadFocus();if(!$("task-dialog").open)openFocus();};
$("task-dialog").addEventListener("close",clearFocusEditor);
setInterval(tickFocus,1000);
