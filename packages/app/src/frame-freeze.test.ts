import { describe, expect, it } from 'vitest';
import { frameLoopFrozen, setFrameLoopFrozen, type FreezeHost } from './frame-freeze';

describe('frame-freeze', () => {
  it('is down until a harness raises it, and only an exact true counts', () => {
    const h: FreezeHost = {};
    expect(frameLoopFrozen(h)).toBe(false);
    (h as Record<string, unknown>).__lionsFreezeLoop = 'yes';
    expect(frameLoopFrozen(h)).toBe(false);
    expect(setFrameLoopFrozen(true, h)).toBe(true);
    expect(frameLoopFrozen(h)).toBe(true);
    setFrameLoopFrozen(false, h);
    expect(frameLoopFrozen(h)).toBe(false);
  });
});
