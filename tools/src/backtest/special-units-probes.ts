// GH-709 special-units balance probes, Phase 1 ("numbers and staging").
//
// The cost curve prices hulls and guns; it cannot price what makes these units special.
// These probes measure the claims the sim can carry TODAY, against the staged drafts in
// docs/campaign/special_units/gh709 (never registered in @lions/data, so the probes load
// the JSON from disk and register it with `sim.addUnitType`, as e5-probes.ts does).
//
// Measured now: unit 1 (found late), unit 2 (reach duel), unit 9 (cover), unit 10 (tunnel
// identification, synthetic route), unit 4 (NLOS reach and precision, Phase 7, on E2) and unit 11
// (cluster, Phase 7, on E3). Units 5, 6, 7 need E1 and print a "deferred" line each. No engine
// code is written for any of them.
//
// Bands are frozen from the first measured run in
// docs/campaign/special_units/gh709/numbers.md. A probe outside its band is a unit to
// retune (the lead's call), never a band to widen.
//
// Run: `pnpm --filter @lions/tools su:probes` (exit 1 when a claim fails).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MissionRuntime,
  Sim,
  fx,
  TICKS_PER_SECOND,
  type MissionJson,
  type SimEvent,
  type UnitTypeJson,
  type WeaponJson,
} from '@lions/sim';
import { runBattle, units } from './harness';

const WEST = 32768;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'gh709');

const LANDED = join(ROOT, 'data', 'units', 'kdf');

/** A GH-709 unit's JSON: the staged draft, or -- once the unit has landed with its
 *  art and the draft is gone -- the shipped file, so a probe keeps measuring the
 *  unit as it ships. Never both: gh709_staged.test.ts refuses a half-landed id. */
