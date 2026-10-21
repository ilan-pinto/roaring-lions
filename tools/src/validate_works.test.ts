// The field-works data rules (#277 Task 8) that validate_data.mjs cannot leave to the runtime.
// Its own module because validate_data.mjs runs its sweep at import time and exits. Each rule has a
// named red fixture: the input that makes it fail, run and seen red (the commit message quotes it).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildableOwnerFailures,
  fieldWorksKeyFailures,
  fieldWorksCarrierReport,
  tunnelSensorFailures,
  worksSymbolFailures,
} from '../validate_works.mjs';

const ROOT = join(__dirname, '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const catalogue = readJson('data/structures.json') as { types: Record<string, Record<string, unknown>> };

const cat = {
  types: {
    medic: { id: 'medic', symbol: 'M', owner: 0, buildable: { cost: { logistics: 1 }, build_time_s: 5 } },
    centre: {
      id: 'centre',
      symbol: 'I',
      owner: 0,
      buildable: { cost: { logistics: 1 }, build_time_s: 5 },
      aura: { sensor: { sight: 10, optics: 1, tunnel_radius: 10 } },
    },
    eye: { id: 'eye', symbol: 'E', owner: 0, buildable: { cost: { logistics: 1 }, build_time_s: 5 }, aura: { sensor: { sight: 10, optics: 1 } } },
    hall: { id: 'hall', symbol: 'm' },
  },
};

describe('rule 1: buildable requires owner 0', () => {
  it('RED FIXTURE buildable_owned_by_enemy: a buildable type owned by side 1, or by nobody, is refused', () => {
    const enemy = { types: { x: { id: 'x', symbol: 'X', owner: 1, buildable: { cost: { logistics: 1 }, build_time_s: 5 } } } };
    const neutral = { types: { x: { id: 'x', symbol: 'X', buildable: { cost: { logistics: 1 }, build_time_s: 5 } } } };
    expect(buildableOwnerFailures(enemy, 'f')).toHaveLength(1);
    expect(buildableOwnerFailures(neutral, 'f')).toHaveLength(1);
  });
  it('passes owner 0, and a type that is not buildable at any owner', () => {
    expect(buildableOwnerFailures(cat, 'f')).toEqual([]);
    expect(buildableOwnerFailures({ types: { c: { id: 'c', symbol: 'C', owner: 1 } } }, 'f')).toEqual([]);
  });
});

describe('rule 2: each field_works key is a buildable type', () => {
  it('RED FIXTURE field_works_names_unbuildable: a key that is unknown, or a type that is not buildable, is refused', () => {
    expect(fieldWorksKeyFailures({ field_works: { nope: 1 } }, cat, 'm')).toHaveLength(1);
    expect(fieldWorksKeyFailures({ field_works: { hall: 1 } }, cat, 'm')).toHaveLength(1);
  });
  it('passes buildable keys and a mission without the block', () => {
    expect(fieldWorksKeyFailures({ field_works: { medic: 1, centre: 2 } }, cat, 'm')).toEqual([]);
    expect(fieldWorksKeyFailures({}, cat, 'm')).toEqual([]);
  });
});

describe('rule 3: a mission with field_works fields a construct carrier', () => {
  const units = new Map<string, { abilities?: string[] }>([
    ['eng', { abilities: ['demolish', 'construct'] }],
    ['rifle', { abilities: [] }],
  ]);
  const base = { field_works: { medic: 1 } };
  it('RED FIXTURE works_without_carrier: no construct unit in starting_force is a failure when nothing can be built', () => {
    const r = fieldWorksCarrierReport({ ...base, starting_force: [{ unit: 'rifle', count: 3 }] }, units, 'm');
    expect(r.failures).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });
  it('is only a warning when the mission has production that could field one (R8/L4)', () => {
    const r = fieldWorksCarrierReport(
      { ...base, resources: { logistics_start: 400 }, starting_force: [{ unit: 'rifle', count: 3 }] },
      units,
      'm',
    );
    expect(r.failures).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
  it('passes with a carrier, and for a mission without field_works', () => {
    expect(fieldWorksCarrierReport({ ...base, starting_force: [{ unit: 'eng', count: 1 }] }, units, 'm')).toEqual({ failures: [], warnings: [] });
    expect(fieldWorksCarrierReport({ starting_force: [] }, units, 'm')).toEqual({ failures: [], warnings: [] });
  });
});

describe('rule 4: no tunnel-radius sensor in a mission that authors digs or in_tunnel', () => {
  const digs = { enemy: { garrison: [{ unit: 'dig', count: 1, at: [1, 1], digs: 'r1' }] } };
  const buried = { enemy: { garrison: [{ unit: 'sap', count: 2, at: [1, 1], in_tunnel: 'r1' }] } };
  it('RED FIXTURE tunnel_radius_with_digs: a field_works centre beside a digs, or an in_tunnel, placement is refused', () => {
    expect(tunnelSensorFailures({ field_works: { centre: 1 }, ...digs }, cat, 'm')).toHaveLength(1);
    expect(tunnelSensorFailures({ field_works: { centre: 1 }, ...buried }, cat, 'm')).toHaveLength(1);
  });
  it('also refuses a mission-placed structure of such a type, keyed on the field and not the id', () => {
    expect(tunnelSensorFailures({ structures: [{ type: 'centre', at: [1, 1], owner: 0 }], ...digs }, cat, 'm')).toHaveLength(1);
  });
  it('passes a sensor with no tunnel_radius, a centre with no tunnels authored, and a mission without either', () => {
    expect(tunnelSensorFailures({ field_works: { eye: 1 }, ...digs }, cat, 'm')).toEqual([]);
    expect(tunnelSensorFailures({ field_works: { centre: 1 } }, cat, 'm')).toEqual([]);
    expect(tunnelSensorFailures({ ...digs }, cat, 'm')).toEqual([]);
  });
});

describe('rule 5: work symbols are not terrain and not on any map row', () => {
  const terrain = new Set(['.', '1', '^']);
  const maps = [{ file: 'a.json', rows: ['..1', '.M.'] }];
  it('RED FIXTURE work_symbol_on_a_map: a work symbol drawn into a map row, or a terrain symbol, is refused', () => {
    expect(worksSymbolFailures(cat, maps, terrain)).toHaveLength(1);
    const t = { types: { x: { id: 'x', symbol: '^', owner: 0, buildable: { cost: { logistics: 1 }, build_time_s: 5 } } } };
    expect(worksSymbolFailures(t, [], terrain)).toHaveLength(1);
  });
  it('passes when no row uses one, and ignores a plain building symbol', () => {
    expect(worksSymbolFailures(cat, [{ file: 'a.json', rows: ['.m.'] }], terrain)).toEqual([]);
  });
});

describe('the shipped data', () => {
  it('every shipped rule passes on the real catalogue', () => {
    expect(buildableOwnerFailures(catalogue, 'structures.json')).toEqual([]);
    const maps = readdirSync(join(ROOT, 'data/maps'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: f, rows: readJson(`data/maps/${f}`).rows as string[] }));
    const terrain = new Set(['.', '1', '2', '3', 'r', 'o', 'n', '^', 'b', 'd']);
    expect(worksSymbolFailures(catalogue, maps, terrain)).toEqual([]);
  });
  it('the eight field works are present, and exactly the four KDF ones are buildable', () => {
    const ids = Object.keys(catalogue.types);
    for (const id of [
      'kdf_medic_station', 'kdf_outpost', 'kdf_intel_centre', 'kdf_workshop',
      'militia_field_clinic', 'militia_firing_position', 'militia_observation_post', 'militia_weapons_workshop',
    ]) expect(ids).toContain(id);
    const buildable = Object.values(catalogue.types).filter((t) => t.buildable !== undefined).map((t) => t.id);
    expect(buildable.sort()).toEqual(['kdf_intel_centre', 'kdf_medic_station', 'kdf_outpost', 'kdf_workshop']);
  });
  it('no shipped mission lists field_works yet (L4/L5 are the lead\'s)', () => {
    const withWorks = readdirSync(join(ROOT, 'data/missions'))
      .filter((f) => f.endsWith('.json'))
      .filter((f) => readJson(`data/missions/${f}`).field_works !== undefined);
    expect(withWorks).toEqual([]);
  });
});
