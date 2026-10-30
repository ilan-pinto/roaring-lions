/**
 * Placing the Wadi Halam backdrop kit (GH-161): the placement convention, the
 * per-vertex height bake, the winding, and the seams, over the SHIPPED kit's
 * own bytes. Pure, node environment, no WebGL.
 *
 * Every expectation is a literal or comes from outside the module under test
 * (the layout tool's convention table is parsed out of `layout.py`), so a bug
 * in `backdrop-kit.ts` cannot agree with its own oracle.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assembleKit,
  FOOT_BURY,
  floorSurface,
  placePoint,
  type BackdropPiece,
  type KitPieceSource,
  type KitSource,
} from './backdrop-kit';
import { readKitFixture, repoPath } from './backdrop-kit-fixture';

const kit = readKitFixture();

/** A flat floor at height `y`, 1-tile lattice from -60 to 110. */
function flat(y: number): ReturnType<typeof floorSurface> {
  const n = 171;
  return floorSurface(new Float32Array(n * n).fill(y), -60, -60, n, n);
}

/** A tilted floor: y = 0.1 x + 0.05 z. */
function tilted(): ReturnType<typeof floorSurface> {
  const n = 171;
  const g = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = 0.1 * (i - 60) + 0.05 * (j - 60);
  return floorSurface(g, -60, -60, n, n);
}

describe('the placement convention', () => {
  // A point 3 tiles out from the inner edge (gx = -3) and 2 tiles along `s` (gz = -2: s = -gz).
  const P: [number, number, number] = [-3, 1, -2];
  const at: [number, number] = [10, 20];
  // Literals, worked by hand from the layout tool's table: rot 0 stands on the WEST side (extends -x, s runs
  // north = -z), 90 the NORTH side (extends -z, s runs east), 180 EAST (extends +x, s south), 270 SOUTH.
  const WANT: [0 | 90 | 180 | 270, number, number][] = [
    [0, 10 - 3, 20 - 2],
    [90, 10 + 2, 20 - 3],
    [180, 10 + 3, 20 + 2],
    [270, 10 - 2, 20 + 3],
  ];
  for (const [rot, x, z] of WANT) {
    it(`rot ${rot} puts the piece on its side and runs s the layout tool's way`, () => {
      const [px, py, pz] = placePoint({ id: 'bd_terrace_a', at, rot }, flat(0), P);
      expect([px, pz]).toEqual([x, z].map((v) => expect.closeTo(v, 9)));
      expect(py).toBeCloseTo(1 - FOOT_BURY, 9);
    });
  }

  it('mirror flips the along-edge axis and nothing else', () => {
    const a = placePoint({ id: 'bd_terrace_a', at, rot: 0 }, flat(0), P);
    const b = placePoint({ id: 'bd_terrace_a', at, rot: 0, mirror: true }, flat(0), P);
    expect(b[0]).toBeCloseTo(a[0], 9);
    expect(b[2]).toBeCloseTo(20 + 2, 9); // s = 2 flipped to -2: south instead of north
    expect(a[2]).toBeCloseTo(20 - 2, 9);
  });

  it("agrees with layout.py's own along-edge table", () => {
    // layout.py: `d = {0: (0.0, -1.0), 90: (1.0, 0.0), 180: (0.0, 1.0), 270: (-1.0, 0.0)}` -- where +s points.
    const py = readFileSync(repoPath('tools/backdrop/layout.py'), 'utf8');
    const m = /d = \{0: \(([^)]*)\), 90: \(([^)]*)\), 180: \(([^)]*)\), 270: \(([^)]*)\)\}/.exec(py);
    expect(m, 'along_dir table not found in tools/backdrop/layout.py').not.toBeNull();
    const table = (m as RegExpExecArray).slice(1).map((s) => s.split(',').map(Number));
    [0, 90, 180, 270].forEach((rot, k) => {
      // s = +1 (gz = -1) from the origin: where does it land relative to `at`?
      const [x, , z] = placePoint({ id: 'bd_terrace_a', at: [0, 0], rot: rot as 0 }, flat(0), [0, 0, -1]);
      expect([x, z]).toEqual([expect.closeTo(table[k][0], 9), expect.closeTo(table[k][1], 9)]);
    });
  });
});

