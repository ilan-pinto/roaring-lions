// @vitest-environment jsdom
// GH-954 W2: the DEV-only /arena setup screen, in jsdom with a recording fetch. The token below is made up.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLAG_SETUP_MAPS } from '@lions/net';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import { errorKey, resultText, showArenaSetup, usageCells, type ArenaSetupDeps } from './arena-setup';

afterEach(() => { setCatalogue('en', en); document.body.replaceChildren(); vi.useRealTimers(); });

const KEY = 'a-long-random-run-token';
const API_TOKEN = 'sk-test-0123456789abcdefXYZ';
const MAPS = [{ id: 'tel_marum', label: 'Tel Marum' }, { id: 'rujm_sawda', label: 'Rujm Sawda' }, { id: 'wadi_tarfan', label: 'Wadi Tarfan' }, { id: 'wadi_tarfan_l', label: 'Wadi Tarfan (large)' }];
const PLAYERS = [
  { id: 'passive', label: 'passive', kind: 'scripted' }, { id: 'rush', label: 'rush', kind: 'scripted' },
  { id: 'opus-5.5', label: 'Claude Opus 5.5', kind: 'model_judge' }, { id: 'sonnet', label: 'Claude Sonnet', kind: 'model' }, { id: 'judge-x', label: 'Judge X', kind: 'judge' },
];
const U = { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 3000, cacheReadInputTokens: 45000, costUsd: 0.25 };
const IDLE = { state: 'idle', run: null, game: null, games: [], totals: null, error: null };
const RUNNING = {
  state: 'running', run: { a: 'rush', b: 'opus-5.5', map: 'tel_marum', matchup: 'mirror', seeds: 2, judge: null, withToken: true }, game: { n: 2, of: 4 },
  games: [{ n: 1, outcome: 'seat1', by: 'cap', ticks: 400, players: ['rush', 'opus-5.5'], usage: [null, U] }],
  totals: { players: [{ player: 'opus-5.5', usage: U }], judge: null, all: U }, error: null,
};

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined; signal: AbortSignal | undefined }
interface Rig { calls: Call[]; deps: ArenaSetupDeps; host: HTMLElement; watched: number; status: { value: unknown }; start: { status: number; body: unknown }; stop: { status: number; body: unknown }; tick(): Promise<void>; timers: (() => void)[]; cleared: unknown[] }

function rig(o: Partial<ArenaSetupDeps> = {}): Rig {
  const r = { calls: [], watched: 0, status: { value: IDLE }, start: { status: 202, body: { state: 'running' } }, stop: { status: 200, body: { state: 'stopped' } }, timers: [], cleared: [] } as unknown as Rig;
  const f = (async (url: string, init?: RequestInit) => {
    r.calls.push({ method: init?.method ?? 'GET', url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined, signal: init?.signal ?? undefined });
    if (url === '/arena/api/players') return Response.json({ players: PLAYERS });
    if (url === '/arena/api/status') return Response.json(r.status.value);
    if (url === '/arena/api/start') return Response.json(r.start.body, { status: r.start.status });
    if (url === '/arena/api/stop') return Response.json(r.stop.body, { status: r.stop.status });
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  r.host = document.createElement('div');
  document.body.appendChild(r.host);
  r.deps = {
    key: KEY, fetch: f, maps: MAPS, watch: () => { r.watched++; },
    setInterval: (fn) => { r.timers.push(fn); return r.timers.length; }, clearInterval: (h) => { r.cleared.push(h); },
    ...o,
  };
  r.tick = async () => { for (const fn of r.timers) fn(); await settle(); };
  return r;
}
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await new Promise((res) => setTimeout(res, 0)); };
const q = <T extends HTMLElement>(host: HTMLElement, sel: string): T => host.querySelector<T>(sel) as T;
const opts = (s: HTMLSelectElement): string[] => [...s.options].map((o) => o.value);
const field = (host: HTMLElement, label: string): HTMLElement => {
  const l = [...host.querySelectorAll<HTMLLabelElement>('label')].find((x) => x.textContent === label);
  if (l === undefined) throw new Error(`no field ${label}`);
  return host.querySelector<HTMLElement>(`#${l.htmlFor}`) as HTMLElement;
};
function chrome(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v) out.push(v); }
    if (el.hidden || el.closest('[hidden]')) continue;
    for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') out.push((n.textContent ?? '').trim());
  }
  return out;
}

