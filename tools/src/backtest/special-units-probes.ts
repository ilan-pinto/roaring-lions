// GH-709 special-units balance probes, Phase 1 ("numbers and staging").
//
// The cost curve prices hulls and guns; it cannot price what makes these units special.
// These probes measure the claims the sim can carry TODAY, against the staged drafts in
// docs/campaign/special_units/gh709 (never registered in @lions/data, so the probes load
// the JSON from disk and register it with `sim.addUnitType`, as e5-probes.ts does).
//
// Measured now: unit 1 (found late), unit 2 (reach duel), unit 9 (cover), unit 10 (tunnel
// identification, synthetic route). Units 4, 5, 6, 7, 11 need E1-E3 and print a "deferred"
// line each. No engine code is written for any of them.
//
// Bands are frozen from the first measured run in
// docs/campaign/special_units/gh709/numbers.md. A probe outside its band is a unit to
// retune (the lead's call), never a band to widen.
//
// Run: `pnpm --filter @lions/tools su:probes` (exit 1 when a claim fails).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, fx, TICKS_PER_SECOND, type UnitTypeJson } from '@lions/sim';
import { runBattle, units } from './harness';

const WEST = 32768;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'gh709');

export function stagedUnit(id: string): UnitTypeJson {
  return JSON.parse(readFileSync(join(STAGED, `${id}.json`), 'utf8')) as UnitTypeJson;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Probe 1: the camouflaged Lavi is found late.
//   One observer faces the probe tank across open ground at 4, 6 and 8 tiles. The
//   reading is the first tick the observer's side holds the tank identified
//   (`contactLevel === 2`). The observer is made unarmed and 30000 hp (a harness
//   device, applied identically to the Lavi and the camo Lavi): an armed observer
//   would be shot dead by a firing tank before it could identify it, and the
//   reading would be "who dies first" rather than "who is found first".
//   ambush: parked, `setStance{ambush}` (radius 3, so it holds fire at 4+ tiles).
//   moving: ordered to drive across the observer's front (perpendicular).
//   firing: parked, default stance, weapons as drafted; fires at the observer.
// ---------------------------------------------------------------------------
// The observer is deterministic given the tick (no random draw reaches detection), so every
// seed reads the same tick (min == max in the CLI). A few seeds keep that visible, cheaply.
export const DETECT_SEEDS = 5;
export const DETECT_RANGES = [4, 6, 8] as const;
export const DETECT_CAP_TICKS = 40 * TICKS_PER_SECOND;
export const TANK_MODES = ['ambush', 'moving', 'firing'] as const;
export type TankMode = (typeof TANK_MODES)[number];
export const OBSERVERS = ['sarim_rifles', 'atgm_cell', 'rpg_team'] as const;
export type Observer = (typeof OBSERVERS)[number];

export interface DetectCase {
  found: number;
  seeds: number;
  median: number; // +Infinity when most seeds never found it
  min: number | null;
  max: number | null;
}

export function firstIdentified(
  tankJson: UnitTypeJson,
  observer: Observer,
  range: number,
  mode: TankMode,
  seed: number,
): number | null {
  const sim = new Sim({ seed, width: 24, height: 48, capacity: 4 });
  const obsJson = units[observer];
  const tank = sim.addUnitType(tankJson);
  const obs = sim.addUnitType({ ...obsJson, weapons: [], hull: { ...obsJson.hull, hp: 30000 } });
  const id = sim.spawn(tank, 0, fx.from(4.5 + range), fx.from(10.5));
  sim.spawn(obs, 1, fx.from(4.5), fx.from(10.5), WEST);
  if (mode === 'ambush') sim.queueCommand({ kind: 'setStance', ids: [id], stance: 'ambush' });
  if (mode === 'moving') sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(4.5 + range), y: fx.from(40.5) });
  for (let t = 0; t < DETECT_CAP_TICKS; t++) {
    sim.tick();
    if (sim.contactLevel(1, id) === 2) return sim.tickCount;
  }
  return null;
}

