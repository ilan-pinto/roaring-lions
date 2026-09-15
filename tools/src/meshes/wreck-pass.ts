/**
 * The wreck pass: give a vehicle GLB a death state without giving it any new
 * geometry.
 *
 *     pnpm wreck:meshes                  # all eleven
 *     pnpm wreck:meshes -- --id=mbt_lavi # one
 *
 * Design: `docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md` §4.1-4.2.
 * Every `art/meshes/vehicles/<id>.glb` gains one extra top-level node,
 * `death_root`, holding one `WRECK_<name>` child per live mesh node. Each child
 * **references the same `Mesh` object** its live twin does, so the file grows
 * by a node and not by a buffer -- the eight Meshy-sourced vehicles are 1.6-3.4
 * MiB each and duplicating their geometry was ruled out on that number. Two
 * clips, `idle` and `wreck`, key the SCALE of every top-level live node and of
 * `death_root` as constants, 1/0 and 0/1, which is exactly what the infantry
 * team rigs ship and what `applyMeshClip` already plays.
 *
 * Three things about this are worth knowing before touching it.
 *
 * **The pass is idempotent by construction, and the trap is accessors.**
 * Re-running after a re-export has to be safe, and running twice has to be a
 * no-op on the bytes. Stripping the old `death_root` and the old clips is the
 * obvious half; the half that bites is that `Animation.dispose()` detaches the
 * animation and leaves its samplers' input/output accessors attached to the
 * Root, and the writer emits everything the Root holds. A pass that disposes
 * only the animation therefore grows the file by 56 bytes of keyframes plus a
 * buffer view on EVERY run, silently, and `pnpm encode:meshes --check` would
 * re-Draco all eleven every time anyone ran it. `stripWreck` walks channels,
 * samplers and then the accessors those samplers were the only users of.
 *
 * **Displacements are applied in WORLD space, after the node's own world
 * matrix** -- `D x W`, not `W x D`. Everything the recipe describes is a world
 * fact: the body settles toward the ground, the vehicle tilts about the centre
 * of its own bounds, the turret is thrown about the pivot's world origin. A
 * local-space composition would tilt each part about its own origin instead,
 * which on a Meshy export (where every top-level part sits at the identity and
 * the geometry carries the offset) happens to look almost right and is wrong
 * the moment a part has a transform of its own -- which is exactly the turret.
 *
 * **A part is classified by its ANCESTORS, not its parent.** `heli_peten`'s
 * `rotor_pivot` is a child of a `rotor_tilt` empty, so `rotor_metal`'s parent
 * is the pivot but on another export it might not be. Walking up to the scene
 * costs nothing and does not care how deep the rig is.
 *
 * No Draco here: `art/meshes/` is the uncompressed source of record and
 * `pnpm encode:meshes` mirrors it to `assets/meshes/` afterwards.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NodeIO,
  getBounds,
  type Accessor,
  type Document,
  type Mesh,
  type Node,
  type Scene,
  type bbox,
  type mat4,
  type vec3,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { WRECK_FRACTIONS, WRECK_RECIPES, type HullKind, type WreckRecipe } from './wreck-recipes';

export const DEATH_ROOT = 'death_root';
export const WRECK_PREFIX = 'WRECK_';
export const CLIP_IDLE = 'idle';
export const CLIP_WRECK = 'wreck';

/**
 * The clips' second keyframe time. Held-pose clips, so the value only has to
 * be short enough that nothing reads them as an animated collapse --
 * `mesh-team-death-shipped.test.ts` pins `duration < 0.2` for the infantry
 * `down`/`wreck` clips and this sits inside that.
 */
export const CLIP_SECONDS = 0.1;

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');

/**
 * The roles the body drop applies to. `rubber` is the wheels and the tracks:
 * they stay on the ground while everything bolted above them settles into the
 * suspension. The vocabulary is closed and censused -- the eleven shipped
 * vehicles between them use exactly `hull`, `plate`, `glass`, `metal`,
 * `recess` and `rubber` -- so this partition covers every part that ships.
 */
