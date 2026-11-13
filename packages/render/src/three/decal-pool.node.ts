/**
 * GH-943 WebGPU P3 (T7): the NODE twin of the decal pools' material (`decal-pool.ts`, `createDecalMaterial`): every crater,
 * scorch, oil, rubble, tread, tyre and churn mark, and the crater rim, as one `NodeMaterial` both pools draw with.
 *
 * What it mirrors, in the order of the legacy material's fragment:
 *   1. the vertex stage: `aOffset` (smooth), `aDecal` and `aGround` (FLAT, so the kind and seed are the exact values the pool
 *      wrote), the world xz from `positionWorld` and the view position from `positionView`;
 *   2. in UNIFORM control flow, before any discard: the screen derivatives of the view position and of the offset (the rim's facet
 *      frame), the sun's shadow, and the control B tap at `worldXZ / uMapSize` (an implicit-gradient tap: never inside a branch);
 *   3. the off-map discard;
 *   4. the kind's opacity and palette index, BRANCH-FREE (`decalAlphaOps`, every kind evaluated, the kind's own selected), the
 *      colour from `uColors[8]`, the ground tone rebuilt from `aGround` and control B's road (`decalGroundToneOps`, the ground's own
 *      `roadBands`), and `outRatio = 1 + a (colour / max(ground, 1e-4) - 1)` (`decalMultiplierOps`);
 *   5. the crater rim: central differences of `craterHeightOps` (e = 0.01) bump-mapped onto the facet, and the ratio multiplied by
 *      `irradiance(n1) / irradiance(n0)` (`decalRimRatioOps`), on a crater with the rim gain on (`decalOutRatioOps`);
 *   6. the discard at `a <= 0`, and `vec4(outRatio, 1)`.
 * Every step after the taps is maths written ONCE against `Ops<T>` / `IntOps<T>` in `decal-maths.ts`, handed here as VALUES
 * (`material-maths.ts`'s `decal` slot); this file samples and wires.
 *
 * **The lights are OBJECTS, read by reference** (`DECAL_LIGHTS_KEY`, recorded by `ThreeRenderer` from `createSceneLights`): the
 * sun (`directionalLights[0]`), the hemisphere and every ambient light. Their colour times intensity is re-read every render, their
 * directions come from their world matrices in view space (`lightTargetDirection`, the hemisphere's position), and a hidden light
 * reads as no light, as the legacy renderer leaves it out. The material itself is UNLIT (`lights` false): it does its own Lambert
 * ratio, like the legacy material, and never runs a lighting model.
 *
 * **The sun's shadow is the light's own node shadow.** The twin reads `sun.shadow.shadowNode`, and installs one (`shadow(sun)`)
 * when the light has none, so the lit materials, which take a light's custom shadow node when it has one, sample the SAME shadow
 * map: one shadow pass a frame, not two. It is installed at adoption (the factory), before the first program is built. It is used
 * where the legacy material would use it (`renderer.shadowMap.enabled`, `sun.castShadow`, the mesh's `receiveShadow`), else 1. The
 * legacy decal has no normal attribute, so its shadow lookup takes no normal bias; the twin's normal (the facet's own, needed for a
 * defined `normalWorld`) is cancelled out of the lookup position, so it takes none either.
 *
 * **The uniforms stay a record.** Numbers and vectors are re-bound from `rec.value` every render, the control B texture rides on
 * `uMapSize`'s update (`ThreeRenderer` binds a new control map on every terrain rebuild, into the SHARED record the ground reads),
 * and `uColors` re-binds its array. `uNowSec` is the SIM clock the renderer writes; `uRimGain` is the `crater-rims` layer.
 *
 * **The blend** is the legacy material's multiply (`DstColor x Zero`, alpha `Zero x One`), with its depth state, polygon offset and
 * side, copied by `copyRenderState` here AND by adoption. The ratio above 1 (a pale lip) survives because the node scene pass is
 * HalfFloat. `renderOrder` stays on the two meshes (-1 and 0, `render-order.ts`).
 *
 * **Not drawn here, and said so** (`userData.rlUnportedTerms`): on a `DECAL_WET` owner, the crater water (P4). A wet owner gets the
 * DRY graph, byte for byte: the graph never reads the define; only the list of unported terms does.
 *
 * ADDON-FREE: `three/webgpu` and `three/tsl` arrive injected, the shared maths as VALUES; every import below is a type, except
 * `three` itself, `copyRenderState` (the import-free seam module) and the TSL ops of the node fog twin, in the same node chunk.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import type { DecalLights } from './decal-pool';
import type {
  craterGradOps,
  decalAlphaOps,
  decalGroundToneOps,
  decalKindOps,
  decalMultiplierOps,
  decalOutRatioOps,
  decalRimRatioOps,
  DecalRimLights,
  V3,
} from './decal-maths';
import type { Ops, IntOps } from './fog-ops';
import type { heightBlendTone } from './terrain/height-blend';
import type { HeightBlendRecord } from './terrain/height-blend-record';
import { tslIntOps, tslOps, type N, type Tsl } from './fog-pass.node';
import { copyRenderState } from './twin-identity';

/** The prefix every node twin's `name` carries (`units/overlays.node.ts`'s `NODE_MATERIAL_PREFIX`; the bundle census reads it). */
export const NODE_DECAL_MATERIAL_NAME = 'rl-node-material-decal';
/** What the twin does not draw on a wet owner, as the census names it (`UNPORTED_TERMS_KEY`). */
export const DECAL_WET_TERM = 'rl-decal: wet terms';

