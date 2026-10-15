import { describe, expect, it } from 'vitest';
import { FIRE_SUPPORT_KINDS, Sim, fx, type SupportKind } from '@lions/sim';
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

function runtime(accept: boolean, intel = 500, cost = 60) {
  const calls: { kind: SupportKind; x: number; y: number }[] = [];
  const rt: SupportRuntime = {
    intel,
    supportCost: () => cost,
    requestSupport: (kind, x, y) => {
      calls.push({ kind, x, y });
      return accept;
    },
  };
  return { rt, calls };
}

describe.each(FIRE_SUPPORT_KINDS)('callSupport(%s)', (kind) => {
  it('a wall click aims at the building', () => {
    const { sim, house } = world();
    const { rt, calls } = runtime(true);
    const out = callSupport(rt, kind, viewOver(house), sim, 5, 5);
    expect(calls).toEqual([{ kind, x: fx.from(11), y: fx.from(11) }]);
    expect(out).toEqual({ ok: true, kind, x: 11, y: 11 });
  });

  it('a ground click aims at the ground', () => {
    const { sim } = world();
    const { rt, calls } = runtime(true);
    const out = callSupport(rt, kind, viewOver(-1), sim, 5, 5);
    expect(calls).toEqual([{ kind, x: fx.from(14.2), y: fx.from(9.1) }]);
    expect(out.ok).toBe(true);
  });

  it('a refusal with too little intel says intel', () => {
    const { sim } = world();
    const { rt } = runtime(false, 10, 60);
    expect(callSupport(rt, kind, viewOver(-1), sim, 5, 5)).toMatchObject({ ok: false, why: 'intel' });
  });

  it('a refusal with intel in hand says caller', () => {
    const { sim } = world();
    const { rt } = runtime(false, 500, 60);
    expect(callSupport(rt, kind, viewOver(-1), sim, 5, 5)).toMatchObject({ ok: false, why: 'caller' });
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
