import { describe, expect, it, vi } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

// Field works (#277) Task 4: construction in the sim. Every expected number is
// worked by hand in a comment from the integer rules, never read back from the
// code under test:
//   buildStep(20 s) = trunc(65536 / (20 x 20)) = trunc(163.84) = 163
//   one builder:  ceil(65536 / 163) = ceil(402.06) = 403 ticks (402 x 163 = 65526 < 65536)
//   two builders: 326 a tick, ceil(65536 / 326) = ceil(201.03) = 202 ticks
//   a D9 at x1.5: fx.mul(163, 98304) = floor(163 x 1.5) = floor(244.5) = 244 a tick,
//                 ceil(65536 / 244) = ceil(268.59) = 269 ticks
// The fixture: a 12x12 map, a 2x2 medic station (200 hp a tile, 800 in all).

const W = 12;
const ONE = 65536;

const MEDIC = {
  id: 'fw_medic', name: 'Medic Station', hp_per_tile: 200, garrison_slots: 2, rubble_cover: 1, owner: 0,
  buildable: { cost: { logistics: 250 }, build_time_s: 20, footprint: [2, 2] },
};
const HOUSE = { id: 'fw_house', name: 'House', hp_per_tile: 200, garrison_slots: 2 };

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
const ENGINEER = unit('fw_engineer', { abilities: ['construct', 'garrison'] });
const DOZER = unit('fw_dozer', { abilities: ['construct'], construct_rate: 1.5, mobility: { speed_tiles_s: 1, wheeled: true } });
const RIFLEMAN = unit('fw_rifleman', { role: 'infantry', abilities: ['garrison'] });

interface World { sim: Sim; medic: number; eng: number; rifle: number; dozer: number }

function world(): World {
  const sim = new Sim({ seed: 0x277, width: W, height: 12, capacity: 32 });
  return {
    sim,
    medic: sim.addStructureType(MEDIC),
    eng: sim.addUnitType(ENGINEER),
    rifle: sim.addUnitType(RIFLEMAN),
    dozer: sim.addUnitType(DOZER),
  };
}

const at = (n: number): number => fx.from(n);
const FOOT_44 = [4 * W + 4, 4 * W + 5, 5 * W + 4, 5 * W + 5];

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** Tick until `structureComplete` (or `limit`), counting the ticks each of
 *  `ids` added progress on (`isConstructing` after the tick). */
function buildOut(sim: Sim, ids: number[], limit = 2000): { ticks: number[]; completeAt: number; events: SimEvent[] } {
  const ticks = ids.map(() => 0);
  const events: SimEvent[] = [];
  for (let t = 0; t < limit; t++) {
    const ev = sim.tick();
    events.push(...ev);
    ids.forEach((id, j) => {
      if (sim.isConstructing(id)) ticks[j]++;
    });
    if (ev.some((e) => e.kind === 'structureComplete')) return { ticks, completeAt: sim.tickCount - 1, events };
  }
  return { ticks, completeAt: -1, events };
}

