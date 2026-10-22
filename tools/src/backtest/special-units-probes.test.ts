// GH-709 Phase 1: the special-units probe bands, frozen 2026-10-22.
//
// Set from the first measured run of `pnpm su:probes` against the staged drafts, recorded in
// docs/campaign/special_units/gh709/numbers.md. From this commit on they are frozen: a probe
// outside its band is a unit to retune (the lead's call), never a band to widen.
//
// Seeds are fixed and the sim is deterministic. The whole file runs the CLI's own seed counts
// (the full probe set is ~1.5 s), so a band here is exactly the number the CLI prints.
//
// Probe 9 was a KNOWN MISS at Phase 1 (cover2 0.052 vs open 0.548). The lead ruled (22 Oct)
// that the grenades ignore part of the cover bonus; Phase 3 added the `cover_ignore` weapon
// field, retuned the staged grenadier (gl_40 cover_ignore 0.75, suppression 120 -> 300), and
// re-froze probe 9's bands from that run (numbers.md, "Phase 3"). The claim now MEETS.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  coverClaims,
  coverTable,
  DEFERRED,
  detectClaims,
  detectTable,
  duelTable,
  nonClaimReason,
  OBSERVERS,
  q11Note,
  stagedUnit,
  TANK_MODES,
  tunnelClaims,
  tunnelTable,
  type CoverTable,
  type DetectTable,
  type DuelTable,
  type Observer,
  type TankMode,
} from './special-units-probes';

/** +/-15% on a tick count (E5's band). */
const band = (x: number): readonly [number, number] => [Math.floor(x * 0.85), Math.ceil(x * 1.15)];

/** First identified tick (20 ticks/s), measured 22 Oct, claim cells only. Infinity = never found. */
const CAMO_TICKS: Record<string, Record<number, number>> = {
  'sarim_rifles/ambush': { 4: 62, 6: 142, 8: 248 },
  'sarim_rifles/moving': { 4: 21, 6: 49, 8: Infinity },
  'sarim_rifles/firing': { 4: 31, 6: 70, 8: 124 },
  'atgm_cell/ambush': { 4: 65, 6: 147, 8: 265 },
  'atgm_cell/moving': { 4: 22, 6: 51, 8: 96 },
  'atgm_cell/firing': { 4: 33, 6: 72, 8: 132 },
  'rpg_team/ambush': { 4: 85, 6: 189 },
  'rpg_team/moving': { 4: 29, 6: 69 },
  'rpg_team/firing': { 4: 37, 6: 84 },
};
const LAVI_TICKS: Record<string, Record<number, number>> = {
  'sarim_rifles/ambush': { 4: 34, 6: 76, 8: 137 },
  'sarim_rifles/moving': { 4: 12, 6: 26, 8: 47 },
  'sarim_rifles/firing': { 4: 17, 6: 38, 8: 69 },
  'atgm_cell/ambush': { 4: 36, 6: 80, 8: 142 },
  'atgm_cell/moving': { 4: 12, 6: 27, 8: 49 },
  'atgm_cell/firing': { 4: 18, 6: 40, 8: 71 },
  'rpg_team/ambush': { 4: 46, 6: 104 },
  'rpg_team/moving': { 4: 16, 6: 36 },
  'rpg_team/firing': { 4: 23, 6: 52 },
};

describe('SU probe 1: the camouflaged Lavi is found later (staged mbt_lavi_camo)', () => {
  let t: DetectTable;
  beforeAll(() => {
    t = detectTable(stagedUnit('mbt_lavi_camo'));
  });

  it('is found later than the Lavi in every claimable cell', () => {
    expect(detectClaims(t).join('\n')).toBe('');
  });

  it('claims cover exactly the pinned cells (no cell dropped into a non-claim by accident)', () => {
    const claimed: string[] = [];
    for (const o of OBSERVERS) {
      for (const m of TANK_MODES) {
        for (const r of [4, 6, 8]) if (nonClaimReason(t, o, r, m) === null) claimed.push(`${o}/${m}/${r}`);
      }
    }
    const pinned = Object.keys(CAMO_TICKS).flatMap((k) => Object.keys(CAMO_TICKS[k]).map((r) => `${k}/${r}`));
    expect(claimed.sort()).toEqual(pinned.sort());
  });

  for (const [key, ranges] of Object.entries(CAMO_TICKS)) {
    const [o, m] = key.split('/') as [Observer, TankMode];
    for (const [r, ticks] of Object.entries(ranges)) {
      it(`camo is first identified inside its band (${key}, ${r} tiles)`, () => {
        const c = t.mbt_lavi_camo[o][m][Number(r)];
        if (!Number.isFinite(ticks)) {
          expect(c.found).toBe(0);
          return;
        }
        const [lo, hi] = band(ticks);
        expect(c.found).toBe(c.seeds);
        expect(c.median).toBeGreaterThanOrEqual(lo);
        expect(c.median).toBeLessThanOrEqual(hi);
      });
      it(`the Lavi control is first identified inside its band (${key}, ${r} tiles)`, () => {
        const [lo, hi] = band(LAVI_TICKS[key][Number(r)]);
        const c = t.mbt_lavi[o][m][Number(r)];
        expect(c.median).toBeGreaterThanOrEqual(lo);
        expect(c.median).toBeLessThanOrEqual(hi);
      });
    }
  }

  it('is NOT hidden while parked in ambush: every in-sight cell finds it (the "only by firing" claim does not hold)', () => {
    for (const o of OBSERVERS) {
      for (const r of [4, 6]) expect(t.mbt_lavi_camo[o].ambush[r].found, `${o} ${r}`).toBe(t.mbt_lavi_camo[o].ambush[r].seeds);
    }
  });
});

