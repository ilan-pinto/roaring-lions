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
 * Steps 2-6 after the taps are ONE function, `ground-maths.ts`'s `groundBlend`, written against `Ops<T>`: this file samples and
 * wires, and `ground-maths.test.ts` evaluates the composition on numbers (`mesh.node.test.ts` pins the wiring).
 *
 * **Not drawn here, and said so** (`userData.rlUnportedTerms`, the census's `partial` kind): on a wet owner, the wet terms (P4, ruled 7 Nov). A wet owner gets the DRY graph, byte for byte: the graph
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
import type { GroundStage, groundBlend, heightBiased, macroDecode, macroFactor, rescaleWeights, roadBands } from './ground-maths';
import type { heightBlendStage } from './height-blend';
import type { HeightBlendRecord } from './height-blend-record';
import type {
  RELIEF_CONTOUR_STRENGTH,
  RELIEF_CONTOUR_WIDTH_PX,
  RELIEF_SLOPE_MAX_TILT_RAD,
  RELIEF_TINT_HIGH,
  RELIEF_TINT_LOW,
  contourFactorOps,
  reliefTiltOps,
  reliefTintRampOps,
} from './relief-read';
import { tslOps, type N, type Tsl } from '../fog-pass.node';

/** The name every ground twin carries (`NODE_MATERIAL_MARKER`'s prefix, `tools/src/perf/bundle-census.ts`). */
export const NODE_GROUND_MATERIAL_NAME = 'rl-node-material-ground';
/** What the twin does not draw, as the census names it (`UNPORTED_TERMS_KEY`). The relief read landed in T4: only the wet terms remain. */
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
  /** T4: the relief read's scalar parts (`relief-read.ts`) and the constants the GLSL is generated from. */
  readonly relief: {
    readonly tilt: typeof reliefTiltOps;
    readonly contour: typeof contourFactorOps;
    readonly tintRamp: typeof reliefTintRampOps;
    readonly maxTiltRad: typeof RELIEF_SLOPE_MAX_TILT_RAD;
    readonly contourStrength: typeof RELIEF_CONTOUR_STRENGTH;
    readonly contourWidthPx: typeof RELIEF_CONTOUR_WIDTH_PX;
    readonly tintLow: typeof RELIEF_TINT_LOW;
    readonly tintHigh: typeof RELIEF_TINT_HIGH;
  };
  /** The whole dry composition after the taps (T3 fix round): the graph's wiring, testable on numbers. */
  readonly groundBlend: typeof groundBlend;
  /**
   * GH-1226 S4: the height blend, as VALUES (`height-blend.ts` and `height-blend-record.ts` are also imported by the legacy chunk): the
   * stage, and the two `userData` keys (the record is read from the owner; the build seals the owner against a later install).
   */
  readonly heightBlend: {
    readonly stage: typeof heightBlendStage;
    readonly recordKey: string;
    readonly builtKey: string;
  };
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
  fwidth(a: N): GN;
  normalize(a: N): GN;
  /** The vertex normal in world space (a varying, unflipped) and the face sign (+1 front, -1 back). */
  readonly normalWorldGeometry: GN;
  readonly faceDirection: GN;
  readonly cameraViewMatrix: GN;
}

/** The legacy uniform record, as the twin reads it. */
type Rec = Record<string, { value: unknown }>;

/** The twin and the nodes it re-binds every render, by uniform name: the legacy names, plus `uHeightBlend*` from the height-blend record (not legacy uniforms). */
export interface NodeGround {
  readonly material: THREE.Material;
  /** Every number and vector uniform, re-bound each render from the legacy record (or, for `uHeightBlend*`, the height-blend record). */
  readonly numbers: Readonly<Record<string, N>>;
  /** Every texture tap, by uniform name (`uHeightBlendField` is the height-blend record's), re-bound each render (on the uniform it rides with). */
  readonly textures: Readonly<Record<string, readonly N[]>>;
}

