/**
 * GH-943 WebGPU P2 (T3): the NODE twin of the ground (`mesh.ts`'s `GroundMaterial`). The dry blend as a TSL `colorNode` on a
 * `MeshStandardNodeMaterial`, built by the node backend's `materials.ground` factory and swapped onto every ground chunk by
 * `ThreeRenderer.adoptNodeMaterials`.
 *
 * What it mirrors, in the order of the legacy material's `GROUND_BLEND_GLSL`:
 *   1. `wallAlbedo` and `groundUv` as attributes, the world xz from `positionWorld`;
 *   2. five UNCONDITIONAL slot taps, each a ratio to its image's mean, mixed from 1 by its strength;
 *   3. control A and B at `worldXZ / uMapSize`; `rlTop = step(wallAlbedo, -0.5)`; a wall takes its rock weight;
 *   4. the height bias and the rescale (`ground-maths.ts`'s `heightBiased`, `rescaleWeights`);
 *   5. the road, BRANCH-FREE: the legacy material skips the block where control B's road distance saturates, and every band is
 *      exactly 0 there, so computing it everywhere is pixel-identical. Its grain tap is the explicit-gradient form, with the two
 *      derivatives of the grain uv taken before it (WGSL rejects an implicit-gradient sample in non-uniform control flow, and the
 *      gate in `mesh.node.test.ts` pins the form, not the absence of a branch);
 *   6. the road, shoulder and rut tones mixed into the vertex colour, then `albedo x macro`.
 *
 * **Not drawn here, and said so** (`userData.rlUnportedTerms`, the census's `partial` kind): the relief read (slope light, height
 * contours, tint: T4) and, on a wet owner, the wet terms (P4, ruled 7 Nov). A wet owner gets the DRY graph, byte for byte: the graph
 * never reads `owner.wet` or its define; only the list of unported terms does.
 *
 * **The uniforms stay a record.** The twin reads the legacy object's `uniforms` table every render (`onRenderUpdate`): numbers and
 * vectors are re-bound from `rec.value` (a slot's mean is REPLACED when its image lands, not mutated), and the eight textures are
 * re-bound too, because `ThreeRenderer` replaces `uniforms[slot].value` when an image lands and the control textures on every
 * rebuild. A texture node has no render update of its own that survives its setup, so each texture rides on the uniform it is read
 * with: a slot's image on that slot's strength, the controls and the macro field on `uMapSize` (every one of them is indexed by it).
 * The legacy object keeps the debug setters (`setRoadsVisible`, `setAlbedoVisible`, `setMacroVisible`), so no toggle code changes.
 *
 * `vertexColors` is FALSE: the graph reads `vertexColor()` itself, and three r186's `setupDiffuseColor` would multiply `colorNode`
 * by the vertex colour a second time. Roughness 1, metalness 0, DoubleSide and no envMap, as the legacy material.
 *
 * ADDON-FREE: `three/webgpu` and `three/tsl` arrive injected, the shared maths as VALUES (`MATERIAL_MATHS.ground`); every import
 * below is a type, except `three` itself and `tslOps` from the node fog twin, which lives in the same node-backend chunk.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { GroundMaterial, GroundSlot, slotUniforms } from './mesh';
import type { ROAD_DISTANCE_RANGE_TILES } from './control-map';
import type { heightBiased, macroDecode, macroFactor, rescaleWeights, roadBands } from './ground-maths';
import { tslOps, type N, type Tsl } from '../fog-pass.node';

/** The name every ground twin carries (`NODE_MATERIAL_MARKER`'s prefix, `tools/src/perf/bundle-census.ts`). */
export const NODE_GROUND_MATERIAL_NAME = 'rl-node-material-ground';
/** What the twin does not draw, as the census names it (`UNPORTED_TERMS_KEY`). */
export const GROUND_RELIEF_TERM = 'rl-ground: relief read';
export const GROUND_WET_TERM = 'rl-ground: wet terms';

/**
 * The ground maths the twin is handed as VALUES (`material-maths.ts`'s `MATERIAL_MATHS.ground`). `mesh.ts`, `control-map.ts` and
 * `ground-maths.ts` are also imported by the legacy material, so the bundler keeps them in the ThreeRenderer chunk, and a value import
 * here would make the node-backend chunk load that chunk statically: the bundle census fails on exactly that.
 */
