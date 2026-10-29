// GH-859 P1a Task 6: non-vacuity of the formation measurements. The probes are REPORT-ONLY (nothing they
// print fails anything), so what must not pass quietly is an instrument that cannot read what it claims
// to: a friendly-fire meter that reads zero for every input, arms that are the same game, a band check
// that passes 2:1 = 3:1. Each test below was seen red under the one-line mutation named beside it
// (the commit message quotes the run).
import { describe, expect, it } from 'vitest';
import { Sim, fx } from '@lions/sim';
import { units } from '@lions/data';
import { DamageMeter, TOGETHER_TICKS, playAmbush, read, reference, seedOf } from './formation-probes';
import { urbanAssault, urbanAttackFormation, urbanBandPass } from './targets';

describe('DamageMeter: friendly splash is read', () => {
  /** An own mortar shelling an unarmed enemy that stands beside an unarmed own spotter. Nothing else is
   *  armed, so the only damage in the world is the mortar's, and it lands on both. */
  function mortarOnOwnSquad(): DamageMeter {
    const sim = new Sim({ seed: 859, width: 40, height: 24, capacity: 8 });
    const mortar = sim.addUnitType(units.mortar_team);
    const spotter = sim.addUnitType({ ...units.inf_squad, id: 'spotter', weapons: [] });
    const dummy = sim.addUnitType({ ...units.inf_squad, id: 'dummy', weapons: [], hull: { ...units.inf_squad.hull, hp: 30000 } });
    sim.spawn(mortar, 0, fx.from(10.5), fx.from(12.5));
    sim.spawn(spotter, 0, fx.from(17.5), fx.from(12.5));
    sim.spawn(dummy, 1, fx.from(18.5), fx.from(12.5), 32768);
    const meter = new DamageMeter(sim);
    for (let t = 0; t < 40 * 20; t++) sim.tick();
    return meter;
  }

  it('an own mortar that lands on its own squad reads friendly damage above zero, and damage dealt above zero', () => {
    const meter = mortarOnOwnSquad();
    expect(meter.dealt).toBeGreaterThan(0);
    expect(meter.friendly).toBeGreaterThan(0);
    expect(Object.keys(meter.friendlyBy)).toEqual(['mortar_team']);
    expect(meter.taken).toBe(0);
  });
});

describe('the ambush arms are three different games, on the same tiles', () => {
  const seed = seedOf(0);
  const ref = reference(seed, 'head');

  it('A forms and springs together, B is stanced alone from the same tiles, C never forms', () => {
    let aGrouped = -1;
    let bGroupedAfter = -1;
    let cGrouped = 0;
    const gA = playAmbush('A', seed, 'head', ref, (t, sim, ring) => {
      if (t === ref.settled) aGrouped = ring.filter((id) => sim.formationGroupOf(id) >= 0).length;
    });
    const gB = playAmbush('B', seed, 'head', ref, (t, sim, ring) => {
      if (t === ref.settled + 5) bGroupedAfter = ring.filter((id) => sim.formationGroupOf(id) >= 0).length;
    });
    const gC = playAmbush('C', seed, 'head', ref, (_t, sim, ring) => {
      cGrouped += ring.filter((id) => sim.formationGroupOf(id) >= 0).length;
    });
    expect(aGrouped).toBe(6);
    expect(gA.formationSprung).toBe(1);
    expect(bGroupedAfter).toBe(0);
    expect(gB.formationSprung).toBe(0);
    expect(cGrouped).toBe(0);
    expect(gC.formationSprung).toBe(0);
    for (const g of [gA, gB, gC]) expect(g.engaged).toBe(true);
  });

  it('C stands on A\'s tiles', () => {
    const tiles: [number, number][] = [];
    playAmbush('C', seed, 'head', ref, (t, sim, ring) => {
      if (t === ref.settled + 30) ring.forEach((id) => tiles.push([sim.state.posX[id] / 65536, sim.state.posY[id] / 65536]));
    });
    expect(tiles).toHaveLength(6);
    tiles.forEach(([x, y], k) => {
      expect(Math.abs(x - (ref.goals[k][0] + 0.5))).toBeLessThan(1.5);
      expect(Math.abs(y - (ref.goals[k][1] + 0.5))).toBeLessThan(1.5);
    });
  });

  it('fire together: A opens with far more of the ring inside a second than B or C, over three seeds', () => {
    const games = (arm: 'A' | 'B' | 'C') => [0, 1, 2].map((n) => playAmbush(arm, seedOf(n), 'head'));
    const [a, b, c] = (['A', 'B', 'C'] as const).map((arm) => read(games(arm)));
    expect(TOGETHER_TICKS).toBe(20);
    expect(a.togetherShare).toBeGreaterThan(b.togetherShare + 0.3);
    expect(a.togetherShare).toBeGreaterThan(c.togetherShare + 0.3);
    expect(a.engaged).toBe(3);
  });
});

