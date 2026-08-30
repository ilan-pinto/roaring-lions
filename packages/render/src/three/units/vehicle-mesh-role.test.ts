import { describe, it, expect } from 'vitest';
import { VEHICLE_MESH_ROLES, isVehicleMeshRole, rampForVehicleRole } from './vehicle-mesh-role';

describe('vehicle-mesh-role', () => {
  it('recognises the closed six-role vehicle vocabulary', () => {
    expect(VEHICLE_MESH_ROLES).toEqual(['hull', 'plate', 'rubber', 'metal', 'glass', 'recess']);
    for (const role of VEHICLE_MESH_ROLES) expect(isVehicleMeshRole(role)).toBe(true);
    expect(isVehicleMeshRole('uniform')).toBe(false); // an infantry role, not a vehicle one
    expect(isVehicleMeshRole('bogus')).toBe(false);
  });

  it('resolves a real role for every vehicle this task wires up', () => {
    for (const id of ['apc_eitan', 'dozer_d9', 'technical', 'mbt_lavi']) {
      const hull = rampForVehicleRole(id, 'hull');
      expect(hull.length).toBeGreaterThan(0);
      for (const hex of hull) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('throws for an unrecognised role, never returning a default colour', () => {
    expect(() => rampForVehicleRole('apc_eitan', 'uniform')).toThrow(/unknown rl_role/);
  });

  it('throws for an unrecognised vehicle id', () => {
    expect(() => rampForVehicleRole('gun_truck', 'hull')).toThrow(/no ramp table/);
  });

  it('throws for a role a real vehicle does not declare (no default colour)', () => {
    // apc_eitan's own render_eitan.py ROLE_PALETTE has no `recess` entry.
    expect(() => rampForVehicleRole('apc_eitan', 'recess')).toThrow(/declares no ramp/);
  });

  it('dozer_d9 and apc_eitan disagree on hull tone -- distinct vehicles, distinct ramps', () => {
    const d9 = rampForVehicleRole('dozer_d9', 'hull');
    const eitan = rampForVehicleRole('apc_eitan', 'hull');
    expect(d9).not.toEqual(eitan);
  });
});
