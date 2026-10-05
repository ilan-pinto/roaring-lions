/**
 * GH-391: a skinned mesh unit's clip clock is SIM time. The same sim time
 * reached through different frame-delta histories must leave the mixer at the
 * same time (so the same pose); before, `mixer.update` took the clamped frame
 * delta, and the three riflemen in the gated `vehicle` frame stood at a
 * different point of their idle loop on every run. Harness as
 * `ThreeRenderer.gait.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildMeshUnitTemplate, type MeshUnitTemplate, type MeshUnitEntity } from './units/mesh-unit';
import { parseFixture } from './units/mesh-fixture';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(): RendererOptions {
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
  };
}

/**
 * The fixture's declared gait. 1.5 m of forward boot travel over a 0.5 s
 * cycle; `MESH_UNITS_PER_TILE` is 3, so the legs describe 1.0 tiles/s.
 * Deliberately round: every expectation in this file is a small integer or a
 * simple fraction of a unit's own `speed_tiles_s`, readable without running
 * the formula.
 */
const INF: UnitTypeJson = {
  id: 'clock_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

interface Privates {
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  beginFrameSimClock(alpha: number, dtMs: number): void;
  updateMeshUnits(alpha: number, dtMs: number): void;
}

async function setUp() {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(INF), 0, fx.from(4.5), fx.from(6.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Privates;
  const gltf = await parseFixture({ roleName: 'uniform', clipName: ['idle', 'move'] });
  priv.meshUnitTemplates.set(INF.id, [buildMeshUnitTemplate(gltf, 'kdf', 'fixture.glb')]);
  renderer.snapshot();
  renderer.snapshot();
  const ticksTo = (t: number): void => {
    while (sim.tickCount < t) {
      sim.tick();
      renderer.snapshot();
    }
  };
  /** One frame, in `frame()`'s order: the sim clock, then the units. */
  const frame = (dtMs: number): void => {
    priv.beginFrameSimClock(1, dtMs);
    priv.updateMeshUnits(1, dtMs);
  };
  const mixerTime = (): number => {
    const e = priv.meshUnitEntities.get(id);
    if (!e) throw new Error('no mesh entity');
    return e.mixer.time;
  };
  return { ticksTo, frame, mixerTime };
}

describe('mesh unit clip clock', () => {
  it('reads the same mixer time at the same sim time whatever the frame history', async () => {
    const a = await setUp();
    a.frame(16);
    a.ticksTo(10);
    for (let i = 0; i < 9; i++) a.frame(100);
    a.ticksTo(120);
    a.frame(100);

    const b = await setUp();
    b.frame(16);
    b.ticksTo(120);
    b.frame(7);

    expect(a.mixerTime()).toBeGreaterThan(0);
    expect(a.mixerTime()).toBeCloseTo(b.mixerTime(), 9);
  });

  it('does not advance on a zero-time repaint at the same sim time', async () => {
    const a = await setUp();
    a.frame(16);
    a.ticksTo(60);
    a.frame(16);
    const t = a.mixerTime();
    a.frame(100);
    a.frame(0);
    expect(a.mixerTime()).toBe(t);
  });
});
