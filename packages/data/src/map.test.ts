import { describe, expect, it } from 'vitest';
import {
  DECOR,
  STRUCTURE_SYMBOLS,
  TERRAIN_LEGEND,
  parseMap,
  type MapJson,
} from './map';
import structureCatalogue from '../../../data/structures.json';

const structures = structureCatalogue.types;

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

describe('terrain symbols and the decor layer', () => {
  const TERRAIN: MapJson = {
    id: 'terrain',
    name: 'Terrain',
    width: 4,
    height: 3,
    rows: ['.ron', '123.', 'rrrr'],
  };

  it('decodes road, grove and knoll into cover and decor', () => {
    const m = parseMap(TERRAIN);
    // Road carries no cover; grove is light; knoll is heavy. They reuse the
    // existing levels on purpose, so the sim sees what it always saw.
    expect(Array.from(m.cover.slice(0, 4))).toEqual([0, 0, 1, 2]);
    expect(Array.from(m.decor.slice(0, 4))).toEqual([
      DECOR.none,
      DECOR.road,
      DECOR.grove,
      DECOR.knoll,
    ]);
  });

  it('leaves none of them blocked, so pathing gains no obstruction', () => {
    const m = parseMap(TERRAIN);
    expect(Array.from(m.blocked)).toEqual(new Array(12).fill(0));
  });

  it('gives plain cover tiles no decor, so 1/2/3 still draw as rubble', () => {
    const m = parseMap(TERRAIN);
    expect(Array.from(m.cover.slice(4, 8))).toEqual([1, 2, 3, 0]);
    expect(Array.from(m.decor.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it('still rejects an unknown symbol', () => {
    expect(() => parseMap({ ...TERRAIN, rows: ['.roZ', '123.', 'rrrr'] })).toThrow(
      /unknown symbol "Z" at \(3,0\)/
    );
  });
});

describe('STRUCTURE_SYMBOLS', () => {
  it('is derived from the catalogue, not hardcoded', () => {
    // The catalogue is the single source of truth: adding a building type must be
    // JSON only. If this drifts, adding a type silently needs an engine edit again.
    for (const [id, spec] of Object.entries(structures)) {
      expect(STRUCTURE_SYMBOLS[(spec as { symbol: string }).symbol]).toBe(id);
    }
    expect(Object.keys(STRUCTURE_SYMBOLS).length).toBe(Object.keys(structures).length);
  });

  it('does not collide with any terrain symbol', () => {
    for (const sym of Object.keys(STRUCTURE_SYMBOLS)) {
      expect(TERRAIN_LEGEND[sym]).toBeUndefined();
    }
  });

  it('makes every structure symbol blocked and decor-free', () => {
    const sym = Object.keys(STRUCTURE_SYMBOLS)[0];
    const m = parseMap({ id: 'b', name: 'B', width: 2, height: 2, rows: [`${sym}.`, '..'] });
    expect(m.blocked[0]).toBe(1);
    expect(m.decor[0]).toBe(DECOR.none);
  });
});
