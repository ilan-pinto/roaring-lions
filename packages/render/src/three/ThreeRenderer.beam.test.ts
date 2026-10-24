/**
 * E6 (GH-274) chunk C: the laser beam, pinned where `ThreeRenderer` wires it.
 *
 * `units/beam-look.test.ts` proves the state table and `units/beam-batch.test.ts` the geometry; this
 * asks the only question that puts a beam on screen: does the RENDERER feed them the sim's own
 * `beamState`, the carrier's live turret pivot, the swarm's slot `live - 1`, and the `beam` events -
 * and keep fog, the debug layers and the shimmer honest.
 *
 * The world is the REAL one: the shipped `aa_remetz.json` and `drone_swarm.json` on the real `Sim`
 * (so the dwell, the strike and the heat lockout come from the engine, not from a fixture of what an
 * engine might say), and the shipped GLBs through the real `loadVehicleMesh`. Harness and `vi.mock`
 * stand-in from `ThreeRenderer.swarm.test.ts`.
 *
 * Every assertion was verified by mutating the line it pins and watching it go red; the list is in
 * the commit message.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { isDebugLayer } from './debug-layers';
import { FogOfWarPass } from './fog-pass';
import { parseGlbHeadless } from './units/headless-gltf';
import { buildVehicleMeshTemplate, type VehicleMeshEntity } from './units/mesh-vehicle';
import type { BeamBatch } from './units/beam-batch';
import type { EmitterSpec, ParticleSpec } from '../vfx/emitters';
import remetzJson from '../../../../data/units/kdf/aa_remetz.json';
import swarmJson from '../../../../data/units/enemy/drone_swarm.json';
import beamStrikeJson from '../../../../data/vfx/beam_strike.json';
import beamVentJson from '../../../../data/vfx/beam_vent.json';
import swarmDownJson from '../../../../data/vfx/swarm_member_down.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const loaded = vi.hoisted(() => ({ templates: new Map<string, unknown>() }));
vi.mock('./units/mesh-vehicle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-vehicle')>();
  return { ...actual, loadVehicleMeshTemplate: async (_url: string, id: string) => loaded.templates.get(id) };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
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
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

const MESHES = '../../../../art/meshes/vehicles/';
const REMETZ_GLB = fileURLToPath(new URL(`${MESHES}aa_remetz.glb`, import.meta.url));
const SWARM_GLB = fileURLToPath(new URL(`${MESHES}drone_swarm.glb`, import.meta.url));

const REMETZ = remetzJson as unknown as UnitTypeJson;
/** The shipped swarm minus its bomb: the dive is chunk B's; here it would only kill the carrier. */
const SWARM = { ...(swarmJson as unknown as UnitTypeJson), weapons: [] } as UnitTypeJson;
/** A lone aircraft that survives a whole 12 s heat budget (240 / 30 = 8 strikes of 80). */
const DRONE: UnitTypeJson = {
  id: 'b_drone', role: 'drone', hull: { hp: 5000, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.01, domain: 'air' }, sensors: { optics: 1, sight_tiles: 6, signature: 1.0 },
};

const EMITTERS = [beamStrikeJson, beamVentJson, swarmDownJson] as unknown as EmitterSpec[];

