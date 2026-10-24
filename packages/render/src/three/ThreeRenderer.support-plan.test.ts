/**
 * `Renderer.supportCalled` RETURNS the plan it builds (GH-782), so the app can
 * hand the very object the aircraft re-anchor on to the audio. Called on the
 * prototype with a stand-in `this` (the centroid it reads, and the aircraft
 * manager it owns): constructing a whole renderer needs a GL context, and the
 * method touches nothing else.
 */
import { describe, expect, it } from 'vitest';
import { ThreeRenderer } from './ThreeRenderer';
import { SupportAircraftManager } from './units/support-aircraft';

function standIn() {
  const supportAircraft = new SupportAircraftManager(0xffffff);
  // Two of the viewer's ground units (side 0) at (10, 30) and (14, 34), an air unit and an enemy that must not count.
  return {
    sim: {
      state: { alive: Uint8Array.from([1, 1, 1, 1]), side: Uint8Array.from([0, 0, 0, 1]), typeIdx: Uint16Array.from([0, 0, 1, 0]) },
      unitTypes: [{ isAir: false }, { isAir: true }],
    },
    snapshottedCount: 4,
    viewer: 0,
    curX: Float32Array.from([10, 14, 99, 99]),
    curY: Float32Array.from([30, 34, 99, 99]),
    supportAircraft,
  };
}
const call = (self: ReturnType<typeof standIn>, kind: string) =>
  (ThreeRenderer.prototype.supportCalled as (this: unknown, call: string, x: number, y: number, tick: number) => unknown).call(self, kind, 20, 20, 5);

describe('ThreeRenderer.supportCalled', () => {
  it('returns the air strike’s plan, from the friendly ground centroid, anchored one tick after the call', () => {
    const self = standIn();
    const plan = call(self, 'air_strike') as { kind: string; anchorMs: number; anchored: boolean; ax: number; ay: number; fx: number; fy: number };
    expect(plan).toMatchObject({ kind: 'strike', anchorMs: 5 * 50, anchored: false, ax: 20, ay: 20 });
    // The centroid (12, 32) lies south-west of the aim point: the aircraft come from there.
    expect(plan.fx).toBeCloseTo(-8 / Math.hypot(8, 12), 12);
    expect(plan.fy).toBeCloseTo(12 / Math.hypot(8, 12), 12);
    self.supportAircraft.dispose();
  });

  it('returns the barrage’s plan, and it is the object the aircraft re-anchor', () => {
    const self = standIn();
    const plan = call(self, 'mortar_barrage') as { kind: string; anchored: boolean; anchorMs: number };
    expect(plan.kind).toBe('barrage');
    self.supportAircraft.onStrike(1, 5 + 120, 20, 20);
    expect(plan.anchored).toBe(true);
    self.supportAircraft.dispose();
  });

  it('returns null for a call that flies nothing, and starts no flight', () => {
    const self = standIn();
    expect(call(self, 'smoke_screen')).toBeNull();
    expect(call(self, 'drone_sweep')).toBeNull();
    expect(self.supportAircraft.flightCount).toBe(0);
    self.supportAircraft.dispose();
  });
});
