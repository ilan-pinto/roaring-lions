/**
 * GH-943 WebGPU P3 (T9): the NODE twin of the tunnel x-ray's four materials (`tunnel-xray.ts`): the bore and shafts (tube), the surface
 * collars, the fighters (figure) and the finder's beam. One factory, four styles chosen by the legacy material's name
 * (`XRAY_STYLE_BY_NAME`), each a `MeshBasicNodeMaterial` of `colorNode` / `opacityNode` / `maskNode`:
 *
 *   tube    reveal front `1 - smoothstep(f - 0.4, f + 0.4, |s - o|)`, the gaussian edge, the grazing rim `pow(1 - |n . toCam|, 4)`,
 *           the scan band on `uTime * 6` mod 30, a discard when faint                        (`xrayRevealOps`, `xrayScanOps`, `xrayTubeOps`)
 *   collar  `step(|s - o|, f)`, breathing on `sin(uTime * 3.4)` at the vent                       (`xrayCollarOps`)
 *   figure  a fresnel mix of the team colour, alpha from the instance's `aAlpha`                   (`xrayFigureOps`)
 *   beam    a gradient on `position.y`                                                              (`xrayBeamOps`)
 *
 * All of it is `Ops<T>` maths written ONCE in `tunnel-xray.ts` and handed here as a value (`material-maths.ts`'s `xray` slot).
 *
 * **The route arrays are the clock's own.** `XrayRouteClock` writes `strength`, `origin`, `front` and `flash` (16 floats each) in
 * place every frame; the legacy uniform record holds those very Float32Arrays. The twin builds an indexed uniform array node over
 * each ONE BY REFERENCE (three copies the array into its buffer on every render), indexed by the vertex's `aRoute`. Copying the array at
 * build would freeze the routes at their state when the twin was adopted.
 *
 * **The clock is the sim's.** `uTime` is a number the legacy record holds (`TunnelXray.update` writes it from `presentationSimMs`);
 * the twin re-reads it every render (`onRenderUpdate`) and invents no clock, so a repaint at the same sim time moves nothing. The
 * beam's `uA` is read the same way. The colours (`uRim`, `uCore`, `uHot`, `uToCam`, `uFig`) are vectors bound by reference.
 *
 * **The state** (the tube's and figure's `GreaterDepth`, stencil `NotEqual`/`Keep`, `BackSide` on the tube, `depthWrite: false`; the
 * collar's and beam's normal blend; the beam's `depthTest: false`) is the legacy material's, copied by adoption (`copyRenderState`).
 * Unlit and fog-blind: the output is linear, and the output stage tone-maps. `renderOrder` stays on the mesh.
 *
 * Attributes: `aS`, `aRoute`, `aKind` (tube, collar), `aAlpha` and the instance matrix (figure), `position.y` (beam).
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N, type Tsl } from './fog-pass.node';
import type { Ops } from './fog-ops';
import type { xrayBeamOps, xrayCollarOps, xrayFigureOps, xrayRevealOps, xrayScanOps, xrayTubeOps } from './tunnel-xray';

export type XrayStyle = 'tube' | 'collar' | 'figure' | 'beam';

/** The legacy material name -> its style: the one place the four are told apart. */
export const XRAY_STYLE_BY_NAME: Readonly<Record<string, XrayStyle>> = Object.freeze({
  'rl-xray-tube': 'tube',
  'rl-xray-collar': 'collar',
  'rl-xray-figure': 'figure',
  'rl-xray-beam': 'beam',
});

/** The shared x-ray maths, INJECTED (`material-maths.ts`'s `xray` slot). */
export interface XrayMaths {
  readonly revealOps: typeof xrayRevealOps;
  readonly scanOps: typeof xrayScanOps;
  readonly tubeOps: typeof xrayTubeOps;
  readonly collarOps: typeof xrayCollarOps;
  readonly figureOps: typeof xrayFigureOps;
  readonly beamOps: typeof xrayBeamOps;
}

/** The TSL surface this twin uses beyond `Tsl` (structural, cast once at the factory: see `fog-pass.node.ts`'s `N`). */
export interface XrayTsl extends Tsl {
  attribute(name: string, type: string): N;
  readonly normalWorldGeometry: N;
  readonly positionLocal: N;
}

export interface XrayTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: XrayTsl;
  readonly maths: XrayMaths;
}

/** The slice of a legacy x-ray material's `uniforms` record. Every style reads only its own fields. */
export interface XrayUniformRecord {
  readonly uRim?: { value: THREE.Vector3 };
  readonly uCore?: { value: THREE.Vector3 };
  readonly uHot?: { value: THREE.Vector3 };
  readonly uFig?: { value: THREE.Vector3 };
  readonly uToCam?: { value: THREE.Vector3 };
  readonly uTime?: { value: number };
  readonly uA?: { value: number };
  readonly uStrength?: { value: Float32Array };
  readonly uOrigin?: { value: Float32Array };
  readonly uFront?: { value: Float32Array };
  readonly uFlash?: { value: Float32Array };
}

