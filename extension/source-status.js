// One visible status card per top-level site tab. Child-frame results arrive through the extension.
(() => {
  if(window.top!==window || globalThis.RUCaptureStatus)return;
  let host,body,summary,items,retry,shown=false,dismissed=false,latest={};
  const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
  function mount(){
    if(host || !document.body || latest.enabled!==true || latest.statusVisible===false || dismissed)return;
    host=el('div');host.id='rucapture-source-status';
    const shadow=host.attachShadow({mode:'closed'}),style=el('style');
    style.textContent=':host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#eef0ff;color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}section{width:380px;max-width:calc(100vw - 28px);max-height:70vh;overflow:auto;padding:18px;background:#1c203d;border:1px solid #a79bff66;border-radius:16px;box-shadow:0 12px 40px #0006}header{display:flex;align-items:center;gap:10px}h2{font-size:17px;margin:0;flex:1}p{margin:10px 0;color:#bfc7e2}button{font:inherit;min-height:40px;color:inherit;background:#292d50;border:1px solid #a79bff60;border-radius:8px;padding:6px 10px;cursor:pointer}button:focus-visible{outline:2px solid #a99afa}button:disabled{opacity:.6;cursor:wait}ul{padding-left:20px;max-height:32vh;overflow:auto}li{margin:10px 0;overflow-wrap:anywhere}small{display:block;color:#bfc7e2}footer{margin-top:12px}a{color:#c6bcff}';
    style.textContent+=':host([hidden]){display:none!important}header button{flex:none;min-width:40px}';
    const card=el('section'),heading=el('header'),title=el('h2','RUCapture · 网站同步'),toggle=el('button','展开'),close=el('button','×');
    close.type='button';close.setAttribute('aria-label','关闭同步提示');close.title='关闭后，再次从 RUCapture 打开此网站时显示';
    close.onclick=()=>{dismissed=true;render();chrome.runtime.sendMessage({type:'dismiss-source-status'}).catch(()=>{});};
    toggle.type='button';toggle.setAttribute('aria-expanded','false');body=el('div');body.hidden=true;
    toggle.onclick=()=>{shown=!shown;body.hidden=!shown;toggle.textContent=shown?'收起':'展开';toggle.setAttribute('aria-expanded',String(shown));};
    heading.append(title,toggle,close);summary=el('p');summary.setAttribute('role','status');items=el('ul');
    retry=el('button','重新读取');retry.type='button';retry.onclick=async()=>{
      retry.disabled=true;summary.textContent='正在重新读取，请稍候…';
      try{const result=await chrome.runtime.sendMessage({type:'read-site'});if(result?.error)throw new Error(result.error);}
      catch(error){summary.textContent=error.message || '扩展已更新，请刷新此网页后重试。';}
      finally{retry.disabled=false;}
    };
    body.append(el('p','已适配网站会自动同步。这里可核对最近读取的标题、截止时间和完成状态。'),items,retry);
    card.append(heading,summary,body);shadow.append(style,card);document.body.append(host);render();
  }
  function render(){
    if(!host)return;host.hidden=latest.enabled!==true || latest.statusVisible===false || dismissed;
    summary.textContent=latest.error || latest.message || '已连接。进入课程或作业列表后自动读取。';
    if(latest.tasks){
      items.replaceChildren(...latest.tasks.slice(0,200).map(task=>{
        const item=el('li',task.title || task.content || '未命名任务'),stamp=new Date(task.due_at),date=task.due_at && Number.isFinite(stamp.getTime())?stamp.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'截止时间未提供';
        item.append(el('small',`${date} · ${{done:'已完成',todo:'未完成',doing:'进行中'}[task.status] || '完成状态未提供'}`));return item;
      }));
    }
  }
  globalThis.RUCaptureStatus={update(data){if(data.reopen)dismissed=false;latest={...latest,...data};mount();render();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(Object.keys(latest).length)mount();},{once:true});
})();
