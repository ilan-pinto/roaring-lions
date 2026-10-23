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
// nothing of the other side, REBUILDS TOWARD THE DOCTRINE'S OWN FORCE MIX: while
// `canBuild` accepts something, queue the armed menu unit with the lowest
// (living + queued + in progress) / (how many the placed versus force fields,
// at least 1), ties by menu order, falling through to the next by that ratio
// when one is refused; never an unarmed unit (`planRound` says why this rule,
// and what it replaced). Queues go through the
// runtime's own `requestBuild(unit, undefined, side)` between ticks, which is
// what `applyQueued` does with a `build` command at the head of `matchTick`.
// Each economy cell also prints the units built and the final purse by faction.
// The sweep knobs, IN-MEMORY overrides of the shipped data for one run, never
// written to disk (`withOverrides`): `--start=<kdf>/<sarim>` start purses,
// `--pop-cap=<kdf>/<sarim>` population caps (`--cap` was already the time cap),
// `--rate-scale=<percent>` every income zone's rate, rounded down.
//
// The tunnel arm (`--tunnels`, implies `--economy`; GH-681 T5, spec §7). The
// economy arm's rooms, which register the Sarim end's routes from the rules file
// (T3), played four ways per map and spawn order: 1 `off` (routes registered,
// never ordered), 2 the Sarim tunnel plan against the KDF's economy plan, 3 the
// Sarim tunnel plan against the KDF answer, 4 the turtle (enter, never vent)
// against the KDF answer. The plans are `TunnelPlan`'s, and each cell prints the
// counts that prove they ran: units entered, stalled walks, surfaced events,
// raids, exits, Sarim routes the KDF identified, charges ordered, routes
// collapsed and the units below when one did. The KDF's march aims at the
// Sarim SURFACE centroid (`centroid`): a buried unit gives nothing away. The
// bar (lead, Q1) is printed under the table, report-only: cell 3 within 60/40
// in both spawn orders; cell 2 a Sarim edge over cell 1; cell 4 not a Sarim win.
// Its own self-check (exit 2, `tunnelSelfCheck`), after the economy controls:
// cell 2 shows at least one `surfaced` per map and spawn order, and cell 1 is,
// seed for seed, the game an economy room with NO versus route plays
// (`withoutVersusRoutes`) -- an unordered route must be inert. Seen red: the
// sim's `applyEnterTunnel` made a no-op (exit 2, cell 2 never surfaced); the
// plan scripting Sarim in the `off` cell (exit 2, cell 1 differs).
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
//   pnpm versus:probe -- --tunnels                    the tunnel arm's four cells, both rules-file maps
//   flags: --maps=<id,id|all>  --arr=<kdf/kdf,kdf/sarim,sarim/kdf>  --seeds=<n>  --cap=<seconds>
//          --rules=<room|default>  --economy  --tunnels  --start=<k>/<s>  --pop-cap=<k>/<s>  --rate-scale=<percent>
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
// `built` count dropped, a no-op wipe (its own assertion throws). The plan's own
// tests (literal menus, a symmetry test across the ends) were seen red under: the
// weights ignored, an unarmed unit allowed, no fall-through past a refusal, the
// in-progress item / the queued items / the living units not counted, the highest
// ratio first, and ties in reverse menu order. One survivor, disclosed: dropping the
// side filter from the living count changes nothing, because the two factions'
// menus share no unit type (a room's economy is never a mirror).
//
// This file is a tool, not a test: nothing here runs under `pnpm test` but the
// self-check's controls (versus-probe.test.ts), and nothing reads its output.

import { fileURLToPath } from 'node:url';
import { Sim, fx, type SimEvent } from '@lions/sim';
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
  /** Tunnel-arm games only (`--tunnels`): the counts that prove the plans ran. */
  tun?: TunnelRead;
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
  /** The tunnel arm's cell (`--tunnels`, GH-681): an economy game with the
   *  Sarim tunnel plan and/or the KDF answer laid over it. Implies `economy`. */
  tunnels?: TunnelCell;
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

/** The raw Q16.16 centroid of a side's living SURFACE units that can fight, or
 *  null when none. A buried unit (GH-681, the tunnel arm) is left out: the
 *  other seat cannot see it, so it must not steer that seat's march -- and
 *  outside the tunnel arm nothing is ever buried. A man down (`sim.isDown`,
 *  GH-707: wounds are on in versus since 23 Oct 2026) is left out too: he cannot
 *  fight, so a side marches on what can shoot back, the way a player would, and
 *  the reading is the harsher of the two the versus-wounds probe measured. In a
 *  world with no wound content `isDown` is always false. */
