/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T11) gates for `fx.node.ts`: the particle disc and the tracer ribbon. The maths runs on numbers against LITERALS; the
 * wiring runs on the generated program text of the REAL batches' meshes (three's own `GLSLNodeBuilder`, no GPU). Each spec names its
 * one-line mutation in the commit message.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { HDR_GAINS } from './hdr-gains';
import { ParticleInstancer, ShellBatch, TracerBatch, softParticleOps } from './fx';
import { createNodeParticleMaterial, FX_BOUND_KEY, HOT_PARTICLE_NAME, type FxTwinBound } from './fx.node';
import { copyRenderState } from '../twin-identity';
import { adoptFx, compileFx, maths, webgpuModules, type Updatable } from './fx-twin-test-kit';

const boundOf = (m: THREE.Material): FxTwinBound => m.userData[FX_BOUND_KEY] as FxTwinBound;

/** A literal feather, the shader's `1 - smoothstep(0.15, 1, d)`, spelled out here and not imported. */
const feather = (d: number): number => {
  const t = Math.min(1, Math.max(0, (d - 0.15) / (1 - 0.15)));
  return 1 - t * t * (3 - 2 * t);
};

describe('the particle coverage on numbers (literals)', () => {
  const at = (lx: number, ly: number, alpha: number, soft: number, hot: boolean) => softParticleOps(NUMBER_OPS, { localX: lx, localY: ly, alpha, soft }, hot);

  it('the feather is flat to |local| 0.15, 0.5 of the way across at the midpoint of the ramp, and 0 at the rim', () => {
    expect(at(0.15, 0, 0.8, 1, false).alpha).toBeCloseTo(0.8, 12);
    expect(at(1, 0, 0.8, 1, false).alpha).toBeCloseTo(0, 12);
    // Just past the core: 0.175 is 0.025 / 0.85 of the way up the smoothstep, so the alpha has begun to fall.
    expect(at(0.175, 0, 1, 1, false).alpha).toBeCloseTo(feather(0.175), 12);
    expect(at(0.175, 0, 1, 1, false).alpha).toBeLessThan(1);
    expect(at(0.575, 0, 1, 1, false).alpha).toBeCloseTo(0.5, 12);
    // |local| is the length, not a single axis.
    expect(at(0.3, 0.4, 1, 1, false).alpha).toBeCloseTo(feather(0.5), 12);
  });
  it('soft 0 keeps the hard fill: a spark, a shard or a ring is untouched', () => {
    expect(at(0.9, 0, 0.6, 0, false).alpha).toBeCloseTo(0.6, 12);
  });
  it('the hot core pins alpha to 1 whatever the instance alpha, and still feathers a soft hot core', () => {
    expect(at(0, 0, 0.1, 0, true).alpha).toBe(1);
    expect(at(0.5, 0, 0.1, 0, true).alpha).toBe(1);
    expect(at(0.575, 0, 0.1, 1, true).alpha).toBeCloseTo(0.5, 12);
  });
  it('r2 is the squared disc radius the cutout tests against 1', () => {
    expect(at(0.6, 0.8, 1, 0, false).r2).toBeCloseTo(1, 12);
    expect(at(0.8, 0.8, 1, 0, false).r2).toBeCloseTo(1.28, 12);
  });
});

async function particle(hot: boolean, over?: Partial<typeof maths.particle>) {
  const { W, TSL } = await webgpuModules();
  const inst = new ParticleInstancer(8, 0, true, hot);
  const legacy = inst.mesh.material as THREE.Material;
  // The twin with the legacy pipeline state copied on (as adoption does), with the maths overridable.
  const twin = createNodeParticleMaterial({ W, TSL, maths: { ...maths.particle, ...over } }, legacy);
  copyRenderState(legacy, twin);
  inst.mesh.material = twin as never;
  return { inst, legacy, twin, mesh: inst.mesh };
}

