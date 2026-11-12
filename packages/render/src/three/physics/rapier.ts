/**
 * GH-1223: the ONE place Rapier is loaded. Presentation-only physics (ragdolls today): nothing it computes is read
 * by the sim, sent over the network or changes an outcome (invariant 4; CLAUDE.md "What not to do").
 *
 * `@dimforge/rapier3d-deterministic-compat`, pinned to exactly 0.21.0 (design L1, L2): the deterministic build (no
 * SIMD, software maths) and the compat packaging (the `.wasm` inlined as base64, so Vite needs no plugin). It is a
 * DYNAMIC import, so the ~1.2 MB (brotli) chunk is fetched only when something asks: the renderer asks only when its
 * preset's ragdoll cap is above zero, so the `low` preset -- and today every preset, shipped dark -- never loads it.
 *
 * Only `packages/render/src/three/physics/**` may import `@dimforge/*`, and only `ThreeRenderer.ts` may import this
 * folder: `tools/physics_fence.mjs`, pinned by `tools/src/physics_fence.test.ts`.
 */
import type RAPIER_NS from '@dimforge/rapier3d-deterministic-compat';

export type Rapier = typeof RAPIER_NS;

let pending: Promise<Rapier> | null = null;
let requests = 0;

/** Loads and initialises Rapier once; every later call shares the same promise. */
export function loadRapier(): Promise<Rapier> {
  if (pending === null) {
    requests++;
    pending = import('@dimforge/rapier3d-deterministic-compat').then(async (m) => {
      const R = m.default;
      await R.init();
      return R;
    });
  }
  return pending;
}

/** How many times the module was actually requested (0 or 1): the witness that a preset with no physics loads none. */
export function rapierRequests(): number {
  return requests;
}
