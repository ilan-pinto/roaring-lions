// Headless mission playtests: each Beit Sahwan mission must be winnable by a
// sensible scripted plan inside its time budget. Run: tsx src/backtest/playtest.ts

import {
  Sim,
  fx,
  TICKS_PER_SECOND,
  MissionRuntime,
  resolveUpgrades,
  unlockReason,
  starsEarned,
  creditsFor,
  creditInputFrom,
  type MissionJson,
  type LedgerData,
  type TunnelRouteJson,
  type UnlockGate,
  type MissionResult,
  type Stars,
} from '@lions/sim';
import {
  units,
  maps,
  missions,
  structures as structureCatalogue,
  parseMap,
  applyTerrain,
  world,
  applyUpgrades,
  maxTiers,
} from '@lions/data';

type Plan = (sim: Sim, rt: MissionRuntime, ids: (t: string) => number[], at: (t: number, fn: () => void) => void) => void;

/**
 * Task 7 / controller ruling R2: the harness's chained ledgers (`led…`) do not
 * reliably reach the three star gates -- Khan Rafid and Deir Amun's plans, for
 * instance, deliberately run on a bare `{}` ledger rather than chaining off
 * Beit Sahwan (see the Khan Rafid comment below), so no single threaded ledger
 * ever accumulates the whole campaign's stars. Instead of asserting on one of
 * those partial ledgers, this records every mission's OWN measured grade here
 * -- keyed by mission id, written only by the winning plan (never a control) --
 * and the assertions at the bottom of this file walk `world.json`'s own
 * region -> town -> mission order and accumulate these recorded stars into a
 * synthetic `campaign.mission_results` ledger, exactly the shape a real
 * playthrough would write one mission at a time.
 */
const missionStars = new Map<string, Stars>();

/** Each mission's own winning-plan credit value (spec 2026-09-15 §4.2), recorded under
 *  the same `label === id` guard as `missionStars`, so probes and controls never count. */
const missionCredits = new Map<string, number>();

/** Each mission's own winning-plan Conduct score, recorded under the same `label === id`
 *  guard as `missionStars`/`missionCredits`. WP-G-E1 (2026-09-18): this feeds
 *  `conductLedgerAfter` below, the Conduct-floor twin of `syntheticLedgerAfter` -- before
 *  this, `missionResults`'s own `roe` field was hardcoded to 0, which was harmless only
 *  because nothing walked the nine `roe_rating_min` gates against the real ladder yet. */
const missionRoe = new Map<string, number>();

/** Brigade economy Task 5: everything a plain `label === id` VICTORY run needs to be
 *  replayed with every KDF type patched to its own maximum tier. Recorded under the
 *  same guard as `missionStars`/`missionCredits` above -- a control, a "(no orders)"
 *  run or one of Task 7's gate probes never contributes an entry, because every one
 *  of them passes a label distinct from its own mission id. `baseResult`/`baseStars`
 *  are what the max-tier replay is held against: the controller's ruling is that a
 *  max-tier force must stay in the VICTORY class and must not drop a star the base
 *  run already earned, never that it reproduce the base run's numbers exactly.
 *  `baseRoe`/`baseCredits` are carried the same way, purely for the diagnostic
 *  line the max-tier loop prints below -- unlike `baseResult`/`baseStars`, they
 *  are never asserted against, since the controller's ruling never asked the
 *  replay to reproduce ROE or credits, only the outcome class and the star
 *  floor. */
interface MaxTierProbe {
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
const maxTierProbes: MaxTierProbe[] = [];

/** A unit JSON entry's `unlock` gate, mapped from the authored
 *  `roe_rating_min`/`stars_min`/`after_mission`/`price` field names to `UnlockGate` -- the
 *  one mapping `unitInfo` and `unlockOf` (`resolveUpgrades`'s lookup) both share. This used
 *  to claim it matched main.ts's own `kdfUnlockGate` while dropping `price` on the floor --
 *  a bought-only unit (no earned field, price only) then read OPEN here and LOCKED in the
 *  app, since `unlockReason` treats a gate with no fields at all as open. Mapped now. */
function kdfUnlockGate(u: {
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

function run(
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
  /** Written by the max-tier replay pass at the end of this file so it can read back
   *  what THIS run actually measured, without widening `run`'s return type -- every
   *  existing call site still gets back exactly the produced `LedgerData` it always
   *  did, spread or chained as-is. `roeScore`/`credits` were added alongside
   *  `result`/`stars` so the replay can print a base-vs-max ROE/credits line
   *  without re-deriving either from `produced`. */
  measured?: { result: 'ongoing' | 'victory' | 'defeat'; stars: Stars; roeScore: number; credits: number }
): LedgerData {
  const mission = missions[id] as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  // Matches the app. `spawn` never reuses a dead slot, so this is a budget for
  // everyone who ever appears, not for how many stand at once.
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
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
  for (const u of Object.values(units)) {
    // Mirrors main.ts's own pre-pass exactly (see the `tiers` doc comment above) --
    // enemy units never go through applyUpgrades, only a KDF unit can carry a tier.
    const registered = tiers === 'max' && u.faction === 'kdf' ? applyUpgrades(u, maxTiers(u)) : u;
    typeOf.set(u.id, sim.addUnitType(registered));
  }
  // `upgrades_to` resolved once, before the runtime is built, exactly as main.ts
  // does it -- so a placed force fields the earned unit here too and the spawner
  // stays gate-blind.
  const unlockOf = (unitId: string): UnlockGate | undefined => {
    if (gateOf) return gateOf(unitId);
    const d = (
      units as Record<
        string,
        { unlock?: { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number } } | undefined
      >
    )[unitId];
    const gate = d ? kdfUnlockGate(d) : undefined;
    return gate ? { ...gate, bought: bought.has(unitId) } : undefined;
  };
  const resolvedMission = resolveUpgrades(mission, ledger, unlockOf);
  const rt = new MissionRuntime(sim, resolvedMission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: (u) => {
      const d = (units as Record<
        string,
        | {
            faction: string;
            unlock?: { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number };
            cost: { logistics: number; build_time_s?: number };
          }
        | undefined
      >)[u];
      if (!d || d.faction !== 'kdf') return null;
      return {
        logistics: d.cost.logistics,
        buildTimeS: d.cost.build_time_s ?? 20,
        unlock: kdfUnlockGate(d),
      };
    },
  });
  rt.start();
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
  const timed: [number, () => void][] = [];
  plan(sim, rt, ids, (t, fn) => timed.push([t * TICKS_PER_SECOND, fn]));
  let produced: LedgerData = {};
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    for (const [when, fn] of timed) if (when === t) fn();
    const evs = sim.tick();
    for (const me of rt.step(evs)) if (me.kind === 'missionEnd') produced = me.ledger;
    if (rt.result !== 'ongoing') break;
  }
  const mins = (t / TICKS_PER_SECOND / 60).toFixed(1);
  console.log(
    `${label}: ${rt.result.toUpperCase()} in ${mins} min, ROE ${rt.roeScore}, stars ${rt.stars}, ` +
      `objectives ${rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}, ` +
      `roster out ${(produced['roster.surviving_units'] ?? []).length}` +
      (fielded !== undefined ? `, fielded ${fielded}=${fieldedOk}` : '')
  );
  const credits = creditsFor(creditInputFrom(rt, rt.roeScore, mission.roe?.fail_below));
  console.log(`${label}: credits ${credits}`);
  if (rt.result !== expect) {
    console.error(`${label}: FAILED — expected ${expect.toUpperCase()}, got ${rt.result.toUpperCase()}`);
    process.exitCode = 1;
  }
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
    missionRoe.set(id, rt.roeScore);
    // Brigade economy Task 5: record this same plain victory for the max-tier
    // replay pass below. `tiers === undefined` is belt-and-suspenders -- a max-tier
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
  }
  return produced;
}

/**
 * F1 / ruling R2(b): the six `upgrades_to` sites (`data/campaign/special_units/design.md`
 * §3-5) are exercised elsewhere in this file only with the gate CLOSED -- every chained
 * `led…` ledger this harness threads together stays far below all three star gates (12,
 * 30, 44; see the GATES table and the `missionOrder` walk at the bottom of this file), so
 * `resolveUpgrades` never fires against real mission JSON anywhere CI can see. `gateLedger`
 * builds a synthetic `campaign.mission_results` ledger of `entries` two-star placeholder
 * missions merged over `base`, keyed `synthetic_<n>` -- never a real mission id, so nothing
 * downstream (`starsEarned`, the debrief, a save file) could ever mistake one for a played
 * mission. The six probes below each mission's own winning-plan run pass `gateLedger({}, 6)`
 * (12 stars) to open `breach_team` (`stars_min` 12), `gateLedger(<ledger>, 15)` (30 stars) to
 * open `scout_shachaf` (30), and `gateLedger(<ledger>, 22)` (44 stars) to open `apc_kipod`
 * (44) -- the same three entry counts the measured optimal-play ladder itself reaches at
 * missions 6/15/22 of `world.json`'s flattened order, landing at 12/31/45 cumulative stars
 * (margins 0/1/1 over the three gates -- see the `GATES` loop's own printed lines). Each
 * probe's `label` is distinct from the mission id (`'<id> (gate open)'`), so the `label ===
 * id` guard above never lets a probe overwrite that mission's real `missionStars` entry and
 * the GATES ladder stays exactly as measured. A red gate probe here means a star moved
 * somewhere on the ladder -- read it that way, never as "widen the gate".
 */
function gateLedger(base: LedgerData, entries: number): LedgerData {
  const results: Record<string, MissionResult> = {};
  for (let n = 0; n < entries; n++) results[`synthetic_${n}`] = { stars: 2, roe: 100, ticks: 1, lost: 0 };
  return {
    ...base,
    'campaign.mission_results': {
      ...(base['campaign.mission_results'] as Record<string, MissionResult> | undefined),
      ...results,
    },
  };
}

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

// 0 — First Light: hold the compound, run the villages in with the jeep, and
// spend the corridor as it arrives.
//
// The compound is at the middle of the map with a gate on each face, and 104
// attackers converge on it from all eight edges over thirteen minutes. Three
// things this plan does deliberately:
//
// - every other defender stays where they are. They start spread across the
//   yard with firing positions covering each gate, and a wall they can shoot
//   over, so there is nothing to reposition toward -- and a unit under orders
//   is a unit that might walk into its own gateway and cork it.
// - the forward section is the one exception, and it is the design's own
//   decision rather than a workaround. `script.md`'s level design leaves one
//   inf_squad at [20,14], outside the wire, between the paramotor's eye and
//   the mortar crew laid in behind it -- exposed to both unless the sniper or
//   the mortar team spends a turn on one of them instead of the wall. `hold_outpost`
//   (secondary, hold_for(outpost_ground, 120)) rewards holding it; the
//   `they_take_the_section` trigger (timer_s 165) takes it if the mission does
//   not lose it first. This plan takes the other half of that decision: at t=0
//   the section withdraws to [21,18], the tile it occupied before the level
//   script moved it forward, trading `hold_outpost` for the unit itself rather
//   than spend a defender on ground the plan cannot also hold with the rest of
//   the line intact.
// - the jeep does two runs, north village then south, and nothing escorts it.
//   Shepherding is a four-tile proximity brush rather than an escort: the
//   families walk themselves in once touched, so speed is the whole trick and
//   numbers only add casualties.
// - logistics is spent, not banked. 400 up front and 120/min means a purchase
//   roughly every two minutes, and an unspent purse at the end is the GDD's own
//   definition of income set too high.
//
// Control: the premise is catastrophe. A player who gives no orders at all must
// LOSE -- if the compound holds itself for thirteen minutes, the breach is not
// a breach. This pins the mission's premise the way the plan pins feasibility.
run('beit_sahwan_breach', () => {}, {}, 'defeat', 'beit_sahwan_breach (passive control)');

const led0 = run('beit_sahwan_breach', (sim, rt, ids, at) => {
  at(0, () => {
    // Pull the forward section back inside the wire immediately, rather than
    // leave it to the paramotor/mortar pair or the t=120s wave that overruns
    // `outpost_ground`. Filtered by starting position, not by entity order,
    // since `inf_squad` spawns four times and only the one at [20,14] is the
    // forward section -- the other three stay on the wall (see the comment
    // above).
    const forward = ids('inf_squad').filter(
      (i) =>
        Math.round(fx.toNumber(sim.state.posX[i])) === 20 && Math.round(fx.toNumber(sim.state.posY[i])) === 14
    );
    sim.queueCommand({ kind: 'move', ids: forward, ...M(21, 18) });
  });
  const shepherds = ids('jeep_shoded');
  // Both western villages, out and back through the west gate, before the
  // south-west and west spawns build up. Six families is the objective and the
  // two western pairs are six between them, so there is no reason to cross the
  // map for the eastern ones and every reason not to.
  const armour = ids('apc_eitan');
  at(5, () => {
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(13, 19) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(13, 28) });
  });
  at(45, () => {
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(20, 21) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(20, 26) });
  });
  // Spend it as it lands. Banking is the losing move here: an unspent purse is
  // a squad that was not on the wall when the wire came down, and the run that
  // bought on a six-purchase schedule died ninety seconds sooner than the one
  // that bought whenever it could afford to.
  for (let when = 20; when <= 700; when += 25) {
    at(when, () => {
      if (!rt.requestBuild('inf_squad')) rt.requestBuild('mortar_team');
    });
  }
});

// I — Recon: scouts screen forward on the berm and observe; the drone tours
// a standoff line and re-tours until the picture is built.
const led1 = run('beit_sahwan_1_recon', (sim, _rt, ids, at) => {
  const drone = ids('recon_drone');
  const screen = [
    ...ids('apc_eitan'),
    ...ids('mbt_lavi'),
    ...ids('ifv_namer'),
    ...ids('inf_squad'),
    ...ids('at_team'),
  ];
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 8) });
  });
  // hvt_seen (carrying secondary): bs_hvt_atgm sits at the map's east edge
  // (38.5,22.5), and the direct bearing from the drone's local-recon standoff
  // passes within ~2 tiles of bs_cell_north_east -- a rifle garrison
  // (small_arms, can_target air) close enough to spring an instant kill on a
  // 120-hp, unarmoured drone, measured. Once the local recon at (21,8) is
  // done (track_north -- find_the_column -- identifies at ~17s), two legs
  // send it east along y=8 first, clearing north_east by 7+ tiles, then south
  // at x=40 to the ATGM's own longitude: the whole transit stays outside
  // every garrison's engagement envelope.
  at(18, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(40, 8) }));
  at(24, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(40, 22) }));
  // The screen holds at its start line rather than advancing at t=0. A real
  // player who wants the HVT photo does not spend the same six-count
  // `picture` on a faster-sighted screen before the drone gets there --
  // measured, the screen's own attackMove into (16,22) plus its upgraded
  // max-tier sensors let apc_eitan identify bs_ambush_market_lane on its own
  // sight alone at ~23s, which used to close `picture` before the drone ever
  // reached the ATGM. Holding for 32s (the drone identifies the ATGM at
  // ~30.4s, both tiers) costs nothing: `picture`'s own count of 6 is already
  // satisfied by the drone's own route -- both `hunters` technicals converge
  // on the player's start the moment first_contact fires and cross its
  // outbound leg, then north_block, track_north and the ATGM itself complete
  // the six -- so the screen advancing at all is flavour once this is
  // reached, not a requirement. Robust from t=26 through the screen never
  // advancing at all (tested to t=9999) at both tiers; 32 leaves margin on
  // both sides rather than sitting on the edge.
  at(32, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(16, 22) }));
  at(60, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 30) }));
  at(150, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(26, 40) }));
  // Recon in force: the screen advances and fights for the rest of the
  // picture — firing multiplies signature, contacts identify fast.
  at(240, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(22, 24) }));
  at(300, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30, 18) }));
  at(480, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(27, 20) }));
}, led0, 'victory', 'beit_sahwan_1_recon', 3);

// II — Foothold: dig in on the assembly area, buy a squad when affordable.
const led2 = run(
  'beit_sahwan_2_foothold',
  (sim, rt, _ids, at) => {
    at(1, () => {
      const all: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0) all.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: all, ...M(8, 23) });
    });
    at(120, () => void rt.requestBuild('inf_squad'));
  },
  led1
);

