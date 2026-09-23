import { describe, expect, it } from 'vitest';
import {
  MAX_DRAWN_OFFSET_TILES,
  MAX_LAG_TILES,
  hullCornerOffsets,
  makeVehicleWeightArrays,
  stepVehicleWeight,
  terrainPitchRad,
  terrainRollRad,
} from './vehicle-weight';
import type { VehicleWeightInput, VehicleWeightParams } from './vehicle-weight';

describe('the four footprint corners', () => {
  // Facing 0 turns is +X in game space (`fx.atan2` of the movement delta, and
  // `meshYawFromFacing`'s own -2*PI*facing maps it onto the mesh's +X-forward
  // rest pose). So at facing 0 "front" is +X and "left"/"right" are +/-Y.
  it('puts the front ahead and the flanks abeam at facing 0', () => {
    const c = hullCornerOffsets(0, 0.6, 0.25);
    expect(c.frontX).toBeCloseTo(0.6, 6);
    expect(c.frontY).toBeCloseTo(0, 6);
    expect(c.rearX).toBeCloseTo(-0.6, 6);
    expect(Math.abs(c.leftY)).toBeCloseTo(0.25, 6);
    expect(c.leftY).toBeCloseTo(-c.rightY, 6);
  });

  it('rotates the whole footprint with the hull', () => {
    const c = hullCornerOffsets(0.25, 0.6, 0.25); // a quarter turn
    expect(c.frontX).toBeCloseTo(0, 6);
    expect(Math.abs(c.frontY)).toBeCloseTo(0.6, 6);
  });

  // Symmetry at EVERY heading, not only the two convenient ones -- an offset
  // table that is right at the axes and skewed in between is the shape a
  // transposed sin/cos produces, and it looks plausible in a screenshot.
  it('keeps front/rear and left/right symmetric about the centre at every heading', () => {
    for (let t = 0; t < 1; t += 1 / 16) {
      const c = hullCornerOffsets(t, 0.6, 0.25);
      expect(c.frontX).toBeCloseTo(-c.rearX, 6);
      expect(c.frontY).toBeCloseTo(-c.rearY, 6);
      expect(c.leftX).toBeCloseTo(-c.rightX, 6);
      expect(c.leftY).toBeCloseTo(-c.rightY, 6);
      // The flank axis is perpendicular to the forward axis, always.
      expect(c.frontX * c.leftX + c.frontY * c.leftY).toBeCloseTo(0, 6);
    }
  });
});

describe('terrain pitch and roll', () => {
  // THE golden-gate pin (R-G). beit_sahwan_outskirts and tutorial_ground carry
  // no elevation grid at all, so all four samples are equal there and this must
  // be exactly 0 -- not 1e-17, not "close to". A parked vehicle on a flat map
  // draws where it always drew, and the `vehicle` baseline cannot move.
  it('is exactly zero when the four samples agree', () => {
    expect(terrainPitchRad(3, 3, 1.2)).toBe(0);
    expect(terrainRollRad(3, 3, 0.5)).toBe(0);
    expect(terrainPitchRad(0, 0, 1.2)).toBe(0);
  });

  // Positive pitch is NOSE-UP, matching MESH_HULL_PITCH_RAD's own sign (the
  // recoil rocks a tank back onto its rear road wheels). Ground rising ahead
  // therefore reads positive.
  it('points the nose up when the ground ahead is higher', () => {
    expect(terrainPitchRad(1, 0, 1.2)).toBeGreaterThan(0);
    expect(terrainPitchRad(0, 1, 1.2)).toBeLessThan(0);
  });

  // Positive roll drops the RIGHT side, so ground falling away to the right
  // reads positive. Stated here because the sign is otherwise a coin flip and
  // a coin flip looks fine on a screenshot of a symmetric hull.
  it('drops the downhill side', () => {
    expect(terrainRollRad(1, 0, 0.5)).toBeGreaterThan(0);
    expect(terrainRollRad(0, 1, 0.5)).toBeLessThan(0);
  });

  // The angle is atan(delta / span), so a LONGER vehicle tilts LESS on the
  // same step in the ground -- which is the physical answer and the reason the
  // span is a parameter rather than a constant.
  it('tilts a long hull less than a short one on the same step', () => {
    const short = terrainPitchRad(0.4, 0, 0.8);
    const long = terrainPitchRad(0.4, 0, 1.6);
    expect(long).toBeLessThan(short);
    expect(long).toBeCloseTo(Math.atan2(0.4, 1.6), 6);
  });

  // A one-level step is 10 px of elevation (E1) and the biggest thing the
  // shipped maps contain; nothing should ever return a right angle.
  it('stays inside a quarter turn for any input', () => {
    expect(Math.abs(terrainPitchRad(50, -50, 0.1))).toBeLessThan(Math.PI / 2);
  });
});

