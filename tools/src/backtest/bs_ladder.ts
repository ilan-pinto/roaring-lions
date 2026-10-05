/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, tree-agnostic on purpose */
// Plan ladder for Beit Sahwan II-IV (GH-382): passive / naive / sensible over many seeds.
//
//   npx tsx tools/src/backtest/bs_ladder.ts [seeds=12] [mission-id ...]
//
// Same idea as da_ladder.ts: the plans are written against ZONES, MARKERS, PLACEMENT TAGS AND THE
// MAP'S OWN TUNNEL LIST, never coordinates, so ONE script runs on the old ground and the new, and
// that is what makes a before/after table honest. Run it in both trees and diff.
//
//   passive  - no orders.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - what a player who read the briefing would do, re-anchored every 45 s:
//     II   the whole force holds the middle of the hold zone; the mortar and the drone stay back;
//          one logistics buy at 120 s;
//     III  the drone flies to the square, the infantry, the Eitan and the engineers take the town
//          centre, the armour holds a boulevard short of the square until 85 s and then goes for
//          the ATGM cell;
//     IV   the Namer shepherds the people at the start to the collection point; the escort takes
//          the shaft head; each Yahalom team takes two routes (mouths in the objective's zone,
//          in the map's own order), charging from the mouth once it stands within two and a half
//          tiles.
//
// A fresh ledger, no purchases, no `upgrades_to` gates open, 12 minute cap.
import { fx } from '../../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../../packages/sim/src/sim';
import { readFileSync } from 'node:fs';
import { ROOT, makeWorld, idsOf } from '../walk_world';

type Tier = 'passive' | 'naive' | 'sensible';
const seedsN = Number(process.argv[2] ?? 12);
const only = process.argv.slice(3);
const MISSIONS = only.length > 0 ? only : ['beit_sahwan_2_foothold', 'beit_sahwan_3_clearance', 'beit_sahwan_4_subterranean'];
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const CAP_TICKS = 12 * 60 * TICKS_PER_SECOND;

