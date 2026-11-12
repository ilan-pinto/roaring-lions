// GH-1223 slice 1 (PR 1228 review): the cap on active figures, at the system itself. The renderer-level specs run with the shipped caps (all 0)
// or with one squad, so nothing offered a death that would put the figures over a cap above zero; dropping that test from `claim` left
// every spec green.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MeshUnitEntity, MeshUnitTemplate } from '../units/mesh-unit';
import { loadRapier } from './rapier';
import { RagdollSystem, type RagdollDeath } from './ragdoll-system';

const ENV = { groundAt: (): number => 0, boxesNear: () => [] };

/** An entity with `n` live figure roots: a parentless bone with a bone of its own riding on it (`liveFigureRoots`). */
function entityWith(n: number): MeshUnitEntity {
  const root = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const b = new THREE.Bone();
    b.name = `fig${k}`;
    b.add(new THREE.Bone());
    root.add(b);
  }
  return { root } as unknown as MeshUnitEntity;
}
const death = (id: number, figures: number): RagdollDeath<number> => ({
  entityId: id,
  deathTick: id,
  entity: entityWith(figures),
  template: {} as MeshUnitTemplate,
  at: { x: 0, y: 0, z: 0, yaw: 0 },
  away: [1, 0],
  handle: id,
});

async function ready(cap: number): Promise<RagdollSystem<number>> {
  const R = await loadRapier();
  const sys = new RagdollSystem<number>(cap, ENV, () => Promise.resolve(R));
  await Promise.resolve();
  await Promise.resolve();
  return sys;
}

describe('RagdollSystem.claim: the figure cap', () => {
  it('takes deaths while their figures fit under the cap, refuses the one that would pass it, and counts figures not incidents', async () => {
    const sys = await ready(3);
    expect(sys.ready).toBe(true);
    expect(sys.claim(death(1, 2))).toBe(true); // 2 of 3
    expect(sys.claim(death(2, 2))).toBe(false); // 4 > 3
    expect(sys.figuresInUse).toBe(2);
    expect(sys.claim(death(3, 1))).toBe(true); // exactly 3 of 3
    expect(sys.claim(death(4, 1))).toBe(false);
    expect(sys.figuresInUse).toBe(3);
    expect(sys.incidents).toBe(2);
    sys.dispose();
  }, 60_000);

  it('refuses an entity with no live figure, and a cap of 0 takes nothing (and never loads)', async () => {
    const sys = await ready(2);
    expect(sys.claim(death(1, 0))).toBe(false);
    sys.dispose();
    const dark = new RagdollSystem<number>(0, ENV, () => Promise.reject(new Error('a cap of 0 must not load Rapier')));
    expect(dark.ready).toBe(false);
    expect(dark.claim(death(1, 1))).toBe(false);
  }, 60_000);
});
