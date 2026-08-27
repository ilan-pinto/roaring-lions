/**
 * Task B3.7: the pure half of structure billboards -- geometry, the
 * Sim -> plain-array snapshots, and the roofPx fallback chain, exercised
 * directly here exactly like `terrain/*.test.ts` and `instances.test.ts`
 * exercise their own pure halves. `StructureInstancer`/`loadStructureFrame`
 * need a real `WebGLRenderer`/`fetch`/`createImageBitmap` and stay untested,
 * the same reason `UnitInstancer`/`buildUnitTexture` do -- covered instead by
 * the browser verification in this task's report.
 *
 * Three of the describe blocks below are this task's own required "break
 * checks", named as such in their `it` titles: skipping the ground tone
 * under a sprited structure, drawing the sprite off the footprint's centre,
 * and letting an un-arted structure fall through to the sprite path.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim } from '@lions/sim';
import { buildBuildings, type StructureFootprint } from '../terrain/buildings';
import { groundTone, PALETTE_HEXES } from '../terrain/tones';
import type { TerrainInput } from '../terrain/types';
import { WORLD_PER_LEVEL } from '../terrain/shared';
import { TILE_W, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { screenOffsetToWorld } from '../terrain/shared';
import { VIEW_DIRECTION } from '../camera';
import { groundWorldY } from '../ground-height';
import {
  maskArtedStructures,
  liveStructurePlacements,
  deadStructurePlacements,
  resolveRoofPx,
  structureBillboardGeometry,
  writeStructureInstances,
  type StructureInstanceBuffers,
} from './structures';

const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const,
};
const BACKGROUND = '#14150F';

/** A 6x6 sim with two structure types: `mosque` (a 2x2 footprint at
 *  tiles (1,1)-(2,2), footprint centre (2, 2) exactly) and `shanty` (a
 *  single tile at (4,4), footprint centre (4.5, 4.5)) -- one even-width, one
 *  odd, so the `(min + max + 1) / 2` centre formula is exercised both ways. */
function buildSim(): { sim: Sim; mosqueIdx: number; shantyIdx: number } {
  const sim = new Sim({ seed: 1, width: 6, height: 6, capacity: 4 });
  const mosqueType = sim.addStructureType({ id: 'mosque', hp_per_tile: 100, height_px: 34, color: 'limestone.4' });
  const shantyType = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  const w = 6;
  const mosqueTiles = [1 + 1 * w, 2 + 1 * w, 1 + 2 * w, 2 + 2 * w];
  const mosqueIdx = sim.addStructure(mosqueType, mosqueTiles);
  const shantyIdx = sim.addStructure(shantyType, [4 + 4 * w]);
  return { sim, mosqueIdx, shantyIdx };
}