export function centroid(sim: Sim, side: number): [number, number] | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] !== 1 || sim.state.side[i] !== side || sim.state.tunnelIn[i] >= 0 || sim.isDown(i)) continue;
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
  if (opts.economy === true || opts.tunnels !== undefined) return playEconomy(mapId, arrangement, seed, opts);
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

/** How many of each type `faction`'s placed versus force fields
 *  (`versusForceOf`): the doctrine's own force mix, which the plan rebuilds
 *  toward. */
export function forceMixOf(faction: Faction): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id] of versusForceOf(faction)) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

/**
 * The production plan, one side, one round (every `ORDER_EVERY_TICKS`, both
 * seats alike, deterministic, nothing read of the other side): REBUILD TOWARD
 * THE DOCTRINE'S OWN FORCE MIX. For each ARMED menu unit, its ratio is
 * (living + queued + in progress of that type on the side) / weight, the
 * weight being how many of it the faction's placed versus force fields
 * (`forceMixOf`), at least 1 for a menu unit the force does not field. While
 * `canBuild` accepts something, queue the unit with the LOWEST ratio, ties
 * broken by doctrine menu order; if `canBuild` refuses it (purse, population,
 * intel, queue), try the next by ratio; stop the round when none is accepted.
 * Unarmed menu units are never bought.
 *
 * Why this rule (the controller's choice, 22 Oct, after the lead's "check the
 * AI first"): the plan's first wording -- "the cheapest armed menu unit not
 * queued last time, cycling the menu in doctrine order" -- contradicts itself
 * (cheapest first, or the cycle?), and the cycle it shipped as walked the
 * menu from its head, so every round opened on the dearest units and emptied
 * the purse on them. Rebuilding the mix each force was balanced with (Sarim's
 * Kornet wall and ZU screen, KDF's combined arms) is the same rule for both
 * factions, so it is symmetric, and it buys what a side has LOST, which is
 * what a player re-equipping a line does.
 *
 * Each queue is the runtime's own `requestBuild(unit, undefined, side)` -- the
 * shortest line, exactly what a queued `build` command does in `applyQueued`
 * -- called between ticks, just before the `matchTick` that would drain such
 * a command. Returns the units queued this round, in order.
 */
export function planRound(runtime: NonNullable<MatchWorld['runtime']>, sim: Sim, menu: readonly string[], mix: ReadonlyMap<string, number>, side: 0 | 1): string[] {
  const cands = menu.filter(armed);
  const have = new Map<string, number>(cands.map((id) => [id, 0]));
  const bump = (id: string): void => {
    const n = have.get(id);
    if (n !== undefined) have.set(id, n + 1);
  };
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] !== 1 || sim.state.side[i] !== side) continue;
    bump(sim.unitTypes[sim.state.typeIdx[i]]?.id ?? '');
  }
  for (const line of runtime.productionLines(side)) {
    if (line.current !== null) bump(line.current);
    for (const id of line.items) bump(id);
  }
  const weight = (id: string): number => Math.max(1, mix.get(id) ?? 0);
  const queued: string[] = [];
  for (;;) {
    // Lowest have/weight first (compared by cross-multiplication, whole numbers
    // only), ties by doctrine menu order: `cands` is in menu order and the sort is stable.
    const order = [...cands].sort((a, b) => (have.get(a) ?? 0) * weight(b) - (have.get(b) ?? 0) * weight(a));
    const pick = order.find((id) => runtime.requestBuild(id, undefined, side));
    if (pick === undefined) return queued;
    bump(pick);
    queued.push(pick);
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
  const mixes = [forceMixOf(w.factions[0]), forceMixOf(w.factions[1])] as const;
  const builtBySide: [number, number] = [0, 0];
  // The tunnel arm (GH-681): null outside it, and for its `off` cell a plan
  // that orders nothing and only counts, so `off` plays the economy arm's game.
  const tp = opts.tunnels !== undefined ? new TunnelPlan(w, opts.tunnels) : null;
  const read = (o: MatchResult): Played => {
    const kdf = w.factions[0] === 'kdf' ? 0 : 1;
    const sarim = kdf === 0 ? 1 : 0;
    return {
      ...finish(o, w.sim.tickCount, sideOfEnd),
      econ: { built: [builtBySide[kdf], builtBySide[sarim]], purse: [runtime.logisticsOf(kdf), runtime.logisticsOf(sarim)] },
      ...(tp ? { tun: tp.read() } : {}),
    };
  };
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      if (opts.plan !== false) {
        tp?.beforeProduction(runtime);
        for (const side of sideOfEnd) planRound(runtime, w.sim, menus[side], mixes[side], side);
      }
      tp?.round(t);
      order(w.sim, (side) => livingOf(w.sim, side).filter((id) => tp === null || !tp.holds(id)), sideOfEnd);
    }
    if (tp !== null && t % DECIDE_EVERY_TICKS === 0) tp.second(t);
    tp?.beforeTick();
    const ev = matchTick(w);
    tp?.after(ev.sim);
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