// III — Clearance: combined arms, with the armour held off the clinic.
//
// The clinic zone is [29,23,6,6] — tiles x29-34, y23-28 — and three things
// about this map put it directly in the way of the primary objective:
// `town_center` is the marker at [31,22], right on its northern edge, and the
// `bs_cell_centre` militia sit at (29.5,25.5), which is INSIDE the zone and in
// the open. Clearing the town means killing something standing in the clinic.
//
// A unit does not choose which of its weapons it fires — only where it stands.
// The zone penalty arms at collateral_risk >= 0.3, which catches the Namer's
// cannon_30 (0.35) and the Lavi's gun_120 (0.55) but not rifles (0.1), the
// Lavi's coax_mg (0.2) or the Eitan's rws_50 (0.25). So the whole mission is
// decided by which units are given a line into that box.
//
// The previous plan attack-moved everything alive to (38,22) at t=140, which
// walked both Namers into range of the cell in the clinic: 107 rounds of 30mm
// landed inside the zone, plus 7 of 120mm and 6 Spike. The 10s cooldown
// compressed those into 11 deductions of 5 — a 55-point loss, on top of 6 for
// one house — and the mission ended at ROE 39 against its own fail_below of 40.
// It lost to its own supporting fire, not to the Ashwar Front (#121).
//
// So: the centre is taken by rifles and the Eitan's RWS, both under the
// threshold, while the armour works the north block and swings east along
// y=16 to the ATGM rather than across the clinic. Same objectives, and it
// finishes faster and with more of the roster alive than the shelling did.
//
// III PRODUCES `intel.marked_positions` since 2026-09-19 (WP-G-E3 Task 1), and
// this run receives the merged `{ ...led1, ...led2 }` rather than `led2` alone.
// Both halves are needed and neither is cosmetic.
//
// The ledger argument first. III declares `requires: intel.marked_positions`,
// and `led2` does not carry the key -- Beit Sahwan II does not declare it, and
// `run` returns only what a mission DECLARES. So the harness was handing a
// mission that asks for intel an EMPTY set, where the app merges every mission's
// output into one persistent ledger (main.ts:1022) and III would really receive
// I's marks. Merging here is fidelity, and it is also what keeps the produces
// key from being destructive: `led4In` below is an object SPREAD, so the moment
// `led3` carries `intel.marked_positions` it REPLACES led1's value instead of
// unioning with it. Measured 2026-09-19 with a scratch log of
// `led4In['intel.marked_positions']` against IV's own eight tags:
//
//   baseline (no produces key)     IV pre-marked: market_lane, north_block, track_north
//   produces key, led2 ledger      IV pre-marked: market_lane, north_block       <- track_north LOST
//   produces key, {led1,led2}      IV pre-marked: market_lane, north_block, track_north
//
// So the failure mode of the naive wiring is LESS pre-marking, not more -- the
// opposite of what 2026-09-11 suggested. `mission.ts:1961` unions `this.marked`
// with `this.markedThisMission`, so once III is given I's marks its produced set
// is a superset of I's and IV's inherited three are exactly as before.
//
// **Measured at Task 1 and SUPERSEDED by Task 3's screen hold.** The two
// before/after readings below (IV's roster count, III's own line) describe
// the state right after this commit landed, not HEAD -- Task 3's screen
// hold reverted the drift. HEAD's own line is added beneath each one.
//
// **The 2026-09-11 experiment does not reproduce, and it was not re-run.** It
// recorded IV going from `VICTORY in 2.1 min, ROE 98` to `ONGOING in 20.0 min`
// with `roster out 0`. Two things changed under it since: Beit Sahwan I gained
// the `bs_track_north` companion placement, and IV's plan was rebuilt around the
// two structural faults that exposed (the Namer out of `escort`, east's north
// charge held to t=68) -- both written up in the `led4In` block below. Measured
// 2026-09-19 on today's JSON, with the produces key and the merged ledger both
// in, IV reads:
//
//   before: VICTORY in 2.1 min, ROE 98, stars 2, all five objectives c, roster out 25
//   after:  VICTORY in 2.1 min, ROE 98, stars 2, all five objectives c, roster out 23
//   HEAD (post Task 3):  VICTORY in 2.1 min, ROE 98, stars 2, roster out 25, credits 188
//
// Result, clock, Conduct, stars and every objective are unmoved; `roster out`
// follows III's own roster shrinking upstream (24 -> 22), not IV degrading. IV's
// plan therefore needed NO hardening and none was added.
//
// III's own line does move, and that is the mission finally getting what its
// `requires` asks for: `VICTORY in 1.1 min, ROE 100, roster out 24, credits 240`
// -> `VICTORY in 2.3 min, ROE 89, roster out 22, credits 209`. Its hostile
// placements now spawn pre-marked, so `spawnPlacement`'s `preMarked` branch skips
// `setAmbush` (mission.ts) and they fight at their full weapon range from tick
// zero instead of holding to the 3 tiles their stance authors. 1.1 min was the
// figure an empty intel set bought; 2.3 (0.33 of `target_minutes` 7) is the one a
// real campaign hands this mission. `picture` is still a plain secondary here --
// the `carries: true` flag is the NEXT commit, deliberately separated so this
// ledger change moves no star (WP-G-E3 ruling R-10).
//   HEAD (post Task 3): VICTORY in 1.1 min, ROE 100, stars 3, roster out 24, credits 280
//
// One honest limit, constructed and run rather than reasoned: **this harness
// cannot fail on the `produces` key by itself.** Reverting it while keeping the
// merged ledger leaves every printed line byte-identical and exits 0, because
// `main.ts:3505` merges a produced ledger with the same SPREAD `led4In` uses --
// so with III declaring nothing, led1's marks simply persist, and IV's own three
// tags are reachable either way. What the key really buys is III's OWN sightings
// (bs_cell_south, bs_mortar_pit, bs_aa_gun_truck, bs_charge_centre,
// bs_loiter_munition, bs_cell_centre, bs_cell_north_east) reaching the persistent
// ledger at all -- which is what makes a `carries: true` on `picture` a claim
// with something behind it, and which no mission downstream reads yet. Reverting
// the LEDGER ARGUMENT does go red (`credit ladder: FAILED -- expected 5490, got
// 5531`), and that is the falsification Task 1's commit was seen to fail on --
// it is not reproducible on HEAD, whose credit ladder now reads 5849.
const led3 = run(
  'beit_sahwan_3_clearance',
  (sim, _rt, ids, at) => {
    at(1, () => {
      sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(32, 18) });
      // North block only. Nothing above the collateral threshold is given a
      // reason to look south into the clinic.
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer')];
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(30, 12) });
      // The Eitan goes with the infantry rather than with the armour: its RWS
      // is under the threshold, so it is the one vehicle that can support a
      // fight inside the zone without being charged for it.
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('inf_squad'), ...ids('apc_eitan')],
        ...M(28, 26),
      });
      // Engineers follow the infantry: held houses come down by charge, which
      // costs the house and nothing else — shelling them scatters rounds into
      // the clinic block next door.
      sim.queueCommand({ kind: 'attackMove', ids: ids('demo_squad'), ...M(27, 25) });
      // The AT team stays north with the armour. Spike also arms the zone
      // penalty, and its business is the technical and the gun truck anyway.
      sim.queueCommand({ kind: 'attackMove', ids: ids('at_team'), ...M(30, 14) });
    });
    // Armour's own move east was retimed from t=140 to t=85 for the
    // map-variants slice (docs/campaign/map-variants-design.md,
    // `beit_sahwan_3` -- the clinic wall). The wall's own north face (y=23)
    // is 10 tiles from the armour's north-block waypoint (30,12ish, snapped
    // off the blocked house tile) -- inside both mbt_lavi's 12-tile gun_120
    // range and ifv_namer's 10-tile cannon_30 range. Once bs_cell_north_block
    // dies the armour has nothing else to shoot at that range and, still
    // under attackMove, fixates on the wall itself: `wall`'s own roe_penalty
    // is 0, so destroying it is free, but `roe.flagged_zones` charges every
    // STRAY heavy round that scatters into the zone regardless of intended
    // target, and at 10-12 tiles those stray rounds land squarely on it.
    // Measured (isolating the wall alone via a scratch run): six such
    // deductions, ROE 94 -> 61. Moving this order earlier -- before the
    // fixation has time to compound -- cuts it to one, ROE 94 -> 89.
    at(85, () => {
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer')];
      // East along the northern edge to the ATGM at (38.5,22.5) — approaching
      // on y=16 keeps the gun line clear of the clinic the whole way.
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(38, 16) });
    });
    at(140, () => {
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('inf_squad'), ...ids('apc_eitan')],
        ...M(31, 22),
      });
    });
    at(260, () => {
      const armor = [...ids('mbt_lavi'), ...ids('ifv_namer')];
      sim.queueCommand({ kind: 'attackMove', ids: armor, ...M(38, 22) });
    });
  },
  // The app's persistent merge, not `led2` alone -- see the block above.
  { ...led1, ...led2 },
  'victory',
  'beit_sahwan_3_clearance',
  3
);

// --- Naharin: Wadi Halam ------------------------------------------------------

// I — The Fords: push the screen into the tree line, clear both gallery
// ambushes for the picture, and hold the ford watch uncontested for 20s.
// The drone tours the bank/bund/hide side of the wadi so the picture comes
// from four *different* enemies rather than two ambushes seen twice.
// `take_ford` is a four-minute hold, contested by three waves out of the
// east (90s, 210s, 225s) -- so the screen has to actually stand on the
// ford watch and fight, not merely visit it for twenty seconds. Re-anchors
// on the same schedule as II and III, for the same reason: a wave that
// breaks and runs pulls a pursuing force past the zone edge and the hold
// clock does not resume until something brings them back.
//
// Option C detour (script.md §9.1): `get_the_carriers_out` runs a 300s clock
// from t=0 regardless of contact, so the jeep alone is diverted to shepherd
// both carrier groups off the south ford before rejoining the ford-watch
// anchor -- a three-leg detour that costs the plan 0 survivors and about
// 0.6 minutes. The drone's own tour gains one extra leg to mark
// `wh_hide_south`, which is the carry-over III spends (script.md §2.3).
const wh1 = run('wadi_halam_1_fords', (sim, rt, ids, at) => {
  const drone = ids('recon_drone');
  const screen = [...ids('apc_eitan'), ...ids('inf_squad'), ...ids('at_team')];
  const jeep = ids('jeep_shoded');
  at(0, () => {
    // North first: the near gallery ambush is 4 tiles off the axis, and
    // going in under attackMove springs and kills it instead of walking past.
    sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 15) });
    // Detour, not the shipped [9,20]: closes on carrier group A ([13.5,30.5])
    // first, within SHEPHERD_RADIUS_SQ (4 tiles).
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(15, 31) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 17) });
  });
  at(45, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 30) }));
  // South gallery next -- the second identified contact the picture needs
  // beyond the bank/bund pair the drone is already turning up.
  at(60, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 31) }));
  // Jeep's second leg: closes on carrier group B ([16.5,33.5]).
  at(60, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(17, 34) }));
  // Drone marks wh_hide_south while its tour is already this far south --
  // the identification III's carry-over spends (script.md §2.3, 5.9 -> 5.2 min).
  at(90, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 35) }));
  // Jeep rejoins the ford-watch anchor loop the screen re-issues every 45s
  // from t=130.
  at(120, () => sim.queueCommand({ kind: 'attackMove', ids: jeep, ...M(10, 24) }));
  // Settle on the ford watch itself.
  at(110, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(10, 24) }));
  for (let when = 130; when <= 320; when += 45) {
    at(when, () => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(10, 24) });
    });
  }
  void rt;
});
run('wadi_halam_1_fords', () => {}, {}, 'defeat', 'wadi_halam_1_fords (no orders)');

// II — Grazing Ground: dig the whole force in on the pump house corner of
// the pasture and take every wave as it arrives; nothing here rewards
// manoeuvre, the ground is open on both sides. Buy inf_squad on a loose
// schedule once logistics allow.
//
// attackMove does not mean "stand here": a picket that breaks and runs pulls
// a force that killed it a good way past the zone edge chasing the retreat,
// and hold_for's clock only counts ticks where a living player unit is
// actually inside the zone. Left to a single order at t=1, the whole force
// wanders off after the first withdraw and the hold never resumes -- so this
// re-anchors on the pump house corner periodically, sweeping in whatever
// spawned since the last order too.
//
// `burn_store` (script.md's `structures[]` shed at [16,19], Option C): a
// masonry structure with nobody garrisoned inside is not a valid target for
// ordinary weapons fire at all -- `selectStructureTarget` only ever picks a
// building that holds an IDENTIFIED HOSTILE occupant (mission.ts / sim.ts:
// "Nothing in the open to shoot? Then the enemy is inside a building"), and
// script.md's own fragment for the shed's defender cannot be authored as
// `stance: garrison` -- `validate_data.mjs`'s garrison-building check reads
// only the map's own static grid, never a mission's own `structures[]` (see
// script.md's correction to §2.2/§8a). So the anchor's firing line alone
// cannot bring the shed down, contrary to script.md's own measurement
// ("brings the new shed's HP down over the course of the mission with no
// amendment"), which was not run against this validator. The mission's own
// briefing already promises engineers ("...while the engineers lay the
// crossing behind you"), so `demo_squad` fields that promise: one combat
// engineer team, added to starting_force, explicitly demolishes the shed --
// the same idiom V already uses for its own seven structures. It is kept
// out of the periodic anchor sweep so a later `attackMove` never cancels its
// charge.
const wh2 = run(
  'wadi_halam_2_laager',
  (sim, rt, ids, at) => {
    const engineers = new Set(ids('demo_squad'));
    const anchor = (): void => {
      const all: number[] = [];
      for (let i = 0; i < sim.entityCount; i++)
        if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !engineers.has(i)) all.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: all, ...M(18, 21) });
    };
    at(0, () => {
      const shed = sim.structureAt(16, 19);
      if (shed >= 0) sim.queueCommand({ kind: 'demolish', ids: [...engineers], structure: shed });
    });
    at(1, anchor);
    for (let when = 45; when <= 700; when += 45) at(when, anchor);
    for (let when = 90; when <= 700; when += 60) {
      at(when, () => void rt.requestBuild('inf_squad'));
    }
  },
  wh1
);
// `burn_store` reaches `failed` at 300s, and `hold_pasture` never even
// starts (the force spawns at x2-4, `pasture` begins at x13) -- nothing else
// on the map can end a passive run.
run('wadi_halam_2_laager', () => {}, wh1, 'defeat', 'wadi_halam_2_laager (no orders)');

// III — The Cattle Track: a fast, armoured pair (jeep + APC) runs the
// commander down at the north hide -- enough firepower to drop him before
// the withdraw trigger matters, and enough armour on the jeep's wing that
// losing it to the technical's dshk isn't the likely outcome. The rest holds
// the bunds against the two-wave counter-raid; the hold re-anchors on the
// same schedule as II, for the same reason (a wave that breaks and runs
// pulls a pursuing force out past the zone edge).
const wh3 = run(
  'wadi_halam_3_counterraid',
  (sim, _rt, ids, at) => {
    const chase = [...ids('jeep_shoded'), ...ids('apc_eitan')];
    const anchor = (): void => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(18, 21) });
    };
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: chase, ...M(22, 10) });
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')],
        ...M(18, 21),
      });
    });
    for (let when = 60; when <= 700; when += 45) at(when, anchor);
  },
  wh2
);
// `get_the_herders_out` reaches `failed` at 300s. `hold_bunds` never starts
// for the same structural reason as II; `kill_amir` cannot fail on its own.
run('wadi_halam_3_counterraid', () => {}, wh2, 'defeat', 'wadi_halam_3_counterraid (no orders)');

// IV — Wadi Halam (the village): clear the four corner cells, kill the cache
// guard in the SE house, and get the families out. Mind the hall block --
// nothing in this force fires ordnance heavy enough to charge it, so the
// only ROE discipline needed is not parking a gun on top of it.
//
// The north corners first, deliberately: any garrisoned house that comes
// within a weapon's max range makes itself the target and an attack-mover
// halts to trade fire with it rather than closing the distance -- so a goal
// picked equidistant between the north and south clusters brings the south
// cell into range while the force is still eight tiles from the actual
// objective, and it sits there sniping a single rifleman through a wall for
// minutes. Clearing north to south in two bounds keeps only one cluster in
// range at a time.
// IV's shepherd is the IFV, not the jeep. Front armour 420 and side 220
// against every gun in this mission's roster (dshk, penetration 25) means
// nothing here can put a scratch on it, so it can drive straight through
// contested ground and pick every family up without the risk a lighter
// vehicle runs of dying mid-transport and stranding its passengers for
// good -- which is exactly what killed the jeep-shepherd version of this
// plan before it evacuated anyone. Five transport slots covers all four
// civilians in one circuit. The APC alone (plus the infantry) is enough
// to clear the north side without the IFV's cannon.
const wadiHalam4Plan: Plan = (sim, _rt, ids, at) => {
  const apc = ids('apc_eitan');
  const ifv = ids('ifv_namer');
  const infantry = [...ids('inf_squad'), ...ids('at_team')];
  // One building at a time, and everything that can hurt masonry aimed at the
  // same one. All four cells are garrisoned, and a garrisoned man cannot be
  // shot -- his house has to come down -- so clearing the village is four
  // sequential demolitions by gunfire, and splitting the force across two
  // corners halves the rate on both.
  const guns = [...apc, ...infantry];
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: guns, ...M(27, 19) });
    sim.queueCommand({ kind: 'move', ids: ifv, ...M(28, 21) });
  });
  at(20, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(25, 23) }));
  at(40, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(29, 28) }));
  at(60, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(22, 36) }));
  // The IFV's autocannon is the heaviest thing here, so it joins the sweep
  // the moment its circuit is done rather than parking on the objective.
  at(105, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(32, 19) }));
  at(210, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(27, 30) }));
  at(300, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(32, 30) }));
  // Consolidate on the centre for the capture clock once the corners are down.
  at(390, () => sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(29, 26) }));
};

const wh4 = run('wadi_halam_4_village', wadiHalam4Plan, wh3);

// F1 / ruling R2(b): gate-open probe -- apc_kipod (stars_min 44) reached via
// gateLedger(wh3, 22), proving the mission's fresh jeep_shoded placement
// resolves to apc_kipod once the gate is open, not merely that the mission
// still wins fielding the un-upgraded jeep. Same plan body as the run above.
run(
  'wadi_halam_4_village',
  wadiHalam4Plan,
  gateLedger(wh3, 22),
  'victory',
  'wadi_halam_4_village (gate open)',
  2,
  'apc_kipod'
);

// `evac_families` already reaches `failed` at 300s today -- the only change
// Option C makes is that it is now a primary, so `checkEnd` finally reads it.
run('wadi_halam_4_village', () => {}, wh3, 'defeat', 'wadi_halam_4_village (no orders)');

