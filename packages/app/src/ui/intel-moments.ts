/**
 * GH-113: the presentation weight of the intel calls -- first the drone
 * sweep and the precision strike, and since S-F (2026-10-15) the smoke
 * screen and the mortar barrage beside them -- approved by the lead on 2026-10-11 as
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
 *  - READY. A call that becomes affordable says so once: the tile's border
 *    for `READY_FLASH_MS`, and -- when two or more prices are crossed on one
 *    tick -- every crossed tile flashes but only the DEAREST of them gets the
 *    minor feed line and the announcer line, so one tick is one voice.
 *  - CALL. "inbound -- 3 s" / "on the way" replaces "called on (x, y)" for
 *    all four calls; one announcer line; an important minimap ring at the
 *    target, info for the sweep and the smoke screen and warn for the strike
 *    and the barrage (GH-461's language: info settles in, warn spreads out).
 *  - RESULT. The sweep: a major line with the count, a breakdown by type, and
 *    a minor ring on every contact it identified -- those contacts draw
 *    nowhere else, because the world and the minimap both skip a hostile the
 *    player does not observe (finding 2 of the mock). The strike: one line,
 *    0.7 s after the round, saying what it hit. The barrage: one line, 0.7 s
 *    after its SIXTH round, saying what all six hit (rounds are `strike`
 *    events with `profile` FS_MORTAR_BARRAGE; the strike's are
 *    FS_AIR_STRIKE). The smoke screen has no result line: the screen on the
 *    ground is the result. Never the Conduct number: the ROE lines price it
 *    on the same tick.
 */

import type { SimEvent } from '@lions/sim';
import { TICKS_PER_SECOND } from '@lions/sim';
import { isHostileSide, isOwnSide } from '@lions/render';
import type { AlertTier } from './alerts';
import { clockText, type Tone } from './hud-model';
import {
  FS_AIR_STRIKE,
  FS_MORTAR_BARRAGE,
  ROUNDS,
  SUPPORT_KINDS,
  SWEEP_RADIUS_SQ_FX,
  lastRoundTicks,
  type SupportKind,
} from './support-kinds';

/**
 * The sim's numbers for the calls are COPIED once, in `support-kinds.ts`
 * (`SWEEP_RADIUS_SQ_FX`, `ROUNDS`), which `support-kinds.test.ts` pins to
 * tuning.ts as TEXT. This module reads them from there.
 */
const STRIKE_SPLASH_FX = ROUNDS.air_strike.splashFx;
const STRIKE_DELAY_TICKS = ROUNDS.air_strike.delayTicks;
const BARRAGE_SPLASH_FX = ROUNDS.mortar_barrage.splashFx;

/** The announcer's ids for the four calls (`data/audio.json`'s
 *  `announcements` table; `AnnounceEventId` carries the same eight). */
export type AnnounceId =
  | 'screen_ready'
  | 'barrage_ready'
  | 'sweep_ready'
  | 'strike_ready'
  | 'screen_inbound'
  | 'barrage_inbound'
  | 'sweep_inbound'
  | 'strike_inbound';
export const READY_ANNOUNCE: Readonly<Record<SupportKind, AnnounceId>> = {
  smoke_screen: 'screen_ready',
  mortar_barrage: 'barrage_ready',
  drone_sweep: 'sweep_ready',
  air_strike: 'strike_ready',
};
export const INBOUND_ANNOUNCE: Readonly<Record<SupportKind, AnnounceId>> = {
  smoke_screen: 'screen_inbound',
  mortar_barrage: 'barrage_inbound',
  drone_sweep: 'sweep_inbound',
  air_strike: 'strike_inbound',
};

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

/** One thing to say. `key`/`params` are catalogue entries; `parts` names
 *  the pieces `main.ts` joins into one line (each its own key). */
