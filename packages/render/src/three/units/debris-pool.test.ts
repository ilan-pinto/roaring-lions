/**
 * GH-1197 P2: the debris pool and its cost, per preset (the design's debris cost table, literal):
 *   high   1024 pieces, +3 colour and +3 shadow draws, <= 49k triangles;
 *   medium  512 pieces, +3 draws (no shadow), <= 12k triangles;
 *   low       0: no pool, no draw (the dirt flipbook only).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITY_PRESETS, debrisQualityOf } from '../../quality';
import { debrisThrowFor, planDebris, restingPlan, type DebrisPlan } from './debris-flight';
import {
  DEBRIS_PROGRAM_KEY,
  DEBRIS_SHAPES,
  DebrisPool,
  debrisGeometry,
  debrisVertexHook,
  triangleCount,
} from './debris-pool';
import { WORLD_RENDER_ORDER } from './render-order';

const flat = (): number => 0;
const T = debrisThrowFor({ clods: 36, chunks: 18, throw_tiles: 2.4, apex_tiles: 3.0 }, 2.4, 2.4);
function plans(n: number, x = 10, z = 10): DebrisPlan[] {
  return Array.from({ length: n }, (_, k) => planDebris(x, 0, z, k, k % 2 === 0, T, flat));
}
const grey = (n: number): THREE.Color[] => Array.from({ length: n }, () => new THREE.Color(0.5, 0.4, 0.3));

/** Every triangle a pass submits when every slot is in use: draws x instance capacity x triangles. */
function worstTriangles(pool: DebrisPool): { colour: number; shadow: number; draws: number; shadowDraws: number } {
  let colour = 0;
  let shadow = 0;
  for (const m of pool.meshes) {
    const tris = triangleCount(m.geometry) * m.instanceMatrix.count;
    colour += tris;
    if (m.castShadow) shadow += tris;
  }
  return { colour, shadow, draws: pool.meshes.length, shadowDraws: pool.meshes.filter((m) => m.castShadow).length };
}

describe('the three shapes (the design: slab 12, block 20, shard 8)', () => {
  it('submit their triangles, are 1 across at most and 0.34 tall', () => {
    expect(DEBRIS_SHAPES.map((s) => triangleCount(debrisGeometry(s)))).toEqual([12, 20, 8]);
    for (const s of DEBRIS_SHAPES) {
      const b = debrisGeometry(s).boundingBox!;
      expect(b.max.x - b.min.x, s).toBeLessThanOrEqual(1 + 1e-6);
      expect(b.max.z - b.min.z, s).toBeLessThanOrEqual(1 + 1e-6);
      expect(b.max.y - b.min.y, s).toBeCloseTo(0.34, 6);
    }
  });
});

describe('the cost, per preset (a cost test: every number literal)', () => {
  it('high: +3 colour and +3 shadow draws, at most 49k triangles in all', () => {
    const pool = new DebrisPool(debrisQualityOf(QUALITY_PRESETS.high));
    const c = worstTriangles(pool);
    expect(c.draws).toBe(3);
    expect(c.shadowDraws).toBe(3);
    expect(c.colour + c.shadow).toBeLessThanOrEqual(49_000);
    expect(pool.meshes.reduce((n, m) => n + m.instanceMatrix.count, 0)).toBeGreaterThanOrEqual(1024);
    pool.dispose();
  });
  it('medium: +3 draws and no shadow, at most 12k triangles', () => {
    const pool = new DebrisPool(debrisQualityOf(QUALITY_PRESETS.medium));
    const c = worstTriangles(pool);
    expect(c.draws).toBe(3);
    expect(c.shadowDraws).toBe(0);
    expect(c.colour).toBeLessThanOrEqual(12_000);
    pool.dispose();
  });
  it('low: no pool, no draw, and a spawn places nothing', () => {
    const pool = new DebrisPool(debrisQualityOf(QUALITY_PRESETS.low));
    expect(pool.meshes).toHaveLength(0);
    expect(pool.group.children).toHaveLength(0);
    expect(pool.spawn(plans(10), grey(10))).toBe(0);
    pool.dispose();
  });
  it('a preset that names no debris reads high', () => {
    expect(debrisQualityOf(undefined)).toEqual({ pool: 1024, shadows: true });
    expect(debrisQualityOf({ ...QUALITY_PRESETS.medium, debris: undefined })).toEqual({ pool: 1024, shadows: true });
  });
});

