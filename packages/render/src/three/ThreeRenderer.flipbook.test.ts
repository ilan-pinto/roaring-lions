// The `vi.mock('three', ...)` block, `TONES` and `makeOpts` below are copied
// verbatim from `ThreeRenderer.missile.test.ts`.
/**
 * Defilade T4, Task 4: the flipbook is built, added to the scene, stepped on
 * the frame clock and disposed by the renderer, and its debug layer holds
 * across a zero-time repaint. Task 6: the spawn paths, at the foot.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { FlipbookFx } from './units/flipbook-fx';
import { FLIP_SMOKE } from './units/flipbook-fx';
import type { EmitterSpec } from '../vfx/emitters';
import catastrophic from '../../../../data/vfx/catastrophic_kill.json';
import shellImpact from '../../../../data/vfx/shell_impact.json';
import missileImpact from '../../../../data/vfx/missile_impact.json';
import fireApfsds from '../../../../data/vfx/fire_apfsds.json';
import structureCollapse from '../../../../data/vfx/structure_collapse.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {
      // Real `WebGLRenderer#setClearColor` reads `outputColorSpace`
      // synchronously; this stand-in only needs to accept the call.
    }
    // `ThreeRenderer.dispose` loses the context last (`context-release.ts`).
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    // `frame()` draws through the raw renderer when no composer was built.
    render(): void {}
    dispose(): void {
      // Nothing to release: this stand-in holds no GPU context.
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
    groveFamily: 'desert_tree',
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

interface Privates {
  flipbook: FlipbookFx;
  scene: THREE.Scene;
  updateFx(ms: number): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

function renderer(): ThreeRenderer {
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 16, height: 16, capacity: 4 }), makeOpts());
  r.snapshot();
  return r;
}

describe('ThreeRenderer flipbook', () => {
  it('adds both flipbook meshes to the scene, hidden while idle', () => {
    const r = renderer();
    const fb = priv(r).flipbook;
    expect(fb.mesh.parent).toBe(priv(r).scene);
    expect(fb.fireMesh.parent).toBe(priv(r).scene);
    priv(r).updateFx(16);
    expect(fb.mesh.visible).toBe(false);
    expect(fb.fireMesh.visible).toBe(false);
    r.dispose();
  });

  it('steps the flipbook on the frame clock, with lit-ground radiance and a unit sun', () => {
    const r = renderer();
    const fb = priv(r).flipbook;
    priv(r).updateFx(16);
    priv(r).updateFx(20);
    expect(fb.nowMs).toBeCloseTo(36, 6);
    const u = fb.mesh.material.uniforms;
    expect(u.uLight.value).toBeGreaterThan(0);
    expect((u.uSun.value as THREE.Vector2).length()).toBeCloseTo(1, 5);
    r.dispose();
  });

  it('the flipbook debug layer answers 2 and holds across a zero-time repaint', () => {
    const r = renderer();
    const fb = priv(r).flipbook;
    const tex = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array(4), 1, 1);
    fb.setAtlases(tex(), tex());
    fb.spawn({ x: 1, y: 0, z: 1, durationMs: 5000, scale: 1, type: FLIP_SMOKE });
    priv(r).updateFx(16);
    expect(fb.mesh.visible).toBe(true);
    expect(r.setDebugLayerVisible('flipbook', false)).toBe(2);
    priv(r).updateFx(0);
    expect(fb.mesh.visible).toBe(false);
    expect(fb.fireMesh.visible).toBe(false);
    r.setDebugLayerVisible('flipbook', true);
    priv(r).updateFx(0);
    expect(fb.mesh.visible).toBe(true);
    r.dispose();
  });
});

// ---------------------------------------------------------------------------
// Task 6 (D5, D6): the flipbook is WIRED -- each event that owns a recipe
// spawns it and stops spawning what it supersedes, and only while the
// atlases are in. Counts are literals (the recipe sizes: shell 29, missile 22,
// kill 36, muzzle 10), read off the instanced geometry, not off the JSON.
// ---------------------------------------------------------------------------

const HARD: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
  weapons: [
    {
      id: 'gun_120', type: 'apfsds', range_tiles: 12, effective_range_tiles: 9.6, accuracy: 0.85,
      penetration: 1300, damage: 520, suppression: 40, rof_per_min: 9, can_target: ['ground'],
    },
    {
      id: 'coax_mg', type: 'hmg', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.55,
      penetration: 20, damage: 35, suppression: 60, rof_per_min: 420, can_target: ['ground'],
    },
  ],
} as unknown as UnitTypeJson;

interface WiredPrivates {
  flipbook: FlipbookFx;
  explosionBursts: { spawn(...a: unknown[]): void; readonly ready: boolean };
  collapseFlashBursts: { spawn(...a: unknown[]): void; readonly ready: boolean };
  smokePlumes: { spawn(...a: unknown[]): void; readonly ready: boolean };
  collapseShrouds: { liveCount: number };
  flashLights: { liveCount: number };
  decalsPersistent: { liveCount: number };
  hitStop: { remainingMs: number };
  vehicleMeshBounds: Map<string, THREE.Vector3>;
  particleSystem: { live: number; spawn(layer: unknown, ...a: unknown[]): void };
  spawnShellImpactFx(s: { kind: string; tx: number; ty: number }): void;
  spawnMissileImpactFx(l: { x: number; y: number; headingTurns: number; power: number; scale: number; miss: boolean }): void;
  spawnCollapseFx(id: string, bx: number, by: number, power?: number, yawTurns?: number): boolean;
}
const wp = (r: ThreeRenderer): WiredPrivates => r as unknown as WiredPrivates;

/** The sprite of every particle layer handed to the pool from here on. */
function spyLayers(p: WiredPrivates): string[] {
  const sprites: string[] = [];
  vi.spyOn(p.particleSystem, 'spawn').mockImplementation((layer: unknown) => {
    sprites.push(String((layer as { sprite?: string }).sprite));
  });
  return sprites;
}

