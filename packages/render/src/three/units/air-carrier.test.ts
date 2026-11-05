import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { groundWorldY } from '../ground-height';
import { terrainSurfaceFrom } from '../terrain/surface';
import { airLiftFrac } from './air-lift';
import { AIR_LIFT_PX } from './frame-state';
import { meshYawFromFacing, MESH_UNITS_PER_TILE } from './mesh-anim';
import { AIR_AIRBORNE, AIR_LANDED, AIR_LANDING } from '@lions/sim';
import {
  AIR_CARRIER_LIFT_PX,
  CARRIER_GEAR_FORWARD_X_M,
  CARRIER_GEAR_HALF_TRACK_M,
  CARRIER_GEAR_MAIN_X_M,
  airFlyingLiftPx,
  carrierGearConform,
} from './air-carrier';
import type { HullConform, HullConformInput } from './vehicle-conform';
import type { HullCorners } from './vehicle-weight';

/** The four gear contacts MEASURED from the GLB: lowest vertices (within 1 cm), clustered by quadrant. */
function measureGearFromGlb(): { x: number; z: number }[] {
  const file = resolve(__dirname, '../../../../../art/meshes/vehicles/heli_yanshuf.glb');
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const view = json.bufferViews[acc.bufferView];
  const off = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const pts: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    pts.push([0, 1, 2].map((k) => bin.readFloatLE(off + i * stride + 4 * k)));
  }
  const yMin = Math.min(...pts.map((p) => p[1]));
  const low = pts.filter((p) => p[1] < yMin + 0.01);
  const out: { x: number; z: number }[] = [];
  for (const front of [false, true]) {
    for (const left of [false, true]) {
      const q = low.filter((p) => p[0] > 0.4 === front && p[2] > 0 === left);
      expect(q.length).toBeGreaterThan(0);
      out.push({ x: q.reduce((a, p) => a + p[0], 0) / q.length, z: q.reduce((a, p) => a + p[2], 0) / q.length });
    }
  }
  return out;
}

describe('flying height per type', () => {
  it('an air carrier flies at 28 px and any other aircraft at 14', () => {
    expect(AIR_CARRIER_LIFT_PX).toBe(28);
    expect(airFlyingLiftPx(true)).toBe(28);
    expect(airFlyingLiftPx(false)).toBe(14);
    expect(airFlyingLiftPx(false)).toBe(AIR_LIFT_PX);
  });
});

describe('gear constants are the GLB, not a guess', () => {
  const gear = measureGearFromGlb();
  it('main wheels, forward wheels and track match the measured contacts to 1 cm', () => {
    for (const g of gear) {
      const wantX = g.x > 0.4 ? CARRIER_GEAR_FORWARD_X_M : CARRIER_GEAR_MAIN_X_M;
      expect(Math.abs(g.x - wantX)).toBeLessThan(0.02);
      expect(Math.abs(Math.abs(g.z) - CARRIER_GEAR_HALF_TRACK_M)).toBeLessThan(0.02);
    }
  });
});

describe('G5: a landed carrier fits the slope', () => {
  // World units (1 tile = 3 m, so 3e-3 is 9 mm). Pitch and roll are fitted from two separate axis slopes, so on a
  // diagonal 20 degree plane they compose to a normal a hair off the true one: measured worst 1.7e-3.
  const GEAR_EPS = 3e-3;
  const W = 16;
  // A plane of one elevation level per tile in x and in y (about 20 deg, a steep case), inside the span the
  // Catmull-Rom surface reads under the hull, so the drawn ground there is exactly planar.
  const elevation = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) elevation[y * W + x] = Math.max(0, Math.min(9, x + y - 3));
  const blocked = new Uint8Array(W * W);
  const ground = terrainSurfaceFrom(elevation, blocked, W, W);
  const gear = measureGearFromGlb();
  const cx = 4.5;
  const cy = 4.5;

  /** The carrier's pose exactly as the renderer writes it, then each gear contact's gap to the drawn ground, world units. */
  function gaps(facingNorm: number, liftFrac: number): number[] {
    const centreGroundY = groundWorldY(ground, W, W, cx, cy);
    const input = { elevation: ground, blocked, mapWidth: W, mapHeight: W, centreX: cx, centreY: cy, centreGroundY, facingNorm, lengthTiles: 0, widthTiles: 0 } as HullConformInput;
    const corners = {} as HullCorners;
    const out: HullConform = { pitchRad: 0, rollRad: 0 };
    carrierGearConform(input, corners, out, liftFrac);
    const rootY = centreGroundY + 0; // landed: no lift
    const e = new THREE.Euler(-out.rollRad, meshYawFromFacing(facingNorm), out.pitchRad, 'YZX');
    return gear.map((g) => {
      const p = new THREE.Vector3(g.x / MESH_UNITS_PER_TILE, 0, g.z / MESH_UNITS_PER_TILE).applyEuler(e);
      return rootY + p.y - groundWorldY(ground, W, W, cx + p.x, cy + p.z);
    });
  }

  it.each([0, 0.125, 0.3, 0.6, 0.85])('facing %f: all four gear contacts sit on the ground (landed)', (facing) => {
    const frac = airLiftFrac(AIR_LANDED, 0, 1);
    expect(frac).toBe(0);
    for (const gap of gaps(facing, frac)) expect(Math.abs(gap)).toBeLessThan(GEAR_EPS);
  });

  it('the fit is doing the work: a level hull is off the slope by many times the tolerance', () => {
    const level = gaps(0.125, 1); // frac 1 = airborne weight: no conform at all
    expect(Math.max(...level.map(Math.abs))).toBeGreaterThan(0.02);
  });

  it('the weight is 1 - airLiftFrac: half way down is half the tilt, airborne is exactly level', () => {
    const run = (frac: number) => {
      const input = { elevation: ground, blocked, mapWidth: W, mapHeight: W, centreX: cx, centreY: cy, centreGroundY: groundWorldY(ground, W, W, cx, cy), facingNorm: 0.3, lengthTiles: 0, widthTiles: 0 } as HullConformInput;
      return carrierGearConform(input, {} as HullCorners, { pitchRad: 0, rollRad: 0 }, frac);
    };
    const landed = run(0);
    const half = run(0.5);
    expect(Math.abs(landed.pitchRad)).toBeGreaterThan(0.1);
    expect(Math.abs(landed.rollRad)).toBeGreaterThan(0.1); // a facing with both, so each weight is tested
    expect(half.pitchRad).toBeCloseTo(landed.pitchRad * 0.5, 12);
    expect(half.rollRad).toBeCloseTo(landed.rollRad * 0.5, 12);
    expect(Math.abs(run(airLiftFrac(AIR_AIRBORNE, 0, 1)).pitchRad)).toBe(0);
    expect(Math.abs(run(airLiftFrac(AIR_AIRBORNE, 0, 1)).rollRad)).toBe(0);
    // mid-descent reads a real fraction, never the landed or airborne endpoint
    const mid = airLiftFrac(AIR_LANDING, 10, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
