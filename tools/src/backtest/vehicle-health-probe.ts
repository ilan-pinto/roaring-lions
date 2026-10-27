// How an armoured vehicle dies under the HP model (GH-560). REPORT-ONLY.
// Run: pnpm vehicle-health:probe -- [--seeds=200] [--tier=max] [--only=s1,s2,s3,s4]
//   (or npx tsx tools/src/backtest/vehicle-health-probe.ts)
//
// What it measures, per scenario: how often a hard hull dies, what its health bar showed on the
// tick BEFORE the shot that killed it, how many penetrations it absorbed first, and, for the
// Sarim Standoff (a Kornet cell at 8.5 tiles against an APS Lavi), what the exchange costs.
//   luck     a destroyed hard hull whose bar read >= 0.5 on the tick before. A penetration costs
//            at most 0.51 of the bar (34% x 1.5 at heavy overmatch), so a hull above half only dies
//            to ONE penetration if the weapon's own damage exceeds that cost. It is an upper bound,
//            not a count of rolls: the catastrophic roll is gone (only HP destroys a hull), and a
//            salvo that lands several penetrations in one tick, or an RPG on an Eitan, also reads
//            here. The tank-v-tank duel is the clean row and reads 0% at 200 seeds; the other
//            rows are context, and the one gate (`vehicle-health-probe.test.ts`) is the duel.
//   1shot    the same, with the bar at >= 0.7.
//   hpShown  the bar before the fatal tick, median.
// "Hard" is armor.front >= 30 mm (16 types at the time of writing). Every unit watched here is.
//
// Where the numbers are quoted: docs/superpowers/specs/2026-10-27-vehicle-health-design.md (the
// design, run C9) and docs/superpowers/plans/2026-10-28-vehicle-health.md. The 200-seed reading
// of every row is in the design runs, minus the `cat` column the HP model deleted.
//
// Nothing here asserts a level except the one gate in `vehicle-health-probe.test.ts` (the Lavi
// v Lavi duel has no luck deaths). Float maths is fine: this file is a tool, never the sim.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Sim, fx, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { units as baseUnits } from '@lions/data';
import { unitsAtMaxTier } from './harness';

const WEST = 32768;
const EAST = 0;

type Roster = Record<string, UnitTypeJson>;

export interface Death {
  /** The bar (hp / max hp) on the tick before the one that destroyed the hull. */
  hpShown: number;
  /** Penetrations it had absorbed by then, the fatal one included. */
  pens: number;
  /** Seconds into the run. */
  t: number;
}

export interface Tally {
  runs: number;
  deaths: Death[];
  pens: number;
  hpEndAlive: number[];
  atkLost: number;
  atkCount: number;
  extra: Record<string, number>;
}

export function tally(): Tally {
  return { runs: 0, deaths: [], pens: 0, hpEndAlive: [], atkLost: 0, atkCount: 0, extra: {} };
}

/** Run one sim, watching `watched` (ids of armoured vehicles). */
function watch(
  sim: Sim,
  watched: number[],
  maxTicks: number,
  t: Tally,
  stop?: (evs: SimEvent[], tick: number) => boolean,
  onTick?: (tick: number) => void,
): void {
  const maxHp = new Map<number, number>();
  const prevHp = new Map<number, number>();
  const pens = new Map<number, number>();
  for (const id of watched) {
    maxHp.set(id, sim.state.hp[id]);
    prevHp.set(id, sim.state.hp[id]);
    pens.set(id, 0);
  }
  const dead = new Set<number>();
  for (let k = 0; k < maxTicks; k++) {
    onTick?.(k);
    const evs = sim.tick();
    for (const e of evs) {
      if (e.kind === 'impact' && e.penetrated && pens.has(e.target)) {
        pens.set(e.target, (pens.get(e.target) ?? 0) + 1);
        t.pens++;
      }
    }
    for (const e of evs) {
      if (e.kind === 'destroyed' && maxHp.has(e.entity) && !dead.has(e.entity)) {
        dead.add(e.entity);
        const shown = (prevHp.get(e.entity) ?? 0) / (maxHp.get(e.entity) ?? 1);
        t.deaths.push({ hpShown: shown, pens: pens.get(e.entity) ?? 0, t: k / TICKS_PER_SECOND });
      }
    }
    for (const id of watched) if (!dead.has(id)) prevHp.set(id, sim.state.hp[id]);
    if (stop?.(evs, k)) break;
    if (watched.every((id) => dead.has(id))) break;
  }
  for (const id of watched) if (!dead.has(id)) t.hpEndAlive.push(sim.state.hp[id] / (maxHp.get(id) ?? 1));
  t.runs++;
}

