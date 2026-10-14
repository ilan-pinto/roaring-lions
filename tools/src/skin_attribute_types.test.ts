// Every skinned primitive in a rigged GLB carries its skin attributes in ONE
// component type. The renderer merges a unit's meshes (`units/silhouette.ts`'s
// merged silhouette, `mergeGeometries`), and three.js refuses to merge a
// `skinIndex` stored as UNSIGNED_BYTE in one mesh and UNSIGNED_SHORT in
// another -- it logs "mergeAttributes() failed ... consistent array types"
// and the occlusion outline silently goes missing.
//
// Found by CI's ui:routes on the unit-polish branch (14 Oct): the mortar
// grafted into mortar_crew (`mortar-graft.ts`) wrote its JOINTS_0 as
// Uint16Array beside the crew's Uint8Array. Red on that file (weapon 5123 vs
// 5121), green once the graft matches the file's own type.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

function glbs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...glbs(p));
    else if (e.name.endsWith('.glb')) out.push(p);
  }
  return out;
}

describe('one skin attribute type per file', () => {
  const files = glbs(MESHES);
  it('reads the rigged files', () => expect(files.length).toBeGreaterThan(20));
  for (const file of files) {
    const rel = path.relative(MESHES, file);
    it(`${rel}: JOINTS_0 and WEIGHTS_0 share one component type across its primitives`, () => {
      const g = readGlb(file).json;
      const seen = { JOINTS_0: new Set<string>(), WEIGHTS_0: new Set<string>() };
      for (const m of g.meshes ?? []) {
        for (const p of m.primitives) {
          for (const k of ['JOINTS_0', 'WEIGHTS_0'] as const) {
            const i = p.attributes[k];
            if (i === undefined) continue;
            const a = g.accessors![i];
            seen[k].add(`${a.componentType}${(a as { normalized?: boolean }).normalized ? 'n' : ''}`);
          }
        }
      }
      expect([...seen.JOINTS_0], `${rel} JOINTS_0`).toHaveLength(Math.min(1, seen.JOINTS_0.size));
      expect([...seen.WEIGHTS_0], `${rel} WEIGHTS_0`).toHaveLength(Math.min(1, seen.WEIGHTS_0.size));
    });
  }
});
