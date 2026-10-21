// Field works (#277) Task 7: sensor structures -- an eye of the owner's side for units, and a
// no-LOS sensor for tunnel routes. Spec docs/superpowers/specs/2026-09-29-field-works-design.md
// §3 ("Intel centre"), §9 (the militia observation post); plan Task 7.
//
// Every expected number is a literal with its hand arithmetic beside it, never a value read
// back from the code under test. Tick counts the arithmetic can only estimate (fixed-point
// rounding of expNeg and the contact blend) are pinned at the measured value with the
// estimate beside them.
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import { structureTypeFromJson, type StructureTypeJson } from './structures';

const INTEL: StructureTypeJson = {
  id: 's_intel', hp_per_tile: 250, garrison_slots: 0,
  aura: { sensor: { sight: 10, optics: 1.0, tunnel_radius: 10 } },
};
/** The militia observation post: no tunnel radius. */
const OP: StructureTypeJson = {
  id: 's_op', hp_per_tile: 300, garrison_slots: 0,
  aura: { sensor: { sight: 9, optics: 1.2 } },
};
const HOUSE: StructureTypeJson = { id: 's_house', hp_per_tile: 260, garrison_slots: 2 };

/** A still militia man: militia_cell's signature 0.45, unarmed so nothing changes the scene. */
const MILITIA: UnitTypeJson = {
  id: 's_militia', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 0.85, sight_tiles: 7, signature: 0.45 },
  weapons: [],
};
/** An unarmed KDF squad, signature 0.6. */
const SQUAD: UnitTypeJson = {
  id: 's_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 2, signature: 0.6 },
  weapons: [],
};
/** A side-1 mortar that sees only 3 tiles: anything it fires on at 17 was spotted by someone else. */
const MORTAR: UnitTypeJson = {
  id: 's_mortar', role: 'artillery',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 3, signature: 0.6 },
  weapons: [{
    id: 'm60', type: 'mortar', range_tiles: 18, effective_range_tiles: 14, accuracy: 0.3,
    damage: 60, splash_tiles: 1, suppression: 60, rof_per_min: 12,
  }],
};

function world() {
  const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 32 });
  const t = {
    intel: sim.addStructureType(INTEL),
    op: sim.addStructureType(OP),
    house: sim.addStructureType(HOUSE),
  };
  const u = {
    militia: sim.addUnitType(MILITIA),
    squad: sim.addUnitType(SQUAD),
    mortar: sim.addUnitType(MORTAR),
  };
  return { sim, t, u };
}

function rect(sim: Sim, typeIdx: number, x: number, y: number, opts?: { owner?: number; progress?: Fx }): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + 2; ty++) for (let tx = x; tx < x + 2; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles, opts);
}

/** Ticks until `pred` holds (the tick count AFTER which it first holds), or -1 within `max`. */
function ticksUntil(sim: Sim, max: number, pred: () => boolean): number {
  for (let n = 1; n <= max; n++) {
    sim.tick();
    if (pred()) return n;
  }
  return -1;
}

describe('sensor parse (Q16.16 at load)', () => {
  const t = (j: StructureTypeJson) => structureTypeFromJson(j, 20);
  it('sight 10 -> sightSq 100 tiles^2 = 6553600 raw; optics 1.0 = 65536; tunnel 10 -> 6553600', () => {
    expect(t(INTEL).aura?.sensor).toEqual({ sight: 655360, sightSq: 6553600, optics: 65536, tunnelRadiusSq: 6553600 });
  });
  it('the OP: sight 9 -> 81 tiles^2 = 5308416; optics 1.2 = fx.from 78643; no tunnel radius -> 0', () => {
    expect(t(OP).aura?.sensor).toEqual({ sight: 589824, sightSq: 5308416, optics: 78643, tunnelRadiusSq: 0 });
  });
  it('a type with no sensor scope parses sensor null', () => {
    expect(structureTypeFromJson({ id: 'x', hp_per_tile: 1, aura: { garrison: { sight_bonus: 1 } } }, 20).aura?.sensor).toBeNull();
  });
});

