// The scripted winning plans for the Wadi Halam arc, I to V (GH-90, GH-93, GH-382, GH-421).
//
// Lifted out of `playtest.ts`, which runs its whole gate at import and so cannot be imported. This
// module has NO side effects: it exports closures and constants and runs nothing. `playtest.ts` runs
// them down its ledger chain and holds the pins; `wh_pacing.ts` runs the very same objects for its
// `optimal` rung (a hand copy of them drifted once and read Wadi Halam IV as a defeat: GH-830), and
// `plans/plans.test.ts` pins that. Nothing here may be copied elsewhere.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';
import { Picture, living } from '../player-picture';
import { e6Remetz, isRemetz } from './e6-remetz';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

/** The arc's missions in play order: each is played on the ledger the one before it produced. */
export const WADI_HALAM_CHAIN = [
  'wadi_halam_1_fords',
  'wadi_halam_2_laager',
  'wadi_halam_3_counterraid',
  'wadi_halam_4_village',
  'wadi_halam_5_depot',
] as const;

// I — The Fords: push the screen into the tree line, clear both gallery
// ambushes for the picture, and hold the ford watch uncontested for 20s.
// The drone tours the bank/bund/hide side of the wadi so the picture comes
// from four *different* enemies rather than two ambushes seen twice.
// `take_ford` is a four-minute hold, contested by six waves out of the
// east (90s to 265s, GH-90) -- so the screen has to actually stand on the
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
// Since the lead's 2026-10-13 ruling (Spike 9 -> 13 tiles) the old plan lost seed 18. That was the
// marginal seed #570 had already re-planned: the plan won by one survivor on nine seeds of thirty,
// and on 30 further seeds (100-129) it lost two with the Spike at 9 or 13 alike. Three changes give
// it a margin rather than a new seed to sit on. Each is what a player who can see the ford would do.
//
// - The Spike team stands off at (4,22), then at (4,24), and never walks with the screen. Its 13
//   tiles reach both fords from there, and the DShK (9) and the RPG (5.5) do not reach it.
//   Walking with the screen, it traded missiles with the bank patrol at 7 tiles.
// - The drone does not fly its old tour onto the bank patrol's DShK, where it died at 8-10 s on
//   every seed. It builds the picture from the west bank at (5,24) and spots for the Spike. The
//   tour's later legs (the hide-south mark meant for III) were never flown: the drone was
//   already dead.
// - The screen holds the ford watch's EAST edge, at (11.5,24). The zone is an olive grove 6 tiles
//   wide, and riders in it are seen at 4-6 tiles: the screen held the west half and met them in
//   the trees. At the east edge it sees them crossing the open bank.
//
// Measured on the sweep's 30 seeds, then on seeds 100-129 that took no part in choosing it:
// - this plan: 30/30 and 28/30, mean survivors 3.97 and 3.67, no seed with one survivor;
// - the old plan: 29/30 and 28/30, mean 2.50 and 2.23, nine one-survivor seeds on 100-129.
// Holding x=8, 9 or 10 with the same Spike and drone read 56-57 of the 60. The east edge read 58.
// Most of what is left is the mission's own late waves in the grove.
//
// The east-bank crest (GH-161, 25 Oct). `wadi_halam_basin` gained a level-2 crest along x=14, one tile
// outside the grove. From the bed nothing of the pasture shows over it, so the screen at (11.5,24)
// first sees a rider at 4 tiles, not 8, and the plan above won 29 of the 30 sweep seeds (seed 9 lost
// its squads to the pair at 210 s). Two changes, each what a player would do once he knows riders now
// top the crest at 4 tiles:
// - The APC takes the lee of the bank, (12,24), alone and two tiles under the crest, from 140 s (110 s before
//   GH-421, see below). It is
//   the one hull that can take a RPG rider's first shot (1,600 hp, a squad has 400) and the first thing
//   a rider tops the crest onto. It is left out of the periodic re-anchor, which would walk it back
//   into the squads.
// - The squads hold (10.5,24), a tile and a half behind it.
// Measured with the same script on the sweep's 30 seeds plus 100 that took no part in choosing it
// (300-399): the plan above on the crest 29/30 and 91/100; this plan 30/30 and 95/100. For scale, the
// plan above on the FLAT map read 30/30, then 28/30 on 100-129 and 28/30 on 200-229.
// Tried and dropped (sweep seeds, then the 100 as well where a variant was close): the drone on the crest
// from 110 s or 150 s (it dies: 24-25 of 30 on 100-129); the APC on the crest or one tile behind it
// (27-29 of 30); ambush stances on the squads (holding fire against riders that outrange sight, 3-29 of
// 30); the Spike team forward at x=6, 8 or 10 (28-29 of 30); the squads west of x=10 (26 of 30: riders
// reach the grove floor first); the APC at (12,22) or (12,26) (27-29 of 30).
// Re-solved against vehicle avoidance (GH-421 Stage 2, merged 26 Oct): the plan above, with the screen
// leaving at 140 s and the APC ordered to the bank at 110 s, read 28/30 (5 and 9 lost), because the 140 s
// screen order cancelled the APC's. Ordering the APC at 140 s, after the screen's, reads 30/30 on the
// sweep seeds (slowest win 7.8 min), 93/100 on 300-399 and 26/30 on 100-129 (117, 119, 121, 123 lost; the
// base tree loses 119 and 123 there). Tried: the APC at 150 s or 160 s (29/30, seed 14), 145 s and the
// screen and APC both at 130 s or 135 s (no better on 300-399: 94/100 at 135 s).
export const wadiHalam1Plan: Plan = (sim, rt, ids, at) => {
  const drone = ids('recon_drone');
  const screen = [...ids('apc_eitan'), ...ids('inf_squad')];
  const spike = ids('at_team');
  const jeep = ids('jeep_shoded');
  const apc = ids('apc_eitan');
  const ANCHOR = M(10.5, 24);
  const BANK = M(12, 24);
  const STANDOFF = M(4, 24);
  at(0, () => {
    // North first: the near gallery ambush is 4 tiles off the axis, and
    // going in under attackMove springs and kills it instead of walking past.
    sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 15) });
    sim.queueCommand({ kind: 'attackMove', ids: spike, ...M(4, 22) });
    // Detour, not the shipped [9,20]: closes on carrier group A ([13.5,30.5])
    // first, within SHEPHERD_RADIUS_SQ (4 tiles).
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(15, 31) });
    sim.queueCommand({ kind: 'move', ids: drone, ...M(5, 24) });
  });
  // South gallery next.
  at(60, () => sim.queueCommand({ kind: 'attackMove', ids: screen.filter((i) => sim.state.alive[i] === 1), ...M(9, 31) }));
  // Jeep's second leg: closes on carrier group B ([16.5,33.5]).
  at(60, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(17, 34) }));
  // GH-421 (vehicle separation): 110 s -> 140 s. The screen's first fight on the south gallery is the
  // 100 s raid (riders killed at 101-103 s); at 110 s it left for the ford while the next riders were
  // still coming, and with hulls no longer sharing space the Eitan, which spawns inside the jeep, is a
  // fraction of a second behind everyone else all the way. Measured on seeds 1-30 for the time the
  // screen leaves (lost seeds): 90 s two, 95 s two (9, 29), 105 s one (20), 110 s one (18), 115 s one
  // (18), 125 s two (3, 18), 135 s none, 140 s none; on seeds 100-129, which took no part in the
  // choice: 135 s lost 107 and 117, 140 s lost 117 (the base tree loses 119 and 123 there).
  at(140, () => {
    sim.queueCommand({ kind: 'attackMove', ids: screen.filter((i) => sim.state.alive[i] === 1), ...ANCHOR });
    sim.queueCommand({ kind: 'attackMove', ids: spike.filter((i) => sim.state.alive[i] === 1), ...STANDOFF });
  });
  at(120, () => sim.queueCommand({ kind: 'attackMove', ids: jeep, ...ANCHOR }));
  for (let when = 130; when <= 320; when += 45) {
    at(when, () => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !spike.includes(i) && !apc.includes(i)) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...ANCHOR });
      sim.queueCommand({ kind: 'attackMove', ids: spike.filter((i) => sim.state.alive[i] === 1), ...STANDOFF });
    });
  }
  // After the screen's order on purpose: at 140 s this order comes second and overrides the APC's share of
  // the screen's anchor above. It was 110 s until GH-421 moved the screen's departure to 140 s: at 110 s
  // the APC left the south gallery thirty seconds early and the 140 s order then walked it back to the
  // squads' anchor, so the lee of the bank was never held (sweep seeds 5 and 9 lost, 28/30).
  at(140, () => sim.queueCommand({ kind: 'attackMove', ids: apc.filter((i) => sim.state.alive[i] === 1), ...BANK }));
  void rt;
};

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
/** GH-291: the laager plan's chase radius round the pump house corner (tiles), and how long the hold
 *  reads `contested` with nothing in that reach before the force goes to look (s). */
