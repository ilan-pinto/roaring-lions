/**
 * @vitest-environment jsdom
 *
 * GH-1227 slice 4: the soft-particle depth fade in the particle NODE twin (`fx.node.ts`'s `createNodeParticleMaterial`), the twin of
 * `ParticleInstancer.setSoftDepth`. OFF unless the legacy record carries `uSoftDepth` (only `quality.softParticles` puts it there) and
 * the material is the depth-tested normal tier; then the default twin is byte for byte the shipped one, pinned by hash LITERALS taken
 * from the twin BEFORE this change (ids of the instance buffer normalised: they come from a process-wide counter). Each spec's one-line
 * mutation is listed in the commit message.
 */
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ParticleInstancer } from './fx';
import { createNodeParticleMaterial, type HasUniforms, type ParticleMaths } from './fx.node';
import { adoptFx, compileFx, compileWgsl, maths, webgpuModules } from './fx-twin-test-kit';
import { assertNoImplicitSampleInConditional } from '../sample-uniformity';
import { copyRenderState } from '../twin-identity';
import type { SoftDepthSource } from '../soft-depth';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

const norm = (s: string): string => s.replace(/(NodeBuffer_|buffer)\d+/g, '$1N');
const hash = (s: string): string => createHash('sha256').update(norm(s)).digest('hex').slice(0, 16);
/** The shipped particle twins' programs (the tier does not change them; the hot core has its own), hashed before the soft twin. */
const SHIPPED = Object.freeze({
  normal: { glslV: '9fb3bdf77dc361c8', glslF: 'fa4c74dceaa4770c', wgslV: 'c7ba81f1156636a8', wgslF: '0054f1e6f74a61fe' },
  hot: { glslV: '406af9773c1c3c8a', glslF: 'f7050b3f8685b2e1', wgslV: 'eaeeaf99198b15c1', wgslF: '99cab4987d388d55' },
});

const source = (): SoftDepthSource => {
  const d = new THREE.DepthTexture(4, 4, THREE.UnsignedInt248Type);
  d.format = THREE.DepthStencilFormat;
  return { depthTexture: d, invSize: new THREE.Vector2(0.25, 0.25) };
};

async function programs(mesh: THREE.Mesh) {
  const g = await compileFx(mesh);
  const w = await compileWgsl(mesh);
  return { glslV: hash(g.vertex), glslF: hash(g.fragment), wgslV: hash(w.vertex), wgslF: hash(w.fragment) };
}

/** A twin built directly with a spy on `depthFadeOps`, so a spec can see what the fade was handed. */
async function spiedTwin(inst: ParticleInstancer, legacy: HasUniforms, over?: Partial<ParticleMaths>, tsl?: (t: never) => never) {
  const { W, TSL } = await webgpuModules();
  const calls: unknown[][] = [];
  const spy: ParticleMaths = {
    ...maths.particle,
    depthFadeOps: ((...a: unknown[]) => (calls.push(a), (maths.particle.depthFadeOps as (...x: unknown[]) => unknown)(...a))) as ParticleMaths['depthFadeOps'],
    ...over,
  };
  const twin = createNodeParticleMaterial({ W, TSL: (tsl ? tsl(TSL as never) : TSL) as never, maths: spy }, legacy as never);
  copyRenderState(legacy as never, twin);
  inst.mesh.material = twin as never;
  // The fade is built inside the fragment's `Fn`, which three runs at program build.
  await compileFx(inst.mesh);
  return { twin, calls, TSL };
}

