// GH-277 Task 14: the §9 probes of the field-works spec (docs/superpowers/specs/2026-09-29-field-works-design.md §9),
// run headless against the real sim and the real data. Every seed is fixed and every structure type comes from
// data/structures.json, never from a literal. The bands are the spec's, fixed at G-NUM (29 Sep): a red probe is
// content to retune on the lead's call, never a band to widen.
// Run: pnpm fw:probes   (docs/campaign/field_works/probes.md records the measured values)
import { Sim, fx, TICKS_PER_SECOND, type UnitTypeJson } from '@lions/sim';
import { structures } from '@lions/data';
import { units } from './harness';
import { urbanAssault, urbanBandPass, type UrbanHooks } from './targets';

const WEST = fx.from(0.5);
type StructureJson = Parameters<Sim['addStructureType']>[0];
const stype = (id: string): StructureJson => {
  const t = (structures as unknown as Record<string, StructureJson | undefined>)[id];
  if (t === undefined) throw new Error(`data/structures.json has no ${id}`);
  return t;
};

/** A 2x2 rectangle of tile indices with its top-left tile at (x, y). */
export function rect2(width: number, x: number, y: number): number[] {
  return [y * width + x, y * width + x + 1, (y + 1) * width + x, (y + 1) * width + x + 1];
}

const secs = (n: number): number => n * TICKS_PER_SECOND;
const alive = (sim: Sim, id: number): boolean => sim.state.alive[id] === 1;

// --- fw-garrison-supp, fw-outpost-raid -------------------------------------------------------------------------

export interface RaidOutcome {
  held: boolean;
  killed: number;
  defenderShots: number;
}

/** `defenders` rifle squads garrisoned in a 2x2 building of `building`, raided by `raiders` (unit id -> count) that
 *  attack-move onto it from the east; 120 s. A hold is at least one defender alive at the end. */
export function raid(
  seed: number,
  building: string,
  defenderCount: number,
  raiders: Readonly<Record<string, number>>
): RaidOutcome {
  const sim = new Sim({ seed, width: 64, height: 64, capacity: 96 });
  const bt = sim.addStructureType(stype(building));
  const inf = sim.addUnitType(units.inf_squad);
  const s = sim.addStructure(bt, rect2(64, 20, 30), { owner: 0 });
  const defs = Array.from({ length: defenderCount }, (_, k) => sim.spawn(inf, 0, fx.from(19.5), fx.from(30.5 + k * 0.5)));
  sim.queueCommand({ kind: 'garrison', ids: defs, structure: s });
  for (let k = 0; k < 300 && defs.some((d) => sim.state.garrisonedIn[d] !== s); k++) sim.tick();
  const atts: number[] = [];
  let n = 0;
  for (const [id, count] of Object.entries(raiders)) {
    const t = sim.addUnitType(units[id as keyof typeof units]);
    for (let i = 0; i < count; i++, n++) atts.push(sim.spawn(t, 1, fx.from(37 + (n % 2)), fx.from(26 + n), WEST));
  }
  sim.queueCommand({ kind: 'attackMove', ids: atts, x: fx.from(22.5), y: fx.from(31) });
  let defenderShots = 0;
  for (let k = 0; k < secs(120); k++) {
    for (const e of sim.tick()) if (e.kind === 'fire' && defs.includes(e.shooter)) defenderShots++;
  }
  return { held: defs.some((d) => alive(sim, d)), killed: atts.filter((a) => !alive(sim, a)).length, defenderShots };
}

export const seeds = (base: number, n: number): number[] => Array.from({ length: n }, (_, i) => base + i);
export const rate = (xs: boolean[]): number => xs.filter(Boolean).length / xs.length;
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The heavy raid (spec §9 N3): Sarim militia with RPG teams riding along. */
export const HEAVY_RAID: Readonly<Record<string, number>> = { militia_cell: 12, rpg_team: 3 };
/** The light raid is the #280 raid: eight militia cells, no launchers. */
export const LIGHT_RAID: Readonly<Record<string, number>> = { militia_cell: 8 };

// --- fw-fp-assault ---------------------------------------------------------------------------------------------