describe('heights are baked per vertex from the floor', () => {
  it('stands each vertex on the floor under it, plus lift and the scaled local height', () => {
    const src = kit.pieces.get('bd_wall_far_a') as KitPieceSource;
    const one: KitSource = { pieces: new Map([['bd_wall_far_a', src]]) };
    const pl: BackdropPiece = { id: 'bd_wall_far_a', at: [0, 8], rot: 0, ys: 1.2, lift: 0.5 };
    const placed = assembleKit({ pieces: [pl] }, one, flat(3));
    for (let k = 0; k < src.positions.length / 3; k += 37) {
      expect(placed.positions[k * 3 + 1]).toBeCloseTo(3 + 0.5 + 1.2 * src.positions[k * 3 + 1] - FOOT_BURY, 5);
    }
  });

  it('follows a sloping floor vertex by vertex (not one base per piece)', () => {
    const src = kit.pieces.get('bd_terrace_a') as KitPieceSource;
    const one: KitSource = { pieces: new Map([['bd_terrace_a', src]]) };
    const floor = tilted();
    const placed = assembleKit({ pieces: [{ id: 'bd_terrace_a', at: [0, 20], rot: 0 }] }, one, floor);
    const out = new Float64Array(3);
    let spread = 0;
    for (let k = 0; k < src.positions.length / 3; k += 11) {
      floor.sample(placed.positions[k * 3], placed.positions[k * 3 + 2], out);
      expect(placed.positions[k * 3 + 1]).toBeCloseTo(out[0] + src.positions[k * 3 + 1] - FOOT_BURY, 5);
      spread = Math.max(spread, Math.abs(out[0] - (0.1 * 0 + 0.05 * 20)));
    }
    expect(spread, 'the test floor must actually slope under the piece').toBeGreaterThan(1);
  });

  it('adds the floor slope to the normal, to first order', () => {
    const src = kit.pieces.get('bd_terrace_a') as KitPieceSource;
    const one: KitSource = { pieces: new Map([['bd_terrace_a', src]]) };
    const a = assembleKit({ pieces: [{ id: 'bd_terrace_a', at: [0, 20], rot: 0 }] }, one, flat(0));
    const b = assembleKit({ pieces: [{ id: 'bd_terrace_a', at: [0, 20], rot: 0 }] }, one, tilted());
    // y = 0.1 x: the surface tilts toward -x (the normal's x component falls) on the tilted floor.
    let sa = 0;
    let sb = 0;
    for (let k = 0; k < a.normals.length / 3; k++) {
      sa += a.normals[k * 3];
      sb += b.normals[k * 3];
    }
    expect(sb / (b.normals.length / 3)).toBeLessThan(sa / (a.normals.length / 3) - 0.05);
  });
});

/** The kit without its house: the winding checks are about landforms (a house's walls stand upright and face sideways). */
const bare: KitSource = { pieces: new Map([...kit.pieces].filter(([k]) => k !== 'bd_house')) };

describe('the placed kit is wound the right way up', () => {
  const pieces: BackdropPiece[] = [];
  for (const [id, rot, mirror] of [
    ['bd_wall_far_a', 0, false],
    ['bd_wall_far_b', 90, true],
    ['bd_slope_near_a', 180, false],
    ['bd_terrace_a', 270, true],
    ['bd_head_wall', 90, false],
    ['bd_outer_corner', 0, true],
  ] as [string, 0 | 90 | 180 | 270, boolean][]) {
    pieces.push({ id, at: [30, 30], rot, mirror });
  }
  it('gives every front face an upward geometric normal, mirrored or not', () => {
    for (const pl of pieces) {
      const placed = assembleKit({ pieces: [pl] }, bare, flat(0));
      let up = 0;
      let total = 0;
      for (let t = 0; t < placed.indices.length; t += 3) {
        const [a, b, c] = [placed.indices[t], placed.indices[t + 1], placed.indices[t + 2]];
        const p = placed.positions;
        const ux = p[b * 3] - p[a * 3];
        const uy = p[b * 3 + 1] - p[a * 3 + 1];
        const uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3];
        const vy = p[c * 3 + 1] - p[a * 3 + 1];
        const vz = p[c * 3 + 2] - p[a * 3 + 2];
        const ny = uz * vx - ux * vz; // the y of u x v
        if (Math.abs(ny) < 1e-9 && Math.abs(uy * vz - uz * vy) + Math.abs(ux * vy - uy * vx) < 1e-9) continue; // degenerate
        total++;
        if (ny > 0) up++;
      }
      expect(total, `${pl.id} has triangles`).toBeGreaterThan(500);
      // The stored normals must agree with the winding: a sign or transposition error in the rotation, the mirror or
      // the Y scale of the NORMALS would leave the geometry right and the lighting wrong.
      let agree = 0;
      let counted = 0;
      for (let t = 0; t < placed.indices.length; t += 3) {
        const [a, b, c] = [placed.indices[t], placed.indices[t + 1], placed.indices[t + 2]];
        const p = placed.positions;
        const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const len = Math.hypot(fx, fy, fz);
        if (len < 1e-9) continue;
        const n = placed.normals;
        const mx = n[a * 3] + n[b * 3] + n[c * 3], my = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], mz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
        counted++;
        if ((fx * mx + fy * my + fz * mz) / len > 0.3) agree++;
      }
      expect(agree / counted, `${pl.id} rot ${pl.rot} mirror ${pl.mirror}: share of triangles whose normals agree with their winding`).toBeGreaterThan(0.99);
      expect(up / total, `${pl.id} rot ${pl.rot} mirror ${pl.mirror}: share of front faces facing up`).toBeGreaterThan(0.995);
    }
  });
});

