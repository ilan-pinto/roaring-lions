/**
 * E6 (GH-274) chunk B: the swarm's instanced draw, pinned where `ThreeRenderer` wires it.
 *
 * `units/swarm-batch.test.ts` proves the batch against the shipped GLB; this asks the only
 * question that puts a swarm on screen: does the RENDERER call it, with the sim's live count,
 * on the right events, and keep the vehicle path and the kill blast out of it.
 *
 * Harness and `vi.mock` stand-in from `ThreeRenderer.blast.test.ts` (read its top comment for why
 * a real `WebGLRenderer` cannot construct here, and for the `loadVehicleMeshTemplate` mock: the
 * fetch is replaced and everything after it - the real `loadVehicleMesh`, the real batch build -
 * is the shipped code). The unit JSON is the SHIPPED `drone_swarm.json`, the emitters the shipped
 * files, the mesh the shipped GLB.
 *
 * Every assertion was verified by mutating the line it pins and watching it go red; the list is
 * in the commit message.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { trackKindFor } from './vehicle-tracks';
import { isDebugLayer } from './debug-layers';
import { parseGlbHeadless } from './units/headless-gltf';
import { buildVehicleMeshTemplate } from './units/mesh-vehicle';
import type { SwarmBatch } from './units/swarm-batch';
import type { EmitterSpec, ParticleSpec } from '../vfx/emitters';
import swarmJson from '../../../../data/units/enemy/drone_swarm.json';
import catastrophicJson from '../../../../data/vfx/catastrophic_kill.json';
import fireHeatJson from '../../../../data/vfx/fire_heat.json';
import missileImpactJson from '../../../../data/vfx/missile_impact.json';
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

// The destroyed-guard test below needs the drone to LOOK like a ground vehicle to the kill rule: with
// the shipped table it is not one, so removing the `swarm === null` guard changed nothing and the
// test could not fail. Only this id is touched; the real table answers for every other.
vi.mock('./vehicle-tracks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./vehicle-tracks')>();
  return { ...actual, trackKindFor: (id: string) => (id === 'drone_swarm' ? ('single' as const) : actual.trackKindFor(id)) };
});

const loaded = vi.hoisted(() => ({ template: null as unknown }));
vi.mock('./units/mesh-vehicle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-vehicle')>();
  return { ...actual, loadVehicleMeshTemplate: async () => loaded.template };
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

function makeOpts(room: Pick<RendererOptions, 'viewerSide' | 'versus'> = {}): RendererOptions {
  return {
    ...room,
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

const GLB = fileURLToPath(new URL('../../../../art/meshes/vehicles/drone_swarm.glb', import.meta.url));
const SWARM = swarmJson as unknown as UnitTypeJson;
/** The dive's victim: soft, tough, harmless, a tile from the cloud. */
const MAN: UnitTypeJson = {
  id: 'man', role: 'infantry', hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 }, sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};
/** A hard hull: the control that DOES throw the kill blast. */
const HARD: UnitTypeJson = {
  id: 'mbt_lavi', role: 'tank', hull: { hp: 3000, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false }, sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};

const EMITTERS = [catastrophicJson, fireHeatJson, missileImpactJson, swarmDownJson] as unknown as EmitterSpec[];

