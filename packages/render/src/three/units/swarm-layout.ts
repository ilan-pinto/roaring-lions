/**
 * E6 (GH-274) chunk B: the pure maths behind the swarm's instanced draw.
 *
 * Three-free, like `missiles.ts` and `air-lift.ts`: everything here is
 * arithmetic over plain numbers so it can be pinned under `environment: 'node'`
 * with no GPU. `swarm-batch.ts` is the half that owns `THREE` objects.
 *
 * ## What a swarm IS to the renderer
 *
 * The sim has ONE entity for a cloud of members and derives the live count from
 * hp (`Sim.swarmMembers`, `ceil(hp / member_hp)`). It never says WHICH member
 * died, so the renderer chooses, and the choice is the whole design:
 *
 *  - **Slots are fixed per entity.** Slot `k` keeps its home in the cloud for
 *    the whole mission, a deterministic function of `(entity id, k)`.
 *  - **Members `0 .. live-1` are drawn; the highest slot is always the one
 *    that leaves.** So every surviving drone stays exactly where it was, and
 *    the beam (chunk C) knows which member its next `struck` removes: slot
 *    `live-1`.
 *  - **Presentation only.** Positions wander on the SIM clock (a frozen tick
 *    repeats, the GH-391 lesson). No sim RNG is read or advanced; the hashes are
 *    `tileHash`, the same presentation hash decals and sway use.
 *
 * ## Exits
 *
 * A member that leaves is an EXIT, classified by what happened this frame: a
 * `fire` event from that shooter makes it a DIVE (it rides the bomb's flight to
 * the impact point and is spent there); anything else makes it a FALL (a
 * 0.6 s tumble on a hashed axis that ends as a wreck on the ground).
 *
 * The dive deliberately does not live in `shells.ts`'s `SHELL_PROFILES`: that
 * table is `Record<ShellKind, ShellProfile>` consumed by `ShellBatch`, whose
 * round has a streak and a trail. The dive has neither - the BODY is the
 * projectile - so a profile row there would be a row of zeroes feeding a batch
 * that draws it. Its flight TIME is the sim's own for class `heat`, through the
 * copied `PROJ_SPEED` rule `missiles.ts` already carries (`missileDurationS`).
 */
import { WEAPON_CLASS } from '@lions/sim';
import { MISS_LATERAL_TILES, MISS_OVERSHOOT_TILES, hash01, missileDurationS, missileResolveTick } from './missiles';
import { tileHash } from '../../tile-hash';

/** 16 live swarms of 12 on screen. The largest authored mission is 65 units. */
export const SWARM_LIVE_CAPACITY = 12 * 16;
/**
 * Headroom for the members in flight on top of those: four swarms' worth of
 * divers and tumblers (a diver lives ~0.1-0.6 s, a tumbler 0.6 s). Without it a
 * full screen of live members left no instance for a member that had just left,
 * and the exit vanished the frame it began.
 */
export const SWARM_EXIT_HEADROOM = 12 * 4;
export const SWARM_CAPACITY = SWARM_LIVE_CAPACITY + SWARM_EXIT_HEADROOM;
/** Ground wrecks kept, oldest evicted first (`MAX_MESH_WRECKS`'s rule). */
export const SWARM_WRECK_CAP = 96;

/** Homes keep this far from each other (tiles). */
export const SWARM_SLOT_MIN_SEP_TILES = 0.18;
/** The Lissajous wander about a home (tiles, per axis). */
export const SWARM_WANDER_TILES = 0.08;
/** The vertical bob (tiles) and its rate. */
export const SWARM_BOB_TILES = 0.03;
export const SWARM_BOB_HZ = 1.7;
/** Each member's yaw is the entity's facing plus up to this much of hash jitter. */
export const SWARM_YAW_JITTER_RAD = (25 * Math.PI) / 180;
/** A member's height is the air lift x (1 +/- this). */
export const SWARM_LIFT_JITTER = 0.25;
/** Wander periods per slot, seconds. */
export const SWARM_PERIOD_MIN_S = 2.3;
export const SWARM_PERIOD_MAX_S = 3.9;