describe('the setup form', () => {
  it('offers the versus maps, only the matchups a map hosts, its own cap, and the players by what they can be', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    const map = field(r.host, 'Map') as HTMLSelectElement;
    const matchup = field(r.host, 'Matchup') as HTMLSelectElement;
    expect(opts(map)).toEqual(['tel_marum', 'rujm_sawda', 'wadi_tarfan', 'wadi_tarfan_l']);
    expect(map.value).toBe('tel_marum');
    expect(opts(matchup)).toEqual(['mirror', 'kdf', 'sarim']);
    expect([...matchup.options].map((o) => o.textContent)).toEqual(['KDF against KDF', 'KDF against Sarim', 'Sarim against KDF']);
    // 25 minutes of 20 ticks a second on Tel Marum; Rujm Sawda is a 35-minute, mirror-only map (literals, not recomputed).
    expect((field(r.host, 'Cap (ticks)') as HTMLInputElement).max).toBe('30000');
    map.value = 'rujm_sawda';
    map.dispatchEvent(new Event('change'));
    expect(opts(matchup)).toEqual(['mirror']);
    expect((field(r.host, 'Cap (ticks)') as HTMLInputElement).max).toBe('42000');
    // A and B: every player that can play. The judge: every one that can judge. None is the default judge.
    expect(opts(field(r.host, 'Player A') as HTMLSelectElement)).toEqual(['passive', 'rush', 'opus-5.5', 'sonnet']);
    expect(opts(field(r.host, 'Judge') as HTMLSelectElement)).toEqual(['', 'opus-5.5', 'judge-x']);
    expect((field(r.host, 'Player A') as HTMLSelectElement).value).toBe('rush');
    expect((field(r.host, 'Player B') as HTMLSelectElement).value).toBe('passive');
  });

  it('Start is off until the players have been read', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').disabled).toBe(true);
    await settle();
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').disabled).toBe(false);
  });
});