// ---------------------------------------------------------------------------
// The tunnel arm (GH-681, versus tunnels T5)
// ---------------------------------------------------------------------------

/** The four cells of the tunnel arm (spec §7.2), per map and spawn order:
 *  `off` the economy arm with the routes registered and never ordered;
 *  `noAnswer` the Sarim tunnel plan against the KDF's economy plan;
 *  `answer` the Sarim tunnel plan against the KDF answer;
 *  `turtle` the Sarim entry with no vent ever, against the KDF answer. */
export type TunnelCell = 'off' | 'noAnswer' | 'answer' | 'turtle';
export const TUNNEL_CELLS: readonly TunnelCell[] = ['off', 'noAnswer', 'answer', 'turtle'];
const TUNNEL_CELL_NAME: Record<TunnelCell, string> = { off: '1 off', noAnswer: '2 on, no answer', answer: '3 on, answer', turtle: '4 turtle' };

/** What proves a tunnel game's plans ran, per game (and summed per cell). */
export interface TunnelRead {
  /** Sarim units that went below on an `enterTunnel` (a raider going back down is not counted). */
  entered: number;
  /** Sarim units ordered in that never got below within `WALK_GIVE_UP_TICKS` and were released. */
  stalled: number;
  /** `surfaced` events (raids and exits). */
  surfaced: number;
  /** `vent raid` orders, one per unit. */
  raids: number;
  /** `vent exit` orders, one per unit. */
  exits: number;
  /** Sarim routes side 0 (the KDF) held IDENTIFIED (`tunnelContactLevel` 2) at any second. */
  identified: number;
  /** `chargeTunnel` orders the KDF answer gave, one per squad and route. */
  charges: number;
  /** `tunnelCollapsed` events. */
  collapsed: number;
  /** Units below on a route in the tick it collapsed. */
  collapseKills: number;
}
const zeroRead = (): TunnelRead => ({ entered: 0, stalled: 0, surfaced: 0, raids: 0, exits: 0, identified: 0, charges: 0, collapsed: 0, collapseKills: 0 });

/** A unit ordered into a route that is not below this long is released to the attack-move. */
export const WALK_GIVE_UP_TICKS = 90 * TICKS_PER_SECOND;
/** A raider still up this long (a raid held by a long burst) is released to the attack-move. */
export const RAID_GIVE_UP_TICKS = 60 * TICKS_PER_SECOND;
/** The drone takes its next sweep waypoint within this many tiles of the current one (Q16.16 squared). */
const DRONE_REACH_SQ = 2 * 2;

/** `Sim.losRay`, the sim's own sight line -- private, so read through a cast
 *  rather than COPIED into the probe (a copy drifts). A rename throws here,
 *  loudly, on the first raid check. -1 when the ray is blocked. */
function losRay(sim: Sim, x0: number, y0: number, x1: number, y1: number): number {
  return (sim as unknown as { losRay(x0: number, y0: number, x1: number, y1: number): number }).losRay(x0, y0, x1, y1);
}

type Fx2 = readonly [number, number];
/** Squared distance between two Q16.16 points, in whole tiles squared (doubles, exact at map scale). */
const tiles2 = (a: Fx2, b: Fx2): number => ((a[0] - b[0]) / 65536) ** 2 + ((a[1] - b[1]) / 65536) ** 2;
const tileCentre = (p: readonly [number, number]): Fx2 => [fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)];

type TunnelState = { kind: 'walk' | 'below' | 'raid'; route: number; since: number };

