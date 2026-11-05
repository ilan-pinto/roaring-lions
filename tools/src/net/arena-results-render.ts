/**
 * One render of the public arena results (GH-954 public-arena P2): the local preview the lead reads before he merges
 * (D-P2), and the module the Worker page (P3) will call, so what he reads is what is served. Pure: a document in, a
 * script-free HTML string out, every value escaped. Rows are alphabetical, as the document gives them; nothing is
 * ordered by score and no row is called first, best or top.
 */
import type { ArenaResults, Section } from './arena-publish';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string | number): string => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const pct = (v: number | null): string => (v === null ? 'too few games' : v.toFixed(3));
const cells = (c: readonly (string | number)[], tag = 'td'): string => `<tr>${c.map((x) => `<${tag}>${esc(x)}</${tag}>`).join('')}</tr>`;
const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]): string =>
  rows.length === 0 ? '' : `<table><thead>${cells(head, 'th')}</thead><tbody>${rows.map((r) => cells(r)).join('')}</tbody></table>`;

const VERDICT: Record<string, string> = { a_ahead: 'ahead', b_ahead: 'behind', not_distinguishable: 'not distinguishable at this n', too_few: 'too few games' };

function sectionHtml(s: Section, i: number): string {
  const label = (id: string): string => s.models.find((m) => m.id === id)?.label ?? id;
  const k = s.key;
  const out: string[] = [];
  out.push(`<section><h2>Section ${i + 1}: ${esc(k.mode)}, pace ${esc(k.pace)}, round ${esc(k.roundWallMs)} ms, cap ${esc(k.capTicks)}</h2>`);
  out.push(`<p>Prompt digest ${esc(k.promptDigest.slice(0, 12))}. Build ${esc(s.builds.join(', '))}${s.mixedBuilds ? ' (mixed builds)' : ''}. ${esc(s.games)} game(s), ${esc(s.voids)} void.</p>`);
  out.push('<h3>Models</h3>');
  out.push(table(['model', 'games', 'won', 'drawn', 'lost', 'void', 'score', '95% interval', 'seat 0', 'seat 1', 'as KDF', 'as Sarim'],
    s.models.map((m) => [m.label, m.games, m.wins, m.draws, m.losses, m.voids, pct(m.score), m.interval === null ? 'too few games' : `${m.interval[0].toFixed(3)} to ${m.interval[1].toFixed(3)}`, pct(m.bySeat[0]), pct(m.bySeat[1]), pct(m.byFaction.kdf), pct(m.byFaction.sarim)])));
  const pinned = s.models.filter((m) => m.modelId !== null);
  if (pinned.length > 0) out.push(`<p class="foot">Pinned model ids: ${pinned.map((m) => `${esc(m.label)} is ${esc(m.modelId ?? '')}`).join('; ')}.</p>`);
  out.push('<h3>Head to head</h3>');
  out.push(table(['pair', 'n', 'first won', 'drawn', 'second won', 'first score', 'p', 'sides swapped', 'reading'],
    s.headToHead.map((p) => [`${label(p.a)} / ${label(p.b)}`, p.n, p.aWins, p.draws, p.bWins, pct(p.aScore), p.p === null ? 'too few games' : p.p.toFixed(4), p.sidesSwapped ? 'yes' : 'no', VERDICT[p.verdict]])));
  out.push('<h3>By map</h3>', table(['map', 'model', 'n', 'score'], s.byMap.map((c) => [c.value, label(c.model), c.n, pct(c.score)])));
  out.push('<h3>By matchup</h3>', table(['matchup', 'model', 'n', 'score'], s.byMatchup.map((c) => [c.value, label(c.model), c.n, pct(c.score)])));
  out.push('<h3>How games ended</h3>', table(['ended by', 'in words', 'games'], s.endings.map((e) => [e.by, e.words, e.count])));
  if (s.rubric.length > 0) {
    const ids = Object.keys(s.rubric[0].criteria);
    out.push('<h3>Judge scores</h3>');
    out.push(table(['model', 'judge', 'self-judged', 'judged', 'of', 'overall', ...ids],
      s.rubric.map((r) => [label(r.model), r.judge ?? 'not named', r.selfJudged === null ? 'unknown' : r.selfJudged ? 'self-judged' : 'no', r.judgedK, r.ofN, r.overall === null ? 'too few games' : r.overall.toFixed(2), ...ids.map((c) => (r.criteria[c] === null ? '-' : (r.criteria[c] as number).toFixed(2)))])));
  }
  out.push('<h3>Games</h3>');
  out.push(table(['run', 'seed', 'map', 'matchup', 'seat 0', 'seat 1', 'winner', 'by', 'ticks', 'build'],
    s.gameList.map((g) => [g.run, g.seed, g.map, g.matchup, label(g.seat0), label(g.seat1), g.winner === 'draw' || g.winner === 'void' ? g.winner : label(g.winner), g.by, g.ticks, g.build])));
  out.push('</section>');
  return out.join('\n');
}

const STYLE = 'body{font:14px/1.5 system-ui,sans-serif;margin:1rem auto;max-width:72rem;padding:0 1rem;color:#222;background:#fff}table{border-collapse:collapse;margin:.5rem 0 1rem;display:block;overflow-x:auto}th,td{border:1px solid #bbb;padding:.2rem .5rem;text-align:left}.foot{font-size:12px;color:#555}';
const shell = (inner: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arena results</title>
<style>${STYLE}</style>
</head><body>
<h1>Arena results</h1>
${inner}
</body></html>
`;

/** The page before anything is published (the Worker serves it while data/arena/results.json does not exist). */
export function renderEmpty(): string {
  return shell('<p>No results published yet.</p>');
}

/** The whole page. No script, no external file, no link. */
export function renderPreview(doc: ArenaResults, runNames?: ReadonlyMap<string, string>): string {
  return shell(`<p>${esc(doc.note)}</p>
<p>Generated ${esc(doc.generated)}. Digest ${esc(doc.digest)}. ${esc(doc.withheld)} game(s) withheld.</p>
${runNames === undefined || runNames.size === 0 ? '' : `<h2>Runs (local only: the published file carries the short code)</h2>${table(['code', 'run'], [...runNames.entries()].sort().map(([h, n]) => [h, n]))}`}
${doc.sections.length === 0 ? '<p>No games to show.</p>' : doc.sections.map(sectionHtml).join('\n')}
<p class="foot">${esc(doc.disclaimer)}</p>`);
}