describe('how to win (GH-976 P3): only the modes the lobby offers for the chosen map and matchup', () => {
  const pickMap = (r: Rig, id: string): void => {
    const map = field(r.host, 'Map') as HTMLSelectElement;
    map.value = id;
    map.dispatchEvent(new Event('change'));
  };
  const modeField = (r: Rig): HTMLSelectElement => field(r.host, 'How to win') as HTMLSelectElement;
  const bodyOfStart = (r: Rig): Record<string, unknown> => JSON.parse(r.calls.filter((c) => c.url === '/arena/api/start')[0].body as string) as Record<string, unknown>;

  const pickMatchup = (r: Rig, id: string): void => {
    const matchup = field(r.host, 'Matchup') as HTMLSelectElement;
    matchup.value = id;
    matchup.dispatchEvent(new Event('change'));
  };
  const pickMode = (r: Rig, id: string): void => {
    modeField(r).value = id;
    modeField(r).dispatchEvent(new Event('change'));
  };

  it('is not drawn where nothing is offered (KDF hosting against Sarim on Tel Marum), and the run is annihilation: no mode in the body', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    // GH-976 P4: the mirror on Tel Marum offers both modes now; the pairing with Sarim was read and offers none.
    expect(opts(modeField(r))).toEqual(['annihilation', 'points', 'flag']);
    pickMatchup(r, 'kdf');
    expect(modeField(r).closest('.rl-arena-setup__field')!.hasAttribute('hidden')).toBe(true);
    expect(opts(modeField(r))).toEqual(['annihilation']);
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect('mode' in bodyOfStart(r)).toBe(false);
    expect(bodyOfStart(r).matchup).toBe('kdf');
  });

  it('lists exactly what winModesOffered lists for the map, in the mirror: Annihilation, Points race, Capture the flag, on all four maps', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    pickMap(r, 'tel_marum');
    expect(modeField(r).closest('.rl-arena-setup__field')!.hasAttribute('hidden')).toBe(false);
    expect(opts(modeField(r))).toEqual(['annihilation', 'points', 'flag']);
    expect([...modeField(r).options].map((o) => o.textContent)).toEqual(['Annihilation', 'Points race', 'Capture the flag']);
    // Camp is read fair on wadi_tarfan, milh_flats and wadi_tarfan_l (GH-976, 5 Nov) and nowhere else: not on tel_marum or rujm_sawda.
    expect(opts(modeField(r))).not.toContain('camp');
    pickMap(r, 'rujm_sawda');
    expect(opts(modeField(r)), 'rujm_sawda').toEqual(['annihilation', 'points', 'flag']);
    for (const id of ['wadi_tarfan', 'wadi_tarfan_l']) {
      pickMap(r, id);
      expect(opts(modeField(r)), id).toEqual(['annihilation', 'camp', 'points', 'flag']);
    }
  });

  it('a faction matchup nobody read fair on the map is offered none; the pick is dropped, not sent', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    pickMap(r, 'wadi_tarfan');
    pickMode(r, 'flag');
    pickMatchup(r, 'kdf');
    expect(opts(modeField(r))).toEqual(['annihilation']);
    expect(modeField(r).value).toBe('annihilation');
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect('mode' in bodyOfStart(r)).toBe(false);
    expect(bodyOfStart(r).matchup).toBe('kdf');
  });

  it('GH-976 P4 review: KDF against Sarim is offered nothing on Wadi Tarfan (large) either, in both orders', async () => {
    for (const matchup of ['kdf', 'sarim']) {
      const r = rig();
      showArenaSetup(r.host, r.deps);
      await settle();
      pickMap(r, 'wadi_tarfan_l');
      pickMatchup(r, matchup);
      expect(modeField(r).closest('.rl-arena-setup__field')!.hasAttribute('hidden')).toBe(true);
      expect(opts(modeField(r)), matchup).toEqual(['annihilation']);
    }
  });

  it('a pick the next map does not offer is dropped, and one it does offer is kept', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    pickMap(r, 'wadi_tarfan');
    pickMode(r, 'points');
    pickMatchup(r, 'kdf');   // KDF against Sarim is offered nothing: the pick is dropped...
    expect(modeField(r).value).toBe('annihilation');
    pickMatchup(r, 'mirror');
    expect(modeField(r).value).toBe('annihilation');   // ...for good, not remembered
    pickMode(r, 'flag');
    pickMap(r, 'wadi_tarfan_l');
    expect(modeField(r).value).toBe('flag');   // a pick a mirror map offers is kept across maps
  });

  it('the pick goes in the start body, the hint says the hold, and the cap follows the mode until the person types in it', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    const cap = field(r.host, 'Cap (ticks)') as HTMLInputElement;
    pickMap(r, 'wadi_tarfan');
    expect(cap.value).toBe('12000');
    modeField(r).value = 'flag';
    modeField(r).dispatchEvent(new Event('change'));
    expect(r.host.textContent).toContain('for 30 seconds');
    expect(cap.value).toBe('30000'); // a mode's game outlasts the 12,000 default; the map's own cap
    modeField(r).value = 'annihilation';
    modeField(r).dispatchEvent(new Event('change'));
    expect(cap.value).toBe('12000');
    modeField(r).value = 'points';
    modeField(r).dispatchEvent(new Event('change'));
    expect(r.host.textContent).toContain('first to 600');
    cap.value = '9000';
    cap.dispatchEvent(new Event('input'));
    modeField(r).value = 'flag';
    modeField(r).dispatchEvent(new Event('change'));
    expect(cap.value).toBe('9000'); // typed by hand: left alone
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect(bodyOfStart(r)).toMatchObject({ map: 'wadi_tarfan', mode: 'flag', capTicks: 9000 });
  });

  it('GH-976 v2 R0.8/R0.22: a flag room on a map in FLAG_SETUP_MAPS shows the set-up hold (45 s) and the 30-minute cap, and another mode keeps the map\'s', async () => {
    const listed = FLAG_SETUP_MAPS as string[];
    const before = [...listed]; // restored below, never cleared
    listed.push('wadi_tarfan');
    try {
      const r = rig();
      showArenaSetup(r.host, r.deps);
      await settle();
      const cap = field(r.host, 'Cap (ticks)') as HTMLInputElement;
      pickMap(r, 'wadi_tarfan');
      modeField(r).value = 'flag';
      modeField(r).dispatchEvent(new Event('change'));
      expect(r.host.textContent).toContain('for 45 seconds');
      expect(cap.value).toBe('36000');
      expect(cap.max).toBe('36000');
      modeField(r).value = 'points';
      modeField(r).dispatchEvent(new Event('change'));
      expect(cap.value).toBe('30000');
      expect(cap.max).toBe('30000');
    } finally { listed.splice(0, listed.length, ...before); }
  });

  it('GH-1079: a cap typed above what the next mode allows comes down to that mode\'s maximum, and one below it stays', async () => {
    const listed = FLAG_SETUP_MAPS as string[];
    const before = [...listed]; // restored below, never cleared
    listed.push('wadi_tarfan');
    try {
      const r = rig();
      showArenaSetup(r.host, r.deps);
      await settle();
      const cap = field(r.host, 'Cap (ticks)') as HTMLInputElement;
      pickMap(r, 'wadi_tarfan');
      modeField(r).value = 'flag';
      modeField(r).dispatchEvent(new Event('change'));
      expect(cap.max).toBe('36000');
      cap.value = '35000'; // legal in the 30-minute flag room
      cap.dispatchEvent(new Event('input'));
      modeField(r).value = 'points';
      modeField(r).dispatchEvent(new Event('change'));
      expect(cap.max).toBe('30000');
      expect(cap.value).toBe('30000'); // was 35000: above the max, so refused at Start with bad_number
      cap.value = '20000';
      cap.dispatchEvent(new Event('input'));
      modeField(r).value = 'flag';
      modeField(r).dispatchEvent(new Event('change'));
      expect(cap.value).toBe('20000'); // typed and in range: left alone
      q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
      await settle();
      expect(bodyOfStart(r)).toMatchObject({ map: 'wadi_tarfan', mode: 'flag', capTicks: 20000 });
    } finally { listed.splice(0, listed.length, ...before); }
  });

  it('is locked while a run is going, like the rest of the form', async () => {
    const r = rig();
    r.status.value = { ...RUNNING, run: { ...RUNNING.run, mode: 'points' } };
    showArenaSetup(r.host, r.deps);
    await settle();
    expect(modeField(r).disabled).toBe(true);
  });

  it('under ?pseudo=1 the label, the options and the hint all went through t()', async () => {
    setCatalogue('pseudo', en, pseudo);
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    const [mapSel, , modeSel] = [...r.host.querySelectorAll<HTMLSelectElement>('select')]; // map, matchup, how to win
    mapSel.value = 'tel_marum';
    mapSel.dispatchEvent(new Event('change'));
    modeSel.value = 'flag';
    modeSel.dispatchEvent(new Event('change'));
    const wrap = modeSel.closest('.rl-arena-setup__field')!;
    const shown = [...wrap.querySelectorAll('label, option, .rl-arena-setup__hint')].map((e) => e.textContent!);
    expect(shown).toHaveLength(5); // the label, three options, the hint
    for (const text of shown) expect(text, text).toMatch(/^⟦[\s\S]*⟧$/);
    expect(missingKeys().filter((k) => k.startsWith('arena.') || k.startsWith('versus.win'))).toEqual([]);
  });
});

