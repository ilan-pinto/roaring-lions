// The breach probe (N2 prerequisites, P6): does side 1's auto-breach tilt a versus match?
//
// REPORT-ONLY, like the versus probe it builds on (`versus-probe.ts`): it prints
// tables and exits 0 whatever they say. Exit 2 is reserved for its own controls,
// below, because a count from a counter that cannot see a breach is worse than none.
//
// What it measures. `Sim.selectBreachTarget` returns -1 for side 0, so only
// side 1 cuts walls on its own initiative. In a versus room seat 1 is side 1. A
// unit is BREACHING on a tick when `state.curStructure` names a structure it
// cannot garrison and it holds no demolition (`state.demoTarget < 0`):
// `selectStructureTarget`, the only other writer of `curStructure`, picks only
// OCCUPIED buildings, and a structure with no garrison slots is never occupied,
// so a wall in `curStructure` is a breach and nothing else. Per side it counts
// breach unit-ticks, the unit-ticks of those spent halted or braced (time lost),
// wall HP removed by a breaching shooter (against wall HP removed any other way:
// splash, a stray round; demolition is 0 here, nobody is ordered to demolish),
// and walls brought down.
//
// The play is the versus probe's own: each side's whole force attack-moves on
// the other's living centroid, re-ordered every 20 s, decided by the real rule
// (`outcomeOf`) or a 10-minute cap decided on surviving value. Pure sim, with
// commands applied on the tick they are queued: the relay's input delay applies
// to both seats alike and is left out. The arena's `rush` policy (PR #632) is
// not on main and is not ported.
//
// The outcome effect, by a counterfactual that needs no sim change. The rule
// keys on SIDE; the ground keys on CAMP (camp A is the map's friendly anchor,
// camp B the hostile one). Every seed is played twice: NORMAL, camp A is side 0
// and camp B side 1 (exactly `versusSpawns`), and SWAPPED, camp A is side 1 and
// camp B side 0. Each camp keeps its faction, its tiles, its facing, its entity
// ids (camp A is spawned first in both, so the per-entity RNG streams are the
// same) and its orders (camp A's first, as the probe orders side 0 first). The
// only thing that changes is which camp carries the breach rule. A game in
// which nobody breaches in either arm must therefore read the same, camp for
// camp, tick for tick: that is a control, and the reason the difference between
// the arms can be laid at the rule's door.
//
//   pnpm versus:breach                       every fair map, the room's pairings, 48 seeds
//   pnpm versus:breach -- --maps=wadi_tarfan --seeds=12
//
// THE CONTROLS (versus-breach.test.ts), each seen red under a one-line mutation:
//   B1 isBreach(): drop `garrisonSlots === 0` (count `curStructure` on any
//      structure) -- the garrison control, where side 0 shells a building with
//      side 1 inside, reads side-0 breach ticks > 0.
//   B2 isBreach(): `state.demoTarget[i] < 0` -> `>= 0` -- side 1 reads 0 breach
//      ticks on wadi_tarfan, where it cuts walls in every game.
//   B3 spawnCamps(): place camp B first in the swapped arm -- the entity ids
//      move, and a wall-less map no longer reads the same game in both arms.

