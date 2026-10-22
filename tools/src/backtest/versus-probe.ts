// The versus probe (GH-561, GH-589): who wins a versus room's map when neither seat is clever?
//
// REPORT-ONLY. It prints a table and a 60/40 reading per cell and exits 0
// whatever they say: whether a map opens for versus is the lead's call
// (`VERSUS_FAIR_MAPS`, @lions/net), and this is the instrument the call is made
// on. The one thing that fails it (exit 2) is its own self-check, below, because
// a table from a probe that cannot tell its sides apart is worse than no table.
//
// The play. Each side's whole force attack-moves on the other side's living
// centroid, re-ordered every 20 s, until the real outcome rule decides
// (`outcomeOf`, packages/app/src/net/outcome.ts: annihilation, mutual, stalemate)
// or a 10-minute cap, which is decided on surviving unit value by that same
// rule (`outcomeOf` asked at `MATCH_CAP_TICKS`) -- not a copy of it. The forces
// are the ones a room spawns (`versusSpawns`, packages/app/src/net/versus-force.ts),
// on the room's own seats (`versusAnchors`), in a `Sim` built the way a room builds it.
// The seed varies the RNG streams and nothing else: 1000 + 7919 * n, so the same
// command prints the same table.
//
// What it cannot say. Two attack-moving blobs are not two players: it measures
// the ground and the start points under the dumbest plan both sides share, which
// is exactly what a spawn bias would show up under. A map that is lopsided here
// is lopsided for a human; a map that is even here may still be lopsided for a
// cleverer plan. And it reads a mirror cell by END (west spawn against east)
// but a KDF-against-Sarim cell by FACTION, so read the two spawn orders of that
// pairing together: a faction edge shows in both, a spawn edge flips between them.
//
// Cells are named by END since LD1 (N3 Task 2): `--arr=<friendly>/<hostile>`,
// printed "KDF friendly" or "Sarim friendly". The KDF is side 0 whichever end
// it stands on, exactly as a room seats it (`sidesOfFactions`, @lions/net), so
// "Sarim friendly" is Sarim on side 1 at the friendly anchor. Orders go out
// friendly end first, and the friendly end's force is spawned first.
//
// The seat table (N3 Task 7). Every reading is on a ROOM's table by default:
// `seatRules` of the cell's versus config (`roomConfig`), both sides held by a
// human, so neither auto-breaches walls -- what a real room plays. The old
// default, the single-player table (side 1 not held, so it auto-breaches), stays
// readable as a labelled CONTROL, `--rules=default`, printed "control:
// single-player seat table"; it is never the reading a map is opened on. At
// 0cb0ced2 the room-table placed-force cells read game for game the same as
// the base's room dump (192 of 192); the control differs from it in six
// wadi_tarfan Sarim-friendly games, wholly the breach rule.
//
// The economy arm (`--economy`, N3 Task 7). A room's own world: `buildMatchWorld`
// of the cell's config (camps, purses, doctrine menus, population caps and income
// zones from data/doctrines and data/versus), stepped by the room's `matchTick`,
// decided by `outcomeOf` with the room's production rule (`productionOf`).
// Faction cells only (a mirror room has no economy), on the maps with a rules
// file. Each side's line rallies on its own anchor; every 20 s the production
// plan (`planRound`) queues, then every living unit of each side -- the built
// ones too -- attack-moves as above. The plan, both seats alike and reading
// nothing of the other side: walk the side's ARMED menu as a cycle in doctrine
// order from the unit after the one queued last, queueing whatever `canBuild`
// accepts, until a whole turn of the cycle buys nothing. Queues go through the
// runtime's own `requestBuild(unit, undefined, side)` between ticks, which is
// what `applyQueued` does with a `build` command at the head of `matchTick`.
// Each economy cell also prints the units built and the final purse by faction.
// The sweep knobs, IN-MEMORY overrides of the shipped data for one run, never
// written to disk (`withOverrides`): `--start=<kdf>/<sarim>` start purses,
// `--pop-cap=<kdf>/<sarim>` population caps (`--cap` was already the time cap),
// `--rate-scale=<percent>` every income zone's rate, rounded down.
//
// The bar. The lead's ruling on GH-561 (2026-10-14): a map re-opens for versus only
// once its fair start points are authored and this probe reads it within 60/40
// at 48 seeds per spawn order -- `FAIR_MAX_PERCENT`, `SEEDS_DEFAULT`.
//
//   pnpm versus:probe                                 the open maps, every pairing, 48 seeds, room table
//   pnpm versus:probe -- --maps=qarn_hadid --arr=kdf/kdf
//   pnpm versus:probe -- --maps=all --arr=kdf/kdf --seeds=12     every candidate map, a quick read
//   pnpm versus:probe -- --rules=default             the single-player seat table, a CONTROL
//   pnpm versus:probe -- --economy                    both rules-file maps, both faction cells
//   pnpm versus:probe -- --economy --start=2400/3840 --seeds=24  a sweep point (in memory only)
//   flags: --maps=<id,id|all>  --arr=<kdf/kdf,kdf/sarim,sarim/kdf>  --seeds=<n>  --cap=<seconds>
//          --rules=<room|default>  --economy  --start=<k>/<s>  --pop-cap=<k>/<s>  --rate-scale=<percent>
//
// THE SELF-CHECK, and the mutation that turns it red. Before any table it plays
// two CONTROLS per map and one repeat, on the table it reads, and refuses to
// report unless they hold:
//   - the east side is cut to one unit: the west must win, by annihilation;
//   - the west side is cut to one unit: the east must win, by annihilation;
//   - one seed played twice reads the same game.
// The first two see a probe that always names the same winner, one that swaps the
// sides, and one whose orders never reach a side (nobody closes, so the game runs
// to the cap -- a win "by cap", not by annihilation). The third sees a seed that
// is not the seed. One-line mutations, each seen red in `versus-probe.test.ts`
// and listed in the commit message:
//   M1  finish(): `winner: o.kind === 'won' ? o.side : null`
//         ->  `winner: o.kind === 'won' ? (o.side === 0 ? 1 : 0) : null`
//   M2  order(): `const target = centroid(sim, side === 0 ? 1 : 0)`  ->  `centroid(sim, side)`
//         (each side marches on itself: nobody closes, the control runs to the cap)
//   M3  world(): `new Sim({ seed, ...`  ->  `new Sim({ seed: seed + (performance.now() | 0), ...`
// With `--economy` the self-check is the economy arm's own (`economySelfCheck`):
// each end's camp destroyed and force cut to one unit, the other wins by
// annihilation; each end's force wiped with its camp and purse standing, the game
// is NOT decided on the first decision tick (it can still field a unit); one seed
// twice is one game; and that game shows at least one `built` per side. Seen red
// (N3 Task 7): the plan never queues (built check), the outcome rule without
// `productionOf` (wipe control), the camp left standing in the cut control, the
// `built` count dropped, a no-op wipe (its own assertion throws).
//
// This file is a tool, not a test: nothing here runs under `pnpm test` but the
// self-check's controls (versus-probe.test.ts), and nothing reads its output.

