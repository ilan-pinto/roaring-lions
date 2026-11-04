/**
 * The DEV-only `/arena/results` screen (GH-954 W3): the runs saved under the arena server's results directory, game by
 * game. For each game: the players (a preset's label, never its command line), the map and mode, the outcome and how
 * it ended, the judge's scores where there are any, what the models said they spent per game and per run, whether the
 * watcher's final state matched the referee's, and a "Replay" link to the recorded frames.
 *
 * It talks to `pnpm arena --serve` / `--watch` (`tools/src/net/arena-results.ts`) behind the server's Host, Origin and
 * key checks, and reaches no other host. This module is reached only by a dynamic `import()` inside
 * `import.meta.env.DEV` in `main.ts`, so a production build has none of it.
 *
 * Every string goes through `t()`. Player names, the map, the numbers and the judge's criterion names are data (the
 * presets file's and the rubric's own words). The disposer aborts the request and empties the host.
 */
import { t } from '../i18n/t';
import { fetchResults, ResultsRefused, type DigestBody, type GameBody, type JudgeBody, type ResultsBody, type RunBody } from '../net/arena-results-api';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { resultText, usageCells } from './arena-setup';

export interface ArenaResultsDeps {
  /** The run's key from the URL fragment; null: the page was not opened from the printed link. */
  key: string | null;
  fetch: typeof fetch;
  /** Open a game's replay: `file` is the name the list gave out. */
  replay(file: string): void;
  /** Back to the setup screen. */
  setup(): void;
}

const MATCHUP_KEY: Readonly<Record<string, string>> = {
  mirror: 'arena.setup.matchup.mirror',
  kdf: 'arena.setup.matchup.kdf',
  sarim: 'arena.setup.matchup.sarim',
};

const JUDGE_STATUS_KEY: Readonly<Record<JudgeBody['status'], string>> = {
  scored: 'arena.results.judge.scored',
  invalid: 'arena.results.judge.invalid',
  failed: 'arena.results.judge.failed',
  skipped: 'arena.results.judge.skipped',
};

const fmtCost = (n: number | null): string => (n === null ? t('arena.setup.unknown') : t('arena.setup.cost', { usd: n.toFixed(4) }));

/** The names to show for a game's two seats: an external player has no name to show. */
export function playerNames(g: Pick<GameBody, 'players'>): [string, string] {
  return [g.players[0] ?? t('arena.results.external'), g.players[1] ?? t('arena.results.external')];
}

/** What the watcher's digest says, in words. */
export function digestWords(d: DigestBody | null, buildMatches: boolean | null): string {
  if (d === null) return t('arena.results.digest.none');
  const base = d.agree === null ? t('arena.results.digest.noWatcher') : d.agree ? t('arena.results.digest.agree', { tick: d.referee.tick }) : t('arena.results.digest.differ', { tick: d.referee.tick });
  return buildMatches === false ? `${base} ${t('arena.results.otherBuild')}` : base;
}

/** The judge's overall scores by seat, `8 : 3`, or why there are none. */
export function judgeWords(j: JudgeBody | null): string {
  if (j === null) return t('arena.results.judge.none');
  if (j.status === 'scored' && j.scores !== undefined) return t('arena.results.judge.scores', { a: j.scores.overall[0], b: j.scores.overall[1] });
  return t(JUDGE_STATUS_KEY[j.status]);
}

