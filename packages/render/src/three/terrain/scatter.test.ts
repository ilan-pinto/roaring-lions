/**
 * The scatter mesh carries the same palette guarantee `ground.test.ts`
 * proves for the ground mesh, plus two properties specific to it: every mark
 * stays inside the tile that placed it, and a mark on a raised tile sits on
 * that tile's own top rather than at elevation 0.
 */
import { describe, it, expect } from 'vitest';
import { buildScatter, screenOffsetToWorld, HIGHLIGHT_EPSILON, FACE_BAND_HALF_Y } from './scatter';
import { WORLD_PER_LEVEL } from './ground';
import { PALETTE_HEXES } from './tones';
import { VIEW_DIRECTION } from '../camera';
import { TILE_W, TILE_H, isoX, isoY } from '../../project';
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
 *  east and a south slope face fire somewhere), every DECOR_* value cycling
 *  across tiles (open/road/grove/knoll/ridge), ridge tiles marked blocked,
 *  and a cycling cover level so cover rubble fires on some open tiles. */
function richMap(): TerrainInput {
  const w = 6, h = 6;
  const input = flat(w, h);
  input.elevation = new Uint8Array(w * h).map((_, ti) => ((ti % w) + Math.floor(ti / w)) % 4);
  input.decor = new Uint8Array(w * h).map((_, ti) => ti % 5); // none, road, grove, knoll, ridge, repeating
  input.blocked = new Uint8Array(w * h).map((_, ti) => (ti % 5 === 4 ? 1 : 0)); // only ridge tiles
  input.cover = new Uint8Array(w * h).map((_, ti) => ti % 4);
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

  describe('keeps every mark inside its own tile', () => {
    // Pixi's offsets were bounded by hand against the screen-space tile
    // diamond, one axis at a time -- but the two axes are independent
    // hashes, and the diamond is not a rectangle: both hashes landing near
    // their extreme at once pushes a raw-ported offset outside the tile
    // (see `pushMark`'s doc comment in scatter.ts for the worked example).
    // A single flat, unelevated tile isolates the clamp itself from
    // slope-face dressing, which has its own boundary-crossing design (it
    // dresses the seam between two tiles on purpose).
    const cases: [string, TerrainInput, TerrainTones][] = [
      ['open ground, stone scatter', flat(1, 1), TONES],
      ['open ground, sward scatter', flat(1, 1), SWARD_TONES],
      ['knoll', withDecor(3), TONES],
      ['road', withDecor(1), TONES],
      ['cover rubble', withCover(3), TONES],
    ];
    const ridgeInput = flat(1, 1);
    ridgeInput.decor = new Uint8Array([4]);
    ridgeInput.blocked = new Uint8Array([1]);
    cases.push(['ridge (blocked)', ridgeInput, TONES]);

    for (const [label, input, tones] of cases) {
      it(label, () => {
        const m = buildScatter(input, tones, '#14150F');
        expect(m.positions.length).toBeGreaterThan(0);
        for (let i = 0; i < m.positions.length; i += 3) {
          expect(m.positions[i]).toBeGreaterThanOrEqual(-1e-6);
          expect(m.positions[i]).toBeLessThanOrEqual(1 + 1e-6);
          expect(m.positions[i + 2]).toBeGreaterThanOrEqual(-1e-6);
          expect(m.positions[i + 2]).toBeLessThanOrEqual(1 + 1e-6);
        }
      });
    }
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
      // `pushMark`'s clamp repositions a mark whose raw offset would escape
      // the tile (shifting its centre inward, full size intact) rather than
      // shrinking it, so a degenerate zero-area triangle should not occur
      // for anything this module actually builds -- confirmed by instrument-
      // ing this fixture's own triangle magnitudes, all comfortably above
      // 1e-3. The skip below guards the shrink fallback `pushMark`'s own doc
      // comment describes for a shape whose half-extent alone exceeds
      // CLAMP_LIMIT (nothing here reaches that), which WOULD still collapse
      // cleanly to a single point -- an unambiguous zero-area degenerate
      // with no winding to check, not a wrong-but-tiny triangle. Every
      // triangle actually reached below still has every corner placed by
      // the same code path and must still wind correctly.
      const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
      if (magnitude < 1e-9) continue;
      const d = dot(normal, [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z]);
      expect(d, `${kindOf(a, b, c)} at triangle ${i / 3} (indices ${i}-${i + 2}) winds away from the camera`).toBeGreaterThan(0);
    }
  });
});

function withDecor(value: number): TerrainInput {
  const input = flat(1, 1);
  input.decor = new Uint8Array([value]);
  return input;
}

function withCover(value: number): TerrainInput {
  const input = flat(1, 1);
  input.cover = new Uint8Array([value]);
  return input;
}
