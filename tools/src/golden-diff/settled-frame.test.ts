import { describe, expect, it } from 'vitest';
import { settledFrameRefusal } from './settled-frame';

describe('settledFrameRefusal', () => {
  it('passes two identical photographs', () => {
    expect(settledFrameRefusal(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('refuses a one-byte difference, naming where', () => {
    const a = new Uint8Array(1000).fill(7);
    const b = a.slice();
    b[500] = 8;
    expect(settledFrameRefusal(a, b)).toMatch(/differ in 1 byte.*first at 500/);
  });
  it('refuses a size difference', () => {
    expect(settledFrameRefusal(new Uint8Array(3), new Uint8Array(4))).toMatch(/different encoded sizes/);
  });
});