/** Rec. 709 luminance, the weights `neutralTint` and the legacy blend use. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function buildNodeGround(deps: NodeGroundDeps, owner: GroundMaterial): NodeGround {
  const { W, maths } = deps;
  const TSL = deps.TSL as unknown as GroundTsl;
  const o = tslOps(deps.TSL as unknown as Tsl);
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
  // T4: the relief read's five uniforms (the debug layers write `uReliefSlopeGain` / `uReliefContour` / `uReliefTint`).
  const slopeGain = uni('uReliefSlopeGain');
  const contourAmp = uni('uReliefContour');
  const tintAmp = uni('uReliefTint');
  const medianY = uni('uReliefMedianY');
  const levelY = uni('uReliefLevelY');
  const relief = maths.relief;

  // GH-1226 S4: the height blend. With NO record on the owner nothing below is created, and the graph is today's, node for node (pin N1).
  // The owner is sealed either way: a record installed after this build would be silently ignored, so `installHeightBlend` throws.
  const record = owner.userData[maths.heightBlend.recordKey] as HeightBlendRecord | undefined;
  Object.defineProperty(owner.userData, maths.heightBlend.builtKey, { value: true, enumerable: false, configurable: true, writable: true });
  /** A record value as a uniform, re-read from the record EVERY render (by reference: a tone is bound, never copied). */
  const recUni = (name: string, read: () => unknown): N => {
    const n = TSL.uniform(read());
    numbers[name] = n;
    n.onRenderUpdate(() => {
      n.value = read();
    });
    return n;
  };
  /** The field tap: `record.field` at `uv`, re-read each render through the carrier `uMapSize` (a texture node's own update does not survive setup). */
  const fieldTap = (rec: HeightBlendRecord, uv: N): GN => {
    const t = TSL.texture(rec.field, uv) as GN;
    (textures.uHeightBlendField ??= []).push(t);
    const list = carried.get('uMapSize') ?? [];
    list.push(() => {
      t.value = rec.field;
    });
    carried.set('uMapSize', list);
    return t;
  };

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
    // The contour's screen rate, taken here for the same reason (a derivative in uniform control flow, before any select).
    const levels = TSL.positionWorld.y.div(levelY);
    const levelRate = TSL.float(0).toVar();
    levelRate.assign(TSL.fwidth(levels));
    const wall = TSL.attribute('wallAlbedo', 'float');
    const groundUv = TSL.attribute('groundUv', 'vec2');
    const vertexTone = TSL.vertexColor().rgb;
    const ones = TSL.vec3(1, 1, 1);
    const luma = TSL.vec3(LUMA[0], LUMA[1], LUMA[2]);

    // 2-6. The taps (unconditional; the road grain explicit-gradient), then the composition, written once in `ground-maths.ts`.
    const ctlUv = worldXZ.div(mapSize);
    const ctlA = tap('uControlA', 'uMapSize', ctlUv);
    const ctlB = tap('uControlB', 'uMapSize', ctlUv);
    const vec = { luma: (rgb: N): N => TSL.dot(rgb, luma), one3: ones };
    let stage: GroundStage<N> | undefined;
    if (record !== undefined) {
      const opts = record.options;
      const fx = fieldTap(record, ctlUv);
      stage = maths.heightBlend.stage(
        o,
        vec,
        [fx.r, fx.g, fx.b],
        {
          rockTone: recUni('uHeightBlendRockTone', () => record.rockTone),
          // Joints compiled out (low, arid): the stage never reads these two, so no uniform is made (it would leave the update list unread).
          jointTone: opts.joints ? recUni('uHeightBlendJointTone', () => record.jointTone ?? record.rockTone) : ones,
          hollowTone: recUni('uHeightBlendHollowTone', () => record.hollowTone),
          rockAmp: recUni('uHeightBlendAR', () => record.aR),
          jointAmp: opts.joints ? recUni('uHeightBlendAJ', () => record.aJ ?? 0) : o.lit(0),
          hollowAmp: recUni('uHeightBlendAH', () => record.aH),
          soften: recUni('uHeightBlendKH', () => record.kH),
          amp: recUni('uHeightBlendAmp', () => record.amp),
        },
        opts
      );
    }
    const blend = maths.groundBlend(
      o,
      vec,
      maths.roadDistanceRangeTiles,
      {
        vertexTone,
        wall,
        slotTexels: slots.map((s) => tap(s.map, s.carrier, groundUv.div(s.tiles)).rgb),
        controlA: [ctlA.r, ctlA.g, ctlA.b, ctlA.a],
        controlB: [ctlB.r, ctlB.g, ctlB.b, ctlB.a],
        grainTexel: tap(knoll.map, knoll.carrier, grainUv).grad(grainDx, grainDy).rgb,
        macroTexel: tap('uMacro', 'uMapSize', ctlUv).r,
      },
      {
        strengths: slots.map((s) => s.strength),
        means: slots.map((s) => s.mean),
        grainMean: knoll.mean,
        roadOn,
        grainGain,
        roadTone,
        shoulderTone,
        rutTone,
        macroAmp,
        macroBright,
        macroDark,
      },
      stage
    );

    // 7. The relief read, on tops only (`blend.top`): a contour line at every half level, and a tint by height against the map's median.
    const line = relief.contour(o, levels, levelRate, o.lit(relief.contourStrength).mul(contourAmp), o.lit(relief.contourWidthPx));
    const ramp = relief.tintRamp(o, levels, medianY.div(levelY), tintAmp);
    const low = TSL.vec3(...relief.tintLow);
    const high = TSL.vec3(...relief.tintHigh);
    const end = TSL.select(ramp.t.lessThan(0), low, high);
    const tint = TSL.mix(ones, end, ramp.k);
    const reliefTerm = TSL.mix(ones, tint.mul(line), blend.top);
    return TSL.vec4(blend.colour.mul(reliefTerm), 1);
  })();

  // The slope light: the LIGHTING normal only (view space), the geometry and the shadows keep the real surface. The vertex normal in
  // world space, flipped on a back face as the legacy does, tilted by the shared maths, passed through where it has no horizontal
  // part or points down (a wall, a back-facing sliver).
  const lightNormal = TSL.Fn(() => {
    const n = TSL.normalWorldGeometry.mul(TSL.faceDirection);
    const h = TSL.length(TSL.vec2(n.x, n.z));
    const tilt = relief.tilt(o, h, n.y, slopeGain, o.lit(relief.maxTiltRad));
    const tilted = TSL.vec3(n.x.mul(tilt.s), tilt.c, n.z.mul(tilt.s));
    const world = TSL.select(n.y.greaterThan(0), TSL.select(h.lessThan(1e-6), n, tilted), n);
    return TSL.normalize(TSL.cameraViewMatrix.mul(TSL.vec4(world, 0)).xyz);
  })();

  const mat = new W.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  mat.vertexColors = false;
  mat.name = NODE_GROUND_MATERIAL_NAME;
  mat.colorNode = colour as never;
  mat.normalNode = lightNormal as never;
  if (owner.wet) mat.userData.rlUnportedTerms = [GROUND_WET_TERM];
  return { material: mat as unknown as THREE.Material, numbers, textures };
}

/** The `materials.ground` factory body: the twin of `owner`. */
export function createNodeGroundMaterial(deps: NodeGroundDeps, owner: GroundMaterial): THREE.Material {
  return buildNodeGround(deps, owner).material;
}