/** A shot-down member falls for this long, spinning at the rate below. */
export const SWARM_TUMBLE_S = 0.6;
export const SWARM_TUMBLE_RAD_S = (540 * Math.PI) / 180;
/** The tumble eases onto its rest pose over the last fraction of the fall. */
export const SWARM_TUMBLE_SETTLE_FROM = 0.7;
/** A wreck lies tilted by up to this much (rad). */
export const SWARM_WRECK_ROLL_RAD = 0.35;

/** A diver pitches nose-down this far over this long. */
export const SWARM_DIVE_PITCH_RAD = (60 * Math.PI) / 180;
export const SWARM_DIVE_PITCH_S = 0.12;
/** `missile_impact` at this scale where a dive lands (a bomblet, not a Spike). */
export const SWARM_DIVE_IMPACT_SCALE = 0.6;
/** The warhead class' `impactPower` (`missiles.ts`, `warhead`) the dive scales. */
export const SWARM_DIVE_IMPACT_POWER = 0.3;
/** A diver ends this high above the ground (world units): the bomb goes off at the surface. */
export const SWARM_DIVE_END_LIFT = 0.04;

/** Rotor blur discs: radians per second on the sim clock. */
export const SWARM_ROTOR_RAD_S = 28;

const TWO_PI = Math.PI * 2;

/** `tileHash` salted: one stream per `(entity, slot, salt)`. */
export function swarmHash(entityId: number, slot: number, salt: number): number {
  return tileHash(entityId * 7919 + salt * 104729, slot * 3571 + salt * 31 + 17);
}

export interface SwarmSlot {
  /** Home offset from the cloud centre, tiles, in the world X/Z plane. */
  readonly homeX: number;
  readonly homeZ: number;
  /** Multiplies the air lift: `1 +/- SWARM_LIFT_JITTER`. */
  readonly liftMul: number;
  /** Radians added to the entity's yaw. */
  readonly yawJitter: number;
  readonly periodX: number;
  readonly periodZ: number;
  readonly phaseX: number;
  readonly phaseZ: number;
  readonly phaseBob: number;
  /** Radians added to the rotor phase so no two members blur in step. */
  readonly rotorPhase: number;
}

const MAX_ATTEMPTS = 64;

/**
 * The cloud: `count` homes inside a disc of diameter `spreadTiles`, no two
 * closer than `SWARM_SLOT_MIN_SEP_TILES`, a pure function of `(entityId, count,
 * spreadTiles)`.
 *
 * Homes stay `SWARM_WANDER_TILES * sqrt(2)` inside the rim, so a member at the
 * far end of its wander is still inside the disc the ring and the pick radius
 * are sized to. Rejection-sampled: slot `k` takes the first of up to 64 hashed
 * candidates that clears every earlier slot, else the best of them (a crowded
 * disc degrades the separation rather than failing). Slot `k` never depends on
 * a LATER slot, so the layout of 12 is the layout of 8 plus four more.
 */
export function swarmSlots(entityId: number, count: number, spreadTiles: number): SwarmSlot[] {
  const rim = Math.max(0, spreadTiles / 2 - SWARM_WANDER_TILES * Math.SQRT2);
  const slots: SwarmSlot[] = [];
  for (let k = 0; k < count; k++) {
    let bestX = 0;
    let bestZ = 0;
    let bestClear = -1;
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      // Uniform over the disc: radius from the square root, angle from the second hash.
      const r = rim * Math.sqrt(swarmHash(entityId, k, 1 + a * 2));
      const th = TWO_PI * swarmHash(entityId, k, 2 + a * 2);
      const x = r * Math.cos(th);
      const z = r * Math.sin(th);
      let clear = Infinity;
      for (const s of slots) clear = Math.min(clear, Math.hypot(x - s.homeX, z - s.homeZ));
      if (clear >= SWARM_SLOT_MIN_SEP_TILES) {
        bestX = x;
        bestZ = z;
        break;
      }
      if (clear > bestClear) {
        bestX = x;
        bestZ = z;
        bestClear = clear;
      }
    }
    const h = (salt: number): number => swarmHash(entityId, k, 200 + salt);
    slots.push({
      homeX: bestX,
      homeZ: bestZ,
      liftMul: 1 + SWARM_LIFT_JITTER * (2 * h(1) - 1),
      yawJitter: SWARM_YAW_JITTER_RAD * (2 * h(2) - 1),
      periodX: SWARM_PERIOD_MIN_S + (SWARM_PERIOD_MAX_S - SWARM_PERIOD_MIN_S) * h(3),
      periodZ: SWARM_PERIOD_MIN_S + (SWARM_PERIOD_MAX_S - SWARM_PERIOD_MIN_S) * h(4),
      phaseX: TWO_PI * h(5),
      phaseZ: TWO_PI * h(6),
      phaseBob: TWO_PI * h(7),
      rotorPhase: TWO_PI * h(8),
    });
  }
  return slots;
}

