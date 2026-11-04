// @vitest-environment jsdom
// GH-954 W3: the DEV-only /arena/replay screen, in jsdom with a stub fetch and a stub battlefield. It proves the
// screen's own contract: what it asks the battlefield to boot, the speed and pause controls, the end-of-game digest
// comparison, the refusals, and the disposer (a counted close). The real battlefield is in the browser check.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateConfig, type MatchConfig } from '@lions/net';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import type { ReplayFile } from '../net/replay-file';
import { ReplayTransport } from '../net/replay-transport';
import type { SpectatorHandle } from '../net/spectator';
import { digestText, replayErrorKey, showArenaReplay, type ArenaReplayDeps, type ReplaySpectate } from './arena-replay';

afterEach(() => { setCatalogue('en', en); document.body.replaceChildren(); vi.useRealTimers(); });

const KEY = 'a-long-random-run-token';
const seat = (s: 0 | 1): Record<string, unknown> => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'bot' });
const config = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'paced', roundTicks: 40, roundWallMs: 1000 }, hashEveryTicks: 20, bufferTicks: 2, build: 'B', dataDigest: 0 }) as MatchConfig;
const FILE: ReplayFile = {
  header: { kind: 'header', v: 1, build: 'B', game: { n: 2, of: 4, seed: 1, map: 'tel_marum', matchup: 'mirror', capTicks: 200, pace: 40, roundWallMs: 1000 }, labels: ['Claude Opus X', 'passive'], config },
  frames: [{ t: 3, c: [{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } as never }] }],
  end: { kind: 'end', ticks: 120, referee: { tick: 120, hash: -77 }, watcher: { tick: 120, hash: -77 }, outcome: 'seat0', by: 'annihilation' },
};
// The wire form is the file's own object: header, frames, end.
const WIRE = { build: 'B', file: 'x-game2.frames.jsonl', replay: FILE };

interface Boot { stage: HTMLElement; signal: AbortSignal; spectate: ReplaySpectate; map: string }
interface Rig {
  host: HTMLElement; deps: ArenaReplayDeps; calls: { url: string; headers: Record<string, string>; signal: AbortSignal | undefined }[];
  boots: Boot[]; disposed: number; backs: number; timers: (() => void)[]; clock: { ms: number };
  landBoot(): void; ready(): SpectatorHandle & { ticks: { value: number }; hash: { value: number } };
}
function rig(response: { status: number; body: unknown } | 'down' = { status: 200, body: WIRE }, o: Partial<ArenaReplayDeps> = {}, manualBoot = false): Rig {
  const r = { calls: [], boots: [], disposed: 0, backs: 0, timers: [], clock: { ms: 0 } } as unknown as Rig;
  let land: () => void = () => {};
  r.landBoot = () => land();
  r.host = document.createElement('div');
  document.body.appendChild(r.host);
  r.deps = {
    key: KEY, game: 'x-game2.frames.jsonl',
    fetch: (async (url: string, init?: RequestInit) => {
      r.calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, signal: init?.signal ?? undefined });
      if (response === 'down') throw new TypeError('down');
      return Response.json(response.body, { status: response.status });
    }) as unknown as typeof fetch,
    boot: (stage, signal, spectate, map) => {
      r.boots.push({ stage, signal, spectate, map });
      const dispose = (): void => { r.disposed++; };
      return manualBoot ? new Promise((res) => { land = () => res(dispose); }) : Promise.resolve(dispose);
    },
    back: () => { r.backs++; },
    now: () => r.clock.ms,
    setInterval: (fn) => { r.timers.push(fn); return r.timers.length; }, clearInterval: () => {},
    ...o,
  };
  r.ready = () => {
    const ticks = { value: 40 };
    const hash = { value: -77 };
    const h = {
      setViewer: vi.fn(),
      read: () => ({ config, tick: ticks.value, behind: 0, score: [{ lost: 1, lostValue: 1, destroyed: 4, destroyedValue: 4, remaining: 50 }, { lost: 4, lostValue: 4, destroyed: 1, destroyedValue: 1, remaining: 20 }] as never, over: false }),
      digest: () => ({ tick: ticks.value, hash: hash.value }),
      ticks, hash,
    };
    r.boots[0].spectate.hooks.onReady(h);
    return h;
  };
  return r;
}
const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise((res) => setTimeout(res, 0)); };
const strip = (): HTMLElement | null => document.body.querySelector('.rl-arena-strip');
function chrome(root: ParentNode): string[] {
  const out: string[] = [];
  for (const el of [...root.querySelectorAll<HTMLElement>('*')]) {
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v) out.push(v); }
    if (el.hidden || el.closest('[hidden]')) continue;
    for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') out.push((n.textContent ?? '').trim());
  }
  return out;
}

