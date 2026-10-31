/**
 * Combat formations, the pure template (GH-859 P1a; spec
 * docs/superpowers/specs/2026-10-28-combat-formations-design.md §3.2, §4.2, §4.5; plan
 * docs/superpowers/plans/2026-10-28-formations-p1a.md Task 2).
 *
 * Unwired: nothing in `sim.ts` calls any of this yet, so no hash can move. A formation FILE is
 * compiled once (`compileFormation`), each unit gets a CLASS once (`formationClassOf`), and
 * `assignTemplate` fits the file's elements to the ground, the way `assignFormation`
 * (formation.ts) fits the old grid -- same frame, same sorted ids, same N-E-S-W walk, same
 * behind-first overflow (it is the SAME `overflowPlace`), so the two cannot drift.
 *
 * Integers only (invariant 2). A facing is an eighth-turn constant (0 = +x, 16384 = +y) chosen
 * by integer comparisons; the ring is the integer midpoint circle; nothing here draws a random
 * number (invariant 3) -- every tie breaks by id or tile index.
 */
import { DIR_DX, DIR_DY, DIR_NONE } from './flowfield';
import { overflowPlace, walk, type Reach } from './formation';
import { FORMATION_WALK_CAP } from './tuning';

/** The seven classes a formation places, in a fixed order: the index IS the class code. */
export const FORMATION_CLASSES = ['armour', 'light_vehicle', 'recon', 'infantry', 'support_weapon', 'medic', 'aircraft'] as const;
export type FormationClassName = (typeof FORMATION_CLASSES)[number];
export const FM_CLASS_ARMOUR = 0;
export const FM_CLASS_LIGHT_VEHICLE = 1;
export const FM_CLASS_RECON = 2;
export const FM_CLASS_INFANTRY = 3;
export const FM_CLASS_SUPPORT_WEAPON = 4;
export const FM_CLASS_MEDIC = 5;
export const FM_CLASS_AIRCRAFT = 6;
/** Only inside a compiled element's class list: "every class no earlier element took". */
export const FM_CLASS_REST = 7;
/** Never placed in a formation (wounded, civilians, an authored `formation_class: none`). */
export const FM_CLASS_NONE = 255;
/** `restFacing` when a unit has none. */
export const FM_FACING_NONE = 0xffff;
/** `fgState` of a group row: marching to its slots (also while it stands in them, in P1a). 2 (ARRIVED) stays
 *  reserved and unused: "arrived" is read per member, never stored. */
export const FM_MARCH = 1;
/** `fgState`: contact has been made (P1b drills). */
export const FM_CONTACT = 3;
/** `fgState`: the ring has sprung (every member's ambush stance is cleared). */
export const FM_SPRUNG = 4;
/** `fmArrive`: 0 none, 1 hold, 16 + R ambush with radius R. */
export const FM_ARRIVE_HOLD = 1;
export const FM_ARRIVE_AMBUSH = 16;

export const FM_VERB_MOVE = 0;
export const FM_VERB_ATTACK = 1;
export const FM_VERB_EITHER = 2;
export const FM_FACE_NONE = 0;
export const FM_FACE_FRONT = 1;
export const FM_FACE_TRAVEL = 2;
export const FM_FACE_OUTWARD = 3;
export const FM_FACE_INWARD = 4;
export const FM_DRILL_NONE = 0;
export const FM_DRILL_HALT = 1;
export const FM_DRILL_PRESS = 2;
export const FM_DRILL_SPRING = 3;
export const FM_PACE_NONE = 0;
export const FM_PACE_SLOWEST_GROUND = 1;
export const FM_SHAPE_FILES = 0;
export const FM_SHAPE_RANK = 1;
export const FM_SHAPE_RING = 2;
export const FM_SHAPE_POINT = 3;
export const FM_CALL_NONE = 0;
export const FM_CALL_CONTACT = 1;
export const FM_CALL_CASUALTY = 2;
/** `UnitType.fmCall` (Ruling 12): what an aircraft does when its group calls it. */
export const FM_CALL_STAY = 0;
export const FM_CALL_STRIKE = 1;
export const FM_CALL_SPOT = 2;

/** The sim's tick rate. Copied, not imported (formation.ts imports nothing from sim.ts either):
 *  formation-template.test.ts pins it against `TICKS_PER_SECOND`. */
const TICKS_PER_SECOND = 20;
/** The widest a `point` element (the recon screen) spreads: 0, +2, -2, +4, -4. */
const POINT_LATERALS = [0, 2, -2, 4, -4] as const;
/** How many members the extent bound budgets for in each element. */
const EXTENT_BUDGET_MEMBERS = 24;

// ---------------------------------------------------------------------------------------------
// The JSON shapes. String-typed on purpose (CLAUDE.md, "literal unions in sim JSON types break
// JSON-module call sites"): `compileFormation` checks every value and throws, naming the id.
// ---------------------------------------------------------------------------------------------

export interface FormationShapeJson {
  kind: string;
  files?: number;
  file_gap?: number;
  depth?: number;
  stagger?: number;
  spacing?: number;
  max_lateral?: number;
  rank_depth?: number;
  radius?: readonly number[];
  cover_pref?: boolean;
  ahead?: number;
}
export interface FormationElementJson {
  classes: readonly string[];
  shape: FormationShapeJson;
  gap?: number;
  standoff?: number;
  on_call?: string;
}
export interface FormationMarchJson {
  legs: boolean;
  leg_tiles: number;
  pace: string;
  dress_s: number;
}
export interface FormationJson {
  id: string;
  label: string;
  blurb: string;
  factions: readonly string[];
  verb: string;
  min_members: number;
  elements: readonly FormationElementJson[];
  march?: FormationMarchJson;
  arrival: { face: string; stance: string };
  contact: { drill: string; call_radius_tiles?: number; quiet_s?: number };
}