/** Instances the flipbook has been handed (delayed ones included). */
const spawned = (fb: FlipbookFx): number => fb.mesh.geometry.instanceCount;

function wired(withAtlases: boolean) {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 8 });
  const hardIdx = sim.addUnitType(HARD);
  const tank = sim.spawn(hardIdx, 0, fx.from(12.5), fx.from(12.5));
  const enemy = sim.spawn(hardIdx, 1, fx.from(18.5), fx.from(12.5));
  const r = new ThreeRenderer(sim, makeOpts());
  r.useEmitters(
    [catastrophic, shellImpact, missileImpact, fireApfsds, structureCollapse] as unknown as EmitterSpec[],
    (key) => (key.startsWith('#') ? key : '#FFB43C')
  );
  r.snapshot();
  r.snapshot();
  const p = wp(r);
  // The pooled meshes the flipbook supersedes, made "loaded" and counted, so
  // a test can tell "skipped" from "never loaded".
  const calls = { burst: 0, flash: 0, plume: 0 };
  for (const [key, pool] of [['burst', p.explosionBursts], ['flash', p.collapseFlashBursts], ['plume', p.smokePlumes]] as const) {
    vi.spyOn(pool, 'ready', 'get').mockReturnValue(true);
    vi.spyOn(pool, 'spawn').mockImplementation(() => { calls[key]++; });
  }
  p.vehicleMeshBounds.set('mbt_lavi', new THREE.Vector3(2, 1.4, 4));
  if (withAtlases) {
    const tex = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array(4), 1, 1);
    p.flipbook.setAtlases(tex(), tex());
  }
  return { sim, r, p, tank, enemy, calls };
}

function killEntity(sim: Sim, r: ThreeRenderer, entity: number): void {
  sim.state.alive[entity] = 0;
  r.onEvents([{ kind: 'destroyed', tick: 1, entity, by: -1 } as unknown as SimEvent]);
}

function fireEvent(shooter: number, target: number, weaponId: string): SimEvent {
  return {
    kind: 'fire', tick: 0, shooter, target, weaponId,
    pHit: fx.from(0.5), roll: fx.from(0.4), willHit: true,
    breakdown: {
      accuracy: fx.from(0.5), rangeFalloff: fx.from(1), coverMod: fx.from(1),
      motionMod: fx.from(1), stanceMod: fx.from(1), suppressionMod: fx.from(1),
    },
  } as unknown as SimEvent;
}

