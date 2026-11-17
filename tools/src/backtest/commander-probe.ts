// GH-1390: the commander coverage probe. REPORT-ONLY: it prints a table and exits 0 whatever it says (exit 2 is its own self-check).
//
// What it asks: can the computer seat take EITHER seat (KDF or Sarim) on every open versus map and in every win mode, and does it keep
// playing? For every open cell (map x matchup x win mode, read from @lions/net's own tables: `VERSUS_FAIR_MAPS`, `matchupAllowed`,
// `winModesOffered`, plus annihilation, the default every room can play), with the commander in seat 0 and in seat 1, against each
// baseline in `BASELINES`, over N seeds, it plays the room's own world (`buildMatchWorld`, `matchTick`, the real outcome rule
// `decideOnHashTick`) with two seats down the battlefield's own frame path (`runFrames`), and records:
//
//   * the tick of the commander's FIRST order (the time-to-first-order);
//   * its longest stretch with NO order (`maxSilentTicks`), and, separately, the longest stretch with no order while it HAD an idle,
//     able unit at every decision in the stretch (`maxIdleSilentTicks`). The brief's STALL is a stretch of 60 s with no order: read
//     literally, `stallLiteral` fires in any game where a force is engaged (a rush attack-moves once, then fights), so the diagnostic
//     that means "it stopped playing" is `stallIdle` (60 s with no order while an idle, able unit stood by). Both are reported;
//   * the outcome, by SEAT: commander win, baseline win, draw, and how it was decided (annihilation, objective, stalemate, time).
//
// The commander is, by default, what ships: `ComputerSeat` with its default `rush` policy plus the straggler sweep (GH-1388). `--commander=slice1`
// plays the opt-in commander of GH-1391 instead (production, zones, defend, a guard), so one probe grades both. The
// baselines are the arena's scripted controls (`passive`, `rush`); a "sensible" baseline does not exist for versus (the campaign
// ladders are mission plans, `plans/`), and one is not invented here. The `rush` baseline is a plain ComputerSeat too, so commander vs
// rush is the same script on both seats: any lean in that row is the cell's, not the script's.
//
// A cell the commander cannot be seated in at all is reported UNSUPPORTED with the reason, not played. The offline config
// (`offlineConfig`) refuses any pairing but the mirror; this probe builds the room's config itself, as `roomConfig` in
// `versus-probe.ts` does, so a faction cell (and a win mode) is PLAYED here even though no lobby can seat the computer in it.
//
//   pnpm --filter @lions/tools exec tsx src/backtest/commander-probe.ts -- --seeds=8 --jobs=4 --out=/tmp/cmd-probe
//   ... --maps=tel_marum,wadi_tarfan --modes=annihilation,points --baselines=passive --seeds=2
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from '@lions/sim';
import {
  VERSUS_FAIR_MAPS, canonicalOrder, factionsOfMatchup, flagSetupFor, matchCapTicksOf, matchupAllowed, sidesOfFactions, validateConfig, winModesOffered,
  type Frame, type Matchup, type MatchConfig, type MatchTransport, type Seat, type Stamped, type TransportStatus, type WinMode,
} from '@lions/net';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { decideOnHashTick, goalsOf, productionOf, type LocalDecision } from '../../../packages/app/src/net/outcome';
import { ComputerSeat } from '../../../packages/app/src/net/computer/computer-seat';
import { campOf } from '../../../packages/app/src/net/versus-force';
import { RUSH_HOME_TILES } from '../../../packages/app/src/net/computer/policy';
import { zoneFacts } from '../../../packages/app/src/net/computer/zones';
import { createCommander, type CommanderOptions } from '../../../packages/app/src/net/computer/commander';
import { isIdle } from '../../../packages/app/src/ui/idle';

/** 60 s of 20 Hz ticks: the brief's stall window. */
export const STALL_TICKS = 60 * 20;
export const BASELINES = ['passive', 'rush'] as const;
export type Baseline = (typeof BASELINES)[number];
export const seedOf = (n: number): number => 1000 + n * 7919;

