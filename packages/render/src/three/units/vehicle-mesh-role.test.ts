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

// ---------------------------------------------------------------------------
// The TypeScript ramp table against the Python gate's copy of it.
//
// `tools/render_mesh_gate.py` keeps its OWN `VEHICLE_ROLE_PALETTES`, because it
// is a Blender script that cannot import TypeScript. Two tables, one truth --
// the same shape `tools/src/terrain_symbols.test.ts` already guards for the
// terrain legend, and it exists for the same reason: the last time two copies
// of one idea drifted here, the tunnel registration went missing from
// playtest.ts and the harness was dead for two days with every test green.
//
// This one drifted the day it was written. A supplied vehicle was added to the
// Python table and not to this one, and `pnpm validate:meshes` stayed GREEN --
// structurally so, because the gate falls back to
// `VEHICLE_ROLE_PALETTE_FALLBACK` for an unknown vehicle and therefore COLOURS
// an unwired mesh rather than failing it. The renderer has no such fallback by
// design (`rampForVehicleRole` throws), so the asset rendered fine in the gate
// and threw at boot in the app. A green gate could not have caught it; this can.
//
// Reading source and regexing a literal is ugly, and worth it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRamp } from './mesh-role';

const GATE = join(import.meta.dirname, '..', '..', '..', '..', '..', 'tools', 'render_mesh_gate.py');

/** `VEHICLE_ROLE_PALETTES` as {vehicle: {role: "band.index"}}, from the gate's source. */
function gateTable(): Record<string, Record<string, string>> {
  const src = readFileSync(GATE, 'utf8');
  const start = src.indexOf('VEHICLE_ROLE_PALETTES = {');
  if (start < 0) {
    throw new Error(
      'could not find `VEHICLE_ROLE_PALETTES = {` in tools/render_mesh_gate.py — ' +
        'if it was renamed, update this regex, do not delete this test'
    );
  }
  // Stop at the FALLBACK declaration, which is a separate table and not a vehicle.
  const end = src.indexOf('VEHICLE_ROLE_PALETTE_FALLBACK', start);
  const body = src.slice(start, end > 0 ? end : undefined);
  const out: Record<string, Record<string, string>> = {};
  for (const m of body.matchAll(/^ {4}"([a-z_0-9]+)":\s*\{([\s\S]*?)\},$/gm)) {
    const roles: Record<string, string> = {};
    for (const r of m[2].matchAll(/"([a-z]+)":\s*"([a-z]+\.\d+)"/g)) roles[r[1]] = r[2];
    out[m[1]] = roles;
  }
  return out;
}

/** The `band.index` shorthand both tables use, resolved to a hex colour. */
function resolve(key: string): string {
  const dot = key.indexOf('.');
  return readRamp(key.slice(0, dot))[Number(key.slice(dot + 1))];
}

describe('the renderer ramp table and the mesh gate agree', () => {
  it('finds the gate declaration at all', () => {
    // Guards the regex itself: a silently-empty match would make the assertion
    // below vacuously true rather than false.
    //
    // Deliberately not a fixed count. The gate's table is PARTIAL by design --
    // only the vehicles whose sprite pipeline declared a palette are in it, and
    // the rest warn `not in VEHICLE_ROLE_PALETTES` and take the fallback. So
    // this checks the parse worked, not how many vehicles it found.
    expect(Object.keys(gateTable()).length).toBeGreaterThan(0);
  });

  // One direction only, and it is the one that fails: gate-knows-it,
  // renderer-does-not. The reverse (an entry here the gate lacks) is not a bug
  // -- the gate falls back and warns, which is visible. This direction is
  // silent in the gate and fatal in the app.
  it('gives every vehicle the gate knows the same base colour per role', () => {
    for (const [vehicle, roles] of Object.entries(gateTable())) {
      for (const [role, key] of Object.entries(roles)) {
        // Throws outright if this table has no entry for the vehicle, which is
        // the exact failure the gate cannot see.
        const ramp = rampForVehicleRole(vehicle, role);
        expect(`${vehicle}.${role} = ${ramp[0]}`).toBe(`${vehicle}.${role} = ${resolve(key)}`);
      }
    }
  });
});
