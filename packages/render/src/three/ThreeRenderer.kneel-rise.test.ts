/**
 * The rise plays `kneelOut`, never `kneelIn` (spike-walk follow-up, 6 Oct).
 *
 * `kneelClipFor` used to choose a transition by comparing a figure's depth
 * with the depth it is heading for: `target >= depth` -> `kneelIn`. When the
 * sim drives the stance (#402's `brace`), the depth IS the target -- the
 * renderer sets one from the other -- so the tie broke toward `kneelIn` on
 * the way UP as well as down: a rising man played his drop clip, scrubbed to
 * the rise's depth, with the drop's staging (support foot first, back knee
 * last) instead of the rise's (hips first, support foot last). It hit every
 * squad's lead figure, and every team drawn as one player (demo_squad).
 *
 * Read on the REAL shipped GLBs through the real draw loop: a unit is put in
 * each brace state by writing `sim.state.brace`/`braceTicks` directly (the
 * renderer only reads them), and the clip each figure's player holds is read
 * back. Harness as `ThreeRenderer.gait.test.ts`'s.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { BRACE_DROPPING, BRACE_KNEELING, BRACE_NONE, BRACE_RISING, KNEEL_RISE_TICKS, KNEEL_DROP_TICKS, Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { parseGlbHeadless } from './units/headless-gltf';
import { buildMeshUnitTemplate, type MeshUnitEntity, type MeshUnitTemplate } from './units/mesh-unit';
import { TEXTURED_INFANTRY_TYPES } from './units/textured-infantry';

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

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

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

interface Privates {
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  updateMeshUnits(alpha: number, dtMs: number): void;
}

const TICK_MS = 50;

/** A squad (rpg_team: two men, each on his own player, staggered 0 and 80
 *  ms) and a team drawn as one player (demo_squad: its charge rides a shared
 *  `prop` bone). Both ship kneel/kneelIn/kneelOut. */
const TEAMS = ['rpg_team', 'demo_squad'] as const;

async function setUp(team: string) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 4 });
  const type: UnitTypeJson = {
    id: team,
    role: 'infantry',
    hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
    mobility: { speed_tiles_s: 0.9 },
    sensors: { optics: 1, sight_tiles: 9, signature: 0.6 },
  };
  const id = sim.spawn(sim.addUnitType(type), 0, fx.from(10.5), fx.from(10.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Privates;
  const gltf = await parseGlbHeadless(readFileSync(`${REPO}art/meshes/${team}.glb`));
  priv.meshUnitTemplates.set(team, [buildMeshUnitTemplate(gltf, 'kdf', `${team}.glb`, TEXTURED_INFANTRY_TYPES.has(team))]);
  renderer.snapshot();
  renderer.snapshot();
  // One frame per sim tick, the brace written after the tick (the sim's own
  // machine would otherwise kneel an idle unit by itself), so presentation
  // time advances 50 ms a frame and the staggered men follow a beat late.
  const brace = (state: number, ticksLeft: number, frames: number): string[] => {
    for (let k = 0; k < frames; k++) {
      sim.tick();
      sim.state.brace[id] = state;
      sim.state.braceTicks[id] = ticksLeft;
      renderer.snapshot();
      priv.updateMeshUnits(1, TICK_MS);
    }
    const e = priv.meshUnitEntities.get(id);
    if (!e) throw new Error(`${team}: no mesh entity -- the template did not install`);
    const figs = e.squad?.squad ? e.squad.figures.map((f) => f.player?.currentClip ?? null) : [e.currentClip];
    return figs.map((c) => c ?? 'none');
  };
  return { brace };
}

describe('the kneel transitions follow the sim brace in both directions', () => {
  for (const team of TEAMS) {
    it(`${team}: dropping plays kneelIn, kneeling kneel, rising kneelOut -- never kneelIn on the way up`, async () => {
      const { brace } = await setUp(team);
      // Standing, then halfway down.
      expect(brace(BRACE_NONE, 0, 3).every((c) => c !== 'kneelIn' && c !== 'kneelOut')).toBe(true);
      const drop = brace(BRACE_DROPPING, Math.ceil(KNEEL_DROP_TICKS / 2), 1);
      expect(drop, `${team} dropping`).toContain('kneelIn');
      expect(drop, `${team} dropping`).not.toContain('kneelOut');
      // Down for long enough that every staggered man has arrived.
      expect(brace(BRACE_KNEELING, 0, 40), `${team} kneeling`).toEqual(expect.arrayContaining(['kneel']));
      // Halfway up: whoever has started up plays the RISE.
      const rise = brace(BRACE_RISING, Math.ceil(KNEEL_RISE_TICKS / 2), 1);
      expect(rise, `${team} rising`).not.toContain('kneelIn');
      expect(rise, `${team} rising`).toContain('kneelOut');
      // ...and stays on it while the others follow a beat late.
      for (let k = 0; k < 6; k++) expect(brace(BRACE_RISING, 1, 1), `${team} rising, frame ${k}`).not.toContain('kneelIn');
    }, 60_000);
  }
});
