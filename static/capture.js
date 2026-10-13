"use strict";
let editingAxis=null,axisScene=null;
const cardTime=task=>task.category==="作业"?task.due_at:task.starts_at;
const chronological=(a,b)=>(cardTime(a)||"9999").localeCompare(cardTime(b)||"9999") || a.id.localeCompare(b.id);
function resetAxisScene(){axisScene=null;}
function fillAxisSelect(value){
  const create=element("option","＋ 新增轴线");create.value="create-axis";create.dataset.action="create-axis";
  $("task-axis").replaceChildren(...[{id:"",title:"暂不加入轴线"},...axes].map(axis=>{const option=element("option",axis.title);option.value=axis.id;return option;}),create);
  $("task-axis").value=value || "";enhanceSelect($("task-axis"));
}
function createAxisFromCard(){
  $("new-axis-form").reset();$("new-axis-error").textContent="";$("new-axis-dialog").showModal();
}
$("new-axis-dialog").addEventListener("cancel",event=>{if($("new-axis-save").disabled)event.preventDefault();});
$("new-axis-form").onsubmit=async event=>{
  event.preventDefault();const session=syncSession,form=$("new-axis-form"),controls=form.querySelectorAll("button");
  controls.forEach(button=>button.disabled=true);$("new-axis-error").textContent="";
  try{
    const axis=await api("/api/axes","POST",{title:$("new-axis-title").value,content:$("new-axis-content").value,starts_at:inputTime($("new-axis-start").value),ends_at:inputTime($("new-axis-end").value)});
    if(session!==syncSession)return;
    axes=axes.filter(item=>item.id!==axis.id);axes.push(axis);fillAxisSelect(axis.id);$("new-axis-dialog").close();lastPayload="";
    await refresh();
  }catch(error){if(session===syncSession)$("new-axis-error").textContent=error.message;}
  finally{controls.forEach(button=>button.disabled=false);}
};
function renderRecords(records){
  $("board").className="record-board";
  const ordered=[...records].sort((a,b)=>-chronological(a,b));
  $("board").replaceChildren(...[["todo","待完善"],["done","已完善"]].map(([state,title])=>{
    const section=element("section",null,`column record-column ${state}`),items=ordered.filter(task=>(task.status==="done"?"done":"todo")===state);
    section.append(groupHeading(title,items.length));
    const list=element("div",null,"schedule-list record-group");
    if(items.length)list.append(...items.map(card));else list.append(emptySchedule(title,"记录",state==="todo"));section.append(list);
    return section;
  }));
  const today=localInput(new Date()).slice(0,10),week=new Date();week.setDate(week.getDate()-6);const since=localInput(week).slice(0,10);
  const values=[records.length,records.filter(t=>{const day=localInput(t.starts_at).slice(0,10);return day>=since&&day<=today;}).length,records.filter(t=>localInput(t.starts_at).startsWith(today)).length,records.filter(t=>t.status!=="done").length];
  document.querySelectorAll(".summary>div").forEach((node,i)=>{node.querySelector("span").textContent=["记录总数","近七天记录数","今日记录数","待完善记录数"][i];node.querySelector("strong").textContent=values[i];node.querySelector("small").textContent=["按记录时间倒序 · 手动归档","含今天在内的最近 7 天","按北京时间统计","完善后勾选 · 不自动归档"][i];});
}
function renderAxisMembers(){
  const items=axisItems.filter(task=>task.axis_id===editingAxis?.id).sort(chronological),root=$("axis-members");
  root.replaceChildren();if(!editingAxis)return;
  root.append(element("h3",`卡片 · ${items.length}`));
  if(!items.length)root.append(element("p","还没有卡片。可以在卡片编辑里选择这条轴线，也可以点画布上末尾的加号添加。","hint"));
  for(const task of items){
    const row=element("div",null,"axis-member"),info=element("div"),meta=element("small",null,"task-kind"),quadrant=taskQuadrantBadge(task);meta.append(element("span",task.category));if(quadrant)meta.append(quadrant);meta.append(element("span",`${formatTime(cardTime(task))}${task.archived_at?" · 已归档":""}`));info.append(element("strong",task.title),meta);
    const edit=element("button","编辑","text-button"),detach=element("button","移出轴线","text-button");edit.type=detach.type="button";
    edit.onclick=()=>openTask(task);detach.onclick=async()=>{detach.disabled=true;try{await api(`/api/tasks/${task.id}`,"PATCH",{axis_id:null,revision:task.revision});lastPayload="";await refresh();renderAxisMembers();}catch(error){notice(error.message);detach.disabled=false;}};
    row.append(info,edit,detach);root.append(row);
  }
}
function openAxis(axis=null){
  if(hasDraft()){notice("请先保存待办草稿");return;}
  editingAxis=axis;$("axis-form").reset();$("axis-error").textContent="";$("axis-dialog-title").textContent=axis?"编辑轴线":"添加轴线";
  $("axis-title").value=axis?.title || "";$("axis-content").value=axis?.content || "";$("axis-start").value=localInput(axis?.starts_at);$("axis-end").value=localInput(axis?.ends_at);$("axis-delete").hidden=!axis;
  renderAxisMembers();$("axis-dialog").showModal();
}
$("axis-form").onsubmit=async event=>{
  event.preventDefault();$("axis-save").disabled=true;$("axis-error").textContent="";
  try{await api(editingAxis?`/api/axes/${editingAxis.id}`:"/api/axes",editingAxis?"PATCH":"POST",{title:$("axis-title").value,content:$("axis-content").value,starts_at:inputTime($("axis-start").value),ends_at:inputTime($("axis-end").value),...(editingAxis?{revision:editingAxis.revision}:{})});$("axis-dialog").close();lastPayload="";await refresh();}
  catch(error){$("axis-error").textContent=error.message;}finally{$("axis-save").disabled=false;}
};
$("axis-delete").onclick=async()=>{
  if(!editingAxis || !await confirmAction(`删除轴线“${editingAxis.title}”？`,"只删除这条轴线，原来的卡片都会保留。","删除轴线"))return;
  $("axis-delete").disabled=true;try{await api(`/api/axes/${editingAxis.id}`,"DELETE",{revision:editingAxis.revision});$("axis-dialog").close();lastPayload="";await refresh();}catch(error){$("axis-error").textContent=error.message;}finally{$("axis-delete").disabled=false;}
};
const axisAdd=element("dialog",null,"axis-add-dialog");axisAdd.id="axis-add-dialog";
const addHeading=element("div",null,"dialog-heading"),closeAxisAdd=element("button","×","icon-button");closeAxisAdd.setAttribute("aria-label","关闭添加卡片");closeAxisAdd.onclick=()=>axisAdd.close();addHeading.append(element("h2","添加卡片"),closeAxisAdd);axisAdd.append(addHeading);
for(const category of CATEGORIES){const button=element("button",category,"axis-add-type");button.prepend(navigationIcon(category));button.onclick=()=>{newTaskCategory=category;axisAdd.close();openTask();};axisAdd.append(button);}
document.body.append(axisAdd);
function addOnAxis(id){newTaskAxis=id;newTaskCategory=null;axisAdd.showModal();}
document.querySelectorAll("[data-view]").forEach(button=>button.onclick=()=>{if(hasDraft()){notice("请先保存待办草稿");return;}if(overviewView!==button.dataset.view)resetAxisScene();overviewView=button.dataset.view;render();});

