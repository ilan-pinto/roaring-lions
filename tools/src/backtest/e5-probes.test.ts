// E5 Task 4: the special-forces probe bands, frozen 2026-09-29 (GH-181).
//
// The bands were set from the first measured run of `pnpm e5:probes` against the staged
// drafts and are recorded in docs/campaign/special_units/e5/numbers.md. From this commit
// on they are frozen: a probe outside its band is a unit to retune (the lead's call),
// never a band to widen.
//
// Seeds are fixed and the sim is deterministic, so a band here fails only when the
// staged numbers or the combat model move.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyUpgrades } from '@lions/data';
import {
  airClaims,
  airRates,
  CLAIM_RANGES,
  detectClaims,
  detectTable,
  houseClaims,
  houseTable,
  HOUSE_SEEDS,
  maxTierClaims,
  maxTierUnit,
  stagedUnit,
  type AirRates,
  type DetectTable,
  type HouseTable,
} from './e5-probes';
import { units, unitsAtMaxTier } from './harness';

/** Measured 29 Sep at front armour 47 (lead ruling): 93/0/0, cleared 93/0/0; Peten 80/0/0. */
const GUNSHIP_BANDS = {
  survive1: [0.8, 1.0],
  survive2Max: 0.1,
  cleared1: [0.8, 1.0],
} as const;

/** First identified tick (20 ticks/s), measured 29 Sep: hold 92/209, fire 69/156; +/-15%. */
const ZIKIT_BANDS: Record<'hold' | 'fire', Record<number, readonly [number, number]>> = {
  hold: { 4: [78, 106], 6: [178, 240] },
  fire: { 4: [59, 79], 6: [133, 179] },
};

describe('E5 probe: Gunship in contested air (staged heli_peten_gunship)', () => {
  let g: AirRates;
  let p: AirRates;
  beforeAll(() => {
    g = airRates(stagedUnit('heli_peten_gunship'));
    p = airRates(units.heli_peten);
  });

  it('meets all three claims (falls with AA; <= Peten at 2 when facing 3; clears 1 as often)', () => {
    expect(airClaims(g, p).join('\n')).toBe('');
  });

  it('survives one truck inside its band', () => {
    expect(g.survival[1]).toBeGreaterThanOrEqual(GUNSHIP_BANDS.survive1[0]);
    expect(g.survival[1]).toBeLessThanOrEqual(GUNSHIP_BANDS.survive1[1]);
  });

  it('is punished by two trucks', () => {
    expect(g.survival[2]).toBeLessThanOrEqual(GUNSHIP_BANDS.survive2Max);
  });

  it('clears one truck inside its band', () => {
    expect(g.cleared[1]).toBeGreaterThanOrEqual(GUNSHIP_BANDS.cleared1[0]);
    expect(g.cleared[1]).toBeLessThanOrEqual(GUNSHIP_BANDS.cleared1[1]);
  });
});

describe('E5 probe: Gunship at maximum tier (lead ruling 29 Sep: armour track front +0)', () => {
  let g: AirRates;
  let p: AirRates;
  beforeAll(() => {
    g = airRates(maxTierUnit(stagedUnit('heli_peten_gunship')));
    p = airRates(unitsAtMaxTier.heli_peten);
    // Two whole air-rate sweeps; the 10 s hook default timed out under load.
  }, 60_000);

  it('survives 3 trucks no more often than the max-tier Peten survives 2', () => {
    expect(g.survival[3]).toBeLessThanOrEqual(p.survival[2]);
  });

  it('meets the max-tier claim', () => {
    expect(maxTierClaims(g, p).join('\n')).toBe('');
  });

  it('keeps front armour at 47 at every armour tier', () => {
    const gs = stagedUnit('heli_peten_gunship');
    for (const tier of [0, 1, 2, 3]) {
      expect(applyUpgrades(gs, { armour: tier }).hull.armor.front, `armour tier ${tier}`).toBe(47);
    }
  });
});

