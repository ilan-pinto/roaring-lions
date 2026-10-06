/**
 * Which teams the motion pass touches, and how. Data, so a reviewer can read
 * the whole scope in one place and a new team is one entry.
 *
 * Slots are glTF metres in the team's own frame: +X forward, +Z the
 * figures' anatomical right. The approved wedge (motion checkpoint, 5 Oct):
 * three figures at (+0.45, 0) and (-0.45, +-1.05); two in echelon at
 * (+0.35, -0.30) and (-0.35, +0.45). sarim_rifles takes a looser, uneven
 * wedge so it does not silhouette as inf_squad's (validate:meshes' IoU).
 */
import type { WeaponKind } from './hold';

export const MOTION_VERSION = 1;

export interface FigureSpec {
  readonly prefix: string;
  /** A hand-held weapon the hold owns; absent for a figure that keeps its own arms. */
  readonly weapon?: WeaponKind;
  /** This figure drops to a knee in `kneel`/`kneelIn`/`kneelOut`. */
  readonly kneels?: boolean;
  /** Target rest slot [x, z], metres. */
  readonly slot?: readonly [number, number];
  /** Extra root-level nodes that move with this figure (its kneeler body). */
  readonly companions?: readonly string[];
  /** The kick this figure's shots get at runtime (`units/squad-motion.ts`),
   *  when it is not implied by `weapon` (rifle -> rifle, a tube -> launcher). */
  readonly recoil?: 'rifle' | 'mg' | 'launcher';
}

export function recoilOf(f: FigureSpec): 'rifle' | 'mg' | 'launcher' | null {
  if (f.recoil) return f.recoil;
  if (!f.weapon) return null;
  return f.weapon === 'rifle' ? 'rifle' : 'launcher';
}

export interface MotionTeam {
  readonly dir?: string;
  readonly figures: readonly FigureSpec[];
  readonly hold: boolean;
  readonly kneel: boolean;
  readonly formation: boolean;
  readonly stride: boolean;
  /** 'replant' (the default) re-solves the legs onto planted footpaths
   *  (`replant.ts`); 'warp' scales a captured run's own stance instead
   *  (`stride.ts`), kept for a rig the replant cannot drive. */
  readonly strideMode?: 'warp' | 'replant';
  /** The unit's `mobility.speed_tiles_s` (pinned against the JSON by test). */
  readonly speedTiles: number;
}

const rifles = (prefixes: string[], slots?: [number, number][]): FigureSpec[] =>
  prefixes.map((prefix, i) => ({ prefix, weapon: 'rifle', kneels: true, ...(slots ? { slot: slots[i] } : {}) }));

export const MOTION_TEAMS: Record<string, MotionTeam> = {
  inf_squad: {
    figures: rifles(['f0', 'f1', 'f2'], [[-0.45, 1.05], [0.45, 0], [-0.45, -1.05]]),
    hold: true, kneel: true, formation: true, stride: true, speedTiles: 0.9,
  },
  sarim_rifles: {
    figures: rifles(['sar0', 'sar1', 'sar2'], [[-0.3, 1.15], [0.5, 0.05], [-0.6, -0.95]]),
    hold: true, kneel: true, formation: true, stride: true, speedTiles: 0.9,
  },
  militia_cell: {
    figures: rifles(['mil0', 'mil1'], [[0.35, -0.3], [-0.35, 0.45]]),
    hold: true, kneel: true, formation: true, stride: true, speedTiles: 0.95,
  },
  yahalom_squad: {
    figures: [
      { prefix: 'yah_a', kneels: true, slot: [0.35, -0.3], companions: ['yah_ak_root', 'yah_ak_death_root'] },
      { prefix: 'yah_b', weapon: 'rifle', kneels: true, slot: [-0.35, 0.45] },
    ],
    hold: true, kneel: true, formation: true, stride: true, speedTiles: 0.85,
  },
  rpg_team: {
    figures: [
      { prefix: 'rpg_fire', weapon: 'rpg', kneels: true, slot: [0.35, -0.3] },
      { prefix: 'rpg_load', weapon: 'rifle', kneels: true, slot: [-0.35, 0.45] },
    ],
    hold: true, kneel: true, formation: true, stride: true, speedTiles: 0.9,
  },
  demo_squad: {
    figures: [{ prefix: 'demo_b', weapon: 'rifle', kneels: true }],
    hold: true, kneel: true, formation: false, stride: true, speedTiles: 0.85,
  },
  mortar_team: {
    figures: [{ prefix: 'mtr_no3', weapon: 'rifle' }],
    hold: true, kneel: false, formation: false, stride: true, speedTiles: 0.65,
  },
  manpad_team: {
    figures: [{ prefix: 'mpd_fire', weapon: 'manpad', kneels: true }],
    hold: true, kneel: true, formation: false, stride: true, speedTiles: 0.75,
  },
  // Stride only: the gait gate is tree-wide, so every walker is re-timed.
  at_team: { figures: [{ prefix: 'at_fire', recoil: 'launcher' }], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.7 },
  charge_squad: { figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 1.9 },
  breach_team: { figures: [{ prefix: 'brc_point', recoil: 'rifle' }, { prefix: 'brc_cover', recoil: 'rifle' }], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.95 },
  recoilless_team: { figures: [{ prefix: 'rcl_fire', recoil: 'launcher' }], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.85 },
  recon_zikit: { figures: [{ prefix: 'zk_rifle', recoil: 'rifle' }], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.9 },
  // The crew-served teams' walkers (`*w`, D6): they march between positions.
  atgm_cell: { figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.7 },
  mortar_crew: { figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.6 },
  digger_crew: { figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.5 },
  // The civilians (`data/units/civilians.json`, 0.8 tiles/s): captured
  // Mixamo bipeds, re-timed and re-planted on their own leg bones.
  civilian_child: { dir: 'civilians', figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.8 },
  civilian_woman: { dir: 'civilians', figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.8 },
  farm_worker: { dir: 'civilians', figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.8 },
  office_worker: { dir: 'civilians', figures: [], hold: false, kneel: false, formation: false, stride: true, speedTiles: 0.8 },
};

/**
 * Steps per second a person takes at `v` metres per second. Walking
 * cadence rises from about 1.8 steps/s at 1.3 m/s; a run starts near
 * 2.6 steps/s and rises slowly with speed (a 2.7 m/s jog is about 2.8, a
 * 5.7 m/s sprint about 3.6) -- most of a runner's extra speed is a longer
 * stride, not a faster one. The approved targets: 2.8 at 2.7 m/s, about
 * 3.7 at 5.7 m/s.
 */
export function targetCadence(v: number): number {
  return v <= 2.0 ? 1.0 + 0.62 * v : 2.05 + 0.28 * v;
}

/** `tools/dimetric.py`'s UNITS_PER_TILE: one tile is three metres. */
export const MESH_METRES_PER_TILE = 3;
