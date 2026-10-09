import { describe, expect, it } from 'vitest';

import { nudgeLabels, pinLabelBox } from './label-layout';

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

// PA-20: "Beit Sahwan 0/15" and "Qarn Hadid" overlapped on the real board. The
// numbers are the shape that was measured at 1440x900: two pins on the same row
// about 140 px apart, the left label ~126 px wide, the label drawn 14 px right
// of its pin.
describe('pinLabelBox (PA-20)', () => {
  const reach = 14;
  const pad = 8;
  const left = { x: 572, y: 433 };
  const right = { x: 712, y: 434 };
  const label = { w: 126, h: 16 };

  it('spans the ring, the reach and the label, so a neighbour inside the label tail is a collision', () => {
    const a = pinLabelBox('beit', left, label, reach, pad);
    expect(a.x).toBe(572);
    expect(a.w).toBe(14 + 126 + 8);
    const m = nudgeLabels([a, pinLabelBox('qarn', right, { w: 90, h: 16 }, reach, pad)], 4);
    expect(m.get('beit')).toBe(0);
    // Qarn's pin (712) is inside Beit Sahwan's drawn label (586..712): it steps down.
    expect(m.get('qarn')).toBeGreaterThan(0);
  });

  it('is what the old pin-point-plus-label-width box got wrong', () => {
    const naive = [
      { id: 'beit', x: left.x, y: left.y, w: label.w, h: label.h },
      { id: 'qarn', x: right.x, y: right.y, w: 90, h: 16 },
    ];
    expect(nudgeLabels(naive, 4).get('qarn')).toBe(0);
  });

  it('leaves two pins that are clear of each other\'s labels alone', () => {
    const m = nudgeLabels([pinLabelBox('a', { x: 0, y: 0 }, label, reach, pad), pinLabelBox('b', { x: 400, y: 2 }, label, reach, pad)], 4);
    expect([...m.values()]).toEqual([0, 0]);
  });
});
