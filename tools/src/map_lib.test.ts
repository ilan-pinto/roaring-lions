// The large-map library (GH-920 B1), tools/maps/lib/. Every oracle here is a LITERAL worked out by hand
// from the rule it holds the code to, never an expression the code under test also computes
// (CLAUDE.md, "oracles take literals"). tools/src/map_lib_mutations.test.ts then breaks each helper
// one line at a time and watches Rujm Sawda's `--check` go red, which is the witness that the library
// still writes the map it was lifted from.
import { describe, expect, it } from 'vitest';
import { halfTurn, halfTurnOf, hash, serialise, sortedByKey } from '../maps/lib/common.mjs';
import { farmAt, ringTiles, scatterPatches, shelfSteps, stampChain } from '../maps/lib/shapes.mjs';
import {
  anchorOf,
  barrierChain,
  bboxOf,
  chainPath,
  components,
  interpElevation,
  isSimplePoint,
  placeShape,
  rescaleRect,
  roadChain,
  straightenStairs,
  thinSimple,
  topHalfMarkers,
  topHalfRects,
} from '../maps/lib/upscale.mjs';
import { fatStairs } from './relief_census';

const grid = (rows: string[]) => rows.map((r) => [...r]);
const show = (g: string[][]) => g.map((r) => r.join(''));

