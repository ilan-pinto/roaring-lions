// The versus probe's WIN-MODE arm (GH-976 P1, `pnpm versus:probe -- --mode=camp|points|all`).
//
// REPORT-ONLY, like the rest of the probe: it prints the tables and the verdict lines and exits 0, except for its
// own self-check (exit 2). Whether a mode opens on a map is the lead's call; this is the instrument.
//
// A game is a room's own world: `buildMatchWorld` of a versus config (a mirror, KDF v KDF, unless `--arr` says two factions) with `winMode` set, so a
// GOALS-ONLY runtime stands (camps owned and targetable, or a score per side), stepped by the room's `matchTick`
// and decided by the room's rule (`outcomeOf` with `goalsOf`, at the map's own cap: 25 minutes, not the
// probe's 10). Each side re-plays its mode every 20 s (`ORDER_EVERY_TICKS`), reading nothing of the other:
//   camp    the side's whole force attack-moves on the ENEMY camp's exit (the camp's footprint is blocked ground,
//           so the order aims at the tile its production would deploy to);
//   points  the force splits over the nearest unheld zones: units standing in a zone the side already holds keep
//           half of themselves there (at least one) as its garrison, and the rest are divided evenly over the
//           three zones nearest the side's own seat that it does not hold, nearest first;
//   flag    (GH-976 P3, a raid) two squads go for the ENEMY end's flag zone and hold it; the rest stay in the blob, which
//           is the base probe's own play (`order`, versus-probe.ts): attack-move on the other side's living centroid. The
//           two squads are the first two infantry units in placement order, latched at the first order and never re-picked
//           (a dead raider is not replaced from the blob: a raid is the two it sent). Both sides place the same force in
//           the same order, so the choice is the same in each seat's own frame.
// A PASSIVE seat issues no order at all and stays where it spawned.
//
// THE CELLS (GH-976 P4). `--arr=<friendly>/<hostile>` picks the factions by END, as the base probe does: `kdf/kdf`, the mirror, is
// the default and what every earlier reading played; `kdf/sarim` is the matchup `kdf` (the host fields the KDF and stands west),
// `sarim/kdf` the matchup `sarim` (the host fields Sarim, side 1, at the friendly end). A KDF-v-Sarim mode room is the two PLACED
// forces, no production and no tunnels (`economyRoom` is false for it), so the arm plays it with the same orders; a faction
// cell reads by END, which within one arrangement is by faction, and the two seat orders are read together: a faction edge shows
// in both, a spawn edge flips between them.
//
// What a cell reads (`--seeds` games each; seed n is `seedOf(n)`, the probe's 1000 + 7919 n):
//   - the ACTIVE cell: both seats play the mode. Fairness is the leader's share against 60/40 (`FAIR_MAX_PERCENT`), by
//     END (west/east), read twice: over ALL the seeds, and (GH-976 P4) over the DECISIVE games alone, so that draws (the
//     flag raid's same-tick double capture) cannot hide a lopsided read; and the share of games decided BY THE GOAL
//     (`objective`), which must reach 70% (`GOAL_SHARE_MIN_PERCENT`);
//   - the PASSIVE cells, one per END: that END stays home and the other plays the mode. The passive seat must
//     lose, every game, before the cap: a cap, a draw or a passive win is a mode a turtle can hold.
// A mode that fails on a map stays unoffered. Nothing here tunes a unit.
//
// THE SELF-CHECK, and the mutations that turn it red (each seen red in `versus-modes.test.ts`):
//   - the east end cut to one squad, both seats playing: the west must win; then the west cut: the east must win
//     (sees a swapped winner, and orders that never reach a side);
//   - one seed twice is one game.
//   M1  finish(): `winner: o.kind === 'won' ? ... sideOfEnd.indexOf(o.side)`  ->  the other index
//   M2  campOrder(): the enemy end -> the own end  (each side marches home: nobody razes, the control runs to the cap)
//   M3  flagOrder(): the enemy end's flag -> the own end's  (the raiders sit on their own flag: nobody captures, the control runs to the cap)
//   M4  raidParty(): two squads -> none  (nobody leaves the blob: the flag is never held)
//
// Usage (run through the probe):
//   pnpm versus:probe -- --mode=camp --maps=wadi_tarfan --seeds=96
//   flags: --mode=<camp|points|flag|all>  --maps=<id,id>  --seeds=<n>  --seed-from=<n>  --passive=<on|off>  --wipe=<ends|off>  --no-self-check
//          --arr=<kdf/kdf,kdf/sarim,sarim/kdf>   the factions by END, friendly first; default the mirror (GH-976 P4)
//          --zones=<zone:rate,...>  --kill=<n>  --target=<n>   fit the points race in memory (never written to disk)
//          --flags=<x,y,w,h/x,y,w,h>  --hold=<s>   fit the flag raid in memory (friendly then hostile ground; never written to disk)