// ===========================================================================
// Task 3 -- the dynamic weight, and the bound it may not cross
// ===========================================================================

const DEG = Math.PI / 180;

const HEAVY: VehicleWeightParams = {
  // 2 degrees -- the issue's own figure (R-M). The brief wrote this as
  // (2 * Math.PI) / 360, which is ONE degree under a comment saying two.
  maxPitchRad: 2 * DEG,
  maxRollRad: 1.5 * DEG,
  accelSeconds: 0.35,
  settleSeconds: 0.5,
  settleDamping: 0.6,
  lagTiles: 0.06,
};

function at(over: Partial<VehicleWeightInput> = {}): VehicleWeightInput {
  return {
    entityId: 0,
    speedTilesS: 0,
    cruiseTilesS: 1.1, // mbt_lavi
    headingTurns: 0,
    turnRateTurnsS: 60 / 360, // mbt_lavi's authored turn_rate_deg_s
    trueX: 10,
    trueY: 10,
    dtSeconds: 1 / 60,
    params: HEAVY,
    ...over,
  };
}

describe('a vehicle the sim reports stationary draws exactly where it stands', () => {
  // R-G, and the single most load-bearing assertion in this package. The golden
  // `vehicle` scenario is beit_sahwan_outskirts at tick 140 with the sandbox
  // force PARKED and no orders. If this returns anything but the identity, that
  // baseline moves and the run goes red for a reason nobody will find quickly.
  it('is the identity transform at rest, and stays there', () => {
    const a = makeVehicleWeightArrays(4);
    let out = stepVehicleWeight(a, at());
    for (let i = 0; i < 600; i++) out = stepVehicleWeight(a, at());
    expect(out.drawX).toBe(10);
    expect(out.drawY).toBe(10);
    expect(out.pitchRad).toBe(0);
    expect(out.rollRad).toBe(0);
  });

  it("is the identity on an entity's very first frame, not after it has settled", () => {
    const a = makeVehicleWeightArrays(4);
    const out = stepVehicleWeight(a, at({ entityId: 3 }));
    expect(out.drawX).toBe(10);
    expect(out.pitchRad).toBe(0);
  });

  // The same pin away from the origin and off the east axis: every term that
  // multiplies by a heading or adds to a position has to come out exactly
  // zero here, not merely small.
  it('is the identity at rest at any heading and position', () => {
    const a = makeVehicleWeightArrays(4);
    const parked = { entityId: 1, headingTurns: 0.37, trueX: 23.5, trueY: 7.25 };
    for (let i = 0; i < 600; i++) {
      const out = stepVehicleWeight(a, at(parked));
      expect(out.drawX).toBe(23.5);
      expect(out.drawY).toBe(7.25);
      expect(out.pitchRad).toBe(0);
      expect(out.rollRad).toBe(0);
    }
  });

  // A parked tank still TURNS: `aimHullAt` swings a stationary hull onto its
  // target at the full `turnPerTick`. Lateral acceleration is speed x yaw
  // rate, and a hull pivoting in place has none -- leaning it would move the
  // drawn pose of a vehicle the sim reports stationary.
  it('does not lean a hull that pivots in place', () => {
    const a = makeVehicleWeightArrays(1);
    const perFrame = 60 / 360 / 60;
    let h = 0.2;
    for (let i = 0; i < 120; i++) {
      h = (h + perFrame) % 1;
      const out = stepVehicleWeight(a, at({ headingTurns: h }));
      expect(out.rollRad).toBe(0);
      expect(out.pitchRad).toBe(0);
      expect(out.drawX).toBe(10);
    }
  });

  // R-G for a vehicle that HAS moved: rest is exact, not asymptotic. "A filter
  // that never settles to zero" is one of the spec's named ways to move the
  // `vehicle` baseline, and an exponential tail is exactly that filter.
  it('comes back to the exact identity after moving, turning and stopping', () => {
    const a = makeVehicleWeightArrays(1);
    let h = 0;
    for (let i = 0; i < 90; i++) {
      h = (h + 0.002) % 1;
      stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: h }));
    }
    let out = stepVehicleWeight(a, at({ headingTurns: h }));
    for (let i = 0; i < 600; i++) out = stepVehicleWeight(a, at({ headingTurns: h }));
    expect(out.drawX).toBe(10);
    expect(out.drawY).toBe(10);
    expect(out.pitchRad).toBe(0);
    expect(out.rollRad).toBe(0);
    expect(a.smoothedSpeed[0]).toBe(0);
    expect(a.settle[0]).toBe(0);
    expect(a.settleVel[0]).toBe(0);
  });
});