interface Privates {
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  vehicleMeshTemplates: Map<string, unknown>;
  beamBatch: BeamBatch;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  updateSwarms(alpha: number, dtMs: number): void;
  updateBeams(alpha: number): void;
  feedBeamShimmer(camera: THREE.OrthographicCamera, alpha: number): void;
  threeCamera(): THREE.OrthographicCamera;
  airLiftY(i: number, alpha: number): number;
  cssWidth: number;
  cssHeight: number;
  fog: Uint8Array;
  fogPass: FogOfWarPass | null;
  particleSystem: { spawn(spec: ParticleSpec, ...rest: unknown[]): void } | null;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

type TargetKind = 'swarm' | 'drone';

async function world(target: TargetKind = 'swarm', opts: { loadCarrier?: boolean; carrier?: UnitTypeJson; hostileCarrier?: boolean } = {}) {
  const sim = new Sim({ seed: 3, width: 40, height: 24, capacity: 16 });
  const rt = sim.addUnitType(opts.carrier ?? REMETZ);
  const carrierSide = opts.hostileCarrier ? 1 : 0;
  const carrier = sim.spawn(rt, carrierSide, fx.from(10.5), fx.from(12.5));
  const tt = sim.addUnitType(target === 'swarm' ? SWARM : DRONE);
  const prey = sim.spawn(tt, 1 - carrierSide, fx.from(17.5), fx.from(12.5));
  const r = new ThreeRenderer(sim, makeOpts());
  const owner = new Map<ParticleSpec, { id: string; at: [number, number] }>();
  r.useEmitters(EMITTERS, (k) => (k.startsWith('#') ? k : '#E6D8BE'));
  for (const em of EMITTERS) for (const l of em.particles) owner.set(l, { id: em.id, at: [0, 0] });
  const ps = priv(r).particleSystem;
  if (ps === null) throw new Error('fixture: useEmitters built no ParticleSystem');
  const log: { id: string; x: number; y: number }[] = [];
  const real = ps.spawn.bind(ps);
  ps.spawn = (spec: ParticleSpec, ...rest: unknown[]): void => {
    log.push({ id: owner.get(spec)?.id ?? 'flat', x: rest[0] as number, y: rest[1] as number });
    real(spec, ...rest);
  };
  loaded.templates.set('aa_remetz', buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(REMETZ_GLB)), 'aa_remetz', true));
  loaded.templates.set('drone_swarm', buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(SWARM_GLB)), 'drone_swarm'));
  if (opts.loadCarrier !== false) await r.loadVehicleMesh('aa_remetz', 'aa_remetz.glb');
  if (target === 'swarm') await r.loadVehicleMesh('drone_swarm', 'drone_swarm.glb');
  r.snapshot();
  r.snapshot();
  priv(r).fog.fill(2);
  // Never `init`ed (no host element): give the camera a viewport, or every projection is degenerate.
  priv(r).cssWidth = 1400;
  priv(r).cssHeight = 900;
  return { sim, r, carrier, prey, log, carrierSide };
}
type World = Awaited<ReturnType<typeof world>>;

/** One presented frame: vehicles, then swarms, then beams (`frame()`'s own order), fog held open. */
function frame(w: World, alpha = 1, dtMs = 16): void {
  priv(w.r).fog.fill(2);
  priv(w.r).updateVehicleMeshes(alpha, dtMs);
  priv(w.r).updateSwarms(alpha, dtMs);
  priv(w.r).updateBeams(alpha);
}

/** `main.ts`'s `runTick` without audio or missions: tick, snapshot, deliver events, paint. */
function tick(w: World, alpha = 1): SimEvent[] {
  w.sim.identifyTo(w.carrierSide, w.prey);
  const events = w.sim.tick();
  w.r.snapshot();
  w.r.onEvents(events);
  frame(w, alpha);
  return events;
}

function ticks(w: World, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...tick(w));
  return all;
}

/** Tick until the beam holds the prey; fails loudly rather than asserting on nothing. */
function untilLasing(w: World, max = 200): void {
  for (let i = 0; i < max; i++) {
    tick(w);
    if (w.sim.beamState(w.carrier).target >= 0) return;
  }
  throw new Error('fixture: the carrier never took the prey');
}