describe('the pool', () => {
  it('draws opaque world geometry, out of AO, with the flight hook on colour and depth', () => {
    const pool = new DebrisPool({ pool: 30, shadows: true });
    for (const m of pool.meshes) {
      expect(m.renderOrder).toBe(WORLD_RENDER_ORDER);
      expect(m.userData.rlAoExempt).toBe(true);
      expect(m.material).toBe(pool.material);
      expect(m.customDepthMaterial).toBe(pool.depthMaterial);
      expect(m.receiveShadow).toBe(true);
    }
    expect(pool.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(pool.material.transparent).toBe(false);
    expect(pool.material.customProgramCacheKey()).toBe(DEBRIS_PROGRAM_KEY);
    pool.dispose();
  });

  it('is invisible until a spawn, and again once every piece has faded on the SIM clock', () => {
    const pool = new DebrisPool({ pool: 30, shadows: false });
    pool.step(16, 0);
    expect(pool.meshes.some((m) => m.visible)).toBe(false);
    expect(pool.spawn(plans(6), grey(6))).toBe(6);
    expect(pool.meshes.every((m) => m.visible)).toBe(true);
    // Frame time alone never retires it: settled debris stays.
    pool.step(200_000, 0);
    expect(pool.meshes.every((m) => m.visible)).toBe(true);
    pool.step(16, 91_499);
    expect(pool.liveCount).toBe(6);
    pool.step(16, 91_501);
    expect(pool.liveCount).toBe(0);
    expect(pool.meshes.some((m) => m.visible)).toBe(false);
    pool.dispose();
  });

  it('writes the plan and the rest pose at spawn, and its colour as given', () => {
    const pool = new DebrisPool({ pool: 30, shadows: false });
    pool.step(40, 5_000);
    const p = plans(1)[0];
    pool.spawn([p], [new THREE.Color(0.25, 0.5, 0.75)]);
    const s = pool.slot(0, 0);
    expect(s.t[0]).toBe(40);
    expect(s.t.slice(1)).toEqual([Math.fround(p.t1), Math.fround(p.t2), Math.fround(p.t3)]);
    expect(s.p0[3]).toBe(5_000);
    expect(s.rest.x).toBeCloseTo(p.rest[0], 5);
    expect(s.rest.y).toBeCloseTo(p.rest[1], 5);
    expect(s.rest.z).toBeCloseTo(p.rest[2], 5);
    expect([s.color.r, s.color.g, s.color.b]).toEqual([0.25, 0.5, 0.75]);
    // A catch-up's resting plan: no flight left.
    pool.spawn([restingPlan(p)], [new THREE.Color(1, 1, 1)]);
    expect(pool.slot(1, 0).t.slice(1)).toEqual([0, 0, 0]);
    pool.dispose();
  });

  it('never steals a live piece: a full pool places nothing until a fade frees a slot', () => {
    const pool = new DebrisPool({ pool: 9, shadows: false });
    expect(pool.spawn(plans(9), grey(9))).toBe(9);
    expect(pool.spawn(plans(5, 20, 20), grey(5))).toBe(0);
    expect(pool.liveCount).toBe(9);
    pool.step(16, 91_501);
    expect(pool.spawn(plans(5, 20, 20), grey(5))).toBe(5);
    pool.dispose();
  });

  it('the debug flag hides it and a later step does not undo that', () => {
    const pool = new DebrisPool({ pool: 30, shadows: false });
    pool.spawn(plans(3), grey(3));
    expect(pool.setDebugHidden(true)).toBe(3);
    pool.step(16, 0);
    expect(pool.meshes.some((m) => m.visible)).toBe(false);
    pool.setDebugHidden(false);
    expect(pool.meshes.some((m) => m.visible)).toBe(true);
    pool.dispose();
  });
});

describe('the flight hook', () => {
  it('moves the position, the world position and the normal of the standard and depth programs', () => {
    for (const src of [THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.depth.vertexShader]) {
      const out = debrisVertexHook(src);
      expect(out).toContain('rlDebrisPrep();');
      expect(out).toContain('mvPosition.xyz += rlDebrisOffset;');
      expect(out).toContain('transformed = rlDebrisSpin * transformed * rlDebrisScale;');
    }
    expect(debrisVertexHook(THREE.ShaderLib.standard.vertexShader)).toContain('worldPosition.xyz += rlDebrisOffset;');
    expect(debrisVertexHook(THREE.ShaderLib.standard.vertexShader)).toContain('objectNormal = rlDebrisSpin * objectNormal;');
  });
  it('transcribes the flight constants, not its own', () => {
    const out = debrisVertexHook(THREE.ShaderLib.standard.vertexShader);
    expect(out).toContain('float g = 9.8000;');
    expect(out).toContain('- 90000.0) / 1500.0');
    expect(out).toContain('0.5 * 0.3400 * size');
  });
});
