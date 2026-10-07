/**
 * The facade pick against the REAL dimetric camera (WP-P4, PA-14). Every
 * screen point here is made by `worldToScreenThree` from a point on the box,
 * so the test asks the projection the game draws with, not a stand-in.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '../project';
import { screenToWorldThree, worldToScreenThree } from './camera';
import { firstStructureOnRay, structureAtScreenThree, type StructureBox } from './structure-pick';

const VP: Viewport = { width: 1440, height: 900 };
const CAM: Camera = { x: 11.5, y: 11.5, zoom: 1 };

/** A 3x3 house on tiles 10..12 x 10..12, as tall as the measured house mesh
 *  is order-of (3.3 world units). */
const HOUSE: StructureBox = { structure: 7, minX: 10, maxX: 13, minZ: 10, maxZ: 13, baseY: 0, topY: 3.3 };

/** The screen pixel showing world point (x, height, z). */
const pixelOf = (x: number, y: number, z: number): { x: number; y: number } =>
  worldToScreenThree(x, z, CAM, VP, y / WORLD_Y_PER_LIFT_PIXEL);

const inFootprint = (p: { x: number; y: number }, b: StructureBox): boolean =>
  p.x >= b.minX && p.x < b.maxX && p.y >= b.minZ && p.y < b.maxZ;

describe('structureAtScreenThree: a click on a wall is a click on the building', () => {
  // The camera looks from +x,+z, so the +z face (z = maxZ) faces it.
  const upperWall = pixelOf(11.5, 0.8 * HOUSE.topY, HOUSE.maxZ);

  it('the defect: the ground pick through the upper wall lands BEHIND the building', () => {
    const ground = screenToWorldThree(upperWall.x, upperWall.y, CAM, VP);
    expect(inFootprint(ground, HOUSE)).toBe(false);
    // Behind = further from the camera, which sits towards +x,+z.
    expect(ground.x + ground.y).toBeLessThan(HOUSE.minX + HOUSE.minZ);
  });

  it('resolves that pixel to the building', () => {
    expect(structureAtScreenThree(upperWall.x, upperWall.y, CAM, VP, [HOUSE])).toBe(7);
  });

  it('resolves the side wall and the roof too', () => {
    const sideWall = pixelOf(HOUSE.maxX, 0.5 * HOUSE.topY, 11.5);
    const roof = pixelOf(11.5, HOUSE.topY, 11.5);
    expect(structureAtScreenThree(sideWall.x, sideWall.y, CAM, VP, [HOUSE])).toBe(7);
    expect(structureAtScreenThree(roof.x, roof.y, CAM, VP, [HOUSE])).toBe(7);
  });

  it('leaves the ground in front of the building alone', () => {
    const street = pixelOf(11.5, 0, HOUSE.maxZ + 0.6);
    expect(structureAtScreenThree(street.x, street.y, CAM, VP, [HOUSE])).toBe(-1);
  });

  it('leaves the ground seen past the roof alone', () => {
    const pastRoof = pixelOf(11.5, HOUSE.topY + 0.4, HOUSE.minZ);
    expect(structureAtScreenThree(pastRoof.x, pastRoof.y, CAM, VP, [HOUSE])).toBe(-1);
  });

  it('picks the NEARER of two buildings stacked on one pixel', () => {
    // A tall block behind the house, its roof line on the same screen column.
    const BACK: StructureBox = { structure: 3, minX: 5, maxX: 8, minZ: 5, maxZ: 8, baseY: 0, topY: 9 };
    expect(structureAtScreenThree(upperWall.x, upperWall.y, CAM, VP, [BACK, HOUSE])).toBe(7);
    expect(structureAtScreenThree(upperWall.x, upperWall.y, CAM, VP, [HOUSE, BACK])).toBe(7);
  });
});

describe('firstStructureOnRay', () => {
  const box: StructureBox = { structure: 1, minX: 0, maxX: 1, minZ: 0, maxZ: 1, baseY: 0, topY: 1 };
  it('ignores a box the ray only reaches after the ground', () => {
    const o = { x: -5, y: 0.5, z: 0.5 };
    const d = { x: 1, y: 0, z: 0 };
    expect(firstStructureOnRay(o, d, [box], 10)).toBe(1);
    expect(firstStructureOnRay(o, d, [box], 4)).toBe(-1);
  });
  it('compares where the ray ENTERS a box, not where it leaves it', () => {
    // Enters at 5, leaves at 6: a ground point at 5.5 is behind the wall.
    expect(firstStructureOnRay({ x: -5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, [box], 5.5)).toBe(1);
  });
  it('misses a box the ray passes beside', () => {
    expect(firstStructureOnRay({ x: -5, y: 0.5, z: 2 }, { x: 1, y: 0, z: 0 }, [box], 99)).toBe(-1);
  });
});
