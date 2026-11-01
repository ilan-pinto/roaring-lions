// Rujm Sawda (GH-913 L4): the large 80x80 versus map, held three ways.
//
//   1. the generator (tools/maps/rujm_sawda/build.mjs) still writes exactly the shipped files, and
//      its cell-level port still reproduces the lead-approved sketch (sketch.py's own output);
//   2. the verifier (rujm_sawda_verify.ts) passes the shipped map;
//   3. the verifier goes RED on each way the map can be broken. A check that has never been seen to
//      fail is evidence about nothing (CLAUDE.md, "Every check gets an input that makes it fail"),
//      so every mutation below is a constructed input run against the verifier, and each one asserts
//      the specific failure it should draw, not merely "something failed".
//
// The rules file's pop caps and the map's absence from the offered lists are pinned here too: this
// package must not open the map (that waits on L5's fairness runs and the lead).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, VERSUS_FAIR_MAPS } from '@lions/net';
import { maps, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { build, cellSketch, serialise } from '../maps/rujm_sawda/build.mjs';
import { verifyRujmSawda, shipped } from './rujm_sawda_verify';

const ROOT = join(__dirname, '..', '..');
const W = 80;

/** The rules file as a test edits it: the shipped type is readonly all the way down. */
interface Rules {
  ends: Record<'friendly' | 'hostile', { camp: { at: number[]; size: number[] } }>;
  tunnels: Record<'friendly' | 'hostile', { id: string; points: number[][]; capacity: number }[]>;
  income_zones: { zone: string; rate_per_min: number }[];
}
type Doc = { json: MapJson; rules: Rules };
const fresh = (): Doc => {
  const s = shipped();
  return { json: JSON.parse(JSON.stringify(s.json)) as MapJson, rules: JSON.parse(JSON.stringify(s.rules)) as Rules };
};
const rowsOf = (d: Doc) => d.json.rows as string[];
const elevOf = (d: Doc) => d.json.elevation as string[];
const setRow = (rows: string[], x: number, y: number, c: string) => {
  rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
};
/** Write `c` at (x, y) and at its half-turn twin, so a mutation that is NOT about symmetry keeps the map symmetric. */
const setBoth = (rows: string[], x: number, y: number, c: string) => {
  setRow(rows, x, y, c);
  setRow(rows, W - 1 - x, W - 1 - y, c);
};
const failures = (d: Doc) => verifyRujmSawda(d.json, d.rules as unknown as VersusRulesJson).failures;
const has = (d: Doc, needle: string) => failures(d).some((f) => f.includes(needle));

describe('the generator', () => {
  it('writes exactly the shipped map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(ROOT, 'data/maps/rujm_sawda.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(ROOT, 'data/versus/rujm_sawda.json'), 'utf8'));
  });

  it('its cell-level port reproduces sketch.py cell for cell, elevation included', () => {
    // sketch.out is the sketch generator's own output: 9 header lines, 40 rows, a blank line, 40 elevation rows.
    const lines = readFileSync(join(ROOT, 'tools/maps/rujm_sawda/sketch.out'), 'utf8').split('\n');
    const rows = lines.slice(9, 49).map((l) => l.slice(4));
    const elev = lines.slice(50, 90).map((l) => l.slice(4));
    expect(rows).toHaveLength(40);
    expect(elev).toHaveLength(40);
    const { g, e } = cellSketch();
    expect(g.map((r) => r.join(''))).toEqual(rows);
    expect(e.map((r) => r.join(''))).toEqual(elev);
  });
});

describe('the shipped map', () => {
  it('passes every check of the verifier', () => {
    const r = verifyRujmSawda(shipped().json, shipped().rules);
    expect(r.failures).toEqual([]);
    expect(r.facts.asymmetric_tiles).toBe(0);
    expect(r.facts.income_per_min).toBe(360);
    expect(r.facts.income_zones).toBe(11);
    expect(r.facts.multi_storey_buildings).toBe(4);
    expect(Number(r.facts.built_share)).toBeLessThanOrEqual(0.01);
    expect(r.facts.wheels_all_five_plugged).toBe('no route');
  });

  it('is 80x80 and arid, with one camp an end and three Sarim tunnel routes an end', () => {
    const j = maps.rujm_sawda as unknown as MapJson;
    expect([j.width, j.height, j.terrain]).toEqual([80, 80, 'arid']);
    const r = versusRules.rujm_sawda;
    expect(r.ends.friendly.camp.size).toEqual([2, 2]);
    expect(r.tunnels?.friendly).toHaveLength(3);
    expect(r.tunnels?.hostile).toHaveLength(3);
    expect(r.income_zones.map((z) => z.zone).sort()).toEqual(
      ['centre', 'home_0', 'home_1', 'mesa_ne', 'mesa_sw', 'tell_ne', 'tell_sw', 'well_e_1', 'well_n_0', 'well_s_1', 'well_w_0'],
    );
  });

  it('is not offered: in neither FACTION_MATCHUP_MAPS nor VERSUS_FAIR_MAPS (that waits on L5 and the lead)', () => {
    expect(FACTION_MATCHUP_MAPS).not.toContain('rujm_sawda');
    expect(VERSUS_FAIR_MAPS).not.toContain('rujm_sawda');
  });

  it('carries none of the L3 / L8 fields: no capacity, no cap_minutes', () => {
    expect(Object.keys(versusRules.rujm_sawda).sort()).toEqual(['ends', 'id', 'income_zones', 'map', 'tunnels']);
  });
});

