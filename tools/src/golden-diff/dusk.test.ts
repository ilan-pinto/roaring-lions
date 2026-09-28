import { describe, expect, it } from 'vitest';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { DUSK_SCENARIO, QUIET_SCENARIO, SCENARIOS, threeUrl } from './capture-protocol';
import { BASELINES, isGated } from './baseline';

describe('the dusk capture (spec §3.6)', () => {
  it("is quiet's frame under the dusk preset", () => {
    expect(DUSK_SCENARIO).toMatchObject({
      sandboxMap: QUIET_SCENARIO.sandboxMap,
      cameraMarker: QUIET_SCENARIO.cameraMarker,
      targetTick: QUIET_SCENARIO.targetTick,
    });
    const url = new URL(threeUrl(5195, DUSK_SCENARIO));
    expect(url.searchParams.get('tod')).toBe('dusk');
    expect(unknownParams(url.searchParams)).toEqual([]);
  });
  it('is captured and reported, and does not vote', () => {
    expect(SCENARIOS).toContain(DUSK_SCENARIO);
    expect(isGated(BASELINES.dusk)).toBe(false);
    expect(BASELINES.dusk.layerChecks ?? []).toEqual([]);
  });
});
