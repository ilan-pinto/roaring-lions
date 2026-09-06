/**
 * The ground mesh is where the palette guarantee either holds across the whole
 * screen or quietly stops applying. These tests assert it directly.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGround,
  roadAxisAt,
  ROAD_AXIS_EAST_WEST,
  ROAD_AXIS_JUNCTION,
  ROAD_AXIS_NORTH_SOUTH,
  SCRUB_TIER_STRENGTH,
  groundAlbedoSlotsUsed,
} from './ground';
import { WORLD_PER_LEVEL } from './shared';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import { SURFACE_OVERSHOOT_LEVELS, SURFACE_SUBDIVISIONS } from './surface';
import { PALETTE_HEXES } from './tones';
import { VIEW_DIRECTION } from '../camera';
import { GROUND_SLOTS } from './mesh';
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

    // Nothing else on the relief fixture is rock either.
    expect(rockPerTile[2], 'open ground must NOT take the rock tile').toEqual(new Set([0]));

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

    // A map with no relief takes the SAME sand, and the same two exclusions.
    // It was held out at first -- that kept three golden baselines at a
    // literal zero -- and the project lead overruled it: the default sandbox
    // map is a flat one, so holding it out would have greeted a player with
    // untextured palette ground while the two relief maps were sand. Flat
    // sand is still sand.
    //
    // This is also the first real test of the ROAD mask on a road NETWORK
    // rather than a single strip: the four shipped flat maps carry 82, 39, 26
    // and 43 road tiles between them.
    const flatMap = flat(4, 3);
    flatMap.decor = new Uint8Array(12);
    flatMap.decor[5] = DECOR_ROAD;
    flatMap.blocked = new Uint8Array(12);
    flatMap.blocked[6] = 1; // a building footprint
    const fm = buildGround(flatMap, TONES, '#14150F');
    // Bucketed per TRIANGLE by its own centroid, not per vertex by its x:
    // the flat path emits four UNSHARED corners per tile, so a vertex sitting
    // on a tile boundary belongs to two buckets and reads as a mixed set.
    // (It did, first time round.)
    const perFlatTile: Array<Set<number>> = Array.from({ length: 12 }, () => new Set<number>());
    for (let i = 0; i < fm.indices.length; i += 3) {
      const tri = [fm.indices[i], fm.indices[i + 1], fm.indices[i + 2]];
      const cx = tri.reduce((a, v) => a + fm.positions[v * 3], 0) / 3;
      const cz = tri.reduce((a, v) => a + fm.positions[v * 3 + 2], 0) / 3;
      const t = Math.floor(cz) * 4 + Math.floor(cx);
      for (const v of tri) perFlatTile[t].add(fm.sandMask![v]);
    }
    expect(perFlatTile[0], 'open ground on a flat map must take the sand tile').toEqual(new Set([1]));
    expect(perFlatTile[5], 'a road on a flat map must NOT take the sand tile').toEqual(new Set([0]));
    expect(perFlatTile[6], 'a building footprint must NOT take the sand tile').toEqual(new Set([0]));
    // Nothing on a flat map is rock -- no shipped flat map has a `^` tile at
    // all, and this pins that the ridge branch is the only thing that grants
    // it rather than "flat" doing so by accident.
    expect(new Set(Array.from(fm.rockMask!))).toEqual(new Set([0]));
    // The geometry is still the pre-2026-09-03 two triangles per tile: the
    // sand is a fragment-stage mask on the SAME mesh, not a rebuild of it.
    expect(fm.indices.length).toBe(4 * 3 * 6);
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

/**
 * The five ground albedos (2026-09-03).
 *
 * `buildGround` decides, per tile, WHICH of `groundSurfaceMaterial`'s five
 * albedo slots that tile's fragments sample. These tests assert the decision
 * through the mesh it actually emits, not through the private function that
 * makes it -- so a mask that stops reaching the GPU fails here too.
 */
