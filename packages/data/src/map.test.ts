import { describe, expect, it } from 'vitest';
import {
  DECOR,
  PER_TILE_SYMBOLS,
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

  it('defaults the terrain theme to arid', () => {
    expect(parseMap(TINY).terrain).toBe('arid');
  });

  it('carries a declared green terrain theme', () => {
    expect(parseMap({ ...TINY, terrain: 'green' }).terrain).toBe('green');
  });

  it('throws on an unknown terrain theme', () => {
    expect(() => parseMap({ ...TINY, terrain: 'lunar' })).toThrow(/unknown terrain theme/);
  });

  it('still decodes exactly seven terrain symbols', () => {
    // The green basin is a look, not new mechanics. If this count moves, a
    // symbol was added and validate_data.mjs's TERRAIN_SYMBOLS must move with it.
    expect(Object.keys(TERRAIN_LEGEND).sort()).toEqual(['.', '1', '2', '3', 'n', 'o', 'r']);
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

describe('tunnels', () => {
  const WITH_TUNNEL = {
    ...TINY,
    tunnels: [
      { id: 'tn_a', mouth: [0, 0], waypoints: [[1, 1]], vent: [2, 2], dig_tiles_per_s: 0.2 },
    ],
  };

  it('flattens mouth, waypoints and vent into one polyline', () => {
    const m = parseMap(WITH_TUNNEL);
    expect(m.tunnels).toHaveLength(1);
    expect(m.tunnels[0].id).toBe('tn_a');
    expect(m.tunnels[0].points).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(m.tunnels[0].digTilesPerS).toBe(0.2);
  });

  it('defaults to no tunnels', () => {
    expect(parseMap(TINY).tunnels).toEqual([]);
  });

  it('allows a route with no waypoints', () => {
    const m = parseMap({ ...TINY, tunnels: [{ id: 'tn_b', mouth: [0, 0], vent: [2, 2] }] });
    expect(m.tunnels[0].points).toEqual([[0, 0], [2, 2]]);
  });

  it('carries pre_dug through as preDug', () => {
    const m = parseMap({
      ...TINY,
      tunnels: [{ id: 'tn_c', mouth: [0, 0], vent: [2, 2], pre_dug: true }],
    });
    expect(m.tunnels[0].preDug).toBe(true);
  });

  it('defaults preDug to false when the author says nothing', () => {
    expect(parseMap(WITH_TUNNEL).tunnels[0].preDug).toBe(false);
  });

  it('rejects an out-of-bounds point, naming which one', () => {
    expect(() =>
      parseMap({ ...TINY, tunnels: [{ id: 'tn_c', mouth: [0, 0], vent: [99, 0] }] })
    ).toThrow(/tn_c/);
  });

  it('rejects a duplicate route id', () => {
    const dup = { id: 'tn_a', mouth: [0, 0], vent: [1, 1] };
    expect(() => parseMap({ ...TINY, tunnels: [dup, dup] })).toThrow(/tn_a/);
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

describe('structure grouping', () => {
  // Symbols chosen by behaviour from the catalogue rather than spelled out, so
  // this suite follows a retyped building instead of quietly testing nothing.
  const byKind = (wantPerTile: boolean): { id: string; symbol: string } => {
    for (const [id, spec] of Object.entries(structures)) {
      const s = spec as { symbol: string; per_tile?: boolean };
      if ((s.per_tile === true) === wantPerTile) return { id, symbol: s.symbol };
    }
    throw new Error(`the catalogue has no ${wantPerTile ? 'per-tile' : 'grouped'} type to test`);
  };
  const grouped = byKind(false);
  const perTile = byKind(true);
  const G = grouped.symbol;
  const W = perTile.symbol;

  it('derives PER_TILE_SYMBOLS from the catalogue rather than hardcoding it', () => {
    for (const [, spec] of Object.entries(structures)) {
      const s = spec as { symbol: string; per_tile?: boolean };
      expect(PER_TILE_SYMBOLS.has(s.symbol)).toBe(s.per_tile === true);
    }
  });

  it('flood-fills a compact building into one structure', () => {
    const m = parseMap({
      id: 'g',
      name: 'G',
      width: 4,
      height: 3,
      rows: [`.${G}${G}.`, `.${G}${G}.`, '....'],
    });
    expect(m.structures).toHaveLength(1);
    expect(m.structures[0].tiles).toEqual([1, 2, 5, 6]);
  });

  it('splits a per-tile run into one structure per tile', () => {
    // The whole point. Flood-filled, this row is a single object whose four
    // tiles unblock together, so breaching one panel opens the entire wall.
    // Split, a breach is the one-tile hole it should be.
    const m = parseMap({
      id: 'w',
      name: 'W',
      width: 6,
      height: 1,
      rows: [`.${W}${W}${W}${W}.`],
    });
    expect(m.structures).toHaveLength(4);
    for (const s of m.structures) expect(s.tiles).toHaveLength(1);
    expect(m.structures.map((s) => s.tiles[0])).toEqual([1, 2, 3, 4]);
  });

  it('splits a per-tile corner, where a flood fill would join the two arms', () => {
    const m = parseMap({
      id: 'l',
      name: 'L',
      width: 3,
      height: 3,
      rows: [`${W}${W}${W}`, `${W}..`, `${W}..`],
    });
    expect(m.structures).toHaveLength(5);
    for (const s of m.structures) expect(s.tiles).toHaveLength(1);
  });

  it('keeps the two kinds separate on one map', () => {
    const m = parseMap({
      id: 'mix',
      name: 'Mix',
      width: 4,
      height: 2,
      rows: [`${G}${G}${W}${W}`, `${G}${G}..`],
    });
    const byType: Record<string, number> = {};
    for (const s of m.structures) byType[s.type] = (byType[s.type] ?? 0) + 1;
    expect(byType[grouped.id]).toBe(1);
    expect(byType[perTile.id]).toBe(2);
  });
});
