"use strict";
let messageReady=false,startupMessageShown=false,releaseState=null,announcementState=null,noticeSnapshot=null;
let chatTarget=null,chatMessages=[],chatMore=false,chatSequence=0,chatBusy=false,chatPending=null,communityUnread=0;
// Original encouragements; no quotation attribution and no saved summary snapshots.
const DAILY_ENCOURAGEMENTS=[
  "把一件事做完，就给心里腾出了一点位置。",
  "今天的这一小步，也算数。",
  "不用每一天都很耀眼，走过的路不会白走。",
  "慢一点也没关系，你有自己的步速。",
  "把目光从还没做的事上移开一会儿，看看已经走过的路。",
  "能开始，已经不容易；能回来继续，也很了不起。",
  "先照顾好自己，再去照顾那些计划。",
  "暂时没有答案的题，明天也可以接着想。",
  "一页笔记、一段阅读，都是给未来留下的线索。",
  "别急着否定今天，你做过的努力不只在这张清单里。",
  "有时候，认真吃饭、好好睡觉，就是最重要的进展。",
  "没有人规定，成长一定要轰轰烈烈。",
  "给自己一点耐心，很多变化正在慢慢发生。",
  "你不需要和别人的进度条对齐。",
  "今天认真做过的事，会在某个时刻帮到你。",
  "把难题拆小一点，也把对自己的要求放温柔一点。",
  "偶尔停下来，不等于放弃向前。",
  "能把注意力收回来一次，就是一次练习。",
  "路还很长，留点力气给沿途的风景。",
  "做完这一段，记得站起来看看窗外。",
  "不是所有收获都能立刻打上勾，但它们依然存在。",
  "你可以有目标，也可以有不赶路的晚上。",
  "今天遇到的困难，不是对你能力的最终评价。",
  "一时没做好，不妨碍下一次做得更好。",
  "把今天收好，明天再翻开新的一页。",
  "能把模糊的想法写下来，就已经离它近了一点。",
  "不必一次想清楚整条路，先走到下一盏灯下。",
  "你认真生活的样子，不需要一张满分答卷来证明。",
  "完成后的那口气，可以慢慢呼出来。",
  "今天的自己，值得一句辛苦了。",
  "把进步看小一点，你会发现它其实常常发生。",
  "喜欢的事可以慢慢来，值得的人也包括你自己。",
  "一次练习可能很普通，许多次练习会留下变化。",
  "不顺利的日子，也可以有一个温柔的结尾。",
  "允许自己边走边学，没有谁一开始就全都会。",
  "给努力一点时间，也给生活一点空白。",
  "从图书馆走回宿舍的路上，记得抬头看看天。",
  "交掉一份作业，也别忘了给自己一点小小的奖励。",
  "困住你的那道题，不会定义整个学期。",
  "能和昨天的自己多懂一点点，就很好。",
  "清单可以很长，今天只需要走好今天这一段。",
  "你值得休息，不必先把所有事情都做完。",
  "在忙碌里给自己留一个能喘气的角落。",
  "别只记得赶路，也记得你为什么出发。",
  "小小的坚持，也是认真回答生活的一种方式。",
  "把注意力放回眼前，一次只做一件事。",
  "生活不只有截止时间，还有值得期待的下一顿饭。",
  "一段用心的时间，不会因为结果普通就失去意义。",
  "今天不够顺利的话，明天还有重新安排的机会。",
  "此刻能做的已经做了，剩下的慢慢来。"
];
let dailySummaryDay="",dailySummarySeen="",dailyAutoAttempted="",dailySummarySequence=0,dailySummaryPeriod="today",dailySummaryAutomatic=false,lastEncouragement=-1;
function resetDailySummary(){
  dailySummarySequence++;dailySummaryDay=dailySummarySeen=dailyAutoAttempted="";
  $("daily-summary-content").replaceChildren();$("daily-summary-date").textContent=$("daily-summary-error").textContent="";
}
function applyDailySummaryStatus(data){
  if(!data.server_time)return;
  dailySummaryDay=localInput(data.server_time).slice(0,10);dailySummarySeen=data.summary_seen_date || "";
}
function maybeDailySummary(){
  if(!dailySummaryDay || dailySummarySeen>=dailySummaryDay || dailyAutoAttempted===dailySummaryDay)return false;
  dailyAutoAttempted=dailySummaryDay;openDailySummary("yesterday",true);return true;
}
function dailyEncouragement(){
  const index=(lastEncouragement+1+Math.floor(Math.random()*(DAILY_ENCOURAGEMENTS.length-1)))%DAILY_ENCOURAGEMENTS.length;
  lastEncouragement=index;return DAILY_ENCOURAGEMENTS[index];
}
async function openDailySummary(period="today",automatic=false){
  const session=syncSession,sequence=++dailySummarySequence,dialog=$("daily-summary-dialog");
  dailySummaryPeriod=period;dailySummaryAutomatic=automatic;
  $("daily-summary-title").textContent=period==="today"?"今日总结":"昨日总结";
  $("daily-summary-date").textContent="正在整理这一天完成的事…";
  $("daily-summary-content").replaceChildren();$("daily-summary-error").textContent="";$("daily-summary-retry").hidden=true;
  if(!dialog.open)dialog.showModal();
  try{
    const data=await api(`/api/daily-summary?period=${period}`);
    if(session!==syncSession || sequence!==dailySummarySequence || !dialog.open)return;
    $("daily-summary-date").textContent=`${data.day.replaceAll("-"," / ")} · 北京时间 00:00 起${period==="today"?`，截至 ${localInput(data.generated_at).slice(11,16)}`:"，全天"}`;
    const records=data.tasks.filter(task=>task.category==="记录").length,completed=data.tasks.length-records;
    const total=element("p",null,"daily-summary-total");
    total.append(element("strong",String(completed || records)),document.createTextNode(!completed && records?"条记录已完善":"项已完成"));
    if(completed && records)total.append(element("small",`另有 ${records} 条记录已完善`));
    const quote=element("p",dailyEncouragement(),"daily-summary-quote"),list=element("ol",null,"daily-summary-list");
    for(const task of data.tasks){
      const row=element("li",null,"daily-summary-row"),time=element("time",localInput(task.completed_at).slice(11,16)),body=element("div"),meta=element("div",null,"daily-summary-meta");
      time.dateTime=task.completed_at;
      meta.append(element("span",task.category,`tag cat-${CATEGORIES.indexOf(task.category)}`));
      if(task.category==="记录")meta.append(element("span","已完善"));
      if(task.archived_at)meta.append(element("span","已归档"));
      body.append(meta,element("strong",task.title));row.append(time,body);list.append(row);
    }
    $("daily-summary-content").append(total,quote,data.tasks.length?list:element("p","这一天还没有标记完成的卡片。休息、尝试和慢慢推进，也都是一天的一部分。","daily-summary-empty"));
    if(automatic){
      dailySummarySeen=data.today;
      try{await api("/api/daily-summary/seen","POST",{day:data.today});}
      catch(error){if(session===syncSession && sequence===dailySummarySequence && dialog.open)$("daily-summary-error").textContent="总结已读取，跨设备的已读状态暂未同步，下次可能再次出现。";}
    }
  }catch(error){
    if(session!==syncSession || sequence!==dailySummarySequence || !dialog.open)return;
    $("daily-summary-date").textContent="暂时没能读取完成记录";$("daily-summary-error").textContent=error.message;$("daily-summary-retry").hidden=false;
  }
}
$("daily-summary-button").onclick=()=>openDailySummary();
$("daily-summary-retry").onclick=()=>openDailySummary(dailySummaryPeriod,dailySummaryAutomatic);
$("daily-summary-dialog").addEventListener("close",()=>{dailySummarySequence++;$("daily-summary-content").replaceChildren();queueMicrotask(maybeDemo);});
function resetMessages(){
  messageReady=false;startupMessageShown=false;releaseState=announcementState=noticeSnapshot=null;
  chatSequence++;chatTarget=null;chatMessages=[];chatMore=false;chatPending=null;chatBusy=false;communityUnread=0;
  $("chat-input").value="";$("chat-bubbles").replaceChildren();$("chat-threads").replaceChildren();$("messages-content").replaceChildren();
  $("feedback-unread").hidden=true;$("user-unread").hidden=true;$("chat-send").disabled=false;$("chat-error").textContent="";
}
async function archiveTask(task,archived){
  if(hasDraft()){notice("请先保存或取消待办草稿");return;}
  try{await api(`/api/tasks/${task.id}/archive`,"PATCH",{archived,revision:task.revision});lastPayload="";await refresh();if($("archive-dialog").open)await loadArchive();notice(archived?"已归档，可在归档处恢复":"已恢复到看板");}
  catch(error){notice(error.message);}
}
async function startMessages(){
  const session=syncSession;resetMessages();
  $("feedback-button").hidden=!trialMode;$("feedback-button").querySelector("span").textContent=isAdmin?"公告与答疑":"与管理员反馈";
  $("feedback-title").textContent=isAdmin?"公告与答疑":"与管理员反馈";
  $("feedback-dialog").classList.toggle("admin-chat",isAdmin);$("messages-error").textContent="";
  const results=await Promise.allSettled([api("/api/notices"),trialMode?api("/api/announcements"):Promise.resolve({announcements:[],last_read:0}),checkCloud(),checkCollector()]);
  if(session!==syncSession || $("workspace").hidden)return;
  releaseState=results[0].status==="fulfilled"?results[0].value:null;
  announcementState=results[1].status==="fulfilled"?results[1].value:null;
  if(!releaseState || !announcementState)$("messages-error").textContent="部分消息暂时读取失败，可重新打开消息看板重试。";
  messageReady=true;refreshCommunityUnread();
}
function expiredSources(){return sources.filter(s=>needsLogin(s)&&(sourceLinksState===null||sourceLinksState.some(l=>l.source===s.id)));}
function soonTasks(){
  const now=Date.now(),end=now+7*86400000;
  return tasks.filter(t=>!["课程","记录"].includes(t.category) && t.status!=="done" && !t.archived_at && Date.parse(t.category==="作业"?t.due_at:t.starts_at)>=now && Date.parse(t.category==="作业"?t.due_at:t.starts_at)<=end)
    .sort((a,b)=>Date.parse(a.category==="作业"?a.due_at:a.starts_at)-Date.parse(b.category==="作业"?b.due_at:b.starts_at));
}
function unreadAnnouncements(){return (announcementState?.announcements || []).filter(a=>a.id>(announcementState?.last_read || 0));}
function maybeMessageBoard(){
  if(!messageReady || document.hidden || $("workspace").hidden || document.querySelector("dialog[open]") || hasDraft())return;
  if(maybeDailySummary() || startupMessageShown)return;
  startupMessageShown=true;
  if(releaseState?.unread || expiredSources().length || soonTasks().length || unreadAnnouncements().length || communityUnread){renderMessages(false);$("messages-dialog").showModal();}
}
function messageSection(title){const section=element("section",null,"message-section");section.append(element("h3",title));$("messages-content").append(section);return section;}
function renderMessages(manual){
  $("messages-content").replaceChildren();const release=releaseState?.release,announcements=manual?(announcementState?.announcements || []):unreadAnnouncements();
  noticeSnapshot={version:releaseState?.unread?release?.version:null,announcement:Math.max(0,...announcements.map(a=>a.id))};
  if(release && (manual || releaseState.unread)){
    const section=messageSection("更新优化"),history=element("div",null,"release-history");history.id="release-history";history.hidden=true;
    const entry=release=>{const article=element("article",null,"release-entry");article.append(element("h4",`v${release.version} · ${release.title}`));const list=element("ul");release.items.forEach(text=>list.append(element("li",text)));article.append(list);return article;};
    section.append(entry(release));
    const older=(releaseState.releases || []).filter(item=>item.version!==release.version);
    if(older.length){
      history.append(...older.map(entry));const more=element("button","查看更多","text-button release-more");more.type="button";more.setAttribute("aria-expanded","false");more.setAttribute("aria-controls",history.id);
      more.onclick=()=>{history.hidden=!history.hidden;more.setAttribute("aria-expanded",String(!history.hidden));more.textContent=history.hidden?"查看更多":"收起历史更新";if(history.hidden)more.scrollIntoView({block:"nearest"});};
      section.append(history,more);
    }
  }
  const expired=expiredSources();
  if(expired.length){const section=messageSection("以下网站登录过期");section.append(element("p","点击跳转并重新登录；请在已连接扩展的电脑浏览器完成。","hint"));expired.forEach(source=>{const row=element("div",null,"expired-site");row.append(element("strong",source.name),loginLink(source));section.append(row);});}
  const soon=soonTasks();
  for(const category of ["作业","考试","会议","活动"]){const group=soon.filter(task=>task.category===category);if(!group.length)continue;const section=messageSection(`未来 7 天${category==="作业"?"到期":"开始"} · ${category} ${group.length} 项`);for(const task of group){const row=element("div",null,"message-task");row.append(element("strong",task.title),element("time",formatTime(category==="作业"?task.due_at:task.starts_at,true)));section.append(row);}}
  if(announcements.length){const section=messageSection("公告通知");for(const a of announcements){const row=element("article",null,"announcement");row.append(element("small",`管理员 · ${formatTime(a.created_at,true)}`),element("p",a.body));section.append(row);}}
  if(communityUnread){const section=messageSection(`收到 ${communityUnread} 条新消息`),button=element("button",isAdmin?"查看用户反馈":"查看管理员回复","secondary");button.onclick=()=>{$("messages-dialog").close();openChat();};section.append(button);}
  if(!$("messages-content").children.length)$("messages-content").append(element("p","暂无新的消息或未来 7 天的安排。","muted"));
}
$("messages-button").onclick=async()=>{
  const session=syncSession;$("messages-error").textContent="";
  try{const [release,announcements]=await Promise.all([api("/api/notices"),trialMode?api("/api/announcements"):Promise.resolve({announcements:[],last_read:0}),checkCloud()]);if(session!==syncSession)return;releaseState=release;announcementState=announcements;startupMessageShown=true;renderMessages(true);$("messages-dialog").showModal();}
  catch(error){notice(error.message);}
};
$("messages-read").onclick=async()=>{
  const session=syncSession,snapshot=noticeSnapshot;$("messages-read").disabled=true;
  try{if(snapshot?.version)await api("/api/notices/read","POST",{version:snapshot.version});if(trialMode&&snapshot?.announcement)await api("/api/announcements/read","POST",{last_id:snapshot.announcement});if(session!==syncSession)return;if(releaseState)releaseState.unread=false;if(announcementState)announcementState.last_read=snapshot?.announcement || announcementState.last_read;$("messages-dialog").close();maybeDemo();}
  catch(error){$("messages-error").textContent=error.message;}finally{$("messages-read").disabled=false;}
};
function applyCommunityUnread(total){
  communityUnread=total;$("feedback-unread").textContent=total>99?"99+":String(total);
  $("feedback-unread").hidden=!total;$("user-unread").hidden=!total;maybeMessageBoard();
}
async function refreshCommunityUnread(){
  if(!trialMode || $("workspace").hidden)return;const session=syncSession;
  try{const data=await api("/api/feedback/unread");if(session!==syncSession)return;applyCommunityUnread(data.total);}catch{}
}
async function openChat(){
  if(!trialMode)return;$("chat-error").textContent="";$("feedback-dialog").dataset.active=isAdmin?"false":"true";$("feedback-dialog").showModal();
  if(isAdmin){await loadThreads();if(!chatTarget)await selectChat("announcements");else await loadChat();$("feedback-dialog").dataset.active="false";}else await selectChat("me");
}
$("feedback-button").onclick=openChat;
$("chat-back").onclick=()=>{$("feedback-dialog").dataset.active="false";loadThreads();};
async function loadThreads(){
  const session=syncSession;
  try{const data=await api("/api/feedback/threads");if(session!==syncSession)return;
    const pinned=element("button",null,"chat-thread pinned");pinned.append(element("strong","发布公告"),element("small","置顶 · 所有试用用户可见"));pinned.setAttribute("aria-pressed",String(chatTarget==="announcements"));pinned.onclick=()=>selectChat("announcements");
    $("chat-threads").replaceChildren(pinned,...data.threads.map(t=>{const button=element("button",null,"chat-thread");button.setAttribute("aria-pressed",String(chatTarget===t.id));button.append(element("strong",t.username+(t.unread?` · ${t.unread} 条未读`:"")),element("small",t.preview));button.onclick=()=>selectChat(t.id);return button;}));
    if(!data.threads.length)$("chat-threads").append(element("p","暂未收到用户反馈。","hint"));
  }catch(error){$("chat-error").textContent=error.message;}
}
async function selectChat(target){
  if(chatBusy)return;
  if(chatTarget!==target && $("chat-input").value.trim() && !await confirmAction("切换会话？","当前未发送的内容将被丢弃。","放弃并切换"))return;
  if(chatTarget!==target){$("chat-input").value="";chatPending=null;}
  chatTarget=target;chatMessages=[];chatMore=false;$("chat-bubbles").replaceChildren();$("chat-error").textContent="";$("feedback-dialog").dataset.active="true";
  $("chat-send").textContent=target==="announcements"?"发布公告":"发送";$("chat-input").placeholder=target==="announcements"?"输入公告，发布后其他用户打开网站时会收到提醒…":"反馈建议、遇到的问题，或补充说明…";
  await loadChat();if(isAdmin)await loadThreads();
}
function renderChat(){
  $("chat-bubbles").replaceChildren(...chatMessages.map(m=>{const row=element("article",null,"chat-message"+(m.mine?" mine":""));row.dataset.id=m.id;row.append(element("p",m.body,"chat-bubble"),element("time",formatTime(m.created_at,true)));return row;}));
  if(!chatMessages.length)$("chat-bubbles").append(element("p",chatTarget==="announcements"?"还没有公告，在下方发布第一条。":"说说你的建议或遇到的问题。管理员回复后会在这里显示。","chat-empty"));
  $("chat-older").hidden=!chatMore;
}
async function loadChat(older=false){
  if(!chatTarget || !$("feedback-dialog").open)return;const session=syncSession,target=chatTarget,sequence=++chatSequence;
  const history=$("chat-history"),height=history.scrollHeight,top=history.scrollTop,atEnd=height-top-history.clientHeight<70;
  const before=older?chatMessages[0]?.id:0;
  try{const data=await api(`${target==="announcements"?"/api/announcements":`/api/feedback/${target}`}${before?`?before=${before}`:""}`);
    if(session!==syncSession||sequence!==chatSequence||target!==chatTarget||!$("feedback-dialog").open)return;
    const items=target==="announcements"?data.announcements.slice().reverse().map(m=>({...m,mine:true})):data.messages;
    // After a long offline interval, restart at the latest page rather than skip a gap.
    if(!older && data.more && items[0]?.id>chatMessages.at(-1)?.id)chatMessages=[];
    const merged=new Map((older?[...items,...chatMessages]:[...chatMessages,...items]).map(m=>[m.id,m]));
    const next=[...merged.values()].sort((a,b)=>a.id-b.id);const changed=JSON.stringify(next)!==JSON.stringify(chatMessages);
    if(older || !chatMessages.length)chatMore=data.more;
    chatMessages=next;$("chat-name").textContent=target==="announcements"?"发布公告":data.name;$("chat-state").textContent="";
    if(changed || !items.length){renderChat();if(older)history.scrollTop=top+history.scrollHeight-height;else if(atEnd||!top)history.scrollTop=history.scrollHeight;}
    if(target!=="announcements" && items.length){await api(`/api/feedback/${target}/read`,"POST",{last_id:items.at(-1).id});if(session===syncSession)refreshCommunityUnread();}
  }catch(error){if(session===syncSession&&sequence===chatSequence)$("chat-error").textContent=error.message;}
}
$("chat-older").onclick=()=>loadChat(true);
$("chat-form").onsubmit=async event=>{
  event.preventDefault();if(chatBusy||!chatTarget)return;const text=$("chat-input").value.trim();if(!text)return;
  const session=syncSession,target=chatTarget;chatBusy=true;$("chat-send").disabled=true;$("chat-error").textContent="";
  if(!chatPending||chatPending.target!==target||chatPending.text!==text)chatPending={target,text,key:crypto.randomUUID()};
  try{await api(target==="announcements"?"/api/announcements":`/api/feedback/${target}`,"POST",{body:text,client_id:chatPending.key});if(session!==syncSession)return;$("chat-input").value="";chatPending=null;await loadChat();$("chat-history").scrollTop=$("chat-history").scrollHeight;if(isAdmin)loadThreads();}
  catch(error){if(session===syncSession)$("chat-error").textContent=`${error.message}。内容已保留，可重试发送。`;}
  finally{if(session===syncSession){chatBusy=false;$("chat-send").disabled=false;}}
};
let lastCommunityPoll=0,chatPolling=false;
setInterval(async()=>{
  if(!trialMode||document.hidden||$("workspace").hidden||chatPolling)return;
  if(!$("feedback-dialog").open)return;
  lastCommunityPoll=Date.now();chatPolling=true;
  try{if($("feedback-dialog").open){await loadChat();if(isAdmin)await loadThreads();}await refreshCommunityUnread();}finally{chatPolling=false;}
},6000);
