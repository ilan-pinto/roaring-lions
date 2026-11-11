/**
 * GH-1197: the two-part ring. Oracles are LITERALS from the approved design and
 * mock v2 (`_coord/gh1197-mock/gh1197_mock.py`'s `ring_state`): at 213 ms the 155's
 * inner shock stands at 2.32 t at alpha 0.36; at 330 ms its outer wave is at
 * 3.07 t at alpha 0.22. At game zoom 1 a tile is 45 px along the ground, so the
 * tile readings below are the px readings divided by 45.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { munitionForWeapon, ringSpecFor, type RingSpec } from '../munitions';
import {
  BLAST_RING_CAPACITY,
  BLAST_RING_LIFT,
  BlastRingPool,
  innerRingState,
  outerRingState,
  ringLifeMs,
} from './blast-ring';
import * as THREE from 'three';
import { FX_RENDER_ORDER, FX_RENDER_ORDER_ADDITIVE } from './render-order';

const UNITS_DIR = new URL('../../../../../data/units/', import.meta.url);

/** Every (weapon id, splash) on the roster with a reach, read from the unit JSON. */
function rosterReach(): { id: string; splash: number; sub: number }[] {
  const out: { id: string; splash: number; sub: number }[] = [];
  const walk = (dir: URL): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(new URL(`${ent.name}/`, dir));
      else if (ent.name.endsWith('.json')) {
        const u = JSON.parse(readFileSync(new URL(ent.name, dir), 'utf8')) as {
          weapons?: { id: string; splash_tiles?: number; submunitions?: { splash_tiles: number } }[];
        };
        for (const w of u.weapons ?? []) {
          const sub = w.submunitions?.splash_tiles ?? 0;
          if ((w.splash_tiles ?? 0) > 0 || sub > 0) out.push({ id: w.id, splash: w.splash_tiles ?? 0, sub });
        }
      }
    }
  };
  walk(UNITS_DIR);
  return out;
}

function specOf(id: string, splash: number, sub = 0): RingSpec {
  const m = munitionForWeapon(id, splash, sub);
  if (m === null) throw new Error(`${id}: no munition`);
  const spec = ringSpecFor(m);
  if (spec === null) throw new Error(`${id}: no ring`);
  return spec;
}

/** The largest radius a state function reaches over a life, sampled every ms. */
function maxRadius(f: (ms: number) => { radius: number } | null, lifeMs: number): number {
  let r = 0;
  for (let t = 0; t <= lifeMs; t++) r = Math.max(r, f(t)?.radius ?? 0);
  return r;
}

const HOWITZER = specOf('howitzer_155', 2.4);

describe('the inner shock is the damage reach (check b)', () => {
  it('reaches S within 10% for every weapon with a reach (S read from the unit JSON)', () => {
    const roster = rosterReach();
    expect(roster.length).toBeGreaterThanOrEqual(12);
    for (const w of roster) {
      const s = w.splash > 0 ? w.splash : w.sub;
      const spec = specOf(w.id, w.splash, w.sub);
      const r = maxRadius((t) => innerRingState(t, spec), spec.innerMs);
      expect(Math.abs(r - s) / s, `${w.id}: ${r} against ${s}`).toBeLessThan(0.1);
    }
  });

  it("the 155's mock v2 frame: 2.32 t at alpha 0.36 at 213 ms, alpha 0.6 held to 182 ms, gone at 260", () => {
    const at213 = innerRingState(213, HOWITZER)!;
    expect(at213.radius).toBeCloseTo(2.32, 2);
    expect(at213.alpha).toBeCloseTo(0.36, 2);
    expect(innerRingState(182, HOWITZER)!.alpha).toBeCloseTo(0.6, 9);
    expect(innerRingState(100, HOWITZER)!.alpha).toBeCloseTo(0.6, 9);
    expect(innerRingState(260, HOWITZER)).toBeNull();
  });

  it('its white-hot edge is 1.6x the body for 120 ms, then fades with it', () => {
    expect(innerRingState(100, HOWITZER)!.edgeAlpha).toBeCloseTo(0.96, 9);
    expect(innerRingState(120, HOWITZER)!.edgeAlpha).toBeCloseTo(0.96, 9);
    const late = innerRingState(250, HOWITZER)!;
    expect(late.edgeAlpha).toBeLessThan(late.alpha * 1.1);
    expect(late.edgeAlpha).toBeGreaterThanOrEqual(late.alpha);
  });
});

