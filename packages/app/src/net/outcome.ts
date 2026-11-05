/**
 * How a versus match ends (spec §2.3, version one; N1b task 10). The rule is
 * read from sim state alone and checked on hash ticks only, so both machines
 * -- which hold the same state at the same tick -- reach the same result on
 * the same tick without saying a word to each other. Nothing here writes to
 * the sim (invariant 4): it counts what is alive.
 *
 * A room's own endings (a seat surrendered, a seat left) arrive from the
 * room instead, and wait behind the frames the transport still holds
 * (`matchResult`, R-B11): a result the sim reaches while draining them wins.
 *
 * A result the sim reached is told to the room once (`reportOver`, L-1): the
 * room closes itself two minutes after both seats have reported it. That
 * ending (`over`) is no result of its own -- the panel is already up.
 */
import { doctrines, units } from '@lions/data';
import { endingLoser, matchCapTicks, type MatchConfig, type Seat, type WinMode } from '@lions/net';
import { isHashTick } from './frame-step';

/** Each side's surviving force value, by SIDE (index 0 is side 0). */
export type Forces = readonly [number, number];

export type MatchOutcome =
  | { kind: 'ongoing' }
  | { kind: 'won'; side: 0 | 1; by: 'annihilation' | 'surrender' | 'left' | 'forfeit' }
  /** GH-976: the winner completed its win mode's goal (the enemy camp razed, the points target reached). */
  | { kind: 'won'; side: 0 | 1; by: 'objective'; mode: WinMode }
  /** Decided on surviving unit value (the lead's ruling, 2026-10-13): every
   *  unit on both sides immobile (`stalemate`), or the 25-minute cap (`time`).
   *  GH-976 P3: the cap of a POINTS room is decided on the points instead, the higher score winning; `points` (whole
   *  points by SIDE, index 0 is side 0) is present exactly then, beside the `forces` the other rule would have read. */
  | { kind: 'won'; side: 0 | 1; by: 'stalemate' | 'time'; forces: Forces; points?: Forces }
  /** Both sides wiped (no `mode`), or, in a win-mode room (GH-976 P3), both sides completed the goal on one tick with
   *  nothing to tell them apart: the draw names its `mode` so the panel can say which. */
  | { kind: 'draw'; by: 'mutual'; mode?: WinMode }
  | { kind: 'draw'; by: 'stalemate' | 'time'; forces: Forces; points?: Forces };

/** A decided match: what the end panel shows. */
export type MatchResult = Exclude<MatchOutcome, { kind: 'ongoing' }>;

/** 25 minutes of 20 Hz ticks: the cap of every map but one with a longer `cap_minutes` (GH-913 L8). A
 *  room asks `matchCapTicks(map)` (`@lions/net`), which is this for a map with no longer cap. */
export const MATCH_CAP_TICKS = 25 * 60 * 20;

/** The slice of `Sim` the rule reads. */
export interface OutcomeSim {
  readonly entityCount: number;
  readonly state: {
    readonly side: ArrayLike<number>;
    readonly alive: ArrayLike<number>;
    readonly typeIdx: ArrayLike<number>;
    /** 1 once a unit's weapons are knocked out for good (`firepower_kill`,
     *  `combat_ineffective`): never cleared, and hashed. Such a hull is not a
     *  combat unit (R-B20). */
    readonly firepowerKilled?: ArrayLike<number>;
    /** 1 while a unit is stuck (`mobility_kill`, `combat_ineffective`), and
     *  hashed; `stepMovement` skips such a unit outright. Not for good since
     *  GH-706: a GROUND hull's crew fixes it to slowed after 90 s of quiet (a
     *  workshop clears it too), so only an aircraft's -- a forced landing,
     *  which no crew can re-rig -- is permanent. */
    readonly mobilityKilled: ArrayLike<number>;
  };
  readonly unitTypes: readonly {
    readonly id: string;
    readonly weapons: readonly unknown[];
    /** Q16.16 tiles a tick; 0 is a type with no movement at all. */
    readonly stepPerTick: number;
    /** An aircraft: its mobility kill is a forced landing, never field-fixed. */
    readonly isAir: boolean;
    /** A medic's `rescue` block (null on the real sim for every other type): a rescue unit is a support unit,
     *  never a combat unit, whatever its carbines (GH-707, the lead, 30 Oct 2026). */
    readonly rescue?: unknown;
  }[];
}

