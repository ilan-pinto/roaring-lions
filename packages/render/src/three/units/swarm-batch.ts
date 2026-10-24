/**
 * E6 (GH-274) chunk B: the swarm's instanced draw. Spec 2026-10-24 (e6-art) §4-§5.
 *
 * One `drone_swarm` entity stands for `count` members; a mesh vehicle per member
 * would cost ~108 draws a swarm (3 meshes x 3 passes x 12). This draws EVERY
 * member of EVERY swarm of the type through three `InstancedMesh`es, a fixed
 * cost that grows with neither members, swarms nor beams:
 *
 *  | mesh    | what                                                       | draws / frame |
 *  |---------|------------------------------------------------------------|---------------|
 *  | bodies  | every live member, diver and falling member, one material  | 3 (main, shadow, AO) |
 *  | rotors  | blur discs from `rl_rotors`, SHARING the bodies' matrices   | 1 (main)      |
 *  | wrecks  | the `WRECK_` twin, charred, at most `SWARM_WRECK_CAP`       | 2 (main, AO)  |
 *
 * (`tools/src/perf/swarm-drawcalls.test.ts` measures those numbers through
 * three's own render list. The wreck casts no shadow: a 0.75 m wreck's shadow
 * is a speck.)
 *
 * ## Colour
 *
 * Bodies carry VERTEX colours from `VEHICLE_ROLE_PALETTE['drone_swarm']` (the
 * `bakePropColors` precedent: one material, so one draw per pass), baked ONCE at
 * load. `new THREE.Color(hex)` is already in three's linear working space, which
 * is what a `vertexColors` standard material wants (CLAUDE.md: vertex and
 * uniform colours must be LINEAR). The rotor blur is a `ShaderMaterial` whose
 * `uColor` is linear for the same reason `createParticleMaterial`'s are.
 *
 * ## What is NOT here
 *
 * No `attachMeshSilhouette`: the occlusion outline is per `Object3D` and a
 * 12-member cloud of 11 px specks would be twelve outlines of nothing. Nothing
 * here reads or writes the sim; positions come in, instances go out.
 */
import * as THREE from 'three';
import { MESH_SCALE } from './mesh-anim';
import type { VehicleMeshTemplate } from './mesh-vehicle';
import { CHARRED_RAMP, rampForVehicleRole } from './vehicle-mesh-role';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';
import { WORLD_ROUGHNESS, liftTone } from '../world-materials';
import { paletteHex } from '../palette-hex';
import {
  SWARM_CAPACITY,
  SWARM_DIVE_IMPACT_POWER,
  SWARM_DIVE_IMPACT_SCALE,
  SWARM_ROTOR_RAD_S,
  SWARM_TUMBLE_RAD_S,
  SWARM_TUMBLE_S,
  SWARM_WRECK_CAP,
  SwarmWreckRing,
  diveFlight,
  diveHasLanded,
  divePose,
  fallHeight,
  liveSlotCount,
  memberOffset,
  planExits,
  settleBlend,
  swarmSlots,
  tumbleAxis,
  wreckRest,
  type DiveFlight,
  type DivePose,
  type DiveRequest,
  type MemberOffset,
  type SwarmSlot,
} from './swarm-layout';

const WRECK_PREFIX = 'WRECK_';
const SWARM_VEHICLE_ID = 'drone_swarm';

/** One blur disc, in TILES, in the member's own frame (`rl_rotors` x `MESH_SCALE`). */
export interface RotorHub {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
}

/** What a swarm template yields: merged geometry plus the extras the runtime reads. */
export interface SwarmParts {
  /** Live non-rotor meshes, `MESH_SCALE` baked in, vertex colours from the type's ramp. */
  readonly body: THREE.BufferGeometry;
  /** The `WRECK_` twin's meshes, `MESH_SCALE` baked in, charred. Null when the GLB has none. */
  readonly wreck: THREE.BufferGeometry | null;
  readonly rotors: readonly RotorHub[];
  /** `rl_bomb`, tiles: where the bomb hangs (the dive's release point). Null when absent. */
  readonly bomb: readonly [number, number, number] | null;
}

