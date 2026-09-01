/**
 * GH-145: indirect fire draws an arcing projectile, and stops drawing the
 * flat ground-level tracer that contradicted it.
 *
 * The wiring is the whole risk here. `units/shells.ts` and `units/fx.ts`'s
 * `writeShellInstances` are covered by their own pure suites, which prove
 * the arc is an arc and the geometry is geometry -- neither of them can tell
 * you that a `fire` event ever reaches them. This file does, and it does it
 * through events the SIM ITSELF produced: a real mortar team and a real
 * rifle squad, spawned in a real `Sim`, ticked until they shoot, and the
 * resulting `SimEvent[]` handed to `ThreeRenderer.onEvents` unmodified. A
 * hand-built `fire` literal would prove nothing about `weaponId` matching a
 * real weapon on a real unit type, which is the exact lookup `onFire` does
 * to classify the shot.
 *
 * `vi.mock('three')`'s `WebGLRenderer` stand-in is `ThreeRenderer.test.ts`'s
 * verbatim, for the same reason: everything the constructor builds except
 * that one object is plain JS-side `THREE.*` construction that needs no GPU.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { TracerModel } from './units/tracers';
import type { ShellModel } from './units/shells';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {
      // Real `WebGLRenderer#setClearColor` reads `outputColorSpace`
      // synchronously; this stand-in only needs to accept the call.
    }
    dispose(): void {
      // Nothing to release: this stand-in holds no GPU context.
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

/** `mortar_team`'s own `mortar_60`, trimmed to the fields the sim reads. */
const MORTAR: UnitTypeJson = {
  id: 't_mortar',
  role: 'artillery',
  hull: { hp: 350, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.65 },
  sensors: { optics: 0.9, sight_tiles: 20 },
  weapons: [
    {
      id: 'mortar_60', type: 'mortar', range_tiles: 18, effective_range_tiles: 14,
      accuracy: 0.5, penetration: 30, damage: 180, splash_tiles: 1.8,
      suppression: 90, rof_per_min: 60, min_range_tiles: 4,
    },
  ],
};

/** `rocket_battery`'s own `grad_122`, same treatment. */
const GRAD: UnitTypeJson = {
  id: 't_grad',
  role: 'artillery',
  hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 0.9, sight_tiles: 20 },
  weapons: [
    {
      id: 'grad_122', type: 'rocket', range_tiles: 20, effective_range_tiles: 15,
      accuracy: 0.4, penetration: 40, damage: 240, splash_tiles: 3,
      suppression: 110, rof_per_min: 60, min_range_tiles: 4,
    },
  ],
};

const RIFLES: UnitTypeJson = {
  id: 't_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 20 },
  weapons: [
    {
      id: 'rifles', type: 'small_arms', range_tiles: 9, effective_range_tiles: 7,
      accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300,
    },
  ],
};

const TARGET: UnitTypeJson = {
  id: 't_target',
  role: 'infantry',
  // Enough HP that nothing under test kills it before it has been shot at.
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1 },
  weapons: [],
};

interface Privates {
  tracers: TracerModel[];
  shells: ShellModel[];
}

/**
 * Builds the renderer and hands it the tick's events the way `main.ts` does
 * -- `snapshot()` first, then `onEvents(events)` (`main.ts:1521-1522`).
 * `snapshot()` is what fills `curX`/`curY`, the interpolated positions
 * `onFire` aims both a tracer and a shell from; skipping it leaves every
 * unit at the origin, which is not a state the real loop can produce.
 */
function rendererAfter(sim: Sim, events: SimEvent[]): ThreeRenderer {
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.snapshot();
  renderer.onEvents(events);
  return renderer;
}

function privates(r: ThreeRenderer): Privates {
  // Same reach-into-privates convention `ThreeRenderer.test.ts` uses for
  // `fogMesh`: there is no public accessor, and adding one purely for a test
  // would widen `Renderer`'s surface for no runtime reason.
  return r as unknown as Privates;
}

/**
 * Spawns `shooter` beside a target and ticks until the shooter fires,
 * returning the real events of the tick it fired on. Ranges are chosen
 * inside every weapon under test (7 tiles clears the mortar's own 4-tile
 * minimum and sits inside the rifle's 9-tile reach).
 */
