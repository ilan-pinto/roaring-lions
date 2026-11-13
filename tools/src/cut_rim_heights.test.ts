/**
 * GH-1225 rim: the wall a cut keeps, per shipped CLONE-DRAWN building type, from its shipped GLB at the template's own scale
 * (1/3 m per tile, fit 1). The runtime measures each structure's drawn clone (`ThreeRenderer.keptWallOf`, fit included); this is
 * the same `lowestSlabBottom` / `keptWallHeight` over the file, so the table below is what a full-size building keeps.
 * Prints the table (the PR body quotes it) and pins the invariant: no type's rim, ragged top included, reaches its lowest slab.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeWorlds, readAccessor, readGlb, MESH_UNITS_PER_TILE } from './mesh_gait';
import { CUT_RIM_JITTER_TILES, CUT_RIM_WALL_TILES } from '../../packages/render/src/three/units/building-cutaway';
import { keptWallHeight, lowestSlabBottom } from '../../packages/render/src/three/units/cut-rim';

const ROOT = resolve(__dirname, '../..');
const types = JSON.parse(readFileSync(resolve(ROOT, 'data/structures.json'), 'utf8')).types as Record<string, { per_tile?: boolean }>;

/** One type's lowest slab underside (tiles above the ground, Infinity: none) from its GLB. */
function slabOf(path: string): number {
  const glb = readGlb(path);
  const worlds = nodeWorlds(glb, new Map(), 0);
  const positions: number[] = [];
  const index: number[] = [];
  (glb.json.nodes ?? []).forEach((n, i) => {
    if (n.mesh === undefined) return;
    const m = worlds[i];
    for (const prim of glb.json.meshes?.[n.mesh].primitives ?? []) {
      const pos = readAccessor(glb, prim.attributes.POSITION);
      const base = positions.length / 3;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.data[3 * v];
        const y = pos.data[3 * v + 1];
        const z = pos.data[3 * v + 2];
        positions.push(
          (m[0] * x + m[4] * y + m[8] * z + m[12]) / MESH_UNITS_PER_TILE,
          (m[1] * x + m[5] * y + m[9] * z + m[13]) / MESH_UNITS_PER_TILE,
          (m[2] * x + m[6] * y + m[10] * z + m[14]) / MESH_UNITS_PER_TILE
        );
      }
      if (prim.indices === undefined) for (let v = 0; v < pos.count; v++) index.push(base + v);
      else for (const k of readAccessor(glb, prim.indices).data) index.push(base + k);
    }
  });
  return lowestSlabBottom(positions, index, 0);
}

const rows = Object.entries(types)
  .filter(([id, t]) => t.per_tile !== true && existsSync(resolve(ROOT, `art/meshes/buildings/${id}.glb`)))
  .map(([id]) => {
    const slab = slabOf(resolve(ROOT, `art/meshes/buildings/${id}.glb`));
    return { id, slab, kept: keptWallHeight(slab) };
  });

describe('the kept rim per shipped building type', () => {
  it('measures a table of types, and prints it', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    process.stdout.write(`\nRIM TABLE (type, lowest slab underside t, kept wall t)\n${rows.map((r) => `${r.id}\t${Number.isFinite(r.slab) ? r.slab.toFixed(2) : 'none'}\t${r.kept.toFixed(2)}`).join('\n')}\n`);
  });
  it('the house: ground storey ceiling at 1.6 t at full size (1.28 t on house 5, whose plot fits it by 0.8, measured in the running game), so it keeps the full 0.9 t', () => {
    const house = rows.find((r) => r.id === 'house');
    expect(house?.slab).toBeCloseTo(1.6, 1);
    expect(house?.kept).toBe(CUT_RIM_WALL_TILES);
  });
  it('no type keeps a rim whose ragged top reaches its lowest slab, and none keeps more than 0.9 t', () => {
    for (const r of rows) {
      expect(r.kept, r.id).toBeLessThanOrEqual(CUT_RIM_WALL_TILES);
      if (Number.isFinite(r.slab) && r.kept > 0.2) expect(r.kept + CUT_RIM_JITTER_TILES, r.id).toBeLessThan(r.slab);
    }
  });
});
