import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { units } from '../../../packages/data/src/index';
import { unitTypeFromJson, type UnitTypeJson } from '../../../packages/sim/src/sim';
import { MESH_SCALE } from '../../../packages/render/src/three/units/mesh-anim';
import { buildFixtureGlb } from '../../../packages/render/src/three/units/mesh-fixture';
import {
  ELLIPSE_BY_TYPE,
  RADIUS_BY_TYPE,
  ringClassOf,
  ringRadiusFor,
  SELECTION_RING,
} from '../../../packages/render/src/three/units/readability';
import { cornerReach, ellipseFor, footprintOf, HULL_ONLY, radiusFor, readGlb, readGlbJson, unitFootprintTable } from './unit-footprints';

/** A real GLB header + JSON chunk around a one-mesh 2 x 1 box (X by Z, 1 tall). */
function boxGlb(nodeScale?: number[]): ArrayBuffer {
  const json = {
    asset: { version: '2.0' },
    accessors: [{ componentType: 5126, count: 8, type: 'VEC3', min: [-1, 0, -0.5], max: [1, 1, 0.5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'box', mesh: 0, ...(nodeScale ? { scale: nodeScale } : {}) }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const body = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(body.length / 4) * 4).fill(0x20);
  padded.set(body);
  const out = new Uint8Array(20 + padded.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, padded.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(padded, 20);
  return out.buffer;
}

describe('footprintOf', () => {
  it('reports sqrt(1^2 + 0.5^2) * MESH_SCALE for a 2 x 1 box', () => {
    const fp = footprintOf(readGlbJson(boxGlb()));
    expect(fp.halfDiagonalTiles).toBeCloseTo(Math.hypot(1, 0.5) * MESH_SCALE, 12);
  });
  it("applies the node's scale", () => {
    const fp = footprintOf(readGlbJson(boxGlb([2, 2, 2])));
    expect(fp.halfDiagonalTiles).toBeCloseTo(2 * Math.hypot(1, 0.5) * MESH_SCALE, 12);
  });
  it('skips WRECK_ nodes, which are hidden while the unit lives', () => {
    const g = readGlbJson(boxGlb());
    g.nodes = [...(g.nodes ?? []), { name: 'WRECK_far', mesh: 0, translation: [50, 0, 0] }];
    g.scenes = [{ nodes: [0, 1] }];
    expect(footprintOf(g).extentX).toBeCloseTo(2, 12);
  });
});

describe('posed and hull-only footprints', () => {
  it('poses a skinned figure at the first idle keyframe and skins it on the CPU', () => {
    const { json, bin } = readGlb(buildFixtureGlb({ roleName: 'r', clipName: 'idle' }));
    expect(footprintOf(json, bin).halfDiagonalM).toBeCloseTo(Math.hypot(0.1, 0.1), 6);
  });
  it('a static node only counts when `include` matches, and the rest are reported', () => {
    const g = readGlbJson(boxGlb());
    g.nodes = [{ name: 'hull_a', mesh: 0 }, { name: 'turret_metal', mesh: 0, translation: [50, 0, 0] }];
    g.scenes = [{ nodes: [0, 1] }];
    const fp = footprintOf(g, null, { include: HULL_ONLY });
    expect(fp.extentX).toBeCloseTo(2, 12);
    expect(fp.excluded).toEqual(['turret_metal']);
  });
  it('drops the barrel and the rotor disc on the shipped types', () => {
    const rows = unitFootprintTable();
    expect(rows.find((r) => r.unit === 'mbt_lavi')?.excluded).toContain('turret_metal');
    expect(rows.find((r) => r.unit === 'heli_peten')?.excluded).toContain('rotor_metal');
  });
  it('the idle pose is what is measured: it is not the bind pose (it is wider for the Meshy rifleman, weapon up)', () => {
    const { json, bin } = readGlb(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../art/meshes/meshy_soldier.glb')));
    const idle = footprintOf(json, bin, { clip: 'idle' }).halfDiagonalTiles;
    const bind = footprintOf(json, bin, { clip: 'no-such-clip' }).halfDiagonalTiles;
    expect(Math.abs(idle - bind)).toBeGreaterThan(0.01);
  });
});

describe('per-type ring radius', () => {
  const rows = unitFootprintTable();
  const byUnit = (id: string) => rows.find((r) => r.unit === id);

  it('rocket_battery is light (authored wheeled, armour 10 < SOFT_ARMOR_LIMIT), mortar_team is foot', () => {
    const rb = unitTypeFromJson(units.rocket_battery as unknown as UnitTypeJson);
    expect(rb.wheeled).toBe(true);
    expect(rb.isSoft).toBe(true);
    expect(ringClassOf(rb)).toBe('light');
    expect(ringClassOf(unitTypeFromJson(units.mortar_team as unknown as UnitTypeJson))).toBe('foot');
    expect(byUnit('rocket_battery')?.ringClass).toBe('light');
    expect(byUnit('mortar_team')?.ringClass).toBe('foot');
  });

  it('dozer_d9 is classed foot by the sim and light by the render-side override', () => {
    expect(ringClassOf(unitTypeFromJson(units.dozer_d9 as unknown as UnitTypeJson))).toBe('foot');
    expect(byUnit('dozer_d9')?.ringClass).toBe('light');
  });

  it('every unit type has a row, and it is exactly max(class, 1.15 x its OWN footprint), rounded up', () => {
    for (const r of rows) {
      expect(RADIUS_BY_TYPE[r.unit], r.unit).toBeDefined();
      expect(RADIUS_BY_TYPE[r.unit], r.unit).toBe(radiusFor(r, SELECTION_RING.radiusTiles));
      expect(ringRadiusFor(r.unit, r.ringClass), r.unit).toBe(RADIUS_BY_TYPE[r.unit]);
    }
  });

  it('every hull clears 1.15x its own footprint', () => {
    for (const r of rows) {
      if (r.halfDiagonalTiles === null) continue;
      expect(RADIUS_BY_TYPE[r.unit], r.unit).toBeGreaterThanOrEqual(1.15 * r.halfDiagonalTiles);
    }
  });

  it('no type inherits a classmate\'s size: the rule is per type, not per class max', () => {
    // A class-max table gives every foot unit the sniper's ring, every air unit the heli's.
    expect(RADIUS_BY_TYPE.at_team).toBe(SELECTION_RING.radiusTiles.foot);
    expect(RADIUS_BY_TYPE.paramotor).toBe(SELECTION_RING.radiusTiles.air);
    expect(RADIUS_BY_TYPE.mbt_lavi).toBeLessThan(RADIUS_BY_TYPE.ifv_namer);
    expect(RADIUS_BY_TYPE.moto_rpg).toBe(SELECTION_RING.radiusTiles.light);
  });

  it('a type is never below its class value (raise only)', () => {
    for (const r of rows) expect(RADIUS_BY_TYPE[r.unit], r.unit).toBeGreaterThanOrEqual(SELECTION_RING.radiusTiles[r.ringClass]);
  });

  it('the paramotor falls back to its class value and says why', () => {
    expect(byUnit('paramotor')?.halfDiagonalTiles).toBeNull();
    expect(byUnit('paramotor')?.note).toMatch(/canopy/);
  });
});

describe('per-type vehicle ellipse (G-MOCK)', () => {
  const rows = unitFootprintTable();

  it('ELLIPSE_BY_TYPE is exactly ellipseFor over a fresh measurement: same types, same numbers', () => {
    const fresh: Record<string, { along: number; across: number }> = {};
    for (const r of rows) {
      const e = ellipseFor(r);
      if (e) fresh[r.unit] = e;
    }
    expect(ELLIPSE_BY_TYPE).toEqual(fresh);
  });

  it('a box hull gives its half-extents plus the 0.30 pad on each axis', () => {
    const fp = footprintOf(readGlbJson(boxGlb()));
    expect(fp.halfExtentXTiles).toBeCloseTo(1 * MESH_SCALE, 12);
    expect(fp.halfExtentZTiles).toBeCloseTo(0.5 * MESH_SCALE, 12);
    const row = { unit: 'box', ringClass: 'armour' as const, halfDiagonalTiles: 1, file: 'x', excluded: [], note: null,
      vehicleHalfExtent: { along: 0.87, across: 0.48, centreAlong: -0.184 } };
    expect(ellipseFor(row)).toEqual({ along: 1.17, across: 0.78, offsetAlong: -0.18 });
    expect(ellipseFor({ ...row, ringClass: 'air' })).toBeNull();
    expect(ellipseFor({ ...row, vehicleHalfExtent: null })).toBeNull();
  });
});

describe('fix round 1: the ellipse is centred on the hull, and holds its corners', () => {
  const rows = unitFootprintTable();

  it("every ground vehicle's four hull corners lie inside its shipped ellipse", () => {
    for (const r of rows) {
      const e = ELLIPSE_BY_TYPE[r.unit];
      if (!e || !r.vehicleHalfExtent) continue;
      expect(cornerReach(r.vehicleHalfExtent.along, r.vehicleHalfExtent.across, e.along, e.across), r.unit).toBeLessThanOrEqual(1);
    }
  });

  it('scaling keeps the mocked aspect and never drops below half-extent + pad', () => {
    for (const r of rows) {
      const e = ELLIPSE_BY_TYPE[r.unit];
      const h = r.vehicleHalfExtent;
      if (!e || !h) continue;
      expect(e.along, r.unit).toBeGreaterThanOrEqual(h.along + 0.3 - 0.005);
      expect(e.across, r.unit).toBeGreaterThanOrEqual(h.across + 0.3 - 0.005);
      expect(e.along / e.across, r.unit).toBeCloseTo((h.along + 0.3) / (h.across + 0.3), 1);
    }
  });

  it("the Lavi's ring centre sits 0.18 tile behind its origin, where its hull box is", () => {
    expect(ELLIPSE_BY_TYPE.mbt_lavi.offsetAlong).toBe(-0.18);
  });
});
