import { describe, expect, it, vi } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import type { EmitterSpec } from '../../vfx';
import * as terrainShared from '../terrain/shared';
import { spawnMissile, type MissileLaunch, type MissileModel } from './missiles';
import {
  GLOW_FLICKER,
  TRAIL_DRIFT_TILES_S,
  TRAIL_RISE_PX_S,
  TRAIL_SPACING_TILES,
  TrailPool,
  emitAlongFlight,
  glowScale,
  missileIgnited,
  trailLookFrom,
  writeMissileSprites,
  type SpriteBuffers,
  type TrailLook,
} from './missile-trail';

const TRAIL_EMITTER: EmitterSpec = {
  id: 'missile_trail', trigger: 'projectile_trail', layer: 'above_units',
  particles: [
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 2.5, color_over_life: ['vfx.white_hot'], additive: true },
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 6, color_over_life: ['vfx.fire'], alpha_over_life: [0.55] },
    { sprite: 'smoke_puff', count: 1, lifetime_ms: 1600, size_px: 2.5, size_over_life: [1.0, 3.2],
      color_over_life: ['limestone.1', 'limestone.3', 'gunmetal.1'], alpha_over_life: [0.7, 0.0] },
  ],
};
const HEX: Record<string, string> = {
  'vfx.white_hot': '#FFF6D0', 'vfx.fire': '#FFB43C', 'limestone.1': '#E6D8BE', 'limestone.3': '#C8B494', 'gunmetal.1': '#8E9491',
};
const resolve = (k: string): string => {
  const hex = HEX[k];
  if (hex === undefined) throw new Error(`fixture: unknown palette key ${k}`);
  return hex;
};
function look(): TrailLook {
  const l = trailLookFrom(TRAIL_EMITTER, resolve);
  if (l === null) throw new Error('fixture: no look');
  return l;
}
function missile(over: Partial<MissileLaunch> = {}): MissileModel {
  const m = spawnMissile({
    sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'kornet',
    target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 1, shooter: 0, ...over,
  });
  if (m === null) throw new Error('fixture: not a missile');
  return m;
}
function buffers(n: number): SpriteBuffers {
  return { positions: new Float32Array(n * 3), colors: new Float32Array(n * 3), alphas: new Float32Array(n),
    scales: new Float32Array(n), softs: new Float32Array(n) };
}
const flatY = (_x: number, _y: number, liftPx: number): number => liftPx;

describe('trailLookFrom (P-3)', () => {
  it('reads the three layers by role, not by position, with every colour resolved (N9, N10)', () => {
    const l = look();
    expect(l.coreRadiusPx).toBe(2.5);
    expect(l.coreColor).toBe('#FFF6D0');
    expect(l.haloRadiusPx).toBe(6);
    expect(l.haloColor).toBe('#FFB43C');
    expect(l.haloAlpha).toBe(0.55);
    expect(l.lifeS).toBeCloseTo(1.6, 9);
    expect(l.colors).toEqual(['#E6D8BE', '#C8B494', '#8E9491']);
    const reversed = { ...TRAIL_EMITTER, particles: [...TRAIL_EMITTER.particles].reverse() };
    expect(trailLookFrom(reversed, resolve)).toEqual(l);
  });

  it('is null with no emitter, and throws on an emitter missing a role', () => {
    expect(trailLookFrom(null, resolve)).toBeNull();
    const noSmoke = { ...TRAIL_EMITTER, particles: TRAIL_EMITTER.particles.slice(0, 2) };
    expect(() => trailLookFrom(noSmoke, resolve)).toThrow(/smoke_puff/);
  });
});

