import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  FlipbookFx,
  FLIPBOOK_CAPACITY,
  FLIPBOOK_COLOR_KEYS,
  FLIPBOOK_RNG_SEED,
  FLIP_DIRT,
  FLIP_FIRE,
  FLIP_SMOKE,
  FLIP_SPARK,
  FLIPBOOK_FIT,
  FLIPBOOK_OIL_CROWN,
  flipbookSupersedes,
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
    expect(fx.mesh.material.uniforms.uQuadScale.value).toBe(1);
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
      if (p[i * 4 + 3] === FLIP_FIRE || p[i * 4 + 3] === FLIP_SPARK) fireEnd = Math.max(fireEnd, end);
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
  it('the kill column lingers 6-8 s and shell smoke 4-6 s', () => {
    // Was 6.5-9 s over instances 20..35 (16 puffs), then 7-10 s over the 36
    // oily puffs at 37..72. Now 6-8 s over the 24 oily puffs at 31..54 (after
    // 1 + 6 fire, 14 ring smoke, 10 cook-off fire): the lead's option A trim
    // (23 Oct), which cut the column's cost on high and low. Shell smoke: Was
    // 3.5-5 s; 4-6 s since P3+P4 (Q6).
    const fx = ready();
    fx.spawnRecipe(catastrophicKill.flipbook as FlipbookLayerSpec[], 0, 0, 0, 1);
    const p = params(fx);
    for (let i = 31; i < 55; i++) {
      expect(p[i * 4 + 1]).toBeGreaterThanOrEqual(6000);
      expect(p[i * 4 + 1]).toBeLessThanOrEqual(8000);
    }
    const shell = ready();
    shell.spawnRecipe(shellImpact.flipbook as FlipbookLayerSpec[], 0, 0, 0, 0.45);
    const q = params(shell);
    // Was 3500-5000 ms over instances 16..21 (the lead, 23 Oct, Q6: smoke 6 -> 9, 4-6 s).
    for (let i = 20; i < 29; i++) {
      expect(q[i * 4 + 1]).toBeGreaterThanOrEqual(4000);
      expect(q[i * 4 + 1]).toBeLessThanOrEqual(6000);
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
//
// `mockKill` is the exception to "the mock's three recipes": the kill's
// oracle is now the literal transcription of the smoke-uplift P2 mock's
// round-3 recipe (the lead-approved one, `_coord/smoke-uplift/mock-p2.diff`)
// with the HDR spark layer in place of the mock's soft_dot ember particles.
// Its point is unchanged: literal equality with an approved mock. Was the
// Task 4 transcription (10 fire, 26 smoke, no spark).

type Rand = () => number;
function pinRand(fx: FlipbookFx, c: number): void {
  (fx as unknown as { rand: Rand }).rand = () => c;
}

// The mortar/Grad shell recipe as the lead approved it on 23 Oct (smoke uplift
// P4, Q6): bigger HE puffs with more tan dirt. Was 12 dirt at 0.25 + 0.22r,
// 6 smoke at 0.7 + 0.4r, 3500-5000 ms. Tint stays 0.4: 0.15 was tried and drew
// the puff DARKER (tint is soot 0 -> dust 1; neither end is white), so
// "whiter" needs a white smoke tone in the shader -- a follow-up. The
// oracle is literal equality with THIS recipe, which replaced the old approved one.
function mockShell(fx: FlipbookFx, r: Rand, x: number, h: number, z: number, power: number): void {
  const fs = 0.8 + 1.4 * power;
  fx.spawn({ x, y: h, z, vy: 0.3, durationMs: 700, scale: fs, type: FLIP_FIRE });
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * 1.4, vy: 0.6 + r(), vz: Math.sin(a) * 1.4, delayMs: 20 * k, durationMs: 600 + 200 * r(), scale: fs * 0.6, type: FLIP_FIRE });
  }
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2;
    const sp = 0.2 + r() * 0.6;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * sp, vy: 2.4 + r() * 2.0, vz: Math.sin(a) * sp, delayMs: 10 * k, durationMs: 800 + 400 * r(), scale: 0.4 + 0.3 * r(), type: FLIP_DIRT });
  }
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * 0.6, vy: 0.3 + r() * 0.3, vz: Math.sin(a) * 0.6, delayMs: 150 + 80 * k, durationMs: 4000 + 2000 * r(), scale: 1.1 + 0.4 * r(), type: FLIP_SMOKE, tint: 0.4, white: 0.85 });
  }
}


