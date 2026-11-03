/**
 * The DEV-only `/arena` screen (GH-954 W2): set up an AI-vs-AI run and start it, then go and watch it. It talks to
 * `pnpm arena --serve` (`tools/src/net/arena-serve.ts`, `arena-control.ts`) and to nothing else. This module is
 * reached only by a dynamic `import()` inside `import.meta.env.DEV` in `main.ts`, so a production build has no route,
 * API path, key header or setup module (`tools/src/net/arena-build.test.ts` builds the app and pins that).
 *
 * The optional private API token (the lead's amendment of D-W6): a `type=password`, `autocomplete=off` field. Its
 * value is read once, when Start is pressed, into the body of that one POST; the field is emptied as soon as the
 * server has taken the run. Nothing here keeps it in a variable, storage, a URL, a log or the DOM after that, and
 * leaving the screen empties it too (the disposer). The server holds it in memory for that run only.
 *
 * Every string the screen shows goes through `t()`. Map and player names are data (the catalogue's and the presets
 * file's own words). The disposer removes the poll, aborts what is in flight and empties the host.
 */
import { matchCapTicks, matchupAllowed, MATCHUPS, type Matchup } from '@lions/net';
import { t } from '../i18n/t';
import { fetchPlayers, fetchStatus, SetupRefused, startRun, stopRun, type PlayerRow, type StartRequest, type StatusView, type UsageView } from '../net/arena-setup-api';
import type { Disposer } from '../shell/router';

