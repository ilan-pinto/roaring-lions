/**
 * `mesh-evac.ts` -- the departure fade a RESCUED unit gets, exercised
 * headlessly against the same hand-authored GLB fixture `mesh-death.test.ts`
 * uses (`./mesh-fixture.ts`; `environment: 'node'`, no `WebGLRenderer`).
 *
 * The suite is written as a contrast rather than in isolation, because the
 * bug this module fixes was never "the fade is wrong" -- it was "the two
 * outcomes are the same fade". So most tests below assert an evacuation
 * against what `mesh-death.ts` does at the identical moment: a death plays
 * `down`, sinks, stops at half opacity and may leave a wreck; a departure
 * does none of those. A regression that quietly re-converged them would have
 * to break one of these pairs.
 *
 * Per this project's own testing standard: every assertion that matters was
 * verified by breaking the corresponding line in `mesh-evac.ts` by hand and
 * confirming the SPECIFIC named test goes red, then reverting. Each break is
 * named at its own test.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate, instantiateMeshUnit, type MeshUnitEntity } from './mesh-unit';
import { parseFixture } from './mesh-fixture';
import { applyMeshClip } from './mesh-clip';
import { beginMeshDeath, MESH_DEATH_SECONDS } from './mesh-death';
import { MESH_EVAC_SECONDS, meshEvacOpacity, beginMeshEvac, stepMeshEvac } from './mesh-evac';

async function buildEntity(clips: string | string[]): Promise<MeshUnitEntity> {
  const gltf = await parseFixture({ roleName: 'uniform', clipName: clips });
  const template = buildMeshUnitTemplate(gltf, 'kdf');
  return instantiateMeshUnit(template, 'inf_squad');
}

function opacityOf(swaps: readonly { fade: THREE.ShaderMaterial }[]): number {
  return (swaps[0].fade.uniforms.uOpacity as { value: number }).value;
}

// --- the curve -------------------------------------------------------------

describe('meshEvacOpacity', () => {
  it('starts fully opaque at t=0', () => {
    expect(meshEvacOpacity(0)).toBe(1);
  });

  it('reaches ZERO at MESH_EVAC_SECONDS -- unlike death, which stops at half', () => {
    // The single most load-bearing difference between the two curves. A
    // rescued civilian has no wreck to become, so a fade that stopped at 0.5
    // would pop her out of existence half-lit instead of letting her leave.
    //
    // Break check (verified by hand, then reverted): in `meshEvacOpacity`,
    // change `1 - Math.min(...)` to `1 - Math.min(...) * 0.5` (death's own
    // curve). This assertion then reads 0.5 instead of 0 and goes red.
    expect(meshEvacOpacity(MESH_EVAC_SECONDS)).toBe(0);
  });

  it('is linear -- half opacity at the midpoint', () => {
    expect(meshEvacOpacity(MESH_EVAC_SECONDS / 2)).toBeCloseTo(0.5, 10);
  });

  it('clamps at 0 rather than going negative past the window', () => {
    // Break check (verified by hand, then reverted): drop the `Math.min(1,
    // ...)` clamp. This assertion then reads a large negative number and
    // goes red.
    expect(meshEvacOpacity(999)).toBe(0);
  });

  it('takes visibly longer than a death, so the two read apart at gameplay zoom', () => {
    expect(MESH_EVAC_SECONDS).toBeGreaterThan(MESH_DEATH_SECONDS);
  });
});

// --- beginMeshEvac ---------------------------------------------------------

describe('beginMeshEvac', () => {
  it('does NOT play `down` -- an evacuated civilian stays upright', async () => {
    // THE bug, in one assertion. `beginMeshDeath`'s first statement is
    // `applyMeshClip(entity, 'down')`, and routing an evacuation through it
    // is what put a rescued woman into the held crawl pose.
    //
    // Break check (verified by hand, then reverted): add
    // `applyMeshClip(entity, 'down');` to the top of `beginMeshEvac`. This
    // assertion then reads `'down'` instead of `'move'` and goes red.
    const entity = await buildEntity(['idle', 'move', 'down']);
    applyMeshClip(entity, 'move'); // her last living frame: walking to the refuge
    beginMeshEvac(entity);
    expect(entity.currentClip).toBe('move');
  });

  it('is the exact contrast with beginMeshDeath on the same entity and the same clip', async () => {
    // The paired half of the test above: same fixture, same starting clip,
    // the other path. If a refactor ever collapses the two, this fails.
    const entity = await buildEntity(['idle', 'move', 'down']);
    applyMeshClip(entity, 'move');
    beginMeshDeath(entity);
    expect(entity.currentClip).toBe('down');
  });

  it('keeps an idle civilian idle -- whatever she was doing, not a new clip', async () => {
    // A civilian already standing inside the zone when a soldier reaches her
    // is counted without ever walking. Upright either way; the module picks
    // no clip of its own.
    const entity = await buildEntity(['idle', 'move', 'down']);
    applyMeshClip(entity, 'idle');
    beginMeshEvac(entity);
    expect(entity.currentClip).toBe('idle');
  });

  it('swaps in a per-entity fade material clone, leaving the shared one alone', async () => {
    const entity = await buildEntity(['idle', 'move']);
    let shared: THREE.Material | null = null;
    entity.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) shared = m.material as THREE.Material;
    });
    const departing = beginMeshEvac(entity);
    expect(departing.t).toBe(0);
    expect(departing.swaps).toHaveLength(1);
    expect(departing.swaps[0].original).toBe(shared);
    expect(departing.swaps[0].fade).not.toBe(shared);
    expect(departing.swaps[0].fade.transparent).toBe(true);
  });
});

// --- stepMeshEvac ----------------------------------------------------------

describe('stepMeshEvac', () => {
  it('while fading: advances t, writes this frame\'s opacity, and returns "fading"', async () => {
    const entity = await buildEntity(['idle', 'move']);
    applyMeshClip(entity, 'move');
    const departing = beginMeshEvac(entity);

    const result = stepMeshEvac(departing, 0.1, new THREE.Scene());

    expect(result).toBe('fading');
    expect(departing.t).toBeCloseTo(0.1, 10);
    // Break check (verified by hand, then reverted): comment out the
    // `setMeshDeathOpacity(d.swaps, meshEvacOpacity(d.t));` line in
    // `stepMeshEvac`. This assertion then reads 1.0 (the material's own
    // untouched default) and goes red.
    expect(opacityOf(departing.swaps)).toBeCloseTo(meshEvacOpacity(0.1), 10);
  });

  it('never moves the body -- no sink, unlike a death', async () => {
    // `stepMeshDeath` drops `position.y` by `meshDeathSinkPx(t) *
    // WORLD_Y_PER_LIFT_PIXEL` every frame, which is half of what reads as
    // "she collapsed". A rescue holds her ground height exactly.
    //
    // Break check (verified by hand, then reverted): add
    // `d.entity.root.position.y -= 0.01;` to `stepMeshEvac`. This assertion
    // then reads 7 - 0.01 and goes red.
    const entity = await buildEntity(['idle', 'move']);
    entity.root.position.set(2, 7, 3);
    const departing = beginMeshEvac(entity);
    stepMeshEvac(departing, 0.1, new THREE.Scene());
    stepMeshEvac(departing, 0.1, new THREE.Scene());
    expect(entity.root.position.y).toBe(7);
    expect(entity.root.position.x).toBe(2);
    expect(entity.root.position.z).toBe(3);
  });

  it('keeps the walk cycle running while she fades', async () => {
    // A figure frozen mid-stride for 0.8 s reads as a glitch, not as
    // leaving. The mixer has to keep being advanced after she stops being a
    // sim entity.
    //
    // Break check (verified by hand, then reverted): delete the
    // `d.entity.mixer.update(dtSeconds);` line in `stepMeshEvac`. The
    // action's own `.time` then stays at 0 and this assertion goes red.
    const entity = await buildEntity(['idle', 'move']);
    applyMeshClip(entity, 'move');
    const action = entity.actions.get('move');
    expect(action).toBeDefined();
    const departing = beginMeshEvac(entity);
    stepMeshEvac(departing, 0.25, new THREE.Scene());
    expect(action?.time).toBeGreaterThan(0);
  });

  it('at the window: removes the entity from the scene and returns "removed"', async () => {
    const entity = await buildEntity(['idle', 'move']);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const departing = beginMeshEvac(entity);

    expect(stepMeshEvac(departing, MESH_EVAC_SECONDS - 0.05, scene)).toBe('fading');
    expect(scene.children).toContain(entity.root);

    // Break check (verified by hand, then reverted): change the guard to
    // `if (d.t < MESH_EVAC_SECONDS * 10) return 'fading';`. This assertion
    // then reads `'fading'` and goes red.
    expect(stepMeshEvac(departing, 0.05, scene)).toBe('removed');
    expect(scene.children).not.toContain(entity.root);
  });

  it('restores the shared material and disposes the clone on removal', async () => {
    // The same leak `endMeshDeathFade` exists to prevent on the death path:
    // the per-entity clone is not owned by the template, so nothing else
    // will ever dispose it.
    const entity = await buildEntity(['idle', 'move']);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const departing = beginMeshEvac(entity);
    const clone = departing.swaps[0].fade;
    const shared = departing.swaps[0].original;
    let disposed = false;
    clone.addEventListener('dispose', () => {
      disposed = true;
    });

    // Break check (verified by hand, then reverted): delete the
    // `endMeshDeathFade(d.swaps);` line in `stepMeshEvac`. Both assertions
    // below then go red (the mesh keeps the clone, and nothing disposes it).
    stepMeshEvac(departing, MESH_EVAC_SECONDS, scene);
    expect(departing.swaps[0].mesh.material).toBe(shared);
    expect(disposed).toBe(true);
  });

  it('produces no wreck, ever -- nothing died', async () => {
    // `stepMeshDeath` can return a `MeshWreck` for an entity whose GLB
    // carries a `wreck` clip. This fixture carries one, and a departure
    // still returns only the two strings.
    const entity = await buildEntity(['idle', 'move', 'down', 'wreck']);
    expect(entity.actions.has('wreck')).toBe(true);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const departing = beginMeshEvac(entity);

    const seen: unknown[] = [];
    for (let i = 0; i < 20; i++) seen.push(stepMeshEvac(departing, 0.1, scene));
    expect(seen.every((r) => r === 'fading' || r === 'removed')).toBe(true);
    expect(seen).toContain('removed');
    expect(entity.currentClip).not.toBe('wreck');
  });
});
