import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clampCamera } from './camera-input';
import {
  INTRO_MS,
  INTRO_START_TOWARD,
  INTRO_START_ZOOM,
  foldGeometry,
  introCamera,
  introPlan,
  introStartPose,
  introToward,
  type IntroCamera,
  type IntroFacts,
} from './mission-intro';

const MISSION: IntroFacts = { hasBriefing: true, sandbox: false, room: false, tutorial: false, reduced: false };

describe('introPlan: who gets the transition', () => {
  it('a mission with a briefing gets the fold and the camera, held until the camera lands', () => {
    expect(introPlan(MISSION)).toEqual({ reduced: false, hudAtMs: 520, landMs: 650, cameraMs: 1400, holdMs: 1400 });
  });

  // Each of these is today's cut exactly: the plan is null, so main.ts keeps
  // nothing and holds nothing.
  it.each([
    ['a sandbox', { sandbox: true }],
    ['a network room', { room: true }],
    ['the tutorial', { tutorial: true }],
    ['a mission whose screen did not hold', { hasBriefing: false }],
  ] as const)('%s gets none', (_, over) => {
    expect(introPlan({ ...MISSION, ...over })).toBeNull();
    expect(introPlan({ ...MISSION, ...over, reduced: true })).toBeNull();
  });

  it('reduced motion: no camera move, and the screen, the HUD, the reveal and the clock all at 200 ms', () => {
    expect(introPlan({ ...MISSION, reduced: true })).toEqual({ reduced: true, hudAtMs: 200, landMs: 200, cameraMs: 0, holdMs: 200 });
  });
});

describe('introToward: what the start pose leans toward', () => {
  const zones = { approach: [10, 20, 4, 6], depot: [30, 30, 2, 2] };
  const map = { width: 48, height: 40 };

  it("is the first PRIMARY objective's target zone centre", () => {
    const objs = [{ primary: false, target: 'depot' }, { target: 'approach' }, { target: 'depot' }];
    expect(introToward(objs, zones, map)).toEqual({ x: 12, y: 23 });
  });

  it('skips a target that names no zone (a raze names a structure tag)', () => {
    expect(introToward([{ target: 'hvt_tag' }, { target: 'depot' }], zones, map)).toEqual({ x: 31, y: 31 });
  });

  it('falls back to the map centre', () => {
    expect(introToward([{ target: 'nowhere' }, {}], zones, map)).toEqual({ x: 24, y: 20 });
    expect(introToward([], zones, map)).toEqual({ x: 24, y: 20 });
  });
});

describe('introStartPose', () => {
  const free = (c: IntroCamera): { x: number; y: number } => ({ x: c.x, y: c.y });

  it('is zoom x0.6 and a third of the way toward the objective', () => {
    expect([INTRO_START_ZOOM, INTRO_START_TOWARD]).toEqual([0.6, 1 / 3]);
    const p = introStartPose({ x: 10, y: 10, zoom: 1 }, { x: 40, y: 22 }, free);
    // Literals worked by hand: 10 + 30/3 = 20, 10 + 12/3 = 14.
    expect(p.zoom).toBeCloseTo(0.6, 9);
    expect(p.x).toBeCloseTo(20, 9);
    expect(p.y).toBeCloseTo(14, 9);
  });

  it('never goes below the 0.35 zoom floor', () => {
    expect(introStartPose({ x: 10, y: 10, zoom: 0.4 }, { x: 10, y: 10 }, free).zoom).toBe(0.35);
  });

  it('hands the clamp the START zoom, not the landing one', () => {
    let seen = -1;
    introStartPose({ x: 10, y: 10, zoom: 2 }, { x: 10, y: 10 }, (c) => {
      seen = c.zoom;
      return c;
    });
    expect(seen).toBeCloseTo(1.2, 9);
  });

  // The mock's T1 finding: a start at the map's south edge opened on off-map
  // void. Through the real `clampCamera`, at every edge, the wide view stays
  // inside the map's box plus the player's own 96 px allowance -- worked
  // here independently from the projection (u = (x-y)*32, v = (x+y)*16).
  const MAP = { width: 48, height: 48 };
  const VP = { width: 1400, height: 900 };
  const clamp = (c: IntroCamera): { x: number; y: number } => clampCamera(c, MAP, VP);
  it.each([
    ['south', { x: 24, y: 47 }],
    ['north', { x: 1, y: 1 }],
    ['west', { x: 1, y: 47 }],
    ['east', { x: 47, y: 1 }],
  ] as const)('keeps the wide view on the map at the %s edge', (_, at) => {
    const p = introStartPose({ ...at, zoom: 1 }, at, clamp);
    const u = (p.x - p.y) * 32;
    const v = (p.x + p.y) * 16;
    const halfW = VP.width / (2 * p.zoom);
    const halfH = VP.height / (2 * p.zoom);
    const m = 96 / p.zoom;
    expect(u - halfW).toBeGreaterThanOrEqual(-48 * 32 - m - 1e-6);
    expect(u + halfW).toBeLessThanOrEqual(48 * 32 + m + 1e-6);
    expect(v - halfH).toBeGreaterThanOrEqual(0 - m - 1e-6);
    expect(v + halfH).toBeLessThanOrEqual(96 * 16 + m + 1e-6);
  });
});