const DROP_ROLES: ReadonlySet<string> = new Set(['hull', 'plate', 'glass', 'metal', 'recess']);

// ---------------------------------------------------------------------------
// 4x4 arithmetic, column-major, glTF's own convention.
//
// Hand-rolled rather than pulled from gl-matrix: the only non-trivial piece a
// transform pass needs is the DECOMPOSE, and `Node.setMatrix` already does that
// (via `MathUtils.decompose`, three.js's algorithm, which gltf-transform uses
// in preference to gl-matrix's own). What is left is a multiply and three
// rotation builders, and adding a dependency for those would be worse than
// writing them.
// ---------------------------------------------------------------------------

const IDENTITY: mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** `a x b`: b is applied first. */
function multiply(a: mat4, b: mat4): mat4 {
  const out = [...IDENTITY] as mat4;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

const translation = (x: number, y: number, z: number): mat4 => [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1,
];

function rotationX(t: number): mat4 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotationY(t: number): mat4 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function rotationZ(t: number): mat4 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** The rotation `r`, applied about the world point `p` rather than the origin. */
const aboutPoint = (p: vec3, r: mat4): mat4 =>
  multiply(translation(p[0], p[1], p[2]), multiply(r, translation(-p[0], -p[1], -p[2])));

function transformPoint(m: mat4, p: vec3): vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Which of the three ground seats a part takes. A `rotor` is bolted to the
 * airframe and rests with it, so it is not a seat of its own; a thrown turret
 * and a collapsed canopy are separate objects on the ground and are.
 */
type SeatGroup = 'body' | 'turret' | 'canopy';

/** One live mesh node and the wreck pose being built for it. `base` is the
 *  world-space displacement before the group's ground seat is applied. */
interface Part {
  readonly node: Node;
  readonly mesh: Mesh;
  readonly seat: SeatGroup;
  /** Whether this part settles: `rubber` (wheels, tracks) does not. */
  readonly drops: boolean;
  base: mat4;
}

/** The measured facts a recipe's fractions are taken against. */
interface HullMetrics {
  readonly height: number;
  readonly length: number;
  readonly groundY: number;
  readonly centre: vec3;
  /** Index of the longer horizontal axis: 0 for X, 2 for Z. */
  readonly longAxis: 0 | 2;
  /**
   * How far the lowest BODY vertex stands above the vehicle's own lowest
   * point: the gap the hull has to settle into before it is sitting on the
   * axle line. Measured, per vehicle, 2026-09-15:
   *
   *     ifv_namer 0.363  rocket_battery 0.352  mbt_lavi 0.311  apc_eitan 0.227
   *     apc_kipod 0.210  scout_shachaf  0.147  paramotor 0.060  technical 0.046
   *     dozer_d9  0.027  heli_peten     0.000  jeep_shoded 0.000
   *
   * **This is what `HULL_DROP` is a fraction of, and the reason it is not a
   * fraction of the HEIGHT any more.** Against the height, the first
   * numbers dropped every body by 0.19-0.53 world units into ground that is
   * 0.00-0.36 below it, and all eleven shipped wrecks stood 0.20-0.69 units
   * UNDER the ground plane. A fraction of the clearance cannot do that, at
   * any value up to 1: a vehicle with no gap under it simply does not
   * settle, which is the honest answer for a dozer resting on its blade.
   */
  readonly clearance: number;
}

/**
 * The exact lowest world Y of one node's own geometry, after `extra` is
 * applied on top of its world matrix.
 *
 * Reads the POSITION accessor rather than rotating the AABB's eight corners,
 * and the difference is not pedantry. A rotated box's corners BOUND the
 * rotated geometry from outside, so seating a part by that measurement leaves
 * it floating by however much the box over-estimates -- which is exactly what
 * the first paramotor canopy did, and the over-estimate grows with the angle,
 * so the one part that rotates 80 degrees was the one it was worst for. Every
 * seat in this file is therefore taken off real vertices. Cost is one pass
 * over each vehicle's positions (measured: under 0.6 s for all eleven,
 * against 1.6-3.4 MiB Meshy exports).
 */
function lowestY(node: Node, extra: mat4 | null): number {
  const mesh = node.getMesh();
  if (!mesh) return Infinity;
  const world = node.getWorldMatrix();
  const m = extra ? multiply(extra, world) : world;
  const el = [0, 0, 0];
  let min = Infinity;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const count = pos.getCount();
    for (let i = 0; i < count; i++) {
      pos.getElement(i, el);
      const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
      if (y < min) min = y;
    }
  }
  return min;
}

