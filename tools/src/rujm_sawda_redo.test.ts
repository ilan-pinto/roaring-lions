// Rujm Sawda, REDONE (GH-974): the 80x80 network map with a plan in it, STAGED and held five ways.
//   1. the generator (tools/maps/rujm_sawda_redo/build.mjs) writes exactly the staged files (docs/campaign/staged_maps/rujm_sawda_redo),
//      which are byte for byte what B4 measured (the sha256 is in the PR);
//   2. the map is what the design says it is (_coord/versus-maps-design/design.md): the seats where the shipped map has them, a
//      scree wadi with 2-LEVEL cliff banks and a gap at each of three fords, bare-slope tells and octagon mesas that close on the
//      map edges, and Bir Sawda, four walled yards at the centre ford;
//   3. the seal holds: with the three fords and the two mesas plugged no vehicle crosses, and the check that says so goes red when
//      the bed is cut or a crossing is forgotten;
//   4. it is inside the versus visibility gate (VERSUS_CAPS), and the spec that says so is no longer in the exempt set;
//   5. it draws fewer structure triangles in any 48x48 window than the 48x48 control draws in all of its map, which is how it fits
//      the render budget (PR 1001: the cost of a town is triangles). The shipped Rujm Sawda is untouched: nothing here reads the redo
//      through `@lions/data`.
// The counts below are INDEPENDENT of the code under test: each was read by a Python script over the staged rows, levels and the
// GLB files (not parseMap, not the generator, not map_triangles.ts), the way PR 959's pins were swept.
// B4 (fairness) is in the PR, not here: the geometry was read once on seeds 0-191 and 4000-4287 and no lever was pulled.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_CAP_MINUTES, matchCapMinutes } from '@lions/net';
import { maps, parseMap, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { FUNNEL, MESA, PLAIN, SHELF, TELL, TOWN_ZONE, WADI, YARDS, bedCentre, build, serialise, tileMap } from '../maps/rujm_sawda_redo/build.mjs';
import { SPECS, staged, verifyLargeMap, verifyVersusVisibility } from './large_map_verify';
import { billOf, centreBill, densestWindow, meshesOf } from './map_triangles';

const ROOT = join(__dirname, '..', '..');
const STAGED_DIR = join(ROOT, 'docs', 'campaign', 'staged_maps', 'rujm_sawda_redo');
const large = JSON.parse(readFileSync(join(STAGED_DIR, 'map.json'), 'utf8')) as MapJson;
const rules = JSON.parse(readFileSync(join(STAGED_DIR, 'versus.json'), 'utf8')) as VersusRulesJson;
const shipped = maps.rujm_sawda as unknown as MapJson;
type Pt = readonly number[];
const rowsOf = large.rows as string[];
const levelOf = (x: number, y: number) => Number((large.elevation as string[])[y][x]);
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const clone = (): MapJson => JSON.parse(JSON.stringify(large)) as MapJson;
const setRow = (rows: string[], x: number, y: number, c: string) => {
  rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
};
/** Write `c` at (x, y) and at its half-turn twin, so a mutation that is not about symmetry keeps the map symmetric. */
const setBoth = (rows: string[], x: number, y: number, c: string) => {
  setRow(rows, x, y, c);
  setRow(rows, 79 - x, 79 - y, c);
};
const spec = () => SPECS.rujm_sawda_redo();
const failuresOf = (json: MapJson, s = spec()) => verifyLargeMap(json, rules, s).failures;

describe('the generator', () => {
  it('writes exactly the staged map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(STAGED_DIR, 'map.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(STAGED_DIR, 'versus.json'), 'utf8'));
  });

  it('is its own half-turn by construction: every tile and every elevation digit, and the tile map the build reads has no seam', () => {
    const { t, el } = tileMap();
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        expect(t[y][x], `${x},${y}`).toBe(t[79 - y][79 - x]);
        expect(el[y][x], `${x},${y}`).toBe(el[79 - y][79 - x]);
      }
    }
  });

  it('the symbols, by a Python count of the staged rows: 4,626 open, 510 scrub, 482 scree, 208 wall, 196 rock, 152 road, 102 knoll, 54 acacia, 24 shed, 22 cover-2, 16 pump, 8 house', () => {
    const n: Record<string, number> = {};
    for (const r of rowsOf) for (const c of r) n[c] = (n[c] ?? 0) + 1;
    expect(n).toEqual({ '.': 4626, '1': 510, b: 482, '=': 208, '^': 196, r: 152, n: 102, o: 54, s: 24, '2': 22, p: 16, h: 8 });
    expect(n.d).toBeUndefined(); // no ditch: a ditch segment is 38,240 triangles a tile
    expect(n['#']).toBeUndefined(); // no concrete block
  });
});