/** What `formationClassOf` reads of a unit file. */
export interface UnitClassJson {
  id?: string;
  faction?: string;
  role?: string;
  formation_class?: string;
  rescue?: unknown;
  hull?: { can_carry?: readonly string[] };
  mobility?: { domain?: string };
}

/** What `aircraftCallOf` reads of an AIR unit file. String-typed on purpose, like the rest of this section. */
export interface UnitCallJson {
  id?: string;
  mobility?: { domain?: string };
  hull?: { transport_slots?: number };
  abilities?: readonly string[];
  swarm?: unknown;
  weapons?: readonly { can_target?: readonly string[] }[];
}

// ---------------------------------------------------------------------------------------------
// Integer helpers (no Math.*: invariant 2).
// ---------------------------------------------------------------------------------------------

/** a / b for a >= 0, b > 0, remainder first: the tree's integer-divide idiom. */
function idiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}
function sgn(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
function abs(v: number): number {
  return v < 0 ? -v : v;
}

// ---------------------------------------------------------------------------------------------
// Classes (§3.2).
// ---------------------------------------------------------------------------------------------

/**
 * A unit's formation class. The first rule that matches wins:
 *
 *  1. role `wounded`, or the civilian faction -> none;
 *  2. a `rescue` block, or `hull.can_carry` exactly ["wounded"] -> medic;
 *  3. the air domain -> aircraft;
 *  4. role artillery or sniper -> support_weapon;
 *  5. role mbt or ifv -> armour;
 *  6. role recon -> recon;
 *  7. a wheeled hull -> light_vehicle;
 *  8. otherwise infantry.
 *
 * `formation_class` overrides all of it (an unknown string throws, naming the unit). `wheeled` is
 * the RESOLVED boolean from `addUnitType` -- the authored `mobility.wheeled`, else
 * `!FOOT_ROLES.has(role)` -- so this never re-derives it (CLAUDE.md: `FOOT_ROLES` alone is wrong).
 * The civilian rule reads `faction === "civilian"`: unit JSON has no side.
 */
export function formationClassOf(json: UnitClassJson, wheeled: boolean): number {
  const override = json.formation_class;
  if (override !== undefined) {
    if (override === 'none') return FM_CLASS_NONE;
    const idx = (FORMATION_CLASSES as readonly string[]).indexOf(override);
    if (idx < 0) throw new Error(`unit ${json.id ?? '?'}: formation_class ${override}`);
    return idx;
  }
  if (json.role === 'wounded' || json.faction === 'civilian') return FM_CLASS_NONE;
  const carry = json.hull?.can_carry;
  if (json.rescue !== undefined || (carry !== undefined && carry.length === 1 && carry[0] === 'wounded')) return FM_CLASS_MEDIC;
  if (json.mobility?.domain === 'air') return FM_CLASS_AIRCRAFT;
  if (json.role === 'artillery' || json.role === 'sniper') return FM_CLASS_SUPPORT_WEAPON;
  if (json.role === 'mbt' || json.role === 'ifv') return FM_CLASS_ARMOUR;
  if (json.role === 'recon') return FM_CLASS_RECON;
  if (wheeled) return FM_CLASS_LIGHT_VEHICLE;
  return FM_CLASS_INFANTRY;
}

/**
 * What an aircraft does when its group is in contact and calls it (Ruling 12). First match wins:
 *
 *  1. seats (`hull.transport_slots` > 0), a `kamikaze` ability or a `swarm` block -> stay (a carrier is the
 *     group's casualty collection point; a loitering munition and a swarm are spent by diving);
 *  2. a weapon that can target `ground` (an absent `can_target` means ground) -> strike;
 *  3. otherwise -> spot.
 *
 * `can_target` reads the four values `unit.schema.json` allows (ground, air, structure, subterranean); only
 * `ground` counts as a ground strike. Throws `unit <id>: <field> <value>` on a value outside that enum, or on
 * a unit that is not an aircraft.
 */
export function aircraftCallOf(json: UnitCallJson): number {
  const id = json.id ?? '?';
  const fail = (field: string, value: unknown): never => {
    throw new Error(`unit ${id}: ${field} ${String(value)}`);
  };
  if (json.mobility?.domain !== 'air') fail('mobility.domain', json.mobility?.domain);
  const seats = json.hull?.transport_slots ?? 0;
  if (!Number.isInteger(seats) || seats < 0) fail('hull.transport_slots', seats);
  const abilities = json.abilities ?? [];
  if (!Array.isArray(abilities)) fail('abilities', abilities);
  const weapons = json.weapons ?? [];
  if (!Array.isArray(weapons)) fail('weapons', weapons);
  let ground = false;
  weapons.forEach((w, i) => {
    const targets = w.can_target;
    if (targets === undefined) {
      ground = true;
      return;
    }
    if (!Array.isArray(targets)) fail(`weapons[${i}].can_target`, targets);
    for (const t of targets) {
      if (t !== 'ground' && t !== 'air' && t !== 'structure' && t !== 'subterranean') fail(`weapons[${i}].can_target`, t);
      if (t === 'ground') ground = true;
    }
  });
  if (seats > 0 || abilities.includes('kamikaze') || json.swarm !== undefined) return FM_CALL_STAY;
  return ground ? FM_CALL_STRIKE : FM_CALL_SPOT;
}

// ---------------------------------------------------------------------------------------------
// The march route (P1b Rulings 1, 2): pure, integer tiles.
// ---------------------------------------------------------------------------------------------

/**
 * Follow a flow field's dirs (`DIR_DX`/`DIR_DY`) from (sx, sy) to (gx, gy), one tile per step. Returns the
 * tile indices (y * w + x) AFTER the start, the goal last; an empty list when the start is the goal; null when
 * the walk meets `DIR_NONE`, leaves the grid, or takes w * h steps without arriving (a cycle).
 */
export function routeWalk(dirs: Uint8Array, w: number, h: number, sx: number, sy: number, gx: number, gy: number): Int32Array | null {
  const cap = w * h;
  const out = new Int32Array(cap);
  let n = 0;
  let x = sx;
  let y = sy;
  while (x !== gx || y !== gy) {
    if (n >= cap || x < 0 || y < 0 || x >= w || y >= h) return null;
    const d = dirs[y * w + x];
    if (d === DIR_NONE) return null;
    x += DIR_DX[d];
    y += DIR_DY[d];
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    out[n++] = y * w + x;
  }
  return out.slice(0, n);
}

/**
 * The route indices (0-based) of each checkpoint. The spacing is S = max(legTiles, ceil(L / budget)); the
 * checkpoints sit at S - 1, 2S - 1, ... below L - 1, and the last one is always L - 1 (the click).
 * `legTiles` 0 (a formation with `legs: false`) gives [L - 1]; L 0 gives [].
 */
export function checkpointsOf(routeLength: number, legTiles: number, budget: number): number[] {
  if (routeLength <= 0) return [];
  const last = routeLength - 1;
  if (legTiles <= 0) return [last];
  const byBudget = idiv(routeLength + budget - 1, budget);
  const spacing = legTiles > byBudget ? legTiles : byBudget;
  const out: number[] = [];
  for (let at = spacing - 1; at < last; at += spacing) out.push(at);
  out.push(last);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Facing (§4.5).
// ---------------------------------------------------------------------------------------------

/** The eight eighth-turns, indexed by (sign x + 1) + 3 * (sign y + 1); the middle (0, 0) entry is unused. */
const EIGHTH_BY_SIGNS = [40960, 49152, 57344, 32768, FM_FACING_NONE, 0, 24576, 16384, 8192] as const;

/**
 * The eighth-turn nearest the vector (dx, dy): 0 = +x, 8192 = +x+y, 16384 = +y, ... (a quarter
 * turn is 16384). By integer comparison, no atan: an axis wins only when it is MORE than twice the
 * other component (|dx| > 2|dy| or |dy| > 2|dx|), so exactly 2:1 (26.6 degrees) is the diagonal
 * it is nearest to; anything else is the diagonal. (0, 0) has no direction: FM_FACING_NONE.
 */
export function eighthToward(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return FM_FACING_NONE;
  const ax = abs(dx);
  const ay = abs(dy);
  // An axis wins by more than 2:1; the other component is then dropped.
  const sx = ay > 2 * ax ? 0 : sgn(dx);
  const sy = ax > 2 * ay ? 0 : sgn(dy);
  return EIGHTH_BY_SIGNS[sx + 1 + 3 * (sy + 1)];
}

// ---------------------------------------------------------------------------------------------
// The ring (F3).
// ---------------------------------------------------------------------------------------------

const ringCache = new Map<number, readonly (readonly [number, number])[]>();

/**
 * The integer midpoint circle at radius `r`, as (forward, lateral), in ANGULAR order: the first
 * octant's steps from (r, 0), then each next octant counter-clockwise, every odd octant's steps
 * reversed so the walk is continuous, and a tile repeated at an octant boundary dropped. Angular
 * order is what makes the ring's spread a spread.
 *
 * The decision step uses `P < 0` (not `<= 0`): at R = 6 the two differ by four tiles, and the
 * plan's counts (12, 16, 24, 28, 32, 40, 44 at R = 2..8) are the strict ones.
 */
export function ringTiles(r: number): readonly (readonly [number, number])[] {
  const hit = ringCache.get(r);
  if (hit !== undefined) return hit;
  const arc: [number, number][] = [];
  let x = r;
  let y = 0;
  let p = 1 - r;
  while (x >= y) {
    arc.push([x, y]);
    y++;
    if (p < 0) p += 2 * y + 1;
    else {
      x--;
      p += 2 * y - 2 * x + 1;
    }
  }
  const out: [number, number][] = [];
  const push = (f0: number, l0: number): void => {
    // `+ 0` turns a negated zero (-0) into 0: a reflection of a zero component must not leak one.
    const f = f0 + 0;
    const l = l0 + 0;
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === f && last[1] === l) return;
    out.push([f, l]);
  };
  for (let oct = 0; oct < 8; oct++) {
    const reversed = oct % 2 === 1;
    for (let k = 0; k < arc.length; k++) {
      const [ax, ay] = arc[reversed ? arc.length - 1 - k : k];
      // The eight reflections of (ax, ay), in counter-clockwise octant order.
      switch (oct) {
        case 0: push(ax, ay); break;
        case 1: push(ay, ax); break;
        case 2: push(-ay, ax); break;
        case 3: push(-ax, ay); break;
        case 4: push(-ax, -ay); break;
        case 5: push(-ay, -ax); break;
        case 6: push(ay, -ax); break;
        default: push(ax, -ay); break;
      }
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && last[0] === first[0] && last[1] === first[1]) out.pop();
  // Frozen, tile pairs included: the cache is shared by every order and exported to the app, so a
  // cast there must not be able to move the ring the sim places from.
  for (const pair of out) Object.freeze(pair);
  Object.freeze(out);
  ringCache.set(r, out);
  return out;
}

/** 0..m-1 sorted by bit-reversed value (van der Corput): the first listed are spread furthest apart. */
function spreadOrder(m: number): number[] {
  let bits = 0;
  while (1 << bits < m) bits++;
  const rev = (i: number): number => {
    let v = 0;
    for (let b = 0; b < bits; b++) if ((i >> b) & 1) v |= 1 << (bits - 1 - b);
    return v;
  };
  const idx: number[] = [];
  for (let i = 0; i < m; i++) idx.push(i);
  idx.sort((a, b) => rev(a) - rev(b));
  return idx;
}

// ---------------------------------------------------------------------------------------------
// Compile.
// ---------------------------------------------------------------------------------------------

export interface CompiledElement {
  /** Class codes in file order; FM_CLASS_REST stands for "every class no earlier element took". */
  readonly classes: readonly number[];
  readonly classMask: number;
  readonly kind: number;
  readonly files: number;
  readonly fileGap: number;
  readonly depth: number;
  readonly stagger: number;
  readonly spacing: number;
  readonly maxLateral: number;
  readonly rankDepth: number;
  readonly radiusMin: number;
  readonly radiusMax: number;
  readonly coverPref: number;
  readonly ahead: number;
  readonly gap: number;
  readonly standoff: number;
  readonly onCall: number;
}

export interface CompiledFormation {
  readonly id: string;
  readonly verb: number;
  readonly minMembers: number;
  readonly elements: readonly CompiledElement[];
  /** Per class code 0..6: the index of the element that takes it. */
  readonly elementOfClass: readonly number[];
  readonly face: number;
  readonly arriveStance: number;
  readonly drill: number;
  /** The walk depth, capped at FORMATION_WALK_CAP. */
  readonly extent: number;
  // P1b reads these; P1a compiles and stores them and reads nothing:
  /** `march.legs`: false (or no march block) compiles to one checkpoint, `legTiles` 0. */
  readonly legs: boolean;
  readonly legTiles: number;
  readonly dressTicks: number;
  readonly pace: number;
  readonly callRadius: number;
  readonly quietTicks: number;
}

function bad(id: string, field: string, value: unknown): never {
  throw new Error(`formation ${id}: ${field} ${String(value)}`);
}
function pick(id: string, field: string, value: string | undefined, names: readonly string[]): number {
  const i = value === undefined ? -1 : names.indexOf(value);
  if (i < 0) bad(id, field, value);
  return i;
}
function int(id: string, field: string, value: number | undefined, lo: number, hi: number, dflt?: number): number {
  const v = value === undefined ? dflt : value;
  if (v === undefined || !Number.isInteger(v) || v < lo || v > hi) bad(id, field, v);
  return v;
}

const FACE_NAMES = ['none', 'front', 'travel', 'outward', 'inward'] as const;
const STANCE_NAMES = ['none', 'hold', 'ambush'] as const;
const DRILL_NAMES = ['none', 'halt', 'press', 'spring'] as const;
const VERB_NAMES = ['move', 'attackMove', 'either'] as const;
const PACE_NAMES = ['none', 'slowest_ground'] as const;
const KIND_NAMES = ['files', 'rank', 'ring', 'point'] as const;
const CALL_NAMES = ['none', 'contact', 'casualty'] as const;
const CLASS_NAMES_WITH_REST = [...FORMATION_CLASSES, 'rest'] as const;

/** Throws `formation <id>: <field> <value>` on anything the schema would refuse. Seconds become ticks (x20). */
export function compileFormation(json: FormationJson): CompiledFormation {
  const id = json.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(id)) bad(String(id), 'id', id);
  const verb = pick(id, 'verb', json.verb, VERB_NAMES);
  const minMembers = int(id, 'min_members', json.min_members, 2, 255);
  if (!Array.isArray(json.factions) || json.factions.length === 0) bad(id, 'factions', json.factions);
  for (const f of json.factions) if (f !== 'kdf' && f !== 'sarim') bad(id, 'factions', f);
  if (!Array.isArray(json.elements) || json.elements.length === 0) bad(id, 'elements', json.elements);

  const elements: CompiledElement[] = [];
  let depthBudget = 0;
  let lateralBudget = 0;
  let standoffMax = 0;
  json.elements.forEach((el, i) => {
    const at = `elements[${i}]`;
    if (!Array.isArray(el.classes) || el.classes.length === 0) bad(id, `${at}.classes`, el.classes);
    const classes: number[] = [];
    let classMask = 0;
    for (const c of el.classes) {
      const code = pick(id, `${at}.classes`, c, CLASS_NAMES_WITH_REST);
      if ((classMask & (1 << code)) !== 0) bad(id, `${at}.classes`, `${c} twice`);
      classMask |= 1 << code;
      classes.push(code);
    }
    if ((classMask & (1 << FM_CLASS_REST)) !== 0 && i !== json.elements.length - 1) bad(id, `${at}.classes`, 'rest not last');
    if (el.shape === undefined) bad(id, `${at}.shape`, el.shape);
    const kind = pick(id, `${at}.shape.kind`, el.shape.kind, KIND_NAMES);
    const s = el.shape;
    const gap = int(id, `${at}.gap`, el.gap, 0, 64, 0);
    const standoff = int(id, `${at}.standoff`, el.standoff, 0, 64, 0);
    const onCall = pick(id, `${at}.on_call`, el.on_call ?? 'none', CALL_NAMES);
    let files = 0;
    let fileGap = 0;
    let depth = 0;
    let stagger = 0;
    let spacing = 0;
    let maxLateral = 0;
    let rankDepth = 0;
    let radiusMin = 0;
    let radiusMax = 0;
    let coverPref = 0;
    let ahead = 0;
    let rows: number;
    let lat: number;
    if (kind === FM_SHAPE_FILES) {
      files = int(id, `${at}.shape.files`, s.files, 1, 3);
      fileGap = int(id, `${at}.shape.file_gap`, s.file_gap, 1, 16, 1);
      depth = int(id, `${at}.shape.depth`, s.depth, 1, 16);
      stagger = int(id, `${at}.shape.stagger`, s.stagger, 0, 16, 0);
      rows = idiv(EXTENT_BUDGET_MEMBERS + files - 1, files) * depth + (files - 1) * stagger;
      lat = (files - 1) * fileGap;
    } else if (kind === FM_SHAPE_RANK) {
      spacing = int(id, `${at}.shape.spacing`, s.spacing, 1, 16);
      maxLateral = int(id, `${at}.shape.max_lateral`, s.max_lateral, 0, 8);
      rankDepth = int(id, `${at}.shape.rank_depth`, s.rank_depth, 1, 16);
      const perRank = 1 + 2 * idiv(maxLateral, spacing);
      rows = idiv(EXTENT_BUDGET_MEMBERS + perRank - 1, perRank) * rankDepth;
      lat = maxLateral;
    } else if (kind === FM_SHAPE_RING) {
      if (!Array.isArray(s.radius) || s.radius.length !== 2) bad(id, `${at}.shape.radius`, s.radius);
      radiusMin = int(id, `${at}.shape.radius[0]`, s.radius[0], 2, 8);
      radiusMax = int(id, `${at}.shape.radius[1]`, s.radius[1], 2, 8);
      if (radiusMin > radiusMax) bad(id, `${at}.shape.radius`, `${radiusMin} > ${radiusMax}`);
      if (typeof s.cover_pref !== 'boolean') bad(id, `${at}.shape.cover_pref`, s.cover_pref);
      coverPref = s.cover_pref ? 1 : 0;
      rows = 2 * radiusMax;
      lat = radiusMax;
    } else {
      ahead = int(id, `${at}.shape.ahead`, s.ahead, 1, 6);
      rows = 0;
      lat = 4;
    }
    depthBudget += gap + rows;
    if (lat > lateralBudget) lateralBudget = lat;
    if (standoff > standoffMax) standoffMax = standoff;
    elements.push({
      classes, classMask, kind, files, fileGap, depth, stagger, spacing, maxLateral, rankDepth, radiusMin, radiusMax, coverPref, ahead, gap, standoff, onCall,
    });
  });

  // Which element takes each class: the first to name it, else the `rest` element, else the last.
  const elementOfClass: number[] = [];
  for (let c = 0; c < FORMATION_CLASSES.length; c++) {
    let at = -1;
    for (let e = 0; e < elements.length && at < 0; e++) if ((elements[e].classMask & (1 << c)) !== 0) at = e;
    for (let e = 0; e < elements.length && at < 0; e++) if ((elements[e].classMask & (1 << FM_CLASS_REST)) !== 0) at = e;
    elementOfClass.push(at < 0 ? elements.length - 1 : at);
  }

  const face = pick(id, 'arrival.face', json.arrival?.face, FACE_NAMES);
  const stance = pick(id, 'arrival.stance', json.arrival?.stance, STANCE_NAMES);
  const drill = pick(id, 'contact.drill', json.contact?.drill, DRILL_NAMES);
  const callRadius = int(id, 'contact.call_radius_tiles', json.contact.call_radius_tiles, 4, 24, 12);
  const quietS = int(id, 'contact.quiet_s', json.contact.quiet_s, 2, 30, 10);
  let legs = false;
  let legTiles = 0;
  let dressTicks = 0;
  let pace = FM_PACE_NONE;
  if (json.march !== undefined) {
    if (typeof json.march.legs !== 'boolean') bad(id, 'march.legs', json.march.legs);
    legs = json.march.legs;
    // leg_tiles is still range-checked when legs is false; it just compiles to 0 ("one checkpoint").
    const tiles = int(id, 'march.leg_tiles', json.march.leg_tiles, 4, 16);
    legTiles = legs ? tiles : 0;
    pace = pick(id, 'march.pace', json.march.pace, PACE_NAMES);
    dressTicks = int(id, 'march.dress_s', json.march.dress_s, 0, 10) * TICKS_PER_SECOND;
  }
  // The walk must reach the deepest and widest slot any generator can emit for a 24-unit order,
  // then a few tiles more: a rank's lateral offset is not free of the walk (a slot is reachable
  // only through open tiles). Capped: an order-time cost, never a per-tick one.
  const deep = depthBudget > standoffMax + 2 ? depthBudget : standoffMax + 2;
  const wide = deep + lateralBudget;
  return {
    id,
    verb,
    minMembers,
    elements,
    elementOfClass,
    face,
    arriveStance: stance === 0 ? 0 : stance === 1 ? FM_ARRIVE_HOLD : FM_ARRIVE_AMBUSH,
    drill,
    extent: wide > FORMATION_WALK_CAP ? FORMATION_WALK_CAP : wide,
    legs,
    legTiles,
    dressTicks,
    pace,
    callRadius,
    quietTicks: quietS * TICKS_PER_SECOND,
  };
}

// ---------------------------------------------------------------------------------------------
// The fill: one routine, two grounds (the world, and open ground for the HUD's schematic).
// ---------------------------------------------------------------------------------------------

interface FillMember {
  id: number;
  domain: number;
  cls: number;
  /** A ground vehicle (not an aircraft). */
  vehicle: boolean;
  elem: number;
  /** The class's position in its element's list: the fill order inside an element. */
  pos: number;
}

/** Where a template is fitted: the world's tiles, or open ground in frame coordinates. */
interface Ground {
  /** `deep`: the spill of a `files` element past its walk (S3), judged on the deeper reach. */
  usable(m: FillMember, track: number, f: number, l: number, deep?: boolean): boolean;
  /** How many rows behind the click any ground can hold: the spill's bound. */
  readonly deepest: number;
  take(m: FillMember, track: number, f: number, l: number): void;
  coverAt(track: number, f: number, l: number): number;
  /** Tile index, the cover tie-break between a position's inward and outward candidates. */
  keyAt(track: number, f: number, l: number): number;
  /** 1 for an element made only of ground vehicles whose snapped origin is not the foot click. */
  trackOf(vehicleOnly: boolean, domain: number): number;
}

interface Placed {
  f: number;
  l: number;
  track: number;
}

function fill(tpl: CompiledFormation, members: readonly FillMember[], g: Ground): { placed: (Placed | null)[]; ringRadius: number } {
  const n = members.length;
  const placed: (Placed | null)[] = [];
  for (let i = 0; i < n; i++) placed.push(null);
  const ext = tpl.extent;
  // The stack: per track, the deepest forward row any populated element has actually used.
  const hasTop = [false, false];
  const top = [0, 0];
  let ringRadius = 0;

  let i = 0;
  while (i < n) {
    const e = members[i].elem;
    let j = i;
    while (j < n && members[j].elem === e) j++;
    const el = tpl.elements[e];
    let vehicleOnly = true;
    for (let k = i; k < j; k++) if (!members[k].vehicle) vehicleOnly = false;
    const track = g.trackOf(vehicleOnly, members[i].domain);

    // An element's front row sits behind the last row used, past its gap; a standoff pushes it
    // further back if that is deeper. The first populated element of a track starts at the click.
    let frontRow = hasTop[track] ? top[track] - el.gap - 1 : 0;
    if (el.standoff > 0 && frontRow > -el.standoff) frontRow = -el.standoff;

    let usedAny = false;
    let usedRear = 0;
    let next = i;
    const put = (f: number, l: number, deep?: boolean): boolean => {
      const m = members[next];
      if (!g.usable(m, track, f, l, deep)) return false;
      g.take(m, track, f, l);
      placed[next] = { f, l, track };
      if (el.kind !== FM_SHAPE_POINT && (!usedAny || f < usedRear)) usedRear = f;
      usedAny = true;
      next++;
      return true;
    };

    if (el.kind === FM_SHAPE_FILES) {
      // Slot k is file k % files, row k / files, forward = -(row * depth + file * stagger): file 0
      // is on the click line, so a one-tile street keeps a whole file (Ruling 4). An unusable slot
      // is skipped and the element runs on.
      for (let k = 0; next < j; k++) {
        const row = idiv(k, el.files);
        const file = k - row * el.files;
        const f = frontRow - (row * el.depth + file * el.stagger);
        // Past the walk's cap the pattern RUNS ON, deeper and with its own depth, stagger and file gap (so
        // the spacing holds): a column longer than the cap is a longer column, not a knot at the click
        // (S3). Those slots are judged on the full-map reach; the bound is the map's own depth.
        if (f < -g.deepest) break;
        put(f, file * el.fileGap, f < -ext);
      }
    } else if (el.kind === FM_SHAPE_RANK) {
      const laterals = [0];
      for (let v = el.spacing; v <= el.maxLateral; v += el.spacing) laterals.push(v, -v);
      for (let row = 0; next < j; row++) {
        const f = frontRow - row * el.rankDepth;
        if (f < -ext) break;
        for (let k = 0; k < laterals.length && next < j; k++) put(f, laterals[k]);
      }
    } else if (el.kind === FM_SHAPE_POINT) {
      for (let k = 0; k < POINT_LATERALS.length && next < j; k++) put(el.ahead, POINT_LATERALS[k]);
    } else {
      // The ring: the smallest radius whose tile count seats everyone.
      const count = j - i;
      let r = el.radiusMin;
      while (r < el.radiusMax && ringTiles(r).length < count) r++;
      const tiles = ringTiles(r);
      const t = tiles.length;
      const seated = count < t ? count : t;
      const centre = hasTop[track] ? frontRow - r : frontRow;
      const order = spreadOrder(seated);
      for (let q = 0; q < seated; q++, next++) {
        const m = members[next];
        const p = idiv(order[q] * t, seated);
        const [tf, tl] = tiles[p];
        // The ring tile, then one step inward and one step outward (the sign vector of its
        // offset); the usable one with the best cover wins, the ring tile on a tie, then the
        // lower tile index.
        const cands: [number, number][] = [[centre + tf, tl]];
        if (el.coverPref === 1) {
          cands.push([centre + tf - sgn(tf), tl - sgn(tl)]);
          cands.push([centre + tf + sgn(tf), tl + sgn(tl)]);
        }
        let best = -1;
        let bestCover = -1;
        let bestKey = 0;
        for (let c = 0; c < cands.length; c++) {
          const [cf, cl] = cands[c];
          if (!g.usable(m, track, cf, cl)) continue;
          const cover = g.coverAt(track, cf, cl);
          const key = g.keyAt(track, cf, cl);
          if (best < 0 || cover > bestCover || (cover === bestCover && best > 0 && c > 0 && key < bestKey)) {
            best = c;
            bestCover = cover;
            bestKey = key;
          }
        }
        let f = 0;
        let l = 0;
        let ok = false;
        if (best >= 0) {
          f = cands[best][0];
          l = cands[best][1];
          ok = true;
        } else {
          // No candidate: the next free ring tile in ring order, after this position's own.
          for (let s = 1; s < t && !ok; s++) {
            const [sf, sl] = tiles[(p + s) % t];
            if (g.usable(m, track, centre + sf, sl)) {
              f = centre + sf;
              l = sl;
              ok = true;
            }
          }
        }
        if (!ok) continue;
        g.take(m, track, f, l);
        placed[next] = { f, l, track };
        if (!usedAny || f < usedRear) usedRear = f;
        usedAny = true;
      }
      ringRadius = r;
      next = j;
    }

    if (el.kind !== FM_SHAPE_POINT && usedAny) {
      top[track] = hasTop[track] && top[track] < usedRear ? top[track] : usedRear;
      hasTop[track] = true;
    }
    i = j;
  }
  return { placed, ringRadius };
}

/** Members in fill order: by element, then the class's position in that element's list, then id. */
function sortMembers(tpl: CompiledFormation, raw: readonly { id: number; domain: number; cls: number; vehicle: boolean }[]): FillMember[] {
  const out: FillMember[] = [];
  for (const u of raw) {
    if (u.cls === FM_CLASS_NONE) continue;
    const elem = tpl.elementOfClass[u.cls];
    const list = tpl.elements[elem].classes;
    let pos = list.indexOf(u.cls);
    if (pos < 0) pos = list.indexOf(FM_CLASS_REST);
    if (pos < 0) pos = list.length;
    out.push({ id: u.id, domain: u.domain, cls: u.cls, vehicle: u.vehicle, elem, pos });
  }
  out.sort((a, b) => a.elem - b.elem || a.pos - b.pos || a.id - b.id);
  return out;
}

// ---------------------------------------------------------------------------------------------
// assignTemplate: fit a formation to the ground.
// ---------------------------------------------------------------------------------------------

export interface TemplateUnit {
  id: number;
  /** Index into `masks` / `origins`: the domain the unit walks (an aircraft takes the foot one). */
  domain: number;
  cls: number;
  /** A ground vehicle. */
  vehicle: boolean;
  air: boolean;
}
export interface TemplateInput {
  width: number;
  height: number;
  /** Passability per domain, indexed by domain number; 0 = open. */
  masks: readonly Uint8Array[];
  /** Per domain: the click tile snapped to open ground for that domain. */
  origins: readonly (readonly [number, number])[];
  /** The foot-snapped click tile: the centre of the frame. */
  clickX: number;
  clickY: number;
  /** The tile the group is coming from (an integer centroid). */
  fromX: number;
  fromY: number;
  units: readonly TemplateUnit[];
  /** 1 where a same-side unit outside this order stands or is bound. */
  reserved: Uint8Array;
  /** Cover level per tile (0 none, 1-3), for the ring's cover preference. */
  cover: Uint8Array;
}
export interface TemplateSlot {
  id: number;
  x: number;
  y: number;
  /** The rest facing (an eighth-turn, FM_FACING_NONE for an aircraft or a formation that says none). */
  face: number;
}

/**
 * Fit `tpl` to the ground. The frame is `assignFormation`'s: the approach is the click-from vector
 * quantised to an axis (ties to x), ids are sorted, walks run N-E-S-W per distinct (mask,
 * origin), overflow is behind-first. A class-none unit gets no slot. `ringRadius` is 0 with no
 * ring element. `overflow` lists the ids the template had no slot for (they stand on the nearest free
 * ground instead, spacing dropped).
 */
export function assignTemplate(input: TemplateInput, tpl: CompiledFormation): { slots: TemplateSlot[]; ringRadius: number; overflow: number[] } {
  const w = input.width;
  const h = input.height;
  const dx = input.clickX - input.fromX;
  const dy = input.clickY - input.fromY;
  let fwdX = 0;
  let fwdY = 0;
  if (abs(dx) >= abs(dy)) fwdX = dx < 0 ? -1 : 1;
  else fwdY = dy < 0 ? -1 : 1;
  const latX = -fwdY;
  const latY = fwdX;

  // One walk per distinct (mask, origin) pair, to `depth` steps.
  const reachAt = (depth: number): Reach[] => {
    const out: Reach[] = [];
    for (let d = 0; d < input.masks.length; d++) {
      const mask = input.masks[d];
      const [ox, oy] = input.origins[d];
      let same = -1;
      for (let e = 0; e < d && same < 0; e++) {
        const [ex, ey] = input.origins[e];
        if (input.masks[e] === mask && ex === ox && ey === oy) same = e;
      }
      out.push(same < 0 ? walk(mask, w, h, input.origins[d], depth) : out[same]);
    }
    return out;
  };
  const reach = reachAt(tpl.extent);
  // The spill of a `files` element past the cap (S3) walks as far as the map goes. Built only if a
  // fill asks: an order-time cost paid by the orders too long for the cap, and no others.
  let deepReach: Reach[] | null = null;

  const members = sortMembers(tpl, input.units);
  const taken = new Uint8Array(w * h);
  // Track 0 anchors at the foot click; track 1 at the vehicles' own snapped origin, used only
  // when an element is all ground vehicles and that origin is not the click (Deviation 4).
  let vehicleAnchor: readonly [number, number] = [input.clickX, input.clickY];
  const anchorOf = (track: number): readonly [number, number] => (track === 0 ? [input.clickX, input.clickY] : vehicleAnchor);
  const tileOf = (track: number, f: number, l: number): number => {
    const [ax, ay] = anchorOf(track);
    const x = ax + f * fwdX + l * latX;
    const y = ay + f * fwdY + l * latY;
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  };
  const ground: Ground = {
    deepest: w + h,
    usable: (m, track, f, l, deep) => {
      const t = tileOf(track, f, l);
      if (t < 0 || input.reserved[t] !== 0 || taken[t] !== 0) return false;
      if (deep === true) {
        if (deepReach === null) deepReach = reachAt(w + h);
        return deepReach[m.domain].hit[t] === 1;
      }
      return reach[m.domain].hit[t] === 1;
    },
    take: (_m, track, f, l) => {
      taken[tileOf(track, f, l)] = 1;
    },
    coverAt: (track, f, l) => {
      const t = tileOf(track, f, l);
      return t < 0 ? -1 : input.cover[t];
    },
    keyAt: (track, f, l) => tileOf(track, f, l),
    trackOf: (vehicleOnly, domain) => {
      if (!vehicleOnly) return 0;
      const o = input.origins[domain];
      if (o[0] === input.clickX && o[1] === input.clickY) return 0;
      vehicleAnchor = o;
      return 1;
    },
  };

  const { placed, ringRadius } = fill(tpl, members, ground);

  const pos = new Map<number, [number, number]>();
  // The track each placed member stands on: "inward" and "outward" are measured from that track's
  // own anchor (a vehicle ring snapped off the click closes on its own centre, not the foot click).
  const trackOfId = new Map<number, number>();
  const rest: FillMember[] = [];
  for (let i = 0; i < members.length; i++) {
    const p = placed[i];
    if (p === null) {
      rest.push(members[i]);
      continue;
    }
    const t = tileOf(p.track, p.f, p.l);
    pos.set(members[i].id, [t % w, (t - (t % w)) / w]);
    trackOfId.set(members[i].id, p.track);
  }
  overflowPlace(
    rest,
    { width: w, clickX: input.clickX, clickY: input.clickY, fwdX, fwdY, reach, origins: input.origins, reserved: input.reserved, taken },
    (u, x, y) => {
      taken[y * w + x] = 1;
      pos.set(u.id, [x, y]);
    },
    (u, x, y) => pos.set(u.id, [x, y])
  );

  const airOf = new Map<number, boolean>();
  for (const u of input.units) airOf.set(u.id, u.air);
  const slots: TemplateSlot[] = [];
  for (const m of members) {
    const xy = pos.get(m.id);
    if (xy === undefined) continue;
    const [x, y] = xy;
    let face = FM_FACING_NONE;
    if (airOf.get(m.id) !== true) {
      if (tpl.face === FM_FACE_FRONT || tpl.face === FM_FACE_TRAVEL) face = eighthToward(fwdX, fwdY);
      else if (tpl.face === FM_FACE_INWARD || tpl.face === FM_FACE_OUTWARD) {
        const [cx, cy] = anchorOf(trackOfId.get(m.id) ?? 0);
        const vx = tpl.face === FM_FACE_INWARD ? cx - x : x - cx;
        const vy = tpl.face === FM_FACE_INWARD ? cy - y : y - cy;
        // A slot on its anchor itself takes forward.
        face = vx === 0 && vy === 0 ? eighthToward(fwdX, fwdY) : eighthToward(vx, vy);
      }
    }
    slots.push({ id: m.id, x, y, face });
  }
  slots.sort((a, b) => a.id - b.id);
  return { slots, ringRadius, overflow: rest.map((m) => m.id).sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------------------------
// templateOffsets: the same fill on open ground, for the HUD's schematic.
// ---------------------------------------------------------------------------------------------

/**
 * The same fill as `assignTemplate` on ground where every tile is usable, in frame coordinates
 * (forward positive ahead, lateral positive to the frame's right-hand side): one entry per class
 * in `classes` that a slot was found for, in fill order. The HUD schematic's only source, so the
 * tooltip cannot disagree with the order. `.ringRadius` is the ring's radius, the same one
 * `assignTemplate` returns (0 when the formation has no ring).
 */
export function templateOffsets(
  tpl: CompiledFormation,
  classes: readonly number[],
): { cls: number; forward: number; lateral: number }[] & { ringRadius: number } {
  const raw = classes.map((cls, id) => ({ id, domain: 0, cls, vehicle: false }));
  const members = sortMembers(tpl, raw);
  const taken = new Set<number>();
  const keyOf = (f: number, l: number): number => (f + 1024) * 4096 + (l + 1024);
  const ground: Ground = {
    deepest: 512,
    usable: (_m, _t, f, l) => !taken.has(keyOf(f, l)),
    take: (_m, _t, f, l) => {
      taken.add(keyOf(f, l));
    },
    coverAt: () => 0,
    keyAt: (_t, f, l) => keyOf(f, l),
    trackOf: () => 0,
  };
  const { placed, ringRadius } = fill(tpl, members, ground);
  const out: { cls: number; forward: number; lateral: number }[] = [];
  for (let i = 0; i < members.length; i++) {
    const p = placed[i];
    if (p !== null) out.push({ cls: members[i].cls, forward: p.f, lateral: p.l });
  }
  // The ring's radius (0 with no ring) rides on the list, so the two existing callers, which only map it, are untouched.
  return Object.assign(out, { ringRadius });
}