interface Privates {
  swarmBatches: Map<string, SwarmBatch>;
  vehicleMeshTemplates: Map<string, unknown>;
  vehicleMeshEntities: Map<number, unknown>;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  updateSwarms(alpha: number, dtMs: number): void;
  fog: Uint8Array;
  hitStop: { remainingMs: number };
  flashLights: { liveCount: number };
  missileFx: { missiles: unknown[] };
  particleSystem: { spawn(spec: ParticleSpec, ...rest: unknown[]): void } | null;
  syncSwarmBatch(id: string, t: unknown): void;
  swarmBatchList: SwarmBatch[];
  fireLinkPulses: { target: number; bornS: number }[];
  fireLinkFlashes: { target: number; startS: number }[];
  fireLinkClockS: number;
  lastShotSimS: Float64Array;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

async function world(room: Pick<RendererOptions, 'viewerSide' | 'versus'> = {}, swarmSide: 0 | 1 = 1) {
  const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 16 });
  const sw = sim.addUnitType(SWARM);
  const man = sim.addUnitType(MAN);
  const hard = sim.addUnitType(HARD);
  const swarm = sim.spawn(sw, swarmSide, fx.from(9.5), fx.from(8.5));
  const victim = sim.spawn(man, 1 - swarmSide, fx.from(10.5), fx.from(8.5));
  const tank = sim.spawn(hard, 1, fx.from(20.5), fx.from(20.5));
  const r = new ThreeRenderer(sim, makeOpts(room));
  const owner = new Map<ParticleSpec, string>();
  r.useEmitters(EMITTERS, (k) => (k.startsWith('#') ? k : '#E6D8BE'));
  for (const em of EMITTERS) for (const l of em.particles) owner.set(l, em.id);
  const ps = priv(r).particleSystem;
  if (ps === null) throw new Error('fixture: useEmitters built no ParticleSystem');
  const log: string[] = [];
  const real = ps.spawn.bind(ps);
  ps.spawn = (spec: ParticleSpec, ...rest: unknown[]): void => {
    log.push(owner.get(spec) ?? 'flat');
    real(spec, ...rest);
  };
  loaded.template = buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(GLB)), 'drone_swarm');
  await r.loadVehicleMesh('drone_swarm', 'drone_swarm.glb');
  r.snapshot();
  r.snapshot();
  // Fog is not what is under test: the viewer sees the whole map.
  priv(r).fog.fill(2);
  return { sim, r, swarm, victim, tank, log, swarmSide };
}

/** One presented frame, with the fog held open (a `snapshot` may recompute it). */
function frame(r: ThreeRenderer, alpha = 1, dtMs = 16): void {
  priv(r).fog.fill(2);
  priv(r).updateSwarms(alpha, dtMs);
}

function setLive(sim: Sim, id: number, live: number): void {
  sim.state.hp[id] = fx.from(15 * live);
}

describe('loading a swarm type', () => {
  it('builds the batch from the template, and the entity gets NO per-entity clone', async () => {
    const { r, swarm } = await world();
    expect(priv(r).swarmBatches.has('drone_swarm')).toBe(true);
    expect(priv(r).vehicleMeshTemplates.has('drone_swarm')).toBe(true);
    priv(r).updateVehicleMeshes(1, 16);
    expect(priv(r).vehicleMeshEntities.has(swarm)).toBe(false);
    expect(priv(r).vehicleMeshEntities.size).toBe(0);
    r.dispose();
  });

  it('refuses the whole load, naming the file, when the GLB lacks the swarm extras', async () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 4 });
    sim.addUnitType(SWARM);
    const r = new ThreeRenderer(sim, makeOpts());
    const t = buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(GLB)), 'drone_swarm');
    delete (t.root.userData as Record<string, unknown>).rl_rotors;
    loaded.template = t;
    await expect(r.loadVehicleMesh('drone_swarm', 'drone_swarm.glb')).rejects.toThrow(/rl_rotors/);
    expect(priv(r).vehicleMeshTemplates.has('drone_swarm')).toBe(false);
    expect(priv(r).swarmBatches.size).toBe(0);
    r.dispose();
  });

  it('a type that is not a swarm builds no batch', async () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 4 });
    sim.addUnitType(HARD);
    const r = new ThreeRenderer(sim, makeOpts());
    priv(r).syncSwarmBatch('mbt_lavi', loaded.template);
    expect(priv(r).swarmBatches.size).toBe(0);
    r.dispose();
  });
});

