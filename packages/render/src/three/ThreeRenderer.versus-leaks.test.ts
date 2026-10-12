/**
 * N1a task 4, network design §5.1: the two leaks, through the REAL renderer.
 *
 * `units/pick.ts` and `fire-visible.ts` are pinned by their own pure suites;
 * neither can tell you that `ThreeRenderer` hands its fog gate to the pick,
 * gates `onFire`'s spawns on the answer, or keeps both OFF in single-player.
 * This file does, through events a real `Sim` produced. Single-player (no
 * `versus`) is asserted beside every room case: it must keep drawing hostile
 * fire through fog and keep letting a click pick a fogged unit, exactly as
 * before, because viewer 0 outside a room is byte-identical to main.
 *
 * Harness: `ThreeRenderer.indirect-projectile.test.ts`'s faked
 * `WebGLRenderer` and options. Fog starts all-unseen (`new Uint8Array`) and
 * nothing here calls `frame()`, so a tile is in sight only where a test
 * writes 2 into the private fog grid itself.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { TracerModel } from './units/tracers';
import type { ShellModel } from './units/shells';
import type { OverlayBatch } from './units/overlays';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
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
  groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(room: Pick<RendererOptions, 'viewerSide' | 'versus'> = {}): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    ...room,
  };
}

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
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1 },
  weapons: [],
};

interface Privates {
  cssWidth: number;
  cssHeight: number;
  fog: Uint8Array;
  tracers: TracerModel[];
  shells: ShellModel[];
  bolts: ShellModel[];
  overlayBatch: OverlayBatch;
  updateOverlays(alpha: number): void;
  drawsEnvelope(i: number): boolean;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

const W = 32;
/** Puts tile (x, y) in sight for this renderer. */
function reveal(r: ThreeRenderer, x: number, y: number): void {
  priv(r).fog[Math.floor(y) * W + Math.floor(x)] = 2;
}

/** A side-1 rifle squad at (4, 4) shooting a side-0 target at (11, 4): the
 *  real events of the tick it first fires on. */
function sideOneFires(): { sim: Sim; events: SimEvent[] } {
  const sim = new Sim({ seed: 7, width: W, height: W, capacity: 8 });
  const shooterType = sim.addUnitType(RIFLES);
  const targetType = sim.addUnitType(TARGET);
  const shooter = sim.spawn(shooterType, 1, fx.from(4), fx.from(4));
  sim.spawn(targetType, 0, fx.from(11), fx.from(4));
  for (let t = 0; t < 400; t++) {
    const events = sim.tick();
    if (events.some((e) => e.kind === 'fire' && e.shooter === shooter)) return { sim, events };
  }
  throw new Error('the side-1 rifles never fired');
}

function drawn(r: ThreeRenderer): number {
  const p = priv(r);
  return p.tracers.length + p.shells.length + p.bolts.length;
}

/** Hands the fire tick to a renderer. The first `snapshot()` computes fog
 *  from the viewer's own units -- a side-0 viewer's target stands in its own
 *  sight -- so `blind` then clears the grid to "neither end in sight" (the
 *  case a shot at a structure or a civilian beyond the seat's eyes is), and
 *  `revealAt` puts one tile back. */
function fireThrough(
  room: Pick<RendererOptions, 'viewerSide' | 'versus'>,
  blind: boolean,
  revealAt?: [number, number]
): number {
  const { sim, events } = sideOneFires();
  const r = new ThreeRenderer(sim, makeOpts(room));
  r.snapshot();
  if (blind) priv(r).fog.fill(0);
  if (revealAt) reveal(r, revealAt[0], revealAt[1]);
  r.onEvents(events);
  const n = drawn(r);
  r.dispose();
  return n;
}

describe('hostile fire out of sight (§5.1, the second leak)', () => {
  it('single-player still draws hostile fire through fog, as main does', () => {
    expect(fireThrough({}, true)).toBeGreaterThan(0);
    expect(fireThrough({ viewerSide: 0 }, true)).toBeGreaterThan(0);
  });
  it('in a versus room, hostile fire with neither end in sight draws nothing', () => {
    expect(fireThrough({ versus: true, viewerSide: 0 }, true)).toBe(0);
  });
  it('in a versus room, it draws when the shooter or the impact is in sight', () => {
    expect(fireThrough({ versus: true, viewerSide: 0 }, true, [4, 4])).toBeGreaterThan(0);
    expect(fireThrough({ versus: true, viewerSide: 0 }, true, [11, 4])).toBeGreaterThan(0);
    // The usual case needs no help: a shot at the seat's own unit lands
    // where that unit's own eyes put the fog.
    expect(fireThrough({ versus: true, viewerSide: 0 }, false)).toBeGreaterThan(0);
  });
  it('in a versus room, own fire always draws, fog or not', () => {
    expect(fireThrough({ versus: true, viewerSide: 1 }, true)).toBeGreaterThan(0);
  });
});

