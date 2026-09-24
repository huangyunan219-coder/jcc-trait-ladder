import { prepareRoster } from './search.js';
import { rewardForScore } from './rewards.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults = () => ({population:8,emblems:{},locked:[],excluded:[],occupiedSlots:{},luxForm:'any'});
let state = defaults();
let data;
let rewards;
let unitsById;
let traitsById;
let mode = 'noFive';
let catalog = 'traits';
let results = {};
let errors = {};
let jobs = new Map();
let sequence = 0;
let seed = 20264143;
let toastTimer;
const modeInput = key => ({...state,allowFiveCosts:key !== 'noFive',requireFiveCost:key === 'withFive'});
const icon = (item, className = 'trait-icon') => item?.icon
  ? `<img class="${className}" src="./${escape(item.icon)}" alt="" loading="lazy" width="27" height="27">`
  : `<span class="icon-fallback" aria-hidden="true">${escape(item?.name?.[0] || '◇')}</span>`;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').hidden = true, 3500);
}

function persist() {
  try { localStorage.setItem('jcc-trait-ladder.s18.v1',JSON.stringify(state)); } catch { /* Storage is optional. */ }
  // A stale shared configuration must not remain in the address after editing.
  if (location.hash.startsWith('#config=')) history.replaceState(null,'',location.pathname + location.search);
}

function restore() {
  let saved;
  try {
    saved = location.hash.startsWith('#config=') ? decodeURIComponent(location.hash.slice(8))
      : localStorage.getItem('jcc-trait-ladder.s18.v1');
    if (!saved) return;
    if (saved.length > 12000) throw new Error('配置过长');
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || ![8,9,10].includes(parsed.population)) throw new Error('人口无效');
    const candidate = defaults();
    for (const key of Object.keys(candidate)) if (Object.hasOwn(parsed,key)) candidate[key]=parsed[key];
    prepareRoster(data,candidate);
    if (Object.values(candidate.emblems).reduce((n,v)=>n+v,0)>30) throw new Error('转职过多');
    state=candidate;
  } catch {
    state=defaults();
    toast('保存的配置不适用当前规则，已恢复默认条件。');
  }
}

function stopJobs() {
  for (const worker of jobs.values()) worker.terminate();
  jobs.clear();
  sequence++;
}

function invalidate() {
  stopJobs();
  results={};
  errors={};
  persist();
  renderControls();
  renderResults();
}

function renderEmblems() {
  const query=$('#emblem-search').value.trim();
  const list=data.traits.filter(trait=>trait.emblem && trait.name.includes(query));
  $('#emblem-list').innerHTML=list.map(trait=>{
    const count=state.emblems[trait.id]||0;
    return `<div class="emblem-row ${count?'selected':''}">${icon(trait)}<span class="emblem-name">${escape(trait.name)}</span><div class="stepper"><button type="button" data-emblem="${escape(trait.id)}" data-delta="-1" aria-label="减少${escape(trait.name)}转职" ${count?'':'disabled'}>−</button><output aria-label="${escape(trait.name)}转职数量">${count}</output><button type="button" data-emblem="${escape(trait.id)}" data-delta="1" aria-label="增加${escape(trait.name)}转职">+</button></div></div>`;
  }).join('');
  $('#emblem-empty').hidden=!!list.length;
  $('#emblem-total').textContent=Object.values(state.emblems).reduce((n,v)=>n+v,0);
}

function displayName(id) {
  return unitsById.get(id)?.name || (id===data.special.lux?'拉克丝':id);
}

