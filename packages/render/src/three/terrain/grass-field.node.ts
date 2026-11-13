/**
 * GH-1167 S4: the 3D grass field's NODE material, and the one way a grass mesh is made. Node-native: there is no legacy twin (the
 * legacy path keeps today's grass, lead ruling 9 Nov), so this file is in `PORTED_FILES` with no `TWINS` row. Design:
 * docs/superpowers/specs/2026-11-11-wadi-halam-3d-grass-design.md, sections 2.1, 3.3 and 3.4.
 *
 * GH-1167 S5: built into `ThreeRenderer` through the node backend alone (`createGrassFieldKit`, `RenderBackend.grassField`): the only
 * value import of this file is `backend/node-backend.ts`, so it lives in the node-backend chunk, behind that chunk's dynamic import,
 * and the bundle pin P1 (`GRASS_FIELD_MARKER`, `tools/src/perf/bundle-census.ts`) requires it there and nowhere else. The cells,
 * matrices, LOD bands and splice are headless data from `grass-field-cells.ts`, computed on the app side and handed over.
 *
 * The material is a `MeshStandardNodeMaterial` (roughness 0.85, metalness 0, LINEAR vertex colours from `grass-blade.ts`, no
 * environment map: the ground's class) whose `positionNode` adds, in this order:
 *   1. the instance ORIGIN, read from the instance matrix by `instanceIndex` with the garrison banner's pattern
 *      (`buffer(instanceMatrix.array, 'mat4', count).element(instanceIndex)`, column 3: the same buffer three's own
 *      `instancedMesh(object)` builds under the uniform-buffer limit). three r186 applies the instance matrix BEFORE `positionNode`
 *      (`NodeMaterial.setupPosition`), so `positionLocal` is already instanced; both facts are pinned by the spec;
 *   2. the wind, `foliageLeanOps` (`wind.ts`) with the blade's own class (`rlNature.y`, `WIND_CLASS_GRASS`): the shipped grass class,
 *      unchanged, in WORLD space, brought back through `modelWorldMatrixInverse` as the foliage twin does;
 *   3. the disturbers (vehicle bend, rotor wash, infantry push): the foliage twin's own `disturbTerm` over the SAME nodes of the same
 *      `DisturbUniformSet` (`disturbNodes`, one set per record), with its early-outs and the preset's slot budget;
 *   4. the per-blade flutter (`grassFlutterOps`, new), along the blade's width axis in the clump frame, through the instance
 *      matrix's linear part, multiplied by `uWindMode` (off in reduced motion) and `uSwayAmp` (the `wind` debug layer);
 *   5. the width floor (`grassWidthFloorOps`): the blade never narrower than 1 device px, from the `zoom` and `dpr` the record holds
 *      (camera state, not time) and the width axis's on-screen length (`modelViewMatrix * mat3(instanceMatrix) * axis`, its `xy`),
 *      which carries the clump's turn, its scale and the dimetric squash.
 *
 * **The uniforms stay a record, bound BY REFERENCE** (`GrassFieldRecord`): `sway` is the very `SwayRecord` the foliage twin binds
 * (`time` = SIM seconds from `presentationSimMs`, `amp`, the wind set, the disturber set); `zoom` and `dpr` are the field's. Every
 * value is re-read each render (`onRenderUpdate`): no frame clock, no accumulated `dtMs`.
 *
 * **Depth and order (section 3.3).** Transparent at opacity 1, depth-tested, NO depth write, `GRASS_RENDER_ORDER` (-0.5): the rings,
 * the zone band, the route and the x-ray draw over it; the occlusion outline never fires on a unit standing in grass; the AO pre-pass
 * and the soft-particle snapshot never see it. The mesh casts no shadow, receives them, and carries `userData.rlAoExempt`.
 *
 * **Both faces, one normal.** A blade is a strip seen from either side (`DoubleSide`), and its normal is bent 70% toward the clump's
 * up-and-out so a clump shades round: `normalNode` is the geometry normal NOT negated on the back face, or every back-facing blade
 * would light as if lit from below.
 *
 * **The rest pose outside the colour pass**, as on the foliage twin: the shadow pass draws `castShadowPositionNode` (the grass casts
 * none; belt and braces), and an override pass three hands this `positionNode` to (the node AO pre-pass) gets the instanced rest
 * position.
 *
 * Imports the backend's own modules and TYPES of the legacy files: the maths arrives as values (`GrassFieldMaths`).
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { Material } from 'three';
import { tslIntOps, tslOps, type N, type Tsl } from '../fog-pass.node';
import { ENV_USERDATA_KEY } from '../environment-classes';
import { GRASS_RENDER_ORDER } from '../units/render-order';
import { disturbNodes, disturbTerm, type DisturbBindings, type FoliageMaths, type FoliageVertex } from './decor-mesh.node';
import type { SwayRecord } from './decor-mesh';
import type { GRASS_WIDTH_ATTRIBUTE, GrassGeometry, GrassLod } from './grass-blade';
import type { GrassCellMesh } from './grass-field-cells';
import type { grassFlutterOps, grassWidthFloorOps } from './grass-sway';

/** The marker of every grass scene object's `name` (`GRASS_FIELD_MARKER`, the bundle pin P1; the legacy-scene pin P3 looks for it). */
export const GRASS_FIELD_NAME = 'rl-grass-field';
/** The material's `name` (`NODE_MATERIAL_MARKER`): a node-native material, with no legacy twin and no unadopted entry. */
export const NODE_GRASS_FIELD_MATERIAL_NAME = 'rl-node-material-grass-field';
/** Design 2.1, Material. */
export const GRASS_FIELD_ROUGHNESS = 0.85;
export const GRASS_FIELD_METALNESS = 0;
/**
 * The most instances one grass mesh may hold: WebGL2's minimum uniform-buffer size (16 KiB) over a mat4 (64 B). Under it three's
 * instance matrix is the `buffer` node this material reads; over it three switches to an interleaved attribute this material does
 * not read. S5 splits a (cell, variant) that would exceed it.
 */
