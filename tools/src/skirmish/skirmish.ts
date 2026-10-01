// G0 skirmish spike harness (GH-187). THROWAWAY -- scratch branch only.
//
// One map (Tel Marum III's ground), one doctrine (Sarim standoff), a utility
// commander against four scripted KDF plans over ten seeds, scored against the
// criteria fixed in docs/superpowers/specs/2026-10-01-skirmish-spike-report.md
// BEFORE this file existed.
//
// Run: npx tsx tools/src/skirmish/skirmish.ts [--quick] [--cost] [--determinism]

import {
  Sim,
  fx,
  TICKS_PER_SECOND,
  MissionRuntime,
  Commander,
  type MissionJson,
  type PlacementJson,
  type TunnelRouteJson,
  type DoctrineJson,
  type CommanderDecision,
} from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';
import doctrineR1 from './sarim_standoff.doctrine.json';
import doctrineR2 from './sarim_standoff_r2.doctrine.json';
/** SK_ROUND=1 reproduces round 1's doctrine exactly. */
const doctrineJson = process.env.SK_ROUND === '1' ? doctrineR1 : doctrineR2;

export const DOCTRINE: DoctrineJson = {
  ...(doctrineJson as unknown as DoctrineJson),
  // Sweep hook: SK_DOC='{"attack_ratio_pct":150}' overrides top-level fields.
  ...(process.env.SK_DOC ? (JSON.parse(process.env.SK_DOC) as Partial<DoctrineJson>) : {}),
};
/** The skirmish's income ground: the doctrine's zones less its watch routes. */
export const INCOME_ZONES = DOCTRINE.zones.filter((z) => z.watch !== true);
export const SEEDS = process.env.SK_SEEDS === 'alt'
  ? [11, 23, 101, 977, 4242, 7777, 31415, 27182, 16180, 90210, 13, 29, 313, 2718, 6006, 8081, 12345, 54321, 99, 777]
  : [424242, 7, 1009, 31337, 65521, 99991, 123456, 2024, 555, 8888];
const GAME_TICKS = 7 * 60 * TICKS_PER_SECOND;
const TM3 = missions.tel_marum_3_clearance as unknown as MissionJson;
const MAP_FILE = 'tel_marum_3';
/** Points the KDF earns for the battery (Deviation D-1). */
const BATTERY_PRIZE = 120;
const DEBUG = process.env.SK_DEBUG === '1';
export const FIRE = new Map<string, number>();

/** Spike-only markers: one holding point and one standoff point per income
 *  zone, and a reserve. Everything else is the map's own. */
const SK_MARKERS: Record<string, number[]> = {
  sk_pass_back: [24, 8],
  sk_west: [10, 8],
  sk_west_back: [12, 5],
  sk_east: [35, 7],
  sk_east_back: [35, 4],
  sk_reserve: [21, 3],
};

const BASE_FORCE: PlacementJson[] = [
  { unit: 'atgm_cell', count: 1, at: [20.5, 4.5] },
  { unit: 'atgm_cell', count: 1, at: [30.5, 4.5] },
  { unit: 'sarim_rifles', count: 1, at: [22.5, 5.5] },
  { unit: 'sarim_rifles', count: 1, at: [28.5, 5.5] },
  { unit: 'sarim_rifles', count: 1, at: [14.5, 4.5] },
  { unit: 'recoilless_team', count: 1, at: [26.5, 8.5] },
  { unit: 'manpad_team', count: 1, at: [23.5, 8.5] },
  { unit: 'rocket_battery', count: 1, at: [25.5, 6.5], tag: 'sk_hq' },
];
/** Deviation D-2: the commander's opening force is Tel Marum III's garrison
 *  PLUS this. The garrison alone is a mission's enemy, sized to lose; it was
 *  wiped by the naive rush in under 100 s with one KDF loss. */
const EXTRA_FORCE: PlacementJson[] = [
  { unit: 'atgm_cell', count: 1, at: [18.5, 3.5] },
  { unit: 'atgm_cell', count: 1, at: [32.5, 3.5] },
  { unit: 'sarim_rifles', count: 1, at: [16.5, 6.5] },
  { unit: 'sarim_rifles', count: 1, at: [33.5, 6.5] },
  { unit: 'recoilless_team', count: 1, at: [20.5, 8.5] },
];
/** Deviation D-3: the KDF skirmish force. Tel Marum III's starting force is a
 *  campaign force, ~5,000 logistics against a garrison sized to lose; a
 *  skirmish is a budget, so the KDF fields ~2,950 here (one of each vehicle
 *  role, the foot) against the commander's ~3,460 plus income -- a defender's
 *  edge. `SK_KDF=tm3` restores the mission force for comparison. */