describe('the private token field', () => {
  it('is a password input that asks the browser to remember nothing, never inside a form, and carries no name', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    const token = field(r.host, 'Private API token (optional)') as HTMLInputElement;
    expect(token.type).toBe('password');
    expect(token.autocomplete).toBe('new-password');
    expect(token.spellcheck).toBe(false);
    expect(token.getAttribute('name')).toBeNull();
    expect(token.closest('form')).toBeNull();
    expect(token.maxLength).toBe(512);
  });

  it('goes out ONLY in the body of the one start POST, then the field is emptied; no URL, header, storage or later request carries it', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    (field(r.host, 'Player B') as HTMLSelectElement).value = 'opus-5.5';
    const token = field(r.host, 'Private API token (optional)') as HTMLInputElement;
    token.value = API_TOKEN;
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    const starts = r.calls.filter((c) => c.url === '/arena/api/start');
    expect(starts).toHaveLength(1);
    expect(starts[0].method).toBe('POST');
    expect(JSON.parse(starts[0].body as string)).toEqual({ a: 'rush', b: 'opus-5.5', map: 'tel_marum', matchup: 'mirror', seeds: 1, pace: 60, roundWallMs: 120000, capTicks: 12000, token: API_TOKEN });
    expect(starts[0].headers).toEqual({ 'x-arena-token': KEY, 'content-type': 'application/json' });
    // Emptied once the server has the run, and the page went on to the watch screen.
    expect(token.value).toBe('');
    expect(r.watched).toBe(1);
    // Everywhere else: no URL, header or body (the other requests), and no storage, no DOM text.
    for (const c of r.calls) {
      expect(c.url).not.toContain(API_TOKEN);
      expect(JSON.stringify(c.headers)).not.toContain(API_TOKEN);
      if (c !== starts[0]) expect(c.body ?? '').not.toContain(API_TOKEN);
    }
    expect(r.host.innerHTML).not.toContain(API_TOKEN);
    expect(document.body.innerHTML).not.toContain(API_TOKEN);
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
      try { expect(JSON.stringify(store)).not.toContain(API_TOKEN); } catch { /* a storage that refuses is not holding it */ }
    }
  });

  it('an empty field sends NO token key; the judge goes only when picked', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect(Object.keys(JSON.parse(r.calls.find((c) => c.url === '/arena/api/start')?.body as string))).toEqual(['a', 'b', 'map', 'matchup', 'seeds', 'pace', 'roundWallMs', 'capTicks']);
    const r2 = rig();
    showArenaSetup(r2.host, r2.deps);
    await settle();
    (field(r2.host, 'Judge') as HTMLSelectElement).value = 'judge-x';
    q<HTMLButtonElement>(r2.host, '.rl-arena-setup__start').click();
    await settle();
    expect(JSON.parse(r2.calls.find((c) => c.url === '/arena/api/start')?.body as string)).toMatchObject({ judge: 'judge-x' });
  });

  it('a refused start keeps the screen (and says why); the field is left for a retry but is emptied on leaving', async () => {
    const r = rig();
    r.start = { status: 400, body: { error: 'bad_token' } };
    const dispose = showArenaSetup(r.host, r.deps);
    await settle();
    const token = field(r.host, 'Private API token (optional)') as HTMLInputElement;
    token.value = API_TOKEN;
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect(q(r.host, '.rl-arena-setup__message').textContent).toBe('The token must be printable characters with no spaces, 8 to 512 long');
    expect(r.watched).toBe(0);
    expect(token.value).toBe(API_TOKEN);
    dispose();
    expect(token.value).toBe('');
  });
});

