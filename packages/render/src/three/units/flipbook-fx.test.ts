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
import type { FlipbookLayerSpec } from '../../vfx/emitters';
import shellImpact from '../../../../../data/vfx/shell_impact.json';
import missileImpact from '../../../../../data/vfx/missile_impact.json';
import catastrophicKill from '../../../../../data/vfx/catastrophic_kill.json';
import fireApfsds from '../../../../../data/vfx/fire_apfsds.json';
import fireHeat from '../../../../../data/vfx/fire_heat.json';

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

  it('sets flipY explicitly: the shader row inversion depends on it', () => {
    const tex = new THREE.Texture();
    tex.flipY = false; // as an ImageBitmapLoader texture would arrive
    expect(prepareFlipbookAtlas(tex).flipY).toBe(true);
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
  it('draws nothing until the atlases are bound, then shows a live spawn on its own pass', () => {
    const fx = new FlipbookFx();
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 500, scale: 1, type: FLIP_FIRE });
    expect(fx.mesh.visible).toBe(false);
    expect(fx.fireMesh.visible).toBe(false);
    fx.setAtlases(atlas(), atlas());
    expect(fx.fireMesh.visible).toBe(true);
    expect(fx.mesh.visible).toBe(false); // nothing live on the smoke pass
  });

  it('is hidden while idle, hides after the last expiry, re-shows on spawn', () => {
    const fx = ready();
    expect(fx.mesh.visible).toBe(false);
    expect(fx.fireMesh.visible).toBe(false);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 300, scale: 1, type: FLIP_SMOKE });
    fx.spawn({ x: 0, y: 0, z: 0, delayMs: 200, durationMs: 300, scale: 1, type: FLIP_SMOKE });
    fx.step(400);
    expect(fx.mesh.visible).toBe(true); // the delayed one lives to 500
    expect(fx.liveCount).toBe(1);
    fx.step(101);
    expect(fx.mesh.visible).toBe(false);
    expect(fx.liveCount).toBe(0);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 50, scale: 1, type: FLIP_DIRT });
    expect(fx.mesh.visible).toBe(true);
    expect(fx.fireMesh.visible).toBe(false);
  });

  it('each pass keeps its own window: fire goes dark while the smoke column lives on', () => {
    const fx = ready();
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 300, scale: 1, type: FLIP_FIRE });
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 5000, scale: 1, type: FLIP_SMOKE });
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([true, true]);
    fx.step(301);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([false, true]);
    fx.step(5000);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([false, false]);
  });

  it('a lone fireball leaves the smoke pass dark, and the fire pass dark once it is out', () => {
    const fx = ready();
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 4000, scale: 1, type: FLIP_FIRE });
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([true, false]);
    fx.spawn({ x: 0, y: 0, z: 0, durationMs: 200, scale: 1, type: FLIP_DIRT });
    fx.step(201);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([true, false]);
    fx.step(4000);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([false, false]);
  });

  it('a whole kill recipe: fire out by its last cook-off, the column lives to its last puff', () => {
    const fx = ready();
    fx.spawnRecipe(catastrophicKill.flipbook as FlipbookLayerSpec[], 0, 0, 0, 1);
    const p = params(fx);
    let fireEnd = 0;
    let smokeEnd = 0;
    for (let i = 0; i < fx.mesh.geometry.instanceCount; i++) {
      const end = p[i * 4] + p[i * 4 + 1];
      if (p[i * 4 + 3] === FLIP_FIRE) fireEnd = Math.max(fireEnd, end);
      else smokeEnd = Math.max(smokeEnd, end);
    }
    expect(fireEnd).toBeLessThan(smokeEnd);
    fx.step(fireEnd + 1);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([false, true]);
    fx.step(smokeEnd - fireEnd);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([false, false]);
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
    expect(fx.fireMesh.visible).toBe(false);
    fx.setDebugHidden(false);
    fx.step(0);
    expect(fx.mesh.visible).toBe(true);
    expect(fx.fireMesh.visible).toBe(true);
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
      fx.spawnRecipe(shellImpact.flipbook as FlipbookLayerSpec[], 1, 0, 2, 0.3);
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
    fresh.spawnRecipe(shellImpact.flipbook as FlipbookLayerSpec[], 1, 0, 2, 0.3);
    expect(Array.from((fresh.mesh.geometry.getAttribute('aSeed').array as Float32Array).slice(0, 22))).toEqual(a);
  });
});