export type IntelOutput =
  | { kind: 'note'; key: string; params: Readonly<Record<string, string | number>>; tone: Tone; tier: AlertTier }
  | { kind: 'breakdown'; types: readonly { name: string; n: number }[]; civilians: number }
  | { kind: 'strikeResult'; down: number; hit: number; building: boolean; civiliansKilled: number }
  | { kind: 'barrageResult'; down: number; hit: number; building: boolean; civiliansKilled: number }
  | { kind: 'flash'; points: readonly { x: number; y: number }[]; tier: AlertTier; tone: Tone }
  | { kind: 'announce'; event: AnnounceId }
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
 *  (`Sim`'s `reveal` command): living, hostile to the calling side (the
 *  viewer, 0 in single-player), on the surface, inside `SWEEP_RADIUS_SQ` --
 *  read off the board as the command saw it. */
export interface BoardView {
  readonly count: number;
  readonly alive: ArrayLike<number>;
  readonly side: ArrayLike<number>;
  readonly posX: ArrayLike<number>;
  readonly posY: ArrayLike<number>;
  readonly tunnelIn: ArrayLike<number>;
}
export function sweptContacts(snap: BoardView, xFx: number, yFx: number, viewer = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < snap.count; i++) {
    if (snap.alive[i] === 0 || !isHostileSide(snap.side[i], viewer)) continue;
    if (snap.tunnelIn[i] >= 0) continue;
    if (distSqFx(snap.posX[i] - xFx, snap.posY[i] - yFx) > SWEEP_RADIUS_SQ_FX) continue;
    out.push(i);
  }
  return out;
}

export interface IntelMomentsOptions {
  /** What a call costs, from the runtime (`runtime.supportCost`): never a
   *  copy of the sim's price table. */
  readonly supportCost: (kind: SupportKind) => number;
  /** Fixed-point from a tile number (`fx.from`), injected so this file needs
   *  no second copy of the sim's conversion. */
  readonly toFx: (n: number) => number;
  /** The side the player commands (network design §5.1), 0 in single-player
   *  and when absent: its `revealed` is the sweep's answer, and the side
   *  hostile to it is what a sweep and a strike count. */
  readonly viewer?: number;
}

const TYPE_NAME_LIMIT = 4;

/** A call whose rounds are still to land, and the tick by which they must
 *  have. A call the sim drops (its caller died before the command ran)
 *  expires at `until` rather than keeping the snapshot running for the rest
 *  of the mission. The barrage gathers its six rounds' effect as they land. */
type InFlight =
  | { kind: 'air_strike'; until: number }
  | {
      kind: 'mortar_barrage';
      until: number;
      landed: number;
      /** Hostiles its rounds killed. */
      killed: Set<number>;
      /** Hostiles its rounds hurt; `hit \ killed` is what the line counts. */
      hit: Set<number>;
      building: boolean;
      civilians: number;
    };
type BarrageInFlight = Extract<InFlight, { kind: 'mortar_barrage' }>;

/** What one round did, by the sim's events and the board before it. */
interface SplashTally {
  readonly killed: readonly number[];
  readonly hurt: readonly number[];
  readonly building: boolean;
}

/** The barrage's one line: everything its rounds did, a man hurt by one
 *  round and killed by a later one counted once, as down. */
function barrageResult(rec: BarrageInFlight): IntelOutput {
  let hit = 0;
  for (const i of rec.hit) if (!rec.killed.has(i)) hit++;
  return { kind: 'barrageResult', down: rec.killed.size, hit, building: rec.building, civiliansKilled: rec.civilians };
}

export class IntelMoments {
  readonly rate = new IntelRate();
  private readonly snap = new Snapshot();
  private readonly prevReady: Record<SupportKind, boolean | null> = {
    smoke_screen: null,
    mortar_barrage: null,
    drone_sweep: null,
    air_strike: null,
  };
  private pendingSweep: { x: number; y: number } | null = null;
  /** Accepted strikes and barrages, oldest first. */
  private inFlight: InFlight[] = [];
  private readouts: { atTick: number; out: IntelOutput }[] = [];
  private disposed = false;

