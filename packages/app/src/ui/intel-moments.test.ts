import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@lions/sim';
import type { SupportKind } from './support-kinds';
import {
  CLOCK_SECONDS_UNDER,
  IntelMoments,
  IntelRate,
  STRIKE_READOUT_DELAY_TICKS,
  chargeClock,
  sweptContacts,
  type IntelLook,
  type IntelOutput,
} from './intel-moments';

const FX = 65536;
const toFx = (n: number): number => Math.round(n * FX);

// --- the rate and the clock ---------------------------------------------------

describe('IntelRate', () => {
  /** A counter accruing `perMin` exactly as the runtime does -- a fraction a
   *  tick -- and reported floored, as `runtime.intel` is. */
  function feed(rate: IntelRate, perMin: number, from: number, ticks: number, start = 0): number {
    let v = start;
    for (let k = 0; k < ticks; k++) {
      v += perMin / 1200;
      rate.push(from + k, Math.floor(v));
    }
    return v;
  }

  it('reads a constant income to within a tenth of a point a minute, floored input and all', () => {
    for (const perMin of [5, 8, 13, 25, 28]) {
      const r = new IntelRate();
      feed(r, perMin, 0, 1200);
      expect(Math.abs(r.perMin() - perMin)).toBeLessThan(0.1);
    }
  });

  it('ignores spending: a drop is not income', () => {
    const r = new IntelRate();
    let v = feed(r, 25, 0, 600, 252);
    v -= 150;
    r.push(600, Math.floor(v));
    feed(r, 25, 601, 600, v);
    expect(Math.abs(r.perMin() - 25)).toBeLessThan(0.1);
  });

  it('reads 0 once nothing has come in for a whole window', () => {
    const r = new IntelRate();
    feed(r, 25, 0, 600);
    for (let k = 600; k < 600 + 30 * 20 + 2; k++) r.push(k, 300);
    expect(r.perMin()).toBe(0);
    expect(r.ticksTo(400, 300)).toBe(Infinity);
  });

  it('counts down to the tick the cost is reached', () => {
    const r = new IntelRate();
    const v = feed(r, 24, 0, 1200, 100);
    const intel = Math.floor(v);
    // 24/min is 0.02 a tick: 150 - 124 = 26 more is 1300 ticks.
    expect(r.ticksTo(150, intel)).toBeGreaterThan(1290);
    expect(r.ticksTo(150, intel)).toBeLessThan(1310);
    expect(r.ticksTo(100, intel)).toBe(0);
  });
});

describe('chargeClock', () => {
  it('reads ready, m:ss under two minutes, whole minutes above, and a dash when nothing comes in', () => {
    expect(chargeClock(0)).toEqual({ kind: 'ready' });
    expect(chargeClock(Infinity)).toEqual({ kind: 'none' });
    expect(chargeClock(99 * 20)).toEqual({ kind: 'mss', text: '1:39' });
    expect(chargeClock(CLOCK_SECONDS_UNDER * 20 - 1)).toEqual({ kind: 'mss', text: '2:00' });
    expect(chargeClock(CLOCK_SECONDS_UNDER * 20)).toEqual({ kind: 'minutes', n: 2 });
    expect(chargeClock(382 * 20)).toEqual({ kind: 'minutes', n: 6 });
  });
});

// --- a board ------------------------------------------------------------------

interface Piece {
  side: number;
  x: number;
  y: number;
  type?: number;
  hp?: number;
  tunnel?: number;
  alive?: number;
}
function board(pieces: Piece[]): IntelLook & { state: { hp: Int32Array; alive: Uint8Array } } {
  const n = pieces.length;
  const state = {
    alive: new Uint8Array(pieces.map((p) => p.alive ?? 1)),
    side: new Uint8Array(pieces.map((p) => p.side)),
    typeIdx: new Uint16Array(pieces.map((p) => p.type ?? 0)),
    posX: new Int32Array(pieces.map((p) => toFx(p.x))),
    posY: new Int32Array(pieces.map((p) => toFx(p.y))),
    hp: new Int32Array(pieces.map((p) => toFx(p.hp ?? 100))),
    tunnelIn: new Int32Array(pieces.map((p) => p.tunnel ?? -1)),
  };
  return { entityCount: n, state, unitTypes: [{ name: 'Sarim Rifles' }, { name: 'Recoilless Team' }, { name: 'Civilians' }] };
}

