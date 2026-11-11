/**
 * GH-1197 Phase 1: the WIRING. `munitions.test.ts` and `units/blast-ring.test.ts`
 * prove the table and the ring in isolation; this file asks whether
 * `ThreeRenderer` carries a weapon's class and reach from its `fire` event to
 * the frame its round lands, and throws the class blast and the two-part ring
 * there. The weapons are the shipped ones, read from `data/units` at test
 * time, so a renamed weapon or a changed splash is seen here too.
 *
 * Harness: the `vi.mock('three')` stand-in `ThreeRenderer.blast.test.ts` uses
 * (the constructor builds everything but the WebGL context).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { DecalStamp } from './decal-pool';
import type { EmitterSpec, FlipbookLayerSpec } from '../vfx/emitters';
import type { RingSpec } from './munitions';
import type { ShellModel } from './units/shells';
import type { MissileModel } from './units/missiles';
import type { DebrisPool } from './units/debris-pool';
import { QUALITY_PRESETS } from '../quality';
import { hexToLinear } from './terrain/shared';
import { paletteHex } from './palette-hex';
import shellImpact from '../../../../data/vfx/shell_impact.json';
import barrageImpact from '../../../../data/vfx/barrage_impact.json';
import airStrikeImpact from '../../../../data/vfx/air_strike_impact.json';

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

/** A shipped unit's weapons, on a trimmed hull the sim accepts. */
function shooterType(file: string, id: string): UnitTypeJson {
  const u = JSON.parse(readFileSync(new URL(`../../../../data/units/${file}`, import.meta.url), 'utf8')) as {
    weapons: UnitTypeJson['weapons'];
  };
  return {
    id,
    role: 'artillery',
    hull: { hp: 1000, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 0 },
    sensors: { optics: 1, sight_tiles: 30 },
    weapons: u.weapons,
  };
}

const TARGET: UnitTypeJson = {
  id: 't_target',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1 },
};

interface Priv {
  shells: ShellModel[];
  missileFx: { missiles: MissileModel[] };
  blastRings: {
    liveCount: number;
    liveRings(): { x: number; z: number; spec: RingSpec; outer: unknown }[];
    additive: { bands: number; vertex(v: number): { r: number; g: number; b: number } };
    normal: { bands: number; vertex(v: number): { r: number; g: number; b: number } };
  };
  flashLights: { spawn(...args: unknown[]): void };
  flipbook: { setAtlases(a: THREE.Texture, b: THREE.Texture): void; spawnRecipe(layers: readonly FlipbookLayerSpec[], ...rest: unknown[]): number };
  hitStop: { remainingMs: number };
  shakeState: { live: readonly { amplitudePx: number; falloffTiles: number }[] };
  stampGroundDecal(s: DecalStamp): boolean;
  onStrike(e: { x: number; y: number; tick: number; profile: number }): void;
  debris: DebrisPool | null;
  cssWidth: number;
  cssHeight: number;
}

function world(
  file: string,
  typeId: string,
  quality?: RendererOptions['quality']
): { sim: Sim; r: ThreeRenderer; p: Priv; shooter: number; target: number } {
  const sim = new Sim({ seed: 3, width: 40, height: 40, capacity: 8 });
  const st = sim.addUnitType(shooterType(file, typeId));
  const tt = sim.addUnitType(TARGET);
  const shooter = sim.spawn(st, 0, fx.from(5.5), fx.from(20.5));
  const target = sim.spawn(tt, 1, fx.from(17.5), fx.from(20.5));
  const r = new ThreeRenderer(sim, { ...makeOpts(), ...(quality ? { quality } : {}) });
  r.useEmitters(
    [shellImpact, barrageImpact, airStrikeImpact] as unknown as EmitterSpec[],
    (key) => (key.startsWith('#') ? key : '#FFB43C')
  );
  const p = r as unknown as Priv;
  p.cssWidth = 1400;
  p.cssHeight = 900;
  r.snapshot();
  r.snapshot();
  return { sim, r, p, shooter, target };
}

