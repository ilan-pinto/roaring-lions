import palette from '../../../data/palette.json';

const ramp = (name: string, i: number): string =>
  (palette as { ramps: Record<string, { colors: string[] }> }).ramps[name].colors[i];

export const STATS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roaring Lions Stats</title>
<style>
@font-face{font-family:Barlow;src:url(/fonts/barlow-latin-400.woff2) format('woff2');font-weight:400}
@font-face{font-family:Barlow;src:url(/fonts/barlow-latin-600.woff2) format('woff2');font-weight:600}
@font-face{font-family:'Big Shoulders Display';src:url(/fonts/big-shoulders-display-latin.woff2) format('woff2');font-weight:100 900}
@font-face{font-family:'IBM Plex Mono';src:url(/fonts/ibm-plex-mono-latin-400.woff2) format('woff2')}
:root{--ground:${ramp('limestone', 0)};--surface:${ramp('limestone', 1)};--ink:${ramp('shadow', 0)};--muted:${ramp('gunmetal', 2)};
--rule:${ramp('gunmetal', 0)};--accent:${ramp('olive', 1)};--bad:${ramp('terracotta', 1)};--good:${ramp('scrub', 1)}}
*{box-sizing:border-box}body{margin:0;padding:0 16px 64px;background:var(--ground);color:var(--ink);font:16px/1.5 Barlow,Arial,sans-serif}
main{max-width:1080px;margin:0 auto}h1{font:800 48px/1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;margin:32px 0 8px}
h2{font:700 26px/1.1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;border-top:1px solid var(--rule);padding-top:14px;margin:40px 0 12px}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}select,button{font:inherit;padding:4px 8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.stat{background:var(--surface);border-top:3px solid var(--ink);padding:12px}.stat b{display:block;font:800 34px/1 'Big Shoulders Display',sans-serif}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule)}
th{font:600 12px 'IBM Plex Mono',monospace;text-transform:uppercase;color:var(--muted)}td.n{text-align:right;font-family:'IBM Plex Mono',monospace}
.bar{height:14px;background:var(--accent)}.drop{background:var(--bad)}.over{color:var(--bad)}.muted{color:var(--muted)}
</style></head><body><main>
<h1>Roaring Lions Stats</h1>
<p class="muted">Anonymous telemetry from the deployed game. Sandbox traffic is excluded.</p>
<div class="controls">
<select id="range"><option value="7d">Last 7 days</option><option value="30d" selected>Last 30 days</option><option value="all">All time</option></select>
<select id="who"><option value="all">Everyone</option><option value="testers">Testers only</option></select>
<select id="tester"><option value="">Any tester</option></select>
</div>
<div class="stats" id="summary"></div>
<h2>Players per day</h2><div class="wrap"><table id="perday"></table></div>
<h2>Campaign funnel</h2><div class="wrap"><table id="funnel"></table></div>
<h2>Tutorial funnel</h2><div class="wrap"><table id="tutorial"></table></div>
<h2>Missions</h2><div class="wrap"><table id="missions"></table></div>
<h2>Testers</h2><div class="wrap"><table id="testers"></table></div>
<h2 id="tl-title" hidden>Timeline</h2><div class="wrap"><table id="timeline"></table></div>
</main><script>
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(n,d=1)=>n==null?'—':Number(n).toFixed(d);
const qs=()=>{const p=new URLSearchParams({range:$('range').value,who:$('who').value});if($('tester').value)p.set('tester',$('tester').value);return p};
const get=(path,p=qs())=>fetch('/stats/api/'+path+'?'+p).then((r)=>r.json());
const table=(el,head,rows)=>{el.innerHTML='<tr>'+head.map((h)=>'<th>'+h+'</th>').join('')+'</tr>'+rows.join('')};
async function load(){
  const [s,days,fun,mis,tes]=await Promise.all([get('summary'),get('per-day'),get('funnel'),get('missions'),get('testers')]);
  $('summary').innerHTML=[['Players',s.players,0],['Sessions',s.sessions,0],['Hours played',s.hoursPlayed,1],['Median min / player',s.medianMinutesPerPlayer,0],['Came back on day 2',s.returnedDay2,0]]
    .map(([l,v,d])=>'<div class="stat"><b>'+fmt(v,d)+'</b>'+l+'</div>').join('');
  const maxDay=Math.max(1,...days.map((d)=>d.new+d.returning));
  table($('perday'),['Day','New','Returning',''],days.map((d)=>'<tr><td>'+esc(d.day)+'</td><td class="n">'+d.new+'</td><td class="n">'+d.returning+'</td><td style="width:40%"><div class="bar" style="width:'+(100*(d.new+d.returning)/maxDay)+'%"></div></td></tr>'));
  const top=Math.max(1,fun.campaign[0]?.started||0);let worst=-1,worstAt=-1;
  fun.campaign.forEach((r,i)=>{if(i>0){const drop=fun.campaign[i-1].started-r.started;if(drop>worst){worst=drop;worstAt=i}}});
  table($('funnel'),['Mission','Started','Won','Reached'],fun.campaign.map((r,i)=>'<tr><td>'+esc(r.mission)+'</td><td class="n">'+r.started+'</td><td class="n">'+r.won+'</td><td style="width:35%"><div class="bar'+(i===worstAt?' drop':'')+'" style="width:'+(100*r.started/top)+'%"></div></td></tr>'));
  const tTop=Math.max(1,fun.tutorial[0]?.players||0);
  table($('tutorial'),['Step','Players',''],fun.tutorial.map((r)=>'<tr><td>'+(r.step+1)+'</td><td class="n">'+r.players+'</td><td style="width:50%"><div class="bar" style="width:'+(100*r.players/tTop)+'%"></div></td></tr>'));
  table($('missions'),['Mission','Attempts','Win %','Median min','Target','Top loss cause','Mean ROE','Most-failed objective'],mis.map((m)=>'<tr><td>'+esc(m.mission)+'</td><td class="n">'+m.attempts+'</td><td class="n">'+(m.winRate==null?'—':Math.round(100*m.winRate))+'</td><td class="n'+(m.medianWinMinutes!=null&&m.targetMinutes!=null&&m.medianWinMinutes>m.targetMinutes?' over':'')+'">'+fmt(m.medianWinMinutes)+'</td><td class="n">'+fmt(m.targetMinutes,0)+'</td><td>'+esc(m.topCause??'—')+'</td><td class="n">'+fmt(m.meanRoe,0)+'</td><td>'+esc(m.mostFailedObjective??'—')+'</td></tr>'));
  table($('testers'),['Tester','Missions won','Last won','Hours','Last seen'],tes.map((t)=>'<tr><td><button data-t="'+esc(t.tester)+'">'+esc(t.tester)+'</button></td><td class="n">'+t.missionsWon+'</td><td>'+esc(t.lastWon??'—')+'</td><td class="n">'+fmt(t.hours)+'</td><td>'+new Date(t.lastSeen).toISOString().slice(0,16).replace('T',' ')+'</td></tr>'));
  const sel=$('tester'),cur=sel.value;sel.innerHTML='<option value="">Any tester</option>'+tes.map((t)=>'<option'+(t.tester===cur?' selected':'')+'>'+esc(t.tester)+'</option>').join('');
}
async function showTimeline(name){
  const rows=await get('timeline',new URLSearchParams({tester:name}));
  $('tl-title').hidden=false;$('tl-title').textContent='Timeline: '+name;
  table($('timeline'),['When','Event','Mission','Result','Minutes'],rows.map((r)=>'<tr><td>'+new Date(r.t).toISOString().slice(0,16).replace('T',' ')+'</td><td>'+esc(r.type)+'</td><td>'+esc(r.mission??'')+'</td><td>'+esc(r.result??'')+'</td><td class="n">'+(r.tick==null?'':fmt(r.tick/1200))+'</td></tr>'));
}
$('testers').addEventListener('click',(e)=>{const b=e.target.closest('button');if(b)showTimeline(b.dataset.t)});
for(const id of ['range','who','tester'])$(id).addEventListener('change',load);
load();
</script></body></html>`;