import { fileURLToPath } from 'node:url';
import { versusModes, type MapId, type WinModeId } from '@lions/data';
import { WIN_MODES, matchCapTicks, validateConfig, type MatchConfig } from '@lions/net';
import { goalsOf, outcomeOf, unitCost, type MatchResult } from '../../../packages/app/src/net/outcome';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { FAIR_MAX_PERCENT, ORDER_EVERY_TICKS, DECIDE_EVERY_TICKS, SEEDS_DEFAULT, livingOf, loneSurvivorOf, order, parseArrangements, roomConfig, seedOf, type Arrangement } from './versus-probe';
import { fx, type Sim } from '@lions/sim';
import { units } from '@lions/data';

/** The lead's bar for the goal: at least this share of a cell's games are decided by it, not by a wipe or the cap. */
export const GOAL_SHARE_MIN_PERCENT = 70;

/** How a mode game ended: `objective` is the goal; the rest are the room's other endings. */
export type ModeFinish = 'objective' | 'annihilation' | 'mutual' | 'stalemate' | 'cap';

export interface ModePlayed {
  /** The winning END (0 friendly/west, 1 hostile/east), or null for a draw. */
  winner: 0 | 1 | null;
  by: ModeFinish;
  ticks: number;
  /** Final points by END (a points race), else absent. */
  points?: [number, number];
}

export interface ModePlayOptions {
  /** The factions by END, `[friendly, hostile]` (the host's end first): `['kdf', 'kdf']`, the mirror, unless given. A KDF-v-Sarim
   *  cell is a mode room too (`economyRoom` is false for it): the two PLACED forces, no production, no tunnels, a goals-only
   *  runtime (GH-976 P4). The cell is read by END, which is by faction within one arrangement. */
  arr?: Arrangement;
  /** The END that issues no order (0 friendly, 1 hostile). */
  passive?: 0 | 1;
  /** CONTROL ONLY: cut this END to one infantry squad before the first tick. In the flag mode the cut end also takes no
   *  order: its lone survivor is the raid's first squad, and a one-man race against the strong end's raid would not be a control. */
  cutEnd?: 0 | 1;
  /** EXPERIMENT ONLY (`--wipe=off`), NOT the room's rule: a wiped side does not end the match. Both sides are told
   *  they can still field a unit (`OutcomeProduction.canField`), so the annihilation and stalemate rules never
   *  fire and only the goal or the cap decides. It answers one question for the lead: how much of the goal share
   *  does annihilation take? */
  wipeEnds?: false;
}

/** The mirror, the arrangement every cell played before GH-976 P4. */
export const MIRROR: Arrangement = ['kdf', 'kdf'];

/** A mode room's config: the probe cell's (the mirror unless `arr` says two factions), with the mode set. */
export function modeConfig(mapId: MapId, mode: WinModeId, seed: number, arr: Arrangement = MIRROR): MatchConfig {
  const c = validateConfig({ ...roomConfig(mapId, arr, seed), winMode: mode });
  if (c === null) throw new Error(`versus modes: no valid ${mode} room config for ${mapId} ${arr.join('/')}`);
  return c;
}

/** A side's finish read back as its END. */
function finish(o: MatchResult, ticks: number, sideOfEnd: readonly [0 | 1, 0 | 1]): Pick<ModePlayed, 'winner' | 'by' | 'ticks'> {
  const by: ModeFinish = o.by === 'objective' || o.by === 'annihilation' || o.by === 'mutual' || o.by === 'stalemate' ? o.by : 'cap';
  return { winner: o.kind === 'won' ? sideOfEnd.indexOf(o.side) as 0 | 1 : null, by, ticks };
}