export const GRASS_INSTANCES_PER_MESH_MAX = 16384 / 64;

/** The field's shared maths, injected (S5: `MATERIAL_MATHS`), so the node chunk never value-imports a legacy file. */
export interface GrassFieldMaths {
  /** The foliage twin's: `foliageLeanOps`, `NATURE_ATTRIBUTE`, the disturbers' bodies, `DISTURB_MAX`. */
  readonly foliage: FoliageMaths;
  readonly flutterOps: typeof grassFlutterOps;
  readonly widthFloorOps: typeof grassWidthFloorOps;
  readonly widthAttribute: typeof GRASS_WIDTH_ATTRIBUTE;
  /** CSS px per world unit at zoom 1 (`SILHOUETTE_PX_PER_WORLD_UNIT`). */
  readonly pxPerUnit: number;
}

export interface NodeGrassFieldDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  readonly maths: GrassFieldMaths;
}

/** What the material binds, by reference. */
export interface GrassFieldRecord {
  /** The foliage record (`swayingFoliageMaterial(...).rlSway`): the sim clock, the debug amplitude, the wind and the disturbers. */
  readonly sway: SwayRecord;
  /** The camera's zoom and the device pixel ratio, written by the renderer each frame (the width floor). */
  readonly zoom: { value: number };
  readonly dpr: { value: number };
}

/** The record's values as the material holds them (re-read every render). Exposed for the record gates. */
export interface GrassFieldBindings {
  readonly uSwayTime: N;
  readonly uSwayAmp: N;
  readonly uWindMode: N;
  readonly uWindStrength: N;
  readonly uWindDir: N;
  readonly uGrassZoom: N;
  readonly uGrassDpr: N;
}

