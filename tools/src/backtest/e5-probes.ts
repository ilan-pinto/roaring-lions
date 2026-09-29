// E5 special-forces balance probes (GH-181, Task 4).
//
// The cost curve (`validate_balance.py --also`) prices hulls and guns. It cannot price
// what makes two of the E5 units special: the Gunship's rocket pods in contested air,
// and the Zikit's low signature. These probes carry those, against the staged drafts in
// docs/campaign/special_units/e5 -- no shipped mission fields either unit, so the
// probes load the staged JSON directly and register it with `sim.addUnitType`.
//
// The acceptance bands were set from the first measured run and are frozen in
// docs/campaign/special_units/e5/numbers.md. A probe outside its band is a unit to
// retune (the lead's call, since the numbers were approved), never a band to widen.
//
// Every seed is fixed. The Peten runs use `targets.ts`'s own airContested seeds, so the
// Peten column here must equal the "Air is contested by AA" line of `pnpm balance`.
//
// Run: `pnpm --filter @lions/tools e5:probes` (exit 1 when a claim fails).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, fx, TICKS_PER_SECOND, type UnitTypeJson } from '@lions/sim';
import { applyUpgrades, maxTiers, type UpgradableUnit } from '@lions/data';
import { runBattle, units, unitsAtMaxTier } from './harness';

const WEST = 32768;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'e5');

/** A staged draft, read from disk exactly as the lead approved it. Typed as both a sim
 *  unit and an upgradable one, since the drafts carry their `upgrades` tracks. */
export type StagedUnit = UnitTypeJson & UpgradableUnit;
export function stagedUnit(id: string): StagedUnit {
  return JSON.parse(readFileSync(join(STAGED, `${id}.json`), 'utf8')) as StagedUnit;
}

// ---------------------------------------------------------------------------
// Probe 1: the Gunship in contested air.
//   `targets.ts`'s gunshipRun, with the helicopter as a parameter: one firing pass
//   (attackMove through the battery) against 1-3 ZU-23 gun trucks, 90 s cap.
// ---------------------------------------------------------------------------
export const GUNSHIP_SEEDS = 30;
export const AA_CASES = [1, 2, 3] as const;

export interface PassOutcome {
  survived: boolean;
  cleared: boolean;
}

export function gunshipPass(heliJson: UnitTypeJson, seed: number, aaCount: number): PassOutcome {
  const sim = new Sim({ seed, width: 40, height: 20, capacity: 8 });
  const heli = sim.addUnitType(heliJson);
  const aa = sim.addUnitType(units.gun_truck);
  const id = sim.spawn(heli, 0, fx.from(4.5), fx.from(10.5));
  for (let n = 0; n < aaCount; n++) {
    sim.spawn(aa, 1, fx.from(24.5 + (n % 2) * 2), fx.from(8.5 + n * 2), WEST);
  }
  sim.queueCommand({ kind: 'attackMove', ids: [id], x: fx.from(26), y: fx.from(10.5) });
  const { alive } = runBattle(sim, 90 * TICKS_PER_SECOND);
  return { survived: alive[0] > 0, cleared: alive[1] === 0 };
}

export interface AirRates {
  /** Survival rate by truck count, 1..3. */
  survival: Record<number, number>;
  /** Position-cleared rate by truck count, 1..3. */
  cleared: Record<number, number>;
}

export function airRates(heliJson: UnitTypeJson, seeds = GUNSHIP_SEEDS): AirRates {
  const survival: Record<number, number> = {};
  const cleared: Record<number, number> = {};
  for (const n of AA_CASES) {
    let lived = 0;
    let clear = 0;
    for (let s = 0; s < seeds; s++) {
      const o = gunshipPass(heliJson, 91000 + n * 1000 + s, n);
      if (o.survived) lived++;
      if (o.cleared) clear++;
    }
    survival[n] = lived / seeds;
    cleared[n] = clear / seeds;
  }
  return { survival, cleared };
}

