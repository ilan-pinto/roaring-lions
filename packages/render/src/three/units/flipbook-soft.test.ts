/**
 * GH-1227 slice 1: the flipbook's opt-in soft particles (`FlipbookFx.setSoftDepth`, `softFlipbookShaders`) and the flag that
 * gates them. The OFF state is the shipped program byte for byte, which is what keeps every golden baseline still.
 * Falsifications (each run once, red, then reverted; listed in the commit message).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLIPBOOK_SHADERS, FlipbookFx, softFlipbookShaders } from './flipbook-fx';
import { SOFT_PARTICLE_GLSL, type SoftDepthSource } from '../soft-depth';
import { QUALITY_PRESETS } from '../../quality';

type Mat = THREE.ShaderMaterial;
const source = (): SoftDepthSource => ({ depthTexture: new THREE.DepthTexture(4, 4), invSize: new THREE.Vector2(0.25, 0.25) });

describe('flipbook soft particles (GH-1227 slice 1)', () => {
  it('no quality preset turns soft particles on', () => {
    for (const [name, q] of Object.entries(QUALITY_PRESETS)) expect(q.softParticles ?? false, name).toBe(false);
  });

  it('off by default: both passes carry the shipped program and no soft uniform', () => {
    const fx = new FlipbookFx(8);
    for (const mesh of fx.meshes) {
      const m = mesh.material as Mat;
      expect(m.vertexShader).toBe(FLIPBOOK_SHADERS.vertexShader);
      expect(m.fragmentShader).toBe(FLIPBOOK_SHADERS.fragmentShader);
      expect(Object.keys(m.uniforms).filter((k) => k.startsWith('uSoft'))).toEqual([]);
    }
    expect(fx.softDepthOn).toBe(false);
  });

  it('on: the smoke pass fades by the snapshot, bound by reference; the fire pass is untouched', () => {
    const fx = new FlipbookFx(8);
    const src = source();
    fx.setSoftDepth(src);
    const smoke = fx.mesh.material as Mat;
    const fire = fx.fireMesh.material as Mat;
    expect(smoke.fragmentShader).toContain('float soft = rlSoftFade(texture2D(uSoftDepth, gl_FragCoord.xy * uSoftInvSize).x, gl_FragCoord.z, uSoftSpan, vSoftSize);');
    expect(smoke.fragmentShader).toContain('gl_FragColor = vec4(col, alpha * vAlpha * soft);');
    expect(smoke.fragmentShader).not.toContain('gl_FragColor = vec4(col, alpha * vAlpha);');
    expect(smoke.fragmentShader).toContain(SOFT_PARTICLE_GLSL);
    expect(smoke.vertexShader).toContain('vSoftSize = size * uQuadScale;');
    expect(smoke.uniforms.uSoftDepth!.value).toBe(src.depthTexture);
    expect(smoke.uniforms.uSoftInvSize!.value).toBe(src.invSize);
    expect(fire.vertexShader).toBe(FLIPBOOK_SHADERS.vertexShader);
    expect(fire.fragmentShader).toBe(FLIPBOOK_SHADERS.fragmentShader);
    expect(fire.uniforms.uSoftDepth).toBeUndefined();
    expect(fx.softDepthOn).toBe(true);
  });

  it('the smoke mesh writes the camera depth span before it draws', () => {
    const fx = new FlipbookFx(8);
    fx.setSoftDepth(source());
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 2, 402);
    fx.mesh.onBeforeRender({} as never, new THREE.Scene(), cam, fx.mesh.geometry, fx.mesh.material, null as never);
    expect((fx.mesh.material as Mat).uniforms.uSoftSpan!.value).toBe(400);
  });

  it('off again restores the shipped program and uniform record exactly', () => {
    const fx = new FlipbookFx(8);
    const before = Object.keys((fx.mesh.material as Mat).uniforms).sort();
    fx.setSoftDepth(source());
    fx.setSoftDepth(null);
    const m = fx.mesh.material as Mat;
    expect(m.vertexShader).toBe(FLIPBOOK_SHADERS.vertexShader);
    expect(m.fragmentShader).toBe(FLIPBOOK_SHADERS.fragmentShader);
    expect(Object.keys(m.uniforms).sort()).toEqual(before);
    expect(fx.mesh.onBeforeRender).toBe(THREE.Object3D.prototype.onBeforeRender);
    expect(fx.softDepthOn).toBe(false);
  });

  it('chains the smoke mesh hook it found rather than overwriting it, and gives it back when turned off', () => {
    const fx = new FlipbookFx(8);
    const seen: string[] = [];
    const own: THREE.Object3D['onBeforeRender'] = () => seen.push('own');
    fx.mesh.onBeforeRender = own;
    const src = source();
    fx.setSoftDepth(src);
    fx.setSoftDepth(src); // a second call must not chain onto its own hook
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 11);
    fx.mesh.onBeforeRender({} as never, new THREE.Scene(), cam, fx.mesh.geometry, fx.mesh.material, null as never);
    expect(seen).toEqual(['own']);
    expect((fx.mesh.material as Mat).uniforms.uSoftSpan!.value).toBe(10);
    fx.setSoftDepth(null);
    expect(fx.mesh.onBeforeRender).toBe(own);
  });

  it('dispose turns soft particles off, so no uniform keeps the snapshot texture', () => {
    const fx = new FlipbookFx(8);
    const src = source();
    fx.setSoftDepth(src);
    const m = fx.mesh.material as Mat;
    fx.dispose();
    expect(fx.softDepthOn).toBe(false);
    expect(Object.values(m.uniforms).some((u) => u.value === src.depthTexture)).toBe(false);
  });

  it('the splice refuses a missing or repeated anchor rather than shipping an unfaded program', () => {
    const { vertexShader: v, fragmentShader: f } = FLIPBOOK_SHADERS;
    expect(() => softFlipbookShaders(v, f.replace('gl_FragColor = vec4(col, alpha * vAlpha);', 'gl_FragColor = vec4(col, alpha);'), '')).toThrow(/fragment output/);
    expect(() => softFlipbookShaders(v.replace('gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);', ''), f, '')).toThrow(/vertex output/);
    expect(() => softFlipbookShaders(v + '\n  void main() {', f, '')).toThrow(/vertex main/);
  });
});
