// Deir Amun's route, sight and tunnel-visibility facts, pinning
// docs/campaign/khan_rafid/design.md §3.2 DA-A1..A7 and script.md §9.2's
// re-measurement (DA-M1, DA-M2) through the real Sim/FlowField/losRay,
// following tools/src/qarn_hadid_doctrine.test.ts's own method: every
// positive is paired against a control built from the same map with one
// thing changed.
//
// data/maps/deir_amun.json ships with script.md §0 item 5's DA-M1 fix
// already applied (the rock line's three spines extended to the map edges,
// x0-2 and x46-47 at y8-10), closing the unintended third/fourth crossing
// that bypassed da_watch_gap's ambush. This file re-measures the routes
// affected by that fix rather than trusting the pre-fix numbers.
//
// One number here corrects design.md's own prediction rather than
// reproducing it, per this task's brief ("if the map disagrees with the
// script's number, do not move the test — report the disagreement"):
//
// DA-A2's control ("the tributary's b cleared, where both domains must be
// equal") does not reproduce as equal. Clearing only the tributary itself
// (x9-11, y15-29, matching design.md's own description of the feature) drops
// the vehicle route from 44 to 30 tiles — proving the tributary is what
// seals the shoulder to wheels and tracks — but it does not reach foot's 27,
// because da_west_head sits north of BOTH the tributary and the separate,
// deliberately-uncleared main wadi band (y29-33), and a vehicle still has to
// divert to a ford to cross the second obstacle before it can use the
// now-open tributary. Foot pays nothing for either barrier. The remaining
// 3-tile gap is real terrain cost, not a defect, and is pinned below as
// measured rather than forced to equal.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';
import type { TunnelRouteJson } from '../../packages/sim/src/tunnels';

type Pt = readonly [number, number];

const MAP = maps.deir_amun as unknown as MapJson;
/** deir_amun always declares six routes; MapJson's own `tunnels` is optional
 *  only because most shipped maps have none. */
const TUNNELS = MAP.tunnels ?? [];

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  const routes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < routes.length; i++) {
    const got = sim.addTunnel(routes[i]);
    if (got !== i) throw new Error(`tunnel "${routes[i].id}" registered as route ${got}, expected ${i}`);
  }
  return { map, sim };
}

function fieldTo(json: MapJson, domain: 'foot' | 'vehicle', to: Pt, extraBlocked: readonly Pt[] = []) {
  const { map, sim } = load(json);
  const mask = (domain === 'foot' ? sim.blocked : sim.blockedVehicle).slice();
  for (const [x, y] of extraBlocked) mask[y * map.width + x] = 1;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  return { map, field };
}

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

function tiles(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt, extraBlocked: readonly Pt[] = []): number | null {
  const r = route(json, domain, from, to, extraBlocked);
  return r === null ? null : r.length - 1;
}

function observerType(sight: number): UnitTypeJson {
  return {
    id: `da_observer_${sight}`,
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
  };
}

function sees(json: MapJson, sight: number, a: Pt, b: Pt): boolean {
  const { sim } = load(json);
  const t = sim.addUnitType(observerType(sight));
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const tgt = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return sim.debugDetection(watcher, tgt)?.visible ?? false;
}

/** Clone a MapJson with a rectangular run of rows edited character-by-character. */
function withRowEdit(json: MapJson, edit: (rows: string[]) => void): MapJson {
  const clone = JSON.parse(JSON.stringify(json)) as MapJson;
  edit(clone.rows as string[]);
  return clone;
}

// ---------------------------------------------------------------------------
const DA_START: Pt = [24, 44];
const DA_WEST_HEAD: Pt = [7, 17];
const NORTH_ROAD: Pt = [24, 4];
const FORD_CENTRE: Pt = [28, 31];
const HAMLET_LANE: Pt = [28, 23];

describe('DA-A1: every one of the six routes is watchable from open ground within 8 tiles', () => {
  it('finds a clear losRay from an open tile within 8 to at least one open tile each route runs under', () => {
    const { map, sim } = load(MAP);
    const w = map.width;
    const h = map.height;
    for (let r = 0; r < TUNNELS.length; r++) {
      let found = false;
      outer: for (let rty = 0; rty < h && !found; rty++) {
        for (let rtx = 0; rtx < w && !found; rtx++) {
          if (!sim.tunnelUnderTile(r, rtx, rty)) continue;
          if (sim.blocked[rty * w + rtx] !== 0) continue;
          for (let dy = -8; dy <= 8; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
              if (dx * dx + dy * dy > 64) continue;
              const ox = rtx + dx;
              const oy = rty + dy;
              if (ox < 0 || oy < 0 || ox >= w || oy >= h) continue;
              if (sim.blocked[oy * w + ox] !== 0) continue;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if ((sim as any).losRay(ox, oy, rtx, rty) < 0) continue;
              found = true;
              break outer;
            }
          }
        }
      }
      expect(found, `route "${TUNNELS[r].id}" has no watchable open tile within 8`).toBe(true);
    }
  });
});