function renderControls() {
  document.querySelectorAll('[data-population]').forEach(button=>button.setAttribute('aria-pressed',String(+button.dataset.population===state.population)));
  $('#lux-form').value=state.luxForm;
  $('#search-button').textContent=state.population===8?'生成两种阵容 →':'生成阵容 →';
  $('#restrictions-count').textContent=state.locked.length+state.excluded.length ? `${state.locked.length} 保留 · ${state.excluded.length} 排除`:'可选';
  $('#locked-list').innerHTML=state.locked.map(id=>`<div class="constraint"><span>${escape(displayName(id))}</span><label>已占格<select data-occupied="${escape(id)}" aria-label="${escape(displayName(id))}已占装备格">${[0,1,2,3].map(n=>`<option value="${n}" ${n===(state.occupiedSlots[id]||0)?'selected':''}>${n}</option>`).join('')}</select></label><button type="button" data-remove-lock="${escape(id)}" aria-label="取消保留${escape(displayName(id))}">×</button></div>`).join('');
  $('#excluded-list').innerHTML=state.excluded.map(id=>`<div class="constraint"><span>${escape(displayName(id))}</span><button type="button" data-remove-exclude="${escape(id)}" aria-label="取消排除${escape(displayName(id))}">×</button></div>`).join('');
  renderEmblems();
}

function boardHtml(board,index) {
  const units=board.unitIds.map(id=>unitsById.get(id)).sort((a,b)=>a.cost-b.cost || a.name.localeCompare(b.name,'zh-CN'));
  const members=units.map(unit=>`<div class="unit-card" data-cost="${unit.cost}"><div class="unit-portrait">${unit.icon?`<img src="./${escape(unit.icon)}" alt="${escape(unit.name)}" loading="lazy" width="56" height="56">`:`<span class="initial">${escape(unit.name[0])}</span>`}<span class="cost-tag">${unit.cost}</span></div><div class="unit-name">${escape(unit.name)}${unit.slots>1?` <small>${unit.slots}人口</small>`:''}</div><div class="unit-traits">${Object.keys(unit.traits).filter(id=>traitsById.get(id)?.countable).map(escape).join(' · ')}</div><div class="unit-emblems">${(board.assignments[unit.id]||[]).map(id=>`<span class="unit-emblem">${traitsById.get(id)?.icon?`<img src="./${escape(traitsById.get(id).icon)}" alt="" loading="lazy">`:''}${escape(id)}转</span>`).join('')}</div></div>`).join('');
  const active=[...board.active].sort((a,b)=>Number(b.countable)-Number(a.countable)||a.name.localeCompare(b.name,'zh-CN'));
  const unused=Object.entries(board.unused||{}).map(([id,n])=>`${id}×${n}`).join('、');
  const lux=units.find(unit=>unit.form);
  return `<article class="board-card"><div class="board-top"><div class="board-title"><span class="rank">${String(index+1).padStart(2,'0')}</span><h3><strong>${board.score}</strong> 种有效羁绊</h3></div><span class="board-meta">${board.slots}/${state.population} 人口 · 一星总价 ${board.cost} 金</span></div><div class="board-members">${members}</div><div class="trait-strip">${active.map(trait=>`<span class="trait-chip ${trait.countable?'':'unique'}" title="${escape(trait.countable?`激活档位 ${trait.breakpoints.join('/')}，计入天梯`:trait.id==='日月双蚀'?'组合羁绊，当前暂不计分':'独有羁绊，不计入天梯')}">${trait.icon?`<img src="./${escape(trait.icon)}" alt="" loading="lazy">`:''}<b>${trait.count}</b>${escape(trait.name)}${trait.countable?'':' · 不计分'}</span>`).join('')}</div><details class="board-details"><summary>查看待激活羁绊与转职说明</summary><div class="missing-traits">${board.inactive.filter(trait=>trait.count>0).map(trait=>`<span>${escape(trait.name)} ${trait.count}/${trait.breakpoints[0]}，差 ${trait.needed}</span>`).join('')||'<span>没有未激活的普通羁绊。</span>'}</div><p style="margin-top:10px">${unused?`未使用：${escape(unused)}。它们没有可增加的有效羁绊，或没有足够的合法装备格。`:'所需转职已分配到上方弈子。'}</p>${lux?`<p>需要找到「${escape(lux.name)}」形态；该元素贡献 2 个人数。</p>`:''}</details><div class="board-bottom"><p>${lux?`拉克丝：${escape(lux.form)}形态`:'按转职与人口约束计算'} · 不使用卡兹克</p><button class="copy-board" type="button" data-copy="${index}">复制阵容 ↗</button></div></article>`;
}

