import { describe, it, expect } from 'vitest';
import type { TelemetryEvent } from '@lions/data/telemetry';
import type { MissionEvent } from '@lions/sim';
import { createTelemetry, NOOP_TELEMETRY, type TelemetryDeps } from './index';
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
});