  constructor(private readonly opts: IntelMomentsOptions) {}

  private get viewer(): number {
    return this.opts.viewer ?? 0;
  }

  private cost(k: SupportKind): number {
    return this.opts.supportCost(k);
  }

  /** Call right before `sim.tick()`. Copies the board only while a call is
   *  waiting on that tick's answer, so a mission that never spends intel
   *  pays nothing for this. */
  beforeTick(sim: IntelLook): void {
    if (this.disposed) return;
    if (this.pendingSweep !== null || this.inFlight.length > 0) this.snap.take(sim);
  }

  /** The player's call, accepted by the runtime. `x`/`y` in tiles. */
  called(kind: SupportKind, x: number, y: number, tick: number): IntelOutput[] {
    if (this.disposed) return [];
    const say = (key: string, params: Readonly<Record<string, number>>, tone: Tone): IntelOutput[] => [
      { kind: 'note', key, params, tone, tier: 'important' },
      { kind: 'announce', event: INBOUND_ANNOUNCE[kind] },
      { kind: 'flash', points: [{ x, y }], tier: 'important', tone },
    ];
    const seconds = (ticks: number): number => Math.round(ticks / TICKS_PER_SECOND);
    switch (kind) {
      case 'drone_sweep':
        this.pendingSweep = { x, y };
        return say('intel.note.sweepInbound', {}, 'info');
      case 'air_strike':
        this.inFlight.push({ kind: 'air_strike', until: tick + STRIKE_DELAY_TICKS + TICKS_PER_SECOND });
        return say('intel.note.strikeInbound', { n: seconds(STRIKE_DELAY_TICKS) }, 'warn');
      case 'mortar_barrage':
        this.inFlight.push({
          kind: 'mortar_barrage',
          until: tick + lastRoundTicks('mortar_barrage') + TICKS_PER_SECOND,
          landed: 0,
          killed: new Set(),
          hit: new Set(),
          building: false,
          civilians: 0,
        });
        return say('intel.note.barrageInbound', { n: seconds(ROUNDS.mortar_barrage.delayTicks) }, 'warn');
      case 'smoke_screen':
        // Nothing in flight and no readout: the screen on the ground is the result.
        return say('intel.note.screenInbound', { n: seconds(ROUNDS.smoke_screen.delayTicks) }, 'info');
      default: {
        const never: never = kind;
        return never;
      }
    }
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

    // Every tile whose price was crossed this tick flashes; only the dearest
    // of them is said and voiced, so two prices crossed together are one line.
    let dearest: SupportKind | null = null;
    for (const k of SUPPORT_KINDS) {
      const ready = intel >= this.cost(k);
      if (this.prevReady[k] === false && ready) {
        out.push({ kind: 'ready', support: k });
        if (dearest === null || this.cost(k) > this.cost(dearest)) dearest = k;
      }
      this.prevReady[k] = ready;
    }
    if (dearest !== null) {
      out.push(
        { kind: 'note', key: 'intel.note.ready', params: { kind: dearest }, tone: 'info', tier: 'minor' },
        { kind: 'announce', event: READY_ANNOUNCE[dearest] }
      );
    }

    for (const e of events) {
      if (e.kind === 'revealed' && isOwnSide(e.side, this.viewer) && this.pendingSweep !== null) {
        const at = this.pendingSweep;
        this.pendingSweep = null;
        out.push(...this.sweepResult(sim, at, e.count));
      } else if (e.kind === 'strike' && e.profile === FS_AIR_STRIKE) {
        const i = this.inFlight.findIndex((f) => f.kind === 'air_strike');
        if (i >= 0) this.inFlight.splice(i, 1);
        this.readouts.push({ atTick: tick + STRIKE_READOUT_DELAY_TICKS, out: this.strikeResult(sim, e, events) });
      } else if (e.kind === 'strike' && e.profile === FS_MORTAR_BARRAGE) {
        const i = this.inFlight.findIndex((f) => f.kind === 'mortar_barrage');
        const rec = i >= 0 ? this.inFlight[i] : undefined;
        if (rec === undefined || rec.kind !== 'mortar_barrage') continue;
        this.barrageRound(sim, rec, e, events);
        if (rec.landed >= ROUNDS.mortar_barrage.rounds) {
          this.inFlight.splice(i, 1);
          this.readouts.push({ atTick: tick + STRIKE_READOUT_DELAY_TICKS, out: barrageResult(rec) });
        }
      }
    }

    // A call whose window closed: dropped silently, unless a barrage had
    // rounds land, in which case it says what they did.
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const f = this.inFlight[i];
      if (tick <= f.until) continue;
      this.inFlight.splice(i, 1);
      if (f.kind === 'mortar_barrage' && f.landed > 0) out.push(barrageResult(f));
    }