function svgElement(tag,attributes={},text){const node=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;}
function renderAxes(){
  const board=$("board");board.className="axes-board";
  const toolbar=element("div",null,"axes-toolbar"),add=element("button","＋ 添加轴线","secondary");add.onclick=()=>openAxis();const actions=element("div",null,"axes-toolbar-actions"),save=element("button","保存布局","secondary");save.id="save-layout";
  actions.append(save,add);toolbar.append(element("span",`${axes.length} 条轴线`,"hint"),actions);
  const help=element("details",null,"axis-help");help.open=!axes.length;
  help.append(element("summary","轴线是什么？"),element("p","就是把同一个目标或合集里的卡片连起来。比如“期末复习”，放上作业、小测和复习笔记；以后回看，就知道自己做过哪些准备、哪些问题还没弄懂。点末尾加号添加卡片，拖动调整后记得保存布局。"));
  const canvas=element("div",null,"axes-canvas"),svg=svgElement("svg",{role:"group","aria-label":"轴线画布",tabindex:"0"}),world=svgElement("g");svg.append(world);canvas.append(svg);
  const controls=element("div",null,"canvas-controls");const buttons={};for(const [key,label] of [["minus","−"],["reset","复位"],["plus","＋"]]){const button=element("button",label);button.setAttribute("aria-label",{minus:"缩小画布",reset:"复位画布",plus:"放大画布"}[key]);buttons[key]=button;controls.append(button);}
  canvas.append(controls);board.replaceChildren(toolbar,help,canvas);
  if(!axes.length){const empty=element("button","＋ 为一个目标或合集建轴线","canvas-empty");empty.onclick=()=>openAxis();canvas.append(empty);return;}
  const signature=JSON.stringify(axes.map(axis=>[axis.id,...axisItems.filter(t=>t.axis_id===axis.id).sort(chronological).map(t=>[t.id,cardTime(t)])]));
  if(axisScene?.signature!==signature){
    const previous=axisScene || savedAxisLayout;
    axisScene={signature,camera:previous?.camera || {x:90,y:80,z:1},pivot:previous?.pivot || 0,anchor:previous?.anchor || 0,dirty:axisScene?.dirty || false,lines:axes.map((axis,i)=>{
      const members=axisItems.filter(t=>t.axis_id===axis.id).sort(chronological),old=previous?.lines?.find(line=>line.id===axis.id);
      const nodes=[{id:"head"},...members.map(task=>({id:task.id})),{id:"tail"}].map((node,j)=>{const saved=old?.nodes.find(n=>n.id===node.id);return {...node,x:saved?.x??j*180,y:saved?.y??i*200};});
      for(let j=1;j<nodes.length;j++)nodes[j].x=Math.max(nodes[j].x,nodes[j-1].x+64);
      return {id:axis.id,nodes};
    })};
  }
  const scene=axisScene,groups=[];let paths=[],gesture=null,saving=false;const pointers=new Map();
  save.disabled=!scene.dirty;
  save.onclick=async()=>{
    save.disabled=true;saving=true;const version=scene.editVersion || 0;
    try{const snapshot=structuredClone({camera:scene.camera,pivot:scene.pivot,anchor:scene.anchor,lines:scene.lines});const result=await api("/api/axis-layout","PUT",{layout:snapshot,revision:axisLayoutRevision});savedAxisLayout=result.layout;axisLayoutRevision=result.revision;scene.dirty=(scene.editVersion || 0)!==version;notice("布局已保存");}
    catch(error){notice(error.message);}finally{saving=false;save.disabled=!scene.dirty;}
  };
  const changed=()=>{scene.dirty=true;scene.editVersion=(scene.editVersion || 0)+1;save.disabled=saving;};
  scene.lines.forEach((line,i)=>{
    const axis=axes.find(a=>a.id===line.id),group=svgElement("g",{class:`axis-line axis-color-${i%5}`}),path=svgElement("path",{class:"axis-path"});group.append(path);
    const nodes=line.nodes.map((node,j)=>{
      const kind=j===0?"head":j===line.nodes.length-1?"tail":"card",task=axisItems.find(t=>t.id===node.id),label=kind==="head"?axis.title:kind==="tail"?"添加卡片":task.title;
      const g=svgElement("g",{class:`axis-node axis-${kind}`,"data-line":i,"data-node":j,"data-kind":kind,role:"button",tabindex:"0","aria-label":`${kind==="head"?"编辑轴线":kind==="tail"?"添加卡片到轴线":"编辑卡片"}：${kind==="tail"?axis.title:label}`});
      g.append(svgElement("title",{},label));
      if(kind==="head"){g.append(svgElement("rect",{x:-34,y:-14,width:68,height:28,rx:9}),svgElement("text",{"text-anchor":"middle",y:4},label));}
      else{
        const record=task?.category==="记录",done=task?.status==="done";
        g.append(svgElement("circle",{r:11,class:record?"record-dot":done?"done-dot":"open-dot"}));
        if(kind==="card" && done && !record)g.append(svgElement("path",{d:"M-5 0l3 3 6-7",class:"node-check"}));
        if(kind==="tail")g.append(svgElement("text",{"text-anchor":"middle",y:4},"+"));
        else {g.append(svgElement("text",{"text-anchor":"middle",x:0,y:-25,class:"axis-node-date"},formatTime(cardTime(task))),svgElement("text",{"text-anchor":"middle",x:0,y:34,class:"axis-node-title"},label.length>18?label.slice(0,18)+"…":label));}
      }
      g.prepend(svgElement("circle",{r:23,class:"node-hit"}));
      group.append(g);return g;
    });world.append(group);groups.push({path,nodes});
  });
  // Measure rendered SVG text, so Chinese and Latin titles get their actual width.
  groups.forEach((group,i)=>{
    const head=group.nodes[0],text=head.querySelector("text"),rect=head.querySelector("rect"),width=Math.max(68,text.getComputedTextLength()+24);
    rect.setAttribute("x",String(-width/2));rect.setAttribute("width",String(width));
    scene.lines[i].headWidth=width;
    const nodes=scene.lines[i].nodes,shift=Math.max(0,nodes[0].x+width/2+48-nodes[1].x);for(let j=1;j<nodes.length;j++)nodes[j].x+=shift;
  });
  if(!savedAxisLayout && !scene.dirty && scene.camera.x===90)scene.camera.x=Math.max(90,...scene.lines.map(line=>line.headWidth/2+24));
  function paint(){
    paths=CaptureLayout.project(scene.lines,scene.pivot,112,scene.anchor);
    groups.forEach((group,i)=>{group.path.setAttribute("d",paths[i].map((p,j)=>`${j?"L":"M"}${p.x},${p.y}`).join(" "));scene.lines[i].nodes.forEach((node,j)=>group.nodes[j].setAttribute("transform",`translate(${node.x},${CaptureLayout.interpolate(paths[i],node.x)})`));});
    world.setAttribute("transform",`translate(${scene.camera.x},${scene.camera.y}) scale(${scene.camera.z})`);
    canvas.style.backgroundPosition=`${scene.camera.x}px ${scene.camera.y}px`;canvas.style.backgroundSize=`${28*scene.camera.z}px ${28*scene.camera.z}px`;
  }
  const local=event=>{const rect=svg.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
  const worldPoint=p=>({x:(p.x-scene.camera.x)/scene.camera.z,y:(p.y-scene.camera.y)/scene.camera.z});
  function zoom(factor,p){const before=worldPoint(p);scene.camera.z=Math.max(.25,Math.min(2.5,scene.camera.z*factor));scene.camera.x=p.x-before.x*scene.camera.z;scene.camera.y=p.y-before.y*scene.camera.z;changed();paint();}
  const center=()=>({x:svg.clientWidth/2,y:svg.clientHeight/2});buttons.plus.onclick=()=>zoom(1.2,center());buttons.minus.onclick=()=>zoom(1/1.2,center());buttons.reset.onclick=()=>{scene.camera={x:Math.max(90,...scene.lines.map(line=>line.headWidth/2+24)),y:80,z:1};changed();paint();};
  svg.addEventListener("wheel",event=>{event.preventDefault();if(event.shiftKey){scene.camera.x-=event.deltaY;changed();paint();}else zoom(Math.exp(-event.deltaY*.0015),local(event));},{passive:false});
  function activate(target){const line=scene.lines[+target.dataset.line],node=line.nodes[+target.dataset.node];if(target.dataset.kind==="head")openAxis(axes.find(a=>a.id===line.id));else if(target.dataset.kind==="tail")addOnAxis(line.id);else openTask(axisItems.find(t=>t.id===node.id));}
  function moveNode(i,j,point){const nodes=scene.lines[i].nodes;nodes[j].x=Math.max(j>0?nodes[j-1].x+(j===1?Math.max(64,(scene.lines[i].headWidth || 68)/2+48):64):-20000,Math.min(j<nodes.length-1?nodes[j+1].x-(j===0?Math.max(64,(scene.lines[i].headWidth || 68)/2+48):64):20000,point.x));nodes[j].y=Math.max(-20000,Math.min(20000,point.y));scene.pivot=i;scene.anchor=j;changed();paint();}
  svg.oncontextmenu=event=>event.preventDefault();
  svg.onpointerdown=event=>{
    if(event.button!==0)return;const p=local(event);pointers.set(event.pointerId,p);svg.setPointerCapture(event.pointerId);
    if(pointers.size===2){const [a,b]=[...pointers.values()];gesture={kind:"pinch",distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};return;}
    const target=event.target.closest(".axis-node");gesture={kind:target?"node":"pan",target,start:p,last:p,moved:false};
    if(gesture.kind==="node"){const i=+target.dataset.line,j=+target.dataset.node;const node=scene.lines[i].nodes[j];gesture.offset={x:worldPoint(p).x-node.x,y:worldPoint(p).y-CaptureLayout.interpolate(paths[i],node.x)};}
    canvas.classList.add("grabbing");
  };
  svg.onpointermove=event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;const p=local(event);pointers.set(event.pointerId,p);
    if(gesture.kind==="pinch" && pointers.size===2){const [a,b]=[...pointers.values()],c={x:(a.x+b.x)/2,y:(a.y+b.y)/2},d=Math.hypot(a.x-b.x,a.y-b.y);if(gesture.distance>0)zoom(d/gesture.distance,gesture.center);scene.camera.x+=c.x-gesture.center.x;scene.camera.y+=c.y-gesture.center.y;gesture.distance=d;gesture.center=c;paint();return;}
    if(gesture.kind==="pinch")return;
    if(Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>5)gesture.moved=true;if(!gesture.moved)return;
    if(gesture.kind==="node"){const point=worldPoint(p);moveNode(+gesture.target.dataset.line,+gesture.target.dataset.node,{x:point.x-gesture.offset.x,y:point.y-gesture.offset.y});}
    else{scene.camera.x+=p.x-gesture.last.x;scene.camera.y+=p.y-gesture.last.y;changed();paint();}gesture.last=p;
  };
  svg.onpointerup=event=>{pointers.delete(event.pointerId);if(gesture && gesture.kind!=="pinch" && !gesture.moved && gesture.target)activate(gesture.target);gesture=null;canvas.classList.remove("grabbing");};
  svg.onpointercancel=()=>{pointers.clear();gesture=null;canvas.classList.remove("grabbing");};
  svg.onkeydown=event=>{const target=event.target.closest(".axis-node");if(target && ["Enter"," "].includes(event.key)){event.preventDefault();activate(target);}else if(target && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();const i=+target.dataset.line,j=+target.dataset.node,node=scene.lines[i].nodes[j];moveNode(i,j,{x:node.x+({ArrowLeft:-20,ArrowRight:20}[event.key]||0),y:CaptureLayout.interpolate(paths[i],node.x)+({ArrowUp:-20,ArrowDown:20}[event.key]||0)});}};
  paint();
}

