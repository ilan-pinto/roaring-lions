/**
 * GH-1167 S3, pins P3 and P4 (docs/superpowers/specs/2026-11-11-wadi-halam-3d-grass-design.md, 3.6): a LEGACY `ThreeRenderer`
 * (the real one over a faked `WebGLRenderer`, the `rain-height-bake.test.ts` harness) booted on `wadi_halam_basin` through the
 * app's own `rendererOptionsFor`
 *   P3: holds no object named `rl-grass-field*`, and its `decor-foliage` batch holds exactly main's instance count (tufts included);
 *   P4: never reads `terrainTones.grassField` (the tones carry one whose getter throws).
 * The count is a literal read on main before any grass code (11 Nov 2026), never recomputed here.
 *
 * Falsified by (run red, then put back): P3, dropping the node check around the field build in `rebuildTerrain` once S4 adds it
 * (before S4 the stand-in is a mutation that adds a decor-foliage instance or an `rl-grass-field` object); P4, reading
 * `tones.grassField` outside the node branch.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as ThreeTypes from '../../packages/render/node_modules/@types/three';
// @ts-expect-error TS7016: the entry file carries no declarations; typed by the cast below.
import * as ThreeRaw from '../../packages/render/node_modules/three/build/three.module.js';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain } from '@lions/data';
import { ThreeRenderer } from '../../packages/render/src/three/ThreeRenderer';
import { rendererOptionsFor } from '../../packages/app/src/renderer-options';

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

const ThreeRuntime = ThreeRaw as unknown as typeof ThreeTypes;
const HIGH = { colorVision: 'default', quality: 'high' } as const;

/** `wadi_halam_basin`'s `decor-foliage` instance count at the `high` preset, read on main (e8da5117c) on 11 Nov 2026. */
const MAIN_FOLIAGE_INSTANCES = 1532;

interface Private {
  scene: ThreeTypes.Scene;
  decorGroup: ThreeTypes.Group | null;
  decorSet: { parts: Map<string, { role: string; geometry: ThreeTypes.BufferGeometry }[]> };
}

function boot(poison: boolean): { r: ThreeRenderer; priv: Private } {
  const parsed = parseMap(maps.wadi_halam_basin);
  const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 4 });
  applyTerrain(parsed, sim);
  const opts = rendererOptionsFor(parsed, HIGH, '/');
  if (poison) {
    const tones = { ...opts.terrainTones };
    Object.defineProperty(tones, 'grassField', {
      enumerable: true,
      get(): never {
        throw new Error('the legacy path read terrainTones.grassField');
      },
    });
    opts.terrainTones = tones;
  }
  const r = new ThreeRenderer(sim, opts);
  // The decor GLBs load over the network in the app; here every family gets one-triangle stand-ins (foliage and trunk parts),
  // so the batch counts measure PLACEMENTS reaching the foliage batch, which is what a node boot must not change.
  const priv = r as unknown as Private;
  const tri = (): ThreeTypes.BufferGeometry => {
    const g = new ThreeRuntime.BufferGeometry();
    g.setAttribute('position', new ThreeRuntime.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new ThreeRuntime.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  };
  for (const family of ['grass', 'sand', 'bush', 'tree', 'desert_tree', 'rock', 'boulder', 'cedar', 'slab', 'reed', 'shrub', 'wet_grass']) {
    for (let v = 0; v < 3; v++) priv.decorSet.parts.set(`${family}_${v}`, [{ role: 'foliage', geometry: tri() }, { role: 'trunk', geometry: tri() }]);
  }
  r.setDecor(parsed.decor);
  r.setElevation(parsed.elevation);
  r.frame(1, 0);
  return { r, priv };
}

describe('GH-1167 S3 P3: the legacy scene on wadi_halam_basin', () => {
  it("has no rl-grass-field object, and decor-foliage holds main's instance count", () => {
    const { r, priv } = boot(false);
    const names: string[] = [];
    priv.scene.traverse((o) => names.push(o.name));
    expect(names.filter((n) => n.startsWith('rl-grass-field'))).toEqual([]);
    const foliage = (priv.decorGroup?.children ?? []).find((c) => c.name === 'decor-foliage') as ThreeTypes.BatchedMesh | undefined;
    expect(foliage, 'decor-foliage exists').toBeDefined();
    if (process.env.PIN_PRINT) console.log(`PIN foliage ${foliage?.instanceCount}`);
    expect(foliage?.instanceCount).toBe(MAIN_FOLIAGE_INSTANCES);
    r.dispose();
  });
});

describe('GH-1167 S3 P4: the legacy path reads no grassField', () => {
  it('boots, builds the terrain and rebuilds it with a grassField whose getter throws', () => {
    const { r } = boot(true);
    r.frame(1, 0);
    r.dispose();
  });
});
