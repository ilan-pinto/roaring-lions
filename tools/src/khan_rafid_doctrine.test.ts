// Khan Rafid's sight and route facts, as assertions, pinning
// docs/campaign/khan_rafid/design.md §3.1 KR-A1..A7 and script.md §9.1's
// re-measurement (KR-M1) through the real Sim/FlowField rather than the
// design's draft tile-BFS.
//
// Method, matching tools/src/qarn_hadid_doctrine.test.ts exactly: sight uses
// the sees()/countVisible() pattern (spawn on the real map, run 12s of ticks,
// read sim.debugDetection(a,b).visible); routes use FlowField.compute over
// sim.blocked / sim.blockedVehicle. Every positive is paired against a
// control built from the same map with one thing changed, per design.md's
// own Appendix.
//
// Every number below was re-measured against the shipped khan_rafid.json
// this session and matches script.md's own §9.1 table exactly (34/40 for
// KR-A1, the unchanged 34 for KR-A2's three blocks, the civilian walk
// figures for KR-A3, the 26/46/31/16 open-tile counts for KR-A7). One
// finding is stated more precisely than script.md's prose: KR-M1 measured
// [19,20]'s only open neighbour as an ORTHOGONAL step into the ward's
// interior (not a diagonal one as design.md's prose says), and — new this
// session — [29,20]'s only open neighbour runs the OTHER way, into the
// market side, not into the interior at all. Neither notch connects across
// the wall in both directions, which is the substantive claim design.md and
// script.md build the ROE design on ("only the north and south gates connect
// Main Street/the souk to the ward, sharing one N-S corridor at x=24"), and
// it holds exactly as measured here.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const MAP = maps.khan_rafid as unknown as MapJson;

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  return { map, sim };
}

function observerType(sight: number): UnitTypeJson {
  return {
    id: `kr_observer_${sight}`,
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
  };
}

function sees(sight: number, a: Pt, b: Pt): boolean {
  const { sim } = load(MAP);
  const t = sim.addUnitType(observerType(sight));
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const tgt = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return sim.debugDetection(watcher, tgt)?.visible ?? false;
}

function fieldTo(json: MapJson, domain: 'foot' | 'vehicle', to: Pt, extraBlocked: readonly Pt[] = []) {
  const { map, sim } = load(json);
  const mask = (domain === 'foot' ? sim.blocked : sim.blockedVehicle).slice();
  for (const [x, y] of extraBlocked) mask[y * map.width + x] = 1;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  return { map, field };
}

/** The tiles a unit of `domain` actually walks, off the real flow field. */
function route(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt, extraBlocked: readonly Pt[] = []): Pt[] | null {
  const { map, field } = fieldTo(json, domain, to, extraBlocked);
  let x = from[0];
  let y = from[1];
  const out: Pt[] = [[x, y]];
  for (let steps = 0; steps <= map.width * map.height; steps++) {
    if (x === to[0] && y === to[1]) return out;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
    out.push([x, y]);
  }
  return null;
}

/** Tile count of a route (steps, excluding the start tile). */
function tiles(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt, extraBlocked: readonly Pt[] = []): number | null {
  const r = route(json, domain, from, to, extraBlocked);
  return r === null ? null : r.length - 1;
}

// ---------------------------------------------------------------------------
// Markers and zones, read directly from data/maps/khan_rafid.json.
const KR_START: Pt = [24, 45];
const SOUK_ALLEY: Pt = [24, 11];
const CIV_REFUGE: Pt = [24, 22];
const WARD_NORTH_GATE: Pt = [24, 17];
const WARD_GATE: Pt = [24, 24];

describe('KR-A1: the fastest road north runs through the ward', () => {
  it('kr_start -> souk_alley is 34 tiles through the ward, 40 with both gates shut', () => {
    expect(tiles(MAP, 'foot', KR_START, SOUK_ALLEY)).toBe(34);
    expect(tiles(MAP, 'foot', KR_START, SOUK_ALLEY, [WARD_NORTH_GATE, [24, 23]])).toBe(40);
  });
});

describe('KR-A2: blocking the narrowest tile of the cheapest route leaves a finite route, unchanged', () => {
  it('blocking [24,20], [13,16] or [33,16] individually leaves the through-ward route at 34 tiles, both domains', () => {
    for (const block of [[24, 20], [13, 16], [33, 16]] as Pt[]) {
      expect(tiles(MAP, 'foot', KR_START, SOUK_ALLEY, [block])).toBe(34);
      expect(tiles(MAP, 'vehicle', KR_START, SOUK_ALLEY, [block])).toBe(34);
    }
  });
});