const CHASE_R = 6;
const STALL_S = 30;
export const wadiHalam2Plan: Plan = (sim, rt, ids, at) => {
  const engineers = new Set(ids('demo_squad'));
  // GH-382: the ford watch is in the NW corner now, off the line to the pasture, so one
  // team stands on it for the whole mission (and is kept out of the anchor sweep).
  const picket = new Set(ids('at_team'));
  const kept = new Set([...engineers, ...picket]);
  const anchor = (): void => {
    const all: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !kept.has(i)) all.push(i);
    sim.queueCommand({ kind: 'attackMove', ids: all, ...M(21, 25) });
  };
  // Two structures stand inside the pasture zone now: the pump house in the field and the
  // forward store on its western edge. The engineers take whichever is still standing.
  const burn = (): void => {
    for (const [tx, ty] of [[18, 22], [13, 25]] as const) {
      const s = sim.structureAt(tx, ty);
      if (s >= 0) {
        sim.queueCommand({ kind: 'demolish', ids: [...engineers], structure: s });
        return;
      }
    }
  };
  at(0, () => {
    burn();
    sim.queueCommand({ kind: 'attackMove', ids: [...picket], ...M(9, 9) });
  });
  at(1, anchor);
  for (let when = 15; when <= 300; when += 15) at(when, burn);
  // GH-291 (see below): seconds the hold has read `contested`, and where the next search goes.
  let stalled = 0;
  let searched = 0;
  for (let when = 45; when <= 700; when += 45)
    at(when, () => {
      if (stalled < STALL_S) anchor();
    });
  // Since #537 nothing walks on to a picket left standing in the pasture: the hold stays contested
  // and the run never ends. Whatever the player has seen inside the pasture is attacked where he saw
  // it, for as long as the mission runs (the anchor used to stop at 700 s).
  //
  // GH-291 (a routed unit flees away from the fire it cannot see, or holds, instead of running -x)
  // changed who is left in the pasture. A raider broken by the anchor's fire runs EAST now, away
  // from the KDF line, and rallies inside the pasture or on the road beyond it; under -x it ran west
  // into the guns and died. Two changes follow, each what a player watching the hold clock would do.
  //
  // - The force chases only what it has seen within 6 tiles of the pump house corner (the contest
  //   radius), and otherwise holds. Every raider's patrol ends on that corner, so the fight comes to
  //   it. Chasing to the pasture's far corner split the force on seed 9: the south riders caught it in
  //   the open at 255-300 s, the rallied technical came back behind it, and the last of the waves
  //   camped beside two knocked-out hulls and a lone squad (STUCK at 20 min).
  // - When the clock has read `contested` for 30 s with nothing seen in reach (the HUD shows it), the
  //   force goes to look: the nearest contact it remembers in the pasture, else the pasture's corners
  //   in turn, east first, where the broken raiders go. With the chase held to 6 tiles alone, seed 13
  //   stuck on a militia cell nobody had seen, 7.6 tiles out at (26.5,30.5), contesting a knocked-out
  //   Namer.
  //
  // Measured with the GH-291 sim, on the sweep's 30 seeds and on 424242 plus 100-128, which took no
  // part in choosing it: the old plan 29/30 (missed 9) and 30/30; the 6-tile chase alone 29/30
  // (missed 13); both changes 30/30 and 30/30, slowest 7.4 and 7.1 min. On the sweep's seeds the
  // search fires on five (6, 9, 11 and 25 go to a remembered contact, 13 to the first corner).
  const pic = new Picture(sim);
  const PASTURE = [13, 15, 14, 17] as const;
  const SEARCH = [[25, 29], [25, 19], [16, 29], [16, 18]] as const;
  for (let when = 30; when <= 1190; when += 10)
    at(when, () => {
      pic.update();
      // The ford is taken and the store is down: the picket and the engineers join the hold.
      if (rt.objectiveStatus('keep_ford') === 'complete') for (const i of picket) kept.delete(i);
      if (rt.objectiveStatus('burn_store') === 'complete') for (const i of engineers) kept.delete(i);
      const hold = rt.objectiveList.find((o) => o.id === 'hold_pasture');
      stalled = hold?.paused === 'contested' ? stalled + 10 : 0;
      const c = pic.nearest(21, 25, PASTURE);
      if (c && (c.x - 21) ** 2 + (c.y - 25) ** 2 <= CHASE_R * CHASE_R) {
        sim.queueCommand({ kind: 'attackMove', ids: living(sim, kept), ...M(c.x, c.y) });
      } else if (stalled >= STALL_S) {
        if ((stalled - STALL_S) % 30 === 0) {
          const [x, y] = c ? [c.x, c.y] : SEARCH[searched++ % SEARCH.length];
          sim.queueCommand({ kind: 'attackMove', ids: living(sim, kept), ...M(x, y) });
        }
      } else if (when > 700 && when % 40 === 0) anchor();
    });
  for (let when = 90; when <= 700; when += 60) {
    at(when, () => void rt.requestBuild('inf_squad'));
  }
};

