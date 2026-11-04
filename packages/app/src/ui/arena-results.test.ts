// @vitest-environment jsdom
// GH-954 W3: the DEV-only /arena/results screen, in jsdom with a stub fetch. Names, tokens and templates: none appear.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import { parseResults, type ResultsBody } from '../net/arena-results-api';
import { digestWords, judgeWords, playerNames, showArenaResults, type ArenaResultsDeps } from './arena-results';

afterEach(() => { setCatalogue('en', en); document.body.replaceChildren(); vi.useRealTimers(); });

const KEY = 'a-long-random-run-token';
const U = { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 3000, cacheReadInputTokens: 45000, costUsd: 0.25 };
const CRIT = ['fewer_deaths', 'wounded_care', 'force_preservation', 'tempo_initiative', 'adaptation'];
const game = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  n, file: `2026-11-04-x-vs-y-game${n}.frames.jsonl`, players: ['Claude Opus X', 'passive'], map: 'tel_marum', matchup: 'mirror', outcome: 'seat0', by: 'annihilation', ticks: 900,
  judge: { status: 'scored', scores: { overall: [8, 3], criteria: Object.fromEntries(CRIT.map((c) => [c, [7, 4]])) } },
  usage: [U, null], judgeUsage: { ...U, costUsd: 0.1 }, costUsd: 0.35,
  digest: { referee: { tick: 900, hash: -5 }, watcher: { tick: 900, hash: -5 }, agree: true }, buildMatches: true, ...over,
});
const BODY = {
  build: '0.1.0+abc', criteria: CRIT.map((id) => ({ id, label: `Criterion ${id}` })),
  runs: [{
    id: '2026-11-04-x-vs-y',
    games: [game(1), game(2, { players: [null, 'Claude Opus X'], outcome: 'draw', judge: null, usage: [null, U], costUsd: 0.25, digest: { referee: { tick: 900, hash: -5 }, watcher: { tick: 900, hash: 7 }, agree: false }, buildMatches: false }), game(3, { file: null, digest: null, buildMatches: null, judge: { status: 'failed' }, outcome: 'void', by: 'timeout' })],
    totals: { players: [{ player: 'Claude Opus X', usage: { ...U, costUsd: 0.5 } }], judge: { ...U, costUsd: 0.2 }, all: { ...U, costUsd: 0.7 } },
    costUsd: 0.7,
  }],
};

interface Rig { host: HTMLElement; deps: ArenaResultsDeps; calls: { url: string; headers: Record<string, string>; signal: AbortSignal | undefined }[]; replayed: string[]; setups: number }
function rig(body: unknown = BODY, o: Partial<ArenaResultsDeps> = {}, status = 200): Rig {
  const r = { calls: [], replayed: [], setups: 0 } as unknown as Rig;
  r.host = document.createElement('div');
  document.body.appendChild(r.host);
  r.deps = {
    key: KEY,
    fetch: (async (url: string, init?: RequestInit) => { r.calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, signal: init?.signal ?? undefined }); return Response.json(body, { status }); }) as unknown as typeof fetch,
    replay: (f) => { r.replayed.push(f); }, setup: () => { r.setups++; }, ...o,
  };
  return r;
}
const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise((res) => setTimeout(res, 0)); };
function chrome(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v) out.push(v); }
    if (el.hidden || el.closest('[hidden]')) continue;
    for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') out.push((n.textContent ?? '').trim());
  }
  return out;
}

describe('parseResults', () => {
  it('reads the server\'s body into named shapes, and drops what it does not name', () => {
    const p = parseResults({ ...BODY, extra: 1 }) as ResultsBody;
    expect(p.runs[0].games).toHaveLength(3);
    expect(p.runs[0].games[1].players).toEqual([null, 'Claude Opus X']);
    expect(p.runs[0].games[0].judge?.scores?.overall).toEqual([8, 3]);
    expect(p.runs[0].totals.all?.costUsd).toBe(0.7);
    expect(JSON.stringify(p)).not.toContain('extra');
  });
  it('refuses a body that is not that shape', () => {
    expect(parseResults(null)).toBeNull();
    expect(parseResults({ build: 'b', criteria: [], runs: [{ id: 'r', games: [{ n: 'x' }], totals: {} }] })).toBeNull();
    expect(parseResults({ ...BODY, runs: [{ ...BODY.runs[0], games: [game(1, { players: ['a', 3] })] }] })).toBeNull();
  });
});

