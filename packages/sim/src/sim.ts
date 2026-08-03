// The deterministic core. Commands in → 20 Hz tick → state + events out
// (invariant 4). Struct-of-arrays over typed arrays: no per-entity object
// allocation inside the hot loops — GC pauses are visible at 400 units.
// Event payloads (a handful per tick) are the one sanctioned allocation.
//
// Tick order is part of the contract (replays depend on it):
//   commands → detection → combat (target/face/fire) → projectiles →
//   movement → upkeep (suppression decay, pins, cooldowns, APS reload).

import { fx, ONE, type Fx } from './fixed';
import { Rng } from './rng';
import { HASH_SEED, hashArray, hashWord } from './hash';
import { FlowField, DIR_NONE, DIR_VX, DIR_VY } from './flowfield';
import {
  K_DETECT,
  CONTACT_DECAY,
  SUSPECTED_AT,
  IDENTIFIED_AT,
  LOST_AT,
  MOTION_SIG,
  COVER_SIG,
  OCCL_PER_COVER,
  FIRING_SIG_TICKS,
  MIN_DETECT_DIST_SQ,
  COVER_HIT,
  FALLOFF_SCALE,
  TARGET_MOTION_MOD,
  MOVING_STANCE_MOD,
  SUPP_K,
  PEN_SIGMA_MULT,
  SIGMA_MIN,
  OBLIQ_MAX,
  ERA_SHAPED_MULT,
  ARC_60,
  ARC_120,
  SOFT_ARMOR_LIMIT,
  COMP_CREW_SHAKEN,
  COMP_MOBILITY,
  COMP_FIREPOWER,
  COMP_BOTH,
  COMP_CATASTROPHIC,
  OVERMATCH_SHIFT_PER_Z,
  OVERMATCH_SHIFT_MAX,
  SUPP_DECAY,
  PIN_AT,
  UNPIN_AT,
  SUPP_CAP,
  NEAR_MISS_RADIUS_SQ,
  COVER_SUPP,
  BOUNCE_SUPP_MULT,
  CREW_SHAKEN_SUPP,
  SUPP_STAT_DIVISOR,
  APS_INTERCEPTABLE_MASK,
  APS_VEL_F,
  APS_SAT_WINDOW,
  APS_SAT_PENALTY,
  APS_SAT_CAP,
  PROJ_SPEED,
  SCATTER_BASE,
  AMBUSH_SIG,
  VET_ACC_BONUS,
  VET_SUPP_BONUS,
  DEFAULT_TURN_DEG_S,
  PIN_SPEED_SHIFT,
  ROUT_AFTER_TICKS,
  ROUT_SPEED_SHIFT,
  ROUT_DISTANCE,
  REGEN_DELAY_TICKS,
  REGEN_FRAC,
  REGEN_CAP,
} from './tuning';

export const TICKS_PER_SECOND = 20;
/** Tick length in Q16.16 seconds (65536 / 20, rounded). Time IS the tick
 *  counter; DT exists only for rate integration, never for wall clocks. */
export const DT = 3277;

// ---------------------------------------------------------------------------
// Schema-shaped input (structural: the sim declares the shape, imports nothing)
// ---------------------------------------------------------------------------

export interface WeaponJson {
  id: string;
  type: string;
  range_tiles: number;
  effective_range_tiles?: number;
  accuracy: number;
  penetration?: number;
  damage?: number;
  splash_tiles?: number;
  suppression?: number;
  rof_per_min?: number;
  min_range_tiles?: number;
  can_target?: string[];
  collateral_risk?: number;
}

export interface UnitTypeJson {
  id: string;
  hull: {
    hp: number;
    armor: { front: number; side: number; rear: number; top?: number };
    era?: boolean;
    crew?: number;
    suppression_resistance?: number;
    aps?: {
      base_pk?: number;
      magazine?: number;
      reload_s?: number;
      ineffective_vs?: string[];
    };
  };
  mobility: { speed_tiles_s: number; turn_rate_deg_s?: number };
  sensors: {
    optics: number;
    sight_tiles: number;
    signature?: number;
    thermal?: boolean;
    firing_signature_mult?: number;
  };
  weapons?: WeaponJson[];
}

/** Weapon classes as ints — string compares stay out of the hot loop. */
export const WEAPON_CLASS: Record<string, number> = {
  apfsds: 0,
  heat: 1,
  he: 2,
  atgm: 3,
  rpg: 4,
  small_arms: 5,
  hmg: 6,
  autocannon: 7,
  mortar: 8,
  rocket: 9,
  interceptor: 10,
  demolition: 11,
};

/** Classes that fire indirect — no line of sight needed, only a side contact. */
const INDIRECT_MASK = (1 << WEAPON_CLASS.mortar) | (1 << WEAPON_CLASS.rocket);
/** Shaped-charge family for ERA purposes. */
const SHAPED_MASK = (1 << WEAPON_CLASS.heat) | (1 << WEAPON_CLASS.atgm) | (1 << WEAPON_CLASS.rpg);

export interface WeaponStats {
  id: string;
  cls: number;
  range: Fx;
  rangeSq: Fx;
  effectiveRange: Fx;
  effectiveRangeSq: Fx;
  minRangeSq: Fx;
  accuracy: Fx;
  penetration: Fx;
  damage: Fx;
  splash: Fx;
  suppPerMiss: Fx;
  ticksBetweenShots: number;
  collateralRisk: Fx;
}

export interface UnitType {
  id: string;
  hp: Fx;
  armorFront: Fx;
  armorSide: Fx;
  armorRear: Fx;
  isSoft: boolean;
  era: boolean;
  suppResFactor: Fx; // incoming suppression multiplier, 1 - res/2
  hasAps: boolean;
  apsPk: Fx;
  apsMagazine: number;
  apsReloadTicks: number;
  apsIneffectiveMask: number;
  speed: Fx;
  stepPerTick: Fx;
  turnPerTick: Fx; // turns/tick
  optics: Fx;
  sight: Fx;
  sightSq: Fx;
  signature: Fx;
  firingSigMult: Fx;
  thermal: boolean;
  weapons: WeaponStats[];
}

function weaponFromJson(w: WeaponJson): WeaponStats {
  const rof = w.rof_per_min ?? 0;
  const tbs = rof > 0 ? fx.toInt(fx.div(fx.fromInt(60 * TICKS_PER_SECOND), fx.from(rof))) : 0;
  const cls = WEAPON_CLASS[w.type];
  if (cls === undefined) throw new Error(`unknown weapon type ${w.type}`);
  const range = fx.from(w.range_tiles);
  const minRange = fx.from(w.min_range_tiles ?? 0);
  const effRange = fx.from(w.effective_range_tiles ?? w.range_tiles);
  return {
    id: w.id,
    cls,
    range,
    rangeSq: fx.mul(range, range),
    effectiveRange: effRange,
    effectiveRangeSq: fx.mul(effRange, effRange),
    minRangeSq: fx.mul(minRange, minRange),
    accuracy: fx.from(w.accuracy),
    penetration: fx.from(w.penetration ?? 0),
    damage: fx.from(w.damage ?? 0),
    splash: fx.from(w.splash_tiles ?? 0),
    suppPerMiss: fx.div(fx.from(w.suppression ?? 0), fx.fromInt(SUPP_STAT_DIVISOR)),
    ticksBetweenShots: tbs > 0 ? tbs : 1,
    collateralRisk: fx.from(w.collateral_risk ?? 0),
  };
}

