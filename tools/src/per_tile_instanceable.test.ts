/**
 * GH-974: every shipped per-tile building draws INSTANCED only if each mesh of its GLB sits at the
 * scene root's own frame (`units/structure-instances.ts`, `instanceableTemplate`): a part carrying
 * its own translation, rotation, scale or matrix would shear under a non-uniform fit, so the
 * renderer refuses it and quietly falls back to a clone per tile, three times the draw calls and
 * nothing red anywhere. This reads the shipped GLBs' node tables and fails by name instead.
 *
 * Reads `assets/meshes/buildings/` (the encoded files the game serves): a Draco pass rewrites
 * geometry, never the node table, so this is the same table `art/meshes/` carries.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const TRS = ['translation', 'rotation', 'scale', 'matrix'] as const;

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: unknown;
  rotation?: unknown;
  scale?: unknown;
  matrix?: unknown;
}

/** The glTF JSON chunk of a GLB. */
export function gltfJson(bytes: Buffer): { nodes: GltfNode[] } {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as { nodes: GltfNode[] };
}

/** Why a node table cannot be instanced: a node with its own transform, or one nested under another. */
export function instancingBlockers(json: { nodes: GltfNode[] }): string[] {
  const out: string[] = [];
  json.nodes.forEach((n, i) => {
    for (const k of TRS) if (n[k] !== undefined) out.push(`node ${i} (${n.name ?? '?'}) carries ${k}`);
    if (n.children !== undefined && n.children.length > 0) out.push(`node ${i} (${n.name ?? '?'}) has children`);
  });
  return out;
}

const structures = JSON.parse(readFileSync(path.join(ROOT, 'data/structures.json'), 'utf8')) as {
  types: Record<string, { per_tile?: boolean }>;
};
const perTile = Object.entries(structures.types)
  .filter(([, t]) => t.per_tile === true)
  .map(([id]) => id);

describe('instancingBlockers (the check itself)', () => {
  it('passes a flat node table and names each way a node can fail', () => {
    expect(instancingBlockers({ nodes: [{ name: 'wall' }, { name: 'roof' }] })).toEqual([]);
    expect(instancingBlockers({ nodes: [{ name: 'roof', translation: [0, 1, 0] }] })).toEqual(['node 0 (roof) carries translation']);
    expect(instancingBlockers({ nodes: [{ name: 'a', matrix: [] }] })).toEqual(['node 0 (a) carries matrix']);
    expect(instancingBlockers({ nodes: [{ name: 'g', children: [1] }, { name: 'm' }] })).toEqual(['node 0 (g) has children']);
  });
});

describe('every shipped per-tile GLB can be drawn instanced', () => {
  it('finds the per-tile types (the loop below is not vacuous)', () => {
    expect(perTile.sort()).toEqual(['fence', 'hesco', 'sandbag_post', 'sandbag_wall', 't_wall', 'wall']);
  });

  for (const id of perTile) {
    for (const suffix of ['', '_wreck']) {
      it(`${id}${suffix}.glb has every mesh at the root frame`, () => {
        const file = path.join(ROOT, 'assets/meshes/buildings', `${id}${suffix}.glb`);
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(instancingBlockers(gltfJson(readFileSync(file)))).toEqual([]);
      });
    }
  }
});