describe('the particle twin graph', () => {
  it('reads the hot core from the legacy name, spelled as the legacy factory spells it', async () => {
    const cold = new ParticleInstancer(2, 0, true, false).mesh.material as THREE.Material;
    const hot = new ParticleInstancer(2, 0, true, true).mesh.material as THREE.Material;
    expect(hot.name).toBe(HOT_PARTICLE_NAME);
    expect(cold.name).not.toBe(HOT_PARTICLE_NAME);
  });

  it('wires aLocal, aColor, aAlpha and aSoft, and discards outside the disc', async () => {
    const { mesh } = await particle(false);
    const c = await compileFx(mesh);
    for (const a of ['aLocal', 'aColor', 'aAlpha', 'aSoft']) expect(c.vertex, a).toContain(a);
    expect(c.fragment).toMatch(/<= 1\.0 \) \) \) \{\s*discard;/);
    // The feather reaches the shader with the core constant.
    expect(c.fragment).toContain('smoothstep( 0.15, 1.0');
  });

  it('the hot core ignores its own instance alpha: aAlpha is not read, alpha is 1', async () => {
    const { mesh } = await particle(true);
    const c = await compileFx(mesh);
    expect(c.vertex).not.toContain('aAlpha');
    for (const a of ['aLocal', 'aColor', 'aSoft']) expect(c.vertex, a).toContain(a);
  });

  it('G3: the hot gain is the value handed in, and the table\'s sparks gain is 4', async () => {
    expect(HDR_GAINS.sparks).toBe(4);
    expect(maths.particle.sparksGain).toBe(4);
    const shipped = await compileFx((await particle(true)).mesh);
    expect(shipped.fragment).toMatch(/nodeVarying\d+ \* vec3\( 4\.0 \)/);
    // A different gain handed in reaches the program: a gain typed into the twin would still read 4.
    const seven = await compileFx((await particle(true, { sparksGain: 7 })).mesh);
    expect(seven.fragment).toMatch(/nodeVarying\d+ \* vec3\( 7\.0 \)/);
    expect(seven.fragment).not.toContain('vec3( 4.0 )');
    // The cold sibling carries no gain at all.
    const cold = await compileFx((await particle(false)).mesh);
    expect(cold.fragment).not.toMatch(/\* vec3\( \d+\.\d+ \)/);
  });

  it('G4: no clock of its own', async () => {
    for (const hot of [false, true]) expect((await compileFx((await particle(hot)).mesh)).frameClocked).toEqual([]);
  });
});

describe('the tracer twin graph', () => {
  async function tracer(batch: TracerBatch | ShellBatch) {
    const twin = await adoptFx(batch.mesh);
    return { twin, legacy: batch.mesh.material };
  }

  it('wires aColor, aAlpha and the uHdr record, with the colour times uHdr and alpha from aAlpha', async () => {
    const batch = new TracerBatch(4);
    const legacy = batch.mesh.material as THREE.ShaderMaterial;
    const { twin } = await tracer(batch);
    const c = await compileFx(batch.mesh);
    for (const a of ['aColor', 'aAlpha']) expect(c.vertex, a).toContain(a);
    expect(c.uniforms.has(boundOf(twin).uHdr)).toBe(true);
    expect(c.fragment).toMatch(/vec4\( \( nodeVarying\d+ \* vec3\( nodeUniform\d+ \) \), 1\.0 \)/);
    expect(c.fragment).toMatch(/DiffuseColor\.w = \( DiffuseColor\.w \* nodeVarying\d+ \);/);
    expect(legacy.uniforms.uHdr?.value).toBe(1);
  });

  it('re-reads uHdr from the legacy record every render: bolt 4 and arc 3.5, from the table', async () => {
    for (const [depthTest, gain] of [[true, 4], [false, 3.5]] as const) {
      const batch = new ShellBatch(4, { depthTest });
      const legacy = batch.mesh.material;
      const { twin } = await tracer(batch);
      const node = boundOf(twin).uHdr as unknown as Updatable;
      node.update();
      expect(node.value).toBe(gain);
      expect(gain).toBe(depthTest ? HDR_GAINS.bolt : HDR_GAINS.arc);
      // A later write to the legacy record (not through the mesh, which holds the twin now) reaches the twin.
      legacy.uniforms.uHdr!.value = 2.25;
      node.update();
      expect(node.value).toBe(2.25);
    }
  });

  it('G4: no clock of its own; and the control: a graph that reads `time` is seen', async () => {
    const batch = new TracerBatch(4);
    await adoptFx(batch.mesh);
    expect((await compileFx(batch.mesh)).frameClocked).toEqual([]);
    const { W, TSL } = await webgpuModules();
    const m = new W.MeshBasicNodeMaterial();
    m.colorNode = TSL.vec3((TSL as unknown as { time: never }).time) as never;
    expect((await compileFx(new THREE.Mesh(new THREE.BoxGeometry(), m as never))).frameClocked).toHaveLength(1);
  });
});