export function unitTypeFromJson(json: UnitTypeJson): UnitType {
  const aps = json.hull.aps;
  let apsMask = 0;
  for (const t of aps?.ineffective_vs ?? []) {
    if (t === 'apfsds' || t === 'kinetic') {
      apsMask |= (1 << WEAPON_CLASS.apfsds) | (1 << WEAPON_CLASS.autocannon);
    }
    if (t === 'gun_he') apsMask |= 1 << WEAPON_CLASS.he;
    if (t === 'small_arms') apsMask |= (1 << WEAPON_CLASS.small_arms) | (1 << WEAPON_CLASS.hmg);
  }
  const speed = fx.from(json.mobility.speed_tiles_s);
  const sight = fx.from(json.sensors.sight_tiles);
  const armorFront = fx.from(json.hull.armor.front);
  const suppRes = fx.from(json.hull.suppression_resistance ?? 1 / 2);
  const turnDeg = json.mobility.turn_rate_deg_s ?? DEFAULT_TURN_DEG_S;
  // deg/s → turns/tick: deg/360 * DT
  const turnPerTick = fx.mul(fx.div(fx.from(turnDeg), fx.fromInt(360)), DT);
  return {
    id: json.id,
    hp: fx.from(json.hull.hp),
    armorFront,
    armorSide: fx.from(json.hull.armor.side),
    armorRear: fx.from(json.hull.armor.rear),
    isSoft: armorFront < SOFT_ARMOR_LIMIT,
    era: json.hull.era ?? false,
    suppResFactor: fx.sub(ONE, suppRes >> 1),
    hasAps: aps !== undefined,
    apsPk: fx.from(aps?.base_pk ?? 0),
    apsMagazine: aps?.magazine ?? 0,
    apsReloadTicks: fx.toInt(fx.mul(fx.from(aps?.reload_s ?? 0), fx.fromInt(TICKS_PER_SECOND))),
    apsIneffectiveMask: apsMask,
    speed,
    stepPerTick: fx.mul(speed, DT),
    turnPerTick: turnPerTick > 0 ? turnPerTick : ONE,
    optics: fx.from(json.sensors.optics),
    sight,
    sightSq: fx.mul(sight, sight),
    signature: fx.from(json.sensors.signature ?? 1),
    firingSigMult: fx.from(json.sensors.firing_signature_mult ?? 4),
    thermal: json.sensors.thermal ?? false,
    weapons: (json.weapons ?? []).map(weaponFromJson),
  };
}

// ---------------------------------------------------------------------------
// Commands and events
// ---------------------------------------------------------------------------

export type Command =
  | { kind: 'move'; ids: number[]; x: Fx; y: Fx }
  | { kind: 'attackMove'; ids: number[]; x: Fx; y: Fx }
  | { kind: 'halt'; ids: number[] };

export type ContactLevel = 'suspected' | 'identified' | 'lost';
export type FacingArc = 'front' | 'side' | 'rear';
export type ComponentResult =
  | 'crew_shaken'
  | 'mobility_kill'
  | 'firepower_kill'
  | 'combat_ineffective'
  | 'catastrophic';

/** Every roll the model makes is on an event, in full, for the debug overlay.
 *  All numeric payloads are raw Q16.16 — the render side converts. */
export type SimEvent =
  | { kind: 'spawn'; tick: number; entity: number; typeId: string; side: number }
  | { kind: 'contact'; tick: number; side: number; target: number; level: ContactLevel; confidence: Fx }
  | {
      kind: 'fire';
      tick: number;
      shooter: number;
      target: number;
      weaponId: string;
      pHit: Fx;
      roll: Fx;
      willHit: boolean;
      breakdown: {
        accuracy: Fx;
        rangeFalloff: Fx;
        coverMod: Fx;
        motionMod: Fx;
        stanceMod: Fx;
        suppressionMod: Fx;
      };
    }
  | { kind: 'aps'; tick: number; target: number; shooter: number; pIntercept: Fx; roll: Fx; intercepted: boolean }
  | {
      kind: 'impact';
      tick: number;
      shooter: number;
      target: number;
      weaponId: string;
      arc: FacingArc;
      effectiveArmor: Fx;
      penetration: Fx;
      pPen: Fx;
      roll: Fx;
      penetrated: boolean;
    }
  | { kind: 'component'; tick: number; target: number; result: ComponentResult; overmatch: Fx }
  | { kind: 'nearMiss'; tick: number; shooter: number; weaponId: string; x: Fx; y: Fx }
  | { kind: 'ambushSprung'; tick: number; entity: number }
  | { kind: 'routed'; tick: number; entity: number }
  | { kind: 'rallied'; tick: number; entity: number }
  | { kind: 'pinned'; tick: number; entity: number }
  | { kind: 'unpinned'; tick: number; entity: number }
  | { kind: 'destroyed'; tick: number; entity: number; by: number };

export interface SimConfig {
  seed: number;
  width: number;
  height: number;
  capacity: number;
}

/** Read-only detection factors for one observer→target pair (debug overlay). */
export interface DetectionDebug {
  visible: boolean;
  p: Fx;
  strength: Fx;
  signature: Fx;
  occlusion: Fx;
  distSq: Fx;
  confidence: Fx;
}

const PROJ_CAP = 1024;

// ---------------------------------------------------------------------------

/** distance² in Q16.16 tile² without overflow: (d>>8)² == d²>>16 exactly
 *  enough for ranges; safe out to ±176 tiles. */
function distSqFx(dx: Fx, dy: Fx): Fx {
  const x = dx >> 8;
  const y = dy >> 8;
  return (x * x + y * y) | 0;
}

export class Sim {
  readonly width: number;
  readonly height: number;
  readonly capacity: number;
  tickCount = 0;

  readonly unitTypes: UnitType[] = [];
  readonly rng: Rng;

  readonly blocked: Uint8Array;
  readonly cover: Uint8Array;

  // --- entity SoA ---
  private count = 0;
  private readonly alive: Uint8Array;
  private readonly side: Uint8Array;
  private readonly typeIdx: Uint16Array;
  private readonly posX: Int32Array;
  private readonly posY: Int32Array;
  private readonly facing: Int32Array;
  private readonly hp: Int32Array;
  private readonly suppression: Int32Array;
  private readonly moving: Uint8Array;
  private readonly attackMove: Uint8Array;
  private readonly goalX: Int32Array;
  private readonly goalY: Int32Array;
  private readonly fieldRef: Int32Array;
  // combat state
  private readonly cooldown: Int32Array; // 2 slots per entity
  private readonly lastFired: Int32Array;
  private readonly engaging: Uint8Array;
  private readonly curTarget: Int32Array;
  private readonly mobilityKilled: Uint8Array;
  private readonly firepowerKilled: Uint8Array;
  private readonly pinned: Uint8Array;
  /** 0 = normal, 1 = ambush (hold fire + minimum signature until sprung). */
  private readonly stance: Uint8Array;
  private readonly ambushRadiusSq: Int32Array;
  private readonly pinnedTicks: Int32Array;
  private readonly routed: Uint8Array;
  private readonly lastDamagedTick: Int32Array;
  /** Veterancy 0-3, from the campaign ledger. Better aim, steadier nerve. */
  private readonly veterancy: Uint8Array;
  private readonly apsAmmo: Int32Array;
  private readonly apsReloadLeft: Int32Array;
  private readonly apsRecent: Int32Array;
  private readonly apsLastTick: Int32Array;
  /** contact confidence and state per (side, target): index side*capacity+target */
  private readonly contact: Int32Array;
  private readonly contactState: Uint8Array;
  private readonly seenThisTick: Uint8Array;

