/**
 * Two colour-meaning rules, pinned through the REAL `updateOverlays` (the
 * `ThreeRenderer.selection-ring.test.ts` fixture pattern):
 *
 * - VR-03: a FRIENDLY unit's HP bar, and a building the player holds, never
 *   fill in the hostile key -- whatever the ratio. A hostile keeps its red.
 * - VR-01: `setTeamColors` re-colours the world mid-mission: the ground ring,
 *   the contact mark, the HP bar's variant-aware key, the three shared
 *   occlusion-silhouette materials and the proxy boxes all read the new
 *   colours, through the renderer seam rather than a recomputation.
 *
 * Every colour below is a literal and the two team sets are DISJOINT from each
 * other and from everything else in the options, so nothing can pass by
 * coincidence.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { cachedHexToLinear, type OverlayBatch } from './units/overlays';
import { hexToLinear } from './terrain/shared';
import type { SelectionRingBatch, RingPlacement } from './units/selection-ring';
import { ProxyBoxBatch } from './units/proxy-box';

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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};

/** Boot set and switched set: [kedem, hostile, neutral]. */
const BOOT: [string, string, string] = ['#2F6FD9', '#D93A2B', '#E8C33A'];
const SWITCHED: [string, string, string] = ['#0072B2', '#D55E00', '#F0E442'];
const SCRUB = '#6B8A4A';

function resolverFor(team: readonly [string, string, string]): (key: string) => string {
  return (key) => {
    if (key === 'team.kedem') return team[0];
    if (key === 'team.hostile') return team[1];
    if (key === 'team.neutral') return team[2];
    if (key === 'scrub.0') return SCRUB;
    return '#101010';
  };
}

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: [...BOOT],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#B8FF5A', '#6FE0FF', '#FFCE5A', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    resolveColor: resolverFor(BOOT),
  };
}

