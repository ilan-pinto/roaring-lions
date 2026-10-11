/**
 * GH-113: the presentation weight of the two intel calls -- the satellite
 * sweep and the precision strike -- approved by the lead on 2026-10-11 as
 * direction A of `docs/polish/intel-moments.md` plus two pieces of B: the
 * strike's footprint under the armed cursor and the sweep's breakdown with a
 * minimap ring per contact. "Announcement yes; fireworks no."
 *
 * Pure: no DOM, no audio, no clock of its own, and nothing it computes ever
 * reaches the sim (invariant 4). It READS a `Sim` -- positions, hit points,
 * contact levels, the tick's events -- and returns what to say, which
 * `main.ts` hands to the HUD's own `note()`, the minimap's own `flash()` and
 * the announcer's own table. Every line is a catalogue KEY with params,
 * resolved by the caller at render time (the `alerts.ts` convention: a table
 * resolved at import time freezes in whatever locale was active before boot).
 *
 * Four jobs:
 *
 *  - RATE. The intel rate is measured from what the runtime reports, never
 *    re-derived from the sim's accrual rule (a second copy of a game rule in
 *    `app` is the thing CLAUDE.md forbids). `runtime.intel` is FLOORED, so a
 *    rate taken from two samples of it is off by up to a whole point; the
 *    estimator instead times the integer CROSSINGS, which are exact for a
 *    constant rate. It answers the strip's `+N/min` and the tile's clock.
 *  - READY. A call that becomes affordable says so once: a minor feed line,
 *    one announcer line, the tile's border for `READY_FLASH_MS`.
 *  - CALL. "inbound -- 3 s" / "on the way" replaces "called on (x, y)"; one
 *    announcer line; an important minimap ring at the target, info for a
 *    sweep and warn for a strike (GH-461's language: info settles in, warn
 *    spreads out).
 *  - RESULT. The sweep: a major line with the count, a breakdown by type, and
 *    a minor ring on every contact it identified -- those contacts draw
 *    nowhere else, because the world and the minimap both skip a hostile the
 *    player does not observe (finding 2 of the mock). The strike: one line,
 *    0.7 s after the round, saying what it hit. Never the Conduct number: the
 *    ROE lines price it on the same tick.
 */

import type { SimEvent } from '@lions/sim';
import { TICKS_PER_SECOND } from '@lions/sim';
import type { AlertTier } from './alerts';
import { clockText, type Tone } from './hud-model';

export type SupportKind = 'sweep' | 'strike';

/**
 * The sim's own numbers for the two calls, COPIED from
 * `packages/sim/src/tuning.ts` and never exported from it -- the same rule
 * `render`'s `PROJ_SPEED` copy follows. `intel-moments.test.ts` reads
 * tuning.ts as TEXT and fails the moment either side moves.
 */
export const SWEEP_RADIUS_SQ_FX = 3932160; // tuning.ts SWEEP_RADIUS_SQ: 60 tile^2
export const STRIKE_SPLASH_FX = 131072; // tuning.ts STRIKE_SPLASH: 2.0 tiles
export const STRIKE_DELAY_TICKS = 60; // tuning.ts STRIKE_DELAY_TICKS: 3 s
/** The strike's splash in tiles, for the footprint. */
export const STRIKE_SPLASH_TILES = STRIKE_SPLASH_FX / 65536;

/** How much history the rate is measured over. Long enough that the slowest
 *  real income -- one holding scout, 5/min, a crossing every 12 s -- still
 *  has two crossings inside it; short enough that a force starting to move
 *  shows in the clock within half a minute. */
export const INTEL_RATE_WINDOW_TICKS = 30 * TICKS_PER_SECOND;

/** The readout lands this long after the round: the impact is the
 *  renderer's moment, the sentence is the commander's. On the SIM clock, so
 *  a paused game holds it and nothing needs a timer to dispose. */
export const STRIKE_READOUT_DELAY_TICKS = Math.round(0.7 * TICKS_PER_SECOND);