describe('placementReason: the four rules', () => {
  it('refuses a footprint off the map, either edge', () => {
    const { sim, medic } = world();
    expect(sim.placementReason(medic, 11, 4, 0)).toBe('off_map'); // 11 + 2 > 12
    expect(sim.placementReason(medic, 4, 11, 0)).toBe('off_map');
    expect(sim.placementReason(medic, -1, 4, 0)).toBe('off_map');
    expect(sim.placementReason(medic, 10, 10, 0)).toBe(null); // the last tile that fits
  });

  it('refuses a blocked tile and a boulder tile, blocked first', () => {
    const { sim, medic } = world();
    sim.setBoulder(5, 5, true);
    expect(sim.placementReason(medic, 4, 4, 0)).toBe('no_footing');
    sim.setBlocked(4, 4, true);
    expect(sim.placementReason(medic, 4, 4, 0)).toBe('blocked');
  });

  it('refuses a footprint on two elevation levels (Q6: flat pads)', () => {
    const { sim, medic } = world();
    sim.setElevation(5, 4, 1);
    expect(sim.placementReason(medic, 4, 4, 0)).toBe('not_level');
    // All four raised together is level again.
    sim.setElevation(4, 4, 1);
    sim.setElevation(4, 5, 1);
    sim.setElevation(5, 5, 1);
    expect(sim.placementReason(medic, 4, 4, 0)).toBe(null);
  });

  it('allows road, grove and knoll ground: cover under the pad is no rule', () => {
    const { sim, medic } = world();
    // In the sim a road, a grove and a knoll are open tiles with a cover value.
    sim.setCover(4, 4, 0);
    sim.setCover(5, 4, 1);
    sim.setCover(4, 5, 2);
    sim.setCover(5, 5, 3);
    expect(sim.placementReason(medic, 4, 4, 0)).toBe(null);
  });

  it('a pending site counts for overlap', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(11.5), at(11.5)); // far: the site stays pending
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 1);
    expect(sim.works.alive[0]).toBe(1);
    expect(sim.works.structure[0]).toBe(-1); // not staked
    expect(sim.blocked[4 * W + 4]).toBe(0); // and so not blocked (Q4)
    expect(sim.placementReason(medic, 5, 5, 0)).toBe('overlap'); // shares tile (5,5)
    expect(sim.placementReason(medic, 6, 4, 0)).toBe(null); // touches, does not share
  });

  /** A wall down columns 5-6 with one gap, rows `y0`..`y1`. */
  function corridor(sim: Sim, y0: number, y1: number): void {
    for (let y = 0; y < 12; y++) {
      if (y >= y0 && y <= y1) continue;
      sim.setBlocked(5, y, true);
      sim.setBlocked(6, y, true);
    }
  }

  it('refuses a 2x2 that closes a two-wide corridor (Q5), and allows one in the open', () => {
    const { sim, medic } = world();
    corridor(sim, 5, 6); // the gap is exactly (5..6, 5..6)
    expect(sim.placementReason(medic, 5, 5, 0)).toBe('seals_passage');
    expect(sim.placementReason(medic, 1, 1, 0)).toBe(null);
    // Across the gap's west mouth, (3..4, 5..6): the only way into the gap from
    // the west is through column 4, so that is a seal too.
    expect(sim.placementReason(medic, 3, 5, 0)).toBe('seals_passage');
    // One tile further west, (2..3, 5..6): column 4 stays open, and the west
    // field walks round the pad into the gap.
    expect(sim.placementReason(medic, 2, 5, 0)).toBe(null);
  });

  it('a pending site counts for sealing', () => {
    const { sim, medic, eng } = world();
    corridor(sim, 4, 7); // a gap two wide and four tall
    // Alone, the lower half of the gap leaves the upper half open.
    expect(sim.placementReason(medic, 5, 6, 0)).toBe(null);
    const b = sim.spawn(eng, 0, at(0.5), at(11.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 5, y: 4 });
    run(sim, 1);
    expect(sim.works.structure[0]).toBe(-1); // pending, not blocked
    expect(sim.placementReason(medic, 5, 6, 0)).toBe('seals_passage');
  });
});

