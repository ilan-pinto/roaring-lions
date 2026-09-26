/**
 * The scatter mesh carries the same palette guarantee `ground.test.ts`
 * proves for the ground mesh, plus properties specific to it: every mark
 * near an elevation edge stays inside the tile that placed it, a mark on a
 * raised tile sits on that tile's own top rather than at elevation 0, and
 * (since #226) a road tile draws no scatter marks of its own at all -- the
 * ground shader's own distance field owns the road's wear now.
 */
import { describe, it, expect } from 'vitest';
import { buildScatter, HIGHLIGHT_EPSILON, FACE_BAND_HALF_Y } from './scatter';
import { WORLD_PER_LEVEL, screenOffsetToWorld, DECOR_ROAD } from './shared';
import { PALETTE_HEXES } from './tones';
import { VIEW_DIRECTION } from '../camera';
import { TILE_W, TILE_H, isoX, isoY } from '../../project';
import type { TerrainInput, MeshData } from './types';
import type { TerrainTones } from '../../api';

/** The clear colour every fixture in this file composites its ground tone
 *  against, matching `buildScatter`'s own `background` parameter. */
const BACKGROUND = '#14150F';

const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const, groveFamily: 'desert_tree' as const,
};
const SWARD_TONES = { ...TONES, scatter: 'sward' as const };

function flat(w: number, h: number): TerrainInput {
  return {
    width: w, height: h, decor: null, elevation: null,
    blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h),
  };
}

/** A 6x6 map that exercises every branch: elevation stepping (so both an
 *  east and a south slope face fire somewhere, and `hasElevationEdge` is
 *  true almost everywhere -- see the winding test below, which relies on
 *  this to exercise the clamped path thoroughly), every DECOR_* value
 *  cycling across tiles (open/road/grove/knoll/ridge), ridge tiles marked
 *  blocked, and a cycling cover level so cover rubble fires on some open
 *  tiles. */
function richMap(): TerrainInput {
  const w = 6, h = 6;
  const input = flat(w, h);
  input.elevation = new Uint8Array(w * h).map((_, ti) => ((ti % w) + Math.floor(ti / w)) % 4);
  input.decor = new Uint8Array(w * h).map((_, ti) => ti % 5); // none, road, grove, knoll, ridge, repeating
  input.blocked = new Uint8Array(w * h).map((_, ti) => (ti % 5 === 4 ? 1 : 0)); // only ridge tiles
  input.cover = new Uint8Array(w * h).map((_, ti) => ti % 4);
  return input;
}

/**
 * A 1x2 map isolating tile (0, 0) -- configured by `configure` -- next to a
 * neighbour raised well above it, so `hasElevationEdge(input, 0, 0)` is
 * true and tile (0, 0)'s own marks are clamped/contained. The neighbour is
 * blocked and undecorated (plain building), which emits no grain of its
 * own, and -- being the HIGHER tile -- draws its own east/south faces only
 * toward its off-map sides (checked by hand: `drawSlopeFace` only fires
 * toward a LOWER neighbour, and tile 1's west side, facing tile 0, is never
 * checked by either tile -- matching `ground.ts`'s own east/south-only face
 * model). So every vertex with world X < 1 belongs to tile (0, 0) alone.
 */
function nearElevationEdge(configure: (input: TerrainInput) => void): TerrainInput {
  const input = flat(2, 1);
  configure(input);
  input.elevation = new Uint8Array([0, 5]);
  input.blocked[1] = 1;
  return input;
}

function paletteEntries(): Set<string> {
  return new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
}