describe('common.mjs', () => {
  it('hash is a function of tile and salt, with these values (the scatter of every map hangs on them)', () => {
    // Literals from `git show f4f908c63:tools/maps/rujm_sawda/build.mjs`'s own `hash`, run before this library
    // existed; a change here changes where Rujm Sawda's scrub grows.
    expect(hash(3, 4, 5)).not.toBe(hash(4, 3, 5));
    expect(hash(3, 4, 5)).not.toBe(hash(3, 4, 6));
    expect([hash(0, 0, 0), hash(12, 7, 5), hash(79, 79, 9)]).toEqual([3228466526, 186973432, 2038805497]);
  });

  it('halfTurnOf maps a tile to size - 1 - x and a rectangle to size - x - w', () => {
    const { mirror, mirrorRect } = halfTurnOf(48);
    expect(mirror([10, 10])).toEqual([37, 37]);
    expect(mirror([0, 47])).toEqual([47, 0]);
    expect(mirrorRect([5, 1, 10, 19])).toEqual([33, 28, 10, 19]); // Wadi Tarfan's camp_0 -> camp_1
    expect(halfTurnOf(96).mirror([20, 20])).toEqual([75, 75]);
  });

  it('halfTurn writes the bottom half as the image of the top, symbols and levels', () => {
    const t = grid(['ab..', 'cd..', '....', '....']);
    const el = [[1, 2, 0, 0], [3, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    halfTurn(t, el, 4);
    expect(show(t)).toEqual(['ab..', 'cd..', '..dc', '..ba']);
    expect(el.map((r) => r.join(''))).toEqual(['1200', '3400', '0043', '0021']);
  });

  it('serialise keeps number arrays on one line, nested arrays and objects expanded, and ends in a newline', () => {
    expect(serialise({ a: [1, 2], b: [[1, 2], [3, 4]], c: {} })).toBe(
      '{\n  "a": [1, 2],\n  "b": [\n    [1, 2],\n    [3, 4]\n  ],\n  "c": {}\n}\n',
    );
    expect(Object.keys(sortedByKey({ b: 1, a: 2, c: 3 }))).toEqual(['a', 'b', 'c']);
  });
});

describe('shapes.mjs', () => {
  it('farmAt draws a one-tile wall on an 8x8 box with its gates open and a 2x2 house', () => {
    const t = Array.from({ length: 10 }, () => Array<string>(10).fill(' '));
    farmAt(t, 1, 1, [4, 4], [[1, 3], [2, 1]]);
    expect(show(t).slice(1, 9).map((r) => r.slice(1, 9))).toEqual([
      '=.======',
      '=......=',
      '.......=',
      '=..hh..=',
      '=..hh..=',
      '=......=',
      '=......=',
      '========',
    ]);
  });

  it('ringTiles is the edge of the rectangle, once each', () => {
    expect(ringTiles(2, 3, 3, 3)).toEqual([[2, 3], [3, 3], [4, 3], [2, 4], [4, 4], [2, 5], [3, 5], [4, 5]]);
    expect(ringTiles(0, 0, 5, 4)).toHaveLength(14);
  });

  it('stampChain stamps allowed ground and throws on anything else, naming the tile', () => {
    const t = grid(['..1', '.=.']);
    stampChain(t, [[0, 0], [1, 0], [2, 0]], 'r', '.1');
    expect(show(t)).toEqual(['rrr', '.=.']);
    expect(() => stampChain(t, [[1, 1]], 'r', '.1')).toThrow('road tile 1,1 lands on =');
  });

  it('shelfSteps steps one tile a level by x + y and skips the named symbols', () => {
    const t = grid(['....', '.n..', '....', '....']);
    const el = Array.from({ length: 4 }, () => Array(4).fill(0));
    shelfSteps(t, el, 4, 4, { reach: 4, bands: [[1, 3], [3, 2]], rest: 1, skip: 'n' });
    // x + y: 0,1 -> 3; 2,3 -> 2; 4 -> 1 (the rest, still inside the reach); beyond it untouched (0); the knoll untouched
    expect(el.map((r) => r.join(''))).toEqual(['3322', '3021', '2210', '2100']);
  });

  it('scatterPatches offers every even-hash tile of the disc and the centre as its own symbol', () => {
    const seen: string[] = [];
    scatterPatches((x: number, y: number, c: string) => seen.push(`${x},${y}${c}`), () => 0, [[5, 5]], { radius: 1, salt: 0, rows: 10, symbol: '1', centreSymbol: '2' });
    // hash 0 is even everywhere; the disc of radius 1 is the centre and its four neighbours, in raster order
    expect(seen).toEqual(['5,41', '4,51', '5,52', '6,51', '5,61']);
    const none: string[] = [];
    scatterPatches((x: number, y: number) => none.push(`${x},${y}`), () => 1, [[5, 5]], { radius: 1, salt: 0, rows: 10, symbol: '1', centreSymbol: '2' });
    expect(none).toEqual([]);
  });
});

describe('upscale.mjs: the 9/3/3/1 elevation rule', () => {
  it('a diagonal cell contour upsamples to the SAME 2x2 staircase the nearest copy makes (the design claimed one tile a step)', () => {
    // 4x4 cells, level 1 on and above the anti-diagonal: x + y >= 3
    const cells = [
      [0, 0, 0, 1],
      [0, 0, 1, 1],
      [0, 1, 1, 1],
      [1, 1, 1, 1],
    ];
    // Worked by hand for the corner tiles of cell (1, 1) = 0, whose right, lower and diagonal neighbours are 1:
    //   (2,2) far cells (0,0,0): 0/16;  (3,2) and (2,3): 3/16;  (3,3): (3 + 3 + 1)/16 = 7/16 -> rounds to 0.
    // Cell (2,1) = 1 weighs 9/16 at its own near corner (4,2): 9/16 -> 1. Every tile stays on its cell's side
    // of 1/2, so the 2x2 blocks survive whole: rows come in identical pairs.
    expect(interpElevation(cells).map((r: number[]) => r.join(''))).toEqual([
      '00000011',
      '00000011',
      '00001111',
      '00001111',
      '00111111',
      '00111111',
      '11111111',
      '11111111',
    ]);
    // ...which is four 2-tall steps two columns apart (columns 6, 4, 2, 0), so two windows of three: the
    // construction that scallops under Catmull-Rom.
    const flat = Uint8Array.from(interpElevation(cells).flat());
    expect(fatStairs(flat, 8, 8).count).toBe(2);
  });

  it('straightenStairs turns that staircase into one tile a step, and leaves the two coarse steps at its tail', () => {
    const cells = [
      [0, 0, 0, 1],
      [0, 0, 1, 1],
      [0, 1, 1, 1],
      [1, 1, 1, 1],
    ];
    // The first column holding a 1 in each row, top to bottom: 6, 5, 4, 3, 2, then the tail 2, 0, 0.
    // Hand-worked: windows start at rows 0 and 2 (steps at columns 6, 4, 2 and 4, 2, 0); each moves the
    // first step's second row one column on, so row 1 gains column 5 and row 3 gains column 3.
    expect(straightenStairs(interpElevation(cells)).map((r: number[]) => r.join(''))).toEqual([
      '00000011',
      '00000111',
      '00001111',
      '00011111',
      '00111111',
      '00111111',
      '11111111',
      '11111111',
    ]);
  });

  it('a long diagonal is one tile a step all the way but its last two steps; and straightening is idempotent', () => {
    const cells = [...Array(8).keys()].map((y) => [...Array(8).keys()].map((x) => (x + y >= 7 ? 1 : 0)));
    const once = straightenStairs(interpElevation(cells));
    const firstOne = once.map((r: number[]) => r.indexOf(1));
    expect(firstOne).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 0, 0]);
    expect(fatStairs(Uint8Array.from(once.flat()), 16, 16).count).toBe(0);
    expect(straightenStairs(once)).toEqual(once);
  });

  it('a relief with no staircase is returned unchanged, and the levels stay nested', () => {
    const line = [...Array(8).keys()].map((y) => [...Array(8).keys()].map((x) => (x + y >= 7 ? 1 : 0)));
    expect(straightenStairs(line)).toEqual(line);
    const two = [...Array(16).keys()].map((y) => [...Array(16).keys()].map((x) => (x + y >= 14 ? 2 : x + y >= 8 ? 1 : 0)));
    const stairs = interpElevation([...Array(8).keys()].map((y) => [...Array(8).keys()].map((x) => (x + y >= 7 ? 2 : x + y >= 4 ? 1 : 0))));
    const out = straightenStairs(stairs);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(out[y][x]).toBeLessThanOrEqual(2);
    expect(fatStairs(Uint8Array.from(out.flat()), 16, 16).count).toBe(0);
    expect(two[0][0]).toBe(0);
  });

  it('a uniform field stays uniform, and the edge cells replicate', () => {
    expect(interpElevation([[3, 3], [3, 3]]).flat().every((v: number) => v === 3)).toBe(true);
    const t = interpElevation([[0, 8]]);
    expect(t[0]).toEqual([0, 2, 6, 8]);
    expect(t).toHaveLength(2);
  });

  it('a point-symmetric field upsamples point-symmetric (the twin of tile x is 2n - 1 - x)', () => {
    const cells = [
      [3, 2, 1],
      [2, 1, 0],
      [1, 0, 0],
    ].map((r, y, a) => r.map((_, x) => Math.max(a[y][x], a[2 - y][2 - x]))); // symmetrise
    const tiles = interpElevation(cells);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) expect(tiles[y][x]).toBe(tiles[5 - y][5 - x]);
  });
});