function renderResults() {
  const eight=state.population===8;
  if (!eight) mode='all';
  else if (mode==='all') mode='noFive';
  $('#mode-tabs').hidden=!eight;
  $('#results-title').textContent=eight?'8 人口，分两种方式搭。':`${state.population} 人口，所有费用都可选。`;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
  $('#no-five-count').textContent=results.noFive?.boards[0]?`${results.noFive.boards[0].score} 种羁绊`:'1–4 费弈子';
  $('#with-five-count').textContent=results.withFive?.boards[0]?`${results.withFive.boards[0].score} 种羁绊`:'至少一张五费';
  const result=results[mode];
  const best=result?.boards[0];
  const running=jobs.has(mode);
  $('#best-score').textContent=best?.score??'—';
  const reward=rewardForScore(best?.score,rewards);
  $('#reward-summary').hidden=!reward;
  $('#reward-value').textContent=reward?`${best.score} 羁绊档 · ${reward.label}`:'';
  document.querySelectorAll('[data-reward-tier]').forEach(row=>row.classList.toggle('current',+row.dataset.rewardTier===best?.score));
  $('#best-label').textContent=result?.complete?'已证明最多（当前数据口径）':'当前找到的有效羁绊';
  $('#search-button').disabled=jobs.size>0 || !data;
  $('#stop-button').hidden=!jobs.size;
  $('#continue-button').disabled=jobs.size>0;
  $('#continue-button').hidden=!!result?.complete;
  $('#search-status').textContent=running?'正在寻找更多羁绊，页面可以继续操作…':
    errors[mode]?'请调整下方提示的条件。':
    !result?'选好转职后生成阵容，也可以先看无转职方案。':
    !best?(result.complete?'当前限制下没有合法阵容。':'时间内尚未找到阵容，可以继续搜索或放宽条件。'):
    result.complete?'当前条件下已完成搜索。只比较羁绊数量，不代表实战强度。':
    result.stopped?'已停止，保留当前找到的方案；尚未证明最优。':'本轮搜索结束，下面是当前找到的方案；尚未证明最优。';
  $('#ladder').innerHTML=Array.from({length:13},(_,i)=>i+4).map(n=>`<div class="ladder-step ${(best?.score||0)>=n?'lit':''} ${best?.score===n?'current':''}" title="${escape(`${n} 羁绊：${rewardForScore(n,rewards).label}`)}"><span>${n}</span></div>`).join('');
  $('#result-error').hidden=!errors[mode];
  $('#result-error').textContent=errors[mode]||'';
  $('#empty-state').hidden=!!best || !!errors[mode];
  $('#result-list').innerHTML=best?result.boards.slice(0,3).map(boardHtml).join('')+
    (result.boards.length>3?`<details class="more-results"><summary>查看另外 ${result.boards.length-3} 套方案</summary>${result.boards.slice(3).map((board,i)=>boardHtml(board,i+3)).join('')}</details>`:''):'';
  $('#results-footer').hidden=!result;
  $('#search-details').textContent=result?`本轮校验 ${result.visited.toLocaleString()} 个候选 · ${(result.elapsedMs/1000).toFixed(1)} 秒 · 同分时优先展示较低购买成本`:'';
}

function combine(previous,next) {
  if (!previous) return next;
  const boards=new Map();
  for (const board of [...previous.boards,...next.boards]) boards.set(board.key,board);
  return {...next,boards:[...boards.values()].sort((a,b)=>b.score-a.score||a.cost-b.cost||b.slots-a.slots||a.key.localeCompare(b.key)).slice(0,10)};
}