describe('particle node twin, soft particles (GH-1227 slice 4)', () => {
  it('off: the default normal and hot twins compile to the shipped programs, byte for byte', async () => {
    for (const hot of [false, true]) {
      const inst = new ParticleInstancer(8, 0, true, hot);
      await adoptFx(inst.mesh);
      expect(await programs(inst.mesh), hot ? 'hot' : 'normal').toEqual(hot ? SHIPPED.hot : SHIPPED.normal);
    }
    // The above tier (depth test off) compiles to the same fragment as the below tier.
    const above = new ParticleInstancer(8, 0, false, false);
    await adoptFx(above.mesh);
    expect((await programs(above.mesh)).wgslF).toBe(SHIPPED.normal.wgslF);
  });

  it('on: the twin fades by the INJECTED depth texture at the screen uv, with the record span, and reads the size attribute', async () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    const src = source();
    inst.setSoftDepth(src);
    const legacy = inst.mesh.material as unknown as HasUniforms;
    const { twin, calls, TSL } = await spiedTwin(inst, legacy);
    expect(calls.length).toBe(1);
    const [, sceneDepth, fragDepth, span, size] = calls[0]!;
    // The depth tap: a texture node over the injected depth texture at screenUV, through its statement var.
    const tap = (sceneDepth as { node?: { value: unknown; uvNode: unknown } }).node!;
    expect(tap.value).toBe(src.depthTexture);
    expect(tap.uvNode).toBe((TSL as unknown as { screenUV: unknown }).screenUV);
    // The span is the record's number, re-read every render.
    expect((span as { value: number }).value).toBe(1);
    (legacy.uniforms.uSoftSpan as { value: number }).value = 400;
    (span as { update?: () => void; value: number }).update?.();
    const T = TSL as unknown as { cameraNear: unknown; cameraFar: unknown };
    expect(fragDepth).not.toBe(T.cameraNear);
    expect(fragDepth).not.toBe(T.cameraFar);
    expect(size).toBeDefined();
    // The colour is the plain instance colour: the fade reaches the opacity only.
    expect((twin.colorNode as unknown as { getAttributeName(): string }).getAttributeName()).toBe('aColor');
    const c = await compileFx(inst.mesh);
    expect(c.vertex).toContain('aSize');
  });

  it("on: the fade's value reaches the opacity (a marker returned by the fade is in the program), and the program differs from the shipped one", async () => {
    const { TSL } = await webgpuModules();
    const inst = new ParticleInstancer(8, 0, true, false);
    inst.setSoftDepth(source());
    const legacy = inst.mesh.material as unknown as HasUniforms;
    await spiedTwin(inst, legacy, { depthFadeOps: (() => TSL.float(0.4242)) as unknown as ParticleMaths['depthFadeOps'] });
    expect((await compileWgsl(inst.mesh)).fragment).toContain('0.4242');
    const real = new ParticleInstancer(8, 0, true, false);
    real.setSoftDepth(source());
    await adoptFx(real.mesh);
    const p = await programs(real.mesh);
    expect(p.wgslF).not.toBe(SHIPPED.normal.wgslF);
    expect(p.glslF).not.toBe(SHIPPED.normal.glslF);
  });

  it('on: the depth sample is a depth-texture tap in uniform control flow', async () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    inst.setSoftDepth(source());
    await adoptFx(inst.mesh);
    const w = await compileWgsl(inst.mesh);
    expect(w.fragment).toContain('texture_depth_2d');
    assertNoImplicitSampleInConditional(w.fragment);
  });

  it("on: the fade's fragment depth is the orthographic view depth of the fragment, never a camera constant", async () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    inst.setSoftDepth(source());
    const legacy = inst.mesh.material as unknown as HasUniforms;
    const seen: { args: unknown[]; out: unknown }[] = [];
    const { calls, TSL } = await spiedTwin(inst, legacy, undefined, (t) => {
      const real = (t as unknown as { viewZToOrthographicDepth: (...a: unknown[]) => unknown }).viewZToOrthographicDepth;
      return { ...(t as object), viewZToOrthographicDepth: (...a: unknown[]) => { const out = real(...a); seen.push({ args: a, out }); return out; } } as never;
    });
    expect(seen.length).toBe(1);
    const T = TSL as unknown as { cameraNear: unknown; cameraFar: unknown };
    expect(seen[0]!.args[1]).toBe(T.cameraNear);
    expect(seen[0]!.args[2]).toBe(T.cameraFar);
    expect(calls[0]![2]).toBe(seen[0]!.out);
  });

  it('the hot core and the above tier never fade, even handed a record that carries the soft uniforms', async () => {
    const donor = new ParticleInstancer(8, 0, true, false);
    donor.setSoftDepth(source());
    const record = (donor.mesh.material as unknown as HasUniforms).uniforms;
    for (const [name, depthTest, hot] of [['hot', true, true], ['above', false, false], ['above-hot', false, true]] as const) {
      const inst = new ParticleInstancer(8, 0, depthTest, hot);
      const legacy = inst.mesh.material as unknown as { uniforms: Record<string, { value: unknown }> };
      legacy.uniforms.uSoftDepth = record.uSoftDepth!;
      legacy.uniforms.uSoftInvSize = record.uSoftInvSize!;
      legacy.uniforms.uSoftSpan = record.uSoftSpan!;
      const { calls } = await spiedTwin(inst, legacy as unknown as HasUniforms);
      expect(calls.length, name).toBe(0);
    }
  });

  it('off again: a twin built after setSoftDepth(null) is the shipped one', async () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    inst.setSoftDepth(source());
    inst.setSoftDepth(null);
    await adoptFx(inst.mesh);
    expect(await programs(inst.mesh)).toEqual(SHIPPED.normal);
  });
});