describe('DA-A2: the tributary seals the shoulder route to vehicles', () => {
  it('foot 27, vehicle 44 to da_west_head on the real map', () => {
    expect(tiles(MAP, 'foot', DA_START, DA_WEST_HEAD)).toBe(27);
    expect(tiles(MAP, 'vehicle', DA_START, DA_WEST_HEAD)).toBe(44);
  });

  it('clearing only the tributary drops the vehicle route to 30 (not to foot\'s 27 — see header note)', () => {
    const cleared = withRowEdit(MAP, (rows) => {
      for (let y = 15; y <= 29; y++) {
        const row = rows[y].split('');
        for (let x = 9; x <= 11; x++) if (row[x] === 'b') row[x] = '.';
        rows[y] = row.join('');
      }
    });
    expect(tiles(cleared, 'foot', DA_START, DA_WEST_HEAD)).toBe(27);
    const clearedVehicle = tiles(cleared, 'vehicle', DA_START, DA_WEST_HEAD);
    expect(clearedVehicle).toBe(30);
    expect(clearedVehicle).toBeLessThan(44);
    expect(clearedVehicle).toBeGreaterThan(27);
  });
});

describe('DA-A3: the wadi bed is dead ground from the terrace, not from its own lip', () => {
  const terrace: Pt = [24, 26];
  const bed: Pt = [24, 31];
  const lip: Pt = [24, 29];

  it('terrace does not see the bed at sight 8 or 12; the lip does', () => {
    expect(sees(MAP, 8, terrace, bed)).toBe(false);
    expect(sees(MAP, 12, terrace, bed)).toBe(false);
    expect(sees(MAP, 8, lip, bed)).toBe(true);
  });

  it('a flattened control sees the bed from the terrace', () => {
    const flat = JSON.parse(JSON.stringify(MAP)) as MapJson & { elevation?: unknown };
    delete flat.elevation;
    expect(sees(flat, 8, terrace, bed)).toBe(true);
  });
});

describe('DA-A4 / DA-M1: the rock line has exactly two gaps, now that the map edges are closed', () => {
  it('the recon_drone, on the foot field, reaches north_road through the two named gaps', () => {
    expect(tiles(MAP, 'foot', DA_START, NORTH_ROAD)).toBe(40);
  });

  it('is unreachable once both named gaps are also closed (DA-M1\'s fix leaves no other crossing)', () => {
    const bothGapsClosed = withRowEdit(MAP, (rows) => {
      for (let y = 8; y <= 10; y++) {
        const row = rows[y].split('');
        for (let x = 15; x <= 21; x++) row[x] = '^';
        for (let x = 31; x <= 38; x++) row[x] = '^';
        rows[y] = row.join('');
      }
    });
    expect(tiles(bothGapsClosed, 'foot', DA_START, NORTH_ROAD)).toBeNull();
  });
});

describe('DA-A5: hamlet holds exactly four tunnel mouths; pump_yard and da_west hold one each', () => {
  function inZone(pt: readonly number[], rect: readonly number[]): boolean {
    return pt[0] >= rect[0] && pt[0] < rect[0] + rect[2] && pt[1] >= rect[1] && pt[1] < rect[1] + rect[3];
  }

  it('every route resolves to exactly one of the three zones, with no mouth claimed by two', () => {
    // The zones' own bounding boxes are NOT disjoint -- hamlet [18,20,17,8]
    // and pump_yard [12,23,7,6] share a one-column sliver at x=18, y23-27 --
    // but design.md's "the three zones disjoint" claim is about MOUTHS, not
    // raw rectangles, and no authored mouth falls in that sliver (checked
    // directly below rather than asserting a geometric property the map does
    // not actually have).
    const { map } = load(MAP);
    const zoneNames = ['hamlet', 'pump_yard', 'da_west'] as const;
    const mouthsIn = (name: (typeof zoneNames)[number]) =>
      TUNNELS.filter((t) => inZone(t.mouth, map.zones[name])).map((t) => t.id);
    expect(mouthsIn('hamlet').sort()).toEqual(['da_tn_east', 'da_tn_lane', 'da_tn_north', 'da_tn_yard'].sort());
    expect(mouthsIn('pump_yard')).toEqual(['da_tn_pump']);
    expect(mouthsIn('da_west')).toEqual(['da_tn_west']);
    // No mouth is claimed by more than one of the three zones.
    const claims = new Map<string, string[]>();
    for (const name of zoneNames) {
      for (const id of mouthsIn(name)) claims.set(id, [...(claims.get(id) ?? []), name]);
    }
    for (const [id, zones] of claims) {
      expect(zones, `mouth "${id}" claimed by ${zones.length} zones`).toHaveLength(1);
    }
  });
});

describe('DA-A6: blocking the centre ford leaves a finite vehicle route through the other two', () => {
  it('da_start -> hamlet_lane, vehicle, unchanged at 21 tiles even with ford_centre closed', () => {
    expect(tiles(MAP, 'vehicle', DA_START, HAMLET_LANE)).toBe(21);
    expect(tiles(MAP, 'vehicle', DA_START, HAMLET_LANE, [FORD_CENTRE])).toBe(21);
  });
});

describe('DA-A7 / DA-M2: the walled-yard and hamlet zones clear the 12-tile floor', () => {
  it('pump_yard 14 (corrects design.md\'s stated 16), store_yard 20, hamlet 80', () => {
    const { map, sim } = load(MAP);
    const counts: Record<string, number> = { pump_yard: 14, store_yard: 20, hamlet: 80 };
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