/** A unit type's value: its logistics cost from the unit data, the number
 *  the cost curve prices (`tools/validate_balance.py`). 0 for a type the data
 *  does not know, so an unknown never tips a result. */
export function unitCost(typeId: string): number {
  const u = (units as Record<string, { cost?: { logistics?: number } } | undefined>)[typeId];
  return u?.cost?.logistics ?? 0;
}

/** Whether unit `i` can never move again: a mobility-killed AIRCRAFT (a
 *  forced landing; GH-706), or a type with no movement. Read from hashed sim
 *  state only, so both seats agree. A stuck GROUND hull is NOT immobile since
 *  GH-706: its crew field-fixes it to slowed after 90 s of quiet, so the fight
 *  can still close. Nor is a pinned, garrisoned, carried, buried, braced or
 *  halted unit: each of those ends, and the sim keeps no flag for them that
 *  says otherwise. */
function immobile(sim: OutcomeSim, i: number): boolean {
  const type = sim.unitTypes[sim.state.typeIdx[i]];
  if (sim.state.mobilityKilled[i] === 1 && type?.isAir === true) return true;
  return (type?.stepPerTick ?? 0) <= 0;
}

/** Whether every living unit of the two playing sides is immobile. */
function allImmobile(sim: OutcomeSim, production?: OutcomeProduction): boolean {
  // A side that can still field a unit can still produce a mover.
  if (production !== undefined && SIDES.some((s) => production.canField(s))) return false;
  const { side: sides, alive } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    if (alive[i] === 0 || (sides[i] !== 0 && sides[i] !== 1)) continue;
    if (!immobile(sim, i)) return false;
  }
  return true;
}

/** Each playing side's surviving value: the sum of its living units' costs. */
export function forcesOf(sim: OutcomeSim, costOf: (typeId: string) => number = unitCost): [number, number] {
  const out: [number, number] = [0, 0];
  const { side: sides, alive, typeIdx } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    const side = sides[i];
    if (alive[i] === 0 || (side !== 0 && side !== 1)) continue;
    out[side] += costOf(sim.unitTypes[typeIdx[i]]?.id ?? '');
  }
  return out;
}

/** The higher surviving value wins; equal values draw. */
function byForces(sim: OutcomeSim, by: 'stalemate' | 'time', costOf: (typeId: string) => number): MatchResult {
  const forces = forcesOf(sim, costOf);
  if (forces[0] === forces[1]) return { kind: 'draw', by, forces };
  return { kind: 'won', side: forces[0] > forces[1] ? 0 : 1, by, forces };
}

/** The cap or a stalemate of a camp room that kept playing past a wipe (GH-976 `after_camp`): the side with an armed unit
 *  wins whatever the surviving value says, because `byForces` counts unarmed value and could hand the win to the wiped side.
 *  `by` stays the real ending (`stalemate`, `time`), so a tally sees a wipe that was never razed; `forces` rides along. */
function armedWins(sim: OutcomeSim, side: 0 | 1, by: 'stalemate' | 'time', costOf: (typeId: string) => number): MatchResult {
  return { kind: 'won', side, by, forces: forcesOf(sim, costOf) };
}

/** The cap of a POINTS room (GH-976 P3): nobody reached the target, so the higher score wins and a level score is a draw.
 *  The design's intent is that the goal decides, and a side that sat on the ground it held for 25 minutes has played the
 *  race; surviving value would let a side that never took a zone win it. Compared on the exact integer units (a score runs
 *  in 1/1200ths of a point), shown in whole points. `forces` rides along as the other rule would have read it. */
function byPoints(sim: OutcomeSim, goals: OutcomeGoals, costOf: (typeId: string) => number): MatchResult {
  const forces = forcesOf(sim, costOf);
  const points: Forces = [goals.scoreOf(0), goals.scoreOf(1)];
  const a = goals.scoreUnitsOf(0);
  const b = goals.scoreUnitsOf(1);
  if (a === b) return { kind: 'draw', by: 'time', forces, points };
  return { kind: 'won', side: a > b ? 0 : 1, by: 'time', forces, points };
}

/** The two playing sides. A third (civilians) neither keeps a side standing nor wins. */
const SIDES: readonly (0 | 1)[] = [0, 1];