function colorAt(colors: Float32Array, i: number): string {
  return (
    '#' +
    [0, 1, 2]
      .map((k) => Math.round(colors[i + k] * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Counts triangles in `m` whose centroid's (x, z) lies inside tile `(tx,
 *  tz)`'s own unit square -- a mark-agnostic way to ask "did this tile draw
 *  anything at all", independent of which branch of `buildScatter` might
 *  have produced it (or, since #226, no longer does). */
function marksOnTile(m: MeshData, tx: number, tz: number): number {
  let count = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const ia = m.indices[i] * 3;
    const ib = m.indices[i + 1] * 3;
    const ic = m.indices[i + 2] * 3;
    const cx = (m.positions[ia] + m.positions[ib] + m.positions[ic]) / 3;
    const cz = (m.positions[ia + 2] + m.positions[ib + 2] + m.positions[ic + 2]) / 3;
    if (cx >= tx && cx < tx + 1 && cz >= tz && cz < tz + 1) count++;
  }
  return count;
}

describe('screenOffsetToWorld', () => {
  it('inverts the iso projection', () => {
    // isoX(1, 0) = TILE_W/2, isoY(1, 0) = TILE_H/2 -- one tile east.
    const got = screenOffsetToWorld(TILE_W / 2, TILE_H / 2);
    expect(got.dx).toBeCloseTo(1, 10);
    expect(got.dy).toBeCloseTo(0, 10);
  });

  it('inverts the other diagonal too', () => {
    // isoX(0, 1) = -TILE_W/2, isoY(0, 1) = TILE_H/2 -- one tile south.
    const got = screenOffsetToWorld(-TILE_W / 2, TILE_H / 2);
    expect(got.dx).toBeCloseTo(0, 10);
    expect(got.dy).toBeCloseTo(1, 10);
  });

  it('round-trips an arbitrary offset through isoX/isoY', () => {
    for (const [ddx, ddy] of [
      [0.3, -0.2],
      [-0.45, 0.1],
      [0.05, 0.49],
    ]) {
      const screen = { dx: isoX(ddx, ddy), dy: isoY(ddx, ddy) };
      const back = screenOffsetToWorld(screen.dx, screen.dy);
      expect(back.dx).toBeCloseTo(ddx, 10);
      expect(back.dy).toBeCloseTo(ddy, 10);
    }
  });
});

describe('buildScatter', () => {
  it('every vertex colour is a palette entry', () => {
    const entries = paletteEntries();
    for (const tones of [TONES, SWARD_TONES]) {
      const m = buildScatter(richMap(), tones, '#14150F');
      expect(m.colors.length).toBeGreaterThan(0);
      for (let i = 0; i < m.colors.length; i += 3) {
        expect(entries).toContain(colorAt(m.colors, i));
      }
    }
  });

  it('is deterministic', () => {
    const a = buildScatter(richMap(), TONES, '#14150F');
    const b = buildScatter(richMap(), TONES, '#14150F');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it('puts marks on the tile top when the tile is raised', () => {
    // A fleck at elevation 0 on a tile raised several levels is buried
    // inside the ridge and invisible -- the failure is silent and reads as
    // "the grain stopped working on high ground".
    //
    // A naive "does the mesh reach this height at all" check does not prove
    // this: `drawSlopeFace` computes a raised tile's face height from its
    // own `levelHere` parameter directly, independent of whatever grain
    // does, so on ANY map with elevation, the tile's own top-edge band
    // reaches the correct height regardless of whether grain is broken --
    // that band alone would make a plain max-Y check pass even with every
    // grain mark silently buried at elevation 0. So the instrument has to be
    // a mark that fires unconditionally (unlike a plain fleck's shading
    // pass, which depends on the tile hash) and sits strictly above what the
    // face band can reach: HIGHLIGHT_EPSILON (0.02) clears the top edge
    // band's own ceiling (topY + FACE_BAND_HALF_Y, 0.01) by a full
    // centimetre.
    //
    // That instrument used to be a `^` RIDGE tile's blob-plus-highlight
    // pair. It cannot be any more: a ridge carries a real rock texture as of
    // 2026-09-03 and draws no synthetic grain at all (`scatter.ts`'s own
    // blocked branch). A KNOLL is the replacement and is a better one --
    // four blobs with highlights, equally unconditional, and it is OPEN
    // ground, so this now also exercises the INTERPOLATED surface path a
    // ridge terrace would have skipped.
    const input = flat(1, 1);
    input.elevation = new Uint8Array([5]);
    input.decor = new Uint8Array([3]); // DECOR_KNOLL
    const m = buildScatter(input, TONES, '#14150F');
    let maxY = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]);
    const topY = 5 * WORLD_PER_LEVEL;
    // Rules out "the face's own top-edge band explains this" -- only a
    // grain highlight correctly placed at the tile's own raised top can
    // clear this ceiling. The intended margin is exactly zero
    // (HIGHLIGHT_EPSILON > FACE_BAND_HALF_Y by construction); +1e-6 keeps
    // the assertion from resting on which way Float32 happens to round
    // topY + FACE_BAND_HALF_Y for these particular constants.
    expect(
      maxY,
      'mesh does not clear the face top-edge band\'s own ceiling -- suggests grain reused the face height rather than its own tile top'
    ).toBeGreaterThan(topY + FACE_BAND_HALF_Y + 1e-6);
    expect(maxY).toBeCloseTo(topY + HIGHLIGHT_EPSILON, 5);
  });

  it('draws no rut dashes on a road -- the ground shader owns the road now (#226)', () => {
    // The two synthetic rut lines this branch used to stamp -- always at
    // this exact tile's centre, `needsContainment`-clamped or not -- are
    // gone: the road's own wear is drawn procedurally from the control
    // map's distance field in the shader (Task 6), and a mark on top of it
    // duplicated that wear and could not track a two-wide street's own
    // collapsed centreline at all.
    const input = flat(3, 1);
    input.decor = Uint8Array.from([0, DECOR_ROAD, 0]);
    const withRoad = buildScatter(input, TONES, BACKGROUND);
    expect(marksOnTile(withRoad, 1, 0)).toBe(0);
  });

  describe('keeps every mark inside its own tile near an elevation edge', () => {
    // Containment is conditional -- see `hasElevationEdge`'s doc comment in
    // scatter.ts -- so this must actually put a tile next to a different
    // elevation to exercise the clamp at all. `nearElevationEdge` isolates
    // tile (0, 0) for exactly that. Pixi's offsets were bounded by hand
    // against the screen-space tile diamond, one axis at a time -- but the
    // two axes are independent hashes, and the diamond is not a rectangle:
    // both hashes landing near their extreme at once pushes a raw-ported
    // offset outside the tile (see `pushMark`'s doc comment for the worked
    // example), which is exactly the failure containment exists to prevent
    // once there is an actual drop to float over.
    const cases: [string, TerrainInput, TerrainTones][] = [
      ['open ground, stone scatter', nearElevationEdge(() => {}), TONES],
      ['open ground, sward scatter', nearElevationEdge(() => {}), SWARD_TONES],
      ['knoll', nearElevationEdge((i) => { i.decor = new Uint8Array([3, 0]); }), TONES],
      ['cover rubble', nearElevationEdge((i) => { i.cover[0] = 3; }), TONES],
      // 'ridge (blocked)' used to be a case here and is gone: a `^` ridge
      // emits no grain at all, so it has nothing to contain and the case
      // would have passed by checking an empty loop -- exactly what this
      // block's own `sawTileZeroVertex` guard exists to catch. 'road' is
      // gone for the identical reason since #226: a road tile draws no
      // grain of its own any more (the ground shader owns the road), so
      // this fixture's tile 0 would emit nothing to contain. Both rules are
      // asserted positively instead -- the ridge one just below, the road
      // one in the "draws no rut dashes" test above.
    ];

    for (const [label, input, tones] of cases) {
      it(label, () => {
        const m = buildScatter(input, tones, '#14150F');
        let sawTileZeroVertex = false;
        for (let i = 0; i < m.positions.length; i += 3) {
          if (m.positions[i] >= 1) continue; // tile 1's own geometry -- see nearElevationEdge's doc comment
          sawTileZeroVertex = true;
          expect(m.positions[i]).toBeGreaterThanOrEqual(-1e-6);
          expect(m.positions[i]).toBeLessThanOrEqual(1 + 1e-6);
          expect(m.positions[i + 2]).toBeGreaterThanOrEqual(-1e-6);
          expect(m.positions[i + 2]).toBeLessThanOrEqual(1 + 1e-6);
        }
        // Confirms the filter above actually found tile 0's marks, so a
        // change that accidentally emptied them wouldn't pass this test
        // vacuously.
        expect(sawTileZeroVertex).toBe(true);
      });
    }
  });

  it('a `^` ridge emits no grain at all -- its rock texture supplies it instead', () => {
    // The rule that replaced the five blob-plus-highlight marks
    // (renderer.ts:1461-1477). Asserted positively rather than left as an
    // absence, because the containment case that used to cover ridge tiles
    // would now pass by checking nothing.
    //
    // Photographed on `tel_marum`'s corridor walls at zoom 2 with both
    // present: `tones.rockLit` is `#F2E8D5` on the arid theme, all but
    // white, and the highlights read as pale confetti over a photograph.
    const ridge = flat(1, 1);
    ridge.elevation = new Uint8Array([5]);
    ridge.decor = new Uint8Array([4]); // DECOR_RIDGE
    ridge.blocked = new Uint8Array([1]);
    const m = buildScatter(ridge, TONES, '#14150F');
    // Not "the mesh is empty": the tile is raised, so its own rim faces are
    // still dressed with a lit top edge, which is deliberately KEPT (a
    // tiling texture cannot know where this wall's top is). What must be
    // gone is every mark sitting ON the tile top.
    const topY = 5 * WORLD_PER_LEVEL;
    for (let i = 1; i < m.positions.length; i += 3) {
      expect(
        m.positions[i],
        `a mark at y=${m.positions[i]} sits on the ridge top -- ridge grain is back`
      ).toBeLessThanOrEqual(topY + FACE_BAND_HALF_Y + 1e-6);
    }
    // ...and the face dressing really is still there, so this is not passing
    // because the tile emitted nothing.
    expect(m.positions.length).toBeGreaterThan(0);
  });

  it('draws NO strata bands on a rock-textured ridge face, and still draws them on a building wall', () => {
    // The other half of the same 2026-09-03 call, and the half that had no
    // test at first: reinstating `drop > 1` unconditionally left the suite
    // green. The rock texture is fractured limestone with horizontal strata
    // of its own, at a finer pitch than one line per level -- two
    // contradictory stratigraphies on one face, and the synthetic one wins
    // because it is a hard palette edge.
    //
    // A BUILDING's wall keeps its bands: it has no texture, so they are still
    // the only thing telling a three-storey face from a one-storey one.
    //
    // Both fixtures are the same tile at the same height with the same drop,
    // so the ONLY difference is the decor byte -- which is the difference
    // under test. Everything else the tile emits (the lit top edge, the foot
    // scree, both KEPT on a ridge) is identical between them, so the vertex
    // delta is exactly the strata.
    const make = (decor: number): TerrainInput => {
      const i = flat(1, 1);
      i.elevation = new Uint8Array([3]);
      i.decor = new Uint8Array([decor]);
      i.blocked = new Uint8Array([1]);
      return i;
    };
    const ridge = buildScatter(make(4), TONES, '#14150F'); // DECOR_RIDGE
    const building = buildScatter(make(0), TONES, '#14150F'); // blocked, no decor
    // drop 3 to off-map level 0 on each of the two visible faces, so
    // `drop - 1` = 2 strata bands per face, 4 quads, 16 vertices.
    const STRATA_VERTS = 2 * 2 * 4;
    expect(building.positions.length / 3 - ridge.positions.length / 3).toBe(STRATA_VERTS);
    // Neither is empty, so this is not a difference between two nothings.
    expect(ridge.positions.length).toBeGreaterThan(0);
  });

  describe('stone-grain fleck stays visible when a theme\'s rockLit coincides with its open tone', () => {
    // The shipped `arid` theme (packages/app/src/terrain-themes.ts) sets
    // `open: paletteColor('limestone.3')` and `rockLit: paletteColor('limestone.3')`
    // -- the SAME palette entry, not merely a close one. `TONES` above never
    // exercises that: it deliberately gives `open` and `rockLit` distinct
    // hexes, which is exactly why 1473 passing tests coexisted with every
    // open-ground fleck rendering as the tile's own background colour on
    // every arid map. `composite(X, X, anyAlpha)` is `X` exactly -- true in
    // continuous colour and doubly true once quantised back onto the
    // palette entry it started from -- so a direct port of Pixi's
    // `ellipse.fill({ color: rockLit, alpha })` over the tile's own
    // `groundTone` is a silent no-op under this coincidence, for any alpha.
    // Pixi never hits this: its base wash is a continuous, non-quantised
    // alpha blend with real (if faint) headroom from the canvas clear
    // colour, which stays a visible, if subtle, gradient no matter what
    // `rockLit` equals -- headroom this quantised pipeline cannot reproduce
    // at that same contrast (reintroducing the same per-tile jitter before
    // compositing still rounds back to the identical palette entry; the
    // palette step is coarser than the signal -- see this task's own probe).
    const DEGENERATE_TONES: TerrainTones = {
      ...TONES,
      open: '#C8B494', // limestone.3
      rockLit: '#C8B494', // limestone.3, same entry -- the real-world coincidence
      rock: '#8C7659', // limestone.6, genuinely distinct -- the escape hatch
    };

    it('keeps most marks visibly distinct from the ground, not just an occasional one', () => {
      // A "saw at least one distinct mark" version of this test still passes
      // under the bug: the earth fleck (tones.earth, genuinely distinct) and
      // the shading sub-mark on ~28% of lit flecks (tones.rock, also
      // genuinely distinct) both survive quantisation on their own -- only
      // the DOMINANT plain "lit fleck" pass (composite(baseHex, rockLit,
      // alpha), ~56% of marks on flat open ground by construction) collapses
      // silently. A wide flat field of open tiles, none decorated, none
      // covered, gives a large enough sample that this fraction is stable
      // rather than an artifact of one tile's own hash: under the bug it
      // lands near 0.36 (worked out by hand from the branch probabilities:
      // 0.22 earth + 0.22 shade-highlight, against 0.56 invisible plain
      // flecks + 0.22 invisible bases under those same highlights); a
      // correct fix makes the PRIMARY mark itself distinct, so every mark
      // qualifies.
      const input = flat(20, 20);
      const m = buildScatter(input, DEGENERATE_TONES, '#14150F');
      expect(m.colors.length).toBeGreaterThan(0);
      const groundHex = DEGENERATE_TONES.open.toUpperCase();
      let total = 0;
      let distinct = 0;
      for (let i = 0; i < m.colors.length; i += 12) {
        // 4 vertices per mark, 3 floats per vertex -- one colour sample per
        // mark is enough since every mark is flat-shaded (all 4 vertices
        // share a colour).
        total += 1;
        if (colorAt(m.colors, i) !== groundHex) distinct += 1;
      }
      expect(total).toBeGreaterThan(100);
      expect(
        distinct / total,
        `only ${distinct}/${total} marks were visibly distinct from the ground -- most of the stone-grain scatter is a no-op under this theme's rockLit/open coincidence`
      ).toBeGreaterThanOrEqual(0.5);
    });
  });

  it('every triangle winds toward the camera', () => {
    // MeshBasicMaterial defaults to FrontSide (terrainMaterial(), reused for
    // the scatter mesh), so a wrong winding does not render dark -- it
    // renders as nothing. Every quad this builder emits falls into one of
    // the same three shapes ground.test.ts already classifies: a mark is
    // flat (all three vertices share Y, like a tile top), an east-face band
    // shares X, a south-face band shares Z -- so the same VIEW_DIRECTION dot
    // product and the same classifier apply unchanged.
    const m = buildScatter(richMap(), TONES, '#14150F');
    expect(m.indices.length).toBeGreaterThan(0);
    const at = (i: number): [number, number, number] => [
      m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2],
    ];
    const sub = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[0] - v[0], u[1] - v[1], u[2] - v[2],
    ];
    const cross = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const dot = (u: [number, number, number], v: [number, number, number]): number =>
      u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const kindOf = (a: [number, number, number], b: [number, number, number], c: [number, number, number]): string => {
      if (a[1] === b[1] && b[1] === c[1]) return 'flat mark';
      if (a[0] === b[0] && b[0] === c[0]) return 'east face band';
      if (a[2] === b[2] && b[2] === c[2]) return 'south face band';
      return 'unrecognised quad';
    };
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = at(m.indices[i]);
      const b = at(m.indices[i + 1]);
      const c = at(m.indices[i + 2]);
      const normal = cross(sub(b, a), sub(c, a));
      // `richMap`'s elevation stair means `hasElevationEdge` is true for
      // nearly every tile, so this exercises the clamped (reposition-then-
      // shrink) path thoroughly. That path repositions a mark whose raw
      // offset would escape the tile (shifting its centre inward, full
      // size intact) rather than shrinking it, so a degenerate zero-area
      // triangle should not occur for anything this module actually builds
      // -- confirmed by instrumenting this fixture's own triangle
      // magnitudes, all comfortably above 1e-3. The skip below guards the
      // shrink fallback `pushMark`'s own doc comment describes for a shape
      // whose half-extent alone exceeds CLAMP_LIMIT (nothing here reaches
      // that), which WOULD still collapse cleanly to a single point -- an
      // unambiguous zero-area degenerate with no winding to check, not a
      // wrong-but-tiny triangle. Every triangle actually reached below
      // still has every corner placed by the same code path and must
      // still wind correctly.
      const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
      if (magnitude < 1e-9) continue;
      const d = dot(normal, [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z]);
      expect(d, `${kindOf(a, b, c)} at triangle ${i / 3} (indices ${i}-${i + 2}) winds away from the camera`).toBeGreaterThan(0);
    }
  });
});