/** The point the camp mode aims a side at: the exit of the camp standing at `end`. */
function campExit(w: MatchWorld, mapId: string, end: 'friendly' | 'hostile'): [number, number] {
  const camp = versusModes[mapId]?.camps?.[end];
  if (camp === undefined) throw new Error(`versus modes: ${mapId} has no camp at its ${end} end`);
  const s = w.sim.structureAt(camp.at[0], camp.at[1]);
  if (s < 0) throw new Error(`versus modes: no structure stands at the ${end} camp of ${mapId}`);
  const [x, y] = w.sim.structureExit(s);
  return [x, y];
}

/** Every side's `camp` order: its whole living force attack-moves on the ENEMY end's camp exit. */
export function campOrder(w: MatchWorld, mapId: string, passiveSide: number): void {
  for (const side of [0, 1] as const) {
    if (side === passiveSide) continue;
    const target = campExit(w, mapId, w.endOfSide[side === 0 ? 1 : 0]);
    const ids = livingOf(w.sim, side);
    if (ids.length > 0) w.sim.queueCommand({ kind: 'attackMove', ids, x: target[0], y: target[1] });
  }
}

/** How many squads a flag raid sends. */
export const RAID_SQUADS = 2;

/** The raid party of one side: its first `RAID_SQUADS` living infantry units in placement order. */
export function raidParty(w: MatchWorld, side: 0 | 1): number[] {
  const out: number[] = [];
  for (const id of livingOf(w.sim, side)) {
    if (out.length >= RAID_SQUADS) break;
    const type = w.sim.unitTypes[w.sim.state.typeIdx[id]].id;
    if ((units as Record<string, { role?: string } | undefined>)[type]?.role === 'infantry') out.push(id);
  }
  return out;
}

/** The tile a raid aims at: the centre of the flag zone at `end` (the flag zones of the mode file, `flags`). */
function flagTile(mapId: string, end: 'friendly' | 'hostile'): [number, number] {
  const f = versusModes[mapId]?.flags?.[end];
  if (f === undefined) throw new Error(`versus modes: ${mapId} has no flag at its ${end} end`);
  return [fx.from(f.at[0] + f.size[0] / 2), fx.from(f.at[1] + f.size[1] / 2)];
}

/** The sides that issue no order in a flag game: the passive one, and (CONTROL ONLY) the cut one, whose lone survivor is the raid's
 *  first squad. The other modes order every side that is not passive. */
export function idleSidesFor(mode: WinModeId, passiveSide: number, cutSide: number): Set<number> {
  const out = new Set<number>([passiveSide]);
  if (mode === 'flag' && cutSide >= 0) out.add(cutSide);
  return out;
}

/** Every side's `flag` order: its raid party attack-moves on the ENEMY end's flag; the rest of the force (the blob) plays the
 *  base probe, attack-moving on the other side's living centroid. A side in `idleSides` takes no order at all. */
export function flagOrder(w: MatchWorld, mapId: string, parties: ReadonlyMap<number, readonly number[]>, idleSides: ReadonlySet<number>, sideOfEnd: readonly [0 | 1, 0 | 1]): void {
  const raiding = (id: number): boolean => [...parties.values()].some((p) => p.includes(id));
  order(w.sim, (side) => (idleSides.has(side) ? [] : livingOf(w.sim, side).filter((id) => !raiding(id))), sideOfEnd);
  for (const side of [0, 1] as const) {
    if (idleSides.has(side)) continue;
    const target = flagTile(mapId, w.endOfSide[side === 0 ? 1 : 0]);
    const ids = (parties.get(side) ?? []).filter((id) => w.sim.state.alive[id] === 1);
    if (ids.length > 0) w.sim.queueCommand({ kind: 'attackMove', ids, x: target[0], y: target[1] });
  }
}

const centreOf = (r: readonly number[]): [number, number] => [fx.from(r[0] + r[2] / 2), fx.from(r[1] + r[3] / 2)];
const inRect = (sim: Sim, id: number, r: readonly number[]): boolean => {
  const tx = sim.state.posX[id] >> 16;
  const ty = sim.state.posY[id] >> 16;
  return tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3];
};

/** How many unheld zones the points mode splits a force over. */
export const POINTS_SPLIT = 3;