import { fileURLToPath } from 'node:url';
import { BRACE_NONE, type Sim } from '@lions/sim';
import { maps, type MapId } from '@lions/data';
import { FACTION_MATCHUP_MAPS, VERSUS_FAIR_MAPS, validateConfig, type Faction, type MatchConfig } from '@lions/net';
import { sandboxAnchors, type SandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { hostileFacing } from '../../../packages/app/src/sandbox-facing';
import { placeOnOpen } from '../../../packages/app/src/sandbox-place';
import { versusForceOf } from '../../../packages/app/src/net/versus-force';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { MATCH_CAP_TICKS, forcesOf, outcomeOf, type MatchResult } from '../../../packages/app/src/net/outcome';
import { CAP_TICKS_DEFAULT, DECIDE_EVERY_TICKS, ORDER_EVERY_TICKS, SEEDS_DEFAULT, centroid, seedOf, world, type Finish } from './versus-probe';

const TICKS_PER_SECOND = 20;
const ONE = 65536;

/** The seed and tick count the versus mirror pins are taken at (versus-force.test.ts, match-world.test.ts). */
export const PIN_SEED = 20260727;
export const PIN_TICKS = 200;
export const PIN_MAPS: readonly MapId[] = ['beit_sahwan_outskirts', 'tel_marum'];

// ---------------------------------------------------------------------------
// The counter
// ---------------------------------------------------------------------------

/** Whether unit `i` is breaching this tick: shooting a structure it cannot garrison, under no demolition. */
export function isBreach(sim: Sim, i: number): boolean {
  const s = sim.state.curStructure[i];
  if (s < 0) return false;
  const type = sim.structureTypes[sim.structures.typeIdx[s]];
  return type.garrisonSlots === 0 && sim.state.demoTarget[i] < 0;
}

export type BreachFn = typeof isBreach;
type Pair = [number, number];

/** Breach activity by SIDE (index 0 is side 0). HP is in whole structure points. */
export interface Activity {
  /** Unit-ticks with a breach target. */
  ticks: Pair;
  /** Of those, unit-ticks halted (not moving) or braced (kneeling, dropping, rising). */
  halted: Pair;
  /** Wall HP removed by a shooter whose last breach target was that wall. */
  breachHp: Pair;
  /** Wall HP removed any other way (splash, a stray round). */
  otherWallHp: Pair;
  /** Walls brought down, by the side of the unit that did it. */
  wallsDown: Pair;
  /** The first tick each side breached on, or null. */
  first: [number | null, number | null];
  /** Unit-ticks shooting a GARRISONABLE structure (a control: side 0 may do this). */
  structureFire: Pair;
}

export const emptyActivity = (): Activity => ({
  ticks: [0, 0], halted: [0, 0], breachHp: [0, 0], otherWallHp: [0, 0], wallsDown: [0, 0], first: [null, null], structureFire: [0, 0],
});

/** Folds one tick into `a`: the events the tick returned, then the state it left. */
export class Counter {
  readonly a = emptyActivity();
  private readonly lastBreach = new Map<number, number>();
  constructor(private readonly sim: Sim, private readonly breach: BreachFn = isBreach) {}

  private isWall(s: number): boolean {
    return this.sim.structureTypes[this.sim.structures.typeIdx[s]].garrisonSlots === 0;
  }

  fold(events: ReturnType<Sim['tick']>): void {
    const { sim, a } = this;
    for (const e of events) {
      if (e.kind === 'structureHit' && e.by >= 0 && this.isWall(e.structure)) {
        const side = sim.state.side[e.by];
        if (side !== 0 && side !== 1) continue;
        const hp = e.damage / ONE;
        if (this.lastBreach.get(e.by) === e.structure) a.breachHp[side] += hp; else a.otherWallHp[side] += hp;
      } else if (e.kind === 'structureDestroyed' && e.by >= 0 && this.isWall(e.structure)) {
        const side = sim.state.side[e.by];
        if (side === 0 || side === 1) a.wallsDown[side]++;
      }
    }
    const st = sim.state;
    for (let i = 0; i < sim.entityCount; i++) {
      if (st.alive[i] !== 1) continue;
      const side = st.side[i];
      if (side !== 0 && side !== 1) continue;
      if (this.breach(sim, i)) {
        a.ticks[side]++;
        if (st.moving[i] === 0 || st.brace[i] !== BRACE_NONE) a.halted[side]++;
        if (a.first[side] === null) a.first[side] = sim.tickCount;
        this.lastBreach.set(i, st.curStructure[i]);
      } else if (st.curStructure[i] >= 0 && !this.isWall(st.curStructure[i])) {
        a.structureFire[side]++;
      }
    }
  }
}

export function addActivity(into: Activity, a: Activity): void {
  for (const k of ['ticks', 'halted', 'breachHp', 'otherWallHp', 'wallsDown', 'structureFire'] as const) {
    into[k][0] += a[k][0];
    into[k][1] += a[k][1];
  }
}

// ---------------------------------------------------------------------------
// The two arms
// ---------------------------------------------------------------------------

export type Arm = 'normal' | 'swapped';
/** The side each camp plays in an arm: [camp A, camp B]. */
export const sidesOf = (arm: Arm): [0 | 1, 0 | 1] => (arm === 'normal' ? [0, 1] : [1, 0]);

/**
 * Each camp's force on its own anchor, as `versusSpawns` places them, camp A
 * first; only the side each is given depends on the arm. In the normal arm
 * this IS `versusSpawns` (pinned in the test against the mirror pins).
 * Returns entity ids by CAMP.
 */
export function spawnCamps(sim: Sim, typeOf: Map<string, number>, anchors: SandboxAnchors, factionsByCamp: readonly [Faction, Faction], arm: Arm): [number[], number[]] {
  const place = placeOnOpen(sim, typeOf);
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const faceA = hostileFacing(bx, by, ax, ay);
  const faceB = hostileFacing(ax, ay, bx, by);
  const [sideA, sideB] = sidesOf(arm);
  const camps: [number[], number[]] = [[], []];
  for (const [id, dx, dy] of versusForceOf(factionsByCamp[0])) camps[0].push(place(id, sideA, ax + dx, ay + dy, faceA));
  for (const [id, dx, dy] of versusForceOf(factionsByCamp[1])) camps[1].push(place(id, sideB, bx - dx, by - dy, faceB));
  return camps;
}

export interface CampGame {
  /** The winning CAMP (0 is A, the friendly anchor), or null for a draw. */
  winnerCamp: 0 | 1 | null;
  by: Finish;
  ticks: number;
  /** Surviving force value by CAMP at the end. */
  value: Pair;
  /** Breach activity by SIDE. */
  activity: Activity;
}

export interface CampOptions {
  capTicks?: number;
  breach?: BreachFn;
}

/** One game in one arm: the versus probe's play, ordered and read by camp. */
export function playCamps(mapId: MapId, factionsByCamp: readonly [Faction, Faction], seed: number, arm: Arm, opts: CampOptions = {}): CampGame {
  const capTicks = opts.capTicks ?? CAP_TICKS_DEFAULT;
  const { sim, typeOf, map } = world(mapId, seed);
  const camps = spawnCamps(sim, typeOf, sandboxAnchors(map), factionsByCamp, arm);
  const sideOf = sidesOf(arm);
  const counter = new Counter(sim, opts.breach);
  const finish = (o: MatchResult): CampGame => {
    const by: Finish = o.by === 'annihilation' || o.by === 'mutual' || o.by === 'stalemate' ? o.by : 'cap';
    const f = forcesOf(sim);
    return {
      winnerCamp: o.kind === 'won' ? (o.side === sideOf[0] ? 0 : 1) : null,
      by,
      ticks: sim.tickCount,
      value: [f[sideOf[0]], f[sideOf[1]]],
      activity: counter.a,
    };
  };
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      for (const camp of [0, 1] as const) {
        const target = centroid(sim, sideOf[camp === 0 ? 1 : 0]);
        const ids = camps[camp].filter((id) => sim.state.alive[id] === 1);
        if (target && ids.length > 0) sim.queueCommand({ kind: 'attackMove', ids, x: target[0], y: target[1] });
      }
    }
    counter.fold(sim.tick());
    if (sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(sim, sim.tickCount);
      if (o.kind !== 'ongoing') return finish(o);
    }
  }
  const o = outcomeOf(sim, MATCH_CAP_TICKS);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return finish(o);
}

