/**
 * GH-943 WebGPU P3 (T12): the NODE twin of the flipbook's two legacy materials (`flipbook-fx.ts`): the smoke pass (`rl-flipbook-smoke`,
 * smoke and dirt, depth-tested) and the fire pass (`rl-flipbook-fire`, fire and sparks, no depth test). One recipe; `pass` is the
 * legacy material's name. An unlit, fog-blind `MeshBasicNodeMaterial`: `toneMapped = false`, `fog = false`, because the legacy shader
 * writes LINEAR colour (the fire at `HDR_GAINS.fireball`) straight into the HalfFloat scene target. The pipeline state is the legacy
 * material's, copied by adoption (`copyRenderState`).
 *
 * **The vertex stage** is a clip-space `vertexNode`: the four motion models by `aParams.w` (`flipbookMotionOps`), the billboard from
 * the view matrix rows (`right`, `up`), the 0.32 lift, and the collapse to `vec4(2, 2, 2, 1)` for a dead instance or one of the
 * other pass's type (`flipbookAliveOps`), all branch-free.
 *
 * **The fragment**: the rotation, the billow and both frames (`flipbookCoverOps`), then BOTH atlases sampled at both frames,
 * UNCONDITIONALLY, before anything selects (`.toVar()` makes each tap a statement in uniform control flow: the legacy shader samples
 * inside `if (vType < 0.5)` on a varying, after a divergent discard, which WGSL rejects), then the type picked by a `select` and the
 * fire, smoke, dirt and spark colours (`flipbookShadeOps`). The two discards are the `maskNode`.
 *
 * **The clock** is the legacy record's `uTime` (the FRAME clock `FlipbookFx.step` writes, so hit-stop freezes it), re-read every
 * render; the twin invents none. A zero-time repaint moves nothing.
 *
 * **The uniforms stay a record.** Numbers and vectors are re-read from `legacy.uniforms[k].value` every render (`setLighting` and
 * `setColors` copy into the vectors in place; `setAtlases` REPLACES the atlas values). The writers hold their legacy materials apart
 * (`FlipbookFx.smokeMaterial` / `fireMaterial`), never through `mesh.material`, which is this twin once adopted.
 *
 * **The atlases are bound late.** They land after adoption (`FlipbookFx.load`), so each tap is built on a placeholder (a filterable
 * 1x1, the same binding layout as the atlas) and re-synced from the record on `uLight`'s render update (the P2 T3 rule: a texture node
 * has no render update of its own that survives its setup). Until both land `FlipbookFx` keeps the meshes hidden, so the placeholder
 * never draws. `NoColorSpace`, no premultiply and `flipY` are the atlas's own (`prepareFlipbookAtlas`); the WebGPU upload honours
 * `flipY`, so the row inversion of `vfxFrameUvOps` holds on both backends.
 *
 * ADDON-FREE. TSL arrives injected; the maths as VALUES (`material-maths.ts`): every import below is a type except the seam's own.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { flipbookAliveOps, flipbookCoverOps, flipbookMotionOps, flipbookShadeOps, Tap4 } from './flipbook-fx';
import type { V3s, vfxBillboardOps } from './vfx-noise';
import { finishFxTwin, type FxTsl, type FxTwinBound, type FxTwinDeps, type HasUniforms, type NX } from './fx.node';

/** The flipbook maths, INJECTED (`material-maths.ts`'s `flipbook` slot). */
export interface FlipbookMaths {
  readonly motionOps: typeof flipbookMotionOps;
  readonly aliveOps: typeof flipbookAliveOps;
  readonly coverOps: typeof flipbookCoverOps;
  readonly shadeOps: typeof flipbookShadeOps;
  readonly billboardOps: typeof vfxBillboardOps;
}

export const NODE_FLIPBOOK_SMOKE_NAME = 'rl-node-material-flipbook-smoke';
export const NODE_FLIPBOOK_FIRE_NAME = 'rl-node-material-flipbook-fire';
/** The legacy fire pass's name (`FlipbookFx`'s `material(1)`); `flipbook-fx.node.test.ts` pins it to the legacy spelling. */
export const FLIPBOOK_FIRE_LEGACY_NAME = 'rl-flipbook-fire';

/** The TSL the VFX twins (flipbook, smoke screen) use beyond `FxTsl`. */
export type VfxTsl = FxTsl & {
  texture(value: unknown, uv: N): N;
  readonly cameraViewMatrix: N;
  readonly cameraProjectionMatrix: N;
  readonly modelWorldMatrix: N;
  Fn(body: (builder: { readonly object: unknown }) => N): () => N;
  OnBeforeObjectUpdate(cb: (frame: { readonly object: unknown }) => void): N;
  instancedDynamicBufferAttribute(value: unknown, type: string, stride: number, offset: number): N;
  mat4(...cols: N[]): N;
  length(a: N): N;
};

/** A legacy texture uniform's taps, re-synced from the record by their carrier's render update. */
export interface LateTexture {
  readonly taps: readonly N[];
  /** What the taps read while the record is still `null`. */
  readonly placeholder: THREE.Texture;
}