export interface MemberOffset {
  /** Tiles from the cloud centre, world X / Z. */
  x: number;
  z: number;
  /** Tiles of bob added to the member's height. */
  bob: number;
}

/** Where a member is about its home at `simSec`: pure in `(slot, simSec)`. */
export function memberOffset(slot: SwarmSlot, simSec: number, out: MemberOffset): MemberOffset {
  out.x = slot.homeX + SWARM_WANDER_TILES * Math.sin((TWO_PI * simSec) / slot.periodX + slot.phaseX);
  out.z = slot.homeZ + SWARM_WANDER_TILES * Math.sin((TWO_PI * simSec) / slot.periodZ + slot.phaseZ);
  out.bob = SWARM_BOB_TILES * Math.sin(TWO_PI * SWARM_BOB_HZ * simSec + slot.phaseBob);
  return out;
}

/** The slots drawn alive: `0 .. live-1`, clamped to what the entity has. */
export function liveSlotCount(live: number, count: number): number {
  return live < 0 ? 0 : live > count ? count : live;
}

export type SwarmExitKind = 'dive' | 'fall';

export interface SwarmExit {
  readonly slot: number;
  readonly kind: SwarmExitKind;
}

/**
 * The exits when the live count drops `prev -> live`: slots `prev-1` down to
 * `live`, HIGHEST FIRST. `dives` is how many `fire` events this shooter threw
 * this frame; the first `dives` exits (the highest slots) are the divers and
 * the rest fall. A rising count (never happens, the sim has no regrowth) plans
 * nothing - the slot simply reappears.
 */
export function planExits(prev: number, live: number, dives: number): SwarmExit[] {
  const out: SwarmExit[] = [];
  let d = dives;
  for (let slot = prev - 1; slot >= live && slot >= 0; slot--) {
    if (d > 0) {
      out.push({ slot, kind: 'dive' });
      d--;
    } else {
      out.push({ slot, kind: 'fall' });
    }
  }
  return out;
}

// --- the dive ---------------------------------------------------------------

export interface DiveRequest {
  /** The shooter's `fire` event. */
  readonly tick: number;
  readonly target: number;
  readonly structure: number;
  /** Where the bomb lands: the target's tile (structure centre for a building). */
  readonly toX: number;
  readonly toZ: number;
  readonly willHit: boolean;
  /** Distance the SIM counts the flight over (shooter centre to target). */
  readonly simDistTiles: number;
  /** Throw the landing FX (a versus seat that cannot see it does not). */
  readonly showImpact: boolean;
}

export interface DiveFlight {
  readonly fromX: number;
  readonly fromZ: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toZ: number;
  readonly toY: number;
  readonly duration: number;
  /** The tick the sim resolves the round on: the landing waits for it (`stepMissiles`' hold). */
  readonly resolveTick: number;
  readonly yaw: number;
  readonly miss: boolean;
  readonly showImpact: boolean;
}

/**
 * A dive from a member's own position to the impact point. The flight TIME is
 * `missileDurationS` for class `heat` - the sim's whole-tick count, copied the
 * way `missiles.ts` copies it - so the diver arrives when the sim resolves the
 * round. A miss lands past the target and to one side from a hash of the tick
 * and the shooter, never `Math.random`, exactly as a missile miss does; the end
 * height is the ground under THAT point (`groundAt`), not under the target.
 */
