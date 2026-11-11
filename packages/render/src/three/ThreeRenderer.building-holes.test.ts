/**
 * GH-1197 P4: real holes in buildings, through the real renderer -- which hits cut which holes (coordinator ruling Q1),
 * that the holes survive a band change, leave with the building, keep the full art at low zoom, and -- the design's
 * visual-gate argument -- that a map nobody has hit mints NO holed material at all.
 *
 * Harness: `ThreeRenderer.building-damage.test.ts`'s (a hand-built template, injected; no GLB, no GL), with real box
 * geometry so the renderer's raycast finds the wall and the roof.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import { scarredMaterial } from './units/building-damage';
import type { Hole } from './units/building-holes';
import type { BuildingHoleMaterials } from './units/holed-material';
import { BuildingCutMaterials, CUT_PROGRAM_KEY, createCutUniforms, cutColorsFor, type CutUniforms } from './units/cut-material';
import { hexToLinear } from './terrain/shared';
import { MUNITIONS } from './munitions';
import { paletteHex } from './palette-hex';

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

function unit(id: string, weapon: Record<string, unknown>): UnitTypeJson {
  return {
    id,
    role: 'armor',
    hull: { hp: 3000, armor: { front: 700, side: 300, rear: 120 } },
    mobility: { speed_tiles_s: 0 },
    sensors: { optics: 1, sight_tiles: 20 },
    weapons: [{ range_tiles: 30, effective_range_tiles: 20, accuracy: 0.8, damage: 300, suppression: 50, rof_per_min: 6, can_target: ['ground', 'structure'], ...weapon } as never],
  };
}
const TANK = unit('t_tank', { id: 'gun_120', type: 'apfsds', penetration: 700 });
const MORTAR = unit('t_mortar', { id: 'mortar_82', type: 'mortar', penetration: 35, splash_tiles: 2.0, min_range_tiles: 4 });
const SAPPER = unit('t_sapper', { id: 'charges', type: 'demolition', penetration: 200, splash_tiles: 1.2 });
const RIFLES = unit('t_rifles', { id: 'rifles', type: 'small_arms', penetration: 8 });

const W = 40;

/** A 2x2 house (tiles 20..21) as a box 1.8 x 1.0 x 1.8 tiles, base on the ground: GLB metres under MESH_SCALE. */
function template(): { template: BuildingMeshTemplate; base: THREE.MeshStandardMaterial } {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const base = new THREE.MeshStandardMaterial({ color: 0xc8b494, roughness: 0.8 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3, 5.4).translate(0, 1.5, 0), base);
  walls.name = 'walls';
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.3, 5.4).translate(0, 3.15, 0), base);
  roof.name = 'roof';
  root.add(walls, roof);
  return { template: { root, materials: [base], geometries: [] }, base };
}

interface Priv {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingMeshLod1Entities: Map<number, THREE.Object3D>;
  buildingHoles: Map<number, { holes: Hole[]; mats: BuildingHoleMaterials }>;
  buildingCuts: Map<number, { root: THREE.Object3D; mats: BuildingCutMaterials }>;
  cutUniforms: CutUniforms | null;
  applyBuildingSkin(s: number, root: THREE.Object3D): void;
  releaseBuildingCut(s: number): void;
  updateBuildingMeshes(): void;
  stepLod1(zoom: number): void;
  onStrike(e: { x: number; y: number; tick: number; profile: number }): void;
  spawnFlatFx(...args: unknown[]): void;
  scene: THREE.Scene;
}

function world(type: UnitTypeJson, at: [number, number] = [27.5, 20.5]) {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
  const t = sim.addUnitType(type);
  const shooter = sim.spawn(t, 1, fx.from(at[0]), fx.from(at[1]));
  const house = sim.addStructureType({ id: 'house', hp_per_tile: 4000, height_px: 30, color: 'limestone.3' });
  const s = sim.addStructure(house, [20 * W + 20, 20 * W + 21, 21 * W + 20, 21 * W + 21]);
  const r = new ThreeRenderer(sim, makeOpts());
  r.snapshot();
  r.snapshot();
  const p = r as unknown as Priv;
  const tpl = template();
  p.buildingMeshIdleTemplates.set('house', tpl.template);
  p.buildingMeshWreckTemplates.set('house', template().template);
  p.updateBuildingMeshes();
  return { sim, r, p, shooter, s, base: tpl.base };
}