/** Four rifle squads plus `support` attack-move on a militia firing position that three militia cells hold. The
 *  position FALLS when none of its three defenders is left alive inside 300 s. */
export function fpAssault(seed: number, support: 'mortar_team' | 'at_team'): boolean {
  const sim = new Sim({ seed, width: 64, height: 64, capacity: 64 });
  const fp = sim.addStructureType(stype('militia_firing_position'));
  const inf = sim.addUnitType(units.inf_squad);
  const sup = sim.addUnitType(units[support]);
  const militia = sim.addUnitType(units.militia_cell);
  const s = sim.addStructure(fp, rect2(64, 40, 30), { owner: 1 });
  const defs = [0, 1, 2].map((k) => sim.spawn(militia, 1, fx.from(42.5), fx.from(31 + k * 0.5), WEST));
  sim.queueCommand({ kind: 'garrison', ids: defs, structure: s });
  for (let k = 0; k < 300 && defs.some((d) => sim.state.garrisonedIn[d] !== s); k++) sim.tick();
  const atts: number[] = [];
  for (let i = 0; i < 4; i++) atts.push(sim.spawn(inf, 0, fx.from(10), fx.from(28 + i * 1.5)));
  atts.push(sim.spawn(sup, 0, fx.from(8.5), fx.from(31)));
  sim.queueCommand({ kind: 'attackMove', ids: atts, x: fx.from(40), y: fx.from(31), sweep: true });
  for (let k = 0; k < secs(300); k++) {
    sim.tick();
    if ((k & 31) === 0 && defs.every((d) => !alive(sim, d))) return true;
  }
  return defs.every((d) => !alive(sim, d));
}

// --- fw-medic-lull and fw-urban-garrisoned (the §5.7 town, urbanAssault with a hook) --------------------------------

const DEFENDERS = 6;
const URBAN_SEEDS = 60;
type Rates = Record<string, number>;

function urbanRates(ratios: number[], hooks?: UrbanHooks, nSeeds = URBAN_SEEDS): Rates {
  const out: Rates = {};
  for (const ratio of ratios) {
    let wins = 0;
    // The same seeds `urbanRatio` uses, so every arm is paired with the §5.7 reading seed for seed.
    for (let k = 0; k < nSeeds; k++) if (urbanAssault(DEFENDERS * ratio, 60000 + ratio * 1000 + k, false, undefined, hooks).won) wins++;
    out[`${ratio}:1`] = wins / nSeeds;
  }
  return out;
}

/** The scripted fall-back, a PULSE per assault group: every 5 s a group under 60% of its hp walks to the point behind the
 *  line (20.5, 15.5), beside the station, and stays until it is back over 95% of its hp, has stopped healing for 40 s, or
 *  120 s have passed; then it resumes its sweep. (A first version pulled single squads back and fragmented the groups:
 *  2:1 read 0-2% with or without a station.) The same orders run in the arm with a station and the arm without one, so
 *  the station is the only variable. */
export const FALL_BACK = { x: 20.5, y: 15.5, stationX: 20, stationY: 12, below: 0.6, resume: 0.95, maxTicks: secs(120), falls: 0 };
const OBJECTIVES: [number, number][] = [[36, 7], [36, 15], [35, 24]];