/** What a test may read back: the nodes the style bound (absent ones are undefined). */
export interface XrayTwinBound {
  readonly style: XrayStyle;
  readonly uRim?: N;
  readonly uCore?: N;
  readonly uHot?: N;
  readonly uFig?: N;
  readonly uToCam?: N;
  readonly uTime?: N;
  readonly uA?: N;
  readonly uStrength?: N;
  readonly uOrigin?: N;
  readonly uFront?: N;
  readonly uFlash?: N;
}

export const NODE_XRAY_MATERIAL_PREFIX = 'rl-node-material-xray-';
/** `XrayTwinBound` rides on `userData` so the vitest can reach the nodes it must `update()`. */
export const XRAY_BOUND_KEY = 'rlXrayBound';

/** An indexed element read: `array.element(i)` with a NODE index (the typed `N.element` takes a number). */
type Indexed = { element(i: N): N };

/** The slice of the legacy material the factory reads: its uniform record (the legacy material owns it). */
export interface XrayLegacy {
  readonly uniforms: object;
}

export function createNodeXrayMaterial(deps: XrayTwinDeps, legacy: XrayLegacy, style: XrayStyle): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const rec = legacy.uniforms as unknown as XrayUniformRecord;
  const need = <K extends keyof XrayUniformRecord>(key: K): NonNullable<XrayUniformRecord[K]> => {
    const r = rec[key];
    if (r === undefined) throw new Error(`node x-ray twin (${style}): the legacy material has no ${key} uniform`);
    return r as NonNullable<XrayUniformRecord[K]>;
  };
  // Vectors by reference: the legacy material owns them.
  const vec = (key: 'uRim' | 'uCore' | 'uHot' | 'uFig' | 'uToCam'): N => TSL.uniform(need(key).value);
  // Numbers are re-read every render: `TunnelXray.update` replaces `.value` once a frame, on the sim clock.
  const num = (key: 'uTime' | 'uA'): N => {
    const r = need(key);
    const n = TSL.uniform(r.value);
    n.onRenderUpdate(() => {
      n.value = r.value;
    });
    return n;
  };
  // The clock's own Float32Array, by reference: three copies it into the buffer on every render.
  const arr = (key: 'uStrength' | 'uOrigin' | 'uFront' | 'uFlash'): N => TSL.uniformArray(need(key).value, 'float');
  const m = new W.MeshBasicNodeMaterial();
  m.name = `${NODE_XRAY_MATERIAL_PREFIX}${style}`;
  const bound: { -readonly [K in keyof XrayTwinBound]: XrayTwinBound[K] } = { style };
  let out: { rgb: N; a: N; keep: N };
  // A fragment of the grazing term: 1 - |n . toCam|, with the world normal (instanced meshes carry their matrix into it).
  const grazing = (toCam: N): N => o.sub(o.lit(1), o.abs(TSL.dot(TSL.normalWorldGeometry, toCam)));

  if (style === 'tube' || style === 'collar') {
    const uStrength = arr('uStrength');
    const uOrigin = arr('uOrigin');
    const uFront = arr('uFront');
    const uFlash = arr('uFlash');
    const uTime = num('uTime');
    const uRim = vec('uRim');
    const uHot = vec('uHot');
    Object.assign(bound, { uStrength, uOrigin, uFront, uFlash, uTime, uRim, uHot });
    const s = TSL.attribute('aS', 'float');
    const kind = TSL.attribute('aKind', 'float');
    // `routeState`: the route index is the vertex's `aRoute`, rounded, as the legacy loop's `int(route + 0.5)`.
    const r = TSL.int(TSL.attribute('aRoute', 'float').add(0.5));
    const at = (a: N): N => (a as unknown as Indexed).element(r);
    const st = at(uStrength);
    const origin = at(uOrigin);
    const front = at(uFront);
    const flash = at(uFlash);
    const rv = maths.revealOps(o, s, origin, front, flash);
    if (style === 'tube') {
      const uCore = vec('uCore');
      const uToCam = vec('uToCam');
      Object.assign(bound, { uCore, uToCam });
      out = maths.tubeOps(o, {
        st,
        revealed: rv.revealed,
        edge: rv.edge,
        flash,
        grazing: grazing(uToCam),
        scan: maths.scanOps(o, s, uTime, kind),
        rim: uRim,
        core: uCore,
        hot: uHot,
      });
    } else {
      out = maths.collarOps(o, st, rv.d, front, kind, uTime, flash, uRim, uHot);
    }
  } else if (style === 'figure') {
    const uFig = vec('uFig');
    const uToCam = vec('uToCam');
    Object.assign(bound, { uFig, uToCam });
    out = maths.figureOps(o, grazing(uToCam), uFig, TSL.attribute('aAlpha', 'float'));
  } else {
    const uRim = vec('uRim');
    const uHot = vec('uHot');
    const uA = num('uA');
    Object.assign(bound, { uRim, uHot, uA });
    out = maths.beamOps(o, TSL.positionLocal.y, uHot, uRim, uA);
  }
  m.colorNode = out.rgb as never;
  m.opacityNode = out.a as never;
  // A faint fragment is discarded, as the legacy shader's `discard`.
  // (The beam never discards.)
  if (style !== 'beam') m.maskNode = out.keep.greaterThan(0.5) as never;
  m.fog = false;
  m.toneMapped = false;
  m.userData[XRAY_BOUND_KEY] = bound as XrayTwinBound;
  return m;
}