describe('the verifier goes red, one broken input at a time (PR 600\'s four, and the rest)', () => {
  it('one row character flipped (symmetry)', () => {
    const d = fresh();
    expect(rowsOf(d)[2][30]).toBe('.');
    setRow(rowsOf(d), 30, 2, '1');
    // the flipped tile and its unflipped twin are both off
    expect(has(d, 'symmetry: 2 tiles are not their half-turn twin, first row 30,2')).toBe(true);
  });

  it('one elevation digit lowered (symmetry)', () => {
    const d = fresh();
    expect(elevOf(d)[2][30]).toBe('3');
    setRow(elevOf(d), 30, 2, '2');
    expect(has(d, 'first elevation 30,2')).toBe(true);
  });

  it('versus_1 moved one tile (seat mirror, and the seats the spawns read)', () => {
    const d = fresh();
    (d.json.markers as Record<string, number[]>).versus_1 = [68, 67];
    expect(has(d, 'symmetry: versus_1 68,67 is not versus_0 12,12 mirrored')).toBe(true);
    expect(has(d, 'sandboxAnchors reads') || has(d, 'versus_1')).toBe(true);
  });

  it('both seats moved off the main diagonal, still a symmetric pair (the lead\'s ruling, asserted directly)', () => {
    const d = fresh();
    const mk = d.json.markers as Record<string, number[]>;
    mk.versus_0 = [12, 14];
    mk.versus_1 = [67, 65]; // the exact half-turn of (12,14): symmetry alone cannot see this
    const out = failures(d);
    expect(out.some((f) => f.startsWith('symmetry: versus_1'))).toBe(false);
    expect(out.some((f) => f.includes('seats: versus_0 (12,14) is not on the main diagonal'))).toBe(true);
    expect(out.some((f) => f.includes('seats: versus_1 (67,65) is not on the main diagonal'))).toBe(true);
  });

  it('a ridge on a formation tile, its twin too so the map stays symmetric (all three pairings\' spawns)', () => {
    const d = fresh();
    expect(rowsOf(d)[17][14]).toBe('.'); // seat 0 + (2, 5): a tile BOTH forces use
    setBoth(rowsOf(d), 14, 17, '^');
    const out = failures(d);
    expect(out.some((f) => f.startsWith('symmetry'))).toBe(false);
    for (const pair of ['kdf/kdf', 'kdf/sarim', 'sarim/kdf']) {
      expect(out.some((f) => f.startsWith(`spawns: ${pair}`) && f.includes('closed to wheels')), pair).toBe(true);
      expect(out.some((f) => f.startsWith(`spawns: ${pair}:`) && f.includes('not placed on their formation tile')), pair).toBe(true);
    }
  });

  it('a boulder on a formation tile is closed to wheels though a foot unit would stand there', () => {
    const d = fresh();
    setBoth(rowsOf(d), 14, 17, 'b');
    const out = failures(d);
    expect(out.some((f) => f.startsWith('spawns: kdf/kdf') && f.includes('closed to wheels'))).toBe(true);
    // the real placer is happy with a boulder (blocked is 0), so only the wheels check can see it
    expect(out.some((f) => f.includes('not placed on their formation tile'))).toBe(false);
  });

  it('a marker on rock (the design table put three there)', () => {
    const d = fresh();
    (d.json.markers as Record<string, number[]>).tell_ne = [47, 24];
    expect(rowsOf(d)[24][47]).toBe('^');
    expect(has(d, 'markers: tell_ne (47,24) is on ^')).toBe(true);
    // ...and one on a house, as well_n_0 was at (38,7)
    const e = fresh();
    (e.json.markers as Record<string, number[]>).well_n_0 = [38, 7];
    expect(has(e, 'markers: well_n_0 (38,7) is on h')).toBe(true);
  });

  it('the centre ford filled with ditch: it no longer carries a vehicle alone', () => {
    const d = fresh();
    for (let y = 38; y <= 41; y++) for (let x = 38; x <= 41; x++) setRow(rowsOf(d), x, y, 'd');
    expect(has(d, 'cut: centre alone does not carry a vehicle from seat 0 to seat 1')).toBe(true);
    expect(has(d, 'cut: ford_ne alone')).toBe(false);
  });

  it('a gap in the channel away from the fords: the wadi leaks', () => {
    const d = fresh();
    expect(rowsOf(d)[18].slice(62, 64)).toBe('dd');
    expect(rowsOf(d)[19].slice(62, 64)).toBe('dd');
    for (const [x, y] of [[62, 18], [63, 18], [62, 19], [63, 19]]) setBoth(rowsOf(d), x, y, '.');
    expect(has(d, 'the wadi leaks')).toBe(true);
  });

  it('a mesa ramp closed to wheels', () => {
    const d = fresh();
    setBoth(rowsOf(d), 62, 9, 'b');
    expect(has(d, 'ramps: ramp_ne_w (62,9) is closed to wheels')).toBe(true);
    expect(has(d, 'ramps: ramp_sw_e (17,70) is closed to wheels')).toBe(true);
  });

  it('a mesa with its crown walled off: it no longer carries a vehicle alone', () => {
    const d = fresh();
    // rock across the crown's neck (rows 12-13, x 66..75), mirrored, so nothing but the mesa is wrong
    for (let y = 12; y <= 13; y++) for (let x = 66; x <= 75; x++) setBoth(rowsOf(d), x, y, '^');
    expect(has(d, 'cut: mesa_ne alone does not carry')).toBe(true);
  });

  it('a hundred more building tiles: the built share goes over 1%', () => {
    const d = fresh();
    for (let y = 20; y < 27; y++) for (let x = 20; x < 27; x++) if (rowsOf(d)[y][x] === '.') setBoth(rowsOf(d), x, y, 's');
    expect(has(d, 'buildings: built share')).toBe(true);
  });

  it('a farmhouse on the track: more than one storey outside a well, near a lane', () => {
    const d = fresh();
    for (const [x, y] of [[20, 8], [21, 8], [20, 9], [21, 9]]) setBoth(rowsOf(d), x, y, 'h');
    const out = failures(d);
    expect(out.some((f) => f.includes("outside the wells' walls"))).toBe(true);
    expect(out.some((f) => f.includes('from a track'))).toBe(true);
    expect(out.some((f) => f.includes('multi-storey buildings'))).toBe(true);
  });

  it('a lone building with no twin', () => {
    const d = fresh();
    setRow(rowsOf(d), 30, 30, 'p');
    expect(has(d, 'has no mirrored twin')).toBe(true);
  });

  it('a hostile tunnel route that is not its twin, a third camp tile moved, a zone that pays unequally', () => {
    const a = fresh();
    a.rules.tunnels.hostile[0].capacity += 1;
    expect(has(a, 'hostile route rs_h_well is not friendly route rs_f_well mirrored')).toBe(true);

    const b = fresh();
    b.rules.ends.hostile.camp.at = [69, 70];
    expect(has(b, 'the hostile camp is not the friendly camp mirrored')).toBe(true);

    const c = fresh();
    c.rules.income_zones[2].rate_per_min += 5;
    expect(has(c, 'economy: income is 365 a minute, not 360')).toBe(true);
    expect(has(c, 'its twin')).toBe(true);
  });

  it('a vent within 18 tiles of the opposing anchor, and a route dropped', () => {
    const a = fresh();
    const pts = a.rules.tunnels.friendly[2].points;
    pts[pts.length - 1] = [56, 56]; // 15.5 tiles from (67,67)
    expect(has(a, 'the least is 18')).toBe(true);

    const b = fresh();
    b.rules.tunnels.friendly = b.rules.tunnels.friendly.slice(0, 2);
    expect(has(b, 'economy: tunnel routes per end are 2 and 3, not 3 and 3')).toBe(true);
  });

  it('a seat cost that differs one way: the home shelf raised on one side only', () => {
    const d = fresh();
    // seat 0's own tile to level 9 and nothing else, as PR 600 did: leaving is all descent, arriving a climb.
    setRow(elevOf(d), 12, 12, '9');
    const out = failures(d);
    expect(out.some((f) => f.startsWith('flow: foot seat 0 to seat 1 costs'))).toBe(true);
    expect(out.some((f) => f.startsWith('flow: wheels seat 0 to seat 1 costs'))).toBe(true);
  });

  it('a camp on a formation tile', () => {
    const d = fresh();
    d.rules.ends.friendly.camp.at = [13, 16]; // (14,17) is the seat\'s (2, 5) offset
    expect(has(d, 'is on a camp tile')).toBe(true);
  });

  it('the wrong size', () => {
    const d = fresh();
    d.json.rows = (d.json.rows as string[]).slice(0, 79);
    d.json.height = 79;
    expect(failures(d).some((f) => f.startsWith('shape:'))).toBe(true);
  });
});