describe('construct: staking (Q4)', () => {
  it('blocks nothing until a builder arrives, then stakes at progress 0 and 10% HP', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(0.5), at(4.5)); // 4 tiles west of the pad
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    const first = run(sim, 1);
    expect(first.some((e) => e.kind === 'constructQueued' && e.site === 0 && e.builder === b)).toBe(true);
    for (const t of FOOT_44) expect(sim.blocked[t]).toBe(0);
    let staked: Extract<SimEvent, { kind: 'constructStaked' }> | undefined;
    for (let i = 0; i < 200 && staked === undefined; i++) {
      for (const e of sim.tick()) if (e.kind === 'constructStaked') staked = e;
    }
    expect(staked).toBeDefined();
    if (staked === undefined) return;
    // Staked at 2 tiles from the nearest footprint tile centre (4.5, 4.5): the
    // builder is at x >= 2.5 and still walking to its tile, (3, 4).
    expect(fx.toNumber(sim.state.posX[b])).toBeGreaterThanOrEqual(2.5);
    const s = staked.structure;
    for (const t of FOOT_44) expect(sim.blocked[t]).toBe(1);
    expect(sim.structures.owner[s]).toBe(0);
    expect(sim.works.structure[0]).toBe(s);
    // maxHp = 800 x 65536 = 52428800; x 0.1 (6554) = 800 x 6554 = 5243200.
    expect(sim.structures.maxHp[s]).toBe(52428800);
    expect(sim.structures.hp[s]).toBe(5243200);
  });

  it('staking calls recomputeFields exactly once', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5)); // already on its tile
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    const spy = vi.spyOn(sim as unknown as { recomputeFields: () => void }, 'recomputeFields');
    const ev = run(sim, 1);
    expect(ev.some((e) => e.kind === 'constructStaked')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('an enemy on the pad delays staking; so does a civilian', () => {
    for (const side of [1, 2]) {
      const { sim, medic, eng, rifle } = world();
      const b = sim.spawn(eng, 0, at(3.5), at(4.5));
      const squatter = sim.spawn(rifle, side, at(5.5), at(5.5));
      sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
      const ev = run(sim, 60);
      expect(ev.some((e) => e.kind === 'constructStaked')).toBe(false);
      expect(sim.blocked[5 * W + 5]).toBe(0);
      sim.teleport(squatter, at(10.5), at(10.5));
      const later = run(sim, 1);
      expect(later.some((e) => e.kind === 'constructStaked')).toBe(true);
    }
  });

  it('a friendly non-builder on the pad is put out at the exit tile', () => {
    const { sim, medic, eng, rifle } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    const friend = sim.spawn(rifle, 0, at(5.5), at(5.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    const ev = run(sim, 1);
    expect(ev.some((e) => e.kind === 'constructStaked')).toBe(true);
    // exitTile scans the ring row-major from (minX-1, minY-1) = (3, 3): open, so (3.5, 3.5).
    expect(sim.state.posX[friend]).toBe(at(3.5));
    expect(sim.state.posY[friend]).toBe(at(3.5));
  });

  it('any later order takes a builder off its site: no stake', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(0.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 1);
    expect(sim.state.buildSite[b]).toBe(0);
    sim.queueCommand({ kind: 'move', ids: [b], x: at(3.5), y: at(4.5) });
    const ev = run(sim, 200);
    expect(sim.state.buildSite[b]).toBe(-1);
    expect(ev.some((e) => e.kind === 'constructStaked')).toBe(false);
    expect(sim.works.alive[0]).toBe(1); // the site waits, unstaked
  });
});

