import { describe, expect, it } from 'vitest';
import { MissionRuntime, type MissionContext, type MissionEvent, type MissionJson } from './mission';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

// Field works (#277) Task 5: the runtime -- allow list, price, count, refunds, events.
// Every expected number is an integer literal worked by hand, never read back from the code
// under test. The fixture: a 20x12 map, a 2x2 outpost at 350 logistics / 20 s, an engineer
// at (7,5) beside the pad (8,5), a start purse of 1000 logistics.
//
// Refund = (cost x (65536 - progress)) >> 16, in whole logistics, truncated:
//   progress 58982 (90%): 350 x 6554  = 2,293,900  /65536 = 35.004  -> 35   (N10)
//   progress 19660 (30%): 350 x 45876 = 16,056,600 /65536 = 245.005 -> 245
//   progress 163 (1 tick of one builder): 350 x 65373 = 22,880,550 /65536 = 349.13 -> 349
//   progress 0 (unstaked): 350
//   progress 65000: 350 x 536 = 187,600 /65536 = 2.86 -> 2   (round or ceil would say 3)
//   the intel post: 40 intel at progress 32768: 40 x 32768 >> 16 = 20; 100 logistics -> 50

function unit(id: string, extra: Partial<UnitTypeJson> = {}): UnitTypeJson {
  return {
    id, role: 'engineer',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 6, signature: 0.6 },
    weapons: [],
    ...extra,
  };
}
const ENGINEER = unit('w_engineer', { abilities: ['construct'] });
const RIFLEMAN = unit('w_rifle', { role: 'infantry' });
const DUMMY = unit('w_dummy', { role: 'infantry', hull: { hp: 40000, armor: { front: 10, side: 10, rear: 10 } } });

const OUTPOST = {
  id: 'w_outpost', name: 'Outpost', hp_per_tile: 200, owner: 0,
  buildable: { cost: { logistics: 350 }, build_time_s: 20, footprint: [2, 2] },
};
const GATED = {
  id: 'w_gated', name: 'Gated', hp_per_tile: 200, owner: 0,
  buildable: { cost: { logistics: 100 }, build_time_s: 20, footprint: [2, 2], unlock: { roe_rating_min: 90 } },
};
const POST = {
  id: 'w_post', name: 'Post', hp_per_tile: 200, owner: 0,
  buildable: { cost: { logistics: 100, intel: 40 }, build_time_s: 20, footprint: [2, 2] },
};
const HOUSE = { id: 'w_house', name: 'House', hp_per_tile: 200 };

interface World {
  sim: Sim;
  runtime: MissionRuntime;
  step: (n: number) => { sim: SimEvent[]; mission: MissionEvent[] };
}

function build(mission: Partial<MissionJson>, force: string[] = ['w_engineer'], ctx: Partial<MissionContext> = {}): World {
  const sim = new Sim({ seed: 0x277, width: 20, height: 12, capacity: 32 });
  const ids = new Map<string, number>();
  for (const t of [ENGINEER, RIFLEMAN, DUMMY]) ids.set(t.id, sim.addUnitType(t));
  for (const s of [OUTPOST, GATED, POST, HOUSE]) sim.addStructureType(s);
  const m: MissionJson = {
    id: 'works_mission',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    starting_force: force.map((u, i) => ({ unit: u, count: 1, at: [7, 5 + i] as [number, number] })),
    enemy: { garrison: [{ unit: 'w_dummy', count: 1, at: [19, 0] }] },
    resources: { logistics_start: 1000, intel_start: 100 },
    ...mission,
  };
  const runtime = new MissionRuntime(sim, m, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: {},
    ...ctx,
  });
  runtime.start();
  return {
    sim,
    runtime,
    step: (n) => {
      const out: { sim: SimEvent[]; mission: MissionEvent[] } = { sim: [], mission: [] };
      for (let i = 0; i < n; i++) {
        const se = sim.tick();
        out.sim.push(...se);
        out.mission.push(...runtime.step(se));
      }
      return out;
    },
  };
}

type Works = Extract<MissionEvent, { kind: 'works' }>;
const worksOf = (evs: MissionEvent[]): Works[] => evs.filter((e): e is Works => e.kind === 'works');

/** Raise an outpost at (8,5) with the engineer (id 0, standing beside it) and tick until it is
 *  staked; returns the site row and structure index. */
