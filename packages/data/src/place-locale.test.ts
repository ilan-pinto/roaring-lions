// applyMapNamesLocale / applyWorldLocale: the place-name locale overlay (GH-1406). See index.ts's header on this section.
import { describe, expect, it } from 'vitest';
import { applyMapNamesLocale, applyWorldLocale, mapManifest, type PlaceLocaleOverlay, type PlaceNamedWorld } from './index';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const world = {
  id: 'w',
  name: 'The Basin',
  regions: [
    { id: 'north', name: 'The North', faction: 'F', towns: [{ id: 'a', name: 'Alpha', at: [1, 2], missions: ['m1'] }, { id: 'b', name: 'Beta', at: [3, 4], missions: [] }] },
    { id: 'south', name: 'The South', faction: 'G', towns: [{ id: 'c', name: 'Gamma', at: [5, 6], missions: ['m2'] }] },
  ],
};

describe('applyMapNamesLocale', () => {
  const cat = { one: { name: 'One' }, two: { name: 'Two' } };
  it('returns the SAME object for no overlay, an overlay without maps, and one naming none of these maps', () => {
    expect(applyMapNamesLocale(cat, null)).toBe(cat);
    expect(applyMapNamesLocale(cat, {})).toBe(cat);
    expect(applyMapNamesLocale(cat, { maps: { other: 'X' } })).toBe(cat);
  });
  it('renames only the named maps on a copy, keeps the key order, and never writes into the source', () => {
    const before = clone(cat);
    const out = applyMapNamesLocale(cat, { maps: { two: 'Deux' } });
    expect(out).not.toBe(cat);
    expect(Object.keys(out)).toEqual(['one', 'two']);
    expect(out).toEqual({ one: { name: 'One' }, two: { name: 'Deux' } });
    expect(out.one).toBe(cat.one); // an untouched entry is shared, not copied
    expect(cat).toEqual(before);
  });
  it('reads an own key only: a map id that is a prototype name does not match', () => {
    expect(applyMapNamesLocale(cat, { maps: JSON.parse('{"constructor":"X","toString":"Y"}') })).toBe(cat);
  });
  it('works over the real manifest without mutating it', () => {
    const id = Object.keys(mapManifest)[0];
    const before = JSON.stringify(mapManifest);
    const out = applyMapNamesLocale(mapManifest, { maps: { [id]: 'NOM' } });
    expect((out as Record<string, { name: string }>)[id].name).toBe('NOM');
    expect(JSON.stringify(mapManifest)).toBe(before);
  });
});

describe('applyWorldLocale', () => {
  const overlay: PlaceLocaleOverlay = { world: 'Le Bassin', regions: { south: 'Le Sud' }, towns: { b: 'Bêta' } };
  it('returns the SAME object for a null overlay, an empty one, and one that renames nothing here', () => {
    expect(applyWorldLocale(world, null)).toBe(world);
    expect(applyWorldLocale(world, {})).toBe(world);
    expect(applyWorldLocale(world, { regions: { nowhere: 'X' }, towns: { zzz: 'Y' }, maps: { m: 'Z' } })).toBe(world);
    expect(applyWorldLocale(world, { world: world.name, regions: { north: 'The North' }, towns: { a: 'Alpha' } })).toBe(world);
  });
  it('renames the world, a region and a town on a copy, carrying every other field, and shares what it did not touch', () => {
    const before = clone(world);
    const out = applyWorldLocale(world, overlay);
    expect(out.name).toBe('Le Bassin');
    expect(out.regions.map((r) => r.name)).toEqual(['The North', 'Le Sud']);
    expect(out.regions[0].towns.map((x) => x.name)).toEqual(['Alpha', 'Bêta']);
    expect(out.regions[1].towns.map((x) => x.name)).toEqual(['Gamma']);
    expect(out.regions[0].towns[1]).toMatchObject({ id: 'b', at: [3, 4], missions: [] });
    expect(out.regions[0]).toMatchObject({ id: 'north', faction: 'F' });
    expect(out).toMatchObject({ id: 'w' });
    expect(out.regions[0].towns[0]).toBe(world.regions[0].towns[0]);
    expect(out.regions[1].towns).toBe(world.regions[1].towns);
    expect(world).toEqual(before); // the source is untouched, deep
  });
  it('renames each level on its own', () => {
    expect(applyWorldLocale(world, { world: 'W' }).name).toBe('W');
    expect(applyWorldLocale(world, { regions: { north: 'N' } }).regions[0].name).toBe('N');
    expect(applyWorldLocale(world, { towns: { c: 'G' } }).regions[1].towns[0].name).toBe('G');
  });
  it('is generic over the world it is given', () => {
    const named: PlaceNamedWorld = { name: 'x', regions: [] };
    expect(applyWorldLocale(named, { world: 'y' })).toEqual({ name: 'y', regions: [] });
  });
});
