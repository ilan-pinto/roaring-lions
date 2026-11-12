// GH-1223 slice 1: the `ragdoll` scenario frames the ragdoll showcase on `qarn_hadid`. The pure, Node-only half (no
// browser, no capture), in the shape of `aftermath.test.ts`: the camera pinned to the renderer's own site picker, the
// URL to what the app parses, and the BASELINES entry to what it declares.
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap } from '@lions/data';
import { buildTerrainSurface } from '../../../packages/render/src/three/terrain/surface';
import { SHOWCASE_CLEAR_TILES, ragdollShowcaseSite, showcaseAnchor, showcaseSites } from '../../../packages/render/src/three/decal-showcase';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { AFTERMATH_SCENARIO, RAGDOLL_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the ragdoll scenario frames the showcase it exists for', () => {
  const pm = parseMap(maps.qarn_hadid);
  const sim = new Sim({ seed: 1, width: pm.width, height: pm.height, capacity: 64 });
  applyTerrain(pm, sim);
  const input = { width: pm.width, height: pm.height, decor: pm.decor, elevation: pm.elevation, blocked: sim.blocked, cover: sim.cover };
  const [ax, ay] = sandboxAnchors(maps.qarn_hadid).friendly;
  const surface = buildTerrainSurface(input);
  // The renderer's own steps (`stampRagdollShowcase`): the decal showcase's anchor, then its site picker.
  const site = ragdollShowcaseSite(showcaseSites(input, surface, showcaseAnchor(input, surface, { x: ax, y: ay })));

  it('finds a site on qarn_hadid, clear of the sandbox force', () => {
    expect(site).not.toBeNull();
    expect(Math.hypot(site!.x - ax, site!.y - ay)).toBeGreaterThanOrEqual(SHOWCASE_CLEAR_TILES);
  });

  it('points its camera at the site (the two teams stand a tile either side of its centre), no orders', () => {
    expect(RAGDOLL_SCENARIO.cameraTile).toEqual([site!.x + 0.5, site!.y + 0.5]);
    expect(RAGDOLL_SCENARIO.orders).toBeUndefined();
    expect(RAGDOLL_SCENARIO.zoom).toBe(2.2);
  });

  it('captures at tick 300: the second team died at 292, handed over at 296, so it is 0.2 s into its fall', () => {
    expect(RAGDOLL_SCENARIO.targetTick).toBe(300);
  });

  it('boots qarn_hadid with &ragdoll and WITHOUT &decals, and nothing the app would warn about', () => {
    const url = new URL(threeUrl(5195, RAGDOLL_SCENARIO));
    expect(url.searchParams.get('sandbox')).toBe('qarn_hadid');
    expect(url.searchParams.has('ragdoll')).toBe(true);
    expect(url.searchParams.has('decals')).toBe(false);
    expect(unknownParams(url.searchParams)).toEqual([]);
    // And `aftermath` does not carry it: the existing scenario's URL is unchanged.
    expect(new URL(threeUrl(5195, AFTERMATH_SCENARIO)).searchParams.has('ragdoll')).toBe(false);
  });

  it('is gated, under aftermath\'s ceilings', () => {
    expect(SCENARIOS).toContain(RAGDOLL_SCENARIO);
    const spec = BASELINES.ragdoll;
    expect(isGated(spec)).toBe(true);
    expect(spec.maxDiffPixels).toBe(40);
    expect(spec.maxMeanAbsChannelDelta).toBe(0.004);
    // One check, the `ragdolls` layer, pending its first CI readings (infinite floors; `baseline.test.ts`'s PENDING).
    expect((spec.layerChecks ?? []).map((c) => c.layer)).toEqual(['ragdolls']);
  });
});