describe('the urban band applied to the Attack formation', () => {
  const real = { '1:1': 0, '2:1': 0.3, '3:1': 1, '4:1': 1 };

  it('passes the measured reading and fails each clause once', () => {
    expect(urbanBandPass(real)).toBe(true);
    expect(urbanBandPass({ ...real, '1:1': 0.5 })).toBe(false);
    expect(urbanBandPass({ ...real, '2:1': 0.9 })).toBe(false);
    expect(urbanBandPass({ ...real, '3:1': 0.6 })).toBe(false);
    expect(urbanBandPass({ ...real, '4:1': 0.8 })).toBe(false);
  });

  it('a formation that buys a ratio step reds: 2:1 equal to 3:1 is outside the band', () => {
    // 2:1 at 3:1's reading inside the 85% cap and above 65%: only the 15-point clause can refuse it.
    expect(urbanBandPass({ '1:1': 0, '2:1': 0.8, '3:1': 0.8, '4:1': 0.8 })).toBe(false);
    // And the plain case, 2:1 at 100% beside 3:1 at 100%, which the 85% cap refuses too.
    expect(urbanBandPass({ '1:1': 0, '2:1': 1, '3:1': 1, '4:1': 1 })).toBe(false);
    // 3:1 at 90% with 2:1 at 76% is 14 points under, still a bought step; 75% is 15 points under, the line.
    expect(urbanBandPass({ '1:1': 0, '2:1': 0.76, '3:1': 0.9, '4:1': 0.9 })).toBe(false);
    expect(urbanBandPass({ '1:1': 0, '2:1': 0.75, '3:1': 0.9, '4:1': 0.9 })).toBe(true);
  });

  it('the formation arm really forms its attackers, and holds them to the band', () => {
    const r = urbanAttackFormation(1);
    // 6, 12, 18 and 24 attackers in three groups: every one of 60 a member, 15 per run.
    expect(r.detail).toContain('15.0 grouped attackers/run');
    // A run that formed nobody is a vacuous arm and fails whatever the rates read.
    expect(r.pass).toBe(true);
  }, 60_000);
});

describe('the urban Attack arm counts its grouped attackers per ratio', () => {
  // Three assault groups of 2, 4, 6 and 8 squads at 1..4:1 against 6 defenders; the formation's minimum
  // is 2 members, so every attacker is grouped. One fixed seed each (the arm's own 60000 + ratio * 1000).
  // The mean of 6, 12, 18 and 24 is the 15.0 the test above pins; a counter forced to 15 matches that
  // mean and no single ratio here.
  const defenders = 6;
  const seedFor = (ratio: number) => 60000 + ratio * 1000;

  it('formed is 6, 12, 18 and 24 at 1:1 to 4:1', () => {
    const formed = [1, 2, 3, 4].map((ratio) => urbanAssault(defenders * ratio, seedFor(ratio), false, 'attack').formed);
    expect(formed).toEqual([6, 12, 18, 24]);
    expect(formed.reduce((a, b) => a + b, 0) / formed.length).toBe(15);
  }, 60_000);

  it('the plain arm names no formation and reports 0 formed', () => {
    for (const ratio of [1, 2, 3, 4]) {
      expect(urbanAssault(defenders * ratio, seedFor(ratio)).formed).toBe(0);
    }
  }, 60_000);
});
