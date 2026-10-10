import { describe, expect, it } from 'vitest';
import { distinctPlaces, placeOnScreen } from './alert-place';

// A 1000 x 600 viewport; its centre is (500, 300).
const W = 1000;
const H = 600;

describe('placeOnScreen', () => {
  it('is here for a point on screen, edges included', () => {
    expect(placeOnScreen({ x: 500, y: 300 }, W, H)).toBe('here');
    expect(placeOnScreen({ x: 0, y: 0 }, W, H)).toBe('here');
    expect(placeOnScreen({ x: W, y: H }, W, H)).toBe('here');
  });

  it('names the eight bearings in screen terms: up the screen is north', () => {
    expect(placeOnScreen({ x: 500, y: -200 }, W, H)).toBe('n');
    expect(placeOnScreen({ x: 1500, y: -700 }, W, H)).toBe('ne');
    expect(placeOnScreen({ x: 1800, y: 300 }, W, H)).toBe('e');
    expect(placeOnScreen({ x: 1500, y: 1300 }, W, H)).toBe('se');
    expect(placeOnScreen({ x: 500, y: 900 }, W, H)).toBe('s');
    expect(placeOnScreen({ x: -500, y: 1300 }, W, H)).toBe('sw');
    expect(placeOnScreen({ x: -800, y: 300 }, W, H)).toBe('w');
    expect(placeOnScreen({ x: -500, y: -700 }, W, H)).toBe('nw');
  });

  it('takes the bearing from the centre, not from the nearest edge', () => {
    // Just past the right edge but far above the centre: north-east, not east.
    expect(placeOnScreen({ x: 1001, y: -400 }, W, H)).toBe('ne');
  });

  it('invents no direction for a point that projected to nowhere', () => {
    expect(placeOnScreen({ x: Number.NaN, y: 5 }, W, H)).toBe('here');
  });
});

describe('distinctPlaces', () => {
  it('keeps first-seen order and drops repeats', () => {
    expect(distinctPlaces(['n', 'here', 'n', 'sw', 'here'])).toEqual(['n', 'here', 'sw']);
  });
});