describe('construct: progress, by hand arithmetic', () => {
  it('one engineer, 20 s: 403 ticks of work, HP rising with it', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 1);
    const s = sim.works.structure[0];
    expect(sim.isConstructing(b)).toBe(true);
    expect(sim.structures.progress[s]).toBe(163);
    // HP: 5243200 + floor(47185600 x 163 / 65536) = 5243200 + floor(117359.5) = 5360559,
    // where 47185600 = fx.mul(52428800, 58982) = 800 x 58982 (0.9 of max).
    expect(sim.structures.hp[s]).toBe(5360559);
    const out = buildOut(sim, [b]);
    expect(out.ticks[0] + 1).toBe(403); // + the first tick, above
    expect(sim.structures.progress[s]).toBe(ONE);
    // Final HP: 5243200 + 402 x 117359 + floor(47185600 x 10 / 65536) (the last tick adds
    // 65536 - 65526 = 10) = 5243200 + 47178318 + 7199 = 52428717: truncation leaves it
    // 83 raw under max, and it is never rounded up.
    expect(sim.structures.hp[s]).toBe(52428717);
    expect(out.events.some((e) => e.kind === 'structureComplete' && e.site === 0 && e.structure === s)).toBe(true);
    expect(sim.works.alive[0]).toBe(0);
    expect(sim.state.buildSite[b]).toBe(-1);
    run(sim, 1);
    expect(sim.isConstructing(b)).toBe(false);
  });

  it('two engineers: 202 ticks', () => {
    const { sim, medic, eng } = world();
    const a = sim.spawn(eng, 0, at(3.5), at(4.5));
    const b = sim.spawn(eng, 0, at(3.5), at(5.5));
    sim.queueCommand({ kind: 'construct', ids: [a, b], structType: medic, x: 4, y: 4 });
    const out = buildOut(sim, [a, b]);
    expect(out.ticks).toEqual([202, 202]);
  });

  it('a D9 at x1.5: 269 ticks (fx.mul truncates 244.5 to 244)', () => {
    const { sim, medic, dozer } = world();
    const d = sim.spawn(dozer, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [d], structType: medic, x: 4, y: 4 });
    const out = buildOut(sim, [d]);
    expect(out.ticks[0]).toBe(269);
  });

  it('a third builder adds nothing: still 202, and the highest id never works', () => {
    const { sim, medic, eng } = world();
    const a = sim.spawn(eng, 0, at(3.5), at(4.5));
    const b = sim.spawn(eng, 0, at(3.5), at(5.5));
    const c = sim.spawn(eng, 0, at(4.5), at(3.5));
    sim.queueCommand({ kind: 'construct', ids: [c, b, a], structType: medic, x: 4, y: 4 });
    const out = buildOut(sim, [a, b, c]);
    expect(out.ticks).toEqual([202, 202, 0]);
  });

  it('a moving builder adds nothing: staked on the walk, no progress until it stands', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(0.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    let s = -1;
    for (let i = 0; i < 200 && s < 0; i++) {
      for (const e of sim.tick()) if (e.kind === 'constructStaked') s = e.structure;
    }
    expect(s).toBeGreaterThanOrEqual(0);
    let walkingTicks = 0;
    while (sim.state.moving[b] === 1 && walkingTicks < 200) {
      expect(sim.structures.progress[s]).toBe(0);
      sim.tick();
      walkingTicks++;
    }
    expect(walkingTicks).toBeGreaterThan(0); // it was staked while still walking
    run(sim, 1);
    expect(sim.structures.progress[s]).toBeGreaterThan(0);
  });

  it('a pinned builder adds nothing', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 2);
    const s = sim.works.structure[0];
    const before = sim.structures.progress[s];
    sim.debugSuppress(b, fx.from(2)); // far past the pin threshold
    run(sim, 1);
    expect(sim.state.pinned[b]).toBe(1);
    const pinnedAt = sim.structures.progress[s];
    let pinnedTicks = 0;
    for (let i = 0; i < 20 && sim.state.pinned[b] === 1; i++) {
      expect(sim.structures.progress[s]).toBe(pinnedAt);
      expect(sim.isConstructing(b)).toBe(false);
      sim.tick();
      pinnedTicks++;
    }
    expect(pinnedTicks).toBeGreaterThan(0);
    expect(pinnedAt - before).toBeLessThanOrEqual(163); // at most the pin tick itself
  });

  it('a builder sent into a building is off the site and adds nothing', () => {
    const { sim, medic, eng } = world();
    const house = sim.addStructureType(HOUSE);
    const h = sim.addStructure(house, [1 * W + 1]);
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 2);
    const s = sim.works.structure[0];
    sim.queueCommand({ kind: 'garrison', ids: [b], structure: h });
    run(sim, 100);
    expect(sim.state.garrisonedIn[b]).toBe(h);
    const p = sim.structures.progress[s];
    run(sim, 20);
    expect(sim.structures.progress[s]).toBe(p);
  });

  it('progress persists when the builder dies, and a second engineer resumes it', () => {
    const { sim, medic, eng } = world();
    const a = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [a], structType: medic, x: 4, y: 4 });
    run(sim, 100); // 100 ticks of work: 100 x 163 = 16300
    const s = sim.works.structure[0];
    expect(sim.structures.progress[s]).toBe(16300);
    sim.debugKill(a);
    run(sim, 50);
    expect(sim.structures.progress[s]).toBe(16300);
    expect(sim.works.alive[0]).toBe(1);
    const b = sim.spawn(eng, 0, at(6.5), at(4.5)); // east side, on its own tile
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    const out = buildOut(sim, [b]);
    // The same site, joined: no second row. 403 - 100 = 303 more ticks.
    expect(out.events.some((e) => e.kind === 'constructQueued' && e.site === 0 && e.builder === b)).toBe(true);
    expect(out.events.some((e) => e.kind === 'constructRefused')).toBe(false);
    expect(out.ticks[0]).toBe(303);
    expect(sim.structures.progress[s]).toBe(ONE);
  });

  it('nobody garrisons a building still going up; once complete they can', () => {
    const { sim, medic, eng, rifle } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    const r = sim.spawn(rifle, 0, at(6.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 2);
    const s = sim.works.structure[0];
    sim.queueCommand({ kind: 'garrison', ids: [r], structure: s });
    run(sim, 40);
    expect(sim.state.garrisonedIn[r]).toBe(-1);
    buildOut(sim, [b]);
    sim.queueCommand({ kind: 'garrison', ids: [r], structure: s });
    run(sim, 40);
    expect(sim.state.garrisonedIn[r]).toBe(s);
  });
});