export interface Cell {
  map: string;
  matchup: Matchup;
  /** null: annihilation, the default. */
  winMode: WinMode | null;
  /** The seat the commander plays (0 is the host end). */
  commanderSeat: Seat;
  baseline: Baseline;
}

/** Every open cell, from the tables the lobby and the Worker read. */
export function cellsOf(o: { maps?: readonly string[]; modes?: readonly (WinMode | 'annihilation')[]; baselines?: readonly Baseline[] } = {}): Cell[] {
  const out: Cell[] = [];
  for (const map of VERSUS_FAIR_MAPS) {
    if (o.maps && !o.maps.includes(map)) continue;
    for (const matchup of ['mirror', 'kdf', 'sarim'] as const) {
      if (!matchupAllowed(matchup, map)) continue;
      const modes: (WinMode | null)[] = [null, ...winModesOffered(map, matchup)];
      for (const winMode of modes) {
        if (o.modes && !o.modes.includes(winMode ?? 'annihilation')) continue;
        for (const commanderSeat of [0, 1] as const) {
          for (const baseline of BASELINES) {
            if (o.baselines && !o.baselines.includes(baseline)) continue;
            out.push({ map, matchup, winMode, commanderSeat, baseline });
          }
        }
      }
    }
  }
  return out;
}

/** The faction the commander plays in a cell: seat 0 is the host's faction, seat 1 the other. */
export function commanderFaction(c: Cell): 'kdf' | 'sarim' {
  return factionsOfMatchup(c.matchup)[c.commanderSeat];
}

/** The room's config for a cell, as the Worker mints it: win mode and the flag set-up rules only where the tables say. */
export function configOf(c: Cell, seed: number): MatchConfig {
  const factions = factionsOfMatchup(c.matchup);
  const sides = sidesOfFactions(factions);
  const seat = (s: Seat) => ({
    seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [],
    player: s === c.commanderSeat ? 'commander' : c.baseline, callsign: s === c.commanderSeat ? 'commander' : c.baseline, kind: 'bot',
  });
  const setup = flagSetupFor(c.map, c.winMode);
  const cfg = validateConfig({
    matchId: 'cmd-probe', code: 'PROBE0', seed, map: c.map, mode: 'versus', seats: [seat(0), seat(1)],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'probe', dataDigest: 0,
    ...(c.winMode !== null ? { winMode: c.winMode } : {}), ...(setup !== undefined ? { flagSetup: setup } : {}),
  });
  if (cfg === null) throw new Error(`commander probe: no valid config for ${JSON.stringify(c)}`);
  return cfg;
}

/** A seat that orders nothing, ever (the arena's `passive` as a seat: a ComputerSeat would still sweep its idle units). */
export class PassiveSeat {
  attach(): void {}
  decidesAt(): boolean { return false; }
  commandsFor(): Stamped[] { return []; }
}
export interface SeatLike { attach(w: MatchWorld): void; decidesAt(t: number): boolean; commandsFor(t: number): Stamped[] }

/** Two scripted seats and nothing else: a frame per tick, every seat's commands in the frame of the tick they were decided for. */
export class PairTransport implements MatchTransport {
  readonly local = true;
  private nextTick = 0;
  closed = false;
  constructor(private readonly seats: readonly [SeatLike, SeatLike], readonly seen: (seat: Seat, tick: number, cmd: Command) => void, private readonly tickStart: (tick: number) => void = () => {}) {}
  attach(w: MatchWorld): void { for (const s of this.seats) s.attach(w); }
  queueCommand(): void {}
  take(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    if (this.closed) return out;
    for (let i = 0; i < maxTicks; i++) {
      const tick = this.nextTick;
      if (i > 0 && this.seats.some((s) => s.decidesAt(tick))) break;
      this.tickStart(tick);
      const cmds = this.seats.flatMap((s) => s.commandsFor(tick));
      for (const c of cmds) this.seen(c.seat, tick, c.cmd);
      out.push({ tick, cmds: canonicalOrder(cmds) });
      this.nextTick++;
    }
    return out;
  }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'local' }; }
  close(): void { this.closed = true; }
}

