// Unit spacing, measured by BODIES (GH-1360, slice S0). REPORT-ONLY: it asserts no level.
// Run: pnpm spacing:census            (tick 0 + the choke probe, a few seconds)
//      pnpm spacing:census -- --play  (also the in-play reading: the sensible plan of every mission, minutes)
//      pnpm spacing:census -- --json=out.json
//
// Spec: docs/superpowers/specs/2026-11-15-unit-spacing-design.md (on cl/gh1360-spacing-design), sections 1, 3.3, 5 and 7 (S0).
//
// A BODY is what a unit occupies for the purpose of "do these two stand inside each other":
//   - a vehicle is its GH-421 capsule, read back from the sim's registered type (`sepHalfLen`, `sepHalfWid`,
//     `sepCentre`, i.e. `mobility.footprint`);
//   - a foot team is the spec's proposed circle (3.1): `FOOT_RADIUS`, a literal table here because no foot type
//     declares a footprint yet. S5c puts the same numbers in the unit JSON; `spacing-census.test.ts` pins them.
// Two bodies overlap when the distance between their axis segments is under the sum of their half-widths, by more
// than CONTACT_EPS (0.02 tile, the GH-421 probe's threshold). Aircraft have no body and are left out, as are units that
// are carried, garrisoned or in a tunnel.
//
// What it reports:
//   1. TICK 0: overlapping pairs per class pair (foot-foot / foot-vehicle / vehicle-vehicle) and per formation class
//      pair, over the 30 shipped missions, every offered versus cell and the free-play task force on every map. Plus
//      the foot bodies that start on a blocked tile, split into the ones a `garrison` stance was queued for (the
//      exemption `assertGroundClear` makes on purpose) and the rest.
//   2. IN PLAY (`--play`): the same per unit-tick, over the sensible plan `pnpm playtest` runs on each mission (seed
//      424242, taken through `tapMissionEvents`, nothing in playtest-run.ts changes), both by bodies and by centre
//      distance under 0.3 tile, which is the cloud census's measure on GH-1360 (13.0% foot-foot). Also valve opens and
//      legs ended at contact per 1,000 unit-ticks (`sepDiag`), speed-zero runs of 1-2 ticks inside a moving leg and
//      facing reversals over 30 degrees within 3 ticks (spec 5: the two inputs to S7).
//   3. THE CHOKE: 12 teams through a 1-tile gap, today (no footprint) and with circles (a test-only footprint), with
//      time to clear, valve opens and legs ended at contact. The S5c gate is "every team through and no deadlock".
//
// `sepDiag` counts only participants (a type with a footprint). Today that is vehicles, so the foot valve and contact
// counts read zero until S5c. That zero is a reading, not a gap in the instrument; the circles arm of the choke probe
// is where the foot valve is visible now.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { FORMATION_CLASSES, MissionRuntime, Sim, TICKS_PER_SECOND, fx, type Command, type UnitType, type UnitTypeJson } from '@lions/sim';
import { applyTerrain, maps, missions, parseMap, roadMaskOf, units, type MapId } from '@lions/data';
import { FACTION_MATCHUP_MAPS, VERSUS_FAIR_MAPS, type Faction } from '@lions/net';
import { missionStage } from '../mission-harness';
import { standMapStructures } from '../../../packages/app/src/map-sim';
import { sandboxSpawns } from '../../../packages/app/src/sandbox-spawn';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { layoutOf, world as versusWorld } from './versus-probe';

// ---------------------------------------------------------------------------------------------
// Geometry (float: this file is a tool, never the sim).
// ---------------------------------------------------------------------------------------------

/** A pair counts once its bodies interpenetrate by more than this, in tiles (6 cm): vehicle-overlap-probe's threshold. */
export const CONTACT_EPS = 0.02;
/** The cloud census's centre-distance bar (GH-1360 comment of 15 Nov): "two teams' figures are inside each other". */
export const CENTRE_NEAR = 0.3;
/** One full turn in the sim's facing integer. */
export const TURN = 65536;

/** A body: an axis segment swept by a radius. A circle has `halfLen === halfWid`. All in tiles; facing is the sim's integer (65536 = one turn, y down). */
export interface Body {
  x: number;
  y: number;
  facing: number;
  halfLen: number;
  halfWid: number;
  /** Body centre along the heading from the unit origin (negative = behind), tiles. */
  centre: number;
}

/** The spec's proposed foot radii (3.1), tiles, by unit id. Literal on purpose: S5c writes them into the unit JSON and the test pins both. */
export const FOOT_RADIUS: Readonly<Record<string, number>> = {
  civilians: 0.25,
  ugv_recon_dog: 0.25,
  breach_team: 0.3,
  manpad_team: 0.35,
  charge_squad: 0.35,
  digger_crew: 0.35,
  rpg_team: 0.4,
  demo_squad: 0.4,
  militia_cell: 0.4,
  recoilless_team: 0.4,
  wounded_kdf: 0.4,
  wounded_sarim: 0.4,
  inf_medic_squad: 0.45,
  at_team: 0.45,
  atgm_cell: 0.45,
  recon_zikit: 0.45,
  mortar_team: 0.45,
  yahalom_squad: 0.45,
  sniper_team: 0.45,
  mortar_crew: 0.45,
  inf_squad: 0.45,
  inf_grenadier: 0.45,
  sarim_rifles: 0.45,
  at_nlos_team: 0.45,
  moto_rpg: 0.45,
};
/** A foot type the table does not name: the ceiling radius, and the census says so. */
export const FOOT_RADIUS_DEFAULT = 0.45;

/** The proposed radius for a foot type id. */
export function footRadius(unitId: string): number {
  return Object.hasOwn(FOOT_RADIUS, unitId) ? FOOT_RADIUS[unitId] : FOOT_RADIUS_DEFAULT;
}

type Seg = readonly [number, number, number, number];