describe('construct: cancel, refusal, wreck', () => {
  it('cancels an unstaked site: the row frees, nothing was built', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(11.5), at(11.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 1);
    sim.queueCommand({ kind: 'cancelConstruct', site: 0 });
    const ev = run(sim, 1);
    expect(ev).toContainEqual({ kind: 'constructCancelled', tick: 1, site: 0, structure: -1, progress: 0 });
    expect(sim.works.alive[0]).toBe(0);
    expect(sim.state.buildSite[b]).toBe(-1);
    expect(sim.placementReason(medic, 4, 4, 0)).toBe(null);
  });

  it('cancels a staked site at 0.9: the event carries the progress and the tiles open, no rubble', () => {
    const { sim, medic, eng } = world();
    for (const t of FOOT_44) sim.setCover(t % W, (t - (t % W)) / W, 0);
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 362); // 362 x 163 = 59006, the first count past 0.9 (58982)
    const s = sim.works.structure[0];
    expect(sim.structures.progress[s]).toBe(59006);
    sim.queueCommand({ kind: 'cancelConstruct', site: 0 });
    const ev = run(sim, 1);
    expect(ev).toContainEqual({ kind: 'constructCancelled', tick: 362, site: 0, structure: s, progress: 59006 });
    expect(ev.some((e) => e.kind === 'structureDestroyed')).toBe(false);
    for (const t of FOOT_44) {
      expect(sim.blocked[t]).toBe(0);
      expect(sim.cover[t]).toBe(0);
    }
    expect(sim.structures.alive[s]).toBe(0);
    expect(sim.works.alive[0]).toBe(0);
  });

  it('ignores a cancel of a completed site', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    const done = buildOut(sim, [b]).events.find((e) => e.kind === 'structureComplete');
    const s = done !== undefined && done.kind === 'structureComplete' ? done.structure : -1;
    expect(s).toBeGreaterThanOrEqual(0);
    sim.queueCommand({ kind: 'cancelConstruct', site: 0 });
    const ev = run(sim, 1);
    expect(ev.some((e) => e.kind === 'constructCancelled')).toBe(false);
    expect(sim.structures.alive[s]).toBe(1);
  });

  it('two overlapping constructs in one frame: the second is refused with overlap', () => {
    const { sim, medic, eng } = world();
    const a = sim.spawn(eng, 0, at(11.5), at(11.5));
    const b = sim.spawn(eng, 0, at(11.5), at(10.5));
    sim.queueCommand({ kind: 'construct', ids: [a], structType: medic, x: 4, y: 4 });
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 5, y: 5 });
    const ev = run(sim, 1);
    expect(ev.filter((e) => e.kind === 'constructQueued')).toHaveLength(1);
    expect(ev).toContainEqual({ kind: 'constructRefused', tick: 0, structType: medic, x: 5, y: 5, reason: 'overlap' });
  });

  it('refuses a ninth site (no_site_slot) and an order with no engineer in it (no_builder)', () => {
    const { sim, medic, eng, rifle } = world();
    const b = sim.spawn(eng, 0, at(11.5), at(11.5));
    // Eight non-overlapping 2x2s in rows 0 and 3: x 0, 3, 6, 9.
    for (const y of [0, 3]) for (const x of [0, 3, 6, 9]) sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x, y });
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 0, y: 6 });
    const r = sim.spawn(rifle, 0, at(10.5), at(11.5));
    sim.queueCommand({ kind: 'construct', ids: [r], structType: medic, x: 3, y: 6 });
    const ev = run(sim, 1);
    expect(ev.filter((e) => e.kind === 'constructQueued')).toHaveLength(8);
    expect(ev).toContainEqual({ kind: 'constructRefused', tick: 0, structType: medic, x: 0, y: 6, reason: 'no_site_slot' });
    expect(ev).toContainEqual({ kind: 'constructRefused', tick: 0, structType: medic, x: 3, y: 6, reason: 'no_builder' });
  });

  it('a wreck mid-build leaves rubble and frees the row', () => {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(3.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    run(sim, 50);
    const s = sim.works.structure[0];
    sim.debugDestroyStructure(s);
    for (const t of FOOT_44) expect(sim.cover[t]).toBe(1); // MEDIC's rubble_cover
    run(sim, 1);
    expect(sim.works.alive[0]).toBe(0);
    expect(sim.works.structure[0]).toBe(-1);
    expect(sim.state.buildSite[b]).toBe(-1);
  });
});

