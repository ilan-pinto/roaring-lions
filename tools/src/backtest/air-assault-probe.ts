// The air-assault probe (GH-698, spec §4): what does a UH-60 Yanshuf buy, and what does a
// hot landing zone cost it?
//
// REPORT-ONLY. It prints a table per map and a PASS/MISS reading against the spec's two
// proposed bars, and exits 0 whatever they say: whether the Yanshuf ships, and at what
// landing time, is the lead's call. Run:
//
//   pnpm --filter @lions/tools air-assault:probe
//   pnpm --filter @lions/tools exec tsx src/backtest/air-assault-probe.ts [--seeds=<n>]
//
// THE WORLD. A bare `Sim` on the shipped map (`applyTerrain` + the map's own structures),
// every shipped unit type registered, no mission runtime. Every arm spawns the SAME list in
// the SAME order -- six `inf_squad`, one `apc_kipod`, one `heli_yanshuf`, one `heli_peten`
// (side 0), one `manpad_team`, one `gun_truck` (side 1) -- and removes what the arm does not
// use with `debugKill` at t=0. So entity ids, and therefore every per-entity RNG stream, are
// identical across arms (CLAUDE.md's Tel Marum trap: deleting a placement reshuffles every
// later unit's stream). The seed varies the Sim seed and nothing else.
//
// THE PLAY. Every order goes through `queueCommand`, the real command queue; nothing is
// moved, revealed or damaged by hand (bar the t=0 `debugKill`s).
//   A foot     the six squads `move` (exact) to the objective.
//   B kipod    `load` into the Kipod; once every living squad is aboard it `move`s to the
//              objective and `unload`s on arrival (a ground carrier: everyone out at once).
//   C yanshuf  `load` into the Yanshuf (it lands at the squads' centroid to load, R3); once
//              every living squad is aboard it `move`s to the objective; once it hovers there
//              (stopped, airborne: arrived or stopped short) it is sent `unload` (R4: it
//              lands at the LZ nearest where it is, then everyone out); once empty the squads
//              walk the last tiles to the objective and it is sent home (it lifts off).
//   D/E/F      C, with the hostile `manpad_team` / `gun_truck` / both alive.
//   G          F, plus the `heli_peten` sent ahead to the LZ (attack-move) at t=0.
// The Kipod's riders likewise walk the last tiles after their unload. A carrier that dies
// with riders in it on the ground bails them out (the sim's rule); they walk on.
//
// TWO AA PLACEMENTS. The bars read STANDOFF: 8-9 tiles off the LZ, inside the MANPAD's and
// the ZU-23's 11-tile reach and outside the door gun's 7 and the rifles' 8. CLOSE (4-6 tiles,
// inside the door gun's reach) is printed beside it as a sensitivity read (D'-G'), because the
// placement moves the hot-LZ result more than anything else measured here.
//
// TWO THINGS ABOUT THE SIM THAT SHAPE THE NUMBERS (read, not changed):
//  - An air unit flies an all-open flow field (DOMAIN_AIR, fix/air-pathing): the Yanshuf takes
//    the straight line over ridges and buildings. Until then it flew the FOOT field, round a
//    ridge -- on Tel Marum up the boulder corridor -- and this probe's first readings did too.
//  - A Yanshuf mobility-killed in the air makes a forced landing (fix/air-pathing) where it is,
//    or on the nearest foot-open tile, and its queued `unload` completes there. Before that it
//    hovered for good with its riders shut in (4 of 160 runs). STRANDED still counts any run
//    that ends that way, so a regression reads non-zero again.
//
// WHAT IS MEASURED, per run.
//   arrival    the first tick at which every living squad stands, unmounted, within
//              ARRIVE_TILES (2) of the objective tile's centre, with at least one living.
//              Never, if every squad dies or the cap comes first.
//   end        the run stops ARRIVE_GRACE_TICKS (30 s) after arrival, or at CAP_TICKS
//              (6 min): losses are read then, so a Yanshuf shot down on the way HOME counts.
//   states     ticks the Yanshuf spends LANDING / LANDED / LIFTING over the run.
//   exposure   hp the Yanshuf loses in each state. Damage is attributed to the airState at
//              the START of the tick, which is the state combat saw: `tick()` runs
//              stepCombat/stepProjectiles before stepAirCarriers, the only writer of airState.
//              A kill is classified the same way.
//   aboard     squads that died inside the Yanshuf (shot down airborne, R5).
//   seen       whether side 1 ever held the Yanshuf at `contactLevel` 2 (identified). The
//              probe reveals nothing: if the AA cannot see it, that is the reading.
//
// THE BARS (spec §4, proposals): a hot LZ (F: MANPAD + ZU, no escort) costs the Yanshuf in at
// least half the seeds; a cold LZ (C) beats the Kipod (B) by at least 2x on median time.
//
// The land/lift times (AIR_LAND_TICKS 40, AIR_LIFT_TICKS 20) are imported consts in tuning.ts
// and the probe cannot override them without a sim change, so it does not try. 40/20 was NOT
// measured against any other value: what it prints is the exposure the shipped values buy (hp and kills per state in D-G) and reads whether they decide the
// outcome. Note what the sim's rule implies before reading it: LANDING and LANDED make the
// Yanshuf a GROUND target, so an air-only MANPAD cannot engage it there -- the landing window
// shields it from the MANPAD and opens it to the ZU-23's ground fire and to rifles.
//
// The harness's own mechanics (lands to load, carries six, unloads at the LZ, ids fixed
// across arms) are pinned in air-assault-probe.test.ts, each check seen red under a one-line
// mutation of this file (listed in the commit message).

