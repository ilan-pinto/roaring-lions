import { STATS_STYLE_HEAD } from './stats-page';

/**
 * /stats/members (GH-695 S5, spec 2026-11-14-admin-account-page-design.md D4-D6, D12, D13; mock beside it). One
 * self-contained HTML string, as /stats and /stats/feedback are, served with `FEEDBACK_PAGE_CSP` (the inline script is
 * the pattern those pages use; there is no nonce). The page reads through `/stats/api/members/*` and writes through the
 * coin route, nothing else.
 *
 * Every member-supplied string (display name, reason, kinds) reaches the DOM through `textContent` or `append(string)`,
 * never as markup: the script contains no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`, and a
 * test greps for them. The script is a `String.raw` literal with no `${}` and no backtick, so the page source is the
 * source you read here. It never holds, requests or prints a Google `sub`, a token, a cookie or an IP.
 */
const SCRIPT = String.raw`
const $=(id)=>document.getElementById(id);
const MAX_COINS=1000000,PER_ACTION=100000,REASON_MIN=8,REASON_MAX=200;
const ERR={signed_out:'Sign in to the game in this browser first.',not_admin:'This game account is not an admin.',closed:'Admin writes are closed.',
  moved:'The balance changed since the card was drawn.',range:'That would leave the balance outside 0 to 1,000,000.',limit:'A daily limit was reached.',
  forbidden:'Refused.',origin:'Refused (origin).',unauthorized:'Your stats session ended. Reload the page to sign in again.',not_found:'No such member.',
  no_wallet:'This member has no wallet.',no_change:'That changes nothing.',reason:'The reason must be 8 to 200 characters.',amount:'That amount is not allowed.',
  busy:'The balance is busy. Try again.',q:'Type a Player ID, or at least 3 letters of a name.'};
const say=(m)=>{$('msg').textContent=m;$('err').textContent=''};
const fail=(e)=>{$('err').textContent=ERR[e.message]||('Failed: '+e.message);$('msg').textContent=''};
const fmt=(n)=>Number(n).toLocaleString('en-US');
const day=(t)=>new Date(t).toISOString().slice(0,10);
const stamp=(t)=>new Date(t).toISOString().slice(0,16).replace('T',' ');
const sgn=(n)=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n));
function el(tag,props,...kids){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v===true)e.setAttribute(k,'');else if(v!==false&&v!=null)e.setAttribute(k,String(v));
  }
  for(const c of kids)e.append(c);
  return e;
}
async function call(path,opt){
  const r=await fetch('/stats/api/members/'+path,opt);
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||('HTTP '+r.status));e.body=j;throw e}
  return j;
}
const get=(p)=>call(p);
const post=(p,body)=>call(p,{method:'POST',headers:{'content-type':'application/json','x-rl-admin':'1'},body:JSON.stringify(body)});
const S={admin:false,open:false,me:null,cur:null,mode:'grant',op:null,filter:'all',next:null,busy:false,fresh:false};

function paintSwitch(){
  const chip=$('sw-chip');
  chip.textContent='Admin writes: '+(S.open?'open':'closed');
  chip.className='chip'+(S.open?'':' bad');
  $('sw-close').hidden=!(S.admin&&S.open);
  $('sw-who').textContent=S.admin?('Signed in as admin '+S.me):'Read only: this browser is not signed in to the game as an admin.';
  $('me').disabled=S.me===null;
  $('me').title=S.me===null?'Sign in to the game in this browser first':'The member signed in to the game in this browser';
  paintForm();
}

function rowOf(m){
  const tr=el('tr',{'data-id':m.publicId,'aria-selected':S.cur&&S.cur.publicId===m.publicId?'true':'false'});
  const open=el('button',{type:'button',class:'link',text:m.displayName});
  open.addEventListener('click',()=>openMember(m.publicId));
  tr.append(el('td',null,open),el('td',{class:'ref',text:m.publicId}),el('td',{text:m.kinds.join(', ')||'none'}),
    el('td',{class:'mono',text:m.created}),el('td',{class:'mono',text:m.lastSeen}),
    el('td',{class:'n',text:m.coins===null?'none':fmt(m.coins)}),el('td',{class:'n'+(m.credits===null?' muted':''),text:m.credits===null?'no campaign':fmt(m.credits)}));
  return tr;
}
function paintResults(list){
  const body=$('results-body');
  body.replaceChildren();
  for(const m of list)body.append(rowOf(m));
  $('results-empty').hidden=list.length>0;
  $('results-wrap').hidden=list.length===0;
}
async function find(q){
  say('');
  try{const j=await get('find?q='+encodeURIComponent(q));paintResults(j.members);return j.members}
  catch(e){fail(e);return []}
}

function block(id,title,big,rows){
  const sec=el('section',{class:'bal','aria-labelledby':id});
  const dl=el('dl');
  for(const [k,v] of rows)dl.append(el('dt',{text:k}),el('dd',{text:v}));
  sec.append(el('h3',{id,text:title}),big,dl);
  return sec;
}
function minutesAgo(t){const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<1?'under a minute ago':m===1?'1 minute ago':m<120?m+' minutes ago':Math.floor(m/60)+' hours ago'}
function paintCard(){
  const d=S.cur;
  $('member').hidden=d===null;
  if(d===null)return;
  const who=$('who');
  who.replaceChildren(el('span',{class:'name',text:d.displayName}),el('span',{class:'mono',text:d.publicId}),
    el('span',{class:'muted',text:'signs in with '+(d.kinds.join(', ')||'nothing')+' · created '+d.created+' · last seen '+d.lastSeen}));
  const card=$('cards');
  card.replaceChildren();
  const c=d.coins;
  if(c===null)card.append(el('section',{class:'bal'},el('h3',{text:'Roar coins'}),el('p',{class:'muted',text:'No wallet for this member.'})));
  else card.append(block('c-coins','Roar coins',el('div',{class:'big',text:fmt(c.free)}),[
    ['free',fmt(c.free)],['paid',c.paid===0?'0 (purchases closed)':fmt(c.paid)],['wallet revision',String(c.revision)],
    ['last change',c.lastChange?stamp(c.lastChange.at)+', '+c.lastChange.kind+' '+sgn(c.lastChange.delta):'none']]));
  const k=d.credits;
  if(k===null)card.append(el('section',{class:'bal'},el('h3',{text:'Brigade credits'}),el('p',{class:'muted',text:'No campaign on the server yet: credits cannot be set.'})));
  else card.append(block('c-cr','Brigade credits',el('div',{class:'big',text:fmt(k.balance)}),[
    ['earned total',fmt(k.earnedTotal)],['granted total',fmt(k.grantedTotal)],['campaign revision',String(k.revision)],['last synced',minutesAgo(k.syncedAt)]]));
  paintForm();
}

function plan(){
  const c=S.cur&&S.cur.coins;
  const raw=$('amt').value.trim();
  const amount=/^\d{1,9}$/.test(raw)?Number(raw):NaN;
  const reason=$('why').value.replace(/\s+/g,' ').trim();
  const out={ok:false,hint:'',amount,reason,before:c?c.free:0,after:0,delta:0};
  if(!S.admin){out.hint='Only a signed-in admin can change a balance.';return out}
  if(!S.open){out.hint='Admin writes are closed. Opening them is a wrangler step.';return out}
  if(!c){out.hint='This member has no wallet.';return out}
  if(Number.isNaN(amount)){out.hint='Type a whole number of coins.';return out}
  out.after=S.mode==='grant'?c.free+amount:S.mode==='deduct'?c.free-amount:amount;
  out.delta=out.after-c.free;
  if(S.mode!=='set'&&amount<1){out.hint='The amount must be at least 1.';return out}
  if(out.after<0||out.after>MAX_COINS){out.hint='The result must stay between 0 and 1,000,000.';return out}
  if(out.delta===0){out.hint='That changes nothing.';return out}
  if(Math.abs(out.delta)>PER_ACTION){out.hint='At most 100,000 coins in one change.';return out}
  if([...reason].length<REASON_MIN){out.hint='Give a reason of at least 8 characters.';return out}
  if([...reason].length>REASON_MAX){out.hint='The reason is at most 200 characters.';return out}
  out.ok=true;
  return out;
}
function paintForm(){
  for(const b of document.querySelectorAll('#modes button'))b.setAttribute('aria-pressed',String(b.dataset.mode===S.mode));
  const reason=$('why').value;
  $('count').textContent=[...reason].length+' / '+REASON_MAX+' · at least '+REASON_MIN;
  const p=plan();
  const pv=$('preview');
  pv.replaceChildren();
  if(S.cur&&S.cur.coins){
    pv.append(fmt(p.before)+' → ');
    if(!Number.isNaN(p.amount))pv.append(el('span',{class:p.delta<0?'minus':'plus',text:fmt(p.after)}),el('span',{class:'muted',text:' ('+sgn(p.delta)+' '+S.mode+')'}));
  }
  $('hint').textContent=p.ok?'':p.hint;
  $('review').disabled=!p.ok||S.busy;
  $('change').hidden=S.cur===null;
}

const WORD={grant:'Grant',deduct:'Deduct',set:'Set'};
function dlgTitle(p){return S.mode==='set'?'Set Roar coins to '+fmt(p.after)+'?':WORD[S.mode]+' '+fmt(Math.abs(p.delta))+' Roar coins?'}
function dlgGo(p){return S.mode==='set'?'Set to '+fmt(p.after)+' coins':WORD[S.mode]+' '+fmt(Math.abs(p.delta))+' coins'}
function showDialog(d){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}
function hideDialog(d){if(typeof d.close==='function')d.close();else d.removeAttribute('open')}
function review(){
  const p=plan();
  if(!p.ok)return;
  const d=S.cur;
  S.op=crypto.randomUUID();
  S.plan=p;
  $('d-title').textContent=dlgTitle(p);
  const t=$('d-table');
  t.replaceChildren();
  const row=(k,v)=>t.append(el('tr',null,el('th',{scope:'row',text:k}),v));
  row('Member',el('td',null,d.displayName+' ',el('span',{class:'mono',text:d.publicId})));
  row('Coins',el('td',{class:'mono'},fmt(p.before)+' → ',el('strong',{class:p.delta<0?'minus':'plus',text:fmt(p.after)}),' ('+sgn(p.delta)+')'));
  row('Reason',el('td',{text:p.reason}));
  row('Wallet rev.',el('td',{class:'mono',text:d.coins.revision+' (refused if it has moved)'}));
  const needType=S.mode!=='grant';
  $('typed').value='';
  $('typed').disabled=!needType;
  $('typed').placeholder=d.publicId;
  $('d-err').textContent='';
  $('d-go').textContent=dlgGo(p);
  $('d-go').disabled=needType;
  $('d-cancel').disabled=false;
  showDialog($('dlg'));
}
function typedOk(){return S.mode==='grant'||$('typed').value.trim().toUpperCase()===S.cur.publicId}
function closeDialog(){hideDialog($('dlg'));$('review').focus()}
async function confirmWrite(){
  if(S.busy||!typedOk())return;
  const p=S.plan,d=S.cur;
  S.busy=true;$('d-go').disabled=true;$('d-cancel').disabled=true;
  try{
    const r=await post(d.publicId+'/coins',{op_id:S.op,mode:S.mode,amount:p.amount,reason:p.reason,revision:d.coins.revision});
    d.coins={...d.coins,free:r.wallet.free,revision:r.wallet.revision,updatedAt:r.wallet.updatedAt,lastChange:{at:r.wallet.updatedAt,kind:'admin',delta:r.delta}};
    S.busy=false;
    closeDialog();
    $('why').value='';$('amt').value='';
    paintCard();
    say(WORD[S.mode]+' done: '+fmt(r.before)+' → '+fmt(r.after)+' coins ('+sgn(r.delta)+').');
    await loadJournal(true,true);
  }catch(e){
    S.busy=false;
    if(e.message==='moved'&&e.body&&e.body.wallet){
      d.coins={...d.coins,free:e.body.wallet.free,revision:e.body.wallet.revision};
      closeDialog();paintCard();fail(e);
    }else{
      $('d-err').textContent=ERR[e.message]||('Failed: '+e.message);
      $('d-go').disabled=false;$('d-cancel').disabled=false;
    }
  }
  paintForm();
}

function kindTag(r){return el('span',{class:'kind'+(r.kind==='admin'?' admin':''),text:r.kind==='admin'?'admin '+(r.mode||''):r.kind})}
function jrow(r,isNew){
  const sign=r.delta>0?'plus':r.delta<0?'minus':'';
  const op=r.opId?r.opId.slice(0,4)+'…'+r.opId.slice(-4):'—';
  return el('tr',{class:isNew?'new':''},el('td',{class:'mono',text:stamp(r.at)}),el('td',{text:r.currency}),el('td',null,kindTag(r)),
    el('td',{class:'n '+sign,text:r.delta==null?'—':sgn(r.delta)+(r.kind==='admin'?' '+(r.mode||''):'')}),
    el('td',{class:'n',text:r.before==null?'—':fmt(r.before)+' → '+fmt(r.after)}),
    el('td',{class:r.reason?'':'muted',text:r.reason||''}),el('td',{class:r.by==='player'?'muted':'ref',text:r.by}),el('td',{class:'ref',text:op}));
}
async function loadJournal(reset,mark){
  if(S.cur===null)return;
  const id=S.cur.publicId;
  const q=[];
  if(S.filter!=='all')q.push('currency='+S.filter);
  if(!reset&&S.next)q.push('before='+encodeURIComponent(S.next));
  try{
    const j=await get(id+'/journal'+(q.length?'?'+q.join('&'):''));
    if(S.cur===null||S.cur.publicId!==id)return;
    const body=$('journal-body');
    if(reset)body.replaceChildren();
    j.rows.forEach((r,i)=>body.append(jrow(r,mark===true&&i===0)));
    S.next=j.next;
    $('older').hidden=j.next===null;
    $('journal-empty').hidden=body.children.length>0;
  }catch(e){fail(e)}
}

async function openMember(publicId){
  say('');
  try{
    const d=await get(publicId);
    S.cur={publicId:d.member.publicId,displayName:d.member.displayName,kinds:d.member.kinds,created:d.member.created,lastSeen:d.member.lastSeen,coins:d.coins,credits:d.credits};
    S.filter='all';S.next=null;
    for(const b of document.querySelectorAll('#filters button'))b.setAttribute('aria-pressed',String(b.dataset.filter==='all'));
    for(const tr of document.querySelectorAll('#results-body tr'))tr.setAttribute('aria-selected',String(tr.dataset.id===publicId));
    paintCard();
    await loadJournal(true);
  }catch(e){fail(e)}
}

$('find-form').addEventListener('submit',(e)=>{e.preventDefault();const q=$('q').value.trim();if(q)find(q)});
$('me').addEventListener('click',async()=>{
  const list=await find('me');
  if(list.length===1)await openMember(list[0].publicId);
});
$('modes').addEventListener('click',(e)=>{const b=e.target.closest('button[data-mode]');if(b){S.mode=b.dataset.mode;paintForm()}});
$('filters').addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-filter]');if(!b)return;
  S.filter=b.dataset.filter;S.next=null;
  for(const x of document.querySelectorAll('#filters button'))x.setAttribute('aria-pressed',String(x===b));
  loadJournal(true);
});
$('older').addEventListener('click',()=>loadJournal(false));
$('amt').addEventListener('input',paintForm);
$('why').addEventListener('input',paintForm);
$('change').addEventListener('submit',(e)=>{e.preventDefault();review()});
$('typed').addEventListener('input',()=>{$('d-go').disabled=S.busy||!typedOk()});
$('d-go').addEventListener('click',confirmWrite);
$('d-cancel').addEventListener('click',()=>{if(!S.busy)closeDialog()});
$('dlg').addEventListener('cancel',(e)=>{if(S.busy)e.preventDefault()});
$('sw-close').addEventListener('click',async()=>{
  if(!confirm('Close admin writes for everyone? Only a wrangler command can open them again.'))return;
  try{await post('switch',{open:false});S.open=false;paintSwitch();say('Admin writes are closed.')}catch(e){fail(e)}
});

(async()=>{
  try{const w=await get('whoami');S.admin=w.admin===true;S.open=w.open===true;S.me=w.publicId}catch(e){fail(e)}
  paintSwitch();
  paintForm();
})();
`;

