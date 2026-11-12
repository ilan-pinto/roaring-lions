/**
 * GH-1223 slice 1: the ragdoll showcase (`RendererOptions.ragdollShowcase`, the gated `ragdoll` scenario's witness)
 * through the REAL renderer (WebGLRenderer stubbed), on the shipped `inf_squad` GLB and the real Rapier: two
 * renderer-only teams, one dying at sim time 0 and one at tick 292; at tick 300 the first is a frozen corpse and the
 * second is mid-fall -- in the same place, bit for bit, whatever the frame cadence; and the `ragdolls` layer hides
 * them all and stays hidden.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';
import { parseGlbHeadless } from './units/headless-gltf';
import { buildMeshUnitTemplate, type MeshUnitTemplate } from './units/mesh-unit';
import type { MeshWreck } from './units/mesh-death';
import { loadRapier } from './physics/rapier';

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

function makeOpts(quality: RenderQuality): RendererOptions {
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
    quality,
  };
}

interface Priv {
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshWrecks: MeshWreck[];
  ragdollRoots: Set<THREE.Object3D>;
  ragdolls: { incidents: number; figuresInUse: number };
}

const ON: RenderQuality = { ...QUALITY_PRESETS.high, physics: { ragdolls: 16 } };
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
let template: MeshUnitTemplate;
beforeAll(async () => {
  template = buildMeshUnitTemplate(await parseGlbHeadless(readFileSync(`${REPO}art/meshes/inf_squad.glb`)), 'kdf', 'inf_squad.glb');
  await loadRapier();
}, 60_000);

async function showcase(framesPerTick: number, toTick: number, quality = ON) {
  const sim = new Sim({ seed: 3, width: 40, height: 40, capacity: 2 });
  const r = new ThreeRenderer(sim, { ...makeOpts(quality), ragdollShowcase: { x: 5, y: 5 } });
  const p = r as unknown as Priv;
  p.meshUnitTemplates.set('inf_squad', [template]);
  await new Promise((res) => setTimeout(res, 0));
  r.snapshot();
  r.snapshot();
  r.frame(1, 16);
  while (sim.tickCount < toTick) {
    sim.tick();
    r.snapshot();
    for (let k = 1; k <= framesPerTick; k++) r.frame(k / framesPerTick, 50 / framesPerTick);
  }
  return { sim, r, p };
}

function digest(roots: Iterable<THREE.Object3D>): string {
  const xs: number[] = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) xs.push(...o.matrixWorld.elements);
    });
  }
  const bytes = new Uint8Array(new Float64Array(xs).buffer);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h >>> 0).toString(16);
}

describe('the ragdoll showcase (the gated `ragdoll` scenario)', () => {
  it('stands two teams (six figures) on the first frame, renderer-only', async () => {
    const { r, p } = await showcase(1, 0);
    expect(p.ragdollRoots.size).toBe(2);
    expect(p.ragdolls.incidents).toBe(2);
    expect(p.ragdolls.figuresInUse).toBe(6);
    r.dispose();
  });

  it('at tick 300 the first team is a frozen corpse and the second is mid-fall', async () => {
    const { r, p } = await showcase(1, 300);
    expect(p.meshWrecks).toHaveLength(1);
    expect(p.ragdolls.incidents).toBe(1);
    r.dispose();
  });

  it('mid-fall at tick 300, the bodies are bit-identical whatever the frame cadence', async () => {
    const a = await showcase(1, 300);
    const b = await showcase(3, 300);
    expect(digest(b.p.ragdollRoots)).toBe(digest(a.p.ragdollRoots));
    a.r.dispose();
    b.r.dispose();
  });

  it('the `ragdolls` layer hides every figure, and a repaint does not undo it', async () => {
    const { sim, r, p } = await showcase(1, 300);
    expect(r.setDebugLayerVisible('ragdolls', false)).toBe(2);
    sim.tick();
    r.snapshot();
    r.frame(1, 50);
    for (const root of p.ragdollRoots) expect(root.visible).toBe(false);
    expect(r.setDebugLayerVisible('ragdolls', true)).toBe(2);
    r.dispose();
  });

  it('with no ragdoll cap (every shipped preset), the showcase stands nothing', async () => {
    const { r, p } = await showcase(1, 2, QUALITY_PRESETS.high);
    expect(p.ragdollRoots.size).toBe(0);
    r.dispose();
  });
});