describe('the ground albedo masks', () => {
  /**
   * Every vertex index belonging to tile `(x, y)`, found through the
   * TRIANGLES rather than by a bounding box on the positions.
   *
   * A box does not work and the failure is silent: tile boundaries are
   * integers and a flat tile's four corners sit exactly on them, so tile
   * (5,1)'s box also catches tile (4,1)'s right-hand corners and the
   * "one value per tile" check below sees two. A triangle's centroid is
   * strictly inside its own tile, on every path this builder has.
   */
  const verticesOf = (m: MeshData, x: number, y: number): number[] => {
    const out = new Set<number>();
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t];
      const b = m.indices[t + 1];
      const c = m.indices[t + 2];
      const cx = (m.positions[a * 3] + m.positions[b * 3] + m.positions[c * 3]) / 3;
      const cz = (m.positions[a * 3 + 2] + m.positions[b * 3 + 2] + m.positions[c * 3 + 2]) / 3;
      if (Math.floor(cx) !== x || Math.floor(cz) !== y) continue;
      out.add(a);
      out.add(b);
      out.add(c);
    }
    return [...out];
  };

  /** The one mask value shared by every vertex of tile `(x, y)`. Throws if
   *  the tile's own vertices disagree, which would mean colour and albedo
   *  had stopped being decided once per tile. */
  const maskOf = (m: MeshData, name: keyof MeshData, x: number, y: number): number => {
    const arr = m[name] as Float32Array;
    const idx = verticesOf(m, x, y);
    expect(idx.length, `no vertices in tile ${x},${y}`).toBeGreaterThan(0);
    const values = new Set(idx.map((i) => arr[i]));
    expect(values.size, `${String(name)} disagrees within tile ${x},${y}`).toBe(1);
    return [...values][0];
  };

  /** A 6x6 flat map carrying one of every surface this file now draws. */
  function everySurface(): TerrainInput {
    const w = 6;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    const cover = new Uint8Array(w * w);
    const at = (x: number, y: number): number => y * w + x;
    // A road running north-south down column 1, turning east along row 3.
    for (const y of [1, 2, 3]) decor[at(1, y)] = DECOR_ROAD;
    for (const x of [2, 3]) decor[at(x, 3)] = DECOR_ROAD;
    // Cover tiers 1, 2, 3 in column 4.
    cover[at(4, 0)] = 1;
    cover[at(4, 1)] = 2;
    cover[at(4, 2)] = 3;
    // A grove: cover 1 AND decor grove, which is exactly what `o` is.
    decor[at(5, 0)] = DECOR_GROVE;
    cover[at(5, 0)] = 1;
    // A knoll: cover 2 AND decor knoll, which is exactly what `n` is.
    decor[at(5, 1)] = DECOR_KNOLL;
    cover[at(5, 1)] = 2;
    input.decor = decor;
    input.cover = cover;
    return input;
  }

  it('gives a road tile the road albedo, and no longer masks it out of everything', () => {
    // Until this change a road was masked OUT of the only albedo there was,
    // so its authored tone would keep reading as navigation. It has one of
    // its own now -- applied as a ratio to its own mean, so the tile still
    // AVERAGES to that same authored tone.
    const m = buildGround(everySurface(), TONES, '#14150F');
    expect(maskOf(m, 'roadMask', 1, 2)).toBe(1);
    expect(maskOf(m, 'sandMask', 1, 2)).toBe(0);
  });

  it('runs the ruts along the road, and crosses them at a junction', () => {
    const m = buildGround(everySurface(), TONES, '#14150F');
    // (1,1) and (1,2) have road above and below only: north-south.
    expect(maskOf(m, 'roadAxis', 1, 1)).toBe(ROAD_AXIS_NORTH_SOUTH);
    expect(maskOf(m, 'roadAxis', 1, 2)).toBe(ROAD_AXIS_NORTH_SOUTH);
    // (2,3) and (3,3) have road left and right only: east-west.
    expect(maskOf(m, 'roadAxis', 2, 3)).toBe(ROAD_AXIS_EAST_WEST);
    expect(maskOf(m, 'roadAxis', 3, 3)).toBe(ROAD_AXIS_EAST_WEST);
    // (1,3) is the corner -- road above and road to the right. Both axes,
    // so the two samples are averaged and the tile draws a crossing.
    expect(maskOf(m, 'roadAxis', 1, 3)).toBe(ROAD_AXIS_JUNCTION);
  });

  it('reads a T and a crossroads as junctions too, not just a corner', () => {
    const w = 5;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    // A full cross centred on (2,2).
    for (const [x, y] of [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [0, 2], [1, 2], [3, 2], [4, 2]]) {
      decor[y * w + x] = DECOR_ROAD;
    }
    input.decor = decor;
    const m = buildGround(input, TONES, '#14150F');
    expect(maskOf(m, 'roadAxis', 2, 2)).toBe(ROAD_AXIS_JUNCTION);
    // The four arms are straight and keep their own axis.
    expect(maskOf(m, 'roadAxis', 2, 1)).toBe(ROAD_AXIS_NORTH_SOUTH);
    expect(maskOf(m, 'roadAxis', 1, 2)).toBe(ROAD_AXIS_EAST_WEST);
    // Remove one arm to make a T: the centre is still a junction.
    decor[0 * w + 2] = 0;
    decor[1 * w + 2] = 0;
    const t = buildGround(input, TONES, '#14150F');
    expect(maskOf(t, 'roadAxis', 2, 2)).toBe(ROAD_AXIS_JUNCTION);
  });

  it('gives a lone road tile the directionless patch, since it has no run to agree with', () => {
    const input = flat(3, 3);
    const decor = new Uint8Array(9);
    decor[1 * 3 + 1] = DECOR_ROAD;
    input.decor = decor;
    const m = buildGround(input, TONES, '#14150F');
    expect(maskOf(m, 'roadAxis', 1, 1)).toBe(ROAD_AXIS_JUNCTION);
  });

  it('roadAxisAt is deterministic and ignores everything but the four neighbours', () => {
    // Never `tileHash`: an authored road must not change orientation because
    // a tile was added somewhere else on the map.
    const input = everySurface();
    const first = roadAxisAt(input, 1, 2);
    expect(roadAxisAt(input, 1, 2)).toBe(first);
    // A cover tile three columns away cannot move it.
    input.cover[2 * input.width + 4] = 3;
    expect(roadAxisAt(input, 1, 2)).toBe(first);
  });

  it('steps the three cover tiers through the scrub albedo, and only the plain symbols', () => {
    const m = buildGround(everySurface(), TONES, '#14150F');
    // `toBeCloseTo`, not `toBe`: the mask arrives through a Float32Array,
    // so 0.4 comes back as 0.4000000059604645.
    expect(maskOf(m, 'scrubMask', 4, 0)).toBeCloseTo(SCRUB_TIER_STRENGTH[0], 6);
    expect(maskOf(m, 'scrubMask', 4, 1)).toBeCloseTo(SCRUB_TIER_STRENGTH[1], 6);
    expect(maskOf(m, 'scrubMask', 4, 2)).toBeCloseTo(SCRUB_TIER_STRENGTH[2], 6);
    // ...and they lose the open-ground albedo, so the two never multiply.
    expect(maskOf(m, 'sandMask', 4, 0)).toBe(0);
  });

  it('SCRUB_TIER_STRENGTH is a strictly rising ladder ending at full strength', () => {
    // The one thing that makes tier 3 separable from tier 2 at all. If these
    // ever collapse to one value, the tiers stop reading apart -- which is
    // the defect measured on `qarn_hadid` and the reason this ladder exists.
    expect(SCRUB_TIER_STRENGTH[0]).toBeLessThan(SCRUB_TIER_STRENGTH[1]);
    expect(SCRUB_TIER_STRENGTH[1]).toBeLessThan(SCRUB_TIER_STRENGTH[2]);
    expect(SCRUB_TIER_STRENGTH[2]).toBe(1);
    expect(SCRUB_TIER_STRENGTH[0]).toBeGreaterThan(0);
  });

  it('draws an olive grove as orchard floor, NOT as scrub -- `o` is cover 1', () => {
    // The ordering trap: `o` carries cover 1 in `@lions/data`'s own LEGEND,
    // so a cover test placed before the grove test would draw every olive
    // grove in the game as scrub. Falsify by swapping those two branches in
    // `albedoFor` and this goes red.
    const m = buildGround(everySurface(), TONES, '#14150F');
    expect(maskOf(m, 'groveMask', 5, 0)).toBe(1);
    expect(maskOf(m, 'scrubMask', 5, 0)).toBe(0);
    expect(maskOf(m, 'sandMask', 5, 0)).toBe(0);
  });

  it('leaves an `n` rocky knoll exactly as it was -- open ground, no scrub', () => {
    // Cover 2, but its own decor kind. Deliberately out of scope: neither
    // the brief nor the art named it, and quietly restyling a symbol is how
    // a map stops looking like the one its author drew.
    const m = buildGround(everySurface(), TONES, '#14150F');
    expect(maskOf(m, 'sandMask', 5, 1)).toBe(1);
    expect(maskOf(m, 'scrubMask', 5, 1)).toBe(0);
  });

  it('never gives one vertex two albedos', () => {
    // The property the whole design rests on: the shader multiplies all five
    // slots in sequence, so two non-zero masks on one vertex would multiply
    // two images onto one fragment and the result would be neither.
    const m = buildGround(everySurface(), TONES, '#14150F');
    const n = m.colors.length / 3;
    for (let i = 0; i < n; i++) {
      const on = [m.sandMask![i], m.rockMask![i], m.roadMask![i], m.scrubMask![i], m.groveMask![i]].filter(
        (v) => v !== 0
      );
      expect(on.length, `vertex ${i} samples ${on.length} albedos`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps all six albedo channels in lockstep with the vertex count', () => {
    // A `push` missed on one path and not another would silently misalign
    // every vertex after it -- the mask arrays are read by index.
    const input = everySurface();
    input.elevation = new Uint8Array(input.width * input.height).map((_, ti) => ti % 4);
    input.blocked[2 * input.width + 2] = 1;
    input.decor![2 * input.width + 2] = DECOR_RIDGE;
    const m = buildGround(input, TONES, '#14150F');
    const n = m.colors.length / 3;
    for (const key of ['sandMask', 'rockMask', 'roadMask', 'roadAxis', 'scrubMask', 'groveMask'] as const) {
      expect((m[key] as Float32Array).length, `${key} length`).toBe(n);
    }
    expect(m.normals!.length).toBe(n * 3);
    expect(m.groundUv!.length).toBe(n * 2);
  });

  it('gives a ridge WALL rock and nothing else -- a wall is bedrock or it is nothing', () => {
    const w = 4;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    const elevation = new Uint8Array(w * w);
    decor[1 * w + 1] = DECOR_RIDGE;
    input.blocked[1 * w + 1] = 1;
    elevation[1 * w + 1] = 3;
    input.decor = decor;
    input.elevation = elevation;
    const m = buildGround(input, TONES, '#14150F');
    // Every wall vertex (three equal X or three equal Z on its triangle) is
    // found through the mesh's own faces; simpler here: any vertex with a
    // non-zero rockMask must have zero everywhere else.
    let rockVertices = 0;
    for (let i = 0; i < m.colors.length / 3; i++) {
      if (m.rockMask![i] === 0) continue;
      rockVertices++;
      expect(m.sandMask![i]).toBe(0);
      expect(m.roadMask![i]).toBe(0);
      expect(m.scrubMask![i]).toBe(0);
      expect(m.groveMask![i]).toBe(0);
    }
    // The ridge top (4) plus its east and south faces.
    expect(rockVertices).toBeGreaterThan(4);
  });
});

