import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FlipbookFx,
  FLIPBOOK_CAPACITY,
  FLIPBOOK_RNG_SEED,
  FLIP_DIRT,
  FLIP_FIRE,
  FLIP_SMOKE,
  prepareFlipbookAtlas,
} from './flipbook-fx';
import { COLLAPSE_FLASH_RENDER_ORDER, SMOKE_RENDER_ORDER } from './render-order';
import { HDR_GAINS } from './hdr-gains';

function atlas(): THREE.DataTexture {
  return new THREE.DataTexture(new Uint8Array(4), 1, 1);
}

function ready(capacity?: number): FlipbookFx {
  const fx = new FlipbookFx(capacity);
  fx.setAtlases(atlas(), atlas());
  return fx;
}

function params(fx: FlipbookFx): Float32Array {
  return fx.mesh.geometry.getAttribute('aParams').array as Float32Array;
}

function types(fx: FlipbookFx, n: number): number[] {
  const p = params(fx);
  return Array.from({ length: n }, (_, i) => p[i * 4 + 3]);
}

describe('FlipbookFx construction', () => {
  it('two meshes over one geometry, smoke depth-tested at band 5, fire not at band 5.5', () => {
    const fx = new FlipbookFx();
    expect(fx.mesh.geometry).toBe(fx.fireMesh.geometry);
    expect(fx.mesh.renderOrder).toBe(SMOKE_RENDER_ORDER);
    expect(fx.fireMesh.renderOrder).toBe(COLLAPSE_FLASH_RENDER_ORDER);
    expect(fx.mesh.material.depthTest).toBe(true);
    expect(fx.fireMesh.material.depthTest).toBe(false);
    expect(fx.mesh.material.depthWrite).toBe(false);
    expect(fx.fireMesh.material.depthWrite).toBe(false);
    expect(fx.mesh.material.uniforms.uFirePass.value).toBe(0);
    expect(fx.fireMesh.material.uniforms.uFirePass.value).toBe(1);
    expect(fx.mesh.material.uniforms.uFireGain.value).toBe(HDR_GAINS.fireball);
    expect(fx.mesh.material.uniforms.uSmokeAlpha.value).toBe(0.85);
    expect(fx.mesh.material.uniforms.uQuadScale.value).toBeCloseTo(1 / 0.85, 10);
    expect(fx.mesh.geometry.getAttribute('aParams').count).toBe(FLIPBOOK_CAPACITY);
  });

  it('prepares an atlas as data: NoColorSpace, no premultiply, clamped, mipmapped', () => {
    const t = prepareFlipbookAtlas(new THREE.Texture());
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.premultiplyAlpha).toBe(false);
    expect(t.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(t.generateMipmaps).toBe(true);
    expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });
});

describe('FlipbookFx ring buffer', () => {
  it('wraps: the fifth spawn into a four-slot ring overwrites slot 0', () => {
    const fx = ready(4);
    for (let k = 0; k < 5; k++) fx.spawn({ x: k, y: 0, z: 0, durationMs: 100, scale: 1, type: FLIP_SMOKE });
    const o = fx.mesh.geometry.getAttribute('aOrigin').array as Float32Array;
    expect([o[0], o[3], o[6], o[9]]).toEqual([4, 1, 2, 3]);
    expect(fx.mesh.geometry.instanceCount).toBe(4);
  });

  it('uploads only the slot it wrote', () => {
    const fx = ready(8);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 100, scale: 1, type: FLIP_SMOKE });
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 100, scale: 1, type: FLIP_SMOKE });
    // Clear what the first two queued, as an upload would.
    const sizes: Record<string, number> = { aOrigin: 3, aVel: 3, aParams: 4, aSeed: 1, aTint: 1 };
    for (const name of Object.keys(sizes)) (fx.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).clearUpdateRanges();
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 100, scale: 1, type: FLIP_SMOKE });
    for (const [name, size] of Object.entries(sizes)) {
      const attr = fx.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      expect(attr.updateRanges, name).toEqual([{ start: 2 * size, count: size }]);
    }
  });
});