describe('neighbouring pieces share their seam, base height included', () => {
  it('two walls side by side agree in plan AND in height along the shared edge', () => {
    // The layout's west walls: slots at z = 8 and z = 24 share the edge z = 16. On a SLOPING floor, a base set
    // per piece (the render-2 mock's tilt between two ends) would disagree somewhere along the seam.
    const floor = tilted();
    const A = assembleKit({ pieces: [{ id: 'bd_wall_far_a', at: [0, 8], rot: 0 }] }, kit, floor);
    const B = assembleKit({ pieces: [{ id: 'bd_wall_far_b', at: [0, 24], rot: 0 }] }, kit, floor);
    const key = (x: number, z: number): string => `${x.toFixed(3)},${z.toFixed(3)}`;
    const onSeam = new Map<string, number>();
    for (let k = 0; k < B.positions.length / 3; k++) {
      if (Math.abs(B.positions[k * 3 + 2] - 16) < 1e-3) onSeam.set(key(B.positions[k * 3], B.positions[k * 3 + 2]), B.positions[k * 3 + 1]);
    }
    let matched = 0;
    let worst = 0;
    for (let k = 0; k < A.positions.length / 3; k++) {
      if (Math.abs(A.positions[k * 3 + 2] - 16) >= 1e-3) continue;
      const yb = onSeam.get(key(A.positions[k * 3], A.positions[k * 3 + 2]));
      if (yb === undefined) continue;
      matched++;
      worst = Math.max(worst, Math.abs(yb - A.positions[k * 3 + 1]));
    }
    expect(matched, 'seam vertices that coincide in plan').toBeGreaterThan(60);
    // Profile W is shared to a few centimetres (render-2 notes); 0.05 tile is 15 cm.
    expect(worst).toBeLessThan(0.05);
  });
});

describe('houses and olives', () => {
  it('plants olives on the terrace treads and houses at the anchors, deterministically', () => {
    const spec = { pieces: [{ id: 'bd_terrace_a', at: [0, 20], rot: 0 }, { id: 'bd_terrace_b', at: [0, 28], rot: 0 }] as BackdropPiece[] };
    const a = assembleKit(spec, kit, flat(0));
    const b = assembleKit(spec, kit, flat(0));
    expect(a.olives.length).toBe(28 + 22); // the sidecar counts of the two pieces in the stats.json of render-2
    expect(a.houses.length).toBe(3); // terrace a carries two anchors, b one
    expect(b.olives).toEqual(a.olives);
    expect(b.houses).toEqual(a.houses);
    // an olive stands on a tread: its height is the tread's, not the floor's
    expect(Math.min(...a.olives.map((o) => o.y))).toBeGreaterThan(0.05);
  });

  it('drops a house whose roof would stand above the near-side cap', () => {
    const spec = { pieces: [{ id: 'bd_terrace_a', at: [0, 20], rot: 0 }] as BackdropPiece[] };
    expect(assembleKit(spec, kit, flat(0), () => Infinity).houses.length).toBe(2);
    expect(assembleKit(spec, kit, flat(0), () => 0.01).houses.length).toBe(0);
  });
});