import { fileURLToPath } from 'node:url';
import { Sim, fx } from '@lions/sim';
import { applyTerrain, doctrines, maps, parseMap, units, versusRules, type DoctrineJson, type MapId, type VersusRulesJson } from '@lions/data';
import { VERSUS_FAIR_MAPS, seatRules, sidesOfFactions, validateConfig, type Faction, type MatchConfig, type SpawnEnd } from '@lions/net';
import { standMapStructures } from '../../../packages/app/src/map-sim';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { versusForceOf, versusSpawns } from '../../../packages/app/src/net/versus-force';
import { MATCH_CAP_TICKS, outcomeOf, productionOf, unitCost, type MatchResult, type OutcomeProduction } from '../../../packages/app/src/net/outcome';
import { versusRoster } from '../../../packages/app/src/net/versus-roster';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';

/** 20 Hz, like the sim. */
const TICKS_PER_SECOND = 20;
/** Each side is re-ordered on the other's centroid this often. */
export const ORDER_EVERY_TICKS = 20 * TICKS_PER_SECOND;
/** The rule is asked this often, like a room's hash window. */
export const DECIDE_EVERY_TICKS = 20;
/** The probe's own cap, shorter than a room's 25 minutes: 10 minutes. */
export const CAP_TICKS_DEFAULT = 10 * 60 * TICKS_PER_SECOND;
/** The lead's bar (GH-561): neither side takes more than this share of the seeds. */
export const FAIR_MAX_PERCENT = 60;
/** The lead's bar: seeds per spawn order. */
export const SEEDS_DEFAULT = 48;

/** The seed of the n-th game of a cell. */
export const seedOf = (n: number): number => 1000 + n * 7919;

/** A cell's factions by END: `[friendly, hostile]` (the host's end first). */
export type Arrangement = readonly [Faction, Faction];

/** How a room lays out an arrangement (LD1): each END's side, and each SIDE's
 *  faction and end. A mirror is side 0 friendly; a faction pairing puts the
 *  KDF on side 0 at whichever end it stands. */
export interface Layout {
  sideOfEnd: [0 | 1, 0 | 1];
  factions: [Faction, Faction];
  ends: [SpawnEnd, SpawnEnd];
}
export function layoutOf(arrangement: Arrangement): Layout {
  const sideOfEnd = sidesOfFactions(arrangement);
  const factions: [Faction, Faction] = ['kdf', 'kdf'];
  const ends: [SpawnEnd, SpawnEnd] = ['friendly', 'hostile'];
  factions[sideOfEnd[0]] = arrangement[0];
  factions[sideOfEnd[1]] = arrangement[1];
  ends[sideOfEnd[0]] = 'friendly';
  ends[sideOfEnd[1]] = 'hostile';
  return { sideOfEnd, factions, ends };
}
/** How a probe game ended: `cap` is the 10-minute limit, decided on surviving value. */
export type Finish = 'annihilation' | 'mutual' | 'stalemate' | 'cap';