export const MEMBERS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roaring Lions Members</title>
<style>${STATS_STYLE_HEAD}
main{max-width:1180px}
h2{font:700 26px/1.1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;border-top:1px solid var(--rule);padding-top:14px;margin:32px 0 12px}
h3{font:700 20px/1.1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;margin:0 0 8px}
.hdr{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}
nav{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
nav a{color:var(--muted);font:600 13px 'IBM Plex Mono',monospace;text-transform:uppercase;text-decoration:none;border-bottom:1px solid var(--rule)}
nav a[aria-current]{color:var(--ink);border-bottom-color:var(--ink)}
nav form.logout{margin:0}nav form.logout button{background:none;border:0;border-bottom:1px solid var(--rule);padding:0;cursor:pointer;color:var(--muted);font:600 13px 'IBM Plex Mono',monospace;text-transform:uppercase}
.switch{display:flex;gap:8px;align-items:center;margin:4px 0 0;flex-wrap:wrap}
.chip{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase;border:1px solid var(--good);color:var(--good);padding:1px 8px}
.chip.bad{border-color:var(--bad);color:var(--bad)}
.mono,td.n,td.ref{font-family:'IBM Plex Mono',monospace}
.muted{color:var(--muted)}.note{font-size:13px}
button,input,select,textarea{font:inherit;padding:4px 8px}
.btn{background:var(--surface);border:1px solid var(--ink);color:var(--ink);cursor:pointer;padding:6px 12px}
.btn.primary{background:var(--ink);color:var(--surface)}.btn.danger{border-color:var(--bad);color:var(--bad)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
button.link{background:none;border:0;padding:0;color:var(--ink);text-decoration:underline;cursor:pointer}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center}
.controls input[type=search]{flex:1;min-width:220px;border:1px solid var(--ink);background:var(--ground)}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase;color:var(--muted)}
td.n{text-align:right;white-space:nowrap}td.ref{white-space:nowrap}
tr[aria-selected="true"]{background:var(--surface)}tr[aria-selected="true"] td:first-child{box-shadow:inset 3px 0 0 var(--ink)}
tr.new{background:color-mix(in srgb,var(--accent) 18%,var(--ground))}
.kind{font:600 11px 'IBM Plex Mono',monospace;text-transform:uppercase;border:1px solid var(--muted);padding:1px 6px;color:var(--muted);white-space:nowrap}
.kind.admin{border-color:var(--ink);color:var(--ink)}
.plus{color:var(--good)}.minus{color:var(--bad)}
.cards{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
@media (max-width:760px){.cards{grid-template-columns:minmax(0,1fr)}}
.bal{background:var(--surface);border-left:4px solid var(--ink);padding:12px 16px}
.bal .big{font:800 44px/1 'Big Shoulders Display',Impact,sans-serif}
.bal dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:10px 0 0;font-size:14px}
.bal dt{color:var(--muted)}.bal dd{margin:0;font-family:'IBM Plex Mono',monospace}
.who{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline;margin:0 0 12px}
.who .name{font:700 28px/1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase}
form.change{display:grid;grid-template-columns:140px minmax(0,1fr);gap:10px 14px;align-items:center;max-width:720px}
@media (max-width:600px){form.change{grid-template-columns:minmax(0,1fr)}}
form.change label,.lbl{font:600 13px 'IBM Plex Mono',monospace;text-transform:uppercase;color:var(--muted)}
.seg{display:inline-flex;border:1px solid var(--ink);justify-self:start}
.seg button{border:0;border-right:1px solid var(--ink);background:none;cursor:pointer;padding:4px 12px}
.seg button:last-child{border-right:0}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--surface);font-weight:600}
form.change input[type=number]{width:160px;border:1px solid var(--ink);background:var(--ground);font-family:'IBM Plex Mono',monospace}
form.change textarea{width:100%;min-height:60px;border:1px solid var(--ink);background:var(--ground)}
.count{font:12px 'IBM Plex Mono',monospace;color:var(--muted)}.preview{font:600 16px 'IBM Plex Mono',monospace}
#msg:empty,#err:empty{display:none}
#msg{border-left:3px solid var(--good);padding:4px 8px;background:var(--surface)}
#err{border-left:3px solid var(--bad);padding:4px 8px;background:var(--surface)}
.warn{border-left:3px solid var(--bad);background:var(--surface);padding:6px 10px;margin:8px 0;font-size:14px}
dialog{max-width:520px;width:calc(100% - 32px);background:var(--ground);color:var(--ink);border:2px solid var(--ink);padding:18px 20px}
dialog::backdrop{background:color-mix(in srgb,var(--ink) 55%,transparent)}
dialog h3{font-size:24px}dialog th{width:120px}
dialog .type{display:block;width:100%;border:1px solid var(--ink);background:var(--ground);font-family:'IBM Plex Mono',monospace;margin-top:4px}
dialog .row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
#d-err:empty{display:none}#d-err{border-left:3px solid var(--bad);padding:4px 8px;margin-top:8px}
</style></head><body><main>
<div class="hdr"><h1>Roaring Lions Stats</h1>
<div><nav aria-label="Stats sections"><a href="/stats">Players</a><a href="/stats/feedback">Feedback</a><a href="/stats/members" aria-current="page">Members</a><form method="post" action="/stats/logout" class="logout"><button type="submit">Sign out</button></form></nav>
<div class="switch"><span class="chip" id="sw-chip" role="status">Admin writes: &hellip;</span><button class="btn danger" id="sw-close" type="button" hidden>Close admin writes</button><span class="muted note" id="sw-who"></span></div></div></div>
<p class="muted">Signed-in members only. A guest's credits and coins live on their own device and cannot be seen or changed here.</p>
<p id="msg" role="status" aria-live="polite"></p>
<p id="err" role="alert"></p>