function fireAt(shooter: number, s: number, weaponId: string, tick = 5): SimEvent {
  return {
    kind: 'fire', tick, shooter, target: -1, structure: s, weaponId, pHit: 0, roll: 0, willHit: true,
    breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0 },
  } as unknown as SimEvent;
}
function hit(shooter: number, s: number, tick = 5): SimEvent {
  return { kind: 'structureHit', tick, structure: s, by: shooter, damage: fx.from(1), hpLeft: fx.from(15999) } as SimEvent;
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** Every material in the scene whose program key names the holes. */
function holedInScene(scene: THREE.Scene): number {
  const seen = new Set<THREE.Material>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.customProgramCacheKey().includes('rl-holes')) seen.add(x);
    const d = (o as THREE.Mesh).customDepthMaterial;
    if (d && d.customProgramCacheKey().includes('rl-holes')) seen.add(d);
  });
  return seen.size;
}

describe('an unhit map mints no holed material (the quiet and relief argument, design 3a)', () => {
  it('a standing, unhit building draws its template material, front-sided, with no depth hook, frame after frame', () => {
    const { r, p, s, base } = world(TANK);
    for (let i = 0; i < 3; i++) r.frame(1, 16);
    expect(p.buildingHoles.size).toBe(0);
    expect(holedInScene(p.scene)).toBe(0);
    for (const m of meshes(p.buildingMeshIdleEntities.get(s)!)) {
      expect(m.material).toBe(base);
      expect((m.material as THREE.Material).side).toBe(THREE.FrontSide);
      expect(m.customDepthMaterial).toBeUndefined();
    }
    r.dispose();
  });
  it('a hit that cuts no hole (a rifle) mints none either', () => {
    const { r, p, shooter, s } = world(RIFLES);
    r.onEvents([fireAt(shooter, s, 'rifles'), hit(shooter, s)]);
    expect(p.buildingHoles.size).toBe(0);
    expect(holedInScene(p.scene)).toBe(0);
    r.dispose();
  });
});

describe('an explosive direct-fire hit cuts a wall hole (ruling Q1 a)', () => {
  it("a tank round on the east face: one 0.30 hole on the wall the mesh draws, facing east", () => {
    const { r, p, shooter, s } = world(TANK);
    r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
    const entry = p.buildingHoles.get(s)!;
    expect(entry.holes).toHaveLength(1);
    const h = entry.holes[0];
    expect(h.radius).toBeCloseTo(0.3, 9);
    expect(h.axis).toEqual([1, 0, 0]);
    // The box's east face is at x = 21 + 0.9 (1.8 t wide about the footprint centre): the raycast found it.
    expect(h.c[0]).toBeCloseTo(21.9, 4);
    expect(entry.mats.uniforms.uRlHoleN.value).toBe(1);
    for (const m of meshes(p.buildingMeshIdleEntities.get(s)!)) {
      expect((m.material as THREE.Material).userData.rlHoles).toBe(true);
      expect((m.material as THREE.Material).side).toBe(THREE.DoubleSide);
      expect(m.customDepthMaterial).toBe(entry.mats.depth);
    }
    r.dispose();
  });
  it("its edge is the wall's ramp and its interior dark: lip limestone.4, halo gunmetal.3, interior under half the wall", () => {
    const { r, p, shooter, s } = world(TANK);
    r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
    const u = p.buildingHoles.get(s)!.mats.uniforms;
    const lin = (key: string): number[] => hexToLinear(paletteHex(key));
    expect(u.uRlLip.value.toArray().map((v, i) => Math.abs(v - lin('limestone.4')[i]) < 1e-6)).toEqual([true, true, true]);
    expect(u.uRlHalo.value.toArray().map((v, i) => Math.abs(v - lin('gunmetal.3')[i]) < 1e-6)).toEqual([true, true, true]);
    const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(u.uRlInterior.value.toArray())).toBeLessThan(0.5 * lum(lin('limestone.3')));
    r.dispose();
  });
  it('a second round at the same spot grows the hole; it never passes 1.6x (0.48)', () => {
    const { r, p, shooter, s } = world(TANK);
    for (let k = 0; k < 12; k++) r.onEvents([fireAt(shooter, s, 'gun_120', 5), hit(shooter, s, 5)]);
    const holes = p.buildingHoles.get(s)!.holes;
    expect(holes.length).toBeLessThanOrEqual(6);
    for (const h of holes) expect(h.radius).toBeLessThanOrEqual(0.48 + 1e-9);
    r.dispose();
  });
  it('keeps its holes across a band change: the holed clone of the scarred material', () => {
    const { sim, r, p, shooter, s, base } = world(TANK);
    r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
    sim.debugDamageStructure(s, 3);
    r.onEvents(sim.tick());
    for (const m of meshes(p.buildingMeshIdleEntities.get(s)!)) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.userData.rlHoles).toBe(true);
      expect(mat.color.getHex()).toBe(scarredMaterial(base, 3).color.getHex());
    }
    r.dispose();
  });
});

