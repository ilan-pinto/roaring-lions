/**
 * The bone-facing half of squad cohesion, recoil and the kneel
 * (`squad-motion.ts` is the arithmetic).
 *
 * A team GLB moves all its figures with one set of clips, so out of the box
 * three riflemen run in lockstep on rails, turn as one block and recoil on
 * the same frame. Here, for a team the motion pass marked as a squad
 * (`extras.rl_figures[].squad`):
 *
 *   * each figure gets its OWN clip player -- the team's clips split by the
 *     figure's bone prefix -- so it has its own phase, cadence and stance;
 *   * each figure's root bones are re-parented under a `Group` that the
 *     renderer moves and turns, so the man walks his own path to his slot
 *     (start/stop lag, drift, a wider spread when kneeling) and his legs
 *     face where he is going while his upper body turns to the aim;
 *
 * and for every figure that fires (squad or not), a recoil kick on its spine,
 * one figure per shot.
 *
 * The sim's position of the unit is never changed (invariant 4): every
 * figure is drawn relative to the renderer's own interpolated unit.
 */
import * as THREE from 'three';
import type { ClipName } from '../../sheet';
import { clipScaleSignatures, type ClipPlayer } from './mesh-clip';
import type { Follower, RecoilKind } from './squad-motion';

export interface FigureSpec {
  readonly prefix: string;
  readonly recoil: RecoilKind | null;
  readonly squad: boolean;
}

/** `extras.rl_figures`, validated. Anything malformed is dropped with a warning. */
export function parseFigureExtras(raw: unknown, label: string): FigureSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: FigureSpec[] = [];
  for (const f of raw) {
    const prefix = (f as { prefix?: unknown }).prefix;
    const recoil = (f as { recoil?: unknown }).recoil ?? null;
    if (typeof prefix !== 'string' || (recoil !== null && recoil !== 'rifle' && recoil !== 'mg' && recoil !== 'launcher')) {
      console.warn(`mesh-unit: ${label} has a malformed rl_figures entry -- dropped`);
      continue;
    }
    out.push({ prefix, recoil: recoil as RecoilKind | null, squad: (f as { squad?: unknown }).squad === true });
  }
  return out;
}

/** True when a track's node belongs to figure `prefix` (its body, its kneeler
 *  or walker variants, its weapon and its corpse). */
export function ownsTrack(prefix: string, trackName: string): boolean {
  const node = trackName.slice(0, trackName.lastIndexOf('.'));
  return node.startsWith(`${prefix}_`) || node.startsWith(`${prefix}k_`) || node.startsWith(`${prefix}w_`);
}

/**
 * The team's clips split per figure. `null` when any track belongs to no
 * figure -- a shared prop -- since a figure-split player would leave it
 * frozen; such a team keeps the one team player.
 */
export function splitClips(
  clips: ReadonlyMap<ClipName, THREE.AnimationClip>,
  prefixes: readonly string[]
): Map<string, Map<ClipName, THREE.AnimationClip>> | null {
  const out = new Map<string, Map<ClipName, THREE.AnimationClip>>(prefixes.map((p) => [p, new Map()]));
  for (const [name, clip] of clips) {
    const byFigure = new Map<string, THREE.KeyframeTrack[]>(prefixes.map((p) => [p, []]));
    for (const track of clip.tracks) {
      const owner = prefixes.find((p) => ownsTrack(p, track.name));
      if (!owner) return null;
      byFigure.get(owner)!.push(track);
    }
    for (const p of prefixes) {
      out.get(p)!.set(name, new THREE.AnimationClip(`${name}#${p}`, clip.duration, byFigure.get(p)!));
    }
  }
  return out;
}

export interface Kick {
  readonly at: number;
  readonly kind: RecoilKind;
  readonly rounds: number;
}

export interface FigureRig {
  readonly index: number;
  readonly prefix: string;
  readonly recoil: RecoilKind | null;
  readonly spine: THREE.Bone | null;
  /** Squad mode only from here down. */
  readonly group: THREE.Group | null;
  /** The figure's rest slot in the team's frame, metres (x forward, z right). */
  readonly slot: THREE.Vector3;
  readonly player: ClipPlayer | null;
  readonly follower: Follower;
  yaw: number;
  depth: number;
  lastDepth: number;
  started: boolean;
  kicks: Kick[];
}