// missile_impact still carries the earlier recipe (P4 did not touch it).
function mockMissileImpact(fx: FlipbookFx, r: Rand, x: number, h: number, z: number, power: number): void {
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
  const fs = 1.2 + 1.0 * power;
  fx.spawn({ x, y: h + 0.2, z, vy: 0.8, durationMs: 1500, scale: fs, type: FLIP_FIRE });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + r();
    fx.spawn({ x, y: h + 0.2, z, vx: Math.cos(a) * 2.4, vy: 1.0 + r() * 1.6, vz: Math.sin(a) * 2.4, delayMs: 15 * k, durationMs: 1100 + 400 * r(), scale: fs * 0.8, type: FLIP_FIRE });
  }
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    fx.spawn({ x, y: h, z, vx: Math.cos(a) * 3.0, vy: 0.4, vz: Math.sin(a) * 3.0, durationMs: 1800 + 600 * r(), scale: 0.9 + 0.4 * power, type: FLIP_SMOKE, tint: 0.9 });
  }
  // Was 16 cook-off fires; 10 after the option A trim (23 Oct).
  for (let k = 0; k < 10; k++) {
    fx.spawn({ x: x + (r() - 0.5) * 0.6, y: h + 0.3, z: z + (r() - 0.5) * 0.6, vy: 0.9 + r() * 0.6, delayMs: 450 + 300 * k, durationMs: 900 + 400 * r(), scale: fs * 0.22, type: FLIP_FIRE });
  }
  // Was 36 puffs, delay 150 + 220k, life 7000 + 3000r, scale rand 0.9; the
  // lead's option A trim (23 Oct) made it 24, 150 + 210k, 6000 + 2000r, 0.5.
  for (let k = 0; k < 24; k++) {
    const a = r() * Math.PI * 2;
    fx.spawn({ x: x + (r() - 0.5) * 0.6, y: h + 0.4, z: z + (r() - 0.5) * 0.6, vx: Math.cos(a) * 0.55, vy: 1.4 + r() * 0.8, vz: Math.sin(a) * 0.55, delayMs: 150 + 210 * k, durationMs: 6000 + 2000 * r(), scale: 1.0 + 0.5 * r() + 0.4 * power, type: FLIP_SMOKE, tint: -1 });
  }
  for (let k = 0; k < 36; k++) {
    const a = r() * Math.PI * 2;
    const sp = 1.5 + 2.5 * r();
    fx.spawn({ x, y: h + 0.3, z, vx: Math.cos(a) * sp, vy: 2.0 + r() * 3.0, vz: Math.sin(a) * sp, delayMs: 8 * k, durationMs: 900 + 700 * r(), scale: 0.05, type: FLIP_SPARK });
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
  const [o, v, p, s, t, w] = [get('aOrigin'), get('aVel'), get('aParams'), get('aSeed'), get('aTint'), get('aWhite')];
  for (let i = 0; i < n; i++) {
    rows.push([o[i * 3], o[i * 3 + 1], o[i * 3 + 2], v[i * 3], v[i * 3 + 1], v[i * 3 + 2], p[i * 4], p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3], s[i], t[i], w[i]]);
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
    { name: 'missile_impact', layers: missileImpact.flipbook as FlipbookLayerSpec[], args: [0, 0.4, 7, 0.5], oracle: (fx, r) => mockMissileImpact(fx, r, 0, 0.4, 7, 0.5) },
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

  it('shell recipe = 29 instances (4 fire, 16 dirt, 9 smoke), missile 22 (4/12/6), kill = 91 (17 fire, 38 smoke, 36 spark), muzzle = 10 (1/3/6)', () => {
    // Was kill = 36 (10 fire, 26 smoke): the P2 recipe adds 7 fire (cook-off
    // 3 -> 10), 12 smoke (column 16 -> 24, ring 10 -> 14) and 36 sparks.
    const tallyOf = (layers: readonly FlipbookLayerSpec[]): number[] => {
      const fx = ready();
      fx.spawnRecipe(layers, 0, 0, 0, 1, 0, 0);
      const t = types(fx, fx.mesh.geometry.instanceCount);
      return [FLIP_FIRE, FLIP_SMOKE, FLIP_DIRT, FLIP_SPARK].map((ty) => t.filter((x) => x === ty).length);
    };
    // Was [4, 6, 12]. Smoke 6 -> 9 and dirt 12 -> 16 (the lead, 23 Oct, Q6).
    expect(tallyOf(shellLayers)).toEqual([4, 9, 16, 0]);
    expect(tallyOf(missileImpact.flipbook as FlipbookLayerSpec[])).toEqual([4, 6, 12, 0]);
    expect(tallyOf(catastrophicKill.flipbook as FlipbookLayerSpec[])).toEqual([17, 38, 0, 36]); // Was [23, 50, 0, 36]: option A trim (23 Oct).
    expect(tallyOf(fireApfsds.flipbook as FlipbookLayerSpec[])).toEqual([1, 3, 6, 0]);
    expect(tallyOf(fireHeat.flipbook as FlipbookLayerSpec[])).toEqual([1, 3, 6, 0]);
  });
});


