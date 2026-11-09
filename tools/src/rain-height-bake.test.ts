/**
 * The rain's height bake on a real wetland map (GH-871 P4 T8): `ein_qasab`, booted through the app's
 * own route (`rendererOptionsFor`) into the real `ThreeRenderer` over a faked `WebGLRenderer` (the
 * `theme-identity.test.ts` harness), one `frame()` run so the terrain exists.
 *
 *  - the baked half floats read `groundWorldY` at the texel CENTRES within 1e-3, on the drawn
 *    surface (relief included: the test requires the bake to span a real height range);
 *  - the bake does the work it should (exactly one sampler call per texel, counted) and costs no more
 *    than `BAKE_COST_RATIO_MAX` times a calibration loop run in the same process (see that constant).
 *    There is no wall-clock bound: the old "under 5 ms" one failed on a shared box at 89aab9b, feeb3fd,
 *    e3b7a09 and 9b68a87 and passed on re-run, because the bake itself measures about 4 ms here.
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
 * What the bake may cost, as a RATIO to a calibration loop timed in the same process (GH-559).
 *
 * The old test bounded the bake at 5 ms of wall clock (spec 6 / R-7). The bake costs about 4 ms on the
 * CI-class box this runs on, so any scheduling noise crossed the line: it failed in the full suite on four
 * shas that touched nothing near it, and passed on re-run. A bound that tight on a machine that varies by
 * 2x cannot tell a slow box from a slow bake.
 *
 * Now each round times a fixed pure-arithmetic loop (`calibrate`, sized to run about as long as the bake, so
 * both need the same uninterrupted slice of CPU) and the bake back to back; the test takes the best of each
 * over up to `MAX_ROUNDS` rounds and compares the two. A slower or busier machine scales both numbers, so
 * the ratio holds still. Measured on an idle 4-core box: calibration 4.0 ms, bake 3.8 ms, whole bake 4.3 ms
 * (ratio about 1.0 and 1.1). With 8 busy loops on those 4 cores it passed 10 of 10 runs; at 40 iterations of
 * calibration (a shorter one than the bake) it failed 2 of 8 there, which is why they are matched. The bound
 * is 2.5: over 2x the measured ratio, and a bake 4x slower reads 3.3 to 3.9 and goes red (mutation in the
 * commit message). Work that grows (a second sampler call per texel, a quadratic sampler) is caught exactly
 * by the call-count tests, which do not depend on time at all.
 *
 * Reviewer note, what the old test proved: that on the machine it ran on, one bake finished inside 5 ms.
 * That is a statement about the machine as much as the code (at 4 ms of real cost it had 25% of headroom,
 * and on CI it was loosened to 25 ms, which proved almost nothing). What it could not say was whether the
 * bake had got slower. This version says that, and says it the same way on every box.
 */
const BAKE_COST_RATIO_MAX = 2.5;
const MAX_ROUNDS = 40;
const CALIBRATION_ITERATIONS = 192 * 192 * 52;

/** A fixed amount of arithmetic, about the bake's own size. The result is returned so it cannot be elided. */
function calibrate(): number {
  let a = 0;
  for (let k = 0; k < CALIBRATION_ITERATIONS; k++) a += Math.sqrt(k) * 1.0001;
  return a;
}

/**
 * Best-of ratio of `work` to `calibrate`, the two timed alternately so load hits both. It stops at the first
 * round that is inside `BAKE_COST_RATIO_MAX` and runs up to `MAX_ROUNDS` otherwise: a loaded box needs one
 * clean round, while a bake that really costs too much has no clean round to find, so it still goes red.
 */
function costRatio(work: () => void): { ratio: number; workMs: number; calibMs: number } {
  let work_ms = Infinity;
  let calib_ms = Infinity;
  let sink = 0;
  for (let k = 0; k < MAX_ROUNDS && (k === 0 || work_ms / calib_ms >= BAKE_COST_RATIO_MAX); k++) {
    let t0 = performance.now();
    sink += calibrate();
    calib_ms = Math.min(calib_ms, performance.now() - t0);
    t0 = performance.now();
    work();
    work_ms = Math.min(work_ms, performance.now() - t0);
  }
  if (!Number.isFinite(sink)) throw new Error('calibration produced a non-finite sum');
  return { ratio: work_ms / calib_ms, workMs: work_ms, calibMs: calib_ms };
}

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

  it('calls the sampler exactly once per texel, at the texel centres (an operation count, not a clock)', () => {
    const calls: Array<[number, number]> = [];
    bakeHeightTexels(
      (x, z) => {
        calls.push([x, z]);
        return 0;
      },
      width,
      height
    );
    expect(calls.length).toBe(192 * 192);
    expect(calls[0]).toEqual([0.125, 0.125]);
    expect(calls[calls.length - 1]).toEqual([47.875, 47.875]);
  });

  it('the renderer\'s bake makes the same 192 x 192 sampler calls', () => {
    const rain = (r as unknown as { rain: { bakeHeights(s: (x: number, z: number) => number): void } | null }).rain;
    let n = 0;
    rain!.bakeHeights((x, z) => {
      n++;
      return sampler(x, z);
    });
    expect(n).toBe(192 * 192);
  });

  it(`costs under ${BAKE_COST_RATIO_MAX}x a calibration loop (best of up to ${MAX_ROUNDS} rounds, same process)`, () => {
    const { ratio, workMs, calibMs } = costRatio(() => {
      bakeHeightTexels(sampler, width, height);
    });
    expect(ratio, `bake ${workMs.toFixed(2)} ms against calibration ${calibMs.toFixed(2)} ms`).toBeLessThan(BAKE_COST_RATIO_MAX);
  });

  it(`the renderer's whole bake (sample + half-float encode + upload flag) costs under ${BAKE_COST_RATIO_MAX}x the calibration too`, () => {
    const rain = (r as unknown as { rain: { bakeHeights(s: (x: number, z: number) => number): void } | null }).rain;
    const { ratio, workMs, calibMs } = costRatio(() => {
      rain!.bakeHeights(sampler);
    });
    expect(ratio, `RainBatch.bakeHeights ${workMs.toFixed(2)} ms against calibration ${calibMs.toFixed(2)} ms`).toBeLessThan(BAKE_COST_RATIO_MAX);
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