/**
 * The decal maths the twin is handed as VALUES (`material-maths.ts`'s `MATERIAL_MATHS.decal`). `decal-maths.ts` is also imported by
 * the legacy material, so a value import here would make the node-backend chunk load the ThreeRenderer chunk statically.
 */
export interface DecalMaths {
  readonly kindOps: typeof decalKindOps;
  readonly alphaOps: typeof decalAlphaOps;
  readonly groundToneOps: typeof decalGroundToneOps;
  readonly multiplierOps: typeof decalMultiplierOps;
  readonly craterGradOps: typeof craterGradOps;
  readonly rimRatioOps: typeof decalRimRatioOps;
  readonly outRatioOps: typeof decalOutRatioOps;
  /** `ROAD_DISTANCE_RANGE_TILES`: control B's road distance, [0, 1], in tiles. */
  readonly roadRangeTiles: number;
  /** `DECAL_PALETTE_ORDER.length`: the `uColors` the legacy record holds. */
  readonly paletteSize: number;
  /** `DECAL_WET_DEFINE`: read ONLY to name the unported wet terms. */
  readonly wetDefine: string;
  /** `DECAL_LIGHTS_KEY`: where the legacy material carries its scene's light objects. */
  readonly lightsKey: string;
  /**
   * GH-1226 S6: the height blend's tone half (`heightBlendTone`; the ground's stage re-implements the same tone mix inline, and a spec pins the two to bit equality at soil 1, Lr 1) and the keys of the
   * record and the seal. The record is read off this material's own `userData` (the renderer installs the ground's record here too).
   */
  readonly heightBlend: {
    readonly tone: typeof heightBlendTone;
    readonly recordKey: string;
    readonly builtKey: string;
  };
}

/** The node slice this file reads beyond the fog twin's `N`. */
interface DN extends N {
  readonly x: DN;
  readonly y: DN;
  readonly r: DN;
  readonly g: DN;
  readonly b: DN;
  readonly a: DN;
  readonly xz: DN;
  readonly xy: DN;
  lessThan(b: N | number): DN;
  greaterThan(b: N | number): DN;
  lessThanEqual(b: N | number): DN;
  or(b: N): DN;
  setInterpolation(type: string): DN;
  element(i: N | number): DN;
  array: unknown;
}
interface DecalTsl extends Omit<Tsl, 'texture'> {
  texture(value: unknown, uv: N): DN;
  attribute(name: string, type: string): DN;
  varying(node: N, name?: string): DN;
  readonly positionWorld: DN;
  readonly positionView: DN;
  readonly normalWorld: DN;
  readonly cameraViewMatrix: DN;
  dFdx(a: N): DN;
  dFdy(a: N): DN;
  cross(a: N, b: N): DN;
  normalize(a: N): DN;
  reference(name: string, type: string, object: unknown): DN;
  lightTargetDirection(light: unknown): DN;
  lightPosition(light: unknown): DN;
  transformDirection(direction: N, matrix: N): DN;
  shadow(light: unknown): DN;
  Discard(cond: N): void;
  Fn(body: (builder: BuilderLike) => N): () => DN;
}
/** What the twin reads off the node builder at build time. */
interface BuilderLike {
  readonly renderer: { readonly shadowMap: { readonly enabled: boolean } };
  readonly object: { readonly receiveShadow?: boolean } | null;
}

export interface DecalTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: unknown;
  readonly maths: DecalMaths;
}