export interface GameRecord {
  cell: Cell;
  seed: number;
  commanderFaction: 'kdf' | 'sarim';
  /** `unsupported`: the commander cannot be seated in this cell (reason in `note`); no game was played. */
  status: 'played' | 'unsupported' | 'error';
  note?: string;
  ticks: number;
  capTicks: number;
  /** `commander`, `baseline`, `draw`, or `undecided` (the cap ran out with no decision, which the outcome rule should not allow). */
  winner: 'commander' | 'baseline' | 'draw' | 'undecided';
  by: string;
  commanderOrders: number;
  /** `build` orders among them, and the commander's units standing / the enemy's at the end, and zone-board samples held (every 5 s). */
  buildOrders: number;
  ownUnitsEnd: number;
  enemyUnitsEnd: number;
  zoneSamplesHeld: number;
  /** Orders a minute of game time (0 for a game shorter than a tick). */
  ordersPerMin: number;
  firstOrderTick: number | null;
  maxSilentTicks: number;
  maxIdleSilentTicks: number;
  /** Like `maxIdleSilentTicks`, counting only idle, able units AWAY from home (beyond `RUSH_HOME_TILES` of the camp): a unit standing at home may be a deliberate guard. */
  maxAwaySilentTicks: number;
  stallLiteral: boolean;
  stallIdle: boolean;
  stallAway: boolean;
  wallMs: number;
}

