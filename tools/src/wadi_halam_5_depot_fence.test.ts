// Wadi Halam V's perimeter fence (2026-09-06) -- the second mission fenced
// under the lead's ask ("every held perimeter should be surrounded by
// fences... more visible"), and the only one of the eight delegated hold/
// survive missions where the design already has a walled compound to hug.
// See docs/campaign/wadi_halam/design.md's dated 2026-09-06 paragraph in
// the mission's own section for the layout rationale and the seven missions
// left bare, and CLAUDE.md's known-scaling-debts entry on `beit_sahwan_breach`
// for the pattern this file follows (`tools/src/first_light_fence.test.ts`).
//
// The depot (`data/maps/wadi_halam_5.json`) is already a walled compound on
// the BASE map: a `wall` structure runs x=34 (west, one gate at y=24, the
// `depot_gate` marker) / x=42 (east, solid) / y=16 (north, solid) / y=31
// (south, solid), enclosing the `depot` raze zone [35,17,7,14]. The mission's
// own `structures[]` adds THIRTY-SEVEN `fence` bodies one tile outside three
// of those four faces:
//   - north: y=15, x=33-43 (11 tiles)
//   - east:  x=43, y=16-31 (16 tiles)
//   - south: y=32, x=34-43 (10 tiles) -- x=33 is left open: the access road
//     runs down that column from the gate, and per the brief's own rule
//     ("gaps... at every road and gate") the road is a gap, not a wall.
//
// **The west face is deliberately left bare, and it is not an oversight.**
// Unlike First Light's open compound wall, this one already has a hamlet
// pressed against its outside: a `house` block at x=33,y16-18, a `shanty` at
// x=33,y20, and the road itself at x=33,y25-32. A fence hugging the wall
// there would either try to stand ON an existing building (which
// `raiseMissionStructures` refuses -- see its "overlaps an existing
// building" check) or reduce to two or three isolated tiles between them
// that read as nothing. The hamlet and the gate's own single opening already
// do the job First Light's fence exists to do, on that one face.
//
// Measured, not assumed: both wave routes into `depot_gate` still exist with
// a 1-3 tile detour (`rif_south` +1, `rif_east` +3 -- forced to go around the
// new east/north/south ring rather than approach from due east), the
// player's own start-to-gate route is BYTE-IDENTICAL for both domains, and
// the two `pnpm playtest` verdicts hold: passive control still DEFEATs
// (`raze_depot` failing) byte-identical to the fenceless baseline, and the
// scripted plan still VICTORYs -- faster (6.2 -> 5.5 min) because the ring
// delays the raiders' arrival relative to the plan's own pace, at a 2-point
// ROE cost (81 -> 79) and one fewer friendly lost (roster out 4 -> 3).
import { describe, expect, it } from 'vitest';
import {
  applyTerrain,
  maps,
  missions,
  parseMap,
  structures as structureCatalogue,
  units,
  type MapJson,
} from '@lions/data';
import {
  MissionRuntime,
  Sim,
  TICKS_PER_SECOND,
  type LedgerData,
  type MissionJson,
  type TunnelRouteJson,
} from '@lions/sim';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';

type Pt = readonly [number, number];

const BASE = maps.wadi_halam_5 as unknown as MapJson;
type FenceSpec = { type: string; at: readonly [number, number]; size?: readonly [number, number] };
type MissionShape = {
  structures?: readonly FenceSpec[];
  enemy?: {
    waves?: readonly { to: string; units: readonly { unit: string; from?: string; count: number }[] }[];
  };
};
const MISSION = missions.wadi_halam_5_depot as unknown as MissionShape;

// ---------------------------------------------------------------- fence tiles

function expandFenceTiles(): Pt[] {
  const out: Pt[] = [];
  for (const spec of MISSION.structures ?? []) {
    if (spec.type !== 'fence') continue;
    const [w, h] = spec.size ?? [2, 2];
    const [ox, oy] = spec.at;
    for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) out.push([x, y]);
  }
  return out;
}

