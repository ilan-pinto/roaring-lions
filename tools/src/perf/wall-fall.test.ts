// The wall-fall tick probe's own checks (GH-974). A timing tool that levels nothing, or levels into an empty
// flow-field pool, prints a small number and means nothing; these pin that it does the work it times.
import { describe, expect, it } from 'vitest';
import { maps, parseMap } from '@lions/data';
import { pct, wallFall } from './wall-fall';

describe('wallFall on Rujm Sawda', () => {
  const w = wallFall('rujm_sawda', 6);

  it('levels every structure the map stands, once, and times each', () => {
    // The oracle is the map file's own structure list, not the sim.
    const listed = parseMap(maps.rujm_sawda).structures;
    expect(w.structures).toBe(listed.length);
    expect(w.wallMs).toHaveLength(listed.length);
    expect(w.cpuMs).toHaveLength(listed.length);
    // mutation: debugDestroyStructure(s) -> nothing, and the tool throws "opened 0 tiles"
    expect(w.opened).toBe(listed.reduce((n, b) => n + b.tiles.length, 0));
    expect(w.walls).toBe(listed.filter((b) => b.tiles.length === 1).length);
  });

  it('fills the pool before it times anything', () => {
    // mutation: the `sim.queueCommand` of the pool fill removed, and the tool throws "the pool holds 0 fields"
    expect(w.fields).toBeGreaterThanOrEqual(6);
    expect(w.followed).toBe(6);
  });

  it('refuses a pool it cannot fill', () => {
    // more units than the sim holds is the sim's own refusal
    expect(() => wallFall('rujm_sawda', 5000)).toThrow('sim at capacity');
  });
});

describe('pct', () => {
  it('is the nearest-rank percentile', () => {
    // mutation: Math.ceil -> Math.floor makes the median of 1..4 read 3
    expect(pct([4, 1, 3, 2], 0.5)).toBe(2);
    expect(pct([4, 1, 3, 2], 0.95)).toBe(4);
  });
});