export function fallBackHooks(withStation: boolean, healPerS?: number, militia?: UnitTypeJson): UrbanHooks {
  // Per assault group: null while it presses, else the tick it pulled back and the tick its hp last rose.
  type Pull = { since: number; rose: number; hp: number };
  const pulled: (Pull | null)[] = [null, null, null];
  const groupHp = (sim: Sim, g: readonly number[]): { hp: number; max: number; live: number[] } => {
    let hp = 0;
    let max = 0;
    const live: number[] = [];
    for (const id of g) {
      if (!alive(sim, id)) continue;
      live.push(id);
      hp += sim.state.hp[id];
      max += sim.unitTypes[sim.state.typeIdx[id]].hp;
    }
    return { hp, max, live };
  };
  return {
    ...(militia === undefined ? {} : { militia }),
    setup(sim) {
      pulled.fill(null);
      if (withStation) {
        const type = stype('kdf_medic_station') as StructureJson & { aura: { area: { heal_per_s: number }[] } };
        // `healPerS` is the falsification knob: the shipped type is used as authored unless a caller asks otherwise.
        const t = sim.addStructureType(
          healPerS === undefined ? type : { ...type, aura: { ...type.aura, area: [{ ...type.aura.area[0], heal_per_s: healPerS }] } }
        );
        sim.addStructure(t, rect2(sim.width, FALL_BACK.stationX, FALL_BACK.stationY), { owner: 0 });
      }
    },
    tick(sim, t, groups) {
      if (t % secs(5) !== 0) return;
      groups.forEach((g, gi) => {
        const { hp, max, live } = groupHp(sim, g);
        if (live.length === 0) return;
        const p = pulled[gi];
        if (p === null) {
          if (hp / max < FALL_BACK.below) {
            pulled[gi] = { since: t, rose: t, hp };
            FALL_BACK.falls++;
            sim.queueCommand({ kind: 'move', ids: live, x: fx.from(FALL_BACK.x), y: fx.from(FALL_BACK.y) });
          }
          return;
        }
        // The group is back at full strength, or as healed as it will get (it stopped rising for 10 s), or out of time.
        if (hp > p.hp) p.rose = t;
        p.hp = hp;
        const done = hp / max >= FALL_BACK.resume || t - p.rose >= secs(10) + secs(30) || t - p.since >= FALL_BACK.maxTicks;
        if (done) {
          pulled[gi] = null;
          sim.queueCommand({ kind: 'attackMove', ids: live, x: fx.fromInt(OBJECTIVES[gi][0]), y: fx.fromInt(OBJECTIVES[gi][1]), sweep: true });
        } else {
          // A routed man ignores orders until he rallies, so the walk back is re-asked every 5 s.
          sim.queueCommand({ kind: 'move', ids: live, x: fx.from(FALL_BACK.x), y: fx.from(FALL_BACK.y) });
        }
      });
    },
  };
}

export interface MedicLull { base: Rates; bare: Rates; station: Rates }
/** `militia` swaps the defenders' type in all three arms: the probe's falsification input (a town of weakened defenders
 *  is a walkover whether or not a station stands behind the attacker, and the band must read red on it). */
export function medicLull(nSeeds = URBAN_SEEDS, militia?: UnitTypeJson): MedicLull {
  return {
    base: urbanRates([1, 2, 3], militia === undefined ? undefined : { militia }, nSeeds),
    bare: urbanRates([1, 2, 3], fallBackHooks(false, undefined, militia), nSeeds),
    station: urbanRates([1, 2, 3], fallBackHooks(true, undefined, militia), nSeeds),
  };
}
/** The band (§9): with a station behind the attacker, 2:1 stays at or under 85% and at least 15 pp below 3:1. */
export const medicLullPasses = (r: Rates): boolean => r['2:1'] <= 0.85 && r['2:1'] <= r['3:1'] - 0.15;

/** The militia bonus on every defender. A workshop's x1.06 (and a clinic's heal) reach a defender only inside four
 *  tiles of the work, and a work in the town's own lanes would move the fight; the stand-in is the SAME x1.06 on the
 *  defenders' accuracy, which is what `hitFactors` multiplies by (`auraAccMult`, capped at ONE). */
export const MILITIA_BONUS = 1.06;
export function buffedMilitia(mult: number = MILITIA_BONUS) {
  const base = units.militia_cell;
  return { ...base, weapons: base.weapons.map((w) => ({ ...w, accuracy: Math.min(1, w.accuracy * mult) })) };
}
export const urbanGarrisoned = (militia: UnitTypeJson = buffedMilitia(), nSeeds = URBAN_SEEDS): Rates =>
  urbanRates([1, 2, 3, 4], { militia }, nSeeds);

// --- fw-workshop-pk --------------------------------------------------------------------------------------------

export interface PkOutcome { penetrations: number; hit: boolean; fightsAgain: boolean; destroyed: boolean }