// ---------------------------------------------------------------------------
// Task 6 (Task 5 review minors): the interpreter fails loudly, the fireball
// rule `spawnRecipe` relies on holds for every shipped recipe, and the layers
// the renderer skips are exactly the three D6 names.
// ---------------------------------------------------------------------------

const VFX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../data/vfx');

describe('flipbook recipes, as shipped', () => {
  // Read at test time, not imported: a NEW emitter with a recipe is checked
  // without anyone remembering to add it here.
  const recipes = readdirSync(VFX_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, em: JSON.parse(readFileSync(path.join(VFX_DIR, f), 'utf8')) as { flipbook?: FlipbookLayerSpec[] } }))
    .filter((r) => r.em.flipbook !== undefined);

  it('finds the eight shipped recipes', () => {
    expect(recipes.map((r) => r.file).sort()).toEqual([
      'air_strike_impact.json', 'barrage_impact.json', 'catastrophic_kill.json', 'cluster_airburst.json', 'fire_apfsds.json', 'fire_heat.json', 'missile_impact.json', 'shell_impact.json',
    ]);
  });

  // `spawnRecipe` reads the fireball scale off layer 0 (`base + per_power *
  // power`) and multiplies every `scale_from: 'fireball'` layer by it, so
  // layer 0 must BE a fixed-size fire layer: no `rand` (the fireball would
  // be one random draw, not a size) and no `scale_from` (it would scale by
  // itself).
  it('every recipe opens on a fire layer with no rand and no scale_from', () => {
    for (const { file, em } of recipes) {
      const first = em.flipbook?.[0];
      expect(first?.type, file).toBe('fire');
      expect(first?.scale.rand, file).toBeUndefined();
      expect(first?.scale_from, file).toBeUndefined();
    }
  });
});

describe('spawnRecipe on a malformed recipe', () => {
  it('throws naming an unknown layer type rather than dropping the layer', () => {
    const fb = new FlipbookFx();
    const bad = [{ type: 'plasma', count: 1, delay_ms: [0, 0], duration_ms: [100, 100], scale: { base: 1 }, velocity: { radial: [0, 0], up: [0, 0] } }] as unknown as FlipbookLayerSpec[];
    expect(() => fb.spawnRecipe(bad, 0, 0, 0, 1)).toThrow(/unknown layer type "plasma"/);
    fb.dispose();
  });
});

describe('flipbookSupersedes', () => {
  it('names the fireball mesh, the column and the smoke discs, and nothing else', () => {
    expect(flipbookSupersedes({ mesh_burst: true })).toBe(true);
    expect(flipbookSupersedes({ mesh_plume: true, sprite: 'smoke_puff' })).toBe(true);
    expect(flipbookSupersedes({ sprite: 'smoke_puff' })).toBe(true);
    expect(flipbookSupersedes({ sprite: 'shard' })).toBe(false);
    expect(flipbookSupersedes({ sprite: 'soft_dot' })).toBe(false);
    expect(flipbookSupersedes({ sprite: 'ring' })).toBe(false);
  });
});

