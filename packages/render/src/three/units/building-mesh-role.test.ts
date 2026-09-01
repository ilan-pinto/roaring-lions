import { describe, it, expect } from 'vitest';
import { BUILDING_MESH_ROLES, isBuildingMeshRole, rampForBuildingRole } from './building-mesh-role';

describe('building-mesh-role', () => {
  it('recognises the closed eight-role building vocabulary', () => {
    expect(BUILDING_MESH_ROLES).toEqual(['wall', 'roof', 'trim', 'dome', 'wood', 'glass', 'metal', 'rust']);
    for (const role of BUILDING_MESH_ROLES) {
      expect(isBuildingMeshRole(role)).toBe(true);
    }
    expect(isBuildingMeshRole('uniform')).toBe(false);
  });

  it('resolves the shared ROLE_PALETTE roles regardless of wallColorKey', () => {
    const roof = rampForBuildingRole('roof', 'limestone.1');
    expect(roof.length).toBeGreaterThan(0);
    for (const hex of roof) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('resolves wall colour from data/structures.json\'s own colour key, per type', () => {
    const mosque = rampForBuildingRole('wall', 'limestone.1');
    const house = rampForBuildingRole('wall', 'limestone.3');
    const warehouse = rampForBuildingRole('wall', 'gunmetal.1');
    expect(mosque).not.toEqual(house);
    expect(mosque).not.toEqual(warehouse);
  });

  it('throws on a role outside the closed set', () => {
    expect(() => rampForBuildingRole('uniform', 'limestone.1')).toThrow(/unknown rl_role/);
  });

  it('throws on a malformed wall colour key', () => {
    expect(() => rampForBuildingRole('wall', 'limestone')).toThrow(/malformed wall colour key/);
    expect(() => rampForBuildingRole('wall', 'limestone.x')).toThrow(/malformed wall colour key/);
  });

  it('throws on an unknown ramp band in the wall colour key', () => {
    expect(() => rampForBuildingRole('wall', 'nonexistent.1')).toThrow(/no ramp named/);
  });

  it('gives every role (except wall) a real multi-step ramp', () => {
    // Prevents truncation like the roof getting sliced to just one colour.
    // Matches the pattern in decor-role.test.ts.
    const rolesExceptWall = BUILDING_MESH_ROLES.filter(r => r !== 'wall');
    for (const role of rolesExceptWall) {
      const ramp = rampForBuildingRole(role, 'limestone.1');
      expect(ramp.length).toBeGreaterThan(1);
      for (const hex of ramp) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
