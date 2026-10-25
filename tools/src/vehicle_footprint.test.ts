import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { unitFootprintTable } from './perf/unit-footprints';
import { VEHICLE_SPACING } from '../../packages/sim/src/formation';
import { DOMAIN_VEHICLE, unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Hull half-extents in tiles: [half_length, half_width, centre_along]. LITERALS, measured
 *  from the hull GLBs (unitFootprintTable) on 2026-10-24, after the Lavi's x1.18 rescale, rounded to 0.01. An oracle
 *  imported from the code under test cannot fail (CLAUDE.md). */
const HULL: Record<string, readonly [number, number, number]> = {
  // GH-274 E6 (the Remetz laser carrier, a 7.0 m 6x6), measured the same way on 2026-10-25: 1.167 / 0.621 / 0.000.
  aa_remetz: [1.17, 0.62, 0],
  apc_eitan: [1.19, 0.51, 0],
  // GH-274 item 1 (the Tzav, a tracked demolition vehicle), measured the same way on 2026-10-25: 1.417 / 0.692 / 0.000.
  demo_tzav: [1.42, 0.69, 0],
  apc_kipod: [1.2, 0.62, 0],
  dozer_d9: [1.14, 0.73, 0],
  gun_truck: [0.9, 0.47, 0],
  ifv_namer: [1.22, 0.69, 0],
  jeep_shoded: [0.8, 0.39, 0],
  mbt_lavi: [1.03, 0.57, -0.22],
  mbt_lavi_camo: [1.1, 0.71, -0.22],
  rocket_battery: [0.95, 0.34, 0],
  scout_shachaf: [0.77, 0.42, 0],
  spg_cluster: [1.22, 0.57, -0.08],
  spg_long_range: [1.22, 0.57, -0.08],
  technical: [0.83, 0.3, 0],
  veh_ambulance: [1.22, 0.69, 0],
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
  it('agrees with a fresh unitFootprintTable() measurement to 0.05 tile', () => {
    const rows = unitFootprintTable().filter((r) => r.vehicleHalfExtent !== null && (r.ringClass === 'light' || r.ringClass === 'armour'));
    expect(rows.map((r) => r.unit).sort()).toEqual(Object.keys(HULL).sort());
    for (const r of rows) {
      const f = fp(byId[r.unit]);
      const h = r.vehicleHalfExtent;
      if (!f || !h) throw new Error(`${r.unit}: no footprint or no measurement`);
      expect(Math.abs(f.half_length_tiles - h.along), `${r.unit} half_length`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(f.half_width_tiles - h.across), `${r.unit} half_width`).toBeLessThanOrEqual(0.05);
      expect(Math.abs((f.centre_along_tiles ?? 0) - h.centreAlong), `${r.unit} centre_along`).toBeLessThanOrEqual(0.05);
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
    // By hand: 1.03*65536=67502.08, 0.57*65536=37355.52, -0.22*65536=-14417.92 (round half away); bound 67502+14418.
    expect([lavi.sepHalfLen, lavi.sepHalfWid, lavi.sepCentre, lavi.sepBound]).toEqual([67502, 37356, -14418, 81920]);
    const inf = unitTypeFromJson(byId.inf_squad);
    expect([inf.sepHalfLen, inf.sepHalfWid, inf.sepCentre, inf.sepBound]).toEqual([0, 0, 0, 0]);
  });
});