describe('the drawn members follow the sim\'s live count', () => {
  it('swarmDrawn(id) equals sim.swarmMembers(id) at every rung from 12 to 1', async () => {
    const { sim, r, swarm } = await world();
    frame(r);
    expect(r.swarmDrawn(swarm)).toBe(12);
    for (const live of [12, 11, 9, 6, 4, 2, 1]) {
      setLive(sim, swarm, live);
      frame(r);
      expect(sim.swarmMembers(swarm)).toBe(live);
      expect(r.swarmDrawn(swarm), `live ${live}`).toBe(live);
    }
    r.dispose();
  });

  it('a hit that wears a member down but removes none changes nothing (live = ceil)', async () => {
    const { sim, r, swarm } = await world();
    frame(r);
    sim.state.hp[swarm] = fx.from(15 * 11 + 1); // 11 members and 1 hp: still 12 alive
    frame(r);
    expect(sim.swarmMembers(swarm)).toBe(12);
    expect(r.swarmDrawn(swarm)).toBe(12);
    r.dispose();
  });

  it('a swarm is not a number to anything but a swarm: swarmDrawn is 0 for a tank and for nothing', async () => {
    const { r, tank } = await world();
    frame(r);
    expect(r.swarmDrawn(tank)).toBe(0);
    expect(r.swarmDrawn(999)).toBe(0);
    r.dispose();
  });

  it('draws nothing for a swarm the fog hides, and everything the moment it is seen', async () => {
    const { sim, r, swarm } = await world();
    priv(r).fog.fill(0);
    priv(r).updateSwarms(1, 16);
    expect(r.swarmDrawn(swarm)).toBe(0);
    expect(priv(r).swarmBatches.get('drone_swarm')?.bodies.visible).toBe(false);
    frame(r);
    expect(r.swarmDrawn(swarm)).toBe(sim.swarmMembers(swarm));
    r.dispose();
  });

  it('exposes slot live-1 for the beam, and it is the member that falls when the live count drops', async () => {
    const { sim, r, swarm, log } = await world();
    frame(r);
    const at = new THREE.Vector3();
    expect(r.swarmMemberWorldPosition(swarm, 11, at)).toBe(true);
    setLive(sim, swarm, 11);
    frame(r);
    expect(r.swarmMemberWorldPosition(swarm, 11, new THREE.Vector3())).toBe(false);
    expect(r.swarmMemberWorldPosition(swarm, 10, new THREE.Vector3())).toBe(true);
    expect(log).toContain('swarm_member_down');
    r.dispose();
  });
});

describe('a catch-up (setQuiet) tumbles nothing, through the PUBLIC frame()', () => {
  /** `main.ts`'s order exactly: `setQuiet(true)`, `onEvents`, `setQuiet(false)`, THEN the frame paints. */
  function catchUp(r: ThreeRenderer, quiet: boolean): void {
    r.setQuiet(quiet);
    r.onEvents([]);
    r.setQuiet(false);
  }

  it('the first frame after a quiet tick lets the lost members vanish: no exit, no wreck, no burst', async () => {
    const { sim, r, swarm, log } = await world();
    priv(r).fog.fill(2);
    r.frame(1, 16);
    expect(r.swarmDrawn(swarm)).toBe(12);
    setLive(sim, swarm, 6);
    catchUp(r, true);
    priv(r).fog.fill(2);
    r.frame(1, 16);
    const batch = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    expect(r.swarmDrawn(swarm)).toBe(6);
    expect(batch.exitsInFlight).toBe(0);
    expect(log).not.toContain('swarm_member_down');
    // The latch is spent by that one frame: the next real loss tumbles as ever.
    setLive(sim, swarm, 5);
    priv(r).fog.fill(2);
    r.frame(1, 16);
    expect(batch.exitsInFlight).toBe(1);
    expect(log).toContain('swarm_member_down');
    r.dispose();
  });

  it('...while the very same loss with no quiet tick tumbles all six (the control)', async () => {
    const { sim, r, swarm, log } = await world();
    priv(r).fog.fill(2);
    r.frame(1, 16);
    setLive(sim, swarm, 6);
    catchUp(r, false);
    priv(r).fog.fill(2);
    r.frame(1, 16);
    const batch = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    expect(batch.exitsInFlight).toBe(6);
    expect(log).toContain('swarm_member_down'); // the quiet case above asserts none
    r.dispose();
  });
});

