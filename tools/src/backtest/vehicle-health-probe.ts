// How an armoured vehicle dies under the HP model (GH-560). REPORT-ONLY.
// Run: pnpm vehicle-health:probe -- [--seeds=200] [--tier=max] [--only=s1,s2,s3,s4,s5,s6]
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
// S5 (GH-868) is a different question: how long a small round takes to kill a light hard hull
// (a technical under a Peten's or a Remetz's guns). The per-hit HP floor was flat at 34% of the bar,
// so a 12.7 mm DShK killed a Peten in 3 hits; the floor now scales by damage / R below R = 85
// (PEN_HP_REF_DAMAGE). `sf2` is the cold-target arrangement the measurement used.
//
// S6 (GH-868, the MANPAD half) states the metric a helicopter-v-MANPAD reading needs. A hit that rolls
// `mobility_kill` or `combat_ineffective` lands the aircraft, a landed aircraft is a ground target and the
// air-only MANPAD can no longer fire at it, so "destroyed 0/200" does not mean "harmless". Each row reports
// destroyed, destroyed-or-grounded (`DD`) and, for a firing pass, survived and intact (alive, not grounded,
// weapons not knocked out). The warhead was 300 (three hits on a Peten, 640 hp): a lone team read 0/200
// destroyed against 43/200 before PR 866. At 420 it is a two-hit warhead (the lead's 28 Oct ruling).
//
// Nothing here asserts a level except the gates in `vehicle-health-probe.test.ts` (the Lavi
// v Lavi duel has no luck deaths; the S5 rows hold a technical off a flat floor; the S6 rows hold a
// MANPAD at two hits on a Peten). Float maths is fine: this file is a tool, never the sim.
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

// --- S5 (GH-868): a cold hard hull under small arms, one arc --------------------
export interface Sf2Result {
  runs: number;
  killed: number;
  /** Seconds to the kill, sorted ascending, killed runs only. */
  ttk: number[];
  pensPerRun: number;
}

/**
 * One cold target (weapons stripped) of `target`, `n` shooters of `shooter` placed rear / side / front
 * of it, `seeds` seeds, `capS` seconds. The target sits at (20.5, 12.5) facing west; the shooters are
 * 6 tiles off in the named arc. Seeds 90000 + 17 s, the readings in _coord/gh868/options.md.
 */
export function sf2(U: Roster, target: string, shooter: string, n: number, where: 'rear' | 'side' | 'front', capS: number, seeds: number): Sf2Result {
  let killed = 0;
  let pens = 0;
  const ttk: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 90000 + s * 17, width: 40, height: 24, capacity: 16 });
    const id = sim.spawn(sim.addUnitType({ ...U[target], id: `${target}_cold`, weapons: [] }), 0, fx.from(20.5), fx.from(12.5), WEST);
    const st = sim.addUnitType(U[shooter]);
    for (let k = 0; k < n; k++) {
      if (where === 'rear') sim.spawn(st, 1, fx.from(26.5), fx.from(12.5 + k), WEST);
      else if (where === 'front') sim.spawn(st, 1, fx.from(14.5), fx.from(12.5 + k), EAST);
      else sim.spawn(st, 1, fx.from(20.5 + k), fx.from(6.5), 16384);
    }
    sim.identifyTo(1, id);
    for (let t = 0; t < capS * TICKS_PER_SECOND; t++) {
      const evs = sim.tick();
      for (const e of evs) if (e.kind === 'impact' && e.target === id && e.penetrated) pens++;
      if (evs.some((e) => e.kind === 'destroyed' && e.entity === id)) {
        killed++;
        ttk.push(t / TICKS_PER_SECOND);
        break;
      }
    }
  }
  ttk.sort((a, b) => a - b);
  return { runs: seeds, killed, ttk, pensPerRun: pens / seeds };
}

export function formatSf2(name: string, r: Sf2Result): string {
  const med = r.ttk.length ? r.ttk[r.ttk.length >> 1].toFixed(1) : '-';
  return `${name.padEnd(36)} killed ${r.killed}/${r.runs} | ttk med ${med}s | pens/run ${r.pensPerRun.toFixed(1)}`;
}

// --- S6 (GH-868): a helicopter against MANPAD teams ----------------------------------
export interface ManpadHover {
  runs: number;
  /** A `destroyed` event for the helicopter within the cap. */
  destroyed: number;
  /** Destroyed, or knocked out of the air by a mobility kill (it lands, and the MANPAD cannot engage it). */
  downOrDead: number;
}

/**
 * One cold (weapons stripped) helicopter hovering, `n` MANPAD teams 6 tiles in front of it, identified,
 * `seeds` seeds, `capS` seconds. The scenario family of `sf2`: seeds 90000 + 17 s, helicopter at (20.5, 12.5),
 * teams at x = 14.5. The readings are in _coord/gh868/manpad-options.md (manpad.mts).
 */
