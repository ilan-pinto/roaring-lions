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
  productionPlacementFailures,
  productionTypeFailures,
  productionWorksCount,
  tunnelSensorFailures,
  worksSymbolFailures,
} from '../validate_works.mjs';

const ROOT = join(__dirname, '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const catalogue = readJson('data/structures.json') as { types: Record<string, Record<string, unknown>> };

const medic = { id: 'medic', symbol: 'M', owner: 0, buildable: { cost: { logistics: 1 }, build_time_s: 5 } };
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

describe('GH-277 forward camp: production works', () => {
  const build = { cost: { logistics: 1 }, build_time_s: 5 };
  const kdfRoles = new Set(['infantry', 'at_team', 'sniper', 'engineer', 'support', 'drone', 'recon', 'mbt']);
  const fwd = (extra: Record<string, unknown>) => ({ types: { fwd: { id: 'fwd', symbol: 'K', owner: 0, buildable: build, production: {}, ...extra } } });

  it('passes a plain production work, one with a role subset, and a catalogue without any', () => {
    expect(productionTypeFailures(fwd({}), kdfRoles, 'f')).toEqual([]);
    expect(productionTypeFailures(fwd({ production: { roles: ['infantry', 'drone'], build_time_mult: 1.25 } }), kdfRoles, 'f')).toEqual([]);
    expect(productionTypeFailures(cat, kdfRoles, 'f')).toEqual([]);
  });

  it('RED FIXTURE production_not_buildable: a production block on a type the player cannot raise is refused', () => {
    const t = { types: { x: { id: 'x', symbol: 'X', owner: 0, production: {} } } };
    const out = productionTypeFailures(t, kdfRoles, 'f');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('is not buildable');
  });

  it('RED FIXTURE production_owned_by_enemy: a production block with owner 1, or none, is refused (D7: the enemy never builds it)', () => {
    expect(productionTypeFailures(fwd({ owner: 1 }), kdfRoles, 'f').some((m) => m.includes('owner 1'))).toBe(true);
    const neutral = { types: { x: { id: 'x', symbol: 'X', buildable: build, production: {} } } };
    expect(productionTypeFailures(neutral, kdfRoles, 'f').some((m) => m.includes('owner -1'))).toBe(true);
  });

  it('RED FIXTURE production_is_the_rear: produces_for beside production would make it the convoy rear, and is refused', () => {
    const out = productionTypeFailures(fwd({ produces_for: 0 }), kdfRoles, 'f');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('convoy rear');
  });

  it('RED FIXTURE production_opens_a_unit: a role no KDF unit has, an empty list and a repeat are refused', () => {
    const open = productionTypeFailures(fwd({ production: { roles: ['gunship'] } }), kdfRoles, 'f');
    expect(open).toHaveLength(1);
    expect(open[0]).toContain('"gunship"');
    expect(productionTypeFailures(fwd({ production: { roles: [] } }), kdfRoles, 'f')).toHaveLength(1);
    expect(productionTypeFailures(fwd({ production: { roles: ['infantry', 'infantry'] } }), kdfRoles, 'f')).toHaveLength(1);
  });

  it('RED FIXTURE production_placed_by_a_mission: a structures[] placement of a production type is refused, a camp is not', () => {
    const t = { types: { ...fwd({}).types, camp: { id: 'camp', symbol: 'c', produces_for: 0 } } };
    const out = productionPlacementFailures({ structures: [{ type: 'fwd', at: [1, 1] }] }, t, 'm');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"fwd"');
    expect(productionPlacementFailures({ structures: [{ type: 'camp', at: [1, 1] }] }, t, 'm')).toEqual([]);
    expect(productionPlacementFailures({}, t, 'm')).toEqual([]);
  });

  it('counts the production works a mission lists, and only those', () => {
    const t = { types: { ...fwd({}).types, medic } };
    expect(productionWorksCount({ field_works: { fwd: 2, medic: 2 } }, t)).toBe(2);
    expect(productionWorksCount({}, t)).toBe(0);
  });

  it('the shipped kdf_forward_camp passes every rule against the shipped KDF roles', () => {
    const roles = new Set<string>();
    for (const f of readdirSync(join(ROOT, 'data/units/kdf')).filter((n) => n.endsWith('.json'))) roles.add(readJson(`data/units/kdf/${f}`).role as string);
    expect(productionTypeFailures(catalogue, roles, 'structures.json')).toEqual([]);
    const t = catalogue.types.kdf_forward_camp as Record<string, unknown>;
    // sets neither optional field (lead, 4 Nov 2026): the whole menu at the whole speed
    expect(t.production).toEqual({});
    expect(t.owner).toBe(0);
    expect(t.produces_for).toBeUndefined();
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
  it('the field works are present, and exactly the six KDF ones are buildable (the forward camp joined, GH-277)', () => {
    const ids = Object.keys(catalogue.types);
    for (const id of [
      'kdf_medic_station', 'kdf_outpost', 'kdf_intel_centre', 'kdf_workshop', 'kdf_aid_post', 'kdf_forward_camp',
      'militia_field_clinic', 'militia_firing_position', 'militia_observation_post', 'militia_weapons_workshop',
    ]) expect(ids).toContain(id);
    const buildable = Object.values(catalogue.types).filter((t) => t.buildable !== undefined).map((t) => t.id);
    expect(buildable.sort()).toEqual(['kdf_aid_post', 'kdf_forward_camp', 'kdf_intel_centre', 'kdf_medic_station', 'kdf_outpost', 'kdf_workshop']);
  });
  it('exactly these ten shipped missions list field_works: Ein Qasab II (GH-912), the seven allow lists of spec 5, Ein Qasab III\'s forward camp (GH-277 Task 15) and Umm Zeitoun IV\'s (GH-277 second wave)', () => {
    const withWorks = readdirSync(join(ROOT, 'data/missions'))
      .filter((f) => f.endsWith('.json'))
      .filter((f) => readJson(`data/missions/${f}`).field_works !== undefined);
    expect(withWorks).toEqual([
      'beit_sahwan_2_foothold.json', 'deir_amun_2_foothold.json', 'ein_qasab_2_foothold.json', 'ein_qasab_3_buildup.json',
      'khan_rafid_2_foothold.json', 'qarn_hadid_2_foothold.json', 'tel_marum_2_foothold.json', 'umm_zeitoun_2_buildup.json',
      'umm_zeitoun_4_clearance.json', 'wadi_halam_2_laager.json',
    ]);
    expect(readJson('data/missions/ein_qasab_2_foothold.json').field_works).toEqual({ kdf_outpost: 1 });
    expect(readJson('data/missions/ein_qasab_3_buildup.json').field_works).toEqual({ kdf_forward_camp: 1 });
    expect(readJson('data/missions/umm_zeitoun_4_clearance.json').field_works).toEqual({ kdf_forward_camp: 1 });
    // Umm Zeitoun II was measured with the camp and left without it (+28.1% median, probes.md).
    expect(readJson('data/missions/umm_zeitoun_2_buildup.json').field_works.kdf_forward_camp).toBeUndefined();
  });
});
