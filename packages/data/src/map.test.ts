import { describe, expect, it } from 'vitest';
import {
  DECOR,
  PER_TILE_SYMBOLS,
  STRUCTURE_SYMBOLS,
  TERRAIN_LEGEND,
  applyTerrain,
  parseMap,
  type MapJson,
  type TerrainSink,
} from './map';
import structureCatalogue from '../../../data/structures.json';
import { maps } from './index';

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

  it('still decodes exactly nine terrain symbols', () => {
    // If this count moves, a symbol was added and validate_data.mjs's
    // TERRAIN_SYMBOLS must move with it. That used to be the whole guard --
    // a comment asking the next author to remember. tools/src/terrain_symbols.test.ts
    // now checks the validator's actual source, so forgetting fails a test.
    expect(Object.keys(TERRAIN_LEGEND).sort()).toEqual([
      '.', '1', '2', '3', '^', 'b', 'n', 'o', 'r',
    ]);
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

// Rock is the first blocked tile in the game that is not a building, which is
// the entire point: a ridge built from concrete would be destructible,
// garrisonable and ROE-scored, and a mountain is none of those. losRay already
// returns -1 for a structureless blocked tile, so the mechanic needs no sim
// code -- only a way to author it.
describe('rock ridge', () => {
  const RIDGE: MapJson = {
    id: 'ridge',
    name: 'Ridge',
    width: 4,
    height: 3,
    rows: ['.^^.', '..^.', '....'],
  };

  it('is impassable, carries no cover, and draws as ridge decor', () => {
    const m = parseMap(RIDGE);
    expect(Array.from(m.blocked.slice(0, 4))).toEqual([0, 1, 1, 0]);
    expect(Array.from(m.cover.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(m.decor.slice(0, 4))).toEqual([
      DECOR.none,
      DECOR.ridge,
      DECOR.ridge,
      DECOR.none,
    ]);
  });

  it('produces no structure, so it has no HP, no garrison and no ROE penalty', () => {
    // The whole reason rock is terrain rather than a building.
    expect(parseMap(RIDGE).structures).toEqual([]);
  });

  it('is not claimed by any building symbol', () => {
    expect(STRUCTURE_SYMBOLS['^']).toBeUndefined();
  });
});

// The map's mechanical layer reaching the sim. This used to be a loop written
// out three times -- main.ts, walk_world.ts and playtest.ts -- none of which
// consumed `blocked` at all. The sink is structurally typed so @lions/data
// imports nothing and stays a leaf; Sim satisfies it without knowing it exists.
// A boulder field: open ground to a rifleman, a wall to anything with wheels
// or tracks. It is ONLY that -- no cover, no sight-blocking, no HP -- so the
// assertions below are as much about what `b` does NOT set as what it does.
describe('the boulder symbol `b`', () => {
  const BOULDERS: MapJson = {
    id: 'boulders',
    name: 'Boulders',
    width: 4,
    height: 2,
    rows: ['.b^2', 'b...'],
  };

  it('blocks vehicles without blocking infantry', () => {
    const m = parseMap(BOULDERS);
    // `blocked` is the infantry mask: the ridge is in it, the boulders are not.
    expect(Array.from(m.blocked)).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
    // `boulder` is the extra the vehicle mask adds on top.
    expect(Array.from(m.boulder)).toEqual([0, 1, 0, 0, 1, 0, 0, 0]);
    expect(m.boulderCount).toBe(2);
  });

  it('carries no cover, so nothing hides behind one', () => {
    const m = parseMap(BOULDERS);
    // Cover 2 at index 3 is the control: a broken cover write would zero that
    // too, and "the boulder has no cover" would pass for the wrong reason.
    expect(m.cover[1]).toBe(0);
    expect(m.cover[4]).toBe(0);
    expect(m.cover[3]).toBe(2);
  });

  it('draws as open ground for now — the boulder mesh is T1-C, not this', () => {
    // Deliberate, and this test is the record of it: giving `b` a decor kind
    // means adding a value to `renderer.ts`'s TERRAIN_DECOR, which is frozen
    // byte-identical to `main`. The mechanical half needs nothing from the
    // decor array -- `ParsedMap.boulder` names the tiles outright. The ridge
    // beside it is the control: decor IS being written, just not for `b`.
    const m = parseMap(BOULDERS);
    expect(m.decor[1]).toBe(DECOR.none);
    expect(m.decor[2]).toBe(DECOR.ridge);
  });

  it('counts zero on every map that has none', () => {
    expect(parseMap(TINY).boulderCount).toBe(0);
    expect(Array.from(parseMap(TINY).boulder).every((v) => v === 0)).toBe(true);
  });
});

describe('applyTerrain', () => {
  interface Call {
    x: number;
    y: number;
    v: number | boolean;
  }

  function sink(): { blocks: Call[]; covers: Call[]; elevs: Call[]; rocks: Call[] } & TerrainSink {
    const blocks: Call[] = [];
    const covers: Call[] = [];
    const elevs: Call[] = [];
    const rocks: Call[] = [];
    return {
      blocks,
      covers,
      elevs,
      rocks,
      setBlocked: (x, y, v) => blocks.push({ x, y, v }),
      setCover: (x, y, v) => covers.push({ x, y, v }),
      setElevation: (x, y, v) => elevs.push({ x, y, v }),
      setBoulder: (x, y, v) => rocks.push({ x, y, v }),
    };
  }

  it('blocks ridge tiles and nothing else on open ground', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'r', name: 'R', width: 3, height: 2, rows: ['.^.', '...'] }), s);
    expect(s.blocks).toEqual([{ x: 1, y: 0, v: true }]);
    expect(s.covers).toEqual([]);
  });

  it('passes cover levels through, including grove and knoll', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'c', name: 'C', width: 4, height: 2, rows: ['.12o', 'n3..'] }), s);
    expect(s.covers).toEqual([
      { x: 1, y: 0, v: 1 },
      { x: 2, y: 0, v: 2 },
      { x: 3, y: 0, v: 1 },
      { x: 0, y: 1, v: 2 },
      { x: 1, y: 1, v: 3 },
    ]);
    expect(s.blocks).toEqual([]);
  });

  it('blocks building tiles too, which is harmless and keeps it idempotent', () => {
    // addStructure sets the same bit in the same array and demolish clears it,
    // so order against the structure loop does not matter.
    const s = sink();
    applyTerrain(parseMap({ id: 'b', name: 'B', width: 3, height: 2, rows: ['.#.', '...'] }), s);
    expect(s.blocks).toEqual([{ x: 1, y: 0, v: true }]);
  });

  it('never unblocks a tile, so it cannot undo a structure', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'o', name: 'O', width: 3, height: 2, rows: ['...', '...'] }), s);
    expect(s.blocks).toEqual([]);
  });

  it('passes elevation through for raised tiles only', () => {
    const s = sink();
    applyTerrain(
      parseMap({ id: 'e', name: 'E', width: 3, height: 2, rows: ['...', '...'],
                 elevation: ['030', '001'] }),
      s
    );
    expect(s.elevs).toEqual([
      { x: 1, y: 0, v: 3 },
      { x: 2, y: 1, v: 1 },
    ]);
  });

  it('says nothing about elevation on a flat map', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'f', name: 'F', width: 3, height: 2, rows: ['...', '...'] }), s);
    expect(s.elevs).toEqual([]);
  });

  it('reports boulder tiles, and never blocks them outright', () => {
    // `b` is the only symbol whose passability differs by domain, so it is
    // the only one that reaches the sink through a channel of its own. It
    // must NOT arrive as setBlocked: that would close it to infantry too,
    // which is the entire thing the symbol exists to avoid.
    const s = sink();
    applyTerrain(parseMap({ id: 'bo', name: 'Bo', width: 3, height: 2, rows: ['.b.', 'b..'] }), s);
    expect(s.rocks).toEqual([
      { x: 1, y: 0, v: true },
      { x: 0, y: 1, v: true },
    ]);
    expect(s.blocks).toEqual([]);
    expect(s.covers).toEqual([]);
  });

  it('says nothing about boulders on a map with none', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'nb', name: 'Nb', width: 3, height: 2, rows: ['.^.', '.1.'] }), s);
    expect(s.rocks).toEqual([]);
  });
});

