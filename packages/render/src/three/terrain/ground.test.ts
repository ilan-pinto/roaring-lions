/**
 * The ground mesh is where the palette guarantee either holds across the whole
 * screen or quietly stops applying. These tests assert it directly.
 */
import { describe, it, expect } from 'vitest';
import { buildGround } from './ground';
import { WORLD_PER_LEVEL } from './shared';
import { DECOR_RIDGE, DECOR_ROAD } from './shared';
import { SURFACE_OVERSHOOT_LEVELS, SURFACE_SUBDIVISIONS } from './surface';
import { PALETTE_HEXES } from './tones';
import { VIEW_DIRECTION } from '../camera';
import type { MeshData, TerrainInput } from './types';

type Vec3 = [number, number, number];

/** The Y of the mesh vertex at world `(x, z)`, or null if there is none. An
 *  `expectY` narrows it to a vertex at that height too, for the terrace
 *  corners where several vertices share a position. Positions are Float32,
 *  so both coordinates are compared with a tolerance rather than `===`. */
function vertexAt(m: MeshData, x: number, z: number, expectY?: number): number | null {
  for (let i = 0; i < m.positions.length; i += 3) {
    if (Math.abs(m.positions[i] - x) > 1e-5) continue;
    if (Math.abs(m.positions[i + 2] - z) > 1e-5) continue;
    if (expectY !== undefined && Math.abs(m.positions[i + 1] - expectY) > 1e-5) continue;
    return m.positions[i + 1];
  }
  return null;
}

function vertex(m: MeshData, i: number): Vec3 {
  return [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
}

/** Which of the four things `buildGround` emits a triangle belongs to,
 *  classified from its own vertices rather than from the builder's
 *  internals -- so a failure names the kind that broke. A flat top has three
 *  equal Y; an east wall three equal X; a south wall three equal Z; anything
 *  else is a patch of the interpolated surface. A smooth patch triangle can
 *  never be mistaken for a wall: its three corners always span two distinct
 *  X and two distinct Z. */
function kindOf(a: Vec3, b: Vec3, c: Vec3): 'tile top' | 'east face' | 'south face' | 'surface patch' {
  if (a[0] === b[0] && b[0] === c[0]) return 'east face';
  if (a[2] === b[2] && b[2] === c[2]) return 'south face';
  if (a[1] === b[1] && b[1] === c[1]) return 'tile top';
  return 'surface patch';
}

function sub(u: Vec3, v: Vec3): Vec3 {
  return [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
}
function cross(u: Vec3, v: Vec3): Vec3 {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

/** Triangles belonging to a vertical wall (east or south face). */
function countFaceTriangles(m: MeshData): number {
  let n = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const k = kindOf(vertex(m, m.indices[i]), vertex(m, m.indices[i + 1]), vertex(m, m.indices[i + 2]));
    if (k === 'east face' || k === 'south face') n++;
  }
  return n;
}

const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const,
};

function flat(w: number, h: number): TerrainInput {
  return {
    width: w, height: h, decor: null, elevation: null,
    blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h),
  };
}