function fireEvent(shooter: number, target: number, weaponId: string): SimEvent {
  return {
    kind: 'fire', tick: 1, shooter, target, weaponId, pHit: 0, roll: 0, willHit: true,
    breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0 },
  } as unknown as SimEvent;
}

/** Frames until the round is down (the frame clock, 50 ms a frame). */
function landAll(r: ThreeRenderer, p: Priv): void {
  for (let i = 0; i < 400 && p.shells.length > 0; i++) r.frame(1, 50);
  expect(p.shells).toHaveLength(0);
}

describe("the Te'o 155 lands as its class (GH-1197 P1)", () => {
  it('carries heavy_artillery at S 2.4 from the fire event onto its shell', () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    expect(p.shells).toHaveLength(1);
    expect(p.shells[0].munition?.cls).toBe('heavy_artillery');
    expect(p.shells[0].munition?.splash).toBeCloseTo(2.4, 4);
    r.dispose();
  });

  it('throws the two-part ring, the class light and shake, no hit-stop, and the c x S / s x S marks', () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    const light = vi.spyOn(p.flashLights, 'spawn');
    const stamps = vi.spyOn(p, 'stampGroundDecal');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    const rings = p.blastRings.liveRings();
    expect(rings).toHaveLength(1);
    expect(rings[0].spec.splash).toBeCloseTo(2.4, 4);
    expect(rings[0].spec.outerK * rings[0].spec.splash).toBeCloseTo(3.84, 3);
    const spec = light.mock.calls[0][3] as { intensity: number; radius_tiles: number; decay_ms: number };
    expect(spec.intensity).toBe(3.2);
    expect(spec.radius_tiles).toBeCloseTo(6, 3);
    expect(spec.decay_ms).toBe(450);
    expect(p.hitStop.remainingMs).toBe(0);
    expect(p.shakeState.live.some((s) => s.amplitudePx === 4 && s.falloffTiles === 12)).toBe(true);
    const crater = stamps.mock.calls.find(([s]) => s.kind === 'crater')?.[0];
    const scorch = stamps.mock.calls.find(([s]) => s.kind === 'scorch')?.[0];
    expect(crater?.halfLength).toBeCloseTo(0.96, 3);
    expect(scorch?.halfLength).toBeCloseTo(1.44, 3);
    r.dispose();
  });

  it('spawns the class recipe, 76 billows, once the flipbook can draw', () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    p.flipbook.setAtlases(new THREE.Texture(), new THREE.Texture());
    const spawn = vi.spyOn(p.flipbook, 'spawnRecipe');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    const counts = spawn.mock.calls.map(([layers]) => layers.reduce((n, l) => n + l.count, 0));
    expect(counts).toContain(76);
    r.dispose();
  });
});