export function detectCase(
  tankJson: UnitTypeJson,
  observer: Observer,
  range: number,
  mode: TankMode,
  seeds = DETECT_SEEDS,
): DetectCase {
  const ticks: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const t = firstIdentified(tankJson, observer, range, mode, 97000 + range * 100 + s);
    ticks.push(t ?? Number.POSITIVE_INFINITY);
  }
  const finite = ticks.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  return {
    found: finite.length,
    seeds,
    median: median(ticks),
    min: finite.length ? finite[0] : null,
    max: finite.length ? finite[finite.length - 1] : null,
  };
}

export type TankName = 'mbt_lavi' | 'mbt_lavi_camo';
export type DetectTable = Record<TankName, Record<Observer, Record<TankMode, Record<number, DetectCase>>>>;

export function detectTable(camo: UnitTypeJson, seeds = DETECT_SEEDS): DetectTable {
  const json: Record<TankName, UnitTypeJson> = { mbt_lavi: units.mbt_lavi, mbt_lavi_camo: camo };
  const out = {} as DetectTable;
  for (const tn of Object.keys(json) as TankName[]) {
    out[tn] = {} as DetectTable[TankName];
    for (const o of OBSERVERS) {
      out[tn][o] = {} as DetectTable[TankName][Observer];
      for (const m of TANK_MODES) {
        out[tn][o][m] = {};
        for (const r of DETECT_RANGES) out[tn][o][m][r] = detectCase(json[tn], o, r, m, seeds);
      }
    }
  }
  return out;
}

/** Why a (observer, range, mode) cell is not a claim, or null when it is one.
 *  A cell is claimable only when the Lavi is found at all there: if even the plain Lavi is
 *  never found (a range outside the observer's sight, or a posture nobody sees), "found
 *  later than the Lavi" is Infinity > Infinity, which is false for a reason that says
 *  nothing about the camo net. */
export function nonClaimReason(t: DetectTable, o: Observer, r: number, m: TankMode): string | null {
  const sight = units[o].sensors.sight_tiles;
  if (r > sight) return `outside ${o} sight ${sight}`;
  const l = t.mbt_lavi[o][m][r];
  if (l.found * 2 <= l.seeds) return 'the plain Lavi is not found either';
  return null;
}

export function detectClaims(t: DetectTable): string[] {
  const fails: string[] = [];
  for (const o of OBSERVERS) {
    for (const m of TANK_MODES) {
      for (const r of DETECT_RANGES) {
        if (nonClaimReason(t, o, r, m) !== null) continue;
        const c = t.mbt_lavi_camo[o][m][r];
        const l = t.mbt_lavi[o][m][r];
        if (!(c.median > l.median)) {
          fails.push(`camo Lavi (${m}, ${r} tiles) found no later than the Lavi by ${o}: median ${c.median} vs ${l.median}`);
        }
      }
    }
  }
  return fails;
}

// ---------------------------------------------------------------------------
// Probe 2: the long-range gun against the Grad, a recon drone spotting for each side.
//   spg_long_range at x=4.5, rocket_battery `d` tiles east. Each side's drone hovers 3
//   tiles from the ENEMY gun (the KDF drone beside the Grad, the Sarim drone beside the
//   SPG), so each gun is identified at once and the duel is decided by reach, rate and hp.
//   No orders. 120 s cap. The duel ends when either gun falls.
// ---------------------------------------------------------------------------
export const DUEL_SEEDS = 30;
export const DUEL_RANGES = [20, 22, 24, 26, 28] as const;
export const DUEL_CAP_TICKS = 120 * TICKS_PER_SECOND;

export interface DuelOutcome {
  spgWon: boolean;
  gradWon: boolean;
  /** SPG hp left over its starting hp, 0 when dead. */
  spgHpFrac: number;
  /** Ticks until the first gun fell (the cap on a draw). */
  ticks: number;
}