/**
 * Both tunnel-arm plans for one game (spec §7.1, plan Task 5). Every order goes
 * through `sim.queueCommand`, the path the economy arm's own orders take, and
 * reaches the sim at the next `matchTick` exactly as a room frame's would.
 *
 * SARIM (cells 2-4). At tick 0 the Sarim side's foot units (not air, not
 * wheeled -- the sim's own `enterTunnel` predicate) take `enterTunnel`, up to
 * each owned route's capacity, assigned round-robin over the routes, each
 * route taking the free unit nearest its mouth; at every later round a BUILT
 * foot unit is fed into a route with room the same way. Room counts the units
 * walking to it, below it and up on a raid from it. The rest play the economy
 * arm's attack-move. Every second, an arrived buried unit (`tunnelEta` 0):
 *   - `vent exit` once the KDF's surface centroid is nearer the Sarim anchor
 *     than the vent is (it then joins the attack-move);
 *   - else `vent raid` when a KDF ground unit on the surface stands within the
 *     unit's best weapon's max range of the vent and the sim's own sight line
 *     (`losRay`) from the vent tile reaches it; back below, it may raid again.
 * The turtle (cell 4) enters the same way and never vents.
 *
 * KDF ANSWER (cells 3-4). The placed `recon_drone` sweeps the Sarim routes'
 * midpoints and the anchors' midpoint in turn (the probe reads route geometry:
 * the answer an informed player gives). The production round queues one
 * `yahalom_squad` at the head of the first round. Every second, a living squad
 * with no charge under way `chargeTunnel`s the nearest Sarim route side 0 has
 * IDENTIFIED; at each round a squad with no charge moves to the drone (or,
 * with the drone dead, attack-moves with the rest).
 *
 * In `off` and for the side a cell does not script, it orders nothing; it
 * only counts. Every count is read, never written, so `off` plays exactly the
 * economy arm's game.
 */
export class TunnelPlan {
  private readonly sim: Sim;
  private readonly cell: TunnelCell;
  private readonly kdf: 0 | 1;
  private readonly sarim: 0 | 1;
  private readonly routes: number[];
  /** Each owned route's points, `w.map.tunnels[r]` (positional: entry r IS the sim's route r). */
  private readonly pointsOf = new Map<number, readonly (readonly [number, number])[]>();
  private readonly placed: Set<number>;
  private readonly sarimAnchor: Fx2;
  private readonly states = new Map<number, TunnelState>();
  private readonly ever = new Set<number>();
  private readonly ident = new Set<number>();
  private readonly charging = new Map<number, number>();
  private readonly occBefore: number[];
  private readonly drone: number;
  private readonly sweep: Fx2[];
  private sweepAt = -1;
  private readonly rangeSqOf = new Map<number, number>();
  private readonly counts = zeroRead();
  private queuedSquad = false;