export function stagedUnit(id: string): UnitTypeJson {
  const file = existsSync(join(STAGED, `${id}.json`)) ? join(STAGED, `${id}.json`) : join(LANDED, `${id}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as UnitTypeJson;
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
// Probe 4 (Phase 7, E2): the NLOS missile team.
//   4a reach without a sight line. at_nlos_team at x=4.5, the target 20 tiles east
//      (rocket_battery, then atgm_cell), a 2-tile-thick sight-blocking wall across the whole map
//      height between them (x 12-13), and a KDF recon_drone hovering 3 tiles from the target as the
//      spotter. NO identifyTo: the drone is the claim's spotter. Control: the same staged JSON with
//      `indirect` stripped (in memory). Read: kills, seconds to kill, rounds fired, and whether
//      the drone identified the target at all. 120 s cap.
//   4b the precision claim. A MissionRuntime scene with a flagged zone ("clinic") round an
//      atgm_cell; the KDF shooter is the NLOS team (18 tiles, its effective range) or, separately,
//      the shipped KDF mortar_team (13 tiles, inside its effective 14). Both are handed the
//      target by identifyTo each tick (the same way for both; the drone is 4a's question). Read:
//      Conduct lost (100 - roeScore), rounds fired, kill. 120 s cap.
// ---------------------------------------------------------------------------
export const NLOS_SEEDS = 20;
export const NLOS_CAP_TICKS = 120 * TICKS_PER_SECOND;
export const NLOS_TARGETS = ['rocket_battery', 'atgm_cell'] as const;
export type NlosTarget = (typeof NLOS_TARGETS)[number];

const WALL_TYPE = { id: 'su_wall', name: 'Wall', hp_per_tile: 900000, garrison_slots: 0, rubble_cover: 1 };

/** The staged NLOS unit with `indirect` stripped: the E2 control. */
export function withoutIndirect(j: UnitTypeJson): UnitTypeJson {
  return { ...j, weapons: (j.weapons ?? []).map((w) => ({ ...w, indirect: false })) };
}

export interface NlosReach {
  killed: boolean;
  ticks: number;
  rounds: number;
  /** The KDF side held the target identified at some tick (the drone did its job). */
  spotted: boolean;
}
export function nlosReach(nlosJson: UnitTypeJson, target: NlosTarget, seed: number, spotter: 'drone' | 'identify' = 'drone'): NlosReach {
  const sim = new Sim({ seed, width: 32, height: 24, capacity: 8 });
  const wall = sim.addStructureType(WALL_TYPE);
  const tiles: number[] = [];
  for (let y = 0; y < 24; y++) for (const x of [12, 13]) tiles.push(y * sim.width + x);
  sim.addStructure(wall, tiles);
  const nt = sim.addUnitType(nlosJson);
  const tt = sim.addUnitType(units[target]);
  const dt = sim.addUnitType(units.recon_drone);
  const me = sim.spawn(nt, 0, fx.from(4.5), fx.from(12.5));
  const it = sim.spawn(tt, 1, fx.from(24.5), fx.from(12.5), WEST);
  sim.spawn(dt, 0, fx.from(21.5), fx.from(10.5));
  let rounds = 0;
  let spotted = false;
  let t = 0;
  for (; t < NLOS_CAP_TICKS; t++) {
    if (spotter === 'identify' && sim.state.alive[it] === 1) sim.identifyTo(0, it);
    for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === me) rounds++;
    if (sim.contactLevel(0, it) === 2) spotted = true;
    if (sim.state.alive[it] === 0) break;
  }
  return { killed: sim.state.alive[it] === 0, ticks: t, rounds, spotted };
}

export interface NlosReachRow {
  kills: number;
  seeds: number;
  spotted: number;
  /** Mean seconds to the kill over the seeds that killed; null when none did. */
  meanS: number | null;
  /** Mean rounds fired over all seeds. */
  rounds: number;
}
export function nlosReachRow(json: UnitTypeJson, target: NlosTarget, seeds = NLOS_SEEDS, spotter: 'drone' | 'identify' = 'drone'): NlosReachRow {
  const row: NlosReachRow = { kills: 0, seeds, spotted: 0, meanS: null, rounds: 0 };
  let ts = 0;
  for (let s = 0; s < seeds; s++) {
    const o = nlosReach(json, target, 97500 + s, spotter);
    if (o.killed) {
      row.kills++;
      ts += o.ticks / TICKS_PER_SECOND;
    }
    if (o.spotted) row.spotted++;
    row.rounds += o.rounds / seeds;
  }
  row.meanS = row.kills ? ts / row.kills : null;
  return row;
}
export interface NlosReachTable {
  nlos: Record<NlosTarget, NlosReachRow>;
  control: Record<NlosTarget, NlosReachRow>;
}
export function nlosReachTable(nlosJson: UnitTypeJson, seeds = NLOS_SEEDS, spotter: 'drone' | 'identify' = 'drone'): NlosReachTable {
  const ctl = withoutIndirect(nlosJson);
  const out = { nlos: {}, control: {} } as NlosReachTable;
  for (const t of NLOS_TARGETS) {
    out.nlos[t] = nlosReachRow(nlosJson, t, seeds, spotter);
    out.control[t] = nlosReachRow(ctl, t, seeds, spotter);
  }
  return out;
}
export function nlosReachClaims(t: NlosReachTable): string[] {
  const fails: string[] = [];
  for (const k of NLOS_TARGETS) {
    const n = t.nlos[k];
    const c = t.control[k];
    if (n.kills * 2 <= n.seeds) fails.push(`NLOS kills ${k} behind the wall in only ${n.kills}/${n.seeds} seeds (spotted ${n.spotted}/${n.seeds})`);
    if (c.rounds > 0 || c.kills > 0) fails.push(`the flag-stripped control fired at ${k} through the wall (${c.rounds.toFixed(2)} rounds, ${c.kills} kills)`);
  }
  return fails;
}

// --- 4b -------------------------------------------------------------------
const SU_SHOOTER = 'su_shooter';
export interface ConductOutcome {
  killed: boolean;
  ticks: number;
  rounds: number;
  /** 100 - roeScore at the end. */
  lost: number;
}
export function nlosConduct(shooterJson: UnitTypeJson, dist: number, seed: number): ConductOutcome {
  const sim = new Sim({ seed, width: 40, height: 24, capacity: 8 });
  const ids = new Map<string, number>([
    [SU_SHOOTER, sim.addUnitType({ ...shooterJson, id: SU_SHOOTER })],
    ['atgm_cell', sim.addUnitType(units.atgm_cell)],
  ]);
  const mission: MissionJson = {
    id: 'su_nlos_conduct',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    starting_force: [{ unit: SU_SHOOTER, count: 1, at: [4, 12] }],
    enemy: { garrison: [{ unit: 'atgm_cell', count: 1, at: [4 + dist, 12], facing_deg: 180 }] },
    roe: { enabled: true, flagged_zones: ['clinic'], flagged_structure_penalty: 5, disproportionate_ordnance_penalty: 3 },
  };
  const runtime = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: { clinic: [4 + dist - 2, 10, 5, 5] },
  });
  runtime.start();
  const target = 1;
  let rounds = 0;
  let t = 0;
  for (; t < NLOS_CAP_TICKS; t++) {
    if (sim.state.alive[target] === 1) sim.identifyTo(0, target);
    const se = sim.tick();
    for (const e of se) if (e.kind === 'fire' && e.shooter === 0) rounds++;
    runtime.step(se);
    if (sim.state.alive[target] === 0) break;
  }
  return { killed: sim.state.alive[target] === 0, ticks: t, rounds, lost: 100 - runtime.roeScore };
}
export interface ConductRow {
  kills: number;
  seeds: number;
  rounds: number;
  /** Mean Conduct lost over all seeds. */
  lost: number;
  /** Seeds that lost any Conduct. */
  seedsCharged: number;
}
export function conductRow(run: (seed: number) => ConductOutcome, seeds: number): ConductRow {
  const r: ConductRow = { kills: 0, seeds, rounds: 0, lost: 0, seedsCharged: 0 };
  for (let s = 0; s < seeds; s++) {
    const o = run(97700 + s);
    if (o.killed) r.kills++;
    if (o.lost > 0) r.seedsCharged++;
    r.rounds += o.rounds / seeds;
    r.lost += o.lost / seeds;
  }
  return r;
}
export const NLOS_DIST = 18;
export const MORTAR_DIST = 13;
export interface NlosConductTable {
  nlos: ConductRow;
  mortar: ConductRow;
}
export function nlosConductTable(nlosJson: UnitTypeJson, seeds = NLOS_SEEDS): NlosConductTable {
  return {
    nlos: conductRow((s) => nlosConduct(nlosJson, NLOS_DIST, s), seeds),
    mortar: conductRow((s) => nlosConduct(units.mortar_team, MORTAR_DIST, s), seeds),
  };
}
export function nlosConductClaims(t: NlosConductTable): string[] {
  const fails: string[] = [];
  if (!(t.nlos.lost < t.mortar.lost)) fails.push(`NLOS loses no less Conduct than mortar_team in the flagged zone: ${t.nlos.lost.toFixed(2)} vs ${t.mortar.lost.toFixed(2)}`);
  if (t.nlos.kills * 2 <= t.nlos.seeds) fails.push(`NLOS kills the atgm_cell in only ${t.nlos.kills}/${t.nlos.seeds} seeds`);
  return fails;
}

// ---------------------------------------------------------------------------
// Probe 11 (Phase 7, E3): the cluster howitzer. The lead's four claims.
//   spg_cluster at x=4.5, y=12.5; targets 18 tiles east (x=22.5), side 1, no orders. The gun's
//   sight is 7, so the target is handed over by identifyTo every tick, as
//   packages/sim/src/special-weapons.test.ts does (the spotter's own rules are probe 4's, not
//   this one's). 90 s cap, 10 seeds. Scenes: infantry (3 sarim_rifles one tile apart), a technical
//   (front 15 mm, soft by the 30 mm rule), a house with 2 sarim_rifles garrisoned, and 3 mbt_lavi.
//   Control for what E3 buys: the same JSON with the bomblets stripped and the Phase-1 unitary
//   round restored (damage 120, splash 1.2) against the same infantry.
//   Conduct: a MissionRuntime with a civilian group beside the infantry, penalty 3, civilian
//   casualty penalty set to 0 so the reading is the ordnance rules alone (Q6) and not who died.
// ---------------------------------------------------------------------------
export const CLUSTER_SEEDS = 10;
export const CLUSTER_CAP_TICKS = 90 * TICKS_PER_SECOND;
export const CLUSTER_SCENES = ['infantry', 'technical', 'house', 'armour'] as const;
export type ClusterScene = (typeof CLUSTER_SCENES)[number];
export type ClusterGun = 'cluster' | 'unitary';

const HOUSE_TYPE = { id: 'su_house', name: 'House', hp_per_tile: 900, garrison_slots: 2, rubble_cover: 1 };

/** The Phase-1 unitary draft: one 120-damage round, splash 1.2, no bomblets. */
export function unitaryRound(j: UnitTypeJson): UnitTypeJson {
  return {
    ...j,
    weapons: (j.weapons ?? []).map((w): WeaponJson => {
      const { submunitions: _s, ...rest } = w;
      void _s;
      return { ...rest, damage: 120, splash_tiles: 1.2 };
    }),
  };
}

export interface ClusterOutcome {
  /** Fraction of the targets' starting hp destroyed (the men, for the house). */
  hpLost: number;
  rounds: number;
  /** Peak mean suppression of the targets over the run, 0..1 of a full scale (Q16.16 / 65536). */
  peakSupp: number;
  /** The house's hp lost (house scene only). */
  houseLost: number;
  /** Targets that were garrisoned when the shooting started (house scene). */
  garrisoned: number;
}
export function clusterRun(gunJson: UnitTypeJson, scene: ClusterScene, seed: number): ClusterOutcome {
  const sim = new Sim({ seed, width: 48, height: 24, capacity: 16 });
  const gt = sim.addUnitType(gunJson);
  sim.spawn(gt, 0, fx.from(4.5), fx.from(12.5));
  const ids: number[] = [];
  let house = -1;
  let garrisoned = 0;
  if (scene === 'infantry') {
    const t = sim.addUnitType(units.sarim_rifles);
    for (const y of [11.5, 12.5, 13.5]) ids.push(sim.spawn(t, 1, fx.from(22.5), fx.from(y), WEST));
  } else if (scene === 'technical') {
    ids.push(sim.spawn(sim.addUnitType(units.technical), 1, fx.from(22.5), fx.from(12.5), WEST));
  } else if (scene === 'armour') {
    const t = sim.addUnitType(units.mbt_lavi);
    for (const y of [11.5, 12.5, 13.5]) ids.push(sim.spawn(t, 1, fx.from(22.5), fx.from(y), WEST));
  } else {
    const ht = sim.addStructureType(HOUSE_TYPE);
    house = sim.addStructure(ht, [12 * sim.width + 22]);
    const t = sim.addUnitType(units.sarim_rifles);
    for (const y of [12.5, 12.5]) ids.push(sim.spawn(t, 1, fx.from(21.5), fx.from(y), WEST));
    sim.queueCommand({ kind: 'garrison', ids: [...ids], structure: house });
    for (let k = 0; k < 120 && ids.some((i) => sim.state.garrisonedIn[i] !== house); k++) sim.tick();
    garrisoned = ids.filter((i) => sim.state.garrisonedIn[i] === house).length;
  }
  const hp0 = ids.reduce((s, i) => s + sim.state.hp[i], 0);
  const houseHp0 = house >= 0 ? sim.structures.hp[house] : 0;
  let rounds = 0;
  let peak = 0;
  for (let k = 0; k < CLUSTER_CAP_TICKS; k++) {
    for (const i of ids) if (sim.state.alive[i] === 1) sim.identifyTo(0, i);
    for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === 0) rounds++;
    let sup = 0;
    for (const i of ids) if (sim.state.alive[i] === 1) sup += sim.state.suppression[i];
    peak = Math.max(peak, sup / ids.length / 65536);
  }
  const hp1 = ids.reduce((s, i) => s + (sim.state.alive[i] === 1 ? sim.state.hp[i] : 0), 0);
  return {
    hpLost: (hp0 - hp1) / hp0,
    rounds,
    peakSupp: peak,
    houseLost: house >= 0 ? (houseHp0 - sim.structures.hp[house]) / houseHp0 : 0,
    garrisoned,
  };
}
export interface ClusterRow {
  seeds: number;
  hpLost: number;
  /** Fewest / most hp lost in any seed (the house and armour claims read the max). */
  hpLostMax: number;
  rounds: number;
  /** hp fraction destroyed per round fired. */
  perRound: number;
  peakSupp: number;
  houseLost: number;
  garrisoned: number;
}
export function clusterRow(gunJson: UnitTypeJson, scene: ClusterScene, seeds = CLUSTER_SEEDS): ClusterRow {
  const r: ClusterRow = { seeds, hpLost: 0, hpLostMax: 0, rounds: 0, perRound: 0, peakSupp: 0, houseLost: 0, garrisoned: 0 };
  let perRoundSum = 0;
  for (let s = 0; s < seeds; s++) {
    const o = clusterRun(gunJson, scene, 97800 + s);
    r.hpLost += o.hpLost / seeds;
    r.hpLostMax = Math.max(r.hpLostMax, o.hpLost);
    r.rounds += o.rounds / seeds;
    perRoundSum += o.rounds > 0 ? o.hpLost / o.rounds : 0;
    r.peakSupp += o.peakSupp / seeds;
    r.houseLost += o.houseLost / seeds;
    r.garrisoned += o.garrisoned / seeds;
  }
  r.perRound = perRoundSum / seeds;
  return r;
}
export interface ClusterConductRow {
  seeds: number;
  rounds: number;
  /** Mean Conduct lost over all seeds. */
  lost: number;
  /** Mean Conduct lost per round fired (seed mean of lost / rounds). */
  perRound: number;
  civDead: number;
}
const CIV: UnitTypeJson = {
  id: 'su_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 }, suppression_resistance: 0.15 },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7, firing_signature_mult: 1.0 },
};
export function clusterConduct(gunJson: UnitTypeJson, seed: number): { rounds: number; lost: number; civDead: number } {
  const sim = new Sim({ seed, width: 48, height: 24, capacity: 16 });
  const ids = new Map<string, number>([
    ['su_gun', sim.addUnitType({ ...gunJson, id: 'su_gun' })],
    ['sarim_rifles', sim.addUnitType(units.sarim_rifles)],
    ['su_civ', sim.addUnitType(CIV)],
  ]);
  const mission: MissionJson = {
    id: 'su_cluster_conduct',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    starting_force: [{ unit: 'su_gun', count: 1, at: [4, 12] }],
    enemy: { garrison: [{ unit: 'sarim_rifles', count: 3, at: [22, 12], facing_deg: 180 }] },
    civilians: { groups: [{ unit: 'su_civ', count: 2, at: [22, 14] }] },
    roe: { enabled: true, civilian_casualty_penalty: 0, disproportionate_ordnance_penalty: 3 },
  };
  const runtime = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { refuge: [44, 20] },
    zones: {},
  });
  runtime.start();
  let rounds = 0;
  for (let k = 0; k < CLUSTER_CAP_TICKS; k++) {
    for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 1 && sim.state.alive[i] === 1) sim.identifyTo(0, i);
    const se: SimEvent[] = sim.tick();
    for (const e of se) if (e.kind === 'fire' && e.shooter === 0) rounds++;
    runtime.step(se);
  }
  let civDead = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 2 && sim.state.alive[i] === 0) civDead++;
  return { rounds, lost: 100 - runtime.roeScore, civDead };
}
export function clusterConductRow(gunJson: UnitTypeJson, seeds = CLUSTER_SEEDS): ClusterConductRow {
  const r: ClusterConductRow = { seeds, rounds: 0, lost: 0, perRound: 0, civDead: 0 };
  for (let s = 0; s < seeds; s++) {
    const o = clusterConduct(gunJson, 97900 + s);
    r.rounds += o.rounds / seeds;
    r.lost += o.lost / seeds;
    r.perRound += (o.rounds > 0 ? o.lost / o.rounds : 0) / seeds;
    r.civDead += o.civDead / seeds;
  }
  return r;
}
export interface ClusterTable {
  cluster: Record<ClusterScene, ClusterRow>;
  /** The unitary control, against the open infantry only. */
  unitary: ClusterRow;
  conduct: { cluster: ClusterConductRow; unitary: ClusterConductRow };
}
export function clusterTable(json: UnitTypeJson, seeds = CLUSTER_SEEDS): ClusterTable {
  const cluster = {} as Record<ClusterScene, ClusterRow>;
  for (const s of CLUSTER_SCENES) cluster[s] = clusterRow(json, s, seeds);
  const uni = unitaryRound(json);
  return {
    cluster,
    unitary: clusterRow(uni, 'infantry', seeds),
    conduct: { cluster: clusterConductRow(json, seeds), unitary: clusterConductRow(uni, seeds) },
  };
}
export function clusterClaims(t: ClusterTable): string[] {
  const fails: string[] = [];
  const c = t.cluster;
  // The zeros below mean "fired and did not hurt", never "never fired".
  for (const [name, row] of [['house', c.house], ['armour', c.armour]] as const) {
    if (!(row.rounds > 0)) fails.push(`cluster never fired on the ${name} scene, so its zero proves nothing`);
  }
  // Both men inside in every seed (a mean of 2), or the house zero reads men in the open.
  if (Math.abs(c.house.garrisoned - 2) > 1e-9) fails.push(`the house scene garrisoned ${c.house.garrisoned.toFixed(2)} men on average, not 2`);
  if (!(c.infantry.hpLost > 0.5)) fails.push(`cluster destroys only ${c.infantry.hpLost.toFixed(2)} of open infantry hp in 90 s`);
  if (!(c.technical.hpLost > 0.5)) fails.push(`cluster destroys only ${c.technical.hpLost.toFixed(2)} of a technical's hp in 90 s`);
  if (c.house.hpLostMax !== 0) fails.push(`cluster hurt garrisoned men (worst seed ${c.house.hpLostMax.toFixed(3)} of their hp)`);
  if (c.house.houseLost !== 0) fails.push(`cluster hurt the house (${c.house.houseLost.toFixed(3)})`);
  if (!(c.house.peakSupp > 0)) fails.push('cluster did not suppress the garrisoned men');
  if (c.armour.hpLostMax !== 0) fails.push(`cluster hurt armour (worst seed ${c.armour.hpLostMax.toFixed(3)} of their hp)`);
  if (!(c.infantry.perRound > t.unitary.perRound)) fails.push(`cluster destroys no more per round than the unitary draft: ${c.infantry.perRound.toFixed(3)} vs ${t.unitary.perRound.toFixed(3)}`);
  if (!(t.conduct.cluster.perRound >= t.conduct.unitary.perRound)) fails.push(`cluster costs less Conduct per round than the unitary draft: ${t.conduct.cluster.perRound.toFixed(2)} vs ${t.conduct.unitary.perRound.toFixed(2)}`);
  return fails;
}

// ---------------------------------------------------------------------------
// Deferred: their ability needs engine work that does not exist yet.
// ---------------------------------------------------------------------------
export const DEFERRED: readonly { unit: string; phase: string; needs: string }[] = [
  { unit: 'veh_ambulance', phase: 'Phase 5', needs: 'E1 (unit aura)' },
  { unit: 'air_medevac_heli', phase: 'Phase 5', needs: 'E1 (unit aura)' },
  { unit: 'inf_medic_squad', phase: 'Phase 5', needs: 'E1 (unit aura)' },
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

  const nt = nlosReachTable(stagedUnit('at_nlos_team'));
  console.log('');
  console.log(`SU probe 4a -- at_nlos_team vs a target 20 tiles east behind a 2-tile wall, a recon_drone spotting (no identifyTo), ${NLOS_SEEDS} seeds, ${NLOS_CAP_TICKS / TICKS_PER_SECOND} s cap`);
  console.log('target          variant      kills   spotted   mean s to kill   rounds fired');
  for (const k of NLOS_TARGETS) {
    for (const [v, r] of [['nlos', nt.nlos[k]], ['no indirect', nt.control[k]]] as const) {
      console.log(`${k.padEnd(15)} ${v.padEnd(12)} ${`${r.kills}/${r.seeds}`.padEnd(7)} ${`${r.spotted}/${r.seeds}`.padEnd(9)} ${(r.meanS === null ? 'never' : r.meanS.toFixed(1)).padEnd(16)} ${r.rounds.toFixed(2)}`);
    }
  }
  fails.push(...nlosReachClaims(nt));

  const nc = nlosConductTable(stagedUnit('at_nlos_team'));
  console.log('');
  console.log(`SU probe 4b -- Conduct lost killing an atgm_cell inside a flagged zone (clinic), ${NLOS_SEEDS} seeds, ${NLOS_CAP_TICKS / TICKS_PER_SECOND} s cap`);
  console.log('shooter        distance   kills   rounds   Conduct lost (mean)   seeds charged');
  for (const [n, d, r] of [['at_nlos_team', NLOS_DIST, nc.nlos], ['mortar_team', MORTAR_DIST, nc.mortar]] as const) {
    console.log(`${n.padEnd(14)} ${String(d).padEnd(10)} ${`${r.kills}/${r.seeds}`.padEnd(7)} ${r.rounds.toFixed(2).padEnd(8)} ${r.lost.toFixed(2).padEnd(21)} ${r.seedsCharged}/${r.seeds}`);
  }
  fails.push(...nlosConductClaims(nc));

  const ctab = clusterTable(stagedUnit('spg_cluster'));
  console.log('');
  console.log(`SU probe 11 -- spg_cluster at 18 tiles, targets identified each tick, ${CLUSTER_SEEDS} seeds, ${CLUSTER_CAP_TICKS / TICKS_PER_SECOND} s cap`);
  console.log('scene          gun        hp lost   worst seed   rounds   hp lost/round   peak supp   house hp lost   garrisoned');
  const line = (scene: string, gun: string, r: ClusterRow) =>
    console.log(
      `${scene.padEnd(14)} ${gun.padEnd(10)} ${r.hpLost.toFixed(3).padEnd(9)} ${r.hpLostMax.toFixed(3).padEnd(12)} ${r.rounds.toFixed(2).padEnd(8)} ${r.perRound.toFixed(3).padEnd(15)} ${r.peakSupp.toFixed(3).padEnd(11)} ${r.houseLost.toFixed(3).padEnd(15)} ${r.garrisoned.toFixed(1)}`,
    );
  for (const s of CLUSTER_SCENES) line(s, 'cluster', ctab.cluster[s]);
  line('infantry', 'unitary', ctab.unitary);
  console.log('Conduct, 3 sarim_rifles + 2 civilians 2 tiles off, disproportionate_ordnance_penalty 3, civilian casualty penalty 0:');
  console.log('gun        rounds   Conduct lost   lost/round   civilians dead');
  for (const [n, r] of [['cluster', ctab.conduct.cluster], ['unitary', ctab.conduct.unitary]] as const) {
    console.log(`${n.padEnd(10)} ${r.rounds.toFixed(2).padEnd(8)} ${r.lost.toFixed(2).padEnd(14)} ${r.perRound.toFixed(2).padEnd(12)} ${r.civDead.toFixed(2)}`);
  }
  fails.push(...clusterClaims(ctab));

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