// The intel centre: a 2x2 at (20,14), centroid (21,15), owner 0. The structure's eye is the
// centroid at ground level (route spotting's rule).
describe('a sensor structure observes units for its owner', () => {
  // Militia at (30,15) on a cover-2 tile: 9 tiles east of the centroid, open ground between.
  // sig = 0.45 x COVER_SIG[2] 0.5 = 0.225; strength = optics 1.0 x 0.225 / 81 = 0.0027778;
  // p = 1 - exp(-K 20 x 0.0027778 x DT 0.05) = 0.0027739 a tick; identified at 0.70:
  // n = ln(0.3) / -ln(1 - p) = 1.20397 / 0.0027778 = 433.4 -> ~434 ticks in real numbers;
  // measured 441 (22.05 s; the fixed-point expNeg LUT and truncating blend run ~2% slow; the
  // spec's "~27 s" was a rougher estimate). Pinned at the measured tick.
  function scene(opts?: { owner?: number; progress?: Fx }) {
    const mx = 30;
    const w = world();
    const s = rect(w.sim, w.t.intel, 20, 14, opts ?? { owner: 0 });
    w.sim.setCover(mx, 15, 2);
    const m = w.sim.spawn(w.u.militia, 1, fx.fromInt(mx), fx.fromInt(15));
    return { ...w, s, m };
  }

  it('identifies a still militia in cover 2 at 9 tiles on the measured tick', () => {
    const { sim, m } = scene();
    const n = ticksUntil(sim, 2000, () => sim.contactLevel(0, m) === 2);
    expect(n).toBe(441);
  });

  it('never sees at 10.5 tiles (sight 10)', () => {
    const { sim, t, u } = world();
    rect(sim, t.intel, 20, 14, { owner: 0 });
    const far = sim.spawn(u.militia, 1, fx.from(31.5), fx.fromInt(15)); // 10.5 from (21,15), open ground
    expect(ticksUntil(sim, 2000, () => sim.contactConfidence(0, far) > 0)).toBe(-1);
  });

  it('an unfinished centre sees nothing', () => {
    const { sim, m } = scene({ owner: 0, progress: fx.from(0.5) });
    expect(ticksUntil(sim, 1000, () => sim.contactConfidence(0, m) > 0)).toBe(-1);
  });

  it('a destroyed centre sees nothing', () => {
    const { sim, s, m } = scene();
    sim.debugDestroyStructure(s);
    expect(ticksUntil(sim, 1000, () => sim.contactConfidence(0, m) > 0)).toBe(-1);
  });

  it('a neutral centre sees for nobody (another owned structure keeps field works live)', () => {
    const { sim, t, m } = scene({ owner: -1 });
    rect(sim, t.house, 2, 2, { owner: 0 });
    expect(sim.fieldWorksLive).toBe(true);
    expect(ticksUntil(sim, 1000, () => sim.contactConfidence(0, m) > 0 || sim.contactConfidence(1, m) > 0)).toBe(-1);
  });

  it('the contact event names the structure: observer -1, observerStructure s', () => {
    const { sim, s, m } = scene();
    const events: SimEvent[] = [];
    for (let i = 0; i < 500; i++) events.push(...sim.tick());
    const ident = events.find((e) => e.kind === 'contact' && e.target === m && e.level === 'identified');
    expect(ident).toMatchObject({ side: 0, observer: -1, observerStructure: s });
    const susp = events.find((e) => e.kind === 'contact' && e.target === m && e.level === 'suspected');
    expect(susp).toMatchObject({ side: 0, observer: -1, observerStructure: s });
  });
});

