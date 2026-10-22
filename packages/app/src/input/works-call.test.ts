import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, type Command, type MissionJson, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { callCancelWorks, callWorks } from './works-call';

// Field works through the order sink (GH-277 follow-up). A REAL runtime over a real sim: the
// click sends a `raiseWorks` / `cancelWorks` command and spends nothing; the command reaches
// the sim through `queueCommand`, as the transport delivers it, and `applyQueued` (run before
// `sim.tick()`, as main.ts's `runTick` does) prices it and queues the sim's own order.
// Fixture as works.test.ts: a 20x12 map, a 2x2 outpost at 350 logistics, an engineer at (7,5),
// a purse of 1000.

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

function world() {
  const sim = new Sim({ seed: 0x277, width: 20, height: 12, capacity: 32 });
  const eng = sim.addUnitType(unit('w_engineer', { abilities: ['construct'] }));
  const dummy = sim.addUnitType(unit('w_dummy', { role: 'infantry', hull: { hp: 40000, armor: { front: 10, side: 10, rear: 10 } } }));
  sim.addStructureType({
    id: 'w_outpost', name: 'Outpost', hp_per_tile: 200, owner: 0,
    buildable: { cost: { logistics: 350 }, build_time_s: 20, footprint: [2, 2] },
  });
  const mission: MissionJson = {
    id: 'works_call', map: { file: 'none' }, ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    starting_force: [{ unit: 'w_engineer', count: 1, at: [7, 5] }],
    enemy: { garrison: [{ unit: 'w_dummy', count: 1, at: [19, 0] }] },
    resources: { logistics_start: 1000, intel_start: 0 },
    field_works: { w_outpost: 1 },
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => (u === 'w_engineer' ? eng : dummy), markers: {}, zones: {},
  });
  rt.start();
  const sent: Command[] = [];
  const sink = { queueCommand: (cmd: Command) => void sent.push(cmd) };
  /** One frame of main.ts: deliver what the sink holds, then `applyQueued`, tick, step. */
  const frame = (): { accepted: number; events: SimEvent[] } => {
    for (const c of sent.splice(0)) sim.queueCommand(c);
    const accepted = rt.applyQueued();
    const events = sim.tick();
    rt.step(events);
    return { accepted, events };
  };
  return { sim, rt, sent, sink, frame };
}

describe('callWorks: a works click is a raiseWorks command, not a direct runtime call', () => {
  it('the click sends one command and spends nothing; the runtime prices it before the tick and the sim stakes it', () => {
    const w = world();
    expect(callWorks(w.rt, w.sink, 'w_outpost', 8, 5, [0])).toEqual({ ok: true });
    expect(w.sent).toEqual([{ kind: 'raiseWorks', side: 0, works: 'w_outpost', x: 8, y: 5, ids: [0] }]);
    // Nothing moved at click time: no charge, no count, no site.
    expect(w.rt.logisticsOf(0)).toBe(1000);
    expect(w.rt.worksOffers()[0].left).toBe(1);
    const first = w.frame();
    expect(first.accepted).toBe(1);
    expect(w.rt.logisticsOf(0)).toBe(650);
    expect(w.rt.worksOffers()[0].left).toBe(0);
    expect(first.events.some((e) => e.kind === 'constructQueued')).toBe(true);
    let staked = first.events.some((e) => e.kind === 'constructStaked');
    for (let i = 0; i < 5 && !staked; i++) staked = w.frame().events.some((e) => e.kind === 'constructStaked');
    expect(staked).toBe(true);
  });

  it('a refusal sends nothing and names the runtime reason', () => {
    const w = world();
    expect(callWorks(w.rt, w.sink, 'w_house', 8, 5, [])).toEqual({ ok: false, why: 'not_listed' });
    expect(callWorks(w.rt, w.sink, 'w_outpost', 19, 11, [])).toMatchObject({ ok: false });
    expect(w.sent).toEqual([]);
  });

  it('an empty selection sends ids [] and the runtime picks the idle carrier', () => {
    const w = world();
    expect(callWorks(w.rt, w.sink, 'w_outpost', 8, 5, [])).toEqual({ ok: true });
    expect(w.sent).toEqual([{ kind: 'raiseWorks', side: 0, works: 'w_outpost', x: 8, y: 5, ids: [] }]);
    expect(w.frame().accepted).toBe(1);
    expect(w.rt.logisticsOf(0)).toBe(650);
  });

  it('through the sink and by a direct request, the same works land on the same tick (same hash)', () => {
    const a = world();
    const b = world();
    callWorks(a.rt, a.sink, 'w_outpost', 8, 5, [0]);
    expect(b.rt.requestConstruct('w_outpost', 8, 5, [0])).toBe(true);
    for (let i = 0; i < 60; i++) {
      a.frame();
      b.frame();
    }
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.rt.economyHash()).toBe(b.rt.economyHash());
  });
});

describe('callCancelWorks: Cancel is a cancelWorks command', () => {
  it('sends one command and refunds nothing until the runtime runs it', () => {
    const w = world();
    callWorks(w.rt, w.sink, 'w_outpost', 15, 5, []); // far from the engineer: unstaked for a while
    w.frame();
    expect(w.rt.logisticsOf(0)).toBe(650);
    expect(callCancelWorks(w.rt, w.sink, 0)).toBe(true);
    expect(w.sent).toEqual([{ kind: 'cancelWorks', side: 0, site: 0 }]);
    expect(w.rt.logisticsOf(0)).toBe(650);
    w.frame();
    expect(w.rt.logisticsOf(0)).toBe(1000);
    expect(w.rt.worksOffers()[0].left).toBe(1);
  });

  it('a site that is not there sends nothing', () => {
    const w = world();
    expect(callCancelWorks(w.rt, w.sink, 0)).toBe(false);
    expect(callCancelWorks(w.rt, w.sink, -1)).toBe(false);
    expect(w.sent).toEqual([]);
  });
});
