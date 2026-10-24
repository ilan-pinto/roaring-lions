/**
 * The swarm drone's GLB (E6, GH-274 chunk A1), read from the shipped bytes: the numbers the
 * brief fixed -- three nodes and roles, at most 800 triangles, a 0.75 m rotor span, the bomb's
 * bottom on the ground -- and the two scene extras the swarm draw (chunk B) will read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = new URL('../../art/meshes/vehicles/drone_swarm.glb', import.meta.url);

interface Accessor { count: number; min?: number[]; max?: number[]; type: string }
interface Gltf {
  nodes: { name: string; mesh?: number; extras?: Record<string, unknown> }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: Accessor[];
  materials?: unknown[];
  scenes: { extras?: { rl_rotors?: number[][]; rl_bomb?: number[] } }[];
}

function load(): Gltf {
  const d = readFileSync(PATH);
  const n = d.readUInt32LE(12);
  return JSON.parse(d.subarray(20, 20 + n).toString('utf8')) as Gltf;
}

const g = load();
const live = g.nodes.filter((n) => n.mesh !== undefined && !n.name.startsWith('WRECK_'));
const trisOf = (n: { mesh?: number }) =>
  g.meshes[n.mesh!]!.primitives.reduce((a, p) => a + g.accessors[p.indices]!.count / 3, 0);
const boundsOf = () => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const n of live) {
    for (const p of g.meshes[n.mesh!]!.primitives) {
      const a = g.accessors[p.attributes.POSITION]!;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, a.min![k]!);
        hi[k] = Math.max(hi[k]!, a.max![k]!);
      }
    }
  }
  return { lo, hi };
};

describe('drone_swarm.glb', () => {
  it('is three palette nodes with the vehicle roles and no material', () => {
    expect(live.map((n) => n.name).sort()).toEqual(['hull_hull', 'hull_metal', 'rotor_rubber']);
    expect(Object.fromEntries(live.map((n) => [n.name, n.extras?.rl_role]))).toEqual({
      hull_hull: 'hull', hull_metal: 'metal', rotor_rubber: 'rubber',
    });
    expect(g.materials ?? []).toHaveLength(0);
  });

  it('is 650-780 triangles, under the 800 cap', () => {
    const total = live.reduce((a, n) => a + trisOf(n), 0);
    expect(total).toBeGreaterThanOrEqual(650);
    expect(total).toBeLessThanOrEqual(780);
  });

  it('spans 0.75 m rotor tip to tip and stands the bomb on the ground', () => {
    const { lo, hi } = boundsOf();
    expect(Math.max(hi[0]! - lo[0]!, hi[2]! - lo[2]!)).toBeCloseTo(0.75, 2);
    expect(lo[1]).toBeCloseTo(0, 3);
    expect((hi[0]! + lo[0]!) / 2).toBeCloseTo(0, 3);
    expect((hi[2]! + lo[2]!) / 2).toBeCloseTo(0, 3);
  });

  it('records four rotors (hub, radius) and the bomb centre in the GLB frame', () => {
    const { lo, hi } = boundsOf();
    const ex = g.scenes[0]!.extras!;
    expect(ex.rl_rotors).toHaveLength(4);
    for (const [x, y, z, r] of ex.rl_rotors!) {
      // the hub sits inside the footprint, and the disc (radius r) reaches no further than the
      // frame's corner: blades lie a quarter turn off their boom, so a disc may pass the bbox side
      expect(Math.abs(x!)).toBeLessThan(hi[0]!);
      expect(Math.hypot(x!, z!) + r!).toBeLessThanOrEqual(Math.hypot(hi[0]!, hi[2]!) + 0.02);
      expect(Math.abs(z!)).toBeGreaterThan(0.2);
      expect(y!).toBeGreaterThan(0.2);
      expect(r).toBeGreaterThan(0.1);
      expect(r).toBeLessThan(0.2);
    }
    // two hubs on each side of the body in both axes: the X frame
    expect(new Set(ex.rl_rotors!.map((h) => `${Math.sign(h[0]!)}${Math.sign(h[2]!)}`)).size).toBe(4);
    const [bx, by, bz] = ex.rl_bomb!;
    expect(Math.abs(bx!)).toBeLessThan(0.02);
    expect(Math.abs(bz!)).toBeLessThan(0.02);
    expect(by!).toBeGreaterThan(lo[1]!);
    expect(by!).toBeLessThan(0.15);
  });
});
