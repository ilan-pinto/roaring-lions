import { describe, it, expect } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import {
  shellKindFor,
  spawnShell,
  stepShells,
  shellPointAt,
  shellProgress,
  shellTrailPoints,
  shellTrailSpan,
  SHELL_PROFILES,
  SHELL_TRAIL_SEGMENTS,
  SHELL_TRAIL_S,
  SHELL_MIN_DURATION_S,
  SHELL_MAX_DURATION_S,
} from './shells';

describe('shellKindFor', () => {
  it('claims exactly the two classes the sim treats as indirect', () => {
    expect(shellKindFor(WEAPON_CLASS.mortar)).toBe('mortar');
    expect(shellKindFor(WEAPON_CLASS.rocket)).toBe('rocket');
  });

  it('claims nothing else on the roster -- direct fire keeps its tracer', () => {
    for (const name of ['apfsds', 'heat', 'he', 'atgm', 'rpg', 'small_arms', 'hmg', 'autocannon', 'interceptor', 'demolition']) {
      expect(shellKindFor(WEAPON_CLASS[name])).toBeNull();
    }
  });
});

describe('spawnShell', () => {
  it('takes its flight time from the distance and the kind, so a rocket beats a mortar over the same ground', () => {
    const mortar = spawnShell(0, 0, 12, 0, 0, 'mortar');
    const rocket = spawnShell(0, 0, 12, 0, 0, 'rocket');
    expect(mortar.duration).toBeCloseTo(12 / SHELL_PROFILES.mortar.speedTilesS, 6);
    expect(rocket.duration).toBeCloseTo(12 / SHELL_PROFILES.rocket.speedTilesS, 6);
    expect(rocket.duration).toBeLessThan(mortar.duration);
  });

  it('clamps flight time at both ends -- a point-blank shot still flies, a map-long one does not crawl', () => {
    expect(spawnShell(0, 0, 0, 0, 0, 'mortar').duration).toBeCloseTo(SHELL_MIN_DURATION_S, 6);
    expect(spawnShell(0, 0, 900, 0, 0, 'mortar').duration).toBeCloseTo(SHELL_MAX_DURATION_S, 6);
  });

  it('arcs a mortar bomb high and a rocket flat over identical ground', () => {
    const mortar = spawnShell(0, 0, 10, 0, 0, 'mortar');
    const rocket = spawnShell(0, 0, 10, 0, 0, 'rocket');
    expect(mortar.apexPx).toBeGreaterThan(rocket.apexPx * 2);
  });

  it('clamps the apex, so an 18-tile mortar shot does not leave the top of the screen', () => {
    const long = spawnShell(0, 0, 18, 0, 0, 'mortar');
    expect(long.apexPx).toBeLessThanOrEqual(SHELL_PROFILES.mortar.apexMaxPx);
    const short = spawnShell(0, 0, 4, 0, 0, 'mortar');
    expect(short.apexPx).toBeGreaterThanOrEqual(SHELL_PROFILES.mortar.apexMinPx);
  });
});

describe('shellPointAt', () => {
  const s = spawnShell(2, 3, 12, 9, 0, 'mortar');

  it('leaves the tube at the muzzle and lands on the aim point, both at ground level', () => {
    expect(shellPointAt(s, 0)).toEqual({ x: 2, y: 3, liftPx: 0 });
    const end = shellPointAt(s, 1);
    expect(end.x).toBeCloseTo(12, 6);
    expect(end.y).toBeCloseTo(9, 6);
    expect(end.liftPx).toBeCloseTo(0, 6);
  });

  it('peaks at the apex, at the midpoint of the ground track', () => {
    const mid = shellPointAt(s, 0.5);
    expect(mid.x).toBeCloseTo(7, 6);
    expect(mid.y).toBeCloseTo(6, 6);
    expect(mid.liftPx).toBeCloseTo(s.apexPx, 6);
  });

  it('is a true arc -- it climbs to the apex and falls away from it, never plateaus', () => {
    for (let i = 0; i < 5; i++) {
      const lo = shellPointAt(s, i / 10).liftPx;
      const hi = shellPointAt(s, (i + 1) / 10).liftPx;
      expect(hi).toBeGreaterThan(lo);
      expect(shellPointAt(s, 1 - i / 10).liftPx).toBeLessThan(shellPointAt(s, 1 - (i + 1) / 10).liftPx);
    }
  });

  it('clamps outside the flight, so a shell past its own duration cannot dive underground', () => {
    expect(shellPointAt(s, 1.6).liftPx).toBeCloseTo(0, 6);
    expect(shellPointAt(s, -0.4).liftPx).toBeCloseTo(0, 6);
  });
});

describe('stepShells', () => {
  it('ages every shell and drops the ones that have landed, without mutating the input', () => {
    const live = spawnShell(0, 0, 12, 0, 0, 'mortar');
    const nearly = { ...spawnShell(0, 0, 12, 0, 1, 'rocket'), t: 2.35 };
    const input = [live, nearly];
    const next = stepShells(input, 0.1);
    expect(next).toHaveLength(1);
    expect(next[0].side).toBe(0);
    expect(next[0].t).toBeCloseTo(0.1, 6);
    // Pure: the caller's own array and objects are untouched.
    expect(input).toHaveLength(2);
    expect(live.t).toBe(0);
  });

  it('reports progress as a clamped 0..1 fraction of the shell’s own flight', () => {
    const s = spawnShell(0, 0, 12, 0, 0, 'mortar');
    expect(shellProgress(s)).toBe(0);
    expect(shellProgress({ ...s, t: s.duration / 4 })).toBeCloseTo(0.25, 6);
    expect(shellProgress({ ...s, t: s.duration * 3 })).toBe(1);
  });
});

describe('shellTrailPoints', () => {
  it('returns one more point than there are segments, ordered tail to head', () => {
    const s = { ...spawnShell(0, 0, 16, 0, 0, 'mortar'), t: 2 };
    const pts = shellTrailPoints(s);
    expect(pts).toHaveLength(SHELL_TRAIL_SEGMENTS + 1);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  });

  it('carries the u each point was sampled at, spanning shellTrailSpan end to end', () => {
    const s = { ...spawnShell(0, 0, 16, 0, 0, 'mortar'), t: 2 };
    const span = shellTrailSpan(s);
    const pts = shellTrailPoints(s);
    expect(pts[0].u).toBeCloseTo(span.tail, 6);
    expect(pts[pts.length - 1].u).toBeCloseTo(span.head, 6);
    // The draw side needs u to interpolate ground height between the launch
    // and impact tiles; a bare position cannot recover it.
    for (let i = 1; i < pts.length; i++) expect(pts[i].u).toBeGreaterThan(pts[i - 1].u);
  });

  it('spans exactly the last SHELL_TRAIL_S of flight once the shell is clear of the tube', () => {
    const s = { ...spawnShell(0, 0, 16, 0, 0, 'mortar'), t: 2 };
    const pts = shellTrailPoints(s);
    const head = shellPointAt(s, 2 / s.duration);
    const tail = shellPointAt(s, (2 - SHELL_TRAIL_S) / s.duration);
    expect(pts[pts.length - 1].x).toBeCloseTo(head.x, 6);
    expect(pts[0].x).toBeCloseTo(tail.x, 6);
  });

  it('clamps the tail to the muzzle at launch, so the streak grows out of the tube', () => {
    const s = { ...spawnShell(3, 5, 16, 5, 0, 'mortar'), t: 0.02 };
    const pts = shellTrailPoints(s);
    expect(pts[0].x).toBeCloseTo(3, 6);
    expect(pts[0].liftPx).toBeCloseTo(0, 6);
  });
});