export function duel(spgJson: UnitTypeJson, d: number, seed: number): DuelOutcome {
  const sim = new Sim({ seed, width: 48, height: 24, capacity: 8 });
  const spg = sim.addUnitType(spgJson);
  const grad = sim.addUnitType(units.rocket_battery);
  const drone = sim.addUnitType(units.recon_drone);
  const a = sim.spawn(spg, 0, fx.from(4.5), fx.from(12.5));
  sim.spawn(grad, 1, fx.from(4.5 + d), fx.from(12.5), WEST);
  // KDF drone beside the Grad, Sarim drone beside the SPG: each gun is identified by the other side.
  sim.spawn(drone, 0, fx.from(4.5 + d - 3), fx.from(10.5));
  sim.spawn(drone, 1, fx.from(4.5 + 3), fx.from(14.5), WEST);
  // runBattle would run to the cap: the two drones are unarmed and never die, so neither side is
  // ever "wiped out". End on the first gun to fall instead.
  const gunLive = (type: number): boolean => {
    for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.typeIdx[i] === type) return true;
    return false;
  };
  let ticks = 0;
  for (; ticks < DUEL_CAP_TICKS; ticks++) {
    sim.tick();
    if (sim.state.alive[a] === 0 || !gunLive(grad)) break;
  }
  const spgAlive = sim.state.alive[a] === 1;
  const gradLive = gunLive(grad);
  return {
    spgWon: spgAlive && !gradLive,
    gradWon: !spgAlive && gradLive,
    spgHpFrac: spgAlive ? sim.state.hp[a] / fx.from(spgJson.hull.hp) : 0,
    ticks,
  };
}

export interface DuelRow {
  spgWins: number;
  gradWins: number;
  draws: number;
  seeds: number;
  /** Mean SPG hp fraction left over all seeds. */
  spgHp: number;
  /** Mean ticks until the first gun fell. */
  meanTicks: number;
}
export function duelRow(spgJson: UnitTypeJson, d: number, seeds = DUEL_SEEDS): DuelRow {
  const row: DuelRow = { spgWins: 0, gradWins: 0, draws: 0, seeds, spgHp: 0, meanTicks: 0 };
  for (let s = 0; s < seeds; s++) {
    const o = duel(spgJson, d, 98000 + d * 100 + s);
    if (o.spgWon) row.spgWins++;
    else if (o.gradWon) row.gradWins++;
    else row.draws++;
    row.spgHp += o.spgHpFrac / seeds;
    row.meanTicks += o.ticks / seeds;
  }
  return row;
}
export type DuelTable = Record<number, DuelRow>;
export function duelTable(spgJson: UnitTypeJson, seeds = DUEL_SEEDS): DuelTable {
  const out: DuelTable = {};
  for (const d of DUEL_RANGES) out[d] = duelRow(spgJson, d, seeds);
  return out;
}

/** Q11 (lead ruling: the recommendation as written): if the gun wins outright at its range,
 *  drop the range to 24. "Outright" = it wins every seed at 28 tiles. REPORT only. */
export function q11Note(t: DuelTable): string {
  const r = t[28];
  return r.spgWins === r.seeds
    ? `Q11 TRIGGERED: the gun wins ${r.spgWins}/${r.seeds} at 28 tiles -- outright; the spec says drop range to 24 (lead call, not retuned here)`
    : `Q11 not triggered: the gun wins ${r.spgWins}/${r.seeds} at 28 tiles (grad ${r.gradWins}, draws ${r.draws})`;
}

// ---------------------------------------------------------------------------
// Probe 9: the grenadier against cover.
//   Two KDF squads (grenadier, or inf_squad as the control) face three militia_cell,
//   6 tiles apart, the militia one tile from each other. Cover 2 on the militia's tiles and
//   a one-tile ring round them, or none. No orders, 25 s. The reading is the mean net hp
//   margin: (militia hp lost - KDF hp lost) as a fraction of one side's starting hp.
//   advantage(cover) = margin(grenadier) - margin(inf_squad).
// ---------------------------------------------------------------------------
export const COVER_SEEDS = 30;
export const COVER_CAP_TICKS = 25 * TICKS_PER_SECOND;
export type Ground = 'open' | 'cover2';