const KDF_FORCE: PlacementJson[] = [
  { unit: 'inf_squad', count: 3, at: [24, 44] },
  { unit: 'at_team', count: 1, at: [27, 44] },
  { unit: 'mbt_lavi', count: 1, at: [26, 45] },
  { unit: 'apc_eitan', count: 1, at: [22, 45] },
  { unit: 'mortar_team', count: 1, at: [24, 46] },
  { unit: 'recon_drone', count: 1, at: [22, 43] },
];
/** Control for "is it the commander or the force?": the commander's whole
 *  opening force dug in together at the pass mouth, no commander, no waves. */
const massedForce = (): PlacementJson[] => {
  // The commander's own opening force, same bodies, dug in as one block.
  const order = ['atgm_cell', 'recoilless_team', 'sarim_rifles', 'manpad_team'];
  const bodies = COMMANDER_FORCE.filter((p) => p.unit !== 'rocket_battery').sort(
    (a, b) => order.indexOf(a.unit) - order.indexOf(b.unit),
  );
  const out: PlacementJson[] = bodies.map((p, k) => ({
    unit: p.unit, count: 1, facing_deg: 180,
    at: [21.5 + (k % 7), 8.5 + ((k - (k % 7)) >> 0) / 7],
    ...(p.unit === 'recoilless_team' ? { stance: { kind: 'ambush', tiles: 4 } } : {}),
  }));
  out.push({ unit: 'rocket_battery', count: 1, at: [25.5, 6.5], tag: 'sk_hq' });
  return out;
};
/** The commander arm's opening force: Tel Marum III's garrison, the same eight
 *  bodies, gathered in the rear instead of placed. The commander deploys them. */
const COMMANDER_FORCE: PlacementJson[] = process.env.SK_MASSED_AS_COMMANDER ? [] : [
  ...BASE_FORCE,
  ...extraForce(Number(process.env.SK_EXTRA ?? '1')),
];
/** `n` copies of EXTRA_FORCE, each a row further north. */
function extraForce(n: number): PlacementJson[] {
  const out: PlacementJson[] = [];
  for (let k = 0; k < n; k++) {
    const take = n - k >= 1 ? EXTRA_FORCE.length : Math.round((n - k) * EXTRA_FORCE.length);
    for (const p of EXTRA_FORCE.slice(0, take)) out.push({ ...p, at: [p.at![0], p.at![1] - (k % 3)] });
  }
  return out;
}

export type PlanName = 'passive' | 'naive' | 'flank' | 'good' | 'concentrated';
export type Arm = 'commander' | 'static' | 'massed';

type At = (s: number, fn: () => void) => void;
type Ids = (t: string) => number[];
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

