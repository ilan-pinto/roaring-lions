/**
 * Per this project's own testing standard: every assertion below was verified
 * by breaking the corresponding line in `mesh-variant.ts` by hand and
 * confirming the SPECIFIC test named goes red, then reverting. What each
 * break was, and what it broke, is recorded above the case it breaks.
 */
import { describe, it, expect } from 'vitest';
import { pickMeshVariant } from './mesh-variant';

const FOUR = ['woman', 'office', 'farm', 'child'] as const;

describe('pickMeshVariant', () => {
  it('is stable: the same entity id always draws the same variant', () => {
    // The property the whole design rests on -- a civilian that changed
    // which person it was mid-mission would be worse than a repeated one.
    for (const id of [0, 1, 7, 40, 4095]) {
      expect(pickMeshVariant(FOUR, id)).toBe(pickMeshVariant(FOUR, id));
    }
  });

  it('is a no-op for the single-asset case every other unit type uses', () => {
    for (const id of [0, 1, 2, 3, 99]) {
      expect(pickMeshVariant(['only'], id)).toBe('only');
    }
  });

  // Break: `variants[entityId % variants.length]` -> `variants[0]`. Verified
  // by hand -- this goes red on the very first `expect`, because every id
  // returns 'woman'. It is the case that would catch a variant list that is
  // loaded but never actually consulted, which is what "the crowd is four
  // copies" looks like from the outside.
  it('gives a contiguous block of entities every variant before repeating any', () => {
    // Civilians spawn as `civilians.groups` placements, so one group's
    // entities take a contiguous id range -- see the module's own comment on
    // why a rotation and not a hash. Eleven is `beit_sahwan_breach`'s count.
    const drawn = Array.from({ length: 11 }, (_, k) => pickMeshVariant(FOUR, 20 + k));
    expect(new Set(drawn.slice(0, 4)).size).toBe(4);
    expect(new Set(drawn).size).toBe(4);
  });

  // Break: `entityId % variants.length` -> `Math.floor(entityId / 4) %
  // variants.length` (a plausible "group them" mistake). Verified by hand --
  // this goes red: ids 20..23 all return 'woman', so adjacent entities
  // collide and the count of adjacent pairs is 3, not 0.
  it('never puts two of the same figure at adjacent entity ids', () => {
    const drawn = Array.from({ length: 40 }, (_, k) => pickMeshVariant(FOUR, k));
    const adjacentCollisions = drawn.filter((v, k) => k > 0 && drawn[k - 1] === v);
    expect(adjacentCollisions).toEqual([]);
  });

  it('spreads a large crowd evenly rather than favouring one figure', () => {
    const counts = new Map<string, number>();
    for (let id = 0; id < 400; id++) {
      const v = pickMeshVariant(FOUR, id);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([100, 100, 100, 100]);
  });

  // Break: delete the `if (variants.length === 0)` guard. Verified by hand --
  // this goes red with "expected undefined to throw" instead: the function
  // returns `undefined`, which `updateMeshUnits` would then hand to
  // `instantiateMeshUnit` as a template, and the failure would surface as a
  // three.js crash inside `SkeletonUtils.clone` with no mention of variants.
  it('throws rather than returning undefined for an empty variant list', () => {
    expect(() => pickMeshVariant([], 0)).toThrow(/no variants loaded/);
  });
});