const RIFLES: UnitTypeJson = {
  id: 'tc_rifles',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

interface Priv {
  overlayBatch: OverlayBatch;
  selectionRing: SelectionRingBatch;
  silhouetteMeshMaterials: THREE.MeshBasicMaterial[];
  proxyBoxes: ProxyBoxBatch | null;
  isVisible(x: number, y: number): boolean;
  updateOverlays(alpha: number): void;
}

const AT = { mine: [6.5, 6.5], theirs: [10.5, 6.5] } as const;

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
  const rifles = sim.addUnitType(RIFLES);
  const hut = sim.addStructureType({ id: 'tc_hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
  const hutMine = sim.addStructure(hut, [16 * 24 + 4]);
  const hutTheirs = sim.addStructure(hut, [16 * 24 + 14]);
  const mine = sim.spawn(rifles, 0, fx.from(AT.mine[0]), fx.from(AT.mine[1]));
  const theirs = sim.spawn(rifles, 1, fx.from(AT.theirs[0]), fx.from(AT.theirs[1]));
  const inMine = sim.spawn(rifles, 0, fx.from(4.5), fx.from(16.5));
  const inTheirs = sim.spawn(rifles, 1, fx.from(14.5), fx.from(16.5));
  sim.state.garrisonedIn[inMine] = hutMine;
  sim.state.garrisonedIn[inTheirs] = hutTheirs;
  sim.structures.occupants[hutMine] = 1;
  sim.structures.occupants[hutTheirs] = 1;
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  priv.isVisible = () => true;
  renderer.snapshot();
  renderer.snapshot();
  const rect = vi.spyOn(priv.overlayBatch, 'rect');
  const tri = vi.spyOn(priv.overlayBatch, 'triangle');
  const pushed: RingPlacement[] = [];
  const batch = priv.selectionRing;
  const real = batch.push.bind(batch);
  vi.spyOn(batch, 'push').mockImplementation((p, sampleY, key) => {
    pushed.push({ ...p });
    return real(p, sampleY, key);
  });
  const draw = (): void => {
    rect.mockClear();
    tri.mockClear();
    pushed.length = 0;
    priv.updateOverlays(1);
  };
  /** The HP-bar FILL at a unit: the third rect at its world anchor. */
  const hpFill = (at: readonly number[]): string | undefined => {
    const calls = rect.mock.calls.filter((c) => c[0][0] === at[0] && c[0][2] === at[1]);
    return calls[2]?.[5];
  };
  /** The integrity-bar FILL over a structure: the second of its two rects at
   *  alpha 0.85 then 1, keyed on the structure's footprint centre. */
  const integrityFill = (s: number): string | undefined => {
    const x = s === hutMine ? 4.5 : 14.5;
    const calls = rect.mock.calls.filter((c) => c[0][0] === x && c[0][2] === 16.5 && c[1] === -16);
    return calls[1]?.[5];
  };
  return { sim, renderer, priv, mine, theirs, hutMine, hutTheirs, rect, tri, pushed, draw, hpFill, integrityFill };
}

describe('VR-03: friendly low health is amber, never enemy red', () => {
  it('a friendly at a tenth of its health fills the warn key; a hostile at the same ratio fills hostile red', () => {
    const w = setUp();
    w.sim.state.hp[w.mine] = fx.from(30);
    w.sim.state.hp[w.theirs] = fx.from(30);
    w.draw();
    expect(w.hpFill(AT.mine)).toBe(BOOT[2]);
    expect(w.hpFill(AT.mine)).not.toBe(BOOT[1]);
    expect(w.hpFill(AT.theirs)).toBe(BOOT[1]);
  });

  it('a friendly at 1 hp still never fills hostile red; above half both sides are green', () => {
    const w = setUp();
    w.sim.state.hp[w.mine] = fx.from(1);
    w.sim.state.hp[w.theirs] = fx.from(299);
    w.draw();
    expect(w.hpFill(AT.mine)).toBe(BOOT[2]);
    expect(w.hpFill(AT.theirs)).toBe(SCRUB);
  });

  it('a building the player holds fills the warn key at low integrity; one the enemy holds keeps the red', () => {
    const w = setUp();
    const str = w.sim.structures;
    str.hp[w.hutMine] = str.maxHp[w.hutMine] * 0.1;
    str.hp[w.hutTheirs] = str.maxHp[w.hutTheirs] * 0.1;
    w.draw();
    expect(w.integrityFill(w.hutMine)).toBe(BOOT[2]);
    expect(w.integrityFill(w.hutTheirs)).toBe(BOOT[1]);
  });
});

describe('VR-01: setTeamColors re-colours the world mid-mission', () => {
  it('the ground ring, the contact mark and the HP bar draw the switched colours on the next frame', () => {
    const w = setUp();
    w.renderer.selection = [w.mine];
    w.sim.state.hp[w.mine] = fx.from(120);
    w.draw();
    expect(w.pushed.find((p) => p.x === AT.mine[0])?.color).toEqual(cachedHexToLinear(BOOT[0]));
    expect(w.tri.mock.calls.some((c) => c[2] === BOOT[1])).toBe(true);
    expect(w.hpFill(AT.mine)).toBe(BOOT[2]);

    w.renderer.setTeamColors([...SWITCHED], resolverFor(SWITCHED));
    w.draw();
    expect(w.pushed.find((p) => p.x === AT.mine[0])?.color).toEqual(cachedHexToLinear(SWITCHED[0]));
    // The contact mark over the hostile: switched hostile, and no boot red left.
    expect(w.tri.mock.calls.some((c) => c[2] === SWITCHED[1])).toBe(true);
    expect(w.tri.mock.calls.some((c) => c[2] === BOOT[1])).toBe(false);
    // The HP bar asks by KEY, so it follows the switched resolver.
    expect(w.hpFill(AT.mine)).toBe(SWITCHED[2]);
  });

  it('the three shared occlusion-silhouette materials take the switched colours in place', () => {
    const w = setUp();
    const mats = w.priv.silhouetteMeshMaterials;
    const before = mats.slice();
    expect(mats[0].color.getHexString()).toBe(new THREE.Color(BOOT[0]).getHexString());
    w.renderer.setTeamColors([...SWITCHED], resolverFor(SWITCHED));
    // The same objects -- every unit's silhouette already points at them.
    expect(w.priv.silhouetteMeshMaterials).toEqual(before);
    for (let side = 0; side < 3; side++) {
      expect(mats[side].color.getHexString()).toBe(new THREE.Color(SWITCHED[side]).getHexString());
    }
  });

  it('the proxy boxes write the switched side colour on their next update', () => {
    const w = setUp();
    const priv = w.priv as unknown as { scene: THREE.Scene; proxyBoxes: ProxyBoxBatch | null };
    // A proxy batch that already existed, built in the boot colours.
    priv.proxyBoxes = new ProxyBoxBatch(priv.scene, BOOT);
    w.renderer.setTeamColors([...SWITCHED], resolverFor(SWITCHED));
    priv.proxyBoxes.update([
      { x: 1, z: 1, groundY: 0, yaw: 0, dims: { halfAlong: 0.5, halfAcross: 0.5, height: 1, offsetAlong: 0 }, side: 0 },
    ]);
    const c = new THREE.Color();
    priv.proxyBoxes.mesh.getColorAt(0, c);
    const want = hexToLinear(SWITCHED[0]);
    expect(c.r).toBeCloseTo(want[0], 5);
    expect(c.g).toBeCloseTo(want[1], 5);
    expect(c.b).toBeCloseTo(want[2], 5);
  });
});