function planOrders(plan: PlanName, sim: Sim, ids: Ids, at: At): void {
  const tanks = ids('mbt_lavi');
  const namer = ids('ifv_namer');
  const carriers = ids('apc_eitan');
  const drone = ids('recon_drone');
  const squads = ids('inf_squad');
  const at_ = ids('at_team');
  const mortar = ids('mortar_team');
  const legs = [...squads, ...at_, ...mortar];
  const all = [...tanks, ...namer, ...carriers, ...legs];
  const q = (kind: 'move' | 'attackMove', who: number[], x: number, y: number, append = false) =>
    sim.queueCommand({ kind, ids: who, ...M(x, y), append });
  // Deviation D-4: the foot's flank route hugs the west wall, then enters the
  // corridor. The first cut walked the flow field's diagonal from the start
  // line, straight past the commander's forward screen, and died in the open
  // valley in every seed of BOTH arms -- never reaching the corridor at all.
  const westRoute = (who: number[]) => {
    q('move', who, 8, 38);
    q('move', who, 7, 24, true);
    q('move', who, 10, 12, true);
  };
  if (plan === 'passive') return;
  if (plan === 'naive') {
    at(2, () => q('attackMove', [...all, ...drone], 25, 6));
    return;
  }
  if (plan === 'flank') {
    // The foot walks the corridor; the armour sits at home.
    at(2, () => westRoute([...squads, ...at_]));
    at(2, () => q('move', drone, 10, 9));
    at(75, () => q('attackMove', [...squads, ...at_], 10, 8));
    at(130, () => q('attackMove', [...squads, ...at_], 25, 6));
    return;
  }
  if (plan === 'concentrated') {
    // Supplementary plan (not the criteria's `good`): one fist, eyes and
    // indirect fire first, then take ground in bounds and spread for income
    // only once the defence is broken. No corridor.
    const fist = [...tanks, ...carriers, ...squads, ...at_];
    at(2, () => q('move', drone, 24, 19));
    at(4, () => q('move', mortar, 24, 30));
    at(5, () => q('attackMove', fist, 24, 26));
    at(100, () => q('attackMove', fist, 24, 17));
    at(100, () => q('move', mortar, 24, 25));
    at(160, () => q('move', drone, 25, 10));
    at(170, () => q('attackMove', fist, 25, 9));
    at(240, () => q('attackMove', squads.slice(0, 1), 10, 8));
    at(240, () => q('attackMove', squads.slice(1, 2), 35, 7));
    return;
  }
  // good: eyes first, the armour takes the approach and pins the pass, the
  // foot takes the corridor and the west ground, then everything converges.
  at(2, () => q('move', drone, 24, 17));
  at(2, () => westRoute([...squads, ...at_]));
  at(4, () => q('move', mortar, 24, 27));
  at(5, () => q('attackMove', [...tanks, ...namer], 24, 23));
  at(5, () => q('move', carriers, 24, 26));
  at(60, () => q('move', drone, 18, 9));
  at(75, () => q('attackMove', [...squads, ...at_], 10, 8));
  at(95, () => q('attackMove', tanks, 28, 16));
  at(95, () => q('attackMove', namer, 20, 16));
  at(120, () => q('attackMove', carriers, 24, 18));
  at(150, () => q('attackMove', [...tanks, ...namer], 24, 12));
  at(150, () => q('attackMove', [...squads, ...at_], 20, 7));
  at(190, () => q('attackMove', [...tanks, ...namer, ...squads, ...at_], 25, 6));
  at(190, () => q('move', drone, 25, 9));
}

export interface GameResult {
  seed: number;
  plan: PlanName;
  arm: Arm;
  winner: 'kdf' | 'sarim';
  reason: 'kdf_wiped' | 'sarim_wiped' | 'points';
  endTick: number;
  points: [number, number];
  /** Holder per zone at 120 s: 0 KDF, 1 Sarim, -1 contested/empty. */
  heldAt120: number[];
  captures: { zone: string; tick: number; answered: boolean }[];
  flankContactTick: number;
  flankAnsweredTick: number;
  westContactTick: number;
  westAnsweredTick: number;
  flankHpLost: number;
  flankHpStart: number;
  trace: CommanderDecision[];
  hash: number;
  waves: number;
  kdfLost: number;
  sarimLost: number;
  batteryKilled: boolean;
  budgetLeft: number;
}