describe('KR-A3: every authored civilian spawn walks to the refuge in <=14 tiles', () => {
  it('the six authored spawn tiles across all three missions', () => {
    const spawns: Pt[] = [
      [20, 16], // KR I
      [27, 16], // KR I
      [16, 16], // KR II / III
      [31, 16], // KR II / III
      [23, 27], // KR II
      [30, 27], // KR III
    ];
    for (const s of spawns) {
      const d = tiles(MAP, 'foot', s, CIV_REFUGE);
      expect(d).not.toBeNull();
      expect(d as number).toBeLessThanOrEqual(14);
    }
  });
});

describe('KR-A4: civ_refuge lies inside zone ward', () => {
  it('by tile arithmetic, the same check MissionRuntime.start() throws on', () => {
    const { map } = load(MAP);
    const [zx, zy, zw, zh] = map.zones.ward;
    expect(CIV_REFUGE[0]).toBeGreaterThanOrEqual(zx);
    expect(CIV_REFUGE[0]).toBeLessThan(zx + zw);
    expect(CIV_REFUGE[1]).toBeGreaterThanOrEqual(zy);
    expect(CIV_REFUGE[1]).toBeLessThan(zy + zh);
  });
});

describe('KR-A5: a souk observer sees into the ward over the low_profile wall', () => {
  it('[24,16] sees the open ward corridor but not behind the clinic', () => {
    expect(sees(9, [24, 16], [24, 20])).toBe(true);
    expect(sees(9, [24, 16], CIV_REFUGE)).toBe(true);
    expect(sees(9, [24, 16], [22, 19])).toBe(false);
  });
});

describe('KR-A6: the ward holds exactly one clinic and one hall; the souk holds no hall', () => {
  it('counted against the real map rows', () => {
    let clinic = 0;
    let hall = 0;
    const [zx, zy, zw, zh] = load(MAP).map.zones.ward;
    for (let y = zy; y < zy + zh; y++) {
      for (let x = zx; x < zx + zw; x++) {
        const sym = MAP.rows[y][x];
        if (sym === 'k') clinic++;
        if (sym === 'm') hall++;
      }
    }
    expect(clinic).toBe(12);
    expect(hall).toBe(9);
    const [sx, sy, sw, sh] = load(MAP).map.zones.souk;
    let soukHall = 0;
    for (let y = sy; y < sy + sh; y++) {
      for (let x = sx; x < sx + sw; x++) {
        if (MAP.rows[y][x] === 'm') soukHall++;
      }
    }
    expect(soukHall).toBe(0);
  });
});

describe('KR-A7: every capture/hold_for zone has well over 12 open tiles', () => {
  it('ward, souk, market and store all clear the floor', () => {
    const { map, sim } = load(MAP);
    const counts: Record<string, number> = { ward: 26, souk: 46, market: 31, store: 16 };
    for (const [name, expected] of Object.entries(counts)) {
      const [zx, zy, zw, zh] = map.zones[name];
      let open = 0;
      for (let y = zy; y < zy + zh; y++) {
        for (let x = zx; x < zx + zw; x++) {
          if (sim.blocked[y * map.width + x] === 0) open++;
        }
      }
      expect(open).toBe(expected);
      expect(open).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('KR-M1: the ward\'s east/west gate notches are one-sided pockets, not through-gates', () => {
  it('[19,20] connects only to the ward interior and is unreachable once the N/S corridor is shut', () => {
    const { sim } = load(MAP);
    const w = 48;
    // Its only open neighbour is the interior side (east); north, south and
    // the true exterior (west) are all wall.
    expect(sim.blocked[20 * w + 18]).toBe(1); // west (true exterior)
    expect(sim.blocked[19 * w + 19]).toBe(1); // north
    expect(sim.blocked[21 * w + 19]).toBe(1); // south
    expect(sim.blocked[20 * w + 20]).toBe(0); // east (interior)
    expect(tiles(MAP, 'foot', KR_START, [19, 20])).not.toBeNull();
    expect(tiles(MAP, 'foot', KR_START, [19, 20], [WARD_NORTH_GATE, [24, 23]])).toBeNull();
  });

  it('[29,20] connects only to the market side and stays reachable even with the N/S corridor shut', () => {
    const { sim } = load(MAP);
    const w = 48;
    expect(sim.blocked[20 * w + 28]).toBe(1); // west (interior)
    expect(sim.blocked[19 * w + 29]).toBe(1); // north
    expect(sim.blocked[21 * w + 29]).toBe(1); // south
    expect(sim.blocked[20 * w + 30]).toBe(0); // east (true exterior, market side)
    const open = tiles(MAP, 'foot', KR_START, [29, 20]);
    const shut = tiles(MAP, 'foot', KR_START, [29, 20], [WARD_NORTH_GATE, [24, 23]]);
    expect(open).not.toBeNull();
    expect(shut).toBe(open); // never used the N-S corridor at all
  });

  it('only the north and south gates carry the N-S corridor at x=24', () => {
    expect(tiles(MAP, 'foot', WARD_GATE, WARD_NORTH_GATE)).not.toBeNull();
  });
});
