// The data gate's elevation checks.
//
// These live in their own module because validate_data.mjs runs its whole
// sweep at import time and exits the process -- a test cannot import it. The
// rows checks stay inline in the gate; only elevation was extracted, because
// only elevation had no coverage at all.
//
// Tel Marum is the first map with an `elevation` key. A 48-row grid of 48
// digits is exactly the artifact that gets one row wrong, and until this
// module existed a wrong row passed the gate green and threw at load instead.
import { describe, expect, it } from 'vitest';
import { elevationFailures } from '../validate_map_grid.mjs';

const good = {
  width: 4,
  height: 3,
  rows: ['....', '....', '....'],
  elevation: ['0123', '0000', '4321'],
};

describe('the data gate on an elevation grid', () => {
  it('passes a grid whose dimensions match', () => {
    expect(elevationFailures(good, 'good.json')).toEqual([]);
  });

  it('passes a map with no elevation at all — every shipped map today', () => {
    const { elevation, ...flat } = good;
    expect(elevation).toBeDefined();
    expect(elevationFailures(flat, 'flat.json')).toEqual([]);
  });

  it('rejects too few rows', () => {
    const bad = { ...good, elevation: ['0123', '0000'] };
    const out = elevationFailures(bad, 'bad.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('2 elevation rows but declared height 3');
  });

  it('rejects a short row, naming which one', () => {
    const bad = { ...good, elevation: ['0123', '000', '4321'] };
    const out = elevationFailures(bad, 'bad.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('elevation row 1 has 3 tiles but declared width 4');
  });

  it('rejects a non-digit, naming where it is', () => {
    const bad = { ...good, elevation: ['0123', '00x0', '4321'] };
    const out = elevationFailures(bad, 'bad.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('(2,1)');
  });

  it('reports every broken row rather than stopping at the first', () => {
    const bad = { ...good, elevation: ['012', '000', '432'] };
    expect(elevationFailures(bad, 'bad.json')).toHaveLength(3);
  });
});