describe('E5 probe: the Zikit is found late (staged recon_zikit)', () => {
  let t: DetectTable;
  beforeAll(() => {
    t = detectTable(stagedUnit('recon_zikit'));
  });

  it('is found later than inf_squad (hold and fire) and than a firing sniper, at 4 and 6 tiles', () => {
    expect(detectClaims(t).join('\n')).toBe('');
  });

  for (const mode of ['hold', 'fire'] as const) {
    for (const r of CLAIM_RANGES) {
      it(`is first identified inside its band (${mode}, ${r} tiles)`, () => {
        const [lo, hi] = ZIKIT_BANDS[mode][r];
        const c = t.recon_zikit[mode][r];
        expect(c.found).toBe(20);
        expect(c.median).toBeGreaterThanOrEqual(lo);
        expect(c.median).toBeLessThanOrEqual(hi);
      });
    }
  }
});

// GH-274 (the Tzav landing, 25 Oct 2026). Measured on the landed unit, 20 seeds, the 90 s cap:
//   demo_tzav   fell 20/20  alive 20/20  median exposed 66 ticks  bystander -36.1 hp (20/20 seeds)
//   dozer_d9    fell 20/20  alive 20/20  median exposed 52 ticks  bystander 0
//   demo_squad  fell  0/20  alive  0/20  (the garrison kills it at the wall)  bystander 0
// The exposure and blast bands are +/-20% of the Tzav's measured reading (the blast reading is
// the linear falloff 300 x (1 - 2.2 / 2.5) = 36 to within a tick of fire).
const HOUSE_BANDS = {
  exposedTicks: [53, 79],
  bystanderLost: [29, 43],
} as const;

describe('E5 probe: the Tzav on a defended house (landed demo_tzav, GH-274)', () => {
  let t: HouseTable;
  beforeAll(() => {
    t = houseTable(stagedUnit('demo_tzav'));
  }, 60_000);

  it('meets every claim (completes and lives; beats the sapper; exposed longer than the D9; hurts its own, the D9 does not)', () => {
    expect(houseClaims(t).join('\n')).toBe('');
  });

  it('brings the house down and lives, in every seed', () => {
    expect(t.demo_tzav.fell).toBe(HOUSE_SEEDS);
    expect(t.demo_tzav.alive).toBe(HOUSE_SEEDS);
  });

  it('is exposed at the wall for about three seconds (inside its band)', () => {
    const m = t.demo_tzav.medianExposed ?? -1;
    expect(m).toBeGreaterThanOrEqual(HOUSE_BANDS.exposedTicks[0]);
    expect(m).toBeLessThanOrEqual(HOUSE_BANDS.exposedTicks[1]);
  });

  it('hurts a soft unit 2.2 tiles from the house by the linear falloff (inside its band)', () => {
    const m = t.demo_tzav.meanBystanderLost;
    expect(m).toBeGreaterThanOrEqual(HOUSE_BANDS.bystanderLost[0]);
    expect(m).toBeLessThanOrEqual(HOUSE_BANDS.bystanderLost[1]);
  });

  it('the D9 and a held-house sapper cannot do this alone: the D9 lives, the squad does not', () => {
    expect(t.dozer_d9.alive).toBe(HOUSE_SEEDS);
    expect(t.demo_squad.alive).toBe(0);
  });
});

// Falsification of the claims, run against the probe itself (not a synthetic table): each
// mutation is one line of the Tzav's own JSON and must turn `houseClaims` red.
describe('E5 probe: the house claims go red on a broken Tzav', () => {
  const tzav = stagedUnit('demo_tzav');

  it('a blast that stops short of the bystander (blast_tiles 1.0 for 2.5) fails "hurts its own"', () => {
    const pc = tzav.placed_charge;
    if (!pc) throw new Error('the Tzav lost its placed charge');
    const broken: typeof tzav = { ...tzav, placed_charge: { ...pc, blast_tiles: 1.0 } };
    expect(houseClaims(houseTable(broken, 5)).join('\n')).toMatch(/hurt the bystander in only 0\//);
  });

  it('a Tzav with no placed charge (a plain sapper, same 3 s) fails "hurts its own"', () => {
    const broken: typeof tzav = { ...tzav, placed_charge: undefined, demolition_method: 'charges' };
    expect(houseClaims(houseTable(broken, 5)).join('\n')).toMatch(/hurt the bystander in only 0\//);
  });

  it('a Tzav that cannot take a hit (hull armour 1, hp 300) fails "completes and lives"', () => {
    const broken = { ...tzav, hull: { ...tzav.hull, hp: 300, armor: { front: 1, side: 1, rear: 1 } } };
    expect(houseClaims(houseTable(broken, 5)).join('\n')).toMatch(/alive at the end in only/);
  });
});