export function coverFight(kdfJson: UnitTypeJson, ground: Ground, seed: number): { margin: number; dealt: number } {
  const sim = new Sim({ seed, width: 24, height: 16, capacity: 8 });
  const kdf = sim.addUnitType(kdfJson);
  const militia = sim.addUnitType(units.militia_cell);
  const mx = 11.5;
  const spots: [number, number][] = [
    [mx, 6.5],
    [mx, 8.5],
    [mx + 1, 7.5],
  ];
  if (ground === 'cover2') {
    for (const [x, y] of spots) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sim.setCover(Math.floor(x) + dx, Math.floor(y) + dy, 2);
    }
  }
  const ours = [sim.spawn(kdf, 0, fx.from(5.5), fx.from(6.5)), sim.spawn(kdf, 0, fx.from(5.5), fx.from(8.5))];
  const theirs = spots.map(([x, y]) => sim.spawn(militia, 1, fx.from(x), fx.from(y), WEST));
  const hp0 = (ids: number[]) => ids.reduce((s, i) => s + sim.state.hp[i], 0);
  const k0 = hp0(ours);
  const m0 = hp0(theirs);
  runBattle(sim, COVER_CAP_TICKS);
  const k1 = ours.reduce((s, i) => s + (sim.state.alive[i] === 1 ? sim.state.hp[i] : 0), 0);
  const m1 = theirs.reduce((s, i) => s + (sim.state.alive[i] === 1 ? sim.state.hp[i] : 0), 0);
  return { margin: (m0 - m1) / m0 - (k0 - k1) / k0, dealt: (m0 - m1) / m0 };
}

export interface CoverCell {
  /** Mean net hp margin. */
  margin: number;
  /** Mean fraction of the militia's hp destroyed. */
  dealt: number;
}
export function coverCell(kdfJson: UnitTypeJson, ground: Ground, seeds = COVER_SEEDS): CoverCell {
  const c = { margin: 0, dealt: 0 };
  for (let s = 0; s < seeds; s++) {
    const o = coverFight(kdfJson, ground, 99000 + s);
    c.margin += o.margin / seeds;
    c.dealt += o.dealt / seeds;
  }
  return c;
}

export interface CoverTable {
  grenadier: Record<Ground, CoverCell>;
  inf_squad: Record<Ground, CoverCell>;
  /** margin(grenadier) - margin(inf_squad): the claim reads this. */
  advantage: Record<Ground, number>;
  /** dealt(grenadier) / dealt(inf_squad): printed, not a claim. */
  dealtRatio: Record<Ground, number>;
}
export function coverTable(grenadier: UnitTypeJson, seeds = COVER_SEEDS): CoverTable {
  const g = { open: coverCell(grenadier, 'open', seeds), cover2: coverCell(grenadier, 'cover2', seeds) };
  const i = { open: coverCell(units.inf_squad, 'open', seeds), cover2: coverCell(units.inf_squad, 'cover2', seeds) };
  return {
    grenadier: g,
    inf_squad: i,
    advantage: { open: g.open.margin - i.open.margin, cover2: g.cover2.margin - i.cover2.margin },
    dealtRatio: { open: g.open.dealt / i.open.dealt, cover2: g.cover2.dealt / i.cover2.dealt },
  };
}
export function coverClaims(t: CoverTable): string[] {
  return t.advantage.cover2 > t.advantage.open
    ? []
    : [`grenadier advantage over inf_squad is not larger against cover: cover2 ${t.advantage.cover2.toFixed(3)} vs open ${t.advantage.open.toFixed(3)}`];
}