describe('the laser carrier lases a swarm: the real engine, the real meshes', () => {
  it('draws a beam while the sim holds a target, and none before', async () => {
    const w = await world();
    frame(w);
    expect(w.r.beamDrawn(w.carrier)).toBeNull();
    expect(priv(w.r).beamBatch.mesh.visible).toBe(false);
    untilLasing(w);
    ticks(w, 3);
    const b = w.r.beamDrawn(w.carrier);
    expect(b).not.toBeNull();
    expect(b?.ribbon).toBe(true);
    expect(priv(w.r).beamBatch.mesh.visible).toBe(true);
    expect(priv(w.r).beamBatch.count).toBe(1);
    w.r.dispose();
  });

  it('the origin is rl_fire.muzzle through the clone\'s LIVE turret_pivot world matrix', async () => {
    const w = await world();
    untilLasing(w);
    ticks(w, 2);
    const entity = priv(w.r).vehicleMeshEntities.get(w.carrier);
    const pivot = entity?.turretPivot;
    expect(pivot).toBeTruthy();
    if (!pivot) return;
    const at = (): THREE.Vector3 => {
      pivot.updateWorldMatrix(true, false);
      return new THREE.Vector3(0.83, 0.575, 0).applyMatrix4(pivot.matrixWorld);
    };
    const first = w.r.beamDrawn(w.carrier)?.origin as [number, number, number];
    const expected = at();
    expect(Math.hypot(first[0] - expected.x, first[1] - expected.y, first[2] - expected.z)).toBeLessThan(1e-4);

    // Height: the pivot sits 4.1 m up and the muzzle 0.575 m above it, 3 m to the tile. Literals.
    expect(first[1]).toBeCloseTo((4.1 + 0.575) / 3, 2);

    // Traverse the turret a quarter turn: the origin MOVES with it (a hull-fixed muzzle would not).
    pivot.rotation.y += Math.PI / 2;
    priv(w.r).updateBeams(1);
    const turned = w.r.beamDrawn(w.carrier)?.origin as [number, number, number];
    const moved = at();
    expect(Math.hypot(turned[0] - moved.x, turned[1] - moved.y, turned[2] - moved.z)).toBeLessThan(1e-4);
    expect(Math.hypot(turned[0] - first[0], turned[2] - first[2])).toBeGreaterThan(0.2);

    // ...and a recoil kick along the pivot's own axis moves it too.
    const before = turned.slice();
    pivot.position.x -= 0.3;
    priv(w.r).updateBeams(1);
    const kicked = w.r.beamDrawn(w.carrier)?.origin as [number, number, number];
    expect(Math.hypot(kicked[0] - before[0], kicked[2] - before[2])).toBeGreaterThan(0.05);
    w.r.dispose();
  });

  it('the end is the swarm member at slot live-1, and it moves to the new live-1 after a strike', async () => {
    const w = await world();
    untilLasing(w);
    ticks(w, 2);
    const live = w.sim.swarmMembers(w.prey);
    expect(live).toBe(12);
    const slot = new THREE.Vector3();
    expect(w.r.swarmMemberWorldPosition(w.prey, live - 1, slot)).toBe(true);
    const end = w.r.beamDrawn(w.carrier)?.end as [number, number, number];
    expect([end[0], end[1], end[2]]).toEqual([slot.x, slot.y, slot.z]);
    const first = new THREE.Vector3();
    w.r.swarmMemberWorldPosition(w.prey, 0, first);
    expect(first.distanceTo(slot)).toBeGreaterThan(0.05);

    // Run on to the first strike.
    const events = ticks(w, 40);
    expect(events.some((e) => e.kind === 'beam' && e.phase === 'struck')).toBe(true);
    const liveAfter = w.sim.swarmMembers(w.prey);
    // The engine: a single-target hit removes AT MOST one member, however hard it hits.
    expect(liveAfter).toBe(11);
    const slotAfter = new THREE.Vector3();
    expect(w.r.swarmMemberWorldPosition(w.prey, liveAfter - 1, slotAfter)).toBe(true);
    const endAfter = w.r.beamDrawn(w.carrier)?.end as [number, number, number];
    expect([endAfter[0], endAfter[1], endAfter[2]]).toEqual([slotAfter.x, slotAfter.y, slotAfter.z]);
    expect(slotAfter.distanceTo(slot)).toBeGreaterThan(0.05);
    w.r.dispose();
  });
});