<h2>Find a member</h2>
<form class="controls" id="find-form" role="search">
<label for="q" class="lbl">Player ID or name</label>
<input id="q" type="search" autocomplete="off" aria-describedby="q-hint">
<button class="btn primary" type="submit">Find</button>
<button class="btn" id="me" type="button" disabled title="Sign in to the game in this browser first">Me</button>
</form>
<p id="q-hint" class="muted note">An exact 8-character Player ID, or the first 3 or more letters of a display name. At most 20 results.</p>
<p id="results-empty" class="muted" hidden>No members found.</p>
<div class="wrap" id="results-wrap" hidden><table>
<thead><tr><th scope="col">Name</th><th scope="col">Player ID</th><th scope="col">Signs in with</th><th scope="col">Created</th><th scope="col">Last seen</th><th scope="col" style="text-align:right">Coins</th><th scope="col" style="text-align:right">Credits</th></tr></thead>
<tbody id="results-body"></tbody></table></div>

<section id="member" hidden>
<h2>Member</h2>
<div class="who" id="who"></div>
<div class="cards" id="cards"></div>

<h2>Change a balance</h2>
<form class="change" id="change" aria-describedby="chg-note">
<span class="lbl" id="l-cur">Currency</span><div><b>Roar coins</b> <span class="muted note">Credits can be read here; changing them comes in a later release.</span></div>
<span class="lbl" id="l-mode">Change</span>
<div class="seg" id="modes" role="group" aria-labelledby="l-mode"><button type="button" data-mode="grant" aria-pressed="true">Grant +</button><button type="button" data-mode="deduct" aria-pressed="false">Deduct &minus;</button><button type="button" data-mode="set" aria-pressed="false">Set =</button></div>
<label for="amt">Amount</label>
<div><input id="amt" type="number" min="0" max="1000000" step="1" inputmode="numeric"> <span class="muted note">at most 100,000 in one change</span></div>
<label for="why">Reason <span aria-hidden="true">*</span></label>
<div><textarea id="why" required aria-required="true" maxlength="200"></textarea><div class="count" id="count"></div></div>
<span class="lbl">Result</span><div class="preview" id="preview"></div>
<span></span><div><button class="btn primary" id="review" type="submit" disabled>Review change&hellip;</button> <span class="muted note" id="hint" aria-live="polite"></span></div>
</form>
<div class="warn" id="chg-note" role="note">The server works out the change. If the balance has moved since this card was drawn, the change is refused and the card is redrawn.</div>

