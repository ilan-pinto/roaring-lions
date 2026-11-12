/**
 * GH-1223 slice 1: the ragdolls wired into the REAL renderer (WebGLRenderer stubbed, no GL), on the shipped
 * `inf_squad` GLB and the real Rapier: a killed squad is claimed, handed over at its death tick + 200 ms of SIM time,
 * stepped on the sim clock, and filed as a corpse; the corpse's bones are bit-identical whatever the frame cadence;
 * and the sim's own hash, tick by tick, is the same with the ragdolls on and off (invariant 4).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FS_AIR_STRIKE, FS_MORTAR_BARRAGE, Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';
import { parseGlbHeadless } from './units/headless-gltf';
import { buildMeshUnitTemplate, type MeshUnitEntity, type MeshUnitTemplate } from './units/mesh-unit';
import type { DyingMeshUnit, MeshWreck } from './units/mesh-death';
import { loadRapier } from './physics/rapier';

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

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};

function makeOpts(quality: RenderQuality): RendererOptions {
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
    quality,
  };
}

const SQUAD: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

interface Priv {
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  meshDying: DyingMeshUnit[];
  meshWrecks: MeshWreck[];
  cssWidth: number;
  cssHeight: number;
  ragdolls: { incidents: number; ready: boolean };
}

const ON: RenderQuality = { ...QUALITY_PRESETS.high, physics: { ragdolls: 16 } };
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
let template: MeshUnitTemplate;
beforeAll(async () => {
  template = buildMeshUnitTemplate(await parseGlbHeadless(readFileSync(`${REPO}art/meshes/inf_squad.glb`)), 'kdf', 'inf_squad.glb');
  await loadRapier();
}, 60_000);

/** A 20 x 20 world: two squads, one killed at tick 3 by the other (`debugKill` plus a hand-made killer). */
async function world(quality: RenderQuality) {
  const sim = new Sim({ seed: 7, width: 20, height: 20, capacity: 4 });
  const t = sim.addUnitType(SQUAD);
  const victim = sim.spawn(t, 0, fx.from(10.5), fx.from(10.5));
  const other = sim.spawn(t, 1, fx.from(14.5), fx.from(9.5));
  const r = new ThreeRenderer(sim, makeOpts(quality));
  const p = r as unknown as Priv;
  p.meshUnitTemplates.set(SQUAD.id, [template]);
  p.cssWidth = 1400;
  p.cssHeight = 900;
  r.camera.x = 10.5;
  r.camera.y = 10.5;
  // The loader's promise has resolved; let the system's `then` run.
  await new Promise((res) => setTimeout(res, 0));
  r.snapshot();
  r.snapshot();
  r.frame(1, 16);
  return { sim, r, p, victim, other };
}

/** Steps the sim one tick and draws `frames` frames across it (alphas evenly up to 1). Returns the hash. */
function tick(sim: Sim, r: ThreeRenderer, frames: number): number {
  const ev = sim.tick();
  r.snapshot();
  r.onEvents(ev);
  for (let k = 1; k <= frames; k++) r.frame(k / frames, 50 / frames);
  return sim.hash();
}

function boneDigest(root: THREE.Object3D): string {
  root.updateMatrixWorld(true);
  const xs: number[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) xs.push(...o.matrixWorld.elements);
  });
  const bytes = new Uint8Array(new Float64Array(xs).buffer);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h >>> 0).toString(16);
}

/** Kills the victim at tick 3 and runs to tick 140 (7 s), `frames` frames a tick. */
async function killAndSettle(quality: RenderQuality, frames: number) {
  const w = await world(quality);
  const hashes: number[] = [];
  for (let i = 0; i < 2; i++) hashes.push(tick(w.sim, w.r, frames));
  w.sim.debugKill(w.victim);
  const log: { tick: number; dying: number; incidents: number }[] = [];
  for (let i = 0; i < 137; i++) {
    hashes.push(tick(w.sim, w.r, frames));
    log.push({ tick: w.sim.tickCount, dying: w.p.meshDying.length, incidents: w.p.ragdolls.incidents });
  }
  return { ...w, hashes, log };
}