describe('introCamera', () => {
  const plan = introPlan(MISSION);
  const start: IntroCamera = { x: 0, y: 0, zoom: 0.6 };
  const end: IntroCamera = { x: 30, y: 12, zoom: 1 };

  it('starts at the start pose', () => {
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(introCamera(0, plan, start, end)).toEqual(start);
  });

  it('eases OUT: past half the distance at a quarter of the time, and nearly home just before the end', () => {
    if (!plan) throw new Error('no plan');
    // ease-out cubic: 1 - (1 - 0.25)^3 = 0.578125.
    expect(introCamera(350, plan, start, end)?.x).toBeCloseTo(30 * 0.578125, 9);
    const near = introCamera(1399, plan, start, end);
    expect(near?.x).toBeCloseTo(30, 3);
    expect(near?.zoom).toBeCloseTo(1, 3);
  });

  it('is null once the ease is over -- the caller writes the landing pose once', () => {
    if (!plan) throw new Error('no plan');
    expect(introCamera(1400, plan, start, end)).toBeNull();
    expect(introCamera(5000, plan, start, end)).toBeNull();
  });

  it('never moves under reduced motion', () => {
    const reduced = introPlan({ ...MISSION, reduced: true });
    if (!reduced) throw new Error('no plan');
    for (const ms of [0, 100, 199, 200]) expect(introCamera(ms, reduced, start, end)).toBeNull();
  });
});