<h2>Journal</h2>
<div class="controls"><span class="lbl">Show</span>
<div class="seg" id="filters" role="group" aria-label="Currency filter"><button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="coins" aria-pressed="false">Coins</button><button type="button" data-filter="credits" aria-pressed="false">Credits</button></div></div>
<div class="wrap"><table>
<thead><tr><th scope="col">When (UTC)</th><th scope="col">Currency</th><th scope="col">Kind</th><th scope="col" style="text-align:right">Delta</th><th scope="col" style="text-align:right">Before &rarr; after</th><th scope="col">Reason</th><th scope="col">By</th><th scope="col">Op</th></tr></thead>
<tbody id="journal-body"></tbody></table></div>
<p id="journal-empty" class="muted" hidden>No entries yet.</p>
<p><button class="btn" id="older" type="button" hidden>Older entries</button></p>
<p class="muted note">Newest first, 50 a page. Player rows come from the coin journal; admin rows from the admin log. A member's export shows admin rows with &ldquo;by: admin&rdquo;, never the admin's id.</p>
</section>

<dialog id="dlg" aria-labelledby="d-title">
<h3 id="d-title"></h3>
<table id="d-table"></table>
<label class="note muted" for="typed">For a deduction or a set, type the Player ID to confirm:</label>
<input class="type" id="typed" autocomplete="off" disabled aria-describedby="typed-why">
<p id="typed-why" class="muted note">Not needed for a grant. Written to the journal with your Player ID; the change cannot be deleted, only reversed by another change.</p>
<p id="d-err" role="alert"></p>
<div class="row"><button class="btn" id="d-cancel" type="button">Cancel</button><button class="btn primary" id="d-go" type="button"></button></div>
</dialog>
</main><script>${SCRIPT}</script></body></html>`;

/** Exposed for tests: the page script on its own. */
export const MEMBERS_SCRIPT = SCRIPT;