function aliveCount(sim: Sim, side: number): number {
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.side[i] === side) n++;
  return n;
}

// --- S1: a Lavi under a single engagement, by shooter set -----------------------
export type Shooters = { id: string; n: number; range: number; flank?: boolean }[];

export function engagement(
  U: Roster,
  shooters: Shooters,
  seeds: number,
  capS = 120,
  target = 'mbt_lavi',
  armedTarget = true,
): Tally {
  const t = tally();
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 70000 + s * 13, width: 40, height: 20, capacity: 16 });
    const tj = armedTarget ? U[target] : { ...U[target], id: target + '_cold', weapons: [] };
    const lav = sim.spawn(sim.addUnitType(tj), 0, fx.from(30.5), fx.from(10.5), WEST);
    let row = 0;
    for (const sh of shooters) {
      const ti = sim.addUnitType(U[sh.id]);
      for (let k = 0; k < sh.n; k++) {
        if (sh.flank) sim.spawn(ti, 1, fx.from(30.5 + (k - (sh.n - 1) / 2) * 1.5), fx.from(10.5 - sh.range), 16384);
        else sim.spawn(ti, 1, fx.from(30.5 - sh.range), fx.from(10.5 + (row - 1) * 1.5), EAST);
        row++;
      }
    }
    t.atkCount += row;
    watch(sim, [lav], capS * TICKS_PER_SECOND, t, (_e, k) => (k & 31) === 0 && aliveCount(sim, 1) === 0);
    t.atkLost += row - aliveCount(sim, 1);
  }
  return t;
}

// --- S2: repeated contact (regeneration's question) -----------------------------
// A weaponless Lavi takes a pair of RPG teams at 3.5 tiles every `gapS` seconds, 5 waves;
// each wave is removed (debugKill) 15 s after it spawns.
export function waves(U: Roster, gapS: number, seeds: number): Tally {
  const t = tally();
  let wavesSurvived = 0;
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 80000 + s * 7, width: 40, height: 20, capacity: 32 });
    const lav = sim.spawn(sim.addUnitType({ ...U.mbt_lavi, id: 'lavi_cold', weapons: [] }), 0, fx.from(30.5), fx.from(10.5), WEST);
    const rpg = sim.addUnitType(U.rpg_team);
    const live: number[][] = [];
    let w = 0;
    const gap = gapS * TICKS_PER_SECOND;
    watch(sim, [lav], 5 * gap + 20 * TICKS_PER_SECOND, t, undefined, (k) => {
      if (k % gap === 0 && w < 5) {
        live.push([sim.spawn(rpg, 1, fx.from(29.5), fx.from(7.5), 16384), sim.spawn(rpg, 1, fx.from(31.5), fx.from(7.5), 16384)]);
        w++;
      }
      if (k % gap === 20 * TICKS_PER_SECOND) for (const id of live.shift() ?? []) if (sim.state.alive[id] === 1) sim.debugKill(id);
    });
    if (sim.state.alive[lav] === 1) wavesSurvived += 5;
    else wavesSurvived += Math.min(5, Math.floor((t.deaths[t.deaths.length - 1].t * TICKS_PER_SECOND) / gap));
  }
  t.extra.waves = wavesSurvived / seeds;
  return t;
}