describe('wall or roof is the DATA: the class row hole.axis (PR 1221 review)', () => {
  it('a direct_he row edited to `roof` makes the same tank round punch the roof', () => {
    const row = MUNITIONS.classes.direct_he!;
    const was = row.hole!.axis;
    row.hole!.axis = 'roof';
    try {
      const { r, p, shooter, s } = world(TANK);
      r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
      expect(p.buildingHoles.get(s)!.holes[0].axis).toEqual([0, 1, 0]);
      r.dispose();
    } finally {
      row.hole!.axis = was;
    }
  });
  it('a mortar row edited to `wall` makes the mortar round hole the wall facing the mortar', () => {
    const row = MUNITIONS.classes.mortar!;
    const was = row.hole!.axis;
    row.hole!.axis = 'wall';
    try {
      const { r, p, shooter, s } = world(MORTAR, [27.5, 20.5]);
      r.onEvents([fireAt(shooter, s, 'mortar_82', 5)]);
      r.onEvents([hit(shooter, s, 45)]);
      expect(p.buildingHoles.get(s)!.holes[0].axis).toEqual([1, 0, 0]);
      r.dispose();
    } finally {
      row.hole!.axis = was;
    }
  });
});

describe('holes are world state: cut during a catch-up, like the scars (ruling Q1)', () => {
  it('a tank round resolved while quiet still cuts its hole (and throws no burst)', () => {
    const { r, p, shooter, s } = world(TANK);
    r.onEvents([fireAt(shooter, s, 'gun_120')]);
    r.setQuiet(true);
    r.onEvents([hit(shooter, s)]);
    r.setQuiet(false);
    expect(p.buildingHoles.get(s)?.holes).toHaveLength(1);
    r.dispose();
  });
});

describe('an indirect round fired at the building punches the roof (ruling Q1 b)', () => {
  it('a mortar_82: a 0.25 roof hole, axis up, on the roof, inside the footprint; the centroid puff stays', () => {
    const { r, p, shooter, s } = world(MORTAR, [27.5, 20.5]);
    const puff = vi.spyOn(p, 'spawnFlatFx');
    r.onEvents([fireAt(shooter, s, 'mortar_82', 5)]);
    r.onEvents([hit(shooter, s, 45)]);
    const h = p.buildingHoles.get(s)!.holes[0];
    expect(h.radius).toBeCloseTo(0.25, 9);
    expect(h.axis).toEqual([0, 1, 0]);
    expect(h.c[0]).toBeGreaterThan(20);
    expect(h.c[0]).toBeLessThan(22);
    // The roof box's top: 3.3 m under MESH_SCALE.
    expect(h.c[1]).toBeCloseTo(3.3 * MESH_SCALE, 4);
    expect(puff.mock.calls.filter((c) => c[0] === 21 && c[1] === 21)).toHaveLength(1);
    r.dispose();
  });
});

describe('a demolition charge cuts a 0.60 wall hole at door height (ruling Q1 c)', () => {
  it('against the wall nearest the sapper', () => {
    const { r, p, shooter, s } = world(SAPPER, [22.8, 20.5]);
    r.onEvents([fireAt(shooter, s, 'charges', 5)]);
    r.onEvents([hit(shooter, s, 30)]);
    const h = p.buildingHoles.get(s)!.holes[0];
    expect(h.radius).toBeCloseTo(0.6, 9);
    expect(h.axis).toEqual([1, 0, 0]);
    expect(h.c[1]).toBeCloseTo(0.6, 4);
    r.dispose();
  });
});