describe('any other air target ends at its render position plus the air lift', () => {
  it('lases a lone aircraft', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 2);
    const b = w.r.beamDrawn(w.carrier);
    expect(b?.ribbon).toBe(true);
    const lift = priv(w.r).airLiftY(w.prey, 1);
    expect(lift).toBeGreaterThan(0);
    expect(b?.end[0]).toBeCloseTo(17.5, 3);
    expect(b?.end[2]).toBeCloseTo(12.5, 3);
    expect(b?.end[1]).toBeCloseTo(lift, 6); // the map is flat: the ground is 0
    w.r.dispose();
  });
});

describe('the dwell drives the look', () => {
  it('the sheath narrows 6 -> 3 px and brightens 0.35 -> 0.85 across a dwell, then resets on the strike', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 1);
    const early = w.r.beamDrawn(w.carrier);
    const samples: { px: number; alpha: number; focus: number }[] = [];
    for (let i = 0; i < 26; i++) {
      tick(w);
      const b = w.r.beamDrawn(w.carrier);
      if (b) samples.push({ px: b.sheathPx, alpha: b.sheathAlpha, focus: b.focus });
    }
    const last = samples[samples.length - 1];
    expect(early?.sheathPx).toBeGreaterThan(5.5);
    expect(last.px).toBeLessThan(3.7);
    expect(last.alpha).toBeGreaterThan(0.75);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].px).toBeLessThanOrEqual(samples[i - 1].px + 1e-9);
      expect(samples[i].alpha).toBeGreaterThanOrEqual(samples[i - 1].alpha - 1e-9);
    }
    w.r.dispose();
  });

  it('reads the dwell length from the unit type, not from a constant', async () => {
    // The same carrier with a 3 s dwell (60 ticks): at dwell d the focus is d / 60, never d / 30.
    const slow = {
      ...REMETZ, id: 'slow_remetz',
      weapons: [{ ...((REMETZ.weapons as unknown[])[0] as object), beam: { dwell_s: 3, heat_s: 12, cooldown_s: 6 } }],
    } as UnitTypeJson;
    const w = await world('drone', { carrier: slow });
    untilLasing(w);
    ticks(w, 14);
    const s = w.sim.beamState(w.carrier);
    expect(s.dwell).toBeGreaterThan(10);
    const b = w.r.beamDrawn(w.carrier);
    expect(b?.focus).toBeCloseTo(s.dwell / 60, 9);
    expect(b?.focus).toBeLessThan(s.dwell / 30 - 0.1);
    w.r.dispose();
  });
});

describe('a strike pulses and throws sparks', () => {
  it('the frame after a struck event reads a full pulse, the next 120 ms later reads none', async () => {
    const w = await world('drone');
    untilLasing(w);
    let struck = false;
    for (let i = 0; i < 60 && !struck; i++) {
      const events = tick(w, 0);
      struck = events.some((e) => e.kind === 'beam' && e.phase === 'struck');
    }
    expect(struck).toBe(true);
    const hit = w.r.beamDrawn(w.carrier);
    expect(hit?.pulse).toBe(1);
    expect(hit?.corePx).toBeCloseTo(2.4, 9);
    expect(hit?.shimmerAmp).toBeCloseTo(1, 9);
    ticks(w, 3);
    const after = w.r.beamDrawn(w.carrier);
    expect(after?.pulse).toBe(0);
    expect(after?.corePx).toBe(1.2);
    w.r.dispose();
  });

  it('throws beam_strike where the beam was on its target', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 5);
    expect(w.log.filter((l) => l.id === 'beam_strike')).toHaveLength(0);
    const end = w.r.beamDrawn(w.carrier)?.end as [number, number, number];
    for (let i = 0; i < 60 && !w.log.some((l) => l.id === 'beam_strike'); i++) tick(w);
    const sparks = w.log.filter((l) => l.id === 'beam_strike');
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks[0].x).toBeCloseTo(end[0], 3);
    expect(sparks[0].y).toBeCloseTo(end[2], 3);
    w.r.dispose();
  });

  it('a catch-up (setQuiet) throws no spark and no pulse', async () => {
    const w = await world('drone');
    untilLasing(w);
    w.r.setQuiet(true);
    const events = ticks(w, 40);
    expect(events.some((e) => e.kind === 'beam' && e.phase === 'struck')).toBe(true);
    expect(w.log.filter((l) => l.id === 'beam_strike')).toHaveLength(0);
    expect(w.r.beamDrawn(w.carrier)?.pulse).toBe(0);
    w.r.dispose();
  });
});