// III — The Cattle Track: a fast, armoured pair (jeep + APC) runs the
// commander down at the north hide -- enough firepower to drop him before
// the withdraw trigger matters, and enough armour on the jeep's wing that
// losing it to the technical's dshk isn't the likely outcome. The rest holds
// the bunds against the two-wave counter-raid; the hold re-anchors on the
// same schedule as II, for the same reason (a wave that breaks and runs
// pulls a pursuing force out past the zone edge).
export const wadiHalam3Plan: Plan = (sim, _rt, ids, at) => {
  e6Remetz(sim, _rt, ids, at, 'wadi_halam_3_counterraid', [20, 22]);
  const chase = [...ids('jeep_shoded'), ...ids('apc_eitan')];
  // GH-382: the herd stands on the lane's lower bend now, 10 tiles above the refuge on the
  // stream bed, and civilians break for the refuge only when a soldier reaches them. One
  // rifle squad walks out to them (infantry carry nobody, so they go on foot, and a hull
  // with free seats near them would take them aboard and strand them in it) and rejoins.
  const shepherd = ids('inf_squad').slice(0, 1);
  const kept = new Set(shepherd);
  const anchor = (): void => {
    const cur: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !kept.has(i) && !isRemetz(sim, i)) cur.push(i);
    sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(21, 22) });
  };
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: chase, ...M(25, 7) });
    sim.queueCommand({
      kind: 'attackMove',
      ids: [...ids('ifv_namer'), ...ids('inf_squad').slice(1), ...ids('at_team')],
      ...M(21, 22),
    });
    sim.queueCommand({ kind: 'move', ids: shepherd, ...M(25, 32) });
  });
  at(75, () => {
    kept.clear();
    sim.queueCommand({ kind: 'attackMove', ids: shepherd, ...M(21, 22) });
  });
  for (let when = 60; when <= 700; when += 45) at(when, anchor);
};