describe('upscale.mjs: one-tile chains', () => {
  it('anchorOf is the tile of the 2x2 block nearer the centre, and is its own half-turn image', () => {
    expect([0, 1, 22, 23].map((c) => anchorOf(c, 48))).toEqual([1, 3, 45, 47]);
    expect([24, 25, 46, 47].map((c) => anchorOf(c, 48))).toEqual([48, 50, 92, 94]);
    for (let c = 0; c < 48; c++) expect(anchorOf(47 - c, 48)).toBe(95 - anchorOf(c, 48));
  });

  it('chainPath is one tile a step, diagonal first, both ends included', () => {
    expect(chainPath([0, 0], [2, 2])).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(chainPath([0, 0], [2, 0])).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(chainPath([0, 0], [2, 1])).toEqual([[0, 0], [1, 1], [2, 1]]);
    expect(chainPath([3, 3], [3, 3])).toEqual([[3, 3]]);
  });

  it('a diagonal road of cells is a corner-touching chain, with no tile beside another orthogonally', () => {
    const tiles = roadChain([[2, 2], [3, 3], [4, 4]], 48, { diag: true }).map(([x, y]) => `${x},${y}`).sort();
    // anchors 5,7,9; the tile between each pair is the diagonal one
    expect(tiles).toEqual(['5,5', '6,6', '7,7', '8,8', '9,9']);
  });

  it('an L of cells is one right angle; a cell beside a diagonal pair suppresses the diagonal edge', () => {
    const l = roadChain([[2, 2], [3, 2], [3, 3]], 48, { diag: true }).map(([x, y]) => `${x},${y}`).sort();
    expect(l).toEqual(['5,5', '6,5', '7,5', '7,6', '7,7']);
    // without the suppression the third edge (2,2)-(3,3) would add the diagonal tile 6,6 and close a 2x2 block with 6,5 / 7,6 / 7,5
    expect(l).not.toContain('6,6');
  });

  it('walls (diag: false) leave a diagonal pair of cells apart and join an orthogonal pair', () => {
    expect(roadChain([[2, 2], [3, 3]], 48, { diag: false })).toHaveLength(2);
    expect(roadChain([[2, 2], [3, 2]], 48, { diag: false })).toHaveLength(3);
  });

  it('a road that crosses the centre line stays joined (cells 23 and 24 are tiles 47 and 48)', () => {
    const tiles = roadChain([[23, 23], [24, 24]], 48, { diag: true }).map(([x, y]) => `${x},${y}`).sort();
    expect(tiles).toEqual(['47,47', '48,48']);
  });
});

