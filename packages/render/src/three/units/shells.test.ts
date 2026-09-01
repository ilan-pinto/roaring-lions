import { describe, it, expect } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import {
  shellKindFor,
  isIndirectShell,
  shellHasLanded,
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
  type ShellKind,
} from './shells';

describe('shellKindFor', () => {
  it('claims exactly the two classes the sim treats as indirect', () => {
    expect(shellKindFor(WEAPON_CLASS.mortar)).toBe('mortar');
    expect(shellKindFor(WEAPON_CLASS.rocket)).toBe('rocket');
  });

  // GH-149. This case used to assert `null` for all ten remaining classes;
  // the contract changed deliberately when direct fire got a projectile, and
  // the interesting half of it is what is STILL null -- see `shellKindFor`'s
  // own doc comment for why a rifle burst keeps the full-span ribbon.
  it('flies a bolt for the one-big-round direct classes -- the tank and the chain gun', () => {
    expect(shellKindFor(WEAPON_CLASS.apfsds)).toBe('bolt');
    expect(shellKindFor(WEAPON_CLASS.autocannon)).toBe('bolt');
  });

  it('flies a missile for the guided/rocket-propelled classes', () => {
    expect(shellKindFor(WEAPON_CLASS.atgm)).toBe('missile');
    expect(shellKindFor(WEAPON_CLASS.rpg)).toBe('missile');
    expect(shellKindFor(WEAPON_CLASS.heat)).toBe('missile');
  });

  it('leaves the STREAM classes on the flat tracer, which is what that ribbon is right for', () => {
    for (const name of ['small_arms', 'hmg', 'he', 'interceptor', 'demolition']) {
      expect(shellKindFor(WEAPON_CLASS[name])).toBeNull();
    }
  });
});

describe('isIndirectShell', () => {
  it('splits the arcing kinds from the direct ones -- the one fact that routes a shell', () => {
    expect(isIndirectShell('mortar')).toBe(true);
    expect(isIndirectShell('rocket')).toBe(true);
    expect(isIndirectShell('bolt')).toBe(false);
    expect(isIndirectShell('missile')).toBe(false);
  });

  it('is the only kind that detonates on landing -- a direct round leaves it to the sim event', () => {
    for (const kind of Object.keys(SHELL_PROFILES) as ShellKind[]) {
      expect(SHELL_PROFILES[kind].impactPower > 0).toBe(isIndirectShell(kind));
    }
  });
});

// The module-level constants are now the ARCING kinds' values and the
// profiles are what the code reads. These pin the two together, so a future
// edit to one that means to move both cannot silently move only one --
// which is exactly how `SHELL_TRAIL_S`'s doc comment would have gone stale.
describe('the arcing profiles still carry the constants they were tuned as', () => {
  it.each(['mortar', 'rocket'] as const)('%s', (kind) => {
    expect(SHELL_PROFILES[kind].trailS).toBe(SHELL_TRAIL_S);
    expect(SHELL_PROFILES[kind].minDurationS).toBe(SHELL_MIN_DURATION_S);
    expect(SHELL_PROFILES[kind].baseLiftPx).toBe(0);
  });
});

describe('the bolt profile', () => {
  it('is genuinely flat -- no apex at any range, so its height is the base lift alone', () => {
    const near = spawnShell(0, 0, 1, 0, 0, 'bolt');
    const far = spawnShell(0, 0, 40, 0, 0, 'bolt');
    expect(near.apexPx).toBe(0);
    expect(far.apexPx).toBe(0);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      expect(shellPointAt(far, u).liftPx).toBeCloseTo(SHELL_PROFILES.bolt.baseLiftPx, 9);
    }
  });

  it('flies clear of the deck, unlike a mortar bomb which meets its own ground at both ends', () => {
    expect(SHELL_PROFILES.bolt.baseLiftPx).toBeGreaterThan(0);
    const bomb = spawnShell(0, 0, 10, 0, 0, 'mortar');
    expect(shellPointAt(bomb, 0).liftPx).toBe(0);
    expect(shellPointAt(bomb, 1).liftPx).toBe(0);
  });

  it('crosses a real engagement in more frames than it is long -- the read GH-149 was after', () => {
    // 6.7 tiles is the tank-duel range measured on beit_sahwan_outskirts.
    const shot = spawnShell(0, 0, 6.7, 0, 0, 'bolt');
    const frames = shot.duration * 60;
    expect(frames).toBeGreaterThan(8);
    // The streak must be clearly SHORTER than the gap it crosses, or it
    // reads as a line that flashes rather than a round that travels.
    const streakTiles = SHELL_PROFILES.bolt.trailS * SHELL_PROFILES.bolt.speedTilesS;
    expect(streakTiles).toBeLessThan(6.7 / 2);
  });

  it('outruns a missile by a wide margin, so a Hellfire and a sabot round do not read alike', () => {
    expect(SHELL_PROFILES.bolt.speedTilesS).toBeGreaterThan(SHELL_PROFILES.missile.speedTilesS * 4);
  });
});

describe('shellTrailSpan reads the KIND\'s own trail, not one global', () => {
  it('gives a bolt a much shorter wake than a bomb at the same point in flight', () => {
    // Both 40% through a 12-tile shot: the only thing that can differ is
    // trailS (and the duration it is divided by).
    const bomb = { ...spawnShell(0, 0, 12, 0, 0, 'mortar') };
    const bolt = { ...spawnShell(0, 0, 12, 0, 0, 'bolt') };
    bomb.t = bomb.duration * 0.4;
    bolt.t = bolt.duration * 0.4;
    const span = (s: typeof bomb): number => {
      const { tail, head } = shellTrailSpan(s);
      return head - tail;
    };
    // In SECONDS of flight, which is what trailS is expressed in.
    expect(span(bolt) * bolt.duration).toBeCloseTo(SHELL_PROFILES.bolt.trailS, 6);
    expect(span(bomb) * bomb.duration).toBeCloseTo(SHELL_PROFILES.mortar.trailS, 6);
    expect(SHELL_PROFILES.bolt.trailS).toBeLessThan(SHELL_PROFILES.mortar.trailS);
  });
});

describe('shellHasLanded', () => {
  it('is true exactly for the shells this dt would drop, so an impact fires once and on time', () => {
    const s = spawnShell(0, 0, 10, 0, 0, 'mortar');
    const nearly = { ...s, t: s.duration - 0.02 };
    expect(shellHasLanded(nearly, 0.01)).toBe(false);
    expect(shellHasLanded(nearly, 0.05)).toBe(true);
    expect(stepShells([nearly], 0.01)).toHaveLength(1);
    expect(stepShells([nearly], 0.05)).toHaveLength(0);
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