interface ColouredPart {
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4;
  readonly tone: THREE.Color;
}

/** Position + normal + colour, one index buffer: a flat merge of the parts. */
export function mergeColoured(parts: readonly ColouredPart[]): THREE.BufferGeometry {
  let verts = 0;
  let indices = 0;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    verts += pos.count;
    indices += p.geometry.index ? p.geometry.index.count : pos.count;
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vBase = 0;
  let iBase = 0;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    const nor = p.geometry.getAttribute('normal');
    if (!nor) throw new Error('swarm-batch: a swarm mesh has no normals (it could not be lit or cast AO)');
    nm.getNormalMatrix(p.matrix);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
      position.set([v.x, v.y, v.z], (vBase + i) * 3);
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      normal.set([v.x, v.y, v.z], (vBase + i) * 3);
      color.set([p.tone.r, p.tone.g, p.tone.b], (vBase + i) * 3);
    }
    const idx = p.geometry.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) index[iBase + i] = idx.getX(i) + vBase;
      iBase += idx.count;
    } else {
      for (let i = 0; i < pos.count; i++) index[iBase + i] = vBase + i;
      iBase += pos.count;
    }
    vBase += pos.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

function parseRotors(userData: Record<string, unknown>): RotorHub[] {
  const raw = userData.rl_rotors;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('swarm-batch: the swarm GLB carries no scene extras.rl_rotors (re-run tools/vehicles/export_meshy_swarm_drone.py)');
  }
  return raw.map((r, i) => {
    if (!Array.isArray(r) || r.length !== 4 || r.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new Error(`swarm-batch: rl_rotors[${i}] must be [x, y, z, r] in GLB metres`);
    }
    const [x, y, z, rad] = r as [number, number, number, number];
    return { x: x * MESH_SCALE, y: y * MESH_SCALE, z: z * MESH_SCALE, r: rad * MESH_SCALE };
  });
}

/**
 * Takes a swarm's `VehicleMeshTemplate` apart. The template's own meshes are
 * left exactly as `buildVehicleMeshTemplate` made them (the vehicle path may
 * still instantiate one for the garage); this reads their geometry and node
 * matrices and builds NEW merged geometry, so nothing here is shared with, or
 * disposed by, the template.
 *
 * `rotor_*` meshes are left out of the body merge: the runtime draws its own
 * blur discs from `rl_rotors`, and a static two-blade rotor under a spinning
 * one is a stopped rotor at 16 px. They stay in the GLB for the gate and for
 * the wreck, whose torn-off rotor is part of the pose.
 */
export function extractSwarmParts(template: VehicleMeshTemplate, vehicleId: string = SWARM_VEHICLE_ID): SwarmParts {
  const root = template.root;
  root.updateMatrixWorld(true);
  const live: ColouredPart[] = [];
  const dead: ColouredPart[] = [];
  const charred = new THREE.Color(liftTone(CHARRED_RAMP));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const ud = mesh.userData as { rl_wreck?: unknown; rl_role?: unknown };
    const isWreck = ud.rl_wreck === true || mesh.name.startsWith(WRECK_PREFIX);
    const bare = mesh.name.startsWith(WRECK_PREFIX) ? mesh.name.slice(WRECK_PREFIX.length) : mesh.name;
    const role = typeof ud.rl_role === 'string' && ud.rl_role.length > 0 ? ud.rl_role : bare;
    if (isWreck) {
      dead.push({ geometry: mesh.geometry, matrix: mesh.matrixWorld.clone(), tone: charred });
      return;
    }
    if (bare.startsWith('rotor_')) return;
    live.push({
      geometry: mesh.geometry,
      matrix: mesh.matrixWorld.clone(),
      tone: new THREE.Color(liftTone(rampForVehicleRole(vehicleId, role))),
    });
  });
  if (live.length === 0) throw new Error(`swarm-batch: ${vehicleId} has no body mesh once rotor_* is left out`);
  const bombRaw = root.userData.rl_bomb;
  const bomb =
    Array.isArray(bombRaw) && bombRaw.length === 3 && bombRaw.every((n) => typeof n === 'number')
      ? ([bombRaw[0] * MESH_SCALE, bombRaw[1] * MESH_SCALE, bombRaw[2] * MESH_SCALE] as const)
      : null;
  return {
    body: mergeColoured(live),
    wreck: dead.length > 0 ? mergeColoured(dead) : null,
    rotors: parseRotors(root.userData),
    bomb,
  };
}