function staked(w: World): { site: number; structure: number } {
  expect(w.runtime.requestConstruct('w_outpost', 8, 5)).toBe(true);
  const ev = w.step(3);
  const e = ev.sim.find((x) => x.kind === 'constructStaked');
  if (e === undefined || e.kind !== 'constructStaked') throw new Error('never staked');
  // Let the builder settle on its tile, so the next tick of work is certain.
  for (let i = 0; i < 80 && !w.sim.isConstructing(0); i++) w.step(1);
  return { site: e.site, structure: e.structure };
}

describe('the allow list', () => {
  it('field_works absent: no offers, every request is not_listed and charges nothing', () => {
    const w = build({});
    expect(w.runtime.worksOffers()).toEqual([]);
    expect(w.runtime.constructReason('w_outpost')).toBe('not_listed');
    expect(w.runtime.constructReason('w_outpost', 8, 5)).toBe('not_listed');
    expect(w.runtime.requestConstruct('w_outpost', 8, 5)).toBe(false);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
    expect(worksOf(w.step(5).mission)).toEqual([]);
  });

  it('a listed type is an offer with its price and count; an unlisted or non-buildable id is dropped', () => {
    const w = build({ field_works: { w_outpost: 1, w_house: 2, w_nothing: 1 } });
    expect(w.runtime.worksOffers()).toEqual([
      { typeId: 'w_outpost', name: 'Outpost', max: 1, left: 1, logistics: 350, intel: 0 },
    ]);
    expect(w.runtime.constructReason('w_house')).toBe('not_listed');
    expect(w.runtime.constructReason('w_gated')).toBe('not_listed');
  });

  it('with 1 allowed the second request is none_left, and a cancel restores it', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    expect(w.runtime.requestConstruct('w_outpost', 8, 5)).toBe(true);
    expect(w.runtime.logisticsOf(0)).toBe(650); // 1000 - 350, taken on the request
    expect(w.runtime.worksOffers()[0].left).toBe(0);
    expect(w.runtime.constructReason('w_outpost', 12, 5)).toBe('none_left');
    expect(w.runtime.requestConstruct('w_outpost', 12, 5)).toBe(false);
    expect(w.runtime.logisticsOf(0)).toBe(650);
    const started = worksOf(w.step(1).mission);
    expect(started).toEqual([
      { kind: 'works', tick: 1, phase: 'started', typeId: 'w_outpost', site: 0, builder: 0, refund: 0 },
    ]);
    expect(w.runtime.requestCancelWorks(0)).toBe(true);
    const cancelled = worksOf(w.step(1).mission);
    expect(cancelled.map((e) => [e.phase, e.refund])).toEqual([['cancelled', 350]]);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
    expect(w.runtime.worksOffers()[0].left).toBe(1);
    // The engineer is still walking to the cancelled pad, so it is not idle yet.
    expect(w.runtime.constructReason('w_outpost', 12, 5)).toBe('needs_engineers');
    w.step(60);
    expect(w.runtime.constructReason('w_outpost', 12, 5)).toBeNull();
  });

  it('locked: the unlock gate goes through unlockReason, and opens with the ledger', () => {
    const closed = build({ field_works: { w_gated: 1 } });
    expect(closed.runtime.constructReason('w_gated')).toBe('locked');
    expect(closed.runtime.requestConstruct('w_gated', 8, 5)).toBe(false);
    expect(closed.runtime.logisticsOf(0)).toBe(1000);
    const open = build({ field_works: { w_gated: 1 } }, ['w_engineer'], { ledger: { 'roe.cumulative_rating': 95 } });
    expect(open.runtime.constructReason('w_gated')).toBeNull();
    expect(open.runtime.requestConstruct('w_gated', 8, 5)).toBe(true);
  });

  it('unaffordable: logistics, and intel', () => {
    const poor = build({ field_works: { w_outpost: 1 }, resources: { logistics_start: 349 } });
    expect(poor.runtime.constructReason('w_outpost')).toBe('unaffordable');
    expect(poor.runtime.requestConstruct('w_outpost', 8, 5)).toBe(false);
    expect(poor.runtime.logisticsOf(0)).toBe(349);
    const exact = build({ field_works: { w_outpost: 1 }, resources: { logistics_start: 350 } });
    expect(exact.runtime.requestConstruct('w_outpost', 8, 5)).toBe(true);
    expect(exact.runtime.logisticsOf(0)).toBe(0);
    const blind = build({ field_works: { w_post: 1 }, resources: { logistics_start: 1000, intel_start: 39 } });
    expect(blind.runtime.constructReason('w_post')).toBe('unaffordable');
    expect(blind.runtime.requestConstruct('w_post', 8, 5)).toBe(false);
    expect(blind.runtime.intel).toBe(39);
  });

  it('needs_engineers: nobody who can build; passing a rifleman does not help', () => {
    const w = build({ field_works: { w_outpost: 1 } }, ['w_rifle']);
    expect(w.runtime.constructReason('w_outpost')).toBe('needs_engineers');
    expect(w.runtime.constructReason('w_outpost', 8, 5)).toBe('needs_engineers');
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [0])).toBe(false);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
    expect(w.runtime.worksOffers()[0].left).toBe(1);
  });

  it('a placement refusal is the sim rule, named; nothing is charged', () => {
    const w = build({ field_works: { w_outpost: 2 } });
    expect(w.runtime.constructReason('w_outpost', 19, 5)).toBe('off_map');
    expect(w.runtime.requestConstruct('w_outpost', 19, 5)).toBe(false);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
  });

  it('passed ids that cannot build fall back to the nearest idle carrier, ties by id', () => {
    const w = build({ field_works: { w_outpost: 1 } }, ['w_rifle', 'w_engineer', 'w_engineer']);
    // ids: 0 rifle at (7,5), 1 engineer at (7,6), 2 engineer at (7,7); the pad is (8..9, 5..6).
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [0])).toBe(true);
    const q = w.step(1).sim.find((e) => e.kind === 'constructQueued');
    expect(q === undefined || q.kind !== 'constructQueued' ? -2 : q.builder).toBe(1);
  });
});