/** Plays one game of a cell on one seed. Never throws for a cell: a refusal or an error is a record. */
export type CommanderKind = 'rush' | 'silent' | 'slice1';
export function playGame(cell: Cell, seed: number, o: { capTicks?: number; commander?: CommanderKind; options?: CommanderOptions } = {}): GameRecord {
  const t0 = Date.now();
  const base: GameRecord = {
    cell, seed, commanderFaction: commanderFaction(cell), status: 'played', ticks: 0, capTicks: 0, winner: 'undecided', by: '',
    commanderOrders: 0, buildOrders: 0, ownUnitsEnd: 0, enemyUnitsEnd: 0, zoneSamplesHeld: 0, ordersPerMin: 0, firstOrderTick: null, maxSilentTicks: 0, maxIdleSilentTicks: 0, maxAwaySilentTicks: 0, stallLiteral: false, stallIdle: false, stallAway: false, wallMs: 0,
  };
  let config: MatchConfig;
  try {
    config = configOf(cell, seed);
  } catch (e) {
    return { ...base, status: 'unsupported', note: (e as Error).message, wallMs: Date.now() - t0 };
  }
  try {
    const capTicks = o.capTicks ?? matchCapTicksOf(config);
    const world = buildMatchWorld(config);
    const commanderSide = config.seats[cell.commanderSeat].side;
    // Idle and able, read off the sim by the app's own idle finder (`isIdle`, as the seat's view builds its `idle` flag), at every 100-tick
    // decision boundary, whatever the seat does: the diagnostic does not trust the seat's own view, so a commander that stops reading it is still caught.
    const st = world.sim.state;
    const camp = campOf(world.anchors, world.endOfSide[commanderSide]);
    const idleAble = (): { all: number; away: number } => {
      let n = 0;
      let away = 0;
      // A unit standing in an income zone its side holds or contests is HOLDING it: it is where the seat wants it, not a unit left without orders.
      const holding = zoneFacts(world, commanderSide).filter((z) => z.holder === 'mine' || z.holder === 'contested');
      for (let i = 0; i < world.sim.entityCount; i++) {
        if (st.alive[i] !== 1 || st.side[i] !== commanderSide) continue;
        // A man down (GH-707: wounds are on in versus) is a casualty in the seat's view, not a unit: it cannot be ordered, so it is not an idle unit.
        if (world.sim.isDown(i) || st.mobilityKilled[i] !== 0 || st.firepowerKilled[i] !== 0 || st.routed[i] !== 0) continue;
        const tx = Math.floor(st.posX[i] / 65536);
        const ty = Math.floor(st.posY[i] / 65536);
        if (holding.length > 0) {
          if (holding.some((z) => tx >= z.at[0] && tx < z.at[0] + z.at[2] && ty >= z.at[1] && ty < z.at[1] + z.at[3])) continue;
        }
        if (isIdle({ alive: true, side: st.side[i], moving: st.moving[i] !== 0, waypoints: world.sim.waypointCount(i), curTarget: st.curTarget[i], curStructure: st.curStructure[i], demoTarget: st.demoTarget[i], carriedBy: st.carriedBy[i], garrisonedIn: st.garrisonedIn[i] }, commanderSide)) {
          n++;
          if (Math.hypot(tx - camp[0], ty - camp[1]) > RUSH_HOME_TILES) away++;
        }
      }
      return { all: n, away };
    };
    let lastOrder = 0;
    /** The last tick the seat was NOT in the state "an idle, able unit stood by": the idle-silent stretch is measured from the later of this and `lastOrder`. */
    let lastBusy = 0;
    let sawIdle = false;
    let sawAway = false;
    let lastBusyAway = 0;
    let maxAwaySilent = 0;
    let orders = 0;
    let buildOrders = 0;
    let zoneSamplesHeld = 0;
    let first: number | null = null;
    let maxSilent = 0;
    let maxIdleSilent = 0;
    // `silent` is the probe's own self-check: a commander that never orders must read as a stall in every game, or the detector detects nothing.
    const commander: SeatLike = o.commander === 'silent'
      ? new PassiveSeat()
      : new ComputerSeat({ seat: cell.commanderSeat, side: commanderSide, ...(o.commander === 'slice1' ? { commander: createCommander(o.options) } : {}) });
    const other: SeatLike = cell.baseline === 'passive'
      ? new PassiveSeat()
      : new ComputerSeat({ seat: (1 - cell.commanderSeat) as Seat, side: config.seats[1 - cell.commanderSeat].side });
    const seats: [SeatLike, SeatLike] = cell.commanderSeat === 0 ? [commander, other] : [other, commander];
    const transport = new PairTransport(seats, (seat, tick, cmd) => {
      if (seat !== cell.commanderSeat) return;
      orders++;
      if (cmd.kind === 'build') buildOrders++;
      if (first === null) first = tick;
      maxSilent = Math.max(maxSilent, tick - lastOrder);
      if (sawIdle) maxIdleSilent = Math.max(maxIdleSilent, tick - Math.max(lastOrder, lastBusy));
      if (sawAway) maxAwaySilent = Math.max(maxAwaySilent, tick - Math.max(lastOrder, lastBusyAway));
      lastOrder = tick;
    }, (tick) => {
      if (tick === 0 || tick % 100 !== 0) return;
      zoneSamplesHeld += zoneFacts(world, commanderSide).filter((z) => z.holder === 'mine').length;
      const idle = idleAble();
      if (idle.all > 0) sawIdle = true;
      else { sawIdle = false; lastBusy = tick; }
      if (idle.away > 0) sawAway = true;
      else { sawAway = false; lastBusyAway = tick; }
    });
    transport.attach(world);
    let decided: LocalDecision | null = null;
    const step = {
      transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config,
      runTick: () => { matchTick(world); },
      runtimeDigest: () => world.runtime?.digest() ?? 0,
      stopAfter: (tick: number): boolean => {
        decided = decideOnHashTick(decided, tick, config, world.sim, productionOf(world), goalsOf(world));
        return decided !== null;
      },
    };
    while (world.sim.tickCount < capTicks + 40 && decided === null) {
      if (runFrames(step, 4).ran === 0) break;
    }
    const end = world.sim.tickCount;
    // The tail: from the last order to the end of the game counts as silence too.
    maxSilent = Math.max(maxSilent, end - lastOrder);
    if (sawIdle) maxIdleSilent = Math.max(maxIdleSilent, end - Math.max(lastOrder, lastBusy));
    if (sawAway) maxAwaySilent = Math.max(maxAwaySilent, end - Math.max(lastOrder, lastBusyAway));
    const living = (side: 0 | 1): number => {
      let n = 0;
      for (let i = 0; i < world.sim.entityCount; i++) if (st.alive[i] === 1 && st.side[i] === side) n++;
      return n;
    };
    const d = decided as LocalDecision | null;
    let winner: GameRecord['winner'] = 'undecided';
    let by = '';
    if (d !== null) {
      const r = d.result;
      by = r.kind === 'draw' ? `draw/${r.by}` : r.by === 'objective' ? `objective/${r.mode}` : r.by;
      winner = r.kind === 'draw' ? 'draw' : r.side === commanderSide ? 'commander' : 'baseline';
    }
    return {
      ...base, ticks: end, capTicks, winner, by, commanderOrders: orders, buildOrders, ownUnitsEnd: living(commanderSide), enemyUnitsEnd: living(commanderSide === 0 ? 1 : 0), zoneSamplesHeld, ordersPerMin: end > 0 ? (orders * 1200) / end : 0, firstOrderTick: first, maxSilentTicks: maxSilent,
      maxIdleSilentTicks: maxIdleSilent, maxAwaySilentTicks: maxAwaySilent, stallLiteral: maxSilent >= STALL_TICKS, stallIdle: maxIdleSilent >= STALL_TICKS, stallAway: maxAwaySilent >= STALL_TICKS, wallMs: Date.now() - t0,
    };
  } catch (e) {
    return { ...base, status: 'error', note: (e as Error).message, wallMs: Date.now() - t0 };
  }
}