describe('the hamlet houses are baked into the kit mesh', () => {
  const spec = { pieces: [{ id: 'bd_terrace_a', at: [-0.52, 20], rot: 0 }, { id: 'bd_slope_near_a', at: [48, 8], rot: 180 }] as BackdropPiece[] };
  const bareKit = bare;

  it('adds 14 triangles per house to the full mesh and to the LOD1 twin, and no draw call of its own', () => {
    const withH = assembleKit(spec, kit, flat(0));
    const without = assembleKit(spec, bareKit, flat(0));
    expect(withH.houses.length).toBeGreaterThan(3);
    expect(without.houses.length).toBe(withH.houses.length); // the same anchors either way
    expect(withH.triangles - without.triangles).toBe(14 * withH.houses.length);
    expect(withH.lod1.triangles - without.lod1.triangles).toBe(14 * withH.houses.length);
  });

  it('plants each house at its anchor, scaled and turned, with its UVs on the three swatches', () => {
    const one = assembleKit({ pieces: [spec.pieces[0]] }, kit, flat(0));
    const base = assembleKit({ pieces: [spec.pieces[0]] }, bareKit, flat(0));
    const nv = base.positions.length / 3;
    const hs = one.houses[0];
    const nh = (kit.pieces.get('bd_house')?.positions.length ?? 0) / 3; // flat shading: a vertex per corner per face
    expect(nh).toBeGreaterThan(12);
    // the first house's first vertex is the box corner (-1.5, 0, ...) in metres: stands on the anchor, within its size
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = nv; k < nv + nh; k++) {
      minY = Math.min(minY, one.positions[k * 3 + 1]);
      maxY = Math.max(maxY, one.positions[k * 3 + 1]);
      expect(Math.hypot(one.positions[k * 3] - hs.x, one.positions[k * 3 + 2] - hs.z)).toBeLessThanOrEqual(hs.size * (1.74 * Math.SQRT2) / 3 + 1e-6);
    }
    expect(minY).toBeCloseTo(hs.y, 5);
    expect(maxY - minY).toBeCloseTo((3.9 * hs.size) / 3, 4); // body 2.7 m + roof 1.2 m, in tiles
    // UVs: every house corner lands on a swatch centre of the olive patch (three distinct points)
    const uvs = new Set<string>();
    for (let k = nv; k < nv + nh; k++) uvs.add(`${one.uvs[k * 2].toFixed(5)},${one.uvs[k * 2 + 1].toFixed(5)}`);
    expect(uvs.size).toBe(3);
    // unit normals
    for (let k = nv; k < nv + nh; k++) expect(Math.hypot(one.normals[k * 3], one.normals[k * 3 + 1], one.normals[k * 3 + 2])).toBeCloseTo(1, 4);
  });
});

describe('a bad placement is refused, not drawn', () => {
  it('names the missing piece', () => {
    expect(() => assembleKit({ pieces: [{ id: 'bd_nope', at: [0, 0], rot: 0 }] }, kit, flat(0))).toThrow(/bd_nope/);
  });
  it('refuses the olive as a placed piece and a Y scale outside 0.75-1.35', () => {
    expect(() => assembleKit({ pieces: [{ id: 'bd_olive', at: [0, 0], rot: 0 }] }, kit, flat(0))).toThrow(/bd_olive/);
    expect(() => assembleKit({ pieces: [{ id: 'bd_crest_a', at: [0, 0], rot: 0, ys: 2 }] }, kit, flat(0))).toThrow(/ys/);
    expect(() => assembleKit({ pieces: [{ id: 'bd_crest_a', at: [0, 0], rot: 45 as 0 }] }, kit, flat(0))).toThrow(/quarter turn/);
  });
});

describe('floorSurface', () => {
  it('interpolates the same triangles the floor mesh draws (a c b / b c d, diagonal b-c)', () => {
    // One cell with corner heights a=0 (0,0) b=10 (1,0) c=20 (0,1) d=100 (1,1). Along the b-c diagonal the two
    // triangles meet: (0.5, 0.5) is 15 from either side. Off the diagonal they differ from a bilinear patch.
    const s = floorSurface(Float32Array.from([0, 10, 20, 100]), 0, 0, 2, 2);
    const out = new Float64Array(3);
    s.sample(0.5, 0.5, out);
    expect(out[0]).toBeCloseTo(15, 6);
    s.sample(0.25, 0.25, out); // triangle a c b: 0 + 0.25*10 + 0.25*20
    expect(out[0]).toBeCloseTo(7.5, 6);
    expect([out[1], out[2]]).toEqual([10, 20]);
    s.sample(0.75, 0.75, out); // triangle b c d: d + (1-u)(c-d) + (1-v)(b-d) = 100 - 0.25*80 - 0.25*90
    expect(out[0]).toBeCloseTo(57.5, 6);
    expect([out[1], out[2]]).toEqual([80, 90]);
    // a bilinear patch would give 0*(.75*.75)... = 10*.75*.25 + 20*.25*.75 + 100*.75*.75 = 61.875: not this surface
    expect(out[0]).not.toBeCloseTo(61.875, 1);
  });
});
