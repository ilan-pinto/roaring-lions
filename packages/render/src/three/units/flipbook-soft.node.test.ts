/**
 * @vitest-environment jsdom
 *
 * GH-1227 slice 1: the soft-particle fade in the flipbook's NODE twin (`flipbook-fx.node.ts`), the twin of
 * `FlipbookFx.setSoftDepth`. OFF unless the legacy smoke record carries `uSoftDepth` (only `quality.softParticles` puts it there),
 * and then the default node program is byte for byte the shipped one: its four program texts are pinned by hash, taken from the
 * twin BEFORE this change. Each spec names its one-line mutation in the commit message.
 */
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FlipbookFx } from './flipbook-fx';
import { createNodeFlipbookMaterial, VFX_TEXTURES_KEY, type FlipbookMaths, type LateTexture } from './flipbook-fx.node';
import { FX_BOUND_KEY, type FxTwinBound, type HasUniforms } from './fx.node';
import { adoptFx, compileFx, compileWgsl, maths, webgpuModules } from './fx-twin-test-kit';
import { assertNoImplicitSampleInConditional } from '../sample-uniformity';
import { copyRenderState } from '../twin-identity';
import type { SoftDepthSource } from '../soft-depth';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
/** The shipped twin's programs (smoke and fire compile alike: the pass is a uniform), hashed at 003d06941 before the soft twin. */
const SHIPPED = Object.freeze({ glslV: '3330c0a48c766efa', glslF: 'bb5099bcf13043bf', wgslV: 'fd238bf5a1781a99', wgslF: 'd982f34589ab58a6' });

const source = (): SoftDepthSource => {
  const d = new THREE.DepthTexture(4, 4, THREE.UnsignedInt248Type);
  d.format = THREE.DepthStencilFormat;
  return { depthTexture: d, invSize: new THREE.Vector2(0.25, 0.25) };
};

type Programs = Record<keyof typeof SHIPPED, string>;
async function programs(mesh: THREE.Mesh): Promise<Programs> {
  const g = await compileFx(mesh);
  const w = await compileWgsl(mesh);
  return { glslV: hash(g.vertex), glslF: hash(g.fragment), wgslV: hash(w.vertex), wgslF: hash(w.fragment) };
}

/** A twin built directly with a spy on `softOps`, so a spec can see what the fade was handed. */
async function spiedTwin(pass: 'smoke' | 'fire', legacy: HasUniforms, mesh: THREE.Mesh) {
  const { W, TSL } = await webgpuModules();
  const calls: unknown[][] = [];
  const spy: FlipbookMaths = { ...maths.flipbook, softOps: ((...a: unknown[]) => (calls.push(a), (maths.flipbook.softOps as (...x: unknown[]) => unknown)(...a))) as FlipbookMaths['softOps'] };
  const twin = createNodeFlipbookMaterial({ W, TSL, maths: spy }, legacy, pass);
  copyRenderState(legacy as never, twin);
  mesh.material = twin as never;
  await compileFx(mesh);
  return { twin, calls, TSL };
}

