// `run()` and the recorders it writes, split out of `playtest.ts` so the passive-control
// sweep's worker processes (`passive-sweep-worker.ts`) can run a mission without running the
// whole campaign ladder that `playtest.ts` executes at module load. Moved verbatim: the
// world a run builds is byte-for-byte the one it always built.

import {
  Sim,
  TICKS_PER_SECOND,
  MissionRuntime,
  resolveUpgrades,
  loanedPlacements,
  creditsFor,
  creditInputFrom,
  type MissionJson,
  type LedgerData,
  type TunnelRouteJson,
  type UnlockGate,
  type UnitTypeJson,
  type SimEvent,
  type Stars,
  type DefeatCause,
} from '@lions/sim';
import {
  units,
  maps,
  missions,
  structures as structureCatalogue,
  parseMap,
  applyTerrain,
  roadMaskOf,
  applyUpgrades,
  maxTiers,
} from '@lions/data';
import { PopulationCensus } from './population-census';
import type { Banking } from './banking';
// `tools` importing a pure module out of `packages/app` is the established
// pattern (`tools/src/meshes/gait-pass.ts` imports `RIGGED_UNIT_MESHES` from
// `packages/app/src/mesh-catalogue` the same way): `roster-cap.ts` is the one
// public source of `ROSTER_CAP`, imported here (Task 2), by the split (Task
// 4), by the brigade sentence (Task 6) and by `deployRosterView` when it
// exists (R-12).
// GH-330: the two-campaign walk goes through the app's REAL account functions and
// open-mission guard, not a re-implementation, so the harness and the debrief
// cannot disagree about what a second campaign pays.

export type Plan = (sim: Sim, rt: MissionRuntime, ids: (t: string) => number[], at: (t: number, fn: () => void) => void) => void;

/**
 * Task 7 / controller ruling R2: the harness's chained ledgers (`led…`) do not
 * reliably reach the three star gates -- Khan Rafid and Deir Amun's plans, for
 * instance, deliberately run on a bare `{}` ledger rather than chaining off
 * Beit Sahwan (see the Khan Rafid comment in `playtest.ts`), so no single threaded ledger
 * ever accumulates the whole campaign's stars. Instead of asserting on one of
 * those partial ledgers, this records every mission's OWN measured grade here
 * -- keyed by mission id, written only by the winning plan (never a control) --
 * and the assertions at the bottom of `playtest.ts` walk `world.json`'s own
 * region -> town -> mission order and accumulate these recorded stars into a
 * synthetic `campaign.mission_results` ledger, exactly the shape a real
 * playthrough would write one mission at a time.
 */
export const missionStars = new Map<string, Stars>();

/** Each mission's own winning-plan credit value (spec 2026-09-15 §4.2), recorded under
 *  the same `label === id` guard as `missionStars`, so probes and controls never count. */
export const missionCredits = new Map<string, number>();
/** GH-330: each winning plan's own clock, in minutes, for the farming report. */
export const missionMinutes = new Map<string, number>();

/** Each mission's own winning-plan Conduct score, recorded under the same `label === id`
 *  guard as `missionStars`/`missionCredits`. WP-G-E1 (2026-09-18): this feeds
 *  `conductLedgerAfter` in `playtest.ts`, the Conduct-floor twin of `syntheticLedgerAfter` -- before
 *  this, `missionResults`'s own `roe` field was hardcoded to 0, which was harmless only
 *  because nothing walked the nine `roe_rating_min` gates against the real ladder yet. */
export const missionRoe = new Map<string, number>();

/** This mission's own produced roster length, for the per-chain totals in `playtest.ts`
 *  (WP-G-E2 Task 2). Same `label === id` + `expect === 'victory'` guard as
 *  `missionStars`, so a control's defeat (which writes nothing to a real
 *  ledger anyway) and a gate-open or max-tier probe can never contribute. */
export const missionRosterOut = new Map<string, number>();

/** This mission's winning-plan population census (GH-183 F3 Task 5), same guard as `missionStars`.
 *  Report only: `playtest.ts` prints it and gates nothing on it. */
export const missionPopulation = new Map<string, PopulationCensus>();

