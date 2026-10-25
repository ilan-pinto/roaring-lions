/**
 * E6 (GH-274) chunk B: the swarm batch, against the REAL `drone_swarm.glb`.
 *
 * A hand-built fixture would agree with whatever the code assumed; the shipped bytes
 * (`rl_rotors`, `rotor_rubber`, the `WRECK_` twin) are what `extractSwarmParts`
 * has to survive, and what a re-export would silently break.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseGlbHeadless } from './headless-gltf';
import { MESH_SCALE } from './mesh-anim';
import { buildVehicleMeshTemplate, type VehicleMeshTemplate } from './mesh-vehicle';
import {
  SwarmBatch,
  buildRotorDiscGeometry,
  createRotorBlurMaterial,
  extractSwarmParts,
  type SwarmBatchEvent,
  type SwarmEntityInput,
  type SwarmFrameEnv,
} from './swarm-batch';
import { SWARM_CAPACITY, SWARM_EXIT_HEADROOM, SWARM_LIVE_CAPACITY, SWARM_TUMBLE_S, SWARM_WRECK_CAP, type DiveRequest } from './swarm-layout';
import { SWARM_ROTOR_RENDER_ORDER } from './render-order';

const GLB = fileURLToPath(new URL('../../../../../art/meshes/vehicles/drone_swarm.glb', import.meta.url));

async function template(): Promise<VehicleMeshTemplate> {
  return buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(GLB)), 'drone_swarm');
}

function env(over: Partial<SwarmFrameEnv> = {}): SwarmFrameEnv {
  return {
    simTick: 0,
    simSec: 1.5,
    groundAt: () => 0,
    drawnAt: () => true,
    exploredAt: () => true,
    bodiesHidden: false,
    quiet: false,
    ...over,
  };
}

function entity(over: Partial<SwarmEntityInput> = {}): SwarmEntityInput {
  return {
    id: 7, side: 1, count: 12, spreadTiles: 1.5, live: 12, x: 10, z: 12, groundY: 0, liftY: 0.357, yaw: 0, drawn: true,
    ...over,
  };
}

/** One frame: begin, one entity, step exits, finish. */
function frame(
  batch: SwarmBatch,
  e: SwarmEntityInput,
  opts: { env?: Partial<SwarmFrameEnv>; dt?: number; requests?: DiveRequest[]; events?: SwarmBatchEvent[] } = {}
) {
  batch.beginFrame(env(opts.env));
  const events = opts.events ?? [];
  batch.updateEntity(e, opts.requests, events);
  const landings = batch.stepExits(opts.dt ?? 0.016);
  batch.finish();
  return { events, landings };
}

async function built(): Promise<{ batch: SwarmBatch; scene: THREE.Scene }> {
  const scene = new THREE.Scene();
  const batch = new SwarmBatch(scene, extractSwarmParts(await template()));
  return { batch, scene };
}

describe('extractSwarmParts: the shipped drone_swarm.glb', () => {
  it('merges the live body WITHOUT the rotor, and the wreck twin WITH its rotors', async () => {
    const parts = extractSwarmParts(await template());
    // hull_hull 136 + hull_metal 492 triangles; rotor_rubber (88) is the runtime's blur disc instead.
    expect((parts.body.index?.count ?? 0) / 3).toBe(136 + 492);
    expect(parts.wreck).not.toBeNull();
    expect((parts.wreck?.index?.count ?? 0) / 3).toBeGreaterThan(136 + 492); // the torn-off rotor rides in the wreck
  });

  it('reads the four rotor hubs out of the scene extras, in tiles', async () => {
    const parts = extractSwarmParts(await template());
    expect(parts.rotors).toHaveLength(4);
    for (const r of parts.rotors) {
      expect(Math.abs(r.x)).toBeCloseTo(0.2533 * MESH_SCALE, 3);
      expect(Math.abs(r.z)).toBeCloseTo(0.2525 * MESH_SCALE, 3);
      expect(r.y).toBeCloseTo(0.298 * MESH_SCALE, 3);
      expect(r.r).toBeCloseTo(0.158 * MESH_SCALE, 3);
    }
  });

  it('paints the body from the swarm ramp: vertex colours present and not one flat tone', async () => {
    const parts = extractSwarmParts(await template());
    const color = parts.body.getAttribute('color');
    expect(color.count).toBe(parts.body.getAttribute('position').count);
    const seen = new Set<string>();
    for (let i = 0; i < color.count; i++) seen.add(`${color.getX(i).toFixed(4)},${color.getY(i).toFixed(4)},${color.getZ(i).toFixed(4)}`);
    expect(seen.size).toBe(2); // hull_hull and hull_metal: two roles, two tones
    // The wreck is ONE charred tone.
    const wc = parts.wreck?.getAttribute('color');
    const wseen = new Set<string>();
    for (let i = 0; wc && i < wc.count; i++) wseen.add(`${wc.getX(i).toFixed(4)},${wc.getY(i).toFixed(4)},${wc.getZ(i).toFixed(4)}`);
    expect(wseen.size).toBe(1);
  });

  it('sizes each blur disc to its rotor: rl_rotors\' r is the farthest rotor vertex from the hub, and the tips span 0.75 m', async () => {
    const t = await template();
    const parts = extractSwarmParts(t);
    let rotor: THREE.Mesh | null = null;
    t.root.traverse((o) => {
      if (o.name === 'rotor_rubber') rotor = o as THREE.Mesh;
    });
    const mesh = rotor as THREE.Mesh | null;
    expect(mesh).not.toBeNull();
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (const h of parts.rotors) {
      let far = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i) * MESH_SCALE - h.x, pos.getZ(i) * MESH_SCALE - h.z);
        if (d < 0.25 * MESH_SCALE) far = Math.max(far, d);
      }
      expect(Math.abs(h.r - far) / far).toBeLessThan(0.01);
    }
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(0.75, 2); // 0.50 m real x 1.5
  });

  it('throws, naming the extra, when a GLB carries no rl_rotors', async () => {
    const t = await template();
    delete (t.root.userData as Record<string, unknown>).rl_rotors;
    expect(() => extractSwarmParts(t)).toThrow(/rl_rotors/);
  });
});

