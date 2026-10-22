// GH-707 Task 1: the unit and structure schemas accept the wound/rescue fields and refuse an
// out-of-range one. P1 is engine only: no shipped JSON uses a field, so these fixtures are the
// only content the schemas are exercised with until P2.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): object => JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', f), 'utf8')) as object;
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => (d: unknown) => boolean;
})({ allErrors: true, strict: false });
ajv.addSchema(read('common.schema.json'));
const validateUnit = ajv.compile(read('unit.schema.json'));
const validateStructures = ajv.compile(read('structure.schema.json'));

const base = {
  name: 'Probe',
  faction: 'kdf',
  cost: { logistics: 100 },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8 },
};

const squad = {
  ...base,
  id: 'probe_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: 0.6, bleed_s: 60, type: 'wounded_kdf', in_place: false } },
};
const wounded = { ...base, id: 'wounded_kdf', role: 'wounded', hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true } };
const medic = {
  ...base,
  id: 'probe_medic',
  role: 'support',
  abilities: ['rescue'],
  hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, figures: 2, transport_slots: 1, can_carry: ['wounded'] },
  rescue: { radius_tiles: 8, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
};
const ambulance = {
  ...base,
  id: 'probe_ambulance',
  role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4, can_carry: ['wounded'], stabilise_radius: 1.5 },
};

describe('unit schema: wound and rescue fields (GH-707)', () => {
  it('accepts a squad, a wounded man, a medic and an ambulance with every new field', () => {
    for (const u of [squad, wounded, medic, ambulance]) expect(validateUnit(u), u.id).toBe(true);
  });

  it('refuses wound_chance 1.5, figures 9, an unknown rescue key and a zero bleed', () => {
    const w = squad.hull.wounds;
    expect(validateUnit({ ...squad, hull: { ...squad.hull, wounds: { ...w, wound_chance: 1.5 } } })).toBe(false);
    expect(validateUnit({ ...squad, hull: { ...squad.hull, wounds: { ...w, bleed_s: 0 } } })).toBe(false);
    expect(validateUnit({ ...squad, hull: { ...squad.hull, figures: 9 } })).toBe(false);
    expect(validateUnit({ ...medic, rescue: { ...medic.rescue, crawl: 1 } })).toBe(false);
  });

  it('refuses a duration over 1600 s and a radius over 64 tiles (Fx would wrap)', () => {
    expect(validateUnit({ ...squad, hull: { ...squad.hull, wounds: { ...squad.hull.wounds, bleed_s: 1601 } } })).toBe(false);
    expect(validateUnit({ ...medic, rescue: { ...medic.rescue, treat_s: 1601 } })).toBe(false);
    expect(validateUnit({ ...medic, rescue: { ...medic.rescue, radius_tiles: 65 } })).toBe(false);
    expect(validateUnit({ ...ambulance, hull: { ...ambulance.hull, stabilise_radius: 65 } })).toBe(false);
  });

  it('can_carry names roles: "wonded" is refused', () => {
    expect(validateUnit({ ...ambulance, hull: { ...ambulance.hull, can_carry: ['wonded'] } })).toBe(false);
  });
});

describe('structure schema: the aid block (GH-707)', () => {
  const aidPost = { id: 'probe_aid_post', symbol: 'A', hp_per_tile: 200, aid: { admit_radius: 1, treat_s: 20, dispatch_radius: 12 } };
  it('accepts an aid post', () => {
    expect(validateStructures({ types: { probe_aid_post: aidPost } })).toBe(true);
  });
  it('refuses an aid treat_s over 1600 s and a dispatch radius over 64 tiles', () => {
    expect(validateStructures({ types: { probe_aid_post: { ...aidPost, aid: { ...aidPost.aid, treat_s: 1601 } } } })).toBe(false);
    expect(validateStructures({ types: { probe_aid_post: { ...aidPost, aid: { ...aidPost.aid, dispatch_radius: 65 } } } })).toBe(false);
  });
  it('refuses an aid block missing treat_s', () => {
    expect(validateStructures({ types: { probe_aid_post: { ...aidPost, aid: { admit_radius: 1, dispatch_radius: 12 } } } })).toBe(false);
  });
});