describe('who builds, when no builder is named', () => {
  it('equally near carriers: the lowest id', () => {
    // 0 engineer (7,5), 1 rifleman (7,6), 2 engineer (7,7); the pad (8..9, 5..6) has its centre
    // at (9,6): distance squared 4+1 = 5 from each engineer.
    const w = build({ field_works: { w_outpost: 1 } }, ['w_engineer', 'w_rifle', 'w_engineer']);
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [1])).toBe(true);
    const q = w.step(1).sim.find((e) => e.kind === 'constructQueued');
    expect(q !== undefined && q.kind === 'constructQueued' ? q.builder : -2).toBe(0);
  });

  it('the nearer carrier wins over the lower id', () => {
    // The pad (8..9, 7..8) has its centre at (9,8): 4+9 = 13 from id 0 at (7,5), 4+1 = 5 from id 2 at (7,7).
    const w = build({ field_works: { w_outpost: 1 } }, ['w_engineer', 'w_rifle', 'w_engineer']);
    expect(w.runtime.requestConstruct('w_outpost', 8, 7, [1])).toBe(true);
    const q = w.step(1).sim.find((e) => e.kind === 'constructQueued');
    expect(q !== undefined && q.kind === 'constructQueued' ? q.builder : -2).toBe(2);
  });
});

describe('a join is not charged twice', () => {
  it('naming a live site joins it: no price, no count, and it is not none_left', () => {
    const w = build({ field_works: { w_outpost: 1 } }, ['w_engineer', 'w_engineer']);
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [0])).toBe(true);
    w.step(1);
    expect(w.runtime.logisticsOf(0)).toBe(650);
    expect(w.runtime.worksOffers()[0].left).toBe(0);
    expect(w.runtime.constructReason('w_outpost', 8, 5)).toBeNull(); // a join, not none_left
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [1])).toBe(true);
    expect(w.runtime.logisticsOf(0)).toBe(650); // recognised as a join BEFORE any charge
    expect(w.runtime.worksOffers()[0].left).toBe(0);
    const out = w.step(1);
    expect(w.runtime.logisticsOf(0)).toBe(650);
    expect(w.runtime.worksOffers()[0].left).toBe(0);
    expect(out.sim.some((e) => e.kind === 'constructQueued' && e.joined)).toBe(true);
    expect(worksOf(out.mission)).toEqual([]); // no second "started"
    // ...and one cancel still returns the single payment.
    expect(w.runtime.requestCancelWorks(0)).toBe(true);
    w.step(1);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
  });

  it('two requests for one new site in the same tick: the second joined and is paid back', () => {
    const w = build({ field_works: { w_outpost: 2 } }, ['w_engineer', 'w_engineer']);
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [0])).toBe(true);
    expect(w.runtime.requestConstruct('w_outpost', 8, 5, [1])).toBe(true);
    expect(w.runtime.logisticsOf(0)).toBe(300); // both charged until the sim answers
    const out = w.step(1);
    expect(w.runtime.logisticsOf(0)).toBe(650);
    expect(w.runtime.worksOffers()[0].left).toBe(1);
    expect(worksOf(out.mission).map((e) => e.phase)).toEqual(['started']);
  });
});