// ---------------------------------------------------------------------------
// Probe 2: the Zikit is found late.
//   One militia_cell faces the probe unit across open ground at 4, 6 and 8 tiles.
//   The reading is the first tick the militia side holds the probe unit identified
//   (`contactLevel === 2`, which latches the tick confidence crosses IDENTIFIED_AT).
//   "hold" registers the probe type with no weapons, so it can never raise its own
//   firing signature; "fire" registers it as drafted. Neither side has orders.
// ---------------------------------------------------------------------------
export const DETECT_SEEDS = 20;
export const DETECT_RANGES = [4, 6, 8] as const;
/** The ranges the detection claims are made at. 8 tiles is measured and printed but is
 *  a NON-CLAIM: it is outside militia_cell's sight (7), so a unit holding fire is never
 *  found there by anyone, and outside the Zikit's carbines (6), so "firing" at 8 is a
 *  hold too. A band frozen there would be vacuous. */
export const CLAIM_RANGES = [4, 6] as const;
export const DETECT_CAP_TICKS = 60 * TICKS_PER_SECOND;
export type FireMode = 'hold' | 'fire';

/** First tick the militia identifies the probe unit, or null if it never does
 *  inside DETECT_CAP_TICKS (out of sight, or the militia died first). */
export function firstIdentified(
  probeJson: UnitTypeJson,
  range: number,
  mode: FireMode,
  seed: number,
): number | null {
  const sim = new Sim({ seed, width: 24, height: 8, capacity: 4 });
  const probe = sim.addUnitType(mode === 'hold' ? { ...probeJson, weapons: [] } : probeJson);
  const militia = sim.addUnitType(units.militia_cell);
  const id = sim.spawn(probe, 0, fx.from(4.5), fx.from(4.5));
  sim.spawn(militia, 1, fx.from(4.5 + range), fx.from(4.5), WEST);
  for (let t = 0; t < DETECT_CAP_TICKS; t++) {
    sim.tick();
    if (sim.contactLevel(1, id) === 2) return sim.tickCount;
  }
  return null;
}

export interface DetectCase {
  /** Seeds in which the militia identified the probe unit at all. */
  found: number;
  /** Median first-identified tick over all seeds; a never-found seed counts as
   *  +Infinity, so a median of Infinity means most seeds never found it. */
  median: number;
  min: number | null;
  max: number | null;
}

export function detectCase(probeJson: UnitTypeJson, range: number, mode: FireMode, seeds = DETECT_SEEDS): DetectCase {
  const ticks: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const t = firstIdentified(probeJson, range, mode, 95000 + range * 100 + s);
    ticks.push(t ?? Number.POSITIVE_INFINITY);
  }
  ticks.sort((a, b) => a - b);
  const finite = ticks.filter((t) => Number.isFinite(t));
  const mid = ticks.length >> 1;
  const median = ticks.length % 2 === 1 ? ticks[mid] : (ticks[mid - 1] + ticks[mid]) / 2;
  return {
    found: finite.length,
    median,
    min: finite.length ? finite[0] : null,
    max: finite.length ? finite[finite.length - 1] : null,
  };
}

export const DETECT_UNITS = ['recon_zikit', 'sniper_team', 'inf_squad'] as const;
export type DetectUnit = (typeof DETECT_UNITS)[number];
export type DetectTable = Record<DetectUnit, Record<FireMode, Record<number, DetectCase>>>;