  // --- projectile SoA (ring) ---
  private readonly prActive: Uint8Array;
  private readonly prShooter: Int32Array;
  private readonly prTarget: Int32Array;
  private readonly prCls: Uint8Array;
  private readonly prWillHit: Uint8Array;
  private readonly prTicksLeft: Int32Array;
  private readonly prOriginX: Int32Array;
  private readonly prOriginY: Int32Array;
  private readonly prAimX: Int32Array;
  private readonly prAimY: Int32Array;
  private readonly prPen: Int32Array;
  private readonly prDamage: Int32Array;
  private readonly prSupp: Int32Array;
  private readonly prSplash: Int32Array;
  private readonly prWeaponIdx: Uint16Array; // typeIdx<<1 | slot, for event weapon ids

  /** Read-only view for the renderer/debug side. Never write through this —
   *  nothing outside the sim may mutate sim state (invariant 4). */
  readonly state: {
    readonly alive: Uint8Array;
    readonly side: Uint8Array;
    readonly typeIdx: Uint16Array;
    readonly posX: Int32Array;
    readonly posY: Int32Array;
    readonly facing: Int32Array;
    readonly hp: Int32Array;
    readonly suppression: Int32Array;
    readonly moving: Uint8Array;
    readonly pinned: Uint8Array;
    readonly mobilityKilled: Uint8Array;
    readonly firepowerKilled: Uint8Array;
    readonly apsAmmo: Int32Array;
    readonly veterancy: Uint8Array;
    /** Current primary engagement target per unit, -1 when none. */
    readonly curTarget: Int32Array;
    readonly routed: Uint8Array;
  };

  private readonly seed: number;
  private commandQueue: Command[] = [];
  private pendingEvents: SimEvent[] = [];
  private readonly fields: FlowField[] = [];
  private readonly fieldByGoal = new Map<number, number>();

  constructor(config: SimConfig) {
    this.width = config.width;
    this.height = config.height;
    this.capacity = config.capacity;
    this.seed = config.seed | 0;
    this.rng = new Rng(config.seed, config.capacity);
    const n = config.capacity;
    const tiles = config.width * config.height;
    this.blocked = new Uint8Array(tiles);
    this.cover = new Uint8Array(tiles);
    this.alive = new Uint8Array(n);
    this.side = new Uint8Array(n);
    this.typeIdx = new Uint16Array(n);
    this.posX = new Int32Array(n);
    this.posY = new Int32Array(n);
    this.facing = new Int32Array(n);
    this.hp = new Int32Array(n);
    this.suppression = new Int32Array(n);
    this.moving = new Uint8Array(n);
    this.attackMove = new Uint8Array(n);
    this.goalX = new Int32Array(n);
    this.goalY = new Int32Array(n);
    this.fieldRef = new Int32Array(n).fill(-1);
    this.cooldown = new Int32Array(n * 2);
    this.lastFired = new Int32Array(n).fill(-100000);
    this.engaging = new Uint8Array(n);
    this.curTarget = new Int32Array(n).fill(-1);
    this.mobilityKilled = new Uint8Array(n);
    this.firepowerKilled = new Uint8Array(n);
    this.pinned = new Uint8Array(n);
    this.stance = new Uint8Array(n);
    this.ambushRadiusSq = new Int32Array(n);
    this.pinnedTicks = new Int32Array(n);
    this.routed = new Uint8Array(n);
    this.lastDamagedTick = new Int32Array(n).fill(-100000);
    this.veterancy = new Uint8Array(n);
    this.apsAmmo = new Int32Array(n);
    this.apsReloadLeft = new Int32Array(n);
    this.apsRecent = new Int32Array(n);
    this.apsLastTick = new Int32Array(n).fill(-100000);
    this.contact = new Int32Array(2 * n);
    this.contactState = new Uint8Array(2 * n);
    this.seenThisTick = new Uint8Array(2 * n);

    this.prActive = new Uint8Array(PROJ_CAP);
    this.prShooter = new Int32Array(PROJ_CAP);
    this.prTarget = new Int32Array(PROJ_CAP);
    this.prCls = new Uint8Array(PROJ_CAP);
    this.prWillHit = new Uint8Array(PROJ_CAP);
    this.prTicksLeft = new Int32Array(PROJ_CAP);
    this.prOriginX = new Int32Array(PROJ_CAP);
    this.prOriginY = new Int32Array(PROJ_CAP);
    this.prAimX = new Int32Array(PROJ_CAP);
    this.prAimY = new Int32Array(PROJ_CAP);
    this.prPen = new Int32Array(PROJ_CAP);
    this.prDamage = new Int32Array(PROJ_CAP);
    this.prSupp = new Int32Array(PROJ_CAP);
    this.prSplash = new Int32Array(PROJ_CAP);
    this.prWeaponIdx = new Uint16Array(PROJ_CAP);

    this.state = {
      alive: this.alive,
      side: this.side,
      typeIdx: this.typeIdx,
      posX: this.posX,
      posY: this.posY,
      facing: this.facing,
      hp: this.hp,
      suppression: this.suppression,
      moving: this.moving,
      pinned: this.pinned,
      mobilityKilled: this.mobilityKilled,
      firepowerKilled: this.firepowerKilled,
      apsAmmo: this.apsAmmo,
      veterancy: this.veterancy,
      curTarget: this.curTarget,
      routed: this.routed,
    };
  }

  get entityCount(): number {
    return this.count;
  }

  addUnitType(json: UnitTypeJson): number {
    this.unitTypes.push(unitTypeFromJson(json));
    return this.unitTypes.length - 1;
  }

  setBlocked(x: number, y: number, b: boolean): void {
    this.blocked[y * this.width + x] = b ? 1 : 0;
    for (const [goal, idx] of this.fieldByGoal) {
      const gx = goal % this.width;
      this.fields[idx].compute(this.blocked, gx, (goal - gx) / this.width);
    }
  }

  setCover(x: number, y: number, c: number): void {
    this.cover[y * this.width + x] = c;
  }

  /** facing: initial hull heading in Q16.16 turns (deployment orientation —
   *  defenders face the expected threat axis). veterancy: 0-3 from the
   *  campaign ledger. */
  spawn(typeIdx: number, side: number, x: Fx, y: Fx, facing: Fx = 0, veterancy = 0): number {
    if (this.count >= this.capacity) throw new Error('sim at capacity');
    const type = this.unitTypes[typeIdx];
    if (type === undefined) throw new Error(`no unit type ${typeIdx}`);
    const id = this.count++;
    this.veterancy[id] = veterancy > 3 ? 3 : veterancy < 0 ? 0 : veterancy;
    this.alive[id] = 1;
    this.side[id] = side;
    this.typeIdx[id] = typeIdx;
    this.posX[id] = x;
    this.posY[id] = y;
    this.facing[id] = facing & 0xffff;
    this.hp[id] = type.hp;
    this.suppression[id] = 0;
    this.moving[id] = 0;
    this.attackMove[id] = 0;
    this.fieldRef[id] = -1;
    this.apsAmmo[id] = type.apsMagazine;
    this.pendingEvents.push({ kind: 'spawn', tick: this.tickCount, entity: id, typeId: type.id, side });
    return id;
  }