describe('picking a hidden unit (§5.1, the first leak)', () => {
  function world(room: Pick<RendererOptions, 'viewerSide' | 'versus'>) {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(TARGET);
    const own = sim.spawn(t, 0, fx.from(5.5), fx.from(5.5));
    const hostile = sim.spawn(t, 1, fx.from(20.5), fx.from(20.5));
    const r = new ThreeRenderer(sim, makeOpts(room));
    // `init()`'s `fitToHost` is what sizes the viewport; no host here.
    priv(r).cssWidth = 1400;
    priv(r).cssHeight = 900;
    r.camera.x = 13;
    r.camera.y = 13;
    r.snapshot();
    return { r, own, hostile };
  }

  /** The click (`unitAtScreen`, what `main.ts` calls) and the box
   *  (`unitsInScreenRect`) at a world point, through the renderer's own
   *  camera. */
  function click(r: ThreeRenderer, wx: number, wy: number): number {
    const p = r.worldToScreen(wx, wy);
    return r.unitAtScreen(p.x, p.y);
  }
  function box(r: ThreeRenderer, wx: number, wy: number): number[] {
    const p = r.worldToScreen(wx, wy);
    return r.unitsInScreenRect(p.x - 4, p.y - 4, p.x + 4, p.y + 4);
  }

  it('single-player picks a fogged hostile, exactly as main does', () => {
    const { r, hostile } = world({});
    expect(r.pickUnit(20.5, 20.5)).toBe(hostile);
    expect(click(r, 20.5, 20.5)).toBe(hostile);
    expect(box(r, 20.5, 20.5)).toEqual([hostile]);
    r.dispose();
  });
  it('a versus seat cannot pick a fogged hostile, can pick it in sight, and always picks its own', () => {
    const { r, own, hostile } = world({ versus: true, viewerSide: 0 });
    expect(r.pickUnit(20.5, 20.5)).toBe(-1);
    expect(click(r, 20.5, 20.5)).toBe(-1);
    expect(box(r, 20.5, 20.5)).toEqual([]);
    expect(r.pickUnit(5.5, 5.5)).toBe(own);
    expect(click(r, 5.5, 5.5)).toBe(own);
    reveal(r, 20.5, 20.5);
    expect(r.pickUnit(20.5, 20.5)).toBe(hostile);
    expect(click(r, 20.5, 20.5)).toBe(hostile);
    expect(box(r, 20.5, 20.5)).toEqual([hostile]);
    r.dispose();
  });
  it('the seat on side 1 is the mirror: its own is side 1', () => {
    // `hostile` is side 1 -- this seat's own -- and `own` is side 0, its enemy.
    const { r, own, hostile } = world({ versus: true, viewerSide: 1 });
    expect(r.pickUnit(20.5, 20.5)).toBe(hostile);
    expect(r.pickUnit(5.5, 5.5)).toBe(-1);
    reveal(r, 5.5, 5.5);
    expect(r.pickUnit(5.5, 5.5)).toBe(own);
    r.dispose();
  });
});

describe('a selected hostile shows no route or envelope in a room (§5.1)', () => {
  function moving(room: Pick<RendererOptions, 'viewerSide' | 'versus'>) {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 1, fx.from(9.5), fx.from(11.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(25.5), y: fx.from(11.5) });
    for (let k = 0; k < 3; k++) sim.tick();
    expect(sim.state.moving[id]).toBe(1);
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    r.snapshot();
    reveal(r, 9.5, 11.5);
    r.selection = [id];
    const lineWorld = vi.spyOn(priv(r).overlayBatch, 'lineWorld');
    priv(r).updateOverlays(1);
    const out = { route: lineWorld.mock.calls.length, envelope: priv(r).drawsEnvelope(id) };
    r.dispose();
    return out;
  }

  it('single-player draws a selected hostile\'s route and envelope, as main does', () => {
    expect(moving({})).toEqual({ route: 1, envelope: true });
  });
  it('a versus seat draws neither for a hostile, even in sight', () => {
    expect(moving({ versus: true, viewerSide: 0 })).toEqual({ route: 0, envelope: false });
  });
  it('and both for its own', () => {
    expect(moving({ versus: true, viewerSide: 1 })).toEqual({ route: 1, envelope: true });
  });
});