/** The sim's provisional price row (mission.ts SUPPORT_COST), as literals. */
const PRICE: Readonly<Record<SupportKind, number>> = { smoke_screen: 60, mortar_barrage: 120, drone_sweep: 150, air_strike: 250 };
const supportCost = (k: SupportKind): number => PRICE[k];
const moments = (): IntelMoments => new IntelMoments({ supportCost, toFx });
const of = <K extends IntelOutput['kind']>(outs: IntelOutput[], kind: K): Extract<IntelOutput, { kind: K }>[] =>
  outs.filter((o): o is Extract<IntelOutput, { kind: K }> => o.kind === kind);

describe('the sweep readout', () => {
  // A sweep at (33, 10), radius sqrt(60) = 7.746 tiles.
  const pieces: Piece[] = [
    { side: 1, x: 33, y: 10 }, // 0: centre
    { side: 1, x: 36, y: 12 }, // 1: inside
    { side: 1, x: 33, y: 17.7, type: 1 }, // 2: inside, 7.7 out
    { side: 1, x: 33, y: 17.8 }, // 3: OUTSIDE, 7.8 out
    { side: 1, x: 34, y: 10, tunnel: 0 }, // 4: underground: never identified
    { side: 1, x: 32, y: 9, alive: 0 }, // 5: dead
    { side: 2, x: 33, y: 11, type: 2 }, // 6: a civilian: in the area, not a contact
    { side: 0, x: 33, y: 12 }, // 7: ours
  ];

  it('names exactly whom the sim rule identifies: living, hostile, on the surface, inside the radius', () => {
    const b = board(pieces);
    const snap = { count: b.entityCount, ...b.state };
    expect(sweptContacts(snap, toFx(33), toFx(10))).toEqual([0, 1, 2]);
  });

  it('says the count, breaks it down by type, names the civilians and rings each contact', () => {
    const b = board(pieces);
    const m = moments();
    m.afterTick(b, 1, [], 252);
    m.called('drone_sweep', 33, 10, 1);
    m.beforeTick(b);
    const revealed: SimEvent = { kind: 'revealed', tick: 2, side: 0, count: 3 };
    const outs = m.afterTick(b, 2, [revealed], 102);
    expect(of(outs, 'note')[0]).toMatchObject({ key: 'intel.note.sweepResult', params: { n: 3 }, tier: 'major' });
    expect(of(outs, 'breakdown')[0]).toEqual({
      kind: 'breakdown',
      types: [
        { name: 'Sarim Rifles', n: 2 },
        { name: 'Recoilless Team', n: 1 },
      ],
      civilians: 1,
    });
    const ring = of(outs, 'flash')[0];
    expect(ring).toMatchObject({ tier: 'minor', tone: 'info' });
    expect(ring.points).toEqual([
      { x: 33, y: 10 },
      { x: 36, y: 12 },
      { x: 33, y: toFx(17.7) / FX },
    ]);
  });
});

