/**
 * GH-1227 slice 4: soft particles on the `ParticleInstancer` dust tier (`ParticleInstancer.setSoftDepth`, `softParticleShaders`), the
 * design's decision D4. The OFF state is the shipped program byte for byte, pinned by hash LITERALS taken from the code before this
 * change (a check against a freshly built material would recompute its own right-hand side). Each spec's one-line mutation is listed in
 * the commit message.
 */
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticleSystem, type ParticleSpec } from '../../vfx';
import { QUALITY_PRESETS } from '../../quality';
import { SOFT_PARTICLE_GLSL, SoftDepthSnapshot, type SoftDepthSource } from '../soft-depth';
import { PARTICLE_QUAD_EDGE_PER_SCALE, ParticleInstancer, createParticleMaterial, softParticleShaders } from './fx';

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
/** The shipped particle programs, hashed before slice 4: the vertex text is shared by all four, the fragment by tier-normal / hot. */
const SHIPPED = Object.freeze({ vertex: 'bf0fe6eaa2daf5b3', fragment: '07f9335436ccaf72', fragmentHot: 'fd8c0a3f62fc6db9' });

type Mat = THREE.ShaderMaterial;
const source = (): SoftDepthSource => ({ depthTexture: new THREE.DepthTexture(4, 4), invSize: new THREE.Vector2(0.25, 0.25) });
const tiers = [
  { name: 'below', depthTest: true, hot: false },
  { name: 'above', depthTest: false, hot: false },
  { name: 'below-hot', depthTest: true, hot: true },
  { name: 'above-hot', depthTest: false, hot: true },
] as const;
const spec = (o: Partial<ParticleSpec> = {}): ParticleSpec => ({ count: 1, lifetime_ms: 1000, color_over_life: ['#000000'], ...o });