describe('a refusal refunds the price and the count', () => {
  it('the sim refuses an overlap the runtime could not see yet', () => {
    const w = build({ field_works: { w_outpost: 2 } });
    expect(w.runtime.requestConstruct('w_outpost', 8, 5)).toBe(true);
    expect(w.runtime.requestConstruct('w_outpost', 9, 5)).toBe(true); // no site yet: passes
    expect(w.runtime.logisticsOf(0)).toBe(300);
    const out = w.step(1);
    expect(out.sim.some((e) => e.kind === 'constructRefused' && e.reason === 'overlap')).toBe(true);
    expect(w.runtime.logisticsOf(0)).toBe(650); // 1000 - 350 x 2 + 350
    expect(w.runtime.worksOffers()[0].left).toBe(1);
    expect(worksOf(out.mission).map((e) => [e.phase, e.site, e.refund])).toEqual([
      ['started', 0, 0],
      ['refused', -1, 350],
    ]);
  });

  it('a refusal on a command with no pending charge refunds nothing', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    // Straight to the sim, bypassing the runtime: there is no payment to give back.
    w.sim.queueCommand({ kind: 'construct', ids: [0], structType: 0, x: 19, y: 5 });
    const out = w.step(1);
    expect(worksOf(out.mission).map((e) => [e.phase, e.refund])).toEqual([['refused', 0]]);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
    expect(w.runtime.worksOffers()[0].left).toBe(1);
  });
});

describe('cancel refunds what is left unbuilt', () => {
  const refundAt = (progress: number): { refund: number; logistics: number; left: number } => {
    const w = build({ field_works: { w_outpost: 1 } });
    const s = staked(w);
    w.sim.structures.progress[s.structure] = progress;
    expect(w.runtime.requestCancelWorks(s.site)).toBe(true);
    const out = w.step(1);
    const e = worksOf(out.mission).find((x) => x.phase === 'cancelled');
    return { refund: e === undefined ? -1 : e.refund, logistics: w.runtime.logisticsOf(0), left: w.runtime.worksOffers()[0].left };
  };

  it('a 90%-built outpost refunds exactly 35 (N10)', () => {
    expect(refundAt(58982)).toEqual({ refund: 35, logistics: 685, left: 1 }); // 650 + 35
  });
  it('30% built refunds 245', () => {
    expect(refundAt(19660)).toEqual({ refund: 245, logistics: 895, left: 1 });
  });
  it('one tick of work refunds 349', () => {
    expect(refundAt(163)).toEqual({ refund: 349, logistics: 999, left: 1 });
  });
  it('truncates: 2.86 is 2', () => {
    expect(refundAt(65000)).toEqual({ refund: 2, logistics: 652, left: 1 });
  });

  it('an unstaked site refunds the full 350', () => {
    const w = build({ field_works: { w_outpost: 1 } }, ['w_engineer']);
    expect(w.runtime.requestConstruct('w_outpost', 15, 5)).toBe(true); // far from the engineer
    w.step(1);
    expect(w.runtime.requestCancelWorks(0)).toBe(true);
    const e = worksOf(w.step(1).mission);
    expect(e.map((x) => [x.phase, x.refund])).toEqual([['cancelled', 350]]);
    expect(w.runtime.logisticsOf(0)).toBe(1000);
  });

  it('intel comes back by the same rule: 40 intel and 100 logistics at 50%', () => {
    const w = build({ field_works: { w_post: 1 } });
    expect(w.runtime.requestConstruct('w_post', 8, 5)).toBe(true);
    expect(w.runtime.logisticsOf(0)).toBe(900);
    expect(w.runtime.intel).toBe(60);
    const st = w.step(3).sim.find((e) => e.kind === 'constructStaked');
    if (st === undefined || st.kind !== 'constructStaked') throw new Error('never staked');
    w.sim.structures.progress[st.structure] = 32768;
    expect(w.runtime.requestCancelWorks(st.site)).toBe(true);
    w.step(1);
    expect(w.runtime.logisticsOf(0)).toBe(950);
    expect(w.runtime.intel).toBe(80);
  });

  it('a site that is not there, or not ours, cannot be cancelled', () => {
    const w = build({ field_works: { w_outpost: 1 }, enemy: { garrison: [{ unit: 'w_dummy', count: 1, at: [19, 0] }, { unit: 'w_engineer', count: 1, at: [17, 8] }] } });
    expect(w.runtime.requestCancelWorks(0)).toBe(false);
    // Side 1's engineer (id 2) opens a site of its own, straight on the sim: not the player's to take down.
    w.sim.queueCommand({ kind: 'construct', ids: [2], structType: 0, x: 15, y: 8 });
    w.step(1);
    expect(w.sim.works.alive[0]).toBe(1);
    expect(w.sim.works.side[0]).toBe(1);
    expect(w.runtime.requestCancelWorks(0)).toBe(false);
    expect(w.runtime.requestCancelWorks(-1)).toBe(false);
    expect(w.runtime.requestCancelWorks(99)).toBe(false);
  });
});

