/**
 * The pure half of Task B3.5 -- geometry, the facing lookup and the
 * per-instance attribute arithmetic are plain numbers, exercised directly
 * here, the same split `atlas.test.ts` draws between `packSheet` (tested)
 * and `buildUnitTexture` (not). `UnitInstancer`'s per-frame `update` still
 * needs a real `WebGLRenderer` to mean anything and stays untested (the same
 * reason `ThreeRenderer` has no test file) -- but its *construction*, and in
 * particular the static material flags that make the render-order tie-break
 * mechanism work (see `instances.ts`'s own top comment, "The unit-vs-tree
 * tie, and what actually resolves it"), needs no GPU at all: `THREE.Material`
 * and friends are plain JS objects under `environment: 'node'`, the same
 * fact `palette-material.test.ts` already relies on for `new THREE.Color`.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseManifest, type SheetSpec } from '../../sheet';
import { packSheet } from './atlas';
import type { EntityFrame } from './frame-state';
import {
  UnitInstancer,
  facingIndex,
  unitBillboardGeometry,
  writeUnitInstances,
  type UnitInstanceBuffers,
} from './instances';
import { TILE_W, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { screenOffsetToWorld, WORLD_PER_LEVEL } from '../terrain/shared';
import { VIEW_DIRECTION } from '../camera';
import { groundWorldY } from '../ground-height';
import infSquadManifest from '../../../../../assets/sprites/INF_SQUAD/manifest.json';

const infSquad: SheetSpec = parseManifest(infSquadManifest);

/** A small, easy-to-hand-check sheet: 4 facings, one clip, one frame. */
const tinySheet: SheetSpec = {
  facings: 4,
  facingOffset: 0,
  facingReverse: false,
  scale: 1,
  layout: 'clip',
  clips: { idle: { frames: 1, fps: 0, loop: true, fileOffset: 0 } },
};

describe('facingIndex', () => {
  it('is 0 at facingNorm 0 with no offset or reverse', () => {
    expect(facingIndex(0, tinySheet)).toBe(0);
  });

  it('rounds to the nearest facing and wraps at the top', () => {
    // 4 facings: 0.99 rounds to index 4, which wraps to 0.
    expect(facingIndex(0.99, tinySheet)).toBe(0);
    expect(facingIndex(0.24, tinySheet)).toBe(1);
  });

  it('applies facingOffset', () => {
    const offset: SheetSpec = { ...tinySheet, facingOffset: 2 };
    expect(facingIndex(0, offset)).toBe(2);
  });

  it('applies facingReverse before the offset, matching Pixi exactly', () => {
    // Ported formula: dir = reverse ? -k : k; return ((dir + offset) % n + n) % n.
    const reversed: SheetSpec = { ...tinySheet, facingOffset: 1, facingReverse: true };
    // facingNorm 0.25 of 4 facings -> k = 1 -> dir = -1 -> (-1 + 1) % 4 = 0.
    expect(facingIndex(0.25, reversed)).toBe(0);
  });

  it('matches the real INF_SQUAD sheet (facingOffset 12, facingReverse true, 16 facings)', () => {
    // k = round(0 * 16) = 0 -> dir = -0 = 0 -> (0 + 12) % 16 = 12.
    expect(facingIndex(0, infSquad)).toBe(12);
    // k = round(0.25 * 16) = 4 -> dir = -4 -> (-4 + 12) % 16 = 8.
    expect(facingIndex(0.25, infSquad)).toBe(8);
  });

  it('never returns a negative index or one outside [0, facings)', () => {
    for (let i = 0; i <= 20; i++) {
      const idx = facingIndex(i / 20, infSquad);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(infSquad.facings);
    }
  });
});