  constructor(w: MatchWorld, cell: TunnelCell) {
    this.sim = w.sim;
    this.cell = cell;
    this.kdf = w.factions[0] === 'kdf' ? 0 : 1;
    this.sarim = this.kdf === 0 ? 1 : 0;
    this.routes = [];
    for (let r = 0; r < w.sim.tunnelCount; r++) if (w.sim.tunnelOwner(r) === this.sarim) this.routes.push(r);
    for (const r of this.routes) this.pointsOf.set(r, w.map.tunnels[r].points);
    if (this.routes.length === 0) throw new Error('versus probe (--tunnels): the room registered no Sarim route');
    this.occBefore = this.routes.map(() => 0);
    this.placed = new Set(w.bySide[this.sarim]);
    this.sarimAnchor = tileCentre(w.anchors[w.endOfSide[this.sarim]]);
    const kdfAnchor = tileCentre(w.anchors[w.endOfSide[this.kdf]]);
    this.drone = w.bySide[this.kdf].find((id) => this.typeId(id) === 'recon_drone') ?? -1;
    const mid = (a: Fx2, b: Fx2): Fx2 => [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
    this.sweep = [
      ...this.routes.map((r) => {
        const pts = w.map.tunnels[r].points;
        return tileCentre(pts[Math.floor(pts.length / 2)]);
      }),
      mid(kdfAnchor, this.sarimAnchor),
    ];
  }

  private typeId(id: number): string {
    return this.sim.unitTypes[this.sim.state.typeIdx[id]]?.id ?? '';
  }
  private get sarimPlays(): boolean {
    return this.cell !== 'off';
  }
  private get kdfAnswers(): boolean {
    return this.cell === 'answer' || this.cell === 'turtle';
  }
  private alive(id: number): boolean {
    return id >= 0 && this.sim.state.alive[id] === 1;
  }

  /** Whether the economy arm's attack-move leaves `id` alone this round. */
  holds(id: number): boolean {
    if (this.states.has(id)) return true;
    if (!this.kdfAnswers) return false;
    if (id === this.drone) return true;
    if (this.charging.has(id)) return true;
    return this.alive(this.drone) && this.typeId(id) === 'yahalom_squad' && this.sim.state.side[id] === this.kdf;
  }

  /** The answer's production: one `yahalom_squad` at the head of the first round. */
  beforeProduction(runtime: NonNullable<MatchWorld['runtime']>): void {
    if (!this.kdfAnswers || this.queuedSquad) return;
    this.queuedSquad = true;
    runtime.requestBuild('yahalom_squad', undefined, this.kdf);
  }

  /** Every `ORDER_EVERY_TICKS`, before the attack-move. */
  round(t: number): void {
    if (this.sarimPlays) this.feed(t);
    if (this.kdfAnswers) {
      const squads = this.squads().filter((id) => !this.charging.has(id));
      if (this.alive(this.drone) && squads.length > 0) {
        this.sim.queueCommand({ kind: 'move', ids: squads, x: this.sim.state.posX[this.drone], y: this.sim.state.posY[this.drone] });
      }
    }
  }

  private squads(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (this.alive(i) && this.sim.state.side[i] === this.kdf && this.typeId(i) === 'yahalom_squad') out.push(i);
    }
    return out;
  }

  private load(r: number): number {
    let n = 0;
    for (const s of this.states.values()) if (s.route === r) n++;
    return n;
  }

