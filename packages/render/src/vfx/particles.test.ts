/**
 * Task B3.12: `forEachLive` is the backend-agnostic read path added to
 * `ParticleSystem` so a three.js caller can draw particles without
 * reimplementing `sampleStep`/`sampleLerp` curve sampling -- doing so would
 * let the two backends silently disagree on what an emitter looks like.
 * `draw()` (Pixi's own accessor, still used on the default player's path) is
 * now expressed entirely in terms of `forEachLive`, so there is no second
 * copy of the sampling or skip logic for the two to diverge from.
 *
 * Because `draw()` delegates to `forEachLive`, comparing their outputs to
 * each other can never expose a divergence -- there is only one
 * implementation now. So most assertions below check `forEachLive`'s output
 * against independently hand-computed `sampleStep`/`sampleLerp` results,
 * not merely against what `draw()` recorded; the accessor-parity checks are
 * an additional (necessary, not sufficient) guard that draw()'s screen-space
 * projection and its `-3` px nudge are still applied on top of exactly the
 * position/colour/alpha/radius `forEachLive` reports, and nothing else.
 *
 * Break check performed by hand while writing this file (not re-run by CI):
 * temporarily made `forEachLive` sample `alphaCurve` with `sampleStep`
 * instead of `sampleLerp` (i.e. corrupted the shared sampling `draw()` now
 * inherits). The P1/P2 hand-computed-alpha assertions below failed as
 * expected; reverting restored green. That is the failure this suite is
 * built to catch -- not two accessors disagreeing with each other (delegation
 * makes that structurally impossible) but the one shared implementation
 * computing the wrong number and both accessors agreeing on it.
 */
import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ParticleSystem } from './particles';
import type { ParticleSpec } from './emitters';

const LAYER_BELOW = 0;
const LAYER_ABOVE = 1;

function makeSpec(overrides: Partial<ParticleSpec> = {}): ParticleSpec {
  return {
    count: 1,
    lifetime_ms: 1000,
    color_over_life: ['#000000'],
    ...overrides,
  };
}

interface RecordedDraw {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
}

/** A minimal stand-in for Pixi's `Graphics` -- only the two chained calls
 *  `draw()` actually makes. Cast through `unknown` rather than implementing
 *  the whole interface, the same pattern `cursor-ownership.test.ts` uses for
 *  its DOM stand-ins. */
function graphicsSpy(): { graphics: Graphics; draws: RecordedDraw[] } {
  const draws: RecordedDraw[] = [];
  let pending: { x: number; y: number; r: number } | null = null;
  const spy = {
    circle(x: number, y: number, r: number) {
      pending = { x, y, r };
      return spy;
    },
    fill(opts: { color: string; alpha: number }) {
      if (pending) draws.push({ ...pending, color: opts.color, alpha: opts.alpha });
      pending = null;
      return spy;
    },
  };
  return { graphics: spy as unknown as Graphics, draws };
}

// A deliberately non-trivial projection: catches an accidental x/y swap or a
// dropped argument, which an identity projection would not.
const isoX = (x: number, y: number) => x * 2 + y * 3;
const isoY = (x: number, y: number) => y * 5 - x * 7;

interface Collected {
  x: number;
  y: number;
  color: string;
  alpha: number;
  radius: number;
}

function collect(system: ParticleSystem, layerIdx: number): Collected[] {
  const out: Collected[] = [];
  system.forEachLive(layerIdx, (x, y, color, alpha, radius) => out.push({ x, y, color, alpha, radius }));
  return out;
}