// V — Break the Depot: bring the D9 and the combat engineers in behind the
// screen from the start to level all seven structures by explicit order,
// then hold the rubble. Every demolish order names its structure -- nothing
// here is left to the automatic search, which would be perfectly happy to
// park a stationary demolisher beside a village house on the way in and
// spend ROE nobody meant to spend.
//
// What sets this mission's length is `hold_depot` (data, not the plan): a
// 240s hold_for on the depot zone, primary, gated the same way II's
// hold_pasture is. The razed structure tiles unblock as they fall, so the
// column can stand in the compound once it is down. An earlier version of
// this plan parked the demolishers at the start line for over four minutes
// to manufacture a slow mission -- invisible to anyone reading the mission
// JSON, which at the time gated on nothing but raze and the gate HVT, and
// left the 160s/220s waves and `no_bleed` (300s) structurally unreachable
// in any competent run. That park is gone: the demolishers move
// immediately, the same as a player who is not deliberately stalling
// would send them. The raze itself is fast (D9: 2400 HP, nothing in this
// mission's roster can penetrate it, blade demolition 2s/structure) -- the
// four escalated waves and three interior defenders now matter for the
// *hold*, not for slowing the demolition down.
//
// The demolish orders are issued straight from the start -- no staging move
// to the gate first, no polling for arrival. `Sim.applyCommands` now snaps a
// blocked goal tile (a structure's centroid always is one) to the nearest
// open tile before building the flow field, so the D9 and the engineers
// route themselves through the one-tile gate on their own, the same as any
// other `move` order would.
const wadiHalam5Plan: Plan = (sim, _rt, ids, at) => {
  const screen = [...ids('apc_eitan'), ...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')];
  const dozer = ids('dozer_d9');
  const engineers = ids('demo_squad');
  const jeep = ids('jeep_shoded');
  // The seven structures inside the wire, by one tile each inside their
  // footprint -- see the map's depot zone. One shared pool rather than a
  // fixed split: the combat engineers (HP 380, no armour worth the name)
  // are the softest thing in the column, and the harassment this mission
  // throws at the gate can plausibly kill them before they clear their
  // share. A demolisher pulls the next live target off the shared list
  // rather than a list assigned to it specifically, so if the engineers
  // go down the D9 (slower alone, but unkillable by anything in this
  // mission's roster) picks up what is left instead of three buildings
  // simply never coming down.
  const targets: [number, number][] = [
    [36, 18],
    [40, 18],
    [36, 21],
    [40, 21],
    [36, 24],
    [39, 24],
    [37, 27],
  ];
  // Checked against the live structure table so a target already down is
  // skipped. Scanned from opposite ends of the shared list so that, when
  // both demolishers are free in the same tick, they claim different
  // structures instead of doubling up on the first one.
  const orderNext = (unit: number[], forward: boolean): void => {
    const order = forward ? targets : [...targets].reverse();
    for (const [tx, ty] of order) {
      const s = sim.structureAt(tx, ty);
      if (s >= 0) {
        sim.queueCommand({ kind: 'demolish', ids: unit, structure: s });
        return;
      }
    }
  };
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(34, 24) });
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(30, 24) });
    orderNext(dozer, true);
    orderNext(engineers, false);
  });
  // Reissue cadence: 15s, comfortably longer than either demolisher's own
  // timer (D9 2s, engineers 5s), so this only ever catches a demolisher
  // that has actually finished and gone idle -- it does not interrupt one
  // still working (a fresh demolish order resets its charge timer).
  for (let when = 15; when <= 200; when += 15) {
    at(when, () => {
      orderNext(dozer, true);
      orderNext(engineers, false);
    });
  }
  // Once the column has a foothold, the screen advances into the compound
  // and holds there for hold_depot's clock -- re-anchored periodically for
  // the same reason II and III need it: attackMove does not mean "stand
  // here", and a wave that breaks and runs pulls a pursuing force out past
  // the zone edge.
  at(40, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(38, 22) }));
  for (let when = 85; when <= 400; when += 45) {
    at(when, () => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(38, 22) });
    });
  }
};

run('wadi_halam_5_depot', wadiHalam5Plan, wh4);

// F1 / ruling R2(b): gate-open probe -- apc_kipod (stars_min 44) reached via
// gateLedger(wh4, 22), proving the mission's fresh jeep_shoded placement
// resolves to apc_kipod once the gate is open. Same plan body as the run above.
run(
  'wadi_halam_5_depot',
  wadiHalam5Plan,
  gateLedger(wh4, 22),
  'victory',
  'wadi_halam_5_depot (gate open)',
  2,
  'apc_kipod'
);

// A player who gives no orders must not WIN the depot. This is the executable
// falsification of raze's worst failure mode: if the target set is ever empty,
// or `every()` degenerates on an empty array, this turns VICTORY and the harness
// fails.
//
// `defeat`, and it used to be `ongoing`. A passive force is neither wiped nor
// victorious, so before `raze_depot` had a deadline this run simply burned the
// 20-minute cap -- which is the softlock #87 describes, visible right here in
// the harness and mistaken for a control passing. Now the deadline expires at
// 300s and the mission ends. `defeat` still falsifies the empty-target-set bug
// exactly as `ongoing` did: a `raze` that wrongly completed would report
// VICTORY, not DEFEAT. It is a stronger control than before, because it also
// proves the deadline fires.
//
// It does NOT prove the D9's automatic demolition search leaves the depot alone
// in general -- the nearest structure is roughly twenty tiles from the passive
// start and the auto-search radius is two, so nothing here was ever close
// enough to test that.
run('wadi_halam_5_depot', () => {}, wh4, 'defeat', 'wadi_halam_5_depot (no orders)');

// --- Beit Sahwan IV: Subterranean --------------------------------------------

// IV — Subterranean: tour the district with both charge teams, and let the
// drone walk ahead of them.
//
// A route can only be charged while it is identified, and identification is
// live: a mark_tunnel carrier has to hold a sight line to it. Both Yahalom
// carry the ability themselves at sight 8, so a team that walks onto a route
// finds it and holds it for its own charge; the drone's job is to shorten the
// walk by finding the next one while the current charge runs.
//
// The two teams split. South-west takes bs_tn_souk then bs_tn_west; north-east
// takes bs_tn_clinic then bs_tn_north. Serialising them on one team is what
// blows the budget.
run('beit_sahwan_4_subterranean', () => {}, {}, 'defeat', 'beit_sahwan_4_subterranean (no orders)');

// The scripted run inherits the arc, the control does not. `run` returns only the
// keys a mission DECLARES in `produces`, while the app merges each mission's output
// into one persistent ledger (main.ts:1022) -- so chaining led1 -> led2 -> led3 by
// hand drops `intel.marked_positions` at Beit Sahwan II, which does not declare it.
// Merging the three here is what the app actually does, and it is the only way this
// mission's two inherited tags (bs_cell_north_block, bs_ambush_market_lane) arrive
// pre-revealed the way the design says they should. The no-orders control keeps `{}`:
// a passive run should not double as a carry-over test.
//
// This is a SPREAD, not a union, and since 2026-09-19 that matters: III declares
// `intel.marked_positions` in its own `produces` now, so `led3`'s value REPLACES
// led1's here rather than merging with it. What makes that safe is that III is run
// on `{ ...led1, ...led2 }` (see its own block above) -- `mission.ts:1961` unions
// what came in with what III saw, so `led3`'s set is a superset of led1's and IV's
// third inherited tag, bs_track_north, survives the replacement. Run III on `led2`
// alone and it does not: measured 2026-09-19, IV's pre-marked set drops from three
// tags to two. If a fourth Beit Sahwan mission ever lands between these, thread its
// ledger the same way rather than trusting the spread.
const led4In = { ...led1, ...led2, ...led3 };

// Diagnosis (walk_mission.ts + a scratch instrumented run) turned up something
// the guessed plan above could not have worked around: a plain `move` parked
// beside a route never charges it. `chargeOrder` is set in exactly one place,
// Sim.applyCommands's `kind: 'chargeTunnel'` branch -- the same command
// main.ts's HUD dispatches on a right-click over an identified route. It also
// walks the team to the nearest tile on the route's OWN polyline itself, so
// there is no tile to guess -- the plan only has to say which route and when.
// Route indices are positional, in the map's own `tunnels` array order:
// bs_tn_west=0, bs_tn_north=1, bs_tn_souk=2, bs_tn_clinic=3.
//
// Second regression: Beit Sahwan I gained a companion placement -- militia_cell
// tagged bs_track_north at [26.5,16.5], IV's own tag too, with a secondary
// (find_the_column) the I plan above now completes. intel.marked_positions
// accumulates by tag and led4In merges led1..led3, so bs_track_north now
// spawns PRE-IDENTIFIED here: spawnPlacement's preMarked branch (mission.ts)
// skips setAmbush, and it stands revealed from tick zero at its full 7-tile
// rifle range instead of holding fire to the 3 tiles its stance authors.
//
// That is not what actually broke this plan. A scratch instrumented run
// (walk_world.ts's makeWorld, this same led1/led2/led3 chain, full per-tick
// dumps of every unit's position/hp/mobilityKilled/chargeTicks) shows the fix
// below returns the identical VICTORY in 2.1 min, ROE 98, roster out 6 even
// with bs_track_north stripped back out of intel.marked_positions -- so it
// spawns as a genuine hidden ambush again. The weaker militia cell it replaces
// was never the threat; the ledger change shifted how many combat ticks other
// entities spend fighting before this point, which shifts their own
// per-entity RNG draws (sim.ts's `rng(shooterId)`, read on every
// targeting/penetration/component roll) far enough to expose two pre-existing
// structural faults this plan already had:
//
// 1. The Namer sat parked at the crossroads (27,25) -- one tile from
//    bs_ambush_market_lane at (27.5,24.5) -- as part of `escort`, for the 45+
//    seconds that group needs to clear bs4_cell_souk and bs4_charge_crossroads
//    regardless of when a LATER order is queued (attack-move will not abandon
//    a live fight). That ambush's rpg7 (penetration 550) overmatches the
//    Namer's 420 front armor; the hit landed and rollComponent (sim.ts) drew
//    mobility_kill. A mobility-killed hull is skipped by every later
//    stepMovement tick FOREVER (sim.ts:4628) -- no order, however late, ever
//    moves it again. It was already carrying the two civilians it picks up
//    for free near its own spawn, so those two were stranded at (27,25) and
//    get_them_out came up two short of 5 inside the 240s clock.
// 2. East's solo run at bs_tn_north started the moment its own tunnel:1 order
//    fired at t=45, with escort still 25-30s of travel away and unable to
//    leave its own fight early. Two buried rpg_team occupants (300 damage,
//    penetration 550 each) surfaced on approach and killed the 380 HP team
//    before its charge finished, permanently blocking bs_tn_north -- only two
//    Yahalom teams exist in the whole mission, so bring_it_down could never
//    complete once one of them was dead.
//
// Fix: the Namer is no longer part of `escort` -- it peels off to the
// collection point immediately instead, so it never stands next to either
// ambush again -- and east's own north charge is held until t=68 instead of
// t=45, so escort (now inf_squad + apc_eitan) is already drawing fire nearby
// when the two buried teams surface, rather than east taking both alone.
// Nothing else moved: a scratch run proved escort's own push orders were
// never the lever -- it cannot leave its own gauntlet near spawn early no
// matter when a later order is queued, so retiming those changed nothing.
// Even fixed, escort's north fight stays close: one inf_squad is measured
// dropping to ~8 of its 400 HP there before the buried pair dies -- exactly
// the trade the design already intends (a replaceable rifle squad drawing
// fire meant for an irreplaceable charge team), now actually landing on the
// right unit.
run('beit_sahwan_4_subterranean', (sim, _rt, ids, at) => {
  const teams = ids('yahalom_squad');
  const west = teams.slice(0, 1);
  const east = teams.slice(1, 2);
  const drone = ids('recon_drone');
  const rescueVehicle = ids('ifv_namer');
  const holdForce = [...ids('inf_squad'), ...ids('apc_eitan')];
  // The Namer never joins this group -- see above. It has nothing to gain at
  // the crossroads and an irreplaceable rescue vehicle to lose there.
  const escort = [...ids('inf_squad'), ...ids('apc_eitan')];

  // The escort goes out FIRST and alone. bs4_charge_crossroads -- a kamikaze
  // charge_squad, not one of the two tags this mission inherits pre-revealed
  // -- sits directly on the ground south of the district and rushes whoever
  // reaches it first. Sending the escort ahead means an inf_squad trades with
  // it instead of a Yahalom team: a rifle squad is replaceable, a charge team
  // eaten by one kamikaze hit (420 damage against 380 HP) is not. The same
  // attackMove clears bs_ambush_market_lane (already identified from the
  // inherited ledger) on the same pass.
  at(0, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(27, 25) }));

  // The Namer peels off immediately instead of following. It spawns at
  // [28,34], already within CivilianFlight's four-tile shepherd radius of the
  // two southern civilians at (24.5,33.5), so they flee and board within the
  // first couple of ticks purely from it EXISTING there -- no detour needed.
  // Sending it straight to collection_point banks those two evacuees inside
  // 20 seconds and keeps this 2200 HP hull out of range of every ambush in
  // the district for the rest of the mission.
  at(1, () => sim.queueCommand({ kind: 'move', ids: rescueVehicle, ...M(29, 33) }));

  // The drone scouts toward bs_tn_north -- the one route nothing has found
  // yet, its mouth over 20 tiles from every player spawn -- from a stand-off
  // point outside any occupant's weapon range of the vent, so it does not
  // trigger a surfacing volley by walking up on its own.
  at(2, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(28, 20) }));

  // West waits for the escort to clear the crossroads, then charges
  // bs_tn_souk. Ordered while the team is still at its spawn: the nearest
  // tile on souk's own polyline from there is on the MOUTH side (~7 tiles),
  // not the vent (~11) -- so the team never comes within the stocked
  // militia_cell pair's weapon range of the vent, and the charge collapses
  // both of them still buried, no fight needed.
  at(12, () => sim.queueCommand({ kind: 'chargeTunnel', ids: west, tunnel: 2 }));

  // East charges bs_tn_clinic immediately. Its stocked rpg_team + militia_cell
  // pair does surface -- clinic's line runs through contested ground either
  // way -- but Yahalom's own carbines are enough to drop both before the
  // charge completes.
  at(2, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 3 }));

  // Once each team's first route is down, retarget to the second.
  // bs_tn_west has no stocked occupants at all -- the digger_crew reworking
  // it live is 20 tiles north, out of this fight -- so west's second charge
  // is uncontested.
  at(45, () => sim.queueCommand({ kind: 'chargeTunnel', ids: west, tunnel: 0 }));

  // bs_tn_north is the hardest of the four: two rpg_team occupants (300
  // damage, penetration 550) plus a garrisoned militia_cell dug in at the
  // mouth. East HOLDS at the clinic vent -- safe, and far from bs_tn_north's
  // stocked occupants -- rather than soloing north the moment clinic is down.
  // t=68 was reached by re-running the scratch harness until east's approach
  // and escort's arrival at the vent overlap, so the two buried teams split
  // their fire against a group already there instead of concentrating both
  // rounds on one 380 HP team alone.
  at(68, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 1 }));
  at(50, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(30, 17) }));

  // Once the mouth fight at bs_tn_north is in hand, push the whole escort
  // further north-west into the shaft head itself. bs4_hvt_spade holds it
  // directly -- a `capture` cannot complete while he does, since contest
  // resets the whole ten-second clock rather than merely pausing it -- and
  // spade_guard's ambush and bs_track_north sit right against the same
  // ground. The four hostages and the two shipped civilians at [28.5,14.5]
  // stand within a couple of tiles of it too, so the same push that clears
  // the ground suppresses them into fleeing on foot toward civ_collection:
  // CivilianFlight walks anyone with no transport within four tiles, no extra
  // order needed, and the ~19-tile walk from here still lands well inside
  // get_them_out's 240s.
  at(80, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(26, 14) }));

  // Escort holds the shaft head rather than following anyone south.
  // `capture`'s contest check resets `holdTicks` to zero on ANY living enemy
  // inside the zone, so a unit left to chase a runner beyond it would restart
  // the whole ten-second count -- ordering it to a fixed interior point once
  // the ground is cleared is what keeps it held rather than merely visited.
  at(115, () => sim.queueCommand({ kind: 'move', ids: holdForce, ...M(26, 13) }));
}, led4In);

// --- Marj: Khan Rafid -----------------------------------------------------------
//
// Passive controls (mission-author's task) plus the six winning plans
// (playtest agent's task, GH-151). Each mission has exactly one failable
// primary -- an evacuate_before/collapse whose deadline the sim itself can
// reach with zero player orders -- so a `() => {}` plan and an empty ledger
// are the whole control, matching the tel_marum/qarn_hadid/umm_zeitoun
// convention. The winning plans below are likewise standalone (`{}` ledger,
// no KR I->II->III chaining): the same convention tel_marum_2/3 already use,
// since a later mission's `ledger.requires` degrades gracefully with no
// upstream ledger rather than breaking (mission.schema.json's own contract).
// That means none of intel.marked_positions' three carried tags
// (kr_lane_west/east, kr_watch's ATGM) arrive pre-identified here -- these
// plans face the full, un-shortcut ambush stances script.md §5.1-5.3 draw.

run('khan_rafid_1_recon', () => {}, {}, 'defeat', 'khan_rafid_1_recon (passive control)');

