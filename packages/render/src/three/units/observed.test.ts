import { describe, it, expect } from 'vitest';
import { unitIsObserved } from './observed';

describe('unitIsObserved', () => {
  const dark = (): boolean => false;
  it('own units always draw; hostile and civilian units need a lit tile', () => {
    expect(unitIsObserved(0, 0, 1, 1, dark)).toBe(true);
    expect(unitIsObserved(1, 0, 1, 1, dark)).toBe(false);
    expect(unitIsObserved(1, 1, 1, 1, dark)).toBe(true);
    expect(unitIsObserved(0, 1, 1, 1, dark)).toBe(false);
    expect(unitIsObserved(2, 1, 1, 1, dark)).toBe(false);
    expect(unitIsObserved(0, 1, 1, 1, () => true)).toBe(true);
  });
});
