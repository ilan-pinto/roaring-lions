import { describe, expect, it } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import { missileDurationS, missileResolveTick } from './missiles';
import {
  SWARM_DIVE_PITCH_RAD,
  SWARM_DIVE_PITCH_S,
  SWARM_SLOT_MIN_SEP_TILES,
  SWARM_TUMBLE_S,
  SWARM_WANDER_TILES,
  SwarmWreckRing,
  diveFlight,
  diveHasLanded,
  divePose,
  fallHeight,
  liveSlotCount,
  memberOffset,
  planExits,
  settleBlend,
  swarmSlots,
  tumbleAxis,
  type DiveRequest,
  type MemberOffset,
} from './swarm-layout';

const SPREAD = 1.5; // data/units/enemy/drone_swarm.json swarm.spread_tiles
const RADIUS = SPREAD / 2;

describe('swarmSlots: the cloud', () => {
  it('is a pure function of (entity id, count, spread)', () => {
    expect(swarmSlots(41, 12, SPREAD)).toEqual(swarmSlots(41, 12, SPREAD));
    expect(swarmSlots(41, 12, SPREAD)).not.toEqual(swarmSlots(42, 12, SPREAD));
  });

  it('slot k does not depend on any later slot: the 12-cloud starts with the 8-cloud', () => {
    expect(swarmSlots(7, 12, SPREAD).slice(0, 8)).toEqual(swarmSlots(7, 8, SPREAD));
  });

  it('keeps every member inside the 0.75-tile disc at every instant of its wander', () => {
    const off: MemberOffset = { x: 0, z: 0, bob: 0 };
    for (let id = 0; id < 40; id++) {
      const slots = swarmSlots(id, 12, SPREAD);
      for (const s of slots) {
        for (let t = 0; t < 60; t += 0.37) {
          memberOffset(s, t, off);
          expect(Math.hypot(off.x, off.z)).toBeLessThanOrEqual(RADIUS);
        }
      }
    }
  });

  it('keeps the homes at least 0.18 tile apart, on every one of 60 entities', () => {
    for (let id = 0; id < 60; id++) {
      const slots = swarmSlots(id, 12, SPREAD);
      for (let a = 0; a < slots.length; a++) {
        for (let b = a + 1; b < slots.length; b++) {
          const d = Math.hypot(slots[a].homeX - slots[b].homeX, slots[a].homeZ - slots[b].homeZ);
          expect(d, `entity ${id} slots ${a},${b}`).toBeGreaterThanOrEqual(SWARM_SLOT_MIN_SEP_TILES - 1e-9);
        }
      }
    }
  });

  it('spreads the members over the disc rather than piling them at the centre', () => {
    let far = 0;
    let total = 0;
    for (let id = 0; id < 30; id++) {
      for (const s of swarmSlots(id, 12, SPREAD)) {
        total++;
        if (Math.hypot(s.homeX, s.homeZ) > RADIUS / 2) far++;
      }
    }
    // Uniform over a disc puts 75% of members beyond half the radius.
    expect(far / total).toBeGreaterThan(0.6);
  });

  it('a frozen sim time repeats exactly, and the wander actually moves with time', () => {
    const s = swarmSlots(3, 12, SPREAD)[5];
    const a: MemberOffset = { x: 0, z: 0, bob: 0 };
    const b: MemberOffset = { x: 0, z: 0, bob: 0 };
    memberOffset(s, 12.345, a);
    memberOffset(s, 12.345, b);
    expect(a).toEqual(b);
    memberOffset(s, 13.9, b);
    expect(b.x === a.x && b.z === a.z).toBe(false);
    expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(2 * SWARM_WANDER_TILES);
  });

  it('varies height and yaw per member, inside the authored jitter', () => {
    const slots = swarmSlots(9, 12, SPREAD);
    expect(new Set(slots.map((s) => s.liftMul)).size).toBeGreaterThan(8);
    for (const s of slots) {
      expect(s.liftMul).toBeGreaterThanOrEqual(0.75);
      expect(s.liftMul).toBeLessThanOrEqual(1.25);
      expect(Math.abs(s.yawJitter)).toBeLessThanOrEqual((25 * Math.PI) / 180 + 1e-12);
    }
  });
});

describe('the exit rule: the highest slots leave first', () => {
  it('draws slots 0 .. live-1, clamped to what the entity has', () => {
    expect(liveSlotCount(12, 12)).toBe(12);
    expect(liveSlotCount(7, 12)).toBe(7);
    expect(liveSlotCount(0, 12)).toBe(0);
    expect(liveSlotCount(-1, 12)).toBe(0);
    expect(liveSlotCount(99, 12)).toBe(12);
  });

  it('a drop from 12 to 9 sends slots 11, 10, 9 out, in that order, and keeps 0..8', () => {
    const exits = planExits(12, 9, 0);
    expect(exits.map((e) => e.slot)).toEqual([11, 10, 9]);
    expect(exits.every((e) => e.kind === 'fall')).toBe(true);
  });

  it('the first `dives` exits are the divers, taken from the top', () => {
    expect(planExits(12, 11, 1)).toEqual([{ slot: 11, kind: 'dive' }]);
    expect(planExits(12, 8, 2)).toEqual([
      { slot: 11, kind: 'dive' },
      { slot: 10, kind: 'dive' },
      { slot: 9, kind: 'fall' },
      { slot: 8, kind: 'fall' },
    ]);
  });

  it('a dive request with no exit plans nothing, and a rising count plans nothing', () => {
    expect(planExits(5, 5, 3)).toEqual([]);
    expect(planExits(5, 8, 0)).toEqual([]);
  });

  it('a whole swarm going at once exits every slot', () => {
    expect(planExits(3, 0, 0).map((e) => e.slot)).toEqual([2, 1, 0]);
  });
});