/** The axis segment of a body, as `hullCapsule` builds it: centred `centre` along the heading, half-length `max(halfLen - halfWid, 0)`. */
export function bodySegment(b: Body): Seg {
  const ang = (b.facing / TURN) * 2 * Math.PI;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const cx = b.x + c * b.centre;
  const cy = b.y + s * b.centre;
  const h = b.halfLen > b.halfWid ? b.halfLen - b.halfWid : 0;
  return [cx - c * h, cy - s * h, cx + c * h, cy + s * h];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance between two segments (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentDistance(a: Seg, b: Seg): number {
  const [p0x, p0y, p1x, p1y] = a;
  const [q0x, q0y, q1x, q1y] = b;
  const d1x = p1x - p0x;
  const d1y = p1y - p0y;
  const d2x = q1x - q0x;
  const d2y = q1y - q0y;
  const rx = p0x - q0x;
  const ry = p0y - q0y;
  const aa = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s: number;
  let t: number;
  if (aa <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (aa <= 1e-12) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-12) {
      t = 0;
      s = clamp01(-c / aa);
    } else {
      const bb = d1x * d2x + d1y * d2y;
      const denom = aa * e - bb * bb;
      s = denom > 1e-12 ? clamp01((bb * f - c * e) / denom) : 0;
      t = (bb * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / aa);
      } else if (t > 1) {
        t = 1;
        s = clamp01((bb - c) / aa);
      }
    }
  }
  const px = p0x + d1x * s;
  const py = p0y + d1y * s;
  const qx = q0x + d2x * t;
  const qy = q0y + d2y * t;
  return Math.hypot(px - qx, py - qy);
}

/** How far two bodies interpenetrate, tiles. Zero or less means apart or touching. */
export function bodyDepth(a: Body, b: Body): number {
  return a.halfWid + b.halfWid - segmentDistance(bodySegment(a), bodySegment(b));
}

// ---------------------------------------------------------------------------------------------
// Entities.
// ---------------------------------------------------------------------------------------------

export type Kind = 'foot' | 'vehicle';
export type ClassPair = 'foot-foot' | 'foot-vehicle' | 'vehicle-vehicle';

export interface Entry {
  id: number;
  side: number;
  unit: string;
  /** The unit's formation class (`FORMATION_CLASSES`), or `none`. */
  cls: string;
  kind: Kind;
  /** Rides on wheels or tracks (the sim's `wheeled`). Differs from `kind` for a moto_rpg: a foot circle on a wheeled mask. */
  wheeled: boolean;
  body: Body;
  tx: number;
  ty: number;
  /** The tile is set in the unit's own mask (`blocked` for foot, `blockedVehicle` for a hull). */
  onBlocked: boolean;
  /** The type is not in `FOOT_RADIUS`: its body is the default radius. */
  unlisted: boolean;
}

/** Whether a registered type has a body, and which. Aircraft and a wheeled hull with no footprint (and no table entry) have none. */
export function bodyOfType(t: Pick<UnitType, 'id' | 'isAir' | 'wheeled' | 'sepHalfLen' | 'sepHalfWid' | 'sepCentre'>): { kind: Kind; halfLen: number; halfWid: number; centre: number; unlisted: boolean } | null {
  if (t.isAir) return null;
  if (t.sepHalfWid > 0) {
    return { kind: 'vehicle', halfLen: fx.toNumber(t.sepHalfLen), halfWid: fx.toNumber(t.sepHalfWid), centre: fx.toNumber(t.sepCentre), unlisted: false };
  }
  // A wheeled type with no footprint and no foot radius is a hull the census cannot measure; one WITH a table entry (moto_rpg) is a circle.
  if (t.wheeled && !Object.hasOwn(FOOT_RADIUS, t.id)) return null;
  const r = footRadius(t.id);
  return { kind: 'foot', halfLen: r, halfWid: r, centre: 0, unlisted: !Object.hasOwn(FOOT_RADIUS, t.id) };
}

/** Every living ground body on the map: not carried, not garrisoned, not in a tunnel, not removed, not air. */
export function entriesOf(sim: Sim): Entry[] {
  const s = sim.state;
  const out: Entry[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    if (s.alive[i] === 0 || s.removed[i] !== 0) continue;
    if (s.carriedBy[i] >= 0 || s.garrisonedIn[i] >= 0 || s.tunnelIn[i] >= 0) continue;
    const t = sim.unitTypes[s.typeIdx[i]];
    const b = bodyOfType(t);
    if (b === null) continue;
    const x = fx.toNumber(s.posX[i]);
    const y = fx.toNumber(s.posY[i]);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    // Which mask it paths on is `wheeled`, not the body kind: a moto_rpg has a foot circle and a wheeled mask.
    const mask = t.wheeled ? sim.blockedVehicle : sim.blocked;
    const inside = tx >= 0 && ty >= 0 && tx < sim.width && ty < sim.height;
    out.push({
      id: i,
      side: s.side[i],
      unit: t.id,
      cls: t.fmClass >= 0 && t.fmClass < FORMATION_CLASSES.length ? FORMATION_CLASSES[t.fmClass] : 'none',
      kind: b.kind,
      wheeled: t.wheeled,
      body: { x, y, facing: s.facing[i], halfLen: b.halfLen, halfWid: b.halfWid, centre: b.centre },
      tx,
      ty,
      onBlocked: inside && mask[ty * sim.width + tx] !== 0,
      unlisted: b.unlisted,
    });
  }
  return out;
}

export const classPairOf = (a: Kind, b: Kind): ClassPair => (a === 'foot' && b === 'foot' ? 'foot-foot' : a === 'vehicle' && b === 'vehicle' ? 'vehicle-vehicle' : 'foot-vehicle');

export interface Overlap {
  a: number;
  b: number;
  /** Interpenetration, tiles. */
  depth: number;
  pair: ClassPair;
  /** The shared side, or -1 for a cross-side pair. */
  side: number;
}