describe('buildRotorDiscGeometry', () => {
  it('is one 12-segment disc per hub in one geometry, in the horizontal plane at the hub height', async () => {
    const parts = extractSwarmParts(await template());
    const g = buildRotorDiscGeometry(parts.rotors);
    expect(g.getAttribute('position').count).toBe(4 * 13);
    expect((g.index?.count ?? 0) / 3).toBe(4 * 12);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(parts.rotors[Math.floor(i / 13)].y, 9);
    // The rim is a unit circle in aDisc.
    const disc = g.getAttribute('aDisc');
    expect(Math.hypot(disc.getX(1), disc.getY(1))).toBeCloseTo(1, 9);
    expect(Math.hypot(disc.getX(0), disc.getY(0))).toBe(0);
  });
});

describe('SwarmBatch: the draw follows the LIVE count', () => {
  it('draws exactly `live` bodies and as many rotor discs, sharing ONE matrix buffer', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    expect(batch.bodies.count).toBe(12);
    expect(batch.rotors.count).toBe(12);
    expect(batch.rotors.instanceMatrix).toBe(batch.bodies.instanceMatrix);
    expect(batch.drawnCount(7)).toBe(12);
    expect(batch.bodies.visible).toBe(true);
  });

  it('draws `live`, never the type\'s `count`, as members are lost', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    for (const live of [11, 8, 5, 1]) {
      frame(batch, entity({ live }));
      expect(batch.drawnCount(7), `live ${live}`).toBe(live);
    }
  });

  it('a swarm that arrives thinned was thinned before we looked: no exits, no wrecks', async () => {
    const { batch } = await built();
    const { events } = frame(batch, entity({ live: 5 }));
    expect(events).toEqual([]);
    expect(batch.exitsInFlight).toBe(0);
    expect(batch.drawnCount(7)).toBe(5);
  });

  it('keeps every surviving member EXACTLY where it was when the highest slots leave', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const before: THREE.Vector3[] = [];
    for (let s = 0; s < 12; s++) {
      const v = new THREE.Vector3();
      expect(batch.memberWorldPosition(7, s, v)).toBe(true);
      before.push(v);
    }
    frame(batch, entity({ live: 9 }));
    for (let s = 0; s < 9; s++) {
      const v = new THREE.Vector3();
      expect(batch.memberWorldPosition(7, s, v)).toBe(true);
      expect(v.toArray()).toEqual(before[s].toArray());
    }
    // Slots 9..11 are gone from the live range.
    expect(batch.memberWorldPosition(7, 9, new THREE.Vector3())).toBe(false);
    expect(batch.memberWorldPosition(7, 11, new THREE.Vector3())).toBe(false);
  });

  it('the survivors\' DRAWN matrices are the first `live` of the full cloud\'s, byte for byte', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const full = Array.from(batch.bodies.instanceMatrix.array.slice(0, 12 * 16));
    frame(batch, entity({ live: 9 }), { dt: 0 });
    const thinned = Array.from(batch.bodies.instanceMatrix.array.slice(0, 9 * 16));
    // Instance k IS slot k for the live members: the highest slots left, nobody else moved.
    expect(thinned).toEqual(full.slice(0, 9 * 16));
  });

  it('exposes the member at slot live-1 for the beam, and it is the one that falls next', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const target = new THREE.Vector3();
    expect(batch.memberWorldPosition(7, 11, target)).toBe(true);
    const events: SwarmBatchEvent[] = [];
    frame(batch, entity({ live: 11 }), { events });
    // The 'down' event is where slot 11 was.
    expect(events).toHaveLength(1);
    expect(events[0].x).toBeCloseTo(target.x, 6);
    expect(events[0].z).toBeCloseTo(target.z, 6);
    expect(events[0].y).toBeCloseTo(target.y, 6);
  });

  it('a fixed sim time repeats the same matrices, and a later one moves them', async () => {
    const { batch } = await built();
    const snap = (simSec: number): number[] => {
      frame(batch, entity({ live: 12 }), { env: { simSec }, dt: 0 });
      return Array.from(batch.bodies.instanceMatrix.array.slice(0, 12 * 16));
    };
    const a = snap(3.25);
    expect(snap(3.25)).toEqual(a);
    expect(snap(4.5)).not.toEqual(a);
  });

  it('keeps every drawn member inside the cloud\'s disc, at the air lift, for the whole wander', async () => {
    const { batch } = await built();
    const v = new THREE.Vector3();
    for (let t = 0; t < 30; t += 0.9) {
      frame(batch, entity({ live: 12 }), { env: { simSec: t }, dt: 0 });
      for (let s = 0; s < 12; s++) {
        batch.memberWorldPosition(7, s, v);
        expect(Math.hypot(v.x - 10, v.z - 12)).toBeLessThanOrEqual(0.75 + 1e-9);
        expect(v.y).toBeGreaterThan(0.357 * 0.7);
        expect(v.y).toBeLessThan(0.357 * 1.3 + 0.04);
      }
    }
  });

  it('an entity hidden by fog is not written to the draw, but its count and exits are still tracked', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 10, drawn: false }), { env: { drawnAt: () => false } });
    expect(batch.drawnCount(7)).toBe(0);
    expect(batch.bodies.count).toBe(0);
    expect(batch.bodies.visible).toBe(false); // an empty batch costs no draw
    expect(batch.exitsInFlight).toBe(2); // the two that fell still fall
    frame(batch, entity({ live: 10, drawn: true }));
    expect(batch.drawnCount(7)).toBe(10);
  });

  it('the swarm debug flag blanks the body draw on the NEXT frame too, not just the toggle frame', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }), { env: { bodiesHidden: true } });
    expect(batch.bodies.count).toBe(0);
    frame(batch, entity({ live: 12 }), { env: { bodiesHidden: true } });
    expect(batch.bodies.count).toBe(0);
    expect(batch.bodies.visible).toBe(false);
    frame(batch, entity({ live: 12 }));
    expect(batch.bodies.count).toBe(12);
  });

  it('never writes past its capacity, however many swarms and exits there are', async () => {
    const scene = new THREE.Scene();
    const batch = new SwarmBatch(scene, extractSwarmParts(await template()), { capacity: 20 });
    batch.beginFrame(env());
    const events: SwarmBatchEvent[] = [];
    for (let id = 0; id < 5; id++) batch.updateEntity(entity({ id, live: 12 }), undefined, events);
    batch.stepExits(0.016);
    batch.finish();
    expect(batch.bodies.count).toBe(20);
    expect(SWARM_LIVE_CAPACITY).toBe(192);
    expect(SWARM_EXIT_HEADROOM).toBe(48);
    expect(SWARM_CAPACITY).toBe(240);
  });

  it('has headroom for the members in flight on top of a full screen of live ones', async () => {
    const { batch } = await built();
    batch.beginFrame(env());
    const events: SwarmBatchEvent[] = [];
    // 17 swarms of 12 is 204 live: more than the 192 a screen of 16 needs.
    for (let id = 0; id < 17; id++) batch.updateEntity(entity({ id, live: 12 }), undefined, events);
    batch.stepExits(0.016);
    batch.finish();
    expect(batch.bodies.count).toBe(204);
    // One loses three: 201 live and 3 tumbling are all drawn, none dropped for want of an instance.
    batch.beginFrame(env());
    for (let id = 0; id < 17; id++) batch.updateEntity(entity({ id, live: id === 0 ? 9 : 12 }), undefined, events);
    batch.stepExits(0.016);
    batch.finish();
    expect(batch.exitsInFlight).toBe(3);
    expect(batch.bodies.count).toBe(204);
  });

  it('draws the rotor discs in their own band, not the turret\'s', async () => {
    const { batch } = await built();
    expect(batch.rotors.renderOrder).toBe(SWARM_ROTOR_RENDER_ORDER);
  });

  it('the rotor shader never takes atan(0, 0): the hub is guarded', () => {
    const src = createRotorBlurMaterial().fragmentShader;
    expect(src.match(/atan\(vDisc/g)).toHaveLength(1);
    expect(src).toMatch(/r < 1e-4 \? 0\.0 : atan\(vDisc\.y, vDisc\.x\)/);
  });

  it('a shot-down member of a swarm that is NOT drawn (fog, a versus leak) throws no "down" event, yet still falls', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const { events } = frame(batch, entity({ live: 10, drawn: false }));
    expect(events).toEqual([]);
    expect(batch.exitsInFlight).toBe(2);
    // The control: the same drop, drawn, does throw them.
    const drawn = await built();
    frame(drawn.batch, entity({ live: 12 }));
    expect(frame(drawn.batch, entity({ live: 10 })).events).toHaveLength(2);
  });

  it('a catch-up (quiet) frame throws no exits and leaves no wrecks', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const { events } = frame(batch, entity({ live: 4 }), { env: { quiet: true } });
    expect(events).toEqual([]);
    expect(batch.exitsInFlight).toBe(0);
    expect(batch.drawnCount(7)).toBe(4);
  });
});