/** How long the tile's border says "ready", ms on the frame clock. */
export const READY_FLASH_MS = 1600;

/** Under this the clock reads m:ss; above it, whole minutes (decision 3):
 *  the rate moves as units start and stop, and a second hand that jumps a
 *  minute either way is a clock nobody can trust. */
export const CLOCK_SECONDS_UNDER = 120;

/** Distance squared in Q16.16 exactly as the sim's private `distSqFx`
 *  computes it, so a contact on the boundary is in or out for both. */
function distSqFx(dx: number, dy: number): number {
  const x = dx >> 8;
  const y = dy >> 8;
  return (x * x + y * y) | 0;
}

/**
 * Times the integer crossings of a floored, accruing counter. Spending (a
 * drop) is not income and moves nothing; only rises count.
 */
export class IntelRate {
  /** [tick, cumulative income] at each rise, oldest first. */
  private readonly rises: [number, number][] = [];
  private income = 0;
  private last: number | null = null;
  private lastTick = 0;

  push(tick: number, intel: number): void {
    this.lastTick = tick;
    if (this.last !== null && intel > this.last) {
      this.income += intel - this.last;
      this.rises.push([tick, this.income]);
      // Keep one rise older than the window as the anchor.
      while (this.rises.length > 2 && tick - this.rises[1][0] > INTEL_RATE_WINDOW_TICKS) this.rises.shift();
    }
    this.last = intel;
  }

  /** Intel a minute, or 0 while unknown or stopped. */
  perMin(): number {
    const n = this.rises.length;
    if (n < 2) return 0;
    const [t0, i0] = this.rises[0];
    const [t1, i1] = this.rises[n - 1];
    // Nothing has come in for a whole window: whatever earned it stopped.
    if (this.lastTick - t1 > INTEL_RATE_WINDOW_TICKS) return 0;
    if (t1 <= t0) return 0;
    return ((i1 - i0) / (t1 - t0)) * TICKS_PER_SECOND * 60;
  }

  /** Ticks until `intel` reaches `cost` at the current rate: 0 when it
   *  already has, `Infinity` when nothing is coming in. */
  ticksTo(cost: number, intel: number): number {
    if (intel >= cost) return 0;
    const r = this.perMin();
    if (r <= 0) return Infinity;
    const perTick = r / (60 * TICKS_PER_SECOND);
    // `intel` is floored: the fraction earned since the last crossing is
    // still on its way to the next point, and without it the clock runs up
    // to one whole point slow (2.5 s at 24/min).
    const lastRise = this.rises[this.rises.length - 1][0];
    const frac = Math.min(0.999, Math.max(0, (this.lastTick - lastRise) * perTick));
    return (cost - intel - frac) / perTick;
  }
}

/** What the tile's corner says. `text` is final for `mss`; `minutes` is
 *  formatted by the caller through `t('dock.support.clock.minutes')`. */
export type ChargeClock =
  | { kind: 'ready' }
  | { kind: 'none' }
  | { kind: 'mss'; text: string }
  | { kind: 'minutes'; n: number };

export function chargeClock(ticksLeft: number): ChargeClock {
  if (ticksLeft <= 0) return { kind: 'ready' };
  if (!Number.isFinite(ticksLeft)) return { kind: 'none' };
  if (ticksLeft < CLOCK_SECONDS_UNDER * TICKS_PER_SECOND) return { kind: 'mss', text: clockText(ticksLeft) };
  return { kind: 'minutes', n: Math.round(ticksLeft / (60 * TICKS_PER_SECOND)) };
}

/** The footprint under the armed cursor (decision 6): the strike's splash
 *  only, and only while the strike is armed and the pointer is on the map.
 *  The sweep's 15-tile circle is not drawn. */