export function play(seed: number, plan: PlanName, arm: Arm, shiftS = 0): GameResult {
  const map = parseMap(maps[MAP_FILE as keyof typeof maps]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id, points: t.points, dig_tiles_per_s: t.digTilesPerS, pre_dug: t.preDug,
  }));
  for (const r of tunnelRoutes) sim.addTunnel(r);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));

  const kdf = process.env.SK_KDF === 'tm3' ? (TM3.starting_force ?? []).map((p) => ({ ...p, from_ledger: false })) : KDF_FORCE;
  const mission: MissionJson = {
    id: 'skirmish_tel_marum',
    map: { file: MAP_FILE },
    ledger: { requires: [], produces: [] },
    objectives: [],
    starting_force: kdf,
    roe: { enabled: false },
    enemy:
      arm === 'static'
        ? { faction: 'sarim', garrison: TM3.enemy?.garrison ?? [], waves: TM3.enemy?.waves ?? [] }
        : arm === 'massed'
        ? { faction: 'sarim', garrison: massedForce(), waves: [] }
        : { faction: 'sarim', garrison: COMMANDER_FORCE, waves: [] },
  };
  const markers = { ...map.markers, ...SK_MARKERS };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger: {},
  });
  rt.start();
  const cmd = arm === 'commander' ? new Commander(sim, rt, DOCTRINE, markers, seed) : null;
  cmd?.adopt();

  const st = sim.state;
  const ids: Ids = (t) => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (st.side[i] === 0 && st.alive[i] === 1 && sim.unitTypes[st.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  let battery = -1;
  for (let i = 0; i < sim.entityCount; i++)
    if (st.side[i] === 1 && sim.unitTypes[st.typeIdx[i]].id === 'rocket_battery') battery = i;
  const flankers = [...ids('inf_squad'), ...ids('at_team')];
  const flankHpStart = flankers.reduce((a, id) => a + st.hp[id] / 65536, 0);
  const kdfStart = sim.entityCount;
  void kdfStart;

  const timed: [number, () => void][] = [];
  planOrders(plan, sim, ids, (s, fn) => {
    const t = s < 5 ? s : s + shiftS;
    timed.push([(t < 1 ? 1 : t) * TICKS_PER_SECOND, fn]);
  });

  const zones = INCOME_ZONES;
  const holder = zones.map(() => -1);
  const heldAt120 = zones.map(() => -1);
  const points: [number, number] = [0, 0];
  const captures: GameResult['captures'] = [];
  let flankContactTick = -1;
  let westContactTick = -1;
  let batteryPaid = false;
  let winner: GameResult['winner'] = 'sarim';
  let reason: GameResult['reason'] = 'points';
  let t = 1;
  const isGround = (i: number) => st.alive[i] === 1 && st.tunnelIn[i] < 0 && !sim.unitTypes[st.typeIdx[i]].isAir;
  for (; t <= GAME_TICKS; t++) {
    for (const [when, fn] of timed) if (when === t) fn();
    const evs = sim.tick();
    if (DEBUG) {
      for (const e of evs) {
        if (e.kind === 'fire' && st.side[e.shooter] === 1) { const k = sim.unitTypes[st.typeIdx[e.shooter]].id + (e.willHit ? ':hit' : ':miss'); FIRE.set(k, (FIRE.get(k) ?? 0) + 1); }
        if (e.kind === 'aps') { const k = 'aps:' + (e.intercepted ? 'stop' : 'leak'); FIRE.set(k, (FIRE.get(k) ?? 0) + 1); }
        if (e.kind === 'impact' && st.side[e.shooter] === 1) { const k = 'impact:' + e.weaponId + (e.penetrated ? ':pen' : ':nopen'); FIRE.set(k, (FIRE.get(k) ?? 0) + 1); }
        if (e.kind !== 'destroyed') continue;
        const nm = (i: number) => (i >= 0 ? `${sim.unitTypes[st.typeIdx[i]].id}#${i}@${st.posX[i] >> 16},${st.posY[i] >> 16}` : '?');
        console.log(`  t=${(sim.tickCount / 20).toFixed(1)} side${st.side[e.entity]} ${nm(e.entity)} by ${nm(e.by)}`);
      }
    }
    rt.step(evs);
    cmd?.step(sim.tickCount);
    // Flank sighting: Sarim contact on a KDF unit in the corridor or the NW.
    if (westContactTick < 0) {
      for (const id of flankers) {
        if (st.alive[id] !== 1 || sim.contactLevel(1, id) < 1) continue;
        const seen = sim.lastSeenOf(1, id);
        if (seen && seen[0] >> 16 <= 16) { westContactTick = sim.tickCount; break; }
      }
    }
    if (flankContactTick < 0) {
      for (const id of flankers) {
        if (st.alive[id] !== 1 || sim.contactLevel(1, id) < 1) continue;
        const seen = sim.lastSeenOf(1, id);
        if (seen && seen[0] >> 16 <= 16 && seen[1] >> 16 <= 18) {
          flankContactTick = sim.tickCount;
          break;
        }
      }
    }
    if (t % TICKS_PER_SECOND === 0) {
      for (let z = 0; z < zones.length; z++) {
        const r = zones[z].rect;
        const n = [0, 0];
        for (let i = 0; i < sim.entityCount; i++) {
          if (st.side[i] > 1 || !isGround(i)) continue;
          const tx = st.posX[i] >> 16;
          const ty = st.posY[i] >> 16;
          if (tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3]) n[st.side[i]]++;
        }
        const h = n[0] > 0 && n[1] === 0 ? 0 : n[1] > 0 && n[0] === 0 ? 1 : -1;
        if (h === 0 && holder[z] !== 0) captures.push({ zone: zones[z].id, tick: sim.tickCount, answered: false });
        holder[z] = h;
        if (h === 0) points[0]++;
        else if (h === 1) points[1]++;
        if (h === 1) cmd?.credit(1);
      }
      if (t === 120 * TICKS_PER_SECOND) for (let z = 0; z < zones.length; z++) heldAt120[z] = holder[z];
      // End conditions.
      let kdfGround = 0;
      let sarim = 0;
      for (let i = 0; i < sim.entityCount; i++) {
        if (st.alive[i] !== 1) continue;
        if (st.side[i] === 0 && isGround(i)) kdfGround++;
        if (st.side[i] === 1) sarim++;
      }
      // Deviation D-1 (see the report): the battery is a points prize, not
      // the end of the game. As an instant win it ended every naive game in
      // under 45 s, under both arms.
      if (battery >= 0 && st.alive[battery] !== 1 && !batteryPaid) { points[0] += BATTERY_PRIZE; batteryPaid = true; }
      if (kdfGround === 0) { winner = 'sarim'; reason = 'kdf_wiped'; break; }
      if (sarim === 0) { winner = 'kdf'; reason = 'sarim_wiped'; break; }
    }
  }
  if (reason === 'points') winner = points[0] > points[1] ? 'kdf' : 'sarim';

  const trace = cmd?.trace ?? [];
  for (const c of captures) {
    c.answered = trace.some(
      (d) => d.task === c.zone && d.kind !== 'stance' && d.tick >= c.tick - 200 && d.tick <= c.tick + 600,
    );
  }
  let flankAnsweredTick = -1;
  if (flankContactTick >= 0) {
    const hit = trace.find(
      (d) =>
        (d.task === 'inc_west' || d.task === 'hq') &&
        d.kind !== 'stance' && d.n > 0 &&
        d.tick >= flankContactTick && d.tick <= flankContactTick + 600,
    );
    if (hit) flankAnsweredTick = hit.tick;
  }
  let westAnsweredTick = -1;
  if (westContactTick >= 0) {
    const hit = trace.find(
      (d) => (d.task === 'inc_west' || d.task === 'hq' || d.task === 'watch_corridor') &&
        d.kind !== 'stance' && d.n > 0 && d.tick >= westContactTick && d.tick <= westContactTick + 600,
    );
    if (hit) westAnsweredTick = hit.tick;
  }
  const flankHpLost = flankHpStart - flankers.reduce((a, id) => a + (st.alive[id] === 1 ? st.hp[id] / 65536 : 0), 0);
  let kdfLost = 0;
  let sarimLost = 0;
  for (let i = 0; i < sim.entityCount; i++) {
    if (st.alive[i] === 1 || st.side[i] > 1) continue;
    if (st.side[i] === 0) kdfLost++;
    else sarimLost++;
  }
  return {
    seed, plan, arm, winner, reason, endTick: t, points, heldAt120, captures,
    flankContactTick, flankAnsweredTick, westContactTick, westAnsweredTick, flankHpLost, flankHpStart, trace,
    hash: sim.hash(), waves: trace.filter((d) => d.kind === 'wave').length, kdfLost, sarimLost, batteryKilled: batteryPaid, budgetLeft: cmd?.budget ?? 0,
  };
}