export interface ArenaSetupDeps {
  /** The run's key from the URL fragment; null: the page was not opened from the printed link. */
  key: string | null;
  fetch: typeof fetch;
  /** The maps a versus room is offered on (`versusMaps()`), in catalogue order. */
  maps: readonly { id: string; label: string }[];
  /** Go to the watch screen. */
  watch(): void;
  /** For a spec. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export const STATUS_MS = 1000;
export const SETUP_DEFAULTS = { seeds: 1, pace: 60, roundWallMs: 120_000, capTicks: 12_000 } as const;

const MATCHUP_KEY: Readonly<Record<Matchup, string>> = {
  mirror: 'arena.setup.matchup.mirror',
  kdf: 'arena.setup.matchup.kdf',
  sarim: 'arena.setup.matchup.sarim',
};

/** The message key for a server error code. An unknown code is the general one. */
export function errorKey(status: number, code: string | null): string {
  if (status === 409) return 'arena.setup.err.busy';
  if (status === 0) return 'arena.setup.err.noServer';
  if (status === 403 || status === 421) return 'arena.setup.err.refused';
  switch (code) {
    case 'bad_player': return 'arena.setup.err.player';
    case 'bad_judge': return 'arena.setup.err.judge';
    case 'bad_map': case 'map_refused': return 'arena.setup.err.map';
    case 'bad_matchup': return 'arena.setup.err.matchup';
    case 'bad_number': case 'bad_args': return 'arena.setup.err.number';
    case 'bad_token': return 'arena.setup.err.token';
    default: return 'arena.setup.err.bad';
  }
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en');
const fmtOpt = (n: number | null): string => (n === null ? t('arena.setup.unknown') : fmtInt(n));
const fmtCost = (n: number | null): string => (n === null ? t('arena.setup.unknown') : t('arena.setup.cost', { usd: n.toFixed(4) }));

/** One game's verdict in words. The winner's name is the player's own. */
export function resultText(g: { outcome: string; by: string; players: readonly [string, string] }): string {
  if (g.outcome === 'seat0' || g.outcome === 'seat1') return t('arena.setup.result.won', { name: g.players[g.outcome === 'seat0' ? 0 : 1], by: g.by });
  return g.outcome === 'draw' ? t('arena.setup.result.draw', { by: g.by }) : t('arena.setup.result.void', { by: g.by });
}

/** Both players' spend in one game, as one cell each; null: that player said nothing. */
export function usageCells(u: UsageView | null): [string, string, string] {
  if (u === null) return [t('arena.setup.unknown'), t('arena.setup.unknown'), t('arena.setup.unknown')];
  return [
    t('arena.setup.tokens', { input: fmtInt(u.inputTokens), output: fmtInt(u.outputTokens) }),
    t('arena.setup.cache', { written: fmtOpt(u.cacheCreationInputTokens), read: fmtOpt(u.cacheReadInputTokens) }),
    fmtCost(u.costUsd),
  ];
}

let nextId = 0;

export function showArenaSetup(host: HTMLElement, deps: ArenaSetupDeps): Disposer {
  const setIv = deps.setInterval ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearIv = deps.clearInterval ?? ((h: unknown): void => { clearInterval(h as ReturnType<typeof setInterval>); });
  const ac = new AbortController();
  let disposed = false;
  let timer: unknown = null;
  let busy = false;
  /** The players have been read: before that there is nothing to start. */
  let loaded = false;
  let players: PlayerRow[] = [];
  let status: StatusView | null = null;

  const root = document.createElement('section');
  root.className = 'rl-arena-setup';
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const title = el('h1', 'rl-arena-setup__title', t('arena.setup.title'));
  const blurb = el('p', 'rl-arena-setup__blurb', t('arena.setup.blurb'));
  const message = el('p', 'rl-arena-setup__message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const say = (text: string, bad = false): void => {
    message.textContent = text;
    message.classList.toggle('rl-bad', bad);
  };
  root.append(title, blurb, message);
  host.appendChild(root);

  if (deps.key === null) {
    say(t('arena.setup.noKey'), true);
    return () => { if (!disposed) { disposed = true; host.replaceChildren(); } };
  }
  const key = deps.key;
  const api = { fetch: deps.fetch, key, signal: ac.signal };

  // --- the form ----------------------------------------------------------------------------------------------
  const grid = el('div', 'rl-arena-setup__grid');
  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement => {
    const wrap = el('div', 'rl-arena-setup__field');
    const id = `rl-arena-setup-${nextId++}`;
    control.id = id;
    const lab = el('label', 'rl-arena-setup__label', label);
    lab.htmlFor = id;
    wrap.append(lab, control);
    if (hint !== undefined) {
      const h = el('span', 'rl-arena-setup__hint', hint);
      control.setAttribute('aria-describedby', `${id}-hint`);
      h.id = `${id}-hint`;
      wrap.appendChild(h);
    }
    return wrap;
  };
  const select = (): HTMLSelectElement => el('select', 'rl-arena-setup__control');
  const option = (value: string, text: string): HTMLOptionElement => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  const number = (min: number, max: number, value: number, step = 1): HTMLInputElement => {
    const i = el('input', 'rl-arena-setup__control');
    i.type = 'number';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(value);
    return i;
  };

  const mapSel = select();
  for (const m of deps.maps) mapSel.appendChild(option(m.id, m.label));
  if (deps.maps.some((m) => m.id === 'tel_marum')) mapSel.value = 'tel_marum';
  const matchupSel = select();
  const aSel = select();
  const bSel = select();
  const judgeSel = select();
  const seeds = number(1, 200, SETUP_DEFAULTS.seeds);
  const pace = number(20, 1200, SETUP_DEFAULTS.pace);
  const wall = number(1000, 600_000, SETUP_DEFAULTS.roundWallMs, 1000);
  const cap = number(1, matchCapTicks(mapSel.value), SETUP_DEFAULTS.capTicks);
  // The private API token. Never a hidden field, never remembered: see the file header.
  const token = el('input', 'rl-arena-setup__control rl-arena-setup__token');
  token.type = 'password';
  token.autocomplete = 'off';
  token.spellcheck = false;
  token.maxLength = 512;
  token.setAttribute('autocapitalize', 'off');

  const fillMatchups = (): void => {
    const keep = matchupSel.value;
    matchupSel.replaceChildren();
    for (const m of MATCHUPS) if (matchupAllowed(m, mapSel.value)) matchupSel.appendChild(option(m, t(MATCHUP_KEY[m])));
    if ([...matchupSel.options].some((o) => o.value === keep)) matchupSel.value = keep;
    cap.max = String(matchCapTicks(mapSel.value));
    if (Number(cap.value) > matchCapTicks(mapSel.value)) cap.value = String(matchCapTicks(mapSel.value));
  };
  mapSel.addEventListener('change', fillMatchups);
  fillMatchups();

  const fillPlayers = (): void => {
    const keepA = aSel.value;
    const keepB = bSel.value;
    const keepJ = judgeSel.value;
    for (const s of [aSel, bSel, judgeSel]) s.replaceChildren();
    judgeSel.appendChild(option('', t('arena.setup.judge.none')));
    for (const p of players) {
      if (p.kind !== 'judge') { aSel.appendChild(option(p.id, p.label)); bSel.appendChild(option(p.id, p.label)); }
      if (p.kind === 'judge' || p.kind === 'model_judge') judgeSel.appendChild(option(p.id, p.label));
    }
    const has = (s: HTMLSelectElement, v: string): boolean => [...s.options].some((o) => o.value === v);
    aSel.value = has(aSel, keepA) ? keepA : has(aSel, 'rush') ? 'rush' : (aSel.options[0]?.value ?? '');
    bSel.value = has(bSel, keepB) ? keepB : has(bSel, 'passive') ? 'passive' : (bSel.options[0]?.value ?? '');
    judgeSel.value = has(judgeSel, keepJ) ? keepJ : '';
  };

  grid.append(
    field(t('arena.setup.map'), mapSel),
    field(t('arena.setup.matchup'), matchupSel),
    field(t('arena.setup.playerA'), aSel),
    field(t('arena.setup.playerB'), bSel),
    field(t('arena.setup.seeds'), seeds, t('arena.setup.seeds.hint')),
    field(t('arena.setup.pace'), pace, t('arena.setup.pace.hint')),
    field(t('arena.setup.wall'), wall, t('arena.setup.wall.hint')),
    field(t('arena.setup.cap'), cap, t('arena.setup.cap.hint')),
    field(t('arena.setup.judge'), judgeSel, t('arena.setup.judge.hint')),
    field(t('arena.setup.token'), token, t('arena.setup.token.hint')),
  );

  const actions = el('div', 'rl-arena-setup__actions');
  const startBtn = el('button', 'rl-arena-setup__start', t('arena.setup.start'));
  startBtn.type = 'button';
  const stopBtn = el('button', 'rl-arena-setup__stop', t('arena.setup.stop'));
  stopBtn.type = 'button';
  const watchBtn = el('button', 'rl-arena-setup__watch', t('arena.setup.watch'));
  watchBtn.type = 'button';
  actions.append(startBtn, watchBtn, stopBtn);
  root.append(grid, actions);

  // --- the status ----------------------------------------------------------------------------------------------
  const panel = el('div', 'rl-arena-setup__status');
  panel.hidden = true;
  const stateLine = el('p', 'rl-arena-setup__state');
  const runLine = el('p', 'rl-arena-setup__run');
  const errorLine = el('p', 'rl-arena-setup__error rl-bad');
  const table = el('table', 'rl-arena-setup__table');
  const totalsTable = el('table', 'rl-arena-setup__table rl-arena-setup__totals');
  panel.append(stateLine, runLine, errorLine, table, totalsTable);
  root.appendChild(panel);

  const head = (cells: string[]): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    for (const c of cells) tr.appendChild(el('th', '', c));
    return tr;
  };
  const row = (cells: string[]): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    for (const c of cells) tr.appendChild(el('td', '', c));
    return tr;
  };