export function aimFootprintFor(
  armed: SupportKind | null,
  cursor: { x: number; y: number } | null
): { x: number; y: number; radius: number } | null {
  if (armed !== 'strike' || cursor === null) return null;
  return { x: cursor.x, y: cursor.y, radius: STRIKE_SPLASH_TILES };
}

/** One thing to say. `key`/`params` are catalogue entries; `parts` names
 *  the pieces `main.ts` joins into one line (each its own key). */
export type IntelOutput =
  | { kind: 'note'; key: string; params: Readonly<Record<string, string | number>>; tone: Tone; tier: AlertTier }
  | { kind: 'breakdown'; types: readonly { name: string; n: number }[]; civilians: number }
  | { kind: 'strikeResult'; down: number; hit: number; building: boolean; civiliansKilled: number }
  | { kind: 'flash'; points: readonly { x: number; y: number }[]; tier: AlertTier; tone: Tone }
  | { kind: 'announce'; event: 'sweep_ready' | 'strike_ready' | 'sweep_inbound' | 'strike_inbound' }
  | { kind: 'ready'; support: SupportKind };

/** The slice of a `Sim` this module reads. A port, so a test can describe a
 *  board instead of building one; `Sim` satisfies it as it stands. */
export interface IntelLook {
  readonly entityCount: number;
  readonly state: {
    readonly alive: Uint8Array;
    readonly side: Uint8Array;
    readonly typeIdx: Uint16Array;
    readonly posX: Int32Array;
    readonly posY: Int32Array;
    readonly hp: Int32Array;
    readonly tunnelIn: Int32Array;
  };
  readonly unitTypes: readonly { readonly name: string }[];
}

/** The board as it stood when a tick began -- which is what the sim's
 *  command step sees (a `reveal` runs before movement) and what its strike
 *  step sees (strikes resolve before movement). Grown, never reallocated per
 *  tick. */
class Snapshot {
  count = 0;
  alive = new Uint8Array(0);
  side = new Uint8Array(0);
  posX = new Int32Array(0);
  posY = new Int32Array(0);
  hp = new Int32Array(0);
  tunnelIn = new Int32Array(0);

  take(sim: IntelLook): void {
    const n = sim.entityCount;
    if (this.alive.length < n) {
      const cap = Math.max(n, this.alive.length * 2, 64);
      this.alive = new Uint8Array(cap);
      this.side = new Uint8Array(cap);
      this.posX = new Int32Array(cap);
      this.posY = new Int32Array(cap);
      this.hp = new Int32Array(cap);
      this.tunnelIn = new Int32Array(cap);
    }
    const s = sim.state;
    this.alive.set(s.alive.subarray(0, n));
    this.side.set(s.side.subarray(0, n));
    this.posX.set(s.posX.subarray(0, n));
    this.posY.set(s.posY.subarray(0, n));
    this.hp.set(s.hp.subarray(0, n));
    this.tunnelIn.set(s.tunnelIn.subarray(0, n));
    this.count = n;
  }
}

/** Whom a sweep at `(x, y)` identified, by the sim's own rule
 *  (`Sim`'s `reveal` command): living, side 1, on the surface, inside
 *  `SWEEP_RADIUS_SQ` -- read off the board as the command saw it. */
export interface BoardView {
  readonly count: number;
  readonly alive: ArrayLike<number>;
  readonly side: ArrayLike<number>;
  readonly posX: ArrayLike<number>;
  readonly posY: ArrayLike<number>;
  readonly tunnelIn: ArrayLike<number>;
}
export function sweptContacts(snap: BoardView, xFx: number, yFx: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < snap.count; i++) {
    if (snap.alive[i] === 0 || snap.side[i] !== 1) continue;
    if (snap.tunnelIn[i] >= 0) continue;
    if (distSqFx(snap.posX[i] - xFx, snap.posY[i] - yFx) > SWEEP_RADIUS_SQ_FX) continue;
    out.push(i);
  }
  return out;
}