// Elevation is authored as a parallel character grid, one digit per tile, and
// is ORTHOGONAL to the terrain symbol rather than derived from it. That is what
// makes valleys possible: open ground can sit high or low, and `^` rock is only
// a mountain because the author put it on high ground. Deriving height from the
// symbol would give ridges and nothing else.
//
// The field is `elevation`, not `height`: ParsedMap.height is already the map's
// row count, and applyTerrain destructures it.
describe('elevation', () => {
  const RELIEF: MapJson = {
    id: 'relief',
    name: 'Relief',
    width: 4,
    height: 3,
    rows: ['....', '..^.', '....'],
    elevation: ['0000', '0330', '0110'],
  };

  it('parses one digit per tile, row-major', () => {
    const m = parseMap(RELIEF);
    expect(Array.from(m.elevation)).toEqual([0, 0, 0, 0, 0, 3, 3, 0, 0, 1, 1, 0]);
  });

  // Both halves live in one test on purpose. Uint8Array is zero-initialised,
  // so "all zero when absent" alone passes even with the whole
  // `if (json.elevation !== undefined)` parsing block deleted -- it proves
  // nothing about parsing. Pairing it with the same map WITH a non-zero
  // elevation field, asserted in the same test, means deleting that block
  // breaks this test: the second half can only pass if parsing actually ran.
  // Splitting them back into two tests would silently restore the tautology.
  it('defaults every tile to zero when the field is absent, and parses it when present', () => {
    const base = { id: 'f', name: 'F', width: 4, height: 3, rows: ['....', '....', '....'] };
    const flat = parseMap(base);
    expect(Array.from(flat.elevation)).toEqual(new Array(12).fill(0));

    const raised = parseMap({ ...base, elevation: ['0000', '0520', '0000'] });
    expect(Array.from(raised.elevation)).toEqual([0, 0, 0, 0, 0, 5, 2, 0, 0, 0, 0, 0]);
  });

  it('is independent of the terrain symbol', () => {
    // Rock at height 0 and open ground at height 3 both parse. Odd-looking, and
    // the author's business -- the same way a mosque in a field is.
    const m = parseMap({ ...RELIEF, elevation: ['0033', '0000', '0000'] });
    expect(m.elevation[2]).toBe(3);
    expect(m.elevation[6]).toBe(0); // the `^` tile
    expect(m.blocked[6]).toBe(1); // still blocked, height changes nothing
  });

  it('rejects a row count that does not match the map', () => {
    expect(() => parseMap({ ...RELIEF, elevation: ['0000', '0330'] })).toThrow(
      /elevation has 2 rows, declared height 3/
    );
  });

  it('rejects a row whose width does not match', () => {
    expect(() => parseMap({ ...RELIEF, elevation: ['0000', '033', '0110'] })).toThrow(
      /elevation row 1 has 3 tiles, declared width 4/
    );
  });

  it('rejects a non-digit', () => {
    expect(() => parseMap({ ...RELIEF, elevation: ['0000', '0x30', '0110'] })).toThrow(
      /unknown elevation "x" at \(1,1\)/
    );
  });
});