describe('what it will not do', () => {
  it('with no key, no game or a refusal it fetches or boots nothing and says why', async () => {
    const nokey = rig(undefined, { key: null });
    showArenaReplay(nokey.host, nokey.deps);
    await settle();
    expect(nokey.calls).toHaveLength(0);
    expect(nokey.boots).toHaveLength(0);
    expect(nokey.host.textContent).toContain('This page needs the link');

    const nogame = rig(undefined, { game: null });
    showArenaReplay(nogame.host, nogame.deps);
    await settle();
    expect(nogame.calls).toHaveLength(0);
    expect(nogame.host.textContent).toContain('That recording is not in the saved results');

    const mismatch = rig({ status: 409, body: { error: 'build_mismatch', fileBuild: '0.1.0+old', build: '0.1.0+new' } });
    showArenaReplay(mismatch.host, mismatch.deps);
    await settle();
    expect(mismatch.boots).toHaveLength(0);
    expect(mismatch.host.textContent).toContain('This recording was made on build 0.1.0+old and this server runs 0.1.0+new, so it is not replayed.');

    for (const [res, words] of [
      [{ status: 404, body: { error: 'not_found' } }, 'not in the saved results'],
      [{ status: 400, body: { error: 'bad_name' } }, 'not in the saved results'],
      [{ status: 422, body: { error: 'incomplete' } }, 'unfinished'],
      [{ status: 422, body: { error: 'bad_file' } }, 'could not be read'],
      [{ status: 403, body: { error: 'token' } }, 'refused this page'],
      ['down', 'did not answer'],
    ] as const) {
      const r = rig(res);
      showArenaReplay(r.host, r.deps);
      await settle();
      expect(r.boots, words).toHaveLength(0);
      expect(r.host.textContent, words).toContain(words);
    }
  });

  it('a file the server sent that does not check out here (another build in its own header) is refused too', async () => {
    const r = rig({ status: 200, body: { ...WIRE, build: 'NOT-B' } });
    showArenaReplay(r.host, r.deps);
    await settle();
    expect(r.boots).toHaveLength(0);
    expect(r.host.textContent).toContain('This recording was made on build B and this server runs NOT-B');
  });

  it('the error keys', () => {
    expect(replayErrorKey(0, null)).toBe('arena.replay.err.noServer');
    expect(replayErrorKey(409, 'build_mismatch')).toBe('arena.replay.err.build');
    expect(replayErrorKey(500, 'read')).toBe('arena.replay.err.bad');
  });
});