// KR I -- the drone banks the harmless ATGM first (kornet cannot target
// air), THEN flies the alley row at [24,11]: standing there is 5 tiles from
// BOTH `kr_watch` militia at once, inside their 7-tile rifle range, and no
// stand-off point on that open row clears both simultaneously (the two are
// 10 tiles apart on a straight corridor, so any point outside one's range is
// outside the other's sight). Ordering the ATGM leg first means the drone
// banks it for free while a rifleman cannot even see it, then spends itself
// on the alley flyby last -- both `kr_watch` militia are IDENTIFIED at
// t=15.1s and the drone is shot down at t=30.6s, but by then `find_the_watch`
// is already latched complete (`identified` only grows, mission.ts:1150).
//
// The jeep's own leg used to route straight through the ward's single
// north-south gate corridor (the shortest path from its spawn to the west
// family at [20,16]) -- the same corridor `the_compound_was_never_empty`
// spawns a militia into the instant a player unit crosses the wall. At base
// stats the jeep wins that race and clears the gate before it stops to
// fight; at `jeep_shoded`'s sensors tier 2 (sight 10->12, optics 1.0->1.15
// -- a purely beneficial bump, no armour or firepower involved) it detects
// that spawn just early enough to get pulled into the fight INSIDE the
// gate instead of past it, and never resumes toward [20,16] at all -- the
// west `kr_watch` militia is then never identified and `find_the_watch` (a
// primary with no deadline) hangs for the full 20 minutes. Measured: holds
// at tier 1, flips at tier 2 and tier 3 (`docs/campaign/economy/upgrades.md`
// §7.6 bisection). The fix routes AROUND the gate instead of re-timing the
// race: [18,20] sits in the open lane between the ward's west wall and the
// blocked housing row to its west, 5 tiles clear of the `kr_lane_west` RPG
// ambush at [13,20] (LOS to it is blocked by that same housing row) and
// entirely outside the `ward` zone, so the compound-spawn trigger and its
// corridor fight never touch the jeep's outbound leg at all -- at any tier.
// Jeep and Eitan are back inside the ward well under the 240s clock.
// Measured: VICTORY in 0.53 min, ROE 100, unchanged at all 17 KDF types'
// max tier (VICTORY, 2 stars, `docs/campaign/economy/upgrades.md` §7.6).
run(
  'khan_rafid_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const jeep = ids('jeep_shoded');
    const eitan = ids('apc_eitan');

    at(0, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(38, 25) }));
    // find_the_west_lane (carrying secondary): kr_lane_west (an rpg_team) sits at
    // [13,20], an ambush that only springs -- and only ever shows the RANGE it
    // would need for that -- within 3 tiles, and closing that distance with a
    // wheeled carrier is exactly the risk the mission's own briefing describes.
    // Its weapon (`rpg7`) can only ever target `ground`, though, so the drone can
    // simply fly over it -- an ambush spring that can't touch what it's aimed at
    // costs nothing. One extra leg, fired while the drone is still inbound to the
    // ATGM bank (well before it arrives at [38,25]), swings it over [13,20] and
    // back onto its original schedule: `at(22, ...)` below is untouched, and it
    // still reaches the alley row on time to finish `find_the_watch`. Measured
    // robust across a 2+ second window (t=8.4-10.5) for this leg alone; outside
    // it the drone is shot down before finishing the three kr_watch posts.
    at(9, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(13, 20) }));
    at(22, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 11) }));

    at(0, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(18, 20) }));
    at(0, () => sim.queueCommand({ kind: 'move', ids: eitan, ...M(27, 16) }));
    at(12, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(20, 16) }));
    at(30, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(24, 22) }));
    at(30, () => sim.queueCommand({ kind: 'move', ids: eitan, ...M(24, 22) }));
  },
  {},
  'victory',
  'khan_rafid_1_recon',
  3
);

run('khan_rafid_2_foothold', () => {}, {}, 'defeat', 'khan_rafid_2_foothold (passive control)');

// KR II -- clear the ward with the hold force (rifles + one Eitan, both
// under the 0.3 structural-collateral threshold that arms `fire into
// protected structure (ward)`), while the Namer runs a family in from BOTH
// sides via the east lane corridor (x=33) rather than straight up the
// middle -- it never crosses the flagged rectangle, so its 0.35-collateral
// cannon_30 can only reach INTO the ward from outside it on a stray round,
// not fire from inside it. AT team and mortar stay south at the staging
// ground the whole mission: their collateral (0.3, 0.7) is exactly the kind
// this mission bills for, and neither is needed to clear six rifle-armed
// militia off a compound. Measured: VICTORY in 4.43 min, ROE 95 (one
// flagged-zone deduction survives: the Namer's cannon can still reach INTO
// the zone from its own corridor once a `ward_push` section is standing in
// it, which is the mechanic `khan_rafid_2_foothold.json`'s own `commit`
// trigger is built to force).
run(
  'khan_rafid_2_foothold',
  (sim, _rt, ids, at) => {
    const inf = ids('inf_squad');
    const eitan = ids('apc_eitan');
    const jeep = ids('jeep_shoded');
    const namer = ids('ifv_namer');
    const at_team = ids('at_team');
    const mortar = ids('mortar_team');
    const drone = ids('recon_drone');
    const holdForce = [...inf, ...eitan];

    at(0, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 20) }));
    at(0, () => sim.queueCommand({ kind: 'attackMove', ids: holdForce, ...M(24, 20) }));

    // Jeep: the close southern family, five tiles from the start line.
    at(0, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(23, 27) }));
    at(15, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(24, 22) }));

    // Namer: the eastern family via the east lane corridor, staying outside
    // the ward's flagged rectangle for the whole round trip.
    at(0, () => {
      sim.queueCommand({ kind: 'move', ids: namer, ...M(33, 25) });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(31, 16), append: true });
    });
    at(35, () => {
      sim.queueCommand({ kind: 'move', ids: namer, ...M(33, 25) });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(24, 22), append: true });
    });

    at(0, () => sim.queueCommand({ kind: 'move', ids: at_team, ...M(24, 36) }));
    at(0, () => sim.queueCommand({ kind: 'move', ids: mortar, ...M(22, 38) }));
  },
  {},
  'victory',
  'khan_rafid_2_foothold'
);

run('khan_rafid_3_clearance', () => {}, {}, 'defeat', 'khan_rafid_3_clearance (passive control)');

// KR III -- O-KR4's measurement gate. `structure_penalty_mult: 2` ships as
// authored (see the note below the ladder): this plan clears the souk with
// the vanguard (rifles + one Eitan + the Lavi + the sniper) walking straight
// at `souk_alley`, which enters the `souk` zone before it is in weapon range
// of either garrisoned shanty -- `zone_entered(souk)` fires the `commit`
// trigger first, and a `commit`/`withdraw_to` order calls `leaveStructure`
// on a garrisoned unit exactly as an explicit move does (sim.ts:1927), so
// the souk garrison is walking in the open by the time anyone is close
// enough to shoot at their buildings. The hall itself is never engaged --
// `roe_penalty` 30 keeps it off `selectStructureTarget` entirely -- and the
// store's secondary is skipped outright, since its warehouse garrison has no
// commit trigger of its own and any fight there is a structure paid for at
// mult 2 for a secondary nobody needs. Namer and the second Eitan run the
// three remaining families via the west/east-lane corridors, clear of both
// the souk and hall. Measured: VICTORY in 2.77 min, ROE 86 -- one Shanty (-4)
// from the Lavi's own splash during the souk fight, plus two flagged-zone
// deductions from fire reaching into the ward while `hall_party`'s ambush
// team is engaged near it. 86 >= 65, so O-KR4 keeps the dial as authored:
// `structure_penalty_mult: 2`, `fail_below: 50`. (Compare the naive plan
// below, which throws the same roster at the souk WITHOUT peeling off for
// the families until t=90s: ROE 70 -- still clear of the 65 gate and the 50
// floor -- but DEFEAT, because `get_six_in` misses its 300s deadline. The
// rising evacuation count, not the ROE floor, is what actually decides this
// mission for a player who does not split forces early.)
const khanRafid3Plan: Plan = (sim, _rt, ids, at) => {
  const inf = ids('inf_squad');
  const eitan = ids('apc_eitan');
  const jeep = ids('jeep_shoded');
  const namer = ids('ifv_namer');
  const lavi = ids('mbt_lavi');
  const sniper = ids('sniper_team');
  const at_team = ids('at_team');
  const mortar = ids('mortar_team');
  const drone = ids('recon_drone');
  const vanguard = [...inf, eitan[0], ...lavi, ...sniper];

  at(0, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 11) }));
  at(0, () => sim.queueCommand({ kind: 'attackMove', ids: vanguard, ...M(24, 11) }));

  // South family, close.
  at(0, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(30, 27) }));
  at(15, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(24, 22) }));

  // Namer sweeps both western families, well clear of the souk/hall fight.
  at(0, () => sim.queueCommand({ kind: 'move', ids: namer, ...M(20, 16) }));
  at(25, () => sim.queueCommand({ kind: 'move', ids: namer, ...M(16, 16) }));
  at(45, () => sim.queueCommand({ kind: 'move', ids: namer, ...M(24, 22) }));

  // Second Eitan grabs the eastern family via the east lane corridor.
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: [eitan[1]], ...M(33, 25) });
    sim.queueCommand({ kind: 'move', ids: [eitan[1]], ...M(31, 16), append: true });
  });
  at(35, () => {
    sim.queueCommand({ kind: 'move', ids: [eitan[1]], ...M(33, 25) });
    sim.queueCommand({ kind: 'move', ids: [eitan[1]], ...M(24, 22), append: true });
  });

  at(0, () => sim.queueCommand({ kind: 'move', ids: at_team, ...M(24, 36) }));
  at(0, () => sim.queueCommand({ kind: 'move', ids: mortar, ...M(22, 38) }));
};

run(
  'khan_rafid_3_clearance',
  khanRafid3Plan,
  {},
  'victory',
  'khan_rafid_3_clearance'
);

// F1 / ruling R2(b): gate-open probe -- breach_team (stars_min 12) reached via
// gateLedger({}, 6), proving the mission's fresh inf_squad placement resolves
// to breach_team once the gate is open. Same plan body as the run above.
run(
  'khan_rafid_3_clearance',
  khanRafid3Plan,
  gateLedger({}, 6),
  'victory',
  'khan_rafid_3_clearance (gate open)',
  2,
  'breach_team'
);

// Bought-gate probe (brigade economy step 2, spec 2026-09-15 §4.4): the same plan
// on a bare `{}` ledger -- no stars, no Conduct -- but with breach_team recorded as
// bought. `unlockOf`'s bought flag short-circuits `unlockReason` before either earned
// check runs, so `resolveUpgrades` fields breach_team here exactly as the gate-open
// probe above does with 6 stars. `label === id` keeps this out of both ladders.
run(
  'khan_rafid_3_clearance',
  khanRafid3Plan,
  {},
  'victory',
  'khan_rafid_3_clearance (bought)',
  2,
  'breach_team',
  new Set(['breach_team'])
);

// Price-only-closed probe (review finding, spec 2026-09-15 §4.4): guards the exact
// divergence this harness's own `kdfUnlockGate` used to have with `main.ts` -- it
// dropped `price` on the floor, so a gate with NO earned field and a price alone read
// as OPEN here (`unlockReason` treats a gate with nothing set as unlocked) while the
// app correctly read it LOCKED. `gateOf` hands `breach_team` a synthetic `{ price: 850
// }` gate -- price only, no stars, no Conduct, no `bought` -- bypassing the real
// unit-data mapping entirely so the assertion is about `resolveUpgrades` +
// `unlockReason`'s shared contract, not about today's `breach_team` JSON (which also
// carries `stars_min: 12` and would already read closed either way). Expect the
// placement to field the un-upgraded base body, `inf_squad` (`data/missions/
// khan_rafid_3_clearance.json`'s own `starting_force` entry), never `breach_team`.
run(
  'khan_rafid_3_clearance',
  khanRafid3Plan,
  {},
  'victory',
  'khan_rafid_3_clearance (price-only closed)',
  2,
  'inf_squad',
  new Set(),
  (unitId) => (unitId === 'breach_team' ? { price: 850 } : undefined)
);

// --- Marj: Deir Amun -------------------------------------------------------------

run('deir_amun_1_recon', () => {}, {}, 'defeat', 'deir_amun_1_recon (passive control)');

// DA I -- the escort and the lone Yahalom team go down the gully bed
// TOGETHER: soloing the engineers (see the naive plan below) leaves them to
// the militia guarding the mouth with nothing shooting back, and the team
// dies mid-approach with the route never charged. Escorted, the mouth's
// guards die to the escort's own weapons well before the charge starts.
// `find_the_crew` needs all three `da_diggers`-tagged units identified,
// including the one placed near the hamlet lane rather than at the mouth --
// the escort's own advance on (9,18) identifies the other two.
//
// The two carrying secondaries are both owed to the drone, and both are a
// STANDOFF problem, not a route problem: flying directly onto either target
// (the shipped plan's own shape) puts the drone inside a threat's weapon
// range for exactly as long as it takes to identify, and that dwell is what
// kills it -- the plain run reads `find_the_chief=a find_the_gap_gun=a`, the
// max-tier replay of the SAME orders reads `find_the_chief=c` on hp alone
// (150 vs 120), never the gap gun. Two threats, not one, sit on this route:
// `militia_cell` at (21,22) (`da_diggers`, weapon range/sight 7 tiles, both
// ground and air), and a SECOND ambush the shipped plan never accounted for
// -- two `militia_cell` sit `in_tunnel: "da_tn_lane"`, pre-dug, vent at
// (27,18), one tile from the digging chief's own spoil at (28,17)
// (data/maps/deir_amun.json's tunnels). A pre-dug vent starts OPEN
// (sim.ts:1408), and `stepSurfacing` springs it the instant anything
// friendly closes inside the militia's own EFFECTIVE range from the vent --
// 5.5 tiles, not the full 7 (`hasTargetFrom` gates on `effectiveRangeSq`,
// sim.ts:2858-2872) -- so approaching the chief at all wakes two rifles at
// point-blank range. The west gap gun itself costs nothing: `rpg_team`'s
// `rpg7` declares `can_target: ["ground"]` only
// (data/units/enemy/rpg_team.json), so it can spring on the drone
// (`checkAmbushSpring` reads raw proximity, not weapon compatibility) and
// never actually fire on it -- closing to identify it is free.
//
// The plan: identify the militia from (21,30), 8 tiles down the open column
// at x=21 (both `h` clusters that block the row sit at x=18-20 and x=22-24,
// never at the militia's own x=21) -- outside its 7-tile envelope, so the
// drone takes zero fire. Identify the chief from (28,25), 7.07 tiles from
// the vent -- outside the 5.5-tile spring range, so the vent stays shut.
// Then loop the vent's whole danger circle rather than cut back through it:
// east to (34,25) and (34,11) (a comfortable 7+ tiles off the vent the
// entire climb, past a warehouse block that sits further west), then west
// along the open row at y=11 to (18,11), closing on the gap gun directly --
// safe by the weapon fact above. Measured against the un-shifted escort:
// zero drone HP lost, all four `locate`/`collapse` targets identified.
//
// The escort/engineers/charge are the SAME orders the un-shifted plan used
// to complete `bring_down_the_west` -- shifted fifteen seconds later on
// their own clock, not restructured, because the drone's honest route needs
// the mission whole past the point the un-shifted timing ends it (~36s) and
// `chargeTunnel` issued while the squad is mid-approach (rather than at the
// same relative offset from ITS OWN start) drops the order entirely: tested
// by hand at +22s on the unshifted clock, the squad drifts off the route
// under fire from the militia group's own counter-commit and the charge
// never fires, reading DEFEAT on the 240s `bring_down_the_west` deadline.
// The shift reproduces the escort's own approach tick-for-tick, fifteen
// seconds later, and the charge lands exactly as it always did. Measured:
// VICTORY in 0.9 min, ROE 100, roster out 6 (up from 5 -- the drone finds
// both men and comes home, where the shipped plan spent it as the third
// star's price).
run(
  'deir_amun_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const yahalom = ids('yahalom_squad');
    const inf = ids('inf_squad');
    const at_team = ids('at_team');
    const eitan = ids('apc_eitan');
    const escort = [...inf, ...at_team, ...eitan];

    // Drone: militia standoff, then the chief's standoff, then loop the
    // vent's danger circle to close on the gap gun. See the comment above
    // for why each stop is placed exactly there.
    at(0, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 30) }));
    at(13, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(28, 25) }));
    at(27, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(34, 25) }));
    at(30, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(34, 11) }));
    at(37, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(18, 11) }));

    // Escort and engineers go down the gully bed together toward the west
    // route -- the un-shifted plan's own orders, fifteen seconds later.
    at(15, () => sim.queueCommand({ kind: 'attackMove', ids: escort, ...M(9, 18) }));
    at(15, () => sim.queueCommand({ kind: 'move', ids: yahalom, ...M(9, 18) }));
    at(45, () => sim.queueCommand({ kind: 'chargeTunnel', ids: yahalom, tunnel: 0 }));
  },
  {},
  'victory',
  'deir_amun_1_recon',
  3
);

run('deir_amun_2_foothold', () => {}, {}, 'defeat', 'deir_amun_2_foothold (passive control)');

