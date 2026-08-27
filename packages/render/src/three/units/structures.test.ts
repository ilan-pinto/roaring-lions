/**
 * Task B3.7: the pure half of structure billboards -- geometry, the
 * Sim -> plain-array snapshots, and the roofPx fallback chain, exercised
 * directly here exactly like `terrain/*.test.ts` and `instances.test.ts`
 * exercise their own pure halves. `StructureInstancer`/`loadStructureFrame`
 * need a real `WebGLRenderer`/`fetch`/`createImageBitmap` and stay untested,
 * the same reason `UnitInstancer`/`buildUnitTexture` do -- covered instead by
 * the browser verification in this task's report.
 *
 * One of this task's own required "break checks" lives here, named as such
 * in its `it` title: drawing the sprite off the footprint's centre. The
 * other two -- skipping the ground tone under a sprited structure, and
 * letting an un-arted structure fall through to the sprite path -- were
 * originally proven here against this file's own `maskArtedStructures`, the
 * function `composeTerrain`/`withoutLiveStructures` (`ThreeRenderer.ts`,
 * Task B3.9) replaced when buildings stopped being one merged mesh; Task C1
 * removed that now-dead function and its describe block, since nothing but
 * its own tests still called it. The same two claims are proven now in
 * `packages/app/src/terrain-parity.test.ts`'s `composeTerrain` describe
 * block instead, against the function that actually ships.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { Sim } from '@lions/sim';
import { buildBuildings, type StructureFootprint } from '../terrain/buildings';
import type { TerrainInput } from '../terrain/types';
import { WORLD_PER_LEVEL } from '../terrain/shared';
import { TILE_W, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { screenOffsetToWorld } from '../terrain/shared';
import { VIEW_DIRECTION } from '../camera';
import { groundWorldY } from '../ground-height';
import {
  liveStructurePlacements,
  deadStructurePlacements,
  resolveRoofPx,
  structureAliveAlpha,
  structureBillboardGeometry,
  collapseBillboardGeometry,
  collapseFrame,
  COLLAPSE_SECONDS,
  COLLAPSE_SQUASH,
  writeStructureInstances,
  footprintCentre,
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

/**
 * Task B4: repo root, reached from this file's own location
 * (`packages/render/src/three/units/`) rather than `@lions/data` --
 * `packages/render/src/**` may not statically import `@lions/(app|data)`
 * (ESLint-enforced, `eslint.config.mjs`), tests included, which is why
 * `terrain-parity.test.ts` (which needs exactly this data) lives in
 * `packages/app` instead. Reading the raw JSON off disk sidesteps that
 * restriction without moving this file -- the same technique
 * `tools/src/terrain_symbols.test.ts` already uses for its own cross-package
 * drift check.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

/** `roofTopPx`/`badgeTopPx` read straight off a shipped structure sheet's
 *  own `manifest.json` -- see `resolveRoofPx`'s own doc comment for what
 *  they mean. `manifestDir` is the sheet's directory name under
 *  `assets/sprites/` (e.g. `BLD_MOSQUE`). */
function readStructureManifest(manifestDir: string): { roofTopPx: number; badgeTopPx: number } {
  const raw: unknown = JSON.parse(
    readFileSync(join(ROOT, 'assets/sprites', manifestDir, 'manifest.json'), 'utf8')
  );
  const manifest = raw as { roofTopPx?: number; badgeTopPx?: number };
  if (typeof manifest.roofTopPx !== 'number' || typeof manifest.badgeTopPx !== 'number') {
    throw new Error(`assets/sprites/${manifestDir}/manifest.json is missing roofTopPx/badgeTopPx`);
  }
  return { roofTopPx: manifest.roofTopPx, badgeTopPx: manifest.badgeTopPx };
}

/** `height_px` read straight off `data/structures.json` for one structure
 *  id -- the same catalogue `@lions/data`'s `structures` export wraps,
 *  without importing that package (see `ROOT`'s own comment). */