// Task 6 fix round 1: the fit `tools/src/flipbook-fit.test.ts` measures against
// the mock is the one the shader actually reads. That test mirrors the FRAG's
// arithmetic in TypeScript; these pin the FRAG to the same arithmetic, as text,
// and the uniforms to the constants.
describe('FLIPBOOK_FIT reaches the shader', () => {
  it('binds each type\'s fit as a uniform on both passes', () => {
    const fx = new FlipbookFx();
    for (const m of [fx.mesh, fx.fireMesh]) {
      const u = m.material.uniforms;
      expect((u.uFireFit.value as THREE.Vector4).toArray()).toEqual([
        FLIPBOOK_FIT.fire.zoom, FLIPBOOK_FIT.fire.gain, FLIPBOOK_FIT.fire.k0, FLIPBOOK_FIT.fire.k1,
      ]);
      expect((u.uSmokeFit.value as THREE.Vector4).toArray()).toEqual([
        FLIPBOOK_FIT.smoke.zoom, FLIPBOOK_FIT.smoke.gain, FLIPBOOK_FIT.smoke.k0, FLIPBOOK_FIT.smoke.k1,
      ]);
      expect(u.uQuadScale.value).toBe(1);
      expect((u.uFireNoise.value as THREE.Vector3).toArray()).toEqual([FLIPBOOK_FIT.fire.freq, FLIPBOOK_FIT.fire.disp, FLIPBOOK_FIT.fire.amp]);
      expect((u.uSmokeNoise.value as THREE.Vector3).toArray()).toEqual([FLIPBOOK_FIT.smoke.freq, FLIPBOOK_FIT.smoke.disp, FLIPBOOK_FIT.smoke.amp]);
    }
    fx.dispose();
  });

  it('samples the zoomed window of the mature frames and remaps density as the mock does', () => {
    const fx = new FlipbookFx();
    const frag = fx.mesh.material.fragmentShader.replace(/\s+/g, ' ');
    expect(frag).toContain('vec2 local = a * (1.0 + (b - 0.5) * nz.y) * (0.5 * fit.x) + 0.5;');
    expect(frag).toContain('vec2 q = a * nz.x + vSeed * 31.0 + vec2(0.0, -vAge * 0.45);');
    expect(frag).toContain('float b = (fbm(q) * 0.7 + fbm(q * 2.3 + 5.1) * 0.3) / 0.9375;');
    expect(frag).toContain('float f = fit.z + tc * (fit.w - fit.z);');
    expect(frag).toContain('float density = clamp(fit.y * s.r * (1.0 + (b - 0.5) * nz.z) - 0.99 * tc * tc, 0.0, 1.0);');
    expect(frag).toContain('float core = max(smoothstep(0.25, 0.95, density), s.a);');
    fx.dispose();
  });
});

// ---- GH-705 smoke uplift P2: oil, sparks, the low tier ---------------------

describe('oil smoke', () => {
  const smokeLayer = (extra: Partial<FlipbookLayerSpec>): FlipbookLayerSpec[] => [
    { type: 'fire', count: 1, delay_ms: [0, 0], duration_ms: [100, 100], scale: { base: 1 }, velocity: { radial: [0, 0], up: [0, 0] } },
    { type: 'smoke', count: 1, delay_ms: [0, 0], duration_ms: [1000, 1000], scale: { base: 1 }, velocity: { radial: [0, 0], up: [0, 0] }, ...extra },
  ];
  const tintOf = (layers: FlipbookLayerSpec[]): number => {
    const fx = ready();
    fx.spawnRecipe(layers, 0, 0, 0, 1);
    return (fx.mesh.geometry.getAttribute('aTint').array as Float32Array)[1];
  };

  it('maps oil to a NEGATIVE tint, and oil overrides tint', () => {
    expect(tintOf(smokeLayer({ oil: 1 }))).toBe(-1);
    expect(tintOf(smokeLayer({ oil: 0.5 }))).toBeCloseTo(-0.5, 6);
    expect(tintOf(smokeLayer({ tint: 0.9 }))).toBeCloseTo(0.9, 6);
    expect(tintOf(smokeLayer({ oil: 1, tint: 0.9 }))).toBe(-1);
    expect(tintOf(smokeLayer({}))).toBe(0);
  });

  it('feeds the lit-crown constant to both passes as a uniform', () => {
    expect(FLIPBOOK_OIL_CROWN).toBe(0.15);
    const fx = new FlipbookFx();
    expect(fx.mesh.material.uniforms.uOilCrown.value).toBe(0.15);
    expect(fx.fireMesh.material.uniforms.uOilCrown.value).toBe(0.15);
  });
});