describe('tel_marum, the first shipped map with relief', () => {
  const map = parseMap(maps.tel_marum as MapJson);

  it('parses at its declared size with an elevation grid', () => {
    expect(map.width).toBe(48);
    expect(map.height).toBe(48);
    expect(map.elevation).toHaveLength(48 * 48);
  });

  it('puts the valley floor at 0 and the ridge line above it', () => {
    const at = (x: number, y: number): number => map.elevation[y * 48 + x];
    expect(at(24, 44)).toBe(0); // start line
    expect(at(24, 29)).toBe(0); // the hollow
    expect(at(24, 26)).toBe(2); // the lip — two levels, deliberately
    expect(at(24, 14)).toBe(2); // wide saddle
    expect(at(10, 14)).toBe(3); // narrow saddle
    expect(at(28, 16)).toBe(3); // east shoulder
    expect(at(8, 14)).toBe(4);  // ridge line
  });

  it('leaves both saddles passable and the ridge between them not', () => {
    const blocked = (x: number, y: number): number => map.blocked[y * 48 + x];
    expect(blocked(24, 14)).toBe(0); // wide saddle
    expect(blocked(10, 14)).toBe(0); // narrow saddle
    expect(blocked(16, 14)).toBe(1); // ridge between them
    expect(blocked(35, 14)).toBe(1); // ridge east of the wide saddle
  });

  it('places every marker on ground a unit can stand on', () => {
    // A marker on a blocked tile cannot spawn a unit and cannot be walked to.
    // The battery position in particular sits NEXT TO the town buildings, not
    // on them.
    for (const [name, [x, y]] of Object.entries(maps.tel_marum.markers)) {
      expect(`${name}:${map.blocked[y * 48 + x]}`).toBe(`${name}:0`);
    }
  });
});