describe('the strike readout', () => {
  it('lands 0.7 s after the round and counts what the splash hit, never Conduct', () => {
    const b = board([
      { side: 1, x: 17.5, y: 8.5 }, // 0: killed
      { side: 1, x: 18.5, y: 8.5 }, // 1: hit
      { side: 1, x: 22, y: 8.5 }, // 2: outside the splash, hurt by something else
      { side: 2, x: 17.5, y: 9.5, type: 2 }, // 3: a civilian, killed
    ]);
    const m = moments();
    m.afterTick(b, 1, [], 252);
    const called = m.called('air_strike', 17.5, 8.5, 1);
    expect(of(called, 'note')[0]).toMatchObject({ key: 'intel.note.strikeInbound', params: { n: 3 }, tone: 'warn' });
    expect(of(called, 'announce')[0].event).toBe('strike_inbound');
    m.beforeTick(b);
    b.state.hp[1] -= toFx(30);
    b.state.hp[2] -= toFx(30);
    b.state.alive[0] = 0;
    b.state.alive[3] = 0;
    const events: SimEvent[] = [
      { kind: 'strike', tick: 61, by: 9, x: toFx(17.5), y: toFx(8.5), profile: 0 },
      { kind: 'destroyed', tick: 61, entity: 0, by: 9 },
      { kind: 'destroyed', tick: 61, entity: 3, by: 9 },
    ];
    expect(of(m.afterTick(b, 61, events, 2), 'strikeResult')).toHaveLength(0);
    for (let k = 62; k < 61 + STRIKE_READOUT_DELAY_TICKS; k++) expect(of(m.afterTick(b, k, [], 2), 'strikeResult')).toHaveLength(0);
    const r = of(m.afterTick(b, 61 + STRIKE_READOUT_DELAY_TICKS, [], 2), 'strikeResult');
    expect(r).toEqual([{ kind: 'strikeResult', down: 1, hit: 1, building: false, civiliansKilled: 1 }]);
  });
});

describe('ready', () => {
  it('says a call is ready once, on the tick it becomes affordable, and not at the start', () => {
    const b = board([]);
    const m = moments();
    expect(m.afterTick(b, 1, [], 252)).toEqual([]);
    expect(m.afterTick(b, 2, [], 130)).toEqual([]);
    const outs = m.afterTick(b, 3, [], 150);
    expect(of(outs, 'ready')).toEqual([{ kind: 'ready', support: 'drone_sweep' }]);
    expect(of(outs, 'announce')).toEqual([{ kind: 'announce', event: 'sweep_ready' }]);
    expect(of(outs, 'note')).toEqual([
      { kind: 'note', key: 'intel.note.ready', params: { kind: 'drone_sweep' }, tone: 'info', tier: 'minor' },
    ]);
    expect(m.afterTick(b, 4, [], 151)).toEqual([]);
  });

  it('two prices crossed in one tick: every tile flashes, one line, one voice (Review Focus 2)', () => {
    const b = board([]);
    const m = moments();
    expect(m.afterTick(b, 1, [], 50)).toEqual([]);
    const outs = m.afterTick(b, 2, [], 130);
    expect(of(outs, 'ready')).toEqual([
      { kind: 'ready', support: 'smoke_screen' },
      { kind: 'ready', support: 'mortar_barrage' },
    ]);
    expect(of(outs, 'note')).toEqual([
      { kind: 'note', key: 'intel.note.ready', params: { kind: 'mortar_barrage' }, tone: 'info', tier: 'minor' },
    ]);
    expect(of(outs, 'announce')).toEqual([{ kind: 'announce', event: 'barrage_ready' }]);
  });

  it('names each of the four calls by its own announcement when it alone crosses', () => {
    const cases: [SupportKind, number, number, string][] = [
      ['smoke_screen', 50, 60, 'screen_ready'],
      ['mortar_barrage', 100, 120, 'barrage_ready'],
      ['drone_sweep', 140, 150, 'sweep_ready'],
      ['air_strike', 200, 250, 'strike_ready'],
    ];
    for (const [kind, before, after, event] of cases) {
      const b = board([]);
      const m = moments();
      m.afterTick(b, 1, [], before);
      const outs = m.afterTick(b, 2, [], after);
      expect(of(outs, 'ready'), kind).toEqual([{ kind: 'ready', support: kind }]);
      expect(of(outs, 'announce'), kind).toEqual([{ kind: 'announce', event }]);
    }
  });
});

