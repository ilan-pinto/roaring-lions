// GH-859 P1b, spec 8.5: non-vacuity of the playtest variants. REPORT-ONLY, so what must not pass quietly is a
// variant that carried no formation (it would read the unmodified plan under another name), a plan pulled out of
// `playtest.ts` that is not the plan it names, and an order rule that tags the wrong orders.
import { describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import { MAIN_BODY_MIN, MISSIONS, VARIANTS, carries, chainSource, ledgerFor, loadPlans, play, read, type Played } from './formation-playtest';

const x = fx.from(10);
const y = fx.from(11);

describe('which orders carry a formation', () => {
  const move = (ids: number[], extra: Partial<Extract<Command, { kind: 'move' }>> = {}): Command => ({ kind: 'move', ids, x, y, ...extra });
  const atk = (ids: number[], extra: Partial<Extract<Command, { kind: 'attackMove' }>> = {}): Command => ({ kind: 'attackMove', ids, x, y, ...extra });

  it('is the verb and the size, and never an exact, appended or already-formed order: the table of eleven', () => {
    const table: [string, Command, 'attack' | 'column' | 'ambush', boolean][] = [
      ['3 on a move carry the column', move([1, 2, 3]), 'column', true],
      ['3 on a move carry the ambush', move([1, 2, 3]), 'ambush', true],
      ['a move is not an attack', move([1, 2, 3]), 'attack', false],
      ['3 on an attack-move carry the attack', atk([1, 2, 3]), 'attack', true],
      ['an attack-move is not a column', atk([1, 2, 3]), 'column', false],
      ['2 are a detachment', move([1, 2]), 'column', false],
      ['the same id three times is one unit', move([1, 1, 1]), 'column', false],
      ['an exact order is placed by the sim, not the plan', move([1, 2, 3, 4], { exact: true }), 'column', false],
      ['an appended order keeps the route the plan drew', move([1, 2, 3, 4], { append: true }), 'column', false],
      ['an order that already names a formation keeps it', move([1, 2, 3], { formation: 'ambush' }), 'column', false],
      ['a stance is no march', { kind: 'setStance', ids: [1, 2, 3], stance: 'hold' } as Command, 'column', false],
    ];
    expect(table).toHaveLength(11);
    expect(MAIN_BODY_MIN).toBe(3);
    for (const [name, c, v, want] of table) expect(carries(c, v), name).toBe(want);
  });
});

describe('the plans read out of playtest.ts', () => {
  it('are the three missions\' scripted plans, as functions', () => {
    const plans = loadPlans();
    expect(MISSIONS).toHaveLength(3);
    for (const m of MISSIONS) expect(typeof plans[m], m).toBe('function');
  });

  it('are each the plan of the mission they are filed under (a literal from each one\'s own script)', () => {
    const plans = loadPlans();
    expect(plans.beit_sahwan_4_subterranean.toString()).toContain("ids('yahalom_squad')");
    expect(plans.tel_marum_2_foothold.toString()).toContain('M(21, 28)');
    expect(plans.qarn_hadid_3_clearance.toString()).toContain('M(28, 11)');
    expect(plans.tel_marum_2_foothold.toString()).not.toContain("ids('yahalom_squad')");
    expect(plans.qarn_hadid_3_clearance.toString()).not.toContain('M(21, 28)');
  });

  it('refuse a source that does not hold them, naming the plan', () => {
    expect(() => loadPlans('const nothing = 1;')).toThrow(/could not find .*plan/);
    expect(() => chainSource(['led9'], 'const led1 = 1;')).toThrow(/could not find `const led9`/);
  });

  it('the unmodified Tel Marum II plan wins on seed 424242 (the shipped playtest\'s own run), with a ledger of {}', () => {
    expect(ledgerFor('tel_marum_2_foothold', 424242)).toEqual({});
    const r = play('tel_marum_2_foothold', 'none', 424242);
    expect(r.result).toBe('victory');
    expect(r.carried).toBe(0);
    expect(r.everGrouped).toBe(0);
  });

  it('Beit Sahwan IV gets the ledger its three earlier missions make on that seed', () => {
    const led = ledgerFor('beit_sahwan_4_subterranean', 424242);
    expect(Object.keys(led).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('a variant carries its formation and plays a different game', () => {
  const plain = play('tel_marum_2_foothold', 'none', 424242);
  it('the Attack variant tags orders, forms units, and sees formation events', () => {
    const a = play('tel_marum_2_foothold', 'attack', 424242);
    expect(a.carried).toBeGreaterThanOrEqual(1);
    expect(a.ordered).toBeGreaterThanOrEqual(3);
    expect(a.everGrouped).toBeGreaterThanOrEqual(1);
    expect(Object.values(a.events).reduce((n, k) => n + k, 0)).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(plain));
  });
  it('the Column variant tags the moves and forms units too', () => {
    const c = play('tel_marum_2_foothold', 'column', 424242);
    expect(c.carried).toBeGreaterThanOrEqual(1);
    expect(c.everGrouped).toBeGreaterThanOrEqual(1);
  });
  it('there are four variants, the unmodified one first', () => {
    expect(VARIANTS).toEqual(['none', 'attack', 'column', 'ambush']);
  });
});

describe('read over a hand-built table (literals)', () => {
  const g: Played = {
    mission: 'tel_marum_2_foothold', variant: 'attack', seed: 1, result: 'victory', stuck: false, minutes: 4, roe: 98, stars: 2, carried: 2, ordered: 5, everGrouped: 4, events: { formationContact: 3 },
  };
  it('counts wins, the minutes, the ROE, the under-two-star wins and the formed runs', () => {
    const r = read([
      g,
      { ...g, minutes: 6, roe: 90, stars: 1, events: { formationContact: 1, formationCall: 2 } },
      { ...g, result: 'defeat', minutes: 9, roe: 10, stars: 0, everGrouped: 0, carried: 0, ordered: 0, events: {} },
      { ...g, result: 'ongoing', stuck: true, minutes: 20, roe: 50, stars: 0 },
    ]);
    expect(r.runs).toBe(4);
    expect(r.victories).toBe(2);
    expect(r.defeats).toBe(1);
    expect(r.stuck).toBe(1);
    expect(r.medianMinutes).toBe(5); // wins at 4 and 6
    expect(r.slowestMinutes).toBe(6);
    expect(r.medianRoe).toBe(94);
    expect(r.lowestRoe).toBe(90);
    expect(r.underTwoStars).toBe(1);
    expect(r.carried).toBe(6);
    expect(r.ordered).toBe(15);
    expect(r.everGrouped).toBe(12);
    expect(r.runsFormed).toBe(3);
    expect(r.events).toEqual({ formationContact: 7, formationCall: 2 });
    expect(r.causes).toEqual({}); // no cause on any of the four
  });
  it('counts the causes of the lost runs', () => {
    const r = read([{ ...g, result: 'defeat', cause: 'the village fell' }, { ...g, result: 'defeat', cause: 'the village fell' }, { ...g, result: 'defeat', cause: 'out of time' }, g]);
    expect(r.causes).toEqual({ 'the village fell': 2, 'out of time': 1 });
  });
  it('a table with no win reads null minutes', () => {
    const r = read([{ ...g, result: 'defeat' }]);
    expect(r.medianMinutes).toBeNull();
    expect(r.lowestRoe).toBeNull();
  });
});