describe('the replay it boots', () => {
  it('asks for the key\'s file by name, boots the spectator battlefield once on the game\'s map and gives it the recorded frames and the config', async () => {
    const r = rig();
    showArenaReplay(r.host, r.deps);
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(['/arena/api/replay?game=x-game2.frames.jsonl']);
    expect(r.calls[0].headers['x-arena-token']).toBe(KEY);
    expect(r.boots).toHaveLength(1);
    const b = r.boots[0];
    expect(b.map).toBe('tel_marum');
    expect(b.stage.classList.contains('rl-arena-stage')).toBe(true);
    // It stops where the referee did, and nowhere else.
    expect(b.spectate.capTicks).toBe(120);
    const conn = await b.spectate.connect(b.signal);
    expect(conn.seat).toBe(0);
    expect(conn.config).toEqual(config);
    expect(conn.transport).toBeInstanceOf(ReplayTransport);
    const tr = conn.transport as ReplayTransport;
    expect(tr.total).toBe(120);
    expect(tr.speed).toBe(1);
    // No input path: a command queued on it is dropped, and the frames are the recorded ones. (A call is credited at most
    // 250 ms: five ticks at 1x, however long the tab was away.)
    tr.queueCommand({ kind: 'halt', ids: [9] } as never);
    r.clock.ms += 50 * 125;
    const frames = tr.take(1000);
    expect(frames.map((f) => f.tick)).toEqual([0, 1, 2, 3, 4]);
    expect(frames.map((f) => f.cmds.length)).toEqual([0, 0, 0, 1, 0]);
    expect(frames[3].cmds).toEqual(FILE.frames[0].c);
    // The strip says whose game it is, and the fog opens on both sides.
    expect(strip()?.textContent).toContain('Game 2 of 4');
    expect(strip()?.textContent).toContain('Claude Opus X vs passive');
    const views = [...(strip()?.querySelectorAll<HTMLButtonElement>('.rl-arena-strip__views [data-view]') ?? [])];
    expect(views.map((v) => [v.dataset.view, v.getAttribute('aria-checked')])).toEqual([['all', 'true'], ['a', 'false'], ['b', 'false']]);
  });

  it('shows the speeds 0.5x to 8x and a pause; they change the transport, and the page says where the replay is', async () => {
    const r = rig();
    showArenaReplay(r.host, r.deps);
    await settle();
    const tr = (await r.boots[0].spectate.connect(r.boots[0].signal)).transport as ReplayTransport;
    const speedBtns = [...(strip()?.querySelectorAll<HTMLButtonElement>('.rl-arena-replay__speeds button') ?? [])];
    expect(speedBtns.map((b) => b.textContent)).toEqual(['0.5x', '1x', '2x', '4x', '8x']);
    expect(speedBtns.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    speedBtns[4].click();
    expect(tr.speed).toBe(8);
    expect(speedBtns.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false', 'true']);
    speedBtns[0].click();
    expect(tr.speed).toBe(0.5);
    const pause = strip()?.querySelector<HTMLButtonElement>('.rl-arena-replay__pause') as HTMLButtonElement;
    expect(pause.textContent).toBe('Pause');
    pause.click();
    expect(tr.paused).toBe(true);
    expect(pause.textContent).toBe('Play');
    pause.click();
    expect(tr.paused).toBe(false);
    // The progress follows the battlefield's own tick.
    const h = r.ready();
    h.ticks.value = 64;
    r.timers.forEach((f) => f());
    expect(strip()?.textContent).toContain('Tick 64 of 120');
    // Leaving for the results is the strip's own button.
    (strip()?.querySelector('.rl-arena-strip__stop') as HTMLButtonElement).click();
    expect(r.backs).toBe(1);
    expect(strip()?.querySelector('.rl-arena-strip__stop')?.textContent).toBe('Back to the results');
  });

  it('the speed buttons name the speed ASKED for; a machine that cannot keep up is told so, with the speed it really ran at', async () => {
    const r = rig();
    showArenaReplay(r.host, r.deps);
    await settle();
    const tick = (): void => r.timers.forEach((f) => f());
    const actual = (): HTMLElement => strip()?.querySelector('.rl-arena-replay__actual') as HTMLElement;
    const h = r.ready();
    (strip()?.querySelectorAll<HTMLButtonElement>('.rl-arena-replay__speeds button') as NodeListOf<HTMLButtonElement>)[4].click();
    h.ticks.value = 0;
    tick();                                   // the sample starts here
    expect(actual().hidden).toBe(true);
    // One second later the page has run 40 ticks: that is 2x, not the 8x asked for.
    r.clock.ms += 1000; h.ticks.value = 40;
    tick();
    expect(actual().hidden).toBe(false);
    expect(actual().textContent).toBe('Running at 2x: this machine cannot step the game faster');
    // Keeping up (160 ticks a second is 8x) says nothing.
    r.clock.ms += 1000; h.ticks.value = 200;
    tick();
    expect(actual().hidden).toBe(true);
    // A pause is not slowness.
    r.clock.ms += 1000; h.ticks.value = 201;
    (strip()?.querySelector('.rl-arena-replay__pause') as HTMLButtonElement).click();
    tick();
    expect(actual().hidden).toBe(true);
  });

  it('at the end it compares its own state with the referee\'s: the same hash says so, a different one says how it differs', async () => {
    for (const [hash, tick, same] of [[-77, 120, true], [-78, 120, false], [-77, 119, false]] as const) {
      document.body.replaceChildren();
      const r = rig();
      showArenaReplay(r.host, r.deps);
      await settle();
      const h = r.ready();
      expect(strip()?.querySelector('.rl-arena-replay__digest')?.hasAttribute('hidden')).toBe(true);
      h.ticks.value = tick;
      h.hash.value = hash;
      r.boots[0].spectate.hooks.onEnd('cap');
      const d = strip()?.querySelector('.rl-arena-replay__digest') as HTMLElement;
      expect(d.hidden).toBe(false);
      expect(d.classList.contains('rl-good')).toBe(same);
      expect(d.classList.contains('rl-bad')).toBe(!same);
      expect(d.textContent).toBe(same ? 'The replay ended in the referee\'s state (tick 120)' : `The replay differs from the referee: tick ${tick} against 120, state ${(hash >>> 0).toString(16).padStart(8, '0')} against ${(-77 >>> 0).toString(16)}`);
      // The recorded verdict shows once it is over.
      expect(strip()?.textContent).toContain('Game 2: Claude Opus X won');
    }
    expect(digestText({ tick: 1, hash: 2 }, { tick: 1, hash: 2 }).same).toBe(true);
  });

  it('a view choice reaches the renderer through the handle, by the seat\'s side', async () => {
    const r = rig();
    showArenaReplay(r.host, r.deps);
    await settle();
    const h = r.ready();
    (strip()?.querySelector('[data-view="b"]') as HTMLButtonElement).click();
    expect(h.setViewer).toHaveBeenCalledWith(1);
    (strip()?.querySelector('[data-view="all"]') as HTMLButtonElement).click();
    expect(h.setViewer).toHaveBeenLastCalledWith('all');
  });
});

describe('the disposer contract', () => {
  it('leaving aborts the fetch and the boot, disposes the battlefield once, closes the transport, removes the strip and the stage', async () => {
    const r = rig();
    const dispose = showArenaReplay(r.host, r.deps);
    await settle();
    const tr = (await r.boots[0].spectate.connect(r.boots[0].signal)).transport as ReplayTransport;
    expect(strip()).not.toBeNull();
    dispose();
    dispose();
    expect(r.disposed).toBe(1);
    expect(r.boots[0].signal.aborted).toBe(true);
    expect(r.calls[0].signal?.aborted).toBe(true);
    expect(tr.status()).toEqual({ kind: 'closed', reason: 'left' });
    expect(strip()).toBeNull();
    expect(r.host.childElementCount).toBe(0);
  });

  it('leaving while the battlefield is still booting disposes it the moment it lands, once', async () => {
    const r = rig(undefined, {}, true);
    const dispose = showArenaReplay(r.host, r.deps);
    await settle();
    expect(r.boots).toHaveLength(1);
    dispose();
    expect(r.disposed).toBe(0);
    r.landBoot();
    await settle();
    expect(r.disposed).toBe(1);
    expect(strip()).toBeNull();
  });

  it('leaving while the file is still being fetched boots nothing', async () => {
    let release: () => void = () => {};
    const r = rig(undefined, { fetch: (() => new Promise<Response>((res) => { release = () => res(Response.json(WIRE)); })) as unknown as typeof fetch });
    const dispose = showArenaReplay(r.host, r.deps);
    dispose();
    release();
    await settle();
    expect(r.boots).toHaveLength(0);
    expect(strip()).toBeNull();
  });

  it('a battlefield that fails to boot is reported on the page, not swallowed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = rig(undefined, { boot: () => Promise.reject(new Error('no webgl')) });
    showArenaReplay(r.host, r.deps);
    await settle();
    expect(r.host.textContent).toContain('The battlefield could not be shown');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('every string goes through t()', () => {
  it('under ?pseudo=1 every string on the screen and the strip, in every state, is bracketed except the names and numbers it was given', async () => {
    setCatalogue('pseudo', en, pseudo);
    const DATA = /^(\d+|Claude Opus X|passive|[\d.]+x|[0-9a-f]{8})$/;
    const shown: string[] = [];
    const states: (() => Promise<Rig>)[] = [
      async () => { const r = rig(); showArenaReplay(r.host, r.deps); await settle(); r.ready(); return r; },
      async () => { const r = rig(); showArenaReplay(r.host, r.deps); await settle(); const h = r.ready(); h.hash.value = 5; r.boots[0].spectate.hooks.onEnd('result'); return r; },
      async () => { const r = rig(); showArenaReplay(r.host, r.deps); await settle(); r.ready(); r.boots[0].spectate.hooks.onEnd('cap'); return r; },
      async () => { const r = rig(); showArenaReplay(r.host, r.deps); await settle(); r.ready(); (strip()?.querySelector('.rl-arena-replay__pause') as HTMLButtonElement).click(); return r; },
      async () => { const r = rig(undefined, { key: null }); showArenaReplay(r.host, r.deps); return r; },
      async () => { const r = rig({ status: 409, body: { error: 'build_mismatch', fileBuild: 'a', build: 'b' } }); showArenaReplay(r.host, r.deps); await settle(); return r; },
    ];
    for (const make of states) {
      document.body.replaceChildren();
      const r = await make();
      for (const s of [...chrome(r.host), ...chrome(document.body)]) {
        shown.push(s);
        if (DATA.test(s)) continue;
        expect(s, s).toMatch(/⟦[\s\S]*⟧/);
      }
    }
    expect(shown.length).toBeGreaterThan(60);
    expect(missingKeys().filter((k) => k.startsWith('arena.'))).toEqual([]);
  });

  it('every arena.replay.* key the source reads exists in en.json, and none that en.json holds is unused', () => {
    const src = readFileSync('packages/app/src/ui/arena-replay.ts', 'utf8');
    const used = new Set([...src.matchAll(/['"`](arena\.replay\.[A-Za-z.]+)['"`]/g)].map((m) => m[1]));
    for (const k of Object.keys(en).filter((x) => x.startsWith('arena.replay.'))) expect(used.has(k), `${k} is unused`).toBe(true);
    for (const k of used) expect(Object.keys(en).includes(k), `${k} is missing`).toBe(true);
  });
});
