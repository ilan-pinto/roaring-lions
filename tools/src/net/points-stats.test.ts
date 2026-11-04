// GH-976 P2 / GH-973: the referee's stats in a points race -- points by source (held zones, enemy units destroyed) per seat.
// The scripted cases hand the tally a runtime of their own, with literal numbers: a minute of ticks is 1200, a score is held in
// 1/1200ths of a point, so a zone paying 30 a minute pays 30 units a tick and 100 ticks of it is 2.5 points.
import { describe, expect, it } from 'vitest';
import { versusModes } from '@lions/data';
import { Sim } from '@lions/sim';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import { modeConfig, pointsOrder } from '../backtest/versus-modes';
import { RefereeTally, POINTS_UNITS, checkReferee, refereeMarkdown, statsGlossary, type PointsTap } from './match-score';

const RULES = { target: 600, zones: [{ zone: 'ford', per_min: 30 }, { zone: 'tell', per_min: 20 }] };
const SIM = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });   // an empty world: the tally\'s sim reads see nothing, the points tap is what is under test

/** A runtime whose score and zones the case scripts. `units` is by side. */
function script() {
  const units: [number, number] = [0, 0];
  const zones = [{ zone: 'ford', state: -1, holder: -1 }, { zone: 'tell', state: -1, holder: -1 }];
  const tap: PointsTap = { runtime: { scoreUnitsOf: (s) => units[s], incomeZones: zones }, rules: RULES };
  const tally = new RefereeTally();
  tally.setPoints(tap);
  const tick = (): void => { tally.onTick(SIM, [0, 1]); };
  const stats = (sides: readonly [0 | 1, 0 | 1] = [0, 1]) => tally.stats(SIM, { map: 'wadi_tarfan', sides, factions: ['kdf', 'kdf'], result: null });
  return { units, zones, tally, tick, stats };
}