describe('SU probe 2: spg_long_range vs rocket_battery, a drone spotting for each side', () => {
  let t: DuelTable;
  beforeAll(() => {
    t = duelTable(stagedUnit('spg_long_range'));
  });

  it('wins every seed at every range 20-28, and loses no hp doing it (measured 22 Oct: 30/30, hp 1.00)', () => {
    for (const r of [20, 22, 24, 26, 28]) {
      expect(t[r].spgWins, `${r}`).toBe(30);
      expect(t[r].gradWins, `${r}`).toBe(0);
      expect(t[r].spgHp, `${r}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('kills the Grad in a measured time (mean seconds to the first gun falling, +/-15%)', () => {
    const measured: Record<number, number> = { 20: 24.7, 22: 24.1, 24: 23.9, 26: 25.8, 28: 28.9 };
    for (const [r, s] of Object.entries(measured)) {
      const got = t[Number(r)].meanTicks / 20;
      expect(got, `${r}`).toBeGreaterThanOrEqual(s * 0.85);
      expect(got, `${r}`).toBeLessThanOrEqual(s * 1.15);
    }
  });

  it('reports Q11 as triggered (REPORT only: the range is not retuned here)', () => {
    expect(q11Note(t)).toMatch(/Q11 TRIGGERED/);
  });
});

describe('SU probe 9: the grenadier against cover (staged inf_grenadier)', () => {
  let t: CoverTable;
  beforeAll(() => {
    t = coverTable(stagedUnit('inf_grenadier'));
  });

  it('MEETS: the advantage over inf_squad is larger against cover than in the open', () => {
    expect(coverClaims(t)).toEqual([]);
  });

  it('net margins sit inside their bands (+/-15%, re-frozen 22 Oct, Phase 3)', () => {
    // grenadier open 0.570, cover2 0.181; inf_squad open -0.073, cover2 -0.503; advantage open 0.643, cover2 0.684
    const near = (got: number, want: number) => {
      const w = Math.abs(want) * 0.15;
      expect(got).toBeGreaterThanOrEqual(want - w);
      expect(got).toBeLessThanOrEqual(want + w);
    };
    near(t.grenadier.open.margin, 0.57);
    near(t.grenadier.cover2.margin, 0.181);
    near(t.inf_squad.open.margin, -0.073);
    near(t.inf_squad.cover2.margin, -0.503);
    near(t.advantage.open, 0.643);
    near(t.advantage.cover2, 0.684);
  });

  it('on damage dealt the grenadier multiplies further against cover (printed, not a claim)', () => {
    expect(t.dealtRatio.cover2).toBeGreaterThan(t.dealtRatio.open);
    // open 3.07x, cover2 49.81x (inf_squad deals 0.006 of the militia's hp there: a small
    // denominator, so this ratio moves a lot for a little).
    expect(t.dealtRatio.open).toBeGreaterThan(2.6);
    expect(t.dealtRatio.open).toBeLessThan(3.6);
    expect(t.dealtRatio.cover2).toBeGreaterThan(42.3);
    expect(t.dealtRatio.cover2).toBeLessThan(57.3);
  });

  it('the field carries the claim: without cover_ignore, or at the old suppression, it misses', () => {
    // Controls measured 22 Oct: cover_ignore removed -> cover2 0.082 vs open 0.643;
    // suppression back at 120 -> cover2 0.126 vs open 0.548. Both changes are needed.
    const g = stagedUnit('inf_grenadier');
    const without = structuredClone(g);
    delete without.weapons?.[0].cover_ignore;
    expect(coverClaims(coverTable(without))).toHaveLength(1);
    const oldSupp = structuredClone(g);
    if (oldSupp.weapons) oldSupp.weapons[0].suppression = 120;
    expect(coverClaims(coverTable(oldSupp))).toHaveLength(1);
    // Two more full cover tables (240 fights): well under a second alone, but the whole
    // suite runs 743 files in parallel.
  }, 60_000);
});

describe('SU probe 10: the robot dog finds a pre_dug route (synthetic map)', () => {
  const t = tunnelTable(stagedUnit('ugv_recon_dog'));

  it('finds it after the recon_drone and before yahalom_squad', () => {
    expect(tunnelClaims(t).join('\n')).toBe('');
  });

  it('identifies it inside its band (+/-15%; measured 22 Oct: drone 92, dog 217, yahalom 425)', () => {
    for (const [c, want] of [['recon_drone', 92], ['ugv_recon_dog', 217], ['yahalom_squad', 425]] as const) {
      const [lo, hi] = band(want);
      expect(t[c], c).toBeGreaterThanOrEqual(lo);
      expect(t[c], c).toBeLessThanOrEqual(hi);
    }
  });
});

describe('SU probes: deferred units', () => {
  it('lists exactly the five that need E1-E3', () => {
    expect(DEFERRED.map((d) => d.unit).sort()).toEqual(
      ['air_medevac_heli', 'at_nlos_team', 'inf_medic_squad', 'spg_cluster', 'veh_ambulance'].sort(),
    );
  });
});
