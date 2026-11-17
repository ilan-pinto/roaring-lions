import { describe, it, expect } from 'vitest';
import type { TelemetryEvent } from '@lions/data/telemetry';
import { isTelemetryEvent } from '@lions/data/telemetry';
import type { MissionEvent } from '@lions/sim';
import { createTelemetry, gatedSink, NOOP_TELEMETRY, PERF_MIN_FRAMES, PERF_SAMPLE_MS, ERROR_CAP, ERROR_SAME_CAP, type TelemetryDeps } from './index';
import type { RuntimeView } from './events';

function harness(over: Partial<TelemetryDeps> = {}) {
  const sent: TelemetryEvent[] = [];
  const flushes: boolean[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let pagehide: (() => void) | undefined;
  let visible = true;
  let now = 1000;
  const deps: TelemetryDeps = {
    identity: { player: '0f8fad5b-d9cb-469f-a165-70867728950e', returning: false, optedOut: false },
    newSession: () => '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    build: '0.78.0',
    dev: false,
    now: () => now,
    viewport: () => [1440, 900],
    visible: () => visible,
    setInterval: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearInterval: (h) => { (h as { cleared: boolean }).cleared = true; },
    onPagehide: (fn) => { pagehide = fn; },
    sink: { push: (e) => void sent.push(e), flush: (useBeacon = false) => void flushes.push(useBeacon) },
    ...over,
  };
  const tel = createTelemetry(deps);
  return {
    tel, sent, flushes, timers,
    hide: () => pagehide?.(),
    setVisible: (v: boolean) => { visible = v; },
    advance: (ms: number) => { now += ms; },
  };
}

let state: RuntimeView;
const view = () => state;
const reset = () => {
  state = { tick: 0, result: 'ongoing', defeatCause: undefined, roe: 100, fielded: 5, lost: 0,
    objectives: [{ id: 'hold', type: 'hold_for', primary: true, status: 'active' }] };
};
const endEvent = (result: 'victory' | 'defeat'): MissionEvent =>
  ({ kind: 'missionEnd', tick: 100, result, roeRating: 90, survivors: [], ledger: {} }) as MissionEvent;

describe('Telemetry', () => {
  it('sends session_start with the envelope', () => {
    const h = harness();
    h.tel.sessionStart('menu', 'three');
    expect(h.sent[0]).toMatchObject({ type: 'session_start', screen: 'menu', renderer: 'three', v: 1, build: '0.78.0', t: 1000 });
  });

  it('victory then teardown sends exactly one mission_end, the victory', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    state = { ...state, result: 'victory', tick: 100 };
    m.onEvent(endEvent('victory'));
    m.end();
    h.hide();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ result: 'victory' });
  });

  it('a soft leave mid-mission sends one abandoned', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    state = { ...state, tick: 500 };
    m.end();
    m.end();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toEqual([expect.objectContaining({ result: 'abandoned', tick: 500 })]);
  });

  it('a closed tab mid-mission sends abandoned through pagehide', () => {
    reset();
    const h = harness();
    h.tel.missionStarted('m1', false, view);
    h.hide();
    expect(h.sent.filter((e) => e.type === 'mission_end')).toEqual([expect.objectContaining({ result: 'abandoned' })]);
  });

  it('M2: pagehide sends the abandoned event over the beacon flush, not a plain fetch flush', () => {
    reset();
    const h = harness();
    h.tel.missionStarted('m1', false, view);
    h.hide();
    // Exactly one flush happened, and it was the beacon one -- `end()`
    // called from the pagehide handler must skip its own (non-beacon) flush
    // and leave the queued event for the handler's own `flush(true)`.
    expect(h.flushes).toEqual([true]);
  });

  it('heartbeats every 60 s only while visible, and stops at end()', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    const hb = h.timers.find((t) => t.ms === 60_000);
    expect(hb).toBeDefined();
    hb?.fn();
    h.setVisible(false);
    hb?.fn();
    expect(h.sent.filter((e) => e.type === 'heartbeat')).toHaveLength(1);
    m.end();
    expect(hb?.cleared).toBe(true);
  });

  it('turns objective events into objective telemetry', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    m.onEvent({ kind: 'objective', tick: 40, id: 'hold', status: 'complete' } as MissionEvent);
    m.onEvent({ kind: 'objective', tick: 41, id: 'hold', status: 'active' } as MissionEvent);
    expect(h.sent.filter((e) => e.type === 'objective')).toEqual([
      expect.objectContaining({ objective: 'hold', objectiveType: 'hold_for', status: 'complete', tick: 40 }),
    ]);
  });

  it('sends the beat id with the step, and omits it when none is given', () => {
    const h = harness();
    h.tel.tutorialStep(0, 9, 'look_around');
    h.tel.tutorialStep(1, 9);
    expect(h.sent.map((e) => (e.type === 'tutorial_step' ? e.id : 'x'))).toEqual(['look_around', undefined]);
  });

  it('times tutorial steps from the previous one', () => {
    const h = harness();
    h.tel.tutorialStep(0, 14);
    h.advance(5000);
    h.tel.tutorialStep(1, 14);
    expect(h.sent.map((e) => (e.type === 'tutorial_step' ? e.prevMs : -1))).toEqual([0, 5000]);
  });

  it('M4: a fresh run starting back at step 0 reads prevMs 0, not time since the previous run', () => {
    const h = harness();
    h.tel.tutorialStep(0, 14);
    h.advance(5000);
    h.tel.tutorialStep(1, 14);
    h.advance(9000);
    h.tel.tutorialStep(0, 14); // replayed, or a second player: back to step 0
    h.advance(3000);
    h.tel.tutorialStep(1, 14);
    expect(h.sent.map((e) => (e.type === 'tutorial_step' ? e.prevMs : -1))).toEqual([0, 5000, 0, 3000]);
  });

  it('marks dev traffic', () => {
    const h = harness({ dev: true });
    h.tel.sessionStart('sandbox', 'three');
    expect(h.sent[0]).toMatchObject({ dev: true });
  });

  it('the no-op never throws', () => {
    expect(() => {
      NOOP_TELEMETRY.sessionStart('menu', 'three');
      const m = NOOP_TELEMETRY.missionStarted('m', false, () => { throw new Error('never read'); });
      m.onEvent(endEvent('victory'));
      m.end();
      NOOP_TELEMETRY.tutorialStep(0, 1);
      NOOP_TELEMETRY.campaignProgress('m', 1);
    }).not.toThrow();
  });

  it('starting a new mission auto-ends the previous one as abandoned', () => {
    reset();
    const h = harness();
    state = { ...state, tick: 100 };
    h.tel.missionStarted('m1', false, view);
    state = { ...state, tick: 250 };
    const m2 = h.tel.missionStarted('m2', false, view);
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ mission: 'm1', result: 'abandoned', tick: 250 });
    m2.end();
    const ends2 = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends2).toHaveLength(2);
    expect(ends2[0]).toMatchObject({ mission: 'm1', result: 'abandoned' });
    expect(ends2[1]).toMatchObject({ mission: 'm2', result: 'abandoned' });
  });

  it('mission_start carries the loadout it was given', () => {
    reset();
    const h = harness();
    h.tel.missionStarted('m1', false, view, { deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } });
    expect(h.sent.find((e) => e.type === 'mission_start')).toMatchObject({ deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } });
  });

  it('counts orders by verb and dock buys by type, and delivers them on the one mission_end', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    m.onIntent({ kind: 'order', verb: 'move', ids: [1], x: 0, y: 0, append: false });
    m.onIntent({ kind: 'order', verb: 'move', ids: [1], x: 1, y: 1, append: false });
    m.onIntent({ kind: 'select', ids: [1], via: 'click' });
    m.onIntent({ kind: 'support', call: 'air_strike', x: 0, y: 0, accepted: false });
    m.onBought('inf_squad');
    m.onBought('inf_squad');
    m.onBought('mbt_lavi');
    state = { ...state, result: 'victory' };
    m.onEvent(endEvent('victory'));
    m.onIntent({ kind: 'halt', ids: [1] }); // after the end: not counted, not sent
    m.end();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ orders: { move: 2 }, bought: { inf_squad: 2, mbt_lavi: 1 } });
    expect(ends[0]).not.toHaveProperty('orders.halt');
  });

  it('counts start from zero for each mission', () => {
    reset();
    const h = harness();
    const a = h.tel.missionStarted('m1', false, view);
    a.onIntent({ kind: 'halt', ids: [1] });
    const b = h.tel.missionStarted('m2', false, view); // auto-ends m1 as abandoned
    b.end();
    const ends = h.sent.filter((e) => e.type === 'mission_end');
    expect(ends.map((e) => (e.type === 'mission_end' ? e.orders : null))).toEqual([{ halt: 1 }, {}]);
  });

  it('account() sends a contract-valid snapshot with its extras', () => {
    const h = harness();
    h.tel.account('purchase', { balance: 60, earned_total: 900, unlocks: ['mbt_lavi'], upgrades: { inf_squad: { armour: 1 } } }, { item: 'inf_squad.armour.1', price: 115 });
    expect(h.sent).toEqual([expect.objectContaining({ type: 'account', reason: 'purchase', credits: 60, tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 })]);
    expect(isTelemetryEvent(h.sent[0])).toBe(true);
  });

  it('a throwing account read is swallowed, never thrown into the game', () => {
    const h = harness();
    const bad = { get balance(): number { throw new Error('storage blew up'); }, earned_total: 0, unlocks: [], upgrades: {} };
    expect(() => h.tel.account('reset', bad)).not.toThrow();
    expect(h.sent).toEqual([]);
  });

  it('the no-op has every new method, and none of them reads its arguments', () => {
    const trap = new Proxy({}, { get: () => { throw new Error('read'); } });
    expect(() => {
      NOOP_TELEMETRY.account('reset', trap as never);
      const m = NOOP_TELEMETRY.missionStarted('m', false, () => { throw new Error('never read'); }, trap as never);
      m.onIntent(trap as never);
      m.onBought('inf_squad');
      m.end();
    }).not.toThrow();
  });
});