/** Every side's `points` order: hold what it holds, split the rest over the nearest unheld zones. */
export function pointsOrder(w: MatchWorld, zoneNames: readonly string[], passiveSide: number): void {
  const runtime = w.runtime;
  if (runtime === null) throw new Error('versus modes: a points room has no runtime');
  const holderOf = (name: string): number => runtime.incomeZones.find((z) => z.zone === name)?.holder ?? -1;
  for (const side of [0, 1] as const) {
    if (side === passiveSide) continue;
    const [ax, ay] = w.anchors[w.endOfSide[side]];
    // The runtime's own rects, so a ground the mode file declares (GH-976 P4) reads like a zone of the map.
    const rects = zoneNames.map((n) => {
      const live = runtime.incomeZones.find((z) => z.zone === n);
      if (live === undefined) throw new Error(`versus modes: the points zone "${n}" is not in the room's runtime`);
      return { name: n, r: live.rect };
    });
    // Distances are from the seat's tile CENTRE, so a point-symmetric map gives the two seats mirrored numbers.
    const far = (r: readonly number[]): number => (r[0] + r[2] / 2 - (ax + 0.5)) ** 2 + (r[1] + r[3] / 2 - (ay + 0.5)) ** 2;
    // A tie in distance (the two tells of Milh Flats sit exactly as far from either seat) is broken by the side of the
    // seat-to-map-centre line the zone lies on, which a half turn about the centre carries from one seat to the other:
    // both seats make the SAME choice in their own frame, where a name order would send both to the same zone.
    const cx = w.map.width / 2;
    const cy = w.map.height / 2;
    const turn = (r: readonly number[]): number => (cx - (ax + 0.5)) * (r[1] + r[3] / 2 - (ay + 0.5)) - (cy - (ay + 0.5)) * (r[0] + r[2] / 2 - (ax + 0.5));
    // Holding parties: in each zone this side holds, half of the units standing there (at least one) stay.
    const free: number[] = [];
    const mine = livingOf(w.sim, side).filter((id) => !w.sim.isDown(id));
    const staying = new Set<number>();
    for (const z of rects) {
      if (holderOf(z.name) !== side) continue;
      const inside = mine.filter((id) => inRect(w.sim, id, z.r));
      const keep = Math.max(1, inside.length >> 1);
      for (let k = 0; k < Math.min(keep, inside.length); k++) staying.add(inside[k]);
    }
    for (const id of mine) if (!staying.has(id)) free.push(id);
    const targets = rects.filter((z) => holderOf(z.name) !== side).sort((a, b) => (Math.abs(far(a.r) - far(b.r)) > 1e-6 ? far(a.r) - far(b.r) : Math.abs(turn(a.r) - turn(b.r)) > 1e-6 ? turn(a.r) - turn(b.r) : a.name < b.name ? -1 : 1)).slice(0, POINTS_SPLIT);
    if (targets.length === 0 || free.length === 0) continue;
    const groups: number[][] = targets.map(() => []);
    free.forEach((id, k) => groups[k % targets.length].push(id));
    targets.forEach((z, k) => {
      const [x, y] = centreOf(z.r);
      if (groups[k].length > 0) w.sim.queueCommand({ kind: 'attackMove', ids: groups[k], x, y });
    });
  }
}

/** One game on `mapId` under `mode`. */
export function playMode(mapId: MapId, mode: WinModeId, seed: number, opts: ModePlayOptions = {}): ModePlayed {
  const config = modeConfig(mapId, mode, seed, opts.arr);
  const w = buildMatchWorld(config);
  const runtime = w.runtime;
  if (runtime === null) throw new Error(`versus modes: ${mapId} ${mode} built no runtime`);
  const goals = goalsOf(w);
  const sideOfEnd: [0 | 1, 0 | 1] = [w.endOfSide[0] === 'friendly' ? 0 : 1, w.endOfSide[0] === 'friendly' ? 1 : 0];
  const passiveSide = opts.passive === undefined ? -1 : sideOfEnd[opts.passive];
  const file = versusModes[mapId];
  const zoneNames = file?.modes.points?.zones.map((z) => z.zone) ?? [];
  if (opts.cutEnd !== undefined) {
    const side = sideOfEnd[opts.cutEnd];
    const keep = loneSurvivorOf(w.bySide[side], (id) => (units as Record<string, { role?: string } | undefined>)[w.sim.unitTypes[w.sim.state.typeIdx[id]].id]?.role ?? '');
    for (const id of w.bySide[side]) if (id !== keep) w.sim.debugKill(id);
  }
  // The flag mode's raid parties, latched before the first order; a side that issues no order sends none.
  const idleSides = idleSidesFor(mode, passiveSide, opts.cutEnd === undefined ? -1 : sideOfEnd[opts.cutEnd]);
  const parties = new Map<number, readonly number[]>();
  if (mode === 'flag') for (const side of [0, 1] as const) parties.set(side, raidParty(w, side));
  const cap = matchCapTicks(mapId);
  const production = opts.wipeEnds === false ? { canField: () => true } : undefined;
  const read = (o: MatchResult): ModePlayed => ({
    ...finish(o, w.sim.tickCount, sideOfEnd),
    ...(mode === 'points' ? { points: [runtime.scoreOf(sideOfEnd[0]), runtime.scoreOf(sideOfEnd[1])] as [number, number] } : {}),
  });
  for (let t = 0; t < cap; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      if (mode === 'camp') campOrder(w, mapId, passiveSide);
      else if (mode === 'flag') flagOrder(w, mapId, parties, idleSides, sideOfEnd);
      else pointsOrder(w, zoneNames, passiveSide);
    }
    matchTick(w);
    if (w.sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(w.sim, w.sim.tickCount, unitCost, production, cap, goals);
      if (o.kind !== 'ongoing') return read(o);
    }
  }
  const o = outcomeOf(w.sim, cap, unitCost, production, cap, goals);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a mode game ongoing');
  return read(o);
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