/** Same-side pairs whose bodies interpenetrate by more than `eps`. `crossSide` also reports pairs of opposing sides (indices into `es`). */
export function overlaps(es: readonly Entry[], opts: { eps?: number; crossSide?: boolean } = {}): Overlap[] {
  const eps = opts.eps ?? CONTACT_EPS;
  const out: Overlap[] = [];
  for (let i = 0; i < es.length; i++) {
    const A = es[i];
    const reachA = Math.max(A.body.halfLen, A.body.halfWid) + Math.abs(A.body.centre);
    for (let j = i + 1; j < es.length; j++) {
      const B = es[j];
      if (A.side !== B.side && opts.crossSide !== true) continue;
      const reach = reachA + Math.max(B.body.halfLen, B.body.halfWid) + Math.abs(B.body.centre);
      const dx = A.body.x - B.body.x;
      const dy = A.body.y - B.body.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      const depth = bodyDepth(A.body, B.body);
      if (depth > eps) out.push({ a: i, b: j, depth, pair: classPairOf(A.kind, B.kind), side: A.side === B.side ? A.side : -1 });
    }
  }
  return out;
}

export interface PairTally {
  'foot-foot': number;
  'foot-vehicle': number;
  'vehicle-vehicle': number;
}
export const emptyTally = (): PairTally => ({ 'foot-foot': 0, 'foot-vehicle': 0, 'vehicle-vehicle': 0 });
export const tallyTotal = (t: PairTally): number => t['foot-foot'] + t['foot-vehicle'] + t['vehicle-vehicle'];

/** Overlaps counted by class pair. */
export function tallyOf(os: readonly Overlap[]): PairTally {
  const t = emptyTally();
  for (const o of os) t[o.pair]++;
  return t;
}

/** Overlaps counted by the unordered pair of formation classes ("armour+infantry"). */
export function classPairCounts(es: readonly Entry[], os: readonly Overlap[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of os) {
    const k = [es[o.a].cls, es[o.b].cls].sort().join('+');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Blocked-tile bodies and the garrison exemption (spec 1.2).
// ---------------------------------------------------------------------------------------------

export interface BlockedSplit {
  /** Bodies on a tile closed to their own mask. */
  total: number;
  /** ...of which a `garrison` command was queued for (the stance `assertGroundClear` exempts on purpose). */
  garrison: Entry[];
  /** ...the rest: a body on blocked ground nobody ordered into a building. */
  other: Entry[];
}

export function splitBlocked(es: readonly Entry[], garrisonIds: ReadonlySet<number>): BlockedSplit {
  const garrison: Entry[] = [];
  const other: Entry[] = [];
  for (const e of es) {
    if (!e.onBlocked) continue;
    (garrisonIds.has(e.id) ? garrison : other).push(e);
  }
  return { total: garrison.length + other.length, garrison, other };
}

// ---------------------------------------------------------------------------------------------
// Starts.
// ---------------------------------------------------------------------------------------------

export interface Start {
  name: string;
  group: 'mission' | 'versus' | 'freeplay';
  sim: Sim;
  /** Entities a `garrison` command was queued for during the start. Empty outside a mission. */
  garrisonIds: ReadonlySet<number>;
}

/** The mission's starting force, as `MissionRuntime.start()` fields it (seed 424242, empty ledger, upgrades unresolved), with the garrison orders it queues recorded. */
export function missionStart(id: string, seed = 424242): Start {
  const { mission, map, sim, context } = missionStage(id, seed);
  const garrisonIds = new Set<number>();
  const queue = sim.queueCommand.bind(sim);
  (sim as unknown as { queueCommand: (c: Command) => void }).queueCommand = (cmd: Command): void => {
    if (cmd.kind === 'garrison') for (const g of cmd.ids) garrisonIds.add(g);
    queue(cmd);
  };
  new MissionRuntime(sim, mission, { ...context({}), roadMask: roadMaskOf(map) }).start();
  delete (sim as unknown as { queueCommand?: unknown }).queueCommand; // back to the prototype method
  return { name: id, group: 'mission', sim, garrisonIds };
}

function registerAll(sim: Sim): Map<string, number> {
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as unknown as UnitTypeJson));
  return typeOf;
}