describe('a swarm frame reuses its scratch', () => {
  it('hands the batch the SAME env object, with the same bound methods, on every frame', async () => {
    const { r } = await world();
    const batch = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    const seen: { env: unknown; groundAt: unknown; drawnAt: unknown }[] = [];
    const real = batch.beginFrame.bind(batch);
    batch.beginFrame = (env): void => {
      seen.push({ env, groundAt: env.groundAt, drawnAt: env.drawnAt });
      real(env);
    };
    for (let i = 0; i < 4; i++) frame(r);
    expect(seen).toHaveLength(4);
    for (const f of seen.slice(1)) {
      expect(f.env).toBe(seen[0].env);
      expect(f.groundAt).toBe(seen[0].groundAt);
      expect(f.drawnAt).toBe(seen[0].drawnAt);
    }
    r.dispose();
  });
});

describe('a swarm the seat cannot see throws no down burst (the versus leak rule)', () => {
  it('a hidden hostile swarm that loses a member throws no swarm_member_down, and the member still falls', async () => {
    const { sim, r, swarm, log } = await world({ versus: true, viewerSide: 0 });
    priv(r).fog.fill(2);
    priv(r).updateSwarms(1, 16);
    priv(r).fog.fill(0);
    setLive(sim, swarm, 11);
    priv(r).updateSwarms(1, 16);
    expect(log).not.toContain('swarm_member_down');
    expect((priv(r).swarmBatches.get('drone_swarm') as SwarmBatch).exitsInFlight).toBe(1);
    r.dispose();
  });

  it('...and the same loss in sight throws it (the control)', async () => {
    const { sim, r, swarm, log } = await world({ versus: true, viewerSide: 0 });
    priv(r).fog.fill(2);
    priv(r).updateSwarms(1, 16);
    setLive(sim, swarm, 11);
    priv(r).updateSwarms(1, 16);
    expect(log).toContain('swarm_member_down');
    r.dispose();
  });
});

describe('reloading a swarm type', () => {
  it('a reload whose GLB fails leaves the type its old batch, in the scene, still drawing', async () => {
    const { r, swarm } = await world();
    const before = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    const t = buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(GLB)), 'drone_swarm');
    delete (t.root.userData as Record<string, unknown>).rl_rotors;
    expect(() => priv(r).syncSwarmBatch('drone_swarm', t)).toThrow(/rl_rotors/);
    expect(priv(r).swarmBatches.get('drone_swarm')).toBe(before);
    expect(priv(r).swarmBatchList).toEqual([before]);
    frame(r);
    expect(r.swarmDrawn(swarm)).toBe(12);
    r.dispose();
  });

  it('a good reload swaps the batch, disposes the old one and keeps the list in step', async () => {
    const { r } = await world();
    const before = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    const t = buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(GLB)), 'drone_swarm');
    priv(r).syncSwarmBatch('drone_swarm', t);
    const after = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    expect(after).not.toBe(before);
    expect(priv(r).swarmBatchList).toEqual([after]);
    expect(before.bodies.parent).toBeNull();
    expect(after.bodies.parent).not.toBeNull();
    r.dispose();
  });
});

describe('the debug layers are flags the per-frame path consults', () => {
  it('"swarm" and "swarm-wrecks" are known layers', () => {
    expect(isDebugLayer('swarm')).toBe(true);
    expect(isDebugLayer('swarm-wrecks')).toBe(true);
  });

  it('hiding "swarm" blanks the draw on EVERY later frame, and showing it restores it', async () => {
    const { r, swarm } = await world();
    frame(r);
    expect(r.setDebugLayerVisible('swarm', false)).toBe(2);
    for (let i = 0; i < 3; i++) {
      frame(r);
      expect(r.swarmDrawn(swarm)).toBe(0);
      expect(priv(r).swarmBatches.get('drone_swarm')?.bodies.count).toBe(0);
    }
    r.setDebugLayerVisible('swarm', true);
    frame(r);
    expect(r.swarmDrawn(swarm)).toBe(12);
    r.dispose();
  });

  it('the existing "units" layer hides the swarm bodies too, across frames', async () => {
    const { r, swarm } = await world();
    frame(r);
    r.setDebugLayerVisible('units', false);
    frame(r);
    frame(r);
    expect(r.swarmDrawn(swarm)).toBe(0);
    r.setDebugLayerVisible('units', true);
    frame(r);
    expect(r.swarmDrawn(swarm)).toBe(12);
    r.dispose();
  });

  it('"swarm-wrecks" hides the wreck batch across frames and leaves the bodies', async () => {
    const { sim, r, swarm } = await world();
    frame(r);
    setLive(sim, swarm, 11);
    frame(r);
    for (let i = 0; i < 60; i++) frame(r, 1, 16); // 0.96 s: the tumble ends
    const batch = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    expect(batch.wrecks?.visible).toBe(true);
    expect(r.setDebugLayerVisible('swarm-wrecks', false)).toBe(1);
    frame(r);
    frame(r);
    expect(batch.wrecks?.visible).toBe(false);
    expect(r.swarmDrawn(swarm)).toBe(11);
    r.setDebugLayerVisible('swarm-wrecks', true);
    frame(r);
    expect(batch.wrecks?.visible).toBe(true);
    r.dispose();
  });
});

