import { describe, it, expect } from 'vitest';
import { DECOR_MESH_ROLES, isDecorMeshRole, rampForDecorRole } from './decor-role';

describe('the decor role vocabulary', () => {
  it('is exactly four roles', () => {
    // Closed per asset class, like every other class in the mesh contract:
    // vehicles have hull/plate/rubber/metal/glass/recess, buildings have
    // wall/roof/trim/..., VFX have core/mid/outer. Decor has these.
    expect([...DECOR_MESH_ROLES].sort()).toEqual(['foliage', 'rock', 'sand', 'trunk']);
  });

  it('gives every role a real multi-step ramp', () => {
    for (const role of DECOR_MESH_ROLES) {
      const ramp = rampForDecorRole(role);
      expect(ramp.length).toBeGreaterThan(1);
      for (const hex of ramp) expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('throws for a role outside the set rather than drawing a default', () => {
    // The contract's rule for every class: a wrong role is a loud failure on
    // both sides, never a silently-wrong colour.
    expect(isDecorMeshRole('hull')).toBe(false);
    expect(() => rampForDecorRole('hull')).toThrow(/decor-role/);
  });
});
