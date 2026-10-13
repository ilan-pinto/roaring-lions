import { describe, expect, it } from 'vitest';
import { maps } from '@lions/data';
import { SHIPPED_MAP_IDS, isShippedMap } from './map-ids';

describe('#559 F5: the shipped map ids', () => {
  it('are exactly @lions/data\'s maps', () => {
    const fromData = Object.keys(maps).sort();
    expect([...SHIPPED_MAP_IDS].sort(), `paste into map-ids.ts:\n${JSON.stringify(fromData)}`).toEqual(fromData);
  });
  it('a prototype key or an unknown name is no map', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope', '']) expect(isShippedMap(id), id).toBe(false);
    expect(isShippedMap('tel_marum')).toBe(true);
  });
});