describe('FlipbookFx recipe linger (D3, 1x)', () => {
  it('the kill column lingers 6.5-9 s and shell smoke 3.5-5 s', () => {
    const fx = ready();
    fx.spawnRecipe(catastrophicKill.flipbook as FlipbookLayerSpec[], 0, 0, 0, 1);
    const p = params(fx);
    for (let i = 20; i < 36; i++) {
      expect(p[i * 4 + 1]).toBeGreaterThanOrEqual(6500);
      expect(p[i * 4 + 1]).toBeLessThanOrEqual(9000);
    }
    const shell = ready();
    shell.spawnRecipe(shellImpact.flipbook as FlipbookLayerSpec[], 0, 0, 0, 0.45);
    const q = params(shell);
    for (let i = 16; i < 22; i++) {
      expect(q[i * 4 + 1]).toBeGreaterThanOrEqual(3500);
      expect(q[i * 4 + 1]).toBeLessThanOrEqual(5000);
    }
  });
});

// ---- Task 5: the JSON recipes against the mock's literal numbers ----------
//
// The oracle is a transcription of the mock's three recipes
// (`mock/defilade-t4` @ `1bd2814b`, Task 4's hard-coded methods) through the
// public `spawn`, with its numbers as LITERALS -- it imports nothing from
// the JSON it judges. With the PRNG pinned to a constant, draw order stops
// mattering, so the recipe and the oracle must write identical instances at
// every constant: that pins every count, range end, delay and offset.

type Rand = () => number;
function pinRand(fx: FlipbookFx, c: number): void {
  (fx as unknown as { rand: Rand }).rand = () => c;
}

function mockShell(fx: FlipbookFx, r: Rand, x: number, h: number, z: number, power: number): void {
  const fs = 0.8 + 1.4 * power;
  fx.spawn({ x, y: h, z, vy: 0.3, durationMs: 700, scale: fs, type: FLIP_FIRE });
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * 1.4, vy: 0.6 + r(), vz: Math.sin(a) * 1.4, delayMs: 20 * k, durationMs: 600 + 200 * r(), scale: fs * 0.6, type: FLIP_FIRE });
  }
  for (let k = 0; k < 12; k++) {
    const a = r() * Math.PI * 2;
    const sp = 0.2 + r() * 0.6;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * sp, vy: 2.4 + r() * 2.0, vz: Math.sin(a) * sp, delayMs: 10 * k, durationMs: 800 + 400 * r(), scale: 0.25 + 0.22 * r(), type: FLIP_DIRT });
  }
  for (let k = 0; k < 6; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * 0.6, vy: 0.3 + r() * 0.3, vz: Math.sin(a) * 0.6, delayMs: 150 + 80 * k, durationMs: 3500 + 1500 * r(), scale: 0.7 + 0.4 * r(), type: FLIP_SMOKE, tint: 0.4 });
  }
}

function mockKill(fx: FlipbookFx, r: Rand, x: number, h: number, z: number, power: number): void {
  const fs = 0.9 + 0.9 * power;
  fx.spawn({ x, y: h + 0.2, z, vy: 0.6, durationMs: 1300, scale: fs, type: FLIP_FIRE });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + r();
    fx.spawn({ x, y: h + 0.2, z, vx: Math.cos(a) * 2.2, vy: 0.9 + r() * 1.4, vz: Math.sin(a) * 2.2, delayMs: 15 * k, durationMs: 1000 + 400 * r(), scale: fs * 0.65, type: FLIP_FIRE });
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * 2.6, vy: 0.4, vz: Math.sin(a) * 2.6, durationMs: 1600 + 400 * r(), scale: 0.6 + 0.3 * power, type: FLIP_SMOKE, tint: 0.9 });
  }
  for (let k = 0; k < 3; k++) {
    fx.spawn({ x: x + (r() - 0.5) * 0.6, y: h + 0.4, z: z + (r() - 0.5) * 0.6, vy: 1.2, delayMs: 500 + 550 * k, durationMs: 700, scale: fs * 0.45, type: FLIP_FIRE });
  }
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x, y: h + 0.3, z, vx: Math.cos(a) * 0.35, vy: 0.7 + r() * 0.5, vz: Math.sin(a) * 0.35, delayMs: 200 + 260 * k, durationMs: 6500 + 2500 * r(), scale: 0.9 + 0.6 * r() + 0.4 * power, type: FLIP_SMOKE });
  }
}

function mockMuzzle(fx: FlipbookFx, r: Rand, x: number, h: number, z: number, dirRad: number, groundH: number, power: number): void {
  const dx = Math.cos(dirRad);
  const dz = Math.sin(dirRad);
  fx.spawn({ x: x + dx * 0.15, y: h - 0.25, z: z + dz * 0.15, vx: dx * 3, vz: dz * 3, durationMs: 140, scale: 0.6, type: FLIP_FIRE });
  for (let k = 0; k < 3; k++) {
    const sp = 2.5 + 2 * r();
    fx.spawn({ x: x + dx * 0.2 * k, y: h, z: z + dz * 0.2 * k, vx: dx * sp, vy: 0.3, vz: dz * sp, delayMs: 10 * k, durationMs: 1400, scale: 0.35 + 0.15 * k * power, type: FLIP_SMOKE });
  }
  for (let k = 0; k < 6; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x: x - dx * 0.6, y: groundH, z: z - dz * 0.6, vx: Math.cos(a) * 1.4 + dx * 1.2, vy: 0.5, vz: Math.sin(a) * 1.4 + dz * 1.2, durationMs: 900, scale: 0.35 * power + 0.25, type: FLIP_DIRT });
  }
}

