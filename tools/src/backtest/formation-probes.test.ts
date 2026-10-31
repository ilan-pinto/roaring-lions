// GH-859 P1a Task 6: non-vacuity of the formation measurements. The probes are REPORT-ONLY (nothing they
// print fails anything), so what must not pass quietly is an instrument that cannot read what it claims
// to: a friendly-fire meter that reads zero for every input, arms that are the same game, a band check
// that passes 2:1 = 3:1. Each test below was seen red under the one-line mutation named beside it
// (the commit message quotes the run).
import { describe, expect, it } from 'vitest';
import { Sim, fx } from '@lions/sim';
import { units } from '@lions/data';
import {
  DamageMeter,
  TOGETHER_TICKS,
  playAir,
  playAmbush,
  playAshwar,
  playMedic,
  read,
  readAir,
  readAshwar,
  readMedic,
  reference,
  runAshwar,
  seedOf,
  type AirGame,
  type AshwarGame,
  volleyFirstOf,
  type MedicGame,
} from './formation-probes';
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

// ---------------------------------------------------------------------------------------------------------------
// GH-859 P1b Task 7: the call, medic, air and Ashwar probes. Report-only, so what must not pass quietly is an arm
// that reads nothing (no treatment, no sortie, no engagement, one outcome only) or two arms that are one game.
// Each non-vacuity test below was seen red under the one-line mutation named in the commit message.

describe('the medic arm reads treatments, and its two arms are different games', { timeout: 60_000 }, () => {
  const seeds = [0, 1, 2];
  const formed = seeds.map((n) => playMedic('column', 'formed', seedOf(n)));
  const plain = seeds.map((n) => playMedic('column', 'plain', seedOf(n)));

  it('the formed Column groups all eight, is called for its casualties and reads at least one treatment', () => {
    expect(formed.map((g) => g.grouped)).toEqual([8, 8, 8]);
    expect(formed.reduce((n, g) => n + g.casualties, 0)).toBeGreaterThanOrEqual(1);
    expect(formed.reduce((n, g) => n + g.treated, 0)).toBeGreaterThanOrEqual(1);
    expect(formed.reduce((n, g) => n + g.calls, 0)).toBeGreaterThanOrEqual(1);
    expect(formed.flatMap((g) => g.startDelays).length).toBeGreaterThanOrEqual(1);
  });
  it('the plain arm groups nobody and raises no casualty call, yet its medics also treat', () => {
    expect(plain.map((g) => g.grouped)).toEqual([0, 0, 0]);
    expect(plain.reduce((n, g) => n + g.calls, 0)).toBe(0);
    expect(plain.reduce((n, g) => n + g.treated, 0)).toBeGreaterThanOrEqual(1);
  });
  it('the arms are not the same game: the same seeds read different casualties, bleed-outs or losses', () => {
    expect(JSON.stringify(formed)).not.toBe(JSON.stringify(plain));
    const sum = (gs: MedicGame[]) => gs.reduce((n, g) => n + g.casualties * 1000 + g.bledOut * 100 + g.medicLosses * 10 + g.treated, 0);
    expect(sum(formed)).not.toBe(sum(plain));
  }, 60_000);
});

describe('a medic squad\'s own man is tended at once and kept out of the delay', { timeout: 60_000 }, () => {
  it('the Attack, seeds 0 and 1: two own-man treatments, and every counted delay is above zero', () => {
    const games = [0, 1].map((n) => playMedic('attack', 'formed', seedOf(n)));
    expect(games.reduce((n, g) => n + g.ownTreated, 0)).toBeGreaterThanOrEqual(1);
    const delays = games.flatMap((g) => g.startDelays);
    expect(delays.length).toBeGreaterThanOrEqual(1);
    expect(delays.every((d) => d > 0)).toBe(true);
  });
});

