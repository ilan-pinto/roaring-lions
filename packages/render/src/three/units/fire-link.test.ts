import { describe, expect, it } from 'vitest';
import { DEFAULT_FIRE_LINK, fireLinkShowsCard, parseFireLink } from '../../fire-link-concepts';
import { lightenHex, notchSegments, pulseAt, PULSE_S, PULSE_START_SCALE } from './fire-link';

describe('parseFireLink', () => {
  it('reads absent and empty as the default', () => {
    expect(parseFireLink(null).concepts).toEqual(DEFAULT_FIRE_LINK);
    expect(parseFireLink('').concepts).toEqual(DEFAULT_FIRE_LINK);
  });
  it('combines comma-separated concepts and reports typos by name', () => {
    const r = parseFireLink('ring, flash,flsh,ring');
    expect(r.concepts).toEqual(['ring', 'flash']);
    expect(r.unknown).toEqual(['flsh']);
  });
  it('shows the card for every concept but legacy and none', () => {
    expect(fireLinkShowsCard(['ticks'])).toBe(true);
    expect(fireLinkShowsCard(['legacy'])).toBe(false);
    expect(fireLinkShowsCard(['none'])).toBe(false);
  });
});

describe('notchSegments', () => {
  it('points an outgoing notch away from the ring along the bearing', () => {
    const segs = notchSegments(0, 0, 10, 0, 1, false);
    expect(segs).not.toBeNull();
    const [shaft, arm] = segs ?? [];
    expect(shaft[0]).toBeGreaterThan(1);
    expect(shaft[2]).toBeGreaterThan(shaft[0]);
    expect(shaft[1]).toBe(0);
    // The arrowhead's tip is the FAR end for an outgoing notch.
    expect(arm[0]).toBe(shaft[2]);
  });
  it('points an incoming notch at the ring', () => {
    const [shaft, arm] = notchSegments(0, 0, 0, -5, 1, true) ?? [];
    expect(shaft[1]).toBeLessThan(-1);
    expect(arm[1]).toBe(shaft[1]);
  });
  it('refuses coincident points', () => {
    expect(notchSegments(2, 2, 2, 2, 1, false)).toBeNull();
  });
});

describe('pulseAt', () => {
  it('starts wide and lands on the ring', () => {
    expect(pulseAt(0)?.scale).toBeCloseTo(PULSE_START_SCALE);
    expect(pulseAt(PULSE_S * 0.999)?.scale).toBeCloseTo(1, 2);
    expect(pulseAt(PULSE_S)).toBeNull();
    expect(pulseAt(-0.01)).toBeNull();
  });
});

describe('lightenHex', () => {
  it('mixes toward white', () => {
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
    expect(lightenHex('#2F6FD9', 0)).toBe('#2f6fd9');
    expect(lightenHex('#2F6FD9', 1)).toBe('#ffffff');
  });
});
