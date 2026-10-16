"use strict";
const $ = id => document.getElementById(id);
const CATEGORIES = ["作业", "课程", "考试", "活动", "会议", "记录"];
const CALENDAR_TYPES=["考试","作业","会议","活动","课程","记录"];
let calendarTypes=new Set(CALENDAR_TYPES);
const NAV_CATEGORIES=CATEGORIES.filter(category=>category!=="课程");
let savedAxisLayout=null,axisLayoutRevision=0;
let axes=[],axisItems=[],overviewView="calendar",newTaskAxis=null,newTaskCategory=null;
const STATES = {todo: "待开始", doing: "进行中", done: "已完成"};
let tasks = [], sources = [], categoryFilter = "全部", editing = null, deleting = null;
let syncRevision=null,syncBusy=false,lastFullSync=0;
let refreshSequence = 0, lastPayload = "", toastTimer, taskCategory = "作业", draftTodos = [];
let draftAttachments = [], uploading = false, draftTaskId=null;
let attachmentStorage=null;
let timetables=[], courseSemester=null, courseWeek="all";
let collectorState=null, cloudState=null, syncing=false;
let syncSession=0, cloudCheckSequence=0, collectorCheckSequence=0, lastCloudCheck=0;
const loginRemindersSeen=new Set();
let sourceLinksState=null, boardAccount="personal", trialMode=false;
let publicRegistration=false;
let authMode="login", accountName="", registrationOpen=false, isAdmin=false;
let editingWebsite=-1, websiteBusy=false;
let syncStep=1,syncVisited=1,syncExecuted=false,cloudPanelLoading=false;
const syncGuideVersion=document.getElementById("app-version").textContent+":1.9.7";
let archiveCategory="全部", archiveItems=[], archiveTotal=0, archiveSequence=0;
let selectedDay = localInput(new Date()).slice(0,10), calendarMonth = selectedDay.slice(0,7);


