/**
 * GH-943 WebGPU P3 (T10): the NODE twin of the valley backdrop's distance fade (`backdrop.ts`, `fadeToBackground`). The five backdrop
 * materials (the ground, the far ground, the kit and its LOD1, which share one, and the olives) are STOCK lit materials with one
 * output term: after lighting, the colour is mixed toward the linear scene background by how far the fragment stands outside the map.
 * The twin is a `MeshStandardNodeMaterial` carrying the legacy material's look (`map`, `roughness`, `metalness`, `envMapIntensity`,
 * all mirrored once from the legacy material at adoption; none of them is ever written afterwards) and ONE `outputNode`:
 *
 *   `out = max(0, max(-xz, xz - uBdSize))`, `f = smoothstep(uBdFade.x, uBdFade.y, length(out))`, `rgb = mix(lit.rgb, uBdBg, f)`
 *
 * The arithmetic is `backdropFadeOps`, written ONCE against `Ops<T>` in the legacy file and handed here as a value
 * (`material-maths.ts`: a value import would make the node chunk statically load the ThreeRenderer chunk). It runs on the LIT output
 * (`output`, three's own post-lighting variable), never on `colorNode`: the legacy hook sits after `dithering_fragment`, so a fade on
 * the albedo would be lit afterwards and the far edge would not be exactly the background.
 *
 * `xz` is `positionWorld`, which in r186 is built from the INSTANCED local position, so the olives read each instance's world
 * position (the legacy hook's `modelMatrix * instanceMatrix * position`). The LOD1 swap is a mesh choice, not this material's.
 * There is no envMap (the kit sets `envMapIntensity: 0`; the class table gives the backdrop none).
 *
 * **The uniforms stay a record.** The legacy material carries `userData.rlBackdropFade` (`uBdBg`, `uBdSize`, `uBdFade`), made up front
 * and bound by the legacy shader too; the twin shares the vectors by reference.
 *
 * ADDON-FREE: `three/webgpu` and `three/tsl` arrive injected, the shared maths as a value. Presentation only.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N, type Tsl } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import { mirrorLegacyFields } from '../twin-identity';
import type { backdropFadeOps } from './backdrop';

/** The shared fade maths, INJECTED (see the header): `material-maths.ts`'s `backdrop` slot. */
export interface BackdropMaths {
  readonly fadeOps: typeof backdropFadeOps;
}

/** The slice of the legacy record the twin reads (`BackdropFadeRecord`, `terrain/backdrop.ts`). */
export interface BackdropFadeUniforms {
  readonly bg: { readonly value: THREE.Vector3 };
  readonly size: { readonly value: THREE.Vector2 };
  readonly fade: { readonly value: THREE.Vector2 };
}

/** The `userData` key the legacy material carries its record under. A COPY of `backdrop.ts`'s `BACKDROP_FADE_KEY` (a value import would
 *  drag the legacy chunk in); `backdrop.node.test.ts` pins the two equal. */
export const BACKDROP_FADE_KEY = 'rlBackdropFade';
/** The name every backdrop twin carries (`NODE_MATERIAL_MARKER`'s prefix, `tools/src/perf/bundle-census.ts`). */
export const NODE_BACKDROP_MATERIAL_NAME = 'rl-node-material-backdrop';
/** The nodes a test may read back, on `userData`. */
export const BACKDROP_BOUND_KEY = 'rlBackdropBound';

export interface BackdropTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: Tsl;
  readonly maths: BackdropMaths;
}

export interface BackdropTwinBound {
  readonly uBdBg: N;
  readonly uBdSize: N;
  readonly uBdFade: N;
}

/** The TSL names this twin uses beyond `Tsl`: three's lit-output variable and the instanced world position. */
interface BackdropTsl extends Tsl {
  readonly output: N;
  readonly positionWorld: N;
}

export function createNodeBackdropMaterial(deps: BackdropTwinDeps, legacy: THREE.MeshStandardMaterial): WEBGPU.MeshStandardNodeMaterial {
  const { W, maths } = deps;
  const T = deps.TSL as BackdropTsl;
  const rec = (legacy.userData as Record<string, unknown>)[BACKDROP_FADE_KEY] as BackdropFadeUniforms | undefined;
  if (rec === undefined) throw new Error('createNodeBackdropMaterial: the legacy material carries no rlBackdropFade record (not a backdrop fade material)');
  const o = tslOps(T) as Ops<N>;

  const uBdBg = T.uniform(rec.bg.value);
  const uBdSize = T.uniform(rec.size.value);
  const uBdFade = T.uniform(rec.fade.value);

  const m = new W.MeshStandardNodeMaterial();
  m.name = NODE_BACKDROP_MATERIAL_NAME;
  // The look: field by field from the legacy material (colour in place), once. Nothing writes these after the backdrop is built.
  mirrorLegacyFields(legacy, m, false);
  m.envMapIntensity = legacy.envMapIntensity;

  const wp = T.positionWorld;
  const lit = T.output;
  const faded = maths.fadeOps(o, {
    x: wp.x,
    z: wp.z,
    sizeX: uBdSize.x,
    sizeZ: uBdSize.y,
    fadeFrom: T.float(1e6), // DEAD WITNESS (temporary)
    fadeTo: T.float(2e6),
    lit: [lit.x, lit.y, lit.z],
    bg: [uBdBg.x, uBdBg.y, uBdBg.z],
  });
  // The OUTPUT term: after lighting (and fog), as the legacy hook after `dithering_fragment`. Alpha is the lit alpha.
  m.outputNode = T.vec4(...faded.rgb, lit.w) as never;
  const bound: BackdropTwinBound = { uBdBg, uBdSize, uBdFade };
  m.userData[BACKDROP_BOUND_KEY] = bound;
  return m;
}