export interface IntelMomentsOptions {
  readonly sweepCost: number;
  readonly strikeCost: number;
  /** Fixed-point from a tile number (`fx.from`), injected so this file needs
   *  no second copy of the sim's conversion. */
  readonly toFx: (n: number) => number;
}

const TYPE_NAME_LIMIT = 4;

export class IntelMoments {
  readonly rate = new IntelRate();
  private readonly snap = new Snapshot();
  private prevReady: Record<SupportKind, boolean | null> = { sweep: null, strike: null };
  private pendingSweep: { x: number; y: number } | null = null;
  /** Ticks by which each accepted strike must have landed. A call the sim
   *  drops (its caller died before the command ran) expires here rather than
   *  keeping the snapshot running for the rest of the mission. */
  private strikesInFlight: number[] = [];
  private readouts: { atTick: number; out: IntelOutput }[] = [];
  private disposed = false;

  constructor(private readonly opts: IntelMomentsOptions) {}

  private cost(k: SupportKind): number {
    return k === 'sweep' ? this.opts.sweepCost : this.opts.strikeCost;
  }

  /** Call right before `sim.tick()`. Copies the board only while a call is
   *  waiting on that tick's answer, so a mission that never spends intel
   *  pays nothing for this. */
  beforeTick(sim: IntelLook): void {
    if (this.disposed) return;
    if (this.pendingSweep !== null || this.strikesInFlight.length > 0) this.snap.take(sim);
  }

  /** The player's call, accepted by the runtime. `x`/`y` in tiles. */
  called(kind: SupportKind, x: number, y: number, tick: number): IntelOutput[] {
    if (this.disposed) return [];
    if (kind === 'sweep') {
      this.pendingSweep = { x, y };
      return [
        { kind: 'note', key: 'intel.note.sweepInbound', params: {}, tone: 'info', tier: 'important' },
        { kind: 'announce', event: 'sweep_inbound' },
        { kind: 'flash', points: [{ x, y }], tier: 'important', tone: 'info' },
      ];
    }
    this.strikesInFlight.push(tick + STRIKE_DELAY_TICKS + TICKS_PER_SECOND);
    return [
      {
        kind: 'note',
        key: 'intel.note.strikeInbound',
        params: { n: Math.round(STRIKE_DELAY_TICKS / TICKS_PER_SECOND) },
        tone: 'warn',
        tier: 'important',
      },
      { kind: 'announce', event: 'strike_inbound' },
      { kind: 'flash', points: [{ x, y }], tier: 'important', tone: 'warn' },
    ];
  }

  /** Call after the tick, with its events and the runtime's intel. */
  afterTick(
    sim: IntelLook,
    tick: number,
    events: readonly SimEvent[],
    intel: number
  ): IntelOutput[] {
    if (this.disposed) return [];
    const out: IntelOutput[] = [];
    this.rate.push(tick, intel);

    for (const k of ['sweep', 'strike'] as const) {
      const ready = intel >= this.cost(k);
      if (this.prevReady[k] === false && ready) {
        out.push(
          { kind: 'ready', support: k },
          { kind: 'note', key: 'intel.note.ready', params: { kind: k }, tone: 'info', tier: 'minor' },
          { kind: 'announce', event: k === 'sweep' ? 'sweep_ready' : 'strike_ready' }
        );
      }
      this.prevReady[k] = ready;
    }

    for (const e of events) {
      if (e.kind === 'revealed' && e.side === 0 && this.pendingSweep !== null) {
        const at = this.pendingSweep;
        this.pendingSweep = null;
        out.push(...this.sweepResult(sim, at, e.count));
      } else if (e.kind === 'strike') {
        this.strikesInFlight.shift();
        this.readouts.push({ atTick: tick + STRIKE_READOUT_DELAY_TICKS, out: this.strikeResult(sim, e, events) });
      }
    }

    while (this.strikesInFlight.length > 0 && tick > this.strikesInFlight[0]) this.strikesInFlight.shift();

    for (let i = this.readouts.length - 1; i >= 0; i--) {
      if (tick >= this.readouts[i].atTick) {
        out.push(this.readouts[i].out);
        this.readouts.splice(i, 1);
      }
    }
    return out;
  }

