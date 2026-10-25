/**
 * Per-vehicle running-gear recipes: where each spinning wheel's axle is, how
 * far out from it a face may sit and still turn with it, and where each track
 * loop runs. Authored in code, like `wreck-recipes.ts`, and consumed by
 * `running-gear-pass.ts`.
 *
 * Every number was MEASURED from the shipped bytes (`art/meshes/vehicles/
 * <id>.glb` at `main@d4823128`). The method is in the design doc
 * (`docs/superpowers/specs/2026-10-12-wheels-and-tracks-design.md` §1):
 * - Clean tyre components: the bounding-box centre and half-extent of the
 *   rubber vertices inside a seeded disc, iterated to convergence.
 * - The gun truck and the Grad, whose tyres are partly in `hull_hull`/
 *   `hull_plate`: the extent of every hull vertex in the tyre's sideways slab.
 * - The tracked vehicles' stations: the hub components and a circle fit.
 *
 * `running-gear-recipes.test.ts` holds these against the doc's own table as
 * LITERALS. The pass reads them from here, so a wrong number here would agree
 * with itself anywhere else.
 *
 * Coordinates are the hull mesh's own space = the vehicle's (every hull mesh
 * sits at the identity): +X forward, +Y up, +Z the physical right. `zIn`/`zOut`
 * are the wheel's sideways slab as distances from the centreline, on its own
 * side.
 */

import { rescaleOf } from './rescale-contract';

/** One spinning wheel. */
export interface WheelSeed {
  readonly side: 'r' | 'l';
  readonly x: number;
  readonly y: number;
  /** Rim radius, metres. */
  readonly r: number;
  readonly zIn: number;
  readonly zOut: number;
  readonly steer?: boolean;
}

/** A disc on a tracked vehicle's side whose faces are never track (a road
 *  wheel that does not spin, A3/A4). */