describe('ThreeRenderer flipbook wiring (D5, D6)', () => {
  it('a vehicle kill spawns the kill recipe INSTEAD of the fireball, the column and the shroud (D5)', () => {
    const { sim, r, p, tank, calls } = wired(true);
    killEntity(sim, r, tank);
    expect(spawned(p.flipbook)).toBe(36);
    expect(calls.flash).toBe(0);
    expect(calls.plume).toBe(0);
    expect(p.collapseShrouds.liveCount).toBe(0);
    // What stays: the light, the freeze, the scorch and the oil.
    expect(p.flashLights.liveCount).toBe(1);
    expect(p.hitStop.remainingMs).toBe(70);
    expect(p.decalsPersistent.liveCount).toBe(2);
    r.dispose();
  });

  it('a vehicle kill before the atlases land falls back to the fireball, column and shroud', () => {
    const { sim, r, p, tank, calls } = wired(false);
    killEntity(sim, r, tank);
    expect(spawned(p.flipbook)).toBe(0);
    expect(calls.flash).toBe(1);
    expect(calls.plume).toBe(1);
    expect(p.collapseShrouds.liveCount).toBe(1);
    r.dispose();
  });

  it('a quiet vehicle kill throws no recipe and no fallback either', () => {
    const { sim, r, p, tank, calls } = wired(true);
    r.setQuiet(true);
    killEntity(sim, r, tank);
    expect(spawned(p.flipbook)).toBe(0);
    expect(calls.flash + calls.plume).toBe(0);
    expect(p.collapseShrouds.liveCount).toBe(0);
    expect(p.decalsPersistent.liveCount).toBe(2);
    r.dispose();
  });

  it('a shell landing spawns the shell recipe and drops the fireball, column and smoke discs, keeping the shards', () => {
    const { r, p, calls } = wired(true);
    const sprites = spyLayers(p);
    p.spawnShellImpactFx({ kind: 'mortar', tx: 12.5, ty: 12.5 });
    // Was 22. Dirt 12 -> 16 and smoke 6 -> 9 (the lead, 23 Oct, Q6).
    expect(spawned(p.flipbook)).toBe(29);
    expect(calls.burst + calls.plume).toBe(0);
    expect(sprites).toEqual(['shard']);
    r.dispose();

    const old = wired(false);
    const oldSprites = spyLayers(old.p);
    old.p.spawnShellImpactFx({ kind: 'mortar', tx: 12.5, ty: 12.5 });
    expect(spawned(old.p.flipbook)).toBe(0);
    expect(old.calls.burst).toBe(1);
    expect(old.calls.plume).toBe(1);
    expect(oldSprites).toEqual(['shard', 'smoke_puff']);
    old.r.dispose();
  });

  it('a quiet shell landing throws no recipe', () => {
    const { r, p } = wired(true);
    r.setQuiet(true);
    p.spawnShellImpactFx({ kind: 'mortar', tx: 12.5, ty: 12.5 });
    expect(spawned(p.flipbook)).toBe(0);
    r.dispose();
  });

  it('a missile impact spawns its recipe and drops its fireball and smoke, keeping the spall', () => {
    const landing = { x: 12.5, y: 12.5, headingTurns: 0.25, power: 0.45, scale: 1, miss: false };
    const { r, p, calls } = wired(true);
    const sprites = spyLayers(p);
    p.spawnMissileImpactFx(landing);
    expect(spawned(p.flipbook)).toBe(22);
    expect(calls.burst).toBe(0);
    expect(sprites).toEqual(['shard']);
    r.dispose();

    const old = wired(false);
    const oldSprites = spyLayers(old.p);
    old.p.spawnMissileImpactFx(landing);
    expect(spawned(old.p.flipbook)).toBe(0);
    expect(old.calls.burst).toBe(1);
    expect(oldSprites).toEqual(['shard', 'smoke_puff']);
    old.r.dispose();
  });

  it('a quiet missile impact throws no recipe', () => {
    const { r, p } = wired(true);
    r.setQuiet(true);
    p.spawnMissileImpactFx({ x: 12.5, y: 12.5, headingTurns: 0, power: 0.45, scale: 1, miss: false });
    expect(spawned(p.flipbook)).toBe(0);
    r.dispose();
  });

  it('a structure collapse, which declares no recipe, is unchanged with the atlases in', () => {
    // The particle layers handed to the pool (the pool's own count draws a
    // presentation PRNG, so the layers, not the particle total, are what
    // "unchanged" means).
    const runs: unknown[][] = [];
    for (const atlases of [false, true]) {
      const { r, p, calls } = wired(atlases);
      const layers = spyLayers(p);
      expect(p.spawnCollapseFx('structure_collapse', 12.5, 12.5, 1, 0)).toBe(true);
      expect(spawned(p.flipbook)).toBe(0);
      runs.push([calls.burst, calls.plume, layers]);
      r.dispose();
    }
    expect(runs[1]).toEqual(runs[0]);
    expect((runs[0][2] as string[]).length).toBeGreaterThan(0);
  });

  it('a main gun throws the muzzle recipe; a machine gun throws none', () => {
    const { r, p, tank, enemy } = wired(true);
    r.onEvents([fireEvent(tank, enemy, 'coax_mg')]);
    expect(spawned(p.flipbook)).toBe(0);
    r.onEvents([fireEvent(tank, enemy, 'gun_120')]);
    expect(spawned(p.flipbook)).toBe(10);
    r.dispose();
  });

  it('a main gun before the atlases land throws no recipe', () => {
    const { r, p, tank, enemy } = wired(false);
    r.onEvents([fireEvent(tank, enemy, 'gun_120')]);
    expect(spawned(p.flipbook)).toBe(0);
    r.dispose();
  });

  it('the kill recipe does not age while the hit-stop holds the frame', () => {
    const { sim, r, p, tank } = wired(true);
    r.frame(0.5, 16);
    const before = p.flipbook.nowMs;
    killEntity(sim, r, tank);
    r.frame(0.5, 16);
    expect(p.flipbook.nowMs).toBe(before);
    r.dispose();
  });
});