  const paint = (): void => {
    const s = status;
    const running = s !== null && (s.state === 'running' || s.state === 'stopping');
    startBtn.disabled = !loaded || busy || running;
    stopBtn.disabled = busy || !running || s?.state === 'stopping';
    watchBtn.hidden = !running;
    for (const c of [mapSel, matchupSel, aSel, bSel, judgeSel, seeds, pace, wall, cap, token]) c.disabled = running;
    panel.hidden = s === null || s.state === 'idle';
    if (s === null || s.state === 'idle') return;
    stateLine.textContent = t('arena.setup.state', { state: s.state });
    runLine.textContent = s.run === null ? '' : t('arena.setup.run', { a: s.run.a, b: s.run.b, map: s.run.map, seeds: s.run.seeds }) + (s.game === null ? '' : ` ${t('arena.setup.game', { n: s.game.n, of: s.game.of })}`);
    errorLine.textContent = s.error ?? '';
    errorLine.hidden = s.error === null;
    table.replaceChildren();
    if (s.games.length > 0) {
      table.appendChild(head([t('arena.setup.col.game'), t('arena.setup.col.players'), t('arena.setup.col.result'), t('arena.setup.col.tokens'), t('arena.setup.col.cache'), t('arena.setup.col.cost')]));
      for (const g of s.games) {
        // One row per player: what each said it spent in that game. A scripted player says nothing.
        for (const seat of [0, 1] as const) {
          const [tok, cache, cost] = usageCells(g.usage[seat]);
          table.appendChild(row([seat === 0 ? String(g.n) : '', g.players[seat], seat === 0 ? resultText(g) : '', tok, cache, cost]));
        }
      }
    }
    totalsTable.replaceChildren();
    const totals = s.totals;
    if (totals !== null) {
      totalsTable.appendChild(head([t('arena.setup.col.runTotal'), t('arena.setup.col.tokens'), t('arena.setup.col.cache'), t('arena.setup.col.cost')]));
      for (const p of totals.players) totalsTable.appendChild(row([p.player, ...usageCells(p.usage)]));
      if (totals.judge !== null) totalsTable.appendChild(row([t('arena.setup.judgeRow'), ...usageCells(totals.judge)]));
      if (totals.all !== null) totalsTable.appendChild(row([t('arena.setup.allRow'), ...usageCells(totals.all)]));
    }
  };