describe('upscale.mjs: thinning', () => {
  const run = (pic: string[], fixedSym = '#') => {
    const h = pic.length;
    const w = pic[0].length;
    const mask = new Uint8Array(w * h);
    const fixed = new Uint8Array(w * h);
    pic.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === 'd') mask[y * w + x] = 1;
      if (c === fixedSym) fixed[y * w + x] = 1;
    }));
    const out = thinSimple(mask, w, h, fixed);
    return pic.map((r, y) => [...r].map((c, x) => (c === fixedSym ? c : out[y * w + x] ? 'd' : '.')).join(''));
  };

  it('a four-wide band thins to a line one tile wide down its middle', () => {
    const band = ['..dddd..', '..dddd..', '..dddd..', '..dddd..', '..dddd..', '..dddd..'];
    const out = run(band);
    // two tiles per row at most is 'one tile wide' only if the line is not 2x2 thick: no 2x2 block of d remains
    for (let y = 0; y + 1 < 6; y++) for (let x = 0; x + 1 < 8; x++) {
      expect(out[y][x] === 'd' && out[y][x + 1] === 'd' && out[y + 1][x] === 'd' && out[y + 1][x + 1] === 'd').toBe(false);
    }
    expect(out.join('').split('d').length - 1).toBeLessThanOrEqual(8);
    expect(out[3].indexOf('d')).toBeGreaterThanOrEqual(3);
    expect(out[3].indexOf('d')).toBeLessThanOrEqual(4);
  });

  it('keeps a hole: a ring of d around one open tile thins to the diamond that still encloses it', () => {
    // the four corners are redundant (the diamond is 8-connected, and no 4-connected path leaves it); the
    // four tiles that touch the hole stay, because deleting one opens the hole to the plain
    const ring = ['.......', '..ddd..', '..d.d..', '..ddd..', '.......'];
    expect(run(ring)).toEqual(['.......', '...d...', '..d.d..', '...d...', '.......']);
  });

  it('keeps two parts joined only through the fixed tiles joined', () => {
    const pic = ['..d..', '..d..', '.###.', '..d..', '..d..'];
    expect(run(pic)).toEqual(pic);
  });

  it('a one-tile line is left alone, end tiles included; a tile in `keep` is never deleted', () => {
    expect(run(['.....', '.ddd.', '.....'])).toEqual(['.....', '.ddd.', '.....']);
    const band = ['......', '.dddd.', '.dddd.', '.dddd.', '......'];
    const w = 6;
    const mask = new Uint8Array(w * 5);
    band.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'd') mask[y * w + x] = 1; }));
    const keep = new Uint8Array(w * 5);
    keep[1 * w + 1] = 1; // the top-left corner of the band, which an unprotected run deletes
    expect(thinSimple(mask, w, 5, null, null)[1 * w + 1]).toBe(0);
    expect(thinSimple(mask, w, 5, null, keep)[1 * w + 1]).toBe(1);
  });

  it('isSimplePoint: an end, a bridge and a corner of a line, from the ring of its neighbours', () => {
    const fg = (cells: string[]) => (x: number, y: number) => cells.includes(`${x},${y}`);
    expect(isSimplePoint(fg([]), 1, 1)).toBe(false); // alone: deleting it deletes a component
    expect(isSimplePoint(fg(['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2']), 1, 1)).toBe(false); // a hole of one
    expect(isSimplePoint(fg(['1,0', '1,2', '1,1']), 1, 1)).toBe(false); // a bridge between two tiles
    expect(isSimplePoint(fg(['1,1', '2,1', '2,2']), 1, 1)).toBe(true); // the end of a bent line
    expect(isSimplePoint(fg(['0,1', '1,1', '2,1', '1,0', '1,2']), 1, 1)).toBe(false); // the middle of a cross
  });

  it('the edge of the grid counts as foreground: a band from edge to edge stays, a band only along the edge goes', () => {
    // from the top edge to the bottom edge, two tiles wide: it divides the grid, so a line of it stays
    const across = run(['..dd..', '..dd..', '..dd..', '..dd..', '..dd..']);
    expect(across.every((r) => r.includes('d'))).toBe(true);
    expect(across.every((r) => r.split('d').length - 1 <= 1)).toBe(true);
    // a slab along the top edge divides nothing: the border seals it already, so it is all redundant
    expect(run(['dddddd', 'dddddd', '......', '......']).join('')).not.toContain('d');
  });

  it('barrierChain joins a ditch cell to the rock it touches: the tile of its block that faces the rock', () => {
    // a ditch cell (3,2) with rock at (2,2) on its left, on a 48-cell sketch: anchor (7,5), the facing edge is x = 6
    const tiles = barrierChain([[3, 2]], [[2, 2]], 48).map(([x, y]) => `${x},${y}`).sort();
    expect(tiles).toEqual(['6,5', '7,5']);
    // a diagonal touch (rock at (2,1)) is joined at the corner tile of the block
    const diag = barrierChain([[3, 2]], [[2, 1]], 48).map(([x, y]) => `${x},${y}`).sort();
    expect(diag).toEqual(['6,4', '7,5']);
  });
});

