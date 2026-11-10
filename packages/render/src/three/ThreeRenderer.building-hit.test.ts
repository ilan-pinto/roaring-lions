/**
 * GH-1197 P3: an explosive direct-fire round hitting a building throws masonry and dust from the HIT FACE,
 * through the real renderer: a `fire` at the structure, then the `structureHit` that resolves it.
 *
 * Harness: the faked `WebGLRenderer` of `ThreeRenderer.versus-leaks.test.ts` (fog starts all-unseen and nothing
 * calls `frame()`, so a tile is in sight only where a test writes 2 into the fog grid).
 */
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { DebrisPool } from './units/debris-pool';
import { hexToLinear } from './terrain/shared';
import { paletteHex } from './palette-hex';
import buildingHitDust from '../../../../data/vfx/building_hit_dust.json';
import type { EmitterSpec } from '../vfx/emitters';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};

type Room = Pick<RendererOptions, 'viewerSide' | 'versus'>;

function makeOpts(room: Room = {}): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    ...room,
  };
}

function shooter(id: string, weapon: Record<string, unknown>): UnitTypeJson {
  return {
    id,
    role: 'armor',
    hull: { hp: 3000, armor: { front: 700, side: 300, rear: 120 } },
    mobility: { speed_tiles_s: 0 },
    sensors: { optics: 1, sight_tiles: 20 },
    weapons: [{ range_tiles: 12, effective_range_tiles: 10, accuracy: 0.8, damage: 300, suppression: 50, rof_per_min: 6, can_target: ['ground', 'structure'], ...weapon } as never],
  };
}
/** `mbt_lavi`'s `gun_120` (unmapped in munitions.json: direct_he at its reference S), and a rifle squad. */
const TANK = shooter('t_tank', { id: 'gun_120', type: 'apfsds', penetration: 700 });
const RIFLES = shooter('t_rifles', { id: 'rifles', type: 'small_arms', penetration: 8 });

const W = 32;

interface Priv {
  debris: DebrisPool | null;
  fog: Uint8Array;
  pendingStructShots: unknown[];
  spawnFlatFx(...args: unknown[]): void;
  flipbook: { spawnRecipe(...args: unknown[]): number };
  particleSystem: { spawn(...args: unknown[]): void } | null;
}

/** A 2x2 house at tiles (20..21, 20..21), colour limestone.3, and a side-1 shooter EAST of it at (27.5, 20.5). */
function world(type: UnitTypeJson, room: Room = {}): { sim: Sim; r: ThreeRenderer; p: Priv; shooter: number; house: number } {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
  const t = sim.addUnitType(type);
  const shooterId = sim.spawn(t, 1, fx.from(27.5), fx.from(20.5));
  const hut = sim.addStructureType({ id: 'house', hp_per_tile: 400, height_px: 30, color: 'limestone.3' });
  const house = sim.addStructure(hut, [20 * W + 20, 20 * W + 21, 21 * W + 20, 21 * W + 21]);
  const r = new ThreeRenderer(sim, makeOpts(room));
  r.useEmitters([buildingHitDust as unknown as EmitterSpec], (key) => (key.startsWith('#') ? key : '#C8B494'));
  r.snapshot();
  r.snapshot();
  const p = r as unknown as Priv;
  if (room.versus) p.fog.fill(0);
  return { sim, r, p, shooter: shooterId, house };
}

function fireAt(shooterId: number, house: number, weaponId: string, tick = 5): SimEvent {
  return {
    kind: 'fire', tick, shooter: shooterId, target: -1, structure: house, weaponId, pHit: 0, roll: 0, willHit: true,
    breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0 },
  } as unknown as SimEvent;
}
/** The centroid puffs among a `spawnFlatFx` spy's calls: the house's centre is (21, 21). Muzzle fallbacks are not. */
function centroidPuffs(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((c) => c[0] === 21 && c[1] === 21).length;
}

function hit(shooterId: number, house: number, tick = 5): SimEvent {
  return { kind: 'structureHit', tick, structure: house, by: shooterId, damage: fx.from(100), hpLeft: fx.from(1000) } as SimEvent;
}