const FENCE_TILES = expandFenceTiles();

describe('Wadi Halam V fence — the tiles themselves', () => {
  it('the fence type is per_tile and fully blocking, roe-neutral, low profile (data/structures.json)', () => {
    const fence = (structureCatalogue as Record<string, { per_tile?: boolean; roe_penalty?: number; low_profile?: boolean }>).fence;
    expect(fence.per_tile).toBe(true);
    expect(fence.roe_penalty).toBe(0);
    expect(fence.low_profile).toBe(true);
  });

  it('is exactly 37 tiles: 11 north + 16 east + 10 south', () => {
    expect(FENCE_TILES).toHaveLength(37);
  });

  it('every tile is on the map and none overlaps a base-map building or road', () => {
    for (const [x, y] of FENCE_TILES) {
      expect(x, `(${x},${y}) on map`).toBeGreaterThanOrEqual(0);
      expect(y, `(${x},${y}) on map`).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(BASE.width);
      expect(y).toBeLessThan(BASE.height);
      const ch = BASE.rows[y][x];
      expect(ch, `(${x},${y}) is "${ch}", expected open ground`).toBe('.');
    }
  });

  it('sits entirely outside the "depot" raze/hold zone [35,17,7,14] and off the wall itself', () => {
    const [zx, zy, zw, zh] = BASE.zones!.depot;
    for (const [x, y] of FENCE_TILES) {
      const inside = x >= zx && x < zx + zw && y >= zy && y < zy + zh;
      expect(inside, `(${x},${y}) inside the depot zone`).toBe(false);
      // The wall runs x=34/x=42/y=16/y=31 -- no fence tile should land ON it.
      const onWallCol = (x === 34 || x === 42) && y >= 16 && y <= 31;
      const onWallRow = (y === 16 || y === 31) && x >= 34 && x <= 42;
      expect(onWallCol || onWallRow, `(${x},${y}) coincides with the wall itself`).toBe(false);
    }
  });

  it('north run: y=15, x=33-43', () => {
    const north = FENCE_TILES.filter(([, y]) => y === 15).map(([x]) => x).sort((a, b) => a - b);
    expect(north).toEqual([33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43]);
  });

  it('east run: x=43, y=16-31 (16 tiles, the full height of the wall)', () => {
    // x===43 alone is not unique: the north run's last tile (y=15) and the
    // south run's last tile (y=32) both carry x=43 too. Excluding them
    // disambiguates, the same idiom First Light's test uses for its west/east
    // runs against its south run.
    const east = FENCE_TILES.filter(([x, y]) => x === 43 && y !== 15 && y !== 32).map(([, y]) => y).sort((a, b) => a - b);
    expect(east).toHaveLength(16);
    expect(east[0]).toBe(16);
    expect(east[east.length - 1]).toBe(31);
  });

  it('south run: y=32, x=34-43 -- x=33 is left open (the access road down to the gate)', () => {
    const south = FENCE_TILES.filter(([, y]) => y === 32).map(([x]) => x).sort((a, b) => a - b);
    expect(south).toEqual([34, 35, 36, 37, 38, 39, 40, 41, 42, 43]);
    expect(south).not.toContain(33);
  });

  it('the west face is deliberately unfenced -- a hamlet (house/shanty) and the road already stand there', () => {
    expect(FENCE_TILES.some(([x]) => x === 33 && BASE.rows[15][33] !== '.')).toBe(false); // sanity: x=33 itself carries no fence tile
    expect(FENCE_TILES.some(([x]) => x < 33)).toBe(false);
  });

  it('no fence tile exactly coincides with a starting_force, garrison or wave-spawn tile', () => {
    // Every `at`/`marker` this mission places on the ground at t=0, expanded
    // by the runtime's own east/south spread (assertGroundClear, mission.ts:
    // count k lands at (bx + (k%3)*1.25, by + floor(k/3)*1.25), never west or
    // north of `at`) -- so a count>1 group's farthest body is what matters.
    const occupied: Pt[] = [
      [12, 23], [12, 25], [13, 24], [14, 24], [14, 23], [13, 25], [15, 24], [14, 25], // starting_force
      [34, 24], // rpg_team @ depot_gate marker (the wall's own gate)
      [39, 20], [41, 20], [41, 27], [38, 24], // gun trucks + interior rpg_team
      [44, 20], [45, 20], [46, 20], // moto_rpg x3, harass_east, spreads east
    ];
    for (const [ox, oy] of occupied) {
      for (const [fx_, fy] of FENCE_TILES) {
        expect(fx_ === ox && fy === oy, `fence (${fx_},${fy}) sits exactly on spawn (${ox},${oy})`).toBe(false);
      }
    }
  });
});