describe('flipbook node twin, soft particles (GH-1227)', () => {
  it('off: the default smoke and fire twins compile to the shipped programs, byte for byte', async () => {
    for (const pass of ['smoke', 'fire'] as const) {
      const fx = new FlipbookFx(8);
      const mesh = pass === 'smoke' ? fx.mesh : fx.fireMesh;
      const twin = await adoptFx(mesh);
      expect(await programs(mesh), pass).toEqual(SHIPPED);
      expect(Object.keys(twin.userData[FX_BOUND_KEY] as FxTwinBound).filter((k) => k.startsWith('uSoft')), pass).toEqual([]);
      expect(Object.keys(twin.userData[VFX_TEXTURES_KEY] as Record<string, LateTexture>), pass).not.toContain('uSoftDepth');
    }
  });

  it('on: the smoke twin fades by the INJECTED depth texture, at the screen uv, with the record span', async () => {
    const fx = new FlipbookFx(8);
    const src = source();
    fx.setSoftDepth(src);
    const legacy = fx.mesh.material as unknown as HasUniforms;
    const { twin, calls, TSL } = await spiedTwin('smoke', legacy, fx.mesh);
    expect(calls.length).toBe(1);
    const [, sceneDepth, , span] = calls[0]!;
    const bound = twin.userData[FX_BOUND_KEY] as FxTwinBound;
    expect(span).toBe(bound.uSoftSpan);
    const textures = twin.userData[VFX_TEXTURES_KEY] as Record<string, LateTexture>;
    const depthTap = textures.uSoftDepth!.taps[0] as unknown as { value: unknown; uvNode: unknown };
    expect(textures.uSoftDepth!.taps.length).toBe(1);
    expect(depthTap.value).toBe(src.depthTexture);
    expect(depthTap.uvNode).toBe((TSL as unknown as { screenUV: unknown }).screenUV);
    // The fade reads that tap (through its statement var), not another texture.
    expect((sceneDepth as { node?: unknown }).node).toBe(depthTap);
    expect(bound.uSoftInvSize).toBeUndefined();
  });

  it("on: the fade's value reaches the fragment's alpha (a marker returned by softOps is in the program)", async () => {
    const { W, TSL } = await webgpuModules();
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(source());
    const legacy = fx.mesh.material as unknown as HasUniforms;
    const marker: FlipbookMaths = { ...maths.flipbook, softOps: (() => TSL.float(0.4242)) as unknown as FlipbookMaths['softOps'] };
    const twin = createNodeFlipbookMaterial({ W, TSL, maths: marker }, legacy, 'smoke');
    copyRenderState(legacy as never, twin);
    fx.mesh.material = twin as never;
    expect((await compileWgsl(fx.mesh)).fragment).toContain('0.4242');
  });

  it('on: the program differs from the shipped one, and its depth sample sits in uniform control flow', async () => {
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(source());
    await adoptFx(fx.mesh);
    const p = await programs(fx.mesh);
    expect(p.wgslF).not.toBe(SHIPPED.wgslF);
    expect(p.glslF).not.toBe(SHIPPED.glslF);
    const w = await compileWgsl(fx.mesh);
    expect(w.fragment).toContain('texture_depth_2d');
    assertNoImplicitSampleInConditional(w.fragment);
  });

  it("on: the fade's fragment depth is the orthographic view depth of the fragment, never a camera constant", async () => {
    const { W, TSL } = await webgpuModules();
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(source());
    const legacy = fx.mesh.material as unknown as HasUniforms;
    const seen: { args: unknown[]; out: unknown }[] = [];
    const real = (TSL as unknown as { viewZToOrthographicDepth: (...a: unknown[]) => unknown }).viewZToOrthographicDepth;
    const wrapped = { ...(TSL as object), viewZToOrthographicDepth: (...a: unknown[]) => { const out = real(...a); seen.push({ args: a, out }); return out; } };
    const calls: unknown[][] = [];
    const spy: FlipbookMaths = { ...maths.flipbook, softOps: ((...a: unknown[]) => (calls.push(a), (maths.flipbook.softOps as (...x: unknown[]) => unknown)(...a))) as FlipbookMaths['softOps'] };
    const twin = createNodeFlipbookMaterial({ W, TSL: wrapped as never, maths: spy }, legacy, 'smoke');
    copyRenderState(legacy as never, twin);
    fx.mesh.material = twin as never;
    await compileFx(fx.mesh);
    // The depth term comes from the view-space depth conversion, fed the camera's near and far, and that very node reaches the fade.
    expect(seen.length).toBe(1);
    const T = TSL as unknown as { cameraNear: unknown; cameraFar: unknown };
    expect(seen[0]!.args[1]).toBe(T.cameraNear);
    expect(seen[0]!.args[2]).toBe(T.cameraFar);
    expect(calls[0]![2]).toBe(seen[0]!.out);
    expect(calls[0]![2]).not.toBe(T.cameraNear);
  });

  it('the fire pass never fades, even handed a record that carries the soft uniforms', async () => {
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(source());
    const smokeRecord = (fx.mesh.material as unknown as HasUniforms).uniforms;
    const fireRecord = (fx.fireMesh.material as unknown as HasUniforms).uniforms;
    const fireLegacy = { uniforms: { ...fireRecord, uSoftDepth: smokeRecord.uSoftDepth, uSoftInvSize: smokeRecord.uSoftInvSize, uSoftSpan: smokeRecord.uSoftSpan } } as unknown as HasUniforms;
    const { calls } = await spiedTwin('fire', fireLegacy, fx.fireMesh);
    expect(calls.length).toBe(0);
  });

  it('off again: a twin built after setSoftDepth(null) is the shipped one', async () => {
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(source());
    fx.setSoftDepth(null);
    await adoptFx(fx.mesh);
    expect(await programs(fx.mesh)).toEqual(SHIPPED);
  });
});