// GH-1410: the field signal.
const RAW_GPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002487) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)';
const GEAR = { preset: 'medium' as const, backend: 'webgl2' as const, gpu: RAW_GPU };
const crash = (n: number) => ({ name: 'TypeError', message: `m${n}`, hash: String(n).padStart(8, '0') });

describe('Telemetry: boot', () => {
  it('sends one boot with the time to first frame, the backend, the preset and the GPU name, and ignores a second', () => {
    const h = harness({ gear: () => GEAR });
    h.tel.boot(2310.4);
    h.tel.boot(9999);
    const boots = h.sent.filter((e) => e.type === 'boot');
    expect(boots).toHaveLength(1);
    expect(boots[0]).toMatchObject({ ttffMs: 2310, backend: 'webgl2', preset: 'medium', gpu: 'NVIDIA RTX 30-series' });
    // The raw renderer string, its PCI id and its driver build never reach the event.
    expect(JSON.stringify(boots[0])).not.toMatch(/0x00002487|D3D11|31\.0\.15|ANGLE/);
    expect(isTelemetryEvent(boots[0])).toBe(true);
  });

  it('omits the GPU when the browser will not say, and a boot event still validates', () => {
    const h = harness({ gear: () => ({ ...GEAR, gpu: null }) });
    h.tel.boot(10);
    expect('gpu' in (h.sent[0] as object)).toBe(false);
    expect(isTelemetryEvent(h.sent[0])).toBe(true);
  });
});