// -------------------------------------------------------------------- routes

function baseSim(json: MapJson) {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  return { map, sim, structIdx };
}

function afterSim(json: MapJson) {
  const { map, sim, structIdx } = baseSim(json);
  for (const spec of MISSION.structures ?? []) {
    const catSpec = (structureCatalogue as Record<string, { per_tile?: boolean }>)[spec.type];
    const perTile = catSpec?.per_tile ?? false;
    const [w, h] = spec.size ?? [2, 2];
    const [ox, oy] = spec.at;
    const ti = structIdx.get(spec.type);
    if (ti === undefined) throw new Error(`unknown structure type ${spec.type}`);
    const tiles: number[] = [];
    for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) tiles.push(y * map.width + x);
    if (perTile) {
      for (const t of tiles) sim.addStructure(ti, [t]);
    } else {
      sim.addStructure(ti, tiles);
    }
  }
  return { map, sim };
}

function route(sim: Sim, map: ReturnType<typeof parseMap>, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
  const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  let x = from[0];
  let y = from[1];
  for (let steps = 0; steps <= map.width * map.height; steps++) {
    if (x === to[0] && y === to[1]) return steps;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
  }
  return null;
}

function marker(json: MapJson, name: string): Pt {
  const raw = json.markers?.[name];
  if (!raw) throw new Error(`no marker "${name}"`);
  return [raw[0], raw[1]];
}

const FOOT_ROLES = new Set(['infantry', 'at_team', 'artillery', 'engineer', 'sniper', 'support']);
function domainOf(unitId: string): 'foot' | 'vehicle' | 'air' {
  const u = (units as Record<string, { role?: string; mobility?: { domain?: string; wheeled?: boolean } }>)[unitId];
  if (!u) throw new Error(`unknown unit "${unitId}"`);
  if (u.mobility?.domain === 'air') return 'air';
  const wheeled = u.mobility?.wheeled ?? !FOOT_ROLES.has(u.role ?? '');
  return wheeled ? 'vehicle' : 'foot';
}

const before = baseSim(BASE);
const after = afterSim(BASE);
const beforeMap = parseMap(BASE);
const afterMap = parseMap(BASE);

describe('Wadi Halam V fence — every fence tile is actually blocked', () => {
  it('all 37 tiles read blocked after, none before', () => {
    for (const [x, y] of FENCE_TILES) {
      const idx = y * afterMap.width + x;
      expect(after.sim.blocked[idx], `(${x},${y}) not blocked after fencing`).toBe(1);
      expect(before.sim.blocked[idx], `(${x},${y}) was already blocked before fencing`).toBe(0);
    }
  });
});

describe('Wadi Halam V fence — the player’s own approach to the gate is untouched', () => {
  const GATE = marker(BASE, 'depot_gate');
  const START: Pt = [13, 24]; // mission.map.player_start

  it('foot route, byte-identical before and after', () => {
    const b = route(before.sim, beforeMap, 'foot', START, GATE);
    const a = route(after.sim, afterMap, 'foot', START, GATE);
    expect(b).not.toBeNull();
    expect(a).toBe(b);
  });

  it('vehicle route, byte-identical before and after', () => {
    const b = route(before.sim, beforeMap, 'vehicle', START, GATE);
    const a = route(after.sim, afterMap, 'vehicle', START, GATE);
    expect(b).not.toBeNull();
    expect(a).toBe(b);
  });
});

