/**
 * The scatter mesh carries the same palette guarantee `ground.test.ts`
 * proves for the ground mesh, plus properties specific to it: every mark
 * near an elevation edge stays inside the tile that placed it, a mark on a
 * raised tile sits on that tile's own top rather than at elevation 0, and
 * a mark whose design spans the tile (the road rut) keeps Pixi's own
 * placement -- overhang and all -- when there is no elevation edge to
 * protect against.
 */
import { describe, it, expect } from 'vitest';
import { buildScatter, screenOffsetToWorld, HIGHLIGHT_EPSILON, FACE_BAND_HALF_Y } from './scatter';
import { WORLD_PER_LEVEL } from './ground';
import { PALETTE_HEXES } from './tones';
import { VIEW_DIRECTION } from '../camera';
import { TILE_W, TILE_H, ELEV_STEP, isoX, isoY } from '../../project';
import type { TerrainInput } from './types';
import type { TerrainTones } from '../../api';

const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const,
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
    // grain mark silently buried at elevation 0. A ridge tile's blob-plus-
    // highlight pair fires unconditionally (unlike a plain fleck's shading
    // pass, which depends on the tile hash), so it gives a guaranteed,
    // hash-independent signal strictly above what the face band alone can
    // reach: HIGHLIGHT_EPSILON (0.02) clears the top edge band's own
    // ceiling (topY + FACE_BAND_HALF_Y, 0.01) by a full centimetre.
    const input = flat(1, 1);
    input.elevation = new Uint8Array([5]);
    input.decor = new Uint8Array([4]); // DECOR_RIDGE
    input.blocked = new Uint8Array([1]);
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
      ['road', nearElevationEdge((i) => { i.decor = new Uint8Array([1, 0]); }), TONES],
      ['cover rubble', nearElevationEdge((i) => { i.cover[0] = 3; }), TONES],
      [
        'ridge (blocked)',
        nearElevationEdge((i) => {
          i.decor = new Uint8Array([4, 0]);
          i.blocked[0] = 1;
        }),
        TONES,
      ],
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

  describe('road rut fidelity on flat ground (no elevation edge)', () => {
    it('achieves Pixi\'s full separation and width when containment does not engage', () => {
      // Every shipped map except Tel Marum is flat, so a road tile's own
      // neighbours never differ in elevation and `hasElevationEdge` is
      // false there -- the rut renders at its raw, unclamped extent,
      // exactly Pixi's own placement. This is the regression a prior
      // version of this fix round introduced: clamping every mark
      // unconditionally pinned every rut's centre at ~0.05 tiles
      // regardless of the intended offset, collapsing the two lines to
      // within 0.1 tile of each other against Pixi's authored 0.3125 (this
      // tile's rut, see the parity test below) -- a systematic distortion
      // on every road tile, not a rare hash-extreme correction.
      const input = flat(1, 1);
      input.decor = new Uint8Array([1]); // DECOR_ROAD
      const m = buildScatter(input, TONES, '#14150F');
      // A road tile emits exactly the two rut marks and nothing else --
      // 2 marks * 4 vertices = 8 vertices, in emission order.
      expect(m.positions.length).toBe(24);

      const centroid = (base: number): [number, number, number] => {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 4; k++) {
          x += m.positions[(base + k) * 3];
          y += m.positions[(base + k) * 3 + 1];
          z += m.positions[(base + k) * 3 + 2];
        }
        return [x / 4, y / 4, z / 4];
      };
      const extentX = (base: number): number => {
        let min = Infinity, max = -Infinity;
        for (let k = 0; k < 4; k++) {
          const x = m.positions[(base + k) * 3];
          min = Math.min(min, x);
          max = Math.max(max, x);
        }
        return max - min;
      };

      const [ax, , az] = centroid(0);
      const [bx, , bz] = centroid(4);
      // rut is always 5 for this tile (see the parity test below), so the
      // two lines' intended separation is 2 * 5 / 16 = 0.3125 tiles.
      expect(Math.abs(bx - ax)).toBeCloseTo(0.3125, 5);
      expect(Math.abs(bz - az)).toBeCloseTo(0.3125, 5);

      // Full width, not shrunk: each mark's own X-extent is the whole
      // unscaled rect (2 * (TILE_W/2 - 6), converted), not compressed
      // toward its centre by a clamp that never should have engaged here.
      expect(extentX(0)).toBeCloseTo(0.859375, 5);
      expect(extentX(4)).toBeCloseTo(0.859375, 5);

      // And the overhang this fidelity implies is real, not just assumed:
      // some corner of these marks genuinely sits outside [0, 1] -- proof
      // containment is off here, not merely that it happened not to
      // trigger. Matches Pixi: its own rut ends run past this tile's own
      // screen-space diamond too (renderer.ts:1526-1530 -- at 26px out
      // horizontally the diamond's own half-height is down to ~3px), and
      // it does not matter there because a flat run of road tiles has
      // nothing to float over. The same reasoning is why this is safe here.
      let anyOutside = false;
      for (let i = 0; i < m.positions.length; i += 3) {
        if (m.positions[i] < -1e-6 || m.positions[i] > 1 + 1e-6) anyOutside = true;
      }
      expect(anyOutside).toBe(true);
    });

    it('stays bounded near an elevation edge, at the cost of separation', () => {
      // The other side of the same trade-off, stated rather than left for a
      // reviewer to find: if a road tile ever DOES sit next to a drop (no
      // shipped map does today), containment engages and the two rut lines'
      // separation compresses -- but the result stays a valid, non-
      // degenerate, correctly-wound quad rather than escaping onto a
      // differently-elevated neighbour. Bounded-but-compressed is the
      // correct trade near a real drop; full-fidelity-but-unbounded is not.
      const input = nearElevationEdge((i) => {
        i.decor = new Uint8Array([1, 0]);
      });
      const m = buildScatter(input, TONES, '#14150F');
      for (let i = 0; i < m.positions.length; i += 3) {
        if (m.positions[i] >= 1) continue; // tile 1's own geometry
        expect(m.positions[i]).toBeGreaterThanOrEqual(-1e-6);
        expect(m.positions[i]).toBeLessThanOrEqual(1 + 1e-6);
      }
    });

    it('the parity check always selects 5, never 7, for any integer tile and elevation', () => {
      // Not a deviation introduced by this port: Pixi's own alternation
      // (renderer.ts:1532, `(cx + cyG) % 2 === 0 ? 5 : 7`) can never
      // actually select 7. cx = isoX(x+0.5, y+0.5) = (x - y) * 32 -- always
      // a multiple of 32, hence even. cyG = isoY(x+0.5, y+0.5) -
      // level*ELEV_STEP = (x + y + 1) * 16 - level * 10 -- a multiple of 16
      // minus a multiple of 10, hence also always even. Their sum is
      // therefore always even for any integer x, y, level, so the "7"
      // branch is dead code in both backends -- this test proves it swept
      // broadly rather than only algebraically.
      let sawOdd = false;
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 12; y++) {
          for (let level = 0; level < 10; level++) {
            const cxPx = isoX(x + 0.5, y + 0.5);
            const cyPx = isoY(x + 0.5, y + 0.5) - level * ELEV_STEP;
            if ((cxPx + cyPx) % 2 !== 0) sawOdd = true;
          }
        }
      }
      expect(sawOdd).toBe(false);
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