export interface DiscSeed {
  readonly side: 'r' | 'l';
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface TrackSeed {
  /** The track's sideways slab, as distances from the centreline. */
  readonly zIn: number;
  readonly zOut: number;
  /** Rubber vertices above this height are skirts, fenders or a cut line, not
   *  the loop. They are left out of the loop's outline. */
  readonly loopMaxY: number;
  /** How far inside or outside the loop outline a face may lie and still be
   *  track (the track's own thickness plus its grousers). */
  readonly band: number;
  /** A face is track only in a rubber connected part at least this big. That
   *  keeps out the skirt strips and hub caps, which are separate tiny parts. */
  readonly minComponentTris: number;
  /** Rubber vertices forward of this are not the loop (the D9's blade arms
   *  share the track's rubber part). */
  readonly loopMaxX?: number;
  /** The loop's top edge is a cut line, not track (the Lavi's rubber is a
   *  slice at y = 0.44 with the upper run hidden in the hull): no face is
   *  track for lying near it. */
  readonly openTop?: boolean;
  readonly excludeDiscs: readonly DiscSeed[];
}

export interface RunningGearRecipe {
  readonly wheels: readonly WheelSeed[];
  /** A face turns with a wheel when every vertex lies within `r * cut` of its
   *  axle in side view and inside its slab (plus `SLAB_MARGIN_M`). Above 1 on
   *  a clean tyre, so the tread band turns too. Below 1 where a track or a
   *  neighbouring tyre is welded on. */
  readonly cut: number;
  /** The Grad's rear bogie: two discs that would overlap at a full cut. Allowed
   *  only by name, and a face goes to its nearer axle. */
  readonly overlapOk?: boolean;
  readonly track?: TrackSeed;
}

/** The sideways tolerance on a wheel's slab, metres. */
export const SLAB_MARGIN_M = 0.03;

const both = (seeds: readonly Omit<WheelSeed, 'side'>[]): WheelSeed[] => [
  ...seeds.map((s) => ({ ...s, side: 'r' as const })),
  ...seeds.map((s) => ({ ...s, side: 'l' as const })),
];

// The Lavi's seeds are in the 6.32 m frame they were measured in, before the
// x1.18 rescale (`scaleTrackSeed` carries them over in the table below).
const LAVI_STATIONS: readonly DiscSeed[] = [
  ...[-2.4, -1.73, -1.14, -0.62, -0.08, 0.5, 1.17].map((x) => ({ side: 'r' as const, x, y: 0.34, r: 0.24 })),
  ...[-2.32, -1.58, -1.14, -0.6, -0.1, 0.5, 1.03].map((x) => ({ side: 'l' as const, x, y: 0.34, r: 0.24 })),
];
const LAVI_TRACK: TrackSeed = {
  zIn: 0.7,
  zOut: 1.4,
  loopMaxY: 0.4,
  openTop: true,
  band: 0.07,
  minComponentTris: 200,
  excludeDiscs: LAVI_STATIONS,
};

/**
 * A track seed measured in one frame, carried into a frame `f` times larger:
 * every length scales (slab, cut height, band, the excluded discs), the
 * component count does not. The Lavi's numbers were measured on the 6.32 m
 * export and stay as measured; the shipped file is x`LAVI_RESCALE`
 * (`rescale-contract.ts`), and the running-gear pass runs AFTER the rescale.
 */
export function scaleTrackSeed(seed: TrackSeed, f: number): TrackSeed {
  return {
    ...seed,
    zIn: seed.zIn * f,
    zOut: seed.zOut * f,
    loopMaxY: seed.loopMaxY * f,
    band: seed.band * f,
    ...(seed.loopMaxX === undefined ? {} : { loopMaxX: seed.loopMaxX * f }),
    excludeDiscs: seed.excludeDiscs.map((d) => ({ ...d, x: d.x * f, y: d.y * f, r: d.r * f })),
  };
}

const D9_WHEELS_X: readonly [number, number][] = [
  [-2.89, 0.645],
  [-1.69, 0.7],
  [-0.77, 0.73],
  [0.29, 0.73],
  [1.37, 0.855],
];

/**
 * The Namer's gear, shared with `veh_ambulance`: the ambulance's `hull_hull` and
 * `hull_rubber` are the Namer's own meshes, byte for byte (the roof box and the
 * stretcher racks are separate `medical_*` nodes the pass never tags), so the
 * recipe is the same object rather than a copy that could drift.
 */
const NAMER_GEAR: RunningGearRecipe = {
  // Road wheels welded into the track loop: the cut stays inside the track's
  // inner face (0.9 of the 0.49 m rim).
  cut: 0.9,
  wheels: [
    { side: 'r', x: 2.875, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'r', x: 1.675, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'r', x: 0.557, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'r', x: -0.561, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'r', x: -1.667, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'r', x: -2.841, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'l', x: 2.863, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'l', x: 1.671, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'l', x: 0.558, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'l', x: -0.555, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'l', x: -1.663, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
    { side: 'l', x: -2.846, y: 0.537, r: 0.49, zIn: 1.12, zOut: 1.98 },
  ],
  track: { zIn: 1.08, zOut: 2.08, loopMaxY: 1.13, band: 0.08, minComponentTris: 200, excludeDiscs: [] },
};

/** GH-709 (2026-10-22): the Te'o Howitzer's running gear, shared by `spg_long_range`
 *  and `spg_cluster` (the cluster is a graft on the Te'o's shipped GLB). */
const TEO_RUNNING_GEAR: RunningGearRecipe = {
  cut: 0.9,
  wheels: both([
    { x: 2.375, y: 0.39, r: 0.34, zIn: 1.0, zOut: 1.66 },
    { x: 1.49, y: 0.39, r: 0.34, zIn: 1.0, zOut: 1.66 },
    { x: 0.555, y: 0.39, r: 0.34, zIn: 1.0, zOut: 1.66 },
    { x: -0.31, y: 0.39, r: 0.34, zIn: 1.0, zOut: 1.66 },
    { x: -1.16, y: 0.39, r: 0.34, zIn: 1.0, zOut: 1.66 },
    { x: -2.02, y: 0.39, r: 0.34, zIn: 1.0, zOut: 1.66 },
  ]),
  track: { zIn: 0.97, zOut: 1.7, loopMaxY: 1.2, band: 0.08, minComponentTris: 200, excludeDiscs: [] },
};

export const RUNNING_GEAR_RECIPES: Readonly<Record<string, RunningGearRecipe>> = {
  // E6 (GH-274 chunk A2, 25 Oct): the Remetz Laser Carrier, a Meshy 6x6 whose tandem OVERLAPS (the
  // rear two tyres' axles are 0.78 m apart for a 1.32 m tyre, as the source delivered them: the Grad's
  // are the same), so `overlapOk` and a face goes to its nearer axle. Measured 2026-10-25 on the
  // exported `hull_rubber` (circle fit to each rim, bbox centre and half-extent in a seeded disc,
  // iterated to convergence; right and left within 4 cm of each other) at the 7.0 m scale (the lead's
  // GH-807 ruling; 7.6 m before it): axle y 0.66-0.67, rim radius 0.65-0.66, tyre slab |z| 0.93-1.50. The front axle steers (A9, as the four 4x4s').
  aa_remetz: {
    cut: 1.03,
    overlapOk: true,
    wheels: [
      { side: 'r', x: 1.922, y: 0.671, r: 0.655, zIn: 0.932, zOut: 1.497, steer: true },
      { side: 'r', x: -1.38, y: 0.661, r: 0.661, zIn: 0.95, zOut: 1.485 },
      { side: 'r', x: -2.155, y: 0.658, r: 0.658, zIn: 0.949, zOut: 1.483 },
      { side: 'l', x: 1.95, y: 0.666, r: 0.655, zIn: 0.953, zOut: 1.504, steer: true },
      { side: 'l', x: -1.382, y: 0.666, r: 0.66, zIn: 0.95, zOut: 1.495 },
      { side: 'l', x: -2.162, y: 0.665, r: 0.662, zIn: 0.952, zOut: 1.497 },
    ],
  },
  apc_eitan: {
    cut: 1.03,
    wheels: [
      { side: 'r', x: 2.287, y: 0.663, r: 0.66, zIn: 0.94, zOut: 1.504 },
      { side: 'r', x: 0.72, y: 0.662, r: 0.654, zIn: 0.947, zOut: 1.504 },
      { side: 'r', x: -0.742, y: 0.665, r: 0.661, zIn: 0.963, zOut: 1.504 },
      { side: 'r', x: -2.132, y: 0.662, r: 0.658, zIn: 0.937, zOut: 1.497 },
      { side: 'l', x: 2.288, y: 0.661, r: 0.661, zIn: 0.952, zOut: 1.504 },
      { side: 'l', x: 0.719, y: 0.662, r: 0.658, zIn: 0.961, zOut: 1.505 },
      { side: 'l', x: -0.744, y: 0.663, r: 0.654, zIn: 0.936, zOut: 1.505 },
      { side: 'l', x: -2.133, y: 0.659, r: 0.658, zIn: 0.924, zOut: 1.497 },
    ],
  },
  apc_kipod: {
    cut: 1.03,
    wheels: [
      { side: 'r', x: 2.296, y: 0.75, r: 0.764, zIn: 0.905, zOut: 1.858 },
      { side: 'r', x: 0.17, y: 0.749, r: 0.764, zIn: 0.989, zOut: 1.859 },
      { side: 'r', x: -1.961, y: 0.75, r: 0.764, zIn: 0.987, zOut: 1.852 },
      { side: 'l', x: 2.296, y: 0.752, r: 0.766, zIn: 0.895, zOut: 1.857 },
      { side: 'l', x: 0.167, y: 0.75, r: 0.762, zIn: 0.992, zOut: 1.858 },
      { side: 'l', x: -1.961, y: 0.751, r: 0.759, zIn: 0.951, zOut: 1.859 },
    ],
  },
  gun_truck: {
    cut: 1.03,
    wheels: [
      { side: 'r', x: 1.772, y: 0.415, r: 0.425, zIn: 0.824, zOut: 1.39, steer: true },
      { side: 'r', x: -1.466, y: 0.415, r: 0.425, zIn: 0.85, zOut: 1.39 },
      { side: 'l', x: 1.772, y: 0.415, r: 0.425, zIn: 0.85, zOut: 1.39, steer: true },
      { side: 'l', x: -1.466, y: 0.415, r: 0.425, zIn: 0.846, zOut: 1.39 },
    ],
  },
  jeep_shoded: {
    cut: 1.03,
    wheels: [
      { side: 'r', x: 1.646, y: 0.43, r: 0.43, zIn: 0.833, zOut: 1.045, steer: true },
      { side: 'r', x: -1.272, y: 0.438, r: 0.432, zIn: 0.831, zOut: 1.051 },
      { side: 'l', x: 1.643, y: 0.429, r: 0.429, zIn: 0.832, zOut: 1.049, steer: true },
      { side: 'l', x: -1.273, y: 0.442, r: 0.432, zIn: 0.827, zOut: 1.051 },
    ],
  },
  rocket_battery: {
    cut: 0.92,
    overlapOk: true,
    wheels: both([
      { x: 1.96, y: 0.48, r: 0.48, zIn: 0.0, zOut: 1.0 },
      { x: -0.9, y: 0.48, r: 0.48, zIn: 0.0, zOut: 1.0 },
      { x: -1.79, y: 0.48, r: 0.48, zIn: 0.0, zOut: 1.0 },
    ]),
  },
  scout_shachaf: {
    cut: 1.03,
    wheels: [
      { side: 'r', x: 1.406, y: 0.538, r: 0.537, zIn: 0.716, zOut: 1.268, steer: true },
      { side: 'r', x: -1.402, y: 0.537, r: 0.538, zIn: 0.714, zOut: 1.268 },
      { side: 'l', x: 1.406, y: 0.536, r: 0.538, zIn: 0.766, zOut: 1.268, steer: true },
      { side: 'l', x: -1.404, y: 0.537, r: 0.539, zIn: 0.764, zOut: 1.268 },
    ],
  },
  technical: {
    cut: 1.03,
    wheels: [
      // A least-squares circle through the tread: the rubber parts' boxes
      // carry a mud-flap sliver that pulled the rear centre 6 cm forward.
      { side: 'r', x: 1.692, y: 0.304, r: 0.312, zIn: 0.384, zOut: 0.853, steer: true },
      { side: 'r', x: -1.19, y: 0.309, r: 0.319, zIn: 0.436, zOut: 0.854 },
      { side: 'l', x: 1.69, y: 0.305, r: 0.312, zIn: 0.402, zOut: 0.847, steer: true },
      { side: 'l', x: -1.192, y: 0.31, r: 0.317, zIn: 0.411, zOut: 0.847 },
    ],
  },
  ifv_namer: NAMER_GEAR,
  // GH-709 (2026-10-22): the armoured ambulance is the Namer's hull under a
  // medical box; its road wheels spin and its tracks scroll as the Namer's do.
  veh_ambulance: NAMER_GEAR,
  // GH-709 (2026-10-22): the Te'o Howitzer. Six road wheels a side, each a distinct
  // rim on the Meshy bake like the Namer's, so they spin and the track scrolls. Measured
  // 2026-10-22 on the shipped `hull_rubber` (right and left within 3 cm of each other):
  // a circle fit to each wheel's rim vertices, axle y 0.38-0.43, rim radius 0.34 (the
  // fits that read 0.42 had locked onto the track run beside the rim). The tracks are
  // the band |z| 0.97-1.70, top run at y 1.10, the sprocket (rear) and idler (front)
  // static as the Namer's are. The cut stays inside the track's own inner face.
  spg_long_range: TEO_RUNNING_GEAR,
  // GH-709 P7: the Te'o Cluster Howitzer is the shipped Te'o's own hull with its gun
  // re-laid, a brake and a rear-deck rack (tools/vehicles/export_spg_cluster.py):
  // the running gear is untouched, so it takes the Te'o's recipe by reference and
  // the two cannot drift.
  spg_cluster: TEO_RUNNING_GEAR,
  mbt_lavi: { cut: 1, wheels: [], track: scaleTrackSeed(LAVI_TRACK, rescaleOf('mbt_lavi')) },
  officer_armour: { cut: 1, wheels: [], track: scaleTrackSeed(LAVI_TRACK, rescaleOf('officer_armour')) },
  // GH-709: the Lavi Ambush Tank wears the Lavi's own running gear (the net
  // stops above the track runs, so the seed is unchanged).
  mbt_lavi_camo: { cut: 1, wheels: [], track: scaleTrackSeed(LAVI_TRACK, rescaleOf('mbt_lavi_camo')) },
  dozer_d9: {
    cut: 1,
    wheels: [],
    track: {
      zIn: 1.0,
      zOut: 2.22,
      loopMaxY: 1.35,
      loopMaxX: 2.05,
      band: 0.1,
      minComponentTris: 200,
      excludeDiscs: [
        ...D9_WHEELS_X.map(([x, y]) => ({ side: 'r' as const, x, y, r: 0.39 })),
        ...D9_WHEELS_X.map(([x, y]) => ({ side: 'l' as const, x, y, r: 0.39 })),
      ],
    },
  },
};
