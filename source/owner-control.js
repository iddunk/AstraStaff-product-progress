(() => {
  'use strict';
  const config = JSON.parse(document.getElementById('owner-control-config').textContent);
  const choices = new Map([['ACCEPT','接受建议'],['KEEP_CURRENT','保持现状'],['ADJUST_PROPOSAL','方向对，方案需调整'],['UNDECIDED','暂不决定']]);
  const processingNames = {OPEN:'等待团队处理',ACKNOWLEDGED:'团队已收到',PROPOSAL_UPDATED:'方案已更新',PRODUCTION_ACCEPTED:'生产已验收',CONTROL_CHANGE_PROPOSAL:'等待 Control 变更确认'};
  const storageKey = 'owner-github-drafts:' + config.repository + ':' + config.pageId;
  const states = new Map();
  const sessionKey='owner-github-session:'+config.repository;
  let drafts = {}, snapshot = null, refreshError = '', busy = false, storageError = false, session='',identity=null,gatewayStatus='CHECKING';
  const fragment=new URLSearchParams(location.hash.slice(1));
  try { session=fragment.get('owner_session') || sessionStorage.getItem(sessionKey) || '';if(session)sessionStorage.setItem(sessionKey,session); } catch { session=fragment.get('owner_session') || ''; }
  if(fragment.has('owner_session'))window.history.replaceState(null,'',location.pathname+location.search);
  const access=el('div','owner-access-bar'),accessText=el('span','','GitHub 共享反馈'),login=el('button','owner-login','使用 GitHub 登录');
  login.type='button';access.append(accessText,login);const pageHeader=document.querySelector('.am-head');if(pageHeader)pageHeader.after(access);else document.body.prepend(access);
  function loginPath(){return config.gatewayUrl+(gatewayStatus==='SETUP_REQUIRED'?'/setup/start':'/auth/start');}
  login.addEventListener('click',()=>{if(identity){session='';identity=null;try{sessionStorage.removeItem(sessionKey);}catch{}paintAccess();for(const s of states.values())paint(s);}else if(['READY','SETUP_REQUIRED'].includes(gatewayStatus))location.assign(loginPath());else if(gatewayStatus==='UNAVAILABLE'){gatewayStatus='CHECKING';paintAccess();void checkGateway();}});
  function paintAccess(){accessText.textContent=identity ? 'GitHub · '+identity.login : gatewayStatus==='UNAVAILABLE'?'登录服务暂不可用，仍可查看共享意见并保留草稿':gatewayStatus==='SETUP_REQUIRED'?'首次连接 GitHub 后可直接在本页保存意见':gatewayStatus==='CHECKING'?'正在检查 GitHub 登录服务':'登录 GitHub 后可直接在本页保存意见';login.textContent=identity?'退出':gatewayStatus==='SETUP_REQUIRED'?'首次连接 GitHub':gatewayStatus==='UNAVAILABLE'?'重新检查登录服务':gatewayStatus==='CHECKING'?'检查中…':'使用 GitHub 登录';login.disabled=!identity&&gatewayStatus==='CHECKING';}
  async function checkGateway(){try{const health=await api('/health');gatewayStatus=health.status==='SETUP_REQUIRED'?'SETUP_REQUIRED':['READY','ready'].includes(health.status)?'READY':'UNAVAILABLE';}catch{gatewayStatus='UNAVAILABLE';}paintAccess();for(const state of states.values())paint(state);}
  async function api(path,init={}){const response=await fetch(config.gatewayUrl+path,{...init,credentials:'omit',cache:'no-store',headers:{...(init.body!==undefined?{'Content-Type':'application/json'}:{}),...(session&&path!=='/health'?{Authorization:'Bearer '+session}:{}),...init.headers},signal:AbortSignal.timeout(20000)});let body;try{body=await response.json();}catch{body={};}if(!response.ok){const error=new Error(body.code || body.error || 'REQUEST_FAILED');error.status=response.status;throw error;}return body;}
  async function authenticate(){if(!session){paintAccess();return;}try{const info=await api('/session');if(info.authenticated!==true || typeof info.login!=='string')throw new Error('INVALID_SESSION');identity=info;}catch{session='';identity=null;try{sessionStorage.removeItem(sessionKey);}catch{}}paintAccess();for(const state of states.values())paint(state);}
  try { drafts = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { drafts = {}; }
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) drafts = {};
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function persist() { try { localStorage.setItem(storageKey, JSON.stringify(drafts)); storageError = false; } catch { storageError = true; } }
  function latest(id) { return snapshot?.current?.find(item => item.module_id === id) || null; }
  function history(id) { return (snapshot?.history || snapshot?.entries || []).filter(item => item.module_id === id); }
  function validDraft(draft, id) { return draft && typeof draft.client_request_id === 'string' && draft.module_id === id && typeof draft.comment === 'string' && draft.comment.length <= 2000 && (draft.decision === null || choices.has(draft.decision)); }
  function startDraft(state) {
    const id = state.module.moduleId;
    if (!validDraft(drafts[id], id)) {
      const current = latest(id);
      drafts[id] = {schema_version:1,page:config.pageId,module_id:id,page_revision:config.pageRevision,proposal_revision:state.module.proposalRevision,
        decision:null,comment:'',expected_latest_decision_id:current?.decision_id || null,client_request_id:crypto.randomUUID()};
    }
    return drafts[id];
  }
  function formatTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '时间待核实' : date.toLocaleString('zh-CN',{hour12:false}); }
  function linkToIssue(entry, text) {
    const link = el('a','owner-issue',text); link.href = 'https://github.com/' + config.repository + '/issues/' + Number(entry.issue_number); link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  }
  function paint(state) {
    const id = state.module.moduleId, current = latest(id), draft = validDraft(drafts[id],id) ? drafts[id] : null;
    const stale = !!draft && (draft.expected_latest_decision_id !== (current?.decision_id || null) || draft.proposal_revision !== state.module.proposalRevision || draft.page_revision !== config.pageRevision || state.conflict);
    const pending = state.receipt && draft?.client_request_id === state.receipt.client_request_id;
    const receipt = draft && history(id).find(entry => entry.client_request_id === draft.client_request_id);
    const rejected = receipt && ['CONFLICT','REJECTED'].includes(receipt.outcome);
    state.area.dataset.state = state.saving?'saving':refreshError ? 'offline' : rejected || stale ? 'conflict' : pending?'github-saved':draft ? 'draft' : current ? 'saved' : 'ready';
    state.badge.textContent = state.saving?'正在保存':refreshError ? '暂未取得最新反馈' : rejected || stale ? '需要核对新意见' : pending?'GitHub 已保存 · 正在同步处理状态':draft ? '草稿 · 尚未提交' : current ? choices.get(current.decision) : '尚未决定';
    const effectiveChoice = draft?.decision || current?.decision;
    for (const button of state.buttons) button.setAttribute('aria-pressed',String(button.dataset.decision === effectiveChoice));
    if (document.activeElement !== state.input) state.input.value = draft?.comment ?? '';
    state.submit.disabled = !draft?.decision || !snapshot || !!refreshError || stale || !!rejected || !!state.saving || !!pending || (!identity&&!['READY','SETUP_REQUIRED'].includes(gatewayStatus));
    state.submit.textContent=state.saving?'正在保存':identity?'保存意见':'登录 GitHub 后保存';
    state.reconcile.hidden = !(stale || rejected);
    state.discard.hidden = !draft;
    state.meta.textContent = '页面 r' + config.pageRevision + ' · 方案 r' + state.module.proposalRevision + (current ? ' · ' + formatTime(current.created_at) + ' · ' + (processingNames[current.status] || '已记录') : '');
    state.latest.replaceChildren();
    if (current) {
      const label = el('p','owner-current','当前意见：' + choices.get(current.decision));
      state.latest.append(label);
      if (current.comment) state.latest.append(el('p','owner-current-comment',current.comment));
      state.latest.append(linkToIssue(current,'查看 GitHub 记录 #' + current.issue_number));
      if (current.stale || current.page_revision !== config.pageRevision || current.proposal_revision !== state.module.proposalRevision) state.latest.append(el('p','owner-error','这是旧页面或方案的意见；当前方案需要重新确认。'));
    }
    if(state.receipt)state.latest.append(linkToIssue(state.receipt,(pending?'已保存至 GitHub #':'上一版意见已保存至 GitHub #')+state.receipt.issue_number));
    state.error.textContent = [refreshError,stale ? '另一设备已有新意见，或方案已更新。核对后再提交，原草稿保留。' : '', rejected ? 'GitHub 已收到，但这条反馈存在冲突，尚未替换当前决定。' : '',storageError ? '此浏览器无法保留草稿，请保持页面打开。' : '',state.failure||''].filter(Boolean).join(' ');
    const entries = history(id).slice().reverse();
    state.history.replaceChildren(el('summary','','历史反馈（' + entries.length + '）'));
    for (const entry of entries.slice(0,30)) {
      const row = el('div','owner-history-row');
      row.append(el('p','',formatTime(entry.created_at) + ' · ' + (choices.get(entry.decision) || '记录更新') + ' · ' + (entry.outcome === 'CONFLICT' ? '冲突待核对' : entry.outcome === 'EDIT_RECORDED' ? '编辑已留存，原决定保留' : processingNames[entry.status] || entry.outcome || '已记录')));
      if (entry.comment) row.append(el('p','',entry.comment));
      if (entry.issue_number) row.append(linkToIssue(entry,'记录 #' + entry.issue_number));
      state.history.append(row);
    }
  }
  async function submit(state){
    const draft=drafts[state.module.moduleId];if(state.submit.disabled || !draft)return;
    if(!identity){persist();location.assign(loginPath());return;}
    const submitted={...draft};
    state.saving=true;state.failure='';paint(state);
    try{const receipt=await api('/feedback',{method:'POST',body:JSON.stringify(submitted)});
      if(!Number.isSafeInteger(receipt.issue_number)||receipt.issue_number<1||receipt.client_request_id!==submitted.client_request_id||receipt.decision_id!=='github-issue:'+receipt.issue_number||receipt.status!=='GITHUB_SAVED_PENDING_PROJECTION'||receipt.html_url!=='https://github.com/'+config.repository+'/issues/'+receipt.issue_number)throw new Error('INVALID_RECEIPT');
      // Do not turn HTTP success into a confirmed Owner direction; await ledger projection.
      // A matching projection may have arrived while POST was in flight.
      // It must not resurrect a pending receipt or clear a newer draft.
      const projected=history(state.module.moduleId).some(entry=>entry.client_request_id===submitted.client_request_id&&['ACCEPTED','DUPLICATE'].includes(entry.outcome));
      if(!projected)state.receipt=receipt;
    }catch(error){if(error.status===401){session='';identity=null;try{sessionStorage.removeItem(sessionKey);}catch{}paintAccess();state.failure='GitHub 登录已过期，草稿保留。重新登录后即可保存。';}else if(error.status===409){state.conflict=true;state.failure='最新意见或页面方案已改变，请先核对；页面版本变化时请刷新。';await refresh();}else{state.failure='尚未确认保存，草稿已保留，请重试。';}}
    finally{state.saving=false;paint(state);}
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      let data;
      if(identity){data=await api('/decisions');}
      else{const url=new URL(config.ledgerUrl);url.searchParams.set('v',String(Math.floor(Date.now()/60000)));const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('unavailable');data=await response.json();}
      if (data.schema_version !== 1 || data.repository !== config.repository || !Array.isArray(data.current) || !Array.isArray(data.history || data.entries)) throw new Error('invalid');
      snapshot = data; refreshError = '';
      for (const state of states.values()) {
        const draft = drafts[state.module.moduleId];
        const receipt = draft && history(state.module.moduleId).find(entry => entry.client_request_id === draft.client_request_id && ['ACCEPTED','DUPLICATE'].includes(entry.outcome));
        if (receipt) { delete drafts[state.module.moduleId]; state.receipt = null; state.conflict=false; }
        if(state.receipt&&history(state.module.moduleId).some(entry=>entry.client_request_id===state.receipt.client_request_id&&['ACCEPTED','DUPLICATE'].includes(entry.outcome)))state.receipt=null;
      }
      persist();
    } catch { refreshError = '暂时无法读取 GitHub 最新记录，草稿保留。稍后自动重试，也可查看 GitHub 原始记录。'; }
    finally { busy = false; for (const state of states.values()) paint(state); }
  }
  for (const module of config.modules) {
    const panel = document.querySelector('section.am-panel[data-id="' + module.panelId + '"]') || document.getElementById('panel-' + module.panelId) || [...document.querySelectorAll('section.am-panel')].find(p => p.querySelector('.am-panel-id')?.textContent.trim() === module.panelId);
    if (!panel) throw new Error('Owner module panel missing: ' + module.panelId);
    const area = el('section','owner-control'); area.dataset.moduleId = module.moduleId;
    const title = el('div','owner-control-title'); title.append(el('strong','',module.title));
    const badge = el('span','owner-status','正在读取'); badge.setAttribute('role','status'); title.append(badge); area.append(title);
    area.append(el('p','owner-recommendation','建议：' + module.recommendation));
    const latestNode = el('div','owner-latest'); area.append(latestNode);
    const editor = el('details','owner-editor'); editor.append(el('summary','','发表或更新意见'));
    const buttons = [], group = el('div','owner-decisions'); group.setAttribute('role','group'); group.setAttribute('aria-label',module.title + '的决策');
    const input = el('textarea','owner-comment'); input.id = 'owner-comment-' + module.moduleId; input.maxLength = 2000; input.rows = 3; input.placeholder = '可补充希望如何调整';
    const label = el('label','','评论（选填，最多 2000 字）'); label.htmlFor = input.id;
    const actions = el('div','owner-actions'), submitButton = el('button','owner-submit','保存意见'), reconcile = el('button','owner-reconcile','已核对，按最新意见继续'), discard = el('button','owner-discard','放弃草稿');
    submitButton.type = reconcile.type = discard.type = 'button'; actions.append(submitButton,reconcile,discard);
    const state = {module,area,badge,input,buttons,submit:submitButton,reconcile,discard,latest:latestNode,meta:el('p','owner-meta'),error:el('p','owner-error'),history:el('details','owner-history'),saving:false,receipt:null,failure:'',conflict:false};
    state.error.setAttribute('role','status');
    for (const [value,text] of choices) { const button = el('button','',text); button.type='button'; button.dataset.decision=value; button.setAttribute('aria-pressed','false'); button.addEventListener('click',()=>{const draft=startDraft(state);draft.decision=value;draft.client_request_id=crypto.randomUUID();state.receipt=null;state.failure='';persist();paint(state);});buttons.push(button);group.append(button); }
    input.addEventListener('input',()=>{const draft=startDraft(state);draft.comment=input.value;draft.client_request_id=crypto.randomUUID();state.receipt=null;state.failure='';persist();paint(state);});
    submitButton.addEventListener('click',()=>submit(state));
    reconcile.addEventListener('click',()=>{const draft=startDraft(state);draft.expected_latest_decision_id=latest(module.moduleId)?.decision_id || null;draft.page_revision=config.pageRevision;draft.proposal_revision=module.proposalRevision;draft.client_request_id=crypto.randomUUID();state.receipt=null;state.failure='';state.conflict=false;persist();paint(state);});
    discard.addEventListener('click',()=>{delete drafts[module.moduleId];state.receipt=null;state.failure='';state.conflict=false;persist();paint(state);});
    editor.append(group,label,input,actions,el('p','owner-disclosure','意见公开保存到 GitHub，团队处理状态通常 1–5 分钟自动同步。'));
    area.append(editor,state.error,state.meta,state.history); (panel.querySelector('.am-panel-body') || panel).append(area); states.set(module.moduleId,state); paint(state);
  }
  // Local-only answer-me-with-html Reply controls are not an alternative decision truth.
  for (const control of document.querySelectorAll('[data-action="reply"],#am-reply-btn')) control.hidden = true;
  checkGateway();authenticate().then(refresh); setInterval(()=>{if(!document.hidden){refresh();if(!identity)checkGateway();}},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('focus',refresh);
})();