const finite = (b: bbox): boolean => b.min.every(Number.isFinite) && b.max.every(Number.isFinite);

function unionBounds(nodes: readonly Node[]): bbox {
  const out: bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const node of nodes) {
    const b = getBounds(node);
    if (!finite(b)) continue; // an empty (a pivot with no mesh under it)
    for (let i = 0; i < 3; i++) {
      out.min[i] = Math.min(out.min[i], b.min[i]);
      out.max[i] = Math.max(out.max[i], b.max[i]);
    }
  }
  return out;
}

function measure(liveTop: readonly Node[], parts: readonly Part[], vehicleId: string): HullMetrics {
  const b = unionBounds(liveTop);
  if (!finite(b)) throw new Error(`${vehicleId}: no mesh geometry to measure`);
  const x = b.max[0] - b.min[0];
  const z = b.max[2] - b.min[2];

  // The suspension gap, off real vertices: the lowest thing that settles,
  // against the lowest thing there is. `Math.max(0, ...)` because a vehicle
  // whose lowest point IS a body part has no gap at all rather than a
  // negative one -- true of `heli_peten` and `jeep_shoded`, which have no
  // `rubber` role reaching lower than their hulls.
  let bodyMin = Infinity;
  let anyMin = Infinity;
  for (const part of parts) {
    const y = lowestY(part.node, null);
    anyMin = Math.min(anyMin, y);
    if (part.drops) bodyMin = Math.min(bodyMin, y);
  }

  return {
    height: b.max[1] - b.min[1],
    length: Math.max(x, z),
    groundY: b.min[1],
    centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    longAxis: x >= z ? 0 : 2,
    clearance: Number.isFinite(bodyMin) && Number.isFinite(anyMin) ? Math.max(0, bodyMin - anyMin) : 0,
  };
}

/** A displacement of `d` along the hull's long axis. */
const alongLongAxis = (m: HullMetrics, d: number): mat4 =>
  m.longAxis === 0 ? translation(d, 0, 0) : translation(0, 0, d);

/**
 * A displacement of `d` ACROSS the hull, at right angles to the axis it runs
 * along. Where a thrown turret goes, and the reason is the camera rather than
 * ballistics: thrown along the hull, a turret lands beyond the nose and its
 * silhouette stays inside the vehicle's own -- photographed at zoom 2.2 the
 * Lavi read as an intact tank with the barrel sticking out. Thrown across, it
 * lands clear of the flank and reads as a separate object lying in the sand,
 * which is the whole point of throwing it.
 */
const acrossLongAxis = (m: HullMetrics, d: number): mat4 =>
  m.longAxis === 0 ? translation(0, 0, d) : translation(d, 0, 0);

/**
 * A ROLL: rotation about the vehicle's own longitudinal axis, the one it runs
 * along. Tipping it over is what a roll means, so the extent that collapses is
 * the width and the length is untouched.
 */
const roll = (m: HullMetrics, t: number): mat4 => (m.longAxis === 0 ? rotationX(t) : rotationZ(t));

/**
 * A PITCH: rotation about the vehicle's own transverse axis. Nose up or nose
 * down, so the extent that collapses is the length.
 *
 * **These two exist because the axes are not fixed.** Eight of the eleven
 * shipped vehicles run along X and three do not, and the same numeral means
 * opposite things to the two groups -- a roll hardcoded about world Z tips a
 * Z-long vehicle over and stands an X-long one on its nose. That was the
 * defect: `heli_peten`'s fuselage runs along X, so `BODY_ROLL_DEG` 25 was
 * pitching it instead of laying it on its side, and on every X-long ground
 * vehicle `HULL_PITCH_DEG` and `HULL_ROLL_DEG` were swapped. Every rotation in
 * this file reads its axis from `m.longAxis`; yaw is the one exception, and
 * only because up is always +Y.
 */