/** What an economy game spent and fielded, by FACTION (`[kdf, sarim]`). */
export interface EconomyRead {
  /** `built` events each faction's lines delivered. */
  built: [number, number];
  /** Each faction's purse when the game was decided, in logistics. */
  purse: [number, number];
}

export interface Played {
  /** The winning END (0 friendly/west, 1 hostile/east), or null for a draw. */
  winner: 0 | 1 | null;
  by: Finish;
  ticks: number;
  /** Economy games only (`--economy`). */
  econ?: EconomyRead;
}

/** Which seat table the world is built on. `room` (the default since N3 Task 7)
 *  is a room's own (`seatRules` of a versus config: both sides held by a human,
 *  so neither auto-breaches); `default` is the single-player table (side 1 not
 *  held, so it auto-breaches walls), kept readable as a labelled CONTROL. */
export type SeatTable = 'room' | 'default';

export interface PlayOptions {
  capTicks?: number;
  /** CONTROL ONLY: cut the force at this END (0 friendly, 1 hostile; in a
   *  mirror the same number as its side) to its first unit before the first
   *  tick. In an economy game that end's camp is destroyed at tick 0 as well,
   *  so it can field nothing more (the economy control). */
  cutSide?: 0 | 1;
  /** ECONOMY CONTROL ONLY: kill EVERY unit at this END before the first tick
   *  and leave its camp and purse standing, so all it has is production. */
  wipeSide?: 0 | 1;
  /** The seat table (placed-force games; an economy game is a room's world,
   *  always on `room`). Default `room`. */
  rules?: SeatTable;
  /** Play a room's economy world (`buildMatchWorld` + `matchTick`): camps,
   *  purses, doctrine menus, income zones, the production plan. Faction cells only. */
  economy?: boolean;
  /** MUTATION SEAM, default true: false is the "the plan never queues"
   *  mutation the economy self-check must see (at least one `built` per side). */
  plan?: boolean;
}

/** A versus room's config for a cell, as a room mints it (LD1: the side
 *  follows the faction, the end the seat; the host, seat 0, stands friendly). */
export function roomConfig(mapId: MapId, arrangement: Arrangement, seed: number): MatchConfig {
  const sides = sidesOfFactions(arrangement);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: arrangement[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'probe', code: 'PROBE0', seed, map: mapId, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'probe', dataDigest: 0 });
  if (c === null) throw new Error(`versus probe: no valid room config for ${mapId} ${arrangement.join('/')}`);
  return c;
}

/** The `humanHeld` table a cell's world is built on: a room's (`seatRules` of
 *  its versus config, `[true, true]`) or the single-player control's. */
export function humanHeldOf(rules: SeatTable, mapId: MapId, arrangement: Arrangement, seed: number): readonly [boolean, boolean] | undefined {
  return rules === 'room' ? seatRules(roomConfig(mapId, arrangement, seed)).humanHeld : undefined;
}

export function world(mapId: MapId, seed: number, humanHeld?: readonly [boolean, boolean]) {
  const map = parseMap(maps[mapId]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256, ...(humanHeld ? { humanHeld } : {}) });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  // A room's roster, not the shipped one: `VERSUS_HELD_UNITS` stays out (GH-698).
  for (const u of versusRoster()) typeOf.set(u.id, sim.addUnitType(u as never));
  return { sim, typeOf, map };
}

/** The raw Q16.16 centroid of a side's living units, or null when none live. */
export function centroid(sim: Sim, side: number): [number, number] | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] !== 1 || sim.state.side[i] !== side) continue;
    x += sim.state.posX[i];
    y += sim.state.posY[i];
    n++;
  }
  return n === 0 ? null : [Math.round(x / n), Math.round(y / n)];
}

/** Both sides march their living units on the other's centroid, the friendly
 *  end's side first. `idsOf(side)` names who is ordered: the spawned force in
 *  a placed-force game, every living unit of the side (the built ones too) in
 *  an economy game. */
function order(sim: Sim, idsOf: (side: 0 | 1) => number[], sideOfEnd: readonly [0 | 1, 0 | 1]): void {
  for (const side of sideOfEnd) {
    const target = centroid(sim, side === 0 ? 1 : 0);
    const ids = idsOf(side).filter((id) => sim.state.alive[id] === 1);
    if (target && ids.length > 0) sim.queueCommand({ kind: 'attackMove', ids, x: target[0], y: target[1] });
  }
}