describe('Telemetry: client_error', () => {
  it('sends the error with the mission it happened in, and flushes at once', () => {
    reset();
    const h = harness();
    h.tel.missionStarted('m1', false, view);
    h.tel.clientError(crash(1));
    const e = h.sent.find((x) => x.type === 'client_error');
    expect(e).toMatchObject({ name: 'TypeError', message: 'm1', hash: '00000001', screen: 'mission', mission: 'm1' });
    expect(isTelemetryEvent(e)).toBe(true);
    expect(h.flushes.length).toBeGreaterThan(0);
  });

  it('outside a mission it names no mission and no screen', () => {
    const h = harness();
    h.tel.clientError(crash(2));
    expect(h.sent[0]).not.toHaveProperty('mission');
    expect(h.sent[0]).not.toHaveProperty('screen');
  });

  it(`sends one crash at most ${ERROR_SAME_CAP} times, and ${ERROR_CAP} errors in all, so a loop cannot flood the Worker`, () => {
    const h = harness();
    for (let i = 0; i < 50; i++) h.tel.clientError(crash(7));
    expect(h.sent.filter((e) => e.type === 'client_error')).toHaveLength(ERROR_SAME_CAP);
    for (let i = 100; i < 200; i++) h.tel.clientError(crash(i));
    expect(h.sent.filter((e) => e.type === 'client_error')).toHaveLength(ERROR_CAP);
  });

  it('after the mission ends a later error carries no mission', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    m.end();
    h.tel.clientError(crash(3));
    expect(h.sent.find((e) => e.type === 'client_error')).not.toHaveProperty('mission');
  });
});

