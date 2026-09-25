import { describe, expect, it } from 'vitest';
import { buildTerrainSurface } from './terrain/surface';
import { DECOR_ROAD } from './terrain/shared';
import type { TerrainInput } from './terrain/types';
import { decalShowcase, SHOWCASE_POWERS, showcaseSites } from './decal-showcase';

function world(): TerrainInput {
  const w = 30;
  const h = 30;
  const decor = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) decor[8 * w + x] = DECOR_ROAD; // a road along y = 8
  const elevation = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 20; x < w; x++) elevation[y * w + x] = Math.min(4, x - 19); // a slope in the east
  return { width: w, height: h, decor, elevation, blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h) };
}
const anchor = { x: 15, y: 15 };

describe('showcaseSites', () => {
  const input = world();
  const sites = showcaseSites(input, buildTerrainSurface(input), anchor);
  it('finds a flat, a relief and a road site', () => {
    expect(sites.map((s) => s.kind).sort()).toEqual(['flat', 'relief', 'road']);
  });
  it('keeps every site in the ring and the sites apart', () => {
    for (const s of sites) {
      const d = Math.hypot(s.x + 0.5 - (anchor.x + 0.5), s.y + 0.5 - (anchor.y + 0.5));
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(9);
    }
    for (const a of sites) for (const b of sites) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(4);
  });
  it('puts the road site on the road', () => {
    expect(sites.find((s) => s.kind === 'road')?.y).toBe(8);
  });
  it('omits the relief site on a flat map', () => {
    const flat = { ...world(), elevation: null };
    expect(showcaseSites(flat, buildTerrainSurface(flat), anchor).map((s) => s.kind)).not.toContain('relief');
  });
  it('is deterministic', () => {
    expect(showcaseSites(input, buildTerrainSurface(input), anchor)).toEqual(sites);
  });
});

describe('decalShowcase', () => {
  const stamps = decalShowcase([{ kind: 'flat', x: 5, y: 5 }, { kind: 'road', x: 12, y: 8 }, { kind: 'relief', x: 22, y: 12 }]);
  it('stamps every kind at every site, three sizes each', () => {
    expect(stamps).toHaveLength(3 * (12 + 12));
    for (const kind of ['crater', 'scorch', 'oil', 'rubble'] as const) expect(stamps.filter((s) => s.kind === kind)).toHaveLength(9);
    expect(stamps.filter((s) => s.kind === 'tread')).toHaveLength(18);
    expect(stamps.filter((s) => s.kind === 'tyre')).toHaveLength(18);
    expect(SHOWCASE_POWERS).toEqual([0.3, 0.45, 1]);
  });
  it('dates every stamp at 0 ms, so a capture at a pinned tick repeats (R-14)', () => {
    expect(new Set(stamps.map((s) => s.simMs))).toEqual(new Set([0]));
  });
});