function readStructureHeightPx(structureId: string): number {
  const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'data/structures.json'), 'utf8'));
  const catalogue = raw as { types?: Record<string, { height_px?: number }> };
  const entry = catalogue.types?.[structureId];
  if (typeof entry?.height_px !== 'number') {
    throw new Error(`data/structures.json has no numeric height_px for structure type "${structureId}"`);
  }
  return entry.height_px;
}

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
    // Task B4: real manifest numbers (assets/sprites/BLD_MOSQUE, BLD_HOUSE)
    // and real data/structures.json heightPx, READ off those files rather
    // than hardcoded -- the previous version pinned four literals (104.11,
    // 136.65, 125.98, 140.86) plus a fifth and sixth (34, 16) that a
    // re-render or a structures.json edit could drift out from under
    // silently, with the test still green. `packages/render/src/**` may not
    // statically import `@lions/data` (ESLint-enforced), hence reading the
    // raw JSON directly rather than importing the `structures` catalogue.
    const cases = [
      { id: 'mosque', manifestDir: 'BLD_MOSQUE' },
      { id: 'house', manifestDir: 'BLD_HOUSE' },
    ];
    for (const c of cases) {
      const heightPx = readStructureHeightPx(c.id);
      const { roofTopPx, badgeTopPx } = readStructureManifest(c.manifestDir);
      const oldRoofPx = heightPx; // ThreeRenderer's only answer pre-B3.7
      const newRoofPx = resolveRoofPx({ roofTopPx, badgeTopPx }, heightPx);
      expect(newRoofPx).toBeCloseTo(roofTopPx, 10); // now prefers the sheet's own roof plane
      const oldGap = (roofTopPx - oldRoofPx) * WORLD_Y_PER_LIFT_PIXEL;
      expect(oldGap).toBeGreaterThan(0); // B3.3 found a real, nonzero gap here
      const newGap = (roofTopPx - newRoofPx) * WORLD_Y_PER_LIFT_PIXEL;
      expect(newGap).toBeCloseTo(0, 10); // closed: occupant now stands exactly on the roof plane
    }
  });

  it("BREAK CHECK (B3): an un-arted structure's fallback is coplanar with buildings.ts's OWN roof plane, not merely a copy of resolveRoofPx's own argument", () => {
    // The previous version of this test asserted only
    // `resolveRoofPx(undefined, 18) === 18` -- functionally identical to the
    // "falls back to heightPx" test above it, and it never referenced
    // `buildings.ts` at all. It would have kept passing even if
    // `buildings.ts`'s own roof formula (`roofY = topY + heightPx *
    // WORLD_Y_PER_LIFT_PIXEL`, `buildings.ts`'s `pushBox`) changed
    // underneath it. This version instead reads `buildings.ts`'s REAL box
    // geometry off a real `buildBuildings` call and checks `resolveRoofPx`'s
    // fallback lands exactly on that roof plane -- the actual coplanarity
    // claim the title makes.
    const heightPx = 18;
    const input: TerrainInput = {
      width: 1,
      height: 1,
      decor: null,
      elevation: null,
      blocked: Uint8Array.from([1]),
      cover: new Uint8Array(1),
    };
    const footprint: StructureFootprint = { tiles: [0], heightPx, colorKey: 'dust.1', hp: 100, maxHp: 100 };
    const mesh = buildBuildings(input, [footprint], TONES, undefined, BACKGROUND);
    // `pushBox` (buildings.ts) emits the south wall first: `[x, roofY, y+1],
    // [x+1, roofY, y+1], [x+1, topY, y+1], [x, topY, y+1]` -- vertex 0's y IS
    // the roof plane's real world height, read off actual output rather than
    // re-derived by this test.
    const roofY = mesh.positions[1];
    const topY = 0; // flat tile: elevation null -> levelAt returns 0
    const occupantY = topY + resolveRoofPx(undefined, heightPx) * WORLD_Y_PER_LIFT_PIXEL;
    // `mesh.positions` is a Float32Array (uploaded to the GPU as one, same
    // reason `instances.test.ts`'s own `F32_TOL` exists) -- comparing
    // against `occupantY`'s double-precision arithmetic needs a tolerance
    // that survives the round-trip through single precision, not
    // double-precision exactness.
    expect(occupantY).toBeCloseTo(roofY, 5);
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

describe('structureAliveAlpha', () => {
  it('full integrity (hp === maxHp) gives alpha 1', () => {
    expect(structureAliveAlpha(100, 100)).toBeCloseTo(1, 10);
  });

  it('zero hp gives the floor, 0.55', () => {
    expect(structureAliveAlpha(0, 100)).toBeCloseTo(0.55, 10);
  });

  it('follows 0.55 + 0.45 * integrity at a mid-damage point, exactly matching structurePlacements\' own formula', () => {
    expect(structureAliveAlpha(20, 100)).toBeCloseTo(0.55 + 0.45 * 0.2, 10);
  });

  it('negative hp (never observed in practice -- destroyStructure clamps to 0) still clamps to the floor rather than going negative', () => {
    expect(structureAliveAlpha(-50, 100)).toBeCloseTo(0.55, 10);
  });

  it('a zero maxHp degrades to full alpha rather than dividing by zero into NaN', () => {
    expect(structureAliveAlpha(0, 0)).toBeCloseTo(1, 10);
  });
});

describe('footprintCentre', () => {
  it("matches liveStructurePlacements' own (min + max + 1) / 2 formula for the same structure", () => {
    const { sim, mosqueIdx } = buildSim();
    const { fx, fy } = footprintCentre(sim, mosqueIdx);
    const placement = liveStructurePlacements(sim, 'mosque', null)[0];
    expect(fx).toBeCloseTo(placement.fx, 10);
    expect(fy).toBeCloseTo(placement.fy, 10);
  });
});

describe('collapseBillboardGeometry', () => {
  // Same fixture as structureBillboardGeometry's own describe block above,
  // so the two are directly comparable -- this geometry is meant to be the
  // SAME size, only re-anchored.
  const scale = 4.5266;
  const centred = structureBillboardGeometry(scale, 512, 600);
  const geo = collapseBillboardGeometry(scale, 512, 600);
  const F32_TOL = 5;

  it('draws at the exact same width/height as the centred geometry for identical inputs -- only the anchor differs', () => {
    expect(geo.drawWidthPx).toBeCloseTo(centred.drawWidthPx, 10);
    expect(geo.drawHeightPx).toBeCloseTo(centred.drawHeightPx, 10);
  });

  it('is BASE-anchored: both bottom vertices sit at local y = 0, not -halfHeight', () => {
    expect(geo.positions[0 * 3 + 1]).toBeCloseTo(0, F32_TOL); // bl.y
    expect(geo.positions[1 * 3 + 1]).toBeCloseTo(0, F32_TOL); // br.y
  });

  it('the top edge sits a full drawHeightPx above the base, not merely halfHeight', () => {
    const fullH = geo.drawHeightPx * WORLD_Y_PER_LIFT_PIXEL;
    expect(geo.positions[2 * 3 + 1]).toBeCloseTo(fullH, F32_TOL); // tr.y
    expect(geo.positions[3 * 3 + 1]).toBeCloseTo(fullH, F32_TOL); // tl.y
  });

  it("the base sits at the SAME world point the centred geometry's own bottom edge sat at, once translated by -halfHeight", () => {
    // ThreeRenderer.beginCollapse translates this quad's local origin to
    // `worldY - halfHeight`. Reproduced here: base-anchored bl.y (0) plus
    // that translation should equal centred bl.y plus zero translation.
    const halfHeight = (centred.drawHeightPx / 2) * WORLD_Y_PER_LIFT_PIXEL;
    const collapseBaseWorldY = geo.positions[0 * 3 + 1] - halfHeight;
    expect(collapseBaseWorldY).toBeCloseTo(centred.positions[0 * 3 + 1], F32_TOL);
  });

  it('is symmetric left/right about the origin, matching the centred geometry\'s own X/Z extents', () => {
    expect(geo.positions[0 * 3 + 0]).toBeCloseTo(centred.positions[0 * 3 + 0], F32_TOL); // bl.x
    expect(geo.positions[1 * 3 + 0]).toBeCloseTo(centred.positions[1 * 3 + 0], F32_TOL); // br.x
  });

  it('uv/index convention matches structureBillboardGeometry exactly -- same texture, same camera, same winding', () => {
    expect(Array.from(geo.uvs)).toEqual(Array.from(centred.uvs));
    expect(Array.from(geo.indices)).toEqual(Array.from(centred.indices));
  });

  it('a zero-width texture degrades to a zero-size quad rather than dividing by zero into NaN/Infinity', () => {
    const degenerate = collapseBillboardGeometry(scale, 0, 0);
    expect(degenerate.drawWidthPx).toBeCloseTo(scale * TILE_W, 10);
    expect(degenerate.drawHeightPx).toBe(0);
    expect(Array.from(degenerate.positions).every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe('collapseFrame', () => {
  it('at t = 0, scaleY is 1 (rest scale) and alpha is unchanged from alpha0', () => {
    const frame = collapseFrame(0, 0.8);
    expect(frame.scaleY).toBeCloseTo(1, 10);
    expect(frame.alpha).toBeCloseTo(0.8, 10);
    expect(frame.done).toBe(false);
  });

  it('follows squared easing at the midpoint: p = 0.5, e = 0.25', () => {
    const frame = collapseFrame(COLLAPSE_SECONDS / 2, 1);
    expect(frame.scaleY).toBeCloseTo(1 - COLLAPSE_SQUASH * 0.25, 10);
    expect(frame.alpha).toBeCloseTo(1 * (1 - 0.25), 10);
    expect(frame.done).toBe(false);
  });

  it('at t = COLLAPSE_SECONDS, the fall is done: alpha reaches 0, scaleY reaches 1 - COLLAPSE_SQUASH', () => {
    const frame = collapseFrame(COLLAPSE_SECONDS, 1);
    expect(frame.scaleY).toBeCloseTo(1 - COLLAPSE_SQUASH, 10);
    expect(frame.alpha).toBeCloseTo(0, 10);
    expect(frame.done).toBe(true);
  });

  it('t past COLLAPSE_SECONDS clamps rather than overshooting (p is capped at 1)', () => {
    const atEnd = collapseFrame(COLLAPSE_SECONDS, 1);
    const wayPast = collapseFrame(COLLAPSE_SECONDS * 5, 1);
    expect(wayPast.scaleY).toBeCloseTo(atEnd.scaleY, 10);
    expect(wayPast.alpha).toBeCloseTo(atEnd.alpha, 10);
    expect(wayPast.done).toBe(true);
  });

  it('a linear fall would NOT match this -- confirms the easing is genuinely squared, not linear', () => {
    // At p = 0.5 a LINEAR fall would have eased exactly half the distance
    // (e = 0.5); the squared curve eases only a quarter (e = 0.25) -- so the
    // squared result must sit strictly ABOVE (less collapsed than) the
    // linear one at the midpoint, matching Pixi's own "accelerates as it
    // goes" reasoning.
    const squared = collapseFrame(COLLAPSE_SECONDS / 2, 1);
    const linearAlpha = 1 * (1 - 0.5);
    expect(squared.alpha).toBeGreaterThan(linearAlpha);
  });
});