describe('Wadi Halam V fence — every wave route from a raid marker still reaches its target', () => {
  type Case = { from: string; to: string; domain: 'foot' | 'vehicle' };
  const cases: Case[] = [];
  const seen = new Set<string>();
  for (const w of MISSION.enemy?.waves ?? []) {
    for (const u of w.units) {
      if (!u.from) continue;
      const domain = domainOf(u.unit);
      if (domain === 'air') continue;
      const key = `${u.from}->${w.to}[${domain}]`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push({ from: u.from, to: w.to, domain });
    }
  }

  it('the mission actually has ground-unit wave routes to check', () => {
    expect(cases.length).toBeGreaterThanOrEqual(2);
  });

  it.each(cases)('$from -> $to [$domain]: route exists before and after, with a small detour', ({ from, to, domain }) => {
    const f = marker(BASE, from);
    const t = marker(BASE, to);
    const b = route(before.sim, beforeMap, domain, f, t);
    const a = route(after.sim, afterMap, domain, f, t);
    expect(b, `${from}->${to} had no route even before the fence`).not.toBeNull();
    expect(a, `${from}->${to} [${domain}] severed by the fence`).not.toBeNull();
    // Both raid approaches come from due east/south-east of the depot and
    // must now go around the new north/east/south ring to reach the gate on
    // the west face -- a real but small detour, not a seal.
    expect((a as number) - (b as number)).toBeGreaterThanOrEqual(0);
    expect((a as number) - (b as number)).toBeLessThanOrEqual(5);
  });

  it('pinned exact deltas: rif_south +1, rif_east +3', () => {
    const south = marker(BASE, 'rif_south');
    const east = marker(BASE, 'rif_east');
    const gate = marker(BASE, 'depot_gate');
    const bSouth = route(before.sim, beforeMap, 'vehicle', south, gate);
    const aSouth = route(after.sim, afterMap, 'vehicle', south, gate);
    const bEast = route(before.sim, beforeMap, 'vehicle', east, gate);
    const aEast = route(after.sim, afterMap, 'vehicle', east, gate);
    expect((aSouth as number) - (bSouth as number)).toBe(1);
    expect((aEast as number) - (bEast as number)).toBe(3);
  });
});

// ---------------------------------------------------------- passive control

/** A from-scratch replica of `playtest.ts`'s `run()` harness for exactly one
 *  check: the passive control, seeded to match it (424242) -- mirrors
 *  `first_light_fence.test.ts`'s own replica exactly. Not exported from
 *  playtest.ts, so this is copied rather than imported. */
function passiveResult(): { result: string; objectives: Record<string, string> } {
  const mission = missions.wadi_halam_5_depot as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < tunnelRoutes.length; i++) sim.addTunnel(tunnelRoutes[i]);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const ledger: LedgerData = {};
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u: string) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: () => null,
  });
  rt.start();
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    const evs = sim.tick();
    rt.step(evs);
    if (rt.result !== 'ongoing') break;
  }
  const objectives: Record<string, string> = {};
  for (const o of rt.objectiveList) objectives[o.id] = o.status;
  return { result: rt.result, objectives };
}

describe('Wadi Halam V fence — the passive control is unchanged', () => {
  it('still DEFEATs with no orders at all, and raze_depot is still the failure', () => {
    const { result, objectives } = passiveResult();
    expect(result).toBe('defeat');
    expect(objectives.raze_depot).toBe('failed');
    expect(objectives.kill_gate_rpg).toBe('active');
    expect(objectives.hold_depot).toBe('active');
    expect(objectives.no_bleed).toBe('complete');
  });
});