describe('the map is a plan: Rujm Sawda, redone', () => {
  it('is 80x80 and arid, with the shipped id and name (so opening it is a file copy)', () => {
    expect([large.width, large.height, large.terrain, large.id, large.name]).toEqual([80, 80, 'arid', 'rujm_sawda', shipped.name]);
  });

  it('keeps the shipped seats on the main diagonal, 77.8 apart, the shipped economy and tunnels, and its rules file byte for byte', () => {
    const m = large.markers as Record<string, Pt>;
    expect([m.versus_0, m.versus_1]).toEqual([[12, 12], [67, 67]]);
    expect(Math.hypot(m.versus_1[0] - m.versus_0[0], m.versus_1[1] - m.versus_0[1])).toBeCloseTo(77.78, 1);
    expect(JSON.stringify(rules)).toBe(JSON.stringify(versusRules.rujm_sawda));
    expect(sha(join(STAGED_DIR, 'versus.json'))).toBe(sha(join(ROOT, 'data', 'versus', 'rujm_sawda.json')));
    expect(rules.capacity).toBe(512);
    expect(rules.cap_minutes).toBe(35);
    expect(matchCapMinutes('rujm_sawda')).toBe(35);
    expect(MAP_CAP_MINUTES.rujm_sawda).toBe(35);
    expect(rules.income_zones).toHaveLength(11);
    expect(rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(360);
    expect(rules.tunnels?.friendly).toHaveLength(3);
    expect(rules.tunnels?.hostile).toHaveLength(3);
  });

  it('its markers are the shipped ones but for the mesas\' (a mesa and its two ramps stand on open ground of the new plateau); it adds one zone, the town', () => {
    const m = large.markers as Record<string, Pt>;
    const s = shipped.markers as Record<string, Pt>;
    expect(Object.keys(m).sort()).toEqual(Object.keys(s).sort());
    for (const k of Object.keys(s)) if (!k.startsWith('mesa_') && !k.startsWith('ramp_')) expect(m[k], k).toEqual(s[k]);
    expect([m.mesa_ne, m.ramp_ne_w, m.ramp_ne_s]).toEqual([[70, 11], [62, 9], [71, 16]]);
    const z = large.zones as Record<string, Pt>;
    const sz = shipped.zones as Record<string, Pt>;
    expect(Object.keys(z).sort()).toEqual([...Object.keys(sz), 'town'].sort());
    for (const k of Object.keys(sz)) expect(z[k], k).toEqual(sz[k]);
    expect(z.town).toEqual([27, 27, 26, 26]);
    expect(TOWN_ZONE).toEqual([27, 27, 26, 26]);
  });

  it('the plain is level 2 (the shipped one was 1: a one-level dip hides nothing), the home shelf 3, and the spawn grounds are open to wheels', () => {
    expect([PLAIN, SHELF]).toEqual([2, 3]);
    const n: Record<number, number> = {};
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) n[levelOf(x, y)] = (n[levelOf(x, y)] ?? 0) + 1;
    expect(n).toEqual({ 0: 260, 1: 18, 2: 3704, 3: 1942, 4: 348, 5: 112, 6: 16 }); // Python count of the staged elevation
    expect([levelOf(12, 12), levelOf(67, 67)]).toEqual([3, 3]);
    for (let y = 3; y <= 21; y++) for (let x = 8; x <= 14; x++) expect('.r12', `seat 0 formation ${x},${y}`).toContain(rowsOf[y][x]);
  });
});