export interface GroundMaths {
  readonly slots: readonly GroundSlot[];
  readonly slotUniforms: typeof slotUniforms;
  readonly roadDistanceRangeTiles: typeof ROAD_DISTANCE_RANGE_TILES;
  readonly roadBands: typeof roadBands;
  readonly heightBiased: typeof heightBiased;
  readonly rescaleWeights: typeof rescaleWeights;
  readonly macroDecode: typeof macroDecode;
  readonly macroFactor: typeof macroFactor;
}

export interface NodeGroundDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  readonly maths: GroundMaths;
}

/** The node slice this file reads beyond the fog twin's `N`. */
interface GN extends N {
  readonly r: GN;
  readonly a: GN;
  readonly g: GN;
  readonly b: GN;
  readonly xz: GN;
  grad(dx: N, dy: N): GN;
}
interface GroundTsl extends Omit<Tsl, 'texture'> {
  texture(value: unknown, uv: N): GN;
  attribute(name: string, type: string): GN;
  vertexColor(): GN;
  readonly positionWorld: GN;
  dFdx(a: N): GN;
  dFdy(a: N): GN;
}

/** The legacy uniform record, as the twin reads it. */
type Rec = Record<string, { value: unknown }>;

/** The twin and the nodes it re-binds every render, by legacy uniform name (the record gate reads both). */
export interface NodeGround {
  readonly material: THREE.Material;
  /** Every number and vector uniform, re-bound from the record each render. */
  readonly numbers: Readonly<Record<string, N>>;
  /** Every texture tap, by legacy uniform name, re-bound from the record each render (on the uniform it rides with). */
  readonly textures: Readonly<Record<string, readonly N[]>>;
}

