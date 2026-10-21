// The versus probe (#561, #589): who wins a versus room's map when neither seat is clever?
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
// on the map's own sandbox anchors, in a `Sim` built the way a room builds it.
// The seed varies the RNG streams and nothing else: 1000 + 7919 * n, so the same
// command prints the same table.
//
// What it cannot say. Two attack-moving blobs are not two players: it measures
// the ground and the start points under the dumbest plan both sides share, which
// is exactly what a spawn bias would show up under. A map that is lopsided here
// is lopsided for a human; a map that is even here may still be lopsided for a
// cleverer plan. And it reads a mirror cell by SIDE (west spawn against east)
// but a KDF-against-Sarim cell by FACTION, so read the two spawn orders of that
// pairing together: a faction edge shows in both, a spawn edge flips between them.
//
// The bar. The lead's ruling on #561 (2026-10-14): a map re-opens for versus only
// once its fair start points are authored and this probe reads it within 60/40
// at 48 seeds per spawn order -- `FAIR_MAX_PERCENT`, `SEEDS_DEFAULT`.
//
//   pnpm versus:probe                                 the two open maps, every pairing, 48 seeds
//   pnpm versus:probe -- --maps=qarn_hadid --arr=kdf/kdf
//   pnpm versus:probe -- --maps=all --arr=kdf/kdf --seeds=12     every candidate map, a quick read
//   flags: --maps=<id,id|all>  --arr=<kdf/kdf,kdf/sarim,sarim/kdf>  --seeds=<n>  --cap=<seconds>
//
// THE SELF-CHECK, and the mutation that turns it red. Before any table it plays
// two CONTROLS per map and one repeat, and refuses to report unless they hold:
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
//
// This file is a tool, not a test: nothing here runs under `pnpm test` but the
// self-check's controls (versus-probe.test.ts), and nothing reads its output.

import { fileURLToPath } from 'node:url';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, type MapId } from '@lions/data';
import { VERSUS_FAIR_MAPS, type Faction } from '@lions/net';
import { standMapStructures } from '../../../packages/app/src/map-sim';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { versusForceOf, versusSpawns, type VersusForce } from '../../../packages/app/src/net/versus-force';
import { MATCH_CAP_TICKS, outcomeOf, unitCost, type MatchResult } from '../../../packages/app/src/net/outcome';
import { versusRoster } from '../../../packages/app/src/net/versus-roster';

/** 20 Hz, like the sim. */
const TICKS_PER_SECOND = 20;
/** Each side is re-ordered on the other's centroid this often. */
export const ORDER_EVERY_TICKS = 20 * TICKS_PER_SECOND;
/** The rule is asked this often, like a room's hash window. */
export const DECIDE_EVERY_TICKS = 20;
/** The probe's own cap, shorter than a room's 25 minutes: 10 minutes. */
export const CAP_TICKS_DEFAULT = 10 * 60 * TICKS_PER_SECOND;
/** The lead's bar (#561): neither side takes more than this share of the seeds. */
export const FAIR_MAX_PERCENT = 60;
/** The lead's bar: seeds per spawn order. */
export const SEEDS_DEFAULT = 48;

/** The seed of the n-th game of a cell. */
export const seedOf = (n: number): number => 1000 + n * 7919;

export type Arrangement = readonly [Faction, Faction];
/** How a probe game ended: `cap` is the 10-minute limit, decided on surviving value. */
export type Finish = 'annihilation' | 'mutual' | 'stalemate' | 'cap';

export interface Played {
  /** The winning SIDE (0 west, 1 east), or null for a draw. */
  winner: 0 | 1 | null;
  by: Finish;
  ticks: number;
}

export interface PlayOptions {
  capTicks?: number;
  /** CONTROL ONLY: cut this side to its first unit before the first tick. */
  cutSide?: 0 | 1;
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

/** Both sides march their living units on the other's centroid. */
function order(sim: Sim, force: VersusForce): void {
  for (const side of [0, 1] as const) {
    const target = centroid(sim, side === 0 ? 1 : 0);
    const ids = force.bySide[side].filter((id) => sim.state.alive[id] === 1);
    if (target && ids.length > 0) sim.queueCommand({ kind: 'attackMove', ids, x: target[0], y: target[1] });
  }
}

/** A decided result, in the probe's terms. */
function finish(o: MatchResult, ticks: number): Played {
  const by: Finish = o.by === 'annihilation' || o.by === 'mutual' || o.by === 'stalemate' ? o.by : 'cap';
  return { winner: o.kind === 'won' ? o.side : null, by, ticks };
}

/** One game: `arrangement[0]` on the west spawn (side 0), `arrangement[1]` on the east. */
export function play(mapId: MapId, arrangement: Arrangement, seed: number, opts: PlayOptions = {}): Played {
  const capTicks = opts.capTicks ?? CAP_TICKS_DEFAULT;
  const { sim, typeOf, map } = world(mapId, seed);
  const force = versusSpawns(sim, typeOf, sandboxAnchors(map), arrangement);
  if (opts.cutSide !== undefined) for (const id of force.bySide[opts.cutSide].slice(1)) sim.debugKill(id);
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) order(sim, force);
    sim.tick();
    if (sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(sim, sim.tickCount);
      if (o.kind !== 'ongoing') return finish(o, sim.tickCount);
    }
  }
  // The cap: the real rule, asked as if the real cap had come -- the higher
  // surviving value wins, equal values draw. Never 'ongoing' there.
  const o = outcomeOf(sim, MATCH_CAP_TICKS);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return finish(o, sim.tickCount);
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
}