  private sweepResult(sim: IntelLook, at: { x: number; y: number }, count: number): IntelOutput[] {
    const ids = sweptContacts(this.snap, this.opts.toFx(at.x), this.opts.toFx(at.y));
    const byType = new Map<string, number>();
    for (const i of ids) {
      const name = sim.unitTypes[sim.state.typeIdx[i]]?.name ?? '';
      byType.set(name, (byType.get(name) ?? 0) + 1);
    }
    // Civilians are not contacts, and the sweep does not identify them; they
    // are named because "4 civilians in the area" is what makes the next
    // decision -- a strike on that ground -- a decision.
    let civilians = 0;
    const xFx = this.opts.toFx(at.x);
    const yFx = this.opts.toFx(at.y);
    for (let i = 0; i < this.snap.count; i++) {
      if (this.snap.alive[i] === 0 || this.snap.side[i] !== 2) continue;
      if (distSqFx(this.snap.posX[i] - xFx, this.snap.posY[i] - yFx) <= SWEEP_RADIUS_SQ_FX) civilians++;
    }
    const types = [...byType.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TYPE_NAME_LIMIT)
      .map(([name, n]) => ({ name, n }));
    // `count` is the sim's own number, from the event; `ids` is who it was.
    // They agree by construction (same board, same rule) and the world test
    // holds them to it.
    const out: IntelOutput[] = [
      { kind: 'note', key: 'intel.note.sweepResult', params: { n: count }, tone: 'info', tier: 'major' },
    ];
    if (types.length > 0 || civilians > 0) out.push({ kind: 'breakdown', types, civilians });
    if (ids.length > 0) {
      out.push({
        kind: 'flash',
        points: ids.map((i) => ({ x: sim.state.posX[i] / 65536, y: sim.state.posY[i] / 65536 })),
        tier: 'minor',
        tone: 'info',
      });
    }
    return out;
  }

  private strikeResult(sim: IntelLook, s: Extract<SimEvent, { kind: 'strike' }>, events: readonly SimEvent[]): IntelOutput {
    const splashSq = distSqFx(STRIKE_SPLASH_FX, 0);
    const inSplash = (i: number): boolean =>
      i < this.snap.count && distSqFx(this.snap.posX[i] - s.x, this.snap.posY[i] - s.y) <= splashSq;
    const killed = new Set<number>();
    let building = false;
    for (const e of events) {
      if (e.kind === 'destroyed' && e.by === s.by && inSplash(e.entity)) killed.add(e.entity);
      if (e.kind === 'structureHit' && e.by === s.by) building = true;
    }
    let down = 0;
    let hit = 0;
    let civiliansKilled = 0;
    for (const i of killed) {
      if (this.snap.side[i] === 1) down++;
      else if (this.snap.side[i] === 2) civiliansKilled++;
    }
    for (let i = 0; i < this.snap.count; i++) {
      if (this.snap.alive[i] === 0 || this.snap.side[i] !== 1 || killed.has(i)) continue;
      if (!inSplash(i)) continue;
      if (sim.state.hp[i] < this.snap.hp[i]) hit++;
    }
    return { kind: 'strikeResult', down, hit, building, civiliansKilled };
  }

  /** Readiness for the dock tile. */
  charge(kind: SupportKind, intel: number): { fraction: number; clock: ChargeClock } {
    const cost = this.cost(kind);
    return { fraction: Math.max(0, Math.min(1, intel / cost)), clock: chargeClock(this.rate.ticksTo(cost, intel)) };
  }

  /** Nothing said after this: a readout still waiting on its 0.7 s never
   *  lands on the next screen. */
  dispose(): void {
    this.disposed = true;
    this.readouts = [];
    this.pendingSweep = null;
    this.strikesInFlight = [];
  }
}