// ---------------------------------------------------------------------------
// Probe 10: the robot dog finds a buried route.
//   Synthetic: a 48x48 map, one pre_dug route along y=30 (x 2..46), no spoil. A carrier
//   starts 26 tiles north of it and is ordered to drive south across it. The reading is
//   the first tick side 0 holds the route identified (`mark_tunnel` + a clear sight line,
//   no dwell: sight x speed is the whole story). Deterministic in the seed; 3 seeds run.
// ---------------------------------------------------------------------------
export const TUNNEL_SEEDS = 3;
export const TUNNEL_CARRIERS = ['recon_drone', 'ugv_recon_dog', 'yahalom_squad'] as const;
export type TunnelCarrier = (typeof TUNNEL_CARRIERS)[number];

export function tunnelFound(json: UnitTypeJson, seed: number): number | null {
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 4 });
  const r = sim.addTunnel({ id: 'su_route', points: [[2, 30], [46, 30]], dig_tiles_per_s: 1, pre_dug: true });
  const t = sim.addUnitType(json);
  const id = sim.spawn(t, 0, fx.from(24.5), fx.from(4.5));
  sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(24.5), y: fx.from(40.5) });
  for (let k = 0; k < 40 * TICKS_PER_SECOND; k++) {
    sim.tick();
    if (sim.tunnelContactLevel(0, r) === 2) return sim.tickCount;
  }
  return null;
}
export function tunnelTable(dog: UnitTypeJson): Record<TunnelCarrier, number | null> {
  const json: Record<TunnelCarrier, UnitTypeJson> = {
    recon_drone: units.recon_drone,
    ugv_recon_dog: dog,
    yahalom_squad: units.yahalom_squad,
  };
  const out = {} as Record<TunnelCarrier, number | null>;
  for (const c of TUNNEL_CARRIERS) {
    const ts: number[] = [];
    for (let s = 0; s < TUNNEL_SEEDS; s++) {
      const t = tunnelFound(json[c], 96000 + s);
      if (t === null) {
        ts.length = 0;
        break;
      }
      ts.push(t);
    }
    out[c] = ts.length ? median(ts) : null;
  }
  return out;
}
export function tunnelClaims(t: Record<TunnelCarrier, number | null>): string[] {
  const { recon_drone: d, ugv_recon_dog: g, yahalom_squad: y } = t;
  if (d === null || g === null || y === null) return [`a carrier never identified the route: drone ${d} dog ${g} yahalom ${y}`];
  const fails: string[] = [];
  if (!(g < y)) fails.push(`dog (${g}) does not find the route before yahalom_squad (${y})`);
  if (!(g > d)) fails.push(`dog (${g}) finds the route as early as or before the recon_drone (${d})`);
  return fails;
}