export interface ModeTally {
  seeds: number;
  wins: [number, number];
  draws: number;
  by: Record<ModeFinish, number>;
  ticks: number;
  /** Games decided by the goal. */
  goal: number;
}

export function tallyModes(games: readonly ModePlayed[]): ModeTally {
  const t: ModeTally = { seeds: games.length, wins: [0, 0], draws: 0, by: { objective: 0, annihilation: 0, mutual: 0, stalemate: 0, cap: 0 }, ticks: 0, goal: 0 };
  for (const g of games) {
    if (g.winner === null) t.draws++; else t.wins[g.winner]++;
    t.by[g.by]++;
    t.ticks += g.ticks;
    if (g.by === 'objective') t.goal++;
  }
  return t;
}

/** Integer arithmetic throughout: 58 of 96 is 60.4%, over; 57 of 96 is 59.4%, within. */
export const fairWithin = (t: ModeTally): boolean => Math.max(t.wins[0], t.wins[1]) * 100 <= FAIR_MAX_PERCENT * t.seeds;
/** The same bar over the DECISIVE games only (GH-976 P4): the leader's share of the games somebody won, so a cell with many
 *  draws (the flag raid's same-tick double capture) cannot hide a lopsided read behind them. A cell nobody won is not fair,
 *  it is empty: it fails here rather than passing on zero over zero. */
export const fairWithinDecisive = (t: ModeTally): boolean => {
  const decided = t.wins[0] + t.wins[1];
  return decided > 0 && Math.max(t.wins[0], t.wins[1]) * 100 <= FAIR_MAX_PERCENT * decided;
};
export const goalShareOk = (t: ModeTally): boolean => t.goal * 100 >= GOAL_SHARE_MIN_PERCENT * t.seeds;
/** The passive END lost every game, by the goal or a wipe, never the cap or a draw. */
export const passiveLost = (t: ModeTally, passiveEnd: 0 | 1): boolean => t.wins[passiveEnd === 0 ? 1 : 0] === t.seeds;

const pct = (n: number, of: number): string => (of === 0 ? '0.0' : (Math.round((1000 * n) / of) / 10).toFixed(1));
const mean = (t: ModeTally): number => (t.seeds === 0 ? 0 : Math.round(t.ticks / t.seeds / 20));

/** The tally as one line. A faction cell names the faction at each end, `west (kdf) 12 / east (sarim) 9`; the mirror is
 *  `west 12 / east 9`, as before. */
export function describeTally(t: ModeTally, arr: Arrangement = MIRROR): string {
  const named = (end: string, f: string): string => (arr[0] === arr[1] ? end : `${end} (${f})`);
  return `${named('west', arr[0])} ${t.wins[0]} / ${named('east', arr[1])} ${t.wins[1]} / draw ${t.draws}  by goal ${t.by.objective}, wipe ${t.by.annihilation}, mutual ${t.by.mutual}, stalemate ${t.by.stalemate}, cap ${t.by.cap}  mean ${mean(t)} s`;
}

// ---------------------------------------------------------------------------
// The self-check
// ---------------------------------------------------------------------------

export type ModePlayFn = typeof playMode;

