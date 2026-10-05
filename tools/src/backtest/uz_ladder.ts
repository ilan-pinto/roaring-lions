/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, tree-agnostic on purpose */
// Plan ladder for Umm Zeitoun II-IV (GH-382): passive / naive / sensible over many seeds.
//
//   npx tsx tools/src/backtest/uz_ladder.ts [seeds=12] [mission-id ...]
//
// Same idea as wh_ladder.ts, and the same reason: the plans are written against MARKERS AND
// ZONES, never coordinates, so ONE script runs on the old ground and the new, and that is what
// makes a before/after table honest. Run it in both trees and diff. The scripted plans in
// playtest.ts are the optimal rung and are tied to coordinates, so they are not on this ladder.
//
//   passive  - no orders.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - what a player who read the briefing would do, re-anchored every 45 s:
//     II  the whole force clears the stone knoll while the demolition party levels the post,
//         then falls back onto the crest line and holds it;
//     III the force splits (west flank on foot, east flank in armour, a rifle squad and the second
//         Eitan into the hamlet), the drone walks out to the northern crest for the man behind
//         the posts;
//     IV  the armoured escort goes to the depot yard first, the demolition parties level what
//         stands in the stockpile zone, the rest walk out to the crest for Adhal.
//
// A fresh ledger, no purchases, no `upgrades_to` gates open, 12 minute cap.
import { fx } from '../../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../../packages/sim/src/sim';
import { readFileSync } from 'node:fs';
import { ROOT, makeWorld, idsOf } from '../walk_world';

type Tier = 'passive' | 'naive' | 'sensible';
const seedsN = Number(process.argv[2] ?? 12);
const only = process.argv.slice(3);
const MISSIONS = only.length > 0 ? only : ['umm_zeitoun_2_buildup', 'umm_zeitoun_3_clearance', 'umm_zeitoun_4_clearance'];
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
  const own = () => idsOf(sim, 0);
  const typeOf = (i: number) => w.nameOf.get(sim.state.typeIdx[i]) ?? '';
  const ofType = (...t: string[]) => own().filter((i) => t.includes(typeOf(i)));
  const start0 = own().length;
  const kind = id.includes('buildup') ? 'II' : id.includes('3_') ? 'III' : 'IV';
  const demo = new Set(ofType('demo_squad'));
  const drone = new Set(ofType('recon_drone'));
  const go = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'attackMove', ids: live, ...M(p[0], p[1]) });
  };
  const structsIn = (zone: string): number[] => {
    const z = map.zones[zone] as number[];
    const seen = new Set<number>();
    for (let y = z[1]; y < z[1] + z[3]; y++) for (let x = z[0]; x < z[0] + z[2]; x++) { const s = sim.structureAt(x, y); if (s >= 0) seen.add(s); }
    return [...seen];
  };
  const razeZone: string | undefined = m.objectives.find((o: any) => o.type === 'raze' && o.primary)?.target;
  const demolishAll = () => {
    if (!razeZone) return;
    const list = structsIn(razeZone);
    const live = [...demo].filter((i) => sim.state.alive[i] === 1);
    live.forEach((u, k) => { if (list.length) sim.queueCommand({ kind: 'demolish', ids: [u], structure: list[(k * 2) % list.length] }); });
  };

  // ---- the four rungs' orders -------------------------------------------------------------
  const focus: [number, number] =
    kind === 'II' ? zc('crest_line') : kind === 'III' ? mk('hamlet_square') : mk('stockpile_yard');
  const main = () => own().filter((i) => !demo.has(i) && !drone.has(i));
  const inf = ofType('inf_squad');
  // III groups
  const west = [...inf.slice(1, 2), ...ofType('at_team', 'mortar_team', 'sniper_team')];
  const east = [...inf.slice(2), ...ofType('mbt_lavi', 'ifv_namer'), ...ofType('apc_eitan').slice(0, 1)];
  const hamlet = [...inf.slice(0, 1), ...ofType('apc_eitan').slice(1)];
  // IV groups
  const escort = ofType('mbt_lavi', 'apc_eitan');
  const walkers = [...ofType('at_team', 'mortar_team', 'sniper_team', 'inf_squad', 'ifv_namer')];
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    const s = t / TICKS_PER_SECOND;
    if (tier === 'naive' && t === 0) go(own(), focus);
    if (tier === 'sensible') {
      if (kind === 'II') {
        if (t === 1) { go(main(), mk('knoll_stone')); demolishAll(); }
        if (t % (15 * TICKS_PER_SECOND) === 0 && s >= 15) demolishAll();
        if (s >= 70 && t % (40 * TICKS_PER_SECOND) === 0) go(main(), mk('rim_crest'));
      } else if (kind === 'III') {
        if (t === 1) { go(west, mk('horn_west')); go(east, mk('horn_east')); go(hamlet, mk('hamlet_square')); }
        if (s >= 60 && t % (45 * TICKS_PER_SECOND) === 0) { go(west, mk('horn_west')); go(east, mk('horn_east')); go(hamlet, mk('hamlet_square')); }
        if (t === 1) sim.queueCommand({ kind: 'move', ids: [...drone], ...M(mk('crest')[0], mk('crest')[1] + 3) });
      } else {
        if (t === 1) go(escort, mk('stockpile_yard'));
        if (s === 45) demolishAll();
        if (s >= 45 && t % (15 * TICKS_PER_SECOND) === 0) demolishAll();
        if (s === 90) go(walkers, mk('crest'));
        if (s > 90 && t % (45 * TICKS_PER_SECOND) === 0) go(walkers, mk('crest'));
      }
    }
    runtime.step(sim.tick());
    if (runtime.result !== 'ongoing') break;
  }
  if (process.env.LADDER_V) console.log(`    ${id} ${tier} seed ${seed}: ${runtime.result} ${runtime.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}`);
  return { result: runtime.result, mins: t / TICKS_PER_SECOND / 60, lost: start0 - own().length, roe: runtime.roeScore };
}

console.log(`seeds 1..${seedsN}; tiers passive/naive/sensible; cap 12 min; tree ${ROOT}`);
for (const id of MISSIONS) {
  for (const tier of ['passive', 'naive', 'sensible'] as Tier[]) {
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
