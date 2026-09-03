/**
 * The interpolated ground surface.
 *
 * Three claims here are load-bearing enough that the rest of this change
 * rests on them, and each is asserted directly rather than argued:
 *
 *  1. The surface passes EXACTLY through every authored tile centre, so the
 *     renderer and the sim agree wherever the sim looks.
 *  2. A map with no relief -- which reaches this module as an all-ZERO grid,
 *     not a null one -- is untouched.
 *  3. A `blocked` tile is a flat terrace and the open ground beside it stays
 *     at its own level right up to the foot of the wall.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  buildTerrainSurface,
  terrainSurfaceFrom,
  hasWall,
  isTerrace,
  markPlane,
  MARK_SLOPE_LIMIT,
  smoothLevel,
  smoothNormal,
  surfaceLevel,
  surfaceNormal,
  surfaceWorldY,
  SURFACE_SHADING_EXEMPTION,
} from './surface';
import { WORLD_PER_LEVEL } from './shared';
import type { TerrainInput } from './types';

function map(w: number, h: number, levels: number[], blocked: number[] = []): TerrainInput {
  return {
    width: w,
    height: h,
    decor: null,
    elevation: Uint8Array.from(levels),
    blocked: blocked.length ? Uint8Array.from(blocked) : new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
  };
}

describe('buildTerrainSurface', () => {
  it('passes through every authored tile centre EXACTLY, not approximately', () => {
    // The property that makes this a renderer-only change. Catmull-Rom at
    // t = 0 evaluates `0.5 * (2 * p1)`, which is exact in binary floating
    // point -- so `toBe`, not `toBeCloseTo`. If this ever needs a tolerance,
    // the interpolant has stopped being interpolating and units have started
    // floating.
    const levels = [0, 1, 3, 2, 5, 1, 0, 2, 4, 3, 1, 2, 2, 0, 1, 3];
    const input = map(4, 4, levels);
    const s = buildTerrainSurface(input);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(surfaceLevel(s, x + 0.5, y + 0.5), `tile (${x},${y})`).toBe(levels[y * 4 + x]);
      }
    }
  });

  it('treats an all-zero grid exactly like no grid at all -- flat, and every query zero', () => {
    // `parseMap` ALWAYS returns a `Uint8Array`, zero-filled when the map JSON
    // has no `elevation` key -- four of the six shipped maps. A null check
    // alone would have smoothed all four while looking, in a fixture, like it
    // had not.
    const zeroed = buildTerrainSurface(map(3, 3, new Array(9).fill(0)));
    const absent = buildTerrainSurface({ ...map(3, 3, new Array(9).fill(0)), elevation: null });
    expect(zeroed.flat).toBe(true);
    expect(absent.flat).toBe(true);
    for (const s of [zeroed, absent]) {
      expect(surfaceLevel(s, 1.37, 2.11)).toBe(0);
      expect(surfaceWorldY(s, 1.37, 2.11)).toBe(0);
      expect(surfaceNormal(s, 1.37, 2.11)).toEqual([0, 1, 0]);
      expect(hasWall(s, 1, 1, 0)).toBe(false);
      expect(isTerrace(s, 1, 1)).toBe(false);
    }
  });

  it('draws a blocked tile as a FLAT terrace at its own integer height', () => {
    // `^` ridge and building footprints. Every point inside the tile reads
    // the tile's own level, corner to corner -- so a building's box base and
    // a ridge slab still sit on ground that is actually there.
    const input = map(3, 3, [0, 0, 0, 0, 4, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const s = buildTerrainSurface(input);
    expect(isTerrace(s, 1, 1)).toBe(true);
    for (const [x, z] of [[1.01, 1.01], [1.5, 1.5], [1.99, 1.01], [1.5, 1.99]] as const) {
      expect(surfaceLevel(s, x, z), `(${x},${z}) inside the terrace`).toBe(4);
    }
  });

  it('keeps the open ground beside a cliff at its OWN level, instead of ramping a third of the way up it', () => {
    // Why terrace tiles are cut out of the smoothing source. Catmull-Rom has
    // a two-tile support, so leaving a 6-level ridge in the field would tip
    // the open ground either side of it well off level. The fill replaces the
    // ridge's sample with its open neighbours' own, which makes the field
    // locally flat across the cliff.
    const w = 7;
    const levels = [1, 1, 1, 6, 1, 1, 1];
    const blocked = [0, 0, 0, 1, 0, 0, 0];
    const s = buildTerrainSurface(map(w, 1, levels, blocked));
    for (const x of [0.5, 1.5, 2.5, 4.5, 5.5, 6.5]) {
      expect(surfaceLevel(s, x, 0.5), `open tile centre at x=${x}`).toBe(1);
    }
    // ...and right at the cliff foot, not just at the centres.
    expect(smoothLevel(s, 2.99, 0.5)).toBeCloseTo(1, 6);
    expect(smoothLevel(s, 4.01, 0.5)).toBeCloseTo(1, 6);
    // The ridge itself is untouched.
    expect(surfaceLevel(s, 3.5, 0.5)).toBe(6);
  });

  it('is C1: the slope is continuous across a tile boundary, which bilinear would not be', () => {
    // Why Catmull-Rom and not bilinear-between-centres. Bilinear is C0: its
    // slope jumps at every line joining two sample points, and since the toon
    // shade here is driven off the normal, that jump draws as a lattice of
    // shading creases -- pyramids instead of hills. Sampled either side of a
    // tile-centre line, the normal must barely move.
    const s = buildTerrainSurface(map(6, 1, [0, 1, 3, 4, 2, 0]));
    const before = smoothNormal(s, 2.5 - 1e-4, 0.5);
    const after = smoothNormal(s, 2.5 + 1e-4, 0.5);
    for (const k of [0, 1, 2]) expect(after[k]).toBeCloseTo(before[k], 4);
  });

  it('a normal is unit length and always points up, everywhere', () => {
    const s = buildTerrainSurface(map(6, 6, Array.from({ length: 36 }, (_, i) => ((i % 6) + Math.floor(i / 6)) % 4)));
    for (let j = 0; j < 24; j++) {
      for (let i = 0; i < 24; i++) {
        const n = smoothNormal(s, i / 4, j / 4);
        expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
        expect(n[1]).toBeGreaterThan(0);
      }
    }
  });

  it('the analytic normal agrees with a finite difference of the surface it belongs to', () => {
    // The normal is the Catmull-Rom derivative, written by hand. A sign slip
    // or a missing `WORLD_PER_LEVEL` would still produce a plausible unit
    // vector; this compares it against the surface it is supposed to describe.
    const s = buildTerrainSurface(map(6, 6, Array.from({ length: 36 }, (_, i) => (i * 7) % 5)));
    const h = 1e-4;
    for (const [x, z] of [[2.3, 3.1], [4.75, 1.2], [1.1, 4.9]] as const) {
      const dydx = (smoothLevel(s, x + h, z) - smoothLevel(s, x - h, z)) / (2 * h) * WORLD_PER_LEVEL;
      const dydz = (smoothLevel(s, x, z + h) - smoothLevel(s, x, z - h)) / (2 * h) * WORLD_PER_LEVEL;
      const len = Math.hypot(-dydx, 1, -dydz);
      const n = smoothNormal(s, x, z);
      expect(n[0]).toBeCloseTo(-dydx / len, 4);
      expect(n[1]).toBeCloseTo(1 / len, 4);
      expect(n[2]).toBeCloseTo(-dydz / len, 4);
    }
  });
});

describe('hasWall', () => {
  const stepped = (blockTheStep: boolean): TerrainInput =>
    map(
      3,
      3,
      [2, 2, 2, 2, 2, 2, 0, 0, 0],
      blockTheStep ? [0, 0, 0, 1, 1, 1, 0, 0, 0] : []
    );

  it('says NO wall between two open tiles at different heights -- that is a slope', () => {
    const s = buildTerrainSurface(stepped(false));
    expect(hasWall(s, 1, 1, 1)).toBe(false);
  });

  it('says a wall where a blocked tile stands above its neighbour', () => {
    const s = buildTerrainSurface(stepped(true));
    expect(hasWall(s, 1, 1, 1)).toBe(true);
  });

  it('says a wall at the map rim, where a raised tile meets off-map level zero', () => {
    const s = buildTerrainSurface(map(2, 1, [3, 3]));
    expect(hasWall(s, 1, 0, 0)).toBe(true);
  });
});

describe('markPlane', () => {
  it('is dead flat on flat ground and on a terrace, so a decal there is unmoved', () => {
    const flatGround = buildTerrainSurface(map(3, 3, new Array(9).fill(0)));
    expect(markPlane(flatGround, 1.5, 1.5)).toEqual({ centerY: 0, gx: 0, gz: 0 });
    const terrace = buildTerrainSurface(map(3, 3, [0, 0, 0, 0, 3, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 0]));
    const p = markPlane(terrace, 1.5, 1.5);
    expect(p.gx).toBe(0);
    expect(p.gz).toBe(0);
    expect(p.centerY).toBe(3 * WORLD_PER_LEVEL);
  });

  it('follows a gentle slope, and CLAMPS a steep one so the decal cannot turn its back on the camera', () => {
    // The clamp is the reason this returns a plane rather than four sampled
    // corners. Without it a mark on ground steeper than the camera's own
    // 30-degree pitch winds away and `terrainMaterial`'s FrontSide culls it,
    // which reads as bald patches on the steepest slopes.
    const gentle = buildTerrainSurface(map(6, 1, [0, 0, 1, 1, 2, 2]));
    const gp = markPlane(gentle, 2.5, 0.5);
    expect(Math.abs(gp.gx)).toBeGreaterThan(0);
    expect(Math.abs(gp.gx) + Math.abs(gp.gz)).toBeLessThanOrEqual(MARK_SLOPE_LIMIT + 1e-9);

    const cliffish = buildTerrainSurface(map(6, 1, [0, 0, 0, 6, 6, 6]));
    const cp = markPlane(cliffish, 2.9, 0.5);
    expect(Math.abs(cp.gx) + Math.abs(cp.gz)).toBeCloseTo(MARK_SLOPE_LIMIT, 9);
  });
});

describe('terrainSurfaceFrom', () => {
  it('produces the identical field to the TerrainInput route -- the renderer draws what its units stand on', () => {
    // `ThreeRenderer` holds an elevation grid and a `blocked` mask;
    // `buildGround` holds a `TerrainInput`. Two routes to one surface, and a
    // renderer that drew one and stood its units on the other would look
    // right in a screenshot and be wrong in play.
    const levels = Array.from({ length: 64 }, (_, i) => (i * 5) % 7);
    const blocked = Array.from({ length: 64 }, (_, i) => (i % 11 === 0 ? 1 : 0));
    const input = map(8, 8, levels, blocked);
    const viaInput = buildTerrainSurface(input);
    const viaArrays = terrainSurfaceFrom(input.elevation, input.blocked, 8, 8);
    expect(Array.from(viaArrays.field)).toEqual(Array.from(viaInput.field));
    expect(Array.from(viaArrays.terrace)).toEqual(Array.from(viaInput.terrace));
    expect(viaArrays.flat).toBe(viaInput.flat);
  });
});

describe('SURFACE_SHADING_EXEMPTION', () => {
  it("agrees with TERRAIN_PALETTE_EXEMPTION in tools/validate_assets.py", () => {
    // The exemption has to be visible on a GATE's passing path, not only in a
    // doc comment -- the shape the three exemptions before it established.
    // `tools/validate_assets.py` is the palette gate, and it prints this on
    // success; nothing in that script can CHECK the ground (terrain is
    // generated at runtime, not shipped as a PNG), so what it does instead is
    // tell a reader of the art gate's output exactly how far the exemption
    // goes.
    //
    // Pinned across the language boundary the same way
    // `units/textured-building.test.ts` pins `TEXTURED_MESH_EXEMPT`: the
    // Python is parsed and compared against the TypeScript, so a line added
    // on one side and not the other fails here. Without this, the two would
    // drift and the gate would print a reassuring paragraph describing an
    // exemption that had since widened.
    const py = readFileSync(
      fileURLToPath(new URL('../../../../../tools/validate_assets.py', import.meta.url)),
      'utf8'
    );
    const block = /TERRAIN_PALETTE_EXEMPTION = \(([\s\S]*?)\)\n/.exec(py);
    expect(block, 'TERRAIN_PALETTE_EXEMPTION not found in tools/validate_assets.py').not.toBeNull();
    const printed = block![1].toLowerCase();

    // Every claim the TypeScript makes has to appear in what the gate prints.
    expect(printed).toContain('fragment stage only');
    for (const asset of ['desert_sand_tile', 'rock_ground_tile']) {
      expect(printed, `the gate never names ${asset}`).toContain(asset);
    }
    for (const kept of ['terrace', 'flat ground', 'road', 'scatter']) {
      expect(printed, `the gate never says ${kept} is still palette-only`).toContain(kept);
    }
    // ...and every `notExempt` entry's own subject is named, so adding one in
    // TypeScript without widening the printed text fails rather than being
    // quietly unreported.
    const subjects = SURFACE_SHADING_EXEMPTION.notExempt.map((s) => s.split(/[ (]/)[0].toLowerCase());
    for (const subject of subjects) {
      expect(printed, `the gate never names "${subject}"`).toContain(subject);
    }
  });

  it('names what is exempt and what is not, so the gate has something to print', () => {
    // The fourth named palette exemption, written to the shape of the three
    // before it (`TEXTURED_BUILDING_TYPES`, `TEXTURED_DECOR_FAMILIES`, the
    // campaign board). A silently weakened check is the failure mode this
    // constant exists to prevent, so the exemption has to be a value
    // something can read and print -- not a sentence in a comment.
    expect(SURFACE_SHADING_EXEMPTION.what).toMatch(/fragment/);
    expect(SURFACE_SHADING_EXEMPTION.notExempt.length).toBeGreaterThanOrEqual(3);
    expect(SURFACE_SHADING_EXEMPTION.notExempt.join(' ')).toMatch(/terrace/i);
    expect(SURFACE_SHADING_EXEMPTION.notExempt.join(' ')).toMatch(/flat ground/i);
  });
});
