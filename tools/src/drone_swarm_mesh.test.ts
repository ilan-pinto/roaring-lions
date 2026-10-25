/**
 * The swarm drone's GLB (E6, GH-274 chunk A1), read from the shipped bytes: the numbers the
 * brief fixed -- three nodes and roles, at most 800 triangles, a 0.75 m rotor span, the bomb's
 * bottom on the ground -- and the two scene extras the swarm draw (chunk B) will read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = new URL('../../art/meshes/vehicles/drone_swarm.glb', import.meta.url);

interface Accessor { count: number; min?: number[]; max?: number[]; type: string; bufferView: number; byteOffset?: number }
interface Gltf {
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  nodes: { name: string; mesh?: number; extras?: Record<string, unknown> }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: Accessor[];
  materials?: unknown[];
  scenes: { extras?: { rl_rotors?: number[][]; rl_bomb?: number[] } }[];
}

const data = readFileSync(PATH);

function load(): Gltf {
  const n = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + n).toString('utf8')) as Gltf;
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

/** The POSITION vertices of a node's mesh, read from the GLB's BIN chunk (float32 VEC3). */
function vertices(n: { mesh?: number }): number[][] {
  const jsonLen = data.readUInt32LE(12);
  const binStart = 20 + jsonLen + 8; // the BIN chunk's header is 8 bytes
  const out: number[][] = [];
  for (const p of g.meshes[n.mesh!]!.primitives) {
    const a = g.accessors[p.attributes.POSITION]!;
    const bv = g.bufferViews[a.bufferView]!;
    const stride = bv.byteStride ?? 12;
    const base = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++) {
      out.push([0, 4, 8].map((o) => data.readFloatLE(base + i * stride + o)));
    }
  }
  return out;
}

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
    // Each recorded hub against the rotor MESH, which the exporter's own arithmetic did not produce:
    // the hub's y lies inside the rotor_rubber blades' y range (they are 12 mm slabs), and its xz is the
    // centre of the disc whose vertices fill that hub's quadrant (a two-blade rotor is symmetric about its hub).
    const rotor = live.find((n) => n.name === 'rotor_rubber')!;
    const rv = vertices(rotor);
    const ys = rv.map((v) => v[1]!);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);
    expect(yHi - yLo).toBeLessThan(0.05); // the blades are thin, so "inside the range" pins y tightly
    for (const [x, y, z, r] of ex.rl_rotors!) {
      expect(y!).toBeGreaterThanOrEqual(yLo - 1e-4);
      expect(y!).toBeLessThanOrEqual(yHi + 1e-4);
      const quad = rv.filter((v) => Math.sign(v[0]!) === Math.sign(x!) && Math.sign(v[2]!) === Math.sign(z!));
      expect(quad.length).toBeGreaterThan(0);
      const cx = (Math.min(...quad.map((v) => v[0]!)) + Math.max(...quad.map((v) => v[0]!))) / 2;
      const cz = (Math.min(...quad.map((v) => v[2]!)) + Math.max(...quad.map((v) => v[2]!))) / 2;
      expect(x!).toBeCloseTo(cx, 2);
      expect(z!).toBeCloseTo(cz, 2);
      // and the disc's reach from that centre is the recorded radius
      const reach = Math.max(...quad.map((v) => Math.hypot(v[0]! - cx, v[2]! - cz)));
      expect(reach).toBeGreaterThan(r! - 0.02);
      expect(reach).toBeLessThan(r! + 0.02);
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