// ---------------------------------------------------------------------------
// Deferred: their ability needs engine work that does not exist yet.
// ---------------------------------------------------------------------------
export const DEFERRED: readonly { unit: string; phase: string; needs: string }[] = [
  { unit: 'at_nlos_team', phase: 'Phase 7', needs: 'E2 (indirect weapon flag)' },
  { unit: 'veh_ambulance', phase: 'Phase 5', needs: 'E1 (unit aura)' },
  { unit: 'air_medevac_heli', phase: 'Phase 5', needs: 'E1 (unit aura)' },
  { unit: 'inf_medic_squad', phase: 'Phase 5', needs: 'E1 (unit aura)' },
  { unit: 'spg_cluster', phase: 'Phase 7', needs: 'E3 (submunitions)' },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function tk(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return 'never';
  return `${x}`;
}

function main(): void {
  const t0 = Date.now();
  const fails: string[] = [];

  const d = detectTable(stagedUnit('mbt_lavi_camo'));
  console.log('');
  console.log(
    `SU probe 1 -- first tick the observer identifies the tank (${DETECT_SEEDS} seeds, ` +
      `${DETECT_CAP_TICKS / TICKS_PER_SECOND} s cap, ${TICKS_PER_SECOND} ticks/s): median [min-max] found/seeds`,
  );
  for (const o of OBSERVERS) {
    for (const m of TANK_MODES) {
      for (const tn of ['mbt_lavi', 'mbt_lavi_camo'] as const) {
        const cells = DETECT_RANGES.map((r) => {
          const c = d[tn][o][m][r];
          const nc = nonClaimReason(d, o, r, m) !== null ? '*' : ' ';
          return `${r}t${nc}${tk(c.median)} [${tk(c.min)}-${tk(c.max)}] ${c.found}/${c.seeds}`;
        });
        console.log(`${o.padEnd(13)} ${m.padEnd(7)} ${tn.padEnd(14)} ${cells.map((c) => c.padEnd(26)).join(' ')}`);
      }
    }
  }
  console.log('* = non-claim cell (outside the observer\'s sight, or the plain Lavi is not found either).');
  fails.push(...detectClaims(d));

  const dt = duelTable(stagedUnit('spg_long_range'));
  console.log('');
  console.log(`SU probe 2 -- spg_long_range vs rocket_battery, a recon_drone spotting for each side, ${DUEL_SEEDS} seeds, ${DUEL_CAP_TICKS / TICKS_PER_SECOND} s cap`);
  console.log('distance   spg wins   grad wins   draws   spg hp left   mean s');
  for (const r of DUEL_RANGES) {
    const row = dt[r];
    console.log(`${String(r).padEnd(10)} ${String(row.spgWins).padEnd(10)} ${String(row.gradWins).padEnd(11)} ${String(row.draws).padEnd(7)} ${row.spgHp.toFixed(2).padEnd(13)} ${(row.meanTicks / TICKS_PER_SECOND).toFixed(1)}`);
  }
  console.log(q11Note(dt));

  const ct = coverTable(stagedUnit('inf_grenadier'));
  console.log('');
  console.log(`SU probe 9 -- 2 squads vs 3 militia_cell, net hp margin (militia lost - own lost), mean of ${COVER_SEEDS} seeds, ${COVER_CAP_TICKS / TICKS_PER_SECOND} s`);
  console.log('unit           margin open  margin cover2   dealt open  dealt cover2');
  for (const [n, c] of [['inf_grenadier', ct.grenadier], ['inf_squad', ct.inf_squad]] as const) {
    console.log(
      `${n.padEnd(14)} ${c.open.margin.toFixed(3).padEnd(12)} ${c.cover2.margin.toFixed(3).padEnd(15)} ` +
        `${c.open.dealt.toFixed(3).padEnd(11)} ${c.cover2.dealt.toFixed(3)}`,
    );
  }
  console.log(`advantage (margin diff, THE CLAIM)  open ${ct.advantage.open.toFixed(3)}  cover2 ${ct.advantage.cover2.toFixed(3)}`);
  console.log(`dealt ratio grenadier/inf_squad (printed, not a claim)  open ${ct.dealtRatio.open.toFixed(2)}x  cover2 ${ct.dealtRatio.cover2.toFixed(2)}x`);
  fails.push(...coverClaims(ct));

  const tt = tunnelTable(stagedUnit('ugv_recon_dog'));
  console.log('');
  console.log('SU probe 10 -- first tick a pre_dug route is identified, carrier driving 26 tiles to it (synthetic map)');
  for (const c of TUNNEL_CARRIERS) console.log(`${c.padEnd(15)} ${tk(tt[c])}`);
  fails.push(...tunnelClaims(tt));

  console.log('');
  for (const x of DEFERRED) console.log(`${x.unit}: deferred to ${x.phase} (needs ${x.needs})`);

  console.log('');
  if (fails.length === 0) console.log('su probes: all claims met');
  else {
    for (const f of fails) console.log(`FAIL  ${f}`);
    console.log('su probes: CLAIMS MISSED -- retune the unit (lead call), never widen a band');
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (fails.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