  queueCommand(cmd: Command): void {
    this.commandQueue.push(cmd);
  }

  /** Put a unit in ambush: hold fire and minimum signature until a target
   *  closes to `tiles` (Q16.16). Cleared when sprung or when re-ordered. */
  setAmbush(id: number, tiles: Fx): void {
    this.stance[id] = 1;
    this.ambushRadiusSq[id] = fx.mul(tiles, tiles);
  }

  /** Dev/test hook: remove a unit as if destroyed (sandbox tooling). */
  debugKill(id: number): void {
    if (this.alive[id] === 1) this.destroy(id, -1);
  }

  /** Advance exactly one 20 Hz tick. Returns the events it produced. */
  tick(): SimEvent[] {
    this.applyCommands();
    this.stepDetection();
    this.stepCombat();
    this.stepProjectiles();
    this.stepMovement();
    this.stepUpkeep();
    this.tickCount++;
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  // ----------------------------------------------------------------- commands

  private fieldFor(gx: number, gy: number): number {
    const key = gy * this.width + gx;
    const existing = this.fieldByGoal.get(key);
    if (existing !== undefined) return existing;
    const field = new FlowField(this.width, this.height);
    field.compute(this.blocked, gx, gy);
    const idx = this.fields.length;
    this.fields.push(field);
    this.fieldByGoal.set(key, idx);
    return idx;
  }

  private applyCommands(): void {
    const q = this.commandQueue;
    for (let c = 0; c < q.length; c++) {
      const cmd = q[c];
      if (cmd.kind === 'move' || cmd.kind === 'attackMove') {
        const fieldIdx = this.fieldFor(fx.toInt(cmd.x), fx.toInt(cmd.y));
        for (const id of cmd.ids) {
          if (this.alive[id] === 0 || this.routed[id] === 1) continue; // broken troops aren't listening
          this.goalX[id] = cmd.x;
          this.goalY[id] = cmd.y;
          this.fieldRef[id] = fieldIdx;
          this.moving[id] = 1;
          this.attackMove[id] = cmd.kind === 'attackMove' ? 1 : 0;
          this.engaging[id] = 0;
          this.stance[id] = 0; // any order overrides a held stance
        }
      } else {
        for (const id of cmd.ids) {
          this.moving[id] = 0;
          this.fieldRef[id] = -1;
          this.engaging[id] = 0;
          this.stance[id] = 0;
        }
      }
    }
    this.commandQueue = [];
  }

  // ---------------------------------------------------------------- detection

  /** Actually displacing this tick — not merely under a move order. An
   *  attack-mover halted to fight counts as stationary for stance, target
   *  motion, and signature purposes. */
  private isEffectivelyMoving(i: number): boolean {
    return this.moving[i] === 1 && !(this.attackMove[i] === 1 && this.engaging[i] === 1);
  }

  /** Bresenham over tiles: -1 if a blocked tile interrupts the ray, else the
   *  number of cover tiles crossed (endpoints excluded, capped at 8). */
  private losRay(x0: number, y0: number, x1: number, y1: number): number {
    const w = this.width;
    let dx = x1 - x0;
    let dy = y1 - y0;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    let coverCount = 0;
    for (;;) {
      if (x === x1 && y === y1) return coverCount;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return coverCount;
      const t = y * w + x;
      if (this.blocked[t] !== 0) return -1;
      if (this.cover[t] !== 0 && coverCount < 8) coverCount++;
    }
  }

  /** Signature × strength × p for one observer→target pair. Shared by the
   *  detection system and the debug overlay (which is why it exists). */
  private detectionPair(obs: number, tgt: number): DetectionDebug {
    const none: DetectionDebug = {
      visible: false,
      p: 0,
      strength: 0,
      signature: 0,
      occlusion: ONE,
      distSq: 0,
      confidence: this.contact[this.side[obs] * this.capacity + tgt],
    };
    const oType = this.unitTypes[this.typeIdx[obs]];
    const tType = this.unitTypes[this.typeIdx[tgt]];
    const dx = fx.sub(this.posX[tgt], this.posX[obs]);
    const dy = fx.sub(this.posY[tgt], this.posY[obs]);
    const dSq = distSqFx(dx, dy);
    none.distSq = dSq;
    if (dSq > oType.sightSq) return none;
    const cov = this.losRay(
      this.posX[obs] >> 16,
      this.posY[obs] >> 16,
      this.posX[tgt] >> 16,
      this.posY[tgt] >> 16
    );
    if (cov < 0) return none;

    let sig = tType.signature;
    if (this.stance[tgt] === 1) sig = fx.mul(sig, AMBUSH_SIG);
    if (this.isEffectivelyMoving(tgt)) sig = fx.mul(sig, MOTION_SIG);
    if (this.tickCount - this.lastFired[tgt] < FIRING_SIG_TICKS) {
      sig = fx.mul(sig, tType.firingSigMult);
    }
    sig = fx.mul(sig, COVER_SIG[this.cover[(this.posY[tgt] >> 16) * this.width + (this.posX[tgt] >> 16)]]);

    const occl = fx.add(ONE, cov * OCCL_PER_COVER);
    const denom = fx.mul(fx.max(dSq, MIN_DETECT_DIST_SQ), occl);
    const strength = fx.div(fx.mul(oType.optics, sig), denom);
    const p = fx.sub(ONE, fx.expNeg(fx.mul(K_DETECT, fx.mul(strength, DT))));
    return {
      visible: true,
      p,
      strength,
      signature: sig,
      occlusion: occl,
      distSq: dSq,
      confidence: this.contact[this.side[obs] * this.capacity + tgt],
    };
  }

  /** Contact state of `target` as known to `side`: 0 unknown, 1 suspected,
   *  2 identified. Read-only accessor for the renderer/overlay. */
  contactLevel(side: number, target: number): number {
    return this.contactState[side * this.capacity + target];
  }

  /** Contact confidence 0..ONE of `target` as known to `side`. */
  contactConfidence(side: number, target: number): Fx {
    return this.contact[side * this.capacity + target];
  }

  /** Public read-only inspection for the debug overlay. */
  debugDetection(obs: number, tgt: number): DetectionDebug | null {
    if (this.alive[obs] === 0 || this.alive[tgt] === 0) return null;
    if (this.side[obs] === this.side[tgt]) return null;
    return this.detectionPair(obs, tgt);
  }

  private stepDetection(): void {
    const cap = this.capacity;
    this.seenThisTick.fill(0);
    for (let obs = 0; obs < this.count; obs++) {
      if (this.alive[obs] === 0) continue;
      const oSide = this.side[obs];
      if (oSide > 1) continue; // civilians (side 2) observe nothing
      for (let tgt = 0; tgt < this.count; tgt++) {
        if (this.alive[tgt] === 0 || this.side[tgt] === oSide) continue;
        const d = this.detectionPair(obs, tgt);
        if (!d.visible) continue;
        const k = oSide * cap + tgt;
        this.seenThisTick[k] = 1;
        const c = this.contact[k];
        this.contact[k] = fx.add(c, fx.mul(fx.sub(ONE, c), d.p));
      }
    }
    // Decay unobserved contacts; emit state transitions.
    for (let s = 0; s < 2; s++) {
      for (let tgt = 0; tgt < this.count; tgt++) {
        const k = s * cap + tgt;
        if (this.seenThisTick[k] === 0) {
          this.contact[k] = fx.mul(this.contact[k], CONTACT_DECAY);
        }
        const c = this.contact[k];
        const st = this.contactState[k];
        if (st < 2 && c >= IDENTIFIED_AT) {
          this.contactState[k] = 2;
          this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side: s, target: tgt, level: 'identified', confidence: c });
        } else if (st < 1 && c >= SUSPECTED_AT) {
          this.contactState[k] = 1;
          this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side: s, target: tgt, level: 'suspected', confidence: c });
        } else if (st > 0 && c < LOST_AT) {
          this.contactState[k] = 0;
          this.pendingEvents.push({ kind: 'contact', tick: this.tickCount, side: s, target: tgt, level: 'lost', confidence: c });
        }
      }
    }
  }

  // ------------------------------------------------------------------- combat

  private selectTarget(shooter: number, w: WeaponStats): number {
    const cap = this.capacity;
    const sSide = this.side[shooter];
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    let best = -1;
    let bestHurts = false;
    let bestDistSq = 0x7fffffff;
    for (let t = 0; t < this.count; t++) {
      // Civilians (side 2) are never targets — collateral comes from
      // ordnance, not aimpoints. That asymmetry is what ROE scores.
      if (this.alive[t] === 0 || this.side[t] === sSide || this.side[t] > 1) continue;
      if (this.contact[sSide * cap + t] < IDENTIFIED_AT) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
      if (dSq > w.rangeSq || dSq < w.minRangeSq) continue;
      if ((INDIRECT_MASK & (1 << w.cls)) === 0) {
        if (this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16) < 0) continue;
      }
      const tType = this.unitTypes[this.typeIdx[t]];
      // "Can this weapon plausibly hurt that?" — quarter of side armor is the
      // heuristic; soft targets always qualify. Suppressive fire at armor is
      // a fallback, not a preference.
      const hurts = tType.isSoft || w.penetration >= tType.armorSide >> 2;
      if (
        best === -1 ||
        (hurts && !bestHurts) ||
        (hurts === bestHurts && dSq < bestDistSq)
      ) {
        best = t;
        bestHurts = hurts;
        bestDistSq = dSq;
      }
    }
    return best;
  }

  /** True when any living enemy is inside the ambush radius with LOS. */
  private checkAmbushSpring(i: number): boolean {
    const mySide = this.side[i];
    const px = this.posX[i];
    const py = this.posY[i];
    const rSq = this.ambushRadiusSq[i];
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === mySide || this.side[t] > 1) continue;
      const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
      if (dSq > rSq) continue;
      if (this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16) >= 0) return true;
    }
    return false;
  }

  /** Flee away from the nearest threat this unit's side knows about. */
  private startRout(i: number): void {
    const mySide = this.side[i];
    let nx = -ONE;
    let ny = 0;
    let bestSq = 0x7fffffff;
    for (let t = 0; t < this.count; t++) {
      if (this.alive[t] === 0 || this.side[t] === mySide || this.side[t] > 1) continue;
      if (this.contact[mySide * this.capacity + t] < SUSPECTED_AT) continue;
      const dx = fx.sub(this.posX[i], this.posX[t]);
      const dy = fx.sub(this.posY[i], this.posY[t]);
      const dSq = distSqFx(dx, dy);
      if (dSq < bestSq) {
        bestSq = dSq;
        const d = fx.sqrt(fx.max(dSq, 1));
        nx = fx.div(dx, d);
        ny = fx.div(dy, d);
      }
    }
    const gx = fx.clamp(fx.add(this.posX[i], fx.mul(nx, ROUT_DISTANCE)), ONE, (this.width - 2) * ONE);
    const gy = fx.clamp(fx.add(this.posY[i], fx.mul(ny, ROUT_DISTANCE)), ONE, (this.height - 2) * ONE);
    this.goalX[i] = gx;
    this.goalY[i] = gy;
    this.fieldRef[i] = -1; // straight-line flight; the wall guard slides them
    this.moving[i] = 1;
    this.attackMove[i] = 0;
    this.engaging[i] = 0;
    this.stance[i] = 0;
  }

  /** Rotate `id` toward `desired` at its turn rate. */
  private turnToward(id: number, desired: Fx): void {
    const type = this.unitTypes[this.typeIdx[id]];
    const da = fx.angleDiff(desired, this.facing[id]);
    const cap = type.turnPerTick;
    const step = fx.clamp(da, -cap, cap);
    this.facing[id] = (this.facing[id] + step) & 0xffff;
  }

  private stepCombat(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.firepowerKilled[i] === 1) continue;
      // Gone to ground (GDD 5.5): heads down, no aimed return fire. This is
      // the threshold that makes fire superiority — and the 3:1 rule — real:
      // enough volume silences a defense, not-enough leaves it lethal.
      if (this.pinned[i] === 1) {
        this.engaging[i] = 0;
        this.curTarget[i] = -1;
        continue;
      }
      // Ambush: weapons cold until a target closes to the trap range with a
      // clear line of sight — then spring and fight normally this same tick.
      if (this.stance[i] === 1) {
        if (!this.checkAmbushSpring(i)) {
          this.engaging[i] = 0;
          this.curTarget[i] = -1;
          continue;
        }
        this.stance[i] = 0;
        this.pendingEvents.push({ kind: 'ambushSprung', tick: this.tickCount, entity: i });
      }
      const type = this.unitTypes[this.typeIdx[i]];
      if (type.weapons.length === 0) continue;

      // `engaging` (which halts an attack-mover) only latches once the primary
      // target is inside EFFECTIVE range — advancing units keep closing under
      // marching fire instead of stalling at maximum range to plink.
      let engagedClose = false;
      for (let slot = 0; slot < type.weapons.length && slot < 2; slot++) {
        const w = type.weapons[slot];
        const target = this.selectTarget(i, w);
        if (slot === 0) this.curTarget[i] = target;
        if (target < 0) continue;
        const dSq = distSqFx(
          fx.sub(this.posX[target], this.posX[i]),
          fx.sub(this.posY[target], this.posY[i])
        );
        if (dSq <= w.effectiveRangeSq) engagedClose = true;

        // Hull turns toward the primary threat while stationary.
        if (slot === 0 && this.moving[i] === 0) {
          this.turnToward(
            i,
            fx.atan2(fx.sub(this.posY[target], this.posY[i]), fx.sub(this.posX[target], this.posX[i]))
          );
        }

        if (this.cooldown[i * 2 + slot] > 0) continue;
        this.fireAt(i, slot, w, target);
      }
      this.engaging[i] = engagedClose ? 1 : 0;
    }
  }

  private fireAt(shooter: number, slot: number, w: WeaponStats, target: number): void {
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const dist = fx.sqrt(dSq);

    // GDD 5.2 — every factor is on the event for the overlay. Veterans shoot
    // straighter: the ledger's carry-over must be worth protecting.
    const accuracy = fx.min(
      fx.mul(w.accuracy, fx.add(ONE, this.veterancy[shooter] * VET_ACC_BONUS)),
      ONE
    );
    const ratio = fx.div(dist, w.effectiveRange);
    const rangeFalloff = fx.expNeg(fx.mul(FALLOFF_SCALE[w.cls], fx.mul(ratio, ratio)));
    const coverMod = COVER_HIT[this.cover[(ty >> 16) * this.width + (tx >> 16)]];
    const motionMod = this.isEffectivelyMoving(target) ? TARGET_MOTION_MOD : ONE;
    const stanceMod = this.isEffectivelyMoving(shooter) ? MOVING_STANCE_MOD : ONE;
    const suppressionMod = fx.div(ONE, fx.add(ONE, fx.mul(SUPP_K, this.suppression[shooter])));
    let p = fx.mul(accuracy, rangeFalloff);
    p = fx.mul(p, coverMod);
    p = fx.mul(p, motionMod);
    p = fx.mul(p, stanceMod);
    p = fx.mul(p, suppressionMod);

    const roll = this.rng.nextU32(shooter) >>> 16;
    const willHit = roll < p;

    this.cooldown[shooter * 2 + slot] = w.ticksBetweenShots;
    this.lastFired[shooter] = this.tickCount;

    // Aim point: the target now, or a scatter point nearby on a miss.
    let aimX = tx;
    let aimY = ty;
    if (!willHit) {
      const ang = this.rng.nextU32(shooter) & 0xffff;
      const rad = fx.add(SCATTER_BASE, this.rng.nextU32(shooter) >>> 16);
      aimX = fx.add(tx, fx.mul(fx.cos(ang), rad));
      aimY = fx.add(ty, fx.mul(fx.sin(ang), rad));
    }

    // Flight time from class speed; hitscan classes land next tick.
    const speed = PROJ_SPEED[w.cls];
    let ticks = 1;
    if (speed > 0) {
      const perTick = fx.mul(speed, DT);
      ticks = fx.toInt(fx.ceil(fx.div(dist, perTick)));
      if (ticks < 1) ticks = 1;
    }

    // Find a free projectile slot (deterministic linear scan).
    let pr = -1;
    for (let k = 0; k < PROJ_CAP; k++) {
      if (this.prActive[k] === 0) {
        pr = k;
        break;
      }
    }
    if (pr >= 0) {
      this.prActive[pr] = 1;
      this.prShooter[pr] = shooter;
      this.prTarget[pr] = target;
      this.prCls[pr] = w.cls;
      this.prWillHit[pr] = willHit ? 1 : 0;
      this.prTicksLeft[pr] = ticks;
      this.prOriginX[pr] = px;
      this.prOriginY[pr] = py;
      this.prAimX[pr] = aimX;
      this.prAimY[pr] = aimY;
      this.prPen[pr] = w.penetration;
      this.prDamage[pr] = w.damage;
      this.prSupp[pr] = w.suppPerMiss;
      this.prSplash[pr] = w.splash;
      this.prWeaponIdx[pr] = ((this.typeIdx[shooter] << 1) | slot) & 0xffff;
    }

    this.pendingEvents.push({
      kind: 'fire',
      tick: this.tickCount,
      shooter,
      target,
      weaponId: w.id,
      pHit: p,
      roll,
      willHit,
      breakdown: { accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod },
    });
  }

  // -------------------------------------------------------------- projectiles

  private weaponOf(pr: number): WeaponStats {
    const packed = this.prWeaponIdx[pr];
    const type = this.unitTypes[packed >> 1];
    return type.weapons[packed & 1];
  }

  private stepProjectiles(): void {
    for (let pr = 0; pr < PROJ_CAP; pr++) {
      if (this.prActive[pr] === 0) continue;
      if (--this.prTicksLeft[pr] > 0) continue;
      this.prActive[pr] = 0;
      this.resolveProjectile(pr);
    }
  }

  private resolveProjectile(pr: number): void {
    const target = this.prTarget[pr];
    const cls = this.prCls[pr];
    const targetAlive = this.alive[target] === 1;

    // Trophy-class APS engages any inbound shaped charge, hit or miss —
    // the defender cannot know which is which (GDD 5.6).
    if (targetAlive && (APS_INTERCEPTABLE_MASK & (1 << cls)) !== 0) {
      const tType = this.unitTypes[this.typeIdx[target]];
      if (tType.hasAps && (tType.apsIneffectiveMask & (1 << cls)) === 0 && this.apsAmmo[target] > 0) {
        let pI = fx.mul(tType.apsPk, APS_VEL_F[cls]);
        if (this.tickCount - this.apsLastTick[target] < APS_SAT_WINDOW) {
          const pen = fx.min(this.apsRecent[target] * APS_SAT_PENALTY, APS_SAT_CAP);
          pI = fx.mul(pI, fx.sub(ONE, pen));
        } else {
          this.apsRecent[target] = 0;
        }
        const roll = this.rng.nextU32(target) >>> 16;
        const intercepted = roll < pI;
        this.apsAmmo[target]--;
        this.apsRecent[target]++;
        this.apsLastTick[target] = this.tickCount;
        if (this.apsAmmo[target] === 0) this.apsReloadLeft[target] = tType.apsReloadTicks;
        this.pendingEvents.push({
          kind: 'aps',
          tick: this.tickCount,
          target,
          shooter: this.prShooter[pr],
          pIntercept: pI,
          roll,
          intercepted,
        });
        if (intercepted) return;
      }
    }

    if (this.prWillHit[pr] === 1 && targetAlive) {
      this.resolveHit(pr, target);
    } else {
      // Miss (or the target died in flight): ordnance lands at the aim point.
      // No exclusions — a scattered round can still splash its intended target.
      this.groundImpact(pr, this.prAimX[pr], this.prAimY[pr]);
    }
  }

  private resolveHit(pr: number, target: number): void {
    const tType = this.unitTypes[this.typeIdx[target]];
    const shooter = this.prShooter[pr];
    const w = this.weaponOf(pr);

    if (tType.isSoft) {
      // Soft targets: no armor plate to defeat. Damage applies on the hit;
      // getting shot at is suppressive whether or not it kills.
      this.applySuppression(target, fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT));
      this.applyDamage(target, this.prDamage[pr], shooter);
      if (this.prSplash[pr] > 0) this.splashAt(pr, this.posX[target], this.posY[target], target);
      return;
    }

    // Facing (GDD 5.3): angle of the incoming round relative to hull facing.
    const inc = fx.atan2(
      fx.sub(this.prOriginY[pr], this.posY[target]),
      fx.sub(this.prOriginX[pr], this.posX[target])
    );
    const rel = fx.abs(fx.angleDiff(inc, this.facing[target]));
    let arc: FacingArc;
    let armor: Fx;
    if (rel <= ARC_60) {
      arc = 'front';
      armor = tType.armorFront;
      // Obliquity: rounds arriving off-axis inside the arc see thicker plate.
      armor = fx.mul(armor, fx.add(ONE, fx.mul(OBLIQ_MAX, fx.div(rel, ARC_60))));
    } else if (rel >= ARC_120) {
      arc = 'rear';
      armor = tType.armorRear;
    } else {
      arc = 'side';
      armor = tType.armorSide;
    }
    if (tType.era && (SHAPED_MASK & (1 << this.prCls[pr])) !== 0) {
      armor = fx.mul(armor, ERA_SHAPED_MULT);
    }

    const pen = this.prPen[pr];
    const sigma = fx.max(fx.mul(PEN_SIGMA_MULT, pen), SIGMA_MIN);
    const z = fx.div(fx.sub(pen, armor), sigma);
    const pPen = fx.normCdf(z);
    const roll = this.rng.nextU32(shooter) >>> 16;
    const penetrated = roll < pPen;

    this.pendingEvents.push({
      kind: 'impact',
      tick: this.tickCount,
      shooter,
      target,
      weaponId: w.id,
      arc,
      effectiveArmor: armor,
      penetration: pen,
      pPen,
      roll,
      penetrated,
    });

    if (!penetrated) {
      // A clang on the hull is loud inside.
      this.applySuppression(target, fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT));
      return;
    }

    this.applyDamage(target, this.prDamage[pr], shooter);
    if (this.alive[target] === 1) this.rollComponent(target, shooter, z);
  }

  private rollComponent(target: number, shooter: number, z: Fx): void {
    // Weights shift with overmatch: crew_shaken → catastrophic (GDD 5.4).
    let shift = fx.toInt(fx.mul(fx.max(fx.sub(z, ONE), 0), fx.fromInt(OVERMATCH_SHIFT_PER_Z)));
    if (shift > OVERMATCH_SHIFT_MAX) shift = OVERMATCH_SHIFT_MAX;
    const wCrew = COMP_CREW_SHAKEN - shift;
    const wCat = COMP_CATASTROPHIC + shift;
    const total = wCrew + COMP_MOBILITY + COMP_FIREPOWER + COMP_BOTH + wCat;
    const draw = ((this.rng.nextU32(shooter) >>> 16) * total) >>> 16;

    let result: ComponentResult;
    if (draw < wCrew) result = 'crew_shaken';
    else if (draw < wCrew + COMP_MOBILITY) result = 'mobility_kill';
    else if (draw < wCrew + COMP_MOBILITY + COMP_FIREPOWER) result = 'firepower_kill';
    else if (draw < wCrew + COMP_MOBILITY + COMP_FIREPOWER + COMP_BOTH) result = 'combat_ineffective';
    else result = 'catastrophic';

    this.pendingEvents.push({ kind: 'component', tick: this.tickCount, target, result, overmatch: z });

    switch (result) {
      case 'crew_shaken':
        this.applySuppression(target, CREW_SHAKEN_SUPP, false);
        break;
      case 'mobility_kill':
        this.mobilityKilled[target] = 1;
        this.moving[target] = 0;
        this.fieldRef[target] = -1;
        break;
      case 'firepower_kill':
        this.firepowerKilled[target] = 1;
        break;
      case 'combat_ineffective':
        this.mobilityKilled[target] = 1;
        this.moving[target] = 0;
        this.fieldRef[target] = -1;
        this.firepowerKilled[target] = 1;
        this.applySuppression(target, CREW_SHAKEN_SUPP, false);
        break;
      case 'catastrophic':
        this.destroy(target, shooter);
        break;
    }
  }

  private groundImpact(pr: number, x: Fx, y: Fx): void {
    this.pendingEvents.push({
      kind: 'nearMiss',
      tick: this.tickCount,
      shooter: this.prShooter[pr],
      weaponId: this.weaponOf(pr).id,
      x,
      y,
    });
    // Near misses suppress everyone close to the impact, both sides.
    const supp = this.prSupp[pr];
    if (supp > 0) {
      for (let i = 0; i < this.count; i++) {
        if (this.alive[i] === 0) continue;
        const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
        if (dSq <= NEAR_MISS_RADIUS_SQ) this.applySuppression(i, supp);
      }
    }
    if (this.prSplash[pr] > 0) this.splashAt(pr, x, y, -1);
  }

  private splashAt(pr: number, x: Fx, y: Fx, excludeId: number): void {
    const splash = this.prSplash[pr];
    const splashSq = fx.mul(splash, splash);
    const dmg = this.prDamage[pr];
    const shooter = this.prShooter[pr];
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || i === excludeId) continue;
      const dSq = distSqFx(fx.sub(this.posX[i], x), fx.sub(this.posY[i], y));
      if (dSq > splashSq) continue;
      const falloff = fx.sub(ONE, fx.div(fx.sqrt(dSq), splash));
      const scaled = fx.mul(dmg, falloff);
      const iType = this.unitTypes[this.typeIdx[i]];
      if (iType.isSoft) {
        this.applyDamage(i, scaled, shooter);
      }
      this.applySuppression(i, fx.mul(this.prSupp[pr], BOUNCE_SUPP_MULT));
    }
  }

  private applyDamage(target: number, dmg: Fx, by: number): void {
    if (dmg <= 0 || this.alive[target] === 0) return;
    this.hp[target] = fx.sub(this.hp[target], dmg);
    this.lastDamagedTick[target] = this.tickCount;
    if (this.hp[target] <= 0) this.destroy(target, by);
  }

  /** coverProtects: fire arriving from outside is muffled by entrenchment;
   *  a penetration's crew shock (crew_shaken) is not. */
  private applySuppression(target: number, amount: Fx, coverProtects = true): void {
    const type = this.unitTypes[this.typeIdx[target]];
    let a = fx.mul(amount, type.suppResFactor);
    const vet = this.veterancy[target];
    if (vet > 0) a = fx.mul(a, fx.sub(ONE, vet * VET_SUPP_BONUS));
    if (coverProtects) {
      const cov = this.cover[(this.posY[target] >> 16) * this.width + (this.posX[target] >> 16)];
      a = fx.mul(a, COVER_SUPP[cov]);
    }
    const s = fx.add(this.suppression[target], a);
    this.suppression[target] = fx.min(s, SUPP_CAP);
  }

  private destroy(target: number, by: number): void {
    this.alive[target] = 0;
    this.hp[target] = 0;
    this.moving[target] = 0;
    this.engaging[target] = 0;
    this.fieldRef[target] = -1;
    this.pendingEvents.push({ kind: 'destroyed', tick: this.tickCount, entity: target, by });
  }

  // ----------------------------------------------------------------- movement

  private stepMovement(): void {
    const w = this.width;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0 || this.moving[i] === 0 || this.mobilityKilled[i] === 1) continue;
      // Attack-movers halt to fight while they hold a target (stationary
      // stance emerges from this — no scripted bonus needed).
      if (this.attackMove[i] === 1 && this.engaging[i] === 1) continue;
      const type = this.unitTypes[this.typeIdx[i]];
      const px = this.posX[i];
      const py = this.posY[i];
      const tileX = px >> 16;
      const tileY = py >> 16;
      const goalTileX = this.goalX[i] >> 16;
      const goalTileY = this.goalY[i] >> 16;

      let step = type.stepPerTick;
      if (this.routed[i] === 1) {
        step = step >> ROUT_SPEED_SHIFT; // fleeing at a crouch-run
      } else if (this.pinned[i] === 1) {
        step = step >> PIN_SPEED_SHIFT; // gone to ground
      }

      let nx: Fx;
      let ny: Fx;
      let arrived = false;
      let onFinalLeg = true;
      if (tileX !== goalTileX || tileY !== goalTileY) {
        const fRef = this.fieldRef[i];
        if (fRef >= 0) {
          const d = this.fields[fRef].dirs[tileY * w + tileX];
          if (d !== DIR_NONE) onFinalLeg = false;
        }
      }

      if (onFinalLeg) {
        let dx = fx.sub(this.goalX[i], px);
        let dy = fx.sub(this.goalY[i], py);
        const LIM = 3 * ONE;
        dx = fx.clamp(dx, -LIM, LIM);
        dy = fx.clamp(dy, -LIM, LIM);
        const dist = fx.sqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
        if (dist <= step) {
          nx = this.goalX[i];
          ny = this.goalY[i];
          arrived = true;
        } else {
          nx = fx.add(px, fx.div(fx.mul(dx, step), dist));
          ny = fx.add(py, fx.div(fx.mul(dy, step), dist));
        }
      } else {
        const fRef = this.fieldRef[i];
        const d = this.fields[fRef].dirs[tileY * w + tileX];
        nx = fx.add(px, fx.mul(DIR_VX[d], step));
        ny = fx.add(py, fx.mul(DIR_VY[d], step));
      }

      const ntx = nx >> 16;
      const nty = ny >> 16;
      if (this.blocked[nty * w + ntx] !== 0) {
        if (this.blocked[tileY * w + ntx] === 0) {
          ny = py;
        } else if (this.blocked[nty * w + tileX] === 0) {
          nx = px;
        } else {
          nx = px;
          ny = py;
        }
      }

      const mvx = fx.sub(nx, px);
      const mvy = fx.sub(ny, py);
      if (mvx !== 0 || mvy !== 0) {
        this.turnToward(i, fx.atan2(mvy, mvx));
      }
      this.posX[i] = nx;
      this.posY[i] = ny;
      if (arrived && nx === this.goalX[i] && ny === this.goalY[i]) {
        this.moving[i] = 0;
        this.fieldRef[i] = -1;
      }
    }
  }

  // ------------------------------------------------------------------- upkeep

  private stepUpkeep(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      // Suppression decays exponentially (GDD 5.5).
      this.suppression[i] = fx.mul(this.suppression[i], SUPP_DECAY);
      if (this.pinned[i] === 0 && this.suppression[i] > PIN_AT) {
        this.pinned[i] = 1;
        this.pendingEvents.push({ kind: 'pinned', tick: this.tickCount, entity: i });
      } else if (this.pinned[i] === 1 && this.suppression[i] < UNPIN_AT) {
        this.pinned[i] = 0;
        this.pendingEvents.push({ kind: 'unpinned', tick: this.tickCount, entity: i });
        if (this.routed[i] === 1) {
          // The fire lifted: rally where they stand and await orders.
          this.routed[i] = 0;
          this.moving[i] = 0;
          this.fieldRef[i] = -1;
          this.pendingEvents.push({ kind: 'rallied', tick: this.tickCount, entity: i });
        }
      }
      // Breaking (GDD 5.5a): soft units pinned too long rout — abandon
      // orders and flee the kill zone instead of dying in place.
      if (this.pinned[i] === 1) {
        this.pinnedTicks[i]++;
        if (
          this.pinnedTicks[i] === ROUT_AFTER_TICKS &&
          this.routed[i] === 0 &&
          this.unitTypes[this.typeIdx[i]].isSoft &&
          this.mobilityKilled[i] === 0
        ) {
          this.routed[i] = 1;
          this.startRout(i);
          this.pendingEvents.push({ kind: 'routed', tick: this.tickCount, entity: i });
        }
      } else {
        this.pinnedTicks[i] = 0;
      }
      // Field recovery: left alone for a while, crews patch up and wounded
      // walk again — but only to a ceiling. Serious damage needs M2 repair.
      if (this.tickCount - this.lastDamagedTick[i] >= REGEN_DELAY_TICKS) {
        const type = this.unitTypes[this.typeIdx[i]];
        const cap = fx.mul(type.hp, REGEN_CAP);
        if (this.hp[i] < cap) {
          this.hp[i] = fx.min(fx.add(this.hp[i], fx.mul(type.hp, REGEN_FRAC)), cap);
        }
      }
      // Weapon cooldowns.
      if (this.cooldown[i * 2] > 0) this.cooldown[i * 2]--;
      if (this.cooldown[i * 2 + 1] > 0) this.cooldown[i * 2 + 1]--;
      // APS magazine reload.
      if (this.apsAmmo[i] === 0 && this.apsReloadLeft[i] > 0) {
        if (--this.apsReloadLeft[i] === 0) {
          this.apsAmmo[i] = this.unitTypes[this.typeIdx[i]].apsMagazine;
        }
      }
    }
  }

  // --------------------------------------------------------------------- hash

  /** Stable digest of all mutable state — the determinism canary. */
  hash(): number {
    let h = HASH_SEED;
    h = hashWord(h, this.seed);
    h = hashWord(h, this.tickCount);
    h = hashWord(h, this.count);
    h = hashArray(h, this.rng.state);
    h = hashArray(h, this.blocked);
    h = hashArray(h, this.cover);
    h = hashArray(h, this.alive);
    h = hashArray(h, this.side);
    h = hashArray(h, this.typeIdx);
    h = hashArray(h, this.posX);
    h = hashArray(h, this.posY);
    h = hashArray(h, this.facing);
    h = hashArray(h, this.hp);
    h = hashArray(h, this.suppression);
    h = hashArray(h, this.moving);
    h = hashArray(h, this.attackMove);
    h = hashArray(h, this.goalX);
    h = hashArray(h, this.goalY);
    h = hashArray(h, this.cooldown);
    h = hashArray(h, this.lastFired);
    h = hashArray(h, this.engaging);
    h = hashArray(h, this.curTarget);
    h = hashArray(h, this.mobilityKilled);
    h = hashArray(h, this.firepowerKilled);
    h = hashArray(h, this.pinned);
    h = hashArray(h, this.stance);
    h = hashArray(h, this.ambushRadiusSq);
    h = hashArray(h, this.pinnedTicks);
    h = hashArray(h, this.routed);
    h = hashArray(h, this.lastDamagedTick);
    h = hashArray(h, this.veterancy);
    h = hashArray(h, this.apsAmmo);
    h = hashArray(h, this.apsReloadLeft);
    h = hashArray(h, this.apsRecent);
    h = hashArray(h, this.apsLastTick);
    h = hashArray(h, this.contact);
    h = hashArray(h, this.contactState);
    h = hashArray(h, this.prActive);
    h = hashArray(h, this.prShooter);
    h = hashArray(h, this.prTarget);
    h = hashArray(h, this.prCls);
    h = hashArray(h, this.prWillHit);
    h = hashArray(h, this.prTicksLeft);
    h = hashArray(h, this.prOriginX);
    h = hashArray(h, this.prOriginY);
    h = hashArray(h, this.prAimX);
    h = hashArray(h, this.prAimY);
    h = hashArray(h, this.prPen);
    h = hashArray(h, this.prDamage);
    h = hashArray(h, this.prSupp);
    h = hashArray(h, this.prSplash);
    h = hashArray(h, this.prWeaponIdx);
    return h >>> 0;
  }
}
