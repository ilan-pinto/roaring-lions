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
  maxTierClaims,
  maxTierUnit,
  stagedUnit,
  type AirRates,
  type DetectTable,
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
  });

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