const traceKey = (tr: CommanderDecision[]) => tr.map((d) => `${d.tick}:${d.kind}:${d.task}:${d.n}`).join('|');

/** Per-tick cost at 300 living units: 150 KDF a-moving north into 150 Sarim
 *  under the commander. Times sim.tick and the commander separately. */
function cost(seed: number, withCommander: boolean): { tick: number[]; think: number[]; living: number; alive: number[]; spawned: number } {
  const map = parseMap(maps[MAP_FILE as keyof typeof maps]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 512 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) sim.addStructure(structIdx.get(b.type) as number, b.tiles);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const grid = (types: string[], y0: number, y1: number): PlacementJson[] => {
    const out: PlacementJson[] = [];
    let k = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = 8; x <= 40; x += 1) {
        if (out.length >= 150) return out;
        if (sim.blocked[y * map.width + x] !== 0 || sim.blockedVehicle[y * map.width + x] !== 0) continue;
        out.push({ unit: types[k++ % types.length], count: 1, at: [x + 0.5, y + 0.5] });
      }
    }
    return out;
  };
  const kdfTypes = ['inf_squad', 'inf_squad', 'inf_squad', 'at_team', 'inf_squad', 'mbt_lavi', 'inf_squad', 'apc_eitan', 'inf_squad', 'mortar_team', 'ifv_namer', 'inf_squad', 'at_team', 'inf_squad', 'inf_squad'];
  const sarTypes = ['sarim_rifles', 'atgm_cell', 'sarim_rifles', 'recoilless_team', 'sarim_rifles', 'manpad_team', 'atgm_cell', 'sarim_rifles'];
  const garrison = grid(sarTypes, 0, 9).slice(0, 149);
  garrison.push({ unit: 'rocket_battery', count: 1, at: [25.5, 6.5] });
  const mission: MissionJson = {
    id: 'skirmish_cost', map: { file: MAP_FILE }, ledger: { requires: [], produces: [] }, objectives: [],
    starting_force: grid(kdfTypes, 28, 47), roe: { enabled: false },
    enemy: { faction: 'sarim', garrison, waves: [] },
  };
  const markers = { ...map.markers, ...SK_MARKERS };
  const rt = new MissionRuntime(sim, mission, { typeIdOf: (u) => typeOf.get(u) as number, markers, zones: map.zones, ledger: {} });
  rt.start();
  const cmd = withCommander ? new Commander(sim, rt, DOCTRINE, markers, seed) : null;
  cmd?.adopt();
  const kdf: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0) kdf.push(i);
  const tick: number[] = [];
  const think: number[] = [];
  const alive: number[] = [];
  const spawned = sim.entityCount;
  let living = 0;
  // Hold everyone still for the first 200 ticks: 300 living units, the
  // commander deploying, nobody dying. Then the KDF attack.
  sim.queueCommand({ kind: 'halt', ids: kdf });
  for (let t = 1; t <= 1200; t++) {
    if (t === 201) sim.queueCommand({ kind: 'attackMove', ids: kdf, ...M(25, 6) });
    const a = performance.now();
    const evs = sim.tick();
    rt.step(evs);
    const b = performance.now();
    cmd?.step(sim.tickCount);
    const c = performance.now();
    tick.push(b - a);
    if (sim.tickCount % DOCTRINE.think_ticks === 1) think.push(c - b);
    let al = 0;
    for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) al++;
    alive.push(al);
    if (t === 200) for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) living++;
  }
  return { tick, think, living, alive, spawned };
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if (args.has('--cost')) {
    const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const withC of [false, true, false, true, false, true]) {
      const r = cost(SEEDS[0], withC);
      const full = r.tick.map((v, i) => [v, r.alive[i]] as const).filter(([, a], i) => i >= 20 && a >= 290).map(([v]) => v);
      const hold = full;
      const holdThink = r.think.filter((_, k) => r.alive[k * DOCTRINE.think_ticks] >= 290);
      console.log(`  spawned ${r.spawned}, ticks with >=290 alive: ${full.length}`);
      console.log(
        `${withC ? 'commander' : 'no commander'}: living@200 ${r.living}; ticks with >=290 alive mean ${mean(hold).toFixed(2)} p95 ${q(hold, 0.95).toFixed(2)} ms; whole 60 s mean ${mean(r.tick).toFixed(2)} p95 ${q(r.tick, 0.95).toFixed(2)} ms` +
          (withC ? `; think @300 mean ${mean(holdThink).toFixed(3)} max ${Math.max(...holdThink).toFixed(3)} ms; think all mean ${mean(r.think).toFixed(3)} p95 ${q(r.think, 0.95).toFixed(3)} max ${Math.max(...r.think).toFixed(3)} (n ${r.think.length}); amortised ${(mean(r.think) / DOCTRINE.think_ticks).toFixed(4)} ms/tick` : ''),
      );
    }
    return;
  }
  const seeds = args.has('--quick') ? SEEDS.slice(0, 3) : SEEDS;
  if (args.has('--determinism')) {
    for (const plan of ['naive', 'good'] as PlanName[]) {
      const a = play(SEEDS[0], plan, 'commander');
      const b = play(SEEDS[0], plan, 'commander');
      const same = a.hash === b.hash && a.points.join() === b.points.join() && traceKey(a.trace) === traceKey(b.trace);
      console.log(`determinism ${plan}: hash ${a.hash >>> 0} vs ${b.hash >>> 0}, trace ${a.trace.length} decisions -> ${same ? 'IDENTICAL' : 'DIVERGED'}`);
      if (!same) process.exitCode = 1;
    }
    return;
  }
  const verbose = args.has('--verbose');
  const runs = new Map<string, GameResult[]>();
  const sweep = (plan: PlanName, arm: Arm, shift = 0) => {
    const key = `${plan}/${arm}${shift ? `/${shift > 0 ? '+' : ''}${shift}s` : ''}`;
    const rs = seeds.map((s) => play(s, plan, arm, shift));
    runs.set(key, rs);
    const wins = rs.filter((r) => r.winner === 'kdf').length;
    const why = rs.map((r) => `${r.winner === 'kdf' ? 'W' : 'L'}:${r.reason[0]}${(r.endTick / 1200).toFixed(1)}${r.batteryKilled ? '*' : ''}`).join(' ');
    const pts = rs.map((r) => `${r.points[0]}/${r.points[1]}`).join(' ');
    console.log(`${key.padEnd(22)} KDF wins ${wins}/${rs.length}  [${why}]`);
    console.log(`${''.padEnd(22)} points kdf/sarim ${pts}`);
    console.log(`${''.padEnd(22)} losses kdf/sarim ${rs.map((r) => `${r.kdfLost}/${r.sarimLost}`).join(' ')}  waves ${rs.map((r) => r.waves).join(',')}  budget left ${rs.map((r) => r.budgetLeft).join(',')}`);
    if (verbose) for (const r of rs) console.log(`   seed ${r.seed}: ${traceKey(r.trace).slice(0, 600)}`);
    return rs;
  };
  const only = [...args].find((a) => a.startsWith('--only='))?.slice(7).split(',');
  if (only) {
    const arm = ([...args].find((a) => a.startsWith('--arm='))?.slice(6) ?? 'commander') as Arm;
    for (const p of only) sweep(p as PlanName, arm);
    return;
  }
  const passive = sweep('passive', 'commander');
  const naive = sweep('naive', 'commander');
  const flank = sweep('flank', 'commander');
  const good = sweep('good', 'commander');
  const flankStatic = sweep('flank', 'static');
  sweep('naive', 'static');
  sweep('good', 'static');
  const conc = sweep('concentrated', 'commander');
  sweep('concentrated', 'static');
  const early = sweep('good', 'commander', -15);
  const late = sweep('good', 'commander', 15);

  const n = seeds.length;
  const wins = (rs: GameResult[]) => rs.filter((r) => r.winner === 'kdf').length;
  const south = INCOME_ZONES.map((z) => z.forward === true);
  console.log('\n=== criteria ===');
  const c1a = passive.filter((r) => r.heldAt120.filter((h) => h === 1).length >= 3 && r.heldAt120.some((h, z) => h === 1 && south[z])).length;
  console.log(`C1a take uncontested ground: ${c1a}/${n} seeds hold >=3 zones incl. one south at 120 s (pass >= ${Math.ceil(0.9 * n)})  ${c1a >= Math.ceil(0.9 * n) ? 'PASS' : 'FAIL'}`);
  console.log(`    held at 120 s per seed: ${passive.map((r) => r.heldAt120.map((h) => (h === 1 ? 'S' : h === 0 ? 'K' : '-')).join('')).join(' ')}`);
  const caps = [...naive, ...flank, ...good].flatMap((r) => r.captures);
  const answered = caps.filter((c) => c.answered).length;
  const c1b = caps.length === 0 ? 1 : answered / caps.length;
  console.log(`C1b dispute captures: ${answered}/${caps.length} answered within 30 s (${(c1b * 100).toFixed(0)}%, pass >= 75%)  ${c1b >= 0.75 ? 'PASS' : 'FAIL'}`);
  const byZone = new Map<string, [number, number]>();
  for (const c of caps) {
    const v = byZone.get(c.zone) ?? [0, 0];
    v[0]++;
    if (c.answered) v[1]++;
    byZone.set(c.zone, v);
  }
  console.log(`    by zone: ${[...byZone].map(([z, [a, b]]) => `${z} ${b}/${a}`).join(', ')}`);
  const c1c = naive.filter((r) => r.points[1] * 2 > r.points[0] + r.points[1]).length;
  console.log(`C1c out-earn naive: ${c1c}/${n} seeds Sarim share > 50% (pass >= ${Math.ceil(0.7 * n)})  ${c1c >= Math.ceil(0.7 * n) ? 'PASS' : 'FAIL'}`);
  const reacted = flank.filter((r) => r.flankAnsweredTick >= 0).length;
  const seen = flank.filter((r) => r.flankContactTick >= 0).length;
  console.log(`C2a react to the flank: ${reacted}/${n} seeds answered within 30 s of contact (contact made in ${seen}/${n}; pass >= ${Math.ceil(0.8 * n)})  ${reacted >= Math.ceil(0.8 * n) ? 'PASS' : 'FAIL'}`);
  console.log(`    contact s / answer s: ${flank.map((r) => `${r.flankContactTick < 0 ? '-' : (r.flankContactTick / 20).toFixed(0)}/${r.flankAnsweredTick < 0 ? '-' : (r.flankAnsweredTick / 20).toFixed(0)}`).join(' ')}`);
  console.log(`  (supplementary) C2a' contact anywhere west of x=16, answered at the corridor/west/HQ within 30 s: ${flank.filter((r) => r.westAnsweredTick >= 0).length}/${n}; contact s/answer s ${flank.map((r) => `${r.westContactTick < 0 ? '-' : (r.westContactTick / 20).toFixed(0)}/${r.westAnsweredTick < 0 ? '-' : (r.westAnsweredTick / 20).toFixed(0)}`).join(' ')}`);
  const hpC = flank.reduce((a, r) => a + r.flankHpLost, 0) / n;
  const hpS = flankStatic.reduce((a, r) => a + r.flankHpLost, 0) / n;
  console.log(`C2b make it cost: flank party HP lost ${hpC.toFixed(0)} (commander) vs ${hpS.toFixed(0)} (static) of ${flank[0].flankHpStart.toFixed(0)}; ratio ${(hpS > 0 ? hpC / hpS : Infinity).toFixed(2)} (pass >= 2)  ${hpC >= 2 * hpS && hpC > 0 ? 'PASS' : 'FAIL'}`);
  console.log(`C2c flank < good: ${wins(flank)} vs ${wins(good)}  ${wins(flank) < wins(good) ? 'PASS' : 'FAIL'}`);
  console.log(`C3a good beats it: ${wins(good)}/${n} (pass >= ${Math.ceil(0.7 * n)})  ${wins(good) >= Math.ceil(0.7 * n) ? 'PASS' : 'FAIL'}`);
  const c3b = wins(passive) === 0 && wins(naive) <= Math.floor(0.3 * n);
  console.log(`C3b gradient: passive ${wins(passive)}/${n}, naive ${wins(naive)}/${n} (pass: 0 and <= ${Math.floor(0.3 * n)})  ${c3b ? 'PASS' : 'FAIL'}`);
  const keys = good.map((r) => traceKey(r.trace));
  const distinct = keys.filter((k, i) => keys.indexOf(k) === i && keys.lastIndexOf(k) === i).length;
  console.log(`C3c no script: timed waves 0, triggers 0; ${distinct}/${n} good-seed traces unique (pass >= ${Math.ceil(0.8 * n)})  ${distinct >= Math.ceil(0.8 * n) ? 'PASS' : 'FAIL'}`);
  const goodStatic = runs.get('good/static') ?? [];
  const gC = good.reduce((a, r) => a + r.flankHpLost, 0) / n;
  const gS = goodStatic.reduce((a, r) => a + r.flankHpLost, 0) / n;
  console.log(`  (supplementary) corridor foot HP lost inside the GOOD plan: ${gC.toFixed(0)} commander vs ${gS.toFixed(0)} static`);
  console.log(`  (supplementary) concentrated plan wins ${wins(conc)}/${n}`);
  console.log(`C2b (RE-SCORED, round 2) corridor foot HP lost inside GOOD: ${gC.toFixed(0)} vs ${gS.toFixed(0)} static; ratio ${(gC / gS).toFixed(2)} (pass >= 2)  ${gC >= 2 * gS ? 'PASS' : 'FAIL'}`);
  const c3d = wins(early) >= Math.ceil(0.6 * n) && wins(late) >= Math.ceil(0.6 * n);
  console.log(`C3d timing-robust: good -15 s ${wins(early)}/${n}, +15 s ${wins(late)}/${n} (pass >= ${Math.ceil(0.6 * n)} each)  ${c3d ? 'PASS' : 'FAIL'}`);
}

if (process.argv[1]?.endsWith('skirmish.ts')) main();