    for (let i = this.readouts.length - 1; i >= 0; i--) {
      if (tick >= this.readouts[i].atTick) {
        out.push(this.readouts[i].out);
        this.readouts.splice(i, 1);
      }
    }
    return out;
  }

  private sweepResult(sim: IntelLook, at: { x: number; y: number }, count: number): IntelOutput[] {
    const ids = sweptContacts(this.snap, this.opts.toFx(at.x), this.opts.toFx(at.y), this.viewer);
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

  /** One round's effect: whom its caller killed and hurt inside `splashFx`
   *  of where it landed, read against the board as the tick began, and
   *  whether it hit a building. Not narrowed by side: callers do that. */
  private splash(sim: IntelLook, s: Extract<SimEvent, { kind: 'strike' }>, events: readonly SimEvent[], splashFx: number): SplashTally {
    const splashSq = distSqFx(splashFx, 0);
    const inSplash = (i: number): boolean =>
      i < this.snap.count && distSqFx(this.snap.posX[i] - s.x, this.snap.posY[i] - s.y) <= splashSq;
    const killed = new Set<number>();
    let building = false;
    for (const e of events) {
      if (e.kind === 'destroyed' && e.by === s.by && inSplash(e.entity)) killed.add(e.entity);
      if (e.kind === 'structureHit' && e.by === s.by) building = true;
    }
    const hurt: number[] = [];
    for (let i = 0; i < this.snap.count; i++) {
      if (this.snap.alive[i] === 0 || killed.has(i) || !inSplash(i)) continue;
      if (sim.state.hp[i] < this.snap.hp[i]) hurt.push(i);
    }
    return { killed: [...killed], hurt, building };
  }

  private strikeResult(sim: IntelLook, s: Extract<SimEvent, { kind: 'strike' }>, events: readonly SimEvent[]): IntelOutput {
    const r = this.splash(sim, s, events, STRIKE_SPLASH_FX);
    let down = 0;
    let civiliansKilled = 0;
    for (const i of r.killed) {
      if (isHostileSide(this.snap.side[i], this.viewer)) down++;
      else if (this.snap.side[i] === 2) civiliansKilled++;
    }
    const hit = r.hurt.filter((i) => isHostileSide(this.snap.side[i], this.viewer)).length;
    return { kind: 'strikeResult', down, hit, building: r.building, civiliansKilled };
  }

  /** One barrage round, added to its call's running tally. */
  private barrageRound(sim: IntelLook, rec: BarrageInFlight, s: Extract<SimEvent, { kind: 'strike' }>, events: readonly SimEvent[]): void {
    const r = this.splash(sim, s, events, BARRAGE_SPLASH_FX);
    rec.landed++;
    for (const i of r.killed) {
      if (isHostileSide(this.snap.side[i], this.viewer)) rec.killed.add(i);
      else if (this.snap.side[i] === 2) rec.civilians++;
    }
    for (const i of r.hurt) if (isHostileSide(this.snap.side[i], this.viewer)) rec.hit.add(i);
    if (r.building) rec.building = true;
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
    this.inFlight = [];
  }
}