const pitch = (m: HullMetrics, t: number): mat4 => (m.longAxis === 0 ? rotationZ(t) : rotationX(t));

// ---------------------------------------------------------------------------
// The recipe, as matrices
// ---------------------------------------------------------------------------

/**
 * The body: settle into the suspension gap under it (unless this part is a
 * wheel or a track), then pitch and roll about the centre of the vehicle's own
 * bounds. An `air` hull rolls by `BODY_ROLL_DEG` instead, so the fuselage
 * leans over rather than merely settling.
 *
 * No ground seat here: every group is seated once, together, in
 * `applyWreckPass` -- see `seatOnGround`.
 */
function hullDisplacement(m: HullMetrics, kind: HullKind, drops: boolean): mat4 {
  const dy = drops ? -WRECK_FRACTIONS.HULL_DROP * m.clearance : 0;
  const rollDeg = kind === 'air' ? WRECK_FRACTIONS.BODY_ROLL_DEG : WRECK_FRACTIONS.HULL_ROLL_DEG;
  const tilt = aboutPoint(
    m.centre,
    multiply(roll(m, rad(rollDeg)), pitch(m, rad(WRECK_FRACTIONS.HULL_PITCH_DEG)))
  );
  return multiply(tilt, translation(0, dy, 0));
}

/**
 * The turret goes with the body, is rolled and yawed about its own pivot, and
 * is then thrown a quarter of the vehicle's length along its long axis. The
 * pivot point used is the one the BODY displacement has already moved -- the
 * turret comes off a hull that has settled, not off the hull's parade pose.
 */
function turretDisplacement(m: HullMetrics, kind: HullKind, pivotWorld: vec3, drops: boolean): mat4 {
  const body = hullDisplacement(m, kind, drops);
  const thrown = aboutPoint(
    transformPoint(body, pivotWorld),
    // Yaw is about world Y on any vehicle -- up does not depend on which way
    // the hull points. The roll does, so it goes through `roll`.
    multiply(rotationY(rad(WRECK_FRACTIONS.TURRET_YAW_DEG)), roll(m, rad(WRECK_FRACTIONS.TURRET_ROLL_DEG)))
  );
  return multiply(acrossLongAxis(m, WRECK_FRACTIONS.TURRET_SHIFT * m.length), multiply(thrown, body));
}

/** The blades bend about the rotor pivot, on a fuselage already on its side. */
function rotorDisplacement(m: HullMetrics, pivotWorld: vec3, drops: boolean): mat4 {
  const body = hullDisplacement(m, 'air', drops);
  return multiply(
    aboutPoint(transformPoint(body, pivotWorld), pitch(m, rad(WRECK_FRACTIONS.ROTOR_BEND_DEG))),
    body
  );
}

/**
 * The wing tips onto its edge about the hull's long axis and lies a little way
 * from the motor. Rolled about the canopy's OWN bounds centre, because a
 * paraglider wing is nothing like the shape of the frame it is attached to and
 * turning it about the vehicle's centre would swing it into orbit.
 *
 * It comes down to the ground plane through the shared seat rather than here;
 * the AABB-corner estimate this used to take was an over-estimate of the true
 * rotated extent, and at 80 degrees it was the worst case in the file.
 */
function canopyDisplacement(m: HullMetrics, canopyBounds: bbox): mat4 {
  const centre: vec3 = [
    (canopyBounds.min[0] + canopyBounds.max[0]) / 2,
    (canopyBounds.min[1] + canopyBounds.max[1]) / 2,
    (canopyBounds.min[2] + canopyBounds.max[2]) / 2,
  ];
  const rolled = aboutPoint(centre, roll(m, rad(WRECK_FRACTIONS.CANOPY_ROLL_DEG)));
  return multiply(alongLongAxis(m, WRECK_FRACTIONS.CANOPY_SHIFT * m.length), rolled);
}

