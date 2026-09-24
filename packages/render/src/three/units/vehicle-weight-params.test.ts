import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_LAG_TILES } from './vehicle-weight';
import type { VehicleWeightParams } from './vehicle-weight';
import {
  VEHICLE_WEIGHT_IMPORTED_UNIT_IDS,
  VEHICLE_WEIGHT_MASS_CLASS,
  VEHICLE_WEIGHT_ROLE_DEFAULTS,
  vehicleWeightParamsFor,
} from './vehicle-weight-params';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const VEHICLE_MESHES = path.join(REPO, 'art/meshes/vehicles');
const UNIT_DIRS = ['data/units/kdf', 'data/units/enemy'];

function shippedVehicleIds(): string[] {
  return readdirSync(VEHICLE_MESHES)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.replace(/\.glb$/, ''));
}

function unitJson(id: string): Record<string, unknown> | null {
  for (const dir of UNIT_DIRS) {
    const p = path.join(REPO, dir, `${id}.json`);
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
      /* next dir */
    }
  }
  return null;
}

describe('the import list is pinned to the directory (R-I)', () => {
  // The `SPRITE_MAP` failure, and the `vfxEmitters` failure one sub-project
  // ago: a hand-kept list of content goes stale silently, the missing entry
  // answers `undefined`, and the effect ships inert behind a passing suite.
  // Read from DISK here, never an import glob -- a glob would derive the list
  // from the directory and make this check vacuous.
  it('resolves params for every unit with a shipped vehicle GLB', () => {
    for (const id of shippedVehicleIds()) {
      const json = unitJson(id);
      if (json === null) continue; // a GLB with no unit JSON is another gate's problem
      const role = (json.role ?? '') as string;
      expect(() => vehicleWeightParamsFor(id, role)).not.toThrow();
      const p = vehicleWeightParamsFor(id, role);
      expect(p.maxPitchRad).toBeGreaterThan(0);
      expect(p.accelSeconds).toBeGreaterThan(0);
    }
  });

  it('has a role default for every role a shipped vehicle declares', () => {
    for (const id of shippedVehicleIds()) {
      const json = unitJson(id);
      if (json === null) continue;
      const role = (json.role ?? '') as string;
      expect(Object.keys(VEHICLE_WEIGHT_ROLE_DEFAULTS)).toContain(role);
    }
  });

  // The whole point of R-I: an authored block must actually be READ. If a unit
  // declares `mobility.weight` and the resolver answers the role default, the
  // JSON is inert and looks authored.
  it('reads an authored block rather than the role default', () => {
    for (const id of shippedVehicleIds()) {
      const json = unitJson(id);
      const mobility = (json?.mobility ?? {}) as Record<string, unknown>;
      const weight = mobility.weight as Record<string, number> | undefined;
      if (!weight || weight.pitch_deg === undefined) continue;
      const role = (json?.role ?? '') as string;
      expect(vehicleWeightParamsFor(id, role).maxPitchRad).toBeCloseTo(
        (weight.pitch_deg * Math.PI) / 180,
        9
      );
    }
  });
});

