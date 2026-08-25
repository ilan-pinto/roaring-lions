// Where a sandbox force stands on a map nobody authored a sandbox for.
//
// The cases that matter are the degenerate ones: no markers, one marker, and
// names that match nothing. A sandbox that throws on an unmarked map is worse
// than one that guesses, because the whole point is to walk a map the moment
// it exists.
import { describe, expect, it } from 'vitest';
import { maps } from '@lions/data';
import { sandboxAnchors } from './sandbox-anchors';

const MAP = { width: 48, height: 48 };

describe('sandboxAnchors', () => {
  it('prefers a marker that reads as a player start over the first one', () => {
    const a = sandboxAnchors({
      ...MAP,
      markers: { town_center: [31, 22], kdf_assembly: [4, 23] },
    });
    expect(a.friendly).toEqual([4, 23]);
  });

  it('accepts the other start spellings the shipped maps actually use', () => {
    for (const name of ['kdf_start', 'kdf_crossing', 'start_line', 'player_start']) {
      const a = sandboxAnchors({ ...MAP, markers: { zzz: [40, 40], [name]: [5, 5] } });
      expect(`${name}:${a.friendly.join(',')}`).toBe(`${name}:5,5`);
    }
  });

  it('falls back to the first marker when no name reads as a start', () => {
    const a = sandboxAnchors({ ...MAP, markers: { alpha: [7, 7], beta: [30, 30] } });
    expect(a.friendly).toEqual([7, 7]);
  });

  it('falls back to map-relative points when there are no markers at all', () => {
    // An unmarked map is still worth walking. Throwing here would make the
    // sandbox refuse to load rather than guess.
    const a = sandboxAnchors({ width: 40, height: 20 });
    expect(a.friendly).toEqual([4, 10]);
    expect(a.hostile).toEqual([28, 10]);
  });

  it('does not stack both forces on one tile when a map has a single marker', () => {
    const a = sandboxAnchors({ ...MAP, markers: { kdf_start: [6, 6] } });
    expect(a.friendly).toEqual([6, 6]);
    expect(a.hostile).not.toEqual(a.friendly);
  });

  it('puts the opposition at contact range, NOT on the far edge', () => {
    // The rule this exists for. A hostile draws no sprite until a friendly
    // sees its tile, so a force on the far edge is invisible for the whole
    // opening — the existing sandbox has a comment about exactly that.
    const a = sandboxAnchors({
      ...MAP,
      markers: { kdf_assembly: [4, 23], town_center: [31, 22], mortar_line: [44, 24] },
    });
    expect(a.hostile).toEqual([31, 22]);
  });

  it('never puts the opposition in a civilian marker, even when it fits best', () => {
    // On beit_sahwan_outskirts the refuge sits 28.4 tiles from the start
    // against the town centre's 27.0, so distance alone picks the shelter —
    // wrong, and in the opposite direction from the fight.
    const a = sandboxAnchors({
      ...MAP,
      markers: { kdf_assembly: [4, 23], town_center: [31, 22], civ_refuge: [22, 45] },
    });
    expect(a.hostile).toEqual([31, 22]);
  });

  it('still places an opposition when excluding civilians leaves nowhere to stand', () => {
    // Excluding a class must not mean returning nothing. Here the only
    // non-civilian marker IS the friendly anchor, so the two would stack —
    // the map-relative fallback is what keeps a walkable sandbox.
    const a = sandboxAnchors({ ...MAP, markers: { kdf_start: [4, 4], civ_refuge: [30, 30] } });
    expect(a.friendly).toEqual([4, 4]);
    expect(a.hostile).not.toEqual(a.friendly);
    expect(a.hostile).not.toEqual([30, 30]);
  });

  it('ignores a malformed marker rather than placing a force at NaN', () => {
    const a = sandboxAnchors({ ...MAP, markers: { kdf_start: [3, 3], broken: [] } });
    expect(a.friendly).toEqual([3, 3]);
    expect(Number.isFinite(a.hostile[0])).toBe(true);
    expect(Number.isFinite(a.hostile[1])).toBe(true);
  });
});

describe('against the maps that actually ship', () => {
  // A heuristic is only worth having if it produces something sensible on the
  // real corpus, and the marker names share no convention at all.
  const shipped = Object.entries(maps) as [string, { width: number; height: number; markers?: Record<string, readonly number[]> }][];

  it('covers every shipped map', () => {
    expect(shipped.length).toBeGreaterThanOrEqual(5);
  });

  it('never places a force outside the map', () => {
    for (const [id, m] of shipped) {
      const a = sandboxAnchors(m);
      for (const [what, p] of [['friendly', a.friendly], ['hostile', a.hostile]] as const) {
        const inside = p[0] >= 0 && p[1] >= 0 && p[0] < m.width && p[1] < m.height;
        expect(`${id}/${what}:${inside}`).toBe(`${id}/${what}:true`);
      }
    }
  });

  it('never stacks the two anchors on one tile', () => {
    for (const [id, m] of shipped) {
      const a = sandboxAnchors(m);
      const same = a.friendly[0] === a.hostile[0] && a.friendly[1] === a.hostile[1];
      expect(`${id}:${same}`).toBe(`${id}:false`);
    }
  });

  it('keeps beit_sahwan_outskirts on the anchors the old sandbox used', () => {
    // The hardcoded layout was placed by hand and its comments explain why.
    // Preserving these two points is what makes the rewrite invisible there.
    const a = sandboxAnchors(maps.beit_sahwan_outskirts);
    expect(a.friendly).toEqual([4, 23]);
    expect(a.hostile).toEqual([31, 22]);
  });

  it('puts Tel Marum’s opposition up the valley, not on the start line', () => {
    const a = sandboxAnchors(maps.tel_marum);
    expect(a.friendly).toEqual([24, 44]);
    expect(a.hostile[1]).toBeLessThan(a.friendly[1]);
  });
});