/** Brigade economy Task 5: everything a plain `label === id` VICTORY run needs to be
 *  replayed with every KDF type patched to its own maximum tier. Recorded under the
 *  same guard as `missionStars`/`missionCredits` above -- a control, a "(no orders)"
 *  run or one of Task 7's gate probes never contributes an entry, because every one
 *  of them passes a label distinct from its own mission id. `baseResult`/`baseStars`
 *  are what the max-tier replay is held against: the controller's ruling is that a
 *  max-tier force must stay in the VICTORY class and must not drop a star the base
 *  run already earned, never that it reproduce the base run's numbers exactly.
 *  `baseRoe`/`baseCredits` are carried the same way, purely for the diagnostic
 *  line the max-tier loop prints in `playtest.ts` -- unlike `baseResult`/`baseStars`, they
 *  are never asserted against, since the controller's ruling never asked the
 *  replay to reproduce ROE or credits, only the outcome class and the star
 *  floor. */
export interface MaxTierProbe {
  id: keyof typeof missions;
  plan: Plan;
  ledger: LedgerData;
  expectStar: 0 | 1 | 2 | 3;
  fielded?: string;
  bought: ReadonlySet<string>;
  gateOf?: (unitId: string) => UnlockGate | undefined;
  baseResult: 'ongoing' | 'victory' | 'defeat';
  baseStars: Stars;
  baseRoe: number;
  baseCredits: number;
}
export const maxTierProbes: MaxTierProbe[] = [];

/** A unit JSON entry's `unlock` gate, mapped from the authored
 *  `roe_rating_min`/`stars_min`/`after_mission`/`price` field names to `UnlockGate` -- the
 *  one mapping `unitInfo` and `unlockOf` (`resolveUpgrades`'s lookup) both share. This used
 *  to claim it matched main.ts's own `kdfUnlockGate` while dropping `price` on the floor --
 *  a bought-only unit (no earned field, price only) then read OPEN here and LOCKED in the
 *  app, since `unlockReason` treats a gate with no fields at all as open. Mapped now. */
export function kdfUnlockGate(u: {
  unlock?: { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number };
}): UnlockGate | undefined {
  return u.unlock
    ? {
        roeMin: u.unlock.roe_rating_min,
        starsMin: u.unlock.stars_min,
        afterMission: u.unlock.after_mission,
        price: u.unlock.price,
      }
    : undefined;
}

/**
 * What a run that reaches the 20-minute cap still ONGOING prints: `STUCK`. A mission with an
 * objective that never fires does not end, and for a player that reads as a hang rather than a
 * loss, so it is named apart from a run that merely has not finished. The outcome a control
 * EXPECTS is still `'ongoing'`; only the word in the report changes.
 */
export function outcomeName(result: 'ongoing' | 'victory' | 'defeat', atCap: boolean): string {
  return result === 'ongoing' && atCap ? 'STUCK' : result.toUpperCase();
}

/** A defeat's cause in one word, as telemetry flattens it: `withdrawn`, `force_destroyed`,
 *  `roe_collapse` or `objective:<id>`. */
export function causeText(c: DefeatCause | undefined): string | undefined {
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : `objective:${c.objective}`;
}

/** What a swept control reports (#540): a defeat by the time limit is `withdrawn`, anything else its
 *  result. A control expecting `defeat` must lose on its own deadline, so a run the limit ended is a
 *  miss, and a witness expecting `withdrawn` must lose by the limit. */
export function sweepOutcome(result: 'ongoing' | 'victory' | 'defeat', cause: string | undefined): string {
  return result === 'defeat' && cause === 'withdrawn' ? 'withdrawn' : result;
}

/** What a run earned in intel (F1, D3-D5): every rise of the held total as `[tick, amount]`, the
 *  tick it ended on, and what the plan spent through `requestSupport`. Read by `intel-gate.ts`. */
export interface IntelRun {
  /** `sim.tickCount` when the run ended: the clock `intel` ticks are on. */
  endTick: number;
  /** One `[tick, amount]` per rise of the held total, in order. `intel_start` is not one. */
  intel: [number, number][];
  /** What `requestSupport` and `requestBuild` took out of the held total. */
  spent: number;
}