/**
 * `groundAlbedoSlotsUsed` -- the derivation `packages/app`'s ground-texture
 * loader (2026-09-06) relies on to skip fetching an image no tile on the
 * current map could ever sample. Asserted against `albedoFor`'s own
 * decision, walked through the real `buildGround` masks above, not
 * re-derived by a second reading of the map symbols.
 */
describe('groundAlbedoSlotsUsed', () => {
  it('reports only sand on ground with no ridge, road, cover or grove', () => {
    expect(groundAlbedoSlotsUsed(flat(4, 4))).toEqual(new Set(['sand']));
  });

  it('every value it ever returns is one of GROUND_SLOTS -- the two lists agree', () => {
    // `GROUND_SLOTS` (mesh.ts) is the shader's own enumeration; this type is
    // declared independently so the pure barrel never imports `three`
    // (`ground.ts`'s own doc comment on `GroundAlbedoSlot`). If the two ever
    // drift, this is where it is caught.
    const w = 6;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    const cover = new Uint8Array(w * w);
    const at = (x: number, y: number): number => y * w + x;
    decor[at(1, 1)] = DECOR_ROAD;
    decor[at(2, 2)] = DECOR_GROVE;
    cover[at(2, 2)] = 1;
    cover[at(3, 3)] = 2;
    decor[at(4, 4)] = DECOR_RIDGE;
    input.blocked[at(4, 4)] = 1;
    input.decor = decor;
    input.cover = cover;
    const used = groundAlbedoSlotsUsed(input);
    for (const slot of used) expect(GROUND_SLOTS).toContain(slot);
  });

  it('finds every slot a map actually uses -- road, grove, scrub, rock and sand together', () => {
    const w = 6;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    const cover = new Uint8Array(w * w);
    const at = (x: number, y: number): number => y * w + x;
    decor[at(1, 1)] = DECOR_ROAD;
    decor[at(2, 2)] = DECOR_GROVE;
    cover[at(2, 2)] = 1;
    cover[at(3, 3)] = 2;
    decor[at(4, 4)] = DECOR_RIDGE;
    input.blocked[at(4, 4)] = 1;
    input.decor = decor;
    input.cover = cover;
    expect(groundAlbedoSlotsUsed(input)).toEqual(new Set(['sand', 'road', 'grove', 'scrub', 'rock']));
  });

  it('omits a slot the map genuinely never lands on -- no ridge means no rock', () => {
    const w = 4;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    decor[1 * w + 1] = DECOR_ROAD;
    input.decor = decor;
    const used = groundAlbedoSlotsUsed(input);
    expect(used.has('rock')).toBe(false);
    expect(used.has('grove')).toBe(false);
    expect(used.has('scrub')).toBe(false);
    expect(used).toEqual(new Set(['sand', 'road']));
  });

  it('an `n` knoll alone does not pull in scrub -- it is cover 2 with its own decor kind', () => {
    const w = 3;
    const input = flat(w, w);
    const decor = new Uint8Array(w * w);
    const cover = new Uint8Array(w * w);
    decor[1 * w + 1] = DECOR_KNOLL;
    cover[1 * w + 1] = 2;
    input.decor = decor;
    input.cover = cover;
    expect(groundAlbedoSlotsUsed(input)).toEqual(new Set(['sand']));
  });
});