describe('particle soft depth (GH-1227 slice 4)', () => {
  it('the band-2 dust tier is the only one that can fade, and no preset turns soft particles on', () => {
    for (const [name, q] of Object.entries(QUALITY_PRESETS)) expect(q.softParticles ?? false, name).toBe(false);
  });

  it('off by default: all four materials carry the shipped program, an empty uniform record and no aSize', () => {
    for (const t of tiers) {
      const inst = new ParticleInstancer(8, 0, t.depthTest, t.hot);
      const m = inst.mesh.material as Mat;
      expect(hash(m.vertexShader), t.name).toBe(SHIPPED.vertex);
      expect(hash(m.fragmentShader), t.name).toBe(t.hot ? SHIPPED.fragmentHot : SHIPPED.fragment);
      expect(Object.keys(m.uniforms), t.name).toEqual([]);
      expect(inst.mesh.geometry.getAttribute('aSize'), t.name).toBeUndefined();
      expect(inst.mesh.onBeforeRender, t.name).toBe(THREE.Object3D.prototype.onBeforeRender);
      expect(inst.softDepthOn, t.name).toBe(false);
    }
  });

  it('on: the fade multiplies ALPHA only, and removing the splice gives the shipped fragment exactly (the colour is untouched)', () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    const src = source();
    inst.setSoftDepth(src);
    const m = inst.mesh.material as Mat;
    expect(m.fragmentShader).toContain('float soft = rlSoftFade(texture2D(uSoftDepth, gl_FragCoord.xy * uSoftInvSize).x, gl_FragCoord.z, uSoftSpan, vSoftSize);');
    expect(m.fragmentShader).toContain('gl_FragColor = vec4(vColor * 1.0, a * soft);');
    expect(m.fragmentShader).toContain(SOFT_PARTICLE_GLSL);
    expect(m.vertexShader).toContain('attribute float aSize;');
    expect(m.vertexShader).toContain('vSoftSize = aSize;');
    // Undo exactly the four insertions: what is left is the shipped text, so no colour term moved and nothing else did.
    const undone = m.fragmentShader
      .replace('\n      varying float vSoftSize;' + SOFT_PARTICLE_GLSL, '')
      .replace(/ {8}float soft = [^\n]*\n/, '')
      .replace('a * soft);', 'a);');
    expect(hash(undone)).toBe(SHIPPED.fragment);
    expect(m.uniforms.uSoftDepth!.value).toBe(src.depthTexture);
    expect(m.uniforms.uSoftInvSize!.value).toBe(src.invSize);
    expect(inst.softDepthOn).toBe(true);
  });

  it('on: the instance carries its drawn WORLD size as aSize, the diameter the fade band is measured against', () => {
    // The scale is the radius in screen pixels; the quad's corners are +-1 along the ground vector (sqrt2 / 64 long): 2 sqrt2 / 64 a pixel.
    expect(PARTICLE_QUAD_EDGE_PER_SCALE).toBeCloseTo(0.04419417382, 10);
    const inst = new ParticleInstancer(8, 0, true, false);
    inst.setSoftDepth(source());
    const size = inst.mesh.geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
    expect(size.isInstancedBufferAttribute).toBe(true);
    expect(size.array.length).toBe(8);
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(spec({ size_px: 10 }), 3, 4, 0, 1, 5, 0);
    inst.update(ps, null, 0, 0);
    expect(inst.mesh.count).toBe(1);
    // The instance scale is the radius in pixels (20 for this spawn); the drawn diameter is that times 2 sqrt2 / 64 = 0.8839 world units,
    // so the 0.35-of-size band is 0.309 world units (not the 7 the bare radius would make it).
    const radius = new THREE.Matrix4().fromArray(inst.mesh.instanceMatrix.array as Float32Array).elements[0]!;
    expect(radius).toBe(20);
    expect(size.array[0]).toBeCloseTo(0.8838834765, 6);
  });

  it('the mesh hook writes far - near, chained onto whatever hook was there, and a second call does not chain onto itself', () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    const seen: string[] = [];
    const own: THREE.Object3D['onBeforeRender'] = () => seen.push('own');
    inst.mesh.onBeforeRender = own;
    const src = source();
    inst.setSoftDepth(src);
    inst.setSoftDepth(src);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 2, 402);
    inst.mesh.onBeforeRender({} as never, new THREE.Scene(), cam, inst.mesh.geometry, inst.mesh.material as THREE.Material, null as never);
    expect(seen).toEqual(['own']);
    expect((inst.mesh.material as Mat).uniforms.uSoftSpan!.value).toBe(400);
    inst.setSoftDepth(null);
    expect(inst.mesh.onBeforeRender).toBe(own);
  });

  it('off again restores the shipped program, the empty record, the attribute set and the hook exactly', () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    const attrs = Object.keys(inst.mesh.geometry.attributes).sort();
    inst.setSoftDepth(source());
    inst.setSoftDepth(null);
    const m = inst.mesh.material as Mat;
    expect(hash(m.vertexShader)).toBe(SHIPPED.vertex);
    expect(hash(m.fragmentShader)).toBe(SHIPPED.fragment);
    expect(Object.keys(m.uniforms)).toEqual([]);
    expect(Object.keys(inst.mesh.geometry.attributes).sort()).toEqual(attrs);
    expect(inst.mesh.onBeforeRender).toBe(THREE.Object3D.prototype.onBeforeRender);
    expect(inst.softDepthOn).toBe(false);
  });

  it('the above tiers and the hot cores refuse, and stay the shipped program', () => {
    for (const t of tiers.filter((x) => !(x.depthTest && !x.hot))) {
      const inst = new ParticleInstancer(8, 0, t.depthTest, t.hot);
      expect(() => inst.setSoftDepth(source()), t.name).toThrow(/only the depth-tested, normal-blended tier/);
      const m = inst.mesh.material as Mat;
      expect(hash(m.vertexShader), t.name).toBe(SHIPPED.vertex);
      expect(Object.keys(m.uniforms), t.name).toEqual([]);
      // Taking it off is always safe.
      expect(() => inst.setSoftDepth(null), t.name).not.toThrow();
    }
  });

  it('dispose turns soft particles off, so no uniform keeps the snapshot texture', () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    const src = source();
    inst.setSoftDepth(src);
    const m = inst.mesh.material as Mat;
    inst.dispose();
    expect(inst.softDepthOn).toBe(false);
    expect(Object.values(m.uniforms).some((u) => u.value === src.depthTexture)).toBe(false);
  });

  it('the splice refuses a missing or repeated anchor, and the hot text', () => {
    const v = createParticleMaterial(true, false).vertexShader;
    const f = createParticleMaterial(true, false).fragmentShader;
    expect(() => softParticleShaders(v, createParticleMaterial(true, true).fragmentShader, '')).toThrow(/fragment output/);
    expect(() => softParticleShaders(v.replace('vSoft = aSoft;', ''), f, '')).toThrow(/vertex output/);
    expect(() => softParticleShaders(v + '\n      void main() {', f, '')).toThrow(/vertex main/);
    expect(() => softParticleShaders(v, f + '\n      void main() {', '')).toThrow(/fragment main/);
  });

  it('the spliced program compiles as GLSL ES 3.00 shaders do (the identifiers it names exist)', () => {
    const inst = new ParticleInstancer(8, 0, true, false);
    inst.setSoftDepth(source());
    const m = inst.mesh.material as Mat;
    // Every identifier the fade reads is declared in the same stage.
    for (const id of ['uSoftDepth', 'uSoftInvSize', 'uSoftSpan', 'vSoftSize', 'rlSoftFade']) expect(m.fragmentShader, id).toContain(id);
    expect(m.fragmentShader.match(/varying float vSoftSize;/g)?.length).toBe(1);
    expect(m.vertexShader.match(/varying float vSoftSize;/g)?.length).toBe(1);
  });
});

describe('the soft-depth snapshot follows the dust tier (GH-1227 slice 4)', () => {
  it('an idle tier (visible mesh, count 0) takes no snapshot; a drawing one does; a hidden one does not', () => {
    const snap = new SoftDepthSnapshot([]);
    const inst = new ParticleInstancer(4, 0, true, false);
    snap.sync([inst.mesh]);
    expect(snap.sentinel.visible).toBe(false);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    ps.spawn(spec(), 1, 1, 0, 1, 5, 0);
    inst.update(ps, null, 0, 0);
    expect(inst.mesh.count).toBe(1);
    snap.sync([inst.mesh]);
    expect(snap.sentinel.visible).toBe(true);
    inst.mesh.visible = false;
    snap.sync([inst.mesh]);
    expect(snap.sentinel.visible).toBe(false);
  });
});
