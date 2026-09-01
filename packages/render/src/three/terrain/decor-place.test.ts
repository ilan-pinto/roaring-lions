import { describe, it, expect } from 'vitest';
import { decorPlacements, VARIANTS_PER_FAMILY } from './decor-place';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import { tileHash } from '../../tile-hash';
import type { TerrainInput } from './types';

/** A w*h map, everything open ground, with per-tile overrides applied after. */
function input(w: number, h: number, edit?: (i: TerrainInput, decor: Uint8Array, blocked: Uint8Array, cover: Uint8Array) => void): TerrainInput {
  const decor = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  const cover = new Uint8Array(w * h);
  const t: TerrainInput = {
    width: w,
    height: h,
    decor,
    elevation: null,
    blocked,
    cover,
  };
  edit?.(t, decor, blocked, cover);
  return t;
}

describe('decorPlacements', () => {
  it('is deterministic: the same map twice gives an identical list', () => {
    // Appearance determinism is the whole reason this uses tileHash and not
    // Math.random -- two runs that merely both look scattered would make every
    // screenshot comparison noise.
    const a = decorPlacements(input(12, 12));
    const b = decorPlacements(input(12, 12));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('never places anything on a blocked tile', () => {
    // A rock inside a building is a bug report, and the building box is drawn
    // over the same ground.
    const out = decorPlacements(
      input(8, 8, (t) => t.blocked.fill(1))
    );
    expect(out).toEqual([]);
  });

  it('never places anything on a road', () => {
    const out = decorPlacements(
      input(8, 8, (_t, decor) => decor.fill(DECOR_ROAD))
    );
    expect(out).toEqual([]);
  });

  it('puts trees on grove tiles, rocks on knolls, slabs on ridges', () => {
    // Ridge is NOT a bare-decor override like grove/knoll: `map.ts`'s own
    // legend (`'^': { blocked: 1, cover: 0, decor: DECOR.ridge }`) makes
    // blocked=1 the one combination `parseMap` actually emits for it, so the
    // fixture must set `blocked` too -- decor=RIDGE with blocked=0 is a
    // shape the real decoder can never produce.
    const families = (decorValue: number, blockedToo = false): Set<string> => {
      const out = decorPlacements(
        input(10, 10, (_t, decor, blocked) => {
          decor.fill(decorValue);
          if (blockedToo) blocked.fill(1);
        })
      );
      return new Set(out.map((p) => p.family));
    };
    expect(families(DECOR_GROVE)).toEqual(new Set(['tree']));
    expect(families(DECOR_KNOLL)).toEqual(new Set(['rock']));
    expect(families(DECOR_RIDGE, true)).toEqual(new Set(['slab']));
  });

  it('gives a ridge tile (blocked 1 + decor ridge, the only shape parseMap emits) a slab', () => {
    // The critical-finding regression test: `decorPlacements` used to skip
    // EVERY blocked tile before `familyFor` was ever consulted, so this
    // branch was dead on every shipped map (Tel Marum alone is 748 ridge
    // tiles, 32% of the map). A ridge is the one blocked tile that is not a
    // building -- `buildings.ts`'s own doc comment says so explicitly, and
    // skips exactly it before ever asking whether a structure stands there.
    const out = decorPlacements(
      input(10, 10, (_t, decor, blocked) => {
        decor.fill(DECOR_RIDGE);
        blocked.fill(1);
      })
    );
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(out.map((p) => p.family))).toEqual(new Set(['slab']));
  });

  it('still puts nothing on a blocked NON-ridge tile (a building: blocked 1, decor 0)', () => {
    // The other half of the same fix: a building's own footprint must stay
    // bare -- `buildBuildings`'s box already owns that ground entirely.
    const out = decorPlacements(
      input(10, 10, (_t, _decor, blocked) => blocked.fill(1))
    );
    expect(out).toEqual([]);
  });

  it('puts bushes directly on cover tiles with no decor value', () => {
    // Verify that a plain cover > 0 tile (with decor = 0) yields family === 'bush'
    const out = decorPlacements(
      input(8, 8, (_t, _decor, _blocked, cover) => cover.fill(1))
    );
    const families = new Set(out.map((p) => p.family));
    expect(families).toEqual(new Set(['bush']));
  });

  it('puts bushes on cover tiles and gets denser with the cover level', () => {
    const count = (cover: number): number =>
      decorPlacements(input(16, 16, (t) => t.cover.fill(cover))).length;
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it('keeps every variant index inside the family range', () => {
    for (const p of decorPlacements(input(20, 20))) {
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(VARIANTS_PER_FAMILY);
    }
  });

  it('sits a placement on its own tile top, not at elevation zero', () => {
    // Same property scatter.test.ts already proves for flat marks: a mark on
    // raised ground must rise with it or it sinks into the hill.
    const flat = decorPlacements(input(6, 6));
    const raised = decorPlacements(
      input(6, 6, (t) => {
        t.elevation = new Uint8Array(36).fill(4);
      })
    );
    expect(flat[0].y).toBe(0);
    expect(raised[0].y).toBe(4 * WORLD_PER_LEVEL);
  });

  it('rolls density on its own stream, independent of scatter.ts\'s ground-grain roll', () => {
    // scatter.ts's own ground grain treats bare `tileHash(x, y)` as its
    // pebble/fleck gate (`rnd > 0.9`, `rnd > 0.84`). Tile (28, 0) on an
    // all-open map rolls tileHash(28, 0) = 0.9269 -- squarely in that
    // "pebbled" range -- and its family roll (the offset stream at
    // (x+977, y+311)) picks 'grass' (density 0.34). If this module's density
    // gate reused that same bare `tileHash(x, y)` -- which the module's own
    // doc comment says it must NOT do -- this tile could never get a grass
    // tuft: 0.9269 >= 0.34 fails the gate on every run, deterministically,
    // not merely on average, because 0.34 and >0.9 never overlap for any
    // family this dense or sparser (grass 0.34, sand 0.18, bush <=1). This
    // exact tile was chosen (by scanning tileHash directly) because it ALSO
    // clears an independent density stream, so it is expected to place once
    // the two streams are actually decoupled.
    const out = decorPlacements(input(40, 40));
    const jx = tileHash(28 + 101, 0 + 7) - 0.5;
    const jy = tileHash(28 + 13, 0 + 401) - 0.5;
    const expectedX = 28 + 0.5 + jx * 0.6;
    const expectedZ = 0 + 0.5 + jy * 0.6;
    const hit = out.find(
      (p) => Math.abs(p.x - expectedX) < 1e-9 && Math.abs(p.z - expectedZ) < 1e-9
    );
    expect(hit?.family).toBe('grass');
  });
});