/** Whether two arms of one seed read the same game, camp for camp. */
export const sameGame = (x: CampGame, y: CampGame): boolean =>
  x.winnerCamp === y.winnerCamp && x.by === y.by && x.ticks === y.ticks && x.value[0] === y.value[0] && x.value[1] === y.value[1];

// ---------------------------------------------------------------------------
// The garrison control (for B1): side 0 shells a building side 1 holds
// ---------------------------------------------------------------------------

/**
 * Side 1's infantry garrisons the garrisonable building nearest its own
 * anchor and holds; side 0 attack-moves onto it. Side 0 then shoots a
 * structure -- through `selectStructureTarget`, never a breach -- so a counter
 * that reads that as a breach reads side 0 above zero.
 */
export function garrisonControl(mapId: MapId = 'wadi_tarfan', breach: BreachFn = isBreach, ticks = 1600): Activity {
  const { sim, typeOf, map } = world(mapId, seedOf(0));
  const anchors = sandboxAnchors(map);
  const camps = spawnCamps(sim, typeOf, anchors, ['kdf', 'kdf'], 'normal');
  const [ax, ay] = anchors.hostile;
  let best = -1;
  let bestD = Infinity;
  for (let s = 0; s < sim.structureCount; s++) {
    if (sim.structureTypes[sim.structures.typeIdx[s]].garrisonSlots === 0) continue;
    const d = (sim.structures.cx[s] / ONE - ax) ** 2 + (sim.structures.cy[s] / ONE - ay) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  if (best < 0) throw new Error(`${mapId}: no garrisonable structure for the garrison control`);
  const inf = camps[1].filter((id) => sim.unitTypes[sim.state.typeIdx[id]].id === 'inf_squad');
  sim.queueCommand({ kind: 'garrison', ids: inf, structure: best });
  const counter = new Counter(sim, breach);
  for (let t = 0; t < ticks; t++) {
    if (t === 600) sim.queueCommand({ kind: 'attackMove', ids: camps[0], x: sim.structures.cx[best], y: sim.structures.cy[best] });
    counter.fold(sim.tick());
  }
  return counter.a;
}

// ---------------------------------------------------------------------------
// The mirror pins' first 200 ticks
// ---------------------------------------------------------------------------

/** A KDF mirror room's config, as match-world.test.ts builds it. */
function mirrorConfig(map: string, seed: number): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error(`no valid mirror config for ${map}`);
  return c;
}