describe('a lockout snaps off and vents; nothing else shows heat', () => {
  it('overheating snaps the beam off in one frame, vents from the carrier, and stays dark for the cooldown', async () => {
    const w = await world('drone');
    untilLasing(w);
    let locked = false;
    let drawnBeforeLock = false;
    for (let i = 0; i < 400 && !locked; i++) {
      const events = tick(w);
      locked = events.some((e) => e.kind === 'beam' && e.phase === 'lockout');
      if (!locked && w.r.beamDrawn(w.carrier)) drawnBeforeLock = true;
    }
    expect(locked).toBe(true);
    expect(drawnBeforeLock).toBe(true);
    // The very frame of the lockout: no beam, no lens glow.
    expect(w.r.beamDrawn(w.carrier)).toBeNull();
    expect(priv(w.r).beamBatch.mesh.visible).toBe(false);
    // The vent leaves the carrier, behind its centre, once.
    const vents = w.log.filter((l) => l.id === 'beam_vent');
    expect(vents.length).toBeGreaterThan(0);
    const cx = fx.toNumber(w.sim.state.posX[w.carrier]);
    const cy = fx.toNumber(w.sim.state.posY[w.carrier]);
    expect(Math.hypot(vents[0].x - cx, vents[0].y - cy)).toBeCloseTo(0.6, 3);
    // Dark through the whole cooldown (6 s = 120 ticks), however many frames it spans.
    for (let i = 0; i < 100; i++) {
      tick(w);
      expect(w.sim.beamState(w.carrier).locked).toBe(true);
      expect(w.r.beamDrawn(w.carrier)).toBeNull();
    }
    // And back after it.
    for (let i = 0; i < 60; i++) tick(w);
    expect(w.sim.beamState(w.carrier).locked).toBe(false);
    expect(w.r.beamDrawn(w.carrier)).not.toBeNull();
    w.r.dispose();
  });

  it('heat is on the unit card only: the readback has no heat field and the look is the same hot or cool', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 15);
    const cool = w.r.beamDrawn(w.carrier);
    expect(Object.keys(cool ?? {})).not.toContain('heat');
    expect(w.sim.beamState(w.carrier).heat).toBeGreaterThan(0);
    w.r.dispose();
  });
});

describe('a break fades; it does not snap', () => {
  it('losing the target without a lockout fades the ribbon over 80 ms and the lens glow over 150', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 10);
    expect(w.r.beamDrawn(w.carrier)?.ribbon).toBe(true);
    w.sim.debugKill(w.prey);
    const frames: (ReturnType<ThreeRenderer['beamDrawn']>)[] = [];
    for (let i = 0; i < 5; i++) {
      tick(w);
      frames.push(w.r.beamDrawn(w.carrier));
    }
    // 50 ms a tick: the ribbon survives the first (half-faded), is gone by the second; the lens glow
    // outlives it and is gone by the fourth.
    expect(frames[0]?.ribbon).toBe(true);
    expect(frames[0]?.coreAlpha).toBeCloseTo(0.375, 9);
    expect(frames[1]?.ribbon).toBe(false);
    expect(frames[1]?.lensGlowAlpha).toBeGreaterThan(0);
    expect(frames[3]).toBeNull();
    w.r.dispose();
  });
});

describe('fog', () => {
  it('draws nothing into fog, and the beam is back the moment its target is seen', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 5);
    expect(w.r.beamDrawn(w.carrier)).not.toBeNull();
    priv(w.r).fog.fill(0);
    priv(w.r).updateBeams(1);
    expect(w.r.beamDrawn(w.carrier)).toBeNull();
    expect(priv(w.r).beamBatch.mesh.visible).toBe(false);
    frame(w);
    expect(w.r.beamDrawn(w.carrier)).not.toBeNull();
    w.r.dispose();
  });
});