/** Three Sarim ATGM cells shoot a static Lavi for 40 s, then are removed from the fight (`debugKill`). A hull with a
 *  mobility or firepower kill that is alive at 40 s, with a workshop `distance` tiles from it (null = none), fights
 *  again if both flags are clear inside 120 s more. A destroyed hull stays destroyed whatever stands beside it. */
export function workshopPk(seed: number, distance: number | null): PkOutcome {
  const sim = new Sim({ seed, width: 64, height: 64, capacity: 32 });
  const lavi = sim.addUnitType(units.mbt_lavi);
  const atgm = sim.addUnitType(units.atgm_cell);
  const wt = sim.addStructureType(stype('kdf_workshop'));
  const tank = sim.spawn(lavi, 0, fx.from(30.5), fx.from(30.5));
  if (distance !== null) sim.addStructure(wt, rect2(64, 30 - distance + 1, 30), { owner: 0 });
  const cells = [0, 1, 2].map((k) => sim.spawn(atgm, 1, fx.from(40.5), fx.from(29 + k * 1.5), WEST));
  let penetrations = 0;
  for (let k = 0; k < secs(40); k++) {
    for (const e of sim.tick()) if (e.kind === 'impact' && e.target === tank && e.penetrated) penetrations++;
  }
  for (const c of cells) if (alive(sim, c)) sim.debugKill(c);
  const hit = alive(sim, tank) && (sim.state.mobilityKilled[tank] === 1 || sim.state.firepowerKilled[tank] === 1);
  let fightsAgain = false;
  for (let k = 0; k < secs(120); k++) {
    sim.tick();
    if (hit && !fightsAgain && alive(sim, tank) && sim.state.mobilityKilled[tank] === 0 && sim.state.firepowerKilled[tank] === 0) fightsAgain = true;
  }
  return { penetrations, hit, fightsAgain, destroyed: !alive(sim, tank) };
}

export interface PkReading { distance: number | null; penetrations: number; hulls: number; again: number; per100: number; destroyedRevived: number }
export function workshopPkReading(distance: number | null, nSeeds = 30): PkReading {
  const rs = seeds(7700, nSeeds).map((s) => workshopPk(s, distance));
  const penetrations = rs.reduce((a, r) => a + r.penetrations, 0);
  const again = rs.filter((r) => r.fightsAgain).length;
  return {
    distance, penetrations, hulls: rs.filter((r) => r.hit).length, again,
    per100: penetrations === 0 ? 0 : (again / penetrations) * 100,
    destroyedRevived: 0,
  };
}

/** `destroy` stays final: a hull killed outright stays dead beside a workshop for 120 s. */
export function destroyedStaysDead(): boolean {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 8 });
  const lavi = sim.addUnitType(units.mbt_lavi);
  const wt = sim.addStructureType(stype('kdf_workshop'));
  const tank = sim.spawn(lavi, 0, fx.from(10.5), fx.from(10.5));
  sim.addStructure(wt, rect2(32, 8, 10), { owner: 0 });
  sim.debugKill(tank);
  for (let k = 0; k < secs(120); k++) sim.tick();
  return !alive(sim, tank);
}

// --- the probe table -------------------------------------------------------------------------------------------

export interface ProbeResult { id: string; kind: 'test' | 'recorded'; band: string; measured: string; pass: boolean }
const RAID_SEEDS = 30;

export function garrisonSupp(): ProbeResult {
  const rs = seeds(101, 20).map((x) => raid(x, 'house', 2, { militia_cell: 8 }));
  const killed = mean(rs.map((r) => r.killed));
  return {
    id: 'fw-garrison-supp', kind: 'test', band: 'a 2x2 garrison kills more than 0 against a raid (GH-280)',
    measured: `2 inf_squad in a 2x2 house vs 8 militia, 20 seeds: kills ${killed.toFixed(2)}/run, held ${pct(rate(rs.map((r) => r.held)))}`,
    pass: killed > 0,
  };
}

