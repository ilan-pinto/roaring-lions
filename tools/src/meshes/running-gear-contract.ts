/**
 * The running-gear contract (mesh-unit contract v7, vehicles): what
 * `running-gear-pass.ts` writes into a vehicle GLB and what every other reader
 * (the kit pass, the gates, the runtime) agrees to read back.
 *
 * A dependency-free module for the same reason `kit-contract.ts` is one: the
 * pass, the kit pass, the roster test and `tools/validate_mesh_assets.py`
 * (which parses the three lists below out of this file as text) all need it,
 * and none of them should import a CLI entry point.
 *
 * Design: `docs/superpowers/specs/2026-10-12-wheels-and-tracks-design.md`,
 * approved by the lead on 2026-10-12 as written (A1-A12).
 */

/** Per-vertex wheel id, UNSIGNED_BYTE SCALAR: 0 = static, k = `wheels[k-1]`. */
export const RG_WHEEL_ATTR = '_RL_WHEEL';
/** Per-vertex track coordinate, FLOAT SCALAR: metres along that side's track
 *  loop, -1 = not track. */
export const RG_TRACK_ATTR = '_RL_TRACK';
/** The scene-level extras key (a sibling of `rl_gait`'s precedent). */
export const RG_EXTRAS_KEY = 'rl_running_gear';
/** Bumped when the extras' shape changes. */
export const RG_VERSION = 1;
/** The most wheels one vehicle may declare: the runtime's uniform arrays are
 *  this long. The Namer's twelve is the most any approved vehicle spins. */
export const RG_MAX_WHEELS = 16;
/** The value `_RL_TRACK` carries on a vertex that is not track. */
export const RG_NOT_TRACK = -1;

/** A1: the vehicles whose wheels spin (the Namer's are its road wheels). */
export const RG_SPIN_VEHICLES: readonly string[] = [
  'apc_eitan',
  'apc_kipod',
  'gun_truck',
  'ifv_namer',
  'jeep_shoded',
  'rocket_battery',
  'scout_shachaf',
  'spg_cluster',
  'spg_long_range',
  'technical',
  // GH-709: the armoured ambulance, the Namer's hull under a medical box.
  'veh_ambulance',
];

/** A2: the vehicles whose tracks scroll. `officer_armour` is the command Lavi
 *  (held art, GH-298) and takes the Lavi's recipe. */
export const RG_TRACK_VEHICLES: readonly string[] = ['dozer_d9', 'ifv_namer', 'mbt_lavi', 'officer_armour', 'veh_ambulance', 'mbt_lavi_camo', 'spg_long_range', 'spg_cluster'];

/** A9: the vehicles whose front axle steers. */
export const RG_STEER_VEHICLES: readonly string[] = ['gun_truck', 'jeep_shoded', 'scout_shachaf', 'technical'];

/** A6: the nominal tread pitch, metres. Each side's real pitch is this rounded
 *  so a whole number of bars fits its loop (`loopLength / round(loopLength /
 *  pitch)`), which is what makes the seam invisible. */
export const RG_TREAD_PITCH_M = 0.3;

/** A9: the steering ceiling, radians (20 degrees). The pass lowers it per wheel
 *  where the tyre would enter the body. */
export const RG_MAX_STEER_RAD = (20 * Math.PI) / 180;

export type RgSide = 'r' | 'l';

/** One spinning wheel, as written into `extras.rl_running_gear.wheels`. */
export interface RgWheel {
  /** `r` is +Z, the hull's physical right (forward +X x up +Y). */
  readonly side: RgSide;
  /** 0 is the frontmost wheel on its side. */
  readonly index: number;
  /** The axle centre in the hull mesh's own space (every hull mesh sits at the
   *  identity, which the pass checks). */
  readonly centre: readonly [number, number, number];
  /** The rim radius, metres: what the runtime divides ground speed by. */
  readonly radius: number;
  /** Every tagged vertex lies within this of the axle in side view. */
  readonly cutRadius: number;
  readonly steer: boolean;
  /** 0 for a wheel that does not steer. */
  readonly maxSteerRad: number;
}

export interface RgTrack {
  readonly side: RgSide;
  readonly loopLength: number;
  readonly pitch: number;
  /** The track's distance from the centreline, m: the lever arm a turn on the
   *  spot runs the two sides opposite by. */
  readonly gauge: number;
}

export interface RgExtras {
  readonly version: number;
  readonly wheels: readonly RgWheel[];
  readonly tracks: readonly RgTrack[];
}
