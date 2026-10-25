/**
 * The Remetz Laser Carrier's GLB (E6, GH-274 chunk A2), read from the shipped bytes: the node
 * graph and roles, the textured-hull / palette-turret split, the 10,000-triangle cap, the length,
 * the turret pivot and the `rl_fire` muzzle -- and the two things the beam VFX (chunk C) will read:
 * that the muzzle is TURRET-LOCAL (relative to `turret_pivot`) and sits on the aperture glass.
 *
 * Every oracle here is a literal measured off the exported bytes on 25 Oct, or a fact about the
 * file taken independently of the exporter's own constants.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { beforeAll, describe, expect, it } from 'vitest';

const FILE = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'art', 'meshes', 'vehicles', 'aa_remetz.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

let doc: Document;
beforeAll(async () => {
  doc = await io.read(FILE);
});

const nodes = (): Node[] => doc.getRoot().listNodes();
const live = (): Node[] =>
  nodes().filter((n) => n.getMesh() && !n.getName().startsWith('WRECK_'));
const byName = (name: string): Node => {
  const n = nodes().find((x) => x.getName() === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
};
const positions = (n: Node): Float32Array => n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
const tris = (n: Node): number => n.getMesh()!.listPrimitives().reduce((a, p) => a + p.getIndices()!.getCount() / 3, 0);
const extrasOf = (n: Node): Record<string, unknown> => n.getExtras() ?? {};

describe('aa_remetz.glb', () => {
  it('is six nodes with the vehicle roles: a textured hull and tyres, a palette turret, column and stack', () => {
    expect(live().map((n) => n.getName()).sort()).toEqual([
      'hull_hull', 'hull_metal', 'hull_rubber', 'turret_glass', 'turret_hull', 'turret_metal',
    ]);
    expect(Object.fromEntries(live().map((n) => [n.getName(), extrasOf(n).rl_role]))).toEqual({
      hull_hull: 'hull', hull_metal: 'metal', hull_rubber: 'rubber',
      turret_glass: 'glass', turret_hull: 'hull', turret_metal: 'metal',
    });
  });

  it('carries the Meshy bake on exactly the hull and the tyres; every Blender part has no material', () => {
    const material = (n: Node) => n.getMesh()!.listPrimitives()[0]!.getMaterial();
    for (const name of ['hull_hull', 'hull_rubber']) {
      const m = material(byName(name));
      expect(m, name).not.toBeNull();
      expect(m!.getBaseColorTexture(), `${name} base colour`).not.toBeNull();
    }
    for (const name of ['hull_metal', 'turret_hull', 'turret_metal', 'turret_glass']) {
      expect(material(byName(name)), name).toBeNull();
    }
  });

  it('is under the 10,000-triangle cap, with a real turret (the Blender parts are most of 1,900)', () => {
    const total = live().reduce((a, n) => a + tris(n), 0);
    expect(total).toBeLessThanOrEqual(10000);
    expect(total).toBeGreaterThanOrEqual(9400);
    expect(tris(byName('hull_hull'))).toBe(5236);
    expect(tris(byName('hull_rubber'))).toBe(2457);
    expect(tris(byName('turret_hull'))).toBeGreaterThanOrEqual(250);
    expect(tris(byName('turret_metal'))).toBeGreaterThanOrEqual(800);
  });

  it('is 7.6 m long with its ground at y = 0 and the whole hull roof under 3.9 m', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const n of live()) {
      const p = positions(n);
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, p[i + k]!);
          hi[k] = Math.max(hi[k]!, p[i + k]!);
        }
      }
    }
    expect(hi[0]! - lo[0]!).toBeCloseTo(7.6, 2);
    expect(lo[1]).toBeCloseTo(0, 3);
    // the hatch box is cut away: nothing of the hull between the flange and the turret column stands over 3.81 m
    // within 0.8 m of the pivot, except the turret's own parts (the hull's mesh, not the column's)
    const p = positions(byName('hull_hull'));
    let worst = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.hypot(p[i]! + 1.387, p[i + 2]!) < 0.8) worst = Math.max(worst, p[i + 1]!);
    }
    expect(worst).toBeLessThan(3.82);
    expect(worst).toBeGreaterThan(3.7);
    // ...and the WHOLE roof, not just the patch round the pivot: the textured hull never stands over 3.88 m anywhere
    // (the roof, with its raised antenna mount, tops out at 3.878). The remesh's collapsed antenna whip -- one vertex
    // at (0.286, 4.298, 0.624), a three-triangle needle 0.43 m over its mount -- is clipped by the exporter, and this
    // is what keeps it clipped: nothing of `hull_hull` over the mount, and the turret's own parts are not in this mesh.
    let roof = -Infinity;
    for (let i = 0; i < p.length; i += 3) roof = Math.max(roof, p[i + 1]!);
    expect(roof).toBeLessThan(3.9);
    expect(roof).toBeGreaterThan(3.85);
  });

  it('has a turret_pivot at the column top with the turret parts under it and the column and stack not', () => {
    const pivot = byName('turret_pivot');
    expect(extrasOf(pivot).rl_pivot).toBe('turret');
    const t = pivot.getTranslation();
    expect(t[0]).toBeCloseTo(-1.387, 2);
    expect(t[1]).toBeCloseTo(4.1, 2);
    expect(Math.abs(t[2])).toBeLessThan(0.01);
    expect(pivot.listChildren().map((c) => c.getName()).sort()).toEqual(['turret_glass', 'turret_hull', 'turret_metal']);
    // the column does not turn
    expect(byName('hull_metal').getParentNode()).toBeNull();
  });

  it('records rl_fire.muzzle TURRET-LOCAL, the aperture centre measured on the turret_glass vertices, relative to the pivot', () => {
    const fire = (doc.getRoot().listScenes()[0]!.getExtras() as { rl_fire?: { muzzle?: number[] } }).rl_fire;
    expect(fire?.muzzle).toHaveLength(3);
    const [mx, my, mz] = fire!.muzzle! as [number, number, number];
    // Independent of the exporter: the disc's own extents (mesh space is the vehicle frame for a pivot child --
    // the node's translation cancels the pivot's) -- the middle across (y, z), the rim's plane along x -- less
    // the pivot. (Not the vertex MEAN: the file splits vertices for flat shading, which would weight the hub.)
    const g = positions(byName('turret_glass'));
    const pv = byName('turret_pivot').getTranslation();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, g[i + k]!);
        hi[k] = Math.max(hi[k]!, g[i + k]!);
      }
    }
    expect(mx).toBeCloseTo(hi[0]! - pv[0], 3);
    expect(my).toBeCloseTo((lo[1]! + hi[1]!) / 2 - pv[1], 3);
    expect(mz).toBeCloseTo((lo[2]! + hi[2]!) / 2 - pv[2], 3);
    // forward of the pivot (the aperture looks along +X), at the head's mid-height, on the centreline
    expect(mx).toBeGreaterThan(0.7);
    expect(mx).toBeLessThan(0.95);
    expect(my).toBeGreaterThan(0.5);
    expect(my).toBeLessThan(0.65);
    expect(Math.abs(mz)).toBeLessThan(0.01);
    // and it is NOT the vehicle-frame point: that would put the muzzle 4.1 m up
    expect(my).toBeLessThan(2);
  });

  it('has an aperture 0.9 m across (radius about 0.45) in a ring standing proud of the head', () => {
    const g = positions(byName('turret_glass'));
    let zlo = Infinity, zhi = -Infinity, ylo = Infinity, yhi = -Infinity;
    for (let i = 0; i < g.length; i += 3) {
      zlo = Math.min(zlo, g[i + 2]!); zhi = Math.max(zhi, g[i + 2]!);
      ylo = Math.min(ylo, g[i + 1]!); yhi = Math.max(yhi, g[i + 1]!);
    }
    expect((zhi - zlo) / 2).toBeCloseTo(0.45, 2);
    expect((yhi - ylo) / 2).toBeCloseTo(0.45, 2);
    // the ring's front (turret_metal) is further forward than the glass
    const m = positions(byName('turret_metal'));
    let ringFront = -Infinity;
    for (let i = 0; i < m.length; i += 3) ringFront = Math.max(ringFront, m[i]!);
    let glassFront = -Infinity;
    for (let i = 0; i < g.length; i += 3) glassFront = Math.max(glassFront, g[i]!);
    expect(ringFront - glassFront).toBeGreaterThan(0.1);
  });

  it('carries six spinning wheels, the front pair steering, and a wreck whose damaged copies are the four recipe meshes', () => {
    const rg = doc.getRoot().listScenes()[0]!.getExtras().rl_running_gear as { wheels: { steer: boolean }[]; tracks: unknown[] };
    expect(rg.wheels).toHaveLength(6);
    expect(rg.wheels.filter((w) => w.steer)).toHaveLength(2);
    expect(rg.tracks).toHaveLength(0);
    const damaged = nodes().filter((n) => 'rl_damage' in extrasOf(n)).map((n) => n.getName()).sort();
    expect(damaged).toEqual(['WRECK_hull_metal', 'WRECK_hull_rubber', 'WRECK_turret_glass', 'WRECK_turret_hull']);
    expect(nodes().some((n) => n.getName() === 'death_root')).toBe(true);
  });
});