describe('buildGround', () => {
  it('emits two triangles per tile on flat ground', () => {
    const m = buildGround(flat(4, 4), TONES, '#14150F');
    expect(m.indices.length).toBe(4 * 4 * 6);
  });

  it('every vertex colour is a palette entry', () => {
    // The guarantee. Phase 0 proved a LUT makes off-palette output
    // unrepresentable for shaded geometry; this is the equivalent claim for
    // terrain, which is unlit and carries its colour per vertex.
    //
    // Elevation varies here on purpose: flat ground alone never emits a side
    // face (drop is 0 in every direction), so a flat-only grid cannot see a
    // quantise skipped on a face colour -- it would exercise only the top
    // quad's tone and pass regardless. A stair pattern guarantees both the
    // x+1 and y+1 comparisons produce positive drops somewhere on the grid.
    const input = flat(8, 8);
    input.elevation = new Uint8Array(8 * 8).map((_, ti) => ((ti % 8) + Math.floor(ti / 8)) % 6);
    const m = buildGround(input, TONES, '#14150F');
    const entries = new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
    for (let i = 0; i < m.colors.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.colors[i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });

  it('litColors matches colors in length and vertex order, and is ALSO always a palette entry', () => {
    // The muzzle-flash ramp-shift effect (`../palette-material.ts`'s "The
    // muzzle-flash 'light'" doc comment) swaps a fragment's colour for
    // `litColors` wholesale, never blends the two -- so `litColors` has to
    // carry the SAME on-palette guarantee `colors` does, proven the same
    // direct way, not merely argued from `rampNeighbor` only ever returning
    // a ramp member (or its input unchanged).
    const input = flat(8, 8);
    input.elevation = new Uint8Array(8 * 8).map((_, ti) => ((ti % 8) + Math.floor(ti / 8)) % 6);
    const m = buildGround(input, TONES, '#14150F');
    expect(m.litColors).toBeDefined();
    expect(m.litColors!.length).toBe(m.colors.length);
    const entries = new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
    for (let i = 0; i < m.litColors!.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.litColors![i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });

  it('litColors is never DARKER than colors at the same vertex -- the "lit" step is a step TOWARD index 0, never away from it', () => {
    // Guards the actual direction, not just palette membership: a regression
    // that fed rampNeighbor a positive-but-wrong sign, or looked up the wrong
    // ramp, could still land on a valid palette entry while getting brighter
    // and darker backwards -- exactly the "index 0 is the LIGHTEST step"
    // mistake `palette-material.ts` warns has already cost three renders.
    // Luminance (perceptual weights, matching common practice) is a coarse
    // proxy for "brighter", but it is directionally reliable for the specific
    // tone/ramp pairs this map's TONES use, and every one of them is checked.
    const input = flat(8, 8);
    input.elevation = new Uint8Array(8 * 8).map((_, ti) => ((ti % 8) + Math.floor(ti / 8)) % 6);
    const m = buildGround(input, TONES, '#14150F');
    const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let i = 0; i < m.colors.length; i += 3) {
      const base = luminance(m.colors[i], m.colors[i + 1], m.colors[i + 2]);
      const lit = luminance(m.litColors![i], m.litColors![i + 1], m.litColors![i + 2]);
      expect(lit).toBeGreaterThanOrEqual(base - 1e-6);
    }
  });

  it("puts a tile's own CENTRE at exactly the height its elevation says", () => {
    // The claim that replaces "a tile top is a flat quad at its own height".
    // The surface interpolates between tile centres and PASSES THROUGH every
    // one of them: Catmull-Rom at t = 0 is `0.5 * (2 * p1)`, exact in binary
    // floating point. So the sim's integer and the renderer's continuous
    // surface still agree exactly wherever the sim actually looks, and a
    // unit standing on a tile centre stands where it always stood.
    //
    // `SURFACE_SUBDIVISIONS` is even, so the tile centre is itself a lattice
    // point of the emitted patch -- this reads a real vertex rather than
    // re-deriving one.
    const input = flat(2, 1);
    input.elevation = new Uint8Array([0, 3]);
    const m = buildGround(input, TONES, '#14150F');
    const centre = vertexAt(m, 1.5, 0.5);
    expect(centre, 'no vertex at tile (1,0)\'s own centre').not.toBeNull();
    // Precision 5, not 10: `MeshData.positions` is a Float32Array (fixed by
    // B2.2's shared types), and WORLD_PER_LEVEL is irrational (it runs
    // through sqrt2/tan), so round-tripping it through a 32-bit float loses
    // precision past ~7 decimal digits. Asking for 10 fails on every run
    // regardless of correctness; 5 still catches a wrong constant or a wrong
    // multiplication by a wide margin.
    expect(centre!).toBeCloseTo(3 * WORLD_PER_LEVEL, 5);
    // And the flat tile's own centre, on the same mesh.
    expect(vertexAt(m, 0.5, 0.5)!).toBeCloseTo(0, 5);
  });

  it('overshoots a step by a bounded amount, and that is Catmull-Rom, not a bug', () => {
    // C1 interpolation buys smooth normals and costs overshoot at a sharp
    // step -- about 6-7% of the step's own height, above the higher sample
    // and below the lower one. Pinned rather than hidden, because it is the
    // reason `terrain-parity.test.ts`'s bounding-box test can no longer
    // assert `minY >= 0` on a relief map. The steepest OPEN step on either
    // shipped relief map is 3 levels; a 3-level fixture here bounds what
    // they can produce.
    const input = flat(2, 1);
    input.elevation = new Uint8Array([0, 3]);
    const m = buildGround(input, TONES, '#14150F');
    let maxY = -Infinity;
    let minY = Infinity;
    for (let i = 1; i < m.positions.length; i += 3) {
      maxY = Math.max(maxY, m.positions[i]);
      minY = Math.min(minY, m.positions[i]);
    }
    expect(maxY / WORLD_PER_LEVEL).toBeGreaterThan(3);
    expect(maxY / WORLD_PER_LEVEL).toBeLessThan(3 + SURFACE_OVERSHOOT_LEVELS);
    expect(minY / WORLD_PER_LEVEL).toBeGreaterThan(-SURFACE_OVERSHOOT_LEVELS);
  });

  it('maps game (x, y) to three (x, height, y)', () => {
    // The world-space convention every later sub-plan depends on. If this
    // flips, terrain and units disagree about which way south is.
    //
    // A square grid cannot catch a transposed axis -- maxX and maxZ come out
    // 2 either way, swapped or not. width != height so a [y, topY, x] swap
    // is visible as a swapped bound, not silently absorbed by symmetry.
    const input = flat(3, 2);
    const m = buildGround(input, TONES, '#14150F');
    let maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      maxX = Math.max(maxX, m.positions[i]);
      maxZ = Math.max(maxZ, m.positions[i + 2]);
    }
    expect(maxX).toBeCloseTo(3, 10);
    expect(maxZ).toBeCloseTo(2, 10);
  });

  it('adds NO side face where two OPEN tiles differ in height -- open ground ramps', () => {
    // This assertion used to be the opposite ("adds a side face only where a
    // neighbour is lower", asserting a bigger mesh for the stepped grid), and
    // it is the assertion the stairs complaint was about. A drop between two
    // tiles the player can walk across is a SLOPE now, and a slope has no
    // wall to draw; the surface is continuous across the shared edge because
    // both tiles evaluate the same `smoothLevel` at the same points.
    //
    // Isolated on a grid big enough that the compared tile and everything
    // that reads its elevation sit away from the map edge. Every tile but
    // one holds elevation 2, and the lone tile at (2, 1) is the only thing
    // that changes between the two grids.
    const w = 4, h = 3;
    const varyAt = 1 * w + 2; // tile (2, 1): interior on every side
    const level = flat(w, h);
    level.elevation = new Uint8Array(w * h).fill(2);
    const stepped = flat(w, h);
    stepped.elevation = new Uint8Array(w * h).fill(2);
    stepped.elevation[varyAt] = 0;
    // Same triangle count: the dip changed the surface's SHAPE, not its
    // topology. (Both grids are non-flat, so both take the smooth path.)
    expect(buildGround(stepped, TONES, '#14150F').indices.length).toBe(
      buildGround(level, TONES, '#14150F').indices.length
    );
    // ...and the dip really is drawn, so this is not passing because nothing
    // happened.
    const dipped = vertexAt(buildGround(stepped, TONES, '#14150F'), 2.5, 1.5);
    expect(dipped!).toBeCloseTo(0, 5);
  });

  it('adds a side face where a BLOCKED tile stands above its neighbour -- a wall stays a wall', () => {
    // The other half of the terrace rule, and the half the `relief` golden
    // scenario photographs: `^` ridge and building footprints are `blocked`,
    // are drawn as flat terraces at their own integer height, and keep their
    // vertical faces. Same fixture as the open-ground case above, with the
    // one difference that decides it.
    const w = 4, h = 3;
    const wallAt = 1 * w + 2;
    const open = flat(w, h);
    open.elevation = new Uint8Array(w * h).fill(0);
    open.elevation[wallAt] = 3;
    const walled = flat(w, h);
    walled.elevation = new Uint8Array(w * h).fill(0);
    walled.elevation[wallAt] = 3;
    walled.blocked = new Uint8Array(w * h);
    walled.blocked[wallAt] = 1;

    const openMesh = buildGround(open, TONES, '#14150F');
    const walledMesh = buildGround(walled, TONES, '#14150F');
    // The blocked tile's own top is ONE flat quad (2 triangles) rather than
    // a subdivided patch, plus its two visible walls.
    const faceTriangles = countFaceTriangles(walledMesh);
    expect(faceTriangles, 'a blocked tile 3 levels above its neighbours draws east and south walls').toBeGreaterThan(0);
    expect(countFaceTriangles(openMesh), 'open ground draws no wall at all').toBe(0);
    // And the terrace really is flat at its own level, corner to corner.
    for (const [px, pz] of [[2, 1], [3, 1], [3, 2], [2, 2]] as const) {
      expect(vertexAt(walledMesh, px, pz, 3 * WORLD_PER_LEVEL)).not.toBeNull();
    }
  });

  it('treats off-map as elevation zero, so a rim tile shows its full face', () => {
    const rim = flat(1, 1);
    rim.elevation = new Uint8Array([4]);
    const m = buildGround(rim, TONES, '#14150F');
    expect(m.indices.length).toBeGreaterThan(6);
  });

  it('is deterministic', () => {
    // Flat ground alone never emits a side face, so comparing colors only
    // on flat(6, 6) never exercises positions, indices, or a single face
    // quad. A stair-step grid puts all three quad types, and their vertex
    // counts, in scope.
    const stair = (): TerrainInput => {
      const input = flat(6, 6);
      input.elevation = new Uint8Array(6 * 6).map((_, ti) => ((ti % 6) + Math.floor(ti / 6)) % 5);
      return input;
    };
    const a = buildGround(stair(), TONES, '#14150F');
    const b = buildGround(stair(), TONES, '#14150F');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it('every terrace top and every wall winds toward the camera, and every surface patch faces up', () => {
    // The winding contract, restated for a mesh that is no longer only flat
    // quads and vertical walls.
    //
    // What is unchanged: a terrace top, an east wall and a south wall must
    // all wind toward the camera. `VIEW_DIRECTION` (target -> camera) is
    // fixed and always points +X/+Y/+Z, so `(b - a) x (c - a)` must have a
    // positive dot with it. Those three are the geometry Pixi parity was
    // built on and none of them can be steep enough to turn away.
    //
    // What is new: an INTERPOLATED patch can legitimately turn its back on
    // this camera. The camera's pitch is 30 degrees, so ground sloping away
    // more steeply than about 3.2 levels per tile faces away from it --
    // measured, the steepest open ground on `qarn_hadid` reads 3.75 and on
    // `tel_marum` 4.01, and the closest triangle on a shipped map clears the
    // threshold by a dot product of 0.00001. That is why
    // `groundSurfaceMaterial` is `DoubleSide` (see its own comment) and why
    // demanding `d > 0` of a patch would be demanding the heightfield never
    // get steep. What IS demanded, and is the thing a wrong winding would
    // actually break, is that every patch triangle is non-degenerate and
    // consistently oriented -- its geometric normal has a POSITIVE Y, which
    // for a single-valued heightfield means "wound the same way up as the
    // ground it belongs to".
    //
    // The fixture is deliberately harsher than any shipped map: `% 5` steps
    // by 4 levels between adjacent open tiles, where the maps top out at 3.
    // Purely a MeshData property -- no THREE.Mesh, no GL context, exactly
    // what makes terrain testable under environment: 'node' at all.
    const input = flat(6, 6);
    input.elevation = new Uint8Array(6 * 6).map((_, ti) => ((ti % 6) + Math.floor(ti / 6)) % 5);
    const m = buildGround(input, TONES, '#14150F');
    const view: Vec3 = [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z];
    let patches = 0;
    let walls = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = vertex(m, m.indices[i]);
      const b = vertex(m, m.indices[i + 1]);
      const c = vertex(m, m.indices[i + 2]);
      const normal = cross(sub(b, a), sub(c, a));
      const kind = kindOf(a, b, c);
      const where = `${kind} at triangle ${i / 3} (indices ${i}-${i + 2})`;
      if (kind === 'surface patch') {
        patches++;
        expect(normal[1], `${where} is degenerate or wound upside down`).toBeGreaterThan(0);
      } else {
        if (kind !== 'tile top') walls++;
        expect(dot(normal, view), `${where} winds away from the camera`).toBeGreaterThan(0);
      }
    }
    // Neither branch is passing by checking nothing.
    expect(patches, 'no interpolated surface in the mesh at all').toBeGreaterThan(0);
    expect(walls, 'no wall in the mesh at all').toBeGreaterThan(0);
  });

  it('a map whose elevation grid is all zeroes is drawn EXACTLY as one with no grid at all', () => {
    // `parseMap` always returns a `Uint8Array` -- zero-filled when the map
    // JSON carries no `elevation` key, which is four of the six shipped
    // maps. So "no relief" reaches this builder as an all-zero GRID, never
    // as null, and a null check alone would have quietly smoothed every flat
    // map in the game while looking, in a fixture, like it did not.
    //
    // This is the assertion behind "the three flat golden scenarios must not
    // move": byte-identical output, not merely equivalent pixels.
    const withGrid = flat(5, 4);
    withGrid.elevation = new Uint8Array(5 * 4);
    const withoutGrid = flat(5, 4);
    const a = buildGround(withGrid, TONES, '#14150F');
    const b = buildGround(withoutGrid, TONES, '#14150F');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.normals!)).toEqual(Array.from(b.normals!));
    // ...and it really is the pre-existing two-triangles-per-tile mesh.
    expect(a.indices.length).toBe(5 * 4 * 6);
  });

  it('emits one normal per vertex, up on every terrace top, wall and flat tile, and tilted on a slope', () => {
    // The half of the palette exemption this builder is responsible for
    // (`surface.ts`, SURFACE_SHADING_EXEMPTION, points 2 and 3).
    // `groundSurfaceMaterial`'s shade term is `1 + RELIEF * (N.L - up.L)`,
    // which is exactly 1.0 at an up normal -- so anything carrying one emits
    // the same palette bytes it always did. Wall and terrace-top vertices
    // must therefore be EXACTLY (0, 1, 0), not merely close.
    const input = flat(6, 6);
    input.elevation = new Uint8Array(6 * 6).map((_, ti) => ((ti % 6) + Math.floor(ti / 6)) % 3);
    input.blocked = new Uint8Array(6 * 6);
    input.blocked[2 * 6 + 2] = 1;
    const m = buildGround(input, TONES, '#14150F');
    expect(m.normals).toBeDefined();
    expect(m.normals!.length).toBe(m.colors.length);

    let exactlyUp = 0;
    let tilted = 0;
    for (let i = 0; i < m.normals!.length; i += 3) {
      const [nx, ny, nz] = [m.normals![i], m.normals![i + 1], m.normals![i + 2]];
      expect(Math.hypot(nx, ny, nz), 'normal is not unit length').toBeCloseTo(1, 5);
      expect(ny, 'a heightfield normal always points up').toBeGreaterThan(0);
      if (nx === 0 && ny === 1 && nz === 0) exactlyUp++;
      else tilted++;
    }
    expect(exactlyUp, 'no exactly-up normals: terraces and walls would be shaded').toBeGreaterThan(0);
    expect(tilted, 'no tilted normals: the surface would shade as flat').toBeGreaterThan(0);

    // Every wall and terrace-top vertex specifically -- counted, not sampled.
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = vertex(m, m.indices[i]);
      const b = vertex(m, m.indices[i + 1]);
      const c = vertex(m, m.indices[i + 2]);
      if (kindOf(a, b, c) === 'surface patch') continue;
      for (const k of [0, 1, 2]) {
        const v = m.indices[i + k] * 3;
        expect(
          [m.normals![v], m.normals![v + 1], m.normals![v + 2]],
          `${kindOf(a, b, c)} vertex is not exactly up -- its fragment would leave the palette`
        ).toEqual([0, 1, 0]);
      }
    }
  });

  it('shares no vertex BETWEEN tiles, so a road tone cannot bleed into the ground beside it', () => {
    // The rule that survived the rewrite. Colour is still decided once per
    // tile and written to every vertex of that tile; a vertex shared across
    // a tile boundary would interpolate two tones and put an off-palette
    // gradient on the ground -- which is a different exemption from the one
    // taken, and not one that was taken.
    //
    // Proven by construction rather than by counting: for every tile
    // boundary vertex there are at least two vertices at that exact
    // position, and their colours differ wherever the tones do.
    const input = flat(3, 1);
    input.elevation = new Uint8Array([1, 2, 1]);
    input.decor = new Uint8Array([0, 1, 0]); // middle tile is road
    const m = buildGround(input, TONES, '#14150F');
    // The shared boundary between tile 0 (open) and tile 1 (road), at the
    // middle of that edge.
    const colorsAt: string[] = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      if (Math.abs(m.positions[i] - 1) > 1e-5) continue;
      if (Math.abs(m.positions[i + 2] - 0.5) > 1e-5) continue;
      colorsAt.push([0, 1, 2].map((k) => m.colors[i + k].toFixed(6)).join(','));
    }
    expect(colorsAt.length, 'no duplicated vertex on the tile boundary -- vertices are being shared').toBeGreaterThan(1);
    expect(new Set(colorsAt).size, 'both sides of a road edge carry the same tone').toBeGreaterThan(1);
  });

  it('subdivides a smooth tile into SURFACE_SUBDIVISIONS squared quads', () => {
    // The cost side of the change, pinned so it cannot drift silently: a
    // smooth tile is 2 * SUB^2 triangles against a terrace's 2.
    const input = flat(3, 3);
    input.elevation = new Uint8Array(9).fill(1);
    input.elevation[4] = 2; // one bump, so the map is not flat
    const m = buildGround(input, TONES, '#14150F');
    // 9 smooth tiles, no walls (all open, no rim drop below 0? the rim DOES
    // drop to 0 off-map, so walls exist -- count patches only).
    let patch = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = vertex(m, m.indices[i]);
      const b = vertex(m, m.indices[i + 1]);
      const c = vertex(m, m.indices[i + 2]);
      if (kindOf(a, b, c) === 'surface patch' || kindOf(a, b, c) === 'tile top') patch++;
    }
    expect(patch).toBe(9 * 2 * SURFACE_SUBDIVISIONS * SURFACE_SUBDIVISIONS);
  });

  it('masks sand onto open interpolated ground, rock onto the ridge, and neither onto a road, a building or a flat map', () => {
    // The other half of the palette exemption's scope. The ground albedo
    // (`mesh.ts`'s `uSand`) is allowed on the interpolated OPEN surface and
    // nowhere else: a road keeps its authored tone so it still reads as a
    // road, a terrace top and a wall keep theirs so a ridge face stays the
    // `FACE_ALPHA` composite it always was, and a map with no relief is
    // untouched entirely.
    // Six tiles, and tile 5 is the one that makes this test able to fail: a
    // BLOCKED tile standing above its neighbours with NO ridge decor -- a
    // building footprint. It draws walls exactly as the ridge does, so
    // without it every wall in the fixture is a ridge wall and "the rock mask
    // is only on ridge walls" is unfalsifiable. (It was, at first: setting
    // the ridge test to `true` unconditionally left this test green.)
    const W = 6;
    const input = flat(W, 1);
    input.elevation = new Uint8Array([1, 2, 1, 3, 1, 3]);
    input.decor = new Uint8Array([0, DECOR_ROAD, 0, DECOR_RIDGE, 0, 0]);
    input.blocked = new Uint8Array([0, 0, 0, 1, 0, 1]);
    const isRidge = (t: number): boolean => t >= 0 && t < W && input.decor![t] === DECOR_RIDGE;
    const m = buildGround(input, TONES, '#14150F');
    expect(m.sandMask).toBeDefined();
    expect(m.sandMask!.length).toBe(m.colors.length / 3);

    // Bucketed per TRIANGLE, by its own centroid, so a wall vertex sitting on
    // a tile boundary is attributed to the wall rather than to whichever tile
    // it happens to touch. Bucketing by vertex X alone put a rim wall's
    // vertices in tile 0 and made this assertion read a mixed set.
    const sandPerTile: Array<Set<number>> = Array.from({ length: W }, () => new Set<number>());
    const rockPerTile: Array<Set<number>> = Array.from({ length: W }, () => new Set<number>());
    // Walls, bucketed by whether either tile sharing the edge is a ridge --
    // computed from the fixture's own decor array, not from anything
    // `buildGround` exports.
    const ridgeWallRock = new Set<number>();
    const plainWallRock = new Set<number>();
    const wallSand = new Set<number>();
    let ridgeWalls = 0;
    let plainWalls = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const tri = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
      const a = vertex(m, tri[0]);
      const b = vertex(m, tri[1]);
      const c = vertex(m, tri[2]);
      const kind = kindOf(a, b, c);
      if (kind === 'east face' || kind === 'south face') {
        for (const v of tri) wallSand.add(m.sandMask![v]);
        // An east face at world X sits between tiles X-1 and X; the fixture
        // is one row deep, so a south face at Z = 1 belongs to the tile under
        // its own X.
        const onRidge =
          kind === 'east face'
            ? isRidge(a[0] - 1) || isRidge(a[0])
            : isRidge(Math.floor(Math.min(a[0], b[0], c[0])));
        if (onRidge) {
          ridgeWalls++;
          for (const v of tri) ridgeWallRock.add(m.rockMask![v]);
        } else {
          plainWalls++;
          for (const v of tri) plainWallRock.add(m.rockMask![v]);
        }
        continue;
      }
      const cx = tri.reduce((acc, v) => acc + m.positions[v * 3], 0) / 3;
      const t = Math.min(W - 1, Math.max(0, Math.floor(cx)));
      for (const v of tri) {
        sandPerTile[t].add(m.sandMask![v]);
        rockPerTile[t].add(m.rockMask![v]);
      }
    }
    expect(sandPerTile[0], 'open interpolated ground must take the sand tile').toEqual(new Set([1]));
    expect(sandPerTile[2], 'open interpolated ground must take the sand tile').toEqual(new Set([1]));
    expect(sandPerTile[1], 'a road must NOT take the sand tile').toEqual(new Set([0]));
    expect(sandPerTile[3], 'a ridge terrace must NOT take the sand tile').toEqual(new Set([0]));
    expect(sandPerTile[5], 'a building footprint must NOT take the sand tile').toEqual(new Set([0]));
    expect(wallSand, 'a wall must NOT take the sand tile').toEqual(new Set([0]));

    // The ROCK mask is the ridge and only the ridge: its flat top and the
    // cliff faces below it. A BUILDING is blocked and terraced exactly like a
    // ridge and draws the same walls, and must get none of it -- a structure
    // pad is not bedrock.
    expect(rockPerTile[3], 'a ridge TOP must take the rock tile').toEqual(new Set([1]));
    expect(rockPerTile[5], 'a building footprint must NOT take the rock tile').toEqual(new Set([0]));
    expect(rockPerTile[0], 'open ground must NOT take the rock tile').toEqual(new Set([0]));
    expect(rockPerTile[1], 'a road must NOT take the rock tile').toEqual(new Set([0]));
    expect(ridgeWalls, 'the fixture drew no ridge wall at all').toBeGreaterThan(0);
    expect(plainWalls, 'the fixture drew no NON-ridge wall -- the rock rule would be unfalsifiable').toBeGreaterThan(0);
    expect(ridgeWallRock, 'a ridge cliff face must take the rock tile').toEqual(new Set([1]));
    expect(plainWallRock, "a building's own wall must NOT take the rock tile").toEqual(new Set([0]));
    // No vertex anywhere is both.
    for (let i = 0; i < m.sandMask!.length; i++) {
      expect(m.sandMask![i] * m.rockMask![i], `vertex ${i} is both sand and rock`).toBe(0);
    }

    // A map with no relief takes neither, so nothing about its pixels can
    // change -- checked below for sand, and here for rock.
    const level = buildGround(flat(4, 4), TONES, '#14150F');
    expect(new Set(Array.from(level.rockMask!))).toEqual(new Set([0]));

    // The albedo UVs: a horizontal quad projects straight down, a wall does
    // not. An east wall spans one world X, so if its UVs used that X every
    // fragment on it would share a U and one column of the image would smear
    // down the whole cliff.
    expect(m.groundUv).toBeDefined();
    expect(m.groundUv!.length).toBe(m.sandMask!.length * 2);
    for (let i = 0; i < m.indices.length; i += 3) {
      const tri = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
      const kind = kindOf(vertex(m, tri[0]), vertex(m, tri[1]), vertex(m, tri[2]));
      const us = tri.map((v) => m.groundUv![v * 2]);
      const vs = tri.map((v) => m.groundUv![v * 2 + 1]);
      if (kind === 'east face') {
        // U from world Z, V from world Y -- so both vary across the face.
        expect(new Set(us).size + new Set(vs).size, 'an east wall UV is degenerate').toBeGreaterThan(2);
        for (const k of [0, 1, 2]) expect(vs[k]).toBeCloseTo(m.positions[tri[k] * 3 + 1], 6);
      } else if (kind !== 'south face') {
        // Horizontal: exactly (world x, world z).
        for (const k of [0, 1, 2]) {
          expect(us[k]).toBeCloseTo(m.positions[tri[k] * 3], 6);
          expect(vs[k]).toBeCloseTo(m.positions[tri[k] * 3 + 2], 6);
        }
      }
    }

    // And a map with no relief: every vertex masked off, so nothing about a
    // flat map's pixels can change.
    expect(new Set(Array.from(level.sandMask!))).toEqual(new Set([0]));
  });

  it('reaches every groundTone branch: open, road, cover, blocked, ridge', () => {
    // tones.test.ts has no groundTone cases at all, and the palette test
    // above uses blocked/cover all zero with decor: null -- only the open
    // branch. Every branch ends in one quantise() call so the risk is low,
    // but "low risk because I read the code" is exactly the shape of the
    // last two holes.
    //
    // groundTone (tones.ts) does not currently branch on `cover` at all --
    // read to confirm before writing this -- so the cover tile below routes
    // through the same open-ground branch as an uncovered one. It stays in
    // the map anyway: TerrainInput.cover is real per-tile game data
    // (packages/data's cover levels), and this is the map buildGround gets
    // handed in practice, not a hand-trimmed one that happens to dodge an
    // unused field.
    const w = 5, h = 1;
    const input: TerrainInput = {
      width: w,
      height: h,
      decor: new Uint8Array([0, 1, 0, 0, 4]), // open, road, open(cover), open, ridge
      elevation: null,
      blocked: new Uint8Array([0, 0, 0, 1, 1]), // ..., blocked(no decor), blocked+ridge
      cover: new Uint8Array([0, 0, 1, 0, 0]),
    };
    const m = buildGround(input, TONES, '#14150F');
    const entries = new Set(PALETTE_HEXES.map((h2) => h2.toUpperCase()));
    for (let i = 0; i < m.colors.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.colors[i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });
});