// ---- the report ----------------------------------------------------------------------------------------------------------------

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const secs = (t: number | null): string => (t === null ? '-' : `${(t / 20).toFixed(0)} s`);

export interface Row {
  map: string; matchup: Matchup; mode: string; seat: Seat; faction: 'kdf' | 'sarim'; baseline: Baseline;
  games: number; unsupported: number; errors: number;
  stallLiteral: number; stallIdle: number; stallAway: number; medianFirstOrder: number | null; medianLength: number | null; medianOrdersPerMin: number | null;
  win: number; loss: number; draw: number; undecided: number; by: Record<string, number>; note: string;
}

export function rowsOf(records: readonly GameRecord[]): Row[] {
  const groups = new Map<string, GameRecord[]>();
  for (const r of records) {
    const k = [r.cell.map, r.cell.matchup, r.cell.winMode ?? 'annihilation', r.cell.commanderSeat, r.cell.baseline].join('|');
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const rows: Row[] = [];
  for (const rs of groups.values()) {
    const c = rs[0].cell;
    const played = rs.filter((r) => r.status === 'played');
    const by: Record<string, number> = {};
    for (const r of played) by[r.by || 'none'] = (by[r.by || 'none'] ?? 0) + 1;
    rows.push({
      map: c.map, matchup: c.matchup, mode: c.winMode ?? 'annihilation', seat: c.commanderSeat, faction: rs[0].commanderFaction, baseline: c.baseline,
      games: played.length, unsupported: rs.filter((r) => r.status === 'unsupported').length, errors: rs.filter((r) => r.status === 'error').length,
      stallLiteral: played.filter((r) => r.stallLiteral).length, stallIdle: played.filter((r) => r.stallIdle).length, stallAway: played.filter((r) => r.stallAway).length,
      medianFirstOrder: median(played.map((r) => r.firstOrderTick).filter((t): t is number => t !== null)),
      medianLength: median(played.map((r) => r.ticks)),
      medianOrdersPerMin: median(played.map((r) => r.ordersPerMin)),
      win: played.filter((r) => r.winner === 'commander').length, loss: played.filter((r) => r.winner === 'baseline').length,
      draw: played.filter((r) => r.winner === 'draw').length, undecided: played.filter((r) => r.winner === 'undecided').length,
      by, note: rs.find((r) => r.note)?.note ?? '',
    });
  }
  return rows.sort((a, b) => (a.map + a.matchup + a.mode + a.seat + a.baseline).localeCompare(b.map + b.matchup + b.mode + b.seat + b.baseline));
}

export function tableOf(rows: readonly Row[]): string {
  const head = '| map | matchup | mode | commander (seat, faction) | vs | games | stalls (60 s, literal) | stalls (60 s, idle unit) | stalls (60 s, idle unit away from home) | median first order | median length | orders a minute (median) | W / L / D / undecided | decided by | note |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => `| ${r.map} | ${r.matchup} | ${r.mode} | ${r.seat}, ${r.faction} | ${r.baseline} | ${r.games}${r.unsupported ? ` (+${r.unsupported} unsupported)` : ''}${r.errors ? ` (+${r.errors} error)` : ''} | ${r.stallLiteral} | ${r.stallIdle} | ${r.stallAway} | ${secs(r.medianFirstOrder)} | ${secs(r.medianLength)} | ${r.medianOrdersPerMin === null ? '-' : r.medianOrdersPerMin.toFixed(1)} | ${r.win} / ${r.loss} / ${r.draw} / ${r.undecided} | ${Object.entries(r.by).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} | ${r.note.slice(0, 80)} |`);
  return [head, sep, ...lines].join('\n');
}

// ---- the CLI -------------------------------------------------------------------------------------------------------------------

function argOf(name: string, argv: readonly string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(argv: readonly string[]): Promise<void> {
  const seeds = Number(argOf('seeds', argv) ?? 8);
  const jobs = Number(argOf('jobs', argv) ?? 1);
  const out = argOf('out', argv) ?? join(process.env.TMPDIR ?? '/tmp', 'commander-probe');
  const maps = argOf('maps', argv)?.split(',');
  const modes = argOf('modes', argv)?.split(',') as (WinMode | 'annihilation')[] | undefined;
  const baselines = argOf('baselines', argv)?.split(',') as Baseline[] | undefined;
  const shard = argOf('shard', argv);
  const commander = (argOf('commander', argv) ?? 'rush') as CommanderKind;
  const cells = cellsOf({ maps, modes, baselines });
  mkdirSync(out, { recursive: true });
  if (shard !== undefined) {
    // A worker: its slice of (cell, seed) games, one JSON line each.
    const [i, n] = shard.split('/').map(Number);
    const file = join(out, `games.${i}.jsonl`);
    let k = 0;
    for (const cell of cells) for (let s = 0; s < seeds; s++) {
      if (k++ % n !== i) continue;
      appendFileSync(file, `${JSON.stringify(playGame(cell, seedOf(s), { commander }))}\n`);
    }
    return;
  }
  if (jobs > 1) {
    const self = fileURLToPath(import.meta.url);
    await Promise.all(Array.from({ length: jobs }, (_, i) => new Promise<void>((resolve, reject) => {
      const p = spawn(process.execPath, [...process.execArgv, self, ...argv.filter((a) => !a.startsWith('--jobs=')), `--shard=${i}/${jobs}`], { stdio: 'inherit' });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}`))));
    })));
  } else {
    const file = join(out, 'games.0.jsonl');
    for (const cell of cells) for (let s = 0; s < seeds; s++) appendFileSync(file, `${JSON.stringify(playGame(cell, seedOf(s), { commander }))}\n`);
  }
  const records: GameRecord[] = [];
  for (const f of readdirSync(out).filter((n) => /^games\.\d+\.jsonl$/.test(n))) {
    for (const l of readFileSync(join(out, f), 'utf8').split('\n')) if (l.trim() !== '') records.push(JSON.parse(l) as GameRecord);
  }
  const table = tableOf(rowsOf(records));
  writeFileSync(join(out, 'table.md'), `${table}\n`);
  console.log(table);
  console.log(`\n${records.length} games, ${records.filter((r) => r.status === 'played').length} played, ${records.filter((r) => r.status === 'unsupported').length} unsupported, ${records.filter((r) => r.status === 'error').length} errors; ${(records.reduce((a, r) => a + r.wallMs, 0) / 1000).toFixed(0)} s of game time`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exitCode = 2; });
}