describe('foldGeometry', () => {
  it('moves the box top-left onto the bar, scales it to the bar width and clips it to the bar height', () => {
    // Box 420 x 600 at (490, 150); bar 520 x 96 at (8, 56). scale = 520/420;
    // kept height = 96 / scale = 77.538..., so 522.46... px are clipped.
    const g = foldGeometry({ left: 490, top: 150, width: 420, height: 600 }, { left: 8, top: 56, width: 520, height: 96 });
    expect(g?.dx).toBe(-482);
    expect(g?.dy).toBe(-94);
    expect(g?.scale).toBeCloseTo(520 / 420, 9);
    expect(g?.clipBottomPx).toBeCloseTo(600 - 96 * (420 / 520), 6);
    // Scaled, what is left is exactly the bar's height.
    if (g) expect((600 - g.clipBottomPx) * g.scale).toBeCloseTo(96, 6);
  });

  it('clips nothing when the box is already shorter than the bar, scaled', () => {
    expect(foldGeometry({ left: 0, top: 0, width: 520, height: 50 }, { left: 0, top: 0, width: 520, height: 96 })?.clipBottomPx).toBe(0);
  });

  it('is null with no bar to fold onto', () => {
    expect(foldGeometry({ left: 0, top: 0, width: 420, height: 600 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    expect(foldGeometry({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 520, height: 96 })).toBeNull();
  });
});

// The CSS half of each timer the runner arms. A token drifting from the table
// would have the screen removed before (or long after) its animation ends.
describe('theme.css carries the same timings as INTRO_MS', () => {
  const css = readFileSync(resolve(process.cwd(), 'packages/app/src/ui/theme.css'), 'utf8');
  const token = (name: string): number => {
    const m = new RegExp(`${name}:\\s*(\\d+)ms;`).exec(css);
    if (!m) throw new Error(`no ${name} in theme.css`);
    return Number(m[1]);
  };
  it.each([
    ['--dur-intro-fold', INTRO_MS.fold],
    ['--delay-intro-backdrop', INTRO_MS.backdropAt],
    ['--dur-intro-backdrop', INTRO_MS.backdrop],
    ['--delay-intro-card-fade', INTRO_MS.cardFadeAt],
    ['--dur-intro-card-fade', INTRO_MS.cardFade],
    ['--dur-intro-hud', INTRO_MS.hudFade],
    ['--dur-intro-pulse', INTRO_MS.pulse],
    ['--dur-intro-fade', INTRO_MS.reducedFade],
  ] as const)('%s is %i ms', (name, ms) => {
    expect(token(name)).toBe(ms);
  });

  it('the card lands as its fold and its fade end', () => {
    expect(INTRO_MS.land).toBe(INTRO_MS.fold);
    expect(INTRO_MS.cardFadeAt + INTRO_MS.cardFade).toBe(INTRO_MS.fold);
  });

  // The ruling's one exemption from the 1 ms reduced-motion collapse, under
  // BOTH switches -- and nothing else of the intro's is exempt.
  it('exempts the reduced-motion fade from the collapse, under both switches', () => {
    const media = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g)].map((m) => m[0]).join('\n');
    expect(media).toMatch(/\.rl-loading\[data-intro='fade'\]\s*\{\s*animation-duration:\s*var\(--dur-intro-fade\) !important;/);
    expect(css).toMatch(/:root\[data-motion='reduce'\] \.rl-loading\[data-intro='fade'\]\s*\{\s*animation-duration:\s*var\(--dur-intro-fade\) !important;/);
    expect(css.match(/var\(--dur-intro-[a-z-]+\) !important/g)?.length).toBe(2);
  });
});

// The wiring no pure test reaches, read off main.ts the way
// `camera-input.test.ts` reads its own: a tool entry point that does not end
// the intro FIRST would see a half transition, or have its framing
// overwritten by the landing pose.
describe('wired in main.ts', () => {
  const main = readFileSync(resolve(process.cwd(), 'packages/app/src/main.ts'), 'utf8');
  const body = (head: RegExp): string => {
    const m = head.exec(main);
    if (!m) throw new Error(`no ${String(head)} in main.ts`);
    return main.slice(m.index + m[0].length, m.index + m[0].length + 400);
  };
  it.each([
    ['step', /\n\s*step: \(n: number\) => \{/],
    ['goto', /\n\s*goto: \(where: string \| number, y\?: number\) => \{/],
    ['sel', /\n\s*sel: \(ids: number\[\]\) => \{/],
  ] as const)('__lions.%s ends the intro before anything else', (_, head) => {
    const code = body(head)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('//'));
    expect(code[0]).toBe('endIntro();');
  });

  it('the intro holds the tick accumulator', () => {
    expect(main).toMatch(/advanceClock\(clock, now, gameSpeed, paused \|\| beat !== null \|\| intro !== null, MS_PER_TICK\)/);
  });

  it('keeps the deploy screen exactly when there is a plan', () => {
    expect(main).toContain('await loading.done({ keep: introPlanned !== null });');
  });

  it('ending the intro releases the clock with no backlog', () => {
    const end = body(/const endIntro = \(\): void => \{/);
    expect(end).toContain('clock.acc = 0;');
    expect(end).toContain('clock.last = performance.now();');
  });
});