describe('the seeded companion (R-N)', () => {
  // Every per-entity array in ThreeRenderer carries one -- turretSeeded,
  // animSeeded, vehicleTrackSeeded -- because a reinforcement spawning
  // mid-mission would otherwise start from the Float64Array zero-fill and read
  // as a vehicle that materialised at full speed.
  it('seeds an entity to its own current speed rather than to zero', () => {
    const a = makeVehicleWeightArrays(4);
    stepVehicleWeight(a, at({ entityId: 2, speedTilesS: 1.1 }));
    expect(a.seeded[2]).toBe(1);
    expect(a.smoothedSpeed[2]).toBeCloseTo(1.1, 6);
    // ... and therefore no launch pitch on the frame it appears.
    const out = stepVehicleWeight(a, at({ entityId: 2, speedTilesS: 1.1 }));
    expect(Math.abs(out.pitchRad)).toBeLessThan(1e-9);
  });

  it('leaves a neighbouring slot alone', () => {
    const a = makeVehicleWeightArrays(4);
    stepVehicleWeight(a, at({ entityId: 2, speedTilesS: 1.1 }));
    expect(a.seeded[1]).toBe(0);
    expect(a.smoothedSpeed[1]).toBe(0);
  });

  // The seed frame is the identity for a MOVING vehicle too, and the lag then
  // grows in rather than popping in a lag-length behind on frame two.
  it('draws a vehicle first seen moving where it stands, then grows its lag', () => {
    const a = makeVehicleWeightArrays(1);
    const first = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    expect(first.drawX).toBe(10);
    expect(first.drawY).toBe(10);
    const second = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    expect(Math.hypot(second.drawX - 10, second.drawY - 10)).toBeLessThan(HEAVY.lagTiles * 0.1);
    let out = second;
    for (let i = 0; i < 120; i++) out = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    expect(Math.hypot(out.drawX - 10, out.drawY - 10)).toBeGreaterThan(HEAVY.lagTiles * 0.9);
  });

  // A seed that forgot the heading -- the Float64Array zero-fill IS heading 0
  // -- would read a reinforcement driving in at any other heading as a hull
  // slewing round at full rate, and lean it hard on its way onto the map.
  it('does not lean a vehicle first seen moving at a heading it already holds', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 60; i++) {
      const out = stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: 0.37 }));
      expect(out.rollRad).toBe(0);
    }
  });

  // A spawn's first snapshot reads the jump from the zero-filled slot to its
  // spawn tile as a speed (`snapshot()`: prevX is 0 for a new id), hundreds of
  // tiles a second for one tick. The sim never moves a unit faster than its
  // own `stepPerTick` -- rout and pin only ever slow it -- so that sample is a
  // discontinuity, not motion, and a parked reinforcement must not nose-dive
  // for the two seconds it would take to "brake" from 600 tiles/s.
  it('does not read a spawn or a teleport as motion', () => {
    const a = makeVehicleWeightArrays(2);
    stepVehicleWeight(a, at({ speedTilesS: 600 }));
    for (let i = 0; i < 120; i++) {
      const out = stepVehicleWeight(a, at());
      expect(out.pitchRad).toBe(0);
      expect(out.drawX).toBe(10);
    }
    // Mid-life: three frames of phantom speed on a cruising vehicle change
    // nothing it draws.
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ entityId: 1, speedTilesS: 1.1 }));
    const before = stepVehicleWeight(a, at({ entityId: 1, speedTilesS: 1.1 })).pitchRad;
    for (let i = 0; i < 3; i++) {
      expect(stepVehicleWeight(a, at({ entityId: 1, speedTilesS: 600 })).pitchRad).toBe(before);
    }
  });
});