describe('unitBillboardGeometry', () => {
  const geo = unitBillboardGeometry(infSquad);
  const drawPx = infSquad.scale * TILE_W;
  const right = screenOffsetToWorld(1, 0);

  // Vertex order is bl, br, tr, tl, each 3 floats (x, y, z) -- vertex i's y
  // sits at positions[i * 3 + 1]. `positions` is a Float32Array (uploaded to
  // the GPU as one), so every comparison below tolerates float32 rounding
  // rather than the double-precision exactness `toBeCloseTo(x, 10)` assumes.
  const F32_TOL = 5;

  it('is anchored at the feet: both bottom vertices sit at exactly 0, not the quad centre', () => {
    // No bias -- local up 0 is the entity's real, unmodified groundWorldY.
    // See instances.ts's own top comment for why a constant offset was
    // removed (it could not separate this quad from a coplanar one anyway).
    expect(geo.positions[0 * 3 + 1]).toBeCloseTo(0, F32_TOL); // bl.y
    expect(geo.positions[1 * 3 + 1]).toBeCloseTo(0, F32_TOL); // br.y
  });

  it('the top edge sits a full draw height above the feet, converted through WORLD_Y_PER_LIFT_PIXEL', () => {
    const topY = drawPx * WORLD_Y_PER_LIFT_PIXEL;
    expect(geo.positions[2 * 3 + 1]).toBeCloseTo(topY, F32_TOL); // tr.y
    expect(geo.positions[3 * 3 + 1]).toBeCloseTo(topY, F32_TOL); // tl.y
  });

  it('is symmetric left/right about the origin, sized to sheet.scale * TILE_W in screen px', () => {
    const half = drawPx / 2;
    expect(geo.positions[0 * 3 + 0]).toBeCloseTo(-half * right.dx, F32_TOL); // bl.x
    expect(geo.positions[1 * 3 + 0]).toBeCloseTo(half * right.dx, F32_TOL); // br.x
    expect(geo.positions[0 * 3 + 2]).toBeCloseTo(-half * right.dy, F32_TOL); // bl.z
    expect(geo.positions[1 * 3 + 2]).toBeCloseTo(half * right.dy, F32_TOL); // br.z
  });

  it('uv: bottom (feet) samples v=1, top samples v=0 -- matches DataArrayTexture flipY=false', () => {
    expect(Array.from(geo.uvs)).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('every triangle winds toward the camera', () => {
    // Same technique grove.test.ts uses to prove its own billboards front-face
    // this camera: a wrong winding does not render dark under FrontSide, it
    // renders as nothing.
    const at = (i: number): [number, number, number] => [
      geo.positions[i * 3],
      geo.positions[i * 3 + 1],
      geo.positions[i * 3 + 2],
    ];
    const sub = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[0] - v[0],
      u[1] - v[1],
      u[2] - v[2],
    ];
    const cross = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
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

  it('scales with sheet.scale, matching Pixi\'s own draw-width formula', () => {
    const doubled: SheetSpec = { ...infSquad, scale: infSquad.scale * 2 };
    const bigGeo = unitBillboardGeometry(doubled);
    // Top edge (feet are at exactly 0, so no offset to subtract) should be
    // twice as far above the feet in world Y.
    const smallRise = geo.positions[2 * 3 + 1];
    const bigRise = bigGeo.positions[2 * 3 + 1];
    expect(bigRise).toBeCloseTo(smallRise * 2, F32_TOL);
  });
});

describe('the unit-vs-tree depth tie is real', () => {
  it('a unit and a co-located tree trunk base compute the identical ground height', () => {
    // 4x4 flat-except-one-tile grid, level 3 at (1, 1) -- grove.ts's own
    // trunk base for a tree on that tile is `levelAt(...) * WORLD_PER_LEVEL`;
    // groundWorldY (what entityFrame gives a unit's worldY, and what
    // unitBillboardGeometry's own feet vertex -- local up 0, no offset --
    // sits on top of) is the same formula through the same
    // levelAt/WORLD_PER_LEVEL, proven here rather than assumed from both
    // modules importing the same symbols. This is exactly the coincidence
    // that makes the render-order tie-break (tested below) load-bearing
    // rather than academic: nothing in this module's own geometry
    // separates the two.
    // prettier-ignore
    const elevation = new Uint8Array([
      0, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const unitWorldY = groundWorldY(elevation, 4, 4, 1.5, 1.5);
    const treeBaseWorldY = 3 * WORLD_PER_LEVEL;
    expect(unitWorldY).toBeCloseTo(treeBaseWorldY, 12);
  });
});

describe('the render-order tie-break', () => {
  // What actually resolves the coincidence above: terrain (ground, scatter,
  // grove, buildings) is opaque `MeshBasicMaterial`; three.js finishes the
  // whole opaque pass -- committing its depths -- before drawing anything
  // transparent, and its default LessEqualDepth comparison then lets an
  // equal-depth transparent fragment pass and overwrite. These three flags
  // are the precondition for that mechanism; UnitInstancer's construction
  // needs no GPU, so they are asserted directly rather than trusted from
  // the module's own doc comment. (The depth-test outcome itself is a GPU
  // behaviour this suite cannot execute -- see instances.ts's top comment
  // for the NDC measurement that confirms it, and the B3.5 report for the
  // browser screenshots.)
  it('the unit material is transparent with depth test and depth write both on', () => {
    const packing = packSheet(infSquad);
    const instancer = new UnitInstancer(infSquad, new THREE.DataArrayTexture(), packing, 4);
    const material = instancer.mesh.material;
    expect(Array.isArray(material)).toBe(false);
    const m = material as THREE.Material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
  });
});

/** Minimal EntityFrame fixture -- only the fields writeUnitInstances reads. */
function makeFrame(overrides: Partial<EntityFrame> = {}): EntityFrame {
  return {
    wx: 0,
    wy: 0,
    worldY: 0,
    clip: 'idle',
    frame: 0,
    facing: 0,
    alpha: 1,
    roofDx: 0,
    roofDy: 0,
    visible: true,
    ...overrides,
  };
}

describe('writeUnitInstances', () => {
  const packing = packSheet(infSquad);

  function buffers(capacity: number): UnitInstanceBuffers {
    return {
      positions: new Float32Array(capacity * 3),
      layers: new Float32Array(capacity),
      alphas: new Float32Array(capacity),
    };
  }

  it('skips invisible frames and returns the visible count', () => {
    const frames = [makeFrame({ visible: true }), makeFrame({ visible: false }), makeFrame({ visible: true })];
    const out = buffers(3);
    const count = writeUnitInstances(frames, infSquad, packing, out);
    expect(count).toBe(2);
  });

  it('writes world position as wx/worldY/wy when roofDx is 0', () => {
    const frames = [makeFrame({ wx: 5, worldY: 1.5, wy: 7, roofDx: 0 })];
    const out = buffers(1);
    writeUnitInstances(frames, infSquad, packing, out);
    expect(out.positions[0]).toBeCloseTo(5, 10);
    expect(out.positions[1]).toBeCloseTo(1.5, 10);
    expect(out.positions[2]).toBeCloseTo(7, 10);
  });

  it('folds roofDx through the same right axis every terrain mark uses', () => {
    const right = screenOffsetToWorld(1, 0);
    const frames = [makeFrame({ wx: 0, worldY: 0, wy: 0, roofDx: 13 })];
    const out = buffers(1);
    writeUnitInstances(frames, infSquad, packing, out);
    expect(out.positions[0]).toBeCloseTo(right.dx * 13, 10);
    expect(out.positions[2]).toBeCloseTo(right.dy * 13, 10);
  });

  it('resolves the DataArrayTexture layer through facingIndex, not the raw normalised facing', () => {
    // facingNorm 0 on INF_SQUAD -> facingIndex 12 (offset 12, reverse true).
    const frames = [makeFrame({ clip: 'idle', frame: 0, facing: 0 })];
    const out = buffers(1);
    writeUnitInstances(frames, infSquad, packing, out);
    const expectedLayer = packing.regionFor('idle', facingIndex(0, infSquad), 0).layer;
    expect(out.layers[0]).toBe(expectedLayer);
  });

  it('passes body alpha through unchanged', () => {
    const frames = [makeFrame({ alpha: 0.35 })];
    const out = buffers(1);
    writeUnitInstances(frames, infSquad, packing, out);
    // out.alphas is a Float32Array, so 0.35 (not exactly representable in
    // float32) round-trips to a nearby value rather than itself.
    expect(out.alphas[0]).toBeCloseTo(0.35, 5);
  });

  it('preserves order and packs visible entries starting at index 0', () => {
    const frames = [
      makeFrame({ wx: 1, visible: false }),
      makeFrame({ wx: 2, visible: true }),
      makeFrame({ wx: 3, visible: true }),
    ];
    const out = buffers(3);
    const count = writeUnitInstances(frames, infSquad, packing, out);
    expect(count).toBe(2);
    expect(out.positions[0]).toBeCloseTo(2, 10);
    expect(out.positions[3]).toBeCloseTo(3, 10);
  });
});