/** The free-play task force on `mapId` with default flags, as the app builds it. */
export function freePlayStart(mapId: string, seed = 424242): Start {
  const map = parseMap(maps[mapId as MapId]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = registerAll(sim);
  sandboxSpawns(sim, typeOf, sandboxAnchors(map));
  return { name: mapId, group: 'freeplay', sim, garrisonIds: new Set() };
}

/** A versus room's two ends on `mapId` for an arrangement (factions by END, friendly first). */
export function versusStart(mapId: string, arrangement: readonly [Faction, Faction], seed = 424242): Start {
  const w = versusWorld(mapId as MapId, seed);
  const { factions, ends } = layoutOf(arrangement);
  versusSpawns(w.sim, w.typeOf, versusAnchors(w.map), factions, ends);
  return { name: `${mapId} ${arrangement[0]}/${arrangement[1]}`, group: 'versus', sim: w.sim, garrisonIds: new Set() };
}

/** The versus cells the lobby offers: every fair map as a mirror, and both spawn orders where a KDF-vs-Sarim pairing is allowed (13 cells). */
export function versusCells(): { map: string; arrangement: [Faction, Faction] }[] {
  const out: { map: string; arrangement: [Faction, Faction] }[] = [];
  for (const map of VERSUS_FAIR_MAPS) {
    out.push({ map, arrangement: ['kdf', 'kdf'] });
    if (FACTION_MATCHUP_MAPS.includes(map)) {
      out.push({ map, arrangement: ['kdf', 'sarim'] });
      out.push({ map, arrangement: ['sarim', 'kdf'] });
    }
  }
  return out;
}

export function missionIds(): string[] {
  return Object.keys(missions);
}

// ---------------------------------------------------------------------------------------------
// Tick-0 reading.
// ---------------------------------------------------------------------------------------------

export interface StartReading {
  name: string;
  group: Start['group'];
  bodies: number;
  /** Per side: bodies. */
  bySide: Record<number, number>;
  /** Same-side overlapping pairs. */
  pairs: PairTally;
  /** The same, side 0 only (the spec's mission basis). */
  pairsSide0: PairTally;
  bodiesSide0: number;
  deepest: number;
  classPairs: Record<string, number>;
  blocked: { foot: number; vehicle: number; garrison: number; other: number; otherUnits: string[] };
  unlisted: string[];
}

export function readStart(st: Start): StartReading {
  const es = entriesOf(st.sim);
  const os = overlaps(es);
  const split = splitBlocked(es, st.garrisonIds);
  const bySide: Record<number, number> = {};
  for (const e of es) bySide[e.side] = (bySide[e.side] ?? 0) + 1;
  const os0 = os.filter((o) => o.side === 0);
  return {
    name: st.name,
    group: st.group,
    bodies: es.length,
    bySide,
    pairs: tallyOf(os),
    pairsSide0: tallyOf(os0),
    bodiesSide0: bySide[0] ?? 0,
    deepest: os.reduce((m, o) => Math.max(m, o.depth), 0),
    classPairs: Object.fromEntries(classPairCounts(es, os)),
    blocked: {
      foot: es.filter((e) => e.onBlocked && !e.wheeled).length,
      vehicle: es.filter((e) => e.onBlocked && e.wheeled).length,
      garrison: split.garrison.length,
      other: split.other.length,
      otherUnits: split.other.map((e) => `${e.unit}#${e.id}@(${e.body.x.toFixed(2)},${e.body.y.toFixed(2)})`),
    },
    unlisted: [...new Set(es.filter((e) => e.unlisted).map((e) => e.unit))],
  };
}

// ---------------------------------------------------------------------------------------------
// In-play instruments (spec 5).
// ---------------------------------------------------------------------------------------------

/** A signed turn from facing `a` to facing `b`, in degrees, in (-180, 180]. */
export function turnDeg(a: number, b: number): number {
  let d = (((b - a) % TURN) + TURN) % TURN;
  if (d > TURN / 2) d -= TURN;
  return (d / TURN) * 360;
}

/**
 * Whether the newest of the facing samples (oldest first, one per tick: four samples span three ticks) COMPLETES a reversal: a
 * swing of at least `deg` one way (sample i to j) followed by a swing of at least `deg` the other (j to the newest), where the
 * second swing was not already complete a tick earlier, so one reversal is counted on the tick it completes and not again
 * on the ticks after it.
 */
export function facingReversal(samples: readonly number[], deg = 30): boolean {
  const k = samples.length - 1;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const first = turnDeg(samples[i], samples[j]);
      const second = turnDeg(samples[j], samples[k]);
      const reversed = (first >= deg && second <= -deg) || (first <= -deg && second >= deg);
      if (!reversed) continue;
      // Not already complete on the previous tick (j === k - 1 means the swing only just began).
      if (j < k - 1) {
        const before = turnDeg(samples[j], samples[k - 1]);
        if (Math.abs(before) >= deg) continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Speed-zero runs inside a moving leg, per entity: feed it one (moved, moving) per tick. A run is 1 or 2 consecutive ticks in
 * which the unit is under a move order (`moving`) but did not change position, between ticks in which it did.
 * `step` returns true on the tick the unit moves again after such a run (the flicker the render would show).
 */
export class ZeroRunTracker {
  private run = 0;
  private moved = false;
  step(moved: boolean, moving: boolean): boolean {
    if (!moving) {
      this.run = 0;
      this.moved = false;
      return false;
    }
    if (moved) {
      const hit = this.moved && this.run >= 1 && this.run <= 2;
      this.run = 0;
      this.moved = true;
      return hit;
    }
    this.run++;
    return false;
  }
}

export interface PlayAcc {
  mission: string;
  ticks: number;
  /** Unit-ticks by kind. */
  unitTicks: { foot: number; vehicle: number };
  /** The same split by `wheeled` (the cloud census's class: a moto_rpg is a vehicle there). Denominator of the `centre` reading. */
  unitTicksWheeled: { foot: number; vehicle: number };
  /** Unit-ticks with a same-side neighbour of the named class under the bar, by `body` (overlap) and `centre` (< 0.3 tile). */
  near: { body: NearTally; centre: NearTally };
  /** Overlapping same-side PAIR-ticks by class, bodies. */
  pairTicks: PairTally;
  /** Foot unit-ticks under a move order, and the two instruments over them. */
  footMoving: number;
  zeroRuns: number;
  reversals: number;
  valve: number;
  contact: number;
}
export interface NearTally {
  foot: number; // foot unit-ticks with a foot neighbour
  vehicle: number; // vehicle unit-ticks with a vehicle neighbour
  cross: number; // unit-ticks with a neighbour of the OTHER class
  any: number;
}
const emptyNear = (): NearTally => ({ foot: 0, vehicle: 0, cross: 0, any: 0 });
export const newPlayAcc = (mission: string): PlayAcc => ({
  mission,
  ticks: 0,
  unitTicks: { foot: 0, vehicle: 0 },
  unitTicksWheeled: { foot: 0, vehicle: 0 },
  near: { body: emptyNear(), centre: emptyNear() },
  pairTicks: emptyTally(),
  footMoving: 0,
  zeroRuns: 0,
  reversals: 0,
  valve: 0,
  contact: 0,
});

/** Per-entity memory the in-play sampler keeps between ticks. */
export class PlayState {
  readonly prevX: Int32Array;
  readonly prevY: Int32Array;
  readonly hist: Int32Array; // 4 facing samples per entity, oldest first
  readonly histN: Uint8Array;
  readonly zero: ZeroRunTracker[] = [];
  constructor(capacity: number) {
    this.prevX = new Int32Array(capacity);
    this.prevY = new Int32Array(capacity);
    this.hist = new Int32Array(capacity * 4);
    this.histN = new Uint8Array(capacity);
  }
}

/** Fold one finished tick of `sim` into `acc`. */
export function sampleTick(sim: Sim, acc: PlayAcc, ps: PlayState): void {
  const s = sim.state;
  const es = entriesOf(sim);
  const flag = (pred: (a: Entry, b: Entry) => boolean, into: NearTally, cls: (e: Entry) => Kind): void => {
    const hasFoot = new Uint8Array(es.length);
    const hasVeh = new Uint8Array(es.length);
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        if (es[i].side !== es[j].side) continue;
        if (!pred(es[i], es[j])) continue;
        (cls(es[j]) === 'foot' ? hasFoot : hasVeh)[i] = 1;
        (cls(es[i]) === 'foot' ? hasFoot : hasVeh)[j] = 1;
      }
    }
    for (let i = 0; i < es.length; i++) {
      const own = cls(es[i]);
      const same = own === 'foot' ? hasFoot[i] : hasVeh[i];
      const cross = own === 'foot' ? hasVeh[i] : hasFoot[i];
      if (own === 'foot' && same) into.foot++;
      if (own === 'vehicle' && same) into.vehicle++;
      if (cross) into.cross++;
      if (same || cross) into.any++;
    }
  };
  flag((a, b) => bodyDepth(a.body, b.body) > CONTACT_EPS, acc.near.body, (e) => e.kind);
  flag((a, b) => Math.hypot(a.body.x - b.body.x, a.body.y - b.body.y) < CENTRE_NEAR, acc.near.centre, (e) => (e.wheeled ? 'vehicle' : 'foot'));
  const os = overlaps(es);
  for (const o of os) acc.pairTicks[o.pair]++;
  acc.ticks++;
  for (const e of es) {
    acc.unitTicks[e.kind]++;
    acc.unitTicksWheeled[e.wheeled ? 'vehicle' : 'foot']++;
    const i = e.id;
    const moved = ps.histN[i] > 0 && (s.posX[i] !== ps.prevX[i] || s.posY[i] !== ps.prevY[i]);
    // Facing history: shift left, newest last.
    const h = ps.hist;
    if (ps.histN[i] < 4) ps.histN[i]++;
    for (let k = 0; k < 3; k++) h[i * 4 + k] = h[i * 4 + k + 1];
    h[i * 4 + 3] = s.facing[i];
    if (e.kind === 'foot') {
      const moving = s.moving[i] === 1;
      if (moving) acc.footMoving++;
      const z = (ps.zero[i] ??= new ZeroRunTracker());
      if (z.step(moved, moving)) acc.zeroRuns++;
      if (moving && ps.histN[i] === 4 && facingReversal(Array.from(h.subarray(i * 4, i * 4 + 4)))) acc.reversals++;
    }
    ps.prevX[i] = s.posX[i];
    ps.prevY[i] = s.posY[i];
  }
}

// ---------------------------------------------------------------------------------------------
// The choke (spec 3.3, "1-tile chokes").
// ---------------------------------------------------------------------------------------------

export interface ChokeOpts {
  /** Unit ids and where each starts and goes. Positions are tile centres. */
  groups: readonly { unit: string; x: number; y: number; goalX: number; goalY: number; exact?: boolean }[];
  /** One plain `move` for EVERY unit to this point, as a player's group order (formation slots), instead of each unit's own goal. */
  groupGoal?: { x: number; y: number };
  /** Extra unit types to register (a clone with a footprint, say). */
  extraTypes?: readonly UnitTypeJson[];
  /** Give up after this many seconds. */
  seconds?: number;
  /** Wall thickness in tiles: 1 is a door in a wall (the default), 6 a corridor where two units cannot steer round each other. */
  wallLen?: number;
  /** Map width and height; the wall starts at x = 15 and has a one-tile gap at y = 5. */
  width?: number;
  height?: number;
}

export interface ChokeReading {
  /** Teams that ended east of the wall (for a westbound group: west of it) by the last tick. */
  through: number;
  teams: number;
  /** Seconds until the last team crossed, or null when some never did (a deadlock inside the cap). */
  clearedAtS: number | null;
  valve: number;
  contact: number;
  /** Overlapping same-side pair-ticks while they crossed (bodies). */
  overlapPairTicks: number;
  ticks: number;
}

export const WALL_X = 15;
export const GAP_Y = 5;

/** Build the choke world: a wall at x = 15 from top to bottom with one open tile at y = 5, and every group spawned and ordered. */
export function chokeWorld(opts: ChokeOpts): { sim: Sim; ids: number[] } {
  const w = opts.width ?? 30;
  const h = opts.height ?? 11;
  const sim = new Sim({ seed: 424242, width: w, height: h, capacity: 64 });
  for (let x = WALL_X; x < WALL_X + (opts.wallLen ?? 1); x++) for (let y = 0; y < h; y++) if (y !== GAP_Y) sim.setBlocked(x, y, true);
  const typeOf = registerAll(sim);
  for (const u of opts.extraTypes ?? []) typeOf.set(u.id, sim.addUnitType(u));
  const ids: number[] = [];
  for (const g of opts.groups) {
    const t = typeOf.get(g.unit);
    if (t === undefined) throw new Error(`chokeWorld: unknown unit ${g.unit}`);
    const facing = g.goalX < g.x ? TURN / 2 : 0;
    const id = sim.spawn(t, 0, fx.from(g.x), fx.from(g.y), facing);
    ids.push(id);
    if (opts.groupGoal === undefined) sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(g.goalX), y: fx.from(g.goalY), ...(g.exact === true ? { exact: true } : {}) });
  }
  if (opts.groupGoal !== undefined) sim.queueCommand({ kind: 'move', ids: [...ids], x: fx.from(opts.groupGoal.x), y: fx.from(opts.groupGoal.y) });
  return { sim, ids };
}

