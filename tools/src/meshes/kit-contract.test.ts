/**
 * The kit contract's numbers, pinned to the files they describe (9 Nov 2026, the v7 set, GH-746).
 *
 *  - `INFANTRY_KIT_TEAM_PART_TRIS.inf_squad` is the Rifle Squad's per-node row for each v7 part: it equals the triangles the
 *    part FILES carry (read from the committed GLBs, not from the report, so a re-decimated carrier moves it) and
 *    `V7_PART_TRIS` in `tools/units/inf_kit_parts.py` (read as text: the module needs no bpy but is not importable here);
 *  - `demo_squad` has no row of its own, so it reads the shared table, and the Rifle Squad inherits the shared row for the
 *    parts v7 does not carry;
 *  - the per-figure and per-file caps equal the ones `tools/validate_mesh_assets.py` enforces on the shipped bytes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INFANTRY_KIT_FIGURE_TRIS,
  INFANTRY_KIT_FILE_TRIS,
  INFANTRY_KIT_PART_TRIS,
  INFANTRY_KIT_TEAM_PART_TRIS,
  infantryKitPartTris,
} from './kit-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const V7 = path.join(REPO, 'art', 'parts', 'inf_kit', 'v7');

/** Triangles of a one-primitive GLB: the index accessor's count / 3 (read from the JSON chunk). */
function glbTris(file: string): number {
  const d = readFileSync(path.join(V7, `${file}.glb`));
  const len = d.readUInt32LE(12);
  const gltf = JSON.parse(d.subarray(20, 20 + len).toString('utf8')) as {
    meshes: { primitives: { indices: number }[] }[];
    accessors: { count: number }[];
  };
  return gltf.accessors[gltf.meshes[0].primitives[0].indices].count / 3;
}

/** The source file(s) one node of a part is made from. */
const SOURCES: Record<string, string[]> = {
  throat: ['throat_protector'],
  groin: ['groin_apron'],
  mag_pouches: ['mag_pouch', 'mag_pouch'],
  grenade_pouches: ['grenade_pouch', 'grenade_pouch'],
  lpvo: ['scope'],
  laser_box: ['laser'],
  headset: ['headset_l_built'],
};

describe('the kit contract', () => {
  const team = INFANTRY_KIT_TEAM_PART_TRIS.inf_squad;

  it('the Rifle Squad rows are the v7 part files\' own triangle counts', () => {
    expect(Object.keys(team).length).toBe(19);
    for (const [part, rows] of Object.entries(team)) {
      const files = SOURCES[part] ?? [part];
      expect(rows, part).toBe(files.reduce((n, f) => n + glbTris(f), 0));
    }
  });

  it('...and the Python table the exporter reads', () => {
    const py = readFileSync(path.join(REPO, 'tools', 'units', 'inf_kit_parts.py'), 'utf8');
    const body = /V7_PART_TRIS = \{([^}]*)\}/.exec(py)?.[1] ?? '';
    const parsed = Object.fromEntries([...body.matchAll(/"(\w+)":\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(parsed).toEqual(team);
  });

  it('demo_squad reads the shared limit; the Rifle Squad reads its own row, and the shared one for a part v7 lacks', () => {
    expect(INFANTRY_KIT_TEAM_PART_TRIS.demo_squad).toBeUndefined();
    expect(infantryKitPartTris('demo_squad', 'carrier')).toBe(INFANTRY_KIT_PART_TRIS.carrier);
    expect(infantryKitPartTris('inf_squad', 'carrier')).toBe(2299);
    expect(infantryKitPartTris('inf_squad', 'yoke')).toBe(INFANTRY_KIT_PART_TRIS.yoke);
    expect(infantryKitPartTris('inf_squad', 'cape')).toBeUndefined();
  });

  it('the figure and file caps equal the ones validate_mesh_assets.py enforces', () => {
    const py = readFileSync(path.join(REPO, 'tools', 'validate_mesh_assets.py'), 'utf8');
    const num = (name: string): number => Number(new RegExp(`^${name} = (\\d+)`, 'm').exec(py)?.[1]);
    expect(num('INFANTRY_KIT_FIGURE_TRIS')).toBe(INFANTRY_KIT_FIGURE_TRIS);
    expect(num('INFANTRY_KIT_FILE_TRIS')).toBe(INFANTRY_KIT_FILE_TRIS);
    expect(INFANTRY_KIT_FIGURE_TRIS).toBe(7200);
  });
});
