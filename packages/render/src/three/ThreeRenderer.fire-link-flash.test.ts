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

interface FlashPrivate {
  meshUnitEntities: Map<number, { root: THREE.Object3D }>;
  fireLinkFlashes: { target: number; startS: number }[];
  fireLinkClockS: number;
  stepFireLinkFlashes(): void;
}

/** The colour a target's silhouette wears once its hit lands -- optionally
 *  after a mid-mission colour-vision switch (VR-01's `setTeamColors`). */
function flashColourFor(side: number, switchTo?: [string, string, string]): string {
  const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 4 });
  const idx = sim.addUnitType(TANK);
  const id = sim.spawn(idx, side, fx.from(8.5), fx.from(8.5));
  const r = new ThreeRenderer(sim, makeOpts());
  const priv = r as unknown as FlashPrivate;
  const root = new THREE.Group();
  const outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  outline.userData.rl_silhouette = true;
  root.add(outline);
  priv.meshUnitEntities.set(id, { root });
  priv.fireLinkFlashes = [{ target: id, startS: 0 }];
  priv.fireLinkClockS = 0.01;
  priv.stepFireLinkFlashes();
  if (switchTo) r.setTeamColors(switchTo, (key) => key);
  const hex = '#' + (outline.material as THREE.MeshBasicMaterial).color.getHexString().toUpperCase();
  // The stand-in has no mixer for `dispose` to stop.
  priv.meshUnitEntities.delete(id);
  r.dispose();
  return hex;
}

describe('the hit flash wears the target\'s side (VR-12)', () => {
  it('a friendly target flashes friendly', () => {
    expect(flashColourFor(0)).toBe(TEAM[0]);
  });

  it('a hostile target flashes hostile', () => {
    expect(flashColourFor(1)).toBe(TEAM[1]);
  });

  it('a neutral target flashes neutral', () => {
    expect(flashColourFor(2)).toBe(TEAM[2]);
  });

  it('a colour-vision switch re-colours each side\'s flash in its own colour (VR-01)', () => {
    const next: [string, string, string] = ['#3E5C2E', '#E8541E', '#A9C4D1'];
    expect(flashColourFor(0, next)).toBe(next[0]);
    expect(flashColourFor(1, next)).toBe(next[1]);
  });
});