import { fileURLToPath } from 'node:url';
import { Sim, fx } from '@lions/sim';
import { applyTerrain, maps, parseMap, units, type MapId } from '@lions/data';
import { AIR_AIRBORNE, AIR_LANDED, AIR_LANDING, AIR_LAND_TICKS, AIR_LIFT_TICKS } from '../../../packages/sim/src/tuning';
import { standMapStructures } from '../../../packages/app/src/map-sim';

export const TICKS_PER_SECOND = 20;
/** Six minutes: far more than any arm needs on either map. */
export const CAP_TICKS = 6 * 60 * TICKS_PER_SECOND;
/** Losses are read this long after arrival. */
export const ARRIVE_GRACE_TICKS = 30 * TICKS_PER_SECOND;
/** "At the objective": within this many tiles of its centre. */
export const ARRIVE_TILES = 2;
export const SEEDS_DEFAULT = 10;
export const seedOf = (n: number): number => 1000 + n * 7919;

export type ProbeMap = 'tel_marum' | 'qarn_hadid';
export type Arm = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export const ARMS: readonly Arm[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

interface ArmSpec { label: string; carrier: 'foot' | 'kipod' | 'yanshuf'; manpad: boolean; gun: boolean; escort: boolean }
export const ARM_SPECS: Record<Arm, ArmSpec> = {
  A: { label: 'foot', carrier: 'foot', manpad: false, gun: false, escort: false },
  B: { label: 'kipod', carrier: 'kipod', manpad: false, gun: false, escort: false },
  C: { label: 'yanshuf, cold LZ', carrier: 'yanshuf', manpad: false, gun: false, escort: false },
  D: { label: 'yanshuf, MANPAD', carrier: 'yanshuf', manpad: true, gun: false, escort: false },
  E: { label: 'yanshuf, ZU-23', carrier: 'yanshuf', manpad: false, gun: true, escort: false },
  F: { label: 'yanshuf, hot LZ (both)', carrier: 'yanshuf', manpad: true, gun: true, escort: false },
  G: { label: 'hot LZ + Peten escort', carrier: 'yanshuf', manpad: true, gun: true, escort: true },
};

type Tile = readonly [number, number];
interface Layout {
  why: string;
  /** A reading note printed under the map's table, or ''. */
  note: string;
  objective: Tile;
  squads: readonly Tile[];
  kipod: Tile;
  yanshuf: Tile;
  peten: Tile;
  /** The STANDOFF placement, the one the bars read: 8-9 tiles off the LZ -- inside the
   *  MANPAD's effective 11 and the ZU-23's 11, outside the door gun's 7 and the rifles' 8. */
  manpad: Tile;
  gun: Tile;
  /** The CLOSE placement, a sensitivity read only: 4-6 tiles off the LZ, inside the door
   *  gun's and the landed squads' reach. */
  close: { manpad: Tile; gun: Tile };
}
export type Placement = 'standoff' | 'close';

// The two layouts. Each objective is foot-open AND vehicle-open, so the LZ snaps onto the
// objective tile itself (R2's lzFor; checked in the test and by `checkLayout` at startup).
export const LAYOUTS: Record<ProbeMap, Layout> = {
  // Start on `start_line` (24,44) in the southern basin; objective `sarim_west` (8,4), north
  // of the rock wall (y 12-17). On foot the cheapest way is the boulder corridor (x 10-11);
  // armour cannot use it and goes through the wide saddle (x 22-26) and back west. The air
  // line crosses the wall: ~43 tiles. AA on the open north plain (level 1), east of the LZ.
  tel_marum: {
    why: 'start_line (24,44) -> sarim_west (8,4), across the ridge; foot by the boulder corridor, armour by the wide saddle',
    note: '',
    objective: [8, 4],
    squads: [[22, 44], [23, 44], [24, 44], [25, 44], [26, 44], [24, 45]],
    kipod: [24, 42],
    yanshuf: [24, 46],
    peten: [26, 46],
    manpad: [16, 2],
    gun: [17, 6],
    close: { manpad: [13, 2], gun: [12, 8] },
  },
  // Start on `kdf_start` (24,39); objective `north_junction` (24,12), north of the rock wall
  // (y 18-22). Foot and armour both take the shoulder gate (x 18-21); the saddle notch
  // (x 29-32) is ditched at y 20, closed to the Kipod. The air line is 27 tiles.
  // AA on the open ground either side of the junction, with a clear view of it.
  qarn_hadid: {
    why: 'kdf_start (24,39) -> north_junction (24,12), across the rock wall; foot and armour by the shoulder gate',
    note: "E: the squads lost here die AFTER arrival -- they stand idle on the objective, 8.2 tiles from the gun truck at (16,14), " +
      "outside their own 8-tile rifles, and the probe gives no order after arrival. They are the ZU's reach, not the landing's cost.",
    objective: [24, 12],
    squads: [[22, 40], [23, 40], [24, 40], [25, 40], [26, 40], [24, 41]],
    kipod: [24, 37],
    yanshuf: [24, 43],
    peten: [26, 43],
    manpad: [32, 14],
    gun: [16, 14],
    close: { manpad: [28, 14], gun: [19, 10] },
  },
};

const at = (t: Tile) => [fx.from(t[0] + 0.5), fx.from(t[1] + 0.5)] as const;

export interface World {
  sim: Sim;
  squads: number[];
  kipod: number;
  yanshuf: number;
  peten: number;
  manpad: number;
  gun: number;
}

/** The same world for every arm: same spawns, same order, same ids. */
export function world(mapId: ProbeMap, seed: number, placement: Placement = 'standoff'): World {
  const map = parseMap(maps[mapId as MapId]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const L = LAYOUTS[mapId];
  const spawn = (unit: string, side: number, t: Tile, facingTurns = 0): number => {
    const ti = typeOf.get(unit);
    if (ti === undefined) throw new Error(`no unit type ${unit}`);
    const [x, y] = at(t);
    return sim.spawn(ti, side, x, y, fx.from(facingTurns));
  };
  const squads = L.squads.map((t) => spawn('inf_squad', 0, t));
  const kipod = spawn('apc_kipod', 0, L.kipod);
  const yanshuf = spawn('heli_yanshuf', 0, L.yanshuf);
  const peten = spawn('heli_peten', 0, L.peten);
  const aa = placement === 'close' ? L.close : L;
  const manpad = spawn('manpad_team', 1, aa.manpad);
  const gun = spawn('gun_truck', 1, aa.gun);
  return { sim, squads, kipod, yanshuf, peten, manpad, gun };
}

export interface Run {
  arm: Arm;
  seed: number;
  /** Entity ids: six squads, then Kipod, Yanshuf, Peten, MANPAD, gun truck. */
  ids: number[];
  /** Ids already dead before the first tick: exactly what the arm removed. */
  removed: number[];
  /** Seconds from t=0 to arrival, or null if never. */
  arrivedS: number | null;
  ticks: number;
  squadsLost: number;
  squadsLostAboard: number;
  kipodLost: boolean;
  yanshufLost: boolean;
  /** airState of the Yanshuf at the tick it was killed (start of tick), or null. */
  yanshufKillState: number | null;
  /** Riders inside the Yanshuf at the moment it died. */
  yanshufKillAboard: number;
  petenLost: boolean;
  /** Ticks in AIRBORNE/LANDING/LANDED/LIFTING (Yanshuf alive only). */
  stateTicks: [number, number, number, number];
  /** Yanshuf hp lost in each state (whole hp). */
  stateDamage: [number, number, number, number];
  /** Most riders ever aboard the Yanshuf at once. */
  maxAboard: number;
  /** The Yanshuf was LANDED on the tick its first rider was seated. */
  landedToLoad: boolean;
  /** Tile the Yanshuf was LANDED on when it unloaded, or null. */
  unloadTile: [number, number] | null;
  /** Side 1 held the Yanshuf identified at least once. */
  seenByAa: boolean;
  /** At the end: the Yanshuf alive, airborne, mobility-killed, with riders aboard. */
  stranded: boolean;
}

const HP = (sim: Sim, id: number) => (sim.state.hp[id] ?? 0) / 65536;


/** One run of one arm on one seed. */
export function run(mapId: ProbeMap, arm: Arm, seed: number, opts: { capTicks?: number; placement?: Placement } = {}): Run {
  const capTicks = opts.capTicks ?? CAP_TICKS;
  const spec = ARM_SPECS[arm];
  const w = world(mapId, seed, opts.placement);
  const { sim, squads, kipod, yanshuf, peten, manpad, gun } = w;
  const L = LAYOUTS[mapId];
  const [ox, oy] = at(L.objective);
  const s = sim.state;

  // Remove what this arm does not field. Ids stay put.
  if (spec.carrier !== 'kipod') sim.debugKill(kipod);
  if (spec.carrier !== 'yanshuf') sim.debugKill(yanshuf);
  if (!spec.escort) sim.debugKill(peten);
  if (!spec.manpad) sim.debugKill(manpad);
  if (!spec.gun) sim.debugKill(gun);

  const car = spec.carrier === 'kipod' ? kipod : spec.carrier === 'yanshuf' ? yanshuf : -1;
  const liveSquads = () => squads.filter((id) => s.alive[id] === 1);
  const aboard = (c: number) => squads.filter((id) => s.alive[id] === 1 && s.carriedBy[id] === c).length;
  const walkIn = (ids: number[]) => { if (ids.length) sim.queueCommand({ kind: 'move', ids, x: ox, y: oy, exact: true }); };

  // t=0 orders.
  if (spec.carrier === 'foot') walkIn(squads);
  else sim.queueCommand({ kind: 'load', ids: [...squads], carrier: car });
  if (spec.escort) sim.queueCommand({ kind: 'attackMove', ids: [peten], x: ox, y: oy });

  type Phase = 'load' | 'transit' | 'unload' | 'home' | 'walk';
  let phase: Phase = spec.carrier === 'foot' ? 'walk' : 'load';
  const r: Run = {
    arm, seed, ids: [...squads, kipod, yanshuf, peten, manpad, gun],
    removed: [...squads, kipod, yanshuf, peten, manpad, gun].filter((id) => s.alive[id] !== 1), arrivedS: null, ticks: 0, squadsLost: 0, squadsLostAboard: 0, kipodLost: false,
    yanshufLost: false, yanshufKillState: null, yanshufKillAboard: 0, petenLost: false,
    stateTicks: [0, 0, 0, 0], stateDamage: [0, 0, 0, 0], maxAboard: 0, landedToLoad: false,
    unloadTile: null, seenByAa: false, stranded: false,
  };
  let firstSeated = false;
  let endAt = capTicks;
  const near = (id: number, tiles: number) => {
    const dx = (s.posX[id] - ox) / 65536, dy = (s.posY[id] - oy) / 65536;
    return dx * dx + dy * dy <= tiles * tiles;
  };

  for (let t = 0; t < endAt; t++) {
    // --- the controller: reads state, issues commands through the queue --------------------
    if (car >= 0 && s.alive[car] === 1) {
      if (phase === 'load') {
        const live = liveSquads();
        if (live.length > 0 && aboard(car) === live.length) {
          sim.queueCommand({ kind: 'move', ids: [car], x: ox, y: oy });
          phase = 'transit';
        }
      } else if (phase === 'transit') {
        if (spec.carrier === 'kipod') {
          if (s.moving[car] === 0 && near(car, ARRIVE_TILES)) { sim.queueCommand({ kind: 'unload', ids: [car] }); phase = 'unload'; }
        } else if (s.airState[car] === AIR_AIRBORNE && s.moving[car] === 0) {
          // Hovering: arrived, or stopped short (another air unit on the goal, a mobility
          // kill). Either way a player would call the landing here; the sim picks the LZ.
          sim.queueCommand({ kind: 'unload', ids: [car] });
          phase = 'unload';
        }
      } else if (phase === 'unload') {
        // Out: the squads close the last tiles on foot (an unload spreads them over the LZ
        // and its neighbours, and a stopped-short carrier may sit up to ARRIVE_TILES off).
        if (aboard(car) === 0 && spec.carrier === 'kipod') {
          walkIn(liveSquads());
          phase = 'walk';
        } else if (aboard(car) === 0 && s.airState[car] === AIR_LANDED) {
          r.unloadTile = [s.posX[car] >> 16, s.posY[car] >> 16];
          walkIn(liveSquads());
          const [hx, hy] = at(L.yanshuf);
          sim.queueCommand({ kind: 'move', ids: [car], x: hx, y: hy });
          phase = 'home';
        }
      }
    }

    const st0 = car === yanshuf && s.alive[yanshuf] === 1 ? s.airState[yanshuf] : -1;
    const hp0 = s.alive[yanshuf] === 1 ? HP(sim, yanshuf) : 0;
    const aboardBefore = s.alive[yanshuf] === 1 ? aboard(yanshuf) : 0;
    const carrierAliveBefore = car >= 0 && s.alive[car] === 1;

    const evs = sim.tick();

    if (st0 >= 0) {
      r.stateTicks[st0]++;
      const hp1 = s.alive[yanshuf] === 1 ? HP(sim, yanshuf) : 0;
      r.stateDamage[st0] += Math.max(0, hp0 - hp1); // regen is not negative damage
      if (!firstSeated && aboard(yanshuf) > 0) { firstSeated = true; r.landedToLoad = s.airState[yanshuf] === AIR_LANDED; }
      r.maxAboard = Math.max(r.maxAboard, aboard(yanshuf));
      if (sim.contactLevel(1, yanshuf) === 2) r.seenByAa = true;
    }
    for (const e of evs) {
      if (e.kind !== 'destroyed') continue;
      if (squads.includes(e.entity)) r.squadsLost++;
      if (e.entity === kipod && spec.carrier === 'kipod') r.kipodLost = true;
      if (e.entity === peten && spec.escort) r.petenLost = true;
      if (e.entity === yanshuf && spec.carrier === 'yanshuf') {
        r.yanshufLost = true;
        r.yanshufKillState = st0;
        r.yanshufKillAboard = aboardBefore;
      }
    }
    if (r.yanshufLost && r.yanshufKillState !== null && r.yanshufKillState !== AIR_LANDING && r.yanshufKillState !== AIR_LANDED) {
      r.squadsLostAboard = r.yanshufKillAboard;
    }
    // A carrier lost on the ground bails its riders out: they walk the rest.
    if (carrierAliveBefore && s.alive[car] === 0 && phase !== 'home' && phase !== 'walk') {
      walkIn(liveSquads().filter((id) => s.carriedBy[id] < 0));
      phase = 'walk';
    }

    if (r.arrivedS === null) {
      const live = liveSquads();
      if (live.length > 0 && live.every((id) => s.carriedBy[id] < 0 && near(id, ARRIVE_TILES))) {
        r.arrivedS = (t + 1) / TICKS_PER_SECOND;
        endAt = Math.min(capTicks, t + 1 + ARRIVE_GRACE_TICKS);
      } else if (live.length === 0) {
        endAt = Math.min(endAt, t + 1 + ARRIVE_GRACE_TICKS);
      }
    }
    r.ticks = t + 1;
  }
  r.stranded = s.alive[yanshuf] === 1 && spec.carrier === 'yanshuf' && s.airState[yanshuf] === AIR_AIRBORNE &&
    s.mobilityKilled[yanshuf] === 1 && aboard(yanshuf) > 0;
  return r;
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const STATE_NAMES = ['AIR', 'LANDING', 'LANDED', 'LIFTING'];

export interface ArmSummary {
  arm: Arm;
  runs: Run[];
  arrived: number;
  medianS: number | null;
  minS: number | null;
  maxS: number | null;
  squadsLost: number;
  yanshufLost: number;
}

export function summarise(arm: Arm, runs: Run[]): ArmSummary {
  const ts = runs.map((r) => r.arrivedS).filter((x): x is number => x !== null);
  return {
    arm, runs, arrived: ts.length, medianS: median(ts),
    minS: ts.length ? Math.min(...ts) : null, maxS: ts.length ? Math.max(...ts) : null,
    squadsLost: runs.reduce((a, r) => a + r.squadsLost, 0),
    yanshufLost: runs.filter((r) => r.yanshufLost).length,
  };
}

const f1 = (x: number | null) => (x === null ? '   -' : x.toFixed(1).padStart(5));

/** Layout sanity, on the sim's own masks: the objective is open on foot AND to vehicles
 *  (so the LZ, the nearest vehicle-open tile, is the objective tile itself), and so is every
 *  spawn of a ground unit on its own mask. Empty when sound. */
export function checkLayout(mapId: ProbeMap): string[] {
  const { sim } = world(mapId, 1);
  const L = LAYOUTS[mapId];
  const idx = (t: Tile) => t[1] * sim.width + t[0];
  const out: string[] = [];
  if (sim.blocked[idx(L.objective)] !== 0) out.push(`${mapId}: objective (${L.objective.join(',')}) is not foot-open`);
  if (sim.blockedVehicle[idx(L.objective)] !== 0) out.push(`${mapId}: objective (${L.objective.join(',')}) has no vehicle-open LZ on it`);
  for (const t of [...L.squads, L.manpad, L.close.manpad]) if (sim.blocked[idx(t)] !== 0) out.push(`${mapId}: foot spawn (${t.join(',')}) is blocked`);
  for (const t of [L.kipod, L.gun, L.close.gun]) if (sim.blockedVehicle[idx(t)] !== 0) out.push(`${mapId}: vehicle spawn (${t.join(',')}) is blocked`);
  return out;
}

function armLine(arm: Arm, runs: Run[], tag = ''): string {
  const sm = summarise(arm, runs);
  const yan = ARM_SPECS[arm].carrier === 'yanshuf';
  const kills = runs.filter((r) => r.yanshufLost).map((r) => `${STATE_NAMES[r.yanshufKillState ?? 0]}(${r.yanshufKillAboard})`);
  const n = runs.length;
  const avg = (k: (r: Run) => number) => runs.reduce((a, r) => a + k(r), 0) / n;
  const killStates = [0, 1, 2, 3].map((k) => kills.filter((x) => x.startsWith(STATE_NAMES[k] + '(')).length);
  return (
    `${(arm + tag).padEnd(2)} ${ARM_SPECS[arm].label.padEnd(24)} ${String(sm.arrived).padStart(2)}/${n}  ${f1(sm.medianS)}  ${f1(sm.minS)}  ${f1(sm.maxS)}  ` +
    `${String(sm.squadsLost).padStart(5)} ${String(runs.reduce((a, r) => a + r.squadsLostAboard, 0)).padStart(4)}  ` +
    (yan
      ? `${String(sm.yanshufLost).padStart(4)}   ${killStates.join('/').padEnd(9)}  ` +
        `${avg((r) => r.stateTicks[1]).toFixed(0)}/${avg((r) => r.stateTicks[2]).toFixed(0)}/${avg((r) => r.stateTicks[3]).toFixed(0)}`.padEnd(10) +
        `  ${[0, 1, 2, 3].map((k) => avg((r) => r.stateDamage[k]).toFixed(0)).join('/').padEnd(16)}` +
        `  ${runs.filter((r) => r.seenByAa).length}/${n}`
      : '   -')
  );
}

const HEADER =
  'arm                         arrived  med s  min s  max s  sq lost/N (aboard)  Y lost  kills A/LNG/LDD/LFT  ticks LNG/LDD/LFT  hp lost A/LNG/LDD/LFT (mean)  seen';
const HEADER_NOTE =
  '   (sq lost/N: squads dead by the end of the run, TOTAL over the N seeds (60 = all six in all ten);\n' +
  '    aboard: of those, inside a Yanshuf shot down airborne. Runs end 30 s after arrival.\n' +
  '    Y lost: runs the Yanshuf died, any phase incl. the flight home; kills/hp by airState at that tick.)';

export interface MapReport { lines: string[]; byArm: Record<Arm, ArmSummary>; close: Partial<Record<Arm, ArmSummary>>; ratio: number | null; hotPass: boolean; coldPass: boolean }

export function report(mapId: ProbeMap, seeds: number[]): MapReport {
  const lines: string[] = [];
  const byArm = {} as Record<Arm, ArmSummary>;
  const close: Partial<Record<Arm, ArmSummary>> = {};
  const L = LAYOUTS[mapId];
  lines.push(`=== ${mapId}: ${L.why}`);
  lines.push(`    objective/LZ (${L.objective.join(',')}); standoff AA: manpad (${L.manpad.join(',')}), gun_truck (${L.gun.join(',')}); ` +
    `close AA: manpad (${L.close.manpad.join(',')}), gun_truck (${L.close.gun.join(',')}); ${seeds.length} seeds; land/lift ${AIR_LAND_TICKS}/${AIR_LIFT_TICKS} ticks`);
  lines.push(HEADER);
  lines.push(HEADER_NOTE);
  for (const arm of ARMS) {
    const runs = seeds.map((sd) => run(mapId, arm, sd));
    byArm[arm] = summarise(arm, runs);
    lines.push(armLine(arm, runs));
  }
  lines.push('  -- sensitivity: the same hostile arms with the AA CLOSE to the LZ --');
  for (const arm of ['D', 'E', 'F', 'G'] as const) {
    const runs = seeds.map((sd) => run(mapId, arm, sd, { placement: 'close' }));
    close[arm] = summarise(arm, runs);
    lines.push(armLine(arm, runs, "'"));
  }
  const b = byArm.B.medianS, c = byArm.C.medianS;
  const ratio = b !== null && c !== null ? b / c : null;
  lines.push(`    time ratio vs the cold Yanshuf (C): Kipod ${ratio === null ? 'n/a' : ratio.toFixed(2) + 'x'}, ` +
    `foot ${byArm.A.medianS !== null && c !== null ? (byArm.A.medianS / c).toFixed(2) + 'x' : 'n/a'}`);
  const hot = byArm.F.yanshufLost;
  const hotPass = hot * 2 >= seeds.length;
  const coldPass = ratio !== null && ratio >= 2;
  lines.push(`    BAR hot LZ (F, standoff) kills the Yanshuf in >= half the seeds: ${hot}/${seeds.length} -> ${hotPass ? 'PASS' : 'MISS'}` +
    `   (close placement: ${close.F?.yanshufLost ?? 0}/${seeds.length})`);
  lines.push(`    BAR cold LZ (C) beats the Kipod (B) by >= 2x on time: ${ratio === null ? 'n/a' : ratio.toFixed(2) + 'x'} -> ${coldPass ? 'PASS' : 'MISS'}`);
  if (L.note) lines.push(`    NOTE ${L.note}`);
  // Land/lift exposure over every hostile run, both placements.
  const hostile = [...(['D', 'E', 'F', 'G'] as const).flatMap((a) => byArm[a].runs), ...(['D', 'E', 'F', 'G'] as const).flatMap((a) => close[a]?.runs ?? [])];
  const kills = [0, 1, 2, 3].map((k) => hostile.filter((r) => r.yanshufLost && r.yanshufKillState === k).length);
  const dmg = [0, 1, 2, 3].map((k) => hostile.reduce((a, r) => a + r.stateDamage[k], 0));
  const tks = [0, 1, 2, 3].map((k) => hostile.reduce((a, r) => a + r.stateTicks[k], 0));
  const per = (k: number) => (tks[k] === 0 ? 0 : (dmg[k] / tks[k]) * TICKS_PER_SECOND);
  const stranded = hostile.filter((r) => r.stranded).length;
  if (stranded > 0) lines.push(`    STRANDED: ${stranded} hostile run(s) ended with the Yanshuf mobility-killed in the air, riders aboard: its queued \`unload\` never completes (a hull that cannot move never reaches its LZ, so it never lands)`);
  const lost = hostile.filter((r) => r.yanshufLost);
  const approach = lost.filter((r) => r.yanshufKillAboard > 0).length;
  lines.push(`    Yanshuf kills over ${hostile.length} hostile runs: ${lost.length} -- ${approach} on the approach/landing (riders aboard), ` +
    `${lost.length - approach} on the flight home (empty)`);
  lines.push(`    land/lift exposure (shipped ${AIR_LAND_TICKS}/${AIR_LIFT_TICKS} only; no other value measured): Yanshuf kills AIR ${kills[0]} / LANDING ${kills[1]} / LANDED ${kills[2]} / LIFTING ${kills[3]}; ` +
    `hp lost ${dmg.map((d) => d.toFixed(0)).join(' / ')}; hp/s in state ${[0, 1, 2, 3].map((k) => per(k).toFixed(0)).join(' / ')}`);
  return { lines, byArm, close, ratio, hotPass, coldPass };
}

export function main(argv: readonly string[]): number {
  const seedArg = argv.find((a) => a.startsWith('--seeds='));
  const n = seedArg ? Number(seedArg.slice(8)) : SEEDS_DEFAULT;
  const seeds = Array.from({ length: n }, (_, i) => seedOf(i));
  for (const m of ['tel_marum', 'qarn_hadid'] as const) {
    for (const p of checkLayout(m)) console.log(`LAYOUT: ${p}`);
    for (const l of report(m, seeds).lines) console.log(l);
    console.log();
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