/** The legacy uniform record, as the twin reads it. */
type Rec = Record<string, { value: unknown }>;

/** The legacy material, as the twin reads it: its uniform record, its defines (the wet one only names a term) and its `userData`. */
export type DecalLegacy = THREE.Material & { readonly uniforms: Rec; readonly defines?: Record<string, unknown> };

/** The twin and the nodes it re-binds, by legacy uniform name (the wiring gates read them). */
export interface NodeDecal {
  readonly material: THREE.Material;
  /** Every number and vector uniform, re-bound from the record each render. */
  readonly numbers: Readonly<Record<string, N>>;
  /** `uColors`, the palette array (its `array` re-bound each render). */
  readonly colours: N;
  /** The control B tap (its `value` re-bound on `uMapSize`'s update). */
  readonly controlB: N;
  /** GH-1226 S6: the height-blend field tap (null with no record on the legacy material: the graph is then today's, node for node). */
  readonly heightField: N | null;
  /** The light colours (each its light's colour times intensity, re-read every render) and the two view-space directions. */
  readonly lights: {
    readonly ambient: N;
    readonly sunColor: N;
    readonly sunDir: N;
    readonly hemiSky: N;
    readonly hemiGround: N;
    readonly hemiDir: N;
  };
  /** The sun's node shadow, the light's own (`sun.shadow.shadowNode`); null with no sun. */
  readonly shadow: N | null;
}

/** A light's colour times its intensity, or black while it is hidden (the legacy renderer leaves a hidden light out). */
function litColour(target: THREE.Color, light: THREE.Light, colour: THREE.Color): THREE.Color {
  return light.visible ? target.copy(colour).multiplyScalar(light.intensity) : target.setRGB(0, 0, 0);
}