  const refused = (err: unknown): void => {
    if (err instanceof SetupRefused) say(t(errorKey(err.status, err.code)), true);
    else say(t('arena.setup.err.noServer'), true);
  };

  const poll = async (): Promise<void> => {
    if (disposed) return;
    try {
      const s = await fetchStatus(api);
      if (disposed) return;
      status = s;
      paint();
    } catch (err) {
      if (!disposed && !(err instanceof DOMException)) refused(err);
    }
  };

  startBtn.addEventListener('click', () => {
    if (disposed || busy) return;
    const n = (i: HTMLInputElement): number => (/^\d+$/.test(i.value.trim()) ? Number(i.value.trim()) : Number.NaN);
    const body: StartRequest = {
      a: aSel.value, b: bSel.value, map: mapSel.value, matchup: matchupSel.value as Matchup,
      seeds: n(seeds), pace: n(pace), roundWallMs: n(wall), capTicks: n(cap),
      ...(judgeSel.value === '' ? {} : { judge: judgeSel.value }),
      // Read here, once, for this one request. An empty field sends no token at all.
      ...(token.value === '' ? {} : { token: token.value }),
    };
    if (![body.seeds, body.pace, body.roundWallMs, body.capTicks].every(Number.isInteger)) { say(t('arena.setup.err.number'), true); return; }
    busy = true;
    say(t('arena.setup.starting'));
    paint();
    startRun(api, body).then(() => {
      // The server has the run (and its token, if any, in its own memory): the field is emptied at once.
      token.value = '';
      busy = false;
      if (!disposed) deps.watch();
    }, (err: unknown) => {
      busy = false;
      if (disposed) return;
      refused(err);
      void poll();
    });
  });
  stopBtn.addEventListener('click', () => {
    if (disposed || busy) return;
    busy = true;
    say(t('arena.setup.stopping'));
    paint();
    stopRun(api).then(() => { busy = false; say(''); void poll(); }, (err: unknown) => { busy = false; if (!disposed) { refused(err); void poll(); } });
  });
  watchBtn.addEventListener('click', () => { if (!disposed) deps.watch(); });

  // --- first load ----------------------------------------------------------------------------------------------
  say(t('arena.setup.loading'));
  startBtn.disabled = true;
  fetchPlayers(api).then((rows) => {
    if (disposed) return;
    players = rows;
    fillPlayers();
    loaded = true;
    say('');
    paint();
    void poll();
  }, (err: unknown) => {
    if (disposed || (err instanceof DOMException)) return;
    refused(err);
  });
  timer = setIv(() => { void poll(); }, STATUS_MS);

  return () => {
    if (disposed) return;
    disposed = true;
    clearIv(timer);
    ac.abort();
    // The token is never left in a page that is gone.
    token.value = '';
    host.replaceChildren();
  };
}
