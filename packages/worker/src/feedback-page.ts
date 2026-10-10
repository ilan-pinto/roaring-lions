import { STATS_STYLE_HEAD } from './stats-page';
import { ANONYMOUS, NO_MISSION } from './feedback-triage';

/** Response headers for the triage page. It renders text the PUBLIC sent, so
 *  it carries a CSP on top of escaping every value: no third-party anything,
 *  no framing, no form posting elsewhere. The inline script and style are the
 *  dashboard's own pattern (one self-contained HTML string). */
export const FEEDBACK_PAGE_CSP =
  "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; " +
  "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** /stats/feedback and /stats/feedback/:id (GH-464, mocks 07-08). One page:
 *  the list stays on top and the opened row renders below it, as the mock
 *  shows; the id rides in the path so a detail link can be pasted. */
export const FEEDBACK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roaring Lions Feedback</title>
<style>${STATS_STYLE_HEAD}
main{max-width:1180px}
h2{font:700 26px/1.1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;border-top:1px solid var(--rule);padding-top:14px;margin:32px 0 12px}
h3{font:700 22px/1.1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;margin:24px 0 8px}
.hdr{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}
nav{display:flex;gap:16px;align-items:baseline}
nav a{color:var(--muted);font:600 13px 'IBM Plex Mono',monospace;text-transform:uppercase;text-decoration:none;border-bottom:1px solid var(--rule)}
nav a[aria-current]{color:var(--ink);border-bottom-color:var(--ink)}
.badge{background:var(--bad);color:var(--surface);padding:0 6px;margin-left:6px}
.badge:empty{display:none}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center}
select,button,input,textarea{font:inherit;padding:4px 8px}
.tab{background:var(--surface);border:1px solid var(--rule);color:var(--ink);cursor:pointer}
.tab[aria-pressed="true"]{border:2px solid var(--ink);font-weight:600}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase;color:var(--muted)}
td.n{text-align:right;font-family:'IBM Plex Mono',monospace}
td.ref,.mono{font-family:'IBM Plex Mono',monospace}
td.ref,td.when{white-space:nowrap}
#fb-list tr[data-id]{cursor:pointer}
#fb-list tr[data-id]:hover,#fb-list tr[aria-selected="true"]{background:var(--surface)}
#fb-list tr[aria-selected="true"] td:first-child{box-shadow:inset 3px 0 0 var(--ink)}
.kind{font:600 11px 'IBM Plex Mono',monospace;text-transform:uppercase;border:1px solid var(--muted);padding:1px 6px;color:var(--muted);white-space:nowrap}
.kind-bug{border-color:var(--bad);color:var(--bad)}.kind-praise{border-color:var(--good);color:var(--good)}
.tag{font:12px 'IBM Plex Mono',monospace;color:var(--muted);margin-right:6px}
.status{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase}
.muted{color:var(--muted)}
.detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;border-top:1px solid var(--rule);margin-top:32px}
@media (max-width:900px){.detail{grid-template-columns:minmax(0,1fr)}}
.note{background:var(--surface);border-left:4px solid var(--ink);padding:12px 16px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px}
.shot{display:block;max-width:100%;border:1px solid var(--rule);margin-bottom:12px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.actions button,.actions a{background:var(--surface);border:1px solid var(--ink);color:var(--ink);text-decoration:none;cursor:pointer;padding:6px 10px}
.actions .primary{background:var(--ink);color:var(--surface)}
.kv th{width:110px}.kv td{overflow-wrap:anywhere}
pre.issue{background:var(--surface);border:1px solid var(--rule);padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 'IBM Plex Mono',monospace}
#fb-msg:empty{display:none}#fb-msg{border-left:3px solid var(--bad);padding:4px 8px;background:var(--surface)}
</style></head><body><main>
<div class="hdr"><h1>Roaring Lions Stats</h1>
<nav><a href="/stats">Players</a><a href="/stats/feedback" aria-current="page">Feedback<span class="badge" id="fb-new"></span></a><a href="/stats/logout">Sign out</a></nav></div>
<p class="muted">Notes players sent from inside the game. Nothing here is public until you file it.</p>
<p id="fb-switch" class="controls"></p>
<p id="fb-msg" role="status" aria-live="polite"></p>
<div class="controls" id="fb-tabs"></div>
<div class="controls">
<select id="fb-tester" aria-label="Tester"></select>
<select id="fb-mission" aria-label="Mission"></select>
<select id="fb-kind" aria-label="Kind"></select>
</div>
<div class="wrap"><table id="fb-list"></table></div>
<section id="fb-detail" class="detail" hidden></section>
</main><script>
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=(t)=>esc(new Date(t).toISOString().slice(5,16).replace('T',' '));
const clock=(tick)=>{const s=Math.floor(tick/20);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const ANON=${JSON.stringify(ANONYMOUS)},NOMISSION=${JSON.stringify(NO_MISSION)};
const STATUSES=['new','triaged','filed','dismissed','all'];
const filt={status:'all',tester:'',mission:'',kind:''};
let openId=null;
const api=(p,opt)=>fetch('/stats/api/feedback'+p,opt).then(async(r)=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j});
const post=(p,body)=>api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const say=(m)=>{$('fb-msg').textContent=m};
function who(r){return r.tester?esc(r.tester):'anonymous'+(r.session?' <span class="muted mono">'+esc(r.session)+'</span>':'')}
function kindTag(c){return '<span class="kind kind-'+esc(c)+'">'+esc(c)+'</span>'}
function listRow(r){
  return '<tr data-id="'+esc(r.id)+'"'+(r.id===openId?' aria-selected="true"':'')+'><td class="ref">'+esc(r.ref)+'</td><td class="when">'+when(r.receivedAt)+'</td><td>'+who(r)+'</td><td>'+kindTag(r.category)+'</td><td>'+esc(r.mission??'(menu)')+'</td><td class="n">'+esc(r.rating??'')+'</td><td>'+esc(r.snippet)+'</td><td>'+(r.shot?'<span class="tag">picture</span>':'')+(r.replay?'<span class="tag">replay</span>':'')+(r.dev?'<span class="tag">dev</span>':'')+'</td><td class="status">'+esc(r.status)+(r.issue?' #'+esc(r.issue):'')+'</td></tr>';
}
function options(el,first,values,cur,labels){el.innerHTML='<option value="">'+esc(first)+'</option>'+values.map((v,i)=>'<option value="'+esc(v)+'"'+(v===cur?' selected':'')+'>'+esc(labels?labels[i]:v)+'</option>').join('')}
function kvRow(k,v){return '<tr><th>'+esc(k)+'</th><td>'+v+'</td></tr>'}
function ctxValue(v){
  if(Array.isArray(v)&&v.every((x)=>typeof x==='string'))return v.map(esc).join('<br>')||'<span class="muted">none</span>';
  if(Array.isArray(v)&&v.length>0&&v.every((x)=>typeof x==='number'))return esc(v.join(' × '));
  if(v!==null&&typeof v==='object')return '<span class="mono">'+esc(JSON.stringify(v))+'</span>';
  return esc(v);
}
function contextRows(d){
  const rows=[
    kvRow('Mission',esc(d.mission??'(menu)')+(d.tick!=null?' · '+esc(clock(d.tick))+' on the clock (tick '+esc(d.tick)+')':'')+' · from '+esc(d.source)),
    kvRow('Build',esc(d.build)+(d.commit?' · commit '+esc(d.commit):'')),
    kvRow('Sent by',esc(d.who)+(d.player?' · player '+esc(d.player)+'…':'')+(d.session?' · session '+esc(d.session)+'… · <a href="#fb-timeline">timeline</a>':' · no session (opted out)')),
  ];
  if(d.contact)rows.push(kvRow('Contact',esc(d.contact)));
  if(d.replay)rows.push(kvRow('Replay',d.replay.missing?'<span class="muted">object missing from storage</span>':esc(d.replay.commands??'?')+' commands · '+esc((d.replay.bytes/1024).toFixed(1))+' KB'+(d.replay.hash?' · state hash '+esc(d.replay.hash):'')+(d.replay.tick!=null?' at tick '+esc(d.replay.tick):'')));
  for(const [k,v] of Object.entries(d.context))rows.push(kvRow(k,ctxValue(v)));
  return rows.join('');
}
function timelineRow(e){return '<tr><td>'+when(e.t)+'</td><td>'+esc(e.type)+'</td><td>'+esc(e.mission??'')+'</td><td>'+esc(e.result??'')+'</td></tr>'}
function detailHtml(d){
  const can=(s)=>d.transitions.includes(s);
  const acts=[];
  if(can('filed')||d.status==='filed')acts.push('<button class="primary" data-act="file">File as GitHub issue</button>');
  if(can('triaged'))acts.push('<button data-act="triage">Mark triaged</button>');
  if(can('dismissed'))acts.push('<button data-act="dismiss">Dismiss</button>');
  if(can('new'))acts.push('<button data-act="reopen">Reopen as new</button>');
  if(d.replay)acts.push('<a href="/stats/api/feedback/'+esc(d.id)+'/replay" download>Download replay</a>');
  if(d.shot)acts.push('<a href="/stats/api/feedback/'+esc(d.id)+'/shot?download=1" download>Download picture</a>');
  acts.push('<button data-act="delete">Delete</button>');
  return '<div><h3>'+esc(d.ref)+' · '+esc(d.category==='rating'?'rating '+d.rating+'/5':d.category)+' · '+esc(d.who)+' · '+when(d.receivedAt)+' · <span class="status">'+esc(d.status)+(d.issueNumber?' #'+esc(d.issueNumber):'')+'</span></h3>'
    +(d.text?'<p class="note">'+esc(d.text)+'</p>':'<p class="muted">No note: a rating only.</p>')
    +(d.shot?'<img class="shot" alt="What the player saw" src="/stats/api/feedback/'+esc(d.id)+'/shot">':'')
    +'<div class="actions">'+acts.join('')+'</div>'
    +'<div class="actions"><input id="fb-issue-no" type="number" min="1" placeholder="Filed as issue #" aria-label="Filed as issue number" value="'+esc(d.issueNumber??'')+'">'
    +'<input id="fb-note" maxlength="2000" placeholder="Triage note (private)" aria-label="Triage note (private)" value="'+esc(d.note??'')+'" style="flex:1"></div>'
    +'<p class="muted">File opens github.com/ilan-pinto/roaring-lions/issues/new with this title and body filled in. You read and edit it there; nothing is posted until you press Submit. The tester\\'s name and contact never go into the issue.'+(d.issue.truncated?' The note is cut to fit the link.':'')+'</p>'
    +'<pre class="issue">'+esc(d.issue.title)+'\\n\\n'+esc(d.issue.body)+'</pre></div>'
    +'<div><table class="kv">'+contextRows(d)+'</table>'
    +'<h3 id="fb-timeline">Session timeline</h3>'
    +(d.timeline.length?'<div class="wrap"><table><tr><th>When (UTC)</th><th>Event</th><th>Mission</th><th>Result</th></tr>'+d.timeline.map(timelineRow).join('')+'</table></div>':'<p class="muted">No session id was sent with this note, so there is nothing to join.</p>')
    +'</div>';
}
function paintSwitch(open){
  $('fb-switch').innerHTML=open
    ?'<span>Feedback is <b>open</b> to every player.</span> <button id="fb-toggle" data-open="0">Close feedback</button>'
    :'<span>Feedback is <b>closed</b>: the game hides its entry and the endpoint answers 410.</span> <button id="fb-toggle" data-open="1">Open feedback</button>';
}
async function loadList(){
  const p=new URLSearchParams();
  for(const k of ['status','tester','mission','kind'])if(filt[k])p.set(k,filt[k]);
  const j=await api('?'+p);
  $('fb-new').textContent=j.counts.new?j.counts.new+' new':'';
  paintSwitch(j.open);
  $('fb-tabs').innerHTML=STATUSES.map((s)=>'<button class="tab" data-status="'+s+'" aria-pressed="'+(filt.status===s)+'">'+esc(s[0].toUpperCase()+s.slice(1))+' '+esc(j.counts[s])+'</button>').join('');
  options($('fb-tester'),'Any tester',[ANON,...j.testers],filt.tester,['anonymous',...j.testers]);
  options($('fb-mission'),'Any mission',[NOMISSION,...j.missions],filt.mission,['(menu)',...j.missions]);
  options($('fb-kind'),'Any kind',j.kinds,filt.kind);
  $('fb-list').innerHTML='<tr><th>Ref</th><th>When (UTC)</th><th>Tester</th><th>Kind</th><th>Mission</th><th>Rating</th><th>Note</th><th>With</th><th>Status</th></tr>'+(j.rows.length?j.rows.map(listRow).join(''):'<tr><td colspan="9" class="muted">Nothing here.</td></tr>');
}
async function loadDetail(id){
  openId=id;
  const el=$('fb-detail');
  if(id===null){el.hidden=true;el.innerHTML='';return}
  try{const d=await api('/'+id);el.innerHTML=detailHtml(d);el.hidden=false;el.dataset.url=d.issue.url}
  catch(e){el.hidden=false;el.innerHTML='<p class="muted">'+esc(e.message)+'</p>'}
}
const idFromPath=()=>{const m=/^\\/stats\\/feedback\\/(\\d+)$/.exec(location.pathname);return m?Number(m[1]):null};
async function refresh(){say('');await loadList().catch((e)=>say('Could not load the list: '+e.message));await loadDetail(idFromPath())}
function go(id){history.pushState(null,'',id===null?'/stats/feedback':'/stats/feedback/'+id);refresh()}
async function act(a){
  const id=openId;if(id===null)return;
  try{
    if(a==='delete'){if(!confirm('Delete this note, its picture and its replay for good?'))return;await post('/'+id,{action:'delete'});go(null);return}
    if(a==='file'){window.open($('fb-detail').dataset.url,'_blank','noopener');const n=Number($('fb-issue-no').value);await post('/'+id,n>0?{action:'file',issue:n}:{action:'file'})}
    else await post('/'+id,{action:a});
    await refresh();
  }catch(e){say('Not saved: '+e.message)}
}
$('fb-list').addEventListener('click',(e)=>{const tr=e.target.closest('tr[data-id]');if(tr)go(Number(tr.dataset.id))});
$('fb-tabs').addEventListener('click',(e)=>{const b=e.target.closest('button[data-status]');if(b){filt.status=b.dataset.status;loadList()}});
for(const k of ['tester','mission','kind'])$('fb-'+k).addEventListener('change',(e)=>{filt[k]=e.target.value;loadList()});
$('fb-detail').addEventListener('click',(e)=>{const b=e.target.closest('button[data-act]');if(b)act(b.dataset.act)});
$('fb-detail').addEventListener('change',async(e)=>{
  const id=openId;if(id===null)return;
  try{
    if(e.target.id==='fb-issue-no'){const n=Number(e.target.value);if(n>0){await post('/'+id,{action:'issue',issue:n});await refresh()}}
    if(e.target.id==='fb-note'){await post('/'+id,{action:'note',note:e.target.value});say('Note saved.')}
  }catch(err){say('Not saved: '+err.message)}
});
$('fb-switch').addEventListener('click',async(e)=>{
  const b=e.target.closest('#fb-toggle');if(!b)return;
  const open=b.dataset.open==='1';
  if(!open&&!confirm('Close feedback for every player? The game will hide its entry.'))return;
  try{await post('/switch',{open});await loadList()}catch(err){say('Not switched: '+err.message)}
});
addEventListener('popstate',refresh);
refresh();
</script></body></html>`;