/** Every living unit of `side`, in id order. */
function livingOf(sim: Sim, side: 0 | 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.side[i] === side) out.push(i);
  return out;
}

/** A decided result, in the probe's terms: the winning side read back as its END. */
function finish(o: MatchResult, ticks: number, sideOfEnd: readonly [0 | 1, 0 | 1]): Played {
  const by: Finish = o.by === 'annihilation' || o.by === 'mutual' || o.by === 'stalemate' ? o.by : 'cap';
  return { winner: o.kind === 'won' ? (sideOfEnd[0] === o.side ? 0 : 1) : null, by, ticks };
}

/** One game: `arrangement[0]` on the friendly (west) spawn, `arrangement[1]` on
 *  the hostile (east) one, each on the side a room would seat it (`layoutOf`). */
export function play(mapId: MapId, arrangement: Arrangement, seed: number, opts: PlayOptions = {}): Played {
  if (opts.economy === true) return playEconomy(mapId, arrangement, seed, opts);
  const capTicks = opts.capTicks ?? CAP_TICKS_DEFAULT;
  const { sim, typeOf, map } = world(mapId, seed, humanHeldOf(opts.rules ?? 'room', mapId, arrangement, seed));
  const { sideOfEnd, factions, ends } = layoutOf(arrangement);
  const force = versusSpawns(sim, typeOf, versusAnchors(map), factions, ends);
  if (opts.cutSide !== undefined) for (const id of force.bySide[sideOfEnd[opts.cutSide]].slice(1)) sim.debugKill(id);
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) order(sim, (side) => force.bySide[side], sideOfEnd);
    sim.tick();
    if (sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(sim, sim.tickCount);
      if (o.kind !== 'ongoing') return finish(o, sim.tickCount, sideOfEnd);
    }
  }
  // The cap: the real rule, asked as if the real cap had come -- the higher
  // surviving value wins, equal values draw. Never 'ongoing' there.
  const o = outcomeOf(sim, MATCH_CAP_TICKS);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return finish(o, sim.tickCount, sideOfEnd);
}

// ---------------------------------------------------------------------------
// The economy arm (N3 Task 7)
// ---------------------------------------------------------------------------

/** A shipped unit id that carries a weapon (the outcome rule's own "armed"). */
const armed = (id: string): boolean => ((units as Record<string, { weapons?: readonly unknown[] } | undefined>)[id]?.weapons?.length ?? 0) > 0;

/**
 * The production plan, one side, one round (every `ORDER_EVERY_TICKS`, both
 * seats alike, deterministic, nothing read of the other side): the side's
 * ARMED doctrine menu is a cycle in doctrine order, and the plan walks it from
 * the unit after the one it queued last, queueing each unit `canBuild`
 * accepts (`requestBuild` asks `canBuild` first), until a whole turn of the cycle finds nothing it can buy. So the
 * unit queued last is never queued again while another is affordable, and a
 * short purse fills with the cheapest units it still covers. Each queue is
 * the runtime's own `requestBuild(unit, undefined, side)` -- the shortest
 * line, exactly what a queued `build` command does in `applyQueued` -- called
 * between ticks, just before the `matchTick` that would drain such a command.
 * Returns the new cursor (the menu index queued last, -1 before any).
 */
export function planRound(runtime: NonNullable<MatchWorld['runtime']>, menu: readonly string[], side: 0 | 1, cursor: number): number {
  const cycle = menu.filter(armed);
  let at = cursor;
  for (;;) {
    let queued = false;
    for (let k = 1; k <= cycle.length; k++) {
      const i = (at + k) % cycle.length;
      if (runtime.requestBuild(cycle[i], undefined, side)) {
        at = i;
        queued = true;
        break;
      }
    }
    if (!queued) return at;
  }
}

/** One economy game: a room's world for the cell (`buildMatchWorld` of
 *  `roomConfig`, so a room's seat table, camps, purses and menus), stepped by
 *  the room's own `matchTick`, decided by `outcomeOf` with the room's
 *  production rule (`productionOf`). Each side's line rallies on its own
 *  anchor; every round the plan queues, then every living unit attack-moves. */
