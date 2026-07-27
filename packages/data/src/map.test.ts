import { describe, expect, it } from 'vitest';
import { parseMap, type MapJson } from './map';

const TINY: MapJson = {
  id: 'tiny',
  name: 'Tiny',
  width: 4,
  height: 3,
  rows: ['..1#', '.23#', '....'],
  markers: { entry: [0, 2] },
  zones: { yard: [1, 0, 2, 2] },
};

describe('parseMap', () => {
  it('decodes the legend into blocked and cover grids', () => {
    const m = parseMap(TINY);
    expect(m.width).toBe(4);
    expect(m.height).toBe(3);
    // row 0: . . 1 #
    expect(Array.from(m.cover.slice(0, 4))).toEqual([0, 0, 1, 0]);
    expect(Array.from(m.blocked.slice(0, 4))).toEqual([0, 0, 0, 1]);
    // row 1: . 2 3 #
    expect(Array.from(m.cover.slice(4, 8))).toEqual([0, 2, 3, 0]);
    expect(Array.from(m.blocked.slice(4, 8))).toEqual([0, 0, 0, 1]);
    // row 2: open
    expect(Array.from(m.blocked.slice(8, 12))).toEqual([0, 0, 0, 0]);
  });

  it('passes markers and zones through', () => {
    const m = parseMap(TINY);
    expect(m.markers.entry).toEqual([0, 2]);
    expect(m.zones.yard).toEqual([1, 0, 2, 2]);
  });

  it('rejects dimension mismatches and unknown symbols', () => {
    expect(() => parseMap({ ...TINY, rows: ['..1#', '.23#'] })).toThrow(/height/);
    expect(() => parseMap({ ...TINY, rows: ['..1#', '.23', '....'] })).toThrow(/width/);
    expect(() => parseMap({ ...TINY, rows: ['..1#', '.2X#', '....'] })).toThrow(/symbol/);
  });

  it('rejects out-of-bounds markers and zones', () => {
    expect(() => parseMap({ ...TINY, markers: { bad: [4, 0] } })).toThrow(/marker/);
    expect(() => parseMap({ ...TINY, zones: { bad: [3, 2, 2, 2] } })).toThrow(/zone/);
  });
});