let effectsSaving=false,effectsTransition=null,effectsFadeTimer;
function applyEffects(enabled,animate=false){
  const mode=enabled?"on":"off",root=document.documentElement;
  clearTimeout(effectsFadeTimer);effectsTransition?.skipTransition();root.classList.remove("effects-fading");
  const update=()=>{root.dataset.effects=mode;$("effects-toggle").setAttribute("aria-checked",String(enabled));$("effects-toggle").querySelector(".effects-status").textContent=enabled?"开":"关";};
  if(root.dataset.effects===mode){update();return;}
  if(animate && !matchMedia("(prefers-reduced-motion: reduce)").matches){
    if(document.startViewTransition){effectsTransition=document.startViewTransition(update);effectsTransition.ready.catch(()=>{});}
    else {root.classList.add("effects-fading");effectsFadeTimer=setTimeout(()=>{update();root.classList.remove("effects-fading");},220);}
  }else update();
}
$("effects-toggle").onclick=async()=>{
  if(effectsSaving)return;
  const enabled=document.documentElement.dataset.effects!=="off",session=syncSession;
  effectsSaving=true;$("effects-toggle").disabled=true;applyEffects(!enabled,true);
  try{await api("/api/preferences","PUT",{effects:!enabled});}
  catch(error){if(session===syncSession){applyEffects(enabled,true);notice(error.message);}}
  finally{effectsSaving=false;$("effects-toggle").disabled=false;}
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(message) {
  document.querySelectorAll(".dialog-notice, #toast").forEach(node=>node.hidden=true);
  const dialog=document.activeElement?.closest("dialog[open]");
  let output=$("toast");
  if(dialog){
    output=dialog.querySelector(".dialog-notice") || element("p",null,"dialog-notice");
    output.setAttribute("role","status");
    (dialog.querySelector(".guide-step:not([hidden]) .step-body") || dialog.querySelector("form") || dialog).append(output);
  }
  output.textContent=message;output.hidden=false;
  if(dialog)output.scrollIntoView({block:"nearest",behavior:"smooth"});
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>output.hidden=true,4000);
}
function confirmAction(title,message,label="删除") {
  const dialog=$("action-confirm-dialog"),session=syncSession;
  if(dialog.open)return Promise.resolve(false);
  $("action-confirm-title").textContent=title;$("action-confirm-message").textContent=message;$("action-confirm-accept").textContent=label;
  dialog.returnValue="";
  return new Promise(resolve=>{
    dialog.addEventListener("close",()=>resolve(dialog.returnValue==="confirm" && session===syncSession),{once:true});
    dialog.showModal();
  });
}
async function api(path, method="GET", payload, timeout=45000) {
  const session=syncSession,canRetry=method==="GET" || method==="POST" && path==="/api/tasks" && payload?.id;
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(path,{method,cache:"no-store",headers:{"Content-Type":"application/json"},...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:controller.signal});
      const data=await response.json().catch(error=>{if(controller.signal.aborted)throw error;throw new Error("服务器暂时不可用，请稍后重试");});
      if(!response.ok){
        if(response.status===401 && session===syncSession && !["/api/login","/api/register","/api/recover","/api/recovery-code"].includes(path))showLogin();
        throw Object.assign(new Error(data.error || "请求未完成，请重试"),{status:response.status});
      }
      return data;
    }catch(error){
      const network=controller.signal.aborted || error.name==="AbortError" || error instanceof TypeError;
      if(network && canRetry && !attempt && session===syncSession && navigator.onLine)continue;
      if(network)throw new Error(method==="GET"?"连接暂时中断，请稍后刷新。": "网络连接中断，请重试。填写的内容仍保留在这里。");
      throw error;
    }finally{clearTimeout(timer);}
  }
}
function showLogin() {
  if(typeof mobileSidebar==="function")mobileSidebar(false);
  if(typeof resetDailySummary==="function")resetDailySummary();
  if(typeof resetPlanning==="function")resetPlanning();
  refreshSequence++;syncRevision=null;lastFullSync=0;closeUserMenu();
  if(typeof resetMessages==="function")resetMessages();
  syncSession++;lastCloudCheck=0;loginRemindersSeen.clear();
  $("expired-sites").replaceChildren();
  $("workspace").hidden = true;
  $("login").hidden = false;
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  tasks = [];savedAxisLayout=null;axisLayoutRevision=0; axes=[];axisItems=[];resetAxisScene();sources = []; timetables=[]; archiveItems=[]; lastPayload = "";
  $("archive-list").replaceChildren(); $("archive-detail").replaceChildren();
  $("board").replaceChildren(); $("sources-list").replaceChildren(); collectorState=null; cloudState=null;
  sourceLinksState=null;if(trialMode)boardAccount="";
  syncStep=syncVisited=1;syncExecuted=false;cloudPanelLoading=false;$("cloud-panel").replaceChildren();
  editing=null;deleting=null;draftTodos=[];draftAttachments=[];attachmentStorage=null;calendarTypes=new Set(CALENDAR_TYPES);
  $("task-form").reset();$("task-todos").replaceChildren();$("task-links").replaceChildren();$("task-attachments").replaceChildren();$("source-links-form").reset();$("website-list").replaceChildren();$("source-links-form").hidden=true;$("recovery-value").textContent="";$("account-password").value="";
}
function formatTime(value, includeYear = false) {
  if (!value) return "待补充时间";
  return new Intl.DateTimeFormat("zh-CN", {timeZone: "Asia/Shanghai", ...(includeYear ? {year:"numeric"} : {}),
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date(value));
}
function localInput(value) {
  return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0,16) : "";
}
function inputTime(value) { return value ? new Date(`${value}:00+08:00`).toISOString() : null; }
function deadline(task) { return task.category === "作业" ? task.due_at : task.ends_at; }
function fileSize(size) { return size === 0 ? "0 KB" : size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`; }
function externalLink(label, url) {
  const link = element("a", label); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; return link;
}
function fileRow(file, removable = false) {
  const row = element("div", null, "resource-row");
  const suffix = file.name.split(".").pop().slice(0, 5).toUpperCase();
  row.append(element("span", suffix || "文件", "resource-kind"));
  if (file.pending) { const name=element("span", file.name); name.append(element("small", `${fileSize(file.size)} · 保存任务后可打开`)); row.append(name); }
  else {
    const link=externalLink(file.name, `/api/files/${file.id}`); link.setAttribute("aria-label", `打开附件：${file.name}`);
    link.append(element("small", fileSize(file.size))); row.append(link);
    const download=externalLink("下载", `/api/files/${file.id}?download=1`); download.className="file-download"; download.setAttribute("aria-label", `下载附件：${file.name}`); row.append(download);
  }
  if (removable) {
    const remove=element("button", "×"); remove.type="button"; remove.setAttribute("aria-label", `移除附件：${file.name}`); remove.disabled=uploading;
    remove.onclick=async()=>{ if(!await confirmAction("移除附件？",`“${file.name}”将从这张卡片中移除，保存后生效。`,"移除"))return; draftAttachments=draftAttachments.filter(value=>value.id!==file.id); renderAttachments(); }; row.append(remove);
  }
  return row;
}
function renderAttachments() {
  $("task-attachments").replaceChildren(...draftAttachments.map(file=>fileRow(file,true)));
  if (!draftAttachments.length) $("task-attachments").append(element("p", "还没有附件", "resource-empty"));
}
function renderAttachmentStorage(storage=attachmentStorage) {
  attachmentStorage=storage;
  const limit=storage?.limit || (trialMode?5:100)*1024*1024,fileLimit=storage?.file_limit || (trialMode?1:10)*1024*1024;
  $("file-limit-hint").textContent=`单个文件 ≤ ${fileLimit/1024/1024} MB`;
  $("attachment-storage").textContent=storage?`账号附件：已用 ${fileSize(storage.used)} / ${limit/1024/1024} MB · 剩余 ${fileSize(Math.max(0,limit-storage.used))}`:`所有卡片共用账号 ${limit/1024/1024} MB 空间，用量待刷新`;
}
function addLinkRow(link = {label:"",url:""}) {
  if ($("task-links").querySelectorAll(".link-edit-row").length >= 20) { notice("最多添加 20 个链接"); return; }
  $("task-links").querySelector(".resource-empty")?.remove();
  const row=element("div", null, "link-edit-row"), label=element("input"), url=element("input"), remove=element("button", "×");
  label.placeholder="链接名称（选填）"; label.maxLength=100; label.value=link.label; label.setAttribute("aria-label", "链接名称"); label.className="link-label";
  url.type="url"; url.placeholder="https://…"; url.maxLength=4000; url.value=link.url; url.setAttribute("aria-label", "链接地址"); url.className="link-url";
  remove.type="button"; remove.setAttribute("aria-label", "移除链接"); remove.onclick=async()=>{if(await confirmAction("移除这条链接？","保存卡片后生效。","移除"))row.remove();}; row.append(label,url,remove); $("task-links").append(row);
}
$("add-link").onclick=()=>addLinkRow();
$("attachment-input").onchange=async () => {
  const selected=[...$("attachment-input").files]; if (!selected.length) return;
  $("attachment-error").textContent="";$("upload-state").textContent="";
  if (selected.length + draftAttachments.length > 20) { $("attachment-error").textContent="每张卡片最多 20 个附件"; $("attachment-input").value=""; return; }
  const fileLimit=attachmentStorage?.file_limit || (trialMode?1:10)*1024*1024;
  if (selected.some(file=>!file.size || file.size>fileLimit)) { $("attachment-error").textContent=`附件不能为空，单个文件最多 ${fileLimit/1024/1024} MB`; $("attachment-input").value=""; return; }
  uploading=true; $("save-task").disabled=true; $("attachment-input").disabled=true;
  $("task-dialog").querySelectorAll(".close-dialog").forEach(button=>button.disabled=true); renderAttachments();
  try {
    for (const [index,file] of selected.entries()) {
      $("upload-state").textContent=`正在上传 ${index+1}/${selected.length}：${file.name}`;
      const form=new FormData(); form.set("file",file);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
      try {
        const response=await fetch("/api/files",{method:"POST",body:form,signal:controller.signal});
        let data; try { data=await response.json(); } catch { throw new Error("文件上传失败，请重试"); }
        if(data.storage)renderAttachmentStorage(data.storage);
        if (!response.ok) throw new Error(data.error || "文件上传失败，请重试");
        const {storage,...fileData}=data;draftAttachments.push({...fileData,pending:true}); renderAttachments();
      }catch(error){
        if(controller.signal.aborted || error.name==="AbortError" || error instanceof TypeError)throw new Error("上传连接中断，请重新选择未上传的文件。卡片内容已保留。");
        throw error;
      }finally{clearTimeout(timer);}
    }
    $("upload-state").textContent="上传完成，保存任务后即可在所有设备打开。";
  } catch (error) { $("attachment-error").textContent=error.message; $("attachment-error").scrollIntoView({block:"center"});$("upload-state").textContent="未上传成功的文件可重新选择，已上传部分会保留。"; }
  finally { uploading=false; $("save-task").disabled=false; $("attachment-input").disabled=false; $("attachment-input").value=""; $("task-dialog").querySelectorAll(".close-dialog").forEach(button=>button.disabled=false); renderAttachments(); }
};
$("task-dialog").addEventListener("cancel",event=>{if(uploading) event.preventDefault();});
function hasDraft() { return !!$("board").dataset.busy || !!document.querySelector("#board [data-dirty], #board [data-busy], #board .dragging, #board .camera-moving, #course-detail [data-dirty], #course-detail [data-busy], #course-detail .dragging, #focus-history [data-dirty], #focus-history [data-busy]"); }
function checklist(initial, persist, inDialog = false) {
  const root = element("div", null, "checklist");
  let items = structuredClone(initial), saved = structuredClone(initial), editingId = null, adding = "", pendingCommit=false;
  const list = element("div", null, "todo-list"), progress = element("span", null, "checklist-count");
  const error = element("p", "", "error checklist-error"); error.setAttribute("role", "alert");
  const recovery = element("div", null, "checklist-recovery"); recovery.hidden = true;
  const retry = element("button", "重试保存", "text-button"), discard = element("button", "放弃草稿并刷新", "text-button");
  retry.type = discard.type = "button";
  retry.onclick = () => commit();
  discard.onclick = () => { items = structuredClone(saved); editingId = null; adding = ""; delete root.dataset.dirty; recovery.hidden = true; draw(); if (!inDialog) refresh(); };
  recovery.append(retry, discard);
  const addRow = element("div", null, "todo-add"), input = element("input"), add = element("button", "+", "todo-add-button");
  input.placeholder = "添加待办事项…"; input.maxLength = 500; input.setAttribute("aria-label", "新的待办事项");
  add.type = "button"; add.setAttribute("aria-label", "添加待办事项");
  input.oninput = () => { adding = input.value; markDirty(); };
  input.onkeydown = event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); add.click(); } if (event.key === "Escape") { adding = input.value = ""; markDirty(); } };
  add.onclick = async () => {
    if (!input.value.trim() || root.dataset.busy || editingId) return;
    if (items.length >= 100) { error.textContent = "每项任务最多 100 条待办"; return; }
    items.push({id: crypto.randomUUID(), text: input.value.trim(), done: false});
    adding = input.value = ""; await commit(); input.focus();
  };
  addRow.append(input, add); root.append(progress, list, addRow, error, recovery);
  function markDirty() {
    if (editingId || adding || JSON.stringify(items) !== JSON.stringify(saved)) root.dataset.dirty = "true";
    else delete root.dataset.dirty;
  }
  async function commit(quiet=false) {
    if (root.dataset.busy) {if(quiet)pendingCommit=true;return;}
    const submitted=structuredClone(items);let succeeded=false;
    markDirty(); root.dataset.busy = "true"; error.textContent = ""; recovery.hidden = true;
    root.setAttribute("aria-busy","true");
    try { await persist(submitted); saved = submitted;succeeded=true; }
    catch (failure) { error.textContent = `${failure.message}。草稿已保留。`; recovery.hidden = false; retry.disabled = failure.status === 409; }
    finally { delete root.dataset.busy;root.removeAttribute("aria-busy");if(pendingCommit && succeeded){pendingCommit=false;await commit(true);}else{pendingCommit=false;draw();markDirty();} }
  }
  function draw() {
    progress.textContent = `待办事项 · ${items.filter(item => item.done).length} / ${items.length}`;
    list.replaceChildren(...items.map(item => {
      const row = element("div", null, "todo-row" + (item.done ? " checked" : "")); row.dataset.id = item.id;
      const handle = element("button", "⋮⋮", "drag-handle"); handle.type = "button";
      handle.setAttribute("aria-label", `拖动排序：${item.text}，也可按上下方向键`);
      handle.title = "拖动排序 / 上下方向键";
      handle.onkeydown = async event => {
        if (event.key === "Escape" && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(false); return; }
        if (drag) return;
        if (!["ArrowUp", "ArrowDown"].includes(event.key) || editingId || root.dataset.busy) return;
        event.preventDefault(); const from = items.indexOf(item), to = from + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= items.length) return;
        items.splice(to, 0, items.splice(from, 1)[0]); await commit();
        list.querySelector(`[data-id="${item.id}"] .drag-handle`)?.focus();
      };
      let drag = null;
      const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
      async function finishDrag(saveOrder) {
        if (!drag || drag.ending) return;
        const current = drag; current.ending = true;
        if (handle.hasPointerCapture(current.pointerId)) handle.releasePointerCapture(current.pointerId);
        if (saveOrder && !reducedMotion()) {
          const landing = row.animate([{transform:row.style.transform}, {transform:`translateY(${current.placeholder.offsetTop}px) scale(1)`}],
            {duration:150,easing:"cubic-bezier(.2,.7,.25,1)",fill:"forwards"});
          await landing.finished.catch(()=>{}); landing.cancel();
        }
        current.placeholder.replaceWith(row);
        row.classList.remove("dragging"); row.style.removeProperty("transform");
        list.querySelectorAll(".todo-row").forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));
        drag = null;
        if (!saveOrder) { draw(); markDirty(); return; }
        const order = new Map(items.map(item => [item.id, item]));
        items = [...list.children].map(node => order.get(node.dataset.id));
        if (JSON.stringify(items) !== JSON.stringify(saved)) await commit(); else markDirty();
        list.querySelector(`[data-id="${item.id}"] .drag-handle`)?.focus({preventScroll:true});
      }
      handle.onpointerdown = event => {
        if (event.button !== 0 || editingId || adding || root.dataset.busy || list.querySelector(".dragging")) return;
        event.preventDefault(); handle.focus({preventScroll:true});
        const rect = row.getBoundingClientRect(), top = row.offsetTop;
        const placeholder = element("div",null,"todo-placeholder");
        placeholder.style.height = `${rect.height}px`; placeholder.setAttribute("aria-hidden","true");
        row.before(placeholder);
        drag = {placeholder,offsetY:event.clientY-rect.top,pointerId:event.pointerId,ending:false};
        row.classList.add("dragging"); row.style.transform = `translateY(${top}px) scale(1.015)`;
        root.dataset.dirty = "true";
        handle.setPointerCapture(event.pointerId);
      };
      handle.onpointermove = event => {
        if (!drag || drag.ending) return;
        const y = event.clientY-list.getBoundingClientRect().top;
        row.style.transform = `translateY(${y-drag.offsetY}px) scale(1.015)`;
        const siblings = [...list.querySelectorAll(".todo-row:not(.dragging)")];
        const next = siblings.find(node => y < node.offsetTop + node.offsetHeight / 2);
        let after = drag.placeholder.nextElementSibling;
        if (after === row) after = after.nextElementSibling;
        if (after === (next || null)) return;
        const positions = siblings.map(node => node.getBoundingClientRect().top);
        siblings.forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));
        list.insertBefore(drag.placeholder,next || null);
        if (!reducedMotion()) siblings.forEach((node,index)=>{
          const offset = positions[index]-node.getBoundingClientRect().top;
          if (offset) node.animate([{transform:`translateY(${offset}px)`},{transform:"translateY(0)"}],{duration:180,easing:"cubic-bezier(.2,.7,.25,1)"});
        });
      };
      handle.onpointerup = () => finishDrag(true);
      handle.onpointercancel = handle.onlostpointercapture = () => finishDrag(false);
      const check = element("input"); check.type = "checkbox"; check.checked = item.done; check.setAttribute("aria-label", `完成：${item.text}`);
      check.onchange = () => { item.done = check.checked;row.classList.toggle("checked",item.done);progress.textContent=`待办事项 · ${items.filter(value=>value.done).length} / ${items.length}`;commit(true); };
      row.append(handle, check);
      if (editingId === item.id) {
        handle.disabled = check.disabled = true;
        const edit = element("input", null, "todo-edit"); edit.value = item.text; edit.maxLength = 500; edit.setAttribute("aria-label", "编辑待办事项");
        edit.oninput = () => { item.text = edit.value; };
        const save = element("button", "✓", "todo-action"), cancel = element("button", "↶", "todo-action"); save.type = cancel.type = "button";
        save.setAttribute("aria-label", "确认待办修改"); cancel.setAttribute("aria-label", "取消待办修改");
        save.onclick = () => { if (!item.text.trim()) { error.textContent = "待办事项不能为空"; edit.focus(); return; } item.text = item.text.trim(); editingId = null; commit(); };
        cancel.onclick = () => { item.text = row.originalText; editingId = null; error.textContent = ""; draw(); markDirty(); };
        edit.onkeydown = event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); save.click(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel.click(); } };
        row.originalText = item.text; row.append(edit, save, cancel);
      } else {
        const text = element("button", item.text, "todo-text"); text.type = "button"; text.title = "点击编辑";
        text.setAttribute("aria-label", `编辑待办：${item.text}`);
        text.onclick = () => { if(root.dataset.busy)return;editingId = item.id; draw(); markDirty(); list.querySelector(".todo-edit").focus(); };
        row.append(text);
      }
      const remove = element("button", "×", "todo-action"); remove.type = "button"; remove.setAttribute("aria-label", `删除待办：${item.text}`);
      remove.onclick = async () => { if(root.dataset.busy)return;if(!await confirmAction("删除这条待办？",item.text))return;if(root.dataset.busy || !root.isConnected)return;items = items.filter(value => value.id !== item.id);if(editingId===item.id)editingId=null;commit(); };
      row.append(remove);
      if (editingId && editingId !== item.id) row.querySelectorAll("button,input").forEach(node => node.disabled = true);
      return row;
    }));
    input.disabled = add.disabled = !!editingId; discard.disabled = false;
    if (recovery.hidden) retry.disabled = false;
  }
  draw(); return root;
}
function navigationIcon(category) {
  const paths={
    "全部":"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    "作业":"M8 3h8l3 3v15H5V3h3 M8 11l2 2 5-5 M8 17h7",
    "课程":"M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z M12 6v14",
    "考试":"M8 3h8 M12 3v3 M18 6l2-2 M12 10v5l3 2 M21 15a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    "活动":"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
    "记录":"M4 3h12l4 4v14H4z M8 10h8 M8 14h8 M8 18h5",
    "会议":"M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-2a7 7 0 0 1 14 0v2 M19 7a3 3 0 0 1 0 6 M22 20v-2a5 5 0 0 0-3-4",
    "灯光":"M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0l-1 2H9z M12 1v1 M3 5l1 1 M20 6l1-1",
    "总结":"M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 15l3 3 5-5",
    "消息":"M18 8a6 6 0 0 0-12 0v5l-2 4h16l-2-4z M10 21h4",
    "反馈":"M4 4h16v12H9l-5 4z M8 8h8 M8 12h5",
    "归档":"M4 8h16v13H4z M3 3h18v5H3z M9 12h6",
    "账户":"M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21a8 8 0 0 1 16 0",
    "退出":"M9 3H4v18h5 M10 12h11 M17 8l4 4-4 4",
    "演示":"M9 7l8 5-8 5z M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    "同步":"M20 10a8 8 0 0 0-14-4L3 9 M3 4v5h5 M4 14a8 8 0 0 0 14 4l3-3 M21 20v-5h-5",
    "专注":"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2"
  };
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS(svg.namespaceURI,"path");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("class",`nav-icon cat-${CATEGORIES.indexOf(category)}`);
  path.setAttribute("d",paths[category]);svg.append(path);return svg;
}
function animateView() {
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  [document.querySelector(".heading"),document.querySelector(".summary"),$("board")].filter(node=>!node.hidden).forEach((node,index)=>{
    node.getAnimations().forEach(animation=>animation.cancel());
    node.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"translateY(0)"}],{duration:260,delay:index*35,easing:"cubic-bezier(.2,.7,.25,1)",fill:"backwards"});
  });
}
function updateAccountCard() {
  const name=accountName || "我的账户",role=trialMode?(isAdmin?"管理员":"个人账户"):"个人空间";
  $("user-card-name").textContent=$("user-menu-name").textContent=name;
  $("user-card-role").textContent=$("user-menu-role").textContent=role;
  $("user-avatar").textContent=accountName?Array.from(accountName).slice(0,2).join("").toUpperCase():"RU";
  $("user-menu-toggle").setAttribute("aria-label",`${name}，打开账户菜单`);
}
function closeUserMenu(){if($("user-menu").matches(":popover-open"))$("user-menu").hidePopover();}
function positionUserMenu(){
  const menu=$("user-menu");if(!menu.matches(":popover-open"))return;
  const rect=$("user-menu-toggle").getBoundingClientRect(),gap=10,pad=12,height=menu.offsetHeight;
  const top=rect.top>=height+gap+pad?rect.top-height-gap:Math.min(rect.bottom+gap,innerHeight-height-pad);
  menu.style.left=`${Math.max(pad,Math.min(rect.left,innerWidth-menu.offsetWidth-pad))}px`;
  menu.style.top=`${Math.max(pad,top)}px`;
}
$("user-menu").addEventListener("beforetoggle",event=>{
  $("user-menu-toggle").setAttribute("aria-expanded",String(event.newState==="open"));if(event.newState==="open")requestAnimationFrame(positionUserMenu);
});
$("user-menu").addEventListener("click",event=>{if(event.target.closest("button:not(#effects-toggle)"))closeUserMenu();});
window.addEventListener("resize",positionUserMenu);document.addEventListener("scroll",positionUserMenu,true);
for(const [id,icon] of [["focus-button","专注"],["demo-button","演示"],["sources-button","同步"],["effects-toggle","灯光"],["daily-summary-button","总结"],["messages-button","消息"],["feedback-button","反馈"],["archive-button","归档"],["account-button","账户"],["logout","退出"]])$(id).prepend(navigationIcon(icon));
function renderNavigation() {
  $("categories").replaceChildren(...["全部", ...NAV_CATEGORIES].map(category => {
    const button = element("button", null, "nav-button" + (categoryFilter === category ? " active" : ""));
    button.setAttribute("aria-pressed", String(categoryFilter === category));button.title=category==="全部"?"总览":category;button.setAttribute("aria-label",button.title);
    button.append(navigationIcon(category), element("span", category === "全部" ? "总览" : category),
      element("span", String(tasks.filter(t => category==="记录"?t.category==="记录":!["课程","记录"].includes(t.category) && t.status !== "done" && (category === "全部" || t.category === category)).length), "count"));
    button.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } const changed=categoryFilter!==category;categoryFilter = category; closeAddMenu(); render();if(changed)animateView(); };
    return button;
  }));
}
function taskContent(task) {
  const content=task?.content && task.content!==task.title?task.content:"";
  return [content,task?.details?.organizer?`组织者 / 主持人：${task.details.organizer}`:""].filter(Boolean).join("\n");
}
function timeRange(task) {
  if(task.category==="记录")return formatTime(task.starts_at,true);
  const start=localInput(task.starts_at),end=localInput(task.ends_at);
  return `${formatTime(task.starts_at,start.slice(0,4)!==end.slice(0,4))} – ${start.slice(0,10)===end.slice(0,10)?end.slice(11):formatTime(task.ends_at,start.slice(0,4)!==end.slice(0,4))}`;
}
function syllabusURL(task) {
  const url=task.source_url?.includes("/student/student-choice-center/syllabus-entry-check.html#/?param=")?task.source_url:null;
  if(!url)return null;
  try{const parsed=new URL(url);return parsed.protocol==="https:" && parsed.hostname==="jw.ruc.edu.cn"?parsed.href:null;}catch{return null;}
}
function taskSourceLink(task) {
  if(task.category==="课程") {const url=syllabusURL(task);return url?externalLink("教学大纲 ↗",url):null;}
  return task.source_url?externalLink(task.source?.startsWith("ruc_")?"教务原页面 ↗":"查看原作业 ↗",task.source_url):null;
}
function taskQuadrantBadge(task){
  if(task.category==="课程" || task.archived_at || typeof quadrantPositions==="undefined")return null;
  const p=quadrantPositions[task.id],name=p?.x!=null?quadrantOf(p.x,p.y)?.title:null;
  if(!name)return null;
  const badge=element("span",name,"task-quadrant");badge.dataset.quadrant=name;return badge;
}
function card(task) {
  const article = element("article", null, "task");
  article.dataset.taskId = task.id;article.dataset.category=task.category;
  const meta = element("div", null, "task-meta");
  const kind=element("span",null,"task-kind"),quadrant=taskQuadrantBadge(task);
  kind.append(element("span", task.category, `badge cat-${CATEGORIES.indexOf(task.category)}`));if(quadrant)kind.append(quadrant);
  const sourceLabel=element("span",null,"source-label");sourceLabel.append(element("span",task.source ? sources.find(s => s.id === task.source)?.name || task.source : "手动添加","task-source-name"));
  meta.append(kind,sourceLabel);
  const title = element("h3", task.title, "task-title");
  article.append(meta, title);
  const isOverdue = task.category === "作业" && task.status !== "done" && deadline(task) && new Date(deadline(task)) < new Date();
  const time = element("div", null, "task-time" + (isOverdue ? " overdue" : ""));
  const completedHomework=task.category==="作业" && task.status==="done";
  time.append(element("p", (isOverdue ? "已逾期 · " : "") + (completedHomework ? "完成时间" : task.category === "作业" ? "截止时间" : task.category==="记录"?"时间":"起止时间"), "time-label"));
  if (task.category === "作业") time.append(element("p", formatTime(completedHomework ? task.completed_at : task.due_at, true)));
  else time.append(element("p", timeRange(task), "time-range"));
  article.append(time);
  if(task.location && task.category!=="记录")article.append(element("p", `⌖ ${task.location}`, "task-location"));
  if(taskContent(task))article.append(element("p",taskContent(task),"task-content"));
  for(const [key,label] of [["teacher","教师"],["seat","座位"]])if(task.details?.[key])article.append(element("p",`${label} · ${task.details[key]}`,"event-detail"));
  if(task.details?.period)article.append(element("p",`第 ${task.details.week} 周 · ${task.details.period}`,"event-detail"));
  if(task.course)article.append(element("p",task.course,"course"));
  const footer = element("div", null, "task-footer");
  const status=element(task.category==="作业"?"select":"input",null,"task-status");
  status.setAttribute("aria-label",`任务状态：${task.title}`);
  if(task.category==="作业") {for(const [value,label] of Object.entries(STATES)) {const option=element("option",label);option.value=value;status.append(option);}status.value=task.status;}
  else {status.type="checkbox";status.checked=task.status==="done";status.setAttribute("aria-label",`${task.category==="记录"?"已完善":"已完成"}：${task.title}`);}
  status.onchange=async()=>{
    if(hasDraft()) {status.value=task.status;status.checked=task.status==="done";notice("请先保存或取消正在编辑的待办事项");return;}
    article.dataset.busy="true";
    article.querySelectorAll("button,input,select").forEach(node=>node.disabled=true);
    try {
      const updated=await api(`/api/tasks/${task.id}`,"PATCH",{status:task.category==="作业"?status.value:status.checked?"done":"todo",revision:task.revision});
      tasks=tasks.map(value=>value.id===updated.id?updated:value);lastPayload="";
      task=current=updated;
      notice(`已设为${task.category==="作业"?STATES[updated.status]:updated.status==="done"?(task.category==="记录"?"已完善":"已完成"):(task.category==="记录"?"待完善":"未完成")}`);
    } catch(error) {notice(error.message);}
    finally {
      delete article.dataset.busy;status.value=task.status;status.checked=task.status==="done";
      article.querySelectorAll("button,input,select").forEach(node=>node.disabled=false);
      if(!hasDraft()) render();await refresh();
    }
  };
  if(task.category==="作业")footer.append(status);
  else if(task.category!=="课程") {const label=element("label",null,"completion-control");label.append(status,document.createTextNode(task.category==="记录"?"已完善":"已完成"));footer.append(label);}
  if(task.category!=="课程"){
    const controls=element("div",null,"card-state-controls"),axisSelect=element("select",null,"card-axis-select");
    axisSelect.setAttribute("aria-label",`所属轴线：${task.title}`);axisSelect.dataset.emptyLabel="所属轴线";
    controls.append(...footer.childNodes,axisSelect);footer.append(controls);fillAxisSelect(task.axis_id,axisSelect);
    async function saveAxis(axisId,created=false){
      const restore=()=>fillAxisSelect(task.axis_id,axisSelect);
      if(hasDraft()){restore();notice("请先保存或取消正在编辑的待办事项");return;}
      if((task.axis_id || "")===(axisId || ""))return;
      const session=syncSession,latest=tasks.find(item=>item.id===task.id);
      if(!latest){restore();notice("这张卡片已不在看板中，请刷新后查看。");return;}
      const busyKey=`axis:${session}`;$("board").dataset.busy=busyKey;
      const visible=document.querySelector(`.task[data-task-id="${task.id}"]`) || article;
      visible.setAttribute("aria-busy","true");visible.querySelectorAll("button,input,select").forEach(node=>node.disabled=true);
      try{
        const updated=await api(`/api/tasks/${task.id}`,"PATCH",{axis_id:axisId || null,revision:latest.revision});
        if(session!==syncSession)return;
        tasks=tasks.map(item=>item.id===updated.id?updated:item);axisItems=axisItems.map(item=>item.id===updated.id?updated:item);task=current=updated;lastPayload="";
        notice(axisId?"已更新所属轴线":"已移出轴线");
      }catch(error){if(session===syncSession)notice(`${created?"轴线已创建，卡片归属未更新：":"归属未更新："}${error.message}`);}
      finally{
        if($("board").dataset.busy===busyKey)delete $("board").dataset.busy;visible.removeAttribute("aria-busy");visible.querySelectorAll("button,input,select").forEach(node=>node.disabled=false);
        if(session===syncSession){restore();if(!hasDraft())render();await refresh();}
      }
    }
    axisSelect.onchange=()=>saveAxis(axisSelect.value);
    axisSelect.onAxisCreated=id=>saveAxis(id,true);
  }
  const footerMain=element("div",null,"task-footer-main");footerMain.append(...footer.childNodes);const original=taskSourceLink(task);if(original){original.classList.add("task-original-link");meta.lastChild.append(original);}footer.append(footerMain);
  const actions = element("div", null, "task-actions");
  const edit = element("button", "编辑", "edit-task");
  edit.type = "button";
  edit.setAttribute("aria-label", `编辑：${task.title}`);
  edit.onclick = () => openTask(task);
  const remove = element("button", "删除", "delete-task");
  remove.type = "button";
  remove.setAttribute("aria-label", `删除：${task.title}`);
  remove.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } confirmCardDeletion(task); };
  const archive=element("button","归档","archive-task");archive.type="button";archive.setAttribute("aria-label",`归档：${task.title}`);archive.onclick=()=>archiveTask(task,true);
  actions.append(edit,archive,remove); footerMain.append(actions);
  let current = task;
  const list = checklist(task.todos, async todos => {
    current = await api(`/api/tasks/${task.id}`, "PATCH", {todos, revision: current.revision});
    tasks = tasks.map(value => value.id === current.id ? current : value);
    task = current; lastPayload = "";
  });
  if(task.category!=="课程" || task.todos.length) article.append(list);
  if (task.attachments?.length || task.links?.length) {
    const resources=element("div", null, "resources");
    resources.append(...(task.attachments || []).map(file=>fileRow(file)));
    for (const link of task.links || []) { const row=element("div",null,"resource-row"); row.append(element("span","链接","resource-kind"),externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url)); resources.append(row); }
    article.append(resources);
  }
  article.append(footer);
  return article;
}
function groupHeading(title,count) {
  const heading=element("h2",null,"column-heading"),dot=element("span",null,"line");dot.setAttribute("aria-hidden","true");
  heading.append(dot,element("span",title),element("span",String(count),"count"));return heading;
}
function render() {
  queueMicrotask(()=>document.querySelectorAll("select:not([data-enhanced])").forEach(enhanceSelect));
  renderNavigation();$("workspace").dataset.category=categoryFilter;
  document.querySelector(".summary").hidden=false;
  document.querySelector(".summary").removeAttribute("data-schedule");
  const visible = tasks.filter(t => categoryFilter === "全部" || categoryFilter === t.category);
  $("view-title").textContent = categoryFilter === "全部" ? "总览" : categoryFilter;
  $("add-task").textContent = categoryFilter === "全部" ? "＋ 添加卡片" : `＋ 添加${categoryFilter}`;
  const taskItems=visible.filter(t=>!["课程","记录"].includes(t.category)),open = taskItems.filter(t => t.status !== "done");
  $("count-open").textContent = open.length;
  $("count-done").textContent = taskItems.length - open.length;
  const current = Date.now();
  $("count-soon").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() >= current && new Date(deadline(t)).getTime() <= current + 7 * 86400000).length;
  $("count-overdue").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() < current).length;
  $("board").className="board"+(categoryFilter==="全部"?" calendar-board":categoryFilter!=="作业"?" schedule-board":"");
  document.querySelectorAll(".summary>div").forEach((node,index)=>{
    node.querySelector("span").textContent=["待完成","未来 7 天到期","已逾期","已完成"][index];
    node.querySelector("small").textContent=[categoryFilter==="作业"?"按截止时间从近到远":"课程与记录不计入任务统计","未来 7 天内到期的未完成任务","到期仍未完成的任务","按完成时间倒序 · 满 7 天自动归档"][index];
  });
  $("overview-views").hidden=categoryFilter!=="全部";
  document.querySelectorAll("[data-view]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.view===overviewView)));
  if(categoryFilter==="全部") {overviewView==="axes"?renderAxes():overviewView==="quadrants"?renderQuadrants():renderCalendar();renderSources();return;}
  if(categoryFilter==="记录") {renderRecords(visible);renderSources();return;}
  if(categoryFilter!=="作业") {renderSchedule(visible);renderSources();return;}
  $("board").replaceChildren(...Object.entries(STATES).map(([state, label]) => {
    const column = element("section", null, `column ${state}`);
    const matching = visible.filter(t => t.status === state).sort((a,b) => state==="done"
      ? (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at) || b.id.localeCompare(a.id)
      : (deadline(a) || "9999").localeCompare(deadline(b) || "9999") || a.created_at.localeCompare(b.created_at));
    column.append(groupHeading(label,matching.length));
    const list=element("div",null,"schedule-list homework-group");
    if(matching.length)list.append(...matching.map(card));else list.append(emptySchedule(label,"作业",state==="todo"));column.append(list);
    return column;
  }));
  renderSources();
}
function shiftDay(day,amount) { return new Date(Date.parse(`${day}T00:00:00Z`)+amount*86400000).toISOString().slice(0,10); }
function monday(day) { return shiftDay(day,-((new Date(`${day}T00:00:00Z`).getUTCDay()+6)%7)); }
function shortDay(day) { return `${Number(day.slice(5,7))} 月 ${Number(day.slice(8))} 日`; }
function scheduleStats(labels,values,hints) {
  document.querySelector(".summary").dataset.schedule=categoryFilter;
  document.querySelectorAll(".summary>div").forEach((node,index)=>{
    node.querySelector("span").textContent=labels[index];node.querySelector("strong").textContent=values[index];node.querySelector("small").textContent=hints[index];
  });
}
function weekRanges(values) {
  const weeks=[...new Set(values.map(Number).filter(n=>Number.isInteger(n) && n>0))].sort((a,b)=>a-b),ranges=[];
  for(let i=0;i<weeks.length;i++) {const first=weeks[i];while(weeks[i+1]===weeks[i]+1)i++;ranges.push(first===weeks[i]?`${first}`:`${first}–${weeks[i]}`);}
  return ranges.join("、");
}
function renderTimetable(courses) {
  const root=$("board"),terms=new Map(timetables.map(table=>[table.semester,table.label]));
  for(const task of courses)if(!terms.has(task.details?.semester || "manual"))terms.set(task.details?.semester || "manual",task.details?.semester_label || task.details?.semester || "手动课程");
  const choices=[...terms.entries()].sort((a,b)=>b[1].localeCompare(a[1],"zh-CN",{numeric:true}));
  if(!terms.has(courseSemester))courseSemester=choices[0]?.[0] || "manual";
  const table=timetables.find(t=>t.semester===courseSemester),matching=courses.filter(t=>(t.details?.semester || "manual")===courseSemester);
  const weekOf=task=>String(table?.days.find(day=>day.date===localInput(task.starts_at).slice(0,10))?.week || (!table && task.details?.week) || `date:${monday(localInput(task.starts_at).slice(0,10))}`);
  const weeks=[...new Set([...(table?.days || []).map(day=>String(day.week)),...matching.map(weekOf)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if(courseWeek!=="all" && !weeks.includes(courseWeek))courseWeek="all";
  const panel=element("section",null,"timetable-panel"),toolbar=element("div",null,"timetable-toolbar"),controls=element("div",null,"timetable-controls");
  const semester=element("select"),week=element("select");semester.id="course-semester";week.id="course-week";semester.setAttribute("aria-label","选择学期");week.setAttribute("aria-label","选择周次");
  for(const [value,label] of choices){const option=element("option",label);option.value=value;semester.append(option);}semester.value=courseSemester;semester.disabled=!choices.length;
  const all=element("option","全部周次");all.value="all";week.append(all);
  for(const value of weeks){const option=element("option",value.startsWith("date:")?`${shortDay(value.slice(5))}起的一周`:`第 ${value} 周`);option.value=value;week.append(option);}week.value=courseWeek;
  semester.onchange=()=>{courseSemester=semester.value;courseWeek="all";render();};week.onchange=()=>{courseWeek=week.value;render();};
  controls.append(semester,week);toolbar.append(element("h2","个人课表"),controls);panel.append(toolbar);root.replaceChildren(panel);
  const visible=matching.filter(task=>courseWeek==="all" || weekOf(task)===courseWeek);
  const slots=new Map((table?.slots || []).map(slot=>[`${slot.start}-${slot.end}`,slot]));
  for(const task of matching) {
    const start=localInput(task.starts_at).slice(11),end=localInput(task.ends_at).slice(11);
    if(![...slots.values()].some(slot=>start<slot.end && end>slot.start))slots.set(`${start}-${end}`,{start,end,period:task.details?.period || "",label:""});
  }
  const ordered=[...slots.values()].sort((a,b)=>a.start.localeCompare(b.start));
  if(!ordered.length) {panel.append(element("p","还没有课表。到“来源与同步”添加课表网站，或手动添加课程。","day-empty"));return;}
  const groups=new Map();
  for(const task of visible) {
    const weekday=new Date(`${localInput(task.starts_at).slice(0,10)}T00:00:00Z`).getUTCDay() || 7,start=localInput(task.starts_at).slice(11),end=localInput(task.ends_at).slice(11);
    const key=JSON.stringify([task.title,task.location,task.details?.teacher,task.details?.assistant,task.details?.campus,weekday,start,end,task.details?.period]);
    if(!groups.has(key))groups.set(key,{weekday,start,end,items:[]});groups.get(key).items.push(task);
  }
  const scroll=element("div",null,"timetable-scroll"),grid=element("table",null,"timetable"),head=element("thead"),headRow=element("tr"),body=element("tbody");
  scroll.tabIndex=0;scroll.setAttribute("aria-label","课程表，可左右滚动查看周一至周日");grid.setAttribute("aria-label","每周课程表");
  const corner=element("th","节次 / 时间");corner.scope="col";headRow.append(corner);
  for(let day=1;day<=7;day++) {
    const th=element("th",`周${"一二三四五六日"[day-1]}`);th.scope="col";
    const date=table?.days.find(entry=>String(entry.week)===courseWeek && entry.weekday===day)?.date;
    if(date)th.append(element("small",`${Number(date.slice(5,7))}/${Number(date.slice(8))}`));headRow.append(th);
  }
  head.append(headRow);grid.append(head);
  ordered.forEach((slot,index)=>{
    const tr=element("tr"),label=element("th");label.scope="row";
    label.append(element("span",slot.label || `第 ${index+1} 大节`));
    if(slot.period)label.append(element("small",`${slot.period.replace(/节$/,"").replace(/\b0(?=\d)/g,"")}节`));label.append(element("small",`${slot.start}–${slot.end}`));tr.append(label);
    for(let day=1;day<=7;day++) {
      const cell=element("td");cell.dataset.weekday=String(day);cell.dataset.start=slot.start;
      for(const group of groups.values()) {
        if(group.weekday!==day || group.start>=slot.end || group.end<=slot.start)continue;
        const task=group.items[0],color=[...task.title].reduce((n,ch)=>(n*31+ch.codePointAt(0))>>>0,0)%6,block=element("div",null,`course-block course-color-${color}`);
        const title=element("h3",task.title);title.title=task.title;block.append(title);
        for(const [key,name] of [["teacher","教师"],["assistant","助教"],["campus","校区"]])if(task.details?.[key])block.append(element("p",`${name}：${task.details[key]}`));
        if(task.location)block.append(element("p",`地点：${task.location}`));
        const range=weekRanges(group.items.map(weekOf));block.append(element("p",range?`周次：${range}周`:`日期：${group.items.map(t=>shortDay(localInput(t.starts_at).slice(0,10))).join("、")}`,"course-weeks"));
        const url=syllabusURL(task);
        if(url){const view=externalLink("查看教学大纲 ↗",url);view.className="course-view";view.setAttribute("aria-label",`查看教学大纲：${task.title}`);block.append(view);}
        else block.append(element("span","尚无教学大纲链接","course-view muted"));
        cell.append(block);
      }
      tr.append(cell);
    }
    body.append(tr);
  });
  grid.append(body);scroll.append(grid);panel.append(scroll,element("p","左右滑动查看完整课表 · 点击“查看教学大纲”进入教务系统","timetable-hint"));
}
function emptySchedule(label,category,canAdd) {
  const empty=element("div",null,"day-empty");empty.append(element("p",`还没有${label}的${category}`));
  if(canAdd){const add=element("button",`＋ 添加${category}`,"text-button empty-add");add.type="button";add.onclick=()=>{newTaskAxis=null;newTaskCategory=category;openTask();};empty.append(add);}
  return empty;
}
function renderSchedule(visible) {
  const root=$("board"),today=localInput(new Date()).slice(0,10),now=Date.now();
  const sorted=[...visible].sort((a,b)=>(a.starts_at || "9999").localeCompare(b.starts_at || "9999") || a.id.localeCompare(b.id));
  root.replaceChildren();
  if(categoryFilter==="课程") {renderTimetable(sorted);return;}
  const pending=sorted.filter(t=>t.status!=="done"),done=sorted.filter(t=>t.status==="done").sort((a,b)=>(b.completed_at || "").localeCompare(a.completed_at || ""));
  scheduleStats(["未完成","未来 7 天","今天","已完成"],
    [pending.length,pending.filter(t=>Date.parse(t.starts_at)>=now && Date.parse(t.starts_at)<=now+7*86400000).length,pending.filter(t=>onCalendarDay(t,today)).length,done.length],
    ["按开始时间从近到远","未来一周开始的安排","全部时间均为北京时间","按完成时间倒序 · 满 7 天自动归档"]);
  const columns=element("div",null,"schedule-columns");
  for(const [label,items,state] of [["未完成",pending,"todo"],["已完成",done,"done"]]) {
    const column=element("section",null,`column ${state}`);column.append(groupHeading(label,items.length));
    const list=element("div",null,`schedule-list ${categoryFilter==="考试"?"exam-group":categoryFilter==="会议"?"meeting-group":"activity-group"}`);
    list.append(...items.map(card));if(!items.length)list.append(emptySchedule(label,categoryFilter,state==="todo" && ["活动","会议"].includes(categoryFilter)));column.append(list);columns.append(column);
  }
  root.append(columns);
}
function calendarDates(task) {
  if(task.category==="作业") {
    const day=localInput(task.due_at).slice(0,10);
    return [day,day];
  }
  return [localInput(task.starts_at || task.ends_at).slice(0,10),localInput(task.ends_at || task.starts_at).slice(0,10)];
}
function onCalendarDay(task,day) {
  const [start,end]=calendarDates(task);
  return day ? !!start && start<=day && day<=end : !start;
}
function calendarSelect(day) {
  if(hasDraft()) {notice("请先保存或取消正在编辑的待办事项");return;}
  selectedDay=day;if(day)calendarMonth=day.slice(0,7);renderCalendar();
}
const calendarEventTime=task=>task.category==="作业"?task.due_at:task.starts_at || task.ends_at;
const calendarTypeOrder=(a,b)=>CALENDAR_TYPES.indexOf(a.category)-CALENDAR_TYPES.indexOf(b.category);
// Lunar dates: Hong Kong Observatory official CSV tables, 2025–2027.
// https://data.weather.gov.hk/weatherAPI/hko_data/calendar/nongli_calendar_2026.csv
// Qingming: HKO Gregorian–Lunar PDF tables for each year. Labels are festivals, not leave/workday rules.
const LUNAR_FESTIVALS={"2025-01-07":"腊八","2025-01-28":"除夕","2025-01-29":"春节","2025-02-12":"元宵","2025-04-04":"清明","2025-05-31":"端午","2025-08-29":"七夕","2025-10-06":"中秋","2025-10-29":"重阳","2026-01-26":"腊八","2026-02-16":"除夕","2026-02-17":"春节","2026-03-03":"元宵","2026-04-05":"清明","2026-06-19":"端午","2026-08-19":"七夕","2026-09-25":"中秋","2026-10-18":"重阳","2027-01-15":"腊八","2027-02-05":"除夕","2027-02-06":"春节","2027-02-20":"元宵","2027-04-05":"清明","2027-06-09":"端午","2027-08-08":"七夕","2027-09-15":"中秋","2027-10-08":"重阳"};
const SOLAR_FESTIVALS={"01-01":"元旦","03-08":"妇女节","05-01":"劳动节","05-04":"青年节","06-01":"儿童节","09-10":"教师节","10-01":"国庆"};
const calendarHoliday=key=>[SOLAR_FESTIVALS[key.slice(5)],LUNAR_FESTIVALS[key]].filter(Boolean).join("·");
function calendarTypeFilter(){
  const filter=element("details",null,"calendar-filter");filter.id="calendar-type-filter";filter.open=!!$(filter.id)?.open;
  const summary=element("summary",calendarTypes.size===6?"筛选 · 全部":`筛选 · ${calendarTypes.size}/6`),menu=element("div",null,"calendar-filter-menu");summary.setAttribute("aria-label","筛选日历类型");const arrow=element("span",null,"select-arrow");arrow.setAttribute("aria-hidden","true");summary.append(arrow);
  for(const [index,type] of ["全部类型",...CALENDAR_TYPES].entries()){
    const row=element("label",null,index?"calendar-filter-option":"calendar-filter-all"),check=element("input");check.type="checkbox";check.id=`calendar-type-${index}`;check.checked=index?calendarTypes.has(type):calendarTypes.size===6;check.indeterminate=!index && calendarTypes.size>0 && calendarTypes.size<6;
    check.onchange=()=>{
      if(index){if(check.checked)calendarTypes.add(type);else calendarTypes.delete(type);}else calendarTypes=new Set(check.checked?CALENDAR_TYPES:[]);
      renderCalendar();$(check.id).focus({preventScroll:true});
    };
    row.append(check,element("span",type,index?`cat-${CATEGORIES.indexOf(type)}`:null));menu.append(row);
  }
  filter.append(summary,menu);filter.onkeydown=event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();filter.open=false;summary.focus();}};return filter;
}
document.addEventListener("click",event=>{const filter=$("calendar-type-filter");if(filter && !filter.contains(event.target))filter.open=false;});
function renderCalendar() {
  const root=$("board"), calendar=element("section",null,"calendar"),toolbar=element("div",null,"calendar-toolbar");
  const visible=tasks.filter(task=>calendarTypes.has(task.category));
  const [year,month]=calendarMonth.split("-").map(Number);
  const previous=element("button","‹","secondary"),next=element("button","›","secondary"),today=element("button","今天","secondary");
  previous.setAttribute("aria-label","上个月");next.setAttribute("aria-label","下个月");
  function moveMonth(offset) {
    if(hasDraft()) {notice("请先保存或取消正在编辑的待办事项");return;}
    calendarMonth=new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,7);
    selectedDay=`${calendarMonth}-01`;renderCalendar();
    $("board").querySelector(offset<0?'[aria-label="上个月"]':'[aria-label="下个月"]').focus();
  }
  previous.onclick=()=>moveMonth(-1);next.onclick=()=>moveMonth(1);today.onclick=()=>calendarSelect(localInput(new Date()).slice(0,10));
  const controls=element("div",null,"calendar-controls");controls.append(previous,today,next);
  const heading=element("div",null,"calendar-heading");heading.append(element("h2",`${year} 年 ${month} 月`),calendarTypeFilter());toolbar.append(heading,controls);calendar.append(toolbar);
  const grid=element("div",null,"calendar-grid");grid.setAttribute("aria-label",`${year}年${month}月`);
  for(const name of ["一","二","三","四","五","六","日"]) grid.append(element("span",name,"calendar-weekday"));
  const first=new Date(Date.UTC(year,month-1,1)),offset=(first.getUTCDay()+6)%7;
  const days=new Date(Date.UTC(year,month,0)).getUTCDate(),cells=Math.ceil((offset+days)/7)*7;
  const todayKey=localInput(new Date()).slice(0,10);
  for(let i=0;i<cells;i++) {
    const date=new Date(Date.UTC(year,month-1,1-offset+i)),key=date.toISOString().slice(0,10);
    const matching=visible.filter(task=>onCalendarDay(task,key)).sort((a,b)=>Number(a.status==="done")-Number(b.status==="done") || calendarTypeOrder(a,b) || (calendarEventTime(a)||"9999").localeCompare(calendarEventTime(b)||"9999") || a.id.localeCompare(b.id));
    const day=element("button",null,"calendar-day"+(key.slice(0,7)!==calendarMonth?" outside":"")+(key===selectedDay?" selected":""));
    day.dataset.date=key;day.setAttribute("aria-label",`${key}，${matching.length} 项安排`);
    day.setAttribute("aria-pressed",String(key===selectedDay));day.setAttribute("aria-controls","day-list");
    if(key===todayKey) day.setAttribute("aria-current","date");
    const dateLine=element("span",null,"calendar-date-line"),holiday=calendarHoliday(key);dateLine.append(element("span",String(date.getUTCDate()),"day-number"));
    if(holiday){dateLine.append(element("span",holiday,"calendar-holiday"));day.setAttribute("aria-label",`${key}，${holiday}，${matching.length} 项安排`);}day.append(dateLine);
    for(const task of matching.slice(0,2)) {
      const title=element("span",task.title,`day-task cat-${CATEGORIES.indexOf(task.category)}`+(task.status==="done"?" is-done":""));title.title=task.title+(task.status==="done"?(task.category==="记录"?"（已完善）":"（已完成）"):"");day.append(title);
    }
    if(matching.length>2)day.append(element("span",`+${matching.length-2} 项`,"day-more"));
    day.onclick=()=>{
      calendarSelect(key);$("board").querySelector(`[data-date="${key}"]`)?.focus({preventScroll:true});
    };
    day.onkeydown=event=>{
      const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(!delta)return;
      event.preventDefault();const target=new Date(date.getTime()+delta*86400000).toISOString().slice(0,10);calendarSelect(target);$("board").querySelector(`[data-date="${target}"]`)?.focus();
    };
    grid.append(day);
  }
  calendar.append(grid);
  const calendarCredit=externalLink("节日日期", "https://www.hko.gov.hk/sc/gts/time/conversion.htm");calendarCredit.className="calendar-credit";calendarCredit.title="公历节日及 2025–2027 年传统节日，仅标注当天，不含调休；农历日期来源：香港天文台";calendar.append(calendarCredit);
  const undated=visible.filter(task=>onCalendarDay(task,""));
  if(undated.length) {const button=element("button",`未定日期 · ${undated.length} 项`,"undated-button secondary");button.setAttribute("aria-pressed",String(selectedDay===""));button.onclick=()=>calendarSelect("");calendar.append(button);}
  const agenda=element("section",null,"day-agenda"),list=element("div",null,"day-list");list.id="day-list";
  // Events continuing from an earlier day start at the beginning of the selected day's timeline.
  const timelineTime=task=>{const time=localInput(calendarEventTime(task));return !time?"待补充":selectedDay && time.slice(0,10)<selectedDay?"00:00":time.slice(11);};
  const matching=visible.filter(task=>onCalendarDay(task,selectedDay)).sort((a,b)=>timelineTime(a).localeCompare(timelineTime(b)) || calendarTypeOrder(a,b) || a.id.localeCompare(b.id));
  agenda.append(element("h2",`${selectedDay ? `${Number(selectedDay.slice(5,7))} 月 ${Number(selectedDay.slice(8))} 日` : "未定日期"} · ${matching.length} 项安排`));
  for(let index=0;index<matching.length;index+=3){
    const row=element("div",null,"agenda-row");
    for(const task of matching.slice(index,index+3)){
      const entry=element("div",null,"agenda-entry"),time=element("div",null,"agenda-time"),event=card(task);time.append(element("span",timelineTime(task)));
      // Controls can replace their clicked text while opening; use the original event path.
      event.classList.add("calendar-event");event.onclick=e=>{if(!e.composedPath().some(node=>node.matches?.("button,input,select,textarea,a,label")) && !window.getSelection()?.toString())openTask(tasks.find(item=>item.id===task.id) || task);};
      entry.append(time,event);row.append(entry);
    }
    list.append(row);
  }
  if(!matching.length)list.append(element("p",calendarTypes.size?"这一天没有所选类型的安排。":"请选择要显示的类型。","day-empty"));
  agenda.append(list);root.replaceChildren(calendar,agenda);
}
function renderArchive() {
  $("archive-categories").replaceChildren(...["全部",...CATEGORIES].map(category=>{
    const button=element("button",category,"archive-tab"+(category===archiveCategory?" active":""));
    button.setAttribute("aria-pressed",String(category===archiveCategory));
    button.onclick=()=>{archiveCategory=category;loadArchive();};return button;
  }));
  $("archive-list").replaceChildren(...archiveItems.map(task=>{
    const row=element("div",null,"archive-row"),info=element("div",null,"archive-info");
    info.append(element("h3",task.title));
    info.append(element("p",task.category==="作业" ? `截止时间 · ${formatTime(task.due_at,true)}` : `${formatTime(task.starts_at,true)} 至 ${formatTime(task.ends_at,true)}`,"muted"));
    const actions=element("div",null,"task-actions"),view=element("button","查看","edit-task"),remove=element("button","删除","delete-task");
    view.setAttribute("aria-label",`查看归档：${task.title}`);
    view.onclick=async()=>{view.disabled=true;try{showArchiveDetail(await api(`/api/tasks/${task.id}`));}catch(error){$("archive-error").textContent=error.message;}finally{view.disabled=false;}};
    remove.setAttribute("aria-label",`删除归档：${task.title}`);remove.onclick=()=>confirmCardDeletion(task);
    const restore=element("button","恢复","text-button");restore.setAttribute("aria-label",`恢复归档：${task.title}`);restore.onclick=()=>archiveTask(task,false);actions.append(view,restore,remove);row.append(info,actions);return row;
  }));
  if(!archiveItems.length) $("archive-list").append(element("p","这里还没有归档卡片。","archive-empty"));
  $("archive-more").hidden=archiveItems.length>=archiveTotal;
}
async function loadArchive(more=false) {
  const sequence=++archiveSequence;$("archive-error").textContent="";$("archive-more").disabled=true;
  try {
    const data=await api(`/api/archive?${new URLSearchParams({category:archiveCategory,offset:more?archiveItems.length:0})}`);
    if(sequence!==archiveSequence) return;
    archiveItems=more?[...archiveItems,...data.tasks]:data.tasks;archiveTotal=data.total;renderArchive();
  }catch(error){$("archive-error").textContent=error.message;}
  finally{if(sequence===archiveSequence) $("archive-more").disabled=false;}
}
function showArchiveDetail(task) {
  const root=$("archive-detail");root.replaceChildren(element("span",task.category,`badge cat-${CATEGORIES.indexOf(task.category)}`),element("h3",task.title,"archive-title"));
  root.append(element("p",task.category==="作业"?`原截止时间 · ${formatTime(task.due_at,true)}`:`起止时间 · ${timeRange(task)}`,"task-time"));
  if(task.location && task.category!=="记录")root.append(element("p",`地点 · ${task.location}`,"task-location"));
  if(taskContent(task))root.append(element("p",taskContent(task),"task-content"));
  if(task.course)root.append(element("p",task.course,"course"));
  for(const [key,label] of [["teacher","教师"],["week","教学周"],["period","节次"],["seat","座位"]])if(task.details?.[key])root.append(element("p",`${label} · ${task.details[key]}`,"event-detail"));
  if(task.completed_at)root.append(element("p",`完成时间 · ${formatTime(task.completed_at,true)}`,"task-time"));
  root.append(element("p",`归档时间 · ${formatTime(task.archived_at,true)}`,"task-time"));
  if(task.todos.length) {const list=element("ul",null,"archive-todos");for(const todo of task.todos) list.append(element("li",`${todo.done?"☑":"☐"} ${todo.text}`));root.append(list);}
  const resources=element("div",null,"resources");resources.append(...task.attachments.map(file=>fileRow(file)));
  for(const link of task.links) {const row=element("div",null,"resource-row");row.append(externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url));resources.append(row);}
  root.append(resources);const original=taskSourceLink(task);if(original)root.append(original);
  $("archive-detail-dialog").showModal();
}
$("archive-button").onclick=()=>{$("archive-dialog").showModal();loadArchive();};
$("archive-more").onclick=()=>loadArchive(true);
const collectorRequests=new Map();
window.addEventListener("message",event=>{
  if(event.source!==window || event.origin!==location.origin || event.data?.kind!=="campus-board-reply") return;
  const pending=collectorRequests.get(event.data.id);if(!pending) return;
  clearTimeout(pending.timer);collectorRequests.delete(event.data.id);
  if(event.data.result?.error) pending.reject(new Error(event.data.result.error));else pending.resolve(event.data.result);
});
function collectorCommand(command,extra={},timeout=18000) {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{collectorRequests.delete(id);reject(new Error("此浏览器未连接新版扩展。请在浏览器重新加载扩展，再刷新看板；手机端可查看电脑同步的结果。"));},timeout);
    collectorRequests.set(id,{resolve,reject,timer});window.postMessage({kind:"campus-board-command",id,command,account:boardAccount,...extra},location.origin);
  });
}
function saveSyncProgress(){
  if($("demo-dialog").open)return;
  try{localStorage.setItem(`rucapture-sync-guide:${boardAccount}`,JSON.stringify({version:syncGuideVersion,step:syncStep,visited:syncVisited,executed:syncExecuted}));}catch{}
}
function loadSyncProgress(){
  syncStep=syncVisited=1;syncExecuted=false;
  try{const saved=JSON.parse(localStorage.getItem(`rucapture-sync-guide:${boardAccount}`));
    if(saved?.version===syncGuideVersion && Number.isInteger(saved.step) && saved.step>=1 && saved.step<=5 && Number.isInteger(saved.visited) && saved.visited>=saved.step && saved.visited<=5){syncStep=saved.step;syncVisited=saved.visited;syncExecuted=saved.executed===true;}
  }catch{}
}
function syncStepStates(){
  return [!!collectorState && (collectorState.version || "0").localeCompare("1.9.7",undefined,{numeric:true})>=0,!!collectorState?.connected,!!sourceLinksState?.length,!!cloudState?.enabled,syncExecuted];
}
function updateSyncSteps(){
  const states=syncStepStates();
  // Old website/cloud settings do not complete steps the user has not reached in this version.
  document.querySelectorAll("#sync-progress li").forEach((point,i)=>{const done=i<syncVisited && states[i] && (i===4 || states[0]);point.classList.toggle("complete",done);if(syncStep===i+1)point.setAttribute("aria-current","step");else point.removeAttribute("aria-current");point.setAttribute("aria-label",`第 ${i+1} 步：${point.lastElementChild.textContent}，${done?"已完成":"未完成"}`);});
  $("sync-prev").disabled=syncStep===1;
  $("sync-next").textContent=syncStep===5?"完成":syncStep===4 && !states[3]?"暂不开启，继续":"下一步";
  $("sync-next").disabled=syncing || syncStep!==4 && !states[syncStep-1];
}
function setSyncStep(step){
  syncStep=step;
  if(!$("demo-dialog").open){syncVisited=Math.max(syncVisited,step);saveSyncProgress();}
  document.querySelectorAll("#sources-dialog .guide-step").forEach(panel=>panel.hidden=Number(panel.dataset.step)!==step);
  updateSyncSteps();
  if(step===4 && $("sources-dialog").open)ensureCloudPanel();
}
$("sync-prev").onclick=()=>setSyncStep(Math.max(1,syncStep-1));
$("sync-existing").onclick=()=>setSyncStep(5);
$("sync-next").onclick=()=>{if($("sync-next").disabled)return;if(syncStep===5){$("sources-dialog").close();return;}setSyncStep(syncStep+1);};
async function ensureCloudPanel(){
  if(cloudPanelLoading || !collectorState?.connected || !cloudState?.available || !syncStepStates()[0])return;
  if(document.querySelector("#cloud-panel iframe"))return;
  const session=syncSession;cloudPanelLoading=true;
  try{
    const result=await collectorCommand("cloud-panel");if(session!==syncSession)return;
    const url=new URL(result.url);
    if(!/^chrome-extension:\/\/[a-p]{32}\/cloud-panel\.html\?/.test(url.href))throw new Error("请重新加载扩展，再刷新本网页。");
    const frame=element("iframe");frame.title="云端同步";frame.src=url.href;$("cloud-panel").replaceChildren(frame);$("cloud-authorize").hidden=true;
  }catch(error){if(session===syncSession){$("source-error").textContent=error.message;$("cloud-authorize").hidden=false;}}
  finally{if(session===syncSession)cloudPanelLoading=false;}
}
window.addEventListener("message",async event=>{
  const frame=document.querySelector("#cloud-panel iframe");
  if(!frame || event.source!==frame.contentWindow || event.origin!==frame.src.split("/").slice(0,3).join("/"))return;
  if(event.data?.kind==="rucapture-cloud-size"){if(Number.isFinite(event.data.height))$("cloud-panel").style.setProperty("--cloud-height",`${Math.max(140,Math.min(360,event.data.height))}px`);return;}
  if(event.data?.kind!=="rucapture-cloud-enabled")return;
  const session=syncSession;await checkCloud();if(session!==syncSession)return;
  if(cloudState?.enabled)notice("云端同步已开启，点击“下一步”继续。");
});
function updateSyncControls() {
  const connected=!!collectorState?.connected;
  $("collector-controls").hidden=!collectorState || connected;
  $("install-state").textContent=collectorState?`已安装 v${collectorState.version} · ${syncStepStates()[0]?"已是最新版本":"请更新至 v1.9.7"}`:"仅需在电脑上安装一次";
  $("collector-options").disabled=!collectorState;
  $("sync-existing").hidden=!!collectorState || !cloudState?.enabled;
  $("browser-settings").hidden=!connected;
  $("collector-scan").disabled=syncing || !(cloudState?.enabled || (connected && collectorState.enabled));
  $("collector-scan").textContent=syncing?"正在同步…":"一键同步";
  $("cloud-authorize").disabled=!connected || !cloudState?.available;
  $("cloud-authorize").textContent=syncStepStates()[0]?"打开云端授权":"先更新扩展至 v1.9.7";
  if(!connected){$("cloud-panel").replaceChildren();$("cloud-authorize").hidden=false;}
  $("cloud-revoke").hidden=!cloudState?.enabled;
  $("cloud-revoke").disabled=syncing || !cloudState?.enabled;
  updateSyncSteps();if(syncStep===4 && $("sources-dialog").open)ensureCloudPanel();
}
async function checkCollector() {
  const session=syncSession,sequence=++collectorCheckSequence;
  try {
    const result=await collectorCommand("status",{},1800);
    if(session!==syncSession || sequence!==collectorCheckSequence)return;
    const previousVersion=collectorState?.version;collectorState=result;
    if(!syncStepStates()[0] && previousVersion!==result.version){syncVisited=1;syncExecuted=false;saveSyncProgress();}
    $("collector-state").textContent=collectorState.connected?`浏览器扩展已连接 · v${collectorState.version}${collectorState.enabled?"":" · 浏览器导入已暂停"}`:"已检测到扩展，点击下方按钮连接。";
    $("collector-enabled").checked=collectorState.enabled;
  }catch {
    if(session!==syncSession || sequence!==collectorCheckSequence)return;
    collectorState=null;
    $("collector-state").textContent="此浏览器未连接扩展。手机可直接查看已同步的任务。";
  }
  updateSyncControls();renderSources();
}
function websiteName(link) {
  const id=link.source || link.id;
  return link.name || sources.find(source=>source.id===id)?.name || (link.url?new URL(link.url).hostname:"网站页面");
}
async function setupGeneric(link) {
  if(!collectorState?.connected)throw new Error("请先完成第 2 步连接扩展，再点击此网站的识别设置。");
  requireSelectiveSync(link.source);
  await collectorCommand("generic-setup",{url:link.url});
  notice("已打开识别设置，请允许读取网站并在原页面确认预览。");
}
function renderWebsiteLinks() {
  $("website-list").replaceChildren(...(sourceLinksState || []).map((link,index)=>{
    const row=element("div",null,link.generic?"website-row generic":"website-row"),text=element("div");
    text.append(element("strong",websiteName(link)),externalLink(link.url,link.url));
    const edit=element("button","编辑","text-button"),remove=element("button","移除","text-button");
    edit.type=remove.type="button";edit.disabled=remove.disabled=websiteBusy;
    edit.setAttribute("aria-label",`编辑网站：${websiteName(link)}`);remove.setAttribute("aria-label",`移除网站：${websiteName(link)}`);
    edit.onclick=()=>openWebsiteInput(index);remove.onclick=async()=>{if(await confirmAction("移除网站？",`将停止同步“${websiteName(link)}”，已导入的卡片会保留。`,"移除"))saveWebsiteLinks(sourceLinksState.filter(item=>item.url!==link.url).map(({name,url})=>({name,url})));};
    row.append(text);
    if(link.generic){const setup=element("button","识别设置","secondary");setup.type="button";setup.setAttribute("aria-label",`识别设置：${link.name}`);setup.onclick=()=>setupGeneric(link).catch(error=>{$("source-error").textContent=error.message;});row.append(setup);}
    row.append(edit,remove);return row;
  }));
}
function openWebsiteInput(index=-1) {editingWebsite=index;$("source-name").value=index<0?"":websiteName(sourceLinksState[index]);$("source-name").setCustomValidity("");$("source-url").value=index<0?"":sourceLinksState[index].url;$("source-links-form").hidden=false;$("add-source-link").hidden=true;$("source-name").focus();}
function closeWebsiteInput() {editingWebsite=-1;$("source-links-form").reset();$("source-name").setCustomValidity("");$("source-links-form").hidden=true;$("add-source-link").hidden=false;}
async function loadSourceLinks() {
  const session=syncSession;
  try {const data=await api("/api/source-links");if(session!==syncSession)return;sourceLinksState=data.links;renderWebsiteLinks();renderSources();updateSyncSteps();}
  catch(error){if(session===syncSession)$("source-links-result").textContent=error.message;}
}
async function saveWebsiteLinks(links,submitted=null) {
  if(websiteBusy)return;websiteBusy=true;$("save-source-link").disabled=true;renderWebsiteLinks();
  try {
    const data=await api("/api/source-links","PUT",{links});sourceLinksState=data.links;closeWebsiteInput();renderSources();
    if(collectorState?.connected && collectorState.sourceStatusControls)await collectorCommand("refresh-sources");
    await refresh();
    const added=submitted?data.links.find(link=>link.url===new URL(submitted).href):null;
    $("source-links-result").textContent=added?.generic?"链接已保存。请打开“识别设置”，核对要导入的内容。":"网站配置已保存。";
    if(added?.generic){if(collectorState?.connected){try{await setupGeneric(added);}catch(error){$("source-links-result").textContent=error.message;}}return;}
    if(added?.source && collectorState?.connected && collectorState.enabled) {
      try {requireSelectiveSync(added.source);await collectorCommand(added.source==="ruc_courses"?"academic-scan":"scan",{source:added.source});$("source-links-result").textContent="已配置，正在读取网站内容。";}
      catch(error){$("source-links-result").textContent=`已保存，可点击一键同步重试：${error.message}`;}
    }
  }catch(error){$("source-links-result").textContent=error.message;}
  finally{websiteBusy=false;$("save-source-link").disabled=false;renderWebsiteLinks();updateSyncSteps();}
}
$("add-source-link").onclick=()=>openWebsiteInput();$("cancel-source-link").onclick=closeWebsiteInput;
$("source-name").oninput=()=>$("source-name").setCustomValidity("");
$("source-links-form").onsubmit=event=>{
  event.preventDefault();const name=$("source-name").value.trim(),url=$("source-url").value.trim(),links=(sourceLinksState || []).map(({name,url})=>({name,url}));
  if(!name){$("source-name").setCustomValidity("请填写网站名称");$("source-name").reportValidity();return;}
  if(editingWebsite>=0)links[editingWebsite]={name,url};else links.push({name,url});
  saveWebsiteLinks(links,url);
};
$("collector-recheck").onclick=async()=>{
  await checkCollector();
  if(collectorState)notice(syncStepStates()[0]?"扩展已就绪，点击“下一步”继续。":"扩展需要更新，请安装后重新检测。");
  else {sessionStorage.setItem("resume-setup","1");location.reload();}
};
$("copy-extension-page").onclick=async()=>{const url=/Edg\//.test(navigator.userAgent)?"edge://extensions":"chrome://extensions";try{await navigator.clipboard.writeText(url);notice("已复制，请粘贴到浏览器地址栏打开");}catch{notice(`请复制 ${url} 到浏览器地址栏`);}};
$("collector-connect").onclick=async()=>{
  $("collector-connect").disabled=true;$("source-error").textContent="";
  try {
    await collectorCommand("status",{},1800);
    const {token}=await api("/api/collector-token","POST",{});
    await collectorCommand("pair",{token});await checkCollector();
    notice("已连接，点击“下一步”添加网站。");
  }catch(error){$("source-error").textContent=error.message;}finally{$("collector-connect").disabled=false;}
};
function requireSelectiveSync(source) {
  const generic=source?.startsWith("web:") || !source && sourceLinksState?.some(link=>link.generic);
  const modern=["yoj","weilai","tuoj"].includes(source) || !source && sourceLinksState?.some(link=>["yoj","weilai","tuoj"].includes(link.source));
  const zhifz=source==="zhifz" || !source && sourceLinksState?.some(link=>link.source==="zhifz"),version=generic?"1.9.0":modern?"1.8.0":zhifz?"1.7.0":"1.6.0";
  if((collectorState?.version || "0").localeCompare(version,undefined,{numeric:true})<0) {
    setSyncStep(1);
    throw new Error(`${modern?"此网站":zhifz?"智夫子":"单独"}同步需要扩展 v${version}，请按第 1 步替换文件、重新加载，再刷新看板。`);
  }
}
async function syncSources(source) {
  if(syncing)return;
  const session=syncSession,markExecuted=()=>{if(session!==syncSession)return;syncExecuted=true;syncVisited=Math.max(syncVisited,syncStep);saveSyncProgress();updateSyncSteps();};
  syncing=true;updateSyncControls();renderSources();$("source-error").textContent="";
  try {
    const jobs=[],cloudEligible=!source || !source.startsWith("web:") && !source.startsWith("ruc_") && !sources.find(item=>item.id===source)?.browser_only;
    if(collectorState?.connected && collectorState.enabled && (source || sourceLinksState?.some(link=>link.generic || ["zhifz","yoj","weilai","tuoj"].includes(link.source))))requireSelectiveSync(source);
    if(cloudState?.enabled && cloudEligible)jobs.push(api("/api/cloud/run","POST",source?{source}:{},60000).then(result=>{
      if(result.running)throw new Error("云端正在同步，请稍后再试");
      markExecuted();
      const errors=Object.values(result).filter(item=>item?.error).map(item=>item.error);if(errors.length)throw new Error(errors.join("；"));
    }));
    if(collectorState?.connected && collectorState.enabled && sourceLinksState?.some(link=>link.source))jobs.push(collectorCommand("scan",source?{source}:{}).then(markExecuted));
    if(!jobs.length)throw new Error(source?.startsWith("ruc_")?"教务同步需要在电脑浏览器连接扩展并开启浏览器导入。":"请先连接扩展并添加需要同步的网站。");
    const results=await Promise.allSettled(jobs),errors=results.filter(r=>r.status==="rejected").map(r=>r.reason.message);
    await refresh();await checkCloud();
    if(errors.length)$("source-error").textContent=errors.join("；");
    else notice(source?"已开始同步此来源，读取结果会显示在下方。":"已开始同步全部可用来源，读取结果会显示在下方。");
  }catch(error){$("source-error").textContent=error.message;}
  finally{syncing=false;updateSyncControls();renderSources();}
}
$("collector-scan").onclick=()=>syncSources();
$("collector-enabled").onchange=async()=>{
  const enabled=$("collector-enabled").checked;$("collector-enabled").disabled=true;
  try{await collectorCommand("configure",{enabled});await checkCollector();}
  catch(error){$("source-error").textContent=error.message;$("collector-enabled").checked=!enabled;}
  finally{$("collector-enabled").disabled=false;}
};
$("collector-options").onclick=()=>collectorCommand("options").catch(error=>{$("source-error").textContent=error.message;});
$("cloud-authorize").onclick=()=>{
  if(!syncStepStates()[0]){setSyncStep(1);return;}ensureCloudPanel();
};
async function checkCloud(snapshot) {
  const session=syncSession,sequence=++cloudCheckSequence;lastCloudCheck=Date.now();
  try {
    const data=snapshot || await api("/api/cloud");
    if(session!==syncSession || sequence!==cloudCheckSequence)return;
    if(sourceLinksState===null)await loadSourceLinks();
    if(session!==syncSession || sequence!==cloudCheckSequence)return;
    cloudState=data;
    $("cloud-status").textContent=cloudState.enabled?`云端自动同步已开启 · 每 ${cloudState.interval_minutes || 60} 分钟`:"浏览器自动同步 · 每 15 分钟";
    $("cloud-grant-state").textContent=!cloudState.available?"暂不可用，可跳过此步":cloudState.enabled?`已开启 · 每 ${cloudState.interval_minutes || 60} 分钟更新`:"尚未开启";
    $("sync-mode-note").textContent="登录过期的网站，可点击下方“重新登录”。";
    updateSyncControls();renderSources();maybeLoginReminder();
  }catch(error){if(session!==syncSession || sequence!==cloudCheckSequence)return;$("cloud-status").textContent=error.message;$("cloud-grant-state").textContent="未能读取授权状态，请关闭后重新打开“来源与同步”。";}
}
function needsLogin(source) {
  const state=cloudState?.sources?.[source.id];
  return /(?:登录|登陆)(?:已)?(?:失效|过期)/.test([source.error,collectorState?.sourceResults?.[source.id]?.error].filter(Boolean).join(" ")) || !!(cloudState?.enabled && (state?.error_code==="auth_expired" || state?.auth_expired_at));
}
function sourceURL(source) {return sourceLinksState?.find(link=>link.source===source.id)?.url || source.url;}
function loginLink(source) {
  const link=externalLink("重新登录 ↗",sourceURL(source));link.className="secondary source-login";
  link.setAttribute("aria-label",`重新登录：${source.name}`);return link;
}
function maybeLoginReminder() { if(typeof maybeMessageBoard==="function")maybeMessageBoard(); }
$("expired-open-sources").onclick=()=>{$("login-expired-dialog").close();$("sources-button").click();setSyncStep(5);};
document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("close",()=>queueMicrotask(maybeLoginReminder)));
$("cloud-revoke").onclick=async()=>{
  if(!await confirmAction("关闭云端同步？","保存的网站登录状态会删除，已导入的卡片会保留。","关闭同步"))return;
  try{await api("/api/cloud","DELETE");$("cloud-panel").replaceChildren();$("cloud-authorize").hidden=false;await checkCloud();}catch(error){$("source-error").textContent=error.message;}
};
function renderSources() {
  updateSyncSteps();
  const selected=new Set((sourceLinksState || []).map(link=>link.source));
  if(selected.has("ruc_courses"))selected.add("ruc_exams");
  $("unsupported-links").replaceChildren();
  $("sources-list").replaceChildren(...sources.filter(source=>sourceLinksState===null || selected.has(source.id)).map(source=>{
    const row=element("div",null,"source-row"),header=element("div");
    const academic=source.kind==="academic",browserOnly=academic || source.browser_only;
    const cloud=!browserOnly && cloudState?.enabled?cloudState.sources?.[source.id]:null;
    const local=collectorState?.sourceResults?.[source.id];
    const seen=cloud?.last_success || (source.error?null:source.last_seen);
    const fresh=seen && Date.now()-Date.parse(seen)<75*60000;
    const error=cloud?.authorized ? cloud.error : (local?.error && (!seen || Date.parse(local.time)>Date.parse(seen)) ? local.error:source.error);
    const total=cloud?.last_success?cloud.count:source.task_count;
    const incomplete=!academic && total>0 && (cloud?.last_success ? cloud.status_count<cloud.count : source.imported_count>source.status_count);
    const expired=needsLogin(source);
    const contentName=source.id==="ruc_exams"?"考试安排":academic?"课程":"作业";
    const countText=`${total} ${source.id==="ruc_exams"?"场考试":academic?"节课程":"项作业"}`;
    const label=expired?"登录过期":error?"需处理":incomplete?"状态不完整":seen && total===0?`已验证 · 暂无${contentName}`:fresh?"已同步":seen?"等待更新":"待验证";
    const name=websiteName(source),host=new URL(sourceURL(source)).hostname,displayName=name===host?name:`${name} · ${host}`;
    header.append(expired?element("strong",displayName):externalLink(`${displayName} ↗`,sourceURL(source)),element("span",label,"state"+(fresh && !error && !incomplete?" connected":"")));
    const sync=element("button","同步","secondary source-sync");sync.type="button";sync.setAttribute("aria-label",`同步：${name}`);
    sync.disabled=syncing || !(collectorState?.connected && collectorState.enabled || !browserOnly && cloudState?.enabled && cloud?.authorized);
    sync.onclick=()=>syncSources(source.id);
    if(expired){const actions=element("div",null,"source-actions");actions.append(loginLink(source),sync);header.append(actions);}else header.append(sync);
    row.append(header);
    row.append(element("p",expired?"重新登录后，点击此网站的“同步”。仍未恢复时，回第 4 步更新。":error || (seen?`${formatTime(seen)} · ${countText}${incomplete?" · 部分完成状态未识别":""}`:cloud?.authorized?"已连接云端，等待同步":"等待首次同步")));
    if(source.generic)row.append(element("p","通过浏览器同步；识别结果可在第 3 步调整。","hint"));
    else if(source.browser_only)row.append(element("p","此网站通过电脑浏览器同步。","hint"));
    if(!browserOnly && cloudState?.enabled && !cloud?.authorized)row.append(element("p","尚未开启此网站的云端同步，可回第 4 步更新。","hint"));
    return row;
  }));
}
async function refresh({poll=false}={}) {
  if(poll && (syncBusy || !navigator.onLine))return;
  if(quadrantWrites.size){if(!poll)quadrantRefreshNeeded=true;return;}
  if (hasDraft() || $("action-confirm-dialog").open || document.querySelector(".checklist[data-busy]")) return;
  const sequence = ++refreshSequence,session=syncSession;syncBusy=true;
  try {
    const incremental=poll && syncRevision!==null && Date.now()-lastFullSync<600000;
    const data = await api(`/api/sync${incremental?`?revision=${encodeURIComponent(syncRevision)}`:""}`);
    if(session!==syncSession)return;
    if (sequence !== refreshSequence || hasDraft() || quadrantWrites.size || $("action-confirm-dialog").open || document.querySelector(".checklist[data-busy]")) return;
    $("login").hidden = true; $("workspace").hidden = false;
    if(data.cloud)checkCloud(data.cloud);
    if(data.unread!==undefined && typeof applyCommunityUnread==="function")applyCommunityUnread(data.unread);
    if(!effectsSaving && typeof data.effects==="boolean")applyEffects(data.effects);
    $("load-error").textContent="";
    if(typeof applyDailySummaryStatus==="function")applyDailySummaryStatus(data);
    if(data.unchanged){focusClockOffset=Date.parse(data.server_time)-Date.now();tickFocus();maybeLoginReminder();return;}
    syncRevision=data.sync_revision;lastFullSync=Date.now();
    if(data.storage && !uploading)renderAttachmentStorage(data.storage);
    tasks = data.tasks;if(axisLayoutRevision!==(data.axis_layout?.revision || 0) && !axisScene?.dirty)resetAxisScene();savedAxisLayout=data.axis_layout?.layout || null;axisLayoutRevision=data.axis_layout?.revision || 0; axes=data.axes || [];axisItems=data.axis_items || [];sources = data.sources; timetables=data.timetables || [];
    quadrantPositions=data.quadrants || {};if(data.focus)applyFocus(data.focus);else loadFocus();
    if($("sources-dialog").open && collectorState)checkCollector();

    const signature = JSON.stringify([tasks, axes, axisItems, sources, timetables, data.axis_layout, data.quadrants, categoryFilter, Math.floor(Date.now()/60000)]);
    if (signature !== lastPayload) { render(); lastPayload = signature; }
    $("load-error").textContent = "";
    maybeLoginReminder();
  } catch (error) {
    if(session===syncSession)$("load-error").textContent = `无法同步：${error.message}。页面上的内容可能不是最新的。`;
  }finally{if(sequence===refreshSequence)syncBusy=false;}
}
function toggleDates() {
  const homework = taskCategory === "作业",record=taskCategory==="记录";
  $("record-time-field").hidden=!record;$("record-time").required=record;
  $("task-location-field").hidden=record;
  $("deadline-field").hidden = !homework; $("range-fields").hidden = homework || record;
  $("due-at").required = homework && !editing?.source;
  $("starts-at").required = !homework && !record; $("ends-at").required = !homework && !record;
}
function openTask(task = null) {
  if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; }
  if(typeof clearFocusEditor==="function")clearFocusEditor();
  editing = task;draftTaskId=task?null:crypto.randomUUID(); $("task-form").reset(); $("task-error").textContent = "";
  taskCategory = task?.category || newTaskCategory || (categoryFilter==="全部"?"作业":categoryFilter);
  $("record-time").value=localInput(task?.starts_at || new Date());
  fillAxisSelect(task ? task.axis_id : newTaskAxis);
  newTaskAxis=null;newTaskCategory=null;
  $("dialog-title").textContent = task ? `编辑${taskCategory}` : `添加${taskCategory}`;
  $("editor-delete").hidden=!task;$("editor-delete").textContent=`删除${taskCategory}`;
  $("task-title").value = task?.title || "";
  $("task-location").value = task?.location || "";
  $("task-content").value=taskContent(task);
  $("task-content").placeholder={作业:"要做哪几题？有什么要求，或卡住的地方？",课程:"这节课要准备什么？有哪些想记下的重点？",考试:"考哪些内容？还有什么没复习，什么东西要带？",活动:"几点集合、在哪里碰面？还有什么要提前准备？",会议:"这次要讨论什么？会前需要准备哪些材料？",记录:"今天做了什么、想到了什么？随手写下来就好。"}[taskCategory];
  $("homework-status").hidden=taskCategory!=="作业";$("done-field").hidden=["作业","课程"].includes(taskCategory);$("done-label").textContent=taskCategory==="记录"?"已完善":"已完成";$("task-done").checked=task?.status==="done";
  $("schedule-fields").hidden=!["课程","考试"].includes(taskCategory);
  $("schedule-person-label").hidden=$("schedule-person").hidden=taskCategory!=="课程";
  $("schedule-person").value=task?.details?.teacher || "";
  $("schedule-seat").value=task?.details?.seat || "";
  $("schedule-seat").hidden=taskCategory!=="考试";
  document.querySelector('label[for="schedule-seat"]').hidden=taskCategory!=="考试";
  draftTodos = structuredClone(task?.todos || []);
  draftAttachments = structuredClone(task?.attachments || []); renderAttachments(); $("upload-state").textContent="";$("attachment-error").textContent="";renderAttachmentStorage();
  const session=syncSession,previousStorage=attachmentStorage;
  api("/api/files").then(storage=>{if(session===syncSession && attachmentStorage===previousStorage && !uploading)renderAttachmentStorage(storage);}).catch(()=>{});
  $("task-links").replaceChildren(); for (const link of task?.links || []) addLinkRow(link);
  if (!(task?.links || []).length) $("task-links").append(element("p", "课程资料、会议地址、在线文档，都可以把链接放在这里。", "resource-empty"));
  $("task-source").hidden=!task?.source_url; $("task-source").replaceChildren();
  if(task){const link=taskSourceLink(task);if(link)$("task-source").append(link);}
  $("task-todos").replaceChildren(checklist(draftTodos, async todos => { draftTodos = todos; }, true));
  $("status").value = task?.status || "todo";enhanceSelect($("status"));
  $("task-completed").hidden=["课程","记录"].includes(taskCategory) || !task?.completed_at; $("task-completed").textContent=task?.completed_at ? `完成时间 · ${formatTime(task.completed_at,true)}（取消勾选后再完成，会按新的完成时间记录。）` : "";
  $("due-at").value = localInput(task?.due_at); $("starts-at").value = localInput(task?.starts_at); $("ends-at").value = localInput(task?.ends_at);
  toggleDates(); $("task-dialog").showModal();
}
function closeAddMenu() { $("add-menu").hidden = true; $("add-task").setAttribute("aria-expanded", "false"); }
function startAdd() {
  newTaskAxis=null;newTaskCategory=null;
  if (categoryFilter !== "全部") return openTask();
  $("add-menu").hidden = !$("add-menu").hidden;
  $("add-task").setAttribute("aria-expanded", String(!$("add-menu").hidden));
  if (!$("add-menu").hidden) $("add-menu").querySelector("button").focus();
}
$("add-menu").replaceChildren(...CATEGORIES.map(category => {
  const button = element("button", `＋ ${category}`);
  button.onclick = () => { if (hasDraft()) { notice("请先保存或取消待办输入"); return; } newTaskCategory = category; closeAddMenu(); openTask(); };
  return button;
}));
document.addEventListener("click", event => { if (!event.target.closest(".add-control") && !event.target.closest(".empty")) closeAddMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("add-menu").hidden) { closeAddMenu(); $("add-task").focus(); } });
$("add-task").onclick = startAdd;
$("sources-button").onclick = async () => {
  renderSources();$("sources-dialog").showModal();$("source-error").textContent="";setSyncStep(syncStep);
  await Promise.all([loadSourceLinks(),checkCollector(),checkCloud()]);
};
document.querySelectorAll(".close-dialog").forEach(button => button.onclick = () => button.closest("dialog").close());
$("task-form").onsubmit = async event => {
  event.preventDefault();if(focusEditor){if(focusEditor.infoEditing)await saveFocusInformation();return;}$("save-task").disabled = true; $("task-error").textContent = "";
  try {
    if (uploading) throw new Error("请等待附件上传完成");
    const homework = taskCategory === "作业";
    if ($("task-todos").querySelector("[data-dirty], [data-busy]")) throw new Error("请先确认或取消正在输入的待办事项");
    const links=[...$("task-links").querySelectorAll(".link-edit-row")].map(row=>({label:row.querySelector(".link-label").value.trim(),url:row.querySelector(".link-url").value.trim()})).filter(link=>link.label || link.url);
    const payload = {category: taskCategory, title: $("task-title").value.trim(), content:$("task-content").value.trim(), location: taskCategory==="记录"?"":$("task-location").value.trim(), todos: draftTodos, links, attachments:draftAttachments.map(file=>file.id), axis_id:$("task-axis").value || null,status:homework?$("status").value:taskCategory==="课程"?"todo":$("task-done").checked?"done":"todo",
      due_at: homework ? inputTime($("due-at").value) : null, starts_at: homework ? null : inputTime($(taskCategory==="记录"?"record-time":"starts-at").value),
      ends_at: homework ? null : inputTime($(taskCategory==="记录"?"record-time":"ends-at").value)};
    payload.details={...(editing?.details || {})};delete payload.details.organizer;
    if(taskCategory==="课程" && (!editing || payload.starts_at!==editing.starts_at || payload.ends_at!==editing.ends_at)) {
      const table=timetables.find(t=>t.semester===(editing?.details?.semester || courseSemester));
      if(table && !editing)Object.assign(payload.details,{semester:table.semester,semester_label:table.label});
      const date=$("starts-at").value.slice(0,10),start=$("starts-at").value.slice(11),end=$("ends-at").value.slice(11);
      payload.details.week=String(table?.days.find(day=>day.date===date)?.week || "");
      payload.details.weekday=String(new Date(`${date}T00:00:00Z`).getUTCDay() || 7);
      payload.details.period=(table?.slots || []).filter(slot=>start<slot.end && end>slot.start).map(slot=>slot.period).filter(Boolean).join("、");
    }
    if(taskCategory==="课程")payload.details.teacher=$("schedule-person").value.trim();
    if(taskCategory==="考试")payload.details.seat=$("schedule-seat").value.trim();
    if(editing)payload.revision=editing.revision;else payload.id=draftTaskId;
    await api(editing ? `/api/tasks/${editing.id}` : "/api/tasks", editing ? "PATCH" : "POST", payload);
    $("task-dialog").close(); notice("卡片已保存"); await refresh();if($("axis-dialog").open)renderAxisMembers();
  } catch (error) { $("task-error").textContent = error.message; }
  finally { $("save-task").disabled = false; }
};
$("editor-delete").onclick=()=>{
  if(uploading || $("save-task").disabled){notice("请等待当前保存或上传完成。");return;}
  if(editing)confirmCardDeletion(editing);
};
function confirmCardDeletion(task){
  deleting=task;$("delete-title").textContent=`删除这张${task.category}卡片？`;
  $("delete-message").textContent=`“${task.title}”将被删除。`+(task.source?"\n这是从教学网站导入的卡片，删除后不会再次自动加入。":"\n删除后无法在看板中恢复。");
  $("confirm-delete").textContent="删除卡片";$("delete-dialog").showModal();
}
$("confirm-delete").onclick = async () => {
  $("confirm-delete").disabled = true;
  const target=deleting;
  try {
    await api(`/api/tasks/${target.id}`, "DELETE", {revision: target.revision});$("delete-dialog").close();
    if(editing?.id===target.id){$("task-dialog").close();editing=null;}
    notice("卡片已删除");await refresh();if($("archive-dialog").open)await loadArchive();if($("axis-dialog").open)renderAxisMembers();
  }
  catch (error) { notice(error.message); }
  finally { $("confirm-delete").disabled = false; }
};
const demoSteps=[
  {category:"全部",view:"calendar",target:"#board",title:"日历：看当天的安排",text:"选一天，下面就是当天的卡片。点击卡片编辑；只想看考试或作业，可以用月份旁的筛选。"},
  {category:"全部",view:"axes",target:"#board",title:"轴线：把零碎的事连起来",text:"一条轴线就是一个目标或合集。比如“期末复习”，可以把相关作业、考试和笔记放在一起，回看自己已经做了哪些准备。点末尾加号添加卡片，点节点编辑。"},
  {category:"全部",view:"quadrants",target:"#board",title:"象限：先做哪件事",text:"待办太多，不知道先做哪件时，可以在这里摆一摆。越靠右越紧急，越靠上越重要；拖动空白处移动画布，滚轮或双指缩放，边缘箭头指向画面外的卡片。"},
  {target:"#focus-button",title:"专注：先做眼前这一件",text:"挑一件事，留一段时间专心做。目标卡片可以不选，计时可以暂停，想法随时记下。结束时再决定要不要保存；想长期保留，就导出到记录板块。"},
  {category:"作业",target:"#board",title:"作业：做到哪一步了",text:"用卡片上的状态切换进度。大作业可以拆成几条待办，做完一条勾一条；“查看原作业”能回到作业网站。"},
  {category:"记录",target:"#board",title:"记录",text:"不一定是任务，也可以是一段想法、一次尝试，或者今天终于弄懂的一道题。记录会显示在日历里，也能加入轴线；不会自动归档。"},
  {target:"#add-task",title:"添加卡片",text:"选好类型，填标题和时间。地点、待办、附件和链接按需要补充。"},
  {target:"#sources-button",title:"连接作业网站",text:"在电脑上安装扩展，连接账号，再添加网站。手机登录同一账号，就能查看同步来的卡片。"},
  {target:"#add-source-link",sources:true,title:"添加网站",text:"粘贴作业列表、课表或校历页面的网址。需要识别的网页，先核对预览，再确认导入。"},
  {target:"#cloud-settings > h3",sources:true,title:"云端同步：关机也能更新",text:"为支持的网站授权后，每小时更新一次。课表、考试和其他仅支持浏览器导入的网页仍需电脑浏览器运行。设置好后，到第 5 步点“一键同步”。"},
  {target:"#user-menu-toggle",title:"今日总结",text:"点击头像，随时查看今天零点以来完成的事。每天第一次打开网站，会先看到昨天的总结；消息、归档和账号设置也在这个菜单里。"}
];
let demoIndex=0,demoOriginal=null,demoFrame=0,demoReveal=false;
const demoKey=()=>`ruchecklist-demo:${boardAccount}`;
function positionDemo() {
  if(!$("demo-dialog").open)return;
  const target=document.querySelector(demoSteps[demoIndex].target);if(!target)return;
  const rect=target.getBoundingClientRect(),frame=$("demo-highlight"),card=$("demo-card"),pad=8;
  const left=Math.max(pad,rect.left-5),top=Math.max(pad,rect.top-5),width=Math.max(0,Math.min(innerWidth-pad,rect.right+5)-left),height=Math.max(0,Math.min(innerHeight-pad,rect.bottom+5)-top);
  Object.assign(frame.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});
  const cardWidth=Math.min(400,innerWidth-32);card.style.width=`${cardWidth}px`;const cardHeight=card.offsetHeight;
  const cardTop=top+height+16+cardHeight<innerHeight?top+height+16:top-cardHeight-16>=16?top-cardHeight-16:Math.max(16,innerHeight-cardHeight-20);
  Object.assign(card.style,{width:`${cardWidth}px`,left:`${Math.max(16,Math.min(left,innerWidth-cardWidth-16))}px`,top:`${cardTop}px`});
}
function layoutDemo(reveal=false){
  demoReveal ||= reveal;
  if(demoFrame)return;
  demoFrame=requestAnimationFrame(()=>{
    demoFrame=0;const shouldReveal=demoReveal;demoReveal=false;if(!$("demo-dialog").open)return;
    const step=demoSteps[demoIndex];
    if(shouldReveal)document.querySelector(step.target)?.scrollIntoView({block:step.sources?"center":"nearest",behavior:"instant"});
    positionDemo();
  });
}
function showDemoStep() {
  const step=demoSteps[demoIndex];
  mobileSidebar(!!document.querySelector(step.target)?.closest(".sidebar"));
  $("demo-title").textContent=step.title;$("demo-description").textContent=step.text;$("demo-progress").textContent=`${demoIndex+1} / ${demoSteps.length}`;
  $("demo-prev").disabled=demoIndex===0;$("demo-next").disabled=false;$("demo-next").textContent=demoIndex===demoSteps.length-1?"开始使用":"下一步";
  if(step.sources) {
    if(!$("sources-dialog").open){$("demo-dialog").close();$("sources-dialog").showModal();$("demo-dialog").showModal();}
    setSyncStep(step.target==="#add-source-link"?3:4);
  }else {
    $("sources-dialog").close();
    if(step.view)overviewView=step.view;
    if(step.category){categoryFilter=step.category;render();}
  }
  layoutDemo(true);$("demo-next").focus({preventScroll:true});
}
function startDemo() {
  if($("workspace").hidden)return;demoIndex=0;demoOriginal={category:categoryFilter,view:overviewView,scroll:scrollY};
  $("sources-dialog").classList.add("demo-preview");$("demo-dialog").showModal();showDemoStep();
  // Detection and network requests must never block a tour transition.
  loadSourceLinks();checkCloud();checkCollector();
}
function endDemo() {
  mobileSidebar(false);
  try{localStorage.setItem(demoKey(),"seen");}catch{}
  $("demo-dialog").close();$("sources-dialog").close();
  $("sources-dialog").classList.remove("demo-preview");cancelAnimationFrame(demoFrame);demoFrame=0;demoReveal=false;
  loadSyncProgress();
  if(demoOriginal){categoryFilter=demoOriginal.category;overviewView=demoOriginal.view;render();window.scrollTo({top:demoOriginal.scroll,behavior:"instant"});demoOriginal=null;}
  (mobileNavigation.matches?$("mobile-nav-toggle"):$("demo-button")).focus({preventScroll:true});
}
function maybeDemo() {if(typeof maybeMessageBoard==="function")maybeMessageBoard();let seen=false;try{seen=localStorage.getItem(demoKey())==="seen";}catch{}if(!seen&&!document.querySelector("dialog[open]")&&!$("workspace").hidden)startDemo();}
$("demo-button").onclick=startDemo;$("demo-skip").onclick=endDemo;
$("demo-next").onclick=()=>{if(demoIndex===demoSteps.length-1)endDemo();else{demoIndex++;showDemoStep();}};
$("demo-prev").onclick=()=>{if(demoIndex){demoIndex--;showDemoStep();}};
$("demo-dialog").addEventListener("cancel",event=>{event.preventDefault();endDemo();});
window.addEventListener("resize",()=>layoutDemo(true));document.addEventListener("scroll",()=>layoutDemo(),true);
const demoLayout=new ResizeObserver(()=>{
  if(!$("demo-dialog").open)return;
  layoutDemo(true);
});
for(const id of ["guide-install","website-setup","collector-controls","collector-state","cloud-settings","sources-list","sources-dialog"])demoLayout.observe($(id));

function setAuthMode(mode) {
  $("auth-heading").textContent=mode==="register"?"注册账号":mode==="recover"?"重设密码":"欢迎回来";
  $("auth-login").className=mode==="login"?"secondary":"text-button";$("auth-register").className=mode==="register"?"secondary":"text-button";
  authMode=mode;$("invite-field").hidden=mode!=="register" || publicRegistration;$("recovery-field").hidden=mode!=="recover";
  $("invite-code").required=mode==="register" && !publicRegistration;$("recovery-code").required=mode==="recover";
  $("password").autocomplete=mode==="login"?"current-password":"new-password";
  $("password-label").textContent=mode==="recover"?"新密码":"密码";
  $("password").placeholder="至少 6 位，含英文和数字";
  document.querySelector("#login-form button[type=submit]").textContent=mode==="register"?"创建账号":mode==="recover"?"重设密码":"登录看板";
  $("login-error").textContent="";
}
function configureAccount(data) {
  publicRegistration=!!data.public_registration;$("public-user-count").textContent=Number.isInteger(data.registered)?String(data.registered):"—";
  $("public-user-count").closest(".landing-stats").hidden=!Number.isInteger(data.registered);
  trialMode=!!data.trial;isAdmin=!!data.admin;boardAccount=data.account || (trialMode?"":"personal");accountName=data.username || accountName;registrationOpen=!!data.registration_open;
  loadSyncProgress();
  updateAccountCard();
  $("trial-auth").hidden=!trialMode;$("auth-recover").hidden=!trialMode;$("account-button").hidden=!trialMode;
  $("username").required=trialMode;$("password").minLength=trialMode?6:0;
  if(trialMode){setAuthMode("login");$("auth-register").disabled=!registrationOpen;$("trial-notice").hidden=registrationOpen;$("trial-notice").textContent=registrationOpen?"":"暂未开放新注册，已有账号可登录";}
  renderAttachmentStorage();
}
function showRecovery(code) {
  $("account-dialog").close();$("recovery-value").textContent=code;$("recovery-done").disabled=true;$("recovery-dialog").showModal();
}
$("auth-login").onclick=()=>setAuthMode("login");$("auth-register").onclick=()=>setAuthMode("register");$("auth-recover").onclick=()=>setAuthMode("recover");
$("recovery-dialog").addEventListener("cancel",event=>{if($("recovery-done").disabled)event.preventDefault();});
$("download-recovery").onclick=()=>{
  const url=URL.createObjectURL(new Blob([`RUCapture\n网站：${location.origin}\n用户名：${accountName}\n恢复码：${$("recovery-value").textContent}\n请勿分享此文件。\n`],{type:"text/plain;charset=utf-8"}));
  const link=element("a");link.href=url;link.download="RUCapture-账号恢复码.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$("recovery-done").disabled=false;
};
$("recovery-done").onclick=()=>{$("recovery-dialog").close();$("recovery-value").textContent="";maybeMessageBoard();maybeDemo();};
$("account-button").onclick=()=>{$("account-name").textContent=`用户名：${accountName}`;$("account-password").value="";$("account-error").textContent="";$("account-dialog").showModal();};
$("recovery-form").onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;try{const result=await api("/api/recovery-code","POST",{password:$("account-password").value});$("account-password").value="";showRecovery(result.recovery);}catch(error){$("account-error").textContent=error.message;}finally{event.submitter.disabled=false;}};
$("login-form").onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $("login-error").textContent = "";
  try {
    const result=await api(trialMode?`/api/${authMode==="register"?"register":authMode==="recover"?"recover":"login"}`:"/api/login", "POST", {password: $("password").value,remember:$("remember-login").checked,...(trialMode?{username:$("username").value,invite:$("invite-code").value.trim(),recovery:$("recovery-code").value.trim()}:{})},30000);
    $("password").value="";$("invite-code").value="";$("recovery-code").value="";
    if(trialMode){boardAccount=result.account;accountName=result.username;isAdmin=!!result.admin;}
    updateAccountCard();await refresh();await startMessages();if(result.recovery)showRecovery(result.recovery);else maybeDemo();
  }
  catch (error) { $("login-error").textContent = error.message; }
  finally { button.disabled = false; }
};
$("logout").onclick=()=>{$("logout-error").textContent="";$("logout-dialog").showModal();};
$("confirm-logout").onclick=async()=>{try{await api("/api/logout","POST",{});showLogin();}catch(error){$("logout-error").textContent=error.message;}};
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("workspace").hidden) refresh(); });
let lastPoll=0;
setInterval(() => { if (!document.hidden && !$("workspace").hidden && !document.activeElement.matches("#board input, #board select") && Date.now()-lastPoll>=60000) {lastPoll=Date.now();refresh({poll:true});} }, 6000);
window.addEventListener("online",()=>{if(!$("workspace").hidden)refresh();});
document.addEventListener("DOMContentLoaded",()=>{
api("/api/session").then(async data => {
  configureAccount(data);
  if(!data.authenticated)return showLogin();
  await refresh();await startMessages();
  if(sessionStorage.getItem("resume-setup")){sessionStorage.removeItem("resume-setup");$("sources-button").click();}else maybeDemo();
}).catch(() => { showLogin(); $("login-error").textContent = "服务器暂时无法连接，请刷新重试"; });
});

// The public tour uses synthetic examples only; it never calls the task APIs.
(() => {
  const root=$("login"),pages=[...root.querySelectorAll("[data-launch-page]")],track=root.querySelector(".launch-track"),nav=[...root.querySelectorAll("[data-launch-to]")];
  const reduced=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current=0,lockedUntil=0,lastWheel=0,wheelTotal=0,wheelDirection=0,wheelConsumed=false,wheelInner=false,touch=null;
  function go(index,{login=false}={}){
    index=Math.max(0,Math.min(pages.length-1,index));
    const changed=index!==current,from=pages[current];current=index;
    // One compositor-driven translation, even when a navigation click interrupts a transition.
    track.style.transform=`translate3d(0,${-100*index}%,0)`;root.dataset.page=String(index);
    if(changed){lockedUntil=performance.now()+(reduced()?0:950);pages[index].scrollTop=0;}
    if(from.contains(document.activeElement) && changed)root.querySelector(`.launch-nav [data-launch-to="${index}"]`).focus({preventScroll:true});
    pages.forEach((page,i)=>{page.classList.toggle("is-current",i===index);page.inert=i!==index;page.setAttribute("aria-hidden",String(i!==index));});
    nav.forEach(button=>{if(Number(button.dataset.launchTo)===index)button.setAttribute("aria-current","step");else button.removeAttribute("aria-current");});
    $("launch-page-number").textContent=`0${index+1} / 04`;
    if(changed && index===2)drawJourney();
    if(login){
      const page=pages[0],form=$("login-form");
      page.scrollTo({top:Math.max(0,form.getBoundingClientRect().top-page.getBoundingClientRect().top+page.scrollTop-(page.clientHeight-form.offsetHeight)/2),behavior:"instant"});
      $(trialMode?"username":"password").focus({preventScroll:true});
    }
  }
  nav.forEach(button=>button.onclick=()=>go(Number(button.dataset.launchTo)));
  root.querySelectorAll("[data-launch-login]").forEach(button=>button.onclick=()=>go(0,{login:true}));
  const editable=target=>target instanceof Element && !!target.closest("input,textarea,select,[contenteditable=true]");
  function canScroll(target,direction){
    for(let node=target instanceof Element?target:null;node && node!==root;node=node.parentElement){
      if(node.scrollHeight>node.clientHeight+2 && /auto|scroll/.test(getComputedStyle(node).overflowY) && (direction>0?node.scrollTop+node.clientHeight<node.scrollHeight-2:node.scrollTop>2))return true;
    }
    return false;
  }
  root.addEventListener("wheel",event=>{
    if(root.hidden || event.ctrlKey || event.metaKey || Math.abs(event.deltaY)<=Math.abs(event.deltaX) || editable(event.target))return;
    const now=performance.now(),direction=Math.sign(event.deltaY),fresh=now-lastWheel>220 || direction!==wheelDirection;
    if(fresh){wheelTotal=0;wheelConsumed=false;wheelInner=false;}lastWheel=now;wheelDirection=direction;
    if(now<lockedUntil || wheelConsumed){event.preventDefault();wheelConsumed=true;return;}
    // A tall page scrolls normally first; its final inertia cannot skip the next page.
    if(canScroll(event.target,direction)){wheelTotal=0;wheelInner=true;return;}
    if(wheelInner){event.preventDefault();return;}
    event.preventDefault();wheelTotal+=Math.abs(event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?pages[current].clientHeight:1);
    if(wheelTotal>=36){wheelConsumed=true;go(current+direction);}
  },{passive:false});
  root.addEventListener("keydown",event=>{
    if(editable(event.target) || event.ctrlKey || event.metaKey || event.altKey)return;
    const direction=["ArrowDown","PageDown"].includes(event.key)?1:["ArrowUp","PageUp"].includes(event.key)?-1:0;
    if(direction){if(canScroll(event.target,direction))return;event.preventDefault();if(!event.repeat)go(current+direction);}
    else if(event.key==="Home" || event.key==="End"){event.preventDefault();go(event.key==="Home"?0:pages.length-1);}
  });
  root.addEventListener("touchstart",event=>{
    if(event.touches.length!==1 || editable(event.target)){touch=null;return;}
    const point=event.touches[0];touch={x:point.clientX,y:point.clientY,index:current,up:!canScroll(event.target,-1),down:!canScroll(event.target,1)};
  },{passive:true});
  root.addEventListener("touchend",event=>{
    const start=touch;touch=null;if(!start || !event.changedTouches.length || start.index!==current || performance.now()<lockedUntil)return;
    const point=event.changedTouches[0],dy=start.y-point.clientY,dx=start.x-point.clientX;
    if(Math.abs(dy)>65 && Math.abs(dy)>Math.abs(dx)*1.3 && (dy>0?start.down:start.up))go(current+Math.sign(dy));
  },{passive:true});
  root.addEventListener("touchcancel",()=>{touch=null;},{passive:true});
  go(0);
  // Small, local pointer response. No motion work runs for touch or reduced-motion users.
  root.querySelectorAll(".launch-demo").forEach(scene=>{
    let frame=0;
    scene.addEventListener("pointermove",event=>{
      if(event.pointerType!=="mouse" || reduced())return;cancelAnimationFrame(frame);
      const x=event.clientX,y=event.clientY;
      frame=requestAnimationFrame(()=>{const box=scene.getBoundingClientRect(),px=(x-box.left)/box.width,py=(y-box.top)/box.height;scene.style.setProperty("--tilt-x",`${(0.5-py)*3}deg`);scene.style.setProperty("--tilt-y",`${(px-0.5)*3}deg`);scene.style.setProperty("--glow-x",`${px*100}%`);scene.style.setProperty("--glow-y",`${py*100}%`);});
    });
    scene.addEventListener("pointerleave",()=>{cancelAnimationFrame(frame);scene.style.removeProperty("--tilt-x");scene.style.removeProperty("--tilt-y");});
  });
  $("collect-demo-replay").onclick=()=>{const scene=root.querySelector(".collect-demo");scene.classList.remove("replaying");requestAnimationFrame(()=>requestAnimationFrame(()=>scene.classList.add("replaying")));};
  const days=[
    [["08:00","课程","数学分析","#eef1fa"],["16:00","作业","完成线性表练习","#c0aaff"],["21:30","记录","今天终于弄懂的一个问题","#a9ceff"]],
    [["10:00","考试","数据结构 · 第一次小测","#f0ce9c"],["14:00","会议","小组讨论：课程展示","#efb5d2"],["19:00","活动","去操场跑一跑","#a4dfcb"]],
    [["08:00","课程","概率论与数理统计","#eef1fa"],["15:30","作业","读书报告：整理提纲","#c0aaff"],["22:00","记录","记下这周想继续做的事","#a9ceff"]]
  ];
  function showDay(index){
    root.querySelectorAll("[data-demo-day]").forEach((button,i)=>button.setAttribute("aria-pressed",String(i===index)));
    $("launch-day-events").replaceChildren(...days[index].map(([time,type,title,color])=>{const article=element("article"),text=element("div");article.style.setProperty("--demo-color",color);text.append(element("strong",title),element("small",type));article.append(element("time",time),text);return article;}));
  }
  root.querySelectorAll("[data-demo-day]").forEach(button=>button.onclick=()=>showDay(Number(button.dataset.demoDay)));showDay(0);
  const journeys=[
    {title:"这门课，争取 4.0",dates:["第 1 周","第 3 周","第 5 周"],titles:["课前预习","第一次小测","找到适合自己的方法"],types:["作业","考试","记录"],note:"从“还没弄懂”，到能独立讲清一道题。",path:"M55 160 C120 160 130 86 210 86 S320 165 380 118 S480 32 545 45",heights:[86,118,45],colors:["#bca4ff","#a8dfff"]},
    {title:"让运动成为习惯",dates:["第一天","第二周","一个月后"],titles:["先跑两公里","和朋友一起打球","跑完第一个五公里"],types:["活动","活动","记录"],note:"不追求每次都更快，先让自己愿意再出发。",path:"M55 160 L210 70 L380 120 L545 40",heights:[70,120,40],colors:["#b4d9cb","#7cddc1"]},
    {title:"沿海旅行随记",dates:["出发前","第一天","第三天"],titles:["留出几天空闲","海边的一场日落","想再去一次的小城"],types:["记录","活动","记录"],note:"行程会结束，看过的风景和当时的心情还在。",path:"M55 160 C125 160 130 55 210 55 S300 140 380 140 S485 80 545 80",heights:[55,140,80],colors:["#efc68f","#c5b0f5"]}
  ];
  function drawJourney(){
    const path=root.querySelector(".journey-plot path"),nodes=[...root.querySelectorAll(".journey-node")];
    for(const node of [path,...nodes])for(const animation of node.getAnimations())animation.cancel();
    if(reduced())return;
    path.animate([{strokeDashoffset:1},{strokeDashoffset:0}],{duration:2100,delay:100,easing:"cubic-bezier(.4,0,.2,1)",fill:"backwards"});
    nodes.forEach((node,i)=>node.animate([{opacity:0,translate:"0 8px"},{opacity:1,translate:"0 0"}],{duration:550,delay:450+i*550,easing:"ease-out",fill:"backwards"}));
  }
  root.querySelectorAll("[data-demo-journey]").forEach(button=>button.onclick=()=>{
    const index=Number(button.dataset.demoJourney),item=journeys[index];root.querySelectorAll("[data-demo-journey]").forEach((node,i)=>node.setAttribute("aria-pressed",String(i===index)));
    $("launch-journey-title").textContent=item.title;root.querySelectorAll(".journey-node").forEach((node,i)=>{node.querySelector("small").textContent=item.dates[i];node.querySelector("strong").textContent=item.titles[i];node.querySelector("span").textContent=item.types[i];node.style.top=`${item.heights[i]/220*100}%`;});$("launch-journey-reflection").querySelector("p").textContent=item.note;
    root.querySelector(".journey-plot path").setAttribute("d",item.path);root.querySelectorAll("#journey-gradient stop").forEach((stop,i)=>stop.setAttribute("stop-color",item.colors[i]));drawJourney();
  });
  let timer=null,seconds=1500,deadline=0;
  function stop(){clearInterval(timer);timer=null;$("launch-clock-toggle").setAttribute("aria-pressed","false");$("launch-clock-toggle").textContent=seconds===1500?"试试专注 ▷":"继续体验 ▷";}
  $("launch-clock-toggle").onclick=()=>{
    if(timer){stop();return;}deadline=Date.now()+seconds*1000;$("launch-clock-toggle").textContent="暂停 Ⅱ";$("launch-clock-toggle").setAttribute("aria-pressed","true");
    timer=setInterval(()=>{if(root.hidden || document.hidden || !pages[3].classList.contains("is-current")){stop();return;}seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));$("launch-clock-value").textContent=`00:${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;if(!seconds){stop();seconds=1500;$("launch-clock-note").textContent="体验结束。真正的专注，由你决定是否留下记录。";}},250);
  };
})();