describe('the list', () => {
  it('shows each game: players, map, mode, outcome and how it ended, judge, cost, the watcher digest and a Replay link', async () => {
    const r = rig();
    showArenaResults(r.host, r.deps);
    await settle();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe('/arena/api/results');
    expect(r.calls[0].headers['x-arena-token']).toBe(KEY);
    const rows = [...r.host.querySelectorAll('table')[0].querySelectorAll('tr')].slice(1).map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toHaveLength(3);
    expect(rows[0].filter((_, i) => i !== 5)).toEqual(['1', 'Claude Opus X vs passive', 'tel_marum', 'KDF against KDF', 'Claude Opus X won (annihilation)', '$0.3500', 'The watcher matches the referee (tick 900)', 'Replay']);
    expect(r.host.querySelector('details summary')?.textContent).toBe('8 : 3');
    // A player with no name to show is "an external player"; a draw; a watcher that differs, on another build.
    expect(rows[1].slice(0, 5)).toEqual(['2', 'An external player vs Claude Opus X', 'tel_marum', 'KDF against KDF', 'Draw (annihilation)']);
    expect(rows[1][5]).toBe('Not judged');
    expect(rows[1][7]).toBe('The watcher differs from the referee (tick 900) Recorded on another build.');
    // No recording: nothing to replay, said in words; a void game and a failed judge.
    expect(rows[2][4]).toBe('No result (timeout)');
    expect(rows[2][5]).toBe('The judge failed');
    expect(rows[2][7]).toBe('No recording');
    expect(rows[2][8]).toBe('Not recorded');
    // The run's cost, and the totals table.
    expect(r.host.textContent).toContain('3 games, $0.7000 in all');
    const totals = [...r.host.querySelectorAll('.rl-arena-setup__totals tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(totals).toEqual([
      ['Run total', 'Tokens in / out', 'Cache written / read', 'Cost'],
      ['Claude Opus X', '100 / 20', '3,000 / 45,000', '$0.5000'],
      ['Judge', '100 / 20', '3,000 / 45,000', '$0.2000'],
      ['All', '100 / 20', '3,000 / 45,000', '$0.7000'],
    ]);
    // The judge's criteria, behind the overall.
    const li = [...r.host.querySelectorAll('details li')].map((x) => x.textContent);
    expect(li).toHaveLength(5);
    expect(li[0]).toBe('Criterion fewer_deaths: 7 : 4');
  });

  it('Replay is a link to the replay route with the file NAME; a plain click goes there softly, a modified one is left to the browser', async () => {
    const r = rig();
    showArenaResults(r.host, r.deps);
    await settle();
    const links = [...r.host.querySelectorAll<HTMLAnchorElement>('a.rl-arena-results__replay')];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/arena/replay?game=2026-11-04-x-vs-y-game1.frames.jsonl');
    expect(new URL(links[0].href, 'http://x').search).toBe('?game=2026-11-04-x-vs-y-game1.frames.jsonl');
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    links[0].dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(r.replayed).toEqual(['2026-11-04-x-vs-y-game1.frames.jsonl']);
    const newTab = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    // jsdom cannot navigate: a listener further up reads whether the link left the default alone, then stops it.
    let left = false;
    const after = (ev: Event): void => { left = !ev.defaultPrevented; ev.preventDefault(); };
    document.addEventListener('click', after);
    links[1].dispatchEvent(newTab);
    document.removeEventListener('click', after);
    expect(left).toBe(true);
    expect(r.replayed).toHaveLength(1);
  });

  it('says so when there are no runs, when the page has no key, and when the server refuses or is gone', async () => {
    const empty = rig({ build: 'b', criteria: [], runs: [] });
    showArenaResults(empty.host, empty.deps);
    await settle();
    expect(empty.host.textContent).toContain('No runs are saved yet');

    const nokey = rig(BODY, { key: null });
    showArenaResults(nokey.host, nokey.deps);
    await settle();
    expect(nokey.calls).toHaveLength(0);
    expect(nokey.host.textContent).toContain('This page needs the link');

    const refused = rig({ error: 'token' }, {}, 403);
    showArenaResults(refused.host, refused.deps);
    await settle();
    expect(refused.host.textContent).toContain('The arena server refused this page');

    const gone = rig(BODY, { fetch: (async () => { throw new TypeError('x'); }) as unknown as typeof fetch });
    showArenaResults(gone.host, gone.deps);
    await settle();
    expect(gone.host.textContent).toContain('did not answer');
  });

  it('Refresh asks again; leaving aborts the request and empties the host, once', async () => {
    const r = rig();
    const dispose = showArenaResults(r.host, r.deps);
    await settle();
    r.host.querySelectorAll<HTMLButtonElement>('button')[1].click();
    await settle();
    expect(r.calls).toHaveLength(2);
    dispose();
    dispose();
    expect(r.calls.every((c) => c.signal?.aborted === true)).toBe(true);
    expect(r.host.childElementCount).toBe(0);
    // A response that lands after leaving paints nothing.
    const slow = rig();
    let release: () => void = () => {};
    slow.deps.fetch = (() => new Promise<Response>((res) => { release = () => res(Response.json(BODY)); })) as unknown as typeof fetch;
    const d2 = showArenaResults(slow.host, slow.deps);
    d2();
    release();
    await settle();
    expect(slow.host.childElementCount).toBe(0);
  });

  it('the words: names, the judge and the digest', () => {
    expect(playerNames({ players: [null, 'x'] })).toEqual(['An external player', 'x']);
    expect(judgeWords(null)).toBe('Not judged');
    expect(judgeWords({ status: 'invalid' })).toBe('Scores not valid');
    expect(digestWords(null, null)).toBe('No recording');
    expect(digestWords({ referee: { tick: 5, hash: 1 }, watcher: null, agree: null }, true)).toBe('No watcher digest');
  });
});