export function showArenaResults(host: HTMLElement, deps: ArenaResultsDeps): Disposer {
  const ac = new AbortController();
  let disposed = false;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const root = el('section', 'rl-arena-setup rl-arena-results');
  const title = el('h1', 'rl-arena-setup__title', t('arena.results.title'));
  const blurb = el('p', 'rl-arena-setup__blurb', t('arena.results.blurb'));
  const message = el('p', 'rl-arena-setup__message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const actions = el('div', 'rl-arena-setup__actions');
  const setupBtn = el('button', 'rl-arena-setup__watch', t('arena.results.setup'));
  setupBtn.type = 'button';
  setupBtn.addEventListener('click', () => { if (!disposed) deps.setup(); });
  const refreshBtn = el('button', 'rl-arena-setup__watch', t('arena.results.refresh'));
  refreshBtn.type = 'button';
  actions.append(setupBtn, refreshBtn);
  const list = el('div', 'rl-arena-results__runs');
  root.append(title, blurb, message, actions, list);
  host.appendChild(root);
  const say = (text: string, bad = false): void => {
    message.textContent = text;
    message.classList.toggle('rl-bad', bad);
  };

  const row = (cells: (string | Node)[], head = false): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    for (const c of cells) {
      const cell = el(head ? 'th' : 'td', '');
      if (typeof c === 'string') cell.textContent = c; else cell.appendChild(c);
      tr.appendChild(cell);
    }
    return tr;
  };

  const judgeCell = (g: GameBody, body: ResultsBody): HTMLElement => {
    const j = g.judge;
    const wrap = el('span', 'rl-arena-results__judge');
    if (j === null || j.status !== 'scored' || j.scores === undefined) { wrap.textContent = judgeWords(j); return wrap; }
    const d = el('details', 'rl-arena-results__criteria');
    d.appendChild(el('summary', '', judgeWords(j)));
    const ul = el('ul', '');
    for (const c of body.criteria) {
      const s = j.scores.criteria[c.id];
      if (s !== undefined) ul.appendChild(el('li', '', t('arena.results.judge.criterion', { name: c.label, a: s[0], b: s[1] })));
    }
    d.appendChild(ul);
    wrap.appendChild(d);
    return wrap;
  };

  const replayCell = (g: GameBody): HTMLElement => {
    const file = g.file;
    if (file === null) return el('span', 'rl-arena-results__norecord', t('arena.results.noReplay'));
    const a = el('a', 'rl-arena-results__replay', t('arena.results.replay'));
    a.href = routes.arenaReplay(file);
    // A soft navigation: the key lives in this page's memory, not in the link, so a new tab would not have it.
    a.addEventListener('click', (ev) => {
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      if (!disposed) deps.replay(file);
    });
    return a;
  };

  const runBlock = (run: RunBody, body: ResultsBody): HTMLElement => {
    const block = el('section', 'rl-arena-results__run');
    block.appendChild(el('h2', 'rl-arena-results__runtitle', run.id));
    block.appendChild(el('p', 'rl-arena-results__runcost', t('arena.results.runCost', { cost: fmtCost(run.costUsd), games: run.games.length })));
    const table = el('table', 'rl-arena-setup__table');
    table.appendChild(row([t('arena.setup.col.game'), t('arena.setup.col.players'), t('arena.results.col.map'), t('arena.results.col.mode'), t('arena.setup.col.result'), t('arena.results.col.judge'), t('arena.setup.col.cost'), t('arena.results.col.digest'), ''], true));
    for (const g of run.games) {
      const names = playerNames(g);
      table.appendChild(row([
        String(g.n),
        t('arena.strip.players', { a: names[0], b: names[1] }),
        g.map,
        t(MATCHUP_KEY[g.matchup] ?? 'arena.setup.unknown'),
        resultText({ outcome: g.outcome, by: g.by, players: names }),
        judgeCell(g, body),
        fmtCost(g.costUsd),
        digestWords(g.digest, g.buildMatches),
        replayCell(g),
      ]));
    }
    block.appendChild(table);
    const totals = run.totals;
    if (totals.players.length > 0 || totals.judge !== null) {
      const tt = el('table', 'rl-arena-setup__table rl-arena-setup__totals');
      tt.appendChild(row([t('arena.setup.col.runTotal'), t('arena.setup.col.tokens'), t('arena.setup.col.cache'), t('arena.setup.col.cost')], true));
      for (const p of totals.players) tt.appendChild(row([p.player ?? t('arena.results.external'), ...usageCells(p.usage)]));
      if (totals.judge !== null) tt.appendChild(row([t('arena.setup.judgeRow'), ...usageCells(totals.judge)]));
      if (totals.all !== null) tt.appendChild(row([t('arena.setup.allRow'), ...usageCells(totals.all)]));
      block.appendChild(tt);
    }
    return block;
  };

  const refusedKey = (err: unknown): string => {
    if (err instanceof ResultsRefused && (err.status === 403 || err.status === 421)) return 'arena.results.err.refused';
    return 'arena.results.err.noServer';
  };

  const load = (): void => {
    if (disposed) return;
    say(t('arena.results.loading'));
    fetchResults({ fetch: deps.fetch, key: deps.key as string, signal: ac.signal }).then((body) => {
      if (disposed) return;
      list.replaceChildren();
      say(body.runs.length === 0 ? t('arena.results.empty') : '');
      for (const run of body.runs) list.appendChild(runBlock(run, body));
    }, (err: unknown) => {
      if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
      say(t(refusedKey(err)), true);
    });
  };
  refreshBtn.addEventListener('click', load);

  if (deps.key === null) refreshBtn.disabled = true; else load();
  if (deps.key === null) say(t('arena.results.noKey'), true);

  return () => {
    if (disposed) return;
    disposed = true;
    ac.abort();
    host.replaceChildren();
  };
}