export function buildNodeDecal(deps: DecalTwinDeps, legacy: DecalLegacy): NodeDecal {
  const { W, maths } = deps;
  const TSL = deps.TSL as DecalTsl;
  const o = tslOps(deps.TSL as Tsl) as Ops<N>;
  const io = tslIntOps(deps.TSL as Tsl) as IntOps<N>;
  const rec = legacy.uniforms;
  const read = (name: string): { value: unknown } => {
    const r = rec[name];
    if (r === undefined) throw new Error(`node decal: the legacy record has no uniform "${name}"`);
    return r;
  };
  const lights = legacy.userData[maths.lightsKey] as DecalLights | undefined;
  if (lights === undefined) throw new Error('node decal: the legacy material carries no scene lights (ThreeRenderer records them with setDecalLights)');

  const numbers: Record<string, N> = {};
  const carried = new Map<string, Array<() => void>>();
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

  // The record, bound up front.
  const nowSec = uni('uNowSec');
  const rimGain = uni('uRimGain');
  const rimShape = uni('uRimShape');
  const mapSize = uni('uMapSize');
  const roadTone = uni('uRoadTone');
  const shoulderTone = uni('uShoulderTone');
  const roadOn = uni('uRoadOn');
  const coloursRec = read('uColors');
  const colours = TSL.uniformArray(coloursRec.value, 'vec3') as DN;
  if ((coloursRec.value as unknown[]).length !== maths.paletteSize) {
    throw new Error(`node decal: uColors holds ${(coloursRec.value as unknown[]).length} colours, the palette ${maths.paletteSize}`);
  }
  colours.onRenderUpdate(() => {
    colours.array = coloursRec.value;
  });

  // The lights, by reference.
  const v3 = (n: N): V3<N> => [n.x, n.y, n.z];
  const zero = TSL.vec3(0, 0, 0);
  const colourOf = (update: (c: THREE.Color) => THREE.Color): N => {
    const n = TSL.uniform(new THREE.Color());
    n.onRenderUpdate(() => update(n.value as THREE.Color));
    return n;
  };
  const { sun, hemisphere: hemi, ambient } = lights;
  const sunColor = sun === null ? zero : colourOf((c) => litColour(c, sun, sun.color));
  const sunDir = sun === null ? TSL.vec3(0, 0, 1) : TSL.lightTargetDirection(sun);
  const hemiSky = hemi === null ? zero : colourOf((c) => litColour(c, hemi, hemi.color));
  const hemiGround = hemi === null ? zero : colourOf((c) => litColour(c, hemi, hemi.groundColor));
  const hemiDir = hemi === null ? TSL.vec3(0, 1, 0) : TSL.transformDirection(TSL.lightPosition(hemi), TSL.cameraViewMatrix);
  const scratch = new THREE.Color();
  const ambientColour = colourOf((c) => {
    c.setRGB(0, 0, 0);
    for (const a of ambient) c.add(litColour(scratch, a, a.color));
    return c;
  });
  const rimLights: DecalRimLights<N> = {
    ambient: v3(ambientColour),
    sunColor: v3(sunColor),
    sunDir: v3(sunDir),
    hemiSky: v3(hemiSky),
    hemiGround: v3(hemiGround),
    hemiDir: v3(hemiDir),
  };

  // The sun's shadow: the light's own node shadow, installed here when it has none (one shadow map for every material).
  let shadowNode: N | null = null;
  if (sun !== null) {
    const s = sun.shadow as unknown as { shadowNode?: N };
    shadowNode = s.shadowNode ?? (s.shadowNode = TSL.shadow(sun));
  }
  const sunShadow = shadowNode;
  const shadowFactor = TSL.Fn((builder) =>
    sun !== null && sunShadow !== null && builder.renderer.shadowMap.enabled && sun.castShadow && builder.object?.receiveShadow === true
      ? sunShadow
      : TSL.float(1)
  )();

  // The vertex stage: the offset interpolates, the per-decal record is flat.
  const offset = TSL.attribute('aOffset', 'vec2');
  const decal = TSL.varying(TSL.attribute('aDecal', 'vec4'), 'vRlDecal').setInterpolation('flat');
  const ground = TSL.varying(TSL.attribute('aGround', 'vec3'), 'vRlGround').setInterpolation('flat');
  // Control B at the fragment's map uv, re-bound on `uMapSize`'s update: every terrain rebuild binds a new control map into the
  // SHARED record the ground reads. Built here, emitted where the graph first reads it (a statement, before any discard).
  const worldXZ = TSL.positionWorld.xz;
  const ctlRec = read('uControlB');
  const mapUv = worldXZ.div(mapSize);
  const controlB = TSL.texture(ctlRec.value, mapUv);
  carried.set('uMapSize', [
    (): void => {
      controlB.value = ctlRec.value;
    },
  ]);

  // GH-1226 S6: the height blend. With NO record on this material nothing below is created (the decal twin's no-record graph is today's). The material is sealed either
  // way: a record installed after this build would be silently ignored, so `installHeightBlend` throws.
  const hb = legacy.userData[maths.heightBlend.recordKey] as HeightBlendRecord | undefined;
  Object.defineProperty(legacy.userData, maths.heightBlend.builtKey, { value: true, enumerable: false, configurable: true, writable: true });
  /** A record value as a uniform, re-read from the record EVERY render (by reference: a tone is bound, never copied). */
  const recUni = (name: string, read: () => unknown): N => {
    const n = TSL.uniform(read());
    numbers[name] = n;
    n.onRenderUpdate(() => {
      n.value = read();
    });
    return n;
  };
  let heightField: DN | null = null;
  let blendKnobs: Parameters<typeof maths.heightBlend.tone<N>>[4] | null = null;
  if (hb !== undefined) {
    // Re-bound each render through the carrier `uMapSize`, as the ground's field tap and control B are (a texture node's own update does not survive setup).
    const field = TSL.texture(hb.field, mapUv);
    heightField = field;
    carried.get('uMapSize')?.push(() => {
      field.value = hb.field;
    });
    const ones = TSL.vec3(1, 1, 1);
    // The tone half reads neither joint input (no texture edge, no joints: design 3.4), so none is bound.
    blendKnobs = {
      rockTone: recUni('uHeightBlendRockTone', () => hb.rockTone),
      jointTone: ones,
      hollowTone: recUni('uHeightBlendHollowTone', () => hb.hollowTone),
      rockAmp: recUni('uHeightBlendAR', () => hb.aR),
      jointAmp: TSL.float(0),
      hollowAmp: recUni('uHeightBlendAH', () => hb.aH),
      soften: TSL.float(0),
      amp: recUni('uHeightBlendAmp', () => hb.amp),
    };
  }

  const fragment = TSL.Fn(() => {
    // Uniform control flow: every derivative, the shadow and the control B tap are statements here, before any discard (an
    // `assign` is emitted where it is called; a bare expression where it is first read).
    const dpx = TSL.vec3(0, 0, 0).toVar();
    dpx.assign(TSL.dFdx(TSL.positionView));
    const dpy = TSL.vec3(0, 0, 0).toVar();
    dpy.assign(TSL.dFdy(TSL.positionView));
    const dstx = TSL.vec2(0, 0).toVar();
    dstx.assign(TSL.dFdx(offset));
    const dsty = TSL.vec2(0, 0).toVar();
    dsty.assign(TSL.dFdy(offset));
    const shadowV = TSL.float(1).toVar();
    shadowV.assign(shadowFactor);
    const ctlB = TSL.vec4(0, 0, 0, 0).toVar() as DN;
    ctlB.assign(controlB);
    const fx = TSL.vec4(0, 0, 0, 0).toVar() as DN;
    if (heightField !== null) fx.assign(heightField);
    // Nothing hangs past the map edge over the skirt.
    TSL.Discard(
      worldXZ.x.lessThan(0).or(worldXZ.y.lessThan(0)).or(worldXZ.x.greaterThan(mapSize.x)).or(worldXZ.y.greaterThan(mapSize.y))
    );

    const kind = maths.kindOps(o, decal.x);
    const seed = decal.y;
    const halfLength = decal.w;
    const s = offset.x;
    const t = offset.y;
    const sample = maths.alphaOps(o, io, kind, s, t, seed, nowSec.sub(decal.z), halfLength);
    const a = TSL.float(0).toVar() as DN;
    a.assign(sample.alpha);
    TSL.Discard(a.lessThanEqual(0));
    // The colour and the ground tone are whole vec3 nodes (the maths is per component); the albedo ratio is a statement, so the
    // rim's select below reads it once.
    const colour = colours.element(TSL.int(sample.colour));
    // The blended ground tone is the divisor (the ground's stage runs BEFORE its road block, so the road mixes over it here too). The decal has
    // no control A, so the soil weight is 1: a pad, a grove floor or a `^` top, where the ground's soil weight is lower, is a known approximation.
    const blended = blendKnobs === null ? ground : maths.heightBlend.tone(o, ground, [fx.r, fx.g, fx.b], o.lit(1), blendKnobs);
    const tone = maths.groundToneOps(o, blended, roadTone, shoulderTone, ctlB.g, ctlB.a, roadOn, maths.roadRangeTiles);
    const base = TSL.vec3(1, 1, 1).toVar();
    base.assign(maths.multiplierOps(o, colour, tone, a));
    const grad = maths.craterGradOps(o, s, t, seed, rimShape.x, rimShape.y);
    const facet = { dpx: v3(dpx), dpy: v3(dpy), dstx: [dstx.x, dstx.y] as const, dsty: [dsty.x, dsty.y] as const };
    const rim = maths.rimRatioOps(o, grad, halfLength, rimGain, facet, rimLights, shadowV);
    const out = maths.outRatioOps(o, kind, rimGain, base, TSL.vec3(rim[0], rim[1], rim[2]));
    return TSL.vec4(out, 1);
  })();
  // The facet's own normal (view space, toward the camera), so `normalWorld` is defined on a mesh with no normal attribute; the
  // shadow lookup's normal bias along it is cancelled, as the legacy decal (no normal) takes none.
  const facetNormal = TSL.Fn(() => {
    const n = TSL.normalize(TSL.cross(TSL.dFdx(TSL.positionView), TSL.dFdy(TSL.positionView)));
    return TSL.select(n.z.lessThan(0), n.negate(), n);
  })();

  const mat = new W.NodeMaterial();
  mat.name = NODE_DECAL_MATERIAL_NAME;
  mat.colorNode = fragment as never;
  mat.normalNode = facetNormal as never;
  if (sun !== null) {
    mat.receivedShadowPositionNode = TSL.positionWorld.sub(TSL.normalWorld.mul(TSL.reference('normalBias', 'float', sun.shadow))) as never;
  }
  mat.fog = false;
  mat.toneMapped = false;
  copyRenderState(legacy, mat);
  if (legacy.defines?.[maths.wetDefine] !== undefined) mat.userData.rlUnportedTerms = [DECAL_WET_TERM];
  return {
    material: mat as unknown as THREE.Material,
    numbers,
    colours,
    controlB,
    heightField,
    lights: { ambient: ambientColour, sunColor, sunDir, hemiSky, hemiGround, hemiDir },
    shadow: shadowNode,
  };
}

/** The `materials.decal` factory body: the twin of `legacy`. */
export function createNodeDecalMaterial(deps: DecalTwinDeps, legacy: DecalLegacy): THREE.Material {
  return buildNodeDecal(deps, legacy).material;
}