describe('ParticleSystem.forEachLive', () => {
  it('reports exactly what draw() draws: same order, position, sampled colour, alpha and radius, per layer', () => {
    const system = new ParticleSystem(8, (key) => key);

    // magnitude 0.2 makes spawn()'s size scale (0.75 + magnitude*1.25)
    // exactly 1.0, so radius reduces to size_px * sampleLerp(size_over_life)
    // with no extra scale factor to fold into the hand-computed expectation.
    const magnitude = 0.2;
    const speed0: Partial<ParticleSpec> = { speed_tiles_s: 0, gravity_tiles_s2: 0, drag: 0 };

    // P1: layer 0, 3-step curves, life 1000ms.
    system.spawn(
      makeSpec({
        ...speed0,
        lifetime_ms: 1000,
        size_px: 8,
        color_over_life: ['#AAAAAA', '#BBBBBB', '#CCCCCC'],
        alpha_over_life: [1, 0.6, 0.2],
        size_over_life: [0.5, 1, 1.5],
      }),
      10,
      20,
      0,
      magnitude,
      5,
      LAYER_BELOW
    );
    // P2: layer 0, different curves and a different life so the same step
    // leaves it at a different t.
    system.spawn(
      makeSpec({
        ...speed0,
        lifetime_ms: 2000,
        size_px: 4,
        color_over_life: ['#100000', '#200000', '#300000'],
        alpha_over_life: [0.9, 0.4, 0.0],
        size_over_life: [2, 1, 0],
      }),
      30,
      40,
      0,
      magnitude,
      5,
      LAYER_BELOW
    );
    // P3: layer 1 -- must be invisible to a layer-0 query and the only
    // result of a layer-1 query.
    system.spawn(
      makeSpec({ ...speed0, lifetime_ms: 1000, size_px: 3, color_over_life: ['#FEFEFE'] }),
      50,
      60,
      0,
      magnitude,
      5,
      LAYER_ABOVE
    );

    // Age P1/P2/P3 by half a second: P1 (life 1s) reaches t=0.5, P2
    // (life 2s) reaches t=0.25, P3 (life 1s) reaches t=0.5.
    system.step(0.5);

    // P4: layer 0, spawned fresh (t=0 exactly) with an alpha curve that
    // starts at 0 -- alive, but must be skipped by both accessors for
    // collapsing to alpha <= 0. size_over_life is a flat 1 so its radius
    // would be positive if alpha were not the reason it's excluded.
    system.spawn(
      makeSpec({ ...speed0, lifetime_ms: 1000, size_px: 5, alpha_over_life: [0, 1], size_over_life: [1] }),
      70,
      80,
      0,
      magnitude,
      5,
      LAYER_BELOW
    );
    // P5: layer 0, t=0, a size curve that starts at 0 -- alive, alpha
    // positive, but must be skipped for collapsing to radius <= 0.
    system.spawn(
      makeSpec({ ...speed0, lifetime_ms: 1000, size_px: 9, alpha_over_life: [1], size_over_life: [0, 1] }),
      90,
      100,
      0,
      magnitude,
      5,
      LAYER_BELOW
    );
    // P7: layer 0, t=0, omits alpha_over_life and size_over_life entirely --
    // exercises the fallback branches (`1 - t` and `1`) in both accessors.
    system.spawn(
      makeSpec({ ...speed0, lifetime_ms: 1000, size_px: 6, color_over_life: ['#ABCDEF'] }),
      110,
      120,
      0,
      magnitude,
      5,
      LAYER_BELOW
    );

    // Six particles spawned, all still alive -- P4/P5 are filtered by value,
    // not by being dead, which is the distinction this test is proving.
    expect(system.live).toBe(6);

    // --- layer 0: P1, P2, P7 in slot order; P3 (layer 1), P4 (alpha<=0),
    // P5 (r<=0) all excluded. ---
    const below = collect(system, LAYER_BELOW);
    expect(below).toHaveLength(3);

    const belowDraws = graphicsSpy();
    system.draw(belowDraws.graphics, isoX, isoY, LAYER_BELOW);
    expect(belowDraws.draws).toHaveLength(3);

    // Independently hand-computed expectations (sampleStep/sampleLerp by
    // hand), not merely "whatever forEachLive happened to return".
    expect(below[0].x).toBe(10);
    expect(below[0].y).toBe(20);
    expect(below[0].color).toBe('#BBBBBB'); // sampleStep(3-step curve, t=0.5) -> index 1
    expect(below[0].alpha).toBeCloseTo(0.6, 10); // sampleLerp([1,0.6,0.2], 0.5) -> curve[1]
    expect(below[0].radius).toBeCloseTo(8, 10); // size_px 8 * scale 1.0 * sampleLerp(...) -> 1.0

    expect(below[1].x).toBe(30);
    expect(below[1].y).toBe(40);
    expect(below[1].color).toBe('#100000'); // sampleStep(3-step curve, t=0.25) -> index 0
    expect(below[1].alpha).toBeCloseTo(0.65, 10); // sampleLerp([0.9,0.4,0], 0.25) -> 0.9 + (0.4-0.9)*0.5
    expect(below[1].radius).toBeCloseTo(6, 10); // size_px 4 * scale 1.0 * 1.5

    expect(below[2].x).toBe(110);
    expect(below[2].y).toBe(120);
    expect(below[2].color).toBe('#ABCDEF'); // single-entry curve, any t
    expect(below[2].alpha).toBeCloseTo(1, 10); // fallback 1 - t, t=0
    expect(below[2].radius).toBeCloseTo(6, 10); // size_px 6 * scale 1.0 * fallback 1

    // Accessor parity: draw()'s recorded screen call is isoX/isoY of the
    // exact same world position forEachLive reported, minus the 3px nudge
    // draw() applies on top -- not baked into forEachLive, since that nudge
    // is a Pixi screen-space convention, not part of the graphics-agnostic
    // contract.
    below.forEach((p, i) => {
      const d = belowDraws.draws[i];
      expect(d.x).toBeCloseTo(isoX(p.x, p.y), 10);
      expect(d.y).toBeCloseTo(isoY(p.x, p.y) - 3, 10);
      expect(d.color).toBe(p.color);
      expect(d.alpha).toBeCloseTo(p.alpha, 10);
      expect(d.r).toBeCloseTo(p.radius, 10);
    });

    // --- layer 1: only P3. ---
    const above = collect(system, LAYER_ABOVE);
    expect(above).toHaveLength(1);
    expect(above[0].x).toBe(50);
    expect(above[0].y).toBe(60);
    expect(above[0].color).toBe('#FEFEFE');
    expect(above[0].alpha).toBeCloseTo(0.5, 10); // fallback 1 - t, t=0.5
    expect(above[0].radius).toBeCloseTo(3, 10); // size_px 3 * scale 1.0 * fallback 1

    const aboveDraws = graphicsSpy();
    system.draw(aboveDraws.graphics, isoX, isoY, LAYER_ABOVE);
    expect(aboveDraws.draws).toHaveLength(1);
    expect(aboveDraws.draws[0].x).toBeCloseTo(isoX(50, 60), 10);
    expect(aboveDraws.draws[0].y).toBeCloseTo(isoY(50, 60) - 3, 10);
  });

  it('excludes a particle whose lifetime has fully elapsed (alive === 0), for both accessors', () => {
    const system = new ParticleSystem(4, (key) => key);
    system.spawn(makeSpec({ lifetime_ms: 1, speed_tiles_s: 0 }), 1, 1, 0, 0.2, 1, LAYER_BELOW);
    system.step(1); // 1s, far past the 1ms life -> dies during step()
    expect(system.live).toBe(0);

    expect(collect(system, LAYER_BELOW)).toHaveLength(0);

    const { graphics, draws } = graphicsSpy();
    system.draw(graphics, isoX, isoY, LAYER_BELOW);
    expect(draws).toHaveLength(0);
  });

  it('never visits an unused pool slot', () => {
    // Capacity larger than anything spawned: the untouched slots start
    // alive === 0 by construction (Uint8Array default), the same code path
    // a slot that died would take.
    const system = new ParticleSystem(16, (key) => key);
    system.spawn(makeSpec({ speed_tiles_s: 0 }), 5, 5, 0, 0.2, 1, LAYER_BELOW);
    expect(collect(system, LAYER_BELOW)).toHaveLength(1);
    expect(collect(system, LAYER_ABOVE)).toHaveLength(0);
  });
});