/** The slice of the node builder the position graph reads at build time. */
interface BuilderLike {
  readonly material: (Material & { isShadowPassMaterial?: boolean }) | null;
  readonly object: (THREE.Object3D & { instanceMatrix?: THREE.InstancedBufferAttribute }) | null;
  getUniformBufferLimit?(): number;
}

/** `N` plus the swizzles, element access and length this file uses. */
interface NE extends N {
  element(i: N | number): NE;
  toVar(): NE;
  length(): N;
  readonly xyz: NE;
  readonly xy: NE;
  readonly w: N;
}

/** The TSL members this file uses beyond `Tsl` (`fog-pass.node.ts`), as a structural handle, cast once. */
interface GrassTsl {
  Fn(body: (builder: BuilderLike) => N): () => N;
  attribute(name: string, type: string): NE;
  buffer(array: unknown, type: string, count: number): NE;
  float(a: N | number): N;
  vec3(...a: Array<N | number>): N;
  vec4(...a: Array<N | number>): N;
  mat3(m: N): N;
  uniform(v: unknown): N;
  readonly instanceIndex: N;
  readonly positionLocal: N;
  readonly modelWorldMatrix: N;
  readonly modelWorldMatrixInverse: N;
  readonly modelViewMatrix: N;
  readonly normalViewGeometry: N;
}

const BINDINGS = new WeakMap<Material, GrassFieldBindings>();
const DISTURB_BINDINGS = new WeakMap<Material, DisturbBindings>();

/** The uniform nodes a grass material reads (null for any other material). */
export function nodeGrassFieldBindings(material: Material): GrassFieldBindings | null {
  return BINDINGS.get(material) ?? null;
}

/** The disturbance's nodes a grass material reads: the very nodes a foliage twin of the same record reads. */
export function nodeGrassFieldDisturbBindings(material: Material): DisturbBindings | null {
  return DISTURB_BINDINGS.get(material) ?? null;
}