describe('shot down members leave wrecks; the entity\'s death fires no kill blast', () => {
  it('members shot down tumble for 0.6 s and then lie on the ground', async () => {
    const { sim, r, swarm } = await world();
    frame(r);
    setLive(sim, swarm, 9);
    frame(r, 1, 16);
    const batch = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    expect(batch.exitsInFlight).toBe(3);
    expect(batch.wreckCount).toBe(0);
    for (let i = 0; i < 50; i++) frame(r, 1, 16);
    expect(batch.exitsInFlight).toBe(0);
    expect(batch.wreckCount).toBe(3);
    r.dispose();
  });

  it('the swarm\'s destroyed event throws no catastrophic_kill hit-stop, light or burst', async () => {
    // The precondition that makes this bite: the kill rule would otherwise admit the drone.
    expect(trackKindFor('drone_swarm')).not.toBeNull();
    const { sim, r, swarm, log } = await world();
    frame(r);
    sim.state.alive[swarm] = 0;
    r.onEvents([{ kind: 'destroyed', tick: 5, entity: swarm, by: 0 } as SimEvent]);
    expect(priv(r).hitStop.remainingMs).toBe(0);
    expect(priv(r).flashLights.liveCount).toBe(0);
    expect(log.filter((k) => k === 'catastrophic_kill')).toEqual([]);
    r.dispose();
  });

  it('...while a tank\'s identical event DOES (the control: the gate is the swarm, not the harness)', async () => {
    const { sim, r, tank } = await world();
    sim.state.alive[tank] = 0;
    r.onEvents([{ kind: 'destroyed', tick: 5, entity: tank, by: 0 } as SimEvent]);
    expect(priv(r).hitStop.remainingMs).toBeGreaterThan(0);
    r.dispose();
  });

  it('the last members of a swarm that dies still exit: all twelve fall, then the entity is forgotten', async () => {
    const { sim, r, swarm } = await world();
    frame(r);
    sim.state.hp[swarm] = 0;
    sim.state.alive[swarm] = 0;
    frame(r, 1, 16);
    const batch = priv(r).swarmBatches.get('drone_swarm') as SwarmBatch;
    expect(batch.exitsInFlight).toBe(12);
    expect(batch.has(swarm)).toBe(false);
    for (let i = 0; i < 50; i++) frame(r, 1, 16);
    expect(batch.wreckCount).toBe(12);
    r.dispose();
  });
});