describe('white HE smoke', () => {
  const smokeLayer = (extra: Partial<FlipbookLayerSpec>): FlipbookLayerSpec[] => [
    { type: 'fire', count: 1, delay_ms: [0, 0], duration_ms: [100, 100], scale: { base: 1 }, velocity: { radial: [0, 0], up: [0, 0] } },
    { type: 'smoke', count: 1, delay_ms: [0, 0], duration_ms: [1000, 1000], scale: { base: 1 }, velocity: { radial: [0, 0], up: [0, 0] }, ...extra },
  ];

  it('a layer\'s white lands in its instance slot of aWhite, beside an unchanged tint', () => {
    const fx = ready();
    fx.spawnRecipe(smokeLayer({ white: 0.85, tint: 0.4 }), 0, 0, 0, 1);
    const w = fx.mesh.geometry.getAttribute('aWhite').array as Float32Array;
    const t = fx.mesh.geometry.getAttribute('aTint').array as Float32Array;
    expect(w[0]).toBe(0); // the fire layer
    expect(w[1]).toBeCloseTo(0.85, 6);
    expect(t[1]).toBeCloseTo(0.4, 6);
    // Slot-only upload: the attribute was marked for the touched slot.
    expect((fx.mesh.geometry.getAttribute('aWhite') as THREE.BufferAttribute).updateRanges.length).toBeGreaterThan(0);
    // A layer without white writes 0, over a slot a wrapped ring reuses too.
    const plain = ready();
    plain.spawnRecipe(smokeLayer({}), 0, 0, 0, 1);
    expect((plain.mesh.geometry.getAttribute('aWhite').array as Float32Array)[1]).toBe(0);
    // spawn() carries it as well.
    const direct = ready();
    direct.spawn({ x: 0, y: 0, z: 0, durationMs: 1000, scale: 1, type: FLIP_SMOKE, white: 0.5 });
    expect((direct.mesh.geometry.getAttribute('aWhite').array as Float32Array)[0]).toBeCloseTo(0.5, 6);
  });

  it('resolves uWhite and uWhiteShade from limestone.0 and gunmetal.1 in both passes', () => {
    expect(FLIPBOOK_COLOR_KEYS.white).toBe('limestone.0');
    expect(FLIPBOOK_COLOR_KEYS.whiteShade).toBe('gunmetal.1');
    const fx = new FlipbookFx();
    const asked: string[] = [];
    fx.setColors((k) => {
      asked.push(k);
      return new THREE.Color(k === 'limestone.0' ? 0.9 : 0.1, 0.2, 0.3);
    });
    expect(asked).toContain('limestone.0');
    for (const m of [fx.mesh, fx.fireMesh]) {
      expect((m.material.uniforms.uWhite.value as THREE.Color).r).toBeCloseTo(0.9, 6);
      expect((m.material.uniforms.uWhiteShade.value as THREE.Color).r).toBeCloseTo(0.1, 6);
    }
    fx.dispose();
  });

  it('the HE recipes (shell, barrage, air strike) turn white at 0.85 with tint 0.4; missile and kill do not', () => {
    const smokeOf = (file: string): FlipbookLayerSpec[] =>
      (JSON.parse(readFileSync(path.join(VFX_DIR, file), 'utf8')) as { flipbook: FlipbookLayerSpec[] }).flipbook.filter((l) => l.type === 'smoke');
    for (const f of ['shell_impact.json', 'barrage_impact.json', 'air_strike_impact.json']) {
      const layers = smokeOf(f);
      expect(layers.length, f).toBeGreaterThan(0);
      for (const l of layers) {
        expect(l.white, f).toBe(0.85);
        expect(l.tint, f).toBe(0.4);
      }
    }
    for (const f of ['missile_impact.json', 'catastrophic_kill.json']) {
      for (const l of smokeOf(f)) expect(l.white, f).toBeUndefined();
    }
  });

  it('the fragment shader mixes white in after the soot/dust/oil colour and before the light', () => {
    const fx = new FlipbookFx();
    const src = fx.mesh.material.fragmentShader;
    const iWhite = src.indexOf('vWhite * smoothstep(0.0, 0.18, vT)');
    expect(iWhite).toBeGreaterThan(src.indexOf('mix(soot, dusty, dustT)'));
    expect(iWhite).toBeLessThan(src.indexOf('col = base * uLight * shade'));
    fx.dispose();
  });
});

