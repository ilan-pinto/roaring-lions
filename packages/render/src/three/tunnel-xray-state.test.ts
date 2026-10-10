import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIM_CONTACT_DECAY_Q16,
  SIM_FORGET_TICKS,
  SIM_LOST_AT_Q16,
  XRAY_FADE_FLOOR,
  XRAY_FORGET_S,
  XrayRouteClock,
  figureAlongRoute,
  xrayTarget,
} from './tunnel-xray-state';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TUNING = path.resolve(HERE, '../../../sim/src/tuning.ts');

/** Steps the clock in 50 ms sim ticks from `from` to `to` seconds. */
function run(c: XrayRouteClock, from: number, to: number, routes = 1): void {
  for (let t = from; t <= to + 1e-9; t += 0.05) c.step(t, routes);
}

describe('the forget window is the sim\'s own', () => {
  it('copies CONTACT_DECAY and LOST_AT, read from tuning.ts as text', () => {
    const src = readFileSync(TUNING, 'utf8');
    const decay = /export const CONTACT_DECAY = (\d+);/.exec(src);
    const lost = /export const LOST_AT = (\d+);/.exec(src);
    if (decay === null || lost === null) throw new Error('CONTACT_DECAY/LOST_AT not found in tuning.ts -- re-point the pin, do not delete it');
    expect(SIM_CONTACT_DECAY_Q16).toBe(Number(decay[1]));
    expect(SIM_LOST_AT_Q16).toBe(Number(lost[1]));
  });

  it('is the number of ticks contact takes to fall from 1 under LOST_AT, multiplied out', () => {
    let c = 65536;
    let ticks = 0;
    while (c >= SIM_LOST_AT_Q16) {
      c = Math.floor((c * SIM_CONTACT_DECAY_Q16) / 65536);
      ticks++;
    }
    // The float derivation and the integer walk agree to a tick or two.
    expect(Math.abs(SIM_FORGET_TICKS - ticks)).toBeLessThanOrEqual(2);
    expect(XRAY_FORGET_S).toBeGreaterThan(15);
    expect(XRAY_FORGET_S).toBeLessThan(17);
  });
});

describe('xrayTarget', () => {
  it('draws nothing for an unknown or a suspected route', () => {
    expect(xrayTarget(0, 0)).toBe(0);
    expect(xrayTarget(1, 0)).toBe(0);
  });

  it('draws an identified, held route at full strength', () => {
    expect(xrayTarget(2, 0)).toBe(1);
  });

  it('fades a lapsed route toward the floor over the forget window, never under it', () => {
    const half = xrayTarget(2, XRAY_FORGET_S / 2);
    expect(half).toBeLessThan(1);
    expect(half).toBeGreaterThan(XRAY_FADE_FLOOR);
    expect(xrayTarget(2, XRAY_FORGET_S)).toBeCloseTo(XRAY_FADE_FLOOR, 6);
    expect(xrayTarget(2, XRAY_FORGET_S * 3)).toBe(XRAY_FADE_FLOOR);
  });
});

describe('XrayRouteClock', () => {
  it('identified and held: the route is drawn', () => {
    const c = new XrayRouteClock();
    c.discover(0, 1, 0);
    for (let t = 1; t <= 3; t += 0.05) {
      c.setRoute(0, 2, true, t);
      c.step(t, 1);
    }
    expect(c.strength[0]).toBeGreaterThan(0.95);
  });

  it('unidentified: nothing, however long it runs', () => {
    const c = new XrayRouteClock();
    c.setRoute(0, 1, false, 0);
    run(c, 0, 20);
    expect(c.strength[0]).toBe(0);
  });

  it('lapsed: fades on the SIM clock, and a repaint at the same instant moves nothing', () => {
    const c = new XrayRouteClock();
    c.discover(0, 0, 0);
    c.setRoute(0, 2, true, 0);
    run(c, 0, 2);
    const held = c.strength[0];
    // No carrier from t = 2: still identified, nobody sees it.
    c.setRoute(0, 2, false, 2.05);
    run(c, 2.05, 10);
    const lapsed = c.strength[0];
    expect(lapsed).toBeLessThan(held - 0.2);
    expect(lapsed).toBeGreaterThan(XRAY_FADE_FLOOR);
    c.step(10, 1);
    c.step(10, 1);
    expect(c.strength[0]).toBe(lapsed);
  });

  it('lost: goes out', () => {
    const c = new XrayRouteClock();
    c.discover(0, 0, 0);
    c.setRoute(0, 2, true, 0);
    run(c, 0, 2);
    c.setRoute(0, 0, false, 2);
    run(c, 2, 4);
    expect(c.strength[0]).toBe(0);
  });

  it('plays the beat once per route: the first discovery beams, a re-acquisition does not', () => {
    const c = new XrayRouteClock();
    expect(c.discover(3, 1, 0)).toBe(true);
    expect(c.beamAlpha(1.1)).toBeGreaterThan(0);
    expect(c.discover(3, 20, 0)).toBe(false);
    expect(c.beamAlpha(20.1)).toBe(0);
    expect(c.discover(4, 30, 0)).toBe(true);
  });

  it('sweeps from the origin outward at a finite speed', () => {
    const c = new XrayRouteClock();
    c.discover(0, 0, 5);
    c.step(0.25, 1);
    expect(c.revealed(0, 5)).toBe(true);
    expect(c.revealed(0, 14)).toBe(false);
    c.step(1, 1);
    expect(c.revealed(0, 14)).toBe(true);
  });
});

describe('figureAlongRoute', () => {
  it('keeps every fighter inside the route, and two fighters apart', () => {
    for (let id = 0; id < 40; id++) {
      for (const t of [0, 3.3, 17]) {
        const p = figureAlongRoute(id, 1, 10, t);
        expect(p.s).toBeGreaterThanOrEqual(0);
        expect(p.s).toBeLessThanOrEqual(10);
      }
    }
    expect(figureAlongRoute(1, 0, 10, 0).s).not.toBe(figureAlongRoute(2, 0, 10, 0).s);
  });
});