// --- the four calls (S-F Task 5) ----------------------------------------------

/** A board whose `entityCount` read is counted: `beforeTick` reads it only
 *  when it takes a snapshot, and nothing else in this module reads it. */
function spied(b: IntelLook): { look: IntelLook; reads: () => number } {
  let n = 0;
  const look: IntelLook = {
    get entityCount() {
      n++;
      return b.entityCount;
    },
    state: b.state,
    unitTypes: b.unitTypes,
  };
  return { look, reads: () => n };
}

describe('called, per kind', () => {
  const cases: [SupportKind, string, Record<string, number>, 'info' | 'warn', string][] = [
    ['smoke_screen', 'intel.note.screenInbound', { n: 4 }, 'info', 'screen_inbound'],
    ['mortar_barrage', 'intel.note.barrageInbound', { n: 6 }, 'warn', 'barrage_inbound'],
    ['drone_sweep', 'intel.note.sweepInbound', {}, 'info', 'sweep_inbound'],
    ['air_strike', 'intel.note.strikeInbound', { n: 3 }, 'warn', 'strike_inbound'],
  ];
  for (const [kind, key, params, tone, event] of cases) {
    it(`${kind}: its own line, voice and ring`, () => {
      const outs = moments().called(kind, 12, 7, 1);
      expect(outs).toEqual([
        { kind: 'note', key, params, tone, tier: 'important' },
        { kind: 'announce', event },
        { kind: 'flash', points: [{ x: 12, y: 7 }], tier: 'important', tone },
      ]);
    });
  }

  it('a smoke screen keeps nothing in flight: no snapshot after it', () => {
    const { look, reads } = spied(board([{ side: 1, x: 12, y: 7 }]));
    const m = moments();
    m.called('smoke_screen', 12, 7, 1);
    for (let k = 2; k < 200; k++) {
      m.beforeTick(look);
      m.afterTick(look, k, [], 0);
    }
    expect(reads()).toBe(0);
  });
});

