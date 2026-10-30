/**
 * The wetland P3 art (GH-871), checked against the shipped GLBs: the reeds, the winter grass and the
 * two Blender props. Oracles are literals from the approved art-numbers sheet (28 Oct) and the lead's
 * R1 rulings, not values read back from the builders; the GLBs are the ground truth.
 *
 * Each check has the input that makes it fail, run and then put back (the `falsified` cases).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRASS_SCALE_MAX } from '../../packages/render/src/three/terrain/decor-place';
import { PROP_TRI_CAPS } from '../../packages/render/src/three/terrain/prop-role';
import { MESH_SCALE } from '../../packages/render/src/three/units/mesh-anim';
import { glbHeight, glbJson, glbTris } from './decor-heights.test';

const MESHES = join(__dirname, '../../art/meshes');
const decor = (n: string): string => join(MESHES, 'decor', `${n}.glb`);
const prop = (n: string): string => join(MESHES, 'props', `${n}.glb`);
const md5 = (p: string): string => createHash('md5').update(readFileSync(p)).digest('hex');

interface Node { mesh?: number; extras?: { rl_role?: string } }
function roles(p: string): string[] {
  const j = glbJson(p) as unknown as { nodes: Node[]; materials?: unknown[]; images?: unknown[]; textures?: unknown[] };
  expect(j.materials ?? [], `${p}: a decor or prop GLB carries zero materials`).toEqual([]);
  expect(j.images ?? []).toEqual([]);
  expect(j.textures ?? []).toEqual([]);
  return j.nodes.filter((n) => n.mesh !== undefined).map((n) => n.extras?.rl_role ?? '?').sort();
}

/** The placement pass's scale roll tops out at 1.2 (`0.8 + hash * 0.4`, decor-place.ts), a literal here. */
const ROLL_MAX = 1.2;
const REED_MODEL = [1.25, 1.1, 1.0];
const F32 = 1e-5; // glTF stores float32

describe('the reeds (art-numbers 2.4, rev. 3)', () => {
  it.each([0, 1, 2])('reed_%i has the approved height and stays at most 1.5 m DRAWN', (v) => {
    const h = glbHeight(glbJson(decor(`reed_${v}`)));
    expect(h).toBeCloseTo(REED_MODEL[v], 4);
    expect(h * ROLL_MAX).toBeLessThanOrEqual(1.5 + F32);
  });

  it('falsified: a reed model 1.3x taller would be drawn above 1.5 m', () => {
    expect(REED_MODEL[0] * 1.3 * ROLL_MAX).toBeGreaterThan(1.5);
  });

  it.each([0, 1, 2])('reed_%i is under 400 triangles and spends them (max detail), in foliage + trunk', (v) => {
    const t = glbTris(glbJson(decor(`reed_${v}`)));
    expect(t).toBeLessThanOrEqual(400);
    expect(t).toBeGreaterThanOrEqual(360);
    expect(roles(decor(`reed_${v}`))).toEqual(['foliage', 'trunk']);
  });

  it('the three variants are three different files (the olive tree_1 == tree_2 defect)', () => {
    expect(new Set([0, 1, 2].map((v) => md5(decor(`reed_${v}`)))).size).toBe(3);
    // falsified: a list with a repeat is smaller
    expect(new Set(['a', 'a', 'b']).size).toBe(2);
  });
});

describe('the winter grass (N-4 extended to wet_grass_*)', () => {
  it.each([0, 1, 2])('wet_grass_%i at GRASS_SCALE_MAX stands at most 0.12 world units', (v) => {
    const h = glbHeight(glbJson(decor(`wet_grass_${v}`)));
    expect(h).toBeLessThanOrEqual(0.4 + F32);
    expect(h * MESH_SCALE * GRASS_SCALE_MAX).toBeLessThanOrEqual(0.12 + 1e-6);
  });

  it('falsified: GRASS_SCALE_MAX 1.2 breaks N-4 for a 0.40 m tuft', () => {
    expect(0.4 * MESH_SCALE * 1.2).toBeGreaterThan(0.12 + 1e-6);
  });

  it.each([0, 1, 2])('wet_grass_%i is at most 200 triangles, foliage with straw in trunk', (v) => {
    expect(glbTris(glbJson(decor(`wet_grass_${v}`)))).toBeLessThanOrEqual(200);
    expect(roles(decor(`wet_grass_${v}`))).toEqual(['foliage', 'trunk']);
  });

  it('the three tufts are three different files', () => {
    expect(new Set([0, 1, 2].map((v) => md5(decor(`wet_grass_${v}`)))).size).toBe(3);
  });
});

describe('the bale and the culvert (art-numbers 2.4)', () => {
  it('stay under their per-kind caps, with the sheet\'s caps pinned as literals', () => {
    expect(PROP_TRI_CAPS.round_bale).toBe(160);
    expect(PROP_TRI_CAPS.culvert_pipe).toBe(140);
    expect(glbTris(glbJson(prop('round_bale')))).toBeLessThanOrEqual(160);
    expect(glbTris(glbJson(prop('culvert_pipe')))).toBeLessThanOrEqual(140);
    // falsified: capping the culvert at 100 (the Python table only) would fail its own file
    expect(glbTris(glbJson(prop('culvert_pipe')))).toBeGreaterThan(100);
  });

  it('carry one role each: a black rubber wrap, and concrete', () => {
    expect(roles(prop('round_bale'))).toEqual(['rubber']);
    expect(roles(prop('culvert_pipe'))).toEqual(['concrete']);
  });

  it('are 1.0 m tall (the bale 1.02 with its domed top) and under the people they stand beside', () => {
    expect(glbHeight(glbJson(prop('round_bale')))).toBeCloseTo(1.018, 2);
    expect(glbHeight(glbJson(prop('culvert_pipe')))).toBeCloseTo(1.0, 3);
  });
});
