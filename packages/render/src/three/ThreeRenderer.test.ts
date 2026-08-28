/**
 * Final whole-branch review (Fix 2): `dispose()` never disposed `fogMesh` --
 * `FogMesh.dispose()` existed and was called from nowhere, so
 * `tools/src/perf/three-units.ts:757` (which calls `renderer.dispose()`
 * between backends to publish a peak-VRAM figure) leaked a full-map
 * `InstancedMesh` on every run. That fix is one line in `dispose()`; this
 * file exists to guard it, and it is deliberately narrow.
 *
 * `ThreeRenderer` has no other headless coverage (recorded, deliberately
 * deferred, in `progress.md`'s "Deferred to Phase C" list -- proving the
 * phase's headline fog/visibility claim wants a real seam, not a
 * constructor-level workaround). This file does not attempt that. It
 * constructs exactly enough of a real `ThreeRenderer` to prove one thing:
 * that `dispose()` reaches `fogMesh.dispose()`.
 *
 * The one real obstacle is `new THREE.WebGLRenderer(...)`, which cannot
 * construct under this suite's headless `environment: 'node'` (no `document`,
 * no WebGL -- see `palette-material.test.ts`'s own top-of-file comment for
 * the established precedent). Every other object `ThreeRenderer`'s
 * constructor builds -- `FogMesh`, `ParticleInstancer`, `TracerBatch`,
 * `terrainMaterial()` -- is plain `THREE.*` JS-side construction with no GPU
 * context needed, already proven headless-safe by `fog-mesh.test.ts`,
 * `units/fx.test.ts` and elsewhere. So this file substitutes a minimal
 * stand-in for `THREE.WebGLRenderer` alone (via `vi.mock`, scoped to this one
 * test file) rather than a real one, keeping every other `three` export
 * untouched. Confirmed by reading the constructor directly
 * (`ThreeRenderer.ts:595-646`): nothing runs between `new
 * THREE.WebGLRenderer(...)` and the end of the constructor that touches the
 * renderer beyond `applyPalettePipeline`'s two calls
 * (`outputColorSpace`/`setClearColor`), both stubbed below.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

const disposeSpy = vi.fn();

// `vi.mock` is hoisted by vitest above every import in this file (static or
// not), so the `import { ThreeRenderer } from './ThreeRenderer'` above --
// which itself does `import * as THREE from 'three'` -- resolves against
// this stand-in, not the real module.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {
      // Real `WebGLRenderer#setClearColor` reads `outputColorSpace`
      // synchronously; this stand-in only needs to accept the call.
    }
    dispose(): void {
      disposeSpy();
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
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
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

function makeSim(): Sim {
  return new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
}

describe('ThreeRenderer.dispose', () => {
  it('disposes fogMesh -- the exact regression this test guards', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    // Reach into the private field the same way this suite already treats
    // `FogMesh` as testable (`fog-mesh.test.ts` constructs and inspects one
    // directly) -- there is no public accessor for it, and adding one
    // purely for a test would widen `Renderer`'s surface for no runtime
    // reason (`api.ts`'s own top comment: "The surface is small ... and
    // that smallness is the whole reason replacing the backend is
    // tractable").
    const fogMesh = (renderer as unknown as { fogMesh: { mesh: { geometry: unknown; material: unknown } } })
      .fogMesh;
    const geometry = fogMesh.mesh.geometry as { addEventListener: (type: string, cb: () => void) => void };
    const material = fogMesh.mesh.material as { addEventListener: (type: string, cb: () => void) => void };
    let geometryDisposed = false;
    let materialDisposed = false;
    // three.js's own disposal signal: `BufferGeometry.dispose()` and
    // `Material.dispose()` both dispatch a `'dispose'` event (they extend
    // `EventDispatcher`) -- asserting on that is a stronger guard than
    // spying on `.dispose` directly, since it proves the REAL three.js
    // method ran, not merely that something callable named `dispose` was
    // invoked.
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });

    renderer.dispose();

    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
    // And the renderer's own WebGLRenderer.dispose() still ran too --
    // fogMesh disposal was ADDED, not substituted for something else.
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('disposes smokeMesh -- the identical shape of leak fogMesh once had, guarded against from the start', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const smokeMesh = (renderer as unknown as { smokeMesh: { mesh: { geometry: unknown; material: unknown } } })
      .smokeMesh;
    const geometry = smokeMesh.mesh.geometry as { addEventListener: (type: string, cb: () => void) => void };
    const material = smokeMesh.mesh.material as { addEventListener: (type: string, cb: () => void) => void };
    let geometryDisposed = false;
    let materialDisposed = false;
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });

    renderer.dispose();

    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});