/** One line per `run()` call, in call order: what the plan sweep (`plan-sweep.ts`) reads back. */
export interface RunRecord extends IntelRun {
  id: string;
  label: string;
  expect: 'victory' | 'defeat' | 'ongoing';
  result: 'ongoing' | 'victory' | 'defeat';
  /** ONGOING at the 20-minute cap. */
  stuck: boolean;
  minutes: number;
  stars: number;
  roe: number;
  /** The defeat's cause (`causeText`); undefined unless lost. */
  cause?: string;
  /** What the run did with its logistics (F2 Task 9, `banking.ts`); undefined for a mission with no
   *  `resources` block. Recorded only: `run()` prints nothing about it, so no existing line moves. */
  banking?: Banking;
}
export const runLog: RunRecord[] = [];

/** What the run `run()` just logged earned in intel: the last entry of this process's own `runLog`. */
export function lastIntelRun(): IntelRun {
  const r = runLog[runLog.length - 1];
  return { endTick: r.endTick, intel: r.intel, spent: r.spent };
}

/** Set only by `setSweep` (`passive-sweep.ts`), for the duration of one swept run: the seed
 *  `run()` builds its `Sim` with (otherwise `PT_SEED`, otherwise 424242), and whether it keeps its
 *  two per-run lines to itself. A FAILED line is never quiet. */
let sweepSeed: number | undefined;
let sweepQuiet = false;
export function setSweep(seed: number | undefined, quiet: boolean): void {
  sweepSeed = seed;
  sweepQuiet = quiet;
}