describe('upscale.mjs: buildings, zones and markers', () => {
  it('components finds each 4-connected run of the named symbols', () => {
    const rows = ['hh..s', 'hh..s', '.....', '..p..'];
    const c = components(rows, 'hsp');
    expect(c.map((b: { sym: string; cells: number[][] }) => `${b.sym}${b.cells.length}`)).toEqual(['h4', 's2', 'p1']);
    expect(bboxOf(c[0].cells)).toEqual({ x0: 0, y0: 0, w: 2, h: 2 });
  });

  it('a 2x2 house keeps its 2x2 footprint, centred on twice the source centre; a single tile on its anchor', () => {
    // source cells (25,15)-(26,16): the box centre is (26, 16) in boundary coordinates, so the tiles start at 51, 31
    const house = placeShape([[25, 15], [26, 15], [25, 16], [26, 16]], 48).map(([x, y]) => `${x},${y}`).sort();
    expect(house).toEqual(['51,31', '51,32', '52,31', '52,32']);
    expect(placeShape([[28, 16]], 48)).toEqual([[56, 33]]); // cell 28 >= 24: the left tile of its block; 16 < 24: the lower
    expect(placeShape([[7, 5]], 48)).toEqual([[15, 11]]);
  });

  it('a building and its twin land on twin tiles: the half-turn of the footprint is the footprint of the twin', () => {
    const a = placeShape([[25, 15], [26, 15], [25, 16], [26, 16]], 48);
    const b = placeShape([[21, 31], [22, 31], [21, 32], [22, 32]], 48); // its source twin: 47 - 26 = 21, 47 - 16 = 31
    const mirrored = a.map(([x, y]) => `${95 - x},${95 - y}`).sort();
    expect(mirrored).toEqual(b.map(([x, y]) => `${x},${y}`).sort());
  });

  it('rescaleRect keeps a landmark zone its own size about twice its centre, and doubles an area zone', () => {
    expect(rescaleRect([31, 10, 7, 7])).toEqual([65, 23, 7, 7]); // centre (34.5, 13.5) -> (69, 27): corner 69 - 3.5 -> 65
    expect(rescaleRect([20, 20, 8, 8])).toEqual([44, 44, 8, 8]); // the centre ford, its own twin
    expect(rescaleRect([5, 1, 10, 19], 'area')).toEqual([10, 2, 20, 38]);
  });

  it('topHalfMarkers draws the top member at twice its tile and gives its twin the half-turn image, 2(47 - x) + 1', () => {
    const out = topHalfMarkers({ versus_0: [10, 10], versus_1: [37, 37], centre: [23, 23], centre_ford: [24, 24] }, 48);
    expect(out).toEqual({ versus_0: [20, 20], versus_1: [75, 75], centre: [46, 46], centre_ford: [49, 49] });
    // 2 * 37 = 74 is what a naive 2x would give versus_1; its twin tile under the half-turn is 75 = 2(47 - 10) + 1
    expect(75).toBe(2 * (47 - 10) + 1);
    // a marker whose _0 is in the BOTTOM half (Wadi's farm_far_0 at (6,38)) is still drawn from its top-half twin
    const far = topHalfMarkers({ farm_far_0: [6, 38], farm_far_1: [41, 9] }, 48);
    expect(far).toEqual({ farm_far_1: [82, 18], farm_far_0: [13, 77] });
  });

  it('topHalfMarkers refuses a marker with no twin tile', () => {
    expect(() => topHalfMarkers({ lone: [3, 3] }, 48)).toThrow('has no twin tile');
  });

  it('topHalfRects rescales the top member of a pair and mirrors it for the other; a self-twin is rescaled', () => {
    const out = topHalfRects(
      { ne_ford: [31, 10, 7, 7], sw_ford: [10, 31, 7, 7], centre_ford: [20, 20, 8, 8] },
      48,
      (_n: string, r: number[]) => rescaleRect(r),
    );
    expect(out).toEqual({ ne_ford: [65, 23, 7, 7], sw_ford: [24, 66, 7, 7], centre_ford: [44, 44, 8, 8] });
  });
});