describe('an explosive direct-fire hit throws masonry from the hit face (GH-1197 P3)', () => {
  it("a tank round on the house's east face: direct_he's 12 + 8 pieces, no centroid puff", () => {
    const { r, p, shooter: s, house } = world(TANK);
    const puff = vi.spyOn(p, 'spawnFlatFx');
    r.onEvents([fireAt(s, house, 'gun_120'), hit(s, house)]);
    expect(p.debris!.liveCount).toBe(20);
    expect(centroidPuffs(puff)).toBe(0);
    expect(p.pendingStructShots).toHaveLength(0);
    r.dispose();
  });

  it('throws them back toward the shooter: mean velocity . (shooter - centre) > 0, every piece from the east face', () => {
    const { r, p, shooter: s, house } = world(TANK);
    r.onEvents([fireAt(s, house, 'gun_120'), hit(s, house)]);
    const toShooter = [27.5 - 21, 20.5 - 21];
    let dot = 0;
    let n = 0;
    for (let shape = 0; shape < 3; shape++) {
      for (let i = 0; i < 7; i++) {
        const slot = p.debris!.slot(shape, i);
        if (slot.t[3] === 0 && slot.p0[0] === 0) continue;
        if (n >= 20) break;
        // The face: x = 22 (maxX + 1) plus the standoff.
        expect(slot.p0[0]).toBeCloseTo(22.05, 4);
        dot += slot.v0[0] * toShooter[0] + slot.v0[2] * toShooter[1];
        // Inside the +-35 degree cone about +x.
        expect(Math.abs(Math.atan2(slot.v0[2], slot.v0[0]))).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-6);
        n++;
      }
    }
    expect(n).toBe(20);
    expect(dot / n).toBeGreaterThan(0);
    r.dispose();
  });

  it("in the house's own ramp: limestone.3, .4, .5 and a quarter gunmetal.2", () => {
    const { r, p, shooter: s, house } = world(TANK);
    r.onEvents([fireAt(s, house, 'gun_120'), hit(s, house)]);
    const allowed = ['limestone.3', 'limestone.4', 'limestone.5', 'gunmetal.2'];
    const seen = new Set<string>();
    for (let shape = 0; shape < 3; shape++) {
      for (let i = 0; i < 6; i++) {
        const c = p.debris!.slot(shape, i).color;
        const key = allowed.find((k) => hexToLinear(paletteHex(k)).every((v, j) => Math.abs(v - [c.r, c.g, c.b][j]) < 1e-6));
        expect(key, `shape ${shape} slot ${i}`).toBeDefined();
        seen.add(key!);
      }
    }
    expect([...seen].sort()).toEqual(allowed.slice().sort());
    r.dispose();
  });

  it('throws its masonry dust at the face, not the centroid', () => {
    const { r, p, shooter: s, house } = world(TANK);
    const dust = vi.spyOn(p.particleSystem!, 'spawn');
    r.onEvents([fireAt(s, house, 'gun_120'), hit(s, house)]);
    const atFace = dust.mock.calls.filter((c) => Math.abs((c[1] as number) - 22.05) < 1e-4);
    expect(atFace.length).toBeGreaterThan(0);
    expect(dust.mock.calls.some((c) => c[1] === 21 && c[2] === 21)).toBe(false);
    r.dispose();
  });

  it('a rifle hit keeps the centroid puff and throws nothing new', () => {
    const { r, p, shooter: s, house } = world(RIFLES);
    const puff = vi.spyOn(p, 'spawnFlatFx');
    r.onEvents([fireAt(s, house, 'rifles'), hit(s, house)]);
    expect(centroidPuffs(puff)).toBe(1);
    expect(p.debris!.liveCount).toBe(0);
    r.dispose();
  });

  it('a hit with no round in flight (a stray splash) keeps the centroid puff', () => {
    const { r, p, shooter: s, house } = world(TANK);
    const puff = vi.spyOn(p, 'spawnFlatFx');
    r.onEvents([hit(s, house)]);
    expect(centroidPuffs(puff)).toBe(1);
    expect(p.debris!.liveCount).toBe(0);
    r.dispose();
  });

  it('two rounds on one tick throw one burst (at most one a building per 4 ticks)', () => {
    const { r, p, shooter: s, house } = world(TANK);
    r.onEvents([fireAt(s, house, 'gun_120'), fireAt(s, house, 'gun_120'), hit(s, house), hit(s, house)]);
    expect(p.debris!.liveCount).toBe(20);
    r.dispose();
  });
});

describe('a hostile hit in versus fog draws nothing (versus-leaks style)', () => {
  function pieces(room: Room, reveal: boolean): number {
    const { r, p, shooter: s, house } = world(TANK, room);
    if (reveal) p.fog[20 * W + 21] = 2;
    const puff = vi.spyOn(p, 'spawnFlatFx');
    r.onEvents([fireAt(s, house, 'gun_120'), hit(s, house)]);
    const n = p.debris!.liveCount + centroidPuffs(puff);
    r.dispose();
    return n;
  }
  it('single-player draws it, as ever', () => {
    expect(pieces({}, false)).toBe(20);
  });
  it('a versus seat draws nothing for a hostile hit on a building it cannot see', () => {
    expect(pieces({ versus: true, viewerSide: 0 }, false)).toBe(0);
  });
  it('a versus seat draws it when a tile of the building is in sight', () => {
    expect(pieces({ versus: true, viewerSide: 0 }, true)).toBe(20);
  });
});