// --- S3: Standoff (Sarim), GDD 5.7 extended: ATGM cell(s) at 8.5 tiles vs an APS MBT, 3 missiles each
export function standoff(U: Roster, cells: number, seeds: number, range = 8.5): Tally {
  const t = tally();
  let mbtKilled = 0;
  let cellsDead = 0;
  let missiles = 0;
  let aps = 0;
  let exch = 0;
  let missionKill = 0;
  const lCost = U.mbt_lavi.cost?.logistics ?? 0;
  const cCost = U.atgm_cell.cost?.logistics ?? 0;
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 60000 + s * 11, width: 40, height: 20, capacity: 16 });
    const lav = sim.spawn(sim.addUnitType(U.mbt_lavi), 0, fx.from(30.5), fx.from(10.5), WEST);
    const ct = sim.addUnitType(U.atgm_cell);
    const ids: number[] = [];
    for (let k = 0; k < cells; k++) ids.push(sim.spawn(ct, 1, fx.from(30.5 - range), fx.from(10.5 + (k - (cells - 1) / 2) * 2), EAST));
    const fired = new Map<number, number>(ids.map((i) => [i, 0]));
    let lastFire = -1;
    let mk = false;
    watch(sim, [lav], 120 * TICKS_PER_SECOND, t, (evs, k) => {
      for (const e of evs) {
        if (e.kind === 'fire' && fired.has(e.shooter)) {
          const n = (fired.get(e.shooter) ?? 0) + 1;
          fired.set(e.shooter, n);
          missiles++;
          lastFire = k;
          if (n >= 3) sim.debugKill(e.shooter); // 3-missile engagement: the cell is spent (round still flies)
        }
        if (e.kind === 'aps' && e.intercepted) aps++;
        if (e.kind === 'component' && e.target === lav && (e.result === 'firepower_kill' || e.result === 'combat_ineffective' || e.result === 'mobility_kill')) mk = true;
      }
      // Over when every cell is spent or dead, 8 s after the last launch (the rounds land).
      const over = ids.every((i) => (fired.get(i) ?? 0) >= 3 || sim.state.alive[i] === 0);
      return over && k - lastFire > 8 * TICKS_PER_SECOND;
    });
    const killed = sim.state.alive[lav] === 0;
    let dead = 0;
    for (const i of ids) if ((fired.get(i) ?? 0) < 3 && sim.state.alive[i] === 0) dead++; // killed before spending 3
    if (killed) mbtKilled++;
    if (killed || mk) missionKill++;
    cellsDead += dead;
    exch += (killed ? lCost : 0) - dead * cCost;
  }
  t.extra = {
    mbtKilledPct: (100 * mbtKilled) / seeds,
    mbtKilledOrDisabledPct: (100 * missionKill) / seeds,
    cellDeadPct: (100 * cellsDead) / (seeds * cells),
    missilesPerRun: missiles / seeds,
    apsInterceptsPerRun: aps / seeds,
    exchangePerRun: exch / seeds,
  };
  return t;
}

