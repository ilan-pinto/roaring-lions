// GH-1197 P5: the `rubble` scenario frames the settled-rubble showcase on `qarn_hadid`. The pure, Node-only half (no
// browser, no capture), in the shape of `aftermath.test.ts`: the camera pinned to the renderer's own site picker, the
// URL to what the app parses, and the BASELINES entry to what it declares.
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap } from '@lions/data';
import { buildTerrainSurface } from '../../../packages/render/src/three/terrain/surface';
import { SHOWCASE_CLEAR_TILES, showcaseAnchor, showcaseSites } from '../../../packages/render/src/three/decal-showcase';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { AFTERMATH_SCENARIO, RUBBLE_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the rubble scenario frames the showcase it exists for', () => {
  const pm = parseMap(maps.qarn_hadid);
  const sim = new Sim({ seed: 1, width: pm.width, height: pm.height, capacity: 64 });
  applyTerrain(pm, sim);
  const input = { width: pm.width, height: pm.height, decor: pm.decor, elevation: pm.elevation, blocked: sim.blocked, cover: sim.cover };
  const [ax, ay] = sandboxAnchors(maps.qarn_hadid).friendly;
  const surface = buildTerrainSurface(input);
  // The renderer's own steps (`stampRubbleShowcase`): the decal showcase's anchor, its flat and road sites.
  const sites = showcaseSites(input, surface, showcaseAnchor(input, surface, { x: ax, y: ay })).filter(
    (s) => s.kind === 'flat' || s.kind === 'road'
  );

  it('finds the flat site (the 3x3 house) and the road site (the 2x2 shed) on qarn_hadid', () => {
    expect(sites.map((s) => s.kind).sort()).toEqual(['flat', 'road']);
  });

  it('stands both clear of the sandbox force, with no orders and no unit flown over them', () => {
    for (const s of sites) expect(Math.hypot(s.x - ax, s.y - ay)).toBeGreaterThanOrEqual(SHOWCASE_CLEAR_TILES);
    expect(RUBBLE_SCENARIO.orders).toBeUndefined();
    expect(RUBBLE_SCENARIO.zoom).toBe(2.2);
  });

  it('points its camera at the two collapses: the centroid of their footprint centres', () => {
    // The house (3x3) is centred on its site's tile centre; the shed (2x2) spans its site and the next tile, so its
    // centre is the site's far corner.
    const flat = sites.find((s) => s.kind === 'flat')!;
    const road = sites.find((s) => s.kind === 'road')!;
    const cx = (flat.x + 0.5 + road.x + 1) / 2;
    const cy = (flat.y + 0.5 + road.y + 1) / 2;
    expect(RUBBLE_SCENARIO.cameraTile).toEqual([Math.round(cx * 2) / 2, Math.round(cy * 2) / 2]);
  });

  it('boots qarn_hadid with &rubble and WITHOUT &decals, and nothing the app would warn about', () => {
    const url = new URL(threeUrl(5195, RUBBLE_SCENARIO));
    expect(url.searchParams.get('sandbox')).toBe('qarn_hadid');
    expect(url.searchParams.has('rubble')).toBe(true);
    expect(url.searchParams.has('decals')).toBe(false);
    expect(unknownParams(url.searchParams)).toEqual([]);
    // And `aftermath` does not carry it: the existing scenario's URL is unchanged.
    expect(new URL(threeUrl(5195, AFTERMATH_SCENARIO)).searchParams.has('rubble')).toBe(false);
  });

  it('is gated, under aftermath\'s ceilings, and votes the debris layer (pending its first CI readings)', () => {
    expect(SCENARIOS).toContain(RUBBLE_SCENARIO);
    const spec = BASELINES.rubble;
    expect(isGated(spec)).toBe(true);
    expect(spec.maxDiffPixels).toBe(40);
    expect(spec.maxMeanAbsChannelDelta).toBe(0.004);
    expect((spec.layerChecks ?? []).map((c) => c.layer)).toEqual(['debris']);
  });
});
