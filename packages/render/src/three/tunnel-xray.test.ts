import { describe, expect, it } from 'vitest';
import { TunnelXray, XRAY_STEP, type XrayRoute } from './tunnel-xray';
import { XRAY_MAX_ROUTES } from './tunnel-xray-state';

const COLORS = { rim: '#6FE0FF', core: '#14150F', hot: '#FFF6D0', figure: '#D93A2B' };

function straight(x0: number, y: number, len: number): XrayRoute {
  const points: [number, number][] = [];
  for (let d = 0; d <= len + 1e-9; d += XRAY_STEP) points.push([x0 + d + 0.5, y + 0.5]);
  return { points, length: len };
}

/** Identify and hold route `r` from t = 0, then step to `until` seconds. */
function hold(x: TunnelXray, routes: readonly number[], occ: readonly (readonly [number, number])[], until = 3): void {
  for (const r of routes) x.discover(r, 0, null);
  for (let t = 0; t <= until + 1e-9; t += 0.05) {
    for (const r of routes) x.clock.setRoute(r, 2, true, t);
    x.update(t, occ);
  }
}

describe('TunnelXray', () => {
  it('a map with no tunnel draws nothing', () => {
    const x = new TunnelXray(COLORS);
    x.build([], () => 0);
    x.update(1, []);
    expect(x.drawCalls).toBe(0);
    x.dispose();
  });

  it('draws one figure per fighter inside an identified route, and none for an unidentified one', () => {
    const x = new TunnelXray(COLORS);
    x.build([straight(0, 0, 10), straight(0, 4, 10)], () => 0);
    const occ: [number, number][] = [
      [0, 11],
      [0, 12],
      [0, 13],
      [1, 20],
      [1, 21],
    ];
    // Route 0 identified and held; route 1 never identified.
    for (let t = 0; t <= 3; t += 0.05) {
      if (t === 0) x.discover(0, 0, null);
      x.clock.setRoute(0, 2, true, t);
      x.clock.setRoute(1, 1, false, t);
      x.update(t, occ);
    }
    expect(x.figures.count).toBe(3);
    expect(x.figures.visible).toBe(true);
    x.dispose();
  });

  it('submits nothing while no route is identified', () => {
    const x = new TunnelXray(COLORS);
    x.build([straight(0, 0, 10)], () => 0);
    for (let t = 0; t <= 3; t += 0.05) {
      x.clock.setRoute(0, 1, false, t);
      x.update(t, [[0, 7]]);
    }
    expect(x.figures.count).toBe(0);
    expect(x.drawCalls).toBe(0);
    x.dispose();
  });

  it('never submits more than four draws, whatever the routes and fighters', () => {
    const x = new TunnelXray(COLORS);
    const routes = Array.from({ length: XRAY_MAX_ROUTES }, (_, r) => straight(0, r * 2, 12));
    x.build(routes, () => 0);
    const occ: [number, number][] = [];
    for (let i = 0; i < 200; i++) occ.push([i % XRAY_MAX_ROUTES, i]);
    const all = routes.map((_, r) => r);
    // Mid-beat: the beam is showing.
    for (const r of all) x.discover(r, 0, null);
    x.discover(0, 0, { x: 3, y: -2, liftY: 2 });
    for (let t = 0; t <= 2; t += 0.05) {
      for (const r of all) x.clock.setRoute(r, 2, true, t);
      x.update(t, occ);
    }
    expect(x.figures.count).toBeGreaterThan(0);
    expect(x.drawCalls).toBeLessThanOrEqual(4);
    x.dispose();
  });

  it('the debug layer hides all of it, and it stays hidden across a frame', () => {
    const x = new TunnelXray(COLORS);
    x.build([straight(0, 0, 10)], () => 0);
    hold(x, [0], [[0, 5]]);
    expect(x.drawCalls).toBeGreaterThan(0);
    expect(x.setDebugHidden(true)).toBe(4);
    x.update(3.05, [[0, 5]]);
    expect(x.drawCalls).toBe(0);
    x.setDebugHidden(false);
    x.update(3.1, [[0, 5]]);
    expect(x.drawCalls).toBeGreaterThan(0);
    x.dispose();
  });
});
