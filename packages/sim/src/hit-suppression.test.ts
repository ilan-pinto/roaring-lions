import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

// What a hit, a non-penetrating hit (a bounce) and a splash actually add to
// the suppression of the unit they land on (GDD 5.5).
//
// BOUNCE_SUPP_MULT is "this many times harder than a near miss" (tuning.ts),
// and it was a plain 2 handed to fx.mul -- 2/65536, not x2 -- from the first
// sim commit (790f4ba9) until this test. Every one of those three paths, and
// the kamikaze and tunnel-collapse splashes that share splashDirect, added
// effectively nothing; only near misses suppressed.
//
// The oracle is literal decimals and floating point, never a constant read
// from the code under test (CLAUDE.md, "Every check gets an input that makes
// it fail"): weapon suppression 70 / SUPP_STAT_DIVISOR 730 = 0.0959 per near
// miss; a default suppression_resistance of 0.5 lets 0.75 of it through; open
// ground (cover 0) lets all of it through. So a near miss adds 0.0719 and
// anything doubled adds 0.1438. The gain on a tick is read back through that
// tick's decay, e^(-0.15 * 0.05) = 0.99253.

const DECAY = 0.99253;
const NEAR_MISS = (70 / 730) * 0.75;
const DOUBLED = 2 * NEAR_MISS;

function weapon(type: string, penetration: number, splash = 0) {
  return {
    id: `w_${type}`,
    type,
    range_tiles: 10,
    effective_range_tiles: 10,
    accuracy: 0.5,
    penetration,
    damage: 1,
    suppression: 70,
    rof_per_min: 60,
    ...(splash > 0 ? { splash_tiles: splash } : {}),
  };
}

/** Hitscan, no splash: every round resolves on the tick it is fired. */
const RIFLE: UnitTypeJson = {
  id: 'hs_rifle',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1 },
  weapons: [weapon('small_arms', 8)],
};
/** The same round with the penetration to threaten HULL, so half its hits
 *  get through and half bounce off a plate they could have beaten. */
const AP_RIFLE: UnitTypeJson = { ...RIFLE, id: 'hs_ap_rifle', weapons: [weapon('small_arms', 300)] };
/** Hitscan and a 2-tile blast: the splash lands the tick the round does. */
const BLASTER: UnitTypeJson = { ...RIFLE, id: 'hs_blaster', weapons: [weapon('autocannon', 8, 2)] };
/** Soft, unarmed, too deep to die: the rifle's target. */
const SOFT: UnitTypeJson = {
  id: 'hs_soft',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1.0, sight_tiles: 1, signature: 1 },
};
/** Armour exactly as thick as AP_RIFLE's penetration: P(pen) = 0.5. */
const HULL: UnitTypeJson = {
  ...SOFT,
  id: 'hs_hull',
  hull: { hp: 30000, armor: { front: 300, side: 300, rear: 300 } },
};

/** A rifle round against MBT armour: it can never penetrate. */
const MBT_HULL: UnitTypeJson = {
  ...SOFT,
  id: 'hs_mbt_hull',
  hull: { hp: 30000, armor: { front: 700, side: 700, rear: 700 } },
};
/** Fire for up to 60 s and return, for every tick on which the shooter fired,
 *  whether the round hit and what each watched unit gained that tick. */
function gains(
  shooterType: UnitTypeJson,
  targetType: UnitTypeJson,
  bystander: boolean,
): { hit: boolean; bounced: boolean; target: number; bystander: number }[] {
  const sim = new Sim({ seed: 7, width: 24, height: 12, capacity: 8 });
  const shooter = sim.spawn(sim.addUnitType(shooterType), 0, fx.from(4.5), fx.from(5.5));
  const tt = sim.addUnitType(targetType);
  const target = sim.spawn(tt, 1, fx.from(10.5), fx.from(5.5));
  // One tile beyond the target, inside the blast and outside the target's own
  // cell: further away, so the shooter never picks it.
  const by = bystander ? sim.spawn(sim.addUnitType(SOFT), 1, fx.from(11.5), fx.from(5.5)) : -1;
  const out: { hit: boolean; bounced: boolean; target: number; bystander: number }[] = [];
  for (let t = 0; t < 60 * 20; t++) {
    const s0 = fx.toNumber(sim.state.suppression[target]);
    const b0 = by >= 0 ? fx.toNumber(sim.state.suppression[by]) : 0;
    const evs = sim.tick();
    const shot = evs.find((e) => e.kind === 'fire' && e.shooter === shooter);
    if (shot === undefined || shot.kind !== 'fire') continue;
    const s1 = fx.toNumber(sim.state.suppression[target]);
    const b1 = by >= 0 ? fx.toNumber(sim.state.suppression[by]) : 0;
    const bounced = evs.some((e) => e.kind === 'impact' && e.target === target && !e.penetrated);
    out.push({ hit: shot.willHit, bounced, target: s1 / DECAY - s0, bystander: b1 / DECAY - b0 });
  }
  return out;
}

describe('hits, bounces and splash suppress (GDD 5.5, BOUNCE_SUPP_MULT)', () => {
  it('a rifle hit on soft target adds twice a near miss', () => {
    const shots = gains(RIFLE, SOFT, false);
    const hits = shots.filter((s) => s.hit);
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) expect(h.target).toBeCloseTo(DOUBLED, 3);
  });

  // A round that COULD have penetrated and did not. One that never could is
  // the next test.
  it('a round that bounces off the hull shakes the crew twice a near miss', () => {
    const shots = gains(AP_RIFLE, HULL, false);
    const bounces = shots.filter((s) => s.hit && s.bounced);
    expect(bounces.length).toBeGreaterThan(3);
    for (const b of bounces) expect(b.target).toBeCloseTo(DOUBLED, 3);
  });

  // The lead's ruling of 2026-10-13: a round that could never penetrate the
  // hull (a rifle on an MBT) is noise, not a threat. Its bounce takes the
  // same HARMLESS_SUPP discount (0.1) its near misses always took, so a rifle
  // squad cannot pin a tank or a dozer by ringing its hull: 0.1438 x 0.1.
  it('a round that could never penetrate the hull bounces off harmlessly', () => {
    const shots = gains(RIFLE, MBT_HULL, false);
    const bounces = shots.filter((s) => s.hit && s.bounced);
    expect(bounces.length).toBeGreaterThan(3);
    for (const b of bounces) expect(b.target).toBeCloseTo(DOUBLED * 0.1, 3);
  });

  it('a blast adds twice a near miss to a soft unit beside the one it hit', () => {
    const shots = gains(BLASTER, SOFT, true);
    const hits = shots.filter((s) => s.hit);
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) {
      expect(h.target).toBeCloseTo(DOUBLED, 3);
      expect(h.bystander).toBeCloseTo(DOUBLED, 3);
    }
  });

  // Control: the instrument reads a plain near miss at 1x. A miss scatters
  // 0.5-1.5 tiles, and only a round landing inside 1.2 tiles is a near miss,
  // so the gain on a miss is either 0.0719 or 0 -- never anything else.
  it('control: a rifle miss beside a soft target adds one near miss or nothing', () => {
    const shots = gains(RIFLE, SOFT, false);
    const misses = shots.filter((s) => !s.hit);
    expect(misses.some((m) => Math.abs(m.target - NEAR_MISS) < 0.0005)).toBe(true);
    for (const m of misses) {
      const near = Math.abs(m.target - NEAR_MISS) < 0.0005;
      const none = Math.abs(m.target) < 0.0005;
      expect(near || none).toBe(true);
    }
  });
});
