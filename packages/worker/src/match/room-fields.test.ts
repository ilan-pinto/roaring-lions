import { describe, expect, it } from 'vitest';
import { kitField, seatSpecialsField, seatTiersField } from './room-fields';
import { KIT_TRACKS } from './kit-tracks';

describe('kitField', () => {
  it('is brigade only for exactly that string; anything else is matched', () => {
    expect(kitField('brigade')).toBe('brigade');
    for (const v of ['matched', 'Brigade', 'brigade ', '', null, undefined, 1, {}, ['brigade']]) expect(kitField(v), String(v)).toBe('matched');
  });
});

describe('seatTiersField: a seat\'s claim, cleaned against the shipped tracks', () => {
  it('keeps a known KDF type\'s known track, clamped to its maximum; drops an unknown track, a prototype key and a non-KDF type', () => {
    const body = JSON.parse('{"mbt_lavi":{"armour":99,"warp":1},"__proto__":{"x":1},"sarim_rifles":{"armour":1}}') as unknown;
    expect(KIT_TRACKS.mbt_lavi.armour).toBe(3);
    expect(seatTiersField(body)).toEqual({ mbt_lavi: { armour: 3 } });
    // The same shape written as a literal: `__proto__` there sets the prototype, which is never an own key.
    expect(seatTiersField({ mbt_lavi: { armour: 99, warp: 1 }, __proto__: { x: 1 }, sarim_rifles: { armour: 1 } })).toEqual({ mbt_lavi: { armour: 3 } });
  });
  it('anything that is not an object is {}', () => {
    for (const v of ['x', 1, null, undefined, true, [], [{ mbt_lavi: { armour: 1 } }]]) expect(seatTiersField(v), String(v)).toEqual({});
  });
  it('truncates, clamps at 0, and drops an entry that ends at 0 and a type left with none', () => {
    expect(seatTiersField({ mbt_lavi: { armour: 2.9, sensors: -4, firepower: 0 }, inf_squad: { armour: 0.5 } })).toEqual({ mbt_lavi: { armour: 2 } });
    expect(seatTiersField({ mbt_lavi: { armour: '2', sensors: NaN, firepower: Infinity } })).toEqual({});
    expect(seatTiersField({ mbt_lavi: [3], inf_squad: null })).toEqual({});
  });
  it('a track another type declares is not this type\'s: recon_drone has no firepower', () => {
    expect(KIT_TRACKS.recon_drone.firepower).toBeUndefined();
    expect(seatTiersField({ recon_drone: { firepower: 2, sensors: 2 } })).toEqual({ recon_drone: { sensors: 2 } });
  });
  it('a prototype key at either level yields no entry and pollutes no prototype', () => {
    const body = JSON.parse('{"__proto__":{"armour":1},"constructor":{"armour":1},"toString":{"armour":1},"mbt_lavi":{"__proto__":{"armour":3},"constructor":2,"armour":1}}') as unknown;
    const out = seatTiersField(body);
    expect(Object.keys(out)).toEqual(['mbt_lavi']);
    expect(Object.keys(out.mbt_lavi)).toEqual(['armour']);
    expect(out.mbt_lavi.armour).toBe(1);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.getPrototypeOf(out.mbt_lavi)).toBeNull();
    expect(({} as Record<string, unknown>).armour).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'armour')).toBe(false);
  });
  it('an allow-listed id or track on the prototype chain is not an own key and is not read', () => {
    expect(seatTiersField({ __proto__: { mbt_lavi: { armour: 1 } } })).toEqual({});
    expect(seatTiersField({ mbt_lavi: { __proto__: { armour: 1 } } })).toEqual({});
  });
  it('asks the body for the table\'s ids alone: never its key list, and one lookup an id', () => {
    const asked: string[] = [];
    let listed = false;
    const body = new Proxy({ mbt_lavi: { armour: 1 } } as Record<string, unknown>, {
      ownKeys: (t) => { listed = true; return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor: (t, k) => { asked.push(String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
    });
    expect(seatTiersField(body)).toEqual({ mbt_lavi: { armour: 1 } });
    expect(listed).toBe(false);
    expect(asked.sort()).toEqual(Object.keys(KIT_TRACKS).sort());
  });
  it('a getter is never run: only data properties are read', () => {
    let ran = false;
    const body = { get mbt_lavi() { ran = true; return { armour: 1 }; } };
    expect(seatTiersField(body)).toEqual({});
    expect(ran).toBe(false);
  });
  it('reads only the table\'s ids, however many the body names: the output is bounded by construction', () => {
    const body: Record<string, unknown> = { mbt_lavi: { armour: 1 } };
    for (let i = 0; i < 5000; i++) body[`junk_${i}`] = { armour: 1 };
    expect(seatTiersField(body)).toEqual({ mbt_lavi: { armour: 1 } });
    const all = Object.fromEntries(Object.entries(KIT_TRACKS).map(([id, t]) => [id, { ...t }]));
    expect(Object.keys(seatTiersField(all))).toHaveLength(Object.keys(KIT_TRACKS).length);
  });
});

describe("seatSpecialsField: a seat's Store-special claim, cleaned against the shipped table (GH-1102)", () => {
  it('keeps a shipped special, once, in the table order; refuses a forged id, a non-store unit, a prototype key and a non-string', () => {
    const body = JSON.parse('["mbt_lavi_camo","no_such_unit","__proto__","constructor","mbt_lavi","sarim_rifles",7,null,{"id":"demo_tzav"},"recon_zikit","mbt_lavi_camo"]') as unknown;
    // Literal: recon_zikit precedes mbt_lavi_camo in `units`, so it comes first whatever the body's order.
    expect(seatSpecialsField(body)).toEqual(['recon_zikit', 'mbt_lavi_camo']);
  });
  it('a forged id alone is the empty claim', () => {
    expect(seatSpecialsField(['mbt_lavi_camo_mk2'])).toEqual([]);
    expect(seatSpecialsField(['MBT_LAVI_CAMO', ' mbt_lavi_camo'])).toEqual([]);
  });
  it('anything that is not an array is the empty claim', () => {
    for (const v of ['mbt_lavi_camo', 1, null, undefined, true, {}, { 0: 'mbt_lavi_camo', length: 1 }]) expect(seatSpecialsField(v), String(v)).toEqual([]);
  });
  it('keeps a refused special: the mint refuses it and the lobby names it, so it is never dropped unseen', () => {
    expect(seatSpecialsField(['spg_cluster', 'veh_ambulance'])).toEqual(['veh_ambulance', 'spg_cluster']);
  });
});