/** The grass field's material, bound to `rec`. One per field: every cell and variant shares it. */
export function createGrassFieldMaterial(deps: NodeGrassFieldDeps, rec: GrassFieldRecord): THREE.Material {
  const { W, maths } = deps;
  const T = deps.TSL as unknown as GrassTsl;
  const o = tslOps(deps.TSL as unknown as Tsl);
  const io = tslIntOps(deps.TSL as unknown as Tsl);
  const foliageDeps = { W, TSL: deps.TSL, maths: maths.foliage };

  const mat = new W.MeshStandardNodeMaterial();
  mat.name = NODE_GRASS_FIELD_MATERIAL_NAME;
  mat.vertexColors = true;
  mat.roughness = GRASS_FIELD_ROUGHNESS;
  mat.metalness = GRASS_FIELD_METALNESS;
  mat.side = W.DoubleSide;
  // Section 3.3: the transparent queue at opacity 1, depth-tested, writing no depth.
  mat.transparent = true;
  mat.opacity = 1;
  mat.depthTest = true;
  mat.depthWrite = false;
  // The ground's environment class: no envMap at all.
  mat.userData = { [ENV_USERDATA_KEY]: 'ground' };
  // The bent normal on both faces (see the header): the geometry normal, never negated on the back side.
  mat.normalNode = T.normalViewGeometry as never;

  // The record, by reference: each value re-read every render.
  const bind = (r: { readonly value: unknown }): N => {
    const n = T.uniform(r.value);
    n.onRenderUpdate(() => {
      n.value = r.value;
    });
    return n;
  };
  const sway = rec.sway;
  const bound: GrassFieldBindings = {
    uSwayTime: bind(sway.time),
    uSwayAmp: bind(sway.amp),
    uWindMode: bind(sway.wind.mode),
    uWindStrength: bind(sway.wind.strength),
    uWindDir: bind(sway.wind.dir),
    uGrassZoom: bind(rec.zoom),
    uGrassDpr: bind(rec.dpr),
  };
  BINDINGS.set(mat, bound);
  const disturb = disturbNodes(foliageDeps, sway.disturb, bind);
  DISTURB_BINDINGS.set(mat, disturb);
  const disturbers = disturbTerm(foliageDeps, disturb, Math.min(maths.foliage.disturbMax, Math.max(0, sway.disturb.slots)));

  const position = T.Fn((builder) => {
    const m = builder.material;
    // Not this material's own colour program, and not the shadow pass (which draws `castShadowPositionNode`): an override pass three
    // handed this `positionNode` to. The instanced rest pose.
    if (m !== mat && m?.isShadowPassMaterial !== true) return T.positionLocal;
    const matrices = builder.object?.instanceMatrix;
    if (matrices === undefined) throw new Error('createGrassFieldMaterial: the grass draws as an InstancedMesh with an instanceMatrix');
    const bytes = matrices.count * 16 * 4;
    const limit = builder.getUniformBufferLimit?.() ?? Infinity;
    if (bytes > limit) throw new Error(`createGrassFieldMaterial: ${matrices.count} clumps (${bytes} bytes) exceed the uniform buffer limit ${limit}`);
    // This clump's matrix, by `instanceIndex`: the buffer three's `instancedMesh(object)` has already applied to `positionLocal`.
    const im = T.buffer(matrices.array, 'mat4', matrices.count).element(T.instanceIndex).toVar();
    const originLocal = im.element(3).xyz;
    const nature = T.attribute(maths.foliage.natureAttribute, 'vec3').toVar();
    const width = T.attribute(maths.widthAttribute, 'vec4').toVar();
    const v: FoliageVertex = {
      TSL: deps.TSL,
      restWorld: (T.modelWorldMatrix.mul(T.vec4(T.positionLocal, 1)) as NE).xyz.toVar(),
      originWorld: (T.modelWorldMatrix.mul(T.vec4(originLocal, 1)) as NE).xyz.toVar(),
      nature,
      time: bound.uSwayTime,
    };
    // 2. The wind (world space): the shipped grass class, through the one body the number tests run.
    const lean = maths.foliage.foliageLeanOps(
      o,
      io,
      {
        cls: nature.y,
        hN: nature.x,
        worldH: v.restWorld.y.sub(v.originWorld.y),
        t: bound.uSwayTime,
        ox: v.originWorld.x,
        oz: v.originWorld.z,
        dirX: bound.uWindDir.x,
        dirZ: bound.uWindDir.y,
        strength: bound.uWindStrength,
        mode: bound.uWindMode,
        amp: bound.uSwayAmp,
      },
      sway.wet,
      false
    );
    // 3. The disturbers (world space), summed with the wind before the frame change, as the foliage twin does.
    const world = T.vec3(lean.dx, 0, lean.dz).add(disturbers(v));
    // 4 and 5. The clump-frame terms, along the blade's width axis.
    const flutter = maths.flutterOps(o, { t: bound.uSwayTime, phase: nature.z, hN: nature.x, mode: bound.uWindMode, amp: bound.uSwayAmp });
    // The width axis in the clump frame; its on-screen length (view units per local tile) sizes the floor: the clump's turn, its
    // scale and the dimetric squash, all in one projection.
    const axis = T.vec3(width.x, 0, width.y);
    const axisView = T.mat3(T.modelViewMatrix).mul(T.mat3(im).mul(axis)) as NE;
    const floor = maths.widthFloorOps(o, {
      signedHalf: width.z,
      baseHalf: width.w,
      viewLen: axisView.xy.length(),
      zoom: bound.uGrassZoom,
      dpr: bound.uGrassDpr,
      pxPerUnit: T.float(maths.pxPerUnit),
    });
    const local = axis.mul(flutter.add(floor));
    return T.positionLocal.add(T.mat3(im).mul(local)).add(T.mat3(T.modelWorldMatrixInverse).mul(world));
  });
  mat.positionNode = position() as never;
  // The grass casts no shadow (decision 6); if a caster is ever switched on, it casts from the rest pose (R-11).
  mat.castShadowPositionNode = T.positionLocal as never;
  return mat;
}

