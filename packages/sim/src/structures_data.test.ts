import { describe, expect, it } from 'vitest';
import catalogue from '../../../data/structures.json';
import demoSquad from '../../../data/units/kdf/demo_squad.json';
import dozerD9 from '../../../data/units/kdf/dozer_d9.json';
import { unitTypeFromJson, TICKS_PER_SECOND, type UnitTypeJson } from './sim';
import { structureTypeFromJson, type StructureTypeJson } from './structures';

// Field works (#277 Task 8): the shipped data/structures.json, read through the REAL parser, so
// the schema, the catalogue and `structureTypeFromJson` cannot drift. Every expected value is a
// literal with its arithmetic beside it (Q16.16: ONE = 65536; fx.from rounds to nearest).

const parse = (id: string) => {
  const json = (catalogue.types as unknown as Record<string, StructureTypeJson>)[id];
  if (json === undefined) throw new Error(`no structure type ${id}`);
  return structureTypeFromJson(json, TICKS_PER_SECOND);
};
const area = (id: string, i: number) => {
  const a = parse(id).aura?.area[i];
  if (a === undefined) throw new Error(`${id} has no area effect ${i}`);
  return a;
};
const ONE = 65536;

describe('the eight field works parse through structureTypeFromJson', () => {
  it('owners: the four KDF types are side 0, the four militia types side 1', () => {
    for (const id of ['kdf_medic_station', 'kdf_outpost', 'kdf_intel_centre', 'kdf_workshop']) expect(parse(id).owner).toBe(0);
    for (const id of ['militia_field_clinic', 'militia_firing_position', 'militia_observation_post', 'militia_weapons_workshop']) {
      expect(parse(id).owner).toBe(1);
      expect(parse(id).buildable).toBeNull();
    }
  });
  it('medic station: heal 0.010/s is fx 655, (655 + 10) / 20 = 33 raw a tick; radius 4 is 16 tile^2', () => {
    expect(area('kdf_medic_station', 0)).toMatchObject({ healRate: 33, healCap: ONE, radiusSq: 1048576, compTicks: 0, accMult: ONE });
    expect(parse('kdf_medic_station').hpPerTile).toBe(200 * ONE);
  });
  it('militia clinic: 0.0075/s is fx 492, (492 + 10) / 20 = 25 raw; radius 3 is 9 tile^2; roe 6', () => {
    expect(area('militia_field_clinic', 0)).toMatchObject({ healRate: 25, healCap: ONE, radiusSq: 589824 });
    expect(parse('militia_field_clinic').roePenalty).toBe(6);
  });
  it('workshop: repair 33 raw, 30 s is 600 ticks; the second area is x1.06 = fx 69468 for any', () => {
    expect(area('kdf_workshop', 0)).toMatchObject({ healRate: 33, compTicks: 600, affects: 1 });
    expect(area('kdf_workshop', 1)).toMatchObject({ accMult: 69468, healRate: 0, affects: 2 });
  });
  it('militia weapons workshop: repair 25 raw, 45 s is 900 ticks, x1.06', () => {
    expect(area('militia_weapons_workshop', 0)).toMatchObject({ healRate: 25, compTicks: 900 });
    expect(area('militia_weapons_workshop', 1).accMult).toBe(69468);
  });
  it('intel centre: sight 10 is 100 tile^2 = 6553600, tunnel radius 10 the same; optics 1.0', () => {
    expect(parse('kdf_intel_centre').aura?.sensor).toEqual({ sight: 10 * ONE, sightSq: 6553600, optics: ONE, tunnelRadiusSq: 6553600 });
  });
  it('militia observation post: sight 9 is 81 tile^2 = 5308416, optics 1.2 is fx 78643, no tunnel radius', () => {
    expect(parse('militia_observation_post').aura?.sensor).toEqual({ sight: 9 * ONE, sightSq: 5308416, optics: 78643, tunnelRadiusSq: 0 });
  });
  it('outpost and firing position: 3 slots, garrison_cover 3, the extra range 0 and sight +2 / +1', () => {
    const o = parse('kdf_outpost');
    expect([o.garrisonSlots, o.garrisonCover, o.aura?.rangeBonus, o.aura?.sightBonus]).toEqual([3, 3, 0, 2 * ONE]);
    const f = parse('militia_firing_position');
    expect([f.garrisonSlots, f.garrisonCover, f.aura?.rangeBonus, f.aura?.sightBonus]).toEqual([3, 3, 0, ONE]);
  });
  it('buildables: cost, footprint and build step (ONE - ONE % ticks) / ticks', () => {
    // medic 20 s = 400 ticks: 65536 % 400 = 336, (65536 - 336) / 400 = 163
    expect(parse('kdf_medic_station').buildable).toMatchObject({ costLogistics: 250, costIntel: 0, buildStep: 163, fw: 2, fh: 2 });
    // intel 40 s = 800 ticks: 65536 % 800 = 736, (65536 - 736) / 800 = 81
    expect(parse('kdf_intel_centre').buildable).toMatchObject({ costLogistics: 400, buildStep: 81 });
    // outpost 30 s = 600 ticks: 65536 % 600 = 136, 65400 / 600 = 109
    expect(parse('kdf_outpost').buildable).toMatchObject({ costLogistics: 350, buildStep: 109 });
    // workshop 30 s
    expect(parse('kdf_workshop').buildable).toMatchObject({ costLogistics: 300, buildStep: 109 });
  });
});

describe('the construct carriers', () => {
  it('demo_squad builds at the base rate, the D9 at 1.5 (fx 98304)', () => {
    const d = unitTypeFromJson(demoSquad as unknown as UnitTypeJson);
    const b = unitTypeFromJson(dozerD9 as unknown as UnitTypeJson);
    expect([d.canConstruct, d.constructRate]).toEqual([true, ONE]);
    expect([b.canConstruct, b.constructRate]).toEqual([true, 98304]);
  });
});