// Fix round 1 (post-approval review). The three checks above only ever prove
// the pin in ONE direction: every shipped GLB resolves to something usable.
// That property survives a STALE or an EXTRA entry, because the role-default
// fallback needed for "answers something usable for a role nobody has
// thought of" is exactly as generous to a unit that should not be in the
// list at all. `VEHICLE_WEIGHT_IMPORTED_UNIT_IDS` is the smallest export that
// lets a test compare the two id sets directly, in both directions, instead
// of only ever walking the disk side of the pin.
describe('the import list matches the shipped roster exactly, in both directions', () => {
  it('imports neither more nor fewer unit ids than art/meshes/vehicles/*.glb ships', () => {
    const shipped = new Set(shippedVehicleIds());
    const imported = new Set(VEHICLE_WEIGHT_IMPORTED_UNIT_IDS);
    const missing = [...shipped].filter((id) => !imported.has(id)).sort();
    const extra = [...imported].filter((id) => !shipped.has(id)).sort();
    // Two separate arrays in the failure message, not one combined diff: a
    // reader should not have to guess whether a name is missing or extra.
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});

describe('the resolution order', () => {
  it('falls back to the role default for a unit that declares nothing', () => {
    expect(vehicleWeightParamsFor('no_such_unit', 'mbt')).toEqual(VEHICLE_WEIGHT_ROLE_DEFAULTS.mbt);
  });

  it('answers something usable for a role nobody has thought of, rather than throwing', () => {
    // `rampForVehicleRole` throws for an unmapped role and is right to -- a
    // vehicle with no ramp draws nothing. This is cosmetic: an unmapped role
    // should draw a plausible hull, not stop the frame.
    expect(() => vehicleWeightParamsFor('x', 'submarine')).not.toThrow();
  });
});

describe('the schema ceilings are real', () => {
  // The bound in two places on purpose: a constraint enforced in one place
  // only is a constraint with one way around it. `validate:data` stops the
  // author; this stops the defaults table.
  it('keeps every default and every mass class inside the lag budget', () => {
    const all = [
      ...Object.values(VEHICLE_WEIGHT_ROLE_DEFAULTS),
      ...Object.values(VEHICLE_WEIGHT_MASS_CLASS),
    ];
    for (const p of all) expect(p.lagTiles).toBeLessThanOrEqual(MAX_LAG_TILES);
  });

  // Every role default AND every mass class: `unit.schema.json`'s
  // `pitch_deg` description says the tables hold this line and the schema
  // does not (its cap is 6 degrees), so both tables have to be the ones
  // checked here.
  it('keeps every default and every mass class under the recoil\'s own pitch, which is a bigger event', () => {
    const MESH_HULL_PITCH_RAD = 0.06; // ThreeRenderer.ts:440
    for (const p of [...Object.values(VEHICLE_WEIGHT_ROLE_DEFAULTS), ...Object.values(VEHICLE_WEIGHT_MASS_CLASS)]) {
      expect(p.maxPitchRad).toBeLessThan(MESH_HULL_PITCH_RAD);
    }
  });

  // A heavier vehicle leans and squats MORE and recovers SLOWER. Asserted as an
  // ordering rather than as numbers, so retuning the table cannot silently
  // invert the one property the whole package is about.
  it('orders the mass classes the way mass orders them', () => {
    const { light, medium, heavy } = VEHICLE_WEIGHT_MASS_CLASS;
    expect(heavy.maxPitchRad).toBeGreaterThan(medium.maxPitchRad);
    expect(medium.maxPitchRad).toBeGreaterThan(light.maxPitchRad);
    expect(heavy.accelSeconds).toBeGreaterThan(light.accelSeconds);
    expect(heavy.settleSeconds).toBeGreaterThan(light.settleSeconds);
  });
});

// Final review of WP-A1.3, ruling 6. `validate:data` holds an AUTHORED
// `mobility.weight` block to the schema; nothing held the renderer's own
// tables to it, so a role default or a mass class could sit outside bounds
// no author is allowed past and nothing would say so. These bounds are READ
// from `data/schemas/unit.schema.json` at test time, never copied: move a
// schema bound or a table number and this is where the two meet.
describe('the tables sit inside the schema\'s own bounds, read from the schema', () => {
  interface Bound {
    minimum: number;
    maximum: number;
  }
  const DEG = Math.PI / 180;
  /** Each numeric schema field, and how a table entry is read in its units. */
  const FIELDS: Readonly<Record<string, (p: VehicleWeightParams) => number>> = {
    pitch_deg: (p) => p.maxPitchRad / DEG,
    roll_deg: (p) => p.maxRollRad / DEG,
    lag_tiles: (p) => p.lagTiles,
    settle_s: (p) => p.settleSeconds,
  };

  function field(obj: unknown, key: string): unknown {
    if (typeof obj !== 'object' || obj === null || !(key in obj)) {
      throw new Error(`unit.schema.json: no "${key}" where mobility.weight's bounds were expected`);
    }
    return (obj as Record<string, unknown>)[key];
  }

  function schemaWeightBounds(): Record<string, Bound> {
    const schema: unknown = JSON.parse(readFileSync(path.join(REPO, 'data/schemas/unit.schema.json'), 'utf8'));
    const mobility = field(field(schema, 'properties'), 'mobility');
    const props = field(field(field(mobility, 'properties'), 'weight'), 'properties');
    const out: Record<string, Bound> = {};
    for (const [key, spec] of Object.entries(props as Record<string, unknown>)) {
      // `mass_class` is the one non-numeric field: an enum picks a whole
      // table row, so it has no bound of its own to hold a number to.
      if (typeof spec === 'object' && spec !== null && 'enum' in spec) continue;
      const minimum = field(spec, 'minimum');
      const maximum = field(spec, 'maximum');
      if (typeof minimum !== 'number' || typeof maximum !== 'number') {
        throw new Error(`unit.schema.json: mobility.weight.${key} has no numeric minimum/maximum`);
      }
      out[key] = { minimum, maximum };
    }
    return out;
  }

  const TABLES: ReadonlyArray<[string, Readonly<Record<string, VehicleWeightParams>>]> = [
    ['VEHICLE_WEIGHT_ROLE_DEFAULTS', VEHICLE_WEIGHT_ROLE_DEFAULTS],
    ['VEHICLE_WEIGHT_MASS_CLASS', VEHICLE_WEIGHT_MASS_CLASS],
  ];

  it('covers every numeric bound the schema declares, and nothing it does not', () => {
    // A new schema number with no reading here would be a bound nothing holds
    // the tables to; a reading with no schema field would be checking air.
    expect(Object.keys(schemaWeightBounds()).sort()).toEqual(Object.keys(FIELDS).sort());
  });

  it('reads lag_tiles\' maximum as the renderer\'s own MAX_LAG_TILES (0.09)', () => {
    expect(schemaWeightBounds().lag_tiles.maximum).toBe(MAX_LAG_TILES);
    expect(MAX_LAG_TILES).toBe(0.09);
  });

  it('keeps every entry of both tables inside every schema bound', () => {
    const bounds = schemaWeightBounds();
    const outside: string[] = [];
    for (const [tableName, table] of TABLES) {
      for (const [entry, p] of Object.entries(table)) {
        for (const [key, read] of Object.entries(FIELDS)) {
          const v = read(p);
          const b = bounds[key];
          if (!(v >= b.minimum && v <= b.maximum)) {
            outside.push(`${tableName}.${entry}.${key} = ${v}, schema allows ${b.minimum}..${b.maximum}`);
          }
        }
      }
    }
    // Named, so a red run says which entry and which bound.
    expect(outside).toEqual([]);
  });
});