describe('maskArtedStructures', () => {
  it("BREAK CHECK 3: an un-arted structure's tiles stay blocked, so buildBuildings still boxes it", () => {
    const { sim } = buildSim();
    // Only mosque has art; shanty does not (hasArt returns false for it) --
    // exactly the "sheet never loaded, or failed to load" case
    // `ThreeRenderer.loadStructureSprite` leaves the type out of its own
    // instancer map for.
    const masked = maskArtedStructures(sim, (id) => id === 'mosque');
    const w = 6;
    // Mosque tiles: zeroed (the sprite draws instead).
    for (const t of [1 + 1 * w, 2 + 1 * w, 1 + 2 * w, 2 + 2 * w]) {
      expect(masked[t]).toBe(0);
    }
    // Shanty tile: still blocked -- unaffected by hasArt returning false, so
    // buildBuildings's ordinary tile loop still reaches it and boxes it.
    expect(masked[4 + 4 * w]).toBe(1);
    expect(sim.blocked[4 + 4 * w]).toBe(1);
  });

  it('does not mutate sim.blocked -- a fresh copy every call', () => {
    const { sim } = buildSim();
    const before = Array.from(sim.blocked);
    maskArtedStructures(sim, () => true);
    expect(Array.from(sim.blocked)).toEqual(before);
  });

  it('a DEAD structure is left as sim.blocked already has it, arted or not', () => {
    // destroyStructure is private; structureAt (what maskArtedStructures
    // walks) is already gated on stAlive, so flipping alive directly is
    // enough to prove a dead structure's tiles are never zeroed by this
    // function regardless of hasArt -- there is nothing left for it to mask.
    // hasArt is scoped to 'mosque' alone (rather than a blanket `() => true`)
    // so the still-ALIVE shanty's own tile -- which legitimately SHOULD be
    // masked once it, too, satisfies hasArt -- cannot muddy this assertion.
    const { sim, mosqueIdx } = buildSim();
    sim.structures.alive[mosqueIdx] = 0;
    const masked = maskArtedStructures(sim, (id) => id === 'mosque');
    expect(Array.from(masked)).toEqual(Array.from(sim.blocked));
  });

  it('BREAK CHECK 1 (guard): buildBuildings, given the masked blocked array, draws no box for the arted structure', () => {
    const { sim } = buildSim();
    const masked = maskArtedStructures(sim, (id) => id === 'mosque');
    const input: TerrainInput = { width: 6, height: 6, decor: null, elevation: null, blocked: masked, cover: new Uint8Array(36) };
    const footprints: StructureFootprint[] = [
      { tiles: [1 + 1 * 6, 2 + 1 * 6, 1 + 2 * 6, 2 + 2 * 6], heightPx: 34, colorKey: 'limestone.4', hp: 400, maxHp: 400 },
      { tiles: [4 + 4 * 6], heightPx: 11, colorKey: 'dust.1', hp: 50, maxHp: 50 },
    ];
    const m = buildBuildings(input, footprints, TONES, undefined, BACKGROUND);
    // Only the shanty's one box (3 quads, no clutter guaranteed by hp<>threshold
    // is irrelevant here -- what matters is it is not ZERO, and the mosque's
    // four tiles contributed nothing): a single un-arted tile draws at most
    // one box's worth of geometry (6 or 8 triangles), never the mosque's four.
    const trisForOneBox = 6; // 3 quads x 2 tris, upper bound check below is generous
    expect(m.indices.length).toBeGreaterThan(0);
    expect(m.indices.length).toBeLessThanOrEqual((trisForOneBox + 2) * 3); // +2 headroom for clutter
  });

  it("BREAK CHECK 1: the ground tone under the mosque's tiles is identical whether or not it has art -- it was never conditioned on buildBuildings' box in the first place", () => {
    // The load-bearing claim this module's top comment makes: `buildGround`
    // must keep reading the ORIGINAL, unmasked TerrainInput -- never the
    // masked one `maskArtedStructures` produces for buildBuildings alone.
    // Prove it by computing groundTone (what buildGround's tile loop actually
    // paints) against BOTH the original input and a hypothetical world where
    // this tile were unmasked-but-unarted, and showing they agree: groundTone
    // depends only on `blocked`/`decor`, never on which structure (if any)
    // has a loaded sprite.
    const { sim } = buildSim();
    const original: TerrainInput = { width: 6, height: 6, decor: null, elevation: null, blocked: sim.blocked, cover: sim.cover };
    const ti = 2 + 2 * 6; // one of the mosque's own tiles
    const artedTone = groundTone(original, TONES, ti, PALETTE_HEXES, BACKGROUND);

    // Now show what WOULD happen if the masked (arted-aware) array were fed
    // to groundTone instead -- the actual regression this test guards
    // against, since `mask[ti]` is 0 there (unblocked), so groundTone takes
    // the OPEN-ground branch, not the under-building one.
    const masked = maskArtedStructures(sim, () => true);
    const maskedInput: TerrainInput = { ...original, blocked: masked };
    const wrongTone = groundTone(maskedInput, TONES, ti, PALETTE_HEXES, BACKGROUND);

    expect(artedTone).not.toBe(wrongTone); // the fixture genuinely distinguishes the two
    // The correct (original-input) tone matches an equivalent UN-arted
    // structure's own tile exactly -- groundTone has no "is this arted"
    // input to even read.
    const shantyTi = 4 + 4 * 6;
    expect(groundTone(original, TONES, shantyTi, PALETTE_HEXES, BACKGROUND)).toBe(artedTone);
  });
});