describe('a killed squad becomes a ragdoll, on the sim clock', () => {
  it('claimed at the death, taken over at death tick + 200 ms, frozen into a corpse', async () => {
    const { p, log, r } = await killAndSettle(ON, 1);
    // `debugKill` at tick 2: the `destroyed` event's tick, the clock the ragdoll starts from.
    const deathTick = 2;
    // Claimed on the death frame, still the death sequence's until the handoff tick (death + 4 ticks = 200 ms).
    const at = (t: number) => log.find((l) => l.tick === t)!;
    expect(at(deathTick + 1).incidents).toBe(1);
    expect(at(deathTick + 1).dying).toBe(1);
    expect(at(deathTick + 3).dying).toBe(1);
    expect(at(deathTick + 4).dying).toBe(0);
    expect(at(deathTick + 4).incidents).toBe(1);
    // Frozen within 240 steps (80 ticks) of the handoff: a corpse, the incident gone.
    expect(at(deathTick + 4 + 81).incidents).toBe(0);
    expect(p.meshWrecks).toHaveLength(1);
    r.dispose();
  });

  it('the corpse is bit-identical whatever the frame cadence (1 or 3 frames a tick)', async () => {
    const a = await killAndSettle(ON, 1);
    const b = await killAndSettle(ON, 3);
    expect(boneDigest(b.p.meshWrecks[0].root)).toBe(boneDigest(a.p.meshWrecks[0].root));
    a.r.dispose();
    b.r.dispose();
  });

  it('the sim never notices: its hash, tick by tick, is the same with the ragdolls on and off', async () => {
    const on = await killAndSettle(ON, 1);
    const off = await killAndSettle(QUALITY_PRESETS.high, 1);
    expect(on.p.meshWrecks).toHaveLength(1);
    expect(off.p.ragdolls.ready).toBe(false);
    expect(on.hashes).toEqual(off.hashes);
    on.r.dispose();
    off.r.dispose();
  });

  /** The push the victim's ragdoll takes when `other` did `prior` (real events through `onEvents`) and then killed it. */
  type Ctx = { victim: number; other: number; tick: number };
  /** `withKill` events ride in the SAME batch as the kill, after its `destroyed` (the sim's order for a charge). */
  const pushAfter = async (prior: (c: Ctx) => SimEvent[], catchUp = false, withKill: (c: Ctx) => SimEvent[] = () => []) => {
    const w = await world(ON);
    const claim = vi.spyOn((w.p as unknown as { ragdolls: { claim(d: { push?: unknown }): boolean } }).ragdolls, 'claim');
    tick(w.sim, w.r, 1);
    const evs = prior({ victim: w.victim, other: w.other, tick: w.sim.tickCount });
    if (catchUp) w.r.setQuiet(true);
    if (evs.length > 0) w.r.onEvents(evs);
    if (catchUp) w.r.setQuiet(false);
    w.sim.debugKill(w.victim);
    const after = withKill({ victim: w.victim, other: w.other, tick: w.sim.tickCount + 1 });
    const ev = w.sim.tick().map((e) => (e.kind === 'destroyed' && evs.length + after.length > 0 ? { ...e, by: w.other } : e));
    ev.push(...after);
    w.r.snapshot();
    w.r.onEvents(ev);
    w.r.frame(1, 50);
    const push = (claim.mock.calls[0][0] as { push?: unknown }).push;
    w.r.dispose();
    return push;
  };
  const fired = (weaponId: string) => (c: { victim: number; other: number; tick: number }): SimEvent[] => [
    {
      kind: 'fire', tick: c.tick, shooter: c.other, target: c.victim, weaponId,
      pHit: fx.from(1), roll: fx.from(0), willHit: true,
      breakdown: { accuracy: fx.from(1), rangeFalloff: fx.from(1), coverMod: fx.from(1), motionMod: fx.from(1), stanceMod: fx.from(1), suppressionMod: fx.from(1) },
    } as SimEvent,
  ];
  const HOWITZER = { horizontalMS: 5.0, upMS: 2.8 };
  const DEFAULT = { horizontalMS: 1.0, upMS: 0.4 };

  it('the push comes from the killing weapon\'s class: the killer\'s last shot, else the default (GH-1223)', async () => {
    expect(await pushAfter(fired('howitzer_155'))).toEqual(HOWITZER);
    expect(await pushAfter(fired('rpg'))).toEqual({ horizontalMS: 3.5, upMS: 1.8 });
    expect(await pushAfter(fired('rifle_556'))).toEqual(DEFAULT);
    expect(await pushAfter(() => [])).toEqual(DEFAULT);
  });

  it('a `strike` event by the caller makes the kill read the air-strike class, and a `chargeDetonated` the demolition class', async () => {
    const strike = (c: { victim: number; other: number; tick: number }): SimEvent[] =>
      [...fired('rifle_556')(c), { kind: 'strike', tick: c.tick, by: c.other, x: fx.from(10), y: fx.from(10), profile: 0 }];
    const charge = (c: { victim: number; other: number; tick: number }): SimEvent[] =>
      [...fired('rifle_556')(c), { kind: 'chargeDetonated', tick: c.tick, structure: 0, by: c.other }];
    // The rifle shot comes first in each list: the later act wins the latch, so the push is the strike's / charge's.
    expect(await pushAfter(strike)).toEqual({ horizontalMS: 5.0, upMS: 2.8 });
    expect(await pushAfter(charge)).toEqual({ horizontalMS: 4.0, upMS: 2.2 });
  });

  it('a mortar barrage latches by its profile: the barrage kill reads the mortar class, the air strike its own', async () => {
    const call = (profile: number) => (c: Ctx): SimEvent[] =>
      [...fired('rifle_556')(c), { kind: 'strike', tick: c.tick, by: c.other, x: fx.from(10), y: fx.from(10), profile }];
    expect(await pushAfter(call(FS_MORTAR_BARRAGE))).toEqual({ horizontalMS: 3.0, upMS: 1.6 });
    expect(await pushAfter(call(FS_AIR_STRIKE))).toEqual({ horizontalMS: 5.0, upMS: 2.8 });
  });

  it('a charge names the garrison it kills in the same batch, though the sim pushes `destroyed` before `chargeDetonated`', async () => {
    // `stepCharges`: `destroyStructure` kills the garrison, THEN `chargeDetonated` -- one tick, one batch, that order.
    const charge = (c: Ctx): SimEvent[] => [{ kind: 'chargeDetonated', tick: c.tick, structure: 0, by: c.other }];
    expect(await pushAfter(fired('rifle_556'), false, charge)).toEqual({ horizontalMS: 4.0, upMS: 2.2 });
  });

  it('a fire later in the kill\'s own batch does not reach back onto that kill', async () => {
    expect(await pushAfter(fired('rifle_556'), false, fired('howitzer_155'))).toEqual(DEFAULT);
    // ... but it is the killer's last act for the next batch.
    expect(await pushAfter((c) => [...fired('rifle_556')(c), ...fired('howitzer_155')(c)])).toEqual(HOWITZER);
  });

  it('a rejoin catch-up still latches: a quiet `fire` drops its burst but the kill reads its class', async () => {
    expect(await pushAfter(fired('howitzer_155'), true)).toEqual(HOWITZER);
  });

  it('the `ragdolls` layer holds a corpse hidden through the fog reveal that would show it again', async () => {
    const { sim, r, p } = await killAndSettle(ON, 1);
    const corpse = p.meshWrecks[0];
    expect(r.setDebugLayerVisible('ragdolls', false)).toBe(1);
    // Not yet revealed: the next frame's `updateMeshWrecks` latches it shown and writes `visible = true`.
    corpse.shown = false;
    tick(sim, r, 1);
    expect(corpse.shown).toBe(true);
    expect(corpse.root.visible).toBe(false);
    r.dispose();
  });

  it('a death in a catch-up keeps today\'s path (no ragdoll), in the order main.ts calls it', async () => {
    const w = await world(ON);
    tick(w.sim, w.r, 1);
    w.sim.debugKill(w.victim);
    // main.ts: setQuiet(true), the ticks and their events, then setQuiet(false) BEFORE any frame is painted, so
    // `quiet` is never true inside frame(); only `deathQuiet` (stamped by onEvents) can stop the ragdoll.
    w.r.setQuiet(true);
    const ev = w.sim.tick();
    w.r.snapshot();
    w.r.onEvents(ev);
    w.r.setQuiet(false);
    w.r.frame(1, 50);
    w.r.frame(1, 16);
    expect(w.p.ragdolls.incidents).toBe(0);
    w.r.dispose();
  });

  it('a death off screen keeps today\'s path (no ragdoll)', async () => {
    const w = await world(ON);
    w.r.camera.x = 0;
    w.r.camera.y = 19;
    w.r.camera.zoom = 2.5;
    tick(w.sim, w.r, 1);
    w.sim.debugKill(w.victim);
    tick(w.sim, w.r, 1);
    expect(w.p.ragdolls.incidents).toBe(0);
    w.r.dispose();
  });
});