describe('spark layers', () => {
  const sparks: FlipbookLayerSpec[] = [
    { type: 'fire', count: 1, delay_ms: [0, 0], duration_ms: [100, 100], scale: { base: 1 }, velocity: { radial: [0, 0], up: [0, 0] } },
    { type: 'spark', count: 4, delay_ms: [0, 8], duration_ms: [900, 1600], scale: { base: 0.05 }, velocity: { radial: [1.5, 4], up: [2, 5] } },
  ];

  it('renders in the FIRE pass only: the smoke pass collapses them off-screen', () => {
    const fx = ready();
    fx.spawnRecipe(sparks, 0, 0, 0, 1);
    expect(types(fx, 5)).toEqual([FLIP_FIRE, FLIP_SPARK, FLIP_SPARK, FLIP_SPARK, FLIP_SPARK]);
    expect(fx.fireMesh.material.uniforms.uSparkGain.value).toBe(HDR_GAINS.sparks);
    // The window: a spark keeps the fire pass live after the fireball is out.
    fx.step(500);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([true, false]);
    fx.step(1200);
    expect([fx.fireMesh.visible, fx.mesh.visible]).toEqual([false, false]);
    const frag = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'flipbook-fx.ts'), 'utf8');
    expect(frag).toContain('bool isFire = type < 0.5 || type > 2.5;');
    expect(frag).toContain('-3.2 * age * age');
  });
});

describe('the low tier (fxDetail 0)', () => {
  const kill = catastrophicKill.flipbook as FlipbookLayerSpec[];
  const tally = (fx: FlipbookFx): number[] => {
    const t = types(fx, fx.mesh.geometry.instanceCount);
    return [FLIP_FIRE, FLIP_SMOKE, FLIP_DIRT, FLIP_SPARK].map((ty) => t.filter((x) => x === ty).length);
  };

  it('defaults to full detail', () => {
    const fx = ready();
    fx.spawnRecipe(kill, 0, 0, 0, 1);
    // Was [23, 50, 0, 36]: the option A trim (23 Oct) cut cook-off fire 16 -> 10 and the column 36 -> 24.
    expect(tally(fx)).toEqual([17, 38, 0, 36]);
  });

  it('drops spark layers and halves low_fraction layers, rounding up', () => {
    const fx = new FlipbookFx(undefined, 0);
    fx.setAtlases(atlas(), atlas());
    const n = fx.spawnRecipe(kill, 0, 0, 0, 1);
    // fire 1 + 6 + ceil(10/2)=5 = 12; smoke 14 + ceil(24/2)=12 = 26; no sparks.
    // Was [15, 32, 0, 0] and 47: the option A trim (23 Oct).
    expect(tally(fx)).toEqual([12, 26, 0, 0]);
    expect(n).toBe(38);
    // Rounded UP: a 3-count layer at 0.5 spawns 2.
    const odd = new FlipbookFx(undefined, 0);
    odd.setAtlases(atlas(), atlas());
    odd.spawnRecipe([{ ...kill[0], count: 3, low_fraction: 0.5 }], 0, 0, 0, 1);
    expect(odd.mesh.geometry.instanceCount).toBe(2);
  });

  it('does not round a float-noisy product up: 100 x 0.55 spawns 55, 10 x 0.7 spawns 7', () => {
    // 100 * 0.55 is 55.00000000000001 in doubles, so a bare ceil gives 56.
    // (10 * 0.7 is exactly 7, a plain regression guard.)
    for (const [count, low_fraction, want] of [[100, 0.55, 55], [10, 0.7, 7]] as const) {
      const fx = new FlipbookFx(undefined, 0);
      fx.setAtlases(atlas(), atlas());
      fx.spawnRecipe([{ ...kill[0], count, low_fraction }], 0, 0, 0, 1);
      expect(fx.mesh.geometry.instanceCount).toBe(want);
    }
  });

  it('fxDetail 1 and the setter keep the full recipe; the setter takes effect at the next spawn', () => {
    const fx = new FlipbookFx(undefined, 1);
    fx.setAtlases(atlas(), atlas());
    fx.spawnRecipe(kill, 0, 0, 0, 1);
    expect(tally(fx)).toEqual([17, 38, 0, 36]); // Was [23, 50, 0, 36]: option A trim (23 Oct).
    const low = ready();
    low.setFxDetail(0);
    low.spawnRecipe(kill, 0, 0, 0, 1);
    expect(tally(low)).toEqual([12, 26, 0, 0]); // Was [15, 32, 0, 0]: option A trim (23 Oct).
  });

  it('ships low_fraction on the column and the cook-off, and on nothing else in the kill', () => {
    expect(kill.map((l) => l.low_fraction)).toEqual([undefined, undefined, undefined, 0.5, 0.5, undefined]);
  });
});
