// First Light's perimeter fence (2026-09-06) -- pins the mission's own
// `structures[]` fence layout, the routes it must not sever, and the two
// playtest verdicts it must not move.
//
// The lead's ask: "the perimeter that needs to be held in all the fortress
// missions should be surrounded by fences and guards so it's more visible."
// This is the fence half, on `beit_sahwan_breach` (First Light), as the
// pattern the other eight hold/survive missions will follow. Guards are a
// separate balance change and are not added here.
//
// The fence sits on `data/maps/marj_perimeter.json`'s own compound wall
// (`=`, x17-31, y16-30, two gates: west at x17,y21-22, east at x31,y24-25) --
// ONE tile outside it on the west/east faces (x16/x32) and two tiles outside
// the south face (y32, the wall's other blind face, alongside the wall's own
// north blind face which the outpost already watches and is deliberately
// left unfenced -- see the design note below). The gaps track the wall's own
// two gates on the west/east faces, and the two `assault_sw`/`assault_se`
// staging markers on the south face.
//
// Two things this file exists to catch, both measured rather than assumed
// while authoring this fence:
//
// - **A `count: 3` civilian group spreads three tiles east of its `at`**
//   (CLAUDE.md, `assertGroundClear`), and the first fence draft (a wider
//   U-ring at x15/x33) put the west face's fence column exactly on the third
//   body of `families_nw`/`families_sw` (both spawn at x=12.5, count 3, so
//   body 3 lands at x=15.0). Moving the fence one tile further out (x14) or,
//   as shipped, one tile IN from that draft (x16, hugging the wall) both
//   clear it -- x16 is shipped because it also turns out to leave every
//   affected route byte-for-byte or near-identical (below), where x14/x33
//   did not.
// - **A wider stand-off (x14/x33, two tiles out) is not free even though
//   every route still exists.** It measurably reshapes the passive control:
//   `beit_sahwan_breach (passive control)` must DEFEAT on `evac_settlements`
//   failing (script.md, design.md 5.1) with NO player orders at all. At
//   x14/x33 it instead VICTORYs -- civilians in the families_nw/ne corners
//   cross `CIV_FLEE_AT` (suppression 0.3) minutes before the ring closes at
//   272s and walk themselves to `civ_refuge`, satisfying `evacuate_before`'s
//   count:2 for free. Isolated with the west and east runs enabled one at a
//   time (the south run alone never moves the verdict), each ALONE is
//   already sufficient to flip it -- so it is not one face's fault, and not
//   the south face's at all. Hugging the wall at x16/x32 removes it: the
//   civilian routes below go back to being BYTE-IDENTICAL before/after (the
//   x14/x33 draft moved every one of them by 1-3 tiles), and the passive
//   control's objective statuses match the no-fence baseline exactly,
//   confirmed against `pnpm playtest`'s own seed (424242), not this file's
//   route-measurement seed (11, irrelevant to a static blocked-mask query
//   but NOT to the passive-control replica below, which is seeded to match
//   the authoritative harness on purpose).
//
// Every route is walked off the real `FlowField`, mirroring
// `beit_sahwan_variants.test.ts`'s idiom (`route()`, `withBlockedRun`-style
// before/after sims) rather than `walk_placements.ts`'s ASCII grid, which
// cannot show a mission-raised structure sitting on originally-open ground at
// all: its glyph choice is `TERRAIN_LEGEND[ch] !== undefined ? ch : '#'`, and
// `.` is IN `TERRAIN_LEGEND` (blocked: 0) -- so a fence tile whose base
// character is `.` prints as `.` regardless of `sim.blocked`, even though the
// real value the tool computes to choose the glyph shows the tile as
// blocked. Confirmed directly against `sim.blocked`/`sim.structureAt` before
// writing this file: every fence tile IS blocked, `walk_placements.ts` just
// cannot draw it. That gap is pre-existing (any mission's `structures[]`
// raised over open ground hits it, e.g. `wadi_halam_2_laager`'s `shanty`) and
// is not fixed here.
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

const BASE = maps.marj_perimeter as unknown as MapJson;
type FenceSpec = { type: string; at: readonly [number, number]; size?: readonly [number, number] };
type MissionShape = {
  structures?: readonly FenceSpec[];
  enemy?: {
    waves?: readonly { to: string; units: readonly { unit: string; from?: string; count: number }[] }[];
  };
};
const MISSION = missions.beit_sahwan_breach as unknown as MissionShape;

// ---------------------------------------------------------------- fence tiles

