/**
 * The rain's height bake on a real wetland map (GH-871 P4 T8): `ein_qasab`, booted through the app's
 * own route (`rendererOptionsFor`) into the real `ThreeRenderer` over a faked `WebGLRenderer` (the
 * `theme-identity.test.ts` harness), one `frame()` run so the terrain exists.
 *
 *  - the baked half floats read `groundWorldY` at the texel CENTRES within 1e-3, on the drawn
 *    surface (relief included: the test requires the bake to span a real height range);
 *  - the bake costs under 5 ms on this map, the BEST of five runs (a loaded machine inflates a
 *    run, never deflates one). The two figures measured at write time are recorded in the
 *    comment on `BAKE_BUDGET_MS`.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as ThreeTypes from '../../packages/render/node_modules/@types/three';
// @ts-expect-error TS7016: the entry file carries no declarations; typed by the cast below.
import * as ThreeRuntime from '../../packages/render/node_modules/three/build/three.module.js';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain } from '@lions/data';
import { ThreeRenderer } from '../../packages/render/src/three/ThreeRenderer';
import { groundWorldY } from '../../packages/render/src/three/ground-height';
import { bakeHeightTexels } from '../../packages/render/src/three/units/rain-maths';
import type { TerrainSurface } from '../../packages/render/src/three/terrain/surface';
import { rendererOptionsFor } from '../../packages/app/src/renderer-options';

const THREE = ThreeRuntime as unknown as typeof ThreeTypes;

vi.mock('../../packages/render/node_modules/three/build/three.module.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeTypes>();
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

const HIGH = { colorVision: 'default', quality: 'high' } as const;

/**
 * The budget (spec 6 / R-7: "under 5 ms"; measured 2.2-2.9 ms on ein_qasab, M3 Pro). A wall-clock bound
 * flaked once in a parallel run at load 45-76, and a CI runner can be slower than any laptop, so on CI
 * (`process.env.CI` set) the bound is the looser 25 ms: still about 10x the measured cost, so a bake that
 * took 100 ms (or a sampler that went quadratic) goes red there too. The non-timing assertions above
 * (the range, the texel centres, the texture contents) are the same everywhere and a missing bake fails them.
 */
const BAKE_BUDGET_MS = process.env.CI !== undefined && process.env.CI !== '' ? 25 : 5;

function einQasab(): { surface: TerrainSurface; width: number; height: number; r: ThreeRenderer } {
  const parsed = parseMap(maps.ein_qasab);
  const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 4 });
  applyTerrain(parsed, sim);
  const r = new ThreeRenderer(sim, rendererOptionsFor(parsed, HIGH, '/'));
  // What the app's boot does next (`main.ts`): the map's decor and relief.
  r.setDecor(parsed.decor);
  r.setElevation(parsed.elevation);
  r.frame(1, 0);
  const surface = (r as unknown as { retained: { elevation: TerrainSurface | null } }).retained.elevation;
  if (surface === null) throw new Error('ein_qasab built no surface');
  return { surface, width: parsed.width, height: parsed.height, r };
}

describe('the rain height bake on ein_qasab', () => {
  const { surface, width, height, r } = einQasab();
  const sampler = (x: number, z: number): number => groundWorldY(surface, width, height, x, z);

  it('is a wetland, 48 tiles, with relief the bake has to carry (a flat map would pass anything)', () => {
    expect(width).toBe(48);
    expect(height).toBe(48);
    let lo = Infinity;
    let hi = -Infinity;
    const f = bakeHeightTexels(sampler, width, height);
    for (const v of f) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi - lo, `ground heights ${lo.toFixed(3)}..${hi.toFixed(3)}`).toBeGreaterThan(0.5);
  });

  it('reads groundWorldY at the texel centres within 1e-3, after the half-float round trip', () => {
    const f = bakeHeightTexels(sampler, width, height);
    const w = width * 4;
    expect(f.length).toBe(192 * 192);
    // Every texel, against an independent call of the sampler at the centre the test works out itself.
    let worst = 0;
    for (let j = 0; j < 192; j++) {
      for (let i = 0; i < 192; i++) {
        const truth = groundWorldY(surface, width, height, i / 4 + 0.125, j / 4 + 0.125);
        worst = Math.max(worst, Math.abs(f[j * w + i] - truth));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it(`costs under ${BAKE_BUDGET_MS} ms (best of five)`, () => {
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      bakeHeightTexels(sampler, width, height);
      times.push(performance.now() - t0);
    }
    const best = Math.min(...times);
    expect(best, `ein_qasab bake ms: ${times.map((t) => t.toFixed(2)).join(', ')}`).toBeLessThan(BAKE_BUDGET_MS);
  });

  it(`the renderer's whole bake (sample + half-float encode + upload flag) is under ${BAKE_BUDGET_MS} ms too (best of five)`, () => {
    const rain = (r as unknown as { rain: { bakeHeights(s: (x: number, z: number) => number): void } | null }).rain;
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      rain!.bakeHeights(sampler);
      times.push(performance.now() - t0);
    }
    const best = Math.min(...times);
    expect(best, `ein_qasab RainBatch.bakeHeights ms: ${times.map((t) => t.toFixed(2)).join(', ')}`).toBeLessThan(BAKE_BUDGET_MS);
  });

  it('the renderer baked the SAME numbers into the texture it draws with (half floats, within 1e-3)', () => {
    const rain = (r as unknown as { rain: { mesh: ThreeTypes.Mesh<ThreeTypes.BufferGeometry, ThreeTypes.ShaderMaterial> } | null }).rain;
    expect(rain, 'ein_qasab rains').not.toBeNull();
    const tex = rain!.mesh.material.uniforms.uHeight.value as ThreeTypes.DataTexture;
    const data = tex.image.data as Uint16Array;
    let worst = 0;
    for (let j = 0; j < 192; j += 3) {
      for (let i = 0; i < 192; i += 3) {
        const truth = groundWorldY(surface, width, height, i / 4 + 0.125, j / 4 + 0.125);
        worst = Math.max(worst, Math.abs(THREE.DataUtils.fromHalfFloat(data[j * 192 + i]) - truth));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });
});