describe('pitch under acceleration (R-M)', () => {
  // The sim jumps 0 -> cruise in one tick. If the model passed that through,
  // the pitch would be one spike on one frame and nothing after it -- which is
  // the defect, not the feature.
  it('does not spike on the frame the step arrives', () => {
    const a = makeVehicleWeightArrays(1);
    stepVehicleWeight(a, at({ speedTilesS: 0 }));
    const first = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    expect(Math.abs(first.pitchRad)).toBeLessThan(HEAVY.maxPitchRad);
  });

  it('ramps to the authored maximum over the launch and returns to zero at cruise', () => {
    const a = makeVehicleWeightArrays(1);
    stepVehicleWeight(a, at({ speedTilesS: 0 }));
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      const out = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
      peak = Math.max(peak, Math.abs(out.pitchRad));
    }
    expect(peak).toBeGreaterThan(HEAVY.maxPitchRad * 0.5);
    expect(peak).toBeLessThanOrEqual(HEAVY.maxPitchRad + 1e-9);
    // Held at cruise for another second: the acceleration is over, so is the pitch.
    let last = 0;
    for (let i = 0; i < 60; i++) last = stepVehicleWeight(a, at({ speedTilesS: 1.1 })).pitchRad;
    expect(Math.abs(last)).toBeLessThan(HEAVY.maxPitchRad * 0.05);
  });

  // Braking is the opposite sign: the nose goes DOWN. Asserted because it is
  // the half a one-directional implementation silently drops.
  it('pitches the other way under braking', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    const launch = (() => {
      const b = makeVehicleWeightArrays(1);
      stepVehicleWeight(b, at({ speedTilesS: 0 }));
      return stepVehicleWeight(b, at({ speedTilesS: 1.1 })).pitchRad;
    })();
    const brake = stepVehicleWeight(a, at({ speedTilesS: 0 })).pitchRad;
    expect(Math.sign(brake)).toBe(-Math.sign(launch));
  });

  // The absolute sign, which the test above cannot see: it passes just as well
  // with both halves inverted. Positive is NOSE-UP -- Task 2's terrain pitch
  // and MESH_HULL_PITCH_RAD's recoil both read it that way, and Task 6 sums
  // all three into one hull-frame pitch -- so pulling away squats the rear and
  // lifts the nose, and braking dives it.
  it('lifts the nose pulling away and dives it braking', () => {
    const launch = makeVehicleWeightArrays(1);
    stepVehicleWeight(launch, at());
    let up = 0;
    for (let i = 0; i < 15; i++) up = stepVehicleWeight(launch, at({ speedTilesS: 1.1 })).pitchRad;
    expect(up).toBeGreaterThan(HEAVY.maxPitchRad * 0.5);

    const brake = makeVehicleWeightArrays(1);
    stepVehicleWeight(brake, at({ speedTilesS: 1.1 }));
    let down = 0;
    for (let i = 0; i < 15; i++) down = stepVehicleWeight(brake, at()).pitchRad;
    expect(down).toBeLessThan(-HEAVY.maxPitchRad * 0.5);
  });

  // The acceleration signal Task 6 hangs the dust surge on (R-O): the ramp's
  // own acceleration as a fraction of the nominal rate.
  it('reports the acceleration it is drawing', () => {
    const a = makeVehicleWeightArrays(1);
    stepVehicleWeight(a, at());
    expect(stepVehicleWeight(a, at({ speedTilesS: 1.1 })).accelFraction).toBe(1);
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    expect(stepVehicleWeight(a, at({ speedTilesS: 1.1 })).accelFraction).toBe(0);
    expect(stepVehicleWeight(a, at()).accelFraction).toBe(-1);
  });
});

