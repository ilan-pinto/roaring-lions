// GH-709 Phase 1: the special-units probe bands, frozen 2026-10-22.
//
// Set from the first measured run of `pnpm su:probes` against the staged drafts, recorded in
// docs/campaign/special_units/gh709/numbers.md. From this commit on they are frozen: a probe
// outside its band is a unit to retune (the lead's call), never a band to widen.
//
// Seeds are fixed and the sim is deterministic. The whole file runs the CLI's own seed counts
// (the full probe set is ~1.5 s), so a band here is exactly the number the CLI prints.
//
// KNOWN MISS, pinned as a miss (not skipped): the grenadier's advantage over inf_squad is NOT
// larger against cover on the net-hp-margin reading (cover2 0.052 vs open 0.548). The test
// asserts the miss as measured; when the unit is retuned it goes red, and the bands are
// re-frozen from a new run with the lead's ruling.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clusterClaims,
  clusterTable,
  coverClaims,
  coverTable,
  DEFERRED,
  detectClaims,
  detectTable,
  duelTable,
  nlosConductClaims,
  nlosConductTable,
  nlosReachClaims,
  nlosReachTable,
  nonClaimReason,
  OBSERVERS,
  q11Note,
  stagedUnit,
  TANK_MODES,
  tunnelClaims,
  tunnelTable,
  type ClusterTable,
  type CoverTable,
  type DetectTable,
  type DuelTable,
  type NlosConductTable,
  type NlosReachTable,
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

  // Re-frozen 22 Oct (Phase 2) after the lead's ruling cut howitzer_155 from 320 to 280 damage
  // (the Grad has 320 hp), range unchanged at 28. The 30/30 and the hp are unchanged: the Grad is
  // outranged above 20 tiles and the SPG's 1400 hp outlasts its 240-damage salvo at 20.
  it('wins every seed at every range 20-28, and loses no hp doing it (measured 22 Oct: 30/30, hp 1.00)', () => {
    for (const r of [20, 22, 24, 26, 28]) {
      expect(t[r].spgWins, `${r}`).toBe(30);
      expect(t[r].gradWins, `${r}`).toBe(0);
      expect(t[r].spgHp, `${r}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('kills the Grad in a measured time (mean seconds to the first gun falling, +/-15%)', () => {
    const measured: Record<number, number> = { 20: 32.7, 22: 34.1, 24: 33.3, 26: 35.8, 28: 34.9 };
    for (const [r, s] of Object.entries(measured)) {
      const got = t[Number(r)].meanTicks / 20;
      expect(got, `${r}`).toBeGreaterThanOrEqual(s * 0.85);
      expect(got, `${r}`).toBeLessThanOrEqual(s * 1.15);
    }
  });

  it('never kills the Grad with one round: 2 or 3 rounds hurt it on every seed (the 280-damage ruling)', () => {
    for (const r of [20, 22, 24, 26, 28]) {
      expect(t[r].hitsToKillMin, `${r}`).toBe(2);
      expect(t[r].hitsToKillMax, `${r}`).toBe(3);
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

  it('KNOWN MISS: the advantage over inf_squad is not larger against cover on the margin reading', () => {
    const fails = coverClaims(t);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/not larger against cover/);
  });

  it('net margins sit inside their bands (+/-15%, measured 22 Oct)', () => {
    // grenadier open 0.475, cover2 -0.451; inf_squad open -0.073, cover2 -0.503; advantage open 0.548, cover2 0.052
    const near = (got: number, want: number) => {
      const w = Math.abs(want) * 0.15;
      expect(got).toBeGreaterThanOrEqual(want - w);
      expect(got).toBeLessThanOrEqual(want + w);
    };
    near(t.grenadier.open.margin, 0.475);
    near(t.grenadier.cover2.margin, -0.451);
    near(t.inf_squad.open.margin, -0.073);
    near(t.inf_squad.cover2.margin, -0.503);
    near(t.advantage.open, 0.548);
    near(t.advantage.cover2, 0.052);
  });

  it('on damage dealt the grenadier does multiply further against cover (printed, not a claim)', () => {
    expect(t.dealtRatio.cover2).toBeGreaterThan(t.dealtRatio.open);
    expect(t.dealtRatio.open).toBeGreaterThan(2.4);
    expect(t.dealtRatio.open).toBeLessThan(3.3);
    expect(t.dealtRatio.cover2).toBeGreaterThan(7.4);
    expect(t.dealtRatio.cover2).toBeLessThan(10.1);
  });
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

/** +/-15% on a measured float; zero stays exactly zero. */
const near = (got: number, want: number, label = ''): void => {
  if (want === 0) {
    expect(got, label).toBe(0);
    return;
  }
  expect(got, label).toBeGreaterThanOrEqual(want * 0.85);
  expect(got, label).toBeLessThanOrEqual(want * 1.15);
};

describe('SU probe 4a: at_nlos_team reaches a target behind a wall, a drone spotting (E2)', () => {
  let t: NlosReachTable;
  beforeAll(() => {
    t = nlosReachTable(stagedUnit('at_nlos_team'));
  });

  it('kills most seeds and the flag-stripped control never fires', () => {
    expect(nlosReachClaims(t).join('\n')).toBe('');
  });

  for (const k of ['rocket_battery', 'atgm_cell'] as const) {
    it(`${k}: kills >= 16 of 20 (measured 19), spotted 20/20, time and rounds inside their bands (22 Oct)`, () => {
      const n = t.nlos[k];
      expect(n.seeds).toBe(20);
      expect(n.kills).toBeGreaterThanOrEqual(16);
      expect(n.spotted).toBe(20);
      near(n.meanS ?? 0, k === 'rocket_battery' ? 21.4 : 21.5, 'seconds');
      near(n.rounds, 1.65, 'rounds');
    });
    it(`${k}: the control never fires, never kills, and still sees the target (the wall stops the shot, not the spotting)`, () => {
      const c = t.control[k];
      expect(c.rounds).toBe(0);
      expect(c.kills).toBe(0);
      expect(c.spotted).toBe(20);
    });
  }
});

describe('SU probe 4b: Conduct lost killing an atgm_cell inside a flagged zone (E2)', () => {
  let t: NlosConductTable;
  beforeAll(() => {
    t = nlosConductTable(stagedUnit('at_nlos_team'));
  });

  it('the NLOS team loses less Conduct than mortar_team and kills', () => {
    expect(nlosConductClaims(t).join('\n')).toBe('');
  });

  it('inside the bands (measured 22 Oct: NLOS 20/20, 1.60 rounds, 0.00 lost; mortar 20/20, 4.35, 16.50)', () => {
    expect(t.nlos.kills).toBe(20);
    near(t.nlos.rounds, 1.6, 'nlos rounds');
    expect(t.nlos.lost).toBe(0);
    expect(t.nlos.seedsCharged).toBe(0);
    expect(t.mortar.kills).toBe(20);
    near(t.mortar.rounds, 4.35, 'mortar rounds');
    near(t.mortar.lost, 16.5, 'mortar lost');
    expect(t.mortar.seedsCharged).toBe(20);
  });
});

describe('SU probe 11: spg_cluster, the lead\'s four claims (E3)', () => {
  let t: ClusterTable;
  beforeAll(() => {
    t = clusterTable(stagedUnit('spg_cluster'));
  });

  it('KNOWN MISS, pinned: it does not destroy half of open infantry or a technical in 90 s (3 rounds)', () => {
    const fails = clusterClaims(t);
    expect(fails).toHaveLength(2);
    expect(fails[0]).toMatch(/open infantry/);
    expect(fails[1]).toMatch(/technical/);
  });

  it('open infantry, technical and the unitary control sit inside their bands (22 Oct)', () => {
    const c = t.cluster;
    near(c.infantry.hpLost, 0.347, 'infantry hp');
    near(c.infantry.perRound, 0.116, 'infantry per round');
    near(c.technical.hpLost, 0.248, 'technical hp');
    near(c.technical.perRound, 0.083, 'technical per round');
    near(t.unitary.hpLost, 0.175, 'unitary hp');
    near(t.unitary.perRound, 0.058, 'unitary per round');
    for (const r of [c.infantry, c.technical, c.house, c.armour, t.unitary]) near(r.rounds, 3, 'rounds');
  });

  it('the cluster destroys more per round than the unitary draft: what E3 buys (about 2x)', () => {
    expect(t.cluster.infantry.perRound).toBeGreaterThan(t.unitary.perRound * 1.7);
  });

  it('a garrisoned house: the men lose 0 hp, the house loses 0, the men ARE suppressed (Q7 and the ruling)', () => {
    const h = t.cluster.house;
    expect(h.garrisoned).toBeCloseTo(2, 9);
    expect(h.rounds).toBeGreaterThan(0);
    expect(h.hpLostMax).toBe(0);
    expect(h.houseLost).toBe(0);
    near(h.peakSupp, 0.045, 'house peak suppression');
  });

  it('an armoured column loses 0 hp, and is suppressed', () => {
    const a = t.cluster.armour;
    expect(a.rounds).toBeGreaterThan(0);
    expect(a.hpLostMax).toBe(0);
    near(a.peakSupp, 0.236, 'armour peak suppression');
  });

  it('Conduct near civilians: cluster >= unitary per round (measured 22 Oct: 5.60 vs 3.00, 16.80 vs 9.00 over 3 rounds), nobody dies', () => {
    const { cluster: c, unitary: u } = t.conduct;
    expect(c.perRound).toBeGreaterThanOrEqual(u.perRound);
    near(c.perRound, 5.6, 'cluster per round');
    near(u.perRound, 3, 'unitary per round');
    near(c.lost, 16.8, 'cluster lost');
    near(u.lost, 9, 'unitary lost');
    expect(c.civDead).toBe(0);
    expect(u.civDead).toBe(0);
  });
});

describe('SU probes: deferred units', () => {
  it('lists exactly the three that need E1 (units 4 and 11 are measured now, Phase 7)', () => {
    expect(DEFERRED.map((d) => d.unit).sort()).toEqual(['air_medevac_heli', 'inf_medic_squad', 'veh_ambulance'].sort());
  });
});
