import { describe, expect, it } from 'vitest';
import { lod1Shown } from './building-lod';

describe('building LOD1 twin helpers (GH-974)', () => {
  it('shows the twin only while the zoom state is on and the building is clean', () => {
    expect(lod1Shown(true, undefined)).toBe(true);
    expect(lod1Shown(true, 8)).toBe(true);
    expect(lod1Shown(false, 8)).toBe(false);
    expect(lod1Shown(true, 3)).toBe(false); // scarred keeps its full art
    expect(lod1Shown(true, 0)).toBe(false); // a wreck is never the twin
  });
});
