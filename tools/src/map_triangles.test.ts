// tools/src/map_triangles.ts: the structure-triangle bill of a map (GH-974). The mesh sizes below were read by a Python parse of the
// same GLB files (JSON chunk, accessor counts of every indexed primitive of every node that references a mesh), not by the code
// under test; the map figures were read by a Python flood fill of the rows. Each assertion has a one-line mutation of the tool
// that turns it red (listed in the commit that added this file).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMap, type MapJson } from '@lions/data';
import {
  DITCH_TRIANGLES,
  PASSES,
  billOf,
  centreBill,
  densestWindow,
  glbTriangles,
  meshesOf,
  msOf,
  structureTriangles,
  windowBill,
} from './map_triangles';

const ROOT = join(__dirname, '..', '..');
const WALL = 3087;
const HOUSE = 39016;
const SHANTY = 7157;
const PUMP = 7594;

/** A square map of open ground with the given rows overwritten, as the loader wants it. */
const mapOf = (size: number, draw: Record<number, string>): MapJson => {
  const rows = Array.from({ length: size }, (_, y) => (draw[y] ?? '').padEnd(size, '.'));
  return { id: 't', name: 't', width: size, height: size, rows, markers: { versus_0: [1, 1], versus_1: [size - 2, size - 2] }, zones: {} } as unknown as MapJson;
};

describe('glbTriangles: the standing meshes, against a Python read of the same files', () => {
  it.each([
    ['wall', WALL],
    ['house', HOUSE],
    ['shanty', SHANTY],
    ['concrete', 7155],
    ['pump_house', PUMP],
    ['fence', 19616],
    ['hall', 19491],
    ['apartment', 19899],
    ['warehouse', 18765],
    ['t_wall', 840],
  ])('%s is %i triangles', (type, n) => {
    expect(structureTriangles(type)).toBe(n);
  });

  it('a house is 12.6 walls, a fence 6.4: the reason a plan counts as it places', () => {
    expect(HOUSE / WALL).toBeCloseTo(12.64, 2);
    expect(structureTriangles('fence') / WALL).toBeCloseTo(6.35, 2);
  });

  it('the ditch segment constant is the decor GLB (38,240), and a nodeless or non-GLB file is refused', () => {
    expect(glbTriangles(join(ROOT, 'art', 'meshes', 'decor', 'ditch_0.glb'))).toBe(DITCH_TRIANGLES);
    expect(DITCH_TRIANGLES).toBe(38_240);
    expect(() => glbTriangles(join(ROOT, 'package.json'))).toThrow('is not a GLB');
  });

  it('is cached: the wreck twin is a different file and reads differently', () => {
    expect(glbTriangles(join(ROOT, 'art', 'meshes', 'buildings', 'house_wreck.glb'))).not.toBe(HOUSE);
  });
});

describe('meshesOf: what the renderer clones', () => {
  it('a 2x2 house is ONE mesh, a four-tile shed one shanty, a wall run is one mesh a TILE, a ditch tile one segment', () => {
    const json = mapOf(12, {
      2: '..hh....',
      3: '..hh.sss',
      5: '=====...',
      7: '.d.d....',
      9: '.pp.....',
      10: '.pp.....',
    });
    const ms = meshesOf(json);
    const by = (type: string) => ms.filter((m) => m.type === type);
    expect(by('house')).toHaveLength(1);
    expect(by('house')[0].triangles).toBe(HOUSE);
    expect(by('house')[0].x).toBe(2.5); // the mean of its tiles
    expect(by('house')[0].y).toBe(2.5);
    expect(by('shanty')).toHaveLength(1); // 'sss' is one three-tile shed
    expect(by('wall')).toHaveLength(5);
    expect(by('ditch')).toHaveLength(2);
    expect(by('ditch')[0].triangles).toBe(DITCH_TRIANGLES);
    expect(by('pump_house')).toHaveLength(1);
    const bill = billOf(ms);
    expect(bill.perPass).toBe(HOUSE + SHANTY + 5 * WALL + 2 * DITCH_TRIANGLES + PUMP);
    expect(bill.frame).toBe(PASSES * bill.perPass);
    expect(PASSES).toBe(3);
    expect(bill.byType.wall).toEqual({ meshes: 5, triangles: 5 * WALL });
  });

  it('two touching houses of the same symbol are one structure (the loader\'s flood fill), so ONE mesh: draw them apart to count two', () => {
    expect(meshesOf(mapOf(10, { 2: '.hh.hh..', 3: '.hh.hh..' })).filter((m) => m.type === 'house')).toHaveLength(2);
    expect(meshesOf(mapOf(10, { 2: '.hhhh...', 3: '.hhhh...' })).filter((m) => m.type === 'house')).toHaveLength(1);
  });
});