describe('the wadi: a scree bed two levels down, and a gap at each of three fords', () => {
  /** Every bed tile's neighbour that is not scree and not a ford (level 0 floor or level 1 ramp): the banks. */
  const cliffs = (rows: string[], lv: (x: number, y: number) => number) => {
    let pairs = 0;
    const off: string[] = [];
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (rows[y][x] !== 'b' || lv(x, y) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx > 79 || ny > 79 || rows[ny][nx] === 'b' || lv(nx, ny) < 2) continue;
          if (lv(nx, ny) - lv(x, y) === 2) pairs++;
          else off.push(`${x},${y}->${nx},${ny} is ${lv(nx, ny)}`);
        }
      }
    }
    return { pairs, off };
  };

  it('the bed is 224 scree tiles at level 0 (112 a half), and every other scree tile is at level 2 (the 64 of the funnel) or 3 (a mesa ring or a shelf flank: 130 + 64)', () => {
    const at: Record<number, number> = {};
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (rowsOf[y][x] === 'b') at[levelOf(x, y)] = (at[levelOf(x, y)] ?? 0) + 1;
    expect(at).toEqual({ 0: 224, 2: 64, 3: 194 });
  });

  it('every bank is a 2-LEVEL CLIFF: 172 bed-bank pairs (Python), each exactly two levels, none other', () => {
    const c = cliffs(rowsOf, levelOf);
    expect(c.pairs).toBe(172);
    expect(c.off).toEqual([]);
  });

  it('RED: lower the plain by one level and the same census reads a one-level bank (the shipped map\'s, which hides nothing)', () => {
    const elev = (large.elevation as string[]).map((r) => [...r].map(Number));
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (elev[y][x] === 2 && rowsOf[y][x] !== 'b') elev[y][x] = 1;
    const c = cliffs(rowsOf, (x, y) => elev[y][x]);
    expect(c.pairs).toBe(0); // a bank one level up is indistinguishable from a ford ramp to the census, so it is the COUNT that goes: 172 to 0
    expect(c.off).toEqual([]);
  });

  it('is five tiles across a row, on the S-curve of the shipped map: the bed centre is the rounded sine, and a bed tile is within two of it', () => {
    expect(WADI).toEqual({ amp: 3.2, period: 104, fords: [0, 27, -27], fordHalf: 2, bedHalf: 2, vMax: 56 });
    expect([bedCentre(0), bedCentre(26), bedCentre(27), bedCentre(-27), bedCentre(52)].map((v) => v + 0)).toEqual([0, 3, 3, -3, 0]); // Python round(3.2 sin(2 pi v / 104))
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (rowsOf[y][x] === 'b' && levelOf(x, y) === 0) expect(Math.abs(x + y - 79 - bedCentre(x - y)), `${x},${y}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('each ford is a gap of five v-values through the bed: 12 floor tiles at level 0 and 6 ramp tiles at level 1 (Python), the centre one with the road through it', () => {
    for (const f of WADI.fords) {
      const floor: string[] = [];
      const ramp: string[] = [];
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 80; x++) {
          if (Math.abs(x - y - f) > 2) continue;
          if (levelOf(x, y) === 0 && '.r'.includes(rowsOf[y][x])) floor.push(`${x},${y}`);
          if (levelOf(x, y) === 1) ramp.push(`${x},${y}`);
        }
      }
      expect(floor, `ford ${f}`).toHaveLength(f === 0 ? 12 : 12);
      expect(ramp, `ford ${f}`).toHaveLength(6);
    }
    expect(rowsOf[39][39]).toBe('r');
    expect(rowsOf[40][40]).toBe('r');
    expect(levelOf(39, 39)).toBe(0);
  });
});

describe('the tells and the mesas', () => {
  it('each tell is a hill of BARE slopes: a crown of 8 rock tiles at level 5 and a ring of 12 knoll at level 4, then open ground at 3 and 3; no cover on the slope', () => {
    const [x0, y0, w, h] = TELL.crown;
    expect([x0, y0, w, h]).toEqual([46, 24, 4, 2]);
    const ring: string[] = [];
    for (let y = y0 - 3; y < y0 + h + 3; y++) {
      for (let x = x0 - 3; x < x0 + w + 3; x++) {
        const d = Math.max(x0 - x, 0, x - (x0 + w - 1)) + Math.max(y0 - y, 0, y - (y0 + h - 1));
        if (d === 0) expect([rowsOf[y][x], levelOf(x, y)], `crown ${x},${y}`).toEqual(['^', 5]);
        else if (d === 1) {
          expect([rowsOf[y][x], levelOf(x, y)], `ring ${x},${y}`).toEqual(['n', 4]);
          ring.push(`${x},${y}`);
        } else if (d <= 3) {
          expect(levelOf(x, y), `slope ${x},${y}`).toBe(3);
          // a slope tile is open ground, a road or the funnel of the lane; never scrub, acacia or knoll
          expect('.r1', `slope ${x},${y}`).toContain(rowsOf[y][x]);
        } else expect(levelOf(x, y), `plain ${x},${y}`).toBeLessThanOrEqual(3);
      }
    }
    expect(ring).toHaveLength(12);
    // by a Python read: the crowns at level 5 are exactly the two tells' 8 + 8 rock tiles
    let crowns = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (rowsOf[y][x] === '^' && levelOf(x, y) === 5) crowns++;
    expect(crowns).toBe(16);
  });

  it('each mesa is an octagon round a crown of 8 rock tiles at level 6: a plateau at 5, a skirt at 4, and a ring of scree at 3 that is cut by two ramps and by nothing else', () => {
    expect(MESA).toEqual({ crown: [70, 8, 4, 2], plateau: 3, skirt: 6, ring: [7, 8] });
    let crowns = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (rowsOf[y][x] === '^' && levelOf(x, y) === 6) crowns++;
    expect(crowns).toBe(16);
    // the west ramp: the crown's two rows through both ring tiles; the south ramp: the two columns under the crown's second quarter
    for (const y of [8, 9]) for (const x of [62, 63]) expect([rowsOf[y][x], levelOf(x, y)], `west ${x},${y}`).toEqual(['.', 3]);
    for (const y of [16, 17]) for (const x of [71, 72]) expect([rowsOf[y][x], levelOf(x, y)], `south ${x},${y}`).toEqual(['.', 3]);
    // ... and the ring is scree everywhere else it is drawn at a ramp's distance: the tiles beside each gap
    for (const [x, y] of [[63, 7], [64, 7], [63, 10], [64, 10], [70, 16], [73, 16], [70, 17], [73, 17]]) expect(rowsOf[y][x], `ring ${x},${y}`).toBe('b');
    // the ring reaches the top edge and the right edge: the NE corner is a closed pocket, which is what lets the ring be the seal
    expect(rowsOf[0].slice(70, 74)).toBe('bbbb');
    expect([rowsOf[6][79], rowsOf[7][79], rowsOf[10][79], rowsOf[11][79]]).toEqual(['b', 'b', 'b', 'b']);
  });

  it('the ramps and the mesa marker stand on open ground', () => {
    const m = large.markers as Record<string, Pt>;
    for (const k of ['mesa_ne', 'ramp_ne_w', 'ramp_ne_s', 'mesa_sw', 'ramp_sw_e', 'ramp_sw_n']) expect('.n', k).toContain(rowsOf[m[k][1]][m[k][0]]);
  });
});

describe('Bir Sawda: four walled yards at the centre ford', () => {
  it('has the yards A and B of seat 0 and their half-turns: six-tile rings, two two-tile gates each, 16 wall tiles a yard, 64 in all (Python)', () => {
    expect(Object.keys(YARDS)).toEqual(['A', 'B']);
    const [x0, y0, w, h] = large.zones!.town as number[];
    let walls = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (rowsOf[y][x] === '=') walls++;
    expect(walls).toBe(64);
    for (const y of Object.values(YARDS)) {
      for (const [gx, gy] of y.gates) {
        expect(rowsOf[gy][gx], `gate ${gx},${gy}`).toBe('.');
        expect(rowsOf[79 - gy][79 - gx], `twin gate ${gx},${gy}`).toBe('.');
      }
      for (let i = 0; i < 6; i++) for (const [x, yy] of [[y.x0 + i, y.y0], [y.x0 + i, y.y0 + 5], [y.x0, y.y0 + i], [y.x0 + 5, y.y0 + i]]) {
        if (!y.gates.some(([gx, gy]) => gx === x && gy === yy)) expect(rowsOf[yy][x], `wall ${x},${yy}`).toBe('=');
      }
    }
  });

  it('holds 2 two-floor houses (4 tiles each, one a bank, on the lip over the ford), 4 sheds of two tiles and 2 pump houses: 24 building tiles, 3.6% of the zone (Python)', () => {
    const [x0, y0, w, h] = large.zones!.town as number[];
    const n: Record<string, number> = {};
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if ('hsp'.includes(rowsOf[y][x])) n[rowsOf[y][x]] = (n[rowsOf[y][x]] ?? 0) + 1;
    expect(n).toEqual({ h: 8, s: 8, p: 8 });
    expect(rowsOf.slice(30, 32).map((r) => r.slice(40, 42))).toEqual(['hh', 'hh']);
    // no house anywhere else: the wells keep one-floor sheds (the shipped map's wells hid a tile in the 92% scoring cap)
    expect(rowsOf.join('').split('h').length - 1).toBe(8);
  });

  it('keeps the main road clear: the diagonal is road from the camp to the ford, and the yards stand at least 5 tiles off it', () => {
    for (let k = 10; k < 70; k++) expect(rowsOf[k][k], `road ${k}`).toBe('r');
    for (const y of Object.values(YARDS)) {
      for (const [x, yy] of [[y.x0, y.y0], [y.x0 + 5, y.y0], [y.x0, y.y0 + 5], [y.x0 + 5, y.y0 + 5]]) expect(Math.abs(x - yy)).toBeGreaterThanOrEqual(5);
    }
  });

  it('the funnel: two jagged strips of scree at level 2 on the plain beside the road, an unbroken core of two tiles and a hashed fringe', () => {
    expect(FUNNEL).toEqual({ core: [7, 8], from: 42, to: 60 });
    let core = 0;
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (rowsOf[y][x] === 'b' && levelOf(x, y) === 2) {
          const v = Math.abs(x - y);
          expect(v >= 6 && v <= 9, `strip ${x},${y}`).toBe(true);
          if (v === 7 || v === 8) core++;
        }
      }
    }
    expect(core).toBeGreaterThanOrEqual(40);
  });
});

describe('the seal: three fords and two mesas, and nothing else', () => {
  it('with the crossings plugged no vehicle crosses; each alone carries one at the same cost both ways; the centre ford is the short way', () => {
    const rep = verifyLargeMap(large, rules, spec());
    expect(rep.failures).toEqual([]);
    expect(rep.facts.wheels_all_plugged).toBe('no route');
    expect(rep.facts.wheels_via_ford_ne_only).toBe(rep.facts.wheels_via_ford_sw_only);
    expect(rep.facts.wheels_via_mesa_ne_only).toBe(rep.facts.wheels_via_mesa_sw_only);
    expect(rep.facts.wheels_via_centre_only).toBe(rep.facts.wheels_seat_to_seat);
    expect(Number(rep.facts.wheels_via_centre_only)).toBeLessThan(Number(rep.facts.wheels_via_ford_ne_only));
    expect(Number(rep.facts.wheels_via_ford_ne_only)).toBeLessThan(Number(rep.facts.wheels_via_mesa_ne_only));
    expect(rep.facts.fat_stairs).toBe(0); // the shipped map needed an exemption of 26
  });

  it('RED: a hole through the bed (its five scree tiles on a row turned to open ground) opens a sixth crossing', () => {
    const j = clone();
    for (let x = 59; x <= 63; x++) setBoth(j.rows as string[], x, 20, '.'); // row 20 of the bed: clear of both ford plugs and of the mesa's
    const out = failuresOf(j);
    expect(out.some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    expect(out.some((f) => f.startsWith('symmetry'))).toBe(false);
  });

  it('RED: a spec that forgets the mesas as crossings sees them leak; a spec that forgets the centre ford sees the town leak', () => {
    const s = spec();
    const noMesas = { ...s, crossings: s.crossings!.filter((c) => !c.name.startsWith('mesa')) };
    expect(failuresOf(large, noMesas).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    const noCentre = { ...s, crossings: s.crossings!.filter((c) => c.name !== 'centre') };
    expect(failuresOf(large, noCentre).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
  });
});

describe('the verifier on it: every B2 check and the versus visibility gate, run on the staged data', () => {
  it('passes every check, with the seats on the main diagonal and the centre marker alone', () => {
    const { json, rules: r, spec: s } = staged('rujm_sawda_redo');
    expect(s.antiDiagonal).toBeUndefined();
    expect(s.lone).toEqual(['centre']);
    expect(s.maxBuiltShare).toBe(0.01);
    expect(s.maxFatStairs).toBeUndefined();
    const rep = verifyLargeMap(json, r, s);
    expect(rep.failures).toEqual([]);
    expect(rep.facts.asymmetric_tiles).toBe(0);
    expect(rep.facts.seat_distance).toBe(77.8);
    expect(rep.facts.road_stairs).toBe(0);
    expect(rep.facts.road_blocks).toBe(0);
    expect(rep.facts.thick_wall_blocks).toBe(0);
    expect(rep.facts.buildings).toBe(14); // 2 houses, 8 sheds (4 well sheds and 4 yard sheds), 4 pump houses
    expect(Number(rep.facts.built_share)).toBeCloseTo(0.0075, 4); // 48 building tiles of 6,400
    expect(Number(rep.facts.cover_share)).toBeCloseTo(0.1075, 4); // 688 cover tiles, by a Python count
    expect(Number(rep.facts.cover_share)).toBeGreaterThanOrEqual(0.1);
    expect(Number(rep.facts.cover_share)).toBeLessThanOrEqual(0.14);
  });

  it('holds the versus visibility gate: the whole map, the seat corridor, every scoring zone and the town', async () => {
    const { json, rules: r, spec: s } = staged('rujm_sawda_redo');
    expect('towns' in s.visibility ? s.visibility.towns : null).toEqual(['town']);
    const v = await verifyVersusVisibility(json, r, s);
    expect(v.failures).toEqual([]);
    expect(Number(v.facts.visible_whole_map)).toBeGreaterThanOrEqual(0.95);
    expect(Number(v.facts.visible_corridor)).toBeGreaterThanOrEqual(0.92);
    expect(Number(v.facts.visible_town)).toBeGreaterThanOrEqual(0.85);
    // the four wells read 91.7% each on the shipped map (one tile under the cap): their one-floor sheds clear it
    for (const w of ['well_n_0', 'well_w_0', 'well_s_1', 'well_e_1']) expect(Number(v.facts[`visible_${w}`]), w).toBeGreaterThanOrEqual(0.94);
    expect(Number(v.facts.building_share)).toBeLessThanOrEqual(0.03);
    expect(Number(v.facts.built_town)).toBeCloseTo(24 / 676, 4);
    expect(Number(v.facts.house_share)).toBeCloseTo(8 / 48, 3); // 17%, over the 40% cap by nothing
    expect(v.facts.building_tiles).toBe(48);
  });

  it('RED: caps just over the map\'s own readings turn the town red twice over: its visible share (98.6%) and its built share (3.6%)', async () => {
    const { json, rules: r, spec: s } = staged('rujm_sawda_redo');
    const tight = await verifyVersusVisibility(json, r, s, { town: 0.99, maxTownBuiltShare: 0.03 });
    expect(tight.failures.some((f) => f.includes('of the town town is visible, under 99%'))).toBe(true);
    expect(tight.failures.some((f) => f.includes('buildings cover 3.6% of town zone town, over 3%'))).toBe(true);
    expect(tight.failures).toHaveLength(2); // and nothing else is red
    const exact = await verifyVersusVisibility(json, r, s, { town: 0.98, maxTownBuiltShare: 0.04 });
    expect(exact.failures).toEqual([]);
  });

  it('is bound to the gate: the spec holds a town list, and the exempt set is the three offered maps only', () => {
    expect(spec().visibility).toEqual({ towns: ['town'] });
    expect(Object.keys(SPECS).filter((id) => 'exempt' in SPECS[id]().visibility).sort()).toEqual(['milh_flats_l', 'rujm_sawda', 'wadi_tarfan_l']);
  });
});

describe('the triangle bill: it fits the render budget from the start', () => {
  const ms = meshesOf(large);

  it('counts, by a Python flood fill and a Python parse of the GLBs: 208 walls, 2 houses, 8 sheds, 4 pump houses, no ditch; 807,760 triangles a pass', () => {
    const b = billOf(ms);
    expect(Object.fromEntries(Object.entries(b.byType).map(([k, v]) => [k, v.meshes]))).toEqual({ wall: 208, shanty: 8, house: 2, pump_house: 4 });
    expect(b.perPass).toBe(807_760); // 208*3087 + 2*39016 + 8*7157 + 4*7594
    expect(b.frame).toBe(2_423_280);
  });

  it('the centre 48x48 draws 408,692 a pass and the densest 48x48 529,631 (at 25,4), against the control\'s 694,926 in its whole map', () => {
    expect(centreBill(ms, 80, 48).perPass).toBe(408_692);
    const d = densestWindow(ms, 80, 48);
    expect(d.bill.perPass).toBe(529_631);
    expect([d.x0, d.y0]).toEqual([25, 4]);
    const control = billOf(meshesOf(maps.milh_flats as unknown as MapJson));
    expect(control.perPass).toBe(694_926);
    expect(d.bill.perPass).toBeLessThan(control.perPass);
  });

  it('the verifier reads the same numbers, and the predicted cost against the control is NEGATIVE at the centre (-0.56 ms) and in the densest window (-0.32 ms)', () => {
    const rep = verifyLargeMap(large, rules, spec());
    expect(rep.facts.triangles_control_per_pass).toBe(694_926);
    expect(rep.facts.triangles_whole_per_pass).toBe(807_760);
    expect(rep.facts.triangles_centre_per_pass).toBe(408_692);
    expect(rep.facts.triangles_densest_per_pass).toBe(529_631);
    expect(rep.facts.triangles_densest_at).toBe('25,4');
    expect(rep.facts.triangles_centre_vs_control_ms).toBe(-0.56);
    expect(rep.facts.triangles_densest_vs_control_ms).toBe(-0.32);
  });

  it('against the SHIPPED Rujm Sawda the redo adds 148k a pass over the map (0.44 M a frame) and 276k at the centre (0.83 M a frame, about 0.54 ms)', () => {
    const was = meshesOf(shipped);
    expect(billOf(was).perPass).toBe(659_596);
    expect(centreBill(was, 80, 48).perPass).toBe(133_092);
    expect(billOf(ms).perPass - billOf(was).perPass).toBe(148_164);
    expect(centreBill(ms, 80, 48).perPass - centreBill(was, 80, 48).perPass).toBe(275_600);
  });

  it('RED: eight more houses in the centre window take it over the control (the centre check); six in the north take only the densest window over it', () => {
    const house = (rows: string[], x: number, y: number) => {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setBoth(rows, x + dx, y + dy, 'h');
    };
    // the centre window is x, y in [16, 64): open plain west of the town on seat 0's side, 3 apart so no two touch (a touching pair is one house)
    const a = clone();
    for (let i = 0; i < 8; i++) house(a.rows as string[], 17 + 3 * (i % 4), 44 + 4 * Math.floor(i / 4));
    const outA = failuresOf(a);
    expect(outA.some((f) => f.includes('triangles: the centre 48x48'))).toBe(true);
    expect(outA.some((f) => f.includes('triangles: the densest 48x48'))).toBe(true);
    // rows 9-13 are above the centre window (y >= 16) and their half-turns (y >= 66) below it; the densest window holds the old wells and the new houses
    const b = clone();
    for (const [x, y] of [[25, 12], [28, 12], [31, 12], [25, 9], [28, 9], [31, 9]]) house(b.rows as string[], x, y);
    const outB = failuresOf(b);
    expect(outB.some((f) => f.includes('triangles: the densest 48x48'))).toBe(true);
    expect(outB.some((f) => f.includes('triangles: the centre 48x48'))).toBe(false);
    const rep = verifyLargeMap(b, rules, spec());
    expect(rep.facts.triangles_centre_per_pass).toBe(408_692); // unchanged: none of the six stands in it
  });

  it('the sim holds 256 structures and every wall tile is one: the redo stands 222 (208 walls, 14 buildings), 34 under the cap', () => {
    const sim = readFileSync(join(ROOT, 'packages', 'sim', 'src', 'sim.ts'), 'utf8');
    const cap = Number(/const MAX_STRUCTURES = (\d+);/.exec(sim)?.[1]);
    expect(cap).toBe(256);
    expect(parseMap(large).structures).toHaveLength(222);
    expect(cap - parseMap(large).structures.length).toBe(34);
  });

  it('RED: a spec that states no `triangles` is not held to a bill (the check is the spec\'s)', () => {
    const j = clone();
    for (let i = 0; i < 8; i++) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setBoth(j.rows as string[], 17 + 3 * (i % 4) + dx, 44 + 4 * Math.floor(i / 4) + dy, 'h');
    const s = { ...spec() } as Partial<ReturnType<typeof spec>>;
    delete s.triangles;
    expect(failuresOf(j, s as ReturnType<typeof spec>).some((f) => f.startsWith('triangles'))).toBe(false);
  });
});

describe('STAGED, not offered: the shipped Rujm Sawda is untouched', () => {
  it('its map is not the redo\'s: the shipped rows keep the one-level dip, the 91.7% wells and the channel of three; and its generator still writes it', () => {
    expect(JSON.stringify(shipped.rows)).not.toBe(JSON.stringify(large.rows));
    expect(shipped.id).toBe('rujm_sawda');
    const flat = (shipped.rows as string[]).join('');
    expect(flat.split('h').length - 1).toBe(16); // four farmhouses of four tiles: the redo has two houses
    expect(parseMap(shipped).structures.filter((s) => s.type === 'house')).toHaveLength(4);
    expect(parseMap(large).structures.filter((s) => s.type === 'house')).toHaveLength(2);
    // shipped plain is level 1 away from the shelves: the redo's is 2
    expect(Number((shipped.elevation as string[])[40][20])).toBe(1);
    expect(levelOf(20, 40)).toBe(2);
  });

  it('the shipped spec is still exempt from the gate and still has the 26-step exemption and the 1% cap', () => {
    expect('exempt' in SPECS.rujm_sawda().visibility).toBe(true);
    expect(SPECS.rujm_sawda().maxFatStairs).toBe(26);
    expect(SPECS.rujm_sawda().maxBuiltShare).toBe(0.01);
    expect(SPECS.rujm_sawda().triangles).toBeUndefined();
  });
});