export function manpadHover(U: Roster, heli: string, n: number, capS: number, seeds: number): ManpadHover {
  let destroyed = 0;
  let downOrDead = 0;
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 90000 + s * 17, width: 40, height: 24, capacity: 16 });
    const id = sim.spawn(sim.addUnitType({ ...U[heli], id: `${heli}_cold`, weapons: [] }), 0, fx.from(20.5), fx.from(12.5), WEST);
    const st = sim.addUnitType(U.manpad_team);
    for (let k = 0; k < n; k++) sim.spawn(st, 1, fx.from(14.5), fx.from(12.5 + k), EAST);
    sim.identifyTo(1, id);
    let down = false;
    for (let t = 0; t < capS * TICKS_PER_SECOND; t++) {
      const evs = sim.tick();
      if (!down && sim.state.mobilityKilled[id] === 1) {
        downOrDead++;
        down = true;
      }
      if (evs.some((e) => e.kind === 'destroyed' && e.entity === id)) {
        destroyed++;
        if (!down) downOrDead++;
        break;
      }
    }
  }
  return { runs: seeds, destroyed, downOrDead };
}

export interface ManpadPass {
  runs: number;
  /** Alive after 90 s. */
  survives: number;
  /** Alive, not grounded and not weapons-killed after 90 s. */
  intact: number;
  /** Every AA piece dead after 90 s. */
  cleared: number;
}

/**
 * A live helicopter attack-moves (sweep) from (4.5, 10.5) onto `n` MANPAD teams at x = 24.5 / 26.5, y = 8.5 + 2 k.
 * The shape of the §5.7 "Air is contested by AA" target. Seeds 91000 + 1000 n + s, 90 s.
 */
export function manpadPass(U: Roster, heli: string, n: number, seeds: number): ManpadPass {
  let survives = 0;
  let intact = 0;
  let cleared = 0;
  for (let s = 0; s < seeds; s++) {
    const sim = new Sim({ seed: 91000 + n * 1000 + s, width: 40, height: 20, capacity: 8 });
    const h = sim.addUnitType(U[heli]);
    const a = sim.addUnitType(U.manpad_team);
    const id = sim.spawn(h, 0, fx.from(4.5), fx.from(10.5));
    for (let k = 0; k < n; k++) sim.spawn(a, 1, fx.from(24.5 + (k % 2) * 2), fx.from(8.5 + k * 2), WEST);
    sim.queueCommand({ kind: 'attackMove', ids: [id], x: fx.from(26), y: fx.from(10.5), sweep: true });
    let dead = false;
    for (let t = 0; t < 90 * TICKS_PER_SECOND; t++) {
      const evs = sim.tick();
      if (evs.some((e) => e.kind === 'destroyed' && e.entity === id)) {
        dead = true;
        break;
      }
    }
    if (!dead) {
      survives++;
      if (sim.state.mobilityKilled[id] === 0 && sim.state.firepowerKilled[id] === 0) intact++;
    }
    if (aliveCount(sim, 1) === 0) cleared++;
  }
  return { runs: seeds, survives, intact, cleared };
}

export function formatManpad(name: string, h: ManpadHover, p: ManpadPass): string {
  return (
    `${name.padEnd(30)} hover 30 s: destroyed ${h.destroyed}/${h.runs}, destroyed-or-grounded ${h.downOrDead}/${h.runs}` +
    ` | pass: survives ${p.survives}/${p.runs}, intact ${p.intact}/${p.runs}, AA cleared ${p.cleared}/${p.runs}`
  );
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
  const row5 = (name: string, r: Sf2Result): void => log(formatSf2(name, r));
  const row6 = (name: string, h: ManpadHover, p: ManpadPass): void => log(formatManpad(name, h, p));

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
  if (want('s5')) {
    // GH-868: a small round against a light hard hull. Main read 110/200 in 13.7 s (technical v Peten),
    // the flat 34% floor 199/200 in 8.3 s, R = 85 173/200 in 18.9 s; Remetz v technical 9.6 / 2.7 / 6.5 s.
    row5('peten v technical, side, 30s', sf2(U, 'heli_peten', 'technical', 1, 'side', 30, seeds));
    row5('peten v gun_truck, front, 30s', sf2(U, 'heli_peten', 'gun_truck', 1, 'front', 30, seeds));
    row5('remetz v technical, side, 60s', sf2(U, 'aa_remetz', 'technical', 1, 'side', 60, seeds));
    row5('remetz v gun_truck, side, 60s', sf2(U, 'aa_remetz', 'gun_truck', 1, 'side', 60, seeds));
  }
  if (want('s6')) {
    // GH-868 (MANPAD half): at 300 a lone team read 0/200 destroyed in the Peten hover (49/200 at 420).
    // Readings at 420 and 200 seeds: _coord/gh868/manpad-options.md and the PR body for the MANPAD ruling.
    for (const heli of ['heli_peten', 'heli_yanshuf'])
      for (const n of [1, 2, 3])
        row6(`${heli.slice(5)} v ${n} manpad`, manpadHover(U, heli, n, 30, seeds), manpadPass(U, heli, n, seeds));
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