export interface SquadRig {
  readonly squad: boolean;
  readonly figures: FigureRig[];
  formationYaw: number;
  shots: number;
  started: boolean;
  /** The unit's stance depth over the last few frames, for the stagger. */
  readonly depthHistory: { t: number; d: number }[];
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let hit: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && o.name === name) hit = o as THREE.Bone;
  });
  return hit;
}

/**
 * Build the rig for one instantiated entity. `figureClips` is the template's
 * per-figure split (null: no squad). Mutates the clone: in squad mode each
 * figure's root bones move under a fresh Group.
 */
export function buildSquadRig(
  root: THREE.Object3D,
  mixer: THREE.AnimationMixer,
  specs: readonly FigureSpec[],
  figureClips: ReadonlyMap<string, ReadonlyMap<ClipName, THREE.AnimationClip>> | null
): SquadRig | null {
  if (specs.length === 0) return null;
  const squad = figureClips !== null && specs.every((s) => s.squad);
  const figures: FigureRig[] = specs.map((s, index) => {
    const spine = findBone(root, `${s.prefix}_spine`);
    const rootBone = findBone(root, `${s.prefix}_root`);
    let group: THREE.Group | null = null;
    const slot = new THREE.Vector3();
    let player: ClipPlayer | null = null;
    if (squad && rootBone && rootBone.parent) {
      slot.set(rootBone.position.x, 0, rootBone.position.z);
      const parent = rootBone.parent;
      group = new THREE.Group();
      group.name = `${s.prefix}_figure`;
      parent.add(group);
      const movers: THREE.Object3D[] = [];
      for (const c of [...parent.children]) {
        if (c === group || !(c as THREE.Bone).isBone) continue;
        if (c.name.startsWith(`${s.prefix}_`) || c.name.startsWith(`${s.prefix}k_`) || c.name.startsWith(`${s.prefix}w_`)) movers.push(c);
      }
      for (const m of movers) group.add(m);
      const clips = figureClips!.get(s.prefix)!;
      const actions = new Map<ClipName, THREE.AnimationAction>();
      for (const [name, clip] of clips) actions.set(name, mixer.clipAction(clip));
      player = { actions, currentClip: null, clipScale: clipScaleSignatures(clips), fades: new Map() };
    }
    return {
      index,
      prefix: s.prefix,
      recoil: s.recoil,
      spine,
      group,
      slot,
      player,
      follower: { x: 0, z: 0, vx: 0, vz: 0 },
      yaw: 0,
      depth: 0,
      lastDepth: 0,
      started: false,
      kicks: [],
    };
  });
  return { squad, figures, formationYaw: 0, shots: 0, started: false, depthHistory: [] };
}

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/** Rotate `bone` in WORLD space by `angle` about the world-space `axis`,
 *  about its own origin. Its parent's world matrix must be current. */
export function rotateBoneWorld(bone: THREE.Bone, axis: THREE.Vector3, angle: number): void {
  if (angle === 0 || !bone.parent) return;
  bone.parent.getWorldQuaternion(_pq);
  _axis.copy(axis).applyQuaternion(_pq.clone().invert()).normalize();
  _q.setFromAxisAngle(_axis, angle);
  bone.quaternion.premultiply(_q);
}

/** The players a dying entity must stop, so the team's death clip owns every bone. */
export function stopSquadPlayers(rig: SquadRig): void {
  for (const f of rig.figures) {
    if (!f.player) continue;
    for (const a of f.player.actions.values()) a.stop();
    f.player.fades.clear();
    f.player.currentClip = null;
    f.kicks = [];
  }
}

/** Hold a once-clip at `fraction` of its length: the drop and the rise are
 *  driven by the sim's ticks left, not by the mixer's clock. */
export function scrubAction(action: THREE.AnimationAction | undefined, fraction: number): void {
  if (!action) return;
  action.timeScale = 0;
  action.time = Math.min(1, Math.max(0, fraction)) * action.getClip().duration;
}