describe('SwarmBatch: shot down members tumble, then lie as wrecks', () => {
  it('a drop with no dive is three falls and three "down" events', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const { events } = frame(batch, entity({ live: 9 }));
    expect(events.map((e) => e.kind)).toEqual(['down', 'down', 'down']);
    expect(batch.exitsInFlight).toBe(3);
    // 9 live + 3 falling are all in the draw.
    expect(batch.bodies.count).toBe(12);
    expect(batch.drawnCount(7)).toBe(9);
  });

  it('a fall takes 0.6 s and ends as a ground wreck where it fell', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 11 }), { dt: 0.016 });
    expect(batch.wreckCount).toBe(0);
    frame(batch, entity({ live: 11 }), { dt: SWARM_TUMBLE_S - 0.1 });
    expect(batch.wreckCount).toBe(0);
    expect(batch.exitsInFlight).toBe(1);
    frame(batch, entity({ live: 11 }), { dt: 0.2 });
    expect(batch.wreckCount).toBe(1);
    expect(batch.exitsInFlight).toBe(0);
    expect(batch.wrecks?.count).toBe(1);
    expect(batch.wrecks?.visible).toBe(true);
    expect(batch.bodies.count).toBe(11);
  });

  it('falls from its height to the ground: lower with age, never below the ground', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const heights: number[] = [];
    frame(batch, entity({ live: 11 }), { dt: 0 });
    for (let i = 0; i < 8; i++) {
      frame(batch, entity({ live: 11 }), { dt: 0.06 });
      const m = new THREE.Matrix4();
      // The falling member is the LAST body written (after the 11 live ones).
      batch.bodies.getMatrixAt(batch.bodies.count - 1, m);
      if (batch.exitsInFlight > 0) heights.push(new THREE.Vector3().setFromMatrixPosition(m).y);
    }
    expect(heights.length).toBeGreaterThan(3);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThan(heights[i - 1]);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0);
  });

  it('keeps at most SWARM_WRECK_CAP wrecks, evicting the oldest', async () => {
    const scene = new THREE.Scene();
    const batch = new SwarmBatch(scene, extractSwarmParts(await template()), { wreckCap: 5 });
    for (let id = 0; id < 4; id++) {
      frame(batch, entity({ id, live: 12 }));
      frame(batch, entity({ id, live: 0 }), { dt: 0.016 });
      frame(batch, entity({ id, live: 0 }), { dt: 1 });
      batch.forget(id);
    }
    expect(batch.wreckCount).toBe(5);
    expect(batch.wrecks?.count).toBe(5);
    expect(SWARM_WRECK_CAP).toBe(96);
  });

  it('wrecks in ground nobody has explored are not drawn; a wreck follows the ground it lies on', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 11 }), { dt: 0 });
    frame(batch, entity({ live: 11 }), { dt: 1 });
    expect(batch.wrecks?.count).toBe(1);
    frame(batch, entity({ live: 11 }), { env: { exploredAt: () => false }, dt: 0 });
    expect(batch.wrecks?.count).toBe(0);
    expect(batch.wrecks?.visible).toBe(false);
    frame(batch, entity({ live: 11 }), { env: { groundAt: () => 0.5 }, dt: 0 });
    const m = new THREE.Matrix4();
    batch.wrecks?.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(0.5, 9);
  });

  it('the swarm-wrecks flag hides the wreck batch on every frame', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 11 }), { dt: 0 });
    frame(batch, entity({ live: 11 }), { dt: 1 });
    batch.setWrecksDebugHidden(true);
    frame(batch, entity({ live: 11 }), { dt: 0 });
    expect(batch.wrecks?.visible).toBe(false);
    batch.setWrecksDebugHidden(false);
    frame(batch, entity({ live: 11 }), { dt: 0 });
    expect(batch.wrecks?.visible).toBe(true);
  });

  it('the whole cloud dying at once tumbles every member; the entity leaves nothing else', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const { events } = frame(batch, entity({ live: 0 }), { dt: 0 });
    expect(events).toHaveLength(12);
    expect(batch.drawnCount(7)).toBe(0);
    expect(batch.bodies.count).toBe(12); // the twelve falling
    frame(batch, entity({ live: 0 }), { dt: 1 });
    expect(batch.wreckCount).toBe(12);
    expect(batch.bodies.count).toBe(0);
  });
});

