import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROP_KINDS, PROP_TRI_CAPS, isPropMeshRole } from '../../packages/render/src/three/terrain/prop-role';
import { glbHeight, glbJson, glbTris } from './decor-heights.test';

const PROPS = join(__dirname, '../../art/meshes/props');
interface Nodes { nodes: { mesh?: number; extras?: { rl_role?: string } }[]; materials?: unknown[]; images?: unknown[]; textures?: unknown[] }

describe.each(PROP_KINDS)('props/%s.glb (R-5, R-7)', (kind) => {
  const path = join(PROPS, `${kind}.glb`);
  it('exists', () => expect(existsSync(path)).toBe(true));
  const j = glbJson(path) as ReturnType<typeof glbJson> & Nodes;
  it('carries no material, image or texture', () => {
    expect(j.materials ?? []).toHaveLength(0);
    expect(j.images ?? []).toHaveLength(0);
    expect(j.textures ?? []).toHaveLength(0);
  });
  it('tags every mesh node with a prop role', () => {
    const meshNodes = j.nodes.filter((n) => n.mesh !== undefined);
    expect(meshNodes.length).toBeGreaterThan(0);
    for (const n of meshNodes) expect(isPropMeshRole(n.extras?.rl_role ?? '')).toBe(true);
  });
  it('stays under its triangle cap', () => {
    expect(glbTris(j)).toBeLessThanOrEqual(PROP_TRI_CAPS[kind]);
  });
  it('stands on the ground and is no taller than 1.7 m', () => {
    expect(glbHeight(j)).toBeLessThanOrEqual(1.7);
  });
});