// Native select remains the form control; its visible picker shares the app theme.
let placeOpenSelect=null;
window.addEventListener("resize",()=>placeOpenSelect?.());
document.addEventListener("scroll",event=>{if(!event.target.closest?.(".select-menu"))placeOpenSelect?.();},true);
window.visualViewport?.addEventListener("resize",()=>placeOpenSelect?.());
function enhanceSelect(select){
  if(select.dataset.enhanced){select.dispatchEvent(new Event("capture-refresh"));return;}
  select.dataset.enhanced="true";select.classList.add("custom-select-native");select.tabIndex=-1;select.setAttribute("aria-hidden","true");
  const wrap=element("div",null,"custom-select"),button=element("button",null,"select-trigger"),menu=element("div",null,"select-menu");button.type="button";button.setAttribute("aria-haspopup","listbox");button.setAttribute("aria-expanded","false");menu.popover="auto";menu.setAttribute("role","listbox");
  select.before(wrap);wrap.append(select,button,menu);
  const label=()=>select.getAttribute("aria-label") || document.querySelector(`label[for="${select.id}"]`)?.textContent.trim() || "选择";
  const sync=()=>{const arrow=element("span",null,"select-arrow");arrow.setAttribute("aria-hidden","true");button.replaceChildren(element("span",select.selectedOptions[0]?.textContent || "请选择","select-value"),arrow);button.disabled=select.disabled;button.setAttribute("aria-label",label());menu.replaceChildren(...[...select.options].map(option=>{
    const action=option.dataset.action==="create-axis",entry=element("button",option.textContent,`select-option${action?" select-create-axis":""}`);
    entry.type="button";entry.setAttribute("role","option");entry.setAttribute("aria-selected",String(option.selected));entry.disabled=option.disabled;
    if(action)entry.setAttribute("aria-haspopup","dialog");
    entry.onclick=()=>{close();button.focus();if(action){createAxisFromCard();return;}select.value=option.value;select.dispatchEvent(new Event("change",{bubbles:true}));sync();};return entry;
  }));};
  const close=()=>{if(menu.matches(":popover-open"))menu.hidePopover();button.setAttribute("aria-expanded","false");if(placeOpenSelect===placeMenu)placeOpenSelect=null;};
  const placeMenu=()=>{
    if(!menu.matches(":popover-open"))return;
    const rect=button.getBoundingClientRect(),view=window.visualViewport,top=(view?.offsetTop || 0)+8,bottom=(view?.offsetTop || 0)+(view?.height || innerHeight)-8;
    if(rect.bottom<top || rect.top>bottom){close();return;}
    const above=rect.top-top-6,below=bottom-rect.bottom-6;
    const up=below<Math.min(menu.scrollHeight,260) && above>below;
    menu.style.width=`${Math.min(rect.width,innerWidth-16)}px`;menu.style.maxHeight=`${Math.max(44,Math.min(260,up?above:below))}px`;
    menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(top,up?rect.top-menu.offsetHeight-6:rect.bottom+6)}px`;
  };
  const open=()=>{sync();menu.showPopover();button.setAttribute("aria-expanded","true");placeOpenSelect=placeMenu;placeMenu();};
  menu.addEventListener("beforetoggle",event=>{button.setAttribute("aria-expanded",String(event.newState==="open"));if(event.newState==="closed" && placeOpenSelect===placeMenu)placeOpenSelect=null;});
  button.onclick=()=>{if(menu.matches(":popover-open"))close();else{open();menu.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});}};
  wrap.onkeydown=event=>{if(event.key==="Escape" && menu.matches(":popover-open")){event.preventDefault();event.stopPropagation();close();button.focus();}if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();if(!menu.matches(":popover-open"))open();const choices=[...menu.querySelectorAll("button:not(:disabled)")],index=choices.indexOf(document.activeElement);choices[event.key==="Home"?0:event.key==="End"?choices.length-1:Math.max(0,Math.min(choices.length-1,index+(event.key==="ArrowDown"?1:-1)))]?.focus();}};
  // Safari taps move focus to the dialog before click. Let popover light-dismiss handle taps outside.
  wrap.addEventListener("keydown",event=>{if(event.key==="Tab")requestAnimationFrame(()=>{if(!wrap.contains(document.activeElement))close();});});select.addEventListener("change",sync);select.addEventListener("capture-refresh",sync);sync();
}
const toggle=$("sidebar-toggle"),workspace=$("workspace");
function sidebarState(collapsed){workspace.classList.toggle("sidebar-collapsed",collapsed);toggle.setAttribute("aria-expanded",String(!collapsed));toggle.title=collapsed?"展开侧栏":"收起侧栏";toggle.setAttribute("aria-label",toggle.title);}
sidebarState(localStorage.getItem("rucapture-sidebar")==="collapsed");toggle.onclick=()=>{const collapsed=!workspace.classList.contains("sidebar-collapsed");sidebarState(collapsed);localStorage.setItem("rucapture-sidebar",collapsed?"collapsed":"expanded");closeUserMenu();};

const mobileNavigation=matchMedia("(max-width:900px)"),mobileToggle=$("mobile-nav-toggle"),sidebar=$("sidebar"),main=workspace.querySelector("main");
function mobileSidebar(open,restoreFocus=false){
  open=mobileNavigation.matches && open;workspace.classList.toggle("mobile-nav-open",open);document.documentElement.classList.toggle("mobile-nav-open",open);
  sidebar.inert=mobileNavigation.matches && !open;main.inert=open;
  mobileToggle.setAttribute("aria-expanded",String(open));mobileToggle.setAttribute("aria-label",open?"收起导航":"展开导航");
  if(!open){closeUserMenu();restoreFocus ||= sidebar.contains(document.activeElement);}if(restoreFocus && mobileNavigation.matches)mobileToggle.focus({preventScroll:true});
}
mobileSidebar(false);mobileNavigation.addEventListener("change",()=>mobileSidebar(false));
mobileToggle.onclick=()=>mobileSidebar(!workspace.classList.contains("mobile-nav-open"));
$("mobile-nav-backdrop").onclick=()=>mobileSidebar(false,true);
// Follow horizontal touch gestures without taking vertical scroll, form editing or canvas drags.
let navGesture=null,navIgnoreClickUntil=0;
function finishNavGesture(cancelled=false){
  const gesture=navGesture;navGesture=null;if(!gesture?.dragging)return;
  workspace.classList.remove("mobile-nav-dragging");workspace.style.removeProperty("--mobile-nav-offset");workspace.style.removeProperty("--mobile-nav-progress");
  navIgnoreClickUntil=performance.now()+450;
  mobileSidebar(cancelled || Math.abs(gesture.dx)<48?gesture.open:gesture.dx>0);
}
workspace.addEventListener("touchstart",event=>{
  navIgnoreClickUntil=0;
  if(event.touches.length!==1){finishNavGesture(true);navGesture=null;return;}
  if(!mobileNavigation.matches || workspace.hidden || document.querySelector("dialog[open],:popover-open"))return;
  if(event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),.axes-canvas,.quadrant-viewport,.planning-pending,.planning-card,.drag-handle,.clock-value'))return;
  for(let node=event.target;node && node!==workspace;node=node.parentElement)if(node.scrollWidth>node.clientWidth+2 && /auto|scroll/.test(getComputedStyle(node).overflowX))return;
  const point=event.touches[0];
  navGesture={x:point.clientX,y:point.clientY,dx:0,open:workspace.classList.contains("mobile-nav-open"),width:sidebar.getBoundingClientRect().width,offset:new DOMMatrixReadOnly(getComputedStyle(main).transform).m41,dragging:false};
},{passive:true});
workspace.addEventListener("touchmove",event=>{
  if(!navGesture || event.touches.length!==1)return;
  const gesture=navGesture,point=event.touches[0],dx=point.clientX-gesture.x,dy=point.clientY-gesture.y;
  if(!gesture.dragging){
    if(Math.abs(dy)>12 && Math.abs(dy)>Math.abs(dx)){navGesture=null;return;}
    if(Math.abs(dx)<12 || Math.abs(dx)<Math.abs(dy)*1.3 || !gesture.open && dx<0 || gesture.open && dx>0)return;
    gesture.dragging=true;workspace.classList.add("mobile-nav-dragging");
  }
  event.preventDefault();gesture.dx=dx;
  const offset=Math.max(0,Math.min(gesture.width,gesture.offset+dx));
  workspace.style.setProperty("--mobile-nav-offset",`${offset}px`);workspace.style.setProperty("--mobile-nav-progress",String(offset/gesture.width));
},{passive:false});
workspace.addEventListener("touchend",()=>finishNavGesture(),{passive:true});
workspace.addEventListener("touchcancel",()=>finishNavGesture(true),{passive:true});
workspace.addEventListener("click",event=>{if(event.detail && performance.now()<navIgnoreClickUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
window.addEventListener("resize",()=>{finishNavGesture(true);navGesture=null;});
sidebar.addEventListener("click",event=>{
  const button=event.target.closest("button");if(!mobileNavigation.matches || !button || button.id==="user-menu-toggle" || button.id==="demo-button")return;
  mobileSidebar(false);
  if(button.closest("#categories")){main.querySelector("h1").tabIndex=-1;main.querySelector("h1").focus({preventScroll:true});window.scrollTo({top:0,behavior:"instant"});}
});
$("user-menu").addEventListener("click",event=>{if(event.target.closest("button:not(#effects-toggle)"))mobileSidebar(false);});
document.addEventListener("keydown",event=>{
  if(!workspace.classList.contains("mobile-nav-open") || document.querySelector("dialog[open],:popover-open"))return;
  if(event.key==="Escape"){event.preventDefault();mobileSidebar(false,true);}
  if(event.key==="Tab"){
    const choices=[mobileToggle,...sidebar.querySelectorAll("a[href],button:not(:disabled)")].filter(node=>node.getClientRects().length && getComputedStyle(node).visibility!=="hidden"),index=choices.indexOf(document.activeElement);
    event.preventDefault();choices[(index+(event.shiftKey?-1:1)+choices.length)%choices.length]?.focus();
  }
});

document.querySelectorAll("select").forEach(enhanceSelect);