const DISC_SEGMENTS = 12;

/** One 12-segment fan per hub, merged: position, the disc-local coordinate, the hub index. */
export function buildRotorDiscGeometry(rotors: readonly RotorHub[]): THREE.BufferGeometry {
  const per = DISC_SEGMENTS + 1;
  const position = new Float32Array(rotors.length * per * 3);
  const disc = new Float32Array(rotors.length * per * 2);
  const hub = new Float32Array(rotors.length * per);
  const index = new Uint16Array(rotors.length * DISC_SEGMENTS * 3);
  rotors.forEach((h, n) => {
    const base = n * per;
    position.set([h.x, h.y, h.z], base * 3);
    for (let s = 0; s < DISC_SEGMENTS; s++) {
      const th = (s / DISC_SEGMENTS) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      position.set([h.x + c * h.r, h.y, h.z + sn * h.r], (base + 1 + s) * 3);
      disc.set([c, sn], (base + 1 + s) * 2);
      index.set([base, base + 1 + s, base + 1 + ((s + 1) % DISC_SEGMENTS)], (n * DISC_SEGMENTS + s) * 3);
    }
    for (let i = 0; i < per; i++) hub[base + i] = n;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aDisc', new THREE.BufferAttribute(disc, 2));
  g.setAttribute('aHub', new THREE.BufferAttribute(hub, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Radial alpha at the hub and at the rim, and the streak's extra (spec §5.1). */
export const ROTOR_ALPHA_HUB = 0.15;
export const ROTOR_ALPHA_RIM = 0.45;
export const ROTOR_STREAK_ALPHA = 0.25;

export function createRotorBlurMaterial(): THREE.ShaderMaterial {
  const tone = new THREE.Color(paletteHex('shadow.0'));
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: tone } },
    vertexShader: /* glsl */ `
      attribute vec2 aDisc;
      attribute float aHub;
      attribute float aPhase;
      varying vec2 vDisc;
      varying float vSpin;
      void main() {
        vDisc = aDisc;
        // Neighbouring rotors turn opposite ways, each offset so no two blur in step.
        vSpin = aPhase * (mod(aHub, 2.0) < 0.5 ? 1.0 : -1.0) + aHub * 1.7;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vDisc;
      varying float vSpin;
      void main() {
        float r = length(vDisc);
        if (r > 1.0) discard;
        float a = mix(${ROTOR_ALPHA_HUB.toFixed(2)}, ${ROTOR_ALPHA_RIM.toFixed(2)}, smoothstep(0.0, 1.0, r));
        // Two blades: |cos(2 theta)| peaks twice a turn. Faint, and clear of the hub.
        float streak = pow(abs(cos(2.0 * (atan(vDisc.y, vDisc.x) - vSpin))), 18.0) * smoothstep(0.2, 0.75, r);
        gl_FragColor = vec4(uColor, min(1.0, a + ${ROTOR_STREAK_ALPHA.toFixed(2)} * streak));
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

// --- the batch --------------------------------------------------------------

/** A swarm entity this frame. Everything is the renderer's already-derived presentation state. */
export interface SwarmEntityInput {
  readonly id: number;
  readonly side: number;
  /** `type.swarm.count` and `spread_tiles`. */
  readonly count: number;
  readonly spreadTiles: number;
  /** `Sim.swarmMembers(id)`, or 0 for a dead entity: the ONLY thing the draw count reads. */
  readonly live: number;
  /** Interpolated centre, world X / Z. */
  readonly x: number;
  readonly z: number;
  /** Ground height under the centre, and the air lift above it (world Y). */
  readonly groundY: number;
  readonly liftY: number;
  /** The entity's mesh yaw (radians about +Y). */
  readonly yaw: number;
  /** The fog / debug gate: write this entity's members into the draw. */
  readonly drawn: boolean;
}

export interface SwarmFrameEnv {
  readonly simTick: number;
  readonly simSec: number;
  readonly groundAt: (x: number, z: number) => number;
  /** The fog gate for a thing in flight (`unitIsDrawn`'s rule at its position). */
  readonly drawnAt: (side: number, x: number, z: number) => boolean;
  /** The wreck gate: ever seen (`mesh-death.ts`'s rule). */
  readonly exploredAt: (x: number, z: number) => boolean;
  /** The `swarm` / `units` debug layer: nothing written to the body draw. */
  readonly bodiesHidden: boolean;
  /** A catch-up (`setQuiet`) throws no burst: exits vanish and leave nothing. */
  readonly quiet: boolean;
}

export type SwarmBatchEvent =
  /** A member was shot down: where it was hit (world X, height, world Z). */
  | { kind: 'down'; x: number; y: number; z: number };

export interface SwarmLanding {
  readonly x: number;
  readonly z: number;
  readonly headingTurns: number;
  readonly power: number;
  readonly scale: number;
  readonly miss: boolean;
  readonly showImpact: boolean;
}

interface EntityState {
  count: number;
  spreadTiles: number;
  slots: SwarmSlot[];
  prev: number;
  /** Members written to the body draw last frame: what `swarmDrawn` reads back. */
  drawn: number;
  /** Last frame's world position of each live slot, xyz. */
  readonly pos: Float32Array;
  posLive: number;
}

interface FallExit {
  readonly id: number;
  readonly slot: number;
  readonly side: number;
  readonly x: number;
  readonly z: number;
  readonly groundY: number;
  readonly h0: number;
  readonly yaw: number;
  readonly axis: readonly [number, number, number];
  readonly rest: { yawOffset: number; roll: number };
  readonly rotorPhase: number;
  age: number;
}

interface DiveExit {
  readonly id: number;
  readonly side: number;
  readonly flight: DiveFlight;
  readonly rotorPhase: number;
  age: number;
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpQuatB = new THREE.Quaternion();
const tmpAxis = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();
const offset: MemberOffset = { x: 0, z: 0, bob: 0 };
const divePoseScratch: DivePose = { x: 0, y: 0, z: 0, pitch: 0 };

export class SwarmBatch {
  readonly bodies: THREE.InstancedMesh;
  readonly rotors: THREE.InstancedMesh;
  readonly wrecks: THREE.InstancedMesh | null;
  readonly parts: SwarmParts;

  private readonly capacity: number;
  private readonly wreckCap: number;
  private readonly entities = new Map<number, EntityState>();
  private falls: FallExit[] = [];
  private dives: DiveExit[] = [];
  private readonly wreckRing: SwarmWreckRing;
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly landingsOut: SwarmLanding[] = [];
  private cursor = 0;
  private env: SwarmFrameEnv | null = null;
  private wrecksDebugHidden = false;
  private bodyMaterial: THREE.MeshStandardMaterial;
  private rotorMaterial: THREE.ShaderMaterial;
  private wreckMaterial: THREE.MeshStandardMaterial | null = null;
  private rotorGeometry: THREE.BufferGeometry;
  private disposed = false;

  constructor(scene: THREE.Object3D, parts: SwarmParts, opts: { capacity?: number; wreckCap?: number } = {}) {
    this.parts = parts;
    this.capacity = opts.capacity ?? SWARM_CAPACITY;
    this.wreckCap = opts.wreckCap ?? SWARM_WRECK_CAP;
    this.wreckRing = new SwarmWreckRing(this.wreckCap);

    this.bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: WORLD_ROUGHNESS, metalness: 0 });
    this.bodies = new THREE.InstancedMesh(parts.body, this.bodyMaterial, this.capacity);
    this.bodies.name = 'swarm-bodies';
    this.bodies.count = 0;
    this.bodies.visible = false;
    this.bodies.frustumCulled = false;
    this.bodies.castShadow = true;
    this.bodies.receiveShadow = true;
    this.bodies.renderOrder = HULL_RENDER_ORDER;
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.rotorGeometry = buildRotorDiscGeometry(parts.rotors);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.phase.setUsage(THREE.DynamicDrawUsage);
    this.rotorGeometry.setAttribute('aPhase', this.phase);
    this.rotorMaterial = createRotorBlurMaterial();
    this.rotors = new THREE.InstancedMesh(this.rotorGeometry, this.rotorMaterial, this.capacity);
    this.rotors.name = 'swarm-rotors';
    // ONE matrix buffer for bodies and discs: a disc is exactly where its member is.
    this.rotors.instanceMatrix = this.bodies.instanceMatrix;
    this.rotors.count = 0;
    this.rotors.visible = false;
    this.rotors.frustumCulled = false;
    this.rotors.castShadow = false;
    this.rotors.receiveShadow = false;
    // After the zone band and the tread (0) and the selection ring (0.5), before FX (2) and overlays (4).
    this.rotors.renderOrder = TURRET_RENDER_ORDER;

    if (parts.wreck) {
      this.wreckMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
      this.wrecks = new THREE.InstancedMesh(parts.wreck, this.wreckMaterial, this.wreckCap);
      this.wrecks.name = 'swarm-wrecks';
      this.wrecks.count = 0;
      this.wrecks.visible = false;
      this.wrecks.frustumCulled = false;
      // Main + AO, no shadow: a 0.75 m wreck's shadow is a speck.
      this.wrecks.castShadow = false;
      this.wrecks.receiveShadow = true;
      this.wrecks.renderOrder = HULL_RENDER_ORDER;
      this.wrecks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    } else {
      this.wrecks = null;
    }

    scene.add(this.bodies, this.rotors);
    if (this.wrecks) scene.add(this.wrecks);
  }

  /** The `swarm-wrecks` debug layer: a FLAG, because `finish()` re-derives `visible` every frame. */
  setWrecksDebugHidden(hidden: boolean): void {
    this.wrecksDebugHidden = hidden;
    if (this.wrecks && hidden) this.wrecks.visible = false;
  }

  /** How many members of entity `id` the body draw was handed last frame. */
  drawnCount(id: number): number {
    return this.entities.get(id)?.drawn ?? 0;
  }

  /** Ground wrecks currently held. */
  get wreckCount(): number {
    return this.wreckRing.length;
  }

  /** Diving + falling members in flight. */
  get exitsInFlight(): number {
    return this.falls.length + this.dives.length;
  }

  /**
   * The world position of live member `slot` of entity `id` as last computed, or
   * false. Chunk C's beam ends on slot `live - 1`: the member the next `struck`
   * removes. Written whether or not the entity was drawn (fog) - a position is
   * not a pixel - so a caller must gate on its own visibility.
   */
  memberWorldPosition(id: number, slot: number, out: THREE.Vector3): boolean {
    const e = this.entities.get(id);
    if (!e || slot < 0 || slot >= e.posLive) return false;
    out.set(e.pos[slot * 3], e.pos[slot * 3 + 1], e.pos[slot * 3 + 2]);
    return true;
  }

  /** Drops an entity's slot state (an abduction, or a type reload). Its exits keep flying. */
  forget(id: number): void {
    this.entities.delete(id);
  }

  has(id: number): boolean {
    return this.entities.has(id);
  }

  beginFrame(env: SwarmFrameEnv): void {
    this.env = env;
    this.cursor = 0;
    this.landingsOut.length = 0;
    for (const e of this.entities.values()) e.drawn = 0;
  }

  private writeBody(x: number, y: number, z: number, q: THREE.Quaternion, phase: number): void {
    if (this.cursor >= this.capacity) return;
    tmpPos.set(x, y, z);
    tmpMatrix.compose(tmpPos, q, tmpScale);
    this.bodies.setMatrixAt(this.cursor, tmpMatrix);
    this.phase.setX(this.cursor, phase);
    this.cursor++;
  }

  /**
   * One swarm entity this frame: places members `0 .. live-1`, and turns the
   * `prev - live` highest slots into exits. Events (a member shot down) are
   * appended to `events`; a dive's landing waits for `stepExits`.
   */
  updateEntity(input: SwarmEntityInput, requests: readonly DiveRequest[] | undefined, events: SwarmBatchEvent[]): void {
    const env = this.env;
    if (!env) throw new Error('SwarmBatch.updateEntity before beginFrame');
    let e = this.entities.get(input.id);
    if (!e || e.count !== input.count || e.spreadTiles !== input.spreadTiles) {
      // First sight: no exits (a swarm that arrives thinned was thinned before we looked).
      e = {
        count: input.count,
        spreadTiles: input.spreadTiles,
        slots: swarmSlots(input.id, input.count, input.spreadTiles),
        prev: liveSlotCount(input.live, input.count),
        drawn: 0,
        pos: new Float32Array(input.count * 3),
        posLive: 0,
      };
      this.entities.set(input.id, e);
    }
    const live = liveSlotCount(input.live, input.count);
    const nowSec = env.simSec;

    // Where every slot is this frame (exits start from here, so nothing pops).
    const place = (slot: number): { x: number; y: number; z: number; yaw: number } => {
      const s = e.slots[slot];
      memberOffset(s, nowSec, offset);
      return {
        x: input.x + offset.x,
        y: input.groundY + input.liftY * s.liftMul + offset.bob,
        z: input.z + offset.z,
        yaw: input.yaw + s.yawJitter,
      };
    };

    if (live < e.prev && !env.quiet) {
      const exits = planExits(e.prev, live, requests?.length ?? 0);
      let nextRequest = 0;
      for (const x of exits) {
        const p = place(x.slot);
        const rotorPhase = e.slots[x.slot].rotorPhase;
        if (x.kind === 'dive') {
          const req = (requests as readonly DiveRequest[])[nextRequest++];
          this.dives.push({
            id: input.id,
            side: input.side,
            flight: diveFlight(input.id, req, p.x, p.z, p.y, env.groundAt(req.toX, req.toZ)),
            rotorPhase,
            age: 0,
          });
        } else {
          this.falls.push({
            id: input.id,
            slot: x.slot,
            side: input.side,
            x: p.x,
            z: p.z,
            groundY: env.groundAt(p.x, p.z),
            h0: Math.max(0, p.y - env.groundAt(p.x, p.z)),
            yaw: p.yaw,
            axis: tumbleAxis(input.id, x.slot),
            rest: wreckRest(input.id, x.slot),
            rotorPhase,
            age: 0,
          });
          events.push({ kind: 'down', x: p.x, y: p.y, z: p.z });
        }
      }
    }
    e.prev = live;

    // The live members: slots 0 .. live-1, in place.
    e.posLive = live;
    const write = input.drawn && !env.bodiesHidden;
    for (let slot = 0; slot < live; slot++) {
      const p = place(slot);
      e.pos[slot * 3] = p.x;
      e.pos[slot * 3 + 1] = p.y;
      e.pos[slot * 3 + 2] = p.z;
      if (!write) continue;
      const before = this.cursor;
      tmpQuat.setFromAxisAngle(tmpAxis.set(0, 1, 0), p.yaw);
      this.writeBody(p.x, p.y, p.z, tmpQuat, SWARM_ROTOR_RAD_S * nowSec + e.slots[slot].rotorPhase);
      if (this.cursor > before) e.drawn++;
    }
  }

  /**
   * Ages every member in flight by `dtSeconds`, writes the ones that are shown,
   * and returns the dives that landed. A fall that finishes becomes a wreck.
   * The returned array is reused: consume it before the next `beginFrame`.
   */
  stepExits(dtSeconds: number): readonly SwarmLanding[] {
    const env = this.env;
    if (!env) throw new Error('SwarmBatch.stepExits before beginFrame');
    const write = !env.bodiesHidden;

    let wf = 0;
    for (let i = 0; i < this.falls.length; i++) {
      const f = this.falls[i];
      f.age += dtSeconds;
      if (f.age >= SWARM_TUMBLE_S) {
        this.wreckRing.push({ x: f.x, z: f.z, yaw: f.yaw + f.rest.yawOffset, roll: f.rest.roll, side: f.side });
        continue; // dropped
      }
      this.falls[wf++] = f;
      if (!write || !env.drawnAt(f.side, f.x, f.z)) continue;
      // Spin about the hashed axis, easing onto the rest pose over the last of the fall.
      tmpQuat.setFromAxisAngle(tmpAxis.set(f.axis[0], f.axis[1], f.axis[2]), SWARM_TUMBLE_RAD_S * f.age);
      tmpQuatB.setFromAxisAngle(tmpAxis.set(0, 1, 0), f.yaw);
      tmpQuat.multiply(tmpQuatB);
      tmpEuler.set(-f.rest.roll, f.yaw + f.rest.yawOffset, 0, 'YZX');
      tmpQuatB.setFromEuler(tmpEuler);
      tmpQuat.slerp(tmpQuatB, settleBlend(f.age));
      this.writeBody(f.x, f.groundY + fallHeight(f.h0, f.age), f.z, tmpQuat, SWARM_ROTOR_RAD_S * env.simSec + f.rotorPhase);
    }
    this.falls.length = wf;

    let wd = 0;
    for (let i = 0; i < this.dives.length; i++) {
      const d = this.dives[i];
      d.age += dtSeconds;
      if (diveHasLanded(d.flight, d.age, env.simTick)) {
        this.landingsOut.push({
          x: d.flight.toX,
          z: d.flight.toZ,
          headingTurns: (((-d.flight.yaw / (Math.PI * 2)) % 1) + 1) % 1,
          power: SWARM_DIVE_IMPACT_POWER * SWARM_DIVE_IMPACT_SCALE,
          scale: SWARM_DIVE_IMPACT_SCALE,
          miss: d.flight.miss,
          showImpact: d.flight.showImpact,
        });
        continue;
      }
      this.dives[wd++] = d;
      divePose(d.flight, d.age, divePoseScratch);
      if (!write || !env.drawnAt(d.side, divePoseScratch.x, divePoseScratch.z)) continue;
      tmpEuler.set(0, d.flight.yaw, divePoseScratch.pitch, 'YZX');
      tmpQuat.setFromEuler(tmpEuler);
      this.writeBody(divePoseScratch.x, divePoseScratch.y, divePoseScratch.z, tmpQuat, SWARM_ROTOR_RAD_S * env.simSec + d.rotorPhase);
    }
    this.dives.length = wd;
    return this.landingsOut;
  }

  /** Publishes the frame: counts, visibility (an empty batch costs no draw) and the wreck matrices. */
  finish(): void {
    const env = this.env;
    if (!env) throw new Error('SwarmBatch.finish before beginFrame');
    this.bodies.count = this.cursor;
    this.rotors.count = this.cursor;
    this.bodies.visible = this.cursor > 0;
    this.rotors.visible = this.cursor > 0;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.phase.needsUpdate = true;

    const w = this.wrecks;
    if (w) {
      let n = 0;
      for (const rec of this.wreckRing.items) {
        if (!env.exploredAt(rec.x, rec.z)) continue;
        tmpPos.set(rec.x, env.groundAt(rec.x, rec.z), rec.z);
        tmpEuler.set(-rec.roll, rec.yaw, 0, 'YZX');
        tmpQuat.setFromEuler(tmpEuler);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        w.setMatrixAt(n++, tmpMatrix);
      }
      w.count = n;
      w.visible = n > 0 && !this.wrecksDebugHidden;
      w.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of [this.bodies, this.rotors, this.wrecks]) {
      if (!m) continue;
      m.removeFromParent();
    }
    // One matrix buffer shared by bodies and rotors: dispose it once, through the bodies.
    this.bodies.dispose();
    this.wrecks?.dispose();
    this.parts.body.dispose();
    this.parts.wreck?.dispose();
    this.rotorGeometry.dispose();
    this.bodyMaterial.dispose();
    this.rotorMaterial.dispose();
    this.wreckMaterial?.dispose();
    this.entities.clear();
    this.falls.length = 0;
    this.dives.length = 0;
  }
}
