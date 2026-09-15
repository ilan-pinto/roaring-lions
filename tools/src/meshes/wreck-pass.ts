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

/** The measured facts a recipe's fractions are taken against. */
interface HullMetrics {
  readonly height: number;
  readonly length: number;
  readonly groundY: number;
  readonly centre: vec3;
  /** Index of the longer horizontal axis: 0 for X, 2 for Z. */
  readonly longAxis: 0 | 2;
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

function measure(liveTop: readonly Node[], vehicleId: string): HullMetrics {
  const b = unionBounds(liveTop);
  if (!finite(b)) throw new Error(`${vehicleId}: no mesh geometry to measure`);
  const x = b.max[0] - b.min[0];
  const z = b.max[2] - b.min[2];
  return {
    height: b.max[1] - b.min[1],
    length: Math.max(x, z),
    groundY: b.min[1],
    centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    longAxis: x >= z ? 0 : 2,
  };
}

/** A displacement of `d` along the hull's long axis. */
const alongLongAxis = (m: HullMetrics, d: number): mat4 =>
  m.longAxis === 0 ? translation(d, 0, 0) : translation(0, 0, d);

// ---------------------------------------------------------------------------
// The recipe, as matrices
// ---------------------------------------------------------------------------

/**
 * The body: settle by a fraction of the height (unless this part is a wheel or
 * a track), then pitch and roll about the centre of the vehicle's own bounds.
 * An `air` hull rolls by `BODY_ROLL_DEG` instead, so the fuselage lies over on
 * its side rather than merely leaning.
 */
function hullDisplacement(m: HullMetrics, kind: HullKind, drops: boolean): mat4 {
  const dy = drops ? -WRECK_FRACTIONS.HULL_DROP * m.height : 0;
  const roll = kind === 'air' ? WRECK_FRACTIONS.BODY_ROLL_DEG : WRECK_FRACTIONS.HULL_ROLL_DEG;
  const tilt = aboutPoint(
    m.centre,
    multiply(rotationZ(rad(roll)), rotationX(rad(WRECK_FRACTIONS.HULL_PITCH_DEG)))
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
    multiply(rotationY(rad(WRECK_FRACTIONS.TURRET_YAW_DEG)), rotationZ(rad(WRECK_FRACTIONS.TURRET_ROLL_DEG)))
  );
  return multiply(alongLongAxis(m, WRECK_FRACTIONS.TURRET_SHIFT * m.length), multiply(thrown, body));
}

/** The blades bend about the rotor pivot, on a fuselage already on its side. */
function rotorDisplacement(m: HullMetrics, pivotWorld: vec3, drops: boolean): mat4 {
  const body = hullDisplacement(m, 'air', drops);
  return multiply(
    aboutPoint(transformPoint(body, pivotWorld), rotationX(rad(WRECK_FRACTIONS.ROTOR_BEND_DEG))),
    body
  );
}

/**
 * The wing tips onto its edge about the hull's long axis, comes down to the
 * ground plane, and lies a little way from the motor. The ground placement is
 * read off the canopy's own rotated bounds rather than assumed, because a
 * paraglider wing is nothing like the shape of the frame it is attached to.
 *
 * Rotating the canopy's AXIS-ALIGNED box and taking the new minimum is an
 * over-estimate of the true rotated extent, so the wing can float a little; it
 * is deterministic and cheap, and Task 5 is where the number gets judged on
 * screen anyway.
 */
function canopyDisplacement(m: HullMetrics, canopyBounds: bbox): mat4 {
  const centre: vec3 = [
    (canopyBounds.min[0] + canopyBounds.max[0]) / 2,
    (canopyBounds.min[1] + canopyBounds.max[1]) / 2,
    (canopyBounds.min[2] + canopyBounds.max[2]) / 2,
  ];
  const angle = rad(WRECK_FRACTIONS.CANOPY_ROLL_DEG);
  const rolled = aboutPoint(centre, m.longAxis === 0 ? rotationX(angle) : rotationZ(angle));

  let minY = Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const p: vec3 = [
      corner & 1 ? canopyBounds.max[0] : canopyBounds.min[0],
      corner & 2 ? canopyBounds.max[1] : canopyBounds.min[1],
      corner & 4 ? canopyBounds.max[2] : canopyBounds.min[2],
    ];
    minY = Math.min(minY, transformPoint(rolled, p)[1]);
  }

  const shift = alongLongAxis(m, WRECK_FRACTIONS.CANOPY_SHIFT * m.length);
  return multiply(multiply(shift, translation(0, m.groundY - minY, 0)), rolled);
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

  const metrics = measure(liveTop, vehicleId);

  const deathRoot = doc.createNode(DEATH_ROOT);
  scene.addChild(deathRoot);

  const wrecks: Node[] = [];
  for (const top of liveTop) {
    top.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return; // a pivot or a tilt empty: its transform is in the child's world matrix

      const drops = DROP_ROLES.has(roleOf(node));
      let displacement: mat4;
      if (canopy && node === canopy) {
        displacement = canopyDisplacement(metrics, getBounds(node));
      } else if (turretPivot && recipe.turretPivot && underNode(node, recipe.turretPivot)) {
        displacement = turretDisplacement(metrics, recipe.hull, turretPivot.getWorldTranslation(), drops);
      } else if (rotorPivot && recipe.rotorPivot && underNode(node, recipe.rotorPivot)) {
        displacement = rotorDisplacement(metrics, rotorPivot.getWorldTranslation(), drops);
      } else {
        displacement = hullDisplacement(metrics, recipe.hull, drops);
      }

      // `D x W`: the node's own world matrix first, then the world-space
      // displacement. The death root is at the identity, so a child's local
      // matrix IS its world matrix and the pivot is baked in for free.
      wrecks.push(
        doc
          .createNode(`${WRECK_PREFIX}${node.getName()}`)
          .setMesh(mesh)
          .setExtras({ ...node.getExtras(), rl_wreck: true })
          .setMatrix(multiply(displacement, node.getWorldMatrix()))
      );
    });
  }

  // Parented after the walk, not during it: a node added to `death_root` while
  // its own subtree is still being traversed would be visited again.
  for (const wreck of wrecks) deathRoot.addChild(wreck);

  addClips(doc, liveTop, deathRoot);
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

/** Apply the pass to the named vehicles (or all eleven) and write them back. */
export async function runWreckPass(ids: readonly string[] | 'all'): Promise<void> {
  const wanted = ids === 'all' ? Object.keys(WRECK_RECIPES) : ids;
  for (const id of wanted) {
    if (!Object.prototype.hasOwnProperty.call(WRECK_RECIPES, id)) {
      throw new Error(
        `no wreck recipe for "${id}" -- known vehicles: ${Object.keys(WRECK_RECIPES).join(', ')}`
      );
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
  const flagged = process.argv.slice(2).filter((a) => a.startsWith('--id='));
  const ids = flagged.length ? flagged.map((a) => a.slice('--id='.length)) : 'all';
  await runWreckPass(ids);
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