// DA II -- both Yahalom teams charge `da_tn_pump` together the moment the
// hold force clears the yard's one gate, then pull straight back out: their
// job is done at t=34s and there is nothing to gain by leaving an
// irreplaceable engineer team parked in a compound a `charge_squad` is timed
// to reach (`timer_s(180)`). The holding force then SPLITS across two points
// a few tiles apart inside the yard -- one kamikaze hit (splash 1.6 tiles)
// catches whichever cluster it reaches, not both -- and the mortar stays
// well back at the staging ground the whole mission, off the flagged
// `hamlet` rectangle and out of splash range of the drone. This is the
// `economy` mission: `requestBuild('inf_squad')` fires on a schedule from
// t=60s once the camp is up, spending logistics on replacements rather than
// banking them. Measured: VICTORY in 4.75 min, ROE 70 (five flagged-zone
// deductions over eight minutes of contact -- comfortably clear of the 40
// floor, but the highest cost of any plan in the arc, matching the design's
// own read that this is the arc's most attrition-heavy foothold).
const deirAmun2Plan: Plan = (sim, rt, ids, at) => {
  const yahalom = ids('yahalom_squad');
  const inf = ids('inf_squad');
  const at_team = ids('at_team');
  const mortar = ids('mortar_team');
  const eitan = ids('apc_eitan');
  const namer = ids('ifv_namer');
  const drone = ids('recon_drone');

  const holdForce = [...inf, ...eitan, ...namer];
  at(0, () => sim.queueCommand({ kind: 'attackMove', ids: holdForce, ...M(15, 27) }));
  at(0, () => sim.queueCommand({ kind: 'move', ids: yahalom, ...M(16, 26) }));
  at(25, () => sim.queueCommand({ kind: 'chargeTunnel', ids: yahalom, tunnel: 1 }));
  at(40, () => sim.queueCommand({ kind: 'move', ids: yahalom, ...M(24, 40) }));

  // Once the door is down, split the holding force: two at the gate, the
  // rest at the interior, so one kamikaze cannot reach everyone at once.
  at(45, () => {
    sim.queueCommand({ kind: 'move', ids: [inf[0], eitan[0]], ...M(15, 28) });
    sim.queueCommand({ kind: 'move', ids: [inf[1], inf[2], eitan[1], ...namer], ...M(16, 25) });
  });

  at(0, () => sim.queueCommand({ kind: 'move', ids: at_team, ...M(17, 27) }));
  at(0, () => sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 40) }));
  at(0, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(15, 27) }));

  // Spend logistics as it lands, once the camp is producing.
  for (let when = 60; when <= 420; when += 40) {
    at(when, () => void rt.requestBuild('inf_squad'));
  }
};

run(
  'deir_amun_2_foothold',
  deirAmun2Plan,
  {},
  'victory',
  'deir_amun_2_foothold'
);

// F1 / ruling R2(b): gate-open probe -- breach_team (stars_min 12) reached via
// gateLedger({}, 6), proving the mission's fresh inf_squad placement resolves
// to breach_team once the gate is open. Same plan body as the run above.
run(
  'deir_amun_2_foothold',
  deirAmun2Plan,
  gateLedger({}, 6),
  'victory',
  'deir_amun_2_foothold (gate open)',
  2,
  'breach_team'
);

run('deir_amun_3_subterranean', () => {}, {}, 'defeat', 'deir_amun_3_subterranean (passive control)');

// DA III -- the sequencing problem the design is built on. Each Yahalom team
// takes two of the four routes, charging from the MOUTH rather than the
// vent -- every one of the four is stocked, but its occupants surface at the
// far VENT, tiles away, so a charge worked from the mouth side never wakes
// them (the same trick beit_sahwan_4_subterranean's plan uses). The tell:
// the west team's own two-route schedule (t=20 charge, t=35 retask, t=50
// charge) works for both its routes, but the identical schedule on the east
// team loses `da_tn_north`'s charge outright -- a `move`/`attackMove` order
// clears `chargeOrder` (sim.ts), so retasking the team to its second mouth
// before the first charge actually finishes cancels it silently, and
// `da_tn_north` never comes down. East's schedule below is stretched to
// t=60/75 for exactly this reason, confirmed by the `tunnelCollapsed`
// trace: all four routes down by t=87s. The heavy force (Namer, Lavi, AT
// team) takes the spoil field directly, since the chief never leaves it.
// Measured: VICTORY in 1.45 min, ROE 85.
run(
  'deir_amun_3_subterranean',
  (sim, _rt, ids, at) => {
    const yahalom = ids('yahalom_squad');
    const inf = ids('inf_squad');
    const at_team = ids('at_team');
    const mortar = ids('mortar_team');
    const eitan = ids('apc_eitan');
    const namer = ids('ifv_namer');
    const lavi = ids('mbt_lavi');
    const drone = ids('recon_drone');

    const west = [yahalom[0]];
    const east = [yahalom[1]];
    const westEscort = [inf[0], inf[1], eitan[0]];
    const eastEscort = [inf[2], inf[3], eitan[1]];
    const chiefForce = [...namer, ...lavi, ...at_team];

    // West pair: da_tn_lane (mouth [20,23] = route 2), then da_tn_yard
    // (mouth [25,26] = route 3).
    at(0, () => sim.queueCommand({ kind: 'attackMove', ids: westEscort, ...M(20, 23) }));
    at(0, () => sim.queueCommand({ kind: 'move', ids: west, ...M(20, 23) }));
    at(20, () => sim.queueCommand({ kind: 'chargeTunnel', ids: west, tunnel: 2 }));
    at(35, () => sim.queueCommand({ kind: 'attackMove', ids: westEscort, ...M(25, 26) }));
    at(35, () => sim.queueCommand({ kind: 'move', ids: west, ...M(25, 26) }));
    at(50, () => sim.queueCommand({ kind: 'chargeTunnel', ids: west, tunnel: 3 }));

    // East pair: da_tn_north (mouth [30,22] = route 4), then da_tn_east
    // (mouth [33,25] = route 5) -- held later than the west pair's schedule
    // on purpose; see the comment above.
    at(0, () => sim.queueCommand({ kind: 'attackMove', ids: eastEscort, ...M(30, 22) }));
    at(0, () => sim.queueCommand({ kind: 'move', ids: east, ...M(30, 22) }));
    at(20, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 4 }));
    at(60, () => sim.queueCommand({ kind: 'attackMove', ids: eastEscort, ...M(33, 25) }));
    at(60, () => sim.queueCommand({ kind: 'move', ids: east, ...M(33, 25) }));
    at(75, () => sim.queueCommand({ kind: 'chargeTunnel', ids: east, tunnel: 5 }));

    // Heavy force takes the spoil field and kills the chief.
    at(0, () => sim.queueCommand({ kind: 'attackMove', ids: chiefForce, ...M(28, 17) }));

    at(0, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(28, 17) }));
    at(0, () => sim.queueCommand({ kind: 'move', ids: mortar, ...M(22, 40) }));
  },
  {},
  'victory',
  'deir_amun_3_subterranean'
);

// --- Sur: Tel Marum -----------------------------------------------------------

// Tel Marum I — the picture, taken from dead ground.
//
// Round 1 shipped `picture` as an untargeted `locate` (count N of ANY
// identified hostile). That was the actual bug: it let the pursuit waves
// below feed the same objective they were meant to punish passivity for
// dodging, so a heavy wave produced a free VICTORY for a player who gave no
// orders, and a light one produced a stalemate no wave volume could break.
// The primary is now four separately TARGETED `locate`s -- one per named
// garrison tag (tm_pocket_east, tm_pocket_west, tm_spotter_west,
// tm_hvt_battery) -- exactly the shape `beit_sahwan_1_recon`'s `hvt_seen`
// already ships. A wave unit carries no such tag, so it is structurally
// unable to complete any of the four; only genuine recon of the wall and
// the battery can.
//
// The approach at (24,25) still gives three of the four for free (sight 16
// reaches both ATGM pockets and the spotter from there, ~9-10 tiles out).
// `find_battery` costs the sweep: the battery sits 18.6 tiles from the
// approach, past sight 16, and the straight route north runs through the
// wide pass at x=22-26 -- exactly what tm_picket_wide (sarim_rifles, weapon
// range 8) is posted to cover, which is what killed the drone at 44.5s in
// an earlier attempt that went straight up the middle. The shipped route
// goes around instead: south and west off the wall's engagement envelope
// entirely, up the narrow saddle at x=11 (nothing in this garrison reaches
// that column), then east to a standoff point that sees the battery at
// range 10.6 -- outside both rifle squads' weapon range and sight the whole
// way, checked leg by leg, not just at the endpoints.
//
// Control: a player who gives no orders never moves the drone, so none of
// the four primaries can complete on their own -- and now, unlike round 1,
// nothing a wave carries can complete them either (a wave unit has no
// tm_pocket_east/tm_pocket_west/tm_spotter_west/tm_hvt_battery tag, so it is
// structurally unable to satisfy a targeted `locate`). That closes the
// round-1 exploit: this control cannot WIN, which is a real assertion --
// round 1's untargeted `picture` could be won by a passive player for free.
//
// It used to be that this control could not LOSE either, on the reasoning
// that wiping the starting force takes more wave volume than a "bring back
// the picture, not casualties" recon should carry -- see git history for
// the retired bounded-fallback measurement (6-vs-7-wave wipe thresholds).
// That reasoning no longer applies: per
// `docs/campaign/tel_marum/script-losable.md` (design decision O-C), this
// mission now carries `clear_the_valley_floor`, an `evacuate_before`
// primary with its own 300s deadline (herders placed on the valley floor,
// at [21,24]), so a passive player loses on that clock regardless of wave
// volume -- `checkEnd` fails the mission the instant the count never
// reaches 2 by t=300s. Measured (this session): DEFEAT at 5.00 min. See
// that document's §1/§2 for the new primary's shape and the shipped plan's
// unchanged victory.
run('tel_marum_1_recon', () => {}, {}, 'defeat', 'tel_marum_1_recon (passive control)');

run(
  'tel_marum_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const screen = ids('apc_eitan');
    const foot = ids('inf_squad');
    at(4, () => {
      // Screen forward to the hollow and stop there — out of the envelope.
      sim.queueCommand({ kind: 'move', ids: screen, ...M(24, 30) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 31) });
      // The drone alone goes into the envelope. From the approach alone,
      // sight 16 already reaches both ATGM pockets and the spotter (all
      // three complete by ~t=16s, well before the next order below fires).
      sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 25) });
    });
    // find_battery is the one the approach cannot give for free: the battery
    // sits 18.6 tiles out from there, past sight 16. The straight route north
    // runs through the wide pass at x=22-26, which is exactly what
    // tm_picket_wide (sarim_rifles, weapon range 8) is posted to cover --
    // closing on it is what killed the drone at 44.5s in the round-2 replay.
    // So the drone goes around: south and west off the wall's engagement
    // envelope entirely, up the UNGUARDED narrow saddle at x=11 (nothing in
    // this garrison can reach that column), then east to a standoff point
    // north of the wall that sees the battery at range 10.6 -- outside both
    // rifle squads' weapon range (8) and sight (9) throughout, by margins of
    // 1-7.5 tiles at every leg (checked against both tm_picket_wide and
    // tm_spotter_west along the full path, not just the endpoints).
    at(20, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(16, 27) }));
    at(28, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(11, 22) }));
    at(35, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(11, 12) }));
    at(44, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(15, 8) }));
  },
  {},
  'victory',
  'tel_marum_1_recon'
);

// Tel Marum II — the start line, and the man who calls the fire.
//
// The approach is 35 tiles. The design doc's 18-of-35 figure came from the
// doctrine test's 48-sight OBSERVER, walking terrain, not from the garrison
// unit actually posted there: `tm_spotter_west` is sarim_rifles, sight 9. At
// that sight the real count is smaller, roughly 15 — approximate, not
// re-measured through the real Sim here. The plan takes the southern edge of
// the zone, which counts for the hold and is the cheapest ground in it, then
// sends infantry up the west side of the bay to kill the observer. Killing
// him removes one contact feeding the battery, but `sim.ts:2073` identifies
// per side, not per unit — other garrison Sarim can still hand the Grad eyes
// on the zone, so the hold is not proven uncontested by this kill alone (see
// mission II's own briefing, which already carries this caveat).
//
// Control: a player who gives no orders never enters the approach, so
// hold_for never starts and kill_spotter never fires, and `hold_for`/
// `eliminate_hvt` are still not among the three objective types `checkEnd`
// can ever fail on their own (only `raze`, `collapse`, both seconds-gated,
// and `evacuate_before` -- mission.ts:1361/1372/1423). But per
// `docs/campaign/tel_marum/script-losable.md` (design decision O-C), this
// mission now also carries `burn_the_ammo_point`, a `raze` primary with its
// own 300s deadline against a mission-raised `shanty` in the new
// `ammo_draw` zone -- a passive player never orders a demolition (the
// structure cannot be destroyed by ordinary weapon fire; see that
// document's Mission II write-up), so it stands at 300s and the primary
// fails. `checkEnd` returns DEFEAT on that clock regardless of the
// hold/HVT pair. Measured (this session): DEFEAT at 5.00 min.
run('tel_marum_2_foothold', () => {}, {}, 'defeat', 'tel_marum_2_foothold (passive control)');

run(
  'tel_marum_2_foothold',
  (sim, _rt, ids, at) => {
    const armour = ids('apc_eitan');
    const tank = ids('mbt_lavi');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    const demo = ids('demo_squad');
    // `at(3)` moved to `at(1)` -- map-variants-design.md §3.1's `tel_marum_2`
    // write-up: the ditch/crossing terrain costs the vehicle route at most
    // 1 tile (measured: start_line -> approach still 20, -> hollow 15 -> 16),
    // and this mission runs 0.87 of target with only 1.1 minutes above its
    // 240s floor -- no reason to spend that margin on travel.
    at(1, () => {
      // Into the southern edge of the approach zone — inside it for the hold,
      // furthest from the battery.
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 26) });
      sim.queueCommand({ kind: 'move', ids: tank, ...M(26, 26) });
      sim.queueCommand({ kind: 'move', ids: at_, ...M(25, 26) });
      // Mortar stays in the hollow: 18 tiles of reach covers the bay lip from
      // ground the Grad cannot touch.
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 29) });
      // The demo squad moves on the ammo cache in the draw. Within 2 tiles
      // of the shanty's footprint it self-targets and burns it with no
      // explicit `demolish` order needed (`stepDemolition`'s automatic
      // branch, sim.ts:4335) -- script-losable.md §1/§2.
      sim.queueCommand({ kind: 'move', ids: demo, ...M(23, 28) });
    });
    at(20, () => {
      // Infantry up the west side toward the pocket.
      sim.queueCommand({ kind: 'move', ids: foot, ...M(20, 22) });
    });
    at(70, () => {
      sim.queueCommand({ kind: 'move', ids: foot, ...M(20, 17) });
    });
    at(110, () => {
      sim.queueCommand({ kind: 'attackMove', ids: foot, ...M(20, 16) });
    });
  },
  {},
  'victory',
  'tel_marum_2_foothold'
);

// Tel Marum III — the pass, taken the expensive way on purpose.
//
// The plan takes the WIDE saddle. That is the costly route and it is chosen
// deliberately: the narrow saddle is nine tiles longer, and while the Grad
// reaches it at 17 tiles, measurement showed the observer at [12,4] does not
// change that price -- narrow-with-spotter-alive (5.2 min) and
// narrow-with-spotter-dead (5.1 min) are the same run (see the Tel Marum
// saddle bullet in CLAUDE.md). The narrow route's real cost is
// force-splitting, not this observer. A scripted proof should demonstrate
// the mission is winnable by the obvious line, not by the clever one.
//
// Mortars kill the west pocket's observer from the hollow first, because every
// tile of the wide saddle is inside the Grad's reach and being seen there is
// what makes it lethal rather than merely defended.
//
// Control: primaries `capture` (take_pass) and `eliminate_hvt`
// (kill_battery) are still not among the three objective types `checkEnd`
// can ever fail on their own (only `raze`, `collapse`, both seconds-gated,
// and `evacuate_before` -- mission.ts:1361/1372/1423). But per
// `docs/campaign/tel_marum/script-losable.md` (design decision O-C), this
// mission now also carries `get_the_block_out`, an `evacuate_before`
// primary reusing the `approach` zone/marker with its own 300s deadline
// (three families placed east of `town_block` at [27.5,5.5]) -- a passive
// player never shepherds them, so the count never reaches 2 by t=300s and
// `checkEnd` returns DEFEAT on that clock regardless of the pass/HVT pair.
// Measured (this session): DEFEAT at 5.00 min.
run('tel_marum_3_clearance', () => {}, {}, 'defeat', 'tel_marum_3_clearance (passive control)');

