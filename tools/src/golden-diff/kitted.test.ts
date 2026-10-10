import { describe, expect, it } from 'vitest';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { KITTED_SCENARIO, SCENARIOS, VEHICLE_SCENARIO, threeUrl } from './capture-protocol';
import { BASELINES, evaluateLayerCheck, isGated } from './baseline';
import type { DiffSummary } from './diff';

function summary(diffPixels: number, meanAbsChannelDelta: number): DiffSummary {
  return {
    baseline: 'shown.png',
    candidate: 'hidden.png',
    region: null,
    width: 1400,
    height: 900,
    totalPixels: 1_260_000,
    diffPixels,
    diffPixelPct: (diffPixels / 1_260_000) * 100,
    changedPixels: diffPixels,
    meanAbsChannelDelta,
    maxAbsChannelDelta: 0,
    thresholdUsed: 0.1,
    diffImagePath: null,
  };
}

describe('the kitted scenario (GH-238 K8)', () => {
  it("is vehicle's frame with &kit and nothing else", () => {
    expect(KITTED_SCENARIO).toMatchObject({
      sandboxMap: VEHICLE_SCENARIO.sandboxMap,
      cameraTile: VEHICLE_SCENARIO.cameraTile,
      targetTick: VEHICLE_SCENARIO.targetTick,
    });
    expect(KITTED_SCENARIO.zoom).toBe(VEHICLE_SCENARIO.zoom);
    expect(KITTED_SCENARIO.orders).toEqual(VEHICLE_SCENARIO.orders);
    expect(KITTED_SCENARIO.cameraMarker).toBe(VEHICLE_SCENARIO.cameraMarker);
    const url = new URL(threeUrl(5232, KITTED_SCENARIO));
    expect(url.searchParams.has('kit')).toBe(true);
    expect(unknownParams(url.searchParams)).toEqual([]);
    // `vehicle` stays the kit-free reference: the falsification reads its URL.
    expect(new URL(threeUrl(5232, VEHICLE_SCENARIO)).searchParams.has('kit')).toBe(false);
  });

  it("is gated, mirrors vehicle's thresholds, and votes on units and kit", () => {
    expect(SCENARIOS).toContain(KITTED_SCENARIO);
    const spec = BASELINES.kitted;
    expect(isGated(spec)).toBe(true);
    expect(spec.region).toEqual(BASELINES.vehicle.region);
    expect(spec.maxDiffPixels).toBe(BASELINES.vehicle.maxDiffPixels);
    expect(spec.maxMeanAbsChannelDelta).toBe(BASELINES.vehicle.maxMeanAbsChannelDelta);
    expect(spec.repaintControl).toBeUndefined();
    expect((spec.layerChecks ?? []).map((c) => c.layer)).toEqual(['units', 'kit']);
    const units = spec.layerChecks?.find((c) => c.layer === 'units');
    const vehicleUnits = BASELINES.vehicle.layerChecks?.find((c) => c.layer === 'units');
    expect(units?.minDiffPixels).toBe(vehicleUnits?.minDiffPixels);
    expect(units?.minMeanAbsChannelDelta).toBe(vehicleUnits?.minMeanAbsChannelDelta);
  });

  it('fails its kit check on the measured empty-tiers reading and passes the measured kitted one', () => {
    const kit = BASELINES.kitted.layerChecks?.find((c) => c.layer === 'kit');
    expect(kit).toBeDefined();
    if (!kit) return;
    // `pnpm kit:capture -- --toggle`, 2026-10-07: the bare `vehicle` URL (empty
    // account -> `applyVehicleKit` gets empty tiers) read 0 kitted / 0 px /
    // 0.0000; the kitted URL read 6460 px / 0.4278 three times.
    expect(evaluateLayerCheck(summary(0, 0), kit).ok).toBe(false);
    expect(evaluateLayerCheck(summary(6460, 0.4278), kit).ok).toBe(true);
  });
});
