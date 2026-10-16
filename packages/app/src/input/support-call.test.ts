import { describe, expect, it } from 'vitest';
import { FIRE_SUPPORT_KINDS, Sim, fx, type Command } from '@lions/sim';
import { aimFootprint, callSupport, supportAim, type SupportRuntime } from './support-call';
import type { PointerView } from './pointer';
import { footprintTiles, ROUNDS } from '../ui/support-kinds';

const W = 32;

/** A 2x2 house at x 10-11, y 10-11 (centre 11,11). */
function world(): { sim: Sim; house: number } {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
  const type = sim.addStructureType({ id: 'house', hp_per_tile: 5000, height_px: 11, color: 'dust.1' });
  const tiles = [10, 11].flatMap((y) => [10, 11].map((x) => y * W + x));
  return { sim, house: sim.addStructure(type, tiles) };
}

/** The ground behind the wall: (14.2, 9.1), off the footprint. */
function viewOver(structure: number): PointerView {
  return {
    screenToWorld: () => ({ x: 14.2, y: 9.1 }),
    structureAtScreen: () => structure,
    unitAtScreen: () => -1,
    isVisible: () => true,
    viewer: 0,
  };
}

/** The runtime slice and the order sink a call reads (N2, D3: "check, then
 *  send"). `canSupport` is the click-time pre-check; an accepted call goes to
 *  the sink as a `support` command and the runtime spends when it runs it.
 *  The slice has no `requestSupport` any more: the click never spends. */
function runtime(accept: boolean, intel = 500, cost = 60) {
  const sent: Command[] = [];
  const rt: SupportRuntime = {
    intel,
    supportCost: () => cost,
    canSupport: () => accept,
  };
  const sink = { queueCommand: (cmd: Command) => void sent.push(cmd) };
  return { rt, sink, sent };
}

describe.each(FIRE_SUPPORT_KINDS)('callSupport(%s)', (kind) => {
  it('a wall click aims at the building, and queues exactly one support command there', () => {
    const { sim, house } = world();
    const { rt, sink, sent } = runtime(true);
    const out = callSupport(rt, sink, kind, viewOver(house), sim, 5, 5);
    expect(sent).toEqual([{ kind: 'support', side: 0, support: kind, x: fx.from(11), y: fx.from(11) }]);
    expect(out).toEqual({ ok: true, kind, x: 11, y: 11 });
  });

  it('a ground click aims at the ground', () => {
    const { sim } = world();
    const { rt, sink, sent } = runtime(true);
    const out = callSupport(rt, sink, kind, viewOver(-1), sim, 5, 5);
    expect(sent).toEqual([{ kind: 'support', side: 0, support: kind, x: fx.from(14.2), y: fx.from(9.1) }]);
    expect(out.ok).toBe(true);
  });

  it('a refusal with too little intel says intel, and queues nothing', () => {
    const { sim } = world();
    const { rt, sink, sent } = runtime(false, 10, 60);
    expect(callSupport(rt, sink, kind, viewOver(-1), sim, 5, 5)).toMatchObject({ ok: false, why: 'intel' });
    expect(sent).toEqual([]);
  });

  it('a refusal with intel in hand says caller, and queues nothing', () => {
    const { sim } = world();
    const { rt, sink, sent } = runtime(false, 500, 60);
    expect(callSupport(rt, sink, kind, viewOver(-1), sim, 5, 5)).toMatchObject({ ok: false, why: 'caller' });
    expect(sent).toEqual([]);
  });
});

describe('supportAim', () => {
  it('is the ring and the click at one point: a wall pixel is the building centre', () => {
    const { sim, house } = world();
    expect(supportAim(viewOver(house), sim, 5, 5)).toEqual({ x: 11, y: 11 });
    expect(supportAim(viewOver(-1), sim, 5, 5)).toEqual({ x: 14.2, y: 9.1 });
  });
});

describe('aimFootprint', () => {
  const at = { x: 17.5, y: 8.5 };
  it.each(FIRE_SUPPORT_KINDS.filter((k) => k !== 'drone_sweep'))('%s radius is footprintTiles', (kind) => {
    expect(aimFootprint(kind, at)?.radius).toBe(footprintTiles(kind));
    expect(aimFootprint(kind, at)).toMatchObject({ x: 17.5, y: 8.5 });
  });
  it('names the ring style per kind: strike and smoke plain, barrage with its 1.5-tile scatter', () => {
    expect(aimFootprint('air_strike', at)).toEqual({ x: 17.5, y: 8.5, radius: 2, kind: 'strike' });
    expect(aimFootprint('smoke_screen', at)).toEqual({ x: 17.5, y: 8.5, radius: 4.5, kind: 'smoke' });
    expect(aimFootprint('mortar_barrage', at)).toEqual({ x: 17.5, y: 8.5, radius: 2.5, kind: 'barrage', scatter: 1.5 });
  });
  it("the barrage scatter is the table's scatterFx, so it cannot drift from the rounds", () => {
    expect(aimFootprint('mortar_barrage', at)?.scatter).toBe(ROUNDS.mortar_barrage.scatterFx / 65536);
  });
  it('is nothing for the sweep, for no kind, or off the map', () => {
    expect(aimFootprint('drone_sweep', at)).toBeNull();
    expect(aimFootprint(null, at)).toBeNull();
    expect(aimFootprint('air_strike', null)).toBeNull();
  });
});
