/**
 * Polish VR-12: the hit flash wears the TARGET's team colour, like the pulse
 * ring it accompanies (`drawFireLinkOverlays`: `teamColors[st.side[target]]`).
 * It used to build one material from `teamColors[1]` for every target, so a
 * friendly unit hit by enemy fire flashed enemy red.
 *
 * Driven through the real `stepFireLinkFlashes`, with a stand-in mesh root
 * carrying one silhouette-marked mesh -- the swap is the whole behaviour, and
 * it is what the player sees for `HIT_FLASH_S`.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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

/** Three DISTINCT team colours, so a flash on the wrong side cannot pass. */
const TEAM = ['#2F6FD9', '#D93A2B', '#E8C33A'] as const;

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: [...TEAM],
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

const TANK: UnitTypeJson = {
  id: 'flash_tank',
  role: 'tank',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface P {
  meshUnitEntities: Map<number, { root: THREE.Object3D }>;
  fireLinkFlashes: { target: number; startS: number }[];
  fireLinkClockS: number;
  stepFireLinkFlashes(): void;
  stepSmokeOutlines(): void;
  smokeOutlineInfantryMaterial: THREE.MeshBasicMaterial | null;
  silhouetteMaterialFor(side: number): THREE.MeshBasicMaterial;
}

/** GH-705: the smoke outline and the hit flash swap the same meshes. The flash
 *  owns them while it runs; afterwards the unit wears the material its smoke
 *  state says, never a stale smoke material. */
describe('smoke outline and hit flash share the silhouette meshes (GH-705)', () => {
  function rig() {
    const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 4 });
    const id = sim.spawn(sim.addUnitType(TANK), 0, fx.from(8.5), fx.from(8.5));
    let smoke = 255;
    vi.spyOn(sim, 'smokeAt').mockImplementation(() => smoke);
    const r = new ThreeRenderer(sim, makeOpts());
    const p = r as unknown as P;
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.userData.rl_silhouette = true;
    root.add(mesh);
    p.meshUnitEntities.set(id, { root });
    const plain = p.silhouetteMaterialFor(0);
    mesh.material = plain;
    const done = (): void => { p.meshUnitEntities.delete(id); r.dispose(); };
    return { p, id, mesh, plain, setSmoke: (v: number) => { smoke = v; }, done };
  }
  const frame = (p: P): void => { p.stepFireLinkFlashes(); p.stepSmokeOutlines(); };

  it('a flash that starts on a smoked unit shows, and the unit is plain after it, out of smoke', () => {
    const { p, id, mesh, plain, setSmoke, done } = rig();
    frame(p);
    expect(mesh.material).toBe(p.smokeOutlineInfantryMaterial);
    p.fireLinkFlashes = [{ target: id, startS: 0 }];
    p.fireLinkClockS = 0.01;
    frame(p);
    expect(mesh.material).not.toBe(p.smokeOutlineInfantryMaterial);
    expect(mesh.material).not.toBe(plain); // the flash material
    p.fireLinkClockS = 0.02;
    frame(p);
    expect(mesh.material).not.toBe(plain); // still the flash
    setSmoke(0);
    p.fireLinkClockS = 99;
    frame(p);
    expect(mesh.material).toBe(plain);
    done();
  });

  it('after the flash a unit still in smoke wears the smoke outline again', () => {
    const { p, id, mesh, done } = rig();
    frame(p);
    p.fireLinkFlashes = [{ target: id, startS: 0 }];
    p.fireLinkClockS = 0.01;
    frame(p);
    p.fireLinkClockS = 99;
    frame(p);
    expect(mesh.material).toBe(p.smokeOutlineInfantryMaterial);
    done();
  });
});