describe('the dive', () => {
  /** `main.ts`'s `runTick`, without audio or missions: tick, snapshot, deliver events. */
  function stepWorld(w: Awaited<ReturnType<typeof world>>): SimEvent[] {
    w.sim.identifyTo(w.swarmSide, w.victim);
    const events = w.sim.tick();
    w.r.snapshot();
    w.r.onEvents(events);
    return events;
  }

  it('a dive is one member riding to the impact: no missile round, no muzzle flash, no tumble', async () => {
    const w = await world();
    const batch = priv(w.r).swarmBatches.get('drone_swarm') as SwarmBatch;
    frame(w.r); // the cloud is seen at full strength before the first dive, as in play
    let dived = false;
    for (let i = 0; i < 400 && !dived; i++) {
      const events = stepWorld(w);
      dived = events.some((e) => e.kind === 'fire' && e.shooter === w.swarm);
      if (dived) {
        // Before the frame that draws it: the round is filed, and nothing was launched or flashed.
        expect(priv(w.r).missileFx.missiles).toHaveLength(0);
        expect(w.log).not.toContain('fire_heat');
        frame(w.r, 1, 16);
        expect(batch.exitsInFlight).toBe(1);
        expect(batch.wreckCount).toBe(0);
        expect(w.log).not.toContain('swarm_member_down');
        expect(w.r.swarmDrawn(w.swarm)).toBe(w.sim.swarmMembers(w.swarm));
        expect(w.sim.swarmMembers(w.swarm)).toBe(11);
      }
    }
    expect(dived).toBe(true);
    w.r.dispose();
  });

  it('is still a SHOT: the fire link pulses on the target, its hit flash waits for the diver, and the shot is stamped', async () => {
    // Only the muzzle and the round are the dive's to skip. An own, selected swarm fires at an enemy.
    const w = await world({}, 0);
    w.r.selection = [w.swarm];
    frame(w.r);
    // Until a shot that HITS: a miss files no hit flash, and an assertion must not hang on one.
    let hit: SimEvent | undefined;
    for (let i = 0; i < 3000 && hit === undefined; i++) {
      hit = stepWorld(w).find((e) => e.kind === 'fire' && e.shooter === w.swarm && e.willHit);
    }
    expect(hit).toBeDefined();
    expect(priv(w.r).lastShotSimS[w.swarm]).toBeGreaterThan(-Infinity);
    const pulses = priv(w.r).fireLinkPulses.filter((p) => p.target === w.victim);
    expect(pulses.length).toBeGreaterThan(0);
    // The hit flash lands with the diver, not on the frame it left (a dive is whole ticks long).
    const flash = priv(w.r).fireLinkFlashes.find((f) => f.target === w.victim);
    expect(flash).toBeDefined();
    expect(flash?.startS).toBeGreaterThan(priv(w.r).fireLinkClockS);
    // ...and still no muzzle flash, no round.
    expect(w.log).not.toContain('fire_heat');
    expect(priv(w.r).missileFx.missiles).toHaveLength(0);
    w.r.dispose();
  });

  it('lands missile_impact where the dive ends, once, and leaves no wreck', async () => {
    const w = await world();
    const batch = priv(w.r).swarmBatches.get('drone_swarm') as SwarmBatch;
    frame(w.r);
    for (let i = 0; i < 400; i++) {
      const events = stepWorld(w);
      if (events.some((e) => e.kind === 'fire' && e.shooter === w.swarm)) break;
    }
    expect(w.log).not.toContain('missile_impact');
    // Frames until the flight and the sim's own resolution are both over.
    for (let i = 0; i < 6; i++) {
      stepWorld(w);
      frame(w.r, 1, 16);
    }
    for (let i = 0; i < 20; i++) frame(w.r, 1, 16);
    expect(w.log).toContain('missile_impact');
    expect(batch.exitsInFlight).toBe(0);
    expect(batch.wreckCount).toBe(0);
    w.r.dispose();
  });
});

describe('picking a cloud', () => {
  it('a click anywhere in the cloud picks the swarm, even at the tight order radius', async () => {
    const { r, swarm } = await world();
    // 0.7 tile from the swarm's centre, 1.2 from the victim: past 0.5, inside the cloud's 0.75.
    expect(r.pickUnit(9.5, 9.2, 0.5)).toBe(swarm);
    r.dispose();
  });

  it('...but not past the cloud\'s edge', async () => {
    const { r } = await world();
    expect(r.pickUnit(9.5, 9.4, 0.5)).toBe(-1);
    r.dispose();
  });

  it('a unit that is not a swarm keeps exactly the radius it was asked', async () => {
    const { r, victim } = await world();
    expect(r.pickUnit(10.5, 9.1, 0.5)).toBe(-1);
    expect(r.pickUnit(10.5, 8.8, 0.5)).toBe(victim);
    r.dispose();
  });
});