/**
 * Every wreck rests ON the ground plane, and this is what puts it there.
 *
 * A group of parts is measured at its lowest real vertex and translated in Y
 * so that vertex sits exactly on `groundY`. Three groups, seated
 * independently: the BODY (hull, wheels, tracks, and a rotor, which is bolted
 * to the airframe), the thrown TURRET, and the collapsed CANOPY.
 *
 * Two things about it are worth knowing.
 *
 * **It is a correction for the TILT, not for the settle.** The settle is
 * already bounded by the clearance and cannot reach the ground on its own;
 * what buries a wreck is rolling a 3-metre-wide hull about its own centre,
 * which drops the low corner by half the width times the sine. Before this,
 * all eleven wrecks stood 0.20-0.69 world units below the ground.
 *
 * **The lift commutes out of every displacement in this file, which is why it
 * can be measured once and applied afterwards.** A rotation about a point that
 * has itself been translated by `T` satisfies `A(T·p, R) = T·A(p, R)·T⁻¹`, so
 * `A(T·p, R)·(T·body) = T·(A(p, R)·body)`: seating the body first and then
 * throwing the turret off it gives exactly the same turret pose as throwing it
 * first and seating afterwards. The horizontal throw translations commute with
 * a vertical one for the same reason. So there is no ordering to get wrong,
 * and the turret still comes off a hull that has settled.
 */
function seatOnGround(m: HullMetrics, parts: readonly Part[]): number {
  let min = Infinity;
  for (const part of parts) min = Math.min(min, lowestY(part.node, part.base));
  return Number.isFinite(min) ? m.groundY - min : 0;
}

// ---------------------------------------------------------------------------
// Stripping, for idempotence
// ---------------------------------------------------------------------------

function disposeSubtree(node: Node): void {
  const doomed: Node[] = [];
  node.traverse((n) => doomed.push(n));
  // Deepest first: a parent disposed before its children leaves the children
  // orphaned on the Root, where the writer still emits them.
  for (const n of doomed.reverse()) n.dispose();
}

/** Dispose an accessor iff nothing but the Root still references it. */
function disposeIfOrphan(accessor: Accessor): void {
  const held = accessor.listParents().filter((p) => p.propertyType !== 'Root');
  if (held.length === 0) accessor.dispose();
}

/**
 * Remove everything a previous run of this pass added, so the next run rebuilds
 * it identically.
 *
 * **Clips are matched BY NAME**, so this removes any animation called `idle` or
 * `wreck` whoever authored it. Today that is safe: the only `idle`/`wreck` any
 * shipped vehicle carries is this pass's own -- all eleven declared ZERO
 * animations before it first ran (censused 2026-09-15) and the exporters have
 * not authored one since. A future re-export that ships a REAL `idle`, an
 * idling engine shake say, would have it silently eaten here. Deferred rather than solved: the fix is to mark this pass's own
 * clips (an `extras` flag on the animation) and strip only those, and it costs
 * nothing to do when the first authored clip appears.
 */
function stripWreck(doc: Document): void {
  for (const node of doc.getRoot().listNodes()) {
    if (node.getName() === DEATH_ROOT) disposeSubtree(node);
  }
  for (const animation of doc.getRoot().listAnimations()) {
    if (animation.getName() !== CLIP_IDLE && animation.getName() !== CLIP_WRECK) continue;
    const accessors: Accessor[] = [];
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) {
      for (const a of [sampler.getInput(), sampler.getOutput()]) if (a) accessors.push(a);
      sampler.dispose();
    }
    animation.dispose();
    for (const a of accessors) disposeIfOrphan(a);
  }
}

// ---------------------------------------------------------------------------
// The clips
// ---------------------------------------------------------------------------