/** The controls on one map and mode; each failure is a sentence. Empty means the arm can tell its sides apart. */
export function modeSelfCheck(mapId: MapId, mode: WinModeId, playFn: ModePlayFn = playMode, arr: Arrangement = MIRROR): string[] {
  const failures: string[] = [];
  const seed = seedOf(0);
  const cell = arr[0] === arr[1] ? `${mapId} ${mode}` : `${mapId} ${mode} ${arr.join('/')}`;
  for (const strong of [0, 1] as const) {
    const g = playFn(mapId, mode, seed, { cutEnd: strong === 0 ? 1 : 0, arr });
    if (g.winner !== strong) failures.push(`${cell}: with end ${strong === 0 ? 1 : 0} cut to one unit, end ${strong} should win; read winner ${String(g.winner)} by ${g.by}`);
    if (g.by === 'cap') failures.push(`${cell}: with end ${strong === 0 ? 1 : 0} cut to one unit the game ran to the cap`);
  }
  const a = playFn(mapId, mode, seed, { arr });
  const b = playFn(mapId, mode, seed, { arr });
  if (a.winner !== b.winner || a.by !== b.by || a.ticks !== b.ticks) failures.push(`${cell}: one seed played twice read two games`);
  return failures;
}

// ---------------------------------------------------------------------------
// The sweep knobs
// ---------------------------------------------------------------------------

/** A points race's numbers, as `--zones`, `--kill` and `--target` set them for one run. */
export interface PointsOverride {
  zones?: { zone: string; per_min: number; at?: number[]; size?: number[] }[];
  perValueDestroyed?: number;
  target?: number;
}

/**
 * Runs `fn` with `mapId`'s points block replaced IN MEMORY (never written to disk), for fitting the numbers on the
 * selection seeds. The block is restored afterwards, also on a throw. `zones` replaces the whole list.
 */
export function withPointsOverride<T>(mapId: string, o: PointsOverride, fn: () => T): T {
  const file = versusModes[mapId] as { modes: { points?: { zones: unknown; per_value_destroyed: number; target: number } } } | undefined;
  const block = file?.modes.points;
  if (block === undefined) throw new Error(`versus modes: ${mapId} has no points block to override`);
  const was = { ...block };
  if (o.zones !== undefined) block.zones = o.zones;
  if (o.perValueDestroyed !== undefined) block.per_value_destroyed = o.perValueDestroyed;
  if (o.target !== undefined) block.target = o.target;
  try { return fn(); } finally { Object.assign(block, was); }
}

/** A flag raid's numbers, as `--flags` and `--hold` set them for one run (GH-976 P4). */
export interface FlagOverride {
  /** `[friendly, hostile]`, each `[x, y, w, h]`. */
  flags?: readonly [readonly number[], readonly number[]];
  holdS?: number;
}

/**
 * Runs `fn` with `mapId`'s flag block replaced IN MEMORY (never written to disk), for fitting the flag grounds on the
 * selection seeds. Restored afterwards, also on a throw.
 */
export function withFlagOverride<T>(mapId: string, o: FlagOverride, fn: () => T): T {
  const file = versusModes[mapId] as { flags?: { friendly: { at: number[]; size: number[] }; hostile: { at: number[]; size: number[] } }; modes: { flag?: { hold_s: number } } } | undefined;
  if (file === undefined || file.modes.flag === undefined || file.flags === undefined) throw new Error(`versus modes: ${mapId} has no flag block to override`);
  const was = { friendly: file.flags.friendly, hostile: file.flags.hostile, hold_s: file.modes.flag.hold_s };
  if (o.flags !== undefined) {
    file.flags.friendly = { at: [o.flags[0][0], o.flags[0][1]], size: [o.flags[0][2], o.flags[0][3]] };
    file.flags.hostile = { at: [o.flags[1][0], o.flags[1][1]], size: [o.flags[1][2], o.flags[1][3]] };
  }
  if (o.holdS !== undefined) file.modes.flag.hold_s = o.holdS;
  try { return fn(); } finally {
    file.flags.friendly = was.friendly;
    file.flags.hostile = was.hostile;
    file.modes.flag.hold_s = was.hold_s;
  }
}

/** `--flags=6,30,5,5/37,13,5,5` as the friendly and the hostile flag rect. */
export function parseFlags(raw: string): [number[], number[]] {
  const parts = raw.split('/');
  const rects = parts.map((r) => r.split(',').map(Number));
  if (parts.length !== 2 || !rects.every((r) => r.length === 4 && r.every((n) => Number.isInteger(n) && n >= 0) && r[2] >= 1 && r[3] >= 1)) {
    throw new Error(`--flags: "${raw}" is not <x>,<y>,<w>,<h>/<x>,<y>,<w>,<h> (friendly then hostile)`);
  }
  return [rects[0], rects[1]];
}