describe('the outer wave reaches k x S and is not the damage line (check c)', () => {
  it('reaches k x S within 10%, and past the inner ring, for every class with one', () => {
    const cases: [string, number, number][] = [
      // weapon, splash, the design's outer reach (k x S), literals
      ['howitzer_155', 2.4, 3.84],
      ['grad_122', 3, 4.8],
      ['mortar_82', 2, 2.5],
      ['mortar_60', 1.8, 2.25],
      ['hellfire', 0.8, 1.0],
      ['charges', 1.2, 1.68],
    ];
    for (const [id, s, outer] of cases) {
      const spec = specOf(id, s);
      const life = ringLifeMs(spec);
      const r = maxRadius((t) => outerRingState(t, spec), life);
      expect(Math.abs(r - outer) / outer, `${id}: ${r} against ${outer}`).toBeLessThan(0.1);
      expect(r, id).toBeGreaterThan(maxRadius((t) => innerRingState(t, spec), life));
    }
  });

  it("the 155's mock v2 frame: 3.07 t at alpha 0.22 at 330 ms, and never inside S", () => {
    const at330 = outerRingState(330, HOWITZER)!;
    expect(at330.radius).toBeCloseTo(3.07, 2);
    expect(at330.alpha).toBeCloseTo(0.22, 2);
    for (let t = 260; t < 520; t += 5) expect(outerRingState(t, HOWITZER)!.innerRadius).toBeGreaterThanOrEqual(2.4);
    expect(outerRingState(259, HOWITZER)).toBeNull();
    expect(outerRingState(520, HOWITZER)).toBeNull();
  });

  it('is fainter than the inner shock at its brightest', () => {
    let outer = 0;
    for (let t = 0; t < 520; t++) outer = Math.max(outer, outerRingState(t, HOWITZER)?.alpha ?? 0);
    expect(outer).toBeLessThanOrEqual(0.3);
    expect(outer).toBeLessThan(innerRingState(0, HOWITZER)!.alpha);
  });

  it('a bomblet (grenade, k 1.0) draws the inner ring only', () => {
    const spec = specOf('dpicm_155', 0, 0.8);
    for (let t = 0; t < 400; t++) expect(outerRingState(t, spec)).toBeNull();
    expect(ringLifeMs(spec)).toBe(160);
  });
});

describe('BlastRingPool', () => {
  const white = (): THREE.Color => new THREE.Color(1, 1, 1);
  const flat = (): number => 0.5;

  it('draws two meshes at most, at the FX and FX-additive bands, only while a ring lives', () => {
    const pool = new BlastRingPool(white);
    expect(pool.group.children.length).toBe(2);
    expect(pool.additive.mesh.renderOrder).toBe(FX_RENDER_ORDER_ADDITIVE);
    expect(pool.normal.mesh.renderOrder).toBe(FX_RENDER_ORDER);
    expect(pool.additive.mesh.material.blending).toBe(THREE.AdditiveBlending);
    expect(pool.normal.mesh.material.blending).toBe(THREE.NormalBlending);
    pool.step(16, flat);
    expect(pool.group.children.filter((c) => c.visible).length).toBe(0);
    pool.spawn(10, 10, HOWITZER);
    pool.step(16, flat);
    expect(pool.additive.mesh.visible).toBe(true);
    // The outer wave has not started: only the inner ring draws.
    expect(pool.normal.mesh.visible).toBe(false);
    pool.step(300, flat);
    expect(pool.normal.mesh.visible).toBe(true);
    expect(pool.additive.mesh.visible).toBe(false);
    pool.step(300, flat);
    expect(pool.liveCount).toBe(0);
    expect(pool.group.children.filter((c) => c.visible).length).toBe(0);
    pool.dispose();
  });

  it('stands every vertex on the ground under it, lifted clear of the decals, at the state radius', () => {
    const pool = new BlastRingPool(white);
    const heightAt = (x: number, z: number): number => 0.1 * x + 0.2 * z;
    pool.spawn(10, 20, HOWITZER);
    pool.step(213, heightAt);
    const live = pool.liveRings();
    expect(live).toHaveLength(1);
    // Band 0 of the additive mesh is the body; vertex 1 is its outer edge at angle 0, where the edge band begins.
    const v = pool.additive.vertex(1);
    expect(v.y).toBeCloseTo(heightAt(v.x, v.z) + BLAST_RING_LIFT, 5);
    // The edge band's outer vertex at angle 0 is the ring's radius.
    const edgeOuter = pool.additive.vertex((64 + 1) * 2 + 1);
    expect(edgeOuter.x - 10).toBeCloseTo(live[0].inner!.radius, 5);
    expect(edgeOuter.a).toBeCloseTo(live[0].inner!.edgeAlpha, 5);
    pool.dispose();
  });

  it('hides under the debug flag and comes back, and draws nothing for no reach', () => {
    const pool = new BlastRingPool(white);
    pool.spawn(1, 1, null);
    pool.spawn(1, 1, { ...HOWITZER, splash: 0 });
    expect(pool.liveCount).toBe(0);
    pool.spawn(1, 1, HOWITZER);
    pool.step(16, flat);
    pool.setDebugHidden(true);
    pool.step(16, flat);
    expect(pool.additive.mesh.visible).toBe(false);
    pool.setDebugHidden(false);
    expect(pool.additive.mesh.visible).toBe(true);
    pool.dispose();
  });

  it('reuses the oldest slot when full, and never holds more than its capacity', () => {
    const pool = new BlastRingPool(white);
    for (let i = 0; i < BLAST_RING_CAPACITY + 5; i++) pool.spawn(i, 0, HOWITZER);
    expect(pool.liveCount).toBe(BLAST_RING_CAPACITY);
    pool.step(16, flat);
    pool.dispose();
  });

  it('draws a dust-toned demolition ring in the normal mesh, with no white-hot edge', () => {
    const pool = new BlastRingPool(white);
    pool.spawn(0, 0, specOf('charges', 1.2));
    pool.step(16, flat);
    expect(pool.additive.mesh.visible).toBe(false);
    expect(pool.normal.mesh.visible).toBe(true);
    expect(pool.normal.bands).toBe(1);
    pool.dispose();
  });
});