describe('FlipbookFx live window', () => {
  it('draws nothing until the atlases are bound, then shows a live spawn', () => {
    const fx = new FlipbookFx();
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 500, scale: 1, type: FLIP_FIRE });
    expect(fx.mesh.visible).toBe(false);
    expect(fx.fireMesh.visible).toBe(false);
    fx.setAtlases(atlas(), atlas());
    expect(fx.mesh.visible).toBe(true);
    expect(fx.fireMesh.visible).toBe(true);
  });

  it('is hidden while idle, hides after the last expiry, re-shows on spawn', () => {
    const fx = ready();
    expect(fx.mesh.visible).toBe(false);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 300, scale: 1, type: FLIP_SMOKE });
    fx.spawn({ x: 0, y: 0, z: 0, delayMs: 200, durationMs: 300, scale: 1, type: FLIP_FIRE });
    fx.step(400);
    expect(fx.mesh.visible).toBe(true); // the delayed one lives to 500
    expect(fx.liveCount).toBe(1);
    fx.step(101);
    expect(fx.mesh.visible).toBe(false);
    expect(fx.fireMesh.visible).toBe(false);
    expect(fx.liveCount).toBe(0);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 50, scale: 1, type: FLIP_DIRT });
    expect(fx.mesh.visible).toBe(true);
    expect(fx.fireMesh.visible).toBe(true);
  });

  it('the debug flag survives a zero-time step and a spawn', () => {
    const fx = ready();
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 1000, scale: 1, type: FLIP_SMOKE });
    expect(fx.setDebugHidden(true)).toBe(2);
    fx.step(0);
    expect(fx.mesh.visible).toBe(false);
    expect(fx.fireMesh.visible).toBe(false);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 1000, scale: 1, type: FLIP_FIRE });
    expect(fx.mesh.visible).toBe(false);
    fx.setDebugHidden(false);
    fx.step(0);
    expect(fx.mesh.visible).toBe(true);
  });

  it('ages on the clock it is stepped with', () => {
    const fx = ready();
    fx.step(1234);
    expect(fx.mesh.material.uniforms.uTime.value).toBe(1234);
    expect(fx.fireMesh.material.uniforms.uTime.value).toBe(1234);
  });
});

describe('FlipbookFx presentation RNG', () => {
  it('is deterministic from a fixed state, and differs from another', () => {
    const seeds = (state: number): number[] => {
      const fx = ready();
      fx.reseed(state);
      fx.spawnShellImpact(1, 0, 2, 0.3);
      return Array.from((fx.mesh.geometry.getAttribute('aSeed').array as Float32Array).slice(0, 22));
    };
    const a = seeds(FLIPBOOK_RNG_SEED);
    expect(seeds(FLIPBOOK_RNG_SEED)).toEqual(a);
    expect(seeds(12345)).not.toEqual(a);
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    // A fresh instance starts from FLIPBOOK_RNG_SEED without being told.
    const fresh = ready();
    fresh.spawnShellImpact(1, 0, 2, 0.3);
    expect(Array.from((fresh.mesh.geometry.getAttribute('aSeed').array as Float32Array).slice(0, 22))).toEqual(a);
  });
});

describe('FlipbookFx recipes', () => {
  const count = (f: (fx: FlipbookFx) => void): { n: number; t: number[] } => {
    const fx = ready();
    f(fx);
    return { n: fx.mesh.geometry.instanceCount, t: types(fx, fx.mesh.geometry.instanceCount) };
  };
  const tally = (t: number[], type: number): number => t.filter((x) => x === type).length;

  it('shell impact: 1 + 3 fire, 12 dirt, 6 smoke = 22', () => {
    const { n, t } = count((fx) => fx.spawnShellImpact(0, 0, 0, 0.3));
    expect(n).toBe(22);
    expect([tally(t, FLIP_FIRE), tally(t, FLIP_DIRT), tally(t, FLIP_SMOKE)]).toEqual([4, 12, 6]);
  });

  it('vehicle kill: 1 + 6 + 3 fire, 10 dust-ring + 16 column smoke = 36', () => {
    const { n, t } = count((fx) => fx.spawnVehicleKill(0, 0, 0, 1));
    expect(n).toBe(36);
    expect([tally(t, FLIP_FIRE), tally(t, FLIP_SMOKE), tally(t, FLIP_DIRT)]).toEqual([10, 26, 0]);
  });

  it('muzzle: 1 fire, 3 smoke, 6 dirt = 10', () => {
    const { n, t } = count((fx) => fx.spawnMuzzle(0, 1, 0, 0, 0, 1));
    expect(n).toBe(10);
    expect([tally(t, FLIP_FIRE), tally(t, FLIP_SMOKE), tally(t, FLIP_DIRT)]).toEqual([1, 3, 6]);
  });

  it('the kill column lingers 6.5-9 s and shell smoke 3.5-5 s (D3, 1x)', () => {
    const fx = ready();
    fx.spawnVehicleKill(0, 0, 0, 1);
    const p = params(fx);
    for (let i = 20; i < 36; i++) {
      expect(p[i * 4 + 1]).toBeGreaterThanOrEqual(6500);
      expect(p[i * 4 + 1]).toBeLessThanOrEqual(9000);
    }
    const shell = ready();
    shell.spawnShellImpact(0, 0, 0, 0.45);
    const q = params(shell);
    for (let i = 16; i < 22; i++) {
      expect(q[i * 4 + 1]).toBeGreaterThanOrEqual(3500);
      expect(q[i * 4 + 1]).toBeLessThanOrEqual(5000);
    }
  });
});