describe('the strike and the barrage punch the roofs inside their splash (ruling Q1 d)', () => {
  it('the strike 0.80, the barrage round 0.25; a building outside the splash stays whole', () => {
    const strike = world(RIFLES);
    strike.p.onStrike({ x: fx.from(21), y: fx.from(23.5), tick: 9, profile: 0 });
    expect(strike.p.buildingHoles.get(strike.s)!.holes[0].radius).toBeCloseTo(0.8, 9);
    expect(strike.p.buildingHoles.get(strike.s)!.holes[0].axis).toEqual([0, 1, 0]);
    strike.r.dispose();
    const barrage = world(RIFLES);
    barrage.p.onStrike({ x: fx.from(21), y: fx.from(22.5), tick: 9, profile: 1 });
    expect(barrage.p.buildingHoles.get(barrage.s)!.holes[0].radius).toBeCloseTo(0.25, 9);
    barrage.r.dispose();
    const far = world(RIFLES);
    far.p.onStrike({ x: fx.from(30), y: fx.from(30), tick: 9, profile: 0 });
    expect(far.p.buildingHoles.size).toBe(0);
    far.r.dispose();
  });
});

describe('a holed building keeps its full art and leaves with its holes', () => {
  it('no LOD1 twin below the zoom band once holed', () => {
    const { r, p, shooter, s } = world(TANK);
    const twin = new THREE.Group();
    p.buildingMeshLod1Entities.set(s, twin);
    p.stepLod1(0.3);
    expect(twin.visible).toBe(true);
    r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
    p.stepLod1(0.3);
    expect(twin.visible).toBe(false);
    r.dispose();
  });
  it('a destroyed building releases its holed materials', () => {
    const { sim, r, p, shooter, s } = world(TANK);
    r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
    expect(p.buildingHoles.has(s)).toBe(true);
    sim.debugDestroyStructure(s);
    r.onEvents([{ kind: 'structureDestroyed', tick: sim.tickCount, structure: s, by: -1 } as SimEvent]);
    for (let i = 0; i < 40; i++) {
      p.updateBuildingMeshes();
      r.frame(1, 100);
    }
    expect(p.buildingHoles.has(s)).toBe(false);
    expect(holedInScene(p.scene)).toBe(0);
    r.dispose();
  });
});

describe('a holed building keeps its holes once a roof cut opens and closes (PR 1221 review, GH-1225 L7)', () => {
  it('hole, then cut (both hooks), then the cut closes: the holes hook is back, uRlHoleN > 0, the cut hook gone', () => {
    const { r, p, shooter, s } = world(TANK);
    r.onEvents([fireAt(shooter, s, 'gun_120'), hit(shooter, s)]);
    const entry = p.buildingHoles.get(s)!;
    const root = p.buildingMeshIdleEntities.get(s)!;
    // The cut opens as updateCutaway opens it: uniforms, the building's cut clones, then the one skin write.
    p.cutUniforms = createCutUniforms();
    const type = (r as unknown as { sim: Sim }).sim.structureTypes[0];
    p.buildingCuts.set(s, { root, mats: new BuildingCutMaterials(p.cutUniforms, cutColorsFor(type.color)) });
    p.applyBuildingSkin(s, root);
    for (const m of meshes(root)) {
      const key = (m.material as THREE.Material).customProgramCacheKey();
      expect(key).toContain('rl-holes');
      expect(key).toContain(CUT_PROGRAM_KEY);
    }
    // The cut closes.
    p.releaseBuildingCut(s);
    expect(p.buildingCuts.has(s)).toBe(false);
    expect(entry.mats.uniforms.uRlHoleN.value).toBeGreaterThan(0);
    for (const m of meshes(root)) {
      const mat = m.material as THREE.Material;
      expect(mat.userData.rlHoles).toBe(true);
      expect(mat.customProgramCacheKey()).toContain('rl-holes');
      expect(mat.customProgramCacheKey()).not.toContain(CUT_PROGRAM_KEY);
      expect(m.customDepthMaterial).toBe(entry.mats.depth);
    }
    r.dispose();
  });
});