describe("roll from the sim's own rate-limited yaw (R-L)", () => {
  it('is zero when the heading is not changing', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 30; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: 0.3 }));
    expect(stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: 0.3 })).rollRad).toBeCloseTo(0, 9);
  });

  // `turnToward` caps the facing change at turnPerTick, so the fastest a hull
  // can possibly yaw is its own authored rate -- which is exactly where full
  // lean belongs, and why no second constant is needed.
  it("reaches the authored maximum at the unit's own turn rate and no further", () => {
    const a = makeVehicleWeightArrays(1);
    const perFrame = 60 / 360 / 60; // turns per frame at 60 deg/s, 60 fps
    let h = 0;
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      h += perFrame;
      peak = Math.max(peak, Math.abs(stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: h })).rollRad));
    }
    expect(peak).toBeGreaterThan(HEAVY.maxRollRad * 0.8);
    expect(peak).toBeLessThanOrEqual(HEAVY.maxRollRad + 1e-9);
  });

  // The brief titled this "leans INTO the turn". It asserts only that the two
  // turns lean opposite ways; which way is the next test's job.
  it('leans one way for one turn, and the other way for the other', () => {
    const left = makeVehicleWeightArrays(1);
    const right = makeVehicleWeightArrays(1);
    const perFrame = 60 / 360 / 60;
    let l = 0;
    let r = 0;
    let lo = 0;
    let ro = 0;
    for (let i = 0; i < 30; i++) {
      l += perFrame;
      r -= perFrame;
      lo = stepVehicleWeight(left, at({ speedTilesS: 1.1, headingTurns: l })).rollRad;
      ro = stepVehicleWeight(right, at({ speedTilesS: 1.1, headingTurns: r })).rollRad;
    }
    expect(Math.sign(lo)).toBe(-Math.sign(ro));
  });

  // WHICH way, pinned to geometry rather than to a word. A hull's body rolls
  // to the OUTSIDE of a turn -- its mass swings out on its suspension -- and
  // positive roll lowers the corner Task 2's `hullCornerOffsets` calls `right`
  // (the convention `terrainRollRad` returns, so Task 6 can sum the two). An
  // INCREASING heading swings the nose toward (-sin, cos); the outside of that
  // turn is the corner whose offset points away from it.
  it('rolls the body to the outside of the turn', () => {
    const a = makeVehicleWeightArrays(1);
    const perFrame = 60 / 360 / 60;
    let h = 0.1;
    let roll = 0;
    for (let i = 0; i < 30; i++) {
      h += perFrame;
      roll = stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: h })).rollRad;
    }
    const theta = h * Math.PI * 2;
    const inward = { x: -Math.sin(theta), y: Math.cos(theta) };
    const c = hullCornerOffsets(h, 0.6, 0.25);
    // The `right` corner is on the outside of an increasing-heading turn ...
    expect(c.rightX * inward.x + c.rightY * inward.y).toBeLessThan(0);
    // ... and positive roll is the one that lowers it.
    expect(roll).toBeGreaterThan(HEAVY.maxRollRad * 0.5);
  });

  // Facing is 0..1 turns and wraps. A yaw rate computed without wrapping reads
  // a 0.99 -> 0.01 step as a 0.98-turn slew and slams the roll to full lean on
  // a hull that barely moved.
  it('does not slam the lean when the heading wraps past 1', () => {
    const a = makeVehicleWeightArrays(1);
    const perFrame = 60 / 360 / 60;
    let h = 0.99;
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      h = (h + perFrame) % 1;
      peak = Math.max(peak, Math.abs(stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: h })).rollRad));
    }
    expect(peak).toBeLessThanOrEqual(HEAVY.maxRollRad + 1e-9);
  });

  // The test above cannot fail: the roll is clamped, so a slammed lean is
  // still "<= max". What CAN fail is agreement: the same turn taken across the
  // wrap and away from it must lean identically, frame for frame.
  it('leans exactly as much across the wrap as away from it', () => {
    const across = makeVehicleWeightArrays(1);
    const clear = makeVehicleWeightArrays(1);
    const perFrame = 60 / 360 / 60;
    for (let i = 0; i < 90; i++) {
      const hAcross = (0.97 + i * perFrame) % 1;
      const hClear = 0.47 + i * perFrame;
      const x = stepVehicleWeight(across, at({ speedTilesS: 1.1, headingTurns: hAcross })).rollRad;
      const y = stepVehicleWeight(clear, at({ speedTilesS: 1.1, headingTurns: hClear })).rollRad;
      expect(Math.abs(x - y)).toBeLessThan(1e-9);
    }
  });
});

describe('the settle on stop', () => {
  it('overshoots once and returns to rest', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    const trail: number[] = [];
    for (let i = 0; i < 120; i++) trail.push(stepVehicleWeight(a, at({ speedTilesS: 0 })).pitchRad);
    const signs = new Set(trail.filter((p) => Math.abs(p) > 1e-6).map((p) => Math.sign(p)));
    expect(signs.size).toBe(2); // it crossed zero: that is the overshoot
    expect(Math.abs(trail[trail.length - 1])).toBeLessThan(1e-6);
  });
});

// The brief's sweep read `VEHICLE_WEIGHT_ROLE_DEFAULTS` from
// `./vehicle-weight-params`, which is Task 4's file and does not exist yet.
// Until it does, the sweep brackets the legal envelope instead: the schema's
// own ceilings (R-B) -- lag at MAX_LAG_TILES, pitch and roll at 6 degrees --
// with the fastest and the most underdamped settle it is sane to author, plus
// the heavy and a light set. Task 4 appends its role defaults and mass classes
// to SWEPT; an envelope that holds at its ceiling holds for every table inside
// it, and Task 4's own lag-budget test is what keeps its tables inside.
const CEILING: VehicleWeightParams = {
  maxPitchRad: 6 * DEG,
  maxRollRad: 6 * DEG,
  accelSeconds: 0.05,
  settleSeconds: 0.1,
  settleDamping: 0.2,
  lagTiles: MAX_LAG_TILES,
};
const LIGHT: VehicleWeightParams = {
  maxPitchRad: 0.5 * DEG,
  maxRollRad: 1 * DEG,
  accelSeconds: 0.15,
  settleSeconds: 0.25,
  settleDamping: 1.4,
  lagTiles: 0.02,
};
const SWEPT: VehicleWeightParams[] = [HEAVY, CEILING, LIGHT];

