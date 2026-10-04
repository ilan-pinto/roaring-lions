import { describe, expect, it } from 'vitest';
import { proxyBoxDims } from './proxy-box';
import { ELLIPSE_BY_TYPE, ELLIPSE_PAD_TILES, ringRadiusFor } from './readability';

describe('proxyBoxDims', () => {
  it('a ground vehicle takes its own hull half-extents and centre offset from the ring ellipse', () => {
    const e = ELLIPSE_BY_TYPE.mbt_lavi;
    const d = proxyBoxDims('mbt_lavi', 'armour');
    expect(d.halfAlong).toBeCloseTo(e.along - ELLIPSE_PAD_TILES, 10);
    expect(d.halfAcross).toBeCloseTo(e.across - ELLIPSE_PAD_TILES, 10);
    expect(d.offsetAlong).toBe(e.offsetAlong);
    expect(d.halfAlong).toBeGreaterThan(d.halfAcross); // a hull is longer than it is wide
  });

  it('a foot unit is a square inside its ring circle, centred on the unit', () => {
    const d = proxyBoxDims('inf_squad', 'foot');
    expect(d.halfAlong).toBe(d.halfAcross);
    expect(d.halfAlong).toBeLessThan(ringRadiusFor('inf_squad', 'foot'));
    expect(d.offsetAlong).toBe(0);
  });

  it('never collapses to nothing, even for an unknown type', () => {
    const d = proxyBoxDims('no_such_type', 'foot');
    expect(d.halfAlong).toBeGreaterThanOrEqual(0.15);
    expect(d.height).toBeGreaterThan(0);
  });
});