/** What a VFX twin carries for the specs (beside `FX_BOUND_KEY`'s uniforms): its textures by legacy uniform name. */
export const VFX_TEXTURES_KEY = 'rlVfxTextures';

const placeholders = new WeakMap<object, Map<string, THREE.Texture>>();

/**
 * A filterable 1x1 for the texture uniform `key` (linear filters: an unfilterable placeholder would compile a `textureLoad` and a
 * different binding layout). ONE PER KEY: three shares a texture binding between taps of the same texture, so two atlases built on
 * one placeholder would compile into one sampler and keep reading one image after both land.
 */
export function vfxPlaceholder(W: typeof WEBGPU, key: string): THREE.Texture {
  let byKey = placeholders.get(W);
  if (byKey === undefined) {
    byKey = new Map();
    placeholders.set(W, byKey);
  }
  let t = byKey.get(key);
  if (t === undefined) {
    const d = new W.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    d.minFilter = W.LinearFilter;
    d.magFilter = W.LinearFilter;
    d.name = `rl-vfx-placeholder-${key}`;
    d.needsUpdate = true;
    t = d;
    byKey.set(key, t);
  }
  return t;
}

/** The record reader the VFX twins share: every number and vector re-read every render; textures re-synced on a carrier. */
export function vfxRecord(W: typeof WEBGPU, TSL: VfxTsl, legacy: HasUniforms, who: string) {
  const u = legacy.uniforms;
  const bound: FxTwinBound = {};
  const textures: Record<string, LateTexture> = {};
  const carried = new Map<N, Array<() => void>>();
  const rec = (key: string): { value: unknown } => {
    const r = u[key];
    if (r === undefined) throw new Error(`${who}: the legacy material has no ${key} uniform`);
    return r;
  };
  /** A uniform over `uniforms[key]`, re-read every render (a number is replaced by its writer; a vector is copied into in place). */
  const uni = (key: string): N => {
    const hit = bound[key];
    if (hit !== undefined) return hit;
    const r = rec(key);
    const n = TSL.uniform(r.value);
    n.onRenderUpdate(() => {
      n.value = r.value;
      for (const sync of carried.get(n) ?? []) sync();
    });
    bound[key] = n;
    return n;
  };
  /** One tap of the texture `uniforms[key]` at `uv`, on a placeholder until the record holds one, re-synced by `carrier`. */
  const tap = (key: string, carrier: N, uv: N): N => {
    const r = rec(key);
    const placeholder = vfxPlaceholder(W, key);
    const value = (): unknown => (r.value === null || r.value === undefined ? placeholder : r.value);
    const t = TSL.texture(value(), uv);
    const late = (textures[key] ??= { taps: [], placeholder });
    (late.taps as N[]).push(t);
    const list = carried.get(carrier) ?? [];
    list.push(() => {
      t.value = value();
    });
    carried.set(carrier, list);
    return t;
  };
  return { bound, textures, uni, tap };
}

/**
 * The fragment's colour and alpha in one `vec4`, the alpha -1 where the legacy shader discards (every kept alpha is >= 0), so ONE
 * `Fn` call is both the `colorNode` (three's diffuse colour takes its alpha; no `opacityNode`) and, through `keptOf`, the `maskNode`.
 */
export function packFragment(TSL: VfxTsl, shaded: { col: N; alpha: N; keep: N }): N {
  return TSL.vec4(shaded.col, TSL.select((shaded.keep as NX).greaterThan(0.5), shaded.alpha, TSL.float(-1)));
}
export function keptOf(fragment: N): N {
  return (fragment.w as NX).greaterThan(-0.5);
}

/** The camera's right and up in world space: the view matrix's first two ROWS (`viewMatrix[i][0]`, `viewMatrix[i][1]`). */
export function viewRows(V: N): { right: V3s<N>; up: V3s<N> } {
  const c0 = V.element(0);
  const c1 = V.element(1);
  const c2 = V.element(2);
  return { right: { x: c0.x, y: c1.x, z: c2.x }, up: { x: c0.y, y: c1.y, z: c2.y } };
}

/** A tap's four channels. */
const channels = (t: N): Tap4<N> => ({ r: t.x, g: t.y, b: t.z, a: t.w });