/** Whether `side` still has a living unit that can fight: one that carries a
 *  weapon and has not had its firepower knocked out. A drone, a truck, a
 *  dozer or a hull whose guns are gone for good cannot win a fight, so it
 *  does not keep a side standing (spec §2.3: "no combat unit alive"; R-B20) --
 *  otherwise a beaten side holds the match to the 25-minute draw. Nor does a
 *  rescue unit (the Nemala medic team carries carbines to defend itself): a
 *  side with only medics left has lost (GH-707, 30 Oct 2026). */
export function armedStanding(sim: OutcomeSim, side: 0 | 1): boolean {
  const { side: sides, alive, typeIdx, firepowerKilled } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    if (alive[i] === 0 || sides[i] !== side) continue;
    if (firepowerKilled?.[i] === 1) continue;
    const type = sim.unitTypes[typeIdx[i]];
    if ((type?.weapons.length ?? 0) > 0 && (type?.rescue ?? null) === null) return true;
  }
  return false;
}

/** What a win-mode room adds to the win rule (GH-976): which sides have completed their goal. Absent -- every
 *  annihilation room -- the rule is the existing one, exactly. */
export interface OutcomeGoals {
  readonly mode: WinMode;
  /** Whether `side` has completed a primary objective of its own. */
  sideWon(side: 0 | 1): boolean;
  /** `side`'s score in exact integer units, the tie-break when both complete on one tick; 0 with no score. */
  scoreUnitsOf(side: 0 | 1): number;
  /** `side`'s score in whole points (GH-976 P3), what a points room's panel shows; 0 with no score. */
  scoreOf(side: 0 | 1): number;
  /** GH-976: the camp mode's `wipe` rule. `after_camp`: a side with no armed unit does not lose while its camp stands
   *  (the other side has not razed it); at the cap or a stalemate it loses. Absent or `ends`: a wipe ends the match. */
  readonly campWipe?: 'ends' | 'after_camp';
  /** The sim tick `side` completed its goal on, or -1 while it has not (GH-976 P2): the first to finish wins. */
  completeTickOf(side: 0 | 1): number;
}

/** The slice of `MatchWorld` that `goalsOf` reads. */
export interface GoalsWorld {
  readonly runtime: {
    sideWon(side: 0 | 1): boolean;
    scoreUnitsOf(side: 0 | 1): number;
    scoreOf(side: 0 | 1): number;
    completeTickOf(side: 0 | 1): number;
  } | null;
  readonly winMode: WinMode | null;
  readonly campWipe?: 'ends' | 'after_camp';
}

/** The goals of a win-mode room, or undefined for annihilation (and for any world with no mode). */
export function goalsOf(w: GoalsWorld): OutcomeGoals | undefined {
  const runtime = w.runtime;
  if (runtime === null || w.winMode === null) return undefined;
  return { mode: w.winMode, sideWon: (s) => runtime.sideWon(s), scoreUnitsOf: (s) => runtime.scoreUnitsOf(s), scoreOf: (s) => runtime.scoreOf(s), completeTickOf: (s) => runtime.completeTickOf(s), campWipe: w.campWipe ?? 'ends' };
}

/** The goal's verdict, or null while no side has completed one. `outcomeOf` asks only on a hash window (every 20
 *  ticks), so two sides can both have finished by the time it asks. The FIRST to finish wins (GH-976 P2): each
 *  objective stores the sim tick it completed on (`completeTickOf`, a snapshot row), so a side that reached the
 *  target 1-19 ticks before the other wins even if the other overshot by more. Only the SAME tick falls to the
 *  score, the larger winning, and level scores are a mutual end. Read from state both machines share (the
 *  runtime's objectives, hashed through its digest). */
function goalOutcome(goals: OutcomeGoals): MatchResult | null {
  const a = goals.sideWon(0);
  const b = goals.sideWon(1);
  if (!a && !b) return null;
  if (a && b) {
    const ta = goals.completeTickOf(0);
    const tb = goals.completeTickOf(1);
    if (ta !== tb) return { kind: 'won', side: ta < tb ? 0 : 1, by: 'objective', mode: goals.mode };
    const sa = goals.scoreUnitsOf(0);
    const sb = goals.scoreUnitsOf(1);
    if (sa === sb) return { kind: 'draw', by: 'mutual', mode: goals.mode };
    return { kind: 'won', side: sa > sb ? 0 : 1, by: 'objective', mode: goals.mode };
  }
  return { kind: 'won', side: a ? 0 : 1, by: 'objective', mode: goals.mode };
}

/** What an economy room adds to the win rule (N3 Task 5): whether a side that
 *  has no armed unit standing can still field one. Absent -- every mirror
 *  room -- the rule is the units-only rule, exactly. */
