import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { VEHICLE_SPACING } from '../../packages/sim/src/formation';
import { DOMAIN_VEHICLE, unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Hull half-extents in tiles: [half_length, half_width, centre_along]. LITERALS, inverted by hand
 *  from readability.ts's ELLIPSE_BY_TYPE at 6a3408a1 and re-measured in Task 1 Step 0. An oracle
 *  imported from the code under test cannot fail (CLAUDE.md). */
const HULL: Record<string, readonly [number, number, number]> = {
  apc_eitan: [1.19, 0.51, 0],
  apc_kipod: [1.2, 0.63, 0],
  dozer_d9: [1.14, 0.73, 0],
  gun_truck: [0.9, 0.47, 0],
  ifv_namer: [1.22, 0.69, 0],
  jeep_shoded: [0.8, 0.39, 0],
  mbt_lavi: [0.87, 0.48, -0.18],
  rocket_battery: [0.95, 0.34, 0],
  scout_shachaf: [0.77, 0.42, 0],
  technical: [0.83, 0.3, 0],
};
/** Vehicle-domain types that do NOT separate, each with its reason (V-R4). */
const EXEMPT: Record<string, string> = {
  moto_rpg: 'a motorcycle drawn as a rigged team: no vehicle GLB, no ellipse',
};
const byId = units as Record<string, UnitTypeJson>;
const all = Object.values(byId);
const fp = (u: UnitTypeJson) => u.mobility.footprint;

describe('vehicle footprints (GH-421)', () => {
  it('exactly the measured hulls declare one', () => {
    expect(all.filter((u) => fp(u) !== undefined).map((u) => u.id).sort()).toEqual(Object.keys(HULL).sort());
  });
  it('every vehicle-domain ground type declares one, bar the named exemption, which still needs it', () => {
    for (const u of all) {
      const t = unitTypeFromJson(u);
      if (t.isAir || t.moveDomain !== DOMAIN_VEHICLE) continue;
      if (u.id in EXEMPT) expect(fp(u), `${u.id}: exempt, so no footprint`).toBeUndefined();
      else expect(fp(u), `${u.id} is a vehicle with no footprint`).toBeDefined();
    }
    // Demotion: an exemption whose unit stopped being a footprint-less vehicle must be deleted.
    for (const id of Object.keys(EXEMPT)) {
      expect(unitTypeFromJson(byId[id]).moveDomain, `${id}: delete its exemption`).toBe(DOMAIN_VEHICLE);
    }
  });
  it('agrees with the measured hull to 0.05 tile', () => {
    for (const [id, [len, wid, ctr]] of Object.entries(HULL)) {
      const f = fp(byId[id]);
      if (!f) throw new Error(`${id}: no footprint`);
      expect(Math.abs(f.half_length_tiles - len), `${id} half_length`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(f.half_width_tiles - wid), `${id} half_width`).toBeLessThanOrEqual(0.05);
      expect(Math.abs((f.centre_along_tiles ?? 0) - ctr), `${id} centre_along`).toBeLessThanOrEqual(0.05);
    }
  });
  it('no footprint contests a sideways formation slot (V-D3)', () => {
    for (const u of all) {
      const f = fp(u);
      if (f) expect(2 * f.half_width_tiles, u.id).toBeLessThanOrEqual(VEHICLE_SPACING);
    }
  });
  it('no aircraft declares one', () => {
    for (const u of all) if (u.mobility.domain === 'air') expect(fp(u), u.id).toBeUndefined();
  });
  it('the sim type carries the footprint as Q16.16, and zero when absent', () => {
    const lavi = unitTypeFromJson(byId.mbt_lavi);
    expect([lavi.sepHalfLen, lavi.sepHalfWid, lavi.sepCentre, lavi.sepBound]).toEqual([57016, 31457, -11796, 68812]);
    const inf = unitTypeFromJson(byId.inf_squad);
    expect([inf.sepHalfLen, inf.sepHalfWid, inf.sepCentre, inf.sepBound]).toEqual([0, 0, 0, 0]);
  });
});