describe('construct and the hash (D1)', () => {
  function scenario(construct: boolean): { hash: number; liveBefore: boolean; liveAfter: boolean } {
    const { sim, medic, eng } = world();
    const b = sim.spawn(eng, 0, at(0.5), at(4.5));
    run(sim, 30);
    const liveBefore = sim.fieldWorksLive;
    if (construct) sim.queueCommand({ kind: 'construct', ids: [b], structType: medic, x: 4, y: 4 });
    else sim.queueCommand({ kind: 'move', ids: [b], x: at(3.5), y: at(4.5) });
    run(sim, 1);
    const liveAfter = sim.fieldWorksLive;
    run(sim, 150);
    return { hash: sim.hash(), liveBefore, liveAfter };
  }

  it('a construct accepted mid-run turns the FW block on, and two runs hash alike', () => {
    const a = scenario(true);
    const b = scenario(true);
    expect(a.liveBefore).toBe(false);
    expect(a.liveAfter).toBe(true);
    expect(a.hash).toBe(b.hash);
    const without = scenario(false);
    expect(without.liveAfter).toBe(false);
    expect(without.hash).not.toBe(a.hash);
  });

  it('a refused construct does not turn the FW block on', () => {
    const { sim, medic, rifle } = world();
    const r = sim.spawn(rifle, 0, at(0.5), at(4.5));
    sim.queueCommand({ kind: 'construct', ids: [r], structType: medic, x: 4, y: 4 });
    run(sim, 1);
    expect(sim.fieldWorksLive).toBe(false);
  });
});