describe('the barrage readout', () => {
  // Rounds land at the barrage's own ticks: called on 1, the command runs on
  // 2, the first round 120 ticks later and one every 36 after it.
  const ROUND_TICKS = [122, 158, 194, 230, 266, 302];
  const round = (tick: number, x: number, y: number): SimEvent => ({ kind: 'strike', tick, by: 9, x: toFx(x), y: toFx(y), profile: 1 });

  /** Runs a barrage on `b` from tick 2 to `last`, calling `onRound` after the
   *  snapshot of each round's tick, and returns every output by tick. */
  function run(
    b: ReturnType<typeof board>,
    m: IntelMoments,
    last: number,
    onRound: (k: number) => SimEvent[]
  ): Map<number, IntelOutput[]> {
    const said = new Map<number, IntelOutput[]>();
    for (let k = 2; k <= last; k++) {
      m.beforeTick(b);
      const events = ROUND_TICKS.includes(k) ? onRound(k) : [];
      const outs = m.afterTick(b, k, events, 0);
      if (outs.length > 0) said.set(k, outs);
    }
    return said;
  }

  function scene(): { b: ReturnType<typeof board>; said: Map<number, IntelOutput[]> } {
    const b = board([
      { side: 1, x: 20, y: 10 }, // 0: killed by round 2
      { side: 1, x: 20.5, y: 10 }, // 1: hurt by round 4
      { side: 1, x: 30, y: 10 }, // 2: hurt, but by something else, far outside every splash
    ]);
    const m = moments();
    m.afterTick(b, 1, [], 0);
    m.called('mortar_barrage', 20, 10, 1);
    const said = run(b, m, 302 + STRIKE_READOUT_DELAY_TICKS + 40, (k) => {
      const ev: SimEvent[] = [round(k, 20, 10)];
      if (k === 158) {
        b.state.alive[0] = 0;
        ev.push({ kind: 'destroyed', tick: k, entity: 0, by: 9 });
      }
      if (k === 230) {
        b.state.hp[1] -= toFx(20);
        b.state.hp[2] -= toFx(20);
      }
      return ev;
    });
    return { b, said };
  }

  it('a barrage reports once, after its sixth round', () => {
    const { said } = scene();
    const results = [...said.entries()].flatMap(([k, outs]) => of(outs, 'barrageResult').map((r) => [k, r] as const));
    expect(results).toEqual([
      [302 + STRIKE_READOUT_DELAY_TICKS, { kind: 'barrageResult', down: 1, hit: 1, building: false, civiliansKilled: 0 }],
    ]);
  });

  it('a profile-1 round is never read as a precision strike', () => {
    const { said } = scene();
    expect([...said.values()].flatMap((outs) => of(outs, 'strikeResult'))).toEqual([]);
  });

  it('counts a civilian killed and a building hit by the caller, and a man hurt then killed only as down', () => {
    const b = board([
      { side: 1, x: 20, y: 10 }, // 0: hurt by round 1, killed by round 3
      { side: 2, x: 20, y: 10.5, type: 2 }, // 1: a civilian, killed by round 5
    ]);
    const m = moments();
    m.afterTick(b, 1, [], 0);
    m.called('mortar_barrage', 20, 10, 1);
    const said = run(b, m, 302 + STRIKE_READOUT_DELAY_TICKS, (k) => {
      const ev: SimEvent[] = [round(k, 20, 10)];
      if (k === 122) b.state.hp[0] -= toFx(20);
      if (k === 194) {
        b.state.alive[0] = 0;
        ev.push({ kind: 'destroyed', tick: k, entity: 0, by: 9 });
      }
      if (k === 266) {
        b.state.alive[1] = 0;
        ev.push({ kind: 'destroyed', tick: k, entity: 1, by: 9 });
        ev.push({ kind: 'structureHit', tick: k, structure: 0, by: 9, damage: toFx(10), hpLeft: toFx(90) });
      }
      return ev;
    });
    expect(of(said.get(302 + STRIKE_READOUT_DELAY_TICKS) ?? [], 'barrageResult')).toEqual([
      { kind: 'barrageResult', down: 1, hit: 0, building: true, civiliansKilled: 1 },
    ]);
  });

  it('a barrage whose rounds never come expires silently (Review Focus 3)', () => {
    const { look, reads } = spied(board([{ side: 1, x: 20, y: 10 }]));
    const m = moments();
    m.afterTick(look, 1, [], 0);
    m.called('mortar_barrage', 20, 10, 1);
    // until = 1 + 120 + 5 * 36 + 20 = 321: snapshots run through it, then stop.
    const said: IntelOutput[] = [];
    for (let k = 2; k <= 400; k++) {
      m.beforeTick(look);
      said.push(...m.afterTick(look, k, [], 0));
    }
    expect(said).toEqual([]);
    const before = reads();
    expect(before).toBeGreaterThan(0);
    for (let k = 401; k <= 420; k++) {
      m.beforeTick(look);
      m.afterTick(look, k, [], 0);
    }
    expect(reads()).toBe(before);
  });

  it('a barrage cut short reports what landed when its window closes', () => {
    const b = board([{ side: 1, x: 20, y: 10 }]);
    const m = moments();
    m.afterTick(b, 1, [], 0);
    m.called('mortar_barrage', 20, 10, 1);
    const said = new Map<number, IntelOutput[]>();
    for (let k = 2; k <= 400; k++) {
      m.beforeTick(b);
      let events: SimEvent[] = [];
      if (k === 122) {
        b.state.alive[0] = 0;
        events = [round(k, 20, 10), { kind: 'destroyed', tick: k, entity: 0, by: 9 }];
      }
      const outs = m.afterTick(b, k, events, 0);
      if (outs.length > 0) said.set(k, outs);
    }
    expect([...said.entries()]).toEqual([[322, [{ kind: 'barrageResult', down: 1, hit: 0, building: false, civiliansKilled: 0 }]]]);
  });
});