function firstFireEvents(shooterJson: UnitTypeJson): { sim: Sim; events: SimEvent[] } {
  const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
  const shooterType = sim.addUnitType(shooterJson);
  const targetType = sim.addUnitType(TARGET);
  const shooter = sim.spawn(shooterType, 0, fx.from(4), fx.from(4));
  sim.spawn(targetType, 1, fx.from(11), fx.from(4));
  for (let t = 0; t < 400; t++) {
    const events = sim.tick();
    if (events.some((e) => e.kind === 'fire' && e.shooter === shooter)) return { sim, events };
  }
  throw new Error(`${shooterJson.id} never fired`);
}

describe('indirect fire draws an arcing projectile', () => {
  it('a real mortar fire event from a real Sim spawns a shell, and NO flat tracer', () => {
    const { sim, events } = firstFireEvents(MORTAR);
    const renderer = rendererAfter(sim, events);
    const p = privates(renderer);
    expect(p.shells).toHaveLength(1);
    expect(p.shells[0].kind).toBe('mortar');
    // The flat ground-level ribbon is the thing the arc REPLACES. Leaving it
    // in would draw a straight line along the ground under a bomb that is
    // visibly not travelling along it.
    expect(p.tracers).toHaveLength(0);
    renderer.dispose();
  });

  it('a rocket battery arcs too, flatter and quicker than the mortar over the same ground', () => {
    const mortarRun = firstFireEvents(MORTAR);
    const gradRun = firstFireEvents(GRAD);
    const mortarRenderer = rendererAfter(mortarRun.sim, mortarRun.events);
    const gradRenderer = rendererAfter(gradRun.sim, gradRun.events);
    const bomb = privates(mortarRenderer).shells[0];
    const rocket = privates(gradRenderer).shells[0];
    expect(rocket.kind).toBe('rocket');
    expect(rocket.apexPx).toBeLessThan(bomb.apexPx);
    expect(rocket.duration).toBeLessThan(bomb.duration);
    mortarRenderer.dispose();
    gradRenderer.dispose();
  });

  it('direct fire is untouched: a rifle still draws a tracer and no shell', () => {
    const { sim, events } = firstFireEvents(RIFLES);
    const renderer = rendererAfter(sim, events);
    const p = privates(renderer);
    expect(p.tracers.length).toBeGreaterThan(0);
    expect(p.shells).toHaveLength(0);
    renderer.dispose();
  });

  it('the shell is aimed at the target, not left at the origin', () => {
    const { sim, events } = firstFireEvents(MORTAR);
    const renderer = rendererAfter(sim, events);
    const shell = privates(renderer).shells[0];
    const fire = events.find((e): e is Extract<SimEvent, { kind: 'fire' }> => e.kind === 'fire');
    if (!fire) throw new Error('no fire event');
    // The renderer aims at its own interpolated position for the target
    // entity -- the same source the tracer has always used. Both units were
    // spawned on integer tiles and neither moves, so that is the spawn tile.
    expect(shell.tx).toBeCloseTo(fx.toNumber(sim.state.posX[fire.target]), 5);
    expect(shell.ty).toBeCloseTo(fx.toNumber(sim.state.posY[fire.target]), 5);
    // The tube is 7 tiles away, so the round has a real distance to cover.
    expect(Math.hypot(shell.tx - shell.sx, shell.ty - shell.sy)).toBeGreaterThan(5);
    renderer.dispose();
  });

  it('shells age off on real frame seconds -- never on sim ticks', () => {
    const { sim, events } = firstFireEvents(MORTAR);
    const renderer = rendererAfter(sim, events);
    const p = privates(renderer);
    const duration = p.shells[0].duration;
    const updateFx = (r: ThreeRenderer, dtMs: number): void =>
      (r as unknown as { updateFx(ms: number): void }).updateFx(dtMs);
    updateFx(renderer, 1000 / 60);
    expect(p.shells).toHaveLength(1);
    expect(p.shells[0].t).toBeGreaterThan(0);
    // Ticking the SIM does not age it -- only frames do.
    const tAfterOneFrame = p.shells[0].t;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(p.shells[0].t).toBe(tAfterOneFrame);
    // And it lands once its own flight time has actually elapsed.
    for (let i = 0; i < Math.ceil(duration * 60) + 2; i++) updateFx(renderer, 1000 / 60);
    expect(p.shells).toHaveLength(0);
    renderer.dispose();
  });
});
