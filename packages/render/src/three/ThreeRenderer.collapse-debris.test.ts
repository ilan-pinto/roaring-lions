/**
 * GH-1197 P5: the staged collapse, through the real renderer -- the flying debris added under today's shroud, 60/40
 * away from the side the building was last hit from, at most 48 a building, settling inside the rubble decal and
 * fading into it 90 s on, on the SIM clock; and the settled-rubble showcase the gated `rubble` scenario photographs.
 *
 * Harness: `ThreeRenderer.building-holes.test.ts`'s (an injected box template, no GLB, no GL).
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import type { DebrisPool } from './units/debris-pool';
import type { DecalStamp } from './decal-pool';
import { rubbleRadiusTiles } from './decal-maths';
import { QUALITY_PRESETS } from '../quality';

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

function makeOpts(extra: Partial<RendererOptions> = {}): RendererOptions {
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
    ...extra,
  };
}

const RIFLES: UnitTypeJson = {
  id: 't_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 20 },
  weapons: [{ id: 'rifles', type: 'small_arms', range_tiles: 30, effective_range_tiles: 20, accuracy: 0.8, damage: 10, suppression: 50, rof_per_min: 300, can_target: ['ground', 'structure'] } as never],
};

const W = 40;

function template(): BuildingMeshTemplate {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const base = new THREE.MeshStandardMaterial({ color: 0xc8b494 });
  root.add(new THREE.Mesh(new THREE.BoxGeometry(8.1, 3, 8.1).translate(0, 1.5, 0), base));
  return { root, materials: [base], geometries: [] };
}

interface Priv {
  debris: DebrisPool | null;
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  updateBuildingMeshes(): void;
  stampGroundDecal(s: DecalStamp): boolean;
  flipbook: { setAtlases(a: THREE.Texture, b: THREE.Texture): void; spawnRecipe(layers: readonly { count: number }[], ...rest: unknown[]): number };
}

/** A 3x3 house over tiles 20..22, and a rifleman EAST of it at (30.5, 21.5). */
function world(extra: Partial<RendererOptions> = {}, shooterX = 30.5) {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
  const t = sim.addUnitType(RIFLES);
  const shooter = sim.spawn(t, 1, fx.from(shooterX), fx.from(21.5));
  const house = sim.addStructureType({ id: 'house', hp_per_tile: 400, height_px: 30, color: 'limestone.3' });
  const tiles: number[] = [];
  for (let y = 20; y <= 22; y++) for (let x = 20; x <= 22; x++) tiles.push(y * W + x);
  const s = sim.addStructure(house, tiles);
  const r = new ThreeRenderer(sim, makeOpts(extra));
  r.snapshot();
  r.snapshot();
  const p = r as unknown as Priv;
  p.buildingMeshIdleTemplates.set('house', template());
  p.buildingMeshWreckTemplates.set('house', template());
  p.updateBuildingMeshes();
  return { sim, r, p, shooter, s };
}

function hitFrom(shooter: number, s: number, tick = 5): SimEvent {
  return { kind: 'structureHit', tick, structure: s, by: shooter, damage: fx.from(1), hpLeft: fx.from(3000) } as SimEvent;
}

function collapse(sim: Sim, r: ThreeRenderer, s: number): void {
  sim.debugDestroyStructure(s);
  r.onEvents([{ kind: 'structureDestroyed', tick: sim.tickCount, structure: s, by: -1 } as SimEvent]);
}

/** Every live piece's launch velocity and start point, read off the pool. */
function pieces(pool: DebrisPool): { v0: number[]; p0: number[]; t: number[]; rest: THREE.Vector3 }[] {
  const out = [];
  for (let shape = 0; shape < 3; shape++) {
    for (let i = 0; i < pool.meshes[shape].count; i++) out.push(pool.slot(shape, i));
  }
  return out;
}