describe('the drawn hull never trails the sim by more than a quarter tile (R-C, R-K)', () => {
  const MESH_HULL_RECOIL_TILES = 0.16; // ThreeRenderer.ts:432 -- the other writer

  // A sweep, not a sample. A bound checked at one speed with one parameter set
  // is a bound that holds for that speed and that parameter set.
  it('holds across every swept parameter set and the whole speed range', () => {
    for (const params of SWEPT) {
      for (const speed of [0, 0.25, 0.5, 1.1, 1.8, 2.6, 3.4]) {
        const a = makeVehicleWeightArrays(1);
        let worst = 0;
        let h = 0;
        for (let i = 0; i < 300; i++) {
          h = (h + 0.01) % 1;
          const out = stepVehicleWeight(
            a,
            at({ speedTilesS: speed, headingTurns: h, cruiseTilesS: speed || 1, params })
          );
          worst = Math.max(worst, Math.hypot(out.drawX - 10, out.drawY - 10));
        }
        expect(worst + MESH_HULL_RECOIL_TILES).toBeLessThanOrEqual(MAX_DRAWN_OFFSET_TILES + 1e-9);
      }
    }
  });

  it('leaves the budget the recoil already spends', () => {
    expect(MAX_LAG_TILES).toBeCloseTo(MAX_DRAWN_OFFSET_TILES - MESH_HULL_RECOIL_TILES, 9);
  });

  // R-C's second half, and the one a lag filter gets wrong by default: a
  // filter that is merely CONVERGING toward the true position is still offset
  // from it, so "the sim says stationary" has to be an explicit case. (The
  // brief drove this at 2.6 tiles/s on a 1.1 cruise -- a Lavi at over twice
  // its own top speed, which the model reads as a teleport and never lags --
  // so it now names a 2.6 cruise and proves there was a lag to remove.)
  it('is exactly zero offset the moment the sim reports the unit stationary', () => {
    const a = makeVehicleWeightArrays(1);
    let moving = stepVehicleWeight(a, at({ speedTilesS: 2.6, cruiseTilesS: 2.6, trueX: 10 }));
    for (let i = 1; i < 60; i++) {
      moving = stepVehicleWeight(a, at({ speedTilesS: 2.6, cruiseTilesS: 2.6, trueX: 10 + i * 0.04 }));
    }
    expect(Math.hypot(moving.drawX - (10 + 59 * 0.04), moving.drawY - 10)).toBeGreaterThan(0.03);
    const out = stepVehicleWeight(a, at({ speedTilesS: 0, cruiseTilesS: 2.6, trueX: 12 }));
    expect(out.drawX).toBe(12);
    expect(out.drawY).toBe(10);
  });

  // A slot re-used by a unit with a shorter lag inherits the longer one in its
  // state. The clamp must apply on the very next frame -- including a frozen
  // one, where nothing else in the function moves.
  it('clamps an inherited lag to the new parameters on the next frame, frozen or not', () => {
    for (const dtSeconds of [0, 1 / 60]) {
      const a = makeVehicleWeightArrays(1);
      for (let i = 0; i < 120; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1, params: CEILING }));
      const out = stepVehicleWeight(a, at({ speedTilesS: 1.1, params: LIGHT, dtSeconds }));
      expect(Math.hypot(out.drawX - 10, out.drawY - 10)).toBeLessThanOrEqual(LIGHT.lagTiles + 1e-12);
    }
  });

  // The adversarial half. Everything the renderer can hand this function on a
  // bad day, in a seeded random order: a spawn's phantom speed, NaN and
  // Infinity in every field, negative speeds, a frozen clock, a five-second
  // frame, headings far outside 0..1, an entity slot re-used by a unit with
  // different parameters, a stop and start at the spring's own resonance.
  // Every frame: pitch and roll finite and inside the params they were drawn
  // with, the offset inside `lagTiles`, exactly zero when the sim says
  // stationary, and no state left non-finite for the next frame to inherit.
  it('holds against an adversarial input sequence', () => {
    let seed = 0x9e3779b9;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const PARAMS: VehicleWeightParams[] = [
      HEAVY,
      CEILING,
      LIGHT,
      { ...HEAVY, settleDamping: 1 }, // exactly critical
      { ...LIGHT, settleDamping: 4, settleSeconds: 2 }, // heavily overdamped
    ];
    const a = makeVehicleWeightArrays(4);
    let params = HEAVY;
    let heading = 0;
    // Violations are collected rather than asserted one by one -- 20,000
    // frames x thirty `expect` calls is seconds of test time for no signal.
    const bad: string[] = [];
    const check = (ok: boolean, what: string, frame: number): void => {
      if (!ok && bad.length < 10) bad.push(`frame ${frame}: ${what}`);
    };
    for (let frame = 0; frame < 20000; frame++) {
      if (rand() < 0.02) params = pick(PARAMS);
      if (rand() < 0.005) a.seeded[Math.floor(rand() * 4)] = 0; // slot re-used
      const cruise = rand() < 0.02 ? pick([0, -1, NaN, Infinity]) : pick([0.5, 1.1, 2.6]);
      const phase = frame % 40;
      // Stop/start at roughly the spring's own period, most of the time.
      const speed =
        rand() < 0.15
          ? pick([NaN, -3, 600, Infinity, 1e-300, 1.4 * 1.1, -0, 1e300])
          : phase < 20
            ? 0
            : pick([0.5, 1.1, 2.6]);
      heading =
        rand() < 0.05
          ? pick([NaN, Infinity, -Infinity, -7.3, 12.9, heading + 0.5])
          : heading + (rand() - 0.5) * 0.02;
      const dt = rand() < 0.1 ? pick([0, 0, 0, 5, NaN, -1, 1e-9, 0.1, Infinity]) : pick([1 / 60, 1 / 30, 0.013]);
      const trueX = rand() < 0.02 ? pick([NaN, 1e6, -1e6]) : 10 + rand();
      const trueY = rand() < 0.02 ? pick([NaN, 1e6, -1e6]) : 10 + rand();
      const entityId = rand() < 0.02 ? pick([-1, 4, 1.5, NaN]) : Math.floor(rand() * 4);
      const turnRate = rand() < 0.02 ? pick([0, -1, NaN, Infinity]) : 60 / 360;
      const input = at({
        entityId,
        speedTilesS: speed,
        cruiseTilesS: cruise,
        headingTurns: heading,
        turnRateTurnsS: turnRate,
        trueX,
        trueY,
        dtSeconds: dt,
        params,
      });
      const out = stepVehicleWeight(a, input);
      check(Number.isFinite(out.pitchRad) && Number.isFinite(out.rollRad), 'pitch/roll not finite', frame);
      check(Math.abs(out.pitchRad) <= params.maxPitchRad + 1e-12, `pitch ${out.pitchRad}`, frame);
      check(Math.abs(out.rollRad) <= params.maxRollRad + 1e-12, `roll ${out.rollRad}`, frame);
      if (Number.isFinite(trueX) && Number.isFinite(trueY)) {
        const off = Math.hypot(out.drawX - trueX, out.drawY - trueY);
        check(Number.isFinite(off) && off <= params.lagTiles + 1e-12, `offset ${off}`, frame);
        if (speed === 0) check(out.drawX === trueX && out.drawY === trueY, 'offset at rest', frame);
      }
      for (let i = 0; i < 4; i++) {
        const sum = a.smoothedSpeed[i] + a.smoothedHeading[i] + a.lagX[i] + a.lagY[i] + a.settle[i] + a.settleVel[i];
        check(Number.isFinite(sum), `slot ${i} state not finite`, frame);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the frame clock, however it is sliced', () => {
  // Time in 1/600 s units, so 60 fps (10), 30 fps (20) and an uneven slicing
  // (7, 13, 4, 16, 10, 10) all land exactly on every 100 ms boundary. The
  // motion changes only on those boundaries -- a launch at 200 ms, a turn at
  // the unit's own rate from 600 to 1000 ms in 10 Hz steps, a stop at 1400 ms
  // -- so every slicing sees the SAME motion and must draw the same thing.
  const UNIT = 1 / 600;
  const TURN = 60 / 360;
  function motion(tu: number): VehicleWeightInput {
    const slot = Math.max(1, Math.ceil(tu / 60)); // the 100 ms step in effect
    const speed = slot >= 3 && slot <= 14 ? 1.1 : 0;
    const heading = 0.1 + TURN * 0.1 * Math.min(4, Math.max(0, slot - 6));
    return at({ speedTilesS: speed, headingTurns: heading, trueX: 10 + slot * 0.1, trueY: 5 });
  }
  function run(slices: readonly number[], freezeEvery = 0): Map<number, number[]> {
    const a = makeVehicleWeightArrays(1);
    stepVehicleWeight(a, { ...motion(0), dtSeconds: 0 });
    const samples = new Map<number, number[]>();
    let tu = 0;
    let k = 0;
    while (tu < 1800) {
      const d = slices[k++ % slices.length];
      tu += d;
      const input = motion(tu);
      const out = stepVehicleWeight(a, { ...input, dtSeconds: d * UNIT });
      const row = [out.pitchRad, out.rollRad, out.drawX - input.trueX, out.drawY - input.trueY];
      if (freezeEvery > 0 && k % freezeEvery === 0) {
        // Hit-stop: four frames with the presentation clock held at zero. The
        // STATE must not move by a single bit; what is drawn may differ only
        // by the rounding of re-deriving the yaw rate from it (~1e-18 rad).
        const state = [a.smoothedSpeed[0], a.smoothedHeading[0], a.lagX[0], a.lagY[0], a.settle[0], a.settleVel[0]];
        for (let f = 0; f < 4; f++) {
          const held = stepVehicleWeight(a, { ...input, dtSeconds: 0 });
          const drawn = [held.pitchRad, held.rollRad, held.drawX - input.trueX, held.drawY - input.trueY];
          for (let c = 0; c < 4; c++) expect(Math.abs(drawn[c] - row[c])).toBeLessThan(1e-12);
          expect([a.smoothedSpeed[0], a.smoothedHeading[0], a.lagX[0], a.lagY[0], a.settle[0], a.settleVel[0]]).toEqual(
            state
          );
        }
      }
      if (tu % 60 === 0) samples.set(tu, row);
    }
    return samples;
  }

  it('draws the same motion the same way at 60 fps, 30 fps and an uneven clock', () => {
    const at60 = run([10]);
    const at30 = run([20]);
    const uneven = run([7, 13, 4, 16, 10, 10]);
    expect(at60.size).toBe(30);
    let moved = 0;
    for (const [tu, ref] of at60) {
      moved = Math.max(moved, Math.abs(ref[0]), Math.abs(ref[1]), Math.abs(ref[2]));
      for (const other of [at30, uneven]) {
        const row = other.get(tu);
        expect(row).toBeDefined();
        for (let c = 0; c < 4; c++) expect(Math.abs((row ?? [])[c] - ref[c])).toBeLessThan(1e-9);
      }
    }
    expect(moved).toBeGreaterThan(0.01); // it really moved: pitch, roll or lag
  });

  // Hit-stop freezes the presentation clock for about four frames after a
  // kill while the sim keeps ticking. A zero dt must be an exact no-op on the
  // state -- no division by it, and nothing banked to spike on release.
  it('treats a frozen clock as no time at all', () => {
    const plain = run([10]);
    const frozen = run([10], 7);
    for (const [tu, ref] of plain) expect(frozen.get(tu)).toEqual(ref);
  });

  it('clamps a long frame to the same ceiling the renderer uses', () => {
    const long = makeVehicleWeightArrays(1);
    const capped = makeVehicleWeightArrays(1);
    stepVehicleWeight(long, at());
    stepVehicleWeight(capped, at());
    const x = stepVehicleWeight(long, at({ speedTilesS: 1.1, dtSeconds: 5 }));
    const xPitch = x.pitchRad;
    const y = stepVehicleWeight(capped, at({ speedTilesS: 1.1, dtSeconds: 0.1 }));
    expect(xPitch).toBe(y.pitchRad);
    expect(long.smoothedSpeed[0]).toBe(capped.smoothedSpeed[0]);
  });
});

describe('the call itself', () => {
  // It runs per vehicle per frame: the result is written into a scratch object
  // the caller owns (one per arrays object), never a fresh one.
  it('returns the same output object every call, and writes into one it is given', () => {
    const a = makeVehicleWeightArrays(2);
    const first = stepVehicleWeight(a, at());
    expect(stepVehicleWeight(a, at({ entityId: 1 }))).toBe(first);
    expect(first).toBe(a.out);
    const mine = { drawX: 0, drawY: 0, pitchRad: 0, rollRad: 0, accelFraction: 0 };
    expect(stepVehicleWeight(a, at(), mine)).toBe(mine);
    expect(mine.drawX).toBe(10);
  });

  it('answers the identity for an entity id it has no slot for, and writes nothing', () => {
    const a = makeVehicleWeightArrays(2);
    for (const entityId of [-1, 2, 0.5, NaN]) {
      const out = stepVehicleWeight(a, at({ entityId, speedTilesS: 1.1 }));
      expect(out.drawX).toBe(10);
      expect(out.pitchRad).toBe(0);
    }
    expect(Array.from(a.seeded)).toEqual([0, 0]);
  });
});