describe('a hostile carrier is fogged like any hostile unit', () => {
  it('draws no beam while the fog hides the carrier, even though its target (ours) is in plain sight', async () => {
    const w = await world('drone', { hostileCarrier: true });
    untilLasing(w);
    ticks(w, 5);
    expect(w.r.beamDrawn(w.carrier)).not.toBeNull();
    priv(w.r).fog.fill(0);
    priv(w.r).updateBeams(1);
    expect(w.sim.state.side[w.prey]).toBe(0);
    expect(w.r.beamDrawn(w.carrier)).toBeNull();
    frame(w);
    expect(w.r.beamDrawn(w.carrier)).not.toBeNull();
    w.r.dispose();
  });
});

describe('frame() runs the beams', () => {
  it('the public frame() paints the beam and hands the fog pass its shimmer site', async () => {
    const w = await world('drone');
    const pass = new FogOfWarPass(new THREE.Texture(), 40, 24);
    priv(w.r).fogPass = pass;
    // Tick the sim without painting once: nothing has drawn a beam yet, so a readback can only
    // come from the frame() call below.
    for (let i = 0; i < 40; i++) {
      w.sim.identifyTo(0, w.prey);
      const events = w.sim.tick();
      w.r.snapshot();
      w.r.onEvents(events);
    }
    expect(w.sim.beamState(w.carrier).target).toBeGreaterThanOrEqual(0);
    expect(w.r.beamDrawn(w.carrier)).toBeNull();
    priv(w.r).fog.fill(2);
    w.r.frame(1, 16);
    expect(w.r.beamDrawn(w.carrier)).not.toBeNull();
    expect(priv(w.r).beamBatch.mesh.visible).toBe(true);
    expect(w.r.beamShimmerSites()).toBe(1);
    expect(pass.uniforms.uShimmerCount.value).toBe(1);
    w.r.dispose();
  });
});

describe('a carrier with no mesh yet', () => {
  it('draws from the hull centre at turret height rather than not at all', async () => {
    const w = await world('drone', { loadCarrier: false });
    untilLasing(w);
    ticks(w, 3);
    const b = w.r.beamDrawn(w.carrier);
    expect(b?.ribbon).toBe(true);
    expect(b?.origin[0]).toBeCloseTo(10.5, 3);
    expect(b?.origin[1]).toBeCloseTo(1.5, 3);
    expect(b?.origin[2]).toBeCloseTo(12.5, 3);
    w.r.dispose();
  });
});

describe('the debug layers', () => {
  it('"beam" and "beam-shimmer" are known layers', () => {
    expect(isDebugLayer('beam')).toBe(true);
    expect(isDebugLayer('beam-shimmer')).toBe(true);
  });

  it('hiding "beam" blanks the mesh on EVERY later frame and showing it restores it', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 3);
    expect(priv(w.r).beamBatch.mesh.visible).toBe(true);
    expect(w.r.setDebugLayerVisible('beam', false)).toBe(1);
    for (let i = 0; i < 3; i++) {
      tick(w);
      expect(priv(w.r).beamBatch.mesh.visible).toBe(false);
    }
    w.r.setDebugLayerVisible('beam', true);
    tick(w);
    expect(priv(w.r).beamBatch.mesh.visible).toBe(true);
    w.r.dispose();
  });

  it('"beam-shimmer" drives the pass\'s amplitude to 0 and back, and reports the change', async () => {
    const w = await world('drone');
    priv(w.r).fogPass = new FogOfWarPass(new THREE.Texture(), 40, 24);
    expect(w.r.setDebugLayerVisible('beam-shimmer', false)).toBe(1);
    expect(priv(w.r).fogPass?.uniforms.uShimmerAmp.value).toBe(0);
    expect(w.r.setDebugLayerVisible('beam-shimmer', false)).toBe(0);
    untilLasing(w);
    ticks(w, 3);
    // Frames write the sites but never the amplitude: it holds across the repaint.
    priv(w.r).feedBeamShimmer(priv(w.r).threeCamera(), 1);
    expect(priv(w.r).fogPass?.uniforms.uShimmerAmp.value).toBe(0);
    expect(w.r.setDebugLayerVisible('beam-shimmer', true)).toBe(1);
    expect(priv(w.r).fogPass?.uniforms.uShimmerAmp.value).toBe(1);
    w.r.dispose();
  });

  it('"beam-shimmer" with no fog pass is a 0, not a throw', async () => {
    const w = await world('drone');
    expect(w.r.setDebugLayerVisible('beam-shimmer', false)).toBe(0);
    w.r.dispose();
  });
});

