/**
 * GH-943 WebGPU P3 (T12): the NODE twin of the smoke screen's legacy material (`smoke-mesh.ts`, `rl-smoke-screen`): a lit, standing,
 * camera-facing puff per instance, sampling the flipbook's smoke atlas at frame `12 + floor(seed * 8)`. An unlit, fog-blind
 * `MeshBasicNodeMaterial` (`toneMapped = false`, `fog = false`: the legacy shader writes linear colour into the HalfFloat scene
 * target); the pipeline state (`DoubleSide`, depth test on, depth write off) is the legacy material's, copied by adoption.
 *
 * **The vertex stage** is a clip-space `vertexNode`, as the legacy shader: the puff's centre and its two axes from the INSTANCE
 * MATRIX, the billboard from the view matrix rows, `vAng = atan(ax.z, ax.x)`. three's own instance step only transforms
 * `positionLocal` (which this stage does not read), so the matrix columns are read here from the mesh's `instanceMatrix` through a
 * second instanced view of the same array, kept in step with it before every draw (`OnBeforeObjectUpdate`).
 *
 * **The fragment**: the billow at `FX_DETAIL` (a JS choice: 0 builds no noise at all, 1 one fbm chain, 2 both; `vfx-noise.ts`), the
 * atlas tapped UNCONDITIONALLY (a statement before anything selects), then the atlas read and the procedural puff both computed and
 * `uReady` selecting (`smokeScreenShadeOps`). The two discards are the `maskNode`.
 *
 * **The clock** is the legacy record's `uClock` (the FRAME clock `ThreeRenderer.smokeClockMs` hands `SmokeMesh.update`), re-read every
 * render. **The uniforms stay a record**, re-read every render; `SmokeMesh` holds its legacy material apart (`update`, `setLook`
 * write its record, never `mesh.material`). **The atlas is bound late** (`setLook` once the flipbook's lands): the tap is built on a
 * placeholder and re-synced from the record on `uReady`'s render update; `uReady` 0 selects the procedural puff meanwhile.
 *
 * ADDON-FREE. TSL arrives injected; the maths as VALUES (`material-maths.ts`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from './fog-pass.node';
import type { Ops } from './fog-ops';
import type { smokeScreenCoverOps, smokeScreenPuffOps, smokeScreenShadeOps } from './smoke-mesh';
import type { vfxBillboardOps, VfxDetail } from './units/vfx-noise';
import { finishFxTwin, type FxTwinDeps, type HasUniforms } from './units/fx.node';
import { keptOf, packFragment, vfxRecord, viewRows, VFX_TEXTURES_KEY, type VfxTsl } from './units/flipbook-fx.node';

/** The smoke screen maths, INJECTED (`material-maths.ts`'s `smokeScreen` slot). */
export interface SmokeScreenMaths {
  readonly coverOps: typeof smokeScreenCoverOps;
  readonly shadeOps: typeof smokeScreenShadeOps;
  readonly puffOps: typeof smokeScreenPuffOps;
  readonly billboardOps: typeof vfxBillboardOps;
}

export const NODE_SMOKE_SCREEN_NAME = 'rl-node-material-smoke-screen';

/** The instanced mesh the vertex stage reads its matrices from (structural: the twin never names the legacy class). */
interface InstancedLike {
  readonly instanceMatrix?: { readonly array: Float32Array; readonly version: number; readonly usage: number };
}
/** A second instanced view of one `instanceMatrix` array, by attribute: one per mesh, versioned with it. */
const views = new WeakMap<object, { version: number; readonly array: ArrayLike<number> }>();

/** The view the vertex stage reads `instanceMatrix` through (specs: it shares the array and follows the version). */
export function smokeInstanceView(instanceMatrix: object): { readonly version: number; readonly array: ArrayLike<number> } | undefined {
  return views.get(instanceMatrix);
}

