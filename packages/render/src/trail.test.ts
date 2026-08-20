import { describe, expect, it } from 'vitest';
import { trailTileAlpha } from './trail';

// The rung split, reviewed into existence: anyone can see dirt, only a
// detector reads the route. An ordinary rifle squad near fresh spoil must
// have the dirt it can see drawn — the "disturbed earth over there, send
// the drone" cue is the recon loop the design is built around, and with no
// tunnelContact toast in the app, this tint is the ONLY place suspicion is
// visible at all. The identified line, by contrast, waits for a detector:
// a mark_tunnel carrier is what turns dirt into "a tunnel, and it runs
// exactly here".
describe('trailTileAlpha', () => {
  it('spoil draws for ordinary eyes — no detector required', () => {
    // Suspected route, fresh dirt, seen by a plain squad (not a carrier):
    // this is the tile the pre-review gate wrongly kept dark.
    expect(trailTileAlpha(1, 255, true, false)).toBeCloseTo(0.64, 5);
    // Weathering dirt fades with density, same curve the loop always drew.
    expect(trailTileAlpha(1, 128, true, false)).toBeCloseTo(0.14 + 0.5 * (128 / 255), 5);
    // No dirt on the tile: a suspected route has no line, nothing draws.
    expect(trailTileAlpha(1, 0, true, false)).toBe(0);
  });

  it('the identified line waits for a detector', () => {
    // Ordinary eyes on a spoilless identified tile see nothing — only a
    // carrier reads the route itself. (Every pre_dug route is this case.)
    expect(trailTileAlpha(2, 0, true, false)).toBe(0);
    expect(trailTileAlpha(2, 0, false, true)).toBeCloseTo(0.18, 5);
  });

  it('an identified route unseen by any carrier still shows its dirt to anyone', () => {
    expect(trailTileAlpha(2, 128, true, false)).toBeCloseTo(0.14 + 0.5 * (128 / 255), 5);
  });

  it('dense spoil outdraws the line when both are seen — the old max rule holds', () => {
    expect(trailTileAlpha(2, 255, true, true)).toBeCloseTo(0.64, 5);
    // Thin spoil under an identified line: the line's floor wins.
    expect(trailTileAlpha(2, 8, true, true)).toBeCloseTo(0.18, 5);
  });

  it('nothing draws unseen or unknown', () => {
    expect(trailTileAlpha(2, 255, false, false)).toBe(0);
    expect(trailTileAlpha(0, 255, true, true)).toBe(0);
  });
});