describe('readMedic over a hand-built table (literals)', () => {
  const base: MedicGame = {
    shape: 'column', arm: 'formed', grouped: 8, casualties: 0, treated: 0, ownTreated: 0, startDelays: [], stabilised: 0, evacuated: 0, bledOut: 0, unreached: 0, calls: 0,
    medicLosses: 0, outTicks: 0, busyTicks: 0, strayTicks: 0, postKilled: 0, riflesLeft: 6,
  };
  const games: MedicGame[] = [
    { ...base, casualties: 3, treated: 2, startDelays: [10, 30], bledOut: 1, stabilised: 1, unreached: 1, calls: 2, medicLosses: 1, outTicks: 100, busyTicks: 200, strayTicks: 40, postKilled: 2, riflesLeft: 4 },
    { ...base, casualties: 2, treated: 2, startDelays: [20, 40], stabilised: 2, calls: 1, outTicks: 60, busyTicks: 80 },
    { ...base },
  ];
  it('reads the median delay, the mean, the shares and the per-engagement losses', () => {
    const r = readMedic(games);
    expect(games).toHaveLength(3);
    expect(r.games).toBe(3);
    expect(r.engaged).toBe(2); // the third game has no casualty
    expect(r.casualties).toBe(5);
    expect(r.treated).toBe(4);
    expect(r.medianDelay).toBe(30); // [10, 20, 30, 40], the upper of the two middle ones
    expect(r.meanDelay).toBe(25);
    expect(r.unreached).toBe(1);
    expect(r.bledOut).toBe(1);
    expect(r.medicLosses).toBe(1);
    expect(r.lossesPerEngagement).toBe(0.5); // 1 lost over 2 engaged games, the idle third game not counted
    expect(r.meanOutTicks).toBeCloseTo(160 / 3, 9);
    expect(r.riflesLeftMean).toBeCloseTo(16 / 3, 9);
  });
  it('a table with no treatment reads null, not zero', () => {
    const r = readMedic([{ ...base }]);
    expect(r.medianDelay).toBeNull();
    expect(r.lossesPerEngagement).toBeNull();
  });
});

describe('the air arm reads sorties, and the call arm and the hull-rank arm are different games', { timeout: 60_000 }, () => {
  const seed = seedOf(0);
  const call = playAir('call', seed);
  const hull = playAir('hull', seed);

  it('the called gunship is a group member, flies a sortie and fires after contact', () => {
    expect(call.grouped).toBe(6);
    expect(call.sorties).toBeGreaterThanOrEqual(1);
    expect(call.contact).toBe(true);
    expect(call.fired).toBe(true);
    expect(call.outTicks).toBeGreaterThan(0);
  });
  it('the hull-rank gunship is in no group, flies no sortie, and still fires', () => {
    expect(hull.grouped).toBe(0);
    expect(hull.sorties).toBe(0);
    expect(hull.outTicks).toBe(0);
    expect(hull.fired).toBe(true);
  });
  it('the two arms respond differently to the same contact', () => {
    expect(call.response).not.toBe(hull.response);
  });
});

describe('readAir over a hand-built table (literals)', () => {
  const g: AirGame = {
    arm: 'call', grouped: 6, contact: true, sorties: 1, fired: true, response: 20, ahead: false, gunshipAlive: true, gunshipHpLost: 100, manpadKilled: true, outTicks: 200, returnOnlyContactTicks: 0,
  };
  it('counts the shots ahead of contact apart from the responses, and the median skips them', () => {
    const r = readAir([g, { ...g, response: 0, ahead: true, gunshipHpLost: 0 }, { ...g, response: 60, gunshipAlive: false, gunshipHpLost: 820, returnOnlyContactTicks: 3 }, { ...g, fired: false, contact: true, sorties: 0, response: 0 }]);
    expect(r.games).toBe(4);
    expect(r.fired).toBe(3);
    expect(r.ahead).toBe(1);
    expect(r.medianResponse).toBe(60); // responses [20, 60]: the upper middle
    expect(r.meanResponse).toBe(40);
    expect(r.survived).toBe(3);
    expect(r.sorties).toBe(3);
    expect(r.meanHpLost).toBe((100 + 0 + 820 + 100) / 4);
    expect(r.returnOnlyContactTicks).toBe(3);
  });
});