export function createNodeFlipbookMaterial(
  deps: FxTwinDeps<FlipbookMaths>,
  legacy: HasUniforms,
  pass: 'smoke' | 'fire'
): WEBGPU.MeshBasicNodeMaterial {
  const { W, maths } = deps;
  const TSL = deps.TSL as VfxTsl;
  const o = tslOps(TSL) as Ops<N>;
  const { bound, textures, uni, tap } = vfxRecord(W, TSL, legacy, 'node flipbook twin');

  // ---- the vertex stage ----
  const uTime = uni('uTime');
  const uFirePass = uni('uFirePass');
  const uQuadScale = uni('uQuadScale');
  const aOrigin = TSL.attribute('aOrigin', 'vec3');
  const aVel = TSL.attribute('aVel', 'vec3');
  const aParams = TSL.attribute('aParams', 'vec4');
  const ageMs = uTime.sub(aParams.x);
  const t = ageMs.div(aParams.y);
  const age = ageMs.div(1000);
  const type = aParams.w;
  const p = maths.motionOps(o, {
    t, age, type, scale: aParams.z,
    origin: { x: aOrigin.x, y: aOrigin.y, z: aOrigin.z },
    vel: { x: aVel.x, y: aVel.y, z: aVel.z },
  });
  const V = TSL.cameraViewMatrix;
  const { right, up } = viewRows(V);
  const c = TSL.positionGeometry;
  // The mock's quad and lift; uQuadScale stays the record's (1) so a capture can still resize the quad without a rebuild.
  const world = maths.billboardOps(o, { x: p.x, y: p.y, z: p.z }, right, up, { x: c.x, y: c.y }, p.size, uQuadScale, 0.32);
  const clip = TSL.cameraProjectionMatrix.mul(V).mul(TSL.vec4(world.x, world.y, world.z, 1));
  const alive = maths.aliveOps(o, t, type, uFirePass);
  const vertex = TSL.select((alive as NX).greaterThan(0.5), clip, TSL.vec4(2, 2, 2, 1));

  // The varyings (the legacy shader's `vUv`, `vT`, `vType`, `vSeed`, `vAge`, `vTint`, `vWhite`).
  const vUvX = TSL.varying(c.x.mul(2));
  const vUvY = TSL.varying(c.y.mul(2));
  const vT = TSL.varying(t);
  const vType = TSL.varying(type);
  const vSeed = TSL.varying(TSL.attribute('aSeed', 'float'));
  const vAge = TSL.varying(age);
  const vTint = TSL.varying(TSL.attribute('aTint', 'float'));
  const vWhite = TSL.varying(TSL.attribute('aWhite', 'float'));
  // GH-1197: the per-instance alpha multiplier (`aAlpha`, 1 unless a recipe authors `alpha`), the legacy shader's `vAlpha`.
  const vAlpha = TSL.varying(TSL.attribute('aAlpha', 'float'));

  // ---- the fragment ----
  const fit = (key: string) => {
    const n = uni(key);
    return { zoom: n.x, gain: n.y, k0: n.z, k1: n.w };
  };
  const noise = (key: string) => {
    const n = uni(key);
    return { freq: n.x, disp: n.y, amp: n.z };
  };
  const uv = { x: vUvX, y: vUvY };
  const cover = maths.coverOps(o, {
    uv, seed: vSeed, age: vAge, t: vT, type: vType,
    fireFit: fit('uFireFit'), smokeFit: fit('uSmokeFit'), fireNoise: noise('uFireNoise'), smokeNoise: noise('uSmokeNoise'),
  });
  const uLight = uni('uLight');
  // BOTH atlases at BOTH frames. The taps are built here; the fragment `Fn` below makes each one a STATEMENT (`.toVar()`) before
  // anything selects, so no implicit-gradient sample sits in a branch (outside a `Fn` a var is emitted where it is first read).
  const uv0 = TSL.vec2(cover.uv0.x, cover.uv0.y);
  const uv1 = TSL.vec2(cover.uv1.x, cover.uv1.y);
  const taps = {
    fire0: tap('uFireAtlas', uLight, uv0),
    fire1: tap('uFireAtlas', uLight, uv1),
    smoke0: tap('uSmokeAtlas', uLight, uv0),
    smoke1: tap('uSmokeAtlas', uLight, uv1),
  };
  const sun = uni('uSun');
  const colors = {
    hot: uni('uHot'), fire: uni('uFire'), ember: uni('uEmber'), soot: uni('uSoot'), smoke: uni('uSmoke'),
    dirt: uni('uDirt'), dirtDark: uni('uDirtDark'), white: uni('uWhite'), whiteShade: uni('uWhiteShade'),
  };
  const knobs = {
    fireGain: uni('uFireGain'), sparkGain: uni('uSparkGain'), light: uLight, smokeAlpha: uni('uSmokeAlpha'), oilCrown: uni('uOilCrown'),
  };
  const fragment = TSL.Fn(() => {
    const fire0 = taps.fire0.toVar();
    const fire1 = taps.fire1.toVar();
    const smoke0 = taps.smoke0.toVar();
    const smoke1 = taps.smoke1.toVar();
    const shaded = maths.shadeOps(o, {
      cover,
      fire0: channels(fire0), fire1: channels(fire1), smoke0: channels(smoke0), smoke1: channels(smoke1),
      uv, t: vT, type: vType, tint: vTint, whiteAmount: vWhite, age: vAge, seed: vSeed,
      colors, ...knobs, sun: { x: sun.x, y: sun.y },
    });
    return packFragment(TSL, { ...shaded, alpha: (shaded.alpha as NX).mul(vAlpha) });
  })();

  const m = new W.MeshBasicNodeMaterial();
  m.vertexNode = vertex as never;
  m.colorNode = fragment as never;
  m.maskNode = keptOf(fragment) as never;
  finishFxTwin(m, pass === 'fire' ? NODE_FLIPBOOK_FIRE_NAME : NODE_FLIPBOOK_SMOKE_NAME, bound);
  m.userData[VFX_TEXTURES_KEY] = textures;
  return m;
}