export function diveFlight(
  shooter: number,
  req: DiveRequest,
  fromX: number,
  fromZ: number,
  fromY: number,
  groundAt: (x: number, z: number) => number
): DiveFlight {
  let tx = req.toX;
  let tz = req.toZ;
  if (!req.willHit) {
    const dx = req.toX - fromX;
    const dz = req.toZ - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const lateral = (hash01(req.tick + 7919, shooter) - 0.5) * 2 * MISS_LATERAL_TILES;
    tx += ux * MISS_OVERSHOOT_TILES + -uz * lateral;
    tz += uz * MISS_OVERSHOOT_TILES + ux * lateral;
  }
  return {
    fromX,
    fromZ,
    fromY,
    toX: tx,
    toZ: tz,
    // The ground under where it ACTUALLY ends: a miss lands past the target, on other ground.
    toY: groundAt(tx, tz) + SWARM_DIVE_END_LIFT,
    duration: missileDurationS(WEAPON_CLASS.heat, req.simDistTiles),
    resolveTick: missileResolveTick(WEAPON_CLASS.heat, req.simDistTiles, req.tick),
    // Mesh yaw about +Y for a heading along game (dx, dz): the mesh's +X is forward.
    yaw: -Math.atan2(tz - fromZ, tx - fromX),
    miss: !req.willHit,
    showImpact: req.showImpact,
  };
}

export interface DivePose {
  x: number;
  y: number;
  z: number;
  /** Radians; negative = nose DOWN (the hull's +X is the nose). */
  pitch: number;
}

/** The diver `t` seconds into its flight: a straight line, nose-down over the first 120 ms. */
export function divePose(d: DiveFlight, t: number, out: DivePose): DivePose {
  const u = d.duration > 0 ? Math.min(1, Math.max(0, t / d.duration)) : 1;
  out.x = d.fromX + (d.toX - d.fromX) * u;
  out.z = d.fromZ + (d.toZ - d.fromZ) * u;
  out.y = d.fromY + (d.toY - d.fromY) * u;
  out.pitch = -SWARM_DIVE_PITCH_RAD * Math.min(1, Math.max(0, t / SWARM_DIVE_PITCH_S));
  return out;
}

/** Whether a dive has landed: its flight is over AND the sim has resolved the round. */
export function diveHasLanded(d: DiveFlight, t: number, simTick: number): boolean {
  return t >= d.duration && simTick > d.resolveTick;
}

// --- the fall ---------------------------------------------------------------

/** A hashed unit vector: the axis a falling member spins about. */
export function tumbleAxis(entityId: number, slot: number): [number, number, number] {
  const z = 2 * swarmHash(entityId, slot, 300) - 1;
  const th = TWO_PI * swarmHash(entityId, slot, 301);
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(th), z, r * Math.sin(th)];
}

/** The pose a wreck lies in: a yaw offset from the exit's and a small tilt. */
export function wreckRest(entityId: number, slot: number): { yawOffset: number; roll: number } {
  return {
    yawOffset: TWO_PI * swarmHash(entityId, slot, 302),
    roll: SWARM_WRECK_ROLL_RAD * (2 * swarmHash(entityId, slot, 303) - 1),
  };
}

/** Fall progress 0..1 `t` seconds after the member was hit. */
export function fallProgress(t: number): number {
  return t <= 0 ? 0 : t >= SWARM_TUMBLE_S ? 1 : t / SWARM_TUMBLE_S;
}

/** Height above the ground after `t` s of free fall from `h0`: accelerates, lands at `SWARM_TUMBLE_S`. */
export function fallHeight(h0: number, t: number): number {
  const u = fallProgress(t);
  return h0 * (1 - u * u);
}

/** How far the spin has eased onto the rest pose: 0 until `SWARM_TUMBLE_SETTLE_FROM`, 1 at landing. */
export function settleBlend(t: number): number {
  const u = fallProgress(t);
  const s = (u - SWARM_TUMBLE_SETTLE_FROM) / (1 - SWARM_TUMBLE_SETTLE_FROM);
  const c = s < 0 ? 0 : s > 1 ? 1 : s;
  return c * c * (3 - 2 * c);
}

// --- the wreck ring ---------------------------------------------------------

export interface SwarmWreckRecord {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly roll: number;
  readonly side: number;
}

/** Wrecks, oldest evicted first once `cap` is reached. */
export class SwarmWreckRing {
  readonly items: SwarmWreckRecord[] = [];
  constructor(readonly cap: number = SWARM_WRECK_CAP) {}
  push(w: SwarmWreckRecord): void {
    while (this.items.length >= this.cap) this.items.shift();
    this.items.push(w);
  }
  get length(): number {
    return this.items.length;
  }
}
