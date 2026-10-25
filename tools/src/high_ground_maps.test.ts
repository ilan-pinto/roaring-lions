// The shipped maps' high ground (F1, D4), through the Sim's own terrain path.
//
// Lives in tools/ and not packages/sim/ because parseMap and applyTerrain are
// @lions/data and `sim` imports nothing. The map list is read from the
// directory, not from a list in this file: a test that names its maps measures
// the maps it names (CLAUDE.md, "It measured one file").
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTerrain, parseMap, type MapJson } from '@lions/data';
import { highGroundRises, medianOpenLevel } from '../../packages/sim/src/intel-earn';
import { Sim } from '../../packages/sim/src/sim';

const MAP_DIR = join(__dirname, '..', '..', 'data', 'maps');

/** Rise count per relief map, read on first run (15 Oct 2026, head aa6b6707 + Task 4): 23 relief
 *  maps, 115 rises in all (12 flat maps, 0). Wadi Halam I's crest (GH-161, 25 Oct) made it the 24th
 *  relief map, 1 rise: 24 relief maps, 116 rises, 11 flat. Three relief maps pin 0 -- they have an elevation grid
 *  and no tile two levels over their own median -- and the pin still guards them against a rise
 *  appearing. */
const RISES: Record<string, number> = {
  beit_sahwan_2: 0,
  beit_sahwan_4: 0,
  deir_amun: 2,
  deir_amun_2: 7,
  deir_amun_3: 2,
  khan_rafid_2: 8,
  milh_flats: 6,
  qarn_hadid: 10,
  qarn_hadid_2: 17,
  qarn_hadid_3: 6,
  tel_marum: 3,
  tel_marum_1: 2,
  tel_marum_2: 1,
  tel_marum_3: 10,
  umm_zeitoun: 8,
  umm_zeitoun_2: 6,
  umm_zeitoun_3: 5,
  umm_zeitoun_4: 5,
  wadi_halam_2: 13,
  wadi_halam_3: 2,
  wadi_halam_4: 1,
  wadi_halam_5: 1,
  wadi_halam_basin: 1,
  wadi_tarfan: 0,
};

function measure(id: string): { relief: boolean; count: number; median: number; open: number } {
  const json = JSON.parse(readFileSync(join(MAP_DIR, `${id}.json`), 'utf8')) as MapJson;
  const map = parseMap(json);
  const sim = new Sim({ seed: 1, width: map.width, height: map.height, capacity: 4 });
  applyTerrain(map, sim);
  const { riseOf, count } = highGroundRises(sim.elevation, sim.blocked, map.width, map.height);
  let open = 0;
  let tagged = 0;
  for (let t = 0; t < map.width * map.height; t++) {
    if (sim.blocked[t] === 0) open++;
    if (riseOf[t] !== -1) {
      tagged++;
      // A rise tile is open by construction.
      expect(sim.blocked[t]).toBe(0);
    }
  }
  expect(tagged === 0).toBe(count === 0);
  return {
    relief: sim.elevation.some((v) => v !== 0),
    count,
    median: medianOpenLevel(sim.elevation, sim.blocked),
    open,
  };
}

const ids = readdirSync(MAP_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  .sort();

describe('shipped maps: high ground', () => {
  const results = new Map(ids.map((id) => [id, measure(id)]));

  it('reads the directory and finds both kinds of map', () => {
    expect(ids.length).toBeGreaterThan(30);
    const relief = ids.filter((id) => results.get(id)?.relief);
    const flat = ids.filter((id) => !results.get(id)?.relief);
    expect(relief.length).toBe(24);
    expect(flat.length).toBe(11);
  });

  it('every flat map reports 0 rises', () => {
    for (const id of ids) {
      const r = results.get(id);
      if (r && !r.relief) expect(r.count, id).toBe(0);
    }
  });

  it('every relief map reports its pinned rise count, and the pin table covers exactly the relief maps', () => {
    const relief = ids.filter((id) => results.get(id)?.relief);
    expect(Object.keys(RISES).sort()).toEqual(relief);
    for (const id of relief) expect(results.get(id)?.count, id).toBe(RISES[id]);
  });
});
