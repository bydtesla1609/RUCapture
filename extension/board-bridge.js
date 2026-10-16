(() => {
  if(window.top!==window || !["https://campus-task-board.pages.dev","https://ruchecklist-trial.pages.dev","https://rucapture.pages.dev"].includes(location.origin)) return;
  let account="personal";
  window.addEventListener("message",async event=>{
    const data=event.data;
    if(event.source!==window || event.origin!==location.origin || data?.kind!=="campus-board-command" || typeof data.id!=="string" || data.id.length>80) return;
    if(!["status","pair","configure","scan","options","academic-scan","generic-setup","cloud-panel","refresh-sources"].includes(data.command)) return;
    let result;
    try {result=await chrome.runtime.sendMessage({type:"board-control",command:data.command,token:data.token,enabled:data.enabled,account:data.account,source:data.source,url:data.url});}
    catch {result={error:"扩展已更新，请刷新看板页面后重试"};}
    if(result?.connected)account=data.account || "personal";
    window.postMessage({kind:"campus-board-reply",id:data.id,result},location.origin);
  });
  // A real link click from the board is the only navigation that reopens a dismissed card.
  for(const type of ["click","auxclick"])document.addEventListener(type,event=>{
    if(!event.isTrusted || event.defaultPrevented || event.button>1)return;
    const link=event.target.closest?.("a[href]");
    if(link && /^https?:/.test(link.href) && new URL(link.href).origin!==location.origin)chrome.runtime.sendMessage({type:"board-control",command:"show-source-status",url:link.href,account}).catch(()=>{});
  });
})();