// Captured (not part of the shipped Tel Marum patch) so Umm Zeitoun -- the
// next town in the same region -- can thread the ledger the way the app
// actually does: one persistent campaign ledger, not a per-mission `{}`. Only
// the `run` call's return value changes here; the plan, its ledgerIn (`{}`),
// and its expectation are byte-identical to the shipped Tel Marum III patch.
const ledTelMarum3 = run(
  'tel_marum_3_clearance',
  (sim, _rt, ids, at) => {
    const tanks = ids('mbt_lavi');
    const namer = ids('ifv_namer');
    const armour = ids('apc_eitan');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    at(3, () => {
      // Mortar into the hollow — 18 tiles of reach onto the wall, out of the
      // Grad's 20-tile circle at 23.
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(24, 29) });
      sim.queueCommand({ kind: 'move', ids: at_, ...M(25, 28) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 27) });
    });
    at(30, () => {
      // Kill the west observer before anything crosses the approach.
      sim.queueCommand({ kind: 'attackMove', ids: mortar, ...M(20, 16) });
    });
    at(85, () => {
      // Armour forward through the approach to the wide saddle mouth.
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 22) });
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(25, 22) });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(24, 23) });
    });
    // Split into east/west arms -- map-variants-design.md §3.1's
    // `tel_marum_3` write-up: the crater belt (rows 20-21) now gates the
    // approach to x<=19 (west) and x>=29 (east), so a single attackMove to
    // each of [28,16]/[20,16] would have both arms converge on the SAME gate
    // before diverging, arriving as a column instead of abreast. Waypoint
    // each arm through its own gate first, then the attackMove target
    // `append`ed onto the same order -- queued behind the first leg
    // (`sim.ts`'s "appending to a unit already under way queues the point
    // instead of overriding it"), not timed by guesswork the way a second
    // `at()` call would be. A guessed 15s gap here (tried first) delayed the
    // advance enough to fail `get_the_block_out`'s 300s evacuation clock --
    // the append fast-path costs no extra wall-clock at all, since both
    // commands land in the same tick's queue and the second only ever
    // widens the unit's own path.
    at(130, () => {
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(30, 20) });
      sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(28, 16), append: true });
      sim.queueCommand({ kind: 'move', ids: namer, ...M(18, 20) });
      sim.queueCommand({ kind: 'attackMove', ids: namer, ...M(20, 16), append: true });
    });
    at(190, () => {
      sim.queueCommand({ kind: 'move', ids: tanks, ...M(24, 13) });
      sim.queueCommand({ kind: 'move', ids: armour, ...M(24, 14) });
      sim.queueCommand({ kind: 'move', ids: foot, ...M(24, 15) });
    });
    at(240, () => {
      // Into the pass zone, then the battery beyond it.
      sim.queueCommand({ kind: 'move', ids: foot, ...M(24, 12) });
      sim.queueCommand({ kind: 'move', ids: armour, ...M(23, 12) });
      sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(25, 6) });
    });
  },
  {},
  'victory',
  'tel_marum_3_clearance'
);

// --- Sur: Qarn Hadid -----------------------------------------------------------

// Qarn Hadid I -- Both Gates: one drone sortie finds both watch posts while
// the jeep and the Eitan run the two-vehicle round trip east for the road
// party.
//
// The drone's own flow-field routing prefers the low saddle for ANY
// northbound order -- the shoulder's five-level climb costs more than the
// loop around, the same terrain fact this map's doctrine test pins for foot
// -- so a waypoint straight up the saddle at [30,17] walks the drone directly
// under the picket patrolling [30,16]-[30,22] and gets it shot down before it
// ever sees a post. Sending it up the WEST side instead reaches [14,6] --
// 11+ tiles from both `qh_watch_shoulder` and the ditch gun, outside their
// own sight -- then a second waypoint at [28,4] sees the notch post from just
// as far. Both gate posts complete inside 76 seconds and the drone never
// takes a hit.
//
// The road party's own reach is the whole clock, exactly as the briefing
// says: the jeep and the Eitan each carry two, and once either is inside
// CivilianFlight's four-tile shepherd radius the families board and ride
// home -- well inside the 240-second deadline.
//
// Control: a passive force at [24,42] is seen by nothing (design.md's own
// measured fact: nothing in the scree sees `kdf_start` at sight 8, 9 or 12),
// so the tube never gets a target, nobody boards, and `get_the_road_party_
// clear` -- the only failable primary -- fails on the clock at 240s.
// `checkEnd` returns DEFEAT. The three `locate` primaries also stay
// incomplete on a passive run, but the evacuation clock is what ends it.
run('qarn_hadid_1_recon', () => {}, {}, 'defeat', 'qarn_hadid_1_recon (passive control)');

const ledQH1 = run(
  'qarn_hadid_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const jeep = ids('jeep_shoded');
    const eitan = ids('apc_eitan');
    at(1, () => {
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(34, 31) });
      sim.queueCommand({ kind: 'move', ids: eitan, ...M(36, 32) });
      sim.queueCommand({ kind: 'move', ids: drone, ...M(14, 6) });
    });
    at(20, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(28, 4) }));
    at(45, () => {
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(24, 39) });
      sim.queueCommand({ kind: 'move', ids: eitan, ...M(24, 39) });
    });
  },
  ledTelMarum3,
  'victory',
  'qarn_hadid_1_recon',
  3
);

// Qarn Hadid II -- The Shoulder: the demolition and the hold, kept off each
// other's feet.
//
// `demolish`'s own goal-snap is the trap here. The revetment's centroid
// ring-searches outward for the nearest open tile, and finds one on EITHER
// face at the same Chebyshev distance -- but the scan is row-major and the
// north face (still sealed, on the far side of the wall) is checked before
// the south one, so an explicit `demolish` order routes the whole way around
// by the saddle to reach a tile it could have reached in five. Two fixes,
// both needed: approach on a plain `move` to an OPEN tile immediately south
// of the structure ([20,20]) rather than `demolish`'s own snap, so the flow
// field takes the short way instead of the long one; and hold that unit at
// the start line until the escort has had time to clear the two defenders
// who can see that tile (the garrisoned rifleman and the west ATGM cell -- a
// waypoint sent any sooner still sits inside the Kornet's ten-tile reach and
// dies waiting there). Once it moves, `stepDemolition`'s automatic search
// does the rest: no explicit `demolish` order needed once it is standing
// within two tiles of an unoccupied, unprotected structure.
//
// The armour never crosses the gate at all -- the revetment seals both
// domains until it falls -- so it parks at [20,20] and fights from there,
// which the revetment's own sight-block (same as a building's) keeps safe:
// nothing north of the wall can see a unit stalled one row south of it. Note
// `attackMove`'s chase is the wrong order for that park: a unit follows a
// broken contact clean across the map (the relocating west garrison, chased
// far enough, once dragged this same escort onto the fleeing battery's own
// square), so the hold is a plain `move`.
//
// The infantry crosses low and alone, into the hollow -- the tube's now-empty
// floor, `take_the_hollow` -- rather than the notch: a bonus 15s capture and
// an HVT this plan does not need the notch fight to reach.
//
// Control: the revetment stands untouched by anything a passive force does
// (raze needs an explicit demolish or a hostile occupant taking fire, neither
// of which a stationary force provides), so `open_the_shoulder` -- the only
// failable primary -- fails on the clock at 300s. `checkEnd` returns DEFEAT.
// `hold_the_gates` never starts on a passive run either (`livingIn` needs a
// player unit physically present), but the raze deadline ends it first.
run('qarn_hadid_2_foothold', () => {}, {}, 'defeat', 'qarn_hadid_2_foothold (passive control)');

const ledQH2 = run(
  'qarn_hadid_2_foothold',
  (sim, _rt, ids, at) => {
    const tank = ids('mbt_lavi');
    const namer = ids('ifv_namer');
    const armour = ids('apc_eitan');
    const foot = ids('inf_squad');
    const at_ = ids('at_team');
    const mortar = ids('mortar_team');
    const demo = ids('demo_squad');
    const drone = ids('recon_drone');
    at(1, () => {
      sim.queueCommand({ kind: 'move', ids: [...tank, ...namer, ...armour], ...M(20, 20) });
      sim.queueCommand({ kind: 'attackMove', ids: [...foot, ...at_], ...M(38, 38) });
      sim.queueCommand({ kind: 'move', ids: mortar, ...M(26, 30) });
      sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 30) });
    });
    at(100, () => sim.queueCommand({ kind: 'move', ids: demo, ...M(20, 20) }));
  },
  ledQH1,
  'victory',
  'qarn_hadid_2_foothold'
);

// QH2 does not declare `intel.marked_positions` in its own `produces`, so its
// own `run()` return has already dropped it -- merge back to QH1's output,
// the same shape as Beit Sahwan's `led4In` and Umm Zeitoun's `ledUZ2In`.
const ledQH2In = { ...ledQH1, ...ledQH2 };

// Qarn Hadid III -- The Village Road: one armour road, a dedicated rescue
// detail, and the knoll taken before the road is watched.
//
// The two civilian groups sit INSIDE the village a combined-arms push has to
// clear anyway, and CivilianFlight boards the nearest player unit with a
// free slot -- so if a vehicle happens to be adjacent when suppression or
// proximity triggers the flee, the family rides wherever THAT vehicle is
// actually going, which on an `attackMove` chasing a live contact is not
// necessarily the clinic. A dedicated two-body detail (no transport, so no
// boarding, just a walk) sent straight at the larger family group settles
// that before the main column ever gets close: three families are moving on
// their own by the time anything else arrives.
//
// That detail used to walk to [29,3] -- almost on top of the `sarim_rifles`
// garrisoned two tiles away at [27,3] -- to get within shepherd range of the
// family. At base stats both bodies (one `inf_squad`, one `at_team`, neither
// escorted or supported) survived that exposure; at `at_team`'s sensors tier
// 1 alone (sight 9->10, optics 1.1->1.19 -- again a purely beneficial bump)
// the detection-timing shift was enough that the SAME rifleman killed both
// in turn (t=46.6, t=64.5) before either ever got close to the family, and
// `get_the_families_clear` then had nothing left to trigger the flee and
// failed on the 300s clock. Measured: holds at 0 tiers, flips at tier 1
// (`docs/campaign/economy/upgrades.md` §7.6 bisection). The fix does not
// try to keep the detail alive against that rifleman -- it removes the
// firefight from the family's critical path entirely: the detail now walks
// to [21,2], directly beside the LARGER family group and away from both
// garrisoned buildings' engagement, so the flee latches (CivilianFlight's
// `fledSet` is permanent once set) within the first third of the walk,
// before anything can reach the detail at all. What happens to the detail
// afterward -- at base stats and at every KDF unit's max tier alike, both
// bodies are eventually killed by other village pickets converging from
// several directions -- no longer matters: the family is already walking to
// the clinic on its own. Measured: VICTORY in 2.8 min, ROE 77 (was 3.7 min,
// ROE 80 -- a different route trips different collateral, hence the credits
// line moving), unchanged at all 17 KDF types' max tier (VICTORY, 2 stars,
// `docs/campaign/economy/upgrades.md` §7.6).
//
// One soldier alone climbs the terraces first -- the mast party will not
// fire until it is entered -- so the relay dies to a small force rather than
// costing the main column a detour, and the west ditch crossing under the
// terraces is unwatched by the time the armour needs it.
//
// `inf_squad` is `from_ledger`, so this plan never hard-indexes it: the
// terrace climber, the rescue detail and the main column are `slice`s of
// whatever survived Qarn Hadid II, the same shape Umm Zeitoun III uses for
// the same reason.
//
// Control: a passive force never comes within four tiles of either family
// group, so `get_the_families_clear` -- the only failable primary -- fails
// on the clock at 300s. `checkEnd` returns DEFEAT. `take_the_village` and
// `kill_the_relay` also stay incomplete, but the evacuation clock ends it.
run('qarn_hadid_3_clearance', () => {}, {}, 'defeat', 'qarn_hadid_3_clearance (passive control)');

const qarnHadid3Plan: Plan = (sim, _rt, ids, at) => {
  const tank = ids('mbt_lavi');
  const namer = ids('ifv_namer');
  const armour = ids('apc_eitan');
  const foot = ids('inf_squad');
  const at_ = ids('at_team');
  const mortar = ids('mortar_team');
  const demo = ids('demo_squad');
  const sniper = ids('sniper_team');
  const drone = ids('recon_drone');
  const west = foot.slice(0, 1);
  const civTeam = [...foot.slice(1, 2), ...at_];
  const main = [...tank, ...namer, ...armour, ...foot.slice(2), ...demo, ...mortar, ...sniper];
  at(1, () => {
    sim.queueCommand({ kind: 'attackMove', ids: west, ...M(10, 9) });
    sim.queueCommand({ kind: 'move', ids: civTeam, ...M(21, 2) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(24, 30) });
  });
  at(60, () => sim.queueCommand({ kind: 'attackMove', ids: main, ...M(20, 9) }));
  at(160, () => sim.queueCommand({ kind: 'attackMove', ids: main, ...M(28, 5) }));
};

run(
  'qarn_hadid_3_clearance',
  qarnHadid3Plan,
  ledQH2In,
  'victory',
  'qarn_hadid_3_clearance'
);

// F1 / ruling R2(b): gate-open probe -- scout_shachaf (stars_min 30) reached via
// gateLedger(ledQH2In, 15), proving the mission's fresh jeep_shoded placement
// resolves to scout_shachaf once the gate is open. Same plan body as the run above.
run(
  'qarn_hadid_3_clearance',
  qarnHadid3Plan,
  gateLedger(ledQH2In, 15),
  'victory',
  'qarn_hadid_3_clearance (gate open)',
  2,
  'scout_shachaf'
);

// --- Sur: Umm Zeitoun ---------------------------------------------------------

// Umm Zeitoun I -- Cold Ground: the drone builds the picture, the jeep buys
// the wadi its two families.
//
// Control: no order ever brings a player unit within CivilianFlight's 4-tile
// shepherd radius of the wells, so nobody flees, the count never reaches 2,
// and `get_the_wells_clear` -- the mission's only evacuate_before -- fails at
// the 240s deadline. `checkEnd` returns DEFEAT on the failed primary. None of
// the four `locate`s can complete on a passive run either (the nearest is 9+
// tiles from a sight-8 rifle squad sitting at the start line), but the
// evacuation is what actually ends the mission.
run('umm_zeitoun_1_recon', () => {}, {}, 'defeat', 'umm_zeitoun_1_recon (no orders)');

// Falsified against the design draft's own station point (24,30): that tile
// is 3.5 from `uz_eye_knoll`, and `sarim_rifles`' `rifles` weapon carries
// `can_target: ["ground","air"]` -- not a MANPAD-only threat as the design
// prose implies. A scratch trace (this session) shows the knoll garrison
// killing the drone there at t=8.15s, decades before west/east ever reach
// IDENTIFIED_AT (0.70) at 15 tiles. Every waypoint below is instead a
// *stand-off* measured at >8.5 tiles from all three `sarim_rifles` posts
// (their weapon range) -- outside rifle range, detection alone still climbs
// to identified in ~20s at that distance, confirmed against the real
// `Sim.contact` ladder. The route also detours through the map's south
// corridor and up its western edge specifically to stay outside both
// MANPADs' 13-tile envelope while transiting -- a direct cross-basin line
// clips `manpad_basin` and gets the drone killed before it ever turns north.
const ledUZ1 = run(
  'umm_zeitoun_1_recon',
  (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const jeep = ids('jeep_shoded');
    at(2, () => {
      // West stand-off, 8.6 tiles from `uz_eye_west` -- outside its rifle's
      // 8-tile reach. The knoll is banked for free during the transit itself
      // (it sits close enough to the direct path that a few seconds of
      // passing sight is already enough).
      sim.queueCommand({ kind: 'move', ids: drone, ...M(15.5, 30.5) });
      // The jeep runs straight to the wells: within 4 tiles of all three
      // families, which is all CivilianFlight needs to start them fleeing
      // and boarding the jeep's two free seats.
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(15, 35) });
    });
    at(12, () => {
      // Two families are aboard by now; drive them into the wadi. The third
      // stays at the wells -- "nothing else out there is worth the jeep."
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(23, 37) });
    });
    // Loop south of the knoll's own 8.5-tile bubble, then east along the
    // bottom of the basin, to the east stand-off -- 8.5 tiles from
    // `uz_eye_east` and, measured, outside both MANPADs' envelopes the
    // whole way there.
    at(30, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30, 42) }));
    at(45, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(40.5, 31.5) }));
    // `find_the_missile_team` is the one target this route never crosses --
    // its own briefing line says the drone gets one look at that envelope,
    // and every other waypoint above is built to stay outside it. Measured
    // with a two-body sim (this session, `manpad_team` isolated against
    // `recon_drone`): from due south at (30.5,29.5) -- 7.0 tiles, well inside
    // `uz_manpad_basin`'s 13-tile reach and its 12-tile sight alike -- OUR
    // side reaches IDENTIFIED_AT at 3.7s (`optics 2.0 x signature 0.4` beats
    // the reverse pairing, `optics 1.2 x signature 0.3`, which does not cross
    // it until 8.2s against a STATIONARY target), so a body that turns south
    // six seconds after arriving is already reading the post while the
    // manpad's own contact is still short of a firing solution. Measured
    // full-plan, not just isolated: a longer hold (dwelling past 8.2s, or
    // retreating slowly enough that `MOTION_SIG` -- movement raises a unit's
    // own signature 1.5x -- hands the manpad the rest of the way there) gets
    // the drone killed at ~25-30s instead, which is the design's own "for its
    // life" reading and not this leg's. This is the one waypoint of the
    // route that trades the standoff discipline above for the one crossing
    // the mission's own briefing promises.
    at(70, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30.5, 29.5) }));
    at(76, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(30, 42) }));
    // Only the crest is left. Loop back through the same southern corridor
    // and up the far-western column, which measures outside `manpad_north`'s
    // 13-tile envelope for its entire length -- the reverse of the design
    // draft's own approach (straight through the envelope, at a station 4-9
    // tiles from it), which is what cost the drone its life in every earlier
    // attempt this session. The overlook at (4,6) sees the crest at ~11 tiles
    // and sits ~18 tiles from `manpad_north` -- safe rather than sacrificial,
    // and identification is permanent once banked either way.
    //
    // The column itself is x~3, not x~5: `uz_eye_west`'s own rifle
    // (`sarim_rifles`, range 8, `can_target: ["ground","air"]`, rof_per_min
    // 320) sits at [10.5,23.5], and a two-body measurement (this session)
    // found (5,25) -- 5.7 tiles, the manpad detour's old return column --
    // kills a STATIONARY drone at 10.75s where (3,25), 7.65 tiles, buys
    // 19.55s. The whole detour above delays this leg's own arrival past
    // where the shipped route used to reach it, so the extra margin is what
    // keeps this waypoint honest rather than merely lucky on the clock.
    at(110, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(10, 40) }));
    at(125, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(3, 25) }));
    at(133, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(4, 6) }));
  },
  ledTelMarum3,
  'victory',
  'umm_zeitoun_1_recon',
  3
);