export function detectTable(zikit: UnitTypeJson, seeds = DETECT_SEEDS): DetectTable {
  const json: Record<DetectUnit, UnitTypeJson> = {
    recon_zikit: zikit,
    sniper_team: units.sniper_team,
    inf_squad: units.inf_squad,
  };
  const out = {} as DetectTable;
  for (const u of DETECT_UNITS) {
    out[u] = { hold: {}, fire: {} };
    for (const mode of ['hold', 'fire'] as const) {
      for (const r of DETECT_RANGES) out[u][mode][r] = detectCase(json[u], r, mode, seeds);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The claims. Each returns the lines that failed; empty means the probe passed.
// ---------------------------------------------------------------------------

/** "Later than" on medians; a never-found case counts as +Infinity. */
function laterThan(a: DetectCase, b: DetectCase): boolean {
  return a.median > b.median;
}

export function airClaims(gunship: AirRates, peten: AirRates): string[] {
  const fails: string[] = [];
  const g = gunship.survival;
  // "Falls with each added truck": never rises as a truck is added, and a battery of
  // three is strictly worse than one gun. Strict at every step is unsatisfiable together
  // with the next claim whenever the Peten's 2-truck survival is 0 (it is: 0/30).
  if (!(g[1] > g[2] && g[2] >= g[3] && g[1] > g[3])) {
    fails.push(`gunship survival does not fall with AA: 1aa=${g[1]} 2aa=${g[2]} 3aa=${g[3]}`);
  }
  if (!(g[3] <= peten.survival[2])) {
    fails.push(`gunship vs 3 trucks (${g[3]}) beats the Peten vs 2 (${peten.survival[2]})`);
  }
  if (!(gunship.cleared[1] >= peten.cleared[1])) {
    fails.push(`gunship clears 1 truck less often (${gunship.cleared[1]}) than the Peten (${peten.cleared[1]})`);
  }
  return fails;
}

export function detectClaims(t: DetectTable): string[] {
  const fails: string[] = [];
  for (const mode of ['hold', 'fire'] as const) {
    for (const r of CLAIM_RANGES) {
      const z = t.recon_zikit[mode][r];
      const inf = t.inf_squad[mode][r];
      if (!laterThan(z, inf)) {
        fails.push(`zikit (${mode}, ${r} tiles) found no later than inf_squad: median ${z.median} vs ${inf.median}`);
      }
    }
  }
  for (const r of CLAIM_RANGES) {
    const z = t.recon_zikit.fire[r];
    const sn = t.sniper_team.fire[r];
    if (!laterThan(z, sn)) {
      fails.push(`zikit (fire, ${r} tiles) found no later than sniper_team: median ${z.median} vs ${sn.median}`);
    }
  }
  return fails;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function tk(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return 'never';
  return `${x}`;
}

function main(): void {
  const t0 = Date.now();
  const gunship = stagedUnit('heli_peten_gunship');
  const zikit = stagedUnit('recon_zikit');

  const g = airRates(gunship);
  const p = airRates(units.heli_peten);
  console.log('');
  console.log(`E5 probe 1 -- one firing pass vs N gun_truck, ${GUNSHIP_SEEDS} seeds each`);
  console.log('unit                  survive 1/2/3          cleared 1/2/3');
  for (const [name, r] of [['heli_peten', p], ['heli_peten_gunship', g]] as const) {
    const s = AA_CASES.map((n) => pct(r.survival[n]).padStart(4)).join(' ');
    const c = AA_CASES.map((n) => pct(r.cleared[n]).padStart(4)).join(' ');
    console.log(`${name.padEnd(22)}${s}         ${c}`);
  }

  // Information only, NOT a claim: both helicopters at their maximum tiers. The
  // Gunship's armour track adds +8 front, which puts it back at 55 -- above the ZU-23's
  // penetration cliff (see numbers.md).
  const gMax = airRates(applyUpgrades(gunship, maxTiers(gunship)));
  const pMax = airRates(unitsAtMaxTier.heli_peten);
  for (const [name, r] of [['heli_peten (max)', pMax], ['gunship (max)', gMax]] as const) {
    const s = AA_CASES.map((n) => pct(r.survival[n]).padStart(4)).join(' ');
    const c = AA_CASES.map((n) => pct(r.cleared[n]).padStart(4)).join(' ');
    console.log(`${name.padEnd(22)}${s}         ${c}   (max tier; non-claim)`);
  }

  const d = detectTable(zikit);
  console.log('');
  console.log(
    `E5 probe 2 -- first tick militia_cell identifies the unit (${DETECT_SEEDS} seeds, ` +
      `${DETECT_CAP_TICKS / TICKS_PER_SECOND} s cap, ${TICKS_PER_SECOND} ticks/s): median [min-max] found/seeds`,
  );
  for (const mode of ['hold', 'fire'] as const) {
    for (const u of DETECT_UNITS) {
      const cells = DETECT_RANGES.map((r) => {
        const c = d[u][mode][r];
        return `${r}t ${tk(c.median)} [${tk(c.min)}-${tk(c.max)}] ${c.found}/${DETECT_SEEDS}`;
      });
      console.log(`${mode.padEnd(5)} ${u.padEnd(12)} ${cells.map((c) => c.padEnd(24)).join(' ')}`);
    }
  }
  console.log('8-tile rows are non-claims (outside militia sight 7 and Zikit weapon range 6).');

  const fails = [...airClaims(g, p), ...detectClaims(d)];
  console.log('');
  if (fails.length === 0) {
    console.log('e5 probes: all claims met');
  } else {
    for (const f of fails) console.log(`FAIL  ${f}`);
    console.log('e5 probes: CLAIMS MISSED -- retune the unit (lead call), never widen a band');
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (fails.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