describe('windows: a mesh belongs to the window its position is in', () => {
  // 3 walls at x 0..2 on row 0, a house at (10..11, 10..11), a wall at (1,12), a wall at (20,20)
  const json = mapOf(24, { 0: '===', 10: '..........hh', 11: '..........hh', 12: '.=', 20: '....................=' });
  const ms = meshesOf(json);

  it('windowBill is half-open: x0 inclusive, x0 + edge exclusive', () => {
    expect(windowBill(ms, 0, 0, 3).perPass).toBe(3 * WALL);
    expect(windowBill(ms, 0, 0, 2).perPass).toBe(2 * WALL); // x = 2 is outside [0, 2)
    expect(windowBill(ms, 1, 0, 2).perPass).toBe(2 * WALL); // x = 0 is outside [1, 3)
    expect(windowBill(ms, 10, 10, 2).perPass).toBe(HOUSE); // the house's mean is (10.5, 10.5)
    expect(windowBill(ms, 11, 10, 2).perPass).toBe(0);
  });

  it('centreBill is the window centred on the map, offset floor((size - edge) / 2)', () => {
    expect(centreBill(ms, 24, 12).perPass).toBe(HOUSE); // offset 6: [6, 18)
    expect(centreBill(ms, 24, 4).perPass).toBe(HOUSE); // offset 10: [10, 14) holds the house at 10.5
    // an odd difference rounds DOWN: 21 on 24 starts at 1, so the wall at (1,12) is in and the wall at (22,y) would not be
    expect(centreBill(ms, 24, 21).perPass).toBe(HOUSE + 2 * WALL); // [1, 22): the house, (1,12) and (20,20)
    expect(centreBill(ms, 24, 20).perPass).toBe(HOUSE + WALL); // offset 2: [2, 22) loses the wall at x = 1

  });

  it('densestWindow finds the heaviest window anywhere and says where its top-left tile is', () => {
    const d = densestWindow(ms, 24, 4);
    expect(d.bill.perPass).toBe(HOUSE);
    expect([d.x0, d.y0]).toEqual([7, 7]); // the first window in scan order whose [x0, x0 + 4) holds 10.5
    const wide = densestWindow(ms, 24, 24);
    expect(wide.bill.perPass).toBe(5 * WALL + HOUSE); // three on row 0, (1,12), (20,20)
    expect(() => densestWindow(ms, 24, 25)).toThrow('does not fit');
  });

  it('msOf is the 0.65 ns a triangle that PR 1001 measured: 5.2 M triangles read +3.4 ms there', () => {
    expect(msOf(5_200_000)).toBeCloseTo(3.38, 2);
  });
});

describe('the figures PR 1001 and this PR quote, from the shipped and staged maps', () => {
  const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as MapJson;

  it('the 48x48 control (milh_flats): 695k triangles a pass, all of it in the one window; 12 walls, 4 houses, 2 concrete, 4 sheds, 12 ditch segments', () => {
    const ms = meshesOf(read('data/maps/milh_flats.json'));
    const bill = billOf(ms);
    expect(bill.perPass).toBe(694_926); // Python: 12*3087 + 4*39016 + 2*7155 + 4*7157 + 12*38240
    expect(Object.fromEntries(Object.entries(bill.byType).map(([k, v]) => [k, v.meshes]))).toEqual({ wall: 12, house: 4, concrete: 2, shanty: 4, ditch: 12 });
    expect(centreBill(ms, 48, 48).perPass).toBe(694_926);
  });

  it('the Milh Flats (large) redo, which PR 1001 measured at +3.4 ms: its centre window is 2.43 M a pass, 1.73 M over the control, 5.2 M a frame', () => {
    const ms = meshesOf(JSON.parse(readFileSync(join(ROOT, 'docs', 'campaign', 'staged_maps', 'milh_flats_l_redo', 'map.json'), 'utf8')) as MapJson);
    const centre = centreBill(ms, 96, 48);
    expect(billOf(ms).byType.wall.meshes).toBe(172);
    expect(billOf(ms).byType.ditch.meshes).toBe(44);
    // the claim itself: (centre - control) x 3 passes is PR 1001's 5.2 M extra triangles, to two digits
    expect((PASSES * (centre.perPass - 694_926)) / 1e6).toBeCloseTo(5.2, 1);
    expect(msOf(PASSES * (centre.perPass - 694_926))).toBeCloseTo(3.4, 0); // +3.40 ms measured
  });

  it('parseMap and meshesOf agree on how many structures a map has', () => {
    const json = read('data/maps/rujm_sawda.json');
    const parsed = parseMap(json);
    expect(meshesOf(json, parsed).filter((m) => m.type !== 'ditch')).toHaveLength(parsed.structures.length);
  });
});
