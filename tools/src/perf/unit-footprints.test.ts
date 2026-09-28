import { describe, expect, it } from 'vitest';
import { units } from '../../../packages/data/src/index';
import { unitTypeFromJson, type UnitTypeJson } from '../../../packages/sim/src/sim';
import { MESH_SCALE } from '../../../packages/render/src/three/units/mesh-anim';
import { buildFixtureGlb } from '../../../packages/render/src/three/units/mesh-fixture';
import { ringClassOf, SELECTION_RING, type RingClass } from '../../../packages/render/src/three/units/readability';
import { footprintOf, maxPerClass, readGlbJson, unitFootprintTable } from './unit-footprints';

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
  it("reads a GLB buildFixtureGlb wrote (skinned: the node's own transform is ignored)", () => {
    const fp = footprintOf(readGlbJson(buildFixtureGlb({ roleName: 'r', clipName: 'idle' })));
    // fixture triangle: x -0.1..0.1, z 0..0.2
    expect(fp.halfDiagonalM).toBeCloseTo(Math.hypot(0.1, 0.1), 6);
  });
  it('skips WRECK_ nodes, which are hidden while the unit lives', () => {
    const g = readGlbJson(boxGlb());
    g.nodes = [...(g.nodes ?? []), { name: 'WRECK_far', mesh: 0, translation: [50, 0, 0] }];
    g.scenes = [{ nodes: [0, 1] }];
    expect(footprintOf(g).extentX).toBeCloseTo(2, 12);
  });
});

describe('shipped unit rings', () => {
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

  it('measures every unit that ships a GLB', () => {
    for (const id of ['mbt_lavi', 'inf_squad', 'heli_peten', 'technical']) {
      expect(byUnit(id)?.halfDiagonalTiles).toBeGreaterThan(0.1);
    }
  });

  it('every class ring clears 1.15x its measured largest footprint', () => {
    const max = maxPerClass(rows);
    for (const cls of Object.keys(max) as RingClass[]) {
      expect(max[cls].tiles).toBeGreaterThan(0);
      expect(SELECTION_RING.radiusTiles[cls], `${cls} (${max[cls].unit})`).toBeGreaterThanOrEqual(1.15 * max[cls].tiles);
    }
  });

  it('mbt_lavi in particular is inside the armour ring', () => {
    const lavi = byUnit('mbt_lavi')?.halfDiagonalTiles ?? 0;
    expect(SELECTION_RING.radiusTiles.armour).toBeGreaterThanOrEqual(1.15 * lavi);
  });
});
