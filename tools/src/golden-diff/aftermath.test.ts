// Task 17 of `docs/superpowers/plans/2026-09-25-ground-plan-1.md`: the
// `aftermath` scenario frames the decal showcase (D4) on `qarn_hadid`, the
// only shipped map with a `relief` showcase site. This file is the pure,
// Node-only half -- no browser, no WebGL, no capture -- that pins the
// scenario's camera to the showcase's own site picker, its URL to what the
// app actually parses, and its `BASELINES` entry to the four layers it
// declares (F-8b's coverage pin lives in `baseline.test.ts`, not here).
//
// `showcaseSites`/`decalShowcase` (`packages/render/src/three/decal-showcase.ts`)
// are pure and three-free (F-27), so this test can import them directly
// without pulling `three` into `pnpm test` -- the same reason
// `decal-maths.ts` exists at all.

import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap } from '@lions/data';
import { buildTerrainSurface } from '../../../packages/render/src/three/terrain/surface';
import { showcaseSites } from '../../../packages/render/src/three/decal-showcase';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { AFTERMATH_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the aftermath scenario frames the showcase it exists for', () => {
  const pm = parseMap(maps.qarn_hadid);
  const sim = new Sim({ seed: 1, width: pm.width, height: pm.height, capacity: 64 });
  applyTerrain(pm, sim);
  const input = { width: pm.width, height: pm.height, decor: pm.decor, elevation: pm.elevation, blocked: sim.blocked, cover: sim.cover };
  const [ax, ay] = sandboxAnchors(maps.qarn_hadid).friendly;
  const sites = showcaseSites(input, buildTerrainSurface(input), { x: ax, y: ay });

  it('finds all three sites on qarn_hadid', () => {
    expect(sites.map((s) => s.kind).sort()).toEqual(['flat', 'relief', 'road']);
  });

  it('points its camera at their centroid', () => {
    const cx = sites.reduce((a, s) => a + s.x + 0.5, 0) / sites.length;
    const cy = sites.reduce((a, s) => a + s.y + 0.5, 0) / sites.length;
    expect(AFTERMATH_SCENARIO.cameraTile).toEqual([Math.round(cx * 2) / 2, Math.round(cy * 2) / 2]);
  });

  it('boots qarn_hadid with &decals and nothing the app would warn about', () => {
    const url = new URL(threeUrl(5195, AFTERMATH_SCENARIO));
    expect(url.searchParams.get('sandbox')).toBe('qarn_hadid');
    expect(url.searchParams.has('decals')).toBe(true);
    expect(unknownParams(url.searchParams)).toEqual([]);
  });

  it('is gated and carries decals, roads, macro and scatter (D4)', () => {
    expect(SCENARIOS).toContain(AFTERMATH_SCENARIO);
    const spec = BASELINES.aftermath;
    expect(isGated(spec)).toBe(true);
    expect((spec.layerChecks ?? []).map((c) => c.layer).sort()).toEqual(['decals', 'macro', 'roads', 'scatter']);
  });
});