describe('liveStructurePlacements / deadStructurePlacements', () => {
  it("computes the footprint centre as (min + max + 1) / 2, Pixi's own drawStructureSprite formula", () => {
    const { sim } = buildSim();
    const mosque = liveStructurePlacements(sim, 'mosque', null);
    expect(mosque).toHaveLength(1);
    expect(mosque[0].fx).toBeCloseTo(2, 10); // (1+2+1)/2
    expect(mosque[0].fy).toBeCloseTo(2, 10);

    const shanty = liveStructurePlacements(sim, 'shanty', null);
    expect(shanty).toHaveLength(1);
    expect(shanty[0].fx).toBeCloseTo(4.5, 10); // (4+4+1)/2
    expect(shanty[0].fy).toBeCloseTo(4.5, 10);
  });

  it('filters by structureId -- asking for one type never returns the other', () => {
    const { sim } = buildSim();
    expect(liveStructurePlacements(sim, 'mosque', null).some((p) => p.fx === 4.5)).toBe(false);
    expect(liveStructurePlacements(sim, 'shanty', null).some((p) => p.fx === 2)).toBe(false);
  });

  it('a full-integrity live structure gets alpha 1 (0.55 + 0.45 * 1)', () => {
    const { sim } = buildSim();
    expect(liveStructurePlacements(sim, 'mosque', null)[0].alpha).toBeCloseTo(1, 10);
  });

  it("a battered structure's alpha follows Pixi's own 0.55 + 0.45 * integrity", () => {
    const { sim, mosqueIdx } = buildSim();
    const max = sim.structures.maxHp[mosqueIdx];
    sim.structures.hp[mosqueIdx] = Math.round(max * 0.2);
    const integrity = sim.structures.hp[mosqueIdx] / max;
    expect(liveStructurePlacements(sim, 'mosque', null)[0].alpha).toBeCloseTo(0.55 + 0.45 * integrity, 10);
  });

  it('worldY is the footprint centre tile\'s own elevation-adjusted ground height', () => {
    const { sim } = buildSim();
    const elevation = new Uint8Array(36);
    elevation[2 + 2 * 6] = 3; // the tile under the mosque's footprint centre (2,2)
    const expected = groundWorldY(elevation, 6, 6, 2, 2);
    expect(expected).toBeCloseTo(3 * WORLD_PER_LEVEL, 10);
    expect(liveStructurePlacements(sim, 'mosque', elevation)[0].worldY).toBeCloseTo(expected, 10);
  });

  it('a dead structure is absent from liveStructurePlacements and present (alpha 1) in deadStructurePlacements', () => {
    const { sim, mosqueIdx } = buildSim();
    sim.structures.hp[mosqueIdx] = Math.round(sim.structures.maxHp[mosqueIdx] * 0.2); // would-be alpha != 1 if it leaked through
    sim.structures.alive[mosqueIdx] = 0;
    expect(liveStructurePlacements(sim, 'mosque', null)).toHaveLength(0);
    const dead = deadStructurePlacements(sim, 'mosque', null);
    expect(dead).toHaveLength(1);
    expect(dead[0].alpha).toBe(1);
    expect(dead[0].fx).toBeCloseTo(2, 10);
  });

  it('deadStructurePlacements is empty while the structure is alive', () => {
    const { sim } = buildSim();
    expect(deadStructurePlacements(sim, 'mosque', null)).toHaveLength(0);
  });
});