describe('SwarmBatch: the dive', () => {
  const REQ: DiveRequest = {
    tick: 100, target: 3, structure: -1, toX: 10.5, toZ: 12, willHit: true, simDistTiles: 0.9, showImpact: true,
  };

  it('a drop with one fire event is a DIVE: no tumble, no "down" event, no wreck', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const { events } = frame(batch, entity({ live: 11 }), { requests: [REQ], dt: 0.016 });
    expect(events).toEqual([]);
    expect(batch.exitsInFlight).toBe(1);
    expect(batch.bodies.count).toBe(12); // 11 live + the diver
    expect(batch.drawnCount(7)).toBe(11);
  });

  it('lands once, after its flight AND after the sim resolves the round, then is gone for good', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 11 }), { requests: [REQ], dt: 0.016, env: { simTick: 100 } });
    // 0.9 tiles at 10 tiles/s is 2 ticks in the air: 0.05 s, resolving on tick 101. A frame
    // that long after the shot is over its flight but the sim has not FINISHED tick 101.
    let r = frame(batch, entity({ live: 11 }), { dt: 0.5, env: { simTick: 101 } });
    expect(r.landings).toHaveLength(0);
    expect(batch.exitsInFlight).toBe(1);
    r = frame(batch, entity({ live: 11 }), { dt: 0.016, env: { simTick: 102 } });
    expect(r.landings).toHaveLength(1);
    expect(r.landings[0].x).toBeCloseTo(10.5, 9);
    expect(r.landings[0].z).toBeCloseTo(12, 9);
    expect(r.landings[0].scale).toBe(0.6);
    expect(r.landings[0].miss).toBe(false);
    expect(batch.exitsInFlight).toBe(0);
    expect(batch.wreckCount).toBe(0); // a diver is spent, not shot down
    r = frame(batch, entity({ live: 11 }), { dt: 0.016, env: { simTick: 103 } });
    expect(r.landings).toHaveLength(0);
  });

  it('two exits and one fire event: the top slot dives, the next falls', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    const { events } = frame(batch, entity({ live: 10 }), { requests: [REQ] });
    expect(events).toHaveLength(1); // one fell
    expect(batch.exitsInFlight).toBe(2);
  });

  it('a hidden entity\'s diver still lands its blast (the landing is state, not a pixel)', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 11, drawn: false }), { requests: [REQ], env: { bodiesHidden: true, simTick: 100 } });
    const r = frame(batch, entity({ live: 11, drawn: false }), { dt: 0.5, env: { bodiesHidden: true, simTick: 102 } });
    expect(r.landings).toHaveLength(1);
    expect(batch.bodies.count).toBe(0);
  });
});

describe('SwarmBatch: lifecycle', () => {
  it('dispose removes all three meshes from the scene, and is idempotent', async () => {
    const { batch, scene } = await built();
    expect(scene.children.map((c) => c.name).sort()).toEqual(['swarm-bodies', 'swarm-rotors', 'swarm-wrecks']);
    batch.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => batch.dispose()).not.toThrow();
  });

  it('forget drops an entity\'s slots but not its exits in flight', async () => {
    const { batch } = await built();
    frame(batch, entity({ live: 12 }));
    frame(batch, entity({ live: 11 }), { dt: 0 });
    batch.forget(7);
    expect(batch.has(7)).toBe(false);
    expect(batch.exitsInFlight).toBe(1);
  });
});