describe('the dive', () => {
  const REQ: DiveRequest = {
    tick: 100, target: 4, structure: -1, toX: 10, toZ: 12, willHit: true, simDistTiles: 1.2, showImpact: true,
  };

  it('flies for the sim\'s own heat flight time and resolves on the sim\'s own tick', () => {
    const f = diveFlight(3, REQ, 9.5, 12, 0.36, 0);
    expect(f.duration).toBe(missileDurationS(WEAPON_CLASS.heat, 1.2));
    expect(f.resolveTick).toBe(missileResolveTick(WEAPON_CLASS.heat, 1.2, 100));
    // heat is 10 tiles/s: a 1.2-tile dive is 3 ticks in the air, resolving 2 after the shot.
    expect(f.duration).toBeCloseTo(0.1, 9);
    expect(f.resolveTick).toBe(102);
  });

  it('lands only once the flight is over AND the sim has resolved the round', () => {
    const f = diveFlight(3, REQ, 9.5, 12, 0.36, 0);
    expect(diveHasLanded(f, 0.05, 200)).toBe(false);
    expect(diveHasLanded(f, 0.1, f.resolveTick)).toBe(false); // the tick has not FINISHED
    expect(diveHasLanded(f, 0.1, f.resolveTick + 1)).toBe(true);
    expect(diveHasLanded(f, 0.04, f.resolveTick + 1)).toBe(false);
  });

  it('rides from the member\'s own position to the impact point, nose-down and low at the end', () => {
    const f = diveFlight(3, REQ, 9.5, 12.4, 0.36, 0.2);
    const p = { x: 0, y: 0, z: 0, pitch: 0 };
    divePose(f, 0, p);
    expect([p.x, p.z, p.y]).toEqual([9.5, 12.4, 0.36]);
    expect(p.pitch).toBeCloseTo(0, 12);
    divePose(f, f.duration, p);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.z).toBeCloseTo(12, 9);
    expect(p.y).toBeCloseTo(0.2 + 0.04, 9);
    // 60 degrees nose-down, reached over the first 120 ms (the flight is shorter, so part-way).
    expect(p.pitch).toBeCloseTo(-SWARM_DIVE_PITCH_RAD * (f.duration / SWARM_DIVE_PITCH_S), 9);
    divePose(f, 5, p);
    expect(p.pitch).toBeCloseTo(-SWARM_DIVE_PITCH_RAD, 12);
  });

  it('a miss lands past the target and to one side, the same way on every replay', () => {
    const miss = { ...REQ, willHit: false };
    const a = diveFlight(3, miss, 9, 12, 0.36, 0);
    const b = diveFlight(3, miss, 9, 12, 0.36, 0);
    expect(a).toEqual(b);
    expect(a.miss).toBe(true);
    expect(Math.hypot(a.toX - REQ.toX, a.toZ - REQ.toZ)).toBeGreaterThan(0.5);
  });

  it('faces along its flight in the mesh convention (+X forward, yaw = -heading)', () => {
    const f = diveFlight(3, { ...REQ, toX: 5, toZ: 5 }, 5, 3, 0.36, 0); // due +Z (game y) from the member
    expect(f.yaw).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe('the fall', () => {
  it('lands exactly when the tumble ends, accelerating, and never goes below the ground', () => {
    expect(fallHeight(0.36, 0)).toBe(0.36);
    expect(fallHeight(0.36, SWARM_TUMBLE_S)).toBe(0);
    expect(fallHeight(0.36, SWARM_TUMBLE_S * 3)).toBe(0);
    expect(fallHeight(0.36, SWARM_TUMBLE_S / 2)).toBeCloseTo(0.27, 9); // free fall: a quarter down at half time
  });

  it('eases onto the rest pose over the last of the fall only', () => {
    expect(settleBlend(0)).toBe(0);
    expect(settleBlend(SWARM_TUMBLE_S * 0.7)).toBe(0);
    expect(settleBlend(SWARM_TUMBLE_S * 0.85)).toBeCloseTo(0.5, 9);
    expect(settleBlend(SWARM_TUMBLE_S)).toBe(1);
  });

  it('spins about a hashed unit axis that differs by member', () => {
    const a = tumbleAxis(5, 3);
    expect(Math.hypot(...a)).toBeCloseTo(1, 9);
    expect(tumbleAxis(5, 3)).toEqual(a);
    expect(tumbleAxis(5, 4)).not.toEqual(a);
  });
});

describe('SwarmWreckRing', () => {
  it('holds at most its cap and evicts the OLDEST first', () => {
    const ring = new SwarmWreckRing(3);
    for (let i = 0; i < 5; i++) ring.push({ x: i, z: 0, yaw: 0, roll: 0, side: 1 });
    expect(ring.length).toBe(3);
    expect(ring.items.map((w) => w.x)).toEqual([2, 3, 4]);
  });
});