export function run(
  id: keyof typeof missions,
  plan: Plan,
  ledger: LedgerData = {},
  expect: 'victory' | 'defeat' | 'ongoing' = 'victory',
  label: string = id,
  /** The grade the plan must reach (spec §4.1). Every winning plan clears ★★, and what
   *  it clears it by is the MARGIN against that mission's own floor (`fail_below + 20`,
   *  or 70 where none is declared) -- never the raw Conduct, since a mission declaring
   *  `fail_below: 40` sets its ★★ bar at 60 and not at 70. Measured 2026-09-11 over 26
   *  winning plans: the tightest were `deir_amun_2_foothold` (+10, Conduct 70 against a
   *  floor of 60) and `umm_zeitoun_3_clearance` (+11, 76 against 65); every other plan
   *  was +16 or better. Both have since widened -- HEAD reads `deir_amun_2_foothold`
   *  at +15 (ROE 75 against 60) and `umm_zeitoun_3_clearance` at +22 (87 against 65) --
   *  and later towns landed two that are tighter still: `khan_rafid_3_clearance` (+6,
   *  Conduct 76 against a floor of 70) and `qarn_hadid_3_clearance` (+12, 77 against
   *  65) are the tightest on HEAD; every other plan is +15 or better. A control that
   *  loses gets 0 by construction, so the defaults
   *  assert the gradient with no per-plan edits. Pass 3 only where the plan completes
   *  every carrying secondary. */
  expectStar: 0 | 1 | 2 | 3 = expect === 'victory' ? 2 : 0,
  /** F1 / ruling R2(b): a unit type id that must be alive on side 0 immediately after
   *  `start()` -- proves a placement's `upgrades_to` actually resolved to the upgraded
   *  type at spawn, not merely that the mission still wins fielding its un-upgraded
   *  fallback. Checked before the plan issues a single order or a tick runs; named in
   *  the printed line either way so a reader never has to re-derive it. */
  fielded?: string,
  /** Unit type ids the brigade account has bought (spec 2026-09-15 §4.4). Mapped into
   *  `unlockOf`'s `UnlockGate.bought`, exactly as `main.ts`'s `kdfUnlockGate` resolves it
   *  from the account -- so a probe can prove a purchase opens an `upgrades_to` slot with
   *  no stars or Conduct at all, the same lookup the real gate uses. */
  bought: ReadonlySet<string> = new Set(),
  /** Replaces `unlockOf`'s normal unit-data lookup entirely when supplied, so a probe can
   *  hand `resolveUpgrades` a gate no shipped unit actually authors -- e.g. a price-only
   *  gate isolated from breach_team's real `stars_min`, to prove the divergence this
   *  harness's own `kdfUnlockGate` used to have with `main.ts`'s cannot reappear. */
  gateOf?: (unitId: string) => UnlockGate | undefined,
  /** Brigade economy Task 5: when 'max', every KDF unit type registers through
   *  `applyUpgrades(u, maxTiers(u))` instead of its raw JSON -- the same pre-pass
   *  `main.ts` runs for an owned tier (`ownedTiers[u.id] ?? {}`), maxed rather than
   *  bought. Enemy (non-kdf) types are never patched, matching `main.ts` exactly. */
  tiers?: 'max',
  /** Written by the max-tier replay pass at the end of `playtest.ts` so it can read back
   *  what THIS run actually measured, without widening `run`'s return type -- every
   *  existing call site still gets back exactly the produced `LedgerData` it always
   *  did, spread or chained as-is. `roeScore`/`credits` were added alongside
   *  `result`/`stars` so the replay can print a base-vs-max ROE/credits line
   *  without re-deriving either from `produced`. */
  measured?: {
    result: 'ongoing' | 'victory' | 'defeat';
    stars: Stars;
    roeScore: number;
    credits: number;
    /** Mission clock at the end, in minutes (E5 Task 5: the `(bought)` probes print it). */
    minutes?: number;
    cause?: string;
  },
  /** E5 Task 5: unit types the shipped roster does not carry (the staged bought-only drafts
   *  in docs/campaign/special_units/e5), registered after every shipped type so no shipped
   *  type index moves. A KDF extra goes through the same max-tier pre-pass as any KDF type
   *  and is visible to `unitInfo`/`unlockOf`, so `requestBuild` sees its price and gate. */
  extraUnits: readonly UnitTypeJson[] = [],
  /** E5 Task 5 fix round 1: every tick's sim events, so a probe can count what a fielded unit
   *  actually DID (rounds fired, kills, contacts) and not merely that it was on the map. */
  onEvents?: (evs: readonly SimEvent[]) => void
): LedgerData {
  const mission = missions[id] as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  // Matches the app. `spawn` never reuses a dead slot, so this is a budget for
  // everyone who ever appears, not for how many stand at once.
  // PT_SEED: the ladder re-measure runs the scripted plans over many seeds (GH-382); unset it is 424242.
  const sim = new Sim({ seed: sweepSeed ?? Number(process.env.PT_SEED ?? 424242), width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  // Buildings are entities, exactly as the app raises them.
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  // Tunnels: registered from ONE array in ONE loop, and that same array is what
  // the mission context receives. `ctx.tunnels` is positional -- entry r IS the
  // sim's route index -- mirroring main.ts exactly (an equal-count permutation
  // would silently bury units in the wrong route).
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < tunnelRoutes.length; i++) {
    const got = sim.addTunnel(tunnelRoutes[i]);
    if (got !== i) throw new Error(`tunnel "${tunnelRoutes[i].id}" registered as route ${got}, expected ${i}`);
  }
  const typeOf = new Map<string, number>();
  for (const u of [...Object.values(units), ...extraUnits] as (typeof units)[keyof typeof units][]) {
    // Mirrors main.ts's own pre-pass exactly (see the `tiers` doc comment above) --
    // enemy units never go through applyUpgrades, only a KDF unit can carry a tier.
    const registered = tiers === 'max' && u.faction === 'kdf' ? applyUpgrades(u, maxTiers(u)) : u;
    typeOf.set(u.id, sim.addUnitType(registered));
  }
  // `upgrades_to` resolved once, before the runtime is built, exactly as main.ts
  // does it -- so a placed force fields the earned unit here too and the spawner
  // stays gate-blind.
  const withBought = (gate: UnlockGate | undefined, unitId: string): UnlockGate | undefined =>
    gate ? { ...gate, bought: bought.has(unitId) } : undefined;
  const unitData: Record<string, unknown> = { ...units, ...Object.fromEntries(extraUnits.map((u) => [u.id, u])) };
  const unlockOf = (unitId: string): UnlockGate | undefined => {
    if (gateOf) return gateOf(unitId);
    const d = (
      unitData as Record<
        string,
        { unlock?: { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number } } | undefined
      >
    )[unitId];
    const gate = d ? kdfUnlockGate(d) : undefined;
    return withBought(gate, unitId);
  };
  const resolvedMission = resolveUpgrades(mission, ledger, unlockOf);
  // F3 Task 6: who is on loan, from the SAME lookup the line above resolved with (as main.ts does).
  const loaned = loanedPlacements(mission, ledger, unlockOf);
  const rt = new MissionRuntime(sim, resolvedMission, {
    loaned,
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    roadMask: roadMaskOf(map),
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: (u) => {
      const d = (unitData as Record<
        string,
        | {
            faction: string;
            unlock?: { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number };
            cost: { logistics: number; build_time_s?: number; population?: number };
          }
        | undefined
      >)[u];
      if (!d || d.faction !== 'kdf') return null;
      return {
        logistics: d.cost.logistics,
        buildTimeS: d.cost.build_time_s ?? 20,
        population: d.cost.population ?? 1,
        // `bought` resolved here as in `main.ts`'s `kdfUnlockGate`: `requestBuild` reads THIS
        // gate through `buildBlockedReason`, so without it a purchase opened `resolveUpgrades`
        // and stayed closed to the build queue.
        unlock: withBought(kdfUnlockGate(d), u),
      };
    },
  });
  rt.start();
  // F3 Task 5: read off the runtime once a tick, after the step; the start is what `start()` spawned.
  const census = new PopulationCensus();
  census.begin(rt);
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  // F1: checked immediately after `start()`, before the plan or the tick loop runs --
  // proves the swap happened, not merely that the mission (still) wins.
  const fieldedOk = fielded === undefined ? null : ids(fielded).length > 0;
  if (fieldedOk === false) {
    console.error(`${label}: FAILED — expected '${fielded}' fielded on side 0 after start(), found none`);
    process.exitCode = 1;
  }
  // Keyed by tick, in the order given. A plan that reads the world every second or two for the
  // whole run (`player-picture.ts`) puts hundreds of entries here, and scanning all of them on every
  // tick cost more than the run. An order given from inside another for the same tick is pushed
  // onto the list being walked and still runs this tick, as it did when this was one flat array.
  const timed = new Map<number, (() => void)[]>();
  plan(sim, rt, ids, (t, fn) => {
    const when = t * TICKS_PER_SECOND;
    const list = timed.get(when);
    if (list) list.push(fn);
    else timed.set(when, [fn]);
  });
  let produced: LedgerData = {};
  // F1 Task 9: what the run EARNED in intel, read off the held total tick by tick rather than summed from
  // the `intelEarned` events, so a source that moves the total without announcing itself (the retired
  // per-minute trickle) is counted here and caught by the cross-check below. A rise is an earning, a
  // fall is a spend (`requestSupport`, `requestBuild`); the orders a plan gives at the top of a tick
  // are read apart from the step, so a tick that spends and earns is not netted.
  const intel: [number, number][] = [];
  let intelSpentTotal = 0;
  let intelEventSum = 0;
  let held = rt.intel;
  const noteIntel = (): void => {
    const now = rt.intel;
    if (now > held) intel.push([sim.tickCount, now - held]);
    else if (now < held) intelSpentTotal += held - now;
    held = now;
  };
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    const due = timed.get(t);
    if (due) {
      for (let k = 0; k < due.length; k++) due[k]();
      noteIntel();
    }
    const evs = sim.tick();
    onEvents?.(evs);
    for (const me of rt.step(evs)) {
      if (me.kind === 'missionEnd') produced = me.ledger;
      else if (me.kind === 'intelEarned') intelEventSum += me.amount;
    }
    noteIntel();
    census.sample(rt);
    if (rt.result !== 'ongoing') break;
  }
  census.finish(rt);
  const cause = rt.result === 'defeat' ? causeText(rt.defeatCause) : undefined;
  const mins = (t / TICKS_PER_SECOND / 60).toFixed(1);
  const shown = outcomeName(rt.result, t >= maxTicks);
  const runLine =
    `${label}: ${shown} in ${mins} min, ROE ${rt.roeScore}, stars ${rt.stars}, ` +
    `objectives ${rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}, ` +
    `roster out ${(produced['roster.surviving_units'] ?? []).length}` +
    (cause !== undefined ? `, cause ${cause}` : '') +
    (fielded !== undefined ? `, fielded ${fielded}=${fieldedOk}` : '');
  const credits = creditsFor(creditInputFrom(rt, rt.roeScore, mission.roe?.fail_below));
  if (!sweepQuiet || rt.result !== expect) console.log(runLine);
  if (!sweepQuiet) console.log(`${label}: credits ${credits}`);
  if (rt.result !== expect) {
    console.error(`${label}: FAILED — expected ${expect.toUpperCase()}, got ${shown}`);
    process.exitCode = 1;
  }
  // F1 Task 9: what the run earned, as its own line so every line above stays as it was.
  let intelEarned = 0;
  for (const [, amount] of intel) intelEarned += amount;
  const intelStart = mission.resources?.intel_start ?? 0;
  if (!sweepQuiet) console.log(`${label}: intel earned ${intelEarned} (start ${intelStart}, spent ${intelSpentTotal}, held ${rt.intel})`);
  // Every point earned is announced as an `intelEarned` event; one that is not is a source the HUD feed,
  // and the gate in `intel-gate.ts`, would otherwise miss. This guards every run in the parent process
  // (seed 424242); the swept seeds (30, in workers) are quiet and are re-verified only for the spend
  // (`seedsNotSpent`), not for this cross-check.
  if (intelEventSum !== intelEarned) {
    console.error(`${label}: FAILED — intel moved ${intelEarned} but only ${intelEventSum} was announced by intelEarned events`);
    process.exitCode = 1;
  }
  const banking: Banking | undefined =
    mission.resources === undefined
      ? undefined
      : { start: mission.resources.logistics_start ?? 0, earned: rt.logisticsEarned(0), zoneEarned: rt.zoneLogisticsEarned(0), held: rt.logistics };
  runLog.push({ id, label, expect, result: rt.result, stuck: t >= maxTicks && rt.result === 'ongoing', minutes: t / TICKS_PER_SECOND / 60, stars: rt.stars, roe: rt.roeScore, cause, endTick: sim.tickCount, intel, spent: intelSpentTotal, banking });
  if (rt.stars < expectStar) {
    console.error(`${label}: FAILED — expected ${expectStar} star(s), got ${rt.stars}`);
    process.exitCode = 1;
  }
  // Task 7 / R2: record this mission's own grade for the synthetic ladder --
  // only the winning plan (never a control, which passes its own distinct
  // label) and only a real victory, so a passive-control defeat can never
  // contribute a false star.
  if (expect === 'victory' && label === id) {
    missionStars.set(id, rt.stars);
    missionCredits.set(id, credits);
    missionMinutes.set(id, t / TICKS_PER_SECOND / 60);
    missionRoe.set(id, rt.roeScore);
    // WP-G-E2 Task 2: fed into the per-chain `roster total` lines beside
    // `missionOrder` in `playtest.ts` -- see the `roster cap:` comment block near
    // `LADDER_CREDITS` for why this number is honest.
    missionRosterOut.set(id, (produced['roster.surviving_units'] ?? []).length);
    missionPopulation.set(id, census);
    // Brigade economy Task 5: record this same plain victory for the max-tier
    // replay pass in `playtest.ts`. `tiers === undefined` is belt-and-suspenders -- a max-tier
    // replay always passes a label distinct from `id` (see `MaxTierProbe`'s own
    // comment), so this branch is already unreachable from a replay on `label ===
    // id` alone, but guarding on both keeps the recorder from ever re-entering
    // itself if that ever changes.
    if (tiers === undefined) {
      maxTierProbes.push({
        id,
        plan,
        ledger,
        expectStar,
        fielded,
        bought,
        gateOf,
        baseResult: rt.result,
        baseStars: rt.stars,
        baseRoe: rt.roeScore,
        baseCredits: credits,
      });
    }
  }
  if (measured) {
    measured.result = rt.result;
    measured.stars = rt.stars;
    measured.roeScore = rt.roeScore;
    measured.credits = credits;
    measured.minutes = t / TICKS_PER_SECOND / 60;
    measured.cause = cause;
  }
  return produced;
}