  /** Free Sarim foot units into routes with room: all of them at tick 0, built ones afterwards. */
  private feed(t: number): void {
    const st = this.sim.state;
    const free: number[] = [];
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] !== 1 || st.side[i] !== this.sarim || this.ever.has(i)) continue;
      if (t > 0 && this.placed.has(i)) continue;
      if (st.tunnelIn[i] >= 0 || st.carriedBy[i] >= 0 || st.garrisonedIn[i] >= 0 || st.routed[i] === 1) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      if (type.isAir || type.wheeled) continue;
      free.push(i);
    }
    const room = this.routes.map((r) => (this.sim.tnAlive[r] === 1 ? this.sim.tunnelCapacity(r) - this.load(r) : 0));
    const picks: number[][] = this.routes.map(() => []);
    for (let more = true; more && free.length > 0; ) {
      more = false;
      for (let k = 0; k < this.routes.length && free.length > 0; k++) {
        if (room[k] <= 0) continue;
        const mouth = tileCentre((this.pointsOf.get(this.routes[k]) ?? [[0, 0]])[0]);
        let best = 0;
        for (let j = 1; j < free.length; j++) {
          const dj = tiles2([st.posX[free[j]], st.posY[free[j]]], mouth);
          const db = tiles2([st.posX[free[best]], st.posY[free[best]]], mouth);
          if (dj < db) best = j;
        }
        const id = free.splice(best, 1)[0];
        picks[k].push(id);
        room[k]--;
        more = true;
      }
    }
    picks.forEach((ids, k) => {
      if (ids.length === 0) return;
      for (const id of ids) {
        this.states.set(id, { kind: 'walk', route: this.routes[k], since: t });
        this.ever.add(id);
      }
      this.sim.queueCommand({ kind: 'enterTunnel', ids, tunnel: this.routes[k] });
    });
  }

  /** Every second: the units' states, the raids and exits, the drone, the charges. */
  second(t: number): void {
    const st = this.sim.state;
    for (const r of this.routes) if (this.sim.tnAlive[r] === 1 && this.sim.tunnelContactLevel(this.kdf, r) === 2) this.ident.add(r);
    for (const [id, s] of [...this.states]) {
      if (st.alive[id] !== 1) {
        this.states.delete(id);
      } else if (s.kind === 'walk') {
        if (st.tunnelIn[id] >= 0) {
          this.states.set(id, { kind: 'below', route: s.route, since: t });
          this.counts.entered++;
        } else if (t - s.since >= WALK_GIVE_UP_TICKS) {
          this.states.delete(id);
          this.counts.stalled++;
        }
      } else if (s.kind === 'raid') {
        if (st.tunnelIn[id] >= 0) this.states.set(id, { kind: 'below', route: s.route, since: t });
        else if (this.sim.tnAlive[s.route] === 0 || t - s.since >= RAID_GIVE_UP_TICKS) this.states.delete(id);
      }
    }
    if (this.cell === 'noAnswer' || this.cell === 'answer') this.vents(t);
    if (this.kdfAnswers) {
      this.flyDrone();
      this.charge();
    }
  }

  private vents(t: number): void {
    const st = this.sim.state;
    const kc = centroid(this.sim, this.kdf);
    const raid: number[] = [];
    const exit: number[] = [];
    for (const [id, s] of this.states) {
      if (s.kind !== 'below' || st.tunnelIn[id] < 0 || st.tunnelEta[id] !== 0) continue;
      const vent = this.sim.tunnelVent(s.route);
      if (kc !== null && tiles2(kc, this.sarimAnchor) < tiles2(vent, this.sarimAnchor)) exit.push(id);
      else if (this.threat(id, vent)) raid.push(id);
    }
    for (const id of exit) this.states.delete(id);
    for (const id of raid) {
      const s = this.states.get(id);
      if (s) this.states.set(id, { kind: 'raid', route: s.route, since: t });
    }
    if (exit.length > 0) this.sim.queueCommand({ kind: 'vent', ids: exit, mode: 'exit' });
    if (raid.length > 0) this.sim.queueCommand({ kind: 'vent', ids: raid, mode: 'raid' });
    this.counts.exits += exit.length;
    this.counts.raids += raid.length;
  }

  /** A KDF ground unit on the surface within `id`'s best weapon's max range of the vent, in sight from it. */
  private threat(id: number, vent: Fx2): boolean {
    const st = this.sim.state;
    const ti = st.typeIdx[id];
    let r2 = this.rangeSqOf.get(ti);
    if (r2 === undefined) {
      r2 = 0;
      for (const wpn of this.sim.unitTypes[ti].weapons) r2 = Math.max(r2, (wpn.range / 65536) ** 2);
      this.rangeSqOf.set(ti, r2);
    }
    if (r2 === 0) return false;
    const vx = vent[0] >> 16;
    const vy = vent[1] >> 16;
    for (let k = 0; k < this.sim.entityCount; k++) {
      if (st.alive[k] !== 1 || st.side[k] !== this.kdf || st.tunnelIn[k] >= 0 || st.carriedBy[k] >= 0) continue;
      if (this.sim.unitTypes[st.typeIdx[k]].isAir) continue;
      if (tiles2([st.posX[k], st.posY[k]], vent) > r2) continue;
      if (losRay(this.sim, vx, vy, st.posX[k] >> 16, st.posY[k] >> 16) < 0) continue;
      return true;
    }
    return false;
  }

  private flyDrone(): void {
    if (!this.alive(this.drone)) return;
    const st = this.sim.state;
    const here: Fx2 = [st.posX[this.drone], st.posY[this.drone]];
    if (this.sweepAt >= 0 && tiles2(here, this.sweep[this.sweepAt]) > DRONE_REACH_SQ) return;
    this.sweepAt = (this.sweepAt + 1) % this.sweep.length;
    const [x, y] = this.sweep[this.sweepAt];
    this.sim.queueCommand({ kind: 'move', ids: [this.drone], x, y, exact: true });
  }

  private charge(): void {
    for (const [id, r] of [...this.charging]) if (!this.alive(id) || this.sim.tnAlive[r] === 0) this.charging.delete(id);
    const known = this.routes.filter((r) => this.sim.tnAlive[r] === 1 && this.sim.tunnelContactLevel(this.kdf, r) === 2);
    if (known.length === 0) return;
    const st = this.sim.state;
    for (const id of this.squads()) {
      if (this.charging.has(id)) continue;
      const at: Fx2 = [st.posX[id], st.posY[id]];
      const near = (r: number): number => {
        let best = Infinity;
        for (const p of this.pointsOf.get(r) ?? []) best = Math.min(best, tiles2(at, tileCentre(p)));
        return best;
      };
      let pick = known[0];
      for (const r of known) if (near(r) < near(pick)) pick = r;
      this.charging.set(id, pick);
      this.counts.charges++;
      this.sim.queueCommand({ kind: 'chargeTunnel', ids: [id], tunnel: pick });
    }
  }

  /** Before each tick: who is below each route, for the collapse count. */
  beforeTick(): void {
    this.routes.forEach((r, k) => {
      this.occBefore[k] = this.sim.tnOccupants[r];
    });
  }

  /** After each tick: the events. */
  after(ev: readonly SimEvent[]): void {
    for (const e of ev) {
      if (e.kind === 'surfaced' && this.sim.state.side[e.entity] === this.sarim) this.counts.surfaced++;
      else if (e.kind === 'tunnelCollapsed') {
        const k = this.routes.indexOf(e.tunnel);
        if (k < 0) continue;
        this.counts.collapsed++;
        this.counts.collapseKills += this.occBefore[k];
      }
    }
  }

  read(): TunnelRead {
    return { ...this.counts, identified: this.ident.size };
  }
}