/** Run a choke scene and read it. */
export function runChoke(opts: ChokeOpts): ChokeReading {
  const { sim, ids } = chokeWorld(opts);
  const d = sim.sepDiag;
  d.on = true;
  const cap = Math.round((opts.seconds ?? 120) * TICKS_PER_SECOND);
  const westbound = opts.groups.map((g) => g.goalX < g.x);
  const crossed = (k: number): boolean => {
    const x = fx.toNumber(sim.state.posX[ids[k]]);
    return westbound[k] ? x < WALL_X : x > WALL_X + (opts.wallLen ?? 1);
  };
  let overlapPairTicks = 0;
  let clearedAt: number | null = null;
  let t = 0;
  for (; t < cap; t++) {
    sim.tick();
    overlapPairTicks += overlaps(entriesOf(sim)).length;
    if (ids.every((_, k) => crossed(k))) {
      clearedAt = t + 1;
      break;
    }
  }
  return {
    through: ids.filter((_, k) => crossed(k)).length,
    teams: ids.length,
    clearedAtS: clearedAt === null ? null : clearedAt / TICKS_PER_SECOND,
    valve: d.valve,
    contact: d.arrive,
    overlapPairTicks,
    ticks: t,
  };
}

/** `inf_squad` with a circle footprint of radius `r`: the S5c participant, available now as a test-only type. */
export function footCircleType(r: number, id = 'inf_squad_circle'): UnitTypeJson {
  const base = JSON.parse(JSON.stringify((units as Record<string, unknown>).inf_squad)) as UnitTypeJson & { mobility: Record<string, unknown> };
  (base as { id: string }).id = id;
  base.mobility.footprint = { half_length_tiles: r, half_width_tiles: r };
  return base;
}