describe('dispose', () => {
  it('says nothing after it, not even a readout already on its way', () => {
    const b = board([{ side: 1, x: 17.5, y: 8.5 }]);
    const m = moments();
    m.afterTick(b, 1, [], 252);
    m.called('air_strike', 17.5, 8.5, 1);
    m.beforeTick(b);
    b.state.hp[0] -= toFx(30);
    m.afterTick(b, 61, [{ kind: 'strike', tick: 61, by: 9, x: toFx(17.5), y: toFx(8.5), profile: 0 }], 2);
    m.dispose();
    expect(m.afterTick(b, 61 + STRIKE_READOUT_DELAY_TICKS, [], 150)).toEqual([]);
    expect(m.called('drone_sweep', 1, 1, 80)).toEqual([]);
  });
});

// N1a task 6: a seat on side 1 sweeps and strikes side 0, its `revealed` is
// the one carrying side 1, and a civilian is never a contact for either seat.
describe('a seat on side 1 (N1a task 6)', () => {
  const pieces: Piece[] = [
    { side: 0, x: 33, y: 10 }, // 0: the enemy to this seat, centre
    { side: 0, x: 36, y: 12 }, // 1: inside
    { side: 1, x: 33, y: 12 }, // 2: ours
    { side: 2, x: 33, y: 11, type: 2 }, // 3: a civilian
  ];
  const seat1 = (): IntelMoments => new IntelMoments({ supportCost, toFx, viewer: 1 });

  it('sweeps side 0, never its own side or a civilian', () => {
    const b = board(pieces);
    const snap = { count: b.entityCount, ...b.state };
    expect(sweptContacts(snap, toFx(33), toFx(10), 1)).toEqual([0, 1]);
    expect(sweptContacts(snap, toFx(33), toFx(10), 0)).toEqual([2]);
  });

  it('reads its own `revealed`, and ignores side 0\'s', () => {
    const run = (side: number): IntelOutput[] => {
      const b = board(pieces);
      const m = seat1();
      m.afterTick(b, 1, [], 252);
      m.called('drone_sweep', 33, 10, 1);
      m.beforeTick(b);
      return m.afterTick(b, 2, [{ kind: 'revealed', tick: 2, side, count: 2 }], 102);
    };
    expect(of(run(1), 'note')[0]).toMatchObject({ key: 'intel.note.sweepResult', params: { n: 2 } });
    expect(of(run(0), 'note')).toEqual([]);
  });

  it('counts side 0 down and hit in its strike readout', () => {
    const b = board([
      { side: 0, x: 17.5, y: 8.5 }, // 0: killed
      { side: 0, x: 18.5, y: 8.5 }, // 1: hit
      { side: 1, x: 17.5, y: 9.0 }, // 2: ours, hit by our own strike: not counted
    ]);
    const m = seat1();
    m.afterTick(b, 1, [], 252);
    m.called('air_strike', 17.5, 8.5, 1);
    m.beforeTick(b);
    b.state.hp[1] -= toFx(30);
    b.state.hp[2] -= toFx(30);
    b.state.alive[0] = 0;
    const events: SimEvent[] = [
      { kind: 'strike', tick: 61, by: 9, x: toFx(17.5), y: toFx(8.5), profile: 0 },
      { kind: 'destroyed', tick: 61, entity: 0, by: 9 },
    ];
    m.afterTick(b, 61, events, 2);
    for (let k = 62; k < 61 + STRIKE_READOUT_DELAY_TICKS; k++) m.afterTick(b, k, [], 2);
    expect(of(m.afterTick(b, 61 + STRIKE_READOUT_DELAY_TICKS, [], 2), 'strikeResult')).toEqual([
      { kind: 'strikeResult', down: 1, hit: 1, building: false, civiliansKilled: 0 },
    ]);
  });
});