export function playEconomy(mapId: MapId, arrangement: Arrangement, seed: number, opts: PlayOptions = {}): Played {
  if (arrangement[0] === arrangement[1]) throw new Error('versus probe: --economy plays a KDF-against-Sarim cell only (a mirror room has no economy)');
  const capTicks = opts.capTicks ?? CAP_TICKS_DEFAULT;
  const w = buildMatchWorld(roomConfig(mapId, arrangement, seed));
  const runtime = w.runtime;
  if (runtime === null) throw new Error(`versus probe: ${mapId} built no economy runtime`);
  const production: OutcomeProduction | undefined = productionOf(w);
  const { sideOfEnd } = layoutOf(arrangement);
  for (const side of [0, 1] as const) {
    const [ax, ay] = w.anchors[w.endOfSide[side]];
    if (!runtime.setRally(0, fx.from(ax), fx.from(ay), side)) throw new Error(`versus probe: ${mapId} side ${side} refused a rally on its own anchor`);
  }
  if (opts.cutSide !== undefined) {
    const side = sideOfEnd[opts.cutSide];
    for (const id of w.bySide[side].slice(1)) w.sim.debugKill(id);
    for (const line of runtime.productionLines(side)) if (line.anchor >= 0) w.sim.debugDestroyStructure(line.anchor);
  }
  if (opts.wipeSide !== undefined) {
    const side = sideOfEnd[opts.wipeSide];
    for (const id of w.bySide[side]) w.sim.debugKill(id);
    // The control means nothing if a unit is left standing: then the end is not beaten anyway.
    if (livingOf(w.sim, side).length !== 0) throw new Error('versus probe: the wipe control left a unit standing');
  }
  const menus = [doctrines[w.factions[0]].menu, doctrines[w.factions[1]].menu] as const;
  const cursor: [number, number] = [-1, -1];
  const builtBySide: [number, number] = [0, 0];
  const read = (o: MatchResult): Played => {
    const kdf = w.factions[0] === 'kdf' ? 0 : 1;
    const sarim = kdf === 0 ? 1 : 0;
    return {
      ...finish(o, w.sim.tickCount, sideOfEnd),
      econ: { built: [builtBySide[kdf], builtBySide[sarim]], purse: [runtime.logisticsOf(kdf), runtime.logisticsOf(sarim)] },
    };
  };
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      if (opts.plan !== false) for (const side of sideOfEnd) cursor[side] = planRound(runtime, menus[side], side, cursor[side]);
      order(w.sim, (side) => livingOf(w.sim, side), sideOfEnd);
    }
    const ev = matchTick(w);
    for (const e of ev.mission) if (e.kind === 'built') builtBySide[e.side]++;
    if (w.sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(w.sim, w.sim.tickCount, unitCost, production);
      if (o.kind !== 'ongoing') return read(o);
    }
  }
  const o = outcomeOf(w.sim, MATCH_CAP_TICKS, unitCost, production);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return read(o);
}

/** The sweep's knobs (Task 7 Step 4), each an IN-MEMORY override of the
 *  shipped data for the length of a run, never written to disk: start purses
 *  and population caps by faction, and every income zone's rate scaled by a
 *  whole percent (rounded down, so the runtime still reads whole logistics). */
export interface Overrides {
  start?: readonly [number, number];
  popCap?: readonly [number, number];
  rateScalePercent?: number;
}

/** Runs `fn` with `o` laid over `doctrines` and `versusRules`, and puts the
 *  shipped objects back afterwards, whatever `fn` does. */
export function withOverrides<T>(o: Overrides, fn: () => T): T {
  const docs = doctrines as Record<'kdf' | 'sarim', DoctrineJson>;
  const rules = versusRules as Record<string, VersusRulesJson>;
  const savedDocs = { kdf: docs.kdf, sarim: docs.sarim };
  const savedRules = { ...rules };
  try {
    (['kdf', 'sarim'] as const).forEach((f, k) => {
      docs[f] = {
        ...docs[f],
        ...(o.popCap ? { pop_cap: o.popCap[k] } : {}),
        budget: { ...docs[f].budget, ...(o.start ? { logistics_start: o.start[k] } : {}) },
      };
    });
    if (o.rateScalePercent !== undefined) {
      const pct = o.rateScalePercent;
      for (const [id, r] of Object.entries(savedRules)) {
        rules[id] = { ...r, income_zones: r.income_zones.map((z) => ({ zone: z.zone, rate_per_min: Math.floor((z.rate_per_min * pct) / 100) })) };
      }
    }
    return fn();
  } finally {
    docs.kdf = savedDocs.kdf;
    docs.sarim = savedDocs.sarim;
    for (const id of Object.keys(savedRules)) rules[id] = savedRules[id];
  }
}