function instances(fx: FlipbookFx): number[][] {
  const g = fx.mesh.geometry;
  const n = g.instanceCount;
  const rows: number[][] = [];
  const get = (name: string): Float32Array => g.getAttribute(name).array as Float32Array;
  const [o, v, p, s, t] = [get('aOrigin'), get('aVel'), get('aParams'), get('aSeed'), get('aTint')];
  for (let i = 0; i < n; i++) {
    rows.push([o[i * 3], o[i * 3 + 1], o[i * 3 + 2], v[i * 3], v[i * 3 + 1], v[i * 3 + 2], p[i * 4], p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3], s[i], t[i]]);
  }
  return rows;
}

function expectSameInstances(a: number[][], b: number[][]): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) expect(a[i][j], `instance ${i} field ${j}`).toBeCloseTo(b[i][j], 4);
  }
}

const RAND_PINS = [0, 0.37, 0.999];

describe('FlipbookFx recipes from data/vfx (Task 5)', () => {
  type Case = {
    name: string;
    layers: readonly FlipbookLayerSpec[];
    args: [number, number, number, number, number?, number?];
    oracle: (fx: FlipbookFx, r: Rand) => void;
  };
  const shellLayers = shellImpact.flipbook as FlipbookLayerSpec[];
  const cases: Case[] = [
    { name: 'shell_impact (mortar 0.3)', layers: shellLayers, args: [3, 1.5, -2, 0.3], oracle: (fx, r) => mockShell(fx, r, 3, 1.5, -2, 0.3) },
    { name: 'shell_impact (Grad 0.45)', layers: shellLayers, args: [3, 1.5, -2, 0.45], oracle: (fx, r) => mockShell(fx, r, 3, 1.5, -2, 0.45) },
    { name: 'missile_impact', layers: missileImpact.flipbook as FlipbookLayerSpec[], args: [0, 0.4, 7, 0.5], oracle: (fx, r) => mockShell(fx, r, 0, 0.4, 7, 0.5) },
    { name: 'catastrophic_kill', layers: catastrophicKill.flipbook as FlipbookLayerSpec[], args: [-4, 2, 1, 0.8], oracle: (fx, r) => mockKill(fx, r, -4, 2, 1, 0.8) },
    { name: 'fire_apfsds', layers: fireApfsds.flipbook as FlipbookLayerSpec[], args: [1, 1.2, 2, 1, 0.7, 0.3], oracle: (fx, r) => mockMuzzle(fx, r, 1, 1.2, 2, 0.7, 0.3, 1) },
    { name: 'fire_heat', layers: fireHeat.flipbook as FlipbookLayerSpec[], args: [1, 1.2, 2, 0.6, 2.5, 0.3], oracle: (fx, r) => mockMuzzle(fx, r, 1, 1.2, 2, 2.5, 0.3, 0.6) },
  ];
  for (const c of cases) {
    it(`${c.name}: writes the mock's instances at every pinned PRNG value`, () => {
      for (const pin of RAND_PINS) {
        const got = ready();
        pinRand(got, pin);
        const [x, h, z, power, dir, ground] = c.args;
        const n = got.spawnRecipe(c.layers, x, h, z, power, dir, ground);
        const want = ready();
        pinRand(want, pin);
        c.oracle(want, () => pin);
        expect(n).toBe(want.mesh.geometry.instanceCount);
        expectSameInstances(instances(got), instances(want));
      }
    });
  }

  it('shell recipe = 22 instances (4 fire, 12 dirt, 6 smoke), kill = 36 (10 fire, 26 smoke), muzzle = 10 (1/3/6)', () => {
    const tallyOf = (layers: readonly FlipbookLayerSpec[]): number[] => {
      const fx = ready();
      fx.spawnRecipe(layers, 0, 0, 0, 1, 0, 0);
      const t = types(fx, fx.mesh.geometry.instanceCount);
      return [FLIP_FIRE, FLIP_SMOKE, FLIP_DIRT].map((ty) => t.filter((x) => x === ty).length);
    };
    expect(tallyOf(shellLayers)).toEqual([4, 6, 12]);
    expect(tallyOf(missileImpact.flipbook as FlipbookLayerSpec[])).toEqual([4, 6, 12]);
    expect(tallyOf(catastrophicKill.flipbook as FlipbookLayerSpec[])).toEqual([10, 26, 0]);
    expect(tallyOf(fireApfsds.flipbook as FlipbookLayerSpec[])).toEqual([1, 3, 6]);
    expect(tallyOf(fireHeat.flipbook as FlipbookLayerSpec[])).toEqual([1, 3, 6]);
  });
});