function addClips(doc: Document, liveTop: readonly Node[], deathRoot: Node): void {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const times = doc
    .createAccessor('wreck_clip_time', buffer)
    .setType('SCALAR')
    .setArray(new Float32Array([0, CLIP_SECONDS]));
  const shown = doc
    .createAccessor('wreck_clip_shown', buffer)
    .setType('VEC3')
    .setArray(new Float32Array([1, 1, 1, 1, 1, 1]));
  const hidden = doc
    .createAccessor('wreck_clip_hidden', buffer)
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 0, 0, 0]));

  const clips = [
    { name: CLIP_IDLE, live: shown, dead: hidden },
    { name: CLIP_WRECK, live: hidden, dead: shown },
  ] as const;

  for (const clip of clips) {
    const animation = doc.createAnimation(clip.name);
    // One sampler per output, shared by every channel that wants it: glTF
    // allows it and it keeps the clips to three accessors between them.
    const liveSampler = doc
      .createAnimationSampler()
      .setInterpolation('STEP')
      .setInput(times)
      .setOutput(clip.live);
    const deadSampler = doc
      .createAnimationSampler()
      .setInterpolation('STEP')
      .setInput(times)
      .setOutput(clip.dead);
    animation.addSampler(liveSampler).addSampler(deadSampler);

    for (const node of liveTop) {
      animation.addChannel(
        doc.createAnimationChannel().setTargetPath('scale').setTargetNode(node).setSampler(liveSampler)
      );
    }
    animation.addChannel(
      doc.createAnimationChannel().setTargetPath('scale').setTargetNode(deathRoot).setSampler(deadSampler)
    );
  }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

function requireNode(liveTop: readonly Node[], name: string, vehicleId: string): Node {
  let found: Node | undefined;
  for (const top of liveTop) {
    top.traverse((n) => {
      if (!found && n.getName() === name) found = n;
    });
  }
  if (!found) throw new Error(`${vehicleId}: the recipe names "${name}" but the document has no such node`);
  return found;
}

/** True if `name` is `node`'s own name or any ancestor's, up to the scene. */
function underNode(node: Node, name: string): boolean {
  let walk: Node | null = node;
  while (walk) {
    if (walk.getName() === name) return true;
    walk = walk.getParentNode();
  }
  return false;
}

const roleOf = (node: Node): string => {
  const role = node.getExtras().rl_role;
  return typeof role === 'string' ? role : '';
};

/**
 * Give `doc` a `death_root` of shared meshes and the two constant-scale clips.
 * Idempotent: any existing death root and any existing `idle`/`wreck` clip are
 * stripped first, so the second run is a no-op on the bytes.
 */