/** A cell's name by END (LD1): `kdf/kdf` for the mirror, else "KDF friendly" / "Sarim friendly". */
export function cellName(arrangement: Arrangement): string {
  if (arrangement[0] === arrangement[1]) return `${arrangement[0]}/${arrangement[1]}`;
  return arrangement[0] === 'kdf' ? 'KDF friendly' : 'Sarim friendly';
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

export interface Tally {
  seeds: number;
  wins: [number, number];
  draws: number;
  by: Record<Finish, number>;
  ticks: number;
  /** Economy games: totals by FACTION (`[kdf, sarim]`) over the cell; absent otherwise. */
  econ?: EconomyRead;
}

/** The games of one cell, counted. */
export function tally(games: readonly Played[]): Tally {
  const t: Tally = { seeds: games.length, wins: [0, 0], draws: 0, by: { annihilation: 0, mutual: 0, stalemate: 0, cap: 0 }, ticks: 0 };
  for (const g of games) {
    if (g.winner === null) t.draws++; else t.wins[g.winner]++;
    t.by[g.by]++;
    t.ticks += g.ticks;
    if (g.econ) {
      t.econ ??= { built: [0, 0], purse: [0, 0] };
      for (const k of [0, 1] as const) {
        t.econ.built[k] += g.econ.built[k];
        t.econ.purse[k] += g.econ.purse[k];
      }
    }
  }
  return t;
}

export interface Reading {
  /** The two contenders and their wins: west/east for a mirror, KDF/Sarim otherwise. */
  labels: [string, string];
  wins: [number, number];
  /** The contender ahead, or null when level. */
  leader: string | null;
  /** The leader's share of ALL the seeds, in percent to one decimal (a draw is no one's). */
  leaderPercent: number;
  /** Whether neither contender takes more than `FAIR_MAX_PERCENT` of the seeds. */
  within: boolean;
}

/** Reads a cell: a mirror by end, a KDF-against-Sarim cell by faction. */
export function reading(arrangement: Arrangement, t: Tally): Reading {
  const mirror = arrangement[0] === arrangement[1];
  // `t.wins` is by END. A cell with the KDF on the east spawn lists its wins in the faction order, KDF first.
  const wins: [number, number] = mirror
    ? [t.wins[0], t.wins[1]]
    : arrangement[0] === 'kdf' ? [t.wins[0], t.wins[1]] : [t.wins[1], t.wins[0]];
  const labels: [string, string] = mirror ? ['west', 'east'] : ['KDF', 'Sarim'];
  const top = Math.max(wins[0], wins[1]);
  return {
    labels,
    wins,
    leader: wins[0] === wins[1] ? null : wins[0] > wins[1] ? labels[0] : labels[1],
    // One decimal: 29 of 48 must not print as a rounded 60% beside OUTSIDE.
    leaderPercent: t.seeds === 0 ? 0 : Math.round((1000 * top) / t.seeds) / 10,
    // Integer arithmetic: 29 of 48 is 60.4%, over; 28 of 48 is 58.3%, within.
    within: top * 100 <= FAIR_MAX_PERCENT * t.seeds,
  };
}

// ---------------------------------------------------------------------------
// The self-check
// ---------------------------------------------------------------------------

/** What the controls call to play a game: the real `play`, or a broken one in a test. */
export type PlayFn = typeof play;

/** The controls on one map; each failure is a sentence. Empty means the probe can tell its sides apart. */
export function selfCheck(mapId: MapId, playFn: PlayFn = play, rules: SeatTable = 'room'): string[] {
  const failures: string[] = [];
  const seed = seedOf(0);
  for (const strong of [0, 1] as const) {
    const g = playFn(mapId, ['kdf', 'kdf'], seed, { cutSide: strong === 0 ? 1 : 0, rules });
    if (g.winner !== strong || g.by !== 'annihilation') {
      failures.push(`${mapId}: with side ${strong === 0 ? 1 : 0} cut to one unit, side ${strong} should win by annihilation; read winner ${String(g.winner)} by ${g.by}`);
    }
  }
  const a = playFn(mapId, ['kdf', 'kdf'], seed, { rules });
  const b = playFn(mapId, ['kdf', 'kdf'], seed, { rules });
  if (a.winner !== b.winner || a.by !== b.by || a.ticks !== b.ticks) {
    failures.push(`${mapId}: one seed played twice read two games (${String(a.winner)}/${a.by}/${a.ticks} then ${String(b.winner)}/${b.by}/${b.ticks})`);
  }
  return failures;
}

/**
 * The economy arm's own controls (`--economy`); each failure is a sentence.
 *   - each END in turn has its camp destroyed at tick 0 and its force cut to
 *     one unit: the other end must win, by annihilation (sees a swapped side,
 *     orders that never close, and a production rule that keeps a side with no
 *     line standing);
 *   - each END in turn loses its whole force at tick 0 but keeps its camp and
 *     purse: the game must NOT be decided at the first decision tick, because
 *     that end can still field an armed unit (sees an outcome rule that
 *     forgets production, `productionOf`, which the first control cannot);
 *   - one uncut seed played twice reads the same game;
 *   - in that game each side's lines delivered at least one unit (sees a plan
 *     that never queues, which the first control cannot: there the weak side
 *     has no camp and the strong one wins with its placed force alone).
 */
export function economySelfCheck(mapId: MapId, playFn: PlayFn = play): string[] {
  const failures: string[] = [];
  const seed = seedOf(0);
  const arr: Arrangement = ['kdf', 'sarim'];
  for (const strong of [0, 1] as const) {
    const weak = strong === 0 ? 1 : 0;
    const g = playFn(mapId, arr, seed, { economy: true, cutSide: weak });
    if (g.winner !== strong || g.by !== 'annihilation') {
      failures.push(`${mapId} (economy): with end ${weak}'s camp destroyed and its force cut to one unit, end ${strong} should win by annihilation; read winner ${String(g.winner)} by ${g.by}`);
    }
  }
  for (const bare of [0, 1] as const) {
    const g = playFn(mapId, arr, seed, { economy: true, wipeSide: bare });
    if (g.ticks <= DECIDE_EVERY_TICKS) {
      failures.push(`${mapId} (economy): end ${bare} with no unit but a camp and a purse can still field one, so it should not be beaten at tick ${DECIDE_EVERY_TICKS}; read winner ${String(g.winner)} by ${g.by} at tick ${g.ticks}`);
    }
  }
  const a = playFn(mapId, arr, seed, { economy: true });
  const b = playFn(mapId, arr, seed, { economy: true });
  if (a.winner !== b.winner || a.by !== b.by || a.ticks !== b.ticks) {
    failures.push(`${mapId} (economy): one seed played twice read two games (${String(a.winner)}/${a.by}/${a.ticks} then ${String(b.winner)}/${b.by}/${b.ticks})`);
  }
  const built = a.econ?.built ?? [0, 0];
  if (built[0] < 1 || built[1] < 1) {
    failures.push(`${mapId} (economy): each side should field at least one built unit in a game; read KDF ${built[0]}, Sarim ${built[1]}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/** Every shipped map a room could be hosted on if the lead opened it: not a tile study, not the tutorial. */
export function candidateMaps(): MapId[] {
  return (Object.keys(maps) as MapId[]).filter((id) => !id.startsWith('tile_') && id !== 'tutorial_ground');
}

const flag = (args: readonly string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export function parseArrangements(raw: string): Arrangement[] {
  return raw.split(',').map((a) => {
    const [x, y, ...rest] = a.split('/');
    const ok = (f: string | undefined): f is Faction => f === 'kdf' || f === 'sarim';
    if (!ok(x) || !ok(y) || rest.length > 0) throw new Error(`--arr: "${a}" is not <faction>/<faction> (kdf or sarim)`);
    return [x, y] as const;
  });
}

const valueOf = (f: Faction): number => versusForceOf(f).reduce((s, [id]) => s + unitCost(id), 0);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);

/** `<a>/<b>` as two whole numbers, for `--start` and `--pop-cap`. */
export function parsePair(name: string, raw: string): [number, number] {
  const parts = raw.split('/');
  const nums = parts.map(Number);
  if (parts.length !== 2 || !nums.every((n) => Number.isInteger(n) && n >= 0)) throw new Error(`--${name}: "${raw}" is not <kdf>/<sarim> as two whole numbers`);
  return [nums[0], nums[1]];
}

/** Prints the report and returns the exit code: 0 for any reading, 2 when the self-check fails. */
export function main(args: readonly string[] = process.argv.slice(2), playFn: PlayFn = play): number {
  const economy = args.includes('--economy');
  const rulesArg = flag(args, 'rules') ?? 'room';
  if (rulesArg !== 'room' && rulesArg !== 'default') throw new Error(`--rules: "${rulesArg}" is not room or default`);
  const rules: SeatTable = rulesArg;
  if (economy && rules !== 'room') throw new Error('--economy plays a room\'s world, on the room\'s seat table: --rules=default does not apply');
  const mapArg = flag(args, 'maps');
  const mapIds = mapArg === 'all' ? candidateMaps() : (mapArg?.split(',') ?? (economy ? Object.keys(versusRules) : VERSUS_FAIR_MAPS)) as MapId[];
  for (const id of mapIds) if (!(id in maps)) throw new Error(`--maps: "${id}" is not a shipped map`);
  if (economy) for (const id of mapIds) if (!Object.hasOwn(versusRules, id)) throw new Error(`--maps: "${id}" has no versus rules file, so no economy room can be hosted on it`);
  const arrangements = parseArrangements(flag(args, 'arr') ?? (economy ? 'kdf/sarim,sarim/kdf' : 'kdf/kdf,kdf/sarim,sarim/kdf'));
  if (economy && arrangements.some(([a, b]) => a === b)) throw new Error('--economy plays a KDF-against-Sarim cell only (a mirror room has no economy)');
  const seeds = Number(flag(args, 'seeds') ?? SEEDS_DEFAULT);
  const capTicks = Math.round(Number(flag(args, 'cap') ?? CAP_TICKS_DEFAULT / TICKS_PER_SECOND) * TICKS_PER_SECOND);
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');
  const startArg = flag(args, 'start');
  const popArg = flag(args, 'pop-cap');
  const rateArg = flag(args, 'rate-scale');
  const overrides: Overrides = {
    ...(startArg !== undefined ? { start: parsePair('start', startArg) } : {}),
    ...(popArg !== undefined ? { popCap: parsePair('pop-cap', popArg) } : {}),
    ...(rateArg !== undefined ? { rateScalePercent: Number(rateArg) } : {}),
  };
  if (overrides.rateScalePercent !== undefined && !(Number.isInteger(overrides.rateScalePercent) && overrides.rateScalePercent >= 0)) throw new Error('--rate-scale must be a whole percent');
  if (!economy && Object.keys(overrides).length > 0) throw new Error('--start, --pop-cap and --rate-scale sweep the economy: they need --economy');
  return withOverrides(overrides, () => report({ economy, rules, mapIds, arrangements, seeds, capTicks, overrides, playFn }));
}

function report(r: { economy: boolean; rules: SeatTable; mapIds: MapId[]; arrangements: Arrangement[]; seeds: number; capTicks: number; overrides: Overrides; playFn: PlayFn }): number {
  const { economy, rules, mapIds, arrangements, seeds, capTicks, playFn } = r;
  console.log(`versus probe (report-only): force value kdf ${valueOf('kdf')}, sarim ${valueOf('sarim')}; ${seeds} seeds per cell; cap ${capTicks / TICKS_PER_SECOND} s, decided on surviving value`);
  console.log(`bar (GH-561): within ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT} at ${SEEDS_DEFAULT} seeds per spawn order; open now: ${VERSUS_FAIR_MAPS.join(', ')}`);
  console.log(rules === 'room'
    ? 'seat table: room (humanHeld [true, true], seatRules of a versus config)'
    : 'control: single-player seat table (humanHeld [true, false]: side 1 auto-breaches) -- NOT a room\'s reading');
  if (economy) {
    const d = doctrines;
    const rate = r.overrides.rateScalePercent;
    console.log(`economy: buildMatchWorld + matchTick; start kdf ${d.kdf.budget.logistics_start} / sarim ${d.sarim.budget.logistics_start}; pop cap kdf ${String(d.kdf.pop_cap)} / sarim ${String(d.sarim.pop_cap)}; income ${rate === undefined ? 'as shipped' : `scaled to ${rate}%`}${Object.keys(r.overrides).length > 0 ? ' (IN-MEMORY SWEEP OVERRIDE, not the shipped data)' : ''}`);
  }

  // The controls first: a probe that cannot pass them reports nothing.
  const failed = mapIds.flatMap((id) => (economy ? economySelfCheck(id, playFn) : selfCheck(id, playFn, rules)));
  if (failed.length > 0) {
    console.error('SELF-CHECK FAILED -- the probe cannot tell its sides apart, so no table is printed:');
    for (const f of failed) console.error(`  ${f}`);
    return 2;
  }
  console.log(economy
    ? `self-check: ${mapIds.length} map(s), 4 economy controls, a repeat and a built-per-side check each -- passed`
    : `self-check: ${mapIds.length} map(s), 2 controls and a repeat each -- passed`);

  console.log(`${pad('map', 24)}${pad('cell', 16)}${pad('west', 6)}${pad('east', 6)}${pad('draw', 6)}${pad('annih/stale/cap/mutual', 24)}${pad('mean min', 10)}${economy ? `${pad('built K/S', 14)}${pad('purse K/S', 14)}` : ''}reading`);
  for (const id of mapIds) {
    for (const arr of arrangements) {
      const games: Played[] = [];
      for (let n = 0; n < seeds; n++) games.push(playFn(id, arr, seedOf(n), { capTicks, rules, economy }));
      const t = tally(games);
      const rd = reading(arr, t);
      const lean = rd.leader === null ? 'level' : `${rd.leader} ${rd.leaderPercent}%`;
      const mean = (x: number) => (x / seeds).toFixed(1);
      const econ = economy && t.econ
        ? `${pad(`${mean(t.econ.built[0])}/${mean(t.econ.built[1])}`, 14)}${pad(`${Math.round(t.econ.purse[0] / seeds)}/${Math.round(t.econ.purse[1] / seeds)}`, 14)}`
        : '';
      console.log(
        `${pad(id, 24)}${pad(cellName(arr), 16)}${pad(t.wins[0], 6)}${pad(t.wins[1], 6)}${pad(t.draws, 6)}` +
          `${pad(`${t.by.annihilation}/${t.by.stalemate}/${t.by.cap}/${t.by.mutual}`, 24)}${pad((t.ticks / seeds / (60 * TICKS_PER_SECOND)).toFixed(1), 10)}${econ}` +
          `${lean}  ${rd.within ? `within ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT}` : `OUTSIDE ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT}`}${t.seeds < SEEDS_DEFAULT ? `  (only ${t.seeds} seeds: the bar is ${SEEDS_DEFAULT})` : ''}`,
      );
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