// Umm Zeitoun II -- The Long Look: hold the crest line while a demolition
// party levels the post above the knoll.
//
// Control: a passive player never occupies `crest_line`, so `hold_for` never
// starts accumulating (it cannot itself fail); nobody fires on the shed or
// orders a demolition, so `level_the_stone_post` -- the mission's only
// failable primary -- reaches `failed` at the 300s deadline. `checkEnd`
// returns DEFEAT. The force is never wiped: Sarim doctrine here is standoff
// and nothing in the light 90s/180s/210s/300s cadence closes on the empty
// start line on its own.
run('umm_zeitoun_2_buildup', () => {}, {}, 'defeat', 'umm_zeitoun_2_buildup (no orders)');

// The whole force clears the knoll TOGETHER before anything splits off to
// hold. A first version sent the demo squad in with only two rifle squads as
// escort while the rest dug in on the crest line immediately -- it survived,
// but the two escorting `inf_squad` did not, and UZ III's own `from_ledger`
// draw for `inf_squad` (a fresh mission's own precondition per the design
// draft) came up empty against that roster, spawning one fresh body where
// three were expected. `hold_for` has no deadline of its own and does not
// reset on a contest (only pauses), so nothing is lost by holding off the
// crest line until the ground that can see it is cleared first -- only the
// 300s `raze` deadline is a hard clock, and it is reached with room to
// spare either way.
const ledUZ2 = run(
  'umm_zeitoun_2_buildup',
  (sim, _rt, ids, at) => {
    const demo = ids('demo_squad');
    const strike = [...ids('apc_eitan'), ...ids('mbt_lavi'), ...ids('mortar_team'), ...ids('at_team'), ...ids('inf_squad')];
    at(1, () => {
      // Everyone but the demo squad clears the ground around the shed first.
      sim.queueCommand({ kind: 'attackMove', ids: strike, ...M(23, 33) });
      // The demo squad follows under its own orders and starts charges the
      // moment it is within 2 tiles and the ground around it is unshaken --
      // it does not need the knoll clear to begin walking there.
      sim.queueCommand({ kind: 'demolish', ids: demo, structure: sim.structureAt(21, 33) });
    });
    // Once the knoll is down, the whole strike force pulls back onto the
    // crest line and digs in for the hold. Re-anchored periodically after
    // that: attackMove does not mean "stand here", and the 180s/300s waves
    // both march straight into the zone (`rim_crest` sits inside
    // `crest_line`).
    at(70, () => sim.queueCommand({ kind: 'attackMove', ids: strike, ...M(24, 41) }));
    for (let when = 110; when <= 350; when += 40) {
      at(when, () => {
        const cur: number[] = [];
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !demo.includes(i)) cur.push(i);
        }
        sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(24, 41) });
      });
    }
  },
  ledUZ1,
  'victory',
  'umm_zeitoun_2_buildup'
);

// UZ II does not declare `intel.marked_positions` in its own `produces`, so
// its own `run()` return has already dropped it -- merge back to UZ I's
// output rather than lose the recon carry-over, the same shape as Beit
// Sahwan's `led4In = {...led1, ...led2, ...led3}`.
const ledUZ2In = { ...ledUZ1, ...ledUZ2 };

// Umm Zeitoun III -- Blinding: split the force (the western horn has no
// vehicle route at all), clear the hamlet with weapons under the ROE
// threshold, evacuate four of the six families.
//
// Control: a passive player never comes within 4 tiles of either hamlet
// group, so `get_the_hamlet_out` -- the only failable primary -- fails at
// 300s. `checkEnd` returns DEFEAT. Both `eliminate_hvt` primaries can only
// stay incomplete on a passive run; neither can reach `failed` (not one of
// the three failable objective types).
run('umm_zeitoun_3_clearance', () => {}, {}, 'defeat', 'umm_zeitoun_3_clearance (no orders)');

const ummZeitoun3Plan: Plan = (sim, _rt, ids, at) => {
  // `inf_squad` is `from_ledger`, so this may be 1-3 bodies depending on
  // what UZ II's fight left in the roster -- never hard-indexed. The
  // hamlet group is the one that actually loses the mission if it is
  // short a body (it is what triggers the evacuation and clears the
  // garrison the ROE-safe way), so it is filled first; west and east take
  // whatever is left, and the apc/mbt/namer/at_team/mortar/sniper carry
  // both flanks regardless.
  const infantry = ids('inf_squad');
  const hamletInfantry = infantry.slice(0, 1);
  const westInfantry = infantry.slice(1, 2);
  const eastInfantry = infantry.slice(2);
  const apcs = ids('apc_eitan');
  const west = [...westInfantry, ...ids('at_team'), ...ids('mortar_team'), ...ids('sniper_team')];
  const east = [...eastInfantry, ...ids('mbt_lavi'), ...ids('ifv_namer'), ...apcs.slice(0, 1)];
  // Rifles and the Eitan's rws_50 only -- both under the 0.3 structural
  // threshold that arms the flagged hamlet's penalty (§6.5's measured
  // finding: cannon_30/gun_120/spike_atgm/mortar_60 all arm it; rifles and
  // rws_50 do not).
  const hamlet = [...hamletInfantry, ...apcs.slice(1)];
  // `find_adhal`: the drone this plan otherwise never orders. `umm_zeitoun_3`
  // shares its northern terrain byte-for-byte with `umm_zeitoun` (only the
  // hamlet rows differ, y=18-28), so the same overlook UZ I already uses for
  // the crest post reads `uz_hvt_lantern` too -- measured with a two-body sim
  // this session, (4,6) sits 9.51 tiles out, OUTSIDE the lantern's own 9-tile
  // sight, so it can never so much as suspect the drone back. The route runs
  // west and stays there (x<=10) for its whole length, clear of the hamlet
  // zone [19,24,9,5] whose `zone_entered` trigger this plan's own `west`/
  // `east`/`hamlet` groups are what is meant to spring, and clear of
  // `uz_eye_west` [10.5,23.5] by the same 7.65-tile standoff UZ I's own
  // route uses south of it -- by the time the drone passes, `west`'s attackMove
  // is already closing on that post regardless.
  const drone = ids('recon_drone');
  at(1, () => {
    sim.queueCommand({ kind: 'attackMove', ids: west, ...M(12, 24) });
    sim.queueCommand({ kind: 'attackMove', ids: east, ...M(35, 24) });
    // Straight into the hamlet: `zone_entered` fires `the_house_was_the_section`
    // the moment either body crosses in, walking both garrisoned riflemen
    // out of their houses and into the open street at `hamlet_square`.
    sim.queueCommand({ kind: 'attackMove', ids: hamlet, ...M(24, 26) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(10, 40) });
  });
  at(15, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(3, 25) }));
  at(30, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(4, 6) }));
  // Re-press both flanks once the first contact clears -- attackMove halts
  // on a live fight rather than closing the last few tiles to the post
  // itself.
  at(60, () => {
    sim.queueCommand({ kind: 'attackMove', ids: west, ...M(10, 23) });
    sim.queueCommand({ kind: 'attackMove', ids: east, ...M(37, 23) });
  });
  at(120, () => {
    sim.queueCommand({ kind: 'attackMove', ids: west, ...M(10, 23) });
    sim.queueCommand({ kind: 'attackMove', ids: east, ...M(37, 23) });
  });
};

const ledUZ3 = run(
  'umm_zeitoun_3_clearance',
  ummZeitoun3Plan,
  ledUZ2In,
  'victory',
  'umm_zeitoun_3_clearance',
  3
);

// F1 / ruling R2(b): gate-open probe -- scout_shachaf (stars_min 30) reached via
// gateLedger(ledUZ2In, 15), proving the mission's fresh jeep_shoded placement
// resolves to scout_shachaf once the gate is open. Same plan body as the run
// above; the returned ledger is deliberately discarded here (`ledUZ3`, used by
// umm_zeitoun_4_clearance downstream, must stay the closed-gate result).
run(
  'umm_zeitoun_3_clearance',
  ummZeitoun3Plan,
  gateLedger(ledUZ2In, 15),
  'victory',
  'umm_zeitoun_3_clearance (gate open)',
  2,
  'scout_shachaf'
);

// Umm Zeitoun IV -- The Stockpile: raze three structures on a 300s clock
// while a second party climbs 16 tiles the other way for Adhal.
//
// Control: a passive player never orders a demolition, so all three
// structures inside `stockpile` still stand at 300s and `raze_the_stockpile`
// -- the only failable primary -- reaches `failed`. `checkEnd` returns
// DEFEAT. `kill_adhal` has no deadline of its own and can only stay
// incomplete.
run('umm_zeitoun_4_clearance', () => {}, {}, 'defeat', 'umm_zeitoun_4_clearance (no orders)');

// A first version sent both demo squads and their escort into one combined
// `attackMove`. Two things falsified it, both about `attackMove` and neither
// about `demolish`: merged with the escort, the demo squads inherited the
// escort's own chase (an `attackMove` group does not stop at its destination
// while a live contact is still ahead of it) and both walked, unescorted by
// nothing left behind to peel off, straight into Adhal's rifle guard 16
// tiles further on and died there; sent alone via a bare `demolish` order
// while the depot's own garrison was still standing, they closed to within a
// few tiles and stalled -- `demolish`'s own pathing has no re-route-around-a-
// live-fight behaviour the way `attackMove` does, and it never got back on
// its feet. The fix is sequencing, not a different order type: the escort
// goes in FIRST and alone to clear `uz_eye_depot`/`uz_rcl_depot`/
// `uz_atgm_north`/the warehouse garrison (and, chasing on past them, Adhal's
// guard too -- a bonus, not something this plan depends on), and only once
// that fight is in hand do the demo squads get their own direct `demolish`
// orders, which they can now walk to the letter.
run(
  'umm_zeitoun_4_clearance',
  (sim, _rt, ids, at) => {
    const demo = ids('demo_squad');
    const drone = ids('recon_drone');
    // The three structures inside `stockpile` (the `w` block, the `#` block
    // and the `s` block, flood-filled from the map's own grid) are each
    // exactly 5s of standing charges once a demolisher is within 2 tiles --
    // `demolish` is a hold-station timer, not a damage race, so 7,500 hp
    // comes down as fast as two squads can walk to three doors.
    const depotEscort = [...ids('mbt_lavi'), ...ids('apc_eitan')];
    at(1, () => {
      // The drone's own presence is enough to start the porters fleeing
      // (CivilianFlight does not filter by domain) well before any charge is
      // set near their ground.
      sim.queueCommand({ kind: 'move', ids: drone, ...M(29.5, 9.5) });
      sim.queueCommand({ kind: 'attackMove', ids: depotEscort, ...M(32, 8) });
    });
    at(45, () => {
      sim.queueCommand({ kind: 'demolish', ids: [demo[0]], structure: sim.structureAt(29, 5) });
      sim.queueCommand({ kind: 'demolish', ids: [demo[1]], structure: sim.structureAt(33, 5) });
    });
    // The shanty is the last of the three. Nothing has to name it: once a
    // squad's own explicit order is fulfilled, `demolishOrder` clears and
    // `stepDemolition`'s automatic search picks the nearest unprotected,
    // non-fenced structure on its own initiative -- measured this session,
    // both `w` and `#` finish first (~t=98s, well inside the 45s head start
    // this plan gives the escort plus the ~48s walk from the player's own
    // start line) and the freed squad retargets the shanty unordered. This
    // is a backstop only, timed comfortably past that: if a future ledger
    // ever leaves both squads still working their first door this late,
    // it re-points BOTH at the shanty rather than let the mission stall.
    at(180, () => sim.queueCommand({ kind: 'demolish', ids: demo, structure: sim.structureAt(33, 8) }));
    // Adhal carries no deadline of his own, so a second, dedicated push for
    // him only needs to exist at all -- it does not need to race the depot.
    // Held back this long on purpose: sent at t=1 alongside the escort, it
    // walks straight through the depot's own live fire on the way north.
    at(90, () => {
      sim.queueCommand({
        kind: 'attackMove',
        ids: [...ids('at_team'), ...ids('mortar_team'), ...ids('sniper_team'), ...ids('inf_squad'), ...ids('ifv_namer')],
        ...M(14, 7),
      });
    });
  },
  ledUZ3,
  'victory',
  'umm_zeitoun_4_clearance'
);

// --- Brigade economy Task 5: every optimal plan holds at max tier ----------
//
// Controller ruling (overrides this task's own brief, which asked for exact
// equality): the max-tier pass asserts outcome CLASS, not equality. A plain
// base VICTORY must stay a VICTORY once every KDF unit fielded is patched to
// its own maximum tier -- upgrades are supposed to make the player STRONGER,
// and a mission only a weaker force can win would be a broken track, not a
// balanced one. Stars may only move UP: a stronger force may clear a third
// star a base-tier one could not, and that is a strictly better outcome,
// never one to fail on; what a max-tier run may never do is drop a star the
// base run already earned. Controls, "(no orders)" runs and Task 7's six gate
// probes are not replayed at all -- they prove something about the mission's
// own premise or about `resolveUpgrades`, not about whether a plan holds, and
// every one of them was already excluded from `maxTierProbes` by the same
// `label === id` guard `missionStars` relies on above.
//
// Each replay goes through `run` itself (`tiers: 'max'`, a distinct label so
// neither ladder below reads it, and `measured` to read back what the run
// actually produced without widening `run`'s return type) rather than
// duplicating any of its setup -- registering the sim, resolving upgrades and
// unlocks, and building the mission runtime all have to happen exactly the
// way the base run did them, or a divergence in HOW the roster is built could
// masquerade as a divergence in whether the tracks are balanced.
let maxTierHeld = 0;
for (const probe of maxTierProbes) {
  const measured: { result: 'ongoing' | 'victory' | 'defeat'; stars: Stars; roeScore: number; credits: number } = {
    result: 'ongoing',
    stars: 0,
    roeScore: 0,
    credits: 0,
  };
  run(
    probe.id,
    probe.plan,
    probe.ledger,
    'victory',
    `${probe.id} (max tier)`,
    probe.expectStar,
    probe.fielded,
    probe.bought,
    probe.gateOf,
    'max',
    measured
  );
  const held = measured.result === 'victory' && measured.stars >= probe.baseStars;
  if (held) {
    maxTierHeld++;
  } else {
    console.error(
      `${probe.id} (max tier): FAILED — base ${probe.baseResult.toUpperCase()}/${probe.baseStars}★, ` +
        `max ${measured.result.toUpperCase()}/${measured.stars}★`
    );
    process.exitCode = 1;
  }
  // Review finding 3: no assertion here, deliberately -- the controller's ruling
  // above only gates outcome class and the star floor. This line exists purely
  // so a reader can SEE how much a max-tier force's ROE/credits drifted from its
  // own base run without re-running the harness twice by hand.
  console.log(
    `${probe.id} (max tier): ROE ${measured.roeScore} (base ${probe.baseRoe}), ` +
      `credits ${measured.credits} (base ${probe.baseCredits})`
  );
}
console.log(`max tier: ${maxTierHeld} of ${maxTierProbes.length} plain victories hold`);

// --- Task 7: the harness proves the gates open where the ladder says -------
//
// The three star-gated units carry `stars_min` 12 (`breach_team`), 30
// (`scout_shachaf`) and 44 (`apc_kipod`) -- data/units/breach_team.json,
// scout_shachaf.json, apc_kipod.json. The design measured that a ★★ player
// reaches each gate at mission 6/15/22 of the flattened `world.json` order
// (region -> town -> mission), so this asserts the gate is OPEN there and
// CLOSED one mission earlier -- against a SYNTHETIC ladder (controller ruling
// R2, see the comment on `missionStars` above), not the harness's own chained
// `led…` ledgers, which do not reliably reach the gates.

const missionOrder: string[] = [];
for (const region of world.regions) {
  for (const town of region.towns) {
    for (const missionId of town.missions) missionOrder.push(missionId);
  }
}

/** `missionOrder`, paired with each mission's own recorded grade. A mission
 *  with no recorded winning plan contributes 0 stars and is named here, once,
 *  rather than silently dropped -- only the tutorial (which is not itself a
 *  `world.json` entry, so it can never appear in this walk at all) should
 *  ever be missing a `missionStars` entry. */
const missionResults: [string, MissionResult][] = missionOrder.map((missionId) => {
  const stars = missionStars.get(missionId);
  if (stars === undefined) {
    console.log(`gate ladder: no recorded winning plan for ${missionId} (contributes 0 stars)`);
  }
  // WP-G-E1: this used to hardcode `roe: 0` -- harmless while nothing read it, but
  // `conductLedgerAfter` below needs the real recorded Conduct score for each mission.
  return [missionId, { stars: stars ?? 0, roe: missionRoe.get(missionId) ?? 0, ticks: 0, lost: 0 }];
});

/** The synthetic `campaign.mission_results` ledger a real playthrough would
 *  hold after clearing the first `count` missions of `missionOrder` -- built
 *  the same way `MissionRuntime`'s own end-of-mission write is (spec §4.1),
 *  so `starsEarned`/`unlockReason` read it exactly as they read a real save. */
function syntheticLedgerAfter(count: number): LedgerData {
  const results: Record<string, MissionResult> = {};
  for (let i = 0; i < count; i++) {
    const [missionId, result] = missionResults[i];
    results[missionId] = result;
  }
  return { 'campaign.mission_results': results };
}