export function outpostRaid(): ProbeResult {
  const heavy = seeds(101, RAID_SEEDS).map((x) => raid(x, 'kdf_outpost', 3, HEAVY_RAID));
  const light = seeds(101, RAID_SEEDS).map((x) => raid(x, 'kdf_outpost', 3, LIGHT_RAID));
  const hold = rate(heavy.map((r) => r.held));
  return {
    id: 'fw-outpost-raid', kind: 'test', band: '3 inf_squad in an outpost: heavy-raid hold 40-80% (G-NUM measured 63%); moved by the outpost HP only, range_bonus does not move it',
    measured: `heavy (12 militia + 3 RPG) hold ${pct(hold)}, light (8 militia) hold ${pct(rate(light.map((r) => r.held)))}, ${RAID_SEEDS} seeds`,
    pass: hold >= 0.4 && hold <= 0.8,
  };
}

export function fpAssaultProbe(): ProbeResult {
  const mortar = seeds(300, RAID_SEEDS).map((x) => fpAssault(x, 'mortar_team'));
  const at = seeds(300, RAID_SEEDS).map((x) => fpAssault(x, 'at_team'));
  return {
    id: 'fw-fp-assault', kind: 'test', band: '4 inf + AT against the militia firing position: it falls >= 80%',
    measured: `4 inf + mortar falls ${pct(rate(mortar))}, 4 inf + AT falls ${pct(rate(at))}, ${RAID_SEEDS} seeds`,
    pass: rate(at) >= 0.8,
  };
}

export function medicLullProbe(): ProbeResult {
  const r = medicLull();
  const fmt = (x: Rates): string => Object.entries(x).map(([k, v]) => `${k}=${pct(v)}`).join(' ');
  return {
    id: 'fw-medic-lull', kind: 'recorded', band: 'CEILING, report-only (no heal rate moves it: 17-22%): with a station behind the attacker 2:1 <= 85% and >= 15 pp under 3:1; the hold_for replay half is unbuilt',
    measured: `${URBAN_SEEDS} seeds: unscripted ${fmt(r.base)} | fall-back, no station ${fmt(r.bare)} | fall-back, station ${fmt(r.station)}`,
    pass: medicLullPasses(r.station),
  };
}

export function urbanGarrisonedProbe(): ProbeResult {
  const r = urbanGarrisoned();
  return {
    id: 'fw-urban-garrisoned', kind: 'test', band: 'the x1.06 on every defender still passes the 5.7 urban band',
    measured: `${URBAN_SEEDS} seeds: ${Object.entries(r).map(([k, v]) => `${k}=${pct(v)}`).join(' ')}`,
    pass: urbanBandPass(r),
  };
}

export function workshopPkProbe(): ProbeResult {
  const none = workshopPkReading(null);
  const near = workshopPkReading(3);
  const far = workshopPkReading(12);
  const f = (x: PkReading): string => `${x.distance === null ? 'no workshop' : `workshop at ${x.distance}`}: ${x.again}/${x.hulls} crippled hulls fight again (${x.penetrations} penetrations, ${x.per100.toFixed(1)} per 100)`;
  const stays = destroyedStaysDead();
  return {
    id: 'fw-workshop-pk', kind: 'recorded', band: 'recorded; a destroyed hull never returns',
    measured: `${[none, near, far].map(f).join(' | ')}; destroy final: ${stays}`,
    pass: stays,
  };
}

export const PROBES: readonly (readonly [string, () => ProbeResult])[] = [
  ['fw-garrison-supp', garrisonSupp],
  ['fw-outpost-raid', outpostRaid],
  ['fw-fp-assault', fpAssaultProbe],
  ['fw-medic-lull', medicLullProbe],
  ['fw-urban-garrisoned', urbanGarrisonedProbe],
  ['fw-workshop-pk', workshopPkProbe],
];

if (process.argv[1]?.endsWith('field-works-probes.ts')) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  let red = 0;
  for (const [id, run] of PROBES) {
    if (only !== undefined && !id.includes(only)) continue;
    const r = run();
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id} [${r.kind}]  band: ${r.band}\n      ${r.measured}`);
    if (!r.pass) red++;
  }
  process.exitCode = red === 0 ? 0 : 1;
}