describe('a collapse throws its masonry under the shroud (design 3.3)', () => {
  it('a 3x3 house: 40 chunks, launched from its roof line over 0-300 ms', () => {
    const { sim, r, p, s } = world();
    const now = p.debris!.nowMs;
    collapse(sim, r, s);
    const all = pieces(p.debris!);
    expect(all).toHaveLength(40);
    for (const c of all) {
      // The roof of the 1-tile-tall box, plus the chunk's half height.
      expect(c.p0[1]).toBeGreaterThan(0.95);
      expect(c.t[0] - now).toBeGreaterThanOrEqual(0);
      expect(c.t[0] - now).toBeLessThanOrEqual(300);
    }
    r.dispose();
  });

  it('60/40 AWAY from the side it was last hit from: most chunks leave westward, off an eastern shooter', () => {
    const { sim, r, p, shooter, s } = world();
    r.onEvents([hitFrom(shooter, s)]);
    collapse(sim, r, s);
    const all = pieces(p.debris!);
    const west = all.filter((c) => c.v0[0] < 0).length;
    // 40 hashed draws of a 60/40 split, each spread +-90 degrees about its side: well over half go west.
    expect(west / all.length).toBeGreaterThan(0.5);
    r.dispose();
    // The same house hit from the WEST throws most of the same chunks east: the side decides, not the hash.
    const w = world({}, 12.5);
    w.r.onEvents([hitFrom(w.shooter, w.s)]);
    collapse(w.sim, w.r, w.s);
    const back = pieces(w.p.debris!);
    expect(back.filter((c) => c.v0[0] > 0).length / back.length).toBeGreaterThan(0.5);
    w.r.dispose();
  });

  it('brings every chunk to rest inside the rubble decal', () => {
    const { sim, r, p, shooter, s } = world();
    r.onEvents([hitFrom(shooter, s)]);
    collapse(sim, r, s);
    const radius = rubbleRadiusTiles(20, 20, 22, 22);
    for (const c of pieces(p.debris!)) expect(Math.hypot(c.rest.x - 21.5, c.rest.z - 21.5)).toBeLessThanOrEqual(radius);
    r.dispose();
  });

  it('throws its 12 dust billows with the flown collapse', () => {
    const { sim, r, p, s } = world();
    p.flipbook.setAtlases(new THREE.Texture(), new THREE.Texture());
    const spawn = vi.spyOn(p.flipbook, 'spawnRecipe');
    collapse(sim, r, s);
    expect(spawn.mock.calls.some(([layers]) => layers.length === 1 && layers[0].count === 12)).toBe(true);
    r.dispose();
  });

  it('a catch-up places the chunks at rest, with no flight left', () => {
    const { sim, r, p, s } = world();
    r.setQuiet(true);
    collapse(sim, r, s);
    r.setQuiet(false);
    const all = pieces(p.debris!);
    expect(all).toHaveLength(40);
    for (const c of all) expect(c.t.slice(1)).toEqual([0, 0, 0]);
    r.dispose();
  });

  it('the low preset throws none (no pool)', () => {
    const { sim, r, p, s } = world({ quality: QUALITY_PRESETS.low });
    collapse(sim, r, s);
    expect(p.debris).toBeNull();
    r.dispose();
  });
});

describe('settled rubble fades into its decal 90 s on, on the SIM clock (two ticks either side)', () => {
  it('frame time alone never fades it; the sim clock does, between 90 s and 91.5 s', () => {
    const { sim, r, p, s } = world();
    collapse(sim, r, s);
    const pool = p.debris!;
    const spawnSim = pool.slot(0, 0).p0[3];
    // Ten minutes of frames with the sim held still: all 40 stay.
    for (let i = 0; i < 6; i++) r.frame(1, 100_000);
    expect(pool.liveCount).toBe(40);
    // Two ticks either side of the fade's end, on the sim clock the renderer hands the pool.
    pool.step(0, spawnSim + 91_500 - 100);
    expect(pool.liveCount).toBe(40);
    pool.step(0, spawnSim + 91_500 + 100);
    expect(pool.liveCount).toBe(0);
    r.dispose();
  });
});

describe('the settled-rubble showcase (the gated `rubble` scenario)', () => {
  it('stamps two collapses on the first frame: 40 + 18 chunks at rest and two rubble decals, all dated sim time 0', () => {
    const { sim, r, p } = world({ rubbleShowcase: { x: 5, y: 5 } });
    // Some sim time has passed before the first frame, so "dated 0" is a claim, not the clock's starting value.
    for (let i = 0; i < 10; i++) sim.tick();
    r.snapshot();
    p.debris!.step(0, 5_000);
    const stamps = vi.spyOn(p, 'stampGroundDecal');
    r.frame(1, 16);
    const all = pieces(p.debris!);
    expect(all).toHaveLength(58);
    for (const c of all) {
      expect(c.t.slice(1)).toEqual([0, 0, 0]);
      expect(c.p0[3]).toBe(0);
    }
    const rubble = stamps.mock.calls.map(([d]) => d).filter((d) => d.kind === 'rubble');
    expect(rubble).toHaveLength(2);
    for (const d of rubble) expect(d.simMs).toBe(0);
    // Once only.
    r.frame(1, 16);
    expect(pieces(p.debris!)).toHaveLength(58);
    r.dispose();
  });
  it('stamps nothing without the option', () => {
    const { r, p } = world();
    r.frame(1, 16);
    expect(pieces(p.debris!)).toHaveLength(0);
    r.dispose();
  });
});