describe('resolveRoofPx -- the discrepancy this task resolves', () => {
  it('falls back to heightPx when no art is loaded (undefined art)', () => {
    expect(resolveRoofPx(undefined, 34)).toBe(34);
  });

  it('prefers roofTopPx over badgeTopPx when both are present', () => {
    expect(resolveRoofPx({ roofTopPx: 104.11, badgeTopPx: 136.65 }, 34)).toBeCloseTo(104.11, 10);
  });

  it('falls back to badgeTopPx when roofTopPx is null (an older sheet)', () => {
    expect(resolveRoofPx({ roofTopPx: null, badgeTopPx: 136.65 }, 34)).toBeCloseTo(136.65, 10);
  });

  it('falls back to heightPx when both roofTopPx and badgeTopPx are null', () => {
    expect(resolveRoofPx({ roofTopPx: null, badgeTopPx: null }, 34)).toBe(34);
  });

  it('re-measures the B3.3 gap: the mosque and one BLD_* house both close to exactly 0', () => {
    // Real manifest numbers (assets/sprites/BLD_MOSQUE, BLD_HOUSE) and real
    // data/structures.json heightPx -- the same fixtures B3.3's review used.
    // The OLD roofPx (this backend's only answer before this task) was
    // heightPx alone; re-deriving the gap it left confirms this test fixture
    // reproduces B3.3's own measurement before checking it is now closed.
    const cases = [
      { id: 'mosque', heightPx: 34, roofTopPx: 104.11, badgeTopPx: 136.65, oldGapWorld: 1.79 },
      { id: 'house', heightPx: 16, roofTopPx: 125.98, badgeTopPx: 140.86, oldGapWorld: 2.81 },
    ];
    for (const c of cases) {
      const oldRoofPx = c.heightPx; // ThreeRenderer's only answer pre-B3.7
      const newRoofPx = resolveRoofPx({ roofTopPx: c.roofTopPx, badgeTopPx: c.badgeTopPx }, c.heightPx);
      expect(newRoofPx).toBeCloseTo(c.roofTopPx, 10); // now prefers the sheet's own roof plane
      const oldGap = (c.roofTopPx - oldRoofPx) * WORLD_Y_PER_LIFT_PIXEL;
      expect(oldGap).toBeCloseTo(c.oldGapWorld, 2); // reproduces B3.3's own measured float
      const newGap = (c.roofTopPx - newRoofPx) * WORLD_Y_PER_LIFT_PIXEL;
      expect(newGap).toBeCloseTo(0, 10); // closed: occupant now stands exactly on the roof plane
    }
  });

  it('an un-arted structure keeps a gap of exactly 0 by construction (feet coplanar with the roof quad)', () => {
    // `art` is undefined for an un-arted type -- resolveRoofPx falls back to
    // heightPx, the SAME value buildings.ts's own box roof uses
    // (`roofY = topY + heightPx * WORLD_Y_PER_LIFT_PIXEL`), so the two are
    // identical by construction: nothing to "fix" here, per the brief.
    expect(resolveRoofPx(undefined, 18)).toBe(18);
  });
});

