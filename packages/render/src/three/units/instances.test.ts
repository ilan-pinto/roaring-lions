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
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { parseManifest, type SheetSpec } from '../../sheet';
import { packSheet, FRAME_PX } from './atlas';
import type { EntityFrame } from './frame-state';
import {
  UnitInstancer,
  facingIndex,
  unitBillboardGeometry,
  writeUnitInstances,
  writeTurretInstances,
  HULL_RENDER_ORDER,
  TURRET_RENDER_ORDER,
  type UnitInstanceBuffers,
} from './instances';
import { TILE_W, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { screenOffsetToWorld, WORLD_PER_LEVEL } from '../terrain/shared';
import { VIEW_DIRECTION, dimetricCamera } from '../camera';
import { groundWorldY } from '../ground-height';
import infSquadManifest from '../../../../../assets/sprites/INF_SQUAD/manifest.json';
import tnkHullManifest from '../../../../../assets/sprites/TNK_HULL/manifest.json';

const infSquad: SheetSpec = parseManifest(infSquadManifest);
const tnkHull: SheetSpec = parseManifest(tnkHullManifest);

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

  it('is anchored at the centre, matching Pixi: the quad straddles world Y 0 symmetrically, not based at 0', () => {
    // BREAK CHECK: an earlier version of this module anchored the quad at
    // the feet (bl/br.y === 0, tr/tl.y === a full draw height above) --
    // exactly the shape this test now asserts is WRONG, per
    // instances.ts's own top comment ("Anchored at the centre, matching
    // Pixi") and the golden-image-diff measurement that forced the change
    // (every unit rendered drawPx/2 too high). Flipping this assertion back
    // to the old feet-anchored shape is the regression this guards.
    const halfY = (drawPx / 2) * WORLD_Y_PER_LIFT_PIXEL;
    expect(geo.positions[0 * 3 + 1]).toBeCloseTo(-halfY, F32_TOL); // bl.y
    expect(geo.positions[1 * 3 + 1]).toBeCloseTo(-halfY, F32_TOL); // br.y
    expect(geo.positions[2 * 3 + 1]).toBeCloseTo(halfY, F32_TOL); // tr.y
    expect(geo.positions[3 * 3 + 1]).toBeCloseTo(halfY, F32_TOL); // tl.y
  });

  it('the translation (local up = 0) is not itself a vertex: the top and bottom edges sit equal distances above and below it', () => {
    // The entity's own groundWorldY is what `writeUnitInstances` writes as
    // the instance translation -- this geometry only decides where, RELATIVE
    // to that translation, the quad's four corners fall. Centred means the
    // translation is the quad's midpoint, not one of its edges.
    const bottomY = geo.positions[0 * 3 + 1];
    const topY = geo.positions[2 * 3 + 1];
    expect(topY).toBeCloseTo(-bottomY, F32_TOL);
    expect(topY - bottomY).toBeCloseTo(drawPx * WORLD_Y_PER_LIFT_PIXEL, F32_TOL);
  });

  it('is symmetric left/right about the origin, sized to sheet.scale * TILE_W in screen px', () => {
    const half = drawPx / 2;
    expect(geo.positions[0 * 3 + 0]).toBeCloseTo(-half * right.dx, F32_TOL); // bl.x
    expect(geo.positions[1 * 3 + 0]).toBeCloseTo(half * right.dx, F32_TOL); // br.x
    expect(geo.positions[0 * 3 + 2]).toBeCloseTo(-half * right.dy, F32_TOL); // bl.z
    expect(geo.positions[1 * 3 + 2]).toBeCloseTo(half * right.dy, F32_TOL); // br.z
  });

  it('uv: bottom edge samples v=1, top edge samples v=0 -- matches DataArrayTexture flipY=false', () => {
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
    // Top edge sits at +half*WORLD_Y_PER_LIFT_PIXEL above the translation,
    // so doubling sheet.scale should double that rise exactly.
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
    // unitBillboardGeometry's own translation -- local up 0, the quad's
    // geometric middle, no offset -- sits exactly on) is the same formula
    // through the same levelAt/WORLD_PER_LEVEL, proven here rather than
    // assumed from both modules importing the same symbols. This is exactly
    // the coincidence that makes the render-order tie-break (tested below)
    // load-bearing rather than academic: nothing in this module's own
    // geometry separates the two.
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

  it('defaults to HULL_RENDER_ORDER, not an unset/implicit value', () => {
    const packing = packSheet(infSquad);
    const instancer = new UnitInstancer(infSquad, new THREE.DataArrayTexture(), packing, 4);
    expect(instancer.mesh.renderOrder).toBe(HULL_RENDER_ORDER);
    expect(HULL_RENDER_ORDER).toBe(0);
  });

  it("a turret instancer's renderOrder is strictly above a hull's, pinned by VALUE -- not by which one happened to be constructed first", () => {
    // Task B3.6's own regression: mbt_lavi/apc_eitan/ifv_namer declare no
    // turretAxisPx, so their turret quad is exactly co-located with the
    // hull's at identical depth. Before this, correct draw order depended
    // on ThreeRenderer.loadSprites always constructing the hull
    // UnitInstancer first (an insertion-order/Object3D.id tie-break this
    // class has no control over) -- exactly the hazard units/fx.ts's own
    // renderOrder split exists to avoid. This test would pass just as
    // happily if a future edit constructed the turret instancer FIRST; only
    // asserting the VALUES (not "whichever was built first wins") catches
    // that regression.
    const packing = packSheet(infSquad);
    const hull = new UnitInstancer(infSquad, new THREE.DataArrayTexture(), packing, 4);
    const turret = new UnitInstancer(infSquad, new THREE.DataArrayTexture(), packing, 4, TURRET_RENDER_ORDER);
    expect(turret.mesh.renderOrder).toBeGreaterThan(hull.mesh.renderOrder);
    expect(turret.mesh.renderOrder).toBe(TURRET_RENDER_ORDER);
  });
});

describe('the ground-clip depth clamp', () => {
  // Task D: instances.ts's own top comment, "Fixed: a per-vertex depth
  // clamp, not a second quad" -- the below-ground half of a centred
  // billboard quad is genuinely FARTHER from the camera than the ground
  // beneath it, under this camera's fixed pitch, which is what let the
  // ground win the (unclamped) depth test and clip a vehicle's own tracks.
  // `mbt_lavi`'s TNK_HULL is the exact sheet the golden-diff crop on file
  // caught this on -- used here rather than a synthetic sheet so the
  // numbers below are the real ones, not a stand-in.
  const CAM = { x: 24, y: 24, zoom: 1 };
  const VP = { width: 800, height: 600 };
  const camera = dimetricCamera(CAM, VP);

  /** NDC z (post-divide, via THREE.Vector3.project -- the same call
   *  worldToScreenThree already relies on for x/y). Smaller is nearer the
   *  camera under three.js's default depth convention. */
  function ndcZ(x: number, y: number, z: number): number {
    const v = new THREE.Vector3(x, y, z);
    v.project(camera);
    return v.z;
  }

  const geo = unitBillboardGeometry(tnkHull);
  // An entity standing at tile (24, 24) on flat ground (worldY 0) --
  // matches `beit_sahwan_outskirts`, the flat map the defect was captured
  // on ("no relief involved" is the point).
  const tx = 24;
  const tz = 24;

  it('BREAK CHECK: the below-ground half of a real vehicle billboard is genuinely farther from the camera than its own ground contact point', () => {
    // bl (index 0) is the BOTTOM edge, local up = -half (below the
    // translation, where the tracks are drawn); tr (index 2) is the TOP
    // edge, local up = +half.
    const bottomLocalY = geo.positions[0 * 3 + 1];
    const topLocalY = geo.positions[2 * 3 + 1];
    expect(bottomLocalY).toBeLessThan(0); // sanity: really is below ground

    const zGround = ndcZ(tx, 0, tz);
    const zBottom = ndcZ(tx, bottomLocalY, tz);
    const zTop = ndcZ(tx, topLocalY, tz);

    // The bottom edge is FARTHER than the ground it stands on -- this is
    // the defect: an unclamped depth test lets the ground win here and
    // clip the sprite's own drawn tracks.
    expect(zBottom).toBeGreaterThan(zGround);
    // The top edge is correctly NEARER -- a turret poking above a wall
    // must keep depth-testing normally, which the fix below must not
    // disturb.
    expect(zTop).toBeLessThan(zGround);
  });

  it('min(own depth, depth at local up = 0) -- the clamp the shader applies -- exactly cancels the defect and leaves the above-ground half untouched', () => {
    const bottomLocalY = geo.positions[0 * 3 + 1];
    const topLocalY = geo.positions[2 * 3 + 1];
    const zGround = ndcZ(tx, 0, tz);
    const zBottom = ndcZ(tx, bottomLocalY, tz);
    const zTop = ndcZ(tx, topLocalY, tz);

    const clampedBottom = Math.min(zBottom, zGround);
    const clampedTop = Math.min(zTop, zGround);

    // Below-ground: was farther than ground, now ties with it exactly --
    // resolved in the unit's favour by the same opaque-before-transparent +
    // LessEqualDepth mechanism the render-order tie-break above relies on.
    expect(clampedBottom).toBeCloseTo(zGround, 12);
    // Above-ground: min() picks the vertex's own (nearer) depth, unchanged
    // -- real occlusion against a ridge or a building still varies
    // per-vertex exactly as it did before this fix.
    expect(clampedTop).toBeCloseTo(zTop, 12);
    expect(clampedTop).not.toBeCloseTo(zGround, 6);
  });

  it('holds for the real quad corner, off the translation column on both axes -- not merely directly underfoot', () => {
    // bl (index 0) sits at local right = -half, local up = -half: off the
    // translation column on BOTH axes, the general case the production
    // fix's own doc comment claims holds ("off-column too, not only
    // directly beneath the translation").
    const blX = geo.positions[0 * 3 + 0];
    const blY = geo.positions[0 * 3 + 1];
    const blZ = geo.positions[0 * 3 + 2];
    const groundX = tx + blX;
    const groundZ = tz + blZ;

    const zGroundHere = ndcZ(groundX, 0, groundZ);
    const zBottomHere = ndcZ(groundX, blY, groundZ);
    expect(zBottomHere).toBeGreaterThan(zGroundHere);
    expect(Math.min(zBottomHere, zGroundHere)).toBeCloseTo(zGroundHere, 12);
  });

  it('the shipped shader actually performs this clamp, not merely the maths above', () => {
    // The maths above proves the CLAIM the shader's min() depends on; this
    // proves the shipped GLSL actually contains that min(), so a future
    // edit that silently drops it (leaving the maths true but unused) fails
    // here instead of only in a browser screenshot.
    const packing = packSheet(tnkHull);
    const instancer = new UnitInstancer(tnkHull, new THREE.DataArrayTexture(), packing, 1);
    const material = instancer.mesh.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain('gl_Position.z = min(gl_Position.z, groundClip.z)');
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
    turretFacing: 0,
    turretClip: 'idle',
    turretFrame: 0,
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

  it('BREAK CHECK (A1): overflow clamps at capacity and warns exactly once even across repeated overflowing frames', () => {
    // Before this clamp existed, a past-the-end write here would be a
    // silent no-op (JS typed arrays do not throw on out-of-range indices)
    // while `count` kept incrementing past `out`'s real size -- the caller
    // would then set `mesh.count` beyond what was actually written. Proven
    // here by checking BOTH that the returned count never exceeds capacity
    // AND that every slot the clamp did allow to write actually holds real
    // data, not a stale zero from an index that silently missed -- plus that
    // a second and third overflowing call (consecutive frames of a real
    // mission, the case this module's own doc comment worries about) do not
    // warn again. One test, not two: the one-time warn is module-level
    // state keyed by writer name, so a second test overflowing the same
    // writer would see it already consumed and assert nothing meaningful.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const frames = [
        makeFrame({ wx: 1, visible: true }),
        makeFrame({ wx: 2, visible: true }),
        makeFrame({ wx: 3, visible: true }),
      ];
      const out = buffers(2); // capacity 2, three visible frames offered
      const count = writeUnitInstances(frames, infSquad, packing, out);
      expect(count).toBe(2);
      expect(out.positions[0]).toBeCloseTo(1, 10);
      expect(out.positions[3]).toBeCloseTo(2, 10);

      writeUnitInstances(frames, infSquad, packing, out);
      writeUnitInstances(frames, infSquad, packing, out);
      const ownCalls = warn.mock.calls.filter((args) => String(args[0]).includes('writeUnitInstances'));
      expect(ownCalls.length).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('writeTurretInstances', () => {
  // A small hull sheet, scale 2 (so spritePxPerSheetPx is not accidentally
  // 1 and a dropped multiplier would still show up).
  const hullSheet: SheetSpec = {
    facings: 4,
    facingOffset: 0,
    facingReverse: false,
    scale: 2,
    layout: 'clip',
    clips: { idle: { frames: 1, fps: 0, loop: true, fileOffset: 0 } },
  };
  // A turret sheet whose rig declared a real turretAxisPx -- distinct,
  // nonzero entries at facing 0 and facing 1, so a hull/turret facing
  // MISMATCH (the common case: a unit is tracking a target off its own
  // heading) produces a genuinely nonzero correction, not one that would
  // still pass by accident if the offset degenerated to [0, 0].
  const turretSheetAxis: SheetSpec = {
    facings: 4,
    facingOffset: 0,
    facingReverse: false,
    scale: 2,
    layout: 'clip',
    clips: { idle: { frames: 1, fps: 0, loop: true, fileOffset: 0 } },
    turretAxisPx: [
      [5, 3],
      [-4, 2],
      [0, 0],
      [0, 0],
    ],
  };
  const turretPackingAxis = packSheet(turretSheetAxis);

  function turretBuffers(capacity: number): UnitInstanceBuffers {
    return {
      positions: new Float32Array(capacity * 3),
      layers: new Float32Array(capacity),
      alphas: new Float32Array(capacity),
    };
  }

  it("BREAK CHECK 2: applies the turret axis offset rather than drawing at the hull's own anchor", () => {
    // facing 0 -> hullIdx = facingIndex(0, hullSheet) = 0.
    // turretFacing 0.25 -> turretIdx = facingIndex(0.25, turretSheetAxis) = 1.
    // turretAxisOffset(turretSheetAxis, 0, 1) = [5 - (-4), 3 - 2] = [9, 1].
    const frames = [makeFrame({ wx: 10, worldY: 0, wy: 20, facing: 0, turretFacing: 0.25 })];
    const out = turretBuffers(1);
    writeTurretInstances(frames, hullSheet, turretSheetAxis, turretPackingAxis, out);

    const spritePxPerSheetPx = (hullSheet.scale * TILE_W) / FRAME_PX;
    const axisOffset = screenOffsetToWorld(9 * spritePxPerSheetPx, 1 * spritePxPerSheetPx);
    expect(out.positions[0]).toBeCloseTo(10 + axisOffset.dx, 10);
    expect(out.positions[2]).toBeCloseTo(20 + axisOffset.dy, 10);
    // Drawing at the hull's own anchor (dropping the correction entirely)
    // would land exactly at (10, 20) instead -- the axis offset here is
    // large enough (9 sheet px, scale 2) that the two cannot coincide by
    // float rounding, so this is a real, not incidental, distinguisher.
    expect(out.positions[0]).not.toBeCloseTo(10, 3);
    expect(out.positions[2]).not.toBeCloseTo(20, 3);
  });

  it('applies no offset when hull and turret face the same way (the common, non-tracking case)', () => {
    const frames = [makeFrame({ wx: 10, worldY: 0, wy: 20, facing: 0, turretFacing: 0 })];
    const out = turretBuffers(1);
    writeTurretInstances(frames, hullSheet, turretSheetAxis, turretPackingAxis, out);
    // hullIdx === turretIdx === 0 -> turretAxisOffset returns [0, 0].
    expect(out.positions[0]).toBeCloseTo(10, 10);
    expect(out.positions[2]).toBeCloseTo(20, 10);
  });

  it('worldY carries no axis correction -- only the ground-plane wx/wy do', () => {
    const frames = [makeFrame({ wx: 0, worldY: 7, wy: 0, facing: 0, turretFacing: 0.25 })];
    const out = turretBuffers(1);
    writeTurretInstances(frames, hullSheet, turretSheetAxis, turretPackingAxis, out);
    expect(out.positions[1]).toBeCloseTo(7, 10);
  });

  it('folds roofDx through the same right axis writeUnitInstances uses', () => {
    const right = screenOffsetToWorld(1, 0);
    const noAxis: SheetSpec = { ...turretSheetAxis, turretAxisPx: undefined };
    const packing = packSheet(noAxis);
    const frames = [makeFrame({ wx: 0, worldY: 0, wy: 0, roofDx: 13, facing: 0, turretFacing: 0 })];
    const out = turretBuffers(1);
    writeTurretInstances(frames, hullSheet, noAxis, packing, out);
    expect(out.positions[0]).toBeCloseTo(right.dx * 13, 10);
    expect(out.positions[2]).toBeCloseTo(right.dy * 13, 10);
  });

  it("resolves the DataArrayTexture layer through the TURRET's own clip/facing/frame, not the hull's", () => {
    const fireTurret: SheetSpec = {
      ...turretSheetAxis,
      clips: {
        idle: turretSheetAxis.clips.idle,
        fire: { frames: 1, fps: 12, loop: false, fileOffset: 0 },
      },
      turretAxisPx: undefined,
    };
    const packing = packSheet(fireTurret);
    // Hull is on 'idle'; the turret's own resolved clip is 'fire' (the
    // independent signal `entityFrame` computes) -- the layer chosen must
    // follow the turret's clip, not the hull's.
    const frames = [makeFrame({ clip: 'idle', turretClip: 'fire', turretFrame: 0, facing: 0, turretFacing: 0 })];
    const out = turretBuffers(1);
    writeTurretInstances(frames, hullSheet, fireTurret, packing, out);
    const expectedLayer = packing.regionFor('fire', facingIndex(0, fireTurret), 0).layer;
    expect(out.layers[0]).toBe(expectedLayer);
  });

  it('skips invisible frames and returns the visible count, matching writeUnitInstances', () => {
    const frames = [makeFrame({ visible: true }), makeFrame({ visible: false })];
    const out = turretBuffers(2);
    const count = writeTurretInstances(frames, hullSheet, turretSheetAxis, turretPackingAxis, out);
    expect(count).toBe(1);
  });

  it('passes body alpha through unchanged', () => {
    const noAxis: SheetSpec = { ...turretSheetAxis, turretAxisPx: undefined };
    const packing = packSheet(noAxis);
    const frames = [makeFrame({ alpha: 0.35 })];
    const out = turretBuffers(1);
    writeTurretInstances(frames, hullSheet, noAxis, packing, out);
    expect(out.alphas[0]).toBeCloseTo(0.35, 5);
  });

  it('BREAK CHECK (A1): more visible frames than capacity clamps at capacity instead of silently overrunning the buffer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const noAxis: SheetSpec = { ...turretSheetAxis, turretAxisPx: undefined };
      const packing = packSheet(noAxis);
      const frames = [makeFrame({ visible: true }), makeFrame({ visible: true }), makeFrame({ visible: true })];
      const out = turretBuffers(2);
      const count = writeTurretInstances(frames, hullSheet, noAxis, packing, out);
      expect(count).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });
});
