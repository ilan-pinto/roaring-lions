// GH-1394 slice 1: an easier posture can never pay more, and Harder pays exactly Standard (design §5, rulings
// D3-D5). Bounds over `creditsFor`'s and `starsFor`'s own inputs, with the sim's own weights: nothing here
// re-derives a number the code under test computes.
import { describe, expect, it } from 'vitest';
import { applyOverlays, POSTURE_IDS, type PostureId } from '@lions/data';
import { missions } from '@lions/data/content';
import { creditsFor, MissionRuntime, starsFor, TICKS_PER_SECOND, type MissionJson } from '@lions/sim';
import { campaignMission, withReliefOnLoan } from '../../packages/app/src/posture';
import { missionStage } from './mission-harness';

const ids = Object.keys(missions) as (keyof typeof missions)[];
const raw = (id: string): MissionJson => (missions as unknown as Record<string, MissionJson>)[id];
const at = (id: string, p: PostureId): MissionJson => applyOverlays(raw(id), { posture: p });

/** The most `creditsFor` can pay for this mission JSON: a win, every carrying secondary done, nobody lost,
 *  Conduct 100. `fielded` is the authored starting force's bodies (the runtime's `startingCount` reads the
 *  spawned bodies of exactly these placements). */
function bestPay(m: MissionJson): number {
  const fielded = (m.starting_force ?? []).reduce((n, p) => n + p.count, 0);
  const carrying = m.objectives.filter((o) => !o.primary && o.carries === true).length;
  return creditsFor({ result: 'victory', carryingComplete: carrying, fielded, lost: 0, roe: 100, failBelow: m.roe?.fail_below });
}

/** The best grade this mission JSON allows: a win, every objective complete, Conduct 100. */
function bestStars(m: MissionJson): number {
  return starsFor('victory', 100, m.roe?.fail_below, m.objectives.map((o) => ({ primary: o.primary, carries: o.carries, status: 'complete' as const })));
}

/** `creditsFor`'s inputs a mission JSON fixes, each on its own: a bound over the SUM can hide one input rising under
 *  another falling (the mutation pass: a relief in the starting force was offset by uncarry on the ten carrying
 *  missions). */
function payInputs(m: MissionJson): { fielded: number; carrying: number; failBelow: number | undefined } {
  return {
    fielded: (m.starting_force ?? []).reduce((n, p) => n + p.count, 0),
    carrying: m.objectives.filter((o) => !o.primary && o.carries === true).length,
    failBelow: m.roe?.fail_below,
  };
}

describe('credits: Easier never above Standard, Harder exactly Standard (S3, S4)', () => {
  it.each(ids)('%s: each input on its own', (id) => {
    const std = payInputs(at(id, 'standard'));
    const e = payInputs(at(id, 'easier'));
    expect(e.fielded).toBeLessThanOrEqual(std.fielded);
    expect(e.carrying).toBeLessThanOrEqual(std.carrying);
    expect(e.failBelow).toBe(std.failBelow);
    expect(payInputs(at(id, 'harder'))).toEqual(std);
  });
  it.each(ids)('%s', (id) => {
    const std = bestPay(at(id, 'standard'));
    expect(bestPay(at(id, 'easier'))).toBeLessThanOrEqual(std);
    expect(bestPay(at(id, 'harder'))).toBe(std);
  });
  it('Easier pays strictly less on exactly the missions with a carrying secondary (14 of 39: Qasr Liwan I and III, Bir Tarsha I and V)', () => {
    const less = ids.filter((id) => bestPay(at(id, 'easier')) < bestPay(at(id, 'standard')));
    expect(less.length).toBe(14); // Was 12 (10 before Qasr Liwan I and III): Bir Tarsha I and V carry a secondary
    for (const id of less) expect(bestPay(at(id, 'standard')) - bestPay(at(id, 'easier'))).toBe(
      40 * raw(id).objectives.filter((o) => !o.primary && o.carries === true).length
    );
  });
});

describe('stars: Easier at most two (D3, S5); Harder and Standard the same', () => {
  it.each(ids)('%s', (id) => {
    expect(bestStars(at(id, 'easier'))).toBeLessThanOrEqual(2);
    expect(bestStars(at(id, 'harder'))).toBe(bestStars(at(id, 'standard')));
  });
  it('Standard still reaches three on the fourteen carrying missions, so the cap is a real cap', () => {
    expect(ids.filter((id) => bestStars(at(id, 'standard')) === 3).length).toBe(14); // Was 12 (10 before Qasr Liwan I and III): Bir Tarsha I and V reach three
  });
});

describe('the Easier relief, in a real runtime (S7)', () => {
  // Every campaign mission under Easier builds, its relief spawns at 1:30 at player_start without a spawn-clear
  // throw, every relief body is on loan (so none joins the roster), and the starting count -- what credits read --
  // is Standard's. 95 s of ticks per mission; no orders.
  const campaign = ids.filter((id) => raw(id).ledger.produces.length > 0);
  it('covers the 38 campaign missions', () => expect(campaign.length).toBe(38)); // Was 34 (29 before Qasr Liwan's five): Bir Tarsha I, II, III and V
  it.each(campaign)('%s', (id) => {
    const ledger = { 'campaign.difficulty': 'easier' };
    const easier = campaignMission(raw(id), ledger);
    expect(easier).not.toBe(raw(id));
    const build = (m: MissionJson, loaned: ReadonlySet<string>) => {
      const stage = missionStage(id);
      const rt = new MissionRuntime(stage.sim, m, { ...stage.context(ledger), loanedReinforce: loaned });
      rt.start();
      return { rt, sim: stage.sim };
    };
    const std = build(raw(id), new Set());
    const { rt, sim } = build(easier, withReliefOnLoan(easier, new Set()));
    expect(rt.startingCount).toBe(std.rt.startingCount);
    const reliefTick = 90 * TICKS_PER_SECOND;
    const types = new Set(['inf_squad', 'inf_medic_squad']);
    const relief: number[] = [];
    for (let t = 0; t < 95 * TICKS_PER_SECOND && rt.result === 'ongoing'; t++) {
      const before = sim.entityCount;
      rt.step(sim.tick());
      if (sim.tickCount === reliefTick) {
        for (let e = before; e < sim.entityCount; e++) {
          if (sim.state.side[e] === 0 && types.has(sim.unitTypes[sim.state.typeIdx[e]].id)) relief.push(e);
        }
      }
    }
    // No campaign mission ends inside 95 s with no orders, so every one of the 29 reaches the relief.
    expect(relief.map((e) => sim.unitTypes[sim.state.typeIdx[e]].id).sort()).toEqual(['inf_medic_squad', 'inf_squad']);
    for (const e of relief) expect(rt.isOnLoan(e)).toBe(true);
    expect(rt.startingCount).toBe(std.rt.startingCount);
  });
});

describe('every posture builds every mission', () => {
  for (const p of POSTURE_IDS) {
    it(`${p}: a runtime starts on all 30`, () => {
      for (const id of ids) {
        const stage = missionStage(id);
        expect(() => new MissionRuntime(stage.sim, at(id, p), stage.context({})).start(), `${id} at ${p}`).not.toThrow();
      }
    });
  }
});