export function createNodeSmokeScreenMaterial(deps: FxTwinDeps<SmokeScreenMaths>, legacy: HasUniforms, fxDetail: VfxDetail): WEBGPU.MeshBasicNodeMaterial {
  const { W, maths } = deps;
  const TSL = deps.TSL as VfxTsl;
  const o = tslOps(TSL) as Ops<N>;
  const { bound, textures, uni, tap } = vfxRecord(W, TSL, legacy, 'node smoke-screen twin');

  // ---- the vertex stage ----
  const instance = TSL.Fn((builder: { readonly object: unknown }) => {
    const im = (builder.object as InstancedLike).instanceMatrix;
    if (im === undefined) throw new Error('node smoke-screen twin: drawn on an object with no instanceMatrix (the smoke screen is an InstancedMesh)');
    let view = views.get(im);
    if (view === undefined) {
      view = new W.InstancedInterleavedBuffer(im.array, 16, 1);
      views.set(im, view);
    }
    const ib = view;
    // Before the draw uploads attributes: the view follows the matrix's own version (`SmokeMesh.update` sets `needsUpdate`).
    TSL.OnBeforeObjectUpdate(() => {
      if (ib.version !== im.version) ib.version = im.version;
    });
    const col = (offset: number): N => TSL.instancedDynamicBufferAttribute(ib, 'vec4', 16, offset);
    return TSL.mat4(col(0), col(4), col(8), col(12));
  });
  const M = instance();
  const col = (i: number) => {
    const m = M.element(i);
    return { x: m.x, y: m.y, z: m.z };
  };
  const m0 = col(0);
  const puff = maths.puffOps(o, m0, col(2));
  const V = TSL.cameraViewMatrix;
  const { right, up } = viewRows(V);
  const c = TSL.positionGeometry;
  // The quad lies in xz (`position.xz` is the corner), the centre is column 3.
  const world = maths.billboardOps(o, col(3), right, up, { x: c.x, y: c.z }, puff.size, TSL.float(1), 0);
  const vertex = TSL.cameraProjectionMatrix.mul(V).mul(TSL.modelWorldMatrix).mul(TSL.vec4(world.x, world.y, world.z, 1));
  const vUvX = TSL.varying(c.x);
  const vUvY = TSL.varying(c.z);
  const vAlpha = TSL.varying(TSL.attribute('aAlpha', 'float'));
  const vSeed = TSL.varying(TSL.attribute('aSeed', 'float'));
  const vAng = TSL.varying(puff.ang);

  // ---- the fragment ----
  const uv = { x: vUvX, y: vUvY };
  const cs = TSL.cos(vAng);
  const sn = TSL.sin(vAng);
  const cover = maths.coverOps(o, { uv, cs, sn, seed: vSeed, clock: uni('uClock') }, fxDetail);
  const uReady = uni('uReady');
  // The atlas tap, built here and made a STATEMENT inside the fragment `Fn` before anything selects (no implicit-gradient sample
  // in a branch: outside a `Fn` a var is emitted where it is first read).
  const atlas = tap('uAtlas', uReady, TSL.vec2(cover.uv.x, cover.uv.y));
  const sun = uni('uSun');
  const look = { lit: uni('uLit'), shade: uni('uShade'), light: uni('uLight') };
  const fragment = TSL.Fn(() => {
    const s = atlas.toVar();
    const shaded = maths.shadeOps(o, {
      uv, cs, sn, b: cover.b, s: { r: s.x, g: s.y, b: s.z }, ready: uReady, alpha: vAlpha, ...look, sun: { x: sun.x, y: sun.y },
    });
    return packFragment(TSL, shaded);
  })();

  const m = new W.MeshBasicNodeMaterial();
  m.vertexNode = vertex as never;
  m.colorNode = fragment as never;
  m.maskNode = keptOf(fragment) as never;
  finishFxTwin(m, NODE_SMOKE_SCREEN_NAME, bound);
  m.userData[VFX_TEXTURES_KEY] = textures;
  return m;
}