/**
 * The Conduct twin of `syntheticLedgerAfter`: the synthetic `roe.mission_ratings` ledger
 * a real playthrough would hold after clearing the first `count` missions of
 * `missionOrder` -- WP-G-E1 (2026-09-18). `conductAtLeast`/`unlockReason`'s `roeMin` check
 * reads `roe.mission_ratings` only, never `campaign.mission_results`, so the star-gate
 * walk above cannot exercise the nine Conduct-gated units at all; this is the missing
 * half. Same shape, same reasoning: an empty object at `count === 0` reads as "no
 * missions rated yet" (`ratings(ledger)` sees a non-null map with zero keys and falls
 * through to the legacy `roe.cumulative_rating` check, which is absent here), so a
 * Conduct gate is always CLOSED before the first mission regardless of its floor.
 */
function conductLedgerAfter(count: number): LedgerData {
  const ratings: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const [missionId, result] = missionResults[i];
    ratings[missionId] = result.roe;
  }
  return { 'roe.mission_ratings': ratings };
}

interface GateSpec {
  /** The star-gated unit this line names in the printout. */
  unit: string;
  starsMin: number;
  /** 1-based position in `missionOrder` where the measured ladder opens this gate. */
  opensAfter: number;
}

// Task 2 (WP-G-E3) already re-pinned `apc_kipod` once, before any of the three
// re-pins below: Beit Sahwan III's `carries: true` flag (mission order 4) earned
// it a third star, pulling the ladder's cumulative past 44 one mission earlier and
// moving `opensAfter` 22 -> 21 (`breach_team` and `scout_shachaf` fall well clear
// of mission 4 and are untouched) -- that 21 is where the first re-pin below starts.
// Re-pinned twice (WP-G-E3 Task 3), both times from the printed line.
// First: `khan_rafid_1_recon` (mission order 6) reached 3 stars, pulling
// `scout_shachaf`'s running total past its 30-star floor one mission earlier
// (15 -> 14: cumulative at mission 14 went 29 -> 30). Second, on the
// controller's ruling that the screen's own order timing is the plan's to
// change: `beit_sahwan_1_recon` (mission order 2, BEFORE khan_rafid_1_recon)
// also reaches 3 stars, and its own extra star propagates through every
// later checkpoint. `breach_team`'s cumulative at mission 5 moved 11 -> 12,
// crossing its 12-star floor one mission sooner (opensAfter 6 -> 5); the same
// shape moves `apc_kipod` (43 -> 44 at mission 20, opensAfter 21 -> 20).
// `scout_shachaf`'s own crossing point does NOT move again: mission 13's
// cumulative (now 29, was 28) is still below its 30-star floor and mission
// 14's (now 31, was 30) is still above it, so `opensAfter` stays 14 -- only
// the printed totals moved, re-measured rather than assumed.
// Re-pinned again (WP-G-E3 Task 4): `deir_amun_1_recon` (mission order 9,
// BEFORE `scout_shachaf`'s own checkpoint at mission 13/14) reaches 3 stars,
// pulling the running total past the 30-star floor one mission earlier again
// (14 -> 13: cumulative at mission 13 went 29 -> 30, so 13 is CLOSED no
// longer). `breach_team`'s own checkpoint (mission 5) falls before mission 9
// and is untouched. `apc_kipod`'s printed totals both move (+1, mission 9
// falls before its own checkpoint at mission 20) but 43 stars at mission 19
// is still short of its 44-star floor, so `opensAfter` stays 20 -- only the
// totals moved there, same shape as `scout_shachaf` not moving again above.
// Re-pinned a final time (WP-G-E3 Task 5): `umm_zeitoun_1_recon` (mission
// order 18) and `umm_zeitoun_3_clearance` (mission order 20) both reach 3
// stars. `breach_team` (checkpoint at mission 5) and `scout_shachaf`
// (checkpoint at mission 13) both fall well before mission 18 and are
// untouched. `apc_kipod` moves again: mission 18's own promotion applies
// from mission 18 onward, so mission 19's cumulative -- one mission before
// mission 20's own promotion ever applies -- already carries that one extra
// star (43 -> 44), crossing the 44-star floor a mission earlier than before
// (`opensAfter` 20 -> 19); mission 20's printed total carries BOTH
// promotions (45 -> 47) but that mission was already past its own checkpoint
// under the old pin, so only the totals move there, same shape as
// `scout_shachaf` and `apc_kipod` not moving again in the two blocks above.
// This is the final triple for WP-G-E3.
const GATES: GateSpec[] = [
  { unit: 'breach_team', starsMin: 12, opensAfter: 5 },
  { unit: 'scout_shachaf', starsMin: 30, opensAfter: 13 },
  { unit: 'apc_kipod', starsMin: 44, opensAfter: 19 },
];

for (const gate of GATES) {
  const openLedger = syntheticLedgerAfter(gate.opensAfter);
  const openStars = starsEarned(openLedger);
  const openReason = unlockReason({ starsMin: gate.starsMin }, openLedger);
  console.log(`gate ${gate.unit}: OPEN after mission ${gate.opensAfter} at ${openStars} stars`);
  if (openReason !== null) {
    console.error(
      `gate ${gate.unit}: FAILED — expected OPEN (>= ${gate.starsMin} stars) after mission ${gate.opensAfter}, got ${openStars} stars`
    );
    process.exitCode = 1;
  }

  const closedAfter = gate.opensAfter - 1;
  const closedLedger = syntheticLedgerAfter(closedAfter);
  const closedStars = starsEarned(closedLedger);
  const closedReason = unlockReason({ starsMin: gate.starsMin }, closedLedger);
  console.log(`gate ${gate.unit}: CLOSED after mission ${closedAfter} at ${closedStars} stars`);
  if (closedReason === null) {
    console.error(
      `gate ${gate.unit}: FAILED — expected CLOSED (< ${gate.starsMin} stars) after mission ${closedAfter}, got ${closedStars} stars`
    );
    process.exitCode = 1;
  }
}

// --- Task 7b: the nine Conduct-gated units, walked the same way ------------
//
// WP-G-E1 (2026-09-18, GH-173): the lead raised these nine `roe_rating_min` floors
// from 35-65 to 70-90 so they would spread across a well-played campaign instead of
// clearing en masse after mission 1 (docs/campaign/economy/prices.md §3.2 found
// exactly that at the old floors -- every winning plan scores Conduct >= 75, so even
// the highest old floor, 65, was already open the moment any credits existed at all).
//
// Measured here, walking the REAL per-mission Conduct scores above rather than the
// old finding's numbers (which predate several map/plan fixes and a mission-order
// change): raising the ceiling to 90 does not change this outcome. `beit_sahwan_breach`
// -- mission 1, unconditionally -- scores Conduct 97 on its own, so the average after
// mission 1 IS 97 (a single data point), which already clears every floor <= 90. The
// campaign average never drops below 93.5 for the rest of the ladder either (its low
// point, mission 26). So EVERY ONE of the nine gates below still opens after mission 1
// -- `opensAfter: 1` for all nine, asserted below -- and no floor inside the lead's
// mandated 70-90 band can delay that on this ladder: doing so would require a floor
// above 97 (mission 1's own score), outside the mandated range, or a change to mission
// content, outside this work package's scope (unit JSON + one doc + test pins only).
// The floors still carry real meaning: they raise the bar from "any winning plan
// clears it" to "only a genuinely clean one does", which matters for a realistic
// player this optimal-play harness cannot model (prices.md §9 finding 1) -- it is
// the VALUE of the floor, not its opening mission on this ladder, that moved.
interface ConductGateSpec {
  /** The Conduct-gated unit this line names in the printout. */
  unit: string;
  roeMin: number;
  /** 1-based position in `missionOrder` where the measured ladder opens this gate.
   *  All nine read 1 -- see the comment above for why no floor in [70, 90] can move it. */
  opensAfter: number;
}

const CONDUCT_GATES: ConductGateSpec[] = [
  { unit: 'recon_drone', roeMin: 70, opensAfter: 1 },
  { unit: 'attack_drone', roeMin: 72, opensAfter: 1 },
  { unit: 'yahalom_squad', roeMin: 75, opensAfter: 1 },
  { unit: 'demo_squad', roeMin: 77, opensAfter: 1 },
  { unit: 'sniper_team', roeMin: 80, opensAfter: 1 },
  { unit: 'heli_peten', roeMin: 82, opensAfter: 1 },
  { unit: 'ifv_namer', roeMin: 85, opensAfter: 1 },
  { unit: 'dozer_d9', roeMin: 87, opensAfter: 1 },
  { unit: 'mbt_lavi', roeMin: 90, opensAfter: 1 },
];

for (const gate of CONDUCT_GATES) {
  const openLedger = conductLedgerAfter(gate.opensAfter);
  const openReason = unlockReason({ roeMin: gate.roeMin }, openLedger);
  console.log(`gate ${gate.unit}: OPEN after mission ${gate.opensAfter} (Conduct floor ${gate.roeMin})`);
  if (openReason !== null) {
    console.error(
      `gate ${gate.unit}: FAILED — expected OPEN (avg Conduct >= ${gate.roeMin}) after mission ${gate.opensAfter}, got "${openReason}"`
    );
    process.exitCode = 1;
  }

  const closedAfter = gate.opensAfter - 1;
  const closedLedger = conductLedgerAfter(closedAfter);
  const closedReason = unlockReason({ roeMin: gate.roeMin }, closedLedger);
  console.log(`gate ${gate.unit}: CLOSED after mission ${closedAfter} (Conduct floor ${gate.roeMin})`);
  if (closedReason === null) {
    console.error(
      `gate ${gate.unit}: FAILED — expected CLOSED (avg Conduct < ${gate.roeMin}) after mission ${closedAfter}, got open`
    );
    process.exitCode = 1;
  }
}

// --- Brigade economy step 1: the optimal ladder's credit total ---------------
//
// The sum of every winning plan's value in `world.json` order. Pinned here the way
// the star gates are, so a content or weight change that moves what the campaign
// pays is a red line with a number, not a silent drift. Re-pin deliberately, in the
// same commit as the change that moved it, and say why. The balance analyst fits
// prices (steps 2-3) against this figure.
let ladderCredits = 0;
// `?? 0` for the same reason the star ladder's walk above needs one: a mission
// with no recorded winning plan contributes nothing, and it was already named
// in that log line rather than silently dropped here too.
for (const missionId of missionOrder) ladderCredits += missionCredits.get(missionId) ?? 0;
// Measured 2026-09-15 under weights win 100 / secondary 40 / home 10 / conduct 1.
// Re-pinned 2026-09-15, same day: "home" now counts only the starting force
// (ruling R4) -- production units no longer inflate the payout, which moved
// the total 5644 -> 5544.
// Re-pinned 2026-09-17: 5544 -> 5531. `qarn_hadid_3_clearance`'s rescue-detail
// waypoint moved from [29,3] to [21,2] (brittle-plan fix, see the plan's own
// comment above) to stop the detail's survival being a knife edge at a
// stronger KDF tier -- the new route trips a different ROE/roster outcome
// (80 -> 77 ROE, one fewer survivor) for the same 2 stars, moving that one
// mission's credits 225 -> 212 and the ladder by the same -13.
// `khan_rafid_1_recon`'s fix (jeep's gate-transit route) changed nothing
// about its own outcome -- VICTORY 0.5 min, ROE 100, stars 2, credits 260,
// byte-identical to before -- so it contributes no change here.
// Re-pinned 2026-09-19 (WP-G-E3 Task 1): 5531 -> 5490. No star moved and no
// weight changed -- the three GATES lines are still 6 / 15 / 22. Beit Sahwan III
// now declares `intel.marked_positions` in `produces` and is run on the merged
// `{ ...led1, ...led2 }` ledger the app would really hand it, so its own hostile
// placements spawn pre-marked and fight at full range from tick zero: III goes
// ROE 100 -> 89 and roster out 24 -> 22, worth -31 credits, and IV inherits the
// two-unit-smaller roster for -10 more. -41 total, both from carry-over fidelity
// rather than from a plan change (neither plan was touched).
// Re-pinned 2026-09-19 (WP-G-E3 Task 2): 5490 -> 5530 (+40, exactly
// `carryingComplete`). Beit Sahwan III's `picture` now flags `carries: true`,
// so III's own grade moves 2 -> 3 stars and its plain-run credits 209 -> 249;
// `beit_sahwan_4_subterranean` (mission 5, the only mission that reads III's
// output) is byte-identical before and after (VICTORY 2.1 min, ROE 98, stars 2,
// roster out 23, credits 178) -- the flag changes what III is CREDITED for, not
// what it produces, so nothing downstream moves. `GATES`' `apc_kipod` line moves
// with it: mission 4's extra star pulls the campaign's running total past its
// starsMin (44) one mission earlier (44 stars after mission 21 where it read 42
// before), so `opensAfter` re-pins 22 -> 21; `breach_team` and `scout_shachaf`
// are unaffected (their own gates fall well clear of mission 4's own position).
// Re-pinned twice 2026-09-19 (WP-G-E3 Task 3), both from the printed line.
// First: 5530 -> 5580 (+50). `khan_rafid_1_recon` now completes
// `find_the_west_lane` (a carrying secondary), moving its own grade 2 -> 3
// stars: +40 `carryingComplete`, plus +10 `unitHome` because the drone
// survives its detour this time (roster out 5 -> 6) where the old plan's
// drone was shot down at the alley row before the mission ended. `GATES`'
// `scout_shachaf` line moved with it (15 -> 14, see above).
// Second, on the controller's ruling that the screen's own order timing is
// the plan's to change: 5580 -> 5661 (+81). `beit_sahwan_1_recon` now
// completes `hvt_seen` too, moving its own grade 2 -> 3 stars: a clean +40
// `carryingComplete` (credits 260 -> 300, ROE and roster out both unchanged
// at 100 / 19 -- no home/conduct drift on the mission itself). The other
// +41 is carry-over, not a second star: `led1` (this mission's own surviving
// roster) feeds `beit_sahwan_3_clearance` two missions later, and holding
// the screen for 32s changes exactly which units are alive and where when
// III's own placements spawn -- III's run goes ROE 89 -> 100 and roster out
// 22 -> 24 (credits 249 -> 280, +31), and `beit_sahwan_4_subterranean`
// inherits III's now-larger roster in turn (credits 178 -> 188, +10).
// 40 + 31 + 10 = 81, matching the measured ladder delta. `GATES`'
// `breach_team` and `apc_kipod` lines move with it (see above); `scout_shachaf`
// does not move again.
// Re-pinned 2026-09-19 (WP-G-E3 Task 4): 5661 -> 5751 (+90, a clean
// `carryingComplete`). `deir_amun_1_recon` now completes both `find_the_chief`
// and `find_the_gap_gun`, moving its own grade 2 -> 3 stars: credits 180 -> 270.
// Deir Amun I's own ledger is not threaded into `deir_amun_2_foothold` in this
// harness (see the plan's own comment -- the `{}` fidelity gap is deliberately
// left open, per the task brief), so nothing downstream moves: no carry-over
// term, unlike Tasks 2 and 3. `GATES`' `scout_shachaf` line moves with it
// (14 -> 13, see above). `breach_team`'s `opensAfter` is untouched -- mission
// 9 falls after its own checkpoint at mission 5, so that cumulative never
// sees the extra star. `apc_kipod`'s printed totals both move (+1: 45/43,
// were 44/42) since mission 9 falls before its checkpoint at mission 20, but
// 43 is still short of its 44-star floor, so `opensAfter` stays 20.
// Re-pinned a final time 2026-09-19 (WP-G-E3 Task 5): 5751 -> 5849 (+98),
// three terms, each read off `rt.startingCount`/`rt.startingHome` rather than
// guessed from the printed `roster out` line (which is the CUMULATIVE pool
// across the whole chain, not this mission's own starting force -- see
// "roster.surviving_units is CUMULATIVE" in CLAUDE.md's known scaling debts).
// (i) `umm_zeitoun_1_recon` itself: +40, a clean `carryingComplete` --
// `find_the_missile_team` completes, ROE stays 100 and home stays 7 of 7, so
// nothing else moves (credits 200 -> 240). (ii) `umm_zeitoun_2_buildup`,
// fed by `ledUZ1`: +20, entirely `unitHome` -- its OWN grade stays 2 stars
// and its ROE stays 98, but two more of UZ1's now-differently-composed
// survivors come home through UZ2's fight (`startingHome` 7 -> 9 of the same
// `startingCount` 10), a carry-over side effect of UZ1's route rather than a
// second star (credits 198 -> 218). (iii) `umm_zeitoun_3_clearance` itself:
// +38 -- `find_adhal` completes for a clean +40 `carryingComplete`, partly
// offset by -2 `conductPoint` (ROE 89 -> 87, both far above the 65 floor;
// `unitHome` is unchanged at 7 of 7, since two more starting-force units are
// FIELDED this time -- `startingCount` 10 -> 12, likely UZ2's own carry-over
// reaching UZ3's `from_ledger` draw in turn -- and just as many of the extra
// two are lost, credits 194 -> 232). 40 + 20 + 38 = 98, matching the measured
// ladder delta. `umm_zeitoun_4_clearance`, fed by `ledUZ3`, is credit-neutral
// (`startingCount`/`startingHome` both unchanged at 12/11, credits 237 both
// times) even though its own printed `roster out` moves (28 -> 30) purely
// from the larger cumulative pool passing through. `GATES`' `apc_kipod` line
// moves with it (see above); `breach_team` and `scout_shachaf` do not.
const LADDER_CREDITS = 5849;
console.log(`credit ladder: ${ladderCredits} over ${missionOrder.length} missions`);
if (ladderCredits !== LADDER_CREDITS) {
  console.error(`credit ladder: FAILED — expected ${LADDER_CREDITS}, got ${ladderCredits}`);
  process.exitCode = 1;
}