// --- S4: combined-arms fights (the versus-like read) ----------------------------
// Each side's group attack-moves on the other's start (mirror), or KDF attack-moves on a
// halted Sarim position (faction). Every armoured unit on both sides is watched.
export function melee(U: Roster, west: string[], east: string[], eastHolds: boolean, seeds: number, capS = 300): Tally {
  const t = tally();
  let westWins = 0;
  let eastWins = 0;
  let vehLostW = 0;
  let vehW = 0;
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 90000 + s * 17, width: 48, height: 24, capacity: 48 });
    const idx = new Map<string, number>();
    const tIdx = (id: string): number => {
      if (!idx.has(id)) idx.set(id, sim.addUnitType(U[id]));
      return idx.get(id) as number;
    };
    const ids: [number[], number[]] = [[], []];
    const armoured: number[] = [];
    const place = (list: string[], side: number, x: number, face: number): void =>
      list.forEach((id, k) => {
        const e = sim.spawn(tIdx(id), side, fx.from(x + (k % 2) * 1.5), fx.from(6.5 + Math.floor(k / 2) * 2), face);
        ids[side].push(e);
        if (U[id].hull.armor.front >= 30) {
          armoured.push(e);
          if (side === 0) vehW++;
        }
      });
    place(west, 0, 6.5, EAST);
    place(east, 1, 38.5, WEST);
    sim.queueCommand({ kind: 'attackMove', ids: ids[0], x: fx.from(40), y: fx.from(12), sweep: true });
    if (!eastHolds) sim.queueCommand({ kind: 'attackMove', ids: ids[1], x: fx.from(7), y: fx.from(12), sweep: true });
    watch(sim, armoured, capS * TICKS_PER_SECOND, t, (_e, k) => (k & 31) === 0 && (aliveCount(sim, 0) === 0 || aliveCount(sim, 1) === 0));
    const a0 = aliveCount(sim, 0);
    const a1 = aliveCount(sim, 1);
    if (a1 === 0 && a0 > 0) westWins++;
    else if (a0 === 0 && a1 > 0) eastWins++;
    for (const e of armoured) if (sim.state.side[e] === 0 && sim.state.alive[e] === 0) vehLostW++;
  }
  t.extra = {
    westWinPct: (100 * westWins) / seeds,
    eastWinPct: (100 * eastWins) / seeds,
    westVehLostPct: vehW ? (100 * vehLostW) / vehW : 0,
  };
  return t;
}

export function quantile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

/** A destroyed hull whose bar read at least this on the tick before is a "luck" death. */
export const LUCK_BAR = 0.5;
/** ... and at least this is a one-shot. */
export const ONE_SHOT_BAR = 0.7;

export interface Summary {
  deaths: number;
  luckDeaths: number;
  medianBar: number;
}

export function summarise(t: Tally): Summary {
  return {
    deaths: t.deaths.length,
    luckDeaths: t.deaths.filter((d) => d.hpShown >= LUCK_BAR).length,
    medianBar: quantile(
      t.deaths.map((d) => d.hpShown),
      0.5,
    ),
  };
}

export function formatRow(name: string, t: Tally): string {
  const d = t.deaths;
  const pct = (n: number): string => (d.length ? ((100 * n) / d.length).toFixed(0) : '-');
  const shown = d.map((x) => x.hpShown);
  const pensAtDeath = d.map((x) => x.pens);
  const parts = [
    `runs ${t.runs}`,
    `deaths/run ${(d.length / t.runs).toFixed(2)}`,
    `hpShown med ${quantile(shown, 0.5).toFixed(2)} (>=0.7: ${pct(d.filter((x) => x.hpShown >= ONE_SHOT_BAR).length)}%)`,
    `luck ${pct(d.filter((x) => x.hpShown >= LUCK_BAR).length)}%`,
    `1shot ${pct(d.filter((x) => x.hpShown >= ONE_SHOT_BAR).length)}%`,
    `pens/kill ${pensAtDeath.length ? (pensAtDeath.reduce((a, b) => a + b, 0) / pensAtDeath.length).toFixed(2) : '-'}`,
    `pens/run ${(t.pens / t.runs).toFixed(2)}`,
    `survivor hp med ${t.hpEndAlive.length ? quantile(t.hpEndAlive, 0.5).toFixed(2) : '-'}`,
    t.atkCount ? `atk lost ${((100 * t.atkLost) / t.atkCount).toFixed(0)}%` : '',
    `ttk med ${d.length ? quantile(d.map((x) => x.t), 0.5).toFixed(1) : '-'}s`,
    ...Object.entries(t.extra).map(([k, v]) => `${k} ${v.toFixed(2)}`),
  ].filter(Boolean);
  return `${name.padEnd(36)} ${parts.join(' | ')}`;
}

/** `--name=value` from an argv list. */
export function argOf(argv: string[], name: string): string | undefined {
  const p = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(p));
  return hit === undefined ? undefined : hit.slice(p.length);
}