describe('Telemetry: perf_sample', () => {
  const frames = (h: ReturnType<typeof harness>, m: { onFrame(ms: number): void }, n: number, ms: number) => {
    for (let i = 0; i < n; i++) m.onFrame(ms);
    void h;
  };

  it(`closes a sample after ${PERF_SAMPLE_MS / 1000} s with the percentiles, the unit count, the preset, the backend and the GPU`, () => {
    reset();
    state = { ...state, living: 266 };
    const h = harness({ gear: () => GEAR });
    const m = h.tel.missionStarted('m1', false, view);
    frames(h, m, PERF_MIN_FRAMES, 16.7);
    expect(h.sent.filter((e) => e.type === 'perf_sample')).toHaveLength(0); // the window is not over
    h.advance(PERF_SAMPLE_MS);
    m.onFrame(50);
    const p = h.sent.find((e) => e.type === 'perf_sample');
    expect(p).toMatchObject({ mission: 'm1', units: 266, preset: 'medium', backend: 'webgl2', gpu: 'NVIDIA RTX 30-series', frames: PERF_MIN_FRAMES + 1, p50: 16.7, p95: 16.7 });
    expect(isTelemetryEvent(p)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/0x00002487|D3D11|ANGLE/);
  });

  it('units fall back to fielded - lost when the view carries no living count', () => {
    reset();
    state = { ...state, fielded: 12, lost: 4 };
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    frames(h, m, PERF_MIN_FRAMES, 16);
    h.advance(PERF_SAMPLE_MS);
    m.onFrame(16);
    expect(h.sent.find((e) => e.type === 'perf_sample')).toMatchObject({ units: 8 });
  });

  it('a window with too few frames (a paused mission) is not a sample, and the next window starts clean', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    frames(h, m, PERF_MIN_FRAMES - 10, 16);
    h.advance(PERF_SAMPLE_MS);
    m.onFrame(16);
    expect(h.sent.filter((e) => e.type === 'perf_sample')).toHaveLength(0);
    frames(h, m, PERF_MIN_FRAMES, 20);
    h.advance(PERF_SAMPLE_MS);
    m.onFrame(20);
    const p = h.sent.filter((e) => e.type === 'perf_sample');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ p50: 20 }); // none of the 16 ms frames of the first window
  });

  it('a hidden tab samples nothing, and an ended mission samples nothing', () => {
    reset();
    const h = harness();
    const m = h.tel.missionStarted('m1', false, view);
    h.setVisible(false);
    frames(h, m, PERF_MIN_FRAMES * 2, 16);
    h.advance(PERF_SAMPLE_MS);
    m.onFrame(16);
    h.setVisible(true);
    m.end();
    frames(h, m, PERF_MIN_FRAMES * 2, 16);
    h.advance(PERF_SAMPLE_MS);
    m.onFrame(16);
    expect(h.sent.filter((e) => e.type === 'perf_sample')).toHaveLength(0);
  });
});

describe('Telemetry: ids() respects a live opt-out', () => {
  it('answers the ids while reports are on and null once the opt-out is set', () => {
    let out = false;
    const h = harness({ optedOut: () => out });
    expect(h.tel.ids()).toEqual({ player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7' });
    out = true;
    expect(h.tel.ids()).toBeNull();
  });
});

describe('gatedSink: the opt-out is read live', () => {
  function inner() {
    const log: string[] = [];
    return {
      log,
      push: (e: TelemetryEvent) => void log.push(`push:${e.type}`),
      flush: (b?: boolean) => void log.push(`flush:${String(b ?? false)}`),
      clear: () => void log.push('clear'),
    };
  }
  const ev = { v: 1, type: 'boot', player: 'p', session: 's', build: '0.1.0', t: 1, ttffMs: 1, backend: 'webgl2', preset: 'high' } as unknown as TelemetryEvent;

  it('passes events and flushes through while the player has not opted out', () => {
    const i = inner();
    const g = gatedSink(i, () => false);
    g.push(ev);
    g.flush(true);
    expect(i.log).toEqual(['push:boot', 'flush:true']);
  });

  it('once opted out it drops the event and EMPTIES the queue, on a push and on a flush alike', () => {
    let out = false;
    const i = inner();
    const g = gatedSink(i, () => out);
    g.push(ev);
    out = true;
    g.push(ev);
    g.flush();
    expect(i.log).toEqual(['push:boot', 'clear', 'clear']);
  });
});
