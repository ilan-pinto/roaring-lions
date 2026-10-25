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
// Probe 3 (GH-274, the Tzav landing) is the placed-charge carrier against the D9 and a
// `demo_squad` on a defended house; the Tzav is a landed unit now, so it reads from
// data/units/kdf like the other two and from `@lions/data`'s `units` for the D9.
//
// Every seed is fixed. The Peten runs use `targets.ts`'s own airContested seeds, so the
// Peten column here must equal the "Air is contested by AA" line of `pnpm balance`.
//
// Run: `pnpm --filter @lions/tools e5:probes` (exit 1 when a claim fails).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, fx, TICKS_PER_SECOND, type UnitTypeJson } from '@lions/sim';
import { applyUpgrades, maxTiers, structures, type UpgradableUnit } from '@lions/data';
import { runBattle, units, unitsAtMaxTier } from './harness';

const WEST = 32768;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'e5');

/** A staged draft, read from disk exactly as the lead approved it. Typed as both a sim
 *  unit and an upgradable one, since the drafts carry their `upgrades` tracks. */
export type StagedUnit = UnitTypeJson & UpgradableUnit;
export function stagedUnit(id: string): StagedUnit {
  // A landed unit (GH-181 part 2: the Zikit and the Gunship) moved to data/units/kdf; the
  // Tzav is still staged. Same bytes either way, so the frozen probe bands do not move.
  const landed = join(ROOT, 'data', 'units', 'kdf', `${id}.json`);
  return JSON.parse(readFileSync(existsSync(landed) ? landed : join(STAGED, `${id}.json`), 'utf8')) as StagedUnit;
}

/** A staged draft at its maximum tiers -- the pre-pass `harness.ts`'s `unitsAtMaxTier`
 *  runs over the shipped KDF roster. */