/** One clump variant at one LOD as a three geometry: position, normal, LINEAR colour, `rlNature` (vec3) and the width record (vec4). */
export function grassClumpGeometry(deps: Pick<NodeGrassFieldDeps, 'W' | 'maths'>, g: GrassGeometry): THREE.BufferGeometry {
  const { W, maths } = deps;
  const geo = new W.BufferGeometry();
  geo.setAttribute('position', new W.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new W.BufferAttribute(g.normals, 3));
  geo.setAttribute('color', new W.BufferAttribute(g.colors, 3));
  geo.setAttribute(maths.foliage.natureAttribute, new W.BufferAttribute(g.nature, 3));
  geo.setAttribute(maths.widthAttribute, new W.BufferAttribute(g.width, 4));
  geo.setIndex(new W.BufferAttribute(g.indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * One grass mesh (S5 makes one per cell and variant): named under `GRASS_FIELD_NAME`, in `GRASS_RENDER_ORDER`, casting no shadow,
 * receiving them, exempt from the AO pre-pass. `count` is capped at `GRASS_INSTANCES_PER_MESH_MAX`.
 */
export function createGrassFieldMesh(
  deps: Pick<NodeGrassFieldDeps, 'W'>,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  suffix: string
): THREE.InstancedMesh {
  if (!Number.isInteger(count) || count < 1 || count > GRASS_INSTANCES_PER_MESH_MAX) {
    throw new Error(`createGrassFieldMesh: ${count} clumps; a grass mesh holds 1 to ${GRASS_INSTANCES_PER_MESH_MAX}`);
  }
  const mesh = new deps.W.InstancedMesh(geometry, material, count);
  mesh.name = `${GRASS_FIELD_NAME}-${suffix}`;
  mesh.renderOrder = GRASS_RENDER_ORDER;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.rlAoExempt = true;
  return mesh;
}

/**
 * GH-1167 S5: how far past an instanced cell's rest bounds the grass may draw (tiles): the wind (0.015 tile at weight 1), the
 * flutter (0.004), the disturbers' bend (at most the 0.12-tile blade laid flat) and the width floor's push. Padded so three's
 * frustum test never drops a cell whose blades still reach the screen.
 */
export const GRASS_CELL_BOUNDS_PAD_TILES = 0.25;

/** What `GrassFieldKit.build` takes: the record, the nine clump geometries and every cell mesh, all headless data. */
export interface GrassFieldSpec {
  readonly record: GrassFieldRecord;
  /** `geometries[variant][lod]`: `buildGrassClump(variant, lod, tones.grassField)`. */
  readonly geometries: readonly (readonly GrassGeometry[])[];
  readonly meshes: readonly GrassCellMesh[];
  /** The LOD to draw first (`grassLodFor`). */
  readonly lod: GrassLod;
}

/** A built field. One material and nine geometries, shared by every cell mesh. */
export interface GrassFieldHandle {
  /** Named `GRASS_FIELD_NAME`; holds every cell mesh. The caller adds it to the scene. */
  readonly root: THREE.Group;
  readonly material: THREE.Material;
  lod(): GrassLod;
  /** Swaps every mesh's geometry to `lod`'s (same attribute layout, so the pipeline does not change; no matrix re-uploads). True when it changed. */
  setLod(lod: GrassLod): boolean;
  /** The collapse splice: every mesh of `cells` is removed and disposed, and `meshes` (all of them from those cells) are added. */
  replaceCells(cells: readonly number[], meshes: readonly GrassCellMesh[]): void;
  meshes(): readonly THREE.InstancedMesh[];
  /** Out of its parent, and every GPU object it made released. Idempotent. */
  dispose(): void;
}

/** The node backend's grass builder (`RenderBackend.grassField`). */
export interface GrassFieldKit {
  /** The most clumps one mesh may hold (`GRASS_INSTANCES_PER_MESH_MAX`): the app splits a (cell, variant) over it. */
  readonly maxInstancesPerMesh: number;
  build(spec: GrassFieldSpec): GrassFieldHandle;
}

/** GH-1167 S5: the grass field's builder, the only maker of grass scene objects. Lives in the node-backend chunk (pin P1). */
export function createGrassFieldKit(deps: NodeGrassFieldDeps): GrassFieldKit {
  const { W } = deps;
  return {
    maxInstancesPerMesh: GRASS_INSTANCES_PER_MESH_MAX,
    build(spec: GrassFieldSpec): GrassFieldHandle {
      if (spec.geometries.length !== 3 || spec.geometries.some((row) => row.length !== 3)) {
        throw new Error('GrassFieldKit.build: geometries must be [3 variants][3 LODs]');
      }
      const material = createGrassFieldMaterial(deps, spec.record);
      const geos = spec.geometries.map((row) => row.map((g) => grassClumpGeometry(deps, g)));
      const root = new W.Group();
      root.name = GRASS_FIELD_NAME;
      root.userData.rlAoExempt = true;
      root.matrixAutoUpdate = false;
      let current: GrassLod = spec.lod;
      const live: THREE.InstancedMesh[] = [];
      const make = (m: GrassCellMesh): THREE.InstancedMesh => {
        const row = geos[m.variant];
        if (row === undefined) throw new Error(`GrassFieldKit: variant ${m.variant}`);
        // Bounds from LOD0 (the superset of every LOD's blades), padded for the motion, then the drawn LOD's geometry.
        const mesh = createGrassFieldMesh(deps, row[0] as THREE.BufferGeometry, material, m.count, `c${m.cell}-v${m.variant}-p${m.part}`);
        (mesh.instanceMatrix.array as Float32Array).set(m.matrices);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        if (mesh.boundingSphere !== null) mesh.boundingSphere.radius += GRASS_CELL_BOUNDS_PAD_TILES;
        mesh.geometry = row[current] as THREE.BufferGeometry;
        mesh.userData.rlGrassCell = m.cell;
        mesh.userData.rlGrassVariant = m.variant;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        return mesh;
      };
      const add = (list: readonly GrassCellMesh[]): void => {
        for (const m of list) {
          const mesh = make(m);
          live.push(mesh);
          root.add(mesh);
        }
      };
      add(spec.meshes);
      root.updateMatrixWorld(true);
      let disposed = false;
      return {
        root,
        material,
        lod: () => current,
        setLod(lod: GrassLod): boolean {
          if (lod === current) return false;
          current = lod;
          for (const mesh of live) {
            const row = geos[mesh.userData.rlGrassVariant as number];
            if (row !== undefined) mesh.geometry = row[lod] as THREE.BufferGeometry;
          }
          return true;
        },
        replaceCells(cells: readonly number[], meshes: readonly GrassCellMesh[]): void {
          const set = new Set(cells);
          for (const m of meshes) if (!set.has(m.cell)) throw new Error(`GrassFieldKit.replaceCells: mesh of cell ${m.cell} outside the replaced cells`);
          for (let i = live.length - 1; i >= 0; i--) {
            const mesh = live[i] as THREE.InstancedMesh;
            if (!set.has(mesh.userData.rlGrassCell as number)) continue;
            root.remove(mesh);
            mesh.dispose();
            live.splice(i, 1);
          }
          add(meshes);
          root.updateMatrixWorld(true);
        },
        meshes: () => live,
        dispose(): void {
          if (disposed) return;
          disposed = true;
          root.removeFromParent();
          for (const mesh of live) mesh.dispose();
          live.length = 0;
          root.clear();
          for (const row of geos) for (const g of row) g.dispose();
          material.dispose();
        },
      };
    },
  };
}