describe('complete and destroyed', () => {
  it('the last tick of work is a complete event, and the count stays spent', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    const s = staked(w);
    w.sim.structures.progress[s.structure] = 65535;
    const done = worksOf(w.step(1).mission);
    expect(done.map((e) => [e.phase, e.typeId, e.site])).toEqual([['complete', 'w_outpost', s.site]]);
    expect(w.runtime.worksOffers()[0].left).toBe(0);
    expect(w.runtime.logisticsOf(0)).toBe(650);
  });

  it('a works structure the sim levels is a destroyed event, with no refund', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    const s = staked(w);
    w.sim.structures.progress[s.structure] = 65535;
    w.step(1);
    w.sim.debugDestroyStructure(s.structure);
    const out = worksOf(w.step(1).mission);
    expect(out.map((e) => [e.phase, e.typeId, e.refund])).toEqual([['destroyed', 'w_outpost', 0]]);
    expect(w.runtime.logisticsOf(0)).toBe(650);
  });

  it('a wreck mid-build is destroyed too', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    const s = staked(w);
    w.sim.debugDestroyStructure(s.structure);
    expect(worksOf(w.step(1).mission).map((e) => e.phase)).toEqual(['destroyed']);
  });

  it('a structure that is not a work is silent when it falls', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    w.step(1);
    expect(worksOf(w.step(1).mission)).toEqual([]);
  });
});

describe('ROE and intel', () => {
  it('levelling your own works charges 0 ROE, even when the player does it', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    const s = staked(w);
    w.sim.structures.progress[s.structure] = 65535;
    w.step(1);
    expect(w.sim.structures.owner[s.structure]).toBe(0);
    // The player's own engineer (id 0) is the destroyer, as for a demolition.
    const fell: SimEvent = { kind: 'structureDestroyed', tick: 99, structure: s.structure, by: 0 };
    const out = w.runtime.step([fell]);
    expect(out.filter((e) => e.kind === 'roe')).toEqual([]);
    expect(w.runtime.roeScore).toBe(100);
    expect(worksOf(out).map((e) => e.phase)).toEqual(['destroyed']);
  });

  it('a house, by contrast, costs the player when he levels it (the control)', () => {
    // The same path with a type that has a penalty must charge, or the test above proves nothing.
    const sim = new Sim({ seed: 1, width: 20, height: 12, capacity: 8 });
    sim.addUnitType(ENGINEER);
    const penal = sim.addStructureType({ id: 'w_penal', name: 'Penal', hp_per_tile: 200, roe_penalty: 4 });
    const m: MissionJson = {
      id: 'm', map: { file: 'none' }, ledger: { requires: [], produces: [] },
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      starting_force: [{ unit: 'w_engineer', count: 1, at: [2, 2] }],
      enemy: { garrison: [{ unit: 'w_engineer', count: 1, at: [19, 0] }] },
    };
    const rt = new MissionRuntime(sim, m, { typeIdOf: () => 0, markers: {}, zones: {} });
    rt.start();
    const s = sim.addStructure(penal, [5 * 20 + 5]);
    const out = rt.step([{ kind: 'structureDestroyed', tick: 1, structure: s, by: 0 }]);
    expect(out.filter((e) => e.kind === 'roe').length).toBe(1);
    expect(rt.roeScore).toBe(96);
  });

  it('a contact with observer -1 credits nobody (Q10)', () => {
    const w = build({ field_works: { w_outpost: 1 } });
    const enemy = 1; // the dummy
    expect(w.sim.state.side[enemy]).toBe(1);
    const before = w.runtime.intel;
    const out = w.runtime.step([
      { kind: 'contact', tick: 1, side: 0, target: enemy, level: 'identified', confidence: 65536, observer: -1 },
    ]);
    expect(out.filter((e) => e.kind === 'intelEarned')).toEqual([]);
    expect(w.runtime.intel).toBe(before);
    expect(w.runtime.intel).toBe(100);
  });
});
