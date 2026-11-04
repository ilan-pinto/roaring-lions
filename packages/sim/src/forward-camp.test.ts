import { describe, expect, it } from 'vitest';
import catalogue from '../../../data/structures.json';
import { ONE } from './fixed';
import { MissionRuntime, NOT_ON_LINE, type MissionEvent } from './mission';
import {
  FWD_CAMP_WORK,
  FWD_PAD,
  FWD_TICKS,
  forwardAdvance,
  forwardDrive,
  forwardWorld,
  type ForwardWorldOptions,
} from './runtime-forward-world.test-helper';
import { MAX_PRODUCTION_LINES } from './tuning';
import { SNAPSHOT_FIXED_HEADER_BYTES, SnapshotRefused, canonicalJson, encodeSim, restoreSim } from './snapshot';
import { structureTypeFromJson, type StructureTypeJson } from './structures';
import { TICKS_PER_SECOND, type Sim } from './sim';

// GH-277 follow-on: the forward camp, a field work that opens a second F4 serial line where it was raised
// (docs: _coord/producing-buildings/design.md sections 4, 5, 9; the lead's rulings on GH-277, 4 Nov 2026).
// Every expected number is an integer literal worked by hand in a comment beside it.
//
// The fixture work (`FWD_CAMP_WORK`) is a TEST type that sets BOTH optional fields the shipped
// `kdf_forward_camp` leaves out (roles: ['infantry'], build_time_mult 1.5), so the menu filter and the multiplier
// have a world to run in. The shipped type is read from data/structures.json in the last block.
//
// 200 logistics, 5 s: a 2x2 pad at (14, 10), the engineer at (12, 10): staked at tick 2, complete at tick 136.
// A squad is 100 logistics / 2 s = 40 ticks (60 on the forward line: 40 x 1.5); a tank 150 / 4 s = 80 ticks, role mbt.

interface World {
  sim: Sim;
  rt: MissionRuntime;
  events: MissionEvent[];
  step(n: number): void;
}

function world(o: ForwardWorldOptions = {}): World {
  const { sim, rt } = forwardWorld(o);
  const events: MissionEvent[] = [];
  return {
    sim,
    rt,
    events,
    step(n) {
      for (let i = 0; i < n; i++) events.push(...rt.step(sim.tick()));
    },
  };
}

