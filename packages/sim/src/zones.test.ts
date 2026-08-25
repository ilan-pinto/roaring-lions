// Zone containment, exported because three callers need to agree.
//
// stepRoe tests this twice inline -- once for fire, once for strikes -- and it
// is what actually deducts ROE. The app needs the same answer to decide
// whether the cursor shows a "do not shoot here" mark. Three copies of a
// four-integer comparison is three chances to be off by one, and the symptom
// would be a cursor that says safe over ground the sim charges for.
import { describe, expect, it } from 'vitest';
import { zoneContains } from './mission';

const ZONE = [10, 20, 4, 3] as const; // x, y, w, h

describe('zoneContains', () => {
  it('includes the top-left corner', () => {
    expect(zoneContains(ZONE, 10, 20)).toBe(true);
  });

  it('includes the last tile inside, at x+w-1 and y+h-1', () => {
    expect(zoneContains(ZONE, 13, 22)).toBe(true);
  });

  it('excludes x+w and y+h — the bound is exclusive', () => {
    // The off-by-one that would make a cursor disagree with stepRoe.
    expect(zoneContains(ZONE, 14, 20)).toBe(false);
    expect(zoneContains(ZONE, 10, 23)).toBe(false);
  });

  it('excludes tiles before the origin', () => {
    expect(zoneContains(ZONE, 9, 20)).toBe(false);
    expect(zoneContains(ZONE, 10, 19)).toBe(false);
  });

  it('is false for an undefined zone rather than throwing', () => {
    // stepRoe calls this.zone(name), which returns undefined for a name the
    // map does not declare. A mission may flag a zone a map never defined.
    expect(zoneContains(undefined, 10, 20)).toBe(false);
  });

  it('is false for a zero-width zone', () => {
    expect(zoneContains([10, 20, 0, 3], 10, 20)).toBe(false);
  });
});
