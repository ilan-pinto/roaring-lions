// GH-1400: the `soft-smoke` scenario, the soft-particle G-visual witness. The pure, Node-only half (no browser, no capture),
// in the shape of `ragdoll.test.ts`: the framing is `aftermath`'s own, the URL is what the app parses with nothing it would
// warn about, the orders refuse a frame with nothing to fade, and the BASELINES entry votes the `soft-depth` layer on the
// world view only.
import { describe, expect, it } from 'vitest';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { AFTERMATH_SCENARIO, SCENARIOS, SOFT_SMOKE_SCENARIO, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the soft-smoke scenario', () => {
  it("is aftermath's own map, camera, zoom and tick, without &decals", () => {
    expect(SOFT_SMOKE_SCENARIO.sandboxMap).toBe(AFTERMATH_SCENARIO.sandboxMap);
    expect(SOFT_SMOKE_SCENARIO.cameraTile).toEqual(AFTERMATH_SCENARIO.cameraTile);
    expect(SOFT_SMOKE_SCENARIO.zoom).toBe(AFTERMATH_SCENARIO.zoom);
    expect(SOFT_SMOKE_SCENARIO.targetTick).toBe(AFTERMATH_SCENARIO.targetTick);
    const url = new URL(threeUrl(5195, SOFT_SMOKE_SCENARIO));
    expect(url.searchParams.get('sandbox')).toBe('qarn_hadid');
    expect(url.searchParams.has('decals')).toBe(false);
    expect(unknownParams(url.searchParams)).toEqual([]);
  });

  it('lands twelve rockets at the capture tick, ages them on a fixed frame, and refuses a frame with nothing to fade', () => {
    const o = SOFT_SMOKE_SCENARIO.orders;
    expect(o?.atTick).toBe(SOFT_SMOKE_SCENARIO.targetTick);
    const js = (o?.commands ?? []).join('\n');
    expect(js).toContain("spawnShellLandingAt('rocket'");
    expect(js).toContain('i < 12');
    expect(js).toContain('r.frame(1, 16)');
    expect(js).toMatch(/liveCount > 0\)\) throw/);
    expect(js).toMatch(/!r\.softDepth\) throw/);
    // Every landing inside the zoom-2.2 frame: the lattice stays within 4.25 tiles of the camera.
    const [cx, cy] = SOFT_SMOKE_SCENARIO.cameraTile ?? [0, 0];
    for (let i = 0; i < 12; i++) {
      expect(Math.abs(30.75 + (i % 4) * 2.5 - cx)).toBeLessThanOrEqual(4.25);
      expect(Math.abs(29.5 + Math.floor(i / 4) * 2.5 - cy)).toBeLessThanOrEqual(4.25);
    }
  });

  it('is gated, under aftermath\'s ceilings, and votes the soft-depth layer on the world view (no HUD, no minimap)', () => {
    expect(SCENARIOS).toContain(SOFT_SMOKE_SCENARIO);
    const spec = BASELINES['soft-smoke'];
    expect(spec).toBeDefined();
    expect(isGated(spec!)).toBe(true);
    expect(spec!.maxDiffPixels).toBe(40);
    expect(spec!.maxMeanAbsChannelDelta).toBe(0.004);
    expect((spec!.layerChecks ?? []).map((c) => c.layer)).toEqual(['soft-depth']);
    const region = spec!.layerChecks?.[0]?.region;
    expect(region).toEqual({ x: 0, y: 48, w: 1170, h: 852 });
  });

  it('the probe is gone: no other scenario carries a soft-depth check', () => {
    for (const [id, s] of Object.entries(BASELINES)) {
      if (id === 'soft-smoke') continue;
      expect((s.layerChecks ?? []).some((c) => c.layer === 'soft-depth'), id).toBe(false);
    }
  });
});