/** Runs `fn` with every rules file's `tunnels` block taken away IN MEMORY, so
 *  `buildMatchWorld` registers no versus route: the world the `off` cell is
 *  compared with, game for game (an unordered route must be inert). */
export function withoutVersusRoutes<T>(fn: () => T): T {
  const rules = versusRules as Record<string, VersusRulesJson>;
  const saved = { ...rules };
  try {
    for (const [id, r] of Object.entries(saved)) {
      const { tunnels: _drop, ...rest } = r;
      void _drop;
      rules[id] = rest;
    }
    return fn();
  } finally {
    for (const id of Object.keys(saved)) rules[id] = saved[id];
  }
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
  const tunnels = args.includes('--tunnels');
  const economy = tunnels || args.includes('--economy');
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
  return withOverrides(overrides, () => report({ economy, tunnels, rules, mapIds, arrangements, seeds, capTicks, overrides, playFn }));
}

function report(r: { economy: boolean; tunnels: boolean; rules: SeatTable; mapIds: MapId[]; arrangements: Arrangement[]; seeds: number; capTicks: number; overrides: Overrides; playFn: PlayFn }): number {
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
  if (r.tunnels) return tunnelReport({ mapIds, arrangements, seeds, capTicks, playFn });

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

/** The tunnel arm's games for one map and spawn order: the four cells, and
 *  the `off` cell's twin played with no versus route registered at all. */
export interface TunnelCellGames {
  cells: Record<TunnelCell, Played[]>;
  routeless: Played[];
}

export function playTunnelCells(mapId: MapId, arr: Arrangement, seeds: number, capTicks: number, playFn: PlayFn = play): TunnelCellGames {
  const cells = { off: [], noAnswer: [], answer: [], turtle: [] } as Record<TunnelCell, Played[]>;
  const routeless: Played[] = [];
  for (let n = 0; n < seeds; n++) {
    for (const c of TUNNEL_CELLS) cells[c].push(playFn(mapId, arr, seedOf(n), { capTicks, economy: true, tunnels: c }));
    routeless.push(withoutVersusRoutes(() => playFn(mapId, arr, seedOf(n), { capTicks, economy: true })));
  }
  return { cells, routeless };
}

/** The tunnel arm's self-check (spec §7.4) over one map and spawn order's
 *  games; each failure is a sentence. Cell 2 must have brought a unit up at
 *  least once, and `off` must be the routeless game, seed for seed. */
export function tunnelSelfCheck(mapId: MapId, arr: Arrangement, g: TunnelCellGames): string[] {
  const failures: string[] = [];
  const where = `${mapId} ${cellName(arr)}`;
  const surfaced = g.cells.noAnswer.reduce((s, p) => s + (p.tun?.surfaced ?? 0), 0);
  if (surfaced < 1) failures.push(`${where}: cell 2 (on, no answer) read no 'surfaced' event in ${g.cells.noAnswer.length} games: the Sarim plan never brought a unit up`);
  const key = (p: Played): string => JSON.stringify([p.winner, p.by, p.ticks, p.econ]);
  const off = g.cells.off;
  const differ = off.map((_p, n) => n).filter((n) => key(off[n]) !== key(g.routeless[n]));
  if (differ.length > 0) {
    failures.push(`${where}: cell 1 (routes registered, never ordered) differs from the routeless economy game in ${differ.length} of ${off.length} seeds (first: seed ${seedOf(differ[0])}, ${key(off[differ[0]])} against ${key(g.routeless[differ[0]])})`);
  }
  return failures;
}

function sumTun(games: readonly Played[]): TunnelRead {
  const t = zeroRead();
  for (const g of games) for (const k of Object.keys(t) as (keyof TunnelRead)[]) t[k] += g.tun?.[k] ?? 0;
  return t;
}

/** Sarim's wins in a faction cell (`t.wins` is by END). */
const sarimWins = (arr: Arrangement, t: Tally): number => reading(arr, t).wins[1];

function tunnelReport(r: { mapIds: MapId[]; arrangements: Arrangement[]; seeds: number; capTicks: number; playFn: PlayFn }): number {
  const { mapIds, arrangements, seeds, capTicks, playFn } = r;
  console.log('tunnel arm (GH-681): the Sarim end\'s routes registered in every room; cells 1 off, 2 Sarim tunnels vs the economy plan, 3 Sarim tunnels vs the KDF answer, 4 turtle vs the KDF answer');
  const all: { mapId: MapId; arr: Arrangement; g: TunnelCellGames }[] = [];
  for (const mapId of mapIds) for (const arr of arrangements) all.push({ mapId, arr, g: playTunnelCells(mapId, arr, seeds, capTicks, playFn) });
  const failed = all.flatMap(({ mapId, arr, g }) => tunnelSelfCheck(mapId, arr, g));
  if (failed.length > 0) {
    console.error('TUNNEL SELF-CHECK FAILED -- the tunnel arm did not run as written, so no table is printed:');
    for (const f of failed) console.error(`  ${f}`);
    return 2;
  }
  console.log(`tunnel self-check: ${all.length} map/spawn pair(s): cell 2 surfaced, cell 1 equal to the routeless game seed for seed -- passed`);
  const proofHead = 'enter/stall/surf/raid/exit/ident/charge/coll/ckill (totals)';
  console.log(`${pad('map', 14)}${pad('spawn', 16)}${pad('cell', 18)}${pad('KDF', 5)}${pad('Sarim', 7)}${pad('draw', 6)}${pad('annih/stale/cap/mut', 21)}${pad('mean min', 10)}${pad('reading', 28)}${proofHead}`);
  const bar: string[] = [];
  for (const { mapId, arr, g } of all) {
    const tallies = {} as Record<TunnelCell, Tally>;
    for (const c of TUNNEL_CELLS) {
      const t = tally(g.cells[c]);
      tallies[c] = t;
      const rd = reading(arr, t);
      const p = sumTun(g.cells[c]);
      const lean = rd.leader === null ? 'level' : `${rd.leader} ${rd.leaderPercent}%`;
      console.log(
        `${pad(mapId, 14)}${pad(cellName(arr), 16)}${pad(TUNNEL_CELL_NAME[c], 18)}${pad(rd.wins[0], 5)}${pad(rd.wins[1], 7)}${pad(t.draws, 6)}` +
          `${pad(`${t.by.annihilation}/${t.by.stalemate}/${t.by.cap}/${t.by.mutual}`, 21)}${pad((t.ticks / seeds / (60 * TICKS_PER_SECOND)).toFixed(1), 10)}` +
          `${pad(`${lean} ${rd.within ? 'within' : 'OUTSIDE'}`, 28)}${p.entered}/${p.stalled}/${p.surfaced}/${p.raids}/${p.exits}/${p.identified}/${p.charges}/${p.collapsed}/${p.collapseKills}`,
      );
    }
    const where = `${mapId} ${cellName(arr)}`;
    const c3 = reading(arr, tallies.answer);
    bar.push(`${where}: cell 3 ${c3.within ? 'within' : 'OUTSIDE'} ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT} (KDF ${c3.wins[0]}, Sarim ${c3.wins[1]})`);
    const s1 = sarimWins(arr, tallies.off);
    const s2 = sarimWins(arr, tallies.noAnswer);
    bar.push(`${where}: cell 2 Sarim ${s2} against cell 1 Sarim ${s1} -- ${s2 > s1 ? 'a Sarim edge' : 'NO Sarim edge'}`);
    const s4 = sarimWins(arr, tallies.turtle);
    bar.push(`${where}: cell 4 (turtle) Sarim ${s4} of ${seeds} -- ${s4 * 2 > seeds ? 'the turtle WINS for Sarim' : 'the turtle does not win'}`);
  }
  console.log('the bar (lead, Q1; report-only):');
  for (const b of bar) console.log(`  ${b}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