/** Breach activity over the pins' own 200 idle ticks, in the world a pin is taken in. */
export function pinWindow(mapId: MapId, how: 'helper' | 'room', breach: BreachFn = isBreach): { activity: Activity; hash: number } {
  let sim: Sim;
  if (how === 'helper') {
    const w = world(mapId, PIN_SEED);
    spawnCamps(w.sim, w.typeOf, sandboxAnchors(w.map), ['kdf', 'kdf'], 'normal');
    sim = w.sim;
  } else {
    sim = buildMatchWorld(mirrorConfig(mapId, PIN_SEED)).sim;
  }
  const counter = new Counter(sim, breach);
  for (let i = 0; i < PIN_TICKS; i++) counter.fold(sim.tick());
  return { activity: counter.a, hash: sim.hash() };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Two-sided exact binomial (sign) test at p = 1/2: `plus` successes of `n`. */
export function signTestP(plus: number, n: number): number {
  if (n === 0) return 1;
  const k = Math.min(plus, n - plus);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Camp B's score in a game: 1 a win, 1/2 a draw, 0 a loss. */
const scoreB = (g: CampGame): number => (g.winnerCamp === 1 ? 1 : g.winnerCamp === null ? 0.5 : 0);

export interface Effect {
  n: number;
  /** Camp B's wins / draws when it is side 1 (normal) and when it is side 0 (swapped). */
  bWinsNormal: number; drawsNormal: number;
  bWinsSwapped: number; drawsSwapped: number;
  /** Seeds whose result moved toward camp B when it carried the rule, and away. */
  better: number; worse: number;
  /** Sign test on `better` vs `worse`. */
  p: number;
  /** Same, on camp B's end value margin (B minus A). */
  marginUp: number; marginDown: number; marginP: number;
  meanMarginNormal: number; meanMarginSwapped: number;
  /** Seeds whose two arms read the same game. */
  identical: number;
  /** Seeds with no breach in either arm whose two arms differ (must be 0: the control). */
  unexplained: number;
}

export function effectOf(pairs: readonly (readonly [CampGame, CampGame])[]): Effect {
  const e: Effect = {
    n: pairs.length, bWinsNormal: 0, drawsNormal: 0, bWinsSwapped: 0, drawsSwapped: 0, better: 0, worse: 0, p: 1,
    marginUp: 0, marginDown: 0, marginP: 1, meanMarginNormal: 0, meanMarginSwapped: 0, identical: 0, unexplained: 0,
  };
  for (const [nrm, swp] of pairs) {
    if (nrm.winnerCamp === 1) e.bWinsNormal++;
    if (nrm.winnerCamp === null) e.drawsNormal++;
    if (swp.winnerCamp === 1) e.bWinsSwapped++;
    if (swp.winnerCamp === null) e.drawsSwapped++;
    const d = scoreB(nrm) - scoreB(swp);
    if (d > 0) e.better++; else if (d < 0) e.worse++;
    const mN = nrm.value[1] - nrm.value[0];
    const mS = swp.value[1] - swp.value[0];
    e.meanMarginNormal += mN / pairs.length;
    e.meanMarginSwapped += mS / pairs.length;
    if (mN > mS) e.marginUp++; else if (mN < mS) e.marginDown++;
    if (sameGame(nrm, swp)) e.identical++;
    else if (nrm.activity.ticks[1] === 0 && swp.activity.ticks[1] === 0 && nrm.activity.ticks[0] === 0 && swp.activity.ticks[0] === 0) e.unexplained++;
  }
  e.p = signTestP(e.better, e.better + e.worse);
  e.marginP = signTestP(e.marginUp, e.marginUp + e.marginDown);
  return e;
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/** The pairings a room offers on a map, by CAMP (camp A is the host's seat, side 0). */
export function pairingsOn(mapId: string): [Faction, Faction][] {
  const out: [Faction, Faction][] = [['kdf', 'kdf']];
  if (FACTION_MATCHUP_MAPS.includes(mapId)) out.push(['kdf', 'sarim'], ['sarim', 'kdf']);
  return out;
}

const flag = (args: readonly string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const r1 = (x: number): string => x.toFixed(1);
const p3 = (x: number): string => (x < 0.001 ? x.toExponential(1) : x.toFixed(3));

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const mapArg = flag(args, 'maps');
  const mapIds = (mapArg?.split(',') ?? VERSUS_FAIR_MAPS) as MapId[];
  for (const id of mapIds) if (!(id in maps)) throw new Error(`--maps: "${id}" is not a shipped map`);
  const seeds = Number(flag(args, 'seeds') ?? SEEDS_DEFAULT);
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');

  // The controls first.
  const failures: string[] = [];
  const g = garrisonControl();
  if (g.structureFire[0] === 0) failures.push('garrison control: side 0 never shot the held building, so it proves nothing');
  if (g.ticks[0] !== 0) failures.push(`garrison control: side 0 read ${g.ticks[0]} breach ticks; side 0 cannot breach`);
  if (g.ticks[1] === 0) failures.push('garrison control: side 1, holding beside its walls, read no breach tick, so the counter sees nothing');
  if (failures.length > 0) {
    console.error('CONTROL FAILED -- no table is printed:');
    for (const f of failures) console.error(`  ${f}`);
    return 2;
  }
  console.log(`breach probe (report-only): ${seeds} seeds per cell, the versus probe's play, cap ${CAP_TICKS_DEFAULT / TICKS_PER_SECOND} s`);
  console.log(`garrison control: side 0 shelled a held building for ${g.structureFire[0]} unit-ticks and read 0 breach ticks; side 1 read ${g.ticks[1]} -- passed`);

  console.log('\nThe mirror pins\' first 200 ticks (seed 20260727, no orders):');
  for (const id of [...new Set([...PIN_MAPS, ...mapIds])]) {
    for (const how of ['helper', 'room'] as const) {
      const w = pinWindow(id, how);
      console.log(`  ${pad(id, 24)}${pad(how, 8)}breach unit-ticks side0 ${w.activity.ticks[0]} side1 ${w.activity.ticks[1]}  hash ${w.hash}`);
    }
  }

  const unexplained: string[] = [];
  console.log('\nActivity by SIDE, normal arm (side 0 = camp A, the friendly anchor):');
  console.log(`${pad('map', 24)}${pad('A/B', 12)}${pad('games w/ breach', 17)}${pad('breach u-ticks 0/1', 20)}${pad('halted 0/1', 16)}${pad('breach HP 0/1', 18)}${pad('other wall HP 0/1', 20)}${pad('walls down 0/1', 16)}${pad('1st (min/med)', 14)}swapped arm u-ticks 0/1`);
  const effects: string[] = [];
  for (const id of mapIds) {
    for (const fac of pairingsOn(id)) {
      const pairs: [CampGame, CampGame][] = [];
      const sum = emptyActivity();
      const sumS = emptyActivity();
      let withBreach = 0;
      const firsts: number[] = [];
      for (let n = 0; n < seeds; n++) {
        const nrm = playCamps(id, fac, seedOf(n), 'normal');
        const swp = playCamps(id, fac, seedOf(n), 'swapped');
        pairs.push([nrm, swp]);
        addActivity(sum, nrm.activity);
        addActivity(sumS, swp.activity);
        if (nrm.activity.ticks[1] > 0) withBreach++;
        if (nrm.activity.first[1] !== null) firsts.push(nrm.activity.first[1]);
      }
      firsts.sort((x, y) => x - y);
      const fst = firsts.length === 0 ? '-' : `${firsts[0]}/${firsts[Math.floor(firsts.length / 2)]}`;
      console.log(
        `${pad(id, 24)}${pad(`${fac[0]}/${fac[1]}`, 12)}${pad(`${withBreach}/${seeds}`, 17)}${pad(`${sum.ticks[0]}/${sum.ticks[1]}`, 20)}${pad(`${sum.halted[0]}/${sum.halted[1]}`, 16)}` +
          `${pad(`${r1(sum.breachHp[0])}/${r1(sum.breachHp[1])}`, 18)}${pad(`${r1(sum.otherWallHp[0])}/${r1(sum.otherWallHp[1])}`, 20)}${pad(`${sum.wallsDown[0]}/${sum.wallsDown[1]}`, 16)}${pad(fst, 14)}${sumS.ticks[0]}/${sumS.ticks[1]}`,
      );
      const e = effectOf(pairs);
      if (e.unexplained > 0) unexplained.push(`${id} ${fac.join('/')}: ${e.unexplained} seed(s) differ with no breach in either arm`);
      effects.push(
        `${pad(id, 24)}${pad(`${fac[0]}/${fac[1]}`, 12)}${pad(e.n, 4)}${pad(`${e.bWinsNormal}/${e.drawsNormal}`, 14)}${pad(`${e.bWinsSwapped}/${e.drawsSwapped}`, 14)}` +
          `${pad(`${e.better}/${e.worse}`, 10)}${pad(p3(e.p), 9)}${pad(`${r1(e.meanMarginNormal)} / ${r1(e.meanMarginSwapped)}`, 22)}${pad(`${e.marginUp}/${e.marginDown}`, 10)}${pad(p3(e.marginP), 9)}${e.identical}`,
      );
    }
  }
  console.log('\nOutcome effect: camp B carrying the rule (normal, side 1) against not (swapped, side 0), paired by seed:');
  console.log(`${pad('map', 24)}${pad('A/B', 12)}${pad('n', 4)}${pad('B win/draw N', 14)}${pad('B win/draw S', 14)}${pad('up/down', 10)}${pad('p', 9)}${pad('B margin N / S', 22)}${pad('m up/dn', 10)}${pad('p', 9)}identical`);
  for (const line of effects) console.log(line);
  if (unexplained.length > 0) {
    console.error('\nSWAP CONTROL FAILED -- the arms differ where nobody breached, so the difference is not the rule:');
    for (const u of unexplained) console.error(`  ${u}`);
    return 2;
  }
  console.log('\nswap control: every seed with no breach in either arm read the same game in both -- passed');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
