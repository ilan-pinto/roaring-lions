import { describe, expect, it } from 'vitest';

import { nudgeLabels } from './label-layout';

describe('nudgeLabels', () => {
  it('leaves separated labels alone', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 0, y: 40, w: 80, h: 16 }], 4);
    expect([...m.values()]).toEqual([0, 0]);
  });
  it('pushes the lower of two overlapping labels down by exactly the overlap plus the gap', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 10, y: 6, w: 80, h: 16 }], 4);
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(14); // a's bottom is 16, b wants top 6 -> 20 with the gap: +14
  });
  it('does not push labels that overlap only horizontally', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 100, y: 6, w: 80, h: 16 }], 4);
    expect(m.get('b')).toBe(0);
  });
  it('chains: three stacked labels each clear the one above', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 0, y: 4, w: 80, h: 16 }, { id: 'c', x: 0, y: 8, w: 80, h: 16 }], 0);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual([0, 12, 24]);
  });
});