/** `--zones=bir_milh:30,tell_nw:20` as a zone list. */
export function parseZones(raw: string): { zone: string; per_min: number; at?: number[]; size?: number[] }[] {
  // The rect of a declared ground rides after its rate with `@`: `--zones=bir_milh:30,hold_a:20@10,12,6,6` (commas split zones, so the rect
  // uses `x.y.w.h`: `hold_a:20@10.12.6.6`).
  return raw.split(',').map((part) => {
    const [head, rect, ...more] = part.split('@');
    const [zone, rate, ...rest] = head.split(':');
    const per_min = Number(rate);
    if (zone === undefined || zone === '' || rest.length > 0 || more.length > 0 || !Number.isInteger(per_min) || per_min < 1) throw new Error(`--zones: "${part}" is not <zone>:<points a minute>[@x.y.w.h]`);
    if (rect === undefined) return { zone, per_min };
    const n = rect.split('.').map(Number);
    if (n.length !== 4 || !n.every((v) => Number.isInteger(v) && v >= 0) || n[2] < 1 || n[3] < 1) throw new Error(`--zones: "${part}": the ground is not x.y.w.h`);
    return { zone, per_min, at: [n[0], n[1]], size: [n[2], n[3]] };
  });
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const flag = (args: readonly string[], name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Maps that carry a mode file. */
export const modeMaps = (): MapId[] => Object.keys(versusModes) as MapId[];

/** Prints the report and returns the exit code: 0 for any reading, 2 when the self-check fails. */
export function modeMain(args: readonly string[] = process.argv.slice(2), playFn: ModePlayFn = playMode): number {
  const modeArg = flag(args, 'mode') ?? 'all';
  // GH-976 P4: `--arr=kdf/kdf,kdf/sarim,sarim/kdf` as the base probe reads it: the factions by END, friendly first. The default
  // is the mirror alone, the only cell every earlier reading played. `kdf/sarim` is the matchup `kdf` (the host fields the
  // KDF and stands west), `sarim/kdf` the matchup `sarim`.
  const arrangements = parseArrangements(flag(args, 'arr') ?? 'kdf/kdf');
  const modes: WinModeId[] = modeArg === 'all' ? [...WIN_MODES] : [modeArg as WinModeId];
  for (const m of modes) if (!(WIN_MODES as readonly string[]).includes(m)) throw new Error(`--mode: "${m}" is not ${WIN_MODES.join(', ')} or all`);
  const mapIds = (flag(args, 'maps')?.split(',') ?? modeMaps()) as MapId[];
  for (const id of mapIds) if (!Object.hasOwn(versusModes, id)) throw new Error(`--maps: "${id}" has no win-mode file`);
  const seeds = Number(flag(args, 'seeds') ?? SEEDS_DEFAULT);
  const seedFrom = Number(flag(args, 'seed-from') ?? 0);
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');
  if (!Number.isInteger(seedFrom) || seedFrom < 0) throw new Error('--seed-from must be a whole number of at least 0');
  const passiveOn = (flag(args, 'passive') ?? 'on') !== 'off';
  const skipCheck = args.includes('--no-self-check');
  const wipeArg = flag(args, 'wipe') ?? 'ends';
  if (wipeArg !== 'ends' && wipeArg !== 'off') throw new Error('--wipe must be ends (the room\'s rule, the default) or off (an experiment)');
  const wipeEnds = wipeArg === 'ends' ? {} : { wipeEnds: false as const };
  if (wipeArg === 'off') console.log('EXPERIMENT --wipe=off: a wiped side does not end the match; only the goal or the cap does. Not the room\'s rule.');
  const zonesArg = flag(args, 'zones');
  const killArg = flag(args, 'kill');
  const targetArg = flag(args, 'target');
  const override: PointsOverride = {
    ...(zonesArg !== undefined ? { zones: parseZones(zonesArg) } : {}),
    ...(killArg !== undefined ? { perValueDestroyed: Number(killArg) } : {}),
    ...(targetArg !== undefined ? { target: Number(targetArg) } : {}),
  };
  if (override.perValueDestroyed !== undefined && !(Number.isInteger(override.perValueDestroyed) && override.perValueDestroyed >= 0)) throw new Error('--kill must be a whole number of points per 100 value, 0 or more');
  if (override.target !== undefined && !(Number.isInteger(override.target) && override.target >= 1)) throw new Error('--target must be a whole number of points, 1 or more');
  const flagsArg = flag(args, 'flags');
  const holdArg = flag(args, 'hold');
  const flagOverride: FlagOverride = {
    ...(flagsArg !== undefined ? { flags: parseFlags(flagsArg) } : {}),
    ...(holdArg !== undefined ? { holdS: Number(holdArg) } : {}),
  };
  if (flagOverride.holdS !== undefined && !(Number.isInteger(flagOverride.holdS) && flagOverride.holdS >= 5 && flagOverride.holdS <= 120)) throw new Error('--hold must be a whole number of seconds, 5 to 120');
  const flagSweeping = Object.keys(flagOverride).length > 0;
  if (flagSweeping && !modes.includes('flag')) throw new Error('--flags and --hold sweep the flag raid: they need --mode=flag (or all)');
  if (flagSweeping) console.log(`flag override (in memory only): ${JSON.stringify(flagOverride)}`);
  const sweeping = Object.keys(override).length > 0;
  if (sweeping && !modes.includes('points')) throw new Error('--zones, --kill and --target sweep the points race: they need --mode=points (or all)');
  if (sweeping) console.log(`points override (in memory only): ${JSON.stringify(override)}`);
  console.log(`versus modes probe: ${seeds} seeds from ${seedFrom} (seed 1000 + 7919 n), bar ${FAIR_MAX_PERCENT}/${100 - FAIR_MAX_PERCENT}, goal share at least ${GOAL_SHARE_MIN_PERCENT}%, passive seat must lose`);
  let failed = 0;
  if (!skipCheck) {
    for (const mapId of mapIds) for (const mode of modes) for (const arr of arrangements) {
      const problems = modeSelfCheck(mapId, mode, playFn, arr);
      for (const p of problems) { console.log(`SELF-CHECK FAILED: ${p}`); failed++; }
    }
    if (failed > 0) return 2;
    console.log('self-check: ok');
  }
  const rows = (mapId: MapId, mode: WinModeId, opts: ModePlayOptions): ModePlayed[] => {
    const out: ModePlayed[] = [];
    for (let n = seedFrom; n < seedFrom + seeds; n++) out.push(playFn(mapId, mode, seedOf(n), { ...opts, ...wipeEnds }));
    return out;
  };
  const run = (mapId: MapId): void => {
    for (const mode of modes) for (const arr of arrangements) {
      // The mirror's lines read as they always did; a faction cell names its arrangement, and the faction at each end.
      const cell = arr[0] === arr[1] ? `${mapId} ${mode}` : `${mapId} ${mode} ${arr.join('/')}`;
      const active = tallyModes(rows(mapId, mode, { arr }));
      console.log(`${cell} active:   ${describeTally(active, arr)}`);
      const verdicts = [
        `fair ${fairWithin(active) ? 'within' : 'OUTSIDE'} (${pct(Math.max(...active.wins), active.seeds)}%)`,
        `decisive ${fairWithinDecisive(active) ? 'within' : 'OUTSIDE'} (${pct(Math.max(...active.wins), active.wins[0] + active.wins[1])}% of ${active.wins[0] + active.wins[1]})`,
        `goal share ${pct(active.goal, active.seeds)}% ${goalShareOk(active) ? 'ok' : 'LOW'}`,
      ];
      if (passiveOn) {
        for (const end of [0, 1] as const) {
          const p = tallyModes(rows(mapId, mode, { passive: end, arr }));
          console.log(`${cell} passive ${end === 0 ? 'west' : 'east'}: ${describeTally(p, arr)}`);
          verdicts.push(`passive ${end === 0 ? 'west' : 'east'} ${passiveLost(p, end) ? 'loses' : 'DOES NOT ALWAYS LOSE'} (goal share ${pct(p.goal, p.seeds)}%)`);
        }
      }
      console.log(`  => ${cell}: ${verdicts.join('; ')}`);
    }
  };
  for (const mapId of mapIds) {
    const pointed = (): void => (sweeping && modes.includes('points') ? withPointsOverride(mapId, override, () => run(mapId)) : run(mapId));
    if (flagSweeping && modes.includes('flag')) withFlagOverride(mapId, flagOverride, pointed);
    else pointed();
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = modeMain();