describe('TrailPool', () => {
  it('is a ring: past capacity the oldest puff is the one overwritten', () => {
    const pool = new TrailPool(4);
    for (let i = 0; i < 6; i++) pool.emit(i, 0, 0, 10);
    expect(pool.live).toBe(4);
    const xs: number[] = [];
    pool.forEachLive((x) => xs.push(x));
    expect(xs.sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('ages, rises and drifts on the dt it is given, and dies at its own life (N10, spec D8)', () => {
    const pool = new TrailPool(8);
    pool.emit(0, 0, 0, 1.0);
    pool.step(0.5);
    let seen = 0;
    pool.forEachLive((x, y, worldY, ageFrac) => {
      seen++;
      expect(ageFrac).toBeCloseTo(0.5, 9);
      expect(Math.hypot(x, y)).toBeCloseTo(TRAIL_DRIFT_TILES_S * 0.5, 6);
      expect(worldY).toBeGreaterThan(0);
    });
    expect(seen).toBe(1);
    pool.step(0); // hit-stop: nothing moves
    pool.forEachLive((_x, _y, _w, ageFrac) => expect(ageFrac).toBeCloseTo(0.5, 9));
    pool.step(0.51);
    expect(pool.live).toBe(0);
    expect(TRAIL_RISE_PX_S).toBe(5);
  });
});

describe('emitAlongFlight', () => {
  it('drops one puff every 0.20 tiles of ground travelled, and never the same stretch twice', () => {
    const pool = new TrailPool(256);
    const m = missile();
    m.t = m.duration * 0.25; // 2.0 tiles of an 8-tile shot
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(Math.floor(2.0 / TRAIL_SPACING_TILES + 1e-9));
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(0);
    m.t = m.duration * 0.5;
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(10);
  });

  it('an RPG leaves no smoke before its motor lights at 0.3 tiles (N6)', () => {
    const pool = new TrailPool(64);
    const m = missile({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7', tx: 4, simDistTiles: 4 });
    m.t = m.duration * (0.25 / 4);
    expect(missileIgnited(m)).toBe(false);
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(0);
    m.t = m.duration * (1.0 / 4);
    expect(missileIgnited(m)).toBe(true);
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(4); // 0.4, 0.6, 0.8, 1.0
  });

  it('a warhead leaves nothing at all', () => {
    const pool = new TrailPool(64);
    const m = missile({ cls: WEAPON_CLASS.heat, weaponId: 'warhead', tx: 1.2, simDistTiles: 1.2 });
    m.t = m.duration * 0.9;
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(0);
  });
});

describe('the glow', () => {
  it('flickers inside +-15 % and is a pure function of (t, seed) (N9)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const g = glowScale(i / 60, 0.3);
      expect(g).toBeGreaterThanOrEqual(1 - GLOW_FLICKER - 1e-9);
      expect(g).toBeLessThanOrEqual(1 + GLOW_FLICKER + 1e-9);
      seen.add(Math.round(g * 1000));
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(glowScale(0.5, 0.3)).toBe(glowScale(0.5, 0.3));
  });
});

describe('writeMissileSprites', () => {
  it('writes a halo per lit missile and every live puff to the soft buffer, and a core per lit missile to the hot one', () => {
    const pool = new TrailPool(64);
    const m = missile();
    m.t = m.duration * 0.25;
    emitAlongFlight(pool, m, look(), flatY);
    const soft = buffers(128);
    const core = buffers(8);
    const counts = writeMissileSprites([m], pool, look(), (mm, u) => u + mm.launchLiftPx, soft, core);
    expect(counts.core).toBe(1);
    expect(counts.soft).toBe(1 + pool.live);
    expect(core.softs[0]).toBe(0);
    expect(soft.softs[0]).toBe(1);
    // 5, not 9: `soft.alphas` is a Float32Array (SpriteBuffers's own contract),
    // and Math.fround(0.55) is already 1.19e-8 off double-precision 0.55 --
    // no writer can clear a 9-digit bar against a buffer typed to lose that
    // much on the store. See task-3-report.md.
    expect(soft.alphas[0]).toBeCloseTo(0.55, 5); // the halo is written first
  });

  it('writes nothing for a warhead or an unlit RPG', () => {
    const pool = new TrailPool(8);
    const w = missile({ cls: WEAPON_CLASS.heat, weaponId: 'warhead', tx: 1.2, simDistTiles: 1.2 });
    const r = missile({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7', tx: 4, simDistTiles: 4 });
    w.t = w.duration * 0.5;
    r.t = 0;
    const counts = writeMissileSprites([w, r], pool, look(), () => 0, buffers(8), buffers(8));
    expect(counts).toEqual({ soft: 0, core: 0 });
  });

  it('caches colour conversion: hexToLinear runs once per distinct colour, not once per puff (allocates nothing per frame)', () => {
    const pool = new TrailPool(64);
    const m = missile();
    m.t = m.duration * 0.25;
    emitAlongFlight(pool, m, look(), flatY); // lays 10 puffs, one shared look
    expect(pool.live).toBe(10);
    const spy = vi.spyOn(terrainShared, 'hexToLinear');
    spy.mockClear();
    writeMissileSprites([m], pool, look(), (mm, u) => u + mm.launchLiftPx, buffers(128), buffers(8));
    // 1 halo + 1 core + at most 3 smoke colour steps = 5 distinct colours,
    // however many times each is sampled. A writer that converts per-sprite
    // instead of caching would call this once per puff too: 10 puffs + halo +
    // core = 12, which must NOT happen.
    expect(spy.mock.calls.length).toBeLessThan(pool.live);
    spy.mockRestore();
  });
});