/** Expand `mission.structures[]` into raw (x,y) tiles, the same rectangle
 *  expansion `raiseMissionStructures` does (mission.ts) -- per_tile or not
 *  makes no difference to which TILES are covered, only to how many bodies
 *  they become, and this file is only measuring the blocked footprint. */
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

describe('First Light fence — the tiles themselves', () => {
  it('the fence type is per_tile and fully blocking, roe-neutral, low profile (data/structures.json)', () => {
    const fence = (structureCatalogue as Record<string, { per_tile?: boolean; roe_penalty?: number; low_profile?: boolean }>).fence;
    expect(fence.per_tile).toBe(true);
    expect(fence.roe_penalty).toBe(0);
    expect(fence.low_profile).toBe(true);
  });

  it('is exactly 33 tiles: 10 west + 10 east + 13 south', () => {
    expect(FENCE_TILES).toHaveLength(33);
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

  it('sits entirely outside the "compound" hold zone [18,17,13,13] -- the wire is outside the wall line', () => {
    const [zx, zy, zw, zh] = BASE.zones!.compound;
    for (const [x, y] of FENCE_TILES) {
      const inside = x >= zx && x < zx + zw && y >= zy && y < zy + zh;
      expect(inside, `(${x},${y}) inside the compound zone`).toBe(false);
    }
  });

  it('west run: x=16, y17-20 and y24-29 -- gap y21-23 (the wall\'s own west gate + the road)', () => {
    // x===16 alone is not unique: the south run's first segment (x15-18)
    // also carries x=16, at y=32. Excluding y=32 disambiguates.
    const west = FENCE_TILES.filter(([x, y]) => x === 16 && y !== 32).map(([, y]) => y).sort((a, b) => a - b);
    expect(west).toEqual([17, 18, 19, 20, 24, 25, 26, 27, 28, 29]);
    for (const y of [21, 22, 23]) expect(west).not.toContain(y);
  });

  it('east run: x=32, y17-22 and y26-29 -- gap y23-25 (the wall\'s own east gate + the road)', () => {
    // Same disambiguation as the west run: the south run's last segment
    // (x30-33) also carries x=32, at y=32.
    const east = FENCE_TILES.filter(([x, y]) => x === 32 && y !== 32).map(([, y]) => y).sort((a, b) => a - b);
    expect(east).toEqual([17, 18, 19, 20, 21, 22, 26, 27, 28, 29]);
    for (const y of [23, 24, 25]) expect(east).not.toContain(y);
  });

  it('south run: y=32, x15-18/x22-26/x30-33 -- gaps at x19-21 (assault_sw) and x27-29 (assault_se)', () => {
    const south = FENCE_TILES.filter(([, y]) => y === 32).map(([x]) => x).sort((a, b) => a - b);
    expect(south).toEqual([15, 16, 17, 18, 22, 23, 24, 25, 26, 30, 31, 32, 33]);
    for (const x of [19, 20, 21, 27, 28, 29]) expect(south).not.toContain(x);
  });

  it('the north face is deliberately unfenced -- the outpost stands there instead ("outside the wire")', () => {
    expect(FENCE_TILES.some(([, y]) => y < 17)).toBe(false);
  });

  it('no fence tile exactly coincides with a starting_force, garrison or civilian spawn tile', () => {
    // A hand census of every `at` this mission places on the ground (civilian
    // spread included, matching `assertGroundClear`'s 1.25-tile grid) --
    // cheaper than re-running the mission runtime here, and this file's job
    // is the terrain, not re-proving `walk_placements.ts`'s own "all
    // placements clear" (already re-checked by hand while authoring this,
    // both for the shipped x=16/x=32 layout and for the wider x=15/x=33
    // draft this file's header describes rejecting). A fence tile standing
    // ADJACENT to a spawn (distance 1) is fine and expected here -- the west
    // run's (16,17) sits diagonally next to `families_nw`'s third body at
    // (15,18) by design, one tile outside the wall the civilians are
    // sheltering behind.
    const occupied: Pt[] = [
      [20, 14], [27, 18], [21, 28], [27, 28], [22, 23], [27, 23], [24, 21], [24, 25], [26, 26], [22, 26], [25, 23],
      [24, 10], [21, 10], [6, 8], [7, 8], [37, 8], [38, 8], [6, 39], [7, 39], [38, 39],
      [12, 18], [13, 18], [15, 18], [35, 18], [36, 18], [38, 18],
      [12, 27], [13, 27], [15, 27], [35, 27], [36, 27],
    ];
    for (const [ox, oy] of occupied) {
      for (const [fx_, fy] of FENCE_TILES) {
        const onTop = fx_ === ox && fy === oy;
        expect(onTop, `fence (${fx_},${fy}) sits exactly on spawn (${ox},${oy})`).toBe(false);
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

/** BASE map + this mission's own fence, raised exactly as `raiseMissionStructures`
 *  would (mirrors `beit_sahwan_variants.test.ts`'s `loadWithStructures`, extended
 *  with the mission's OWN structures on top of the map's). */
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

describe('First Light fence — civilian routes to civ_refuge are untouched', () => {
  const REFUGE = marker(BASE, 'civ_refuge');
  // Group `at`s from the mission, floored to the tile the group actually
  // starts on (matches `walk_placements.ts`'s own convention).
  const GROUPS: readonly [string, Pt][] = [
    ['families_nw', [12, 18]],
    ['families_ne', [35, 18]],
    ['families_sw', [12, 27]],
    ['families_se', [35, 27]],
  ];

  it.each(GROUPS)('%s: foot route to civ_refuge exists both before and after, byte-identical length', (_label, from) => {
    const b = route(before.sim, beforeMap, 'foot', from, REFUGE);
    const a = route(after.sim, afterMap, 'foot', from, REFUGE);
    expect(b).not.toBeNull();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  // Pinned exact lengths, so a future edit to the fence (or the map) that
  // silently lengthens a civilian's walk shows up as a number changing here,
  // not just as "still not null".
  it('exact lengths: nw=12 ne=14 sw=13 se=11', () => {
    expect(route(after.sim, afterMap, 'foot', [12, 18], REFUGE)).toBe(12);
    expect(route(after.sim, afterMap, 'foot', [35, 18], REFUGE)).toBe(14);
    expect(route(after.sim, afterMap, 'foot', [12, 27], REFUGE)).toBe(13);
    expect(route(after.sim, afterMap, 'foot', [35, 27], REFUGE)).toBe(11);
  });
});

describe('First Light fence — every wave route from a raid marker still reaches its target', () => {
  // Derived from the mission's own `enemy.waves`, not hand-picked, so a future
  // wave edit is walked automatically. Air units (paramotor) are skipped: a
  // fence cannot touch a domain that never reads `sim.blocked`.
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

  it('the mission actually has ground-unit wave routes to check (guards against an empty parametrised suite)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases)('$from -> $to [$domain]: route exists before and after, with only a small detour', ({ from, to, domain }) => {
    const f = marker(BASE, from);
    const t = marker(BASE, to);
    const b = route(before.sim, beforeMap, domain, f, t);
    const a = route(after.sim, afterMap, domain, f, t);
    expect(b, `${from}->${to} had no route even before the fence`).not.toBeNull();
    expect(a, `${from}->${to} [${domain}] severed by the fence`).not.toBeNull();
    // The fence hugs the wall (1-2 tiles out) with gaps at the wall's own
    // gates, so no route should need more than a couple of extra tiles to
    // find the second gap right behind the first.
    expect((a as number) - (b as number)).toBeGreaterThanOrEqual(0);
    expect((a as number) - (b as number)).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------- passive control

/** A from-scratch replica of `playtest.ts`'s `run()` harness for exactly one
 *  check: the passive control, seeded to match it (424242) because this
 *  mission's autonomous civilian/suppression behaviour is seed-sensitive
 *  (confirmed while authoring this fence -- `walk_world.ts`'s own default
 *  seed, 11, reads VICTORY on the unmodified, fenceless mission, which is
 *  not the invariant `script.md`/`design.md` 5.1 pins; 424242, `playtest.ts`'s
 *  own seed, is the one that matters). Not exported from playtest.ts, so this
 *  is copied rather than imported -- deliberately minimal, no plan support,
 *  built only to answer "does an all-idle run still lose on evac_settlements". */
function passiveResult(): { result: string; objectives: Record<string, string> } {
  const mission = missions.beit_sahwan_breach as unknown as MissionJson;
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

describe('First Light fence — the passive control is unchanged', () => {
  it('still DEFEATs with no orders at all, and evac_settlements is still the failure', () => {
    const { result, objectives } = passiveResult();
    expect(result).toBe('defeat');
    expect(objectives.evac_settlements).toBe('failed');
    // The rest of the objective ladder is unaffected by the fence: the yard
    // still holds itself for three minutes on a passive run.
    expect(objectives.hold_compound).toBe('complete');
  });
});