describe('the Ashwar arm reads engagements and both outcomes, and its two arms are different games', { timeout: 60_000 }, () => {
  // Twelve seeds is one pass over the twelve geometries (cover 0..3 x three distances); the sim draws nothing in
  // this approach, so a seed index chooses a geometry and repeats it.
  const rows = runAshwar(12);
  const col = rows.find((r) => r.arm === 'column' && r.cover === null);
  const pl = rows.find((r) => r.arm === 'plain' && r.cover === null);
  it('has an all-games row and a row per cover for each arm', () => {
    expect(rows).toHaveLength(10);
    expect(col).toBeDefined();
    expect(pl).toBeDefined();
  });
  it('the Column arm meets the team in every geometry, the team fires in some, and the outcomes are both seen', () => {
    expect(col?.met).toBe(12);
    expect(col?.engaged).toBeGreaterThanOrEqual(1);
    expect(col?.volleyFirst).toBeGreaterThanOrEqual(1); // the claim holds in some geometry
    expect(col?.foundFirst).toBeGreaterThanOrEqual(1); // and fails in another
    expect(col?.volleyFirst).toBe((col?.met ?? 0) - (col?.foundFirst ?? 0));
  });
  it('the arms are different games: the Column groups its four hulls, the plain arm none, and they read differently', () => {
    expect(col?.grouped).toBe(48);
    expect(pl?.grouped).toBe(0);
    expect(pl?.engaged).toBeGreaterThanOrEqual(1);
    expect(col?.volleyFirst).not.toBe(pl?.volleyFirst);
  });
  it('the team is in the ambush stance and holds its first volley until the column is inside radius 3', () => {
    for (const [arm, cover, offset] of [['column', 3, 0.5], ['column', 3, 2.5], ['plain', 0, 0.5]] as const) {
      const g = playAshwar(arm, seedOf(0), offset, cover);
      expect(g.stanced, `${arm} ${cover} ${offset}`).toBe(true);
      expect(g.volleyRange).toBeGreaterThan(2);
      expect(g.volleyRange).toBeLessThan(3.5); // an RPG team out of ambush opens at its range of 5
    }
  });
  it('one geometry, one seed: the Column in bare ground is found before the team fires', () => {
    const g = playAshwar('column', seedOf(0), 0.5, 0);
    expect(g.met).toBe(true);
    expect(g.volleyFirst).toBe(false);
    expect(g.identified).toBeGreaterThan(0);
    expect(g.engaged).toBe(false);
    const w = playAshwar('column', seedOf(0), 0.5, 3);
    expect(w.volleyFirst).toBe(true);
    expect(w.firstVolley).toBeLessThan(w.identified);
  });
});

describe('readAshwar over a hand-built table (literals)', () => {
  const g: AshwarGame = {
    arm: 'column', cover: 0, offset: 0.5, grouped: 4, engaged: true, firstVolley: 400, identified: 410, stanced: true, volleyRange: 2.9, met: true, volleyFirst: true, hullsKilled: 1, teamKilled: true,
  };
  it('splits met games into volley-first and found-first, counting the found ones that then fired', () => {
    const r = readAshwar([
      g,
      { ...g, firstVolley: 200 },
      { ...g, volleyFirst: false, identified: 100, firstVolley: 300 }, // found first, then fired
      { ...g, volleyFirst: false, engaged: false, firstVolley: -1, identified: 100, teamKilled: false }, // found first, never fired
      { ...g, met: false, volleyFirst: false, engaged: false, firstVolley: -1, identified: -1 }, // never met
    ]);
    expect(r.games).toBe(5);
    expect(r.met).toBe(4);
    expect(r.volleyFirst).toBe(2);
    expect(r.foundFirst).toBe(2);
    expect(r.foundThenFired).toBe(1);
    expect(r.engaged).toBe(3);
    expect(r.medianFirstVolley).toBe(300); // [200, 300, 400]
    expect(r.teamKilled).toBe(4);
    expect(r.hullsKilled).toBe(5);
  });
});

describe('the Ambush re-run with aircraft', { timeout: 60_000 }, () => {
  const seed = seedOf(0);
  const air = playAmbush('A', seed, 'head', reference(seed, 'head', true), undefined, true);
  it('flies at least one sortie, the group forms around the six, and the counters are inside their bounds', () => {
    expect(air.sorties).toBeGreaterThanOrEqual(1);
    expect(air.grouped).toBe(6);
    expect(air.airAlive).toBeLessThanOrEqual(2);
    expect(air.returnOnlyContactTicks).toBeGreaterThanOrEqual(0);
    expect(air.engaged).toBe(true);
  });
  it('the ring-only game flies none, and a B or C arm cannot carry aircraft', () => {
    expect(playAmbush('A', seed, 'head').sorties).toBe(0);
    expect(() => playAmbush('B', seed, 'head', reference(seed, 'head', true), undefined, true)).toThrow(/arm A only/);
  });
});

describe('volleyFirstOf (literals): identified entering the volley\'s own tick is identified first', () => {
  it('the table of five', () => {
    const table: [number, number, boolean][] = [
      [200, 201, true], // identified a tick after the volley
      [200, 200, false], // identified entering the volley's tick: the column had it
      [200, 150, false],
      [200, -1, true], // never identified
      [-1, 5, false], // never fired
    ];
    expect(table).toHaveLength(5);
    for (const [volley, id, want] of table) expect(volleyFirstOf(volley, id), `${volley}/${id}`).toBe(want);
  });
});