/** Raise the work and tick until the line stands (tick 136). */
function raised(o: ForwardWorldOptions = {}): World {
  const w = world(o);
  expect(w.rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe(true);
  w.step(136);
  expect(w.rt.productionLines(0)).toHaveLength(o.camps === undefined ? 2 : o.camps.length + 1);
  return w;
}

const priv = (rt: MissionRuntime): Record<string, unknown> => rt as unknown as Record<string, unknown>;
const queuedUnits = (rt: MissionRuntime, line: number): string[] => {
  const l = rt.productionLines(0)[line];
  return [...(l.current === null ? [] : [l.current]), ...l.items];
};

describe('a production work opens a line only when it completes (gate 2)', () => {
  it('while it is built there is one line and no build can name a second; at completion the line is the tail', () => {
    const w = world();
    expect(w.rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe(true);
    expect(w.rt.logisticsOf(0)).toBe(1300); // 1500 - 200, taken on the request
    w.step(100);
    const anchor = w.sim.structureCount - 1;
    // staked and under way: progress 0 < ONE at tick 100 (the work completes at 136), a structure row exists
    expect(w.sim.structures.progress[anchor]).toBeGreaterThan(0);
    expect(w.sim.structures.progress[anchor]).toBeLessThan(ONE);
    expect(w.rt.productionLines(0)).toHaveLength(1);
    expect(w.rt.canBuild('fwd_squad', 1)).toBe(false);
    expect(w.rt.requestBuild('fwd_squad', 1)).toBe(false);
    expect(w.rt.logisticsOf(0)).toBe(1300); // the refusal charged nothing
    w.step(36);
    const lines = w.rt.productionLines(0);
    expect(lines).toHaveLength(2);
    // The tail: line 0 is still the authored camp, byte for byte its old self; line 1 is the new one.
    expect(lines.map((l) => l.appended)).toEqual([false, true]);
    expect(lines[0].anchor).toBe(0);
    expect(lines[1].anchor).toBe(anchor);
    expect(lines[1].alive).toBe(true);
    // The runtime told the dock: a `complete` event, once.
    expect(w.events.filter((e) => e.kind === 'works' && e.phase === 'complete')).toHaveLength(1);
  });

  it('a line over a structure below ONE progress is not alive, whatever else is true of it', () => {
    // Constructed input: a completed work's progress knocked down to a half. (Nothing in the sim does this; the read holds the rule.)
    const w = raised();
    const anchor = w.rt.productionLines(0)[1].anchor;
    expect(w.rt.canBuild('fwd_squad', 1)).toBe(true);
    w.sim.structures.progress[anchor] = ONE / 2;
    expect(w.rt.productionLines(0)[1].alive).toBe(false);
    expect(w.rt.canBuild('fwd_squad', 1)).toBe(false);
    w.sim.structures.progress[anchor] = ONE;
    expect(w.rt.canBuild('fwd_squad', 1)).toBe(true);
  });

  it('a cancelled site opens no line and returns its price', () => {
    const w = world();
    expect(w.rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe(true);
    w.step(60);
    expect(w.rt.requestCancelWorks(0)).toBe(true);
    w.step(5);
    expect(w.rt.productionLines(0)).toHaveLength(1);
    expect(priv(w.rt).appendedAnchors).toEqual([]);
    // cost 200 x (ONE - progress) >> 16 back: progress is part-way, so more than nothing and less than all
    expect(w.rt.logisticsOf(0)).toBeGreaterThan(1300);
    expect(w.rt.logisticsOf(0)).toBeLessThanOrEqual(1500);
  });
});

describe('the menu of a line, and the reason a build is not on it (gate 4)', () => {
  it('a unit the work\'s roles leave out is refused on its line with the code, accepted on the camp, and an unnamed build skips the forward line', () => {
    const w = raised();
    // tank: role mbt, the work builds ['infantry'] only
    expect(w.rt.buildBlockedReasonOn('fwd_tank', 1)).toBe(NOT_ON_LINE);
    expect(NOT_ON_LINE).toBe('not_on_line');
    expect(w.rt.canBuild('fwd_tank', 1)).toBe(false);
    expect(w.rt.requestBuild('fwd_tank', 1)).toBe(false);
    expect(w.rt.logisticsOf(0)).toBe(1300); // nothing charged
    expect(w.rt.buildBlockedReasonOn('fwd_tank', 0)).toBeNull();
    expect(w.rt.canBuild('fwd_tank', 0)).toBe(true);
    // unnamed: some line takes it, so it is not refused...
    expect(w.rt.buildBlockedReason('fwd_tank')).toBeNull();
    // ...and it goes to the camp line even when that line is the LONGER one (two squads ahead of it).
    expect(w.rt.requestBuild('fwd_squad', 0)).toBe(true);
    expect(w.rt.requestBuild('fwd_squad', 0)).toBe(true);
    expect(w.rt.requestBuild('fwd_tank')).toBe(true);
    expect(queuedUnits(w.rt, 0)).toEqual(['fwd_squad', 'fwd_squad', 'fwd_tank']);
    expect(queuedUnits(w.rt, 1)).toEqual([]);
    // an infantry build, unnamed, takes the SHORTEST line: the forward line, empty against the camp's three
    expect(w.rt.requestBuild('fwd_squad')).toBe(true);
    expect(queuedUnits(w.rt, 1)).toEqual(['fwd_squad']);
  });

  it('the camp\'s own and player_start\'s lines take every role', () => {
    const w = world();
    expect(w.rt.buildBlockedReasonOn('fwd_tank', 0)).toBeNull();
    expect(w.rt.buildBlockedReason('fwd_tank')).toBeNull();
    expect(w.rt.buildBlockedReasonOn('fwd_squad', 0)).toBeNull();
  });

  it('a unit that names no role is not on a line that restricts roles', () => {
    // `unitInfo` is the app's: a lookup that never heard of roles must not slip a unit onto a restricted line.
    const w = raised();
    const rt = priv(w.rt) as unknown as { ctx: { unitInfo: (u: string) => unknown } };
    const was = rt.ctx.unitInfo;
    rt.ctx.unitInfo = (u: string) => {
      const info = was(u) as Record<string, unknown> | null;
      if (info === null) return null;
      const { role: _role, ...rest } = info;
      void _role;
      return rest;
    };
    expect(w.rt.buildBlockedReasonOn('fwd_squad', 1)).toBe(NOT_ON_LINE);
    expect(w.rt.buildBlockedReasonOn('fwd_squad', 0)).toBeNull();
  });

  it('build_time_mult scales a forward-line item to ceil(base x mult), whole ticks; the camp\'s line is untouched', () => {
    const w = raised();
    // squad 2 s = 40 ticks: 40 x 1.5 = 60 on the forward line, 40 on the camp's
    expect(w.rt.requestBuild('fwd_squad', 1)).toBe(true);
    expect(w.rt.requestBuild('fwd_squad', 0)).toBe(true);
    expect(w.rt.productionLines(0).map((l) => l.ticksLeft)).toEqual([40, 60]);
    // scout 0.85 s = 17 ticks: 17 x 1.5 = 25.5, CEIL 26 (a truncation would say 25)
    expect(w.rt.requestBuild('fwd_scout', 1)).toBe(true);
    const items = w.rt.productionOf(0).filter((p) => p.unit === 'fwd_scout');
    expect(items.map((p) => p.totalTicks)).toEqual([26]);
  });
});

describe('a destroyed work (gate 3, F4 D4)', () => {
  it('loses the item in progress, refunds the queue, keeps its index and does not give the count back', () => {
    const w = raised();
    // forward line: one squad in progress, two queued. 3 x 100 charged.
    for (let i = 0; i < 3; i++) expect(w.rt.requestBuild('fwd_squad', 1)).toBe(true);
    w.step(1);
    expect(w.rt.logisticsOf(0)).toBe(1000); // 1300 - 300
    const anchor = w.rt.productionLines(0)[1].anchor;
    w.sim.debugDestroyStructure(anchor);
    w.step(1);
    const line = w.rt.productionLines(0)[1];
    expect(line.alive).toBe(false);
    expect(line.current).toBeNull();
    expect(line.queued).toBe(0);
    // D4: the item in progress (100) is LOST, the two queued (200) are back
    expect(w.rt.logisticsOf(0)).toBe(1200);
    // the line keeps its index; the work's count is not returned (field_works fwd_camp: 1)
    expect(w.rt.productionLines(0)).toHaveLength(2);
    expect(w.rt.worksOffers()[0].left).toBe(0);
    expect(w.rt.canBuild('fwd_squad', 1)).toBe(false);
    expect(w.rt.requestBuild('fwd_squad', 1)).toBe(false);
    // and the unnamed build still has the camp
    expect(w.rt.requestBuild('fwd_squad')).toBe(true);
    expect(queuedUnits(w.rt, 0)).toEqual(['fwd_squad']);
  });
});

describe('the rear and the income are the authored camp\'s alone (gate 5)', () => {
  it('a completed work is never the rear: with the camp down, no structure produces for side 0', () => {
    const w = raised();
    const anchor = w.rt.productionLines(0)[1].anchor;
    expect(w.sim.structureProducesFor(anchor)).toBe(-1);
    expect(priv(w.rt).productionAnchor).toBeTypeOf('function');
    const anchorOf = (): number => (w.rt as unknown as { productionAnchor(side: number): number }).productionAnchor(0);
    expect(anchorOf()).toBe(0); // the camp, structure 0
    w.sim.debugDestroyStructure(0);
    // The forward camp still stands and still has its line, but it is not where side 0 "produces from" for the rear.
    expect(anchorOf()).toBe(-1);
    w.step(2);
    expect(w.rt.productionLines(0)[1].alive).toBe(true);
    expect(w.rt.productionLines(0)[0].alive).toBe(false);
  });
});

describe('the line cap (gate 6)', () => {
  const FOUR: ForwardWorldOptions = { camps: [[2, 2], [2, 8], [2, 14], [2, 20]] };

  it('four authored lines leave no slot: no_line_slot, nothing charged', () => {
    const w = world(FOUR);
    expect(MAX_PRODUCTION_LINES).toBe(4);
    expect(w.rt.constructReason('fwd_camp')).toBe('no_line_slot');
    expect(w.rt.constructReason('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe('no_line_slot');
    expect(w.rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe(false);
    expect(w.rt.logisticsOf(0)).toBe(1500);
    expect(w.rt.worksOffers()[0].left).toBe(1);
  });

  it('three authored lines leave exactly one: a second work in flight is refused, a first is not', () => {
    const w = world({ camps: [[2, 2], [2, 8], [2, 14]], count: 2 });
    expect(w.rt.constructReason('fwd_camp')).toBeNull();
    expect(w.rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe(true);
    // the first is charged and not yet staked: it holds the fourth slot already
    expect(w.rt.constructReason('fwd_camp', 20, 10)).toBe('no_line_slot');
    w.step(5); // staked, not complete
    expect(w.rt.constructReason('fwd_camp', 20, 10)).toBe('no_line_slot');
    w.step(140); // complete
    expect(w.rt.productionLines(0)).toHaveLength(4);
    expect(w.rt.constructReason('fwd_camp', 20, 10)).toBe('no_line_slot');
  });

  it('a destroyed work\'s line keeps its index, so it keeps its slot', () => {
    const w = raised({ camps: [[2, 2], [2, 8], [2, 14]], count: 2 });
    expect(w.rt.productionLines(0)).toHaveLength(4);
    w.sim.debugDestroyStructure(w.rt.productionLines(0)[3].anchor);
    w.step(2);
    // one count left (2 allowed, 1 raised and lost), but no slot: the dead line still has index 3
    expect(w.rt.worksOffers()[0].left).toBe(1);
    expect(w.rt.constructReason('fwd_camp', 20, 10)).toBe('no_line_slot');
  });

  it('a join of a live site is never refused for the slot it already holds', () => {
    const w = world({ camps: [[2, 2], [2, 8], [2, 14]] });
    expect(w.rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1])).toBe(true);
    w.step(3);
    // the same type at the same origin joins the live site (the sim's rule): no price, no count, no slot test
    // (the lone engineer is on the site, so the reason is `needs_engineers`: what matters is that it is not the slot)
    expect(w.rt.constructReason('fwd_camp', FWD_PAD[0], FWD_PAD[1])).not.toBe('no_line_slot');
  });
});

describe('the enemy line table is not touched (gate 8, D7)', () => {
  it('completing a work appends to side 0 alone: side 1 has no line and no cursor', () => {
    const w = raised();
    expect(w.rt.productionLines(1)).toEqual([]);
    expect(priv(w.rt).enemyLast).toEqual([]);
    expect(priv(w.rt).enemyMenu).toEqual([]);
  });
});

describe('economyHash covers the appended tail, and only when there is one (gate 1)', () => {
  it('moves with the appended line\'s structure type, and a world with no appended line folds nothing', () => {
    const w = raised();
    const base = w.rt.economyHash();
    const anchor = (priv(w.rt).appendedAnchors as number[])[0];
    // Constructed input: the SAME world with the appended line's structure reading another type index. No other
    // word of economyHash reads the type, so only the tail block can see it.
    const types = w.sim.structures.typeIdx;
    const was = types[anchor];
    types[anchor] = 0;
    expect(w.rt.economyHash()).not.toBe(base);
    types[anchor] = was;
    expect(w.rt.economyHash()).toBe(base);
    // and with no appended line the same poke is invisible (nothing to fold): the hash is the pre-feature hash
    const pre = world();
    pre.step(10);
    const h = pre.rt.economyHash();
    pre.sim.structures.typeIdx[anchor] = 0;
    expect(pre.rt.economyHash()).toBe(h);
  });
});

describe('the snapshot carries an appended line (gate 9)', () => {
  const META = { build: 'b-test', matchId: 'room-7', contentDigest: 0xabcdef, frameTick: 123, matchDigest: 0x1234_5678 };
  const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

  function played(T: number): { sim: Sim; rt: MissionRuntime } {
    const { sim, rt } = forwardWorld();
    for (let t = 0; t < T; t++) {
      forwardDrive(rt, t);
      forwardAdvance({ sim, rt });
    }
    return { sim, rt };
  }

  it('encode(restore(fresh, S)) == S and the digest agrees, before, at and after the line opens', () => {
    // 20: a site staked; 135/136: either side of the completion tick; 137: the first tick of the line; 250/300: items on both lines
    for (const T of [20, 100, 135, 136, 137, 250, 300, FWD_TICKS]) {
      const a = played(T);
      const S = encodeSim(a.sim, META, a.rt);
      const fresh = forwardWorld();
      // The fresh twin is built by the same setup, so it has ONE line; the snapshot makes the tail.
      expect(fresh.rt.productionLines(0)).toHaveLength(1);
      const meta = restoreSim(fresh.sim, S, fresh.rt);
      expect(fresh.rt.productionLines(0), `T=${T}: lines`).toHaveLength(a.rt.productionLines(0).length);
      expect(fresh.rt.digest(), `T=${T}: digest`).toBe(a.rt.digest());
      expect(fresh.rt.economyHash(), `T=${T}: economyHash`).toBe(a.rt.economyHash());
      expect(bytesEqual(encodeSim(fresh.sim, meta, fresh.rt), S), `T=${T}: re-encode`).toBe(true);
    }
  }, 60_000);

  it('restore then step is byte-identical to the uninterrupted run, the appended line included', () => {
    for (const T of [100, 137, 255, 300]) {
      const a = played(T);
      const S = encodeSim(a.sim, META, a.rt);
      const b = forwardWorld();
      restoreSim(b.sim, S, b.rt);
      for (let t = T; t < FWD_TICKS; t++) {
        forwardDrive(a.rt, t);
        forwardAdvance(a);
        forwardDrive(b.rt, t);
        forwardAdvance(b);
        if (t % 10 === 0) {
          expect(b.sim.hash(), `T=${T} tick ${t}: sim.hash`).toBe(a.sim.hash());
          expect(b.rt.digest(), `T=${T} tick ${t}: digest`).toBe(a.rt.digest());
        }
      }
      expect(bytesEqual(encodeSim(b.sim, META, b.rt), encodeSim(a.sim, META, a.rt)), `T=${T}: the end states encode alike`).toBe(true);
    }
  }, 60_000);

  // Constructed inputs: a section edited to something the restore must refuse, each with its reason pinned.
  function refusalOf(edit: (s: Record<string, unknown>) => void, T = 300): string {
    const a = played(T);
    const S = encodeSim(a.sim, META, a.rt);
    // the runtime section is the LAST frame of the file: a u32 length word, then canonical JSON
    const view = new DataView(S.buffer, S.byteOffset, S.byteLength);
    let start = -1;
    for (let p = S.length - 5; p >= SNAPSHOT_FIXED_HEADER_BYTES && start < 0; p--) {
      if (p + 4 + view.getUint32(p, true) === S.length && S[p + 4] === 0x7b) start = p;
    }
    const section = JSON.parse(new TextDecoder().decode(S.subarray(start + 4))) as Record<string, unknown>;
    edit(section);
    const body = new TextEncoder().encode(canonicalJson(section));
    const out = new Uint8Array(start + 4 + body.length);
    out.set(S.subarray(0, start));
    new DataView(out.buffer).setUint32(start, body.length, true);
    out.set(body, start + 4);
    const fresh = forwardWorld();
    try {
      restoreSim(fresh.sim, out, fresh.rt);
    } catch (e) {
      expect(e).toBeInstanceOf(SnapshotRefused);
      return (e as SnapshotRefused).reason;
    }
    throw new Error('the restore accepted a section it must refuse');
  }

  it('refuses an appended anchor that is not a production work, one repeated, a tail the lines do not match, and too many', () => {
    expect(refusalOf((s) => (s.appendedAnchors = [0]))).toMatch(/structure 0 is a camp, which opens no production line/);
    expect(refusalOf((s) => (s.appendedAnchors = [1, 1]))).toMatch(/structure 1 twice/);
    // the tail says one more line than the lines array carries
    expect(refusalOf((s) => (s.appendedAnchors = []))).toMatch(/lines\[\]: 2 entries, this world has 1/);
    expect(refusalOf((s) => (s.appendedAnchors = [1, 2, 3, 4]))).toMatch(/appendedAnchors/);
    // a work still under construction (snapshot at 100: structure 1 is staked at progress < ONE) cannot be a line's anchor
    expect(refusalOf((s) => (s.appendedAnchors = [1]), 100)).toMatch(/structure 1 is not complete/);
    // an anchor past the structures the sim holds
    expect(refusalOf((s) => (s.appendedAnchors = [200]))).toMatch(/appendedAnchors\[\]: 200 is outside 0\.\.1/);
  });
});

describe('the shipped kdf_forward_camp (lead rulings, 4 Nov 2026)', () => {
  const parse = (id: string) => {
    const json = (catalogue.types as unknown as Record<string, StructureTypeJson>)[id];
    return structureTypeFromJson(json, TICKS_PER_SECOND);
  };

  it('a field work: owner 0, 350 logistics, 40 s, 300 hp a tile, a 2x2 pad, the whole menu at the whole speed', () => {
    const t = parse('kdf_forward_camp');
    expect(t.owner).toBe(0); // targetable
    expect(t.producesFor).toBe(-1); // never the rear
    expect(t.hpPerTile).toBe(300 * ONE);
    // 40 s = 800 ticks: 65536 % 800 = 736, (65536 - 736) / 800 = 81
    expect(t.buildable).toMatchObject({ costLogistics: 350, costIntel: 0, buildStep: 81, fw: 2, fh: 2 });
    // sets neither optional field: no role subset, build_time_mult 1.0
    expect(t.production).toEqual({ roles: null, buildMult: ONE });
    expect(t.garrisonSlots).toBe(0);
  });

  it('carries the medic station\'s heal (past the 70% cap) and the workshop\'s repair, the placeholder radius and rates of each', () => {
    const t = parse('kdf_forward_camp');
    const med = parse('kdf_medic_station').aura?.area[0];
    const shop = parse('kdf_workshop').aura?.area[0];
    expect(t.aura?.area).toHaveLength(2);
    // heal 0.010/s = fx 655, (655 + 10) / 20 = 33 raw a tick, cap 1.0, radius 4 = 16 tile^2 = 1048576, foot (0)
    expect(t.aura?.area[0]).toMatchObject({ healRate: 33, healCap: ONE, radiusSq: 1048576, affects: 0 });
    // repair 33 raw a tick, 30 s = 600 ticks of component repair, radius 4, vehicle (1)
    expect(t.aura?.area[1]).toMatchObject({ healRate: 33, compTicks: 600, radiusSq: 1048576, affects: 1 });
    expect(t.aura?.area[0]).toEqual(med);
    expect(t.aura?.area[1]).toEqual(shop);
    // the heal cap is the medic's, past REGEN_CAP (0.7 = 45875)
    expect(t.aura?.area[0].healCap).toBeGreaterThan(45875);
  });

  it('refuses a production block without a buildable, an empty roles list and a multiplier outside 1.0..2.0', () => {
    const base = { id: 'x', hp_per_tile: 10, owner: 0 };
    expect(() => structureTypeFromJson({ ...base, production: {} } as StructureTypeJson, 20)).toThrow(/needs a buildable block/);
    const b = { cost: { logistics: 1 }, build_time_s: 5 };
    expect(() => structureTypeFromJson({ ...base, buildable: b, production: { roles: [] } } as StructureTypeJson, 20)).toThrow(/roles is empty/);
    expect(() => structureTypeFromJson({ ...base, buildable: b, production: { build_time_mult: 0.5 } } as StructureTypeJson, 20)).toThrow(/expected 1\.0\.\.2\.0/);
    expect(() => structureTypeFromJson({ ...base, buildable: b, production: { build_time_mult: 2.5 } } as StructureTypeJson, 20)).toThrow(/expected 1\.0\.\.2\.0/);
    expect(structureTypeFromJson({ ...base, buildable: b, production: { build_time_mult: 2 } } as StructureTypeJson, 20).production?.buildMult).toBe(2 * ONE);
    // the fixture work parses to the two optional fields the shipped type leaves out
    expect(structureTypeFromJson(FWD_CAMP_WORK as unknown as StructureTypeJson, 20).production).toEqual({ roles: ['infantry'], buildMult: 98304 });
  });
});