describe('RefereeTally in a points race', () => {
  it('a zone held for 100 ticks at 30 a minute is 2.5 points from zones and none from kills', () => {
    const { units, zones, tick, stats } = script();
    tick();   // the first tick seen: nothing before it is split
    zones[0].state = 0; zones[0].holder = 0;
    for (let i = 0; i < 100; i++) { units[0] += 30; tick(); }
    const s = stats();
    expect(s.seats[0].points).toEqual({ total: 2, fromZones: 2.5, fromKills: 0, byZone: { ford: 2.5 } });
    expect(s.seats[1].points).toEqual({ total: 0, fromZones: 0, fromKills: 0, byZone: {} });
    expect(s.mode).toBe('points');
    expect(s.target).toBe(600);
  });

  it('a rise beyond the zones\' rate is a kill: 3600 units (3 points) on top of a held ford is 3 from kills, and the zones keep theirs', () => {
    const { units, zones, tick, stats } = script();
    tick();
    zones[0].state = 1; zones[0].holder = 1;   // side 1 holds the ford
    zones[1].state = 1; zones[1].holder = 1;   // and the tell
    for (let i = 0; i < 60; i++) { units[1] += 50; tick(); }          // 30 + 20 a minute: 50 units a tick, 3000 units = 2.5 points
    units[1] += 50 + 3600; tick();                                    // one tick that also banks a kill worth 3 points
    const p = stats().seats[1].points!;
    expect(p.fromKills).toBe(3);
    expect(p.fromZones).toBe(2.5);   // 61 ticks x 50 units = 3050 = 2.54 points, to one decimal
    expect(p.byZone).toEqual({ ford: 1.5, tell: 1 });   // 61 x 30 = 1830 = 1.525 -> 1.5 ; 61 x 20 = 1220 = 1.017 -> 1.0
    expect(p.total).toBe(5);   // 6650 units = 5.54 -> the race\'s own whole number
  });

  it('a contested or empty zone pays nothing, so a rise there is all kills', () => {
    const { units, zones, tick, stats } = script();
    tick();
    zones[0].state = -2; zones[0].holder = 0;   // contested, with a stale holder: still nobody\'s
    for (let i = 0; i < 100; i++) { units[0] += 30; tick(); }
    zones[0].state = -1; zones[0].holder = -1;  // empty
    for (let i = 0; i < 100; i++) { units[0] += 30; tick(); }
    expect(stats().seats[0].points).toEqual({ total: 5, fromZones: 0, fromKills: 5, byZone: {} });
  });

  it('the tick a side completes its goal stops short of the rate: zones are credited first, kills get none, and the sum stays the runtime\'s', () => {
    const { units, zones, tick, stats } = script();
    tick();
    zones[0].state = 0; zones[0].holder = 0;
    units[0] += 10; tick();   // the goal completed on this tick and the runtime added 10 of the 30 the zone would pay
    const p = stats().seats[0].points!;
    expect(p.fromZones).toBe(0);   // 10 units = 0.008 points
    expect(p.fromKills).toBe(0);
    expect(p.byZone).toEqual({ ford: 0 });
  });

  it('the seats are read through the sides: a Sarim host plays side 1, and its stats are its own', () => {
    const { units, zones, tick, stats } = script();
    tick();
    zones[0].state = 1; zones[0].holder = 1;
    for (let i = 0; i < 40; i++) { units[1] += 30; tick(); }
    const s = stats([1, 0]);   // seat 0 plays side 1
    expect(s.seats[0].points).toMatchObject({ total: 1, fromZones: 1 });
    expect(s.seats[1].points).toMatchObject({ total: 0, fromZones: 0 });
  });

  it('the timeline carries the points banked so far, by seat, every 30 seconds', () => {
    const t = new RefereeTally();
    const units: [number, number] = [0, 0];
    t.setPoints({ runtime: { scoreUnitsOf: (s) => units[s], incomeZones: [] }, rules: RULES });
    const sim = { ...SIM, tickCount: 0 } as unknown as Sim;
    units[0] = 5 * POINTS_UNITS; units[1] = 2 * POINTS_UNITS + 5;
    for (const tickCount of [0, 20, 600]) { (sim as { tickCount: number }).tickCount = tickCount; t.onTick(sim, [0, 1]); }
    const s = t.stats(sim, { map: 'wadi_tarfan', sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    expect(s.timeline.map((p) => [p.tick, p.points])).toEqual([[0, [5, 2]], [600, [5, 2]]]);
  });

  it('an annihilation tally says so and carries no points', () => {
    const t = new RefereeTally();
    const s = t.stats(SIM, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    expect(s.mode).toBe('annihilation');
    expect(s).not.toHaveProperty('target');
    expect(s.seats.every((x) => x.points === undefined)).toBe(true);
  });

  it('checkReferee accepts a points record and refuses a malformed one', () => {
    const { tick, stats, units, zones } = script();
    tick();
    zones[0].state = 0; zones[0].holder = 0;
    units[0] += 30; tick();
    const good = JSON.parse(JSON.stringify(stats())) as ReturnType<typeof stats>;
    expect(checkReferee(good)).not.toBeNull();
    const bad = JSON.parse(JSON.stringify(good)) as { seats: { points: unknown }[] };
    bad.seats[0].points = { total: 'many' };
    expect(checkReferee(bad)).toBeNull();
    expect(checkReferee({ ...good, mode: 'flag' })).toBeNull();
  });

  it('the judge\'s glossary and the table say what points by source mean', () => {
    expect(statsGlossary()).toContain('`fromZones`');
    expect(statsGlossary()).toMatch(/against that goal.*not against the kill count/);
    const { tick, stats, units, zones } = script();
    tick();
    zones[0].state = 0; zones[0].holder = 0;
    for (let i = 0; i < 100; i++) { units[0] += 30; tick(); }
    const md = refereeMarkdown(stats(), ['A', 'B']).join('\n');
    expect(md).toContain('Points race, first to 600');
    expect(md).toMatch(/\| 0 \| A \| 2 \| 2\.5 \| 0 \| ford 2\.5 \|/);
  });
});

describe('RefereeTally on a real points race', () => {
  it('the two sources add up to the runtime\'s own score for both seats, over a played game (the unit is right, the split loses nothing)', () => {
    const map = 'wadi_tarfan';
    const w = buildMatchWorld(modeConfig(map, 'points', 4000));
    const tally = new RefereeTally();
    tally.setPoints({ runtime: w.runtime!, rules: versusModes[map].modes.points! });
    const names = versusModes[map].modes.points!.zones.map((z) => z.zone);
    for (let t = 0; t < 4800; t++) {
      if (t % 400 === 0) pointsOrder(w, names, -1);
      const ev = matchTick(w);
      tally.onEvents(w.sim, ev.sim);
      tally.onTick(w.sim, [0, 1]);
    }
    const s = tally.stats(w.sim, { map, sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    for (const seat of s.seats) {
      const p = seat.points!;
      const exact = w.runtime!.scoreUnitsOf(seat.side) / POINTS_UNITS;
      // fromZones + fromKills cover the same ticks as the race (it starts at tick 1, with nothing banked on tick 0)
      expect(p.fromZones + p.fromKills, `seat ${seat.seat}`).toBeGreaterThan(exact - 0.15);
      expect(p.fromZones + p.fromKills, `seat ${seat.seat}`).toBeLessThan(exact + 0.15);
      expect(p.total).toBe(Math.floor(exact));
      expect(p.fromKills).toBeGreaterThanOrEqual(0);
    }
    expect(s.seats[0].points!.fromZones + s.seats[1].points!.fromZones).toBeGreaterThan(0);   // two minutes of play: ground was held
    expect(Object.keys(s.seats[0].points!.byZone).every((z) => names.includes(z))).toBe(true);
  }, 120_000);
});