/**
 * `emit_over_ms`, `inherit_velocity`: previously declared in the schema and
 * `ParticleSpec` and read by nothing (`emitOverMs`/`inheritVelocity` never
 * appeared outside the type declaration and the JSON that set them --
 * confirmed by grep before writing this suite). `spawn()` burst behaviour is
 * the field-absent/0 case and must stay byte-identical; that is the first
 * test below, and it was run against the pre-change `spawn()` to confirm it
 * already passed before any implementation landed here.
 */
describe('ParticleSystem sustained emission (emit_over_ms) and inherit_velocity', () => {
  it('REGRESSION: a spec without emit_over_ms spawns its full count immediately, exactly as burst always has', () => {
    const system = new ParticleSystem(32, (key) => key);
    // count 8, magnitude 0 -> n = round(8 * 0.5) = 4, same formula spawn()
    // has always used. No emit_over_ms field at all (not merely 0).
    system.spawn(makeSpec({ count: 8, speed_tiles_s: 0 }), 1, 2, 0, 0, 3, LAYER_BELOW);
    expect(system.live).toBe(4);
  });

  it('REGRESSION: emit_over_ms: 0 behaves identically to the field being absent', () => {
    const system = new ParticleSystem(32, (key) => key);
    system.spawn(makeSpec({ count: 8, speed_tiles_s: 0, emit_over_ms: 0 }), 1, 2, 0, 0, 3, LAYER_BELOW);
    expect(system.live).toBe(4);
  });

  it('spreads emission across the declared window instead of bursting all particles at once', () => {
    const system = new ParticleSystem(32, (key) => key);
    // count 8, magnitude 0 -> n = 4 (same formula as above). lifetime is long
    // so nothing dies mid-test; emit_over_ms spreads the 4 across 1000ms.
    system.spawn(
      makeSpec({ count: 8, lifetime_ms: 60_000, speed_tiles_s: 0, emit_over_ms: 1000 }),
      1,
      2,
      0,
      0,
      3,
      LAYER_BELOW
    );
    // Not all 4 exist the instant spawn() returns -- this is the behaviour
    // that distinguishes a sustained emitter from a burst.
    expect(system.live).toBeLessThan(4);
    expect(system.live).toBeGreaterThanOrEqual(1);

    system.step(0.5); // halfway through the window
    expect(system.live).toBeLessThan(4);

    system.step(0.6); // now well past the 1000ms window
    expect(system.live).toBe(4);

    // Further stepping does not keep spawning past the declared total.
    system.step(1);
    expect(system.live).toBe(4);
  });

  it('respects the pool capacity while trickling a sustained emission, without throwing', () => {
    const system = new ParticleSystem(2, (key) => key);
    system.spawn(
      makeSpec({ count: 10, lifetime_ms: 60_000, speed_tiles_s: 0, emit_over_ms: 200 }),
      0,
      0,
      0,
      0,
      3,
      LAYER_BELOW
    );
    for (let i = 0; i < 20; i++) {
      system.step(0.05);
      expect(system.live).toBeLessThanOrEqual(2);
    }
  });

  it('inherit_velocity blends in the emitting entity motion passed to spawn()', () => {
    const system = new ParticleSystem(4, (key) => key);
    // speed_tiles_s 0 removes the cone-jitter term from vx/vy entirely, so
    // the only source of velocity is the inherited fraction of (velX, velY).
    system.spawn(
      makeSpec({ lifetime_ms: 60_000, speed_tiles_s: 0, gravity_tiles_s2: 0, drag: 0, inherit_velocity: 0.5 }),
      0,
      0,
      0,
      0,
      1,
      LAYER_BELOW,
      10,
      -4
    );
    system.step(1); // 1s at constant velocity -> displacement equals velocity
    const [p] = collect(system, LAYER_BELOW);
    expect(p.x).toBeCloseTo(5, 10); // 10 * 0.5
    expect(p.y).toBeCloseTo(-2, 10); // -4 * 0.5
  });

  it('REGRESSION: inherit_velocity has no effect when spawn() is called without a velocity argument', () => {
    // Every existing call site (weapon fire, collapse, ambient) calls spawn()
    // with exactly 7 arguments. inherit_velocity must not change their output.
    const system = new ParticleSystem(4, (key) => key);
    system.spawn(
      makeSpec({ lifetime_ms: 60_000, speed_tiles_s: 0, gravity_tiles_s2: 0, drag: 0, inherit_velocity: 0.9 }),
      3,
      4,
      0,
      0,
      1,
      LAYER_BELOW
    );
    system.step(1);
    const [p] = collect(system, LAYER_BELOW);
    expect(p.x).toBeCloseTo(3, 10);
    expect(p.y).toBeCloseTo(4, 10);
  });
});