/** Rec. 709 luminance, the weights `neutralTint` and the legacy blend use. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function buildNodeGround(deps: NodeGroundDeps, owner: GroundMaterial): NodeGround {
  const { W, maths } = deps;
  const TSL = deps.TSL as unknown as GroundTsl;
  const o = tslOps(deps.TSL as unknown as Tsl);
  const lit = o.lit;
  const rec = owner.uniforms as unknown as Rec;
  const read = (name: string): { value: unknown } => {
    const r = rec[name];
    if (r === undefined) throw new Error(`node ground: the legacy record has no uniform "${name}"`);
    return r;
  };

  const numbers: Record<string, N> = {};
  const textures: Record<string, N[]> = {};
  const carried = new Map<string, Array<() => void>>();
  /** A number or vector uniform over `rec[name]`, re-bound every render (with the textures it carries). */
  const uni = (name: string): N => {
    const hit = numbers[name];
    if (hit !== undefined) return hit;
    const r = read(name);
    const n = TSL.uniform(r.value);
    numbers[name] = n;
    n.onRenderUpdate(() => {
      n.value = r.value;
      for (const sync of carried.get(name) ?? []) sync();
    });
    return n;
  };
  /**
   * One tap of the texture `rec[name]` at `uv`, re-bound by `carrier`'s render update. Built as `texture(value, uv)`, so the tap
   * applies no `texture.matrix` (the legacy GLSL samples the raw uv); three's own per-backend flip is unchanged.
   */
  const tap = (name: string, carrier: string, uv: N): GN => {
    const r = read(name);
    uni(carrier);
    const t = TSL.texture(r.value, uv) as GN;
    (textures[name] ??= []).push(t);
    const list = carried.get(carrier) ?? [];
    list.push(() => {
      t.value = r.value;
    });
    carried.set(carrier, list);
    return t;
  };

  // The record, bound up front (the graph below only reads these nodes).
  const slots = maths.slots.map((slot) => {
    const u = maths.slotUniforms(slot);
    return { slot, map: u.map, carrier: u.strength, strength: uni(u.strength), mean: uni(u.mean), tiles: uni(u.tiles) };
  });
  const knoll = slots.find((s) => s.slot === 'knoll');
  if (knoll === undefined || slots.length !== 5) throw new Error(`node ground: expected the five slots with a knoll, got ${maths.slots.join(', ')}`);
  const mapSize = uni('uMapSize');
  const roadOn = uni('uRoadOn');
  const grainTiles = uni('uRoadGrainTiles');
  const grainGain = uni('uRoadGrainGain');
  const roadTone = uni('uRoadTone');
  const shoulderTone = uni('uShoulderTone');
  const rutTone = uni('uRutTone');
  const macroAmp = uni('uMacroAmp');
  const macroBright = uni('uMacroBright');
  const macroDark = uni('uMacroDark');

  const colour = TSL.Fn(() => {
    // 1. Attributes and the world position. The road grain's derivatives FIRST, as statements (an `assign` is emitted where it is
    //    called; a bare expression is emitted where it is first read), so they run in uniform control flow before any tap or select.
    const worldXZ = TSL.positionWorld.xz;
    const grainUv = TSL.vec2(0, 0).toVar();
    grainUv.assign(worldXZ.div(grainTiles));
    const grainDx = TSL.vec2(0, 0).toVar();
    grainDx.assign(TSL.dFdx(grainUv));
    const grainDy = TSL.vec2(0, 0).toVar();
    grainDy.assign(TSL.dFdy(grainUv));
    const wall = TSL.attribute('wallAlbedo', 'float');
    const groundUv = TSL.attribute('groundUv', 'vec2');
    const vertexTone = TSL.vertexColor().rgb;
    const ones = TSL.vec3(1, 1, 1);
    const luma = TSL.vec3(LUMA[0], LUMA[1], LUMA[2]);

    // 2. The five slots: a ratio to the image's mean, mixed from 1 by the strength. Unconditional.
    const factors = slots.map((s) => TSL.mix(ones, tap(s.map, s.carrier, groundUv.div(s.tiles)).rgb.div(s.mean), s.strength));

    // 3. The control map, at the fragment's own map position. A wall ignores it and takes its rock weight.
    const ctlUv = worldXZ.div(mapSize);
    const ctlA = tap('uControlA', 'uMapSize', ctlUv);
    const ctlB = tap('uControlB', 'uMapSize', ctlUv);
    const top = o.step(wall, lit(-0.5));
    const w: N[] = [
      top.mul(ctlA.r),
      top.mul(ctlA.g).add(lit(1).sub(top).mul(TSL.max(wall, lit(0)))),
      top.mul(ctlA.b),
      top.mul(ctlA.a),
      top.mul(ctlB.r),
    ];

    // 4. Height bias (each weight by its own strength-scaled texel's luminance deviation), then the rescale.
    const biased = w.map((wi, i) => maths.heightBiased(o, wi, TSL.dot(factors[i] as N, luma).sub(1)));
    const weights = maths.rescaleWeights(o, w, biased);

    // 5. The road, branch-free; its grain tap is explicit-gradient.
    const range = lit(maths.roadDistanceRangeTiles);
    const bands = maths.roadBands(o, ctlB.g.mul(range), ctlB.a.mul(2).sub(1), ctlB.b.mul(range));
    const gate = roadOn.mul(0).add(1).mul(top);
    const surf = gate.mul(bands.surface);
    const shoulder = gate.mul(bands.shoulder);
    const grain = tap(knoll.map, knoll.carrier, grainUv).grad(grainDx, grainDy).rgb.div(knoll.mean);
    const rut = bands.rut.mul(gate).mul(TSL.smoothstep(lit(0.85), lit(1.05), TSL.dot(grain, luma)));
    const grainTerm = surf.mul(TSL.mix(ones, grain, grainGain).sub(ones));
    const offRoad = lit(1).sub(surf);

    // 6. The tones into the vertex colour, then albedo x macro.
    let tone = TSL.mix(vertexTone, roadTone, surf);
    tone = TSL.mix(tone, shoulderTone, shoulder);
    tone = TSL.mix(tone, rutTone, rut);
    let albedo: N = ones;
    for (let i = 0; i < weights.length; i++) albedo = albedo.add((weights[i] as N).mul(offRoad).mul((factors[i] as N).sub(ones)));
    albedo = albedo.add(grainTerm);
    const m = maths.macroDecode(o, tap('uMacro', 'uMapSize', ctlUv).r);
    const macro = maths.macroFactor(o, m, macroAmp, macroBright, macroDark);
    return TSL.vec4(tone.mul(albedo).mul(macro), 1);
  })();

  const mat = new W.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  mat.vertexColors = false;
  mat.name = NODE_GROUND_MATERIAL_NAME;
  mat.colorNode = colour as never;
  mat.userData.rlUnportedTerms = owner.wet ? [GROUND_RELIEF_TERM, GROUND_WET_TERM] : [GROUND_RELIEF_TERM];
  return { material: mat as unknown as THREE.Material, numbers, textures };
}

/** The `materials.ground` factory body: the twin of `owner`. */
export function createNodeGroundMaterial(deps: NodeGroundDeps, owner: GroundMaterial): THREE.Material {
  return buildNodeGround(deps, owner).material;
}