function run(id: string, tier: Tier, seed: number): { result: string; mins: number; lost: number; roe: number } {
  const w = makeWorld(id, { seed });
  const { sim, runtime, mission } = w;
  const m: any = mission;
  const map = JSON.parse(readFileSync(`${ROOT}/data/maps/${m.map.file}.json`, 'utf8'));
  const mk = (n: string): [number, number] => map.markers[n];
  const zc = (n: string): [number, number] => {
    const z = map.zones[n] as number[];
    return [z[0] + Math.floor(z[2] / 2), z[1] + Math.floor(z[3] / 2)];
  };
  const tagAt = (tag: string): [number, number] => {
    const p = m.enemy.garrison.find((g: any) => g.tag === tag);
    return [Math.floor(p.at[0]), Math.floor(p.at[1])];
  };
  const own = () => idsOf(sim, 0);
  const typeOf = (i: number) => w.nameOf.get(sim.state.typeIdx[i]) ?? '';
  const ofType = (...t: string[]) => own().filter((i) => t.includes(typeOf(i)));
  const start0 = own().length;
  const kind = id.startsWith('beit_sahwan_2') ? 'II' : id.startsWith('beit_sahwan_3') ? 'III' : 'IV';
  const go = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'attackMove', ids: live, ...M(p[0], p[1]) });
  };
  const walk = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'move', ids: live, ...M(p[0], p[1]) });
  };
  const yahalom = ofType('yahalom_squad');
  const drone = ofType('recon_drone');
  const mortar = ofType('mortar_team');
  const inf = ofType('inf_squad');
  const eitan = ofType('apc_eitan');
  const namer = ofType('ifv_namer');
  const armour = ofType('mbt_lavi', 'ifv_namer');
  const demo = ofType('demo_squad');
  const atTeam = ofType('at_team');
  const start = own().length ? ([Math.floor(Number(sim.state.posX[own()[0]]) / 65536), Math.floor(Number(sim.state.posY[own()[0]]) / 65536)] as [number, number]) : ([0, 0] as [number, number]);

  // One state slot per charge team.
  const state = new Map<number, { k: number; phase: 'go' | 'charge'; since: number }>();
  let focus: [number, number];
  let routes: { idx: number; mouth: [number, number] }[] = [];
  if (kind === 'II') focus = zc('west_approach');
  else if (kind === 'III') focus = mk('town_center');
  else {
    focus = zc('shaft_head');
    const cz = map.zones.town as number[];
    routes = (map.tunnels as any[])
      .map((tn, idx) => ({ idx, mouth: tn.mouth as [number, number] }))
      .filter((r) => r.mouth[0] >= cz[0] && r.mouth[0] < cz[0] + cz[2] && r.mouth[1] >= cz[1] && r.mouth[1] < cz[1] + cz[3]);
  }
  const hvt: [number, number] | null = kind === 'III' ? tagAt('bs_hvt_atgm') : null;
  const squareHold: [number, number] | null = kind === 'III' ? zc('town') : null;
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    const s = t / TICKS_PER_SECOND;
    if (tier === 'naive' && t === 0) go(own(), focus);
    if (tier === 'sensible') {
      if (kind === 'II') {
        if (t === 1) { go(own().filter((i) => !drone.includes(i) && !mortar.includes(i)), focus); walk(drone, start); walk(mortar, start); }
        if (s > 45 && t % (45 * TICKS_PER_SECOND) === 0) go(own().filter((i) => !drone.includes(i) && !mortar.includes(i)), focus);
        if (t === 120 * TICKS_PER_SECOND) void runtime.requestBuild('inf_squad');
      } else if (kind === 'III') {
        const light = [...inf, ...eitan, ...demo];
        if (t === 1) {
          walk(drone, [squareHold![0], squareHold![1] - 4]);
          go(light, squareHold!);
          go(atTeam, squareHold!);
          // the armour holds the boulevard west of the square until it is time
          go(armour, [mk('town_center')[0] - 12, mk('town_center')[1]]);
        }
        if (t === 85 * TICKS_PER_SECOND) go(armour, hvt!);
        if (s > 90 && t % (45 * TICKS_PER_SECOND) === 0) { go(light, squareHold!); go(armour, hvt!); }
      } else {
        const west = [yahalom[0]];
        const east = [yahalom[1]];
        const escort = [...inf, ...eitan];
        if (t === 1) {
          walk(namer, mk('civ_collection'));
          go(escort, focus);
          walk(drone, [focus[0], focus[1] + 8]);
        }
        // Routes nearest the start first; the two teams alternate down that list. Each team is
        // ordered to charge its next route directly (the command walks the team to the route's own
        // polyline) once the last one is down, the second team 25 s behind the first.
        const near = [...routes].sort((a, b) => Math.hypot(a.mouth[0] - start[0], a.mouth[1] - start[1]) - Math.hypot(b.mouth[0] - start[0], b.mouth[1] - start[1]));
        const rA = near.filter((_, i) => i % 2 === 0);
        const rB = near.filter((_, i) => i % 2 === 1);
        const direct = (team: number[], rs: { idx: number }[], delay: number) => {
          const live = team.filter((i) => sim.state.alive[i] === 1);
          if (!live.length || s < delay) return;
          let st = state.get(team[0]);
          if (!st) { st = { k: 0, phase: 'go', since: t }; state.set(team[0], st); sim.queueCommand({ kind: 'chargeTunnel', ids: live, tunnel: rs[0].idx }); }
          if (st.k >= rs.length - 1 && (sim.tnAlive[rs[st.k].idx] === 0)) return;
          if (sim.tnAlive[rs[st.k].idx] === 0 || t - st.since > 80 * TICKS_PER_SECOND) {
            if (st.k < rs.length - 1) { st.k++; st.since = t; sim.queueCommand({ kind: 'chargeTunnel', ids: live, tunnel: rs[st.k].idx }); }
          }
        };
        direct(west, rA, 5);
        direct(east, rB, 30);
        if (s > 90 && t % (45 * TICKS_PER_SECOND) === 0) go(escort, focus);
      }
    }
    runtime.step(sim.tick());
    if (process.env.LADDER_D && t % (20 * TICKS_PER_SECOND) === 0) console.log(`      t=${t / TICKS_PER_SECOND} ${runtime.objectiveList.map((o: any) => `${o.id}=${o.status[0]}${o.paused ? '(' + o.paused + ')' : ''}${o.holdTicks ?? ''}`).join(' ')} own=${own().length}`);
    if (runtime.result !== 'ongoing') break;
  }
  if (process.env.LADDER_V) console.log(`    ${id} ${tier} seed ${seed}: ${runtime.result} ${runtime.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}`);
  return { result: runtime.result, mins: t / TICKS_PER_SECOND / 60, lost: start0 - own().length, roe: runtime.roeScore };
}

console.log(`seeds 1..${seedsN}; tiers passive/naive/sensible; cap 12 min; tree ${ROOT}`);
for (const id of MISSIONS) {
  for (const tier of (['passive', 'naive', 'sensible'] as Tier[]).filter((x) => !process.env.LADDER_TIER || x === process.env.LADDER_TIER)) {
    const rs = Array.from({ length: seedsN }, (_, k) => run(id, tier, k + 1));
    const wins = rs.filter((r) => r.result === 'victory').length;
    const avg = (f: (r: (typeof rs)[number]) => number, sel = rs) => (sel.length ? sel.reduce((a, r) => a + f(r), 0) / sel.length : NaN);
    const won = rs.filter((r) => r.result === 'victory');
    console.log(
      `${id.padEnd(26)} ${tier.padEnd(8)} win ${String(wins).padStart(2)}/${seedsN} (${((100 * wins) / seedsN).toFixed(0).padStart(3)}%)  ` +
        `min(all) ${avg((r) => r.mins).toFixed(1)}  min(won) ${avg((r) => r.mins, won).toFixed(1)}  lost ${avg((r) => r.lost).toFixed(1)}  roe ${avg((r) => r.roe).toFixed(0)}`
    );
  }
}
