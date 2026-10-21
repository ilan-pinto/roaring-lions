import { describe, expect, it } from 'vitest';
import { collectWorksObservers, type WorksAura, type WorksObserverInput } from './works-observers';

// Literal oracles. Progress units: 10 = complete.
const SENSOR: WorksAura = { sensorSight: 9, sightBonus: 0 };
const OUTPOST: WorksAura = { sensorSight: null, sightBonus: 2 };

function input(over: Partial<WorksObserverInput>): WorksObserverInput {
  return {
    viewer: 0,
    structureCount: 1,
    alive: [1],
    owner: [0],
    progress: [10],
    complete: 10,
    cx: (s) => [4.5][s],
    cy: (s) => [7][s],
    auraOf: () => SENSOR,
    garrisoned: [],
    ...over,
  };
}

describe('collectWorksObservers', () => {
  it('a complete sensor the viewer owns sees from its centroid', () => {
    expect(collectWorksObservers(input({}))).toEqual([{ x: 4.5, y: 7, sight: 9 }]);
  });
  it('is undefined (today exactly) when there is nothing', () => {
    expect(collectWorksObservers(input({ auraOf: () => null }))).toBeUndefined();
  });
  it('skips an unfinished structure (progress < complete)', () => {
    // Mutation: drop the progress check and this goes red.
    expect(collectWorksObservers(input({ progress: [9] }))).toBeUndefined();
  });
  it('skips a dead one and one owned by the other side', () => {
    expect(collectWorksObservers(input({ alive: [0] }))).toBeUndefined();
    expect(collectWorksObservers(input({ owner: [1] }))).toBeUndefined();
  });
  it('adds the garrison sight bonus to each occupant of a complete structure', () => {
    expect(
      collectWorksObservers(
        input({
          auraOf: () => OUTPOST,
          garrisoned: [
            { structure: 0, sight: 6 },
            { structure: 0, sight: 7 },
            { structure: 3, sight: 6 },
          ],
        })
      )
    ).toEqual([
      { x: 4.5, y: 7, sight: 8 },
      { x: 4.5, y: 7, sight: 9 },
    ]);
  });
  it('gives NO garrison bonus while the structure is incomplete', () => {
    // The sim's garrisonAura is null unless progress === ONE.
    expect(
      collectWorksObservers(
        input({ progress: [9], auraOf: () => OUTPOST, garrisoned: [{ structure: 0, sight: 6 }] })
      )
    ).toBeUndefined();
  });
});