export interface OutcomeProduction {
  canField(side: 0 | 1): boolean;
}

/** The slice of `MatchWorld` that `productionOf` reads. */
export interface ProductionWorld {
  readonly runtime: {
    productionLines(side: 0 | 1): readonly { readonly alive: boolean; readonly current: string | null; readonly items: readonly string[] }[];
    logisticsOf(side: 0 | 1): number;
    /** True when the population cap is what refuses `unitId` for `side` (F3's own check). */
    popCapped(unitId: string, side: 0 | 1): boolean;
  } | null;
  readonly factions: readonly ['kdf' | 'sarim', 'kdf' | 'sarim'];
  /** GH-976: a win-mode room's runtime is goals-only and has no production to ask about. */
  readonly winMode?: WinMode | null;
}

/** A unit id the shipped data knows to carry a weapon and not to be a rescue unit (`armedStanding`'s own test). */
function armedType(id: string): boolean {
  const u = (units as Record<string, { weapons?: readonly unknown[]; rescue?: unknown } | undefined>)[id];
  return (u?.weapons?.length ?? 0) > 0 && u?.rescue === undefined;
}

/** The production half of the rule, from state both machines share: the
 *  runtime's lines and purse (hashed through its digest), and the faction's
 *  shipped doctrine menu. `canField(s)` is true when side `s` has a living
 *  line AND (an armed item is queued or in progress on a line, OR its purse
 *  covers the cheapest ARMED unit on its menu). Undefined with no runtime. */
export function productionOf(w: ProductionWorld): OutcomeProduction | undefined {
  const runtime = w.runtime;
  if (runtime === null || (w.winMode ?? null) !== null) return undefined;
  return productionFor(runtime, [doctrines[w.factions[0]].menu, doctrines[w.factions[1]].menu]);
}

/** `productionOf` over an explicit menu per side (the tests' seam). */
export function productionFor(runtime: NonNullable<ProductionWorld['runtime']>, menus: readonly [readonly string[], readonly string[]]): OutcomeProduction {
  return {
    canField(side) {
      const lines = runtime.productionLines(side).filter((l) => l.alive);
      if (lines.length === 0) return false;
      if (lines.some((l) => (l.current !== null && armedType(l.current)) || l.items.some(armedType))) return true;
      // An armed menu unit the side can both afford and fit under its population cap: what
      // `requestBuild` would actually accept (Task 5 review, minor 1).
      const purse = runtime.logisticsOf(side);
      return menus[side].some((id) => armedType(id) && unitCost(id) <= purse && !runtime.popCapped(id, side));
    },
  };
}

/** Spec §2.3, version one, read from sim state alone so both machines agree:
 *  a side with no living armed unit has lost; both on the same tick is a
 *  draw. With both standing, the lead's ruling (2026-10-13) settles two more
 *  cases by surviving unit value (`forcesOf`), the higher total winning and
 *  equal totals drawing: every living unit on both sides immobile (nothing
 *  can ever close the distance -- a stalemate, ended at once), and the
 *  cap (25 minutes, or the map's `cap_minutes`; `capTicks`), which until then
 *  was always a draw. There is no production
 *  in a sandbox, so the counts are the whole test. In a POINTS room the cap is decided on the points instead (GH-976 P3:
 *  the higher score wins, a level score draws); every other room, and a stalemate, still reads surviving value. */
export function outcomeOf(sim: OutcomeSim, tick: number, costOf: (typeId: string) => number = unitCost, production?: OutcomeProduction, capTicks: number = MATCH_CAP_TICKS, goals?: OutcomeGoals): MatchOutcome {
  // GH-976: a goal completed beats everything below it (a side that razed the camp as its last unit fell has won).
  if (goals !== undefined) {
    const g = goalOutcome(goals);
    if (g !== null) return g;
  }
  const standing = SIDES.filter((side) => armedStanding(sim, side) || production?.canField(side) === true);
  if (standing.length === 0) return { kind: 'draw', by: 'mutual' };
  // GH-976 `wipe: after_camp`: a lone survivor has not won yet -- the wiped side's camp stands until it is razed
  // (`goalOutcome` above is the win). The match runs on to the goal, a stalemate or the cap, where the armed side wins.
  const razeOn = standing.length === 1 && goals !== undefined && goals.mode === 'camp' && goals.campWipe === 'after_camp';
  if (standing.length === 1 && !razeOn) return { kind: 'won', side: standing[0], by: 'annihilation' };
  if (allImmobile(sim, production)) return razeOn ? armedWins(sim, standing[0], 'stalemate', costOf) : byForces(sim, 'stalemate', costOf);
  if (tick >= capTicks) {
    if (razeOn) return armedWins(sim, standing[0], 'time', costOf);
    return goals !== undefined && goals.mode === 'points' ? byPoints(sim, goals, costOf) : byForces(sim, 'time', costOf);
  }
  return { kind: 'ongoing' };
}