export function applyWreckPass(doc: Document, vehicleId: string, recipe: WreckRecipe): void {
  const scene: Scene | undefined = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${vehicleId}: no scene`);

  stripWreck(doc);

  const liveTop = scene.listChildren();
  if (liveTop.length === 0) throw new Error(`${vehicleId}: the scene has no children`);

  // Fail on a recipe that names a node the export does not have, rather than
  // silently treating its parts as hull. A re-export that renames a pivot is
  // exactly the case this catches, and the symptom otherwise is a turret that
  // quietly stops being thrown.
  const turretPivot = recipe.turretPivot ? requireNode(liveTop, recipe.turretPivot, vehicleId) : null;
  const rotorPivot = recipe.rotorPivot ? requireNode(liveTop, recipe.rotorPivot, vehicleId) : null;
  const canopy = recipe.canopy ? requireNode(liveTop, recipe.canopy, vehicleId) : null;

  // Classify first, displace second. A part is classified by its ANCESTORS
  // (see the file header), and a node with no mesh is a pivot or a tilt empty
  // whose transform reaches the wreck through its children's world matrices.
  const parts: Part[] = [];
  for (const top of liveTop) {
    top.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const seat: SeatGroup =
        canopy && node === canopy
          ? 'canopy'
          : recipe.turretPivot && turretPivot && underNode(node, recipe.turretPivot)
            ? 'turret'
            : 'body';
      parts.push({ node, mesh, seat, drops: DROP_ROLES.has(roleOf(node)), base: IDENTITY });
    });
  }

  const metrics = measure(liveTop, parts, vehicleId);

  for (const part of parts) {
    if (part.seat === 'canopy') {
      part.base = canopyDisplacement(metrics, getBounds(part.node));
    } else if (part.seat === 'turret' && turretPivot) {
      part.base = turretDisplacement(metrics, recipe.hull, turretPivot.getWorldTranslation(), part.drops);
    } else if (rotorPivot && recipe.rotorPivot && underNode(part.node, recipe.rotorPivot)) {
      part.base = rotorDisplacement(metrics, rotorPivot.getWorldTranslation(), part.drops);
    } else {
      part.base = hullDisplacement(metrics, recipe.hull, part.drops);
    }
  }

  // One seat per group, measured off real vertices and applied last.
  for (const seat of ['body', 'turret', 'canopy'] as const) {
    const group = parts.filter((p) => p.seat === seat);
    if (group.length === 0) continue;
    const lift = translation(0, seatOnGround(metrics, group), 0);
    for (const part of group) part.base = multiply(lift, part.base);
  }

  const deathRoot = doc.createNode(DEATH_ROOT);
  scene.addChild(deathRoot);

  // `D x W`: the node's own world matrix first, then the world-space
  // displacement. The death root is at the identity, so a child's local matrix
  // IS its world matrix and the pivot is baked in for free.
  //
  // Parented after the walk above, not during it: a node added to `death_root`
  // while its own subtree was still being traversed would be visited again.
  for (const part of parts) {
    deathRoot.addChild(
      doc
        .createNode(`${WRECK_PREFIX}${part.node.getName()}`)
        .setMesh(part.mesh)
        .setExtras({ ...part.node.getExtras(), rl_wreck: true })
        .setMatrix(multiply(part.base, part.node.getWorldMatrix()))
    );
  }

  addClips(doc, liveTop, deathRoot);
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

const KNOWN = (): string => Object.keys(WRECK_RECIPES).join(', ');

const ID_FLAG = '--id=';

/**
 * argv -> the vehicles to process. Empty means all eleven.
 *
 * **Every argument must be recognised, and that is the whole point of this
 * function existing.** The first version kept the `--id=` entries and threw
 * the rest away, so `--id mbt_lavi`, `--ids=mbt_lavi` or any typo silently fell
 * through to "all eleven" and rewrote 25 MB of tracked art the caller never
 * asked about. A destructive default reached by a typo is worse than an error.
 *
 * A bare `--` is tolerated because pnpm forwards its own separator verbatim:
 * `pnpm wreck:meshes -- --id=x` reaches this as `['--', '--id=x']`.
 */
export function parseWreckArgs(argv: readonly string[]): readonly string[] | 'all' {
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (!arg.startsWith(ID_FLAG) || arg.length === ID_FLAG.length) {
      throw new Error(
        `unrecognised argument "${arg}" -- usage: wreck:meshes [--id=<vehicle>]... ` +
          `-- known vehicles: ${KNOWN()}`
      );
    }
    ids.push(arg.slice(ID_FLAG.length));
  }
  return ids.length ? ids : 'all';
}

/** Apply the pass to the named vehicles (or all eleven) and write them back. */
export async function runWreckPass(ids: readonly string[] | 'all'): Promise<void> {
  const wanted = ids === 'all' ? Object.keys(WRECK_RECIPES) : ids;
  for (const id of wanted) {
    if (!Object.prototype.hasOwnProperty.call(WRECK_RECIPES, id)) {
      throw new Error(`no wreck recipe for "${id}" -- known vehicles: ${KNOWN()}`);
    }
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of wanted) {
    const recipe = WRECK_RECIPES[id];
    const file = path.join(VEHICLES, `${id}.glb`);
    const before = readFileSync(file).length;
    const doc = await io.read(file);
    applyWreckPass(doc, id, recipe);
    await io.write(file, doc);
    const after = statSync(file).size;
    const deathRoot = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === DEATH_ROOT);
    const wrecks = deathRoot ? deathRoot.listChildren().length : 0;
    console.log(`WRECK_PASS_OK ${id} +${after - before} bytes, ${wrecks} wreck nodes`);
  }
}

async function main(): Promise<number> {
  await runWreckPass(parseWreckArgs(process.argv.slice(2)));
  return 0;
}

// Only when this file is the process entry point -- it is imported by its own
// tests, which must not write to `art/meshes/`.
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