describe('structureBillboardGeometry', () => {
  // A deliberately NON-square texture (unlike every unit frame): a
  // structure's decoded bitmap is whatever the PNG actually is (this file's
  // top comment on why nothing here hardcodes 256 or 512), so this test
  // exercises a 512x600 fixture to prove drawHeightPx is NOT forced to equal
  // drawWidthPx the way a unit's square-frame assumption would.
  const scale = 4.5266; // BLD_MOSQUE's real `scale`
  const geo = structureBillboardGeometry(scale, 512, 600);
  const right = screenOffsetToWorld(1, 0);
  const F32_TOL = 5;

  it("BREAK CHECK 2: is anchored at the footprint's centre, not the feet -- both bottom vertices sit at -halfHeight, not 0", () => {
    const halfH = geo.drawHeightPx / 2;
    expect(geo.positions[0 * 3 + 1]).toBeCloseTo(-halfH * WORLD_Y_PER_LIFT_PIXEL, F32_TOL); // bl.y
    expect(geo.positions[1 * 3 + 1]).toBeCloseTo(-halfH * WORLD_Y_PER_LIFT_PIXEL, F32_TOL); // br.y
    // A feet-anchored quad (units/instances.ts's own convention) would have
    // put these at exactly 0 -- the wrong answer for a structure, per this
    // file's own top comment ("Anchor convention").
    expect(geo.positions[0 * 3 + 1]).not.toBeCloseTo(0, F32_TOL);
  });

  it('the top edge sits +halfHeight above the anchor, symmetric with the bottom', () => {
    const halfH = geo.drawHeightPx / 2;
    expect(geo.positions[2 * 3 + 1]).toBeCloseTo(halfH * WORLD_Y_PER_LIFT_PIXEL, F32_TOL); // tr.y
    expect(geo.positions[3 * 3 + 1]).toBeCloseTo(halfH * WORLD_Y_PER_LIFT_PIXEL, F32_TOL); // tl.y
  });

  it('drawn width matches scale * TILE_W, exactly Pixi\'s own formula', () => {
    expect(geo.drawWidthPx).toBeCloseTo(scale * TILE_W, 10);
  });

  it('drawn height is proportional, NOT forced square -- a 512x600 texture draws taller than it is wide', () => {
    const spriteScale = geo.drawWidthPx / 512;
    expect(geo.drawHeightPx).toBeCloseTo(600 * spriteScale, 5);
    expect(geo.drawHeightPx).not.toBeCloseTo(geo.drawWidthPx, 1);
  });

  it('is symmetric left/right about the origin', () => {
    const half = geo.drawWidthPx / 2;
    expect(geo.positions[0 * 3 + 0]).toBeCloseTo(-half * right.dx, F32_TOL); // bl.x
    expect(geo.positions[1 * 3 + 0]).toBeCloseTo(half * right.dx, F32_TOL); // br.x
  });

  it('uv: bottom samples v=1, top samples v=0 -- matches loadStructureFrame\'s explicit flipY=false', () => {
    // Browser-measured, not merely derived: an earlier draft used the
    // theoretically-matching non-inverted mapping for flipY's THREE.Texture
    // default (true) and rendered every structure upside down in practice
    // (see structureBillboardGeometry's own uv comment). This is the
    // corrected, INVERTED mapping -- identical to unitBillboardGeometry's.
    expect(Array.from(geo.uvs)).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('every triangle winds toward the camera', () => {
    const at = (i: number): [number, number, number] => [
      geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2],
    ];
    const sub = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[0] - v[0], u[1] - v[1], u[2] - v[2],
    ];
    const cross = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0],
    ];
    const dot = (u: [number, number, number], v: [number, number, number]): number =>
      u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    for (let i = 0; i < geo.indices.length; i += 3) {
      const a = at(geo.indices[i]);
      const b = at(geo.indices[i + 1]);
      const c = at(geo.indices[i + 2]);
      const normal = cross(sub(b, a), sub(c, a));
      const d = dot(normal, [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z]);
      expect(d, `triangle at index ${i} winds away from the camera`).toBeGreaterThan(0);
    }
  });

  it('a zero-width texture degrades to a zero-size quad rather than dividing by zero into NaN/Infinity', () => {
    const degenerate = structureBillboardGeometry(scale, 0, 0);
    expect(degenerate.drawWidthPx).toBeCloseTo(scale * TILE_W, 10);
    expect(degenerate.drawHeightPx).toBe(0);
    expect(Array.from(degenerate.positions).every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe('writeStructureInstances', () => {
  function buffers(cap: number): StructureInstanceBuffers {
    return { positions: new Float32Array(cap * 3), alphas: new Float32Array(cap) };
  }

  it('writes fx/worldY/fy per placement and returns the count', () => {
    const out = buffers(2);
    const count = writeStructureInstances(
      [
        { fx: 2, fy: 3, worldY: 0.5, alpha: 1 },
        { fx: 4.5, fy: 4.5, worldY: 0, alpha: 0.7 },
      ],
      out
    );
    expect(count).toBe(2);
    expect(Array.from(out.positions)).toEqual([2, 0.5, 3, 4.5, 0, 4.5]);
    // Float32Array precision: 0.7 is not exactly representable, so compare
    // against the same rounding rather than the double-precision literal.
    expect(Array.from(out.alphas)).toEqual(Array.from(Float32Array.from([1, 0.7])));
  });

  it('an empty placement list writes nothing and returns 0', () => {
    const out = buffers(1);
    expect(writeStructureInstances([], out)).toBe(0);
  });

  it('BREAK CHECK (A1): more placements than capacity clamps at capacity instead of silently overrunning the buffer', () => {
    // Before this clamp existed, a past-the-end write here would be a
    // silent no-op (JS typed arrays do not throw on out-of-range indices)
    // while the returned count kept climbing past `out`'s real size -- the
    // caller would then set `mesh.count` beyond what was actually written,
    // and every instance past the real data reads (0, 0, 0) at alpha 0,
    // alpha-discarded. Proven here by checking both the clamped return value
    // and that the slots the clamp did allow to write hold real data.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = buffers(2);
      const count = writeStructureInstances(
        [
          { fx: 1, fy: 1, worldY: 0, alpha: 1 },
          { fx: 2, fy: 2, worldY: 0, alpha: 1 },
          { fx: 3, fy: 3, worldY: 0, alpha: 1 },
        ],
        out
      );
      expect(count).toBe(2);
      expect(out.positions[0]).toBe(1);
      expect(out.positions[3]).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });
});