/** The games of one cell, counted. */
export function tally(games: readonly Played[]): Tally {
  const t: Tally = { seeds: games.length, wins: [0, 0], draws: 0, by: { annihilation: 0, mutual: 0, stalemate: 0, cap: 0 }, ticks: 0 };
  for (const g of games) {
    if (g.winner === null) t.draws++; else t.wins[g.winner]++;
    t.by[g.by]++;
    t.ticks += g.ticks;
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

/** Reads a cell: a mirror by side, a KDF-against-Sarim cell by faction. */
export function reading(arrangement: Arrangement, t: Tally): Reading {
  const mirror = arrangement[0] === arrangement[1];
  // A cell with the KDF on the east spawn lists its wins in the faction order, KDF first.
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
export function selfCheck(mapId: MapId, playFn: PlayFn = play): string[] {
  const failures: string[] = [];
  const seed = seedOf(0);
  for (const strong of [0, 1] as const) {
    const g = playFn(mapId, ['kdf', 'kdf'], seed, { cutSide: strong === 0 ? 1 : 0 });
    if (g.winner !== strong || g.by !== 'annihilation') {
      failures.push(`${mapId}: with side ${strong === 0 ? 1 : 0} cut to one unit, side ${strong} should win by annihilation; read winner ${String(g.winner)} by ${g.by}`);
    }
  }
  const a = playFn(mapId, ['kdf', 'kdf'], seed);
  const b = playFn(mapId, ['kdf', 'kdf'], seed);
  if (a.winner !== b.winner || a.by !== b.by || a.ticks !== b.ticks) {
    failures.push(`${mapId}: one seed played twice read two games (${String(a.winner)}/${a.by}/${a.ticks} then ${String(b.winner)}/${b.by}/${b.ticks})`);
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

/** Prints the report and returns the exit code: 0 for any reading, 2 when the self-check fails. */
export function main(args: readonly string[] = process.argv.slice(2), playFn: PlayFn = play): number {
  const mapArg = flag(args, 'maps');
  const mapIds = mapArg === 'all' ? candidateMaps() : (mapArg?.split(',') ?? VERSUS_FAIR_MAPS) as MapId[];
  for (const id of mapIds) if (!(id in maps)) throw new Error(`--maps: "${id}" is not a shipped map`);
  const arrangements = parseArrangements(flag(args, 'arr') ?? 'kdf/kdf,kdf/sarim,sarim/kdf');
  const seeds = Number(flag(args, 'seeds') ?? SEEDS_DEFAULT);
  const capTicks = Math.round(Number(flag(args, 'cap') ?? CAP_TICKS_DEFAULT / TICKS_PER_SECOND) * TICKS_PER_SECOND);
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');

  console.log(`versus probe (report-only): force value kdf ${valueOf('kdf')}, sarim ${valueOf('sarim')}; ${seeds} seeds per cell; cap ${capTicks / TICKS_PER_SECOND} s, decided on surviving value`);
  console.log(`bar (#561): within ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT} at ${SEEDS_DEFAULT} seeds per spawn order; open now: ${VERSUS_FAIR_MAPS.join(', ')}`);

  // The controls first: a probe that cannot pass them reports nothing.
  const failed = mapIds.flatMap((id) => selfCheck(id, playFn));
  if (failed.length > 0) {
    console.error('SELF-CHECK FAILED -- the probe cannot tell its sides apart, so no table is printed:');
    for (const f of failed) console.error(`  ${f}`);
    return 2;
  }
  console.log(`self-check: ${mapIds.length} map(s), 2 controls and a repeat each -- passed`);

  console.log(`${pad('map', 24)}${pad('west/east', 13)}${pad('west', 6)}${pad('east', 6)}${pad('draw', 6)}${pad('annih/stale/cap/mutual', 24)}${pad('mean min', 10)}reading`);
  for (const id of mapIds) {
    for (const arr of arrangements) {
      const games: Played[] = [];
      for (let n = 0; n < seeds; n++) games.push(playFn(id, arr, seedOf(n), { capTicks }));
      const t = tally(games);
      const r = reading(arr, t);
      const lean = r.leader === null ? 'level' : `${r.leader} ${r.leaderPercent}%`;
      console.log(
        `${pad(id, 24)}${pad(`${arr[0]}/${arr[1]}`, 13)}${pad(t.wins[0], 6)}${pad(t.wins[1], 6)}${pad(t.draws, 6)}` +
          `${pad(`${t.by.annihilation}/${t.by.stalemate}/${t.by.cap}/${t.by.mutual}`, 24)}${pad((t.ticks / seeds / (60 * TICKS_PER_SECOND)).toFixed(1), 10)}` +
          `${lean}  ${r.within ? `within ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT}` : `OUTSIDE ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT}`}${t.seeds < SEEDS_DEFAULT ? `  (only ${t.seeds} seeds: the bar is ${SEEDS_DEFAULT})` : ''}`,
      );
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