describe('errors', () => {
  it('maps a status and code to a message, with no value from the server in it', () => {
    expect(errorKey(409, 'busy')).toBe('arena.setup.err.busy');
    expect(errorKey(0, null)).toBe('arena.setup.err.noServer');
    expect(errorKey(403, null)).toBe('arena.setup.err.refused');
    expect(errorKey(421, null)).toBe('arena.setup.err.refused');
    for (const [code, key] of [['bad_player', 'player'], ['bad_judge', 'judge'], ['map_refused', 'map'], ['bad_map', 'map'], ['bad_matchup', 'matchup'], ['bad_mode', 'mode'], ['bad_number', 'number'], ['bad_args', 'number'], ['bad_token', 'token'], ['unknown_field', 'bad'], [null, 'bad']] as const) {
      expect(errorKey(400, code)).toBe(`arena.setup.err.${key}`);
    }
  });
  it('a 409 on Start says a run is going and keeps the page; an unreachable server says so', async () => {
    const r = rig();
    r.start = { status: 409, body: { error: 'busy' } };
    showArenaSetup(r.host, r.deps);
    await settle();
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect(q(r.host, '.rl-arena-setup__message').textContent).toBe('A run is already going: watch it or stop it first');
    expect(r.watched).toBe(0);
    const down = rig({ fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    showArenaSetup(down.host, down.deps);
    await settle();
    expect(q(down.host, '.rl-arena-setup__message').textContent).toContain('did not answer');
  });
  it('a page opened without the printed link makes no request at all', async () => {
    const r = rig({ key: null });
    showArenaSetup(r.host, r.deps);
    await settle();
    expect(r.calls).toEqual([]);
    expect(q(r.host, '.rl-arena-setup__message').textContent).toContain('its key follows the #');
    expect(r.host.querySelector('input, select, button')).toBeNull();
  });
  it('validates the numbers before sending anything', async () => {
    const r = rig();
    showArenaSetup(r.host, r.deps);
    await settle();
    (field(r.host, 'Seeds') as HTMLInputElement).value = '1.5';
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    expect(r.calls.some((c) => c.url === '/arena/api/start')).toBe(false);
    expect(q(r.host, '.rl-arena-setup__message').textContent).toContain('Check the numbers');
  });
});

describe('the status', () => {
  it('a running run locks the form, shows Watch and Stop, and lists each game with each player\'s usage and the run totals', async () => {
    const r = rig();
    r.status.value = RUNNING;
    showArenaSetup(r.host, r.deps);
    await settle();
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').disabled).toBe(true);
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__stop').disabled).toBe(false);
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__watch').hidden).toBe(false);
    expect((field(r.host, 'Map') as HTMLSelectElement).disabled).toBe(true);
    expect(q(r.host, '.rl-arena-setup__state').textContent).toBe('A run is going');
    expect(q(r.host, '.rl-arena-setup__run').textContent).toBe('rush vs opus-5.5 on tel_marum, 2 seeds Game 2 of 4');
    const rows = [...r.host.querySelectorAll('.rl-arena-setup__table:not(.rl-arena-setup__totals) tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ['Game', 'Player', 'Result', 'Tokens in / out', 'Cache written / read', 'Cost'],
      ['1', 'rush', 'opus-5.5 won (cap)', '—', '— / —'.replace('— / —', '—'), '—'],
      ['', 'opus-5.5', '', '100 / 20', '3,000 / 45,000', '$0.2500'],
    ].map((row, i) => (i === 1 ? ['1', 'rush', 'opus-5.5 won (cap)', '—', '—', '—'] : row)));
    const totals = [...r.host.querySelectorAll('.rl-arena-setup__totals tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(totals).toEqual([
      ['Run total', 'Tokens in / out', 'Cache written / read', 'Cost'],
      ['opus-5.5', '100 / 20', '3,000 / 45,000', '$0.2500'],
      ['All', '100 / 20', '3,000 / 45,000', '$0.2500'],
    ]);
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__watch').click();
    expect(r.watched).toBe(1);
  });

  it('polls on the timer; a finished run frees Start and shows its end', async () => {
    const r = rig();
    r.status.value = RUNNING;
    showArenaSetup(r.host, r.deps);
    await settle();
    r.status.value = { ...RUNNING, state: 'done', game: null };
    await r.tick();
    expect(q(r.host, '.rl-arena-setup__state').textContent).toBe('The run is complete');
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').disabled).toBe(false);
    expect(q<HTMLButtonElement>(r.host, '.rl-arena-setup__watch').hidden).toBe(true);
    r.status.value = { ...RUNNING, state: 'failed', game: null, error: 'a game could not be played' };
    await r.tick();
    expect(q(r.host, '.rl-arena-setup__error').textContent).toBe('a game could not be played');
  });

  it('Stop posts an empty object and refreshes', async () => {
    const r = rig();
    r.status.value = RUNNING;
    showArenaSetup(r.host, r.deps);
    await settle();
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__stop').click();
    await settle();
    const stop = r.calls.find((c) => c.url === '/arena/api/stop');
    expect(stop?.method).toBe('POST');
    expect(stop?.body).toBe('{}');
  });

  it('formats usage cells, a scripted player\'s nothing, and verdicts', () => {
    expect(usageCells(U)).toEqual(['100 / 20', '3,000 / 45,000', '$0.2500']);
    expect(usageCells({ ...U, cacheCreationInputTokens: null, costUsd: null })).toEqual(['100 / 20', '— / 45,000', '—']);
    expect(usageCells(null)).toEqual(['—', '—', '—']);
    expect(resultText({ outcome: 'seat0', by: 'annihilation', players: ['a', 'b'] })).toBe('a won (annihilation)');
    expect(resultText({ outcome: 'draw', by: 'time', players: ['a', 'b'] })).toBe('Draw (time)');
    expect(resultText({ outcome: 'void', by: 'desync', players: ['a', 'b'] })).toBe('No result (desync)');
  });
});

describe('the disposer contract', () => {
  it('stops the poll, aborts what is in flight, empties the host and the token, and a late answer paints and navigates nothing', async () => {
    const r = rig();
    let release: () => void = () => {};
    const slow = new Promise<void>((res) => { release = res; });
    const base = r.deps.fetch;
    r.deps.fetch = (async (url: string, init?: RequestInit) => { if (url === '/arena/api/start') await slow; return base(url, init); }) as unknown as typeof fetch;
    const dispose = showArenaSetup(r.host, r.deps);
    await settle();
    const token = field(r.host, 'Private API token (optional)') as HTMLInputElement;
    token.value = API_TOKEN;
    q<HTMLButtonElement>(r.host, '.rl-arena-setup__start').click();
    await settle();
    const signal = r.calls[0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    dispose();
    expect(signal.aborted).toBe(true);
    expect(r.cleared).toHaveLength(1);
    expect(r.host.childNodes).toHaveLength(0);
    expect(token.value).toBe('');
    release();
    await settle();
    expect(r.watched).toBe(0);
    expect(r.host.childNodes).toHaveLength(0);
    dispose();   // idempotent
    expect(r.cleared).toHaveLength(1);
    // A stale timer tick after disposal makes no request.
    const before = r.calls.length;
    await r.tick();
    expect(r.calls.length).toBe(before);
  });
});

describe('the saved results (GH-954 W3)', () => {
  it('has a Results button when the route gives it somewhere to go, and none when it does not', async () => {
    let went = 0;
    const withIt = rig({ results: () => { went++; } });
    showArenaSetup(withIt.host, withIt.deps);
    await settle();
    const btn = [...withIt.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Saved results') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(went).toBe(1);
    const without = rig();
    showArenaSetup(without.host, without.deps);
    await settle();
    expect([...without.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Saved results')?.hidden).toBe(true);
  });
});

describe('every string goes through t()', () => {
  const DATA = new Set([...MAPS.map((m) => m.label), ...PLAYERS.map((p) => p.label), 'rush', 'opus-5.5']);
  it('under ?pseudo=1 every string on the screen, in every state, is bracketed except the maps\' and players\' own names', async () => {
    setCatalogue('pseudo', en, pseudo);
    const shown: string[] = [];
    for (const status of [IDLE, RUNNING, { ...RUNNING, state: 'failed', game: null, error: null }]) {
      const r = rig();
      r.status.value = status;
      showArenaSetup(r.host, r.deps);
      await settle();
      for (const s of chrome(r.host)) {
        shown.push(s);
        if (DATA.has(s) || /^\d+$/.test(s)) continue;   // a name from the catalogue or the presets file, or a bare game number
        expect(s, s).toMatch(/^⟦[\s\S]*⟧$/);
      }
    }
    // An error, and the no-key page, too.
    const down = rig({ fetch: (async () => { throw new TypeError('x'); }) as unknown as typeof fetch });
    showArenaSetup(down.host, down.deps);
    await settle();
    const nokey = rig({ key: null });
    showArenaSetup(nokey.host, nokey.deps);
    for (const host of [down.host, nokey.host]) for (const s of chrome(host)) { shown.push(s); if (!DATA.has(s)) expect(s, s).toMatch(/^⟦[\s\S]*⟧$/); }
    expect(shown.length).toBeGreaterThan(80);
    expect(shown.some((s) => s.includes('Ƀ') || s.includes('ƀ'))).toBe(true);
    expect(missingKeys().filter((k) => k.startsWith('arena.'))).toEqual([]);
  });

  it('every arena.setup.* key the source reads exists in en.json, and none that en.json holds is unused', () => {
    const src = readFileSync('packages/app/src/ui/arena-setup.ts', 'utf8');
    const used = new Set([...src.matchAll(/['"`](arena\.setup\.[A-Za-z.]+)['"`]/g)].map((m) => m[1]));
    // The three matchups and the error keys are reached through tables in the source.
    for (const k of Object.keys(en).filter((x) => x.startsWith('arena.setup.'))) expect(used.has(k), `${k} is unused`).toBe(true);
    for (const k of used) expect(Object.keys(en).includes(k), `${k} is missing`).toBe(true);
  });
});