/** The spec's probe: 12 teams, three files of four, through the 1-tile door, ONE group move (formation slots) to the far side. */
export function chokeTwelve(unit: string, extraTypes: readonly UnitTypeJson[] = []): ChokeReading {
  const groups: ChokeOpts['groups'][number][] = [];
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 4; r++) groups.push({ unit, x: 5.5 + c, y: 3.5 + r, goalX: 23.5, goalY: GAP_Y + 0.5 });
  }
  return runChoke({ groups, extraTypes, groupGoal: { x: 23.5, y: GAP_Y + 0.5 } });
}

// ---------------------------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------------------------

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${((100 * n) / d).toFixed(1)}%`);
const per1000 = (n: number, d: number): string => (d === 0 ? '-' : ((1000 * n) / d).toFixed(2));
const tallyStr = (t: PairTally): string => `${tallyTotal(t)} (${t['foot-foot']} / ${t['foot-vehicle']} / ${t['vehicle-vehicle']})`;

function sumTallies(ts: readonly PairTally[]): PairTally {
  const o = emptyTally();
  for (const t of ts) for (const k of Object.keys(o) as (keyof PairTally)[]) o[k] += t[k];
  return o;
}

export function startsTable(rs: readonly StartReading[]): string[] {
  const lines: string[] = [];
  lines.push('TICK 0, by bodies (GH-421 capsules for hulls, the spec\'s foot circles for teams); a pair counts past 0.02 tile.');
  lines.push('Overlapping same-side pairs: total (foot-foot / foot-vehicle / vehicle-vehicle).');
  lines.push('');
  lines.push('| starts | bodies | overlapping pairs | starts with a pair | deepest |');
  lines.push('|---|---|---|---|---|');
  const groups: [string, (r: StartReading) => boolean][] = [
    ['shipped missions', (r) => r.group === 'mission'],
    ['versus cells (every fair map as a mirror, both spawn orders where KDF v Sarim is offered: camps repeat across cells, so this is NOT the spec\'s 6-end row)', (r) => r.group === 'versus'],
    ['free play (41 maps)', (r) => r.group === 'freeplay'],
  ];
  for (const [label, pick] of groups) {
    const g = rs.filter(pick);
    if (g.length === 0) continue;
    const pairs = sumTallies(g.map((r) => r.pairs));
    const worst = g.reduce((m, r) => Math.max(m, r.deepest), 0);
    lines.push(`| ${label} (${g.length}) | ${g.reduce((n, r) => n + r.bodies, 0)} | ${tallyStr(pairs)} | ${g.filter((r) => tallyTotal(r.pairs) > 0).length} | ${worst.toFixed(2)} |`);
  }
  const ms = rs.filter((r) => r.group === 'mission');
  if (ms.length > 0) {
    const p0 = sumTallies(ms.map((r) => r.pairsSide0));
    lines.push(`| shipped missions, side 0 only, ground bodies (the spec's 292 bodies counts aircraft; its 15/28/29 split is unreproduced, cause unknown) | ${ms.reduce((n, r) => n + r.bodiesSide0, 0)} | ${tallyStr(p0)} | ${ms.filter((r) => tallyTotal(r.pairsSide0) > 0).length} | |`);
  }
  const all = sumTallies(rs.map((r) => r.pairs));
  lines.push(`| TOTAL | ${rs.reduce((n, r) => n + r.bodies, 0)} | ${tallyStr(all)} | ${rs.filter((r) => tallyTotal(r.pairs) > 0).length} | |`);
  lines.push('');
  const cp = new Map<string, number>();
  for (const r of rs) for (const [k, n] of Object.entries(r.classPairs)) cp.set(k, (cp.get(k) ?? 0) + n);
  lines.push('By formation class pair (all starts): ' + ([...cp].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'));
  lines.push('');
  lines.push('Starts with overlapping pairs (worst first):');
  for (const r of [...rs].filter((x) => tallyTotal(x.pairs) > 0).sort((a, b) => tallyTotal(b.pairs) - tallyTotal(a.pairs) || b.deepest - a.deepest)) {
    lines.push(`  ${r.group.padEnd(8)} ${r.name.padEnd(44)} ${tallyStr(r.pairs)}  deepest ${r.deepest.toFixed(2)}`);
  }
  const unlisted = new Set(rs.flatMap((r) => r.unlisted));
  if (unlisted.size > 0) lines.push(`\nFoot types missing from FOOT_RADIUS (default ${FOOT_RADIUS_DEFAULT} used): ${[...unlisted].join(', ')}`);
  return lines;
}

export function blockedTable(rs: readonly StartReading[]): string[] {
  const ms = rs.filter((r) => r.group === 'mission');
  const lines: string[] = [];
  const foot = ms.reduce((n, r) => n + r.blocked.foot, 0);
  const garrison = ms.reduce((n, r) => n + r.blocked.garrison, 0);
  const other = ms.reduce((n, r) => n + r.blocked.other, 0);
  lines.push(`BODIES ON A BLOCKED TILE at tick 0, shipped missions (all sides): foot ${foot}, vehicle ${ms.reduce((n, r) => n + r.blocked.vehicle, 0)}.`);
  lines.push(`Of those, ${garrison} had a \`garrison\` command queued by start() (the exemption assertGroundClear makes on purpose); ${other} did not.`);
  for (const r of ms.filter((x) => x.blocked.foot + x.blocked.vehicle > 0)) {
    lines.push(`  ${r.name.padEnd(30)} on blocked ${r.blocked.foot + r.blocked.vehicle}: garrison ${r.blocked.garrison}, other ${r.blocked.other}${r.blocked.otherUnits.length ? ' [' + r.blocked.otherUnits.join(' ') + ']' : ''}`);
  }
  const fp = rs.filter((r) => r.group !== 'mission');
  const fpV = fp.reduce((n, r) => n + r.blocked.vehicle, 0);
  const fpF = fp.reduce((n, r) => n + r.blocked.foot, 0);
  lines.push(`Versus and free play: foot ${fpF}, vehicle ${fpV} on a tile closed to their own mask.`);
  return lines;
}

export function playTable(accs: readonly PlayAcc[]): string[] {
  const lines: string[] = [];
  const sum = (f: (a: PlayAcc) => number): number => accs.reduce((n, a) => n + f(a), 0);
  const foot = sum((a) => a.unitTicks.foot);
  const veh = sum((a) => a.unitTicks.vehicle);
  const footW = sum((a) => a.unitTicksWheeled.foot);
  const vehW = sum((a) => a.unitTicksWheeled.vehicle);
  const all = foot + veh;
  lines.push(`IN PLAY: ${accs.length} missions, the sensible plan at seed 424242, ${all} ground unit-ticks (by body: ${foot} foot, ${veh} vehicle; by the sim's wheeled flag: ${footW} foot, ${vehW} vehicle: a moto_rpg is a foot circle on a wheeled mask). Same-side neighbours only.`);
  lines.push('');
  lines.push('| measure | by bodies (> 0.02 tile) | by centres (< 0.3 tile, the cloud census) |');
  lines.push('|---|---|---|');
  const nb = (k: 'foot' | 'vehicle' | 'cross' | 'any', m: 'body' | 'centre'): number => sum((a) => a.near[m][k]);
  lines.push(`| foot unit-ticks with a foot neighbour | ${pct(nb('foot', 'body'), foot)} | ${pct(nb('foot', 'centre'), footW)} |`);
  lines.push(`| vehicle unit-ticks with a vehicle neighbour | ${pct(nb('vehicle', 'body'), veh)} | ${pct(nb('vehicle', 'centre'), vehW)} |`);
  lines.push(`| unit-ticks with a neighbour of the other class | ${pct(nb('cross', 'body'), all)} | ${pct(nb('cross', 'centre'), all)} |`);
  lines.push(`| unit-ticks with any neighbour | ${pct(nb('any', 'body'), all)} | ${pct(nb('any', 'centre'), all)} |`);
  lines.push('');
  const pt = sumTallies(accs.map((a) => a.pairTicks));
  lines.push(`Overlapping pair-ticks (bodies): foot-foot ${pt['foot-foot']}, foot-vehicle ${pt['foot-vehicle']}, vehicle-vehicle ${pt['vehicle-vehicle']}`);
  lines.push(`Valve opens ${sum((a) => a.valve)} (${per1000(sum((a) => a.valve), all)} per 1,000 unit-ticks); legs ended at contact ${sum((a) => a.contact)} (${per1000(sum((a) => a.contact), all)} per 1,000). Both count participants only: vehicles today.`);
  const fm = sum((a) => a.footMoving);
  lines.push(`Foot unit-ticks under a move order: ${fm}. Speed-zero runs of 1-2 ticks inside a moving leg: ${sum((a) => a.zeroRuns)} (${per1000(sum((a) => a.zeroRuns), foot)} per 1,000 foot unit-ticks; S7's bar is a real count).`);
  lines.push(`Facing reversals over 30 degrees within 3 ticks: ${sum((a) => a.reversals)} (${per1000(sum((a) => a.reversals), foot)} per 1,000 foot unit-ticks; S7's bar is 1).`);
  lines.push('');
  lines.push('| mission | unit-ticks | foot-foot % (bodies / centres) | veh-veh % (bodies / centres) | any % (bodies / centres) | valve | contact |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const a of [...accs].sort((x, y) => y.near.centre.any / Math.max(1, y.unitTicks.foot + y.unitTicks.vehicle) - x.near.centre.any / Math.max(1, x.unitTicks.foot + x.unitTicks.vehicle))) {
    const u = a.unitTicks.foot + a.unitTicks.vehicle;
    lines.push(
      `| ${a.mission} | ${u} | ${pct(a.near.body.foot, a.unitTicks.foot)} / ${pct(a.near.centre.foot, a.unitTicksWheeled.foot)} | ${pct(a.near.body.vehicle, a.unitTicks.vehicle)} / ${pct(a.near.centre.vehicle, a.unitTicksWheeled.vehicle)} | ${pct(a.near.body.any, u)} / ${pct(a.near.centre.any, u)} | ${a.valve} | ${a.contact} |`,
    );
  }
  return lines;
}

export function chokeTable(rows: readonly { arm: string; r: ChokeReading }[]): string[] {
  const lines = ['THE CHOKE. Rows 1-2: 12 teams, three files of four, through a 1-tile door in a wall (x=15, gap y=5), one group move to the far side. Rows 3-5: two bodies meeting head-on in a 6-long one-tile corridor.', ''];
  lines.push('| arm | through | cleared in | valve opens | legs ended at contact | overlapping pair-ticks |');
  lines.push('|---|---|---|---|---|---|');
  for (const { arm, r } of rows) {
    lines.push(`| ${arm} | ${r.through}/${r.teams} | ${r.clearedAtS === null ? `NOT CLEARED in ${(r.ticks / TICKS_PER_SECOND).toFixed(0)} s` : `${r.clearedAtS.toFixed(1)} s`} | ${r.valve} | ${r.contact} | ${r.overlapPairTicks} |`);
  }
  return lines;
}

/** The in-play reading: the sensible plan of every mission, through playtest-run's own tap. Slow (minutes). */
export async function playReading(log: (s: string) => void = () => {}): Promise<PlayAcc[]> {
  // The plan-child mode runs every winning plan down its own chained ledgers on one seed, skips the controls and the
  // max-tier replay, and starts no worker processes: exactly the run the cloud census used. These are read at import.
  process.env.PT_PLAN_CHILD = '1';
  process.env.PT_SEED = '424242';
  process.env.PT_SWEEP_WORKERS = '0';
  const run = await import('./playtest-run');
  const sims: { sim: Sim; acc: PlayAcc; ps: PlayState }[] = [];
  let current: { sim: Sim; acc: PlayAcc; ps: PlayState } | undefined;
  run.tapMissionEvents((_evs, _rt, sim) => {
    if (current === undefined || current.sim !== sim) {
      sim.sepDiag.on = true;
      current = { sim, acc: newPlayAcc(''), ps: new PlayState(sim.capacity) };
      sims.push(current);
    }
    sampleTick(sim, current.acc, current.ps);
  });
  const quiet = console.log;
  console.log = (): void => {};
  try {
    await import('./playtest');
  } finally {
    console.log = quiet;
    run.tapMissionEvents(undefined);
  }
  // runLog is pushed once per finished run, in order, and carries the tick the run ended on. A tapped sim belongs to
  // the next log entry whose `endTick` it ended on; a tapped sim no entry claims (a run `run()` did not log) is skipped.
  const out: PlayAcc[] = [];
  const seen = new Set<string>();
  let k = 0;
  let skipped = 0;
  for (const rec of run.runLog) {
    while (k < sims.length && sims[k].sim.tickCount !== rec.endTick) {
      k++;
      skipped++;
    }
    if (k >= sims.length) throw new Error(`play reading: no tapped run ended at tick ${rec.endTick} for ${rec.label}`);
    const { acc, sim } = sims[k++];
    acc.valve = sim.sepDiag.valve;
    acc.contact = sim.sepDiag.arrive;
    if (rec.label !== rec.id || rec.expect !== 'victory' || seen.has(rec.id)) continue;
    seen.add(rec.id);
    acc.mission = rec.id;
    out.push(acc);
  }
  skipped += sims.length - k;
  log(`play reading: ${sims.length} runs tapped, ${run.runLog.length} logged, ${skipped} tapped but not logged, ${out.length} missions kept`);
  return out;
}

export interface CensusJson {
  starts: StartReading[];
  choke: { arm: string; r: ChokeReading }[];
  play?: PlayAcc[];
}

export function headOn(unit: string, extraTypes: readonly UnitTypeJson[] = []): ChokeReading {
  return runChoke({
    wallLen: 6,
    seconds: 60,
    extraTypes,
    groups: [
      { unit, x: 11.5, y: 5.5, goalX: 24.5, goalY: 5.5, exact: true },
      { unit, x: 24.5, y: 5.5, goalX: 11.5, goalY: 5.5, exact: true },
    ],
  });
}

export function chokeArms(): { arm: string; r: ChokeReading }[] {
  const circle = footCircleType(0.45);
  return [
    { arm: '12 teams, today: no foot footprint', r: chokeTwelve('inf_squad') },
    { arm: '12 teams, circles r 0.45 (S5c participants)', r: chokeTwelve('inf_squad_circle', [circle]) },
    { arm: 'head-on pair, two Lavis (1.14 wide: cannot pass)', r: headOn('mbt_lavi') },
    { arm: 'head-on pair, two jeeps (0.78 wide: slide past)', r: headOn('jeep_shoded') },
    { arm: 'head-on pair, two circle teams r 0.45', r: headOn('inf_squad_circle', [circle]) },
  ];
}

/** Every start the census reads, built one at a time (a Sim is not small) and handed to `each`. */
export function eachStart(each: (st: Start) => void): void {
  for (const id of missionIds()) each(missionStart(id));
  for (const c of versusCells()) each(versusStart(c.map, c.arrangement));
  for (const m of Object.keys(maps)) {
    let st: Start;
    try {
      st = freePlayStart(m);
    } catch (e) {
      console.error(`free play on ${m} skipped: ${(e as Error).message}`);
      continue;
    }
    each(st);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonPath = args.find((a) => a.startsWith('--json='))?.slice('--json='.length);
  const play = args.includes('--play');
  console.log(`unit spacing census (GH-1360 S0), report only; contact > ${CONTACT_EPS} tile; seed 424242\n`);
  const starts: StartReading[] = [];
  eachStart((st) => starts.push(readStart(st)));
  for (const l of startsTable(starts)) console.log(l);
  console.log('');
  for (const l of blockedTable(starts)) console.log(l);
  console.log('');
  const choke = chokeArms();
  for (const l of chokeTable(choke)) console.log(l);
  const json: CensusJson = { starts, choke };
  if (play) {
    console.log('');
    const acc = await playReading((s) => console.log(s));
    for (const l of playTable(acc)) console.log(l);
    json.play = acc;
    process.exitCode = 0; // report-only: a playtest gate that fired is playtest's to report, not this tool's
  }
  if (jsonPath !== undefined) writeFileSync(jsonPath, JSON.stringify(json, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