// IV — Wadi Halam (the village): kill the cache guard in the east house, get
// the families out, and hold the village. Mind the hall block -- nothing in
// this force fires ordnance heavy enough to charge it, so the only ROE
// discipline needed is not parking a gun on top of it.
//
// GH-382: seven garrisoned houses strung along the terraced street. NW (15,11) on the upper
// terrace, the middle-terrace SW (19,24), SE (33,25), the rpg_team pair mid (37,25) and far
// (42,26), the cache house (43,20, the third rpg_team, the HVT) and NE (37,7) on the top lane.
// The families wait by the hall (31,22), the east end of the street (36,22) and the plaza
// (27,26); the refuge is on the road WEST (3,24), the longest walk in the mission.
//
// Garrison overhaul (Task 9, L-3): this plan used to level five houses by gunfire, moving up to a
// firing step 2-3 tiles off each house's face. Cause, measured on the plan's own seeds: those
// steps stand inside the garrisons' reach, and a garrison now fires from its window unpinned with
// +1 range -- the SW and SE militia_cells shoot the rifle squads and the at_team dead during the
// slow demolitions, and the mid rpg_team (37,25) kills the Eitan (and on some seeds the IFV) at
// the (34,28)/(38,28) steps, so the sweep runs out of guns that hurt masonry before the cache
// house falls and the 840 s clock expires (1/30 seeds, slowest win 808 s).
//
// So the plan fights only the house the mission needs, from outside every garrison's reach:
// - Only the cache house has to come down (its guard is the HVT, and a man inside cannot be
//   shot). The capture is contested only by an enemy within six tiles of a player unit INSIDE
//   the zone (x 14-43, y 8-29), so the other six cells are left standing and the force stays
//   out of their reach rather than demolishing them -- one house down is also ROE 94, not 70.
// - The guns stand in the NE corner, east of the zone: the cache's nearest window is >= 7 tiles
//   off (rpg reach 5 + 1 + 0.5) and the cache is nearer than the NE militia house, so every
//   gun's own target choice (the nearest identified garrison) is the cache. The at_team gets
//   the one infantry-safe tile there, (47,13): 8.9 from the NE militia's window (7 + 1 + 0.5),
//   7.1 from the cache. It rides in the Eitan, because no route to it on foot stays out of
//   both NW and NE rifle reach; vehicles shrug off rifles, so they take the north road.
// - The IFV collects the three families it needs (count 3) at the hall and the plaza and never
//   drives to (36,23): that pick-up sat 2.9 tiles from the mid rpg_team's window and on some
//   seeds the IFV was immobilised there with the families aboard. It waits for the technicals
//   to die first (they run for the village centre on first contact), then joins the guns.
// - When the cache house falls the Eitan alone drives into the zone at (42.5,16.5), more than
//   six tiles from every remaining garrison, and holds the 20 s capture clock.
export const wadiHalam4Plan: Plan = (sim, rt, ids, at) => {
  const apc = ids('apc_eitan');
  const ifv = ids('ifv_namer');
  const atTeam = ids('at_team');
  const st = sim.state;
  // Garrison overhaul: the firing positions (see above). Single-unit orders, so no formation
  // slot can drift a gun back inside a window's reach.
  const CACHE: [number, number] = [43, 20];
  const AT_POST: [number, number] = [47.5, 13.5];
  const EITAN_POST: [number, number] = [45.5, 13.5];
  const IFV_POST: [number, number] = [46.5, 13.5];
  const HOLD: [number, number] = [42.5, 16.5];
  // Garrison overhaul: vehicles run the north road, out of every rpg_team's reach (the only
  // threat to them here); the two militia houses it passes cannot hurt armour.
  const northRoad = (who: number[], to: [number, number]): void => {
    sim.queueCommand({ kind: 'move', ids: who, ...M(9.5, 15.5) });
    sim.queueCommand({ kind: 'move', ids: who, ...M(24.5, 13.5), append: true });
    sim.queueCommand({ kind: 'move', ids: who, ...M(31.5, 11.5), append: true });
    sim.queueCommand({ kind: 'move', ids: who, ...M(41.5, 11.5), append: true });
    sim.queueCommand({ kind: 'move', ids: who, ...M(to[0], to[1]), append: true });
  };
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: ifv, ...M(31, 23) });
    // Garrison overhaul: the at_team rides to its post (no foot route avoids the rifles).
    sim.queueCommand({ kind: 'load', ids: atTeam, carrier: apc[0] });
  });
  at(5, () => northRoad(apc, AT_POST));
  let unloaded = false;
  for (let when = 10; when <= 300; when += 1)
    at(when, () => {
      if (unloaded || apc.length === 0 || st.alive[apc[0]] !== 1) return;
      if (Math.abs(st.posX[apc[0]] / 65536 - AT_POST[0]) > 0.8 || Math.abs(st.posY[apc[0]] / 65536 - AT_POST[1]) > 0.8) return;
      unloaded = true;
      sim.queueCommand({ kind: 'unload', ids: apc });
      at(when + 3, () => sim.queueCommand({ kind: 'move', ids: apc, ...M(EITAN_POST[0], EITAN_POST[1]) }));
    });
  // Garrison overhaul: three families is the count; the IFV leaves the hall once the
  // technicals are dead (or at 60 s) and never stops beside the mid rpg_team's house.
  let leftHall = false;
  for (let when = 20; when <= 120; when += 1)
    at(when, () => {
      if (leftHall) return;
      let technicals = false;
      for (let i = 0; i < sim.entityCount; i++)
        if (st.alive[i] === 1 && st.side[i] === 1 && sim.unitTypes[st.typeIdx[i]].id === 'technical') technicals = true;
      if (technicals && when < 60) return;
      leftHall = true;
      sim.queueCommand({ kind: 'move', ids: ifv, ...M(3, 24) });
    });
  // Garrison overhaul: the IFV's autocannon is the heaviest gun here; it joins the corner once
  // the families are in.
  let ifvFree = false;
  for (let when = 30; when <= 300; when += 1)
    at(when, () => {
      if (ifvFree || rt.objectiveStatus('evac_families') === 'active') return;
      ifvFree = true;
      sim.queueCommand({ kind: 'unload', ids: ifv });
      northRoad(ifv, IFV_POST);
    });
  // 400 logistics and 80 a minute were never spent: rifles are bought as they come.
  for (let when = 1; when <= 400; when += 10) at(when, () => void rt.requestBuild('inf_squad'));
  // A shepherd that cannot move any more puts its passengers down to walk west, and the jeep
  // (which otherwise waits on the road all mission) runs the circuit in its place
  let stranded = false;
  for (let when = 10; when <= 290; when += 5)
    at(when, () => {
      if (stranded || rt.objectiveStatus('evac_families') !== 'active') return;
      if (!ifv.some((i) => sim.state.alive[i] !== 1 || sim.state.mobilityKilled[i] === 1)) return;
      stranded = true;
      const jeep = ids('jeep_shoded').concat(ids('apc_kipod'));
      sim.queueCommand({ kind: 'unload', ids: ifv.filter((i) => sim.state.alive[i] === 1) });
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(31, 23) });
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(27, 27), append: true });
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(3, 24), append: true });
    });
  // Garrison overhaul: the capture clock starts when the cache house is down, held by the
  // Eitan alone at a tile more than six from every garrison still standing.
  let holding = false;
  for (let when = 10; when <= 830; when += 1)
    at(when, () => {
      if (holding || sim.structureAt(CACHE[0], CACHE[1]) >= 0) return;
      holding = true;
      sim.queueCommand({ kind: 'move', ids: apc, ...M(HOLD[0], HOLD[1]) });
    });
};

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
// six waves (two added at 265 s and 300 s for GH-90) and three interior
// defenders now matter for the *hold*, not for slowing the demolition down.
// The second engineer team the mission reinforces at 75 s (GH-93, the
// fallback for a lost D9) is never ordered here: this plan's demolishers
// are captured at t=0 and do not need it.
//
// The demolish orders are issued straight from the start -- no staging move
// to the gate first, no polling for arrival. `Sim.applyCommands` now snaps a
// blocked goal tile (a structure's centroid always is one) to the nearest
// open tile before building the flow field, so the D9 and the engineers
// route themselves through the one-tile gate on their own, the same as any
// other `move` order would.
export const wadiHalam5Plan: Plan = (sim, _rt, ids, at) => {
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
  // GH-382: the depot is on the embankment now (walls x28-41, y4-17; the yard is zone
  // [29,5,12,12]) and its seven structures stand where the map puts them.
  const targets: [number, number][] = [
    [30, 6],
    [34, 6],
    [37, 6],
    [30, 10],
    [35, 10],
    [38, 11],
    [36, 14],
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
  // The ZU-23 on the gate (`wh_depot_gun_truck`, [31.5,14.5], holding) goes first. Its twin 23 mm
  // cannot penetrate any KDF hull here, and since 2026-10-13 its gunner knows it (target choice reads
  // the real penetration chance against the face shown, lead exception): it no longer spends its belts
  // on the Eitan and saves them for the infantry and the engineers. Until then this plan walked them
  // in at t=0 behind armour the gun was wasting itself on, and on seed 9 of the gate-open run it now
  // cut both rifle squads and the engineers down at 37-41 s, and the raze with them. So the armour
  // (which the gun cannot hurt) clears the gate, and the soft column follows once it is down.
  const gateGunAlive = (): boolean => {
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] !== 1 || sim.state.alive[i] === 0) continue;
      if (sim.unitTypes[sim.state.typeIdx[i]].id !== 'gun_truck') continue;
      const dx = sim.state.posX[i] / 65536 - 31.5;
      const dy = sim.state.posY[i] / 65536 - 14.5;
      if (dx * dx + dy * dy < 4) return true;
    }
    return false;
  };
  const armour = [...ids('apc_eitan'), ...ids('ifv_namer')];
  const soft = screen.filter((u) => !armour.includes(u));
  let softIn = false;
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: armour, ...M(33, 20) });
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(32, 27) });
    orderNext(dozer, true);
  });
  for (let when = 5; when <= 120; when += 5) {
    at(when, () => {
      if (softIn || (gateGunAlive() && when < 120)) return;
      softIn = true;
      sim.queueCommand({ kind: 'attackMove', ids: soft, ...M(33, 20) });
      orderNext(engineers, false);
    });
  }
  // Reissue cadence: 15s, comfortably longer than either demolisher's own
  // timer (D9 2s, engineers 5s), so this only ever catches a demolisher
  // that has actually finished and gone idle -- it does not interrupt one
  // still working (a fresh demolish order resets its charge timer).
  for (let when = 15; when <= 200; when += 15) {
    at(when, () => {
      orderNext(dozer, true);
      if (softIn) orderNext(engineers, false);
    });
  }
  // Once the column has a foothold, the screen advances into the compound
  // and holds there for hold_depot's clock -- re-anchored periodically for
  // the same reason II and III need it: attackMove does not mean "stand
  // here", and a wave that breaks and runs pulls a pursuing force out past
  // the zone edge.
  at(40, () => sim.queueCommand({ kind: 'attackMove', ids: softIn ? screen : armour, ...M(33, 12) }));
  // The screen steps out to the depot's south-east corner to meet what comes at the D9 there.
  // Until 2026-10-11 nobody ordered this: an attack-move that had arrived walked on by itself to
  // the nearest contact its side remembered, and at 103 s that hunt took the screen to (38,19).
  // The gate-open run lost its D9 to a mobility kill at (36,9) without it, and the raze with it.
  // A player's attack-move stops where it is sent now (the lead's ruling), so the plan says it.
  at(103, () => sim.queueCommand({ kind: 'attackMove', ids: softIn ? screen : armour, ...M(38, 19) }));
  // Since a hit suppresses (2026-10-13), a ZU-23 the screen cannot see can pin the D9 for the rest of
  // the clock: on seed 3 with the gate open a gun truck that routed out past the east wall rallied at
  // (42,8) and kept the dozer pinned at (36,9) from 150 s to 300 s while the screen stood at (33,12),
  // and the raze failed. A player sees which gun is shooting his dozer (`Picture`: identified
  // contacts only), so the carriers go and kill it, and the hold re-anchor below leaves them to it.
  const pic = new Picture(sim);
  for (let when = 2; when <= 400; when += 2) at(when, () => pic.update());
  const hunters = [...armour, ...ids('apc_kipod')];
  const gunOnDozer = (): { x: number; y: number } | undefined => {
    const d = dozer.find((u) => sim.state.alive[u] === 1);
    if (d === undefined || _rt.objectiveStatus('raze_depot') !== 'active') return undefined;
    const dx = fx.toNumber(sim.state.posX[d]);
    const dy = fx.toNumber(sim.state.posY[d]);
    return pic.identified('gun_truck').find((c) => (c.x - dx) ** 2 + (c.y - dy) ** 2 <= 12 * 12);
  };
  for (let when = 60; when <= 300; when += 10)
    at(when, () => {
      const g = gunOnDozer();
      if (g) sim.queueCommand({ kind: 'attackMove', ids: hunters, ...M(g.x, g.y) });
    });
  for (let when = 85; when <= 400; when += 45) {
    at(when, () => {
      const cur: number[] = [];
      const hunting = gunOnDozer() !== undefined;
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !(hunting && hunters.includes(i))) cur.push(i);
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(33, 12) });
    });
  }
};

/** The five plans by mission id, in the chain's order. */
export const WADI_HALAM_PLANS: Readonly<Record<(typeof WADI_HALAM_CHAIN)[number], Plan>> = {
  wadi_halam_1_fords: wadiHalam1Plan,
  wadi_halam_2_laager: wadiHalam2Plan,
  wadi_halam_3_counterraid: wadiHalam3Plan,
  wadi_halam_4_village: wadiHalam4Plan,
  wadi_halam_5_depot: wadiHalam5Plan,
};