describe('every string goes through t()', () => {
  it('under ?pseudo=1 every string on the screen, in every state, is bracketed except the names and numbers it was given', async () => {
    setCatalogue('pseudo', en, pseudo);
    const DATA = /^(\d+|Claude Opus X|passive|tel_marum|2026-11-04-x-vs-y|\$0\.\d+|[\d,]+ \/ [\d,]+|Criterion \w+)$/;
    const shown: string[] = [];
    for (const rg of [rig(), rig({ build: 'b', criteria: [], runs: [] }), rig(BODY, { key: null }), rig({ error: 'x' }, {}, 403)]) {
      showArenaResults(rg.host, rg.deps);
      await settle();
      for (const s of chrome(rg.host)) {
        shown.push(s);
        if (DATA.test(s)) continue;
        expect(s, s).toMatch(/⟦[\s\S]*⟧/);
      }
    }
    expect(shown.length).toBeGreaterThan(60);
    expect(missingKeys().filter((k) => k.startsWith('arena.'))).toEqual([]);
  });

  it('every arena.results.* key the source reads exists in en.json, and none that en.json holds is unused', () => {
    const src = readFileSync('packages/app/src/ui/arena-results.ts', 'utf8');
    const used = new Set([...src.matchAll(/['"`](arena\.results\.[A-Za-z.]+)['"`]/g)].map((m) => m[1]));
    for (const k of Object.keys(en).filter((x) => x.startsWith('arena.results.'))) expect(used.has(k), `${k} is unused`).toBe(true);
    for (const k of used) expect(Object.keys(en).includes(k), `${k} is missing`).toBe(true);
  });
});