export function runAll(argv: string[], log: (line: string) => void): void {
  const seeds = Number(argOf(argv, 'seeds') ?? 100);
  const tier = argOf(argv, 'tier') ?? 'base';
  const only = argOf(argv, 'only');
  const want = (k: string): boolean => !only || only.split(',').includes(k);
  const U = (tier === 'max' ? unitsAtMaxTier : baseUnits) as unknown as Roster;
  const row = (name: string, t: Tally): void => log(formatRow(name, t));

  log(`vehicle-health-probe tier=${tier} seeds=${seeds}`);
  if (want('s1')) {
    row('spike x3 @7 vs lavi', engagement(U, [{ id: 'at_team', n: 3, range: 7 }], seeds));
    row('rpg x2 @3.5 vs lavi', engagement(U, [{ id: 'rpg_team', n: 2, range: 3.5 }], seeds));
    row('recoilless+rpg x2 @4 vs lavi', engagement(U, [{ id: 'recoilless_team', n: 1, range: 4 }, { id: 'rpg_team', n: 2, range: 3.5 }], seeds));
    row('lavi vs lavi @9', engagement(U, [{ id: 'mbt_lavi', n: 1, range: 9 }], seeds));
    row('namer vs lavi @7 (30mm)', engagement(U, [{ id: 'ifv_namer', n: 1, range: 7 }], seeds, 90));
    row('rpg x2 @3.5 vs eitan', engagement(U, [{ id: 'rpg_team', n: 2, range: 3.5 }], seeds, 120, 'apc_eitan'));
    row('rpg x2 FLANK @3.5 vs lavi', engagement(U, [{ id: 'rpg_team', n: 2, range: 3.5, flank: true }], seeds));
    row('spike x2 FLANK @6 vs lavi', engagement(U, [{ id: 'at_team', n: 2, range: 6, flank: true }], seeds));
    row('kornet x1 FLANK @8 vs lavi', engagement(U, [{ id: 'atgm_cell', n: 1, range: 8, flank: true }], seeds));
    row('rpg x2 FLANK @3.5 vs eitan', engagement(U, [{ id: 'rpg_team', n: 2, range: 3.5, flank: true }], seeds, 120, 'apc_eitan'));
    row('namer FLANK @6 vs lavi (30mm)', engagement(U, [{ id: 'ifv_namer', n: 1, range: 6, flank: true }], seeds, 90));
  }
  if (want('s2')) {
    row('rpg pair FLANK waves /30s, cold lavi', waves(U, 30, seeds));
    row('rpg pair FLANK waves /60s, cold lavi', waves(U, 60, seeds));
  }
  if (want('s4')) {
    const kdf = ['mbt_lavi', 'mbt_lavi', 'ifv_namer', 'apc_eitan', 'inf_squad', 'inf_squad', 'inf_squad', 'at_team'];
    row('mirror kdf/kdf (all armour)', melee(U, kdf, kdf, false, seeds));
    row(
      'kdf assault vs sarim hold',
      melee(
        U,
        ['mbt_lavi', 'mbt_lavi', 'apc_eitan', 'inf_squad', 'inf_squad', 'at_team'],
        ['rpg_team', 'rpg_team', 'atgm_cell', 'atgm_cell', 'recoilless_team', 'militia_cell', 'militia_cell', 'militia_cell', 'technical', 'gun_truck'],
        true,
        seeds,
      ),
    );
  }
  if (want('s3')) {
    // Standoff (Sarim), GDD 5.7 extended: ATGM cells at 8.5 tiles, three missiles each.
    row('standoff 1 cell(s) @8.5', standoff(U, 1, seeds));
    row('standoff 2 cell(s) @8.5', standoff(U, 2, seeds));
    row('standoff 3 cell(s) @8.5', standoff(U, 3, seeds));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAll(process.argv.slice(2), (line) => console.log(line));
}
