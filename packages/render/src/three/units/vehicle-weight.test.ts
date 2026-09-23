import { describe, expect, it } from 'vitest';
import { hullCornerOffsets, terrainPitchRad, terrainRollRad } from './vehicle-weight';

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
