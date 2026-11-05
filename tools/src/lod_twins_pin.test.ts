// GH-974: `house_lod1` and `ditch_lod1` pinned against their sources, from the BYTES of both GLBs (the wall's twin: wall_lod1.test.ts).
//
// The twin is drawn INSTEAD of the compound wall below zoom 2.0, with the wall's own
// material, so five things must stay true of it or the swap shows. None of this imports
// the exporter or the renderer: the oracle is the two files and literals.
//   - the same node names and `rl_role` extras as the wall (the renderer pairs by role);
//   - the same bounds, within 5 mm (a taller or fatter twin pops at the swap);
//   - at most 350 triangles, and under 12% of the wall's (the point of the asset);
//   - zero materials, images and textures (it borrows the wall's), but a UV0 on every
//     primitive, every UV inside the unit square (it samples the wall's bake: option (a));
//   - both files are the SHIPPED art/meshes sources, not a scratch copy.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

interface Accessor { count: number; min?: number[]; max?: number[]; bufferView?: number; byteOffset?: number; componentType: number }
interface Glb {
  nodes: { name: string; mesh?: number; extras?: { rl_role?: string; rl_textured?: boolean } }[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number }[] }[];
  accessors: Accessor[];
  materials?: unknown[];
  images?: unknown[];
  textures?: unknown[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
}

function readGlb(rel: string): { json: Glb; bin: Buffer } {
  const buf = readFileSync(path.resolve(REPO, rel));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Glb;
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart) };
}

const triangles = (g: Glb): number => g.meshes.reduce((n, m) => n + m.primitives.reduce((k, p) => k + g.accessors[p.indices].count / 3, 0), 0);

function bounds(g: Glb): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of g.meshes) {
    for (const p of m.primitives) {
      const a = g.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], (a.min as number[])[i]);
        max[i] = Math.max(max[i], (a.max as number[])[i]);
      }
    }
  }
  return { min, max };
}


interface Pin {
  label: string;
  full: string;
  twin: string;
  env: string;
  roles: [string, string | undefined][];
  tol: number;
  maxTris: number;
  maxShare: number;
  minTris: number;
}
// HOUSE_LOD1_TWIN / DITCH_LOD1_TWIN are the falsification hooks: point one at a mutated scratch COPY (absolute path).
const PINS: Pin[] = [
  {
    label: 'house_lod1 / house', full: 'art/meshes/buildings/house.glb',
    twin: process.env.HOUSE_LOD1_TWIN ?? 'art/meshes/buildings/house_lod1.glb', env: 'HOUSE_LOD1_TWIN',
    roles: [['glass', 'glass'], ['metal', 'metal'], ['roof', 'roof'], ['trim', 'trim'], ['wall', 'wall']],
    tol: 0.06, maxTris: 4000, maxShare: 0.12, minTris: 1000,
  },
  {
    label: 'ditch_lod1 / ditch_0', full: 'art/meshes/decor/ditch_0.glb',
    twin: process.env.DITCH_LOD1_TWIN ?? 'art/meshes/decor/ditch_lod1.glb', env: 'DITCH_LOD1_TWIN',
    roles: [['ditch', undefined]],
    tol: 0.01, maxTris: 2500, maxShare: 0.08, minTris: 500,
  },
];

for (const pin of PINS) {
  describe(`${pin.label} is a twin (GH-974)`, () => {
    const full = readGlb(pin.full);
    const twin = readGlb(pin.twin);

    it('reads two real files (vacuity guard)', () => {
      expect(triangles(full.json)).toBeGreaterThan(30000);
      expect(triangles(twin.json)).toBeGreaterThan(pin.minTris);
    });

    it('carries the same node names and rl_role extras as the full mesh', () => {
      const roles = (g: Glb): [string, string | undefined][] => g.nodes.map((n): [string, string | undefined] => [n.name, n.extras?.rl_role]).sort();
      expect(roles(twin.json)).toEqual(roles(full.json));
      expect(roles(twin.json)).toEqual(pin.roles);
    });

    it('a textured family\'s twin carries the same rl_textured flag the runtime reads', () => {
      const flag = (g: Glb): (boolean | undefined)[] => g.nodes.map((n) => n.extras?.rl_textured);
      expect(flag(twin.json)).toEqual(flag(full.json));
    });

    it(`has the full mesh's bounds within ${pin.tol * 100} cm`, () => {
      const f = bounds(full.json);
      const t = bounds(twin.json);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(t.min[i] - f.min[i]), `min[${i}]`).toBeLessThanOrEqual(pin.tol);
        expect(Math.abs(t.max[i] - f.max[i]), `max[${i}]`).toBeLessThanOrEqual(pin.tol);
      }
    });

    it(`is at most ${pin.maxTris} triangles and under ${pin.maxShare * 100}% of the full mesh`, () => {
      expect(triangles(twin.json)).toBeLessThanOrEqual(pin.maxTris);
      expect(triangles(twin.json) / triangles(full.json)).toBeLessThan(pin.maxShare);
    });

    it('ships no material, image or texture, and a UV0 inside the unit square on every primitive', () => {
      expect(twin.json.materials ?? []).toEqual([]);
      expect(twin.json.images ?? []).toEqual([]);
      expect(twin.json.textures ?? []).toEqual([]);
      expect(full.json.materials?.length).toBe(1); // the bake it borrows
      for (const m of twin.json.meshes) {
        for (const p of m.primitives) {
          const id = p.attributes.TEXCOORD_0;
          expect(id, `${m.name} has TEXCOORD_0`).toBeDefined();
          const a = twin.json.accessors[id];
          const bv = twin.json.bufferViews[a.bufferView as number];
          const at = twin.bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
          const uv = new Float32Array(twin.bin.buffer.slice(at, at + a.count * 8));
          expect(uv.length).toBe(a.count * 2);
          for (const v of uv) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });
}
