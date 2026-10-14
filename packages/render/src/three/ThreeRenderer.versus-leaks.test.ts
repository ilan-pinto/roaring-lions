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
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { TracerModel } from './units/tracers';
import type { ShellModel } from './units/shells';
import type { OverlayBatch } from './units/overlays';
import type { BannerSpot } from './units/banner-placement';
import type { GarrisonBannerBatch } from './units/garrison-banner';

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
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  bannerSpots: Map<string, BannerSpot | null>;
  updateGarrisonBanners(): void;
  garrisonBanners: GarrisonBannerBatch;
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
  it('in a versus room, it draws when the shooter is in sight', () => {
    expect(fireThrough({ versus: true, viewerSide: 0 }, true, [4, 4])).toBeGreaterThan(0);
  });
  // N1b follow-up: a target in sight no longer draws a hidden shooter's round
  // -- the streak starts at the muzzle, and the line back along it is the
  // shooter. The target tile, and the "usual case" of a shot at the seat's own
  // unit, whose eyes (sight 1) do not reach the tube 7 tiles off, draw none.
  it('in a versus room, a hostile shooter it cannot see throws no round, even when the target is in sight', () => {
    expect(fireThrough({ versus: true, viewerSide: 0 }, true, [11, 4])).toBe(0);
    expect(fireThrough({ versus: true, viewerSide: 0 }, false)).toBe(0);
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

describe('a held building shows its holder only where it may (lead ruling 2026-10-14)', () => {
  /** A side-1 rifleman garrisoned in a hut at (20, 20), far outside side 0's
   *  sight. Returns how many banners the renderer draws for it, and how many
   *  of the retired badge's roofs (the one triangle spanning -7..7 px with
   *  its apex at 0) the overlay pass still pushes. No GLB loads under node,
   *  so the hut's standing clone and its type's banner spot are stood in:
   *  what is under test is the RULE that picks the banners, not the mesh. */
  function held(room: Pick<RendererOptions, 'viewerSide' | 'versus'>, revealHut: boolean): { banners: number; badges: number } {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(TARGET);
    const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1', garrison_slots: 1 });
    const hutId = sim.addStructure(hut, [20 * W + 20]);
    sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
    const inside = sim.spawn(t, 1, fx.from(20.5), fx.from(20.5));
    sim.state.garrisonedIn[inside] = hutId;
    sim.structures.occupants[hutId] = 1;
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    r.snapshot();
    priv(r).buildingMeshIdleEntities.set(hutId, new THREE.Object3D());
    priv(r).bannerSpots.set('hut', { face: '+z', x: 0, y: 0.5, z: 0.4, width: 0.3, drop: 0.4, lit: 1, solid: 1 });
    priv(r).fog.fill(0);
    if (revealHut) reveal(r, 20.5, 20.5);
    const triangle = vi.spyOn(priv(r).overlayBatch, 'triangle');
    priv(r).updateOverlays(1);
    priv(r).updateGarrisonBanners();
    const badges = triangle.mock.calls.filter(([, pts]) => pts[0][0] === -7 && pts[1][0] === 0 && pts[2][0] === 7).length;
    const out = { banners: priv(r).garrisonBanners.count, badges };
    r.dispose();
    return out;
  }

  it('single-player no longer shows a fogged hostile garrison (the badge did: the leak)', () => {
    expect(held({}, false)).toEqual({ banners: 0, badges: 0 });
    expect(held({ viewerSide: 0 }, false)).toEqual({ banners: 0, badges: 0 });
  });
  it('single-player shows it once the building is in sight', () => {
    expect(held({}, true)).toEqual({ banners: 1, badges: 0 });
  });
  it('a versus seat shows no hostile-held building it cannot see, and does once it can', () => {
    expect(held({ versus: true, viewerSide: 0 }, false)).toEqual({ banners: 0, badges: 0 });
    expect(held({ versus: true, viewerSide: 0 }, true)).toEqual({ banners: 1, badges: 0 });
  });
  it('a seat always shows its own garrison, fog or not', () => {
    expect(held({ versus: true, viewerSide: 1 }, false)).toEqual({ banners: 1, badges: 0 });
  });
});

// ---------------------------------------------------------------------------
// N1b task 13 (R-N14): the four leaks N1a left open, through the real
// renderer. `versus-fog.test.ts` pins the predicates; these pin that the
// renderer asks them on its production paths, and that single-player (no
// `versus`) still draws every one of them through fog, as main does.
// ---------------------------------------------------------------------------

interface LeakPrivates {
  fog: Uint8Array;
  shells: ShellModel[];
  overlayBatch: OverlayBatch;
  updateOverlays(alpha: number): void;
  spawnSmokeDischarge(by: number, sx: number, sy: number): void;
  spawnCollapseFx(id: string, bx: number, by: number, power?: number, yawTurns?: number): boolean;
  beginCollapseShroud(structure: number, cx: number, cy: number): void;
}
const leak = (r: ThreeRenderer): LeakPrivates => r as unknown as LeakPrivates;
type Room = Pick<RendererOptions, 'viewerSide' | 'versus'>;

describe('a damaged building out of sight shows no integrity bar in a room (R-N14 leak 1)', () => {
  /** A side-1-held hut at (20, 20), half its integrity gone, far outside the
   *  side-0 seat's sight. Returns how many integrity-bar rects (32 x 4 px,
   *  -16..16) the overlay pass pushed: 2 when drawn (background and fill). */
  function bars(room: Room, revealHut: boolean): number {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(TARGET);
    const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
    const hutId = sim.addStructure(hut, [20 * W + 20]);
    sim.structures.hp[hutId] = Math.floor(sim.structures.maxHp[hutId] / 2);
    sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
    const inside = sim.spawn(t, 1, fx.from(20.5), fx.from(20.5));
    sim.state.garrisonedIn[inside] = hutId;
    sim.structures.occupants[hutId] = 1;
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    r.snapshot();
    leak(r).fog.fill(0);
    if (revealHut) reveal(r, 20.5, 20.5);
    const rect = vi.spyOn(leak(r).overlayBatch, 'rect');
    leak(r).updateOverlays(1);
    const n = rect.mock.calls.filter(([, x0, y0, , y1]) => x0 === -16 && y1 - y0 === 4).length;
    r.dispose();
    return n;
  }

  it('single-player draws a fogged hostile building\'s bar, as main does', () => {
    expect(bars({}, false)).toBe(2);
    expect(bars({ viewerSide: 0 }, false)).toBe(2);
  });
  it('a versus seat draws no bar for a hostile building it cannot see', () => {
    expect(bars({ versus: true, viewerSide: 0 }, false)).toBe(0);
  });
  it('a versus seat draws it once the building is in sight', () => {
    expect(bars({ versus: true, viewerSide: 0 }, true)).toBe(2);
  });
  it('a versus seat always draws its own building\'s bar, fog or not', () => {
    expect(bars({ versus: true, viewerSide: 1 }, false)).toBe(2);
  });
});

describe('hostile smoke laid out of sight throws no discharge in a room (R-N14 leak 2)', () => {
  /** A side-1 unit at (20.5, 20.5) lays a screen toward (22, 20); returns how
   *  many times the renderer threw the launcher's pop. */
  function pops(room: Room, revealLayer: boolean): number {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(TARGET);
    sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
    const layer = sim.spawn(t, 1, fx.from(20.5), fx.from(20.5));
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    r.snapshot();
    leak(r).fog.fill(0);
    if (revealLayer) reveal(r, 20.5, 20.5);
    const pop = vi.spyOn(leak(r), 'spawnSmokeDischarge');
    r.onEvents([{ kind: 'smokeLaid', tick: 1, by: layer, x: fx.from(22), y: fx.from(20) }]);
    const n = pop.mock.calls.length;
    r.dispose();
    return n;
  }

  it('single-player throws a fogged hostile\'s pop, as main does', () => {
    expect(pops({}, false)).toBe(1);
  });
  it('a versus seat throws none for a hostile it cannot see', () => {
    expect(pops({ versus: true, viewerSide: 0 }, false)).toBe(0);
  });
  it('a versus seat throws it when the layer is in sight, and always for its own', () => {
    expect(pops({ versus: true, viewerSide: 0 }, true)).toBe(1);
    expect(pops({ versus: true, viewerSide: 1 }, false)).toBe(1);
  });
});

describe('a collapse out of sight throws no fireball or shroud in a room (R-N14 leak 3)', () => {
  /** A 2x2 block at (20..21, 20..21), levelled through the sim's own path,
   *  then the event handed over. Returns the burst and shroud call counts. */
  function structure(room: Room, revealTile?: [number, number]): { burst: number; shroud: number } {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(TARGET);
    sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
    const block = sim.addStructureType({ id: 'block', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
    const id = sim.addStructure(block, [20 * W + 20, 20 * W + 21, 21 * W + 20, 21 * W + 21]);
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    r.snapshot();
    leak(r).fog.fill(0);
    if (revealTile) reveal(r, revealTile[0], revealTile[1]);
    const burst = vi.spyOn(leak(r), 'spawnCollapseFx');
    const shroud = vi.spyOn(leak(r), 'beginCollapseShroud');
    sim.debugDestroyStructure(id);
    r.onEvents([{ kind: 'structureDestroyed', tick: sim.tickCount, structure: id, by: -1 }]);
    const out = { burst: burst.mock.calls.length, shroud: shroud.mock.calls.length };
    r.dispose();
    return out;
  }

  it('single-player throws a fogged structure collapse, as main does', () => {
    expect(structure({}, undefined)).toEqual({ burst: 1, shroud: 1 });
  });
  it('a versus seat throws none for a collapse it cannot see', () => {
    expect(structure({ versus: true, viewerSide: 0 }, undefined)).toEqual({ burst: 0, shroud: 0 });
  });
  it('a versus seat throws it when any footprint tile is in sight -- the structure is already dead', () => {
    // The far corner, not the centre: `structureInSight` would read false
    // for every tile of a dead structure (R-B15), so this is the footprint.
    expect(structure({ versus: true, viewerSide: 0 }, [21.5, 21.5])).toEqual({ burst: 1, shroud: 1 });
  });

  /** A pre-dug route from (18, 18) to (26, 18), collapsed. Returns how many
   *  sample points threw the `tunnel_collapse` burst. */
  function tunnel(room: Room, revealTile?: [number, number]): number {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
    const t = sim.addUnitType(TARGET);
    sim.spawn(t, 0, fx.from(4.5), fx.from(4.5));
    const route = sim.addTunnel({ id: 'tn', points: [[18, 18], [26, 18]], dig_tiles_per_s: 1, pre_dug: true });
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    r.snapshot();
    leak(r).fog.fill(0);
    if (revealTile) reveal(r, revealTile[0], revealTile[1]);
    const burst = vi.spyOn(leak(r), 'spawnCollapseFx');
    r.onEvents([{ kind: 'tunnelCollapsed', tick: sim.tickCount, tunnel: route, by: -1 }]);
    const n = burst.mock.calls.filter(([id]) => id === 'tunnel_collapse').length;
    r.dispose();
    return n;
  }

  it('single-player throws every sample of a fogged tunnel collapse, as main does', () => {
    expect(tunnel({}, undefined)).toBeGreaterThan(1);
  });
  it('a versus seat throws none out of sight, and only the samples it can see', () => {
    const all = tunnel({}, undefined);
    expect(tunnel({ versus: true, viewerSide: 0 }, undefined)).toBe(0);
    expect(tunnel({ versus: true, viewerSide: 0 }, [18.5, 18.5])).toBe(1);
    expect(all).toBeGreaterThan(1);
  });
});

describe('a hidden shooter\'s muzzle flash and direct-fire streak stay hidden when only its target is seen (N1b follow-up)', () => {
  interface FirePrivates {
    fog: Uint8Array;
    tracers: unknown[];
    bolts: unknown[];
    flashLights: { liveCount: number };
    spawnFlatFx(x: number, y: number, color: string, size: number, life: number): void;
  }
  const fp = (r: ThreeRenderer): FirePrivates => r as unknown as FirePrivates;

  /** The side-1 squad's first shot, with the fog set up as the case asks:
   *  `shooterSeen` reveals the shooter's tile (4, 4), `targetSeen` the target's
   *  (11, 4); everything else is dark. Returns what the shot drew. */
  function shot(room: Room, shooterSeen: boolean, targetSeen: boolean): { streaks: number; flashes: number } {
    const { sim, events } = sideOneFires();
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    fp(r).fog.fill(0);
    if (shooterSeen) reveal(r, 4, 4);
    if (targetSeen) reveal(r, 11, 4);
    // No emitter set is loaded: a visible muzzle falls back to flat puffs,
    // which is the same `muzzleShown` gate the particle layers and the light sit behind.
    const puffs = vi.spyOn(fp(r), 'spawnFlatFx');
    // The `fire` events alone: a miss or a hit on a target in sight throws its
    // own flat flash at the TARGET, which is not what is asked here.
    r.onEvents(events.filter((e) => e.kind === 'fire'));
    const out = { streaks: fp(r).tracers.length + fp(r).bolts.length, flashes: puffs.mock.calls.length };
    r.dispose();
    return out;
  }

  it('single-player draws the flash and the streak whatever the fog, as main does', () => {
    for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      const out = shot({}, a, b);
      expect(out.streaks, `${a}/${b}`).toBeGreaterThan(0);
      expect(out.flashes, `${a}/${b}`).toBeGreaterThan(0);
    }
  });
  it('a versus seat sees neither when the hostile shooter is hidden, target seen or not', () => {
    expect(shot({ versus: true, viewerSide: 0 }, false, true)).toEqual({ streaks: 0, flashes: 0 });
    expect(shot({ versus: true, viewerSide: 0 }, false, false)).toEqual({ streaks: 0, flashes: 0 });
  });
  it('a versus seat sees both once the shooter is in sight', () => {
    for (const targetSeen of [false, true]) {
      const out = shot({ versus: true, viewerSide: 0 }, true, targetSeen);
      expect(out.streaks, `target ${targetSeen}`).toBeGreaterThan(0);
      expect(out.flashes, `target ${targetSeen}`).toBeGreaterThan(0);
    }
  });
  it('a versus seat always sees its own shot, fog or not', () => {
    const out = shot({ versus: true, viewerSide: 1 }, false, false);
    expect(out.streaks).toBeGreaterThan(0);
    expect(out.flashes).toBeGreaterThan(0);
  });
});

/** `mortar_team`'s own `mortar_60`, trimmed to the fields the sim reads (the
 *  `ThreeRenderer.indirect-projectile.test.ts` fixture). */
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

describe('an arc from an unseen hostile shooter appears at its apex in a room (R-N14 leak 4)', () => {
  /** A side-1 mortar at (4, 4) firing at a side-0 target at (11, 4): the
   *  real events of its first fire tick. Returns the spawned round's
   *  `hiddenUntil` (0 when absent), or null when no round was spawned. */
  function hiddenUntil(room: Room, revealAt?: [number, number]): number | null {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 8 });
    const shooterType = sim.addUnitType(MORTAR);
    const targetType = sim.addUnitType(TARGET);
    const shooter = sim.spawn(shooterType, 1, fx.from(4), fx.from(4));
    sim.spawn(targetType, 0, fx.from(11), fx.from(4));
    let events: SimEvent[] = [];
    for (let k = 0; k < 400 && !events.some((e) => e.kind === 'fire' && e.shooter === shooter); k++) events = sim.tick();
    expect(events.some((e) => e.kind === 'fire' && e.shooter === shooter)).toBe(true);
    const r = new ThreeRenderer(sim, makeOpts(room));
    r.snapshot();
    leak(r).fog.fill(0);
    if (revealAt) reveal(r, revealAt[0], revealAt[1]);
    r.onEvents(events);
    const shells = leak(r).shells;
    const out = shells.length === 0 ? null : (shells[0].hiddenUntil ?? 0);
    r.dispose();
    return out;
  }

  it('single-player draws a fogged hostile mortar from the muzzle, as main does', () => {
    expect(hiddenUntil({}, undefined)).toBe(0);
    expect(hiddenUntil({}, [11, 4])).toBe(0);
  });
  it('a versus seat that sees only the impact gets the round from its apex', () => {
    expect(hiddenUntil({ versus: true, viewerSide: 0 }, [11, 4])).toBe(0.5);
  });
  it('a versus seat that sees the shooter, or owns it, gets the whole arc', () => {
    expect(hiddenUntil({ versus: true, viewerSide: 0 }, [4, 4])).toBe(0);
    expect(hiddenUntil({ versus: true, viewerSide: 1 }, undefined)).toBe(0);
  });
});