function startSearch(again=false) {
  stopJobs();
  const requestId=sequence;
  const keys=state.population===8?['noFive','withFive']:['all'];
  if (!again) results={};
  errors={};
  for (const key of keys) {
    try {
      const input=modeInput(key);
      prepareRoster(data,input);
      const previous=results[key];
      const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      jobs.set(key,worker);
      worker.onmessage=({data:message})=>{
        if (message.id!==sequence || jobs.get(key)!==worker) return;
        if (message.type==='error') errors[key]=message.message;
        else results[key]=combine(previous,message.result);
        if (message.type!=='progress') {worker.terminate();jobs.delete(key);}
        renderResults();
      };
      worker.onerror=()=>{
        if (requestId!==sequence) return;
        errors[key]='计算线程启动失败，请刷新页面或使用较新的浏览器。';
        worker.terminate();jobs.delete(key);renderResults();
      };
      worker.postMessage({id:requestId,input,timeBudgetMs:again?10000:5000,seed:seed++});
    } catch(error) {errors[key]=error.message;}
  }
  renderResults();
}

function renderCatalog() {
  document.querySelectorAll('[data-catalog]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.catalog===catalog)));
  const list=catalog==='traits'?data.traits.filter(trait=>trait.countable):data.units;
  $('#catalog').innerHTML=`<div class="catalog-grid">${list.map(item=>`<div class="catalog-item">${icon(item)}<div><b>${escape(item.name)}</b><p>${catalog==='traits'?`${item.breakpoints.join(' / ')} 人激活${item.emblem?' · 有转职':''}`:`${item.cost}费 · ${Object.keys(item.traits).map(escape).join(' / ')}`}</p></div></div>`).join('')}</div>`;
}

function renderRewards() {
  $('#reward-rows').innerHTML=rewards.tiers.map(tier=>
    `<tr data-reward-tier="${tier.traits}"><th scope="row">${tier.traits}</th><td>${escape(tier.reward)}</td></tr>`
  ).join('');
}

async function copy(text) {
  try {await navigator.clipboard.writeText(text);toast('已复制。');}
  catch {$('#copy-output').value=text;$('#copy-dialog').showModal();$('#copy-output').select();}
}

function copyBoard(index) {
  const board=results[mode]?.boards[index];
  if (!board) return;
  const names=board.unitIds.map(id=>{
    const equipped=board.assignments[id]||[];
    return `${unitsById.get(id).name}${equipped.length?`（${equipped.join('转、')}转）`:''}`;
  });
  copy(`羁绊天梯 · 金铲铲 S18 · ${state.population}人口${mode==='noFive'?' · 无五费':mode==='withFive'?' · 含五费':''}\n${board.score}种有效羁绊（${results[mode].complete?'已完成搜索':'当前找到，未证明最优'}）\n${names.join('、')}\n羁绊：${board.active.filter(t=>t.countable).map(t=>`${t.name}${t.count}`).join('、')}\n数据：18.2a资料快照；日月双蚀暂不计数；不使用卡兹克。\n${location.origin}${location.pathname}`);
}

async function init() {
  const responses=await Promise.all(['./data/s18.json','./data/s18-rewards.json'].map(url=>fetch(url)));
  if (responses.some(response=>!response.ok)) throw new Error('S18 数据加载失败，请检查网络后刷新。');
  [data,rewards]=await Promise.all(responses.map(response=>response.json()));
  unitsById=new Map(data.units.map(unit=>[unit.id,unit]));
  traitsById=new Map(data.traits.map(trait=>[trait.id,trait]));
  restore();
  const groups=new Map();
  for (const unit of data.units) groups.set(unit.baseId,unit.form?{...unit,id:unit.baseId,name:'拉克丝'}:unit);
  const options=[...groups.values()].sort((a,b)=>a.cost-b.cost||a.name.localeCompare(b.name,'zh-CN'))
    .map(unit=>`<option value="${escape(unit.id)}">${unit.cost}费 · ${escape(unit.name)}</option>`).join('');
  $('#lock-picker').innerHTML='<option value="">选择要保留的弈子</option>'+options;
  $('#exclude-picker').innerHTML='<option value="">选择要排除的弈子</option>'+options;
  $('#lux-form').insertAdjacentHTML('beforeend',data.units.filter(unit=>unit.form).map(unit=>`<option value="${escape(unit.form)}">${escape(unit.form)}形态</option>`).join(''));
  $('#dataset-label').textContent=`${data.counts.baseChampions}名弈子 · ${data.counts.countableTraits}种计分羁绊 · ${data.counts.emblems}种转职`;
  $('#data-confidence').textContent=data.confidenceNotice;
  $('#source-links').innerHTML=[['中文英雄图鉴','https://jccvvvip.com/heroes'],['羁绊档位来源','https://jccvvvip.com/traits'],['S18 纹章清单','https://op.gg/zh-cn/tft/set/18'],['Riot 赛季机制说明','https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/enchanted-wilds-overview/']].map(([title,url])=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${title} ↗</a>`).join('');
  $('#share-button').disabled=false;
  renderControls();renderCatalog();renderRewards();renderResults();

  $('#emblem-search').addEventListener('input',renderEmblems);
  $('#emblem-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-emblem]');
    if (!button) return;
    const id=button.dataset.emblem,delta=+button.dataset.delta;
    if (delta>0 && Object.values(state.emblems).reduce((n,v)=>n+v,0)>=30) return toast('最多可输入 30 个转职。');
    const count=Math.max(0,(state.emblems[id]||0)+delta);
    if (count) state.emblems[id]=count; else delete state.emblems[id];
    invalidate();
  });
  document.querySelectorAll('[data-population]').forEach(button=>button.addEventListener('click',()=>{
    state.population=+button.dataset.population;mode=state.population===8?'noFive':'all';invalidate();
  }));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;renderResults();}));
  $('#clear-emblems').addEventListener('click',()=>{state.emblems={};invalidate();});
  $('#add-lock').addEventListener('click',()=>{
    const id=$('#lock-picker').value;if (!id) return;
    if (state.excluded.includes(id)) return toast('这张弈子已被排除，请先取消排除。');
    if (!state.locked.includes(id)) state.locked.push(id);invalidate();
  });
  $('#add-exclude').addEventListener('click',()=>{
    const id=$('#exclude-picker').value;if (!id) return;
    if (state.locked.includes(id)) return toast('这张弈子已被保留，请先取消保留。');
    if (!state.excluded.includes(id)) state.excluded.push(id);invalidate();
  });
  $('#locked-list').addEventListener('click',event=>{const id=event.target.closest('[data-remove-lock]')?.dataset.removeLock;if(id){state.locked=state.locked.filter(x=>x!==id);delete state.occupiedSlots[id];invalidate();}});
  $('#locked-list').addEventListener('change',event=>{const id=event.target.dataset.occupied;if(id){state.occupiedSlots[id]=+event.target.value;invalidate();}});
  $('#excluded-list').addEventListener('click',event=>{const id=event.target.closest('[data-remove-exclude]')?.dataset.removeExclude;if(id){state.excluded=state.excluded.filter(x=>x!==id);invalidate();}});
  $('#lux-form').addEventListener('change',()=>{state.luxForm=$('#lux-form').value;invalidate();});
  $('#search-button').addEventListener('click',()=>startSearch());
  $('#continue-button').addEventListener('click',()=>startSearch(true));
  $('#stop-button').addEventListener('click',()=>{stopJobs();for(const result of Object.values(results))result.stopped=true;renderResults();});
  $('#share-button').addEventListener('click',()=>{const url=new URL(location.href);url.hash='config='+encodeURIComponent(JSON.stringify(state));copy(url.href);});
  $('#result-list').addEventListener('click',event=>{const button=event.target.closest('[data-copy]');if(button)copyBoard(+button.dataset.copy);});
  document.querySelectorAll('[data-catalog]').forEach(button=>button.addEventListener('click',()=>{catalog=button.dataset.catalog;renderCatalog();}));
  $('#close-copy').addEventListener('click',()=>$('#copy-dialog').close());
  if (!('Worker' in window)) throw new Error('此浏览器不支持后台计算，请使用较新的 Chrome、Edge、Safari 或 Firefox。');
  startSearch();
}

init().catch(error=>{
  $('#load-error').textContent=error.message||'页面初始化失败，请刷新后重试。';
  $('#load-error').hidden=false;
  $('#search-button').disabled=true;
});