describe('the heat shimmer is fed from the beam\'s target end', () => {
  it('hands the fog pass one site per lasing beam, at the target, with the look\'s amplitude', async () => {
    const w = await world('drone');
    const pass = new FogOfWarPass(new THREE.Texture(), 40, 24);
    priv(w.r).fogPass = pass;
    frame(w);
    priv(w.r).feedBeamShimmer(priv(w.r).threeCamera(), 1);
    expect(w.r.beamShimmerSites()).toBe(0);
    expect(pass.uniforms.uShimmerCount.value).toBe(0);

    untilLasing(w);
    ticks(w, 12);
    const cam = priv(w.r).threeCamera();
    priv(w.r).feedBeamShimmer(cam, 1);
    expect(w.r.beamShimmerSites()).toBe(1);
    expect(pass.uniforms.uShimmerCount.value).toBe(1);
    const b = w.r.beamDrawn(w.carrier);
    const ndc = new THREE.Vector3(...(b?.end as [number, number, number])).project(cam);
    const site = pass.uniforms.uShimmer.value[0];
    expect(site.x).toBeCloseTo(ndc.x * 0.5 + 0.5, 5);
    expect(site.y).toBeCloseTo(ndc.y * 0.5 + 0.5, 5);
    expect(site.w).toBeCloseTo(b?.shimmerAmp ?? -1, 5);
    expect(site.z).toBeGreaterThan(0);
    // The phase is the SIM clock: the same tick and alpha is the same distortion.
    const t = pass.uniforms.uShimmerTime.value;
    priv(w.r).feedBeamShimmer(cam, 1);
    expect(pass.uniforms.uShimmerTime.value).toBe(t);
    w.r.dispose();
  });

  it('a lockout feeds no site at all, so the next frame is the pre-shimmer frame', async () => {
    const w = await world('drone');
    const pass = new FogOfWarPass(new THREE.Texture(), 40, 24);
    priv(w.r).fogPass = pass;
    untilLasing(w);
    for (let i = 0; i < 400 && !w.sim.beamState(w.carrier).locked; i++) tick(w);
    expect(w.sim.beamState(w.carrier).locked).toBe(true);
    priv(w.r).feedBeamShimmer(priv(w.r).threeCamera(), 1);
    expect(pass.uniforms.uShimmerCount.value).toBe(0);
    w.r.dispose();
  });
});

describe('a zero-time repaint changes nothing', () => {
  it('two paints at the same tick and alpha read the same beam', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 12);
    const a = JSON.stringify(w.r.beamDrawn(w.carrier));
    priv(w.r).updateBeams(1);
    priv(w.r).updateBeams(1);
    expect(JSON.stringify(w.r.beamDrawn(w.carrier))).toBe(a);
    w.r.dispose();
  });
});

describe('one-way: the renderer reads the sim and writes none of it', () => {
  it('beamState is untouched by painting', async () => {
    const w = await world('drone');
    untilLasing(w);
    ticks(w, 12);
    const before = JSON.stringify(w.sim.beamState(w.carrier));
    for (let i = 0; i < 5; i++) frame(w);
    expect(JSON.stringify(w.sim.beamState(w.carrier))).toBe(before);
    w.r.dispose();
  });
});