// Tunnels. Centroid (21,15). A route tile (28,21) has its centre 7.5 east and 6.5 south:
// 56.25 + 42.25 = 98.5 tiles^2 = 9.925 tiles, inside tunnel_radius 10 (100). A route starting
// at (29,20): 8.5^2 + 5.5^2 = 72.25 + 30.25 = 102.5 = 10.12 tiles, outside; every later tile of
// either route runs east, further away. A rock wall at x = 24, full height, stands between: the
// sensor has no LOS test.
describe('a sensor structure identifies tunnel routes without line of sight', () => {
  const IN = { id: 'tn_in', points: [[28, 21], [34, 21]] as [number, number][], dig_tiles_per_s: 1, pre_dug: true };
  const OUT = { id: 'tn_out', points: [[29, 20], [35, 20]] as [number, number][], dig_tiles_per_s: 1, pre_dug: true };

  function ridge(sim: Sim): void {
    for (let y = 0; y < 32; y++) sim.setBlocked(24, y, true);
  }

  it('a route tile at 9.925 tiles behind a ridge is identified on the first tick', () => {
    const { sim, t } = world();
    ridge(sim);
    const r = sim.addTunnel(IN);
    const s = rect(sim, t.intel, 20, 14, { owner: 0 });
    const ev = sim.tick();
    expect(sim.tunnelContactLevel(0, r)).toBe(2);
    expect(sim.tunnelContactLevel(1, r)).toBe(0);
    expect(ev).toContainEqual(
      expect.objectContaining({ kind: 'tunnelContact', side: 0, tunnel: r, level: 'identified', observer: -1, observerStructure: s })
    );
  });

  it('the same, with the route registered after the centre', () => {
    const { sim, t } = world();
    ridge(sim);
    rect(sim, t.intel, 20, 14, { owner: 0 });
    const r = sim.addTunnel(IN);
    sim.tick();
    expect(sim.tunnelContactLevel(0, r)).toBe(2);
  });

  it('a route whose nearest tile is 10.12 tiles out is not', () => {
    const { sim, t } = world();
    ridge(sim);
    const r = sim.addTunnel(OUT);
    rect(sim, t.intel, 20, 14, { owner: 0 });
    expect(ticksUntil(sim, 400, () => sim.tunnelContactLevel(0, r) !== 0)).toBe(-1);
  });

  it('an unfinished centre identifies no route', () => {
    const { sim, t } = world();
    const r = sim.addTunnel(IN);
    rect(sim, t.intel, 20, 14, { owner: 0, progress: fx.from(0.5) });
    expect(ticksUntil(sim, 400, () => sim.tunnelContactLevel(0, r) !== 0)).toBe(-1);
  });

  it('the OP (no tunnel radius) identifies no route', () => {
    const { sim, t } = world();
    const r = sim.addTunnel({ ...IN, points: [[22, 15], [26, 15]] }); // passes 1.5 tiles from the OP
    rect(sim, t.op, 20, 14, { owner: 0 });
    expect(ticksUntil(sim, 400, () => sim.tunnelContactLevel(0, r) !== 0)).toBe(-1);
  });

  it('held, not latched: after the centre falls the route decays to lost down the ladder', () => {
    // From tnContact ONE, decay is c x CONTACT_DECAY 0.99501 a tick until c < LOST_AT 0.20:
    // in real numbers n > ln(0.2) / ln(0.99501) = 1.60944 / 0.0050025 = 321.7 -> 322 ticks. In
    // Q16.16 each step truncates, c = (c x 65209) >> 16 from 65536 until c < 13107, which by
    // integer iteration crosses on step 321 (one truncation-tick early).
    const { sim, t } = world();
    ridge(sim);
    const r = sim.addTunnel(IN);
    const s = rect(sim, t.intel, 20, 14, { owner: 0 });
    for (let i = 0; i < 200; i++) sim.tick();
    expect(sim.tunnelContactLevel(0, r)).toBe(2); // held while it stands
    sim.debugDestroyStructure(s);
    const n = ticksUntil(sim, 1000, () => sim.tunnelContactLevel(0, r) === 0);
    expect(n).toBe(321);
  });
});

// The militia OP spots for the mortar: indirect fire needs only its SIDE's identification
// (INDIRECT_MASK in selectTarget), so the structure is a spotter with no new rule.
// OP 2x2 at (10,10), centroid (11,11), owner 1. KDF squad at (19,11): 8 tiles, inside sight 9.
// strength = 1.2 x 0.6 / 64 = 0.01125; p = 1 - exp(-20 x 0.01125 x 0.05) = 0.01119;
// identified after ln(0.3)/0.01125 ~ 107 ticks. The mortar at (11,26) is sqrt(64 + 225) = 17
// tiles from the squad: inside range 18, far outside its own sight 3.
describe('the militia OP spots for a side-1 mortar', () => {
  function scene(progress: Fx) {
    const { sim, t, u } = world();
    rect(sim, t.op, 10, 10, { owner: 1, progress });
    const squad = sim.spawn(u.squad, 0, fx.fromInt(19), fx.fromInt(11));
    const mortar = sim.spawn(u.mortar, 1, fx.fromInt(11), fx.fromInt(26));
    return { sim, squad, mortar };
  }
  function firstFire(sim: Sim, mortar: number, squad: number, max: number): number {
    for (let n = 1; n <= max; n++) {
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === mortar && e.target === squad) return n;
    }
    return -1;
  }

  it('the mortar engages a squad only the OP sees', () => {
    const { sim, squad, mortar } = scene(fx.fromInt(1));
    expect(firstFire(sim, mortar, squad, 600)).toBeGreaterThan(0);
  });

  it('control: with the OP unfinished the mortar never fires', () => {
    const { sim, squad, mortar } = scene(fx.from(0.5));
    expect(firstFire(sim, mortar, squad, 600)).toBe(-1);
  });
});