describe('the ring colours reach the vertex buffer LINEAR (CLAUDE.md: hexToLinear)', () => {
  it('the inner ring is hexToLinear(vfx.white_hot) and the outer wave hexToLinear(dust.2)', () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    r.frame(1, 16);
    // Oracles from the palette, not from the code under test.
    const hot = hexToLinear(paletteHex('vfx.white_hot'));
    const dust = hexToLinear(paletteHex('dust.2'));
    expect(p.blastRings.additive.bands).toBeGreaterThan(0);
    const inner = p.blastRings.additive.vertex(0);
    expect([inner.r, inner.g, inner.b].map((c, i) => c - hot[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
    // Until the outer wave is live (from 260 ms, a ring's inner peak).
    for (let i = 0; i < 40 && !p.blastRings.liveRings().some((g) => g.outer !== null); i++) r.frame(1, 16);
    expect(p.blastRings.normal.bands).toBeGreaterThan(0);
    const outer = p.blastRings.normal.vertex(0);
    expect([outer.r, outer.g, outer.b].map((c, i) => c - dust[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
    // And not the raw sRGB channels: the oracle can tell the two apart for this key.
    expect(Math.abs(outer.r - parseInt(paletteHex('dust.2').slice(1, 3), 16) / 255)).toBeGreaterThan(1e-3);
    r.dispose();
  });
});

describe('a mortar keeps its look and gains its ring', () => {
  it("mortar_82: today's hit-stop and crater, plus a 2.0 / 2.5 ring", () => {
    const { r, p, shooter, target } = world('enemy/mortar_crew.json', 't_mortar');
    const stamps = vi.spyOn(p, 'stampGroundDecal');
    r.onEvents([fireEvent(shooter, target, 'mortar_82')]);
    landAll(r, p);
    expect(p.hitStop.remainingMs).toBeGreaterThan(0);
    expect(stamps.mock.calls.find(([s]) => s.kind === 'crater')?.[0].halfLength).toBeCloseTo(0.45, 9);
    const rings = p.blastRings.liveRings();
    expect(rings).toHaveLength(1);
    expect(rings[0].spec.splash).toBeCloseTo(2, 4);
    expect(rings[0].spec.outerK * rings[0].spec.splash).toBeCloseTo(2.5, 3);
    r.dispose();
  });
});

describe('the fire-support calls ring at the sim splash (coordinator ruling Q2)', () => {
  it('the strike: 2.0 inner, 3.2 outer (was a single 2.2 ring); the barrage round: 1.0 / 1.25', () => {
    const { r, p } = world('enemy/mortar_crew.json', 't_mortar');
    p.onStrike({ x: fx.from(10), y: fx.from(10), tick: 1, profile: 0 });
    p.onStrike({ x: fx.from(20), y: fx.from(10), tick: 1, profile: 1 });
    const rings = p.blastRings.liveRings();
    expect(rings).toHaveLength(2);
    const strike = rings.find((g) => g.x === 10)!.spec;
    const round = rings.find((g) => g.x === 20)!.spec;
    expect(strike.splash).toBe(2);
    expect(strike.outerK * strike.splash).toBeCloseTo(3.2, 9);
    expect(round.splash).toBe(1);
    expect(round.outerK * round.splash).toBeCloseTo(1.25, 9);
    r.dispose();
  });
});

describe('a cluster round rings every bomblet, inner only', () => {
  it('dpicm_155: a 0.8-tile ring where each bomblet lands', () => {
    const { r, p, shooter } = world('kdf/spg_cluster.json', 't_cluster');
    const events: SimEvent[] = [];
    for (let k = 0; k < 3; k++) {
      events.push({ kind: 'submunition', tick: 1, by: shooter, weaponId: 'dpicm_155', x: fx.from(10 + k), y: fx.from(10), index: k, count: 12 } as SimEvent);
    }
    r.onEvents(events);
    const rings = p.blastRings.liveRings();
    expect(rings).toHaveLength(3);
    for (const g of rings) {
      expect(g.spec.splash).toBeCloseTo(0.8, 4);
      expect(g.spec.outerK).toBe(1);
    }
    r.dispose();
  });
});

describe('a missile with a reach carries it to its landing', () => {
  it('hellfire: the launched missile holds direct_he at 0.8', () => {
    const { r, p, shooter, target } = world('kdf/heli_peten.json', 't_heli');
    r.onEvents([fireEvent(shooter, target, 'hellfire')]);
    const m = p.missileFx.missiles[0];
    expect(m?.munition).toEqual({ cls: 'direct_he', splash: expect.closeTo(0.8, 4) as unknown as number });
    r.dispose();
  });
});

describe('every landing with a reach throws its class debris (GH-1197 P2, coordinator ruling Q1)', () => {
  it("the 155: 36 clods and 18 chunks into the pool, in the ground's own ramp", () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    expect(p.debris?.liveCount).toBe(54);
    // The test map's open tone is limestone.3 (#C8B494): clods limestone.2, chunks limestone.4 / .5, charred gunmetal.2.
    const lin = (key: string): number[] => hexToLinear(paletteHex(key));
    const seen = new Set<string>();
    for (let shape = 0; shape < 3; shape++) {
      for (let i = 0; i < 18; i++) {
        const c = p.debris!.slot(shape, i).color;
        const hit = ['limestone.2', 'limestone.4', 'limestone.5', 'gunmetal.2'].find((k) =>
          lin(k).every((v, j) => Math.abs(v - [c.r, c.g, c.b][j]) < 1e-6)
        );
        expect(hit, `shape ${shape} slot ${i}`).toBeDefined();
        seen.add(hit!);
      }
    }
    expect([...seen].sort()).toEqual(['gunmetal.2', 'limestone.2', 'limestone.4', 'limestone.5']);
    r.dispose();
  });

  it('a mortar_82 throws its own row (16 + 6), a DPICM bomblet 4 clods', () => {
    const mortar = world('enemy/mortar_crew.json', 't_mortar');
    mortar.r.onEvents([fireEvent(mortar.shooter, mortar.target, 'mortar_82')]);
    landAll(mortar.r, mortar.p);
    expect(mortar.p.debris?.liveCount).toBe(22);
    mortar.r.dispose();
    const cluster = world('kdf/spg_cluster.json', 't_cluster');
    cluster.r.onEvents([
      { kind: 'submunition', tick: 1, by: cluster.shooter, weaponId: 'dpicm_155', x: fx.from(10), y: fx.from(10), index: 0, count: 12 } as SimEvent,
    ]);
    expect(cluster.p.debris?.liveCount).toBe(4);
    cluster.r.dispose();
  });

  it('the low preset builds no pool: the dirt flipbook only', () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg', QUALITY_PRESETS.low);
    expect(p.debris).toBeNull();
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    r.dispose();
  });

  it('a catch-up places the strike debris at rest, with no ring', () => {
    const { r, p } = world('enemy/mortar_crew.json', 't_mortar');
    r.setQuiet(true);
    p.onStrike({ x: fx.from(10), y: fx.from(10), tick: 1, profile: 0 });
    r.setQuiet(false);
    expect(p.blastRings.liveCount).toBe(0);
    expect(p.debris!.liveCount).toBe(72);
    expect(p.debris!.slot(0, 0).t.slice(1)).toEqual([0, 0, 0]);
    r.dispose();
  });
});

describe('the debris pool rides the renderer clocks (PR 1218 review)', () => {
  it('each frame advances its flight clock by the frame time, and hands it the presented sim time', () => {
    const { sim, r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    const pool = p.debris!;
    const t0 = pool.nowMs;
    r.frame(1, 40);
    r.frame(1, 40);
    // The 155 asks no hit-stop, so every frame's time reaches the pool.
    expect(pool.nowMs - t0).toBeCloseTo(80, 6);
    for (let i = 0; i < 30; i++) sim.tick();
    r.snapshot();
    r.frame(1, 16);
    // `frame(alpha 1)` presents the sim's last tick: 50 ms a tick, never 0.
    expect(pool.simMs).toBeGreaterThan(0);
    expect(pool.simMs).toBeCloseTo(sim.tickCount * 50, -2);
    r.dispose();
  });

  it('the minimap photograph hides the pool and puts it back', () => {
    const { r, p, shooter, target } = world('kdf/spg_long_range.json', 't_spg');
    r.onEvents([fireEvent(shooter, target, 'howitzer_155')]);
    landAll(r, p);
    const priv = r as unknown as { hideForGroundPhoto(): () => void };
    expect(p.debris!.group.visible).toBe(true);
    const restore = priv.hideForGroundPhoto();
    expect(p.debris!.group.visible).toBe(false);
    restore();
    expect(p.debris!.group.visible).toBe(true);
    r.dispose();
  });
});