/** The rule, asked only on the frame that closes a hash window (`isHashTick`,
 *  keyed by the FRAME's tick like the hash itself): both seats run the same
 *  frames into the same state, so both decide on the same tick, and the
 *  hash sent on that tick covers the state the decision was read from. The
 *  cap is measured on the sim's own tick count. Null while it is ongoing,
 *  on any other tick, and without a room. */
export function hashTickOutcome(frameTick: number, config: MatchConfig | null, sim: OutcomeSim & { readonly tickCount: number }, production?: OutcomeProduction, goals?: OutcomeGoals): MatchResult | null {
  if (!isHashTick(frameTick, config)) return null;
  // The cap is the MAP's (GH-913 L8): 25 minutes, or the longer one its rules file declares.
  const o = outcomeOf(sim, sim.tickCount, unitCost, production, matchCapTicks(config?.map), goals);
  return o.kind === 'ongoing' ? null : o;
}

/** A result this seat's sim reached, and the frame tick it was read on:
 *  what it reports to the room as `over` (L-1). */
export interface LocalDecision { readonly result: MatchResult; readonly tick: number }

/** `hashTickOutcome`, remembered with the frame tick that decided it: the
 *  first decision stands. Both seats read it on the same frame tick, so both
 *  report the same `over` tick. */
export function decideOnHashTick(
  prev: LocalDecision | null, frameTick: number, config: MatchConfig | null, sim: OutcomeSim & { readonly tickCount: number }, production?: OutcomeProduction, goals?: OutcomeGoals,
): LocalDecision | null {
  if (prev !== null) return prev;
  const result = hashTickOutcome(frameTick, config, sim, production, goals);
  return result === null ? null : { result, tick: frameTick };
}

/** Tells the room this seat's result as its panel goes up (L-1, R-B26) --
 *  only when the panel shows the result the SIM reached (`matchResult` hands
 *  back that very object). A result taken from the room's own ending (a
 *  surrender, a leave) owes nothing: that room has ended already. The
 *  transport sends one `over` however often it is asked. */
export function reportOver(room: { over(tick: number): void } | null, shown: MatchResult, local: LocalDecision | null): void {
  if (room !== null && local !== null && shown === local.result) room.over(local.tick);
}

/** The other playing side. */
function opponentOf(side: 0 | 1): 0 | 1 {
  return SIDES.find((s) => s !== side) ?? side;
}

/** The room's `ended`, as a result for this seat. A surrender, a leave and
 *  a forfeit (60 s disconnected) name the seat that gave the match up
 *  (`endingLoser`, one rule for both seats), and its side loses. A `left`
 *  from an older room names nobody: the seat that left closed its own socket
 *  and never hears it, so whoever hears it stayed and wins. `void` (a desync,
 *  or both seats dropped at once), `expired` and `over` (the room closing
 *  itself after the result the sims reached, L-1) are no result. */
export function roomEndingOutcome(
  reason: string,
  seat: Seat | undefined,
  viewer: 0 | 1,
  sideOfSeat: (seat: Seat) => 0 | 1,
): MatchResult | null {
  const loser = endingLoser(reason, seat);
  if (loser !== null && (reason === 'surrender' || reason === 'left' || reason === 'forfeit')) return { kind: 'won', side: opponentOf(sideOfSeat(loser)), by: reason };
  if (reason === 'left') return { kind: 'won', side: viewer, by: 'left' };
  return null;
}

/** What the panel shows after a frame's stepping, or null to keep going
 *  (R-B11). The sim's own result wins: it is the one both seats reach. A
 *  room's ending shows only once `drained` -- the transport yielded nothing
 *  more -- because the frames it still holds were issued before the ending
 *  and may decide the match on a tick the other seat has already reached. */
export function matchResult(local: MatchResult | null, ending: MatchResult | null, drained: boolean): MatchResult | null {
  if (local !== null) return local;
  if (ending !== null && drained) return ending;
  return null;
}