export function maxTierUnit(u: StagedUnit): StagedUnit {
  return applyUpgrades(u, maxTiers(u));
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
// Probe 3 (GH-274, closes GH-156): the Tzav on a defended house.
//   The three demolishers, one at a time, ordered onto a 2x2 `house` held by two garrisoned
//   `militia_cell`, with one soft bystander (no weapons, 30,000 hp) two tiles from the house
//   centre, inside the Tzav's 2.5-tile blast. Same map, same seeds, same orders for all three.
//   What the design promised (E5 spec 1.2) and what each reading answers:
//     - "exposed 3 s; the D9 must hold 2 s, demo_squad 5 s": `exposedTicks`, the time from
//       first standing within 3 tiles of the house centre to the job being done (the charge
//       SET for the Tzav, the house down for the others);
//     - "the demolition completes after it leaves, or dies": `fell` and `carrierAlive`;
//     - "the blast damages every soft unit within 2.5 tiles, own infantry included, and the D9
//       stays the clean tool": `bystanderLost`, the hp the bystander loses on the tick the
//       house falls (bracketed, so gunfire on the approach is not counted).
// ---------------------------------------------------------------------------
export const HOUSE_SEEDS = 20;
export const HOUSE_CARRIERS = ['demo_tzav', 'dozer_d9', 'demo_squad'] as const;
export type HouseCarrier = (typeof HOUSE_CARRIERS)[number];
export const HOUSE_CAP_TICKS = 90 * TICKS_PER_SECOND;
const HOUSE_W = 40;
/** The bystander's hp: the garrison shoots it for the whole approach (a 1,000 hp one was dead
 *  before the Tzav had set its charge), so it carries enough to still stand on the fall tick. */
const BYSTANDER_HP = 30000;
/** The house's tiles (24..25, 9..10): centre (25, 10). */
const HOUSE_TILES = [9 * HOUSE_W + 24, 9 * HOUSE_W + 25, 10 * HOUSE_W + 24, 10 * HOUSE_W + 25];
const HOUSE_CX = 25;
const HOUSE_CY = 10;
/** Standing within this many tiles of the house centre counts as "at the wall". */
const AT_WALL_TILES = 3;

export interface HouseRun {
  /** The house came down inside the cap. */
  fell: boolean;
  /** Ticks at the wall until the job was done; null if it never got there or never finished. */
  exposedTicks: number | null;
  carrierAlive: boolean;
  /** hp the bystander lost on the tick the house fell (0 if it never fell). */
  bystanderLost: number;
  /** Tiles between the carrier and the house centre at the moment it fell. */
  carrierDistAtFall: number | null;
  /** Garrison killed by the fall (of 2). */
  garrisonKilled: number;
}

export function houseRun(carrierJson: UnitTypeJson, seed: number, withBystander = false): HouseRun {
  const sim = new Sim({ seed, width: HOUSE_W, height: 20, capacity: 16 });
  const house = sim.addStructureType(structures.house as Parameters<typeof sim.addStructureType>[0]);
  const militia = sim.addUnitType(units.militia_cell);
  const bystander = sim.addUnitType({
    ...units.inf_squad,
    id: 'house_bystander',
    hull: { ...units.inf_squad.hull, hp: BYSTANDER_HP },
    // Rooted: a soft unit under fire breaks and walks off, and one that left was never inside
    // the blast. Speed 0 keeps it where the escort would have stood.
    mobility: { ...units.inf_squad.mobility, speed_tiles_s: 0 },
    weapons: [],
  } as UnitTypeJson);
  const carrierType = sim.addUnitType(carrierJson);
  const s = sim.addStructure(house, HOUSE_TILES);
  const defs = [0, 1].map((k) => sim.spawn(militia, 1, fx.from(22.5), fx.from(9.5 + k), WEST));
  sim.queueCommand({ kind: 'garrison', ids: defs, structure: s });
  for (let k = 0; k < 300 && defs.some((d) => sim.state.garrisonedIn[d] !== s); k++) sim.tick();
  const by = withBystander ? sim.spawn(bystander, 0, fx.from(25), fx.from(12.2)) : -1;
  const carrier = sim.spawn(carrierType, 0, fx.from(4.5), fx.from(9.5));
  sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
  const dist = (): number =>
    Math.hypot(sim.state.posX[carrier] / 65536 - HOUSE_CX, sim.state.posY[carrier] / 65536 - HOUSE_CY);
  const placed = carrierJson.demolition_method === 'placed';
  let arrive: number | null = null;
  let done: number | null = null;
  let fell = false;
  let lost = 0;
  let atFall: number | null = null;
  for (let t = 0; t < HOUSE_CAP_TICKS && !fell; t++) {
    if (arrive === null && sim.state.alive[carrier] === 1 && dist() <= AT_WALL_TILES) arrive = t;
    const hpBefore = by >= 0 ? sim.state.hp[by] : 0;
    const aliveBefore = by >= 0 ? sim.state.alive[by] : 0;
    const dBefore = dist();
    for (const e of sim.tick()) {
      if (e.kind === 'chargeSet' && placed && done === null) done = t;
      if (e.kind === 'structureDestroyed' && e.structure === s) {
        fell = true;
        if (!placed && done === null) done = t;
      }
    }
    if (fell) {
      // The tick's own damage, bracketed: a dead bystander lost whatever it had left.
      if (by >= 0 && aliveBefore === 1) {
        lost = fx.toNumber(hpBefore) - (sim.state.alive[by] === 1 ? fx.toNumber(sim.state.hp[by]) : 0);
      }
      atFall = sim.state.alive[carrier] === 1 ? dist() : dBefore;
    }
  }
  return {
    fell,
    exposedTicks: arrive !== null && done !== null ? done - arrive : null,
    carrierAlive: sim.state.alive[carrier] === 1,
    bystanderLost: Math.max(0, lost),
    carrierDistAtFall: atFall,
    garrisonKilled: defs.filter((d) => sim.state.alive[d] !== 1).length,
  };
}

export interface HouseCase {
  fell: number;
  alive: number;
  /** Median ticks at the wall until the job was done, over the seeds that finished it. */
  medianExposed: number | null;
  /** Mean hp the bystander lost on the fall tick, over every seed. */
  meanBystanderLost: number;
  /** Seeds in which the bystander lost any hp on the fall tick. */
  bystanderHurt: number;
  seeds: number;
}

export function houseCase(carrierJson: UnitTypeJson, seeds = HOUSE_SEEDS): HouseCase {
  // Two runs a seed, because the bystander is a decoy: a garrison that is shooting it is not
  // shooting the carrier (the demo_squad lived 20 of 20 with one beside the house and died 20
  // of 20 without), so survival and exposure are read from the run with nobody else there,
  // and the blast from the run with the bystander.
  const runs: HouseRun[] = [];
  const blasts: HouseRun[] = [];
  for (let k = 0; k < seeds; k++) {
    runs.push(houseRun(carrierJson, 97000 + k));
    blasts.push(houseRun(carrierJson, 97000 + k, true));
  }
  const exposed = runs.map((r) => r.exposedTicks).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return {
    fell: runs.filter((r) => r.fell).length,
    alive: runs.filter((r) => r.carrierAlive).length,
    medianExposed: exposed.length ? exposed[exposed.length >> 1] : null,
    meanBystanderLost: blasts.reduce((a, r) => a + r.bystanderLost, 0) / seeds,
    bystanderHurt: blasts.filter((r) => r.bystanderLost > 0).length,
    seeds,
  };
}

export type HouseTable = Record<HouseCarrier, HouseCase>;

export function houseTable(tzav: UnitTypeJson, seeds = HOUSE_SEEDS): HouseTable {
  return {
    demo_tzav: houseCase(tzav, seeds),
    dozer_d9: houseCase(units.dozer_d9, seeds),
    demo_squad: houseCase(units.demo_squad, seeds),
  };
}

// ---------------------------------------------------------------------------
// The claims. Each returns the lines that failed; empty means the probe passed.
// ---------------------------------------------------------------------------

/** "Later than" on medians; a never-found case counts as +Infinity. */
function laterThan(a: DetectCase, b: DetectCase): boolean {
  return a.median > b.median;
}

/** Probe 3's claims, each from the design (E5 spec 1.2). Empty means the probe passed. */
export function houseClaims(t: HouseTable): string[] {
  const fails: string[] = [];
  const z = t.demo_tzav;
  const d = t.dozer_d9;
  const q = t.demo_squad;
  // "The demolition completes after it leaves, or dies": the house comes down and the carrier lives.
  if (z.fell < Math.ceil(0.9 * z.seeds)) fails.push(`tzav brought the house down in ${z.fell}/${z.seeds} seeds`);
  if (z.alive < Math.ceil(0.9 * z.seeds)) fails.push(`tzav alive at the end in only ${z.alive}/${z.seeds} seeds`);
  // The soft sapper cannot do the same job alone against a held house.
  if (!(z.alive > q.alive)) fails.push(`tzav survives (${z.alive}) no more often than demo_squad (${q.alive})`);
  // "Exposed 3 s; the D9 must hold 2 s": the placed charge costs the carrier more time at the wall.
  if (z.medianExposed === null || d.medianExposed === null || !(z.medianExposed > d.medianExposed)) {
    fails.push(`tzav exposed ${z.medianExposed} ticks, not longer than the D9's ${d.medianExposed}`);
  }
  // "The blast damages every soft unit within 2.5 tiles, own infantry included; the D9 stays the clean tool."
  if (z.bystanderHurt < Math.ceil(0.9 * z.seeds)) {
    fails.push(`tzav hurt the bystander in only ${z.bystanderHurt}/${z.seeds} seeds`);
  }
  if (d.meanBystanderLost !== 0) fails.push(`the D9 hurt the bystander (mean ${d.meanBystanderLost} hp)`);
  if (q.meanBystanderLost !== 0) fails.push(`demo_squad hurt the bystander (mean ${q.meanBystanderLost} hp)`);
  return fails;
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

/** The max-tier claim (lead ruling 29 Sep): a max-tier Gunship against 3 trucks survives
 *  no more often than a max-tier Peten against 2. The other two base claims are printed
 *  at max tier but are not claims there: nobody ruled on them. */
export function maxTierClaims(gunship: AirRates, peten: AirRates): string[] {
  if (gunship.survival[3] <= peten.survival[2]) return [];
  return [`max-tier gunship vs 3 trucks (${gunship.survival[3]}) beats the max-tier Peten vs 2 (${peten.survival[2]})`];
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

  // Maximum tier. Since the lead's 29 Sep ruling on the armour track ("front +0, rest to
  // sides and HP") ONE claim is made here: `maxTierClaims`. The rest is printed only.
  // Before the ruling the track added +8 front and put the Gunship back at 55, above the
  // ZU-23's penetration cliff (100/100/93 against the max-tier Peten's 100/30/30).
  const gMax = airRates(maxTierUnit(gunship));
  const pMax = airRates(unitsAtMaxTier.heli_peten);
  for (const [name, r] of [['heli_peten (max)', pMax], ['gunship (max)', gMax]] as const) {
    const s = AA_CASES.map((n) => pct(r.survival[n]).padStart(4)).join(' ');
    const c = AA_CASES.map((n) => pct(r.cleared[n]).padStart(4)).join(' ');
    console.log(`${name.padEnd(22)}${s}         ${c}`);
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


  const tzav = stagedUnit('demo_tzav');
  const h = houseTable(tzav);
  console.log('');
  console.log(
    `E5 probe 3 -- a defended house (2 militia_cell inside), ${HOUSE_SEEDS} seeds, ${HOUSE_CAP_TICKS / TICKS_PER_SECOND} s cap; ` +
      'a bystander 2.2 tiles from the centre, rooted and unarmed',
  );
  console.log('carrier       fell   alive  median exposed (ticks)  bystander hp lost on the fall tick (mean, hurt/seeds)');
  for (const c of HOUSE_CARRIERS) {
    const r = h[c];
    console.log(
      `${c.padEnd(13)} ${`${r.fell}/${r.seeds}`.padEnd(6)} ${`${r.alive}/${r.seeds}`.padEnd(6)} ${tk(r.medianExposed).padEnd(23)} ` +
        `${r.meanBystanderLost.toFixed(1)} (${r.bystanderHurt}/${r.seeds})`,
    );
  }

  const fails = [...airClaims(g, p), ...maxTierClaims(gMax, pMax), ...detectClaims(d), ...houseClaims(h)];
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
