// Local, declarative DOM rules only. Never evaluate website-provided code.
globalThis.CampusGeneric=(()=>{
  const compact=value=>String(value || "").replace(/\s+/g," ").trim();
  const emptyList=text=>/^(?:暂无(?:作业|任务|相关作业|相关任务|数据)|没有(?:作业|任务)|no (?:assignments|tasks)(?: yet)?)[。.!！]?$/i.test(text);
  function pageKey(value) {
    const url=new URL(value);
    if(!["https:","http:"].includes(url.protocol) || url.username || url.password)throw new Error("页面地址不正确");
    for(const key of [...url.searchParams.keys()])if(/^(?:page|pageNum|pageNo|offset|utm_.*)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();return url.href;
  }
  function validateRule(rule) {
    if(!rule || typeof rule!=="object")throw new Error("请先识别列表或点选字段");
    const result={};
    for(const key of ["rows","title","due","status","course"]){
      const value=rule[key] || "";
      if(typeof value!=="string" || value.length>1200 || (!value && ["rows","title"].includes(key)))throw new Error("读取规则不完整，请重新点选");
      result[key]=value;
    }
    return result;
  }
  const visible=node=>node && !node.closest('[hidden],[aria-hidden="true"],script,style,input,textarea,select,nav,header,footer') && node.getClientRects().length>0;
  function text(node) {
    if(!node)return "";
    const parts=[],walker=node.ownerDocument.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(visible(walker.currentNode.parentElement))parts.push(walker.currentNode.textContent);
    return compact(parts.join(' '));
  }
  function path(node,root) {
    const parts=[];
    while(node && node!==root && node.nodeType===1){
      const tag=node.tagName.toLowerCase(),siblings=[...(node.parentElement?.children || [])].filter(other=>other.tagName===node.tagName);
      parts.unshift(tag+(siblings.length>1?`:nth-of-type(${siblings.indexOf(node)+1})`:""));node=node.parentElement;
    }
    return root?parts.length?`:scope > ${parts.join(" > ")}`:":scope":parts.join(" > ");
  }
  function repeated(node) {
    const semantic=node.closest('tr,li,article,[role="row"],.assignment,.homework,.task-card,.el-collapse-item,.ant-collapse-item');
    if(semantic)return semantic;
    for(let parent=node.parentElement;parent && parent!==document.body;parent=parent.parentElement){
      const siblings=[...parent.parentElement.children].filter(other=>other.tagName===parent.tagName && other.className===parent.className);
      if(siblings.length>=2 && text(parent).length<=2000 && (parent.querySelector('a[href],h2,h3,h4') || siblings.every(other=>/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text(other)))))return parent;
    }
    throw new Error("没有找到重复的任务行，请点选一条任务内的标题");
  }
  function rowSelector(row) {
    const classes=[...row.classList].filter(name=>!/active|selected|done|complete|pending|odd|even|hover/i.test(name));
    const selector=`${row.tagName.toLowerCase()}${classes.map(name=>'.'+CSS.escape(name)).join("")}`;
    // Collapse lists often split current and ended tasks into separate containers.
    return classes.some(name=>/^(?:el-collapse-item|ant-collapse-item|assignment|homework|task-card|exam-card)$/.test(name))?selector:`${path(row.parentElement)} > ${selector}`;
  }
  function pickTitle(node) {
    const row=repeated(node);
    return {rows:rowSelector(row),title:path(node,row),...fields(row)};
  }
  function pickField(rule,node,field) {
    let row=node.closest(rule.rows);
    if(!row){
      // Repair old title-only rules when a sibling date/status is selected.
      for(const old of document.querySelectorAll(rule.rows)){
        const title=rule.title===':scope'?old:old.querySelector(rule.title);
        if(!title)continue;
        const candidate=repeated(title);
        if(candidate.contains(node)){rule=pickTitle(title);row=candidate;break;}
      }
    }
    if(!row)throw new Error('请在同一任务列表内点选该字段');
    if(field==='due')while(node!==row && !deadline(node) && node.parentElement)node=node.parentElement;
    return {...rule,[field]:path(node,row)};
  }
  const completion=value=>globalThis.CampusParsers?.progress(value) || (/^(?:已完成|已提交|已交卷|已交|待批阅|已批阅|已批改|completed|submitted)$/i.test(value)?'done':/^(?:未完成|未提交|未交卷|未交|待提交|待重做|已退回|not submitted|incomplete)$/i.test(value)?'todo':null);
  function fields(row) {
    const nodes=[...row.querySelectorAll('time,[datetime],[data-due],[data-deadline],span,p,div,td')].filter(visible);
    let dates=nodes.filter(node=>deadline(node));
    // Prefer an explicitly labelled deadline or a complete start/end range over an isolated start date.
    const priority=node=>/截止|结束|deadline|due/i.test(text(node)) || node.matches('[data-due],[data-deadline]')?0:dateMatches(text(node)).length===2?1:2;
    if(dateMatches(text(row)).length>1 && dates.every(node=>priority(node)===2))dates=[];
    dates.sort((a,b)=>priority(a)-priority(b)||text(a).length-text(b).length);
    const states=nodes.filter(node=>completion(text(node).replace(/^(?:提交状态|完成状态|状态)[:：]?\s*/,''))).sort((a,b)=>text(a).length-text(b).length);
    return {due:dates[0]?path(dates[0],row):'',status:states[0]?path(states[0],row):'',course:''};
  }
  function detect(doc=document) {
    const candidates=[];
    for(const table of doc.querySelectorAll('table,[role="table"]')){
      if(!visible(table))continue;
      const headers=[...table.querySelectorAll('thead th,thead td,[role="columnheader"]')];
      if(!headers.length)headers.push(...table.querySelectorAll('tr:first-child th'));
      const index=pattern=>headers.findIndex(node=>pattern.test(text(node)));
      const title=index(/作业|任务|名称|标题|assignment|homework|title/i),due=index(/截止|DDL|due|deadline|结束时间/i),status=index(/完成|提交|状态|进度|通过题|status|progress/i),course=index(/课程|科目|course/i);
      if(title<0)continue;
      const row=[...table.querySelectorAll('tbody tr,[role="row"]')].find(node=>visible(node) && node.querySelector('td,[role="cell"]'));
      if(table.matches('table') && table.querySelector('tbody') && emptyList(text(table.querySelector('tbody')))){
        const field=i=>i<0?"":`:scope > td:nth-child(${i+1})`;
        candidates.push({rows:`${path(table.querySelector('tbody'))} > tr`,title:field(title),due:field(due),status:field(status),course:field(course)});continue;
      }
      if(!row)continue;
      const field=i=>i<0 || !row.children[i]?"":path(row.children[i],row);
      if(!row.children[title])continue;
      candidates.push({rows:rowSelector(row),title:field(title),due:field(due),status:field(status),course:field(course)});
    }
    if(candidates.length)return candidates[0];
    const titles=[...doc.querySelectorAll('main h2,main h3,main h4,article h2,article h3,a[href],[class*="title"],[class*="name"]')];
    for(const node of [...doc.querySelectorAll('span,p,div')].slice(0,3000))if(!node.children.length && /作业|任务|assignment|homework/i.test(node.textContent))titles.push(node);
    for(const title of [...new Set(titles)].slice(0,2000)){
      if(!visible(title))continue;
      const titleText=text(title);if(!titleText || titleText.length>500 || dateMatches(titleText).length || completion(titleText))continue;
      try{
        const rule=pickTitle(title),rows=[...doc.querySelectorAll(rule.rows)].filter(visible);
        if(!rows.length || rows.length===1 && !rows[0].matches('.assignment,.homework,.task-card,.el-collapse-item,.ant-collapse-item') || !rows.some(row=>/截止|DDL|deadline|due|作业|任务|assignment|homework/i.test(text(row))))continue;
        const row=rows[0];
        // Skip wrappers that combine a completion badge and the actual title.
        if([...title.children].some(child=>completion(text(child))))continue;
        return {...rule,...fields(row)};
      }catch{}
    }
    return null;
  }
  const normalized=value=>compact(value).replace(/[：]/g,':');
  const dateMatches=value=>[...normalized(value).matchAll(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/g)];
  function deadline(node) {
    if(!visible(node))return null;
    return CampusParsers.deadline(node.getAttribute('data-due') || node.getAttribute('data-deadline') || node.getAttribute('datetime') || text(node));
  }
  async function extract(rule,address,doc=document) {
    rule=validateRule(rule);
    if([...doc.querySelectorAll('input[type="password"]')].some(node=>node.getClientRects().length && !node.closest('[hidden],[aria-hidden="true"]')))throw new Error("请先完成网站登录，再读取列表");
    const rows=[...doc.querySelectorAll(rule.rows)].filter(visible);
    if(!rows.length)throw new Error("未找到原来的任务列表，请确认页面已加载，必要时重新点选字段");
    if(rows.length>200)throw new Error("当前页面超过 200 条，请分页面读取");
    const tasks=[],seen=new Set(),base=new URL(address);
    for(const row of rows){
      if(!row.querySelector('a[href]') && emptyList(text(row)))continue;
      const get=key=>rule[key]===':scope'?row:rule[key]?row.querySelector(rule[key]):null,titleNode=get("title"),title=text(titleNode);
      if(!title || title.length>500)throw new Error("任务标题缺失或过长，请重新点选标题");
      const anchors=titleNode.matches('a[href]')?[titleNode]:[...titleNode.querySelectorAll('a[href]')];
      if(!anchors.length && titleNode.closest('a[href]') && row.contains(titleNode.closest('a[href]')))anchors.push(titleNode.closest('a[href]'));
      const links=[...new Set(anchors.map(a=>{try{const url=new URL(a.getAttribute('href'),base);return url.origin===base.origin && !url.username && !url.password && pageKey(url.href)!==pageKey(address)?url.href:null;}catch{return null;}}).filter(Boolean))];
      const link=links.length===1?links[0]:null;
      const identity=link?new URL(link):null;if(identity)identity.searchParams.sort();
      const key=identity?`link:${identity.href}`:`title:${pageKey(address)}:${title}`;
      const external_id='g:'+ [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(seen.has(external_id))throw new Error("列表含同名且无法区分的任务，请点选各自的标题链接后重试");
      seen.add(external_id);
      const state=text(get('status')).replace(/^(?:提交状态|完成状态|状态)[:：]?\s*/,"");
      const status=completion(state);
      tasks.push({external_id,title,content:"",due_at:deadline(get('due')),...(status?{status}:{}),course:text(get('course')).slice(0,300),source_url:link || address,stable:!!link});
    }
    return tasks;
  }
  return {pageKey,validateRule,path,pickTitle,pickField,detect,extract};
})();
