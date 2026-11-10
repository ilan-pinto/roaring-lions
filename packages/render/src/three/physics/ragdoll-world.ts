/**
 * GH-1223 slice 1: one ragdoll INCIDENT -- the figures of one entity killed on one tick -- in its own Rapier world
 * (design section 2, rule 4: a shared world's bits depend on unrelated deaths; a world per incident is isolated).
 *
 * Three-free and sim-free: everything arrives as plain numbers (metres, world frame), built by `ragdoll-rig.ts`.
 *
 * - **The clock is the SIM's.** `advanceTo(simMs)` runs every step owed up to the presentation sim time, at a fixed
 *   `MS_PER_TICK / 3` (50/3 ms: three steps a 20 Hz tick). Frame time is never read, and owed steps are never dropped,
 *   so the state at any sim time is the same however the frames fell. The step count is integer arithmetic on the
 *   sim's own milliseconds (`stepsOwed`), never a float division that could land a hair under a whole step.
 * - **Bodies are created with the identity rotation** and their capsules rotated inside them, so every joint's two
 *   frames coincide at creation: a joint's angle 0 IS the handoff pose. The muscle tone (position motors toward 0,
 *   decaying to nothing over `TONE_STEPS`) holds the handoff pose a moment, and a hinge's limits are about it.
 * - **Settle and freeze in steps:** every body under `FREEZE_LIN_M_S` and `FREEZE_ANG_RAD_S` for `FREEZE_QUIET_STEPS`
 *   steps in a row, or `MAX_STEPS` steps (4 s), whichever is first. The world is then freed and the last pose kept.
 */
import type { ImpulseJoint, RevoluteImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-deterministic-compat';
import { MS_PER_TICK } from '../decal-maths';
import type { Rapier } from './rapier';

export type V3 = readonly [number, number, number];
export type Q4 = readonly [number, number, number, number];

export const PHYSICS_STEPS_PER_TICK = 3;
/** 50/3 ms. Informational: the step count is `stepsOwed`, in integers. */
export const PHYSICS_STEP_MS = MS_PER_TICK / PHYSICS_STEPS_PER_TICK;
export const GRAVITY_M_S2 = -9.81;
export const FREEZE_LIN_M_S = 0.05;
export const FREEZE_ANG_RAD_S = 0.1;
export const FREEZE_QUIET_STEPS = 30;
export const MAX_STEPS = 240;
/** The muscle tone toward the handoff pose: acceleration-based stiffness and damping, gone after 0.6 s. */
export const TONE_STIFFNESS = 40;
export const TONE_DAMPING = 4;
export const TONE_STEPS = 36;
/** A hinge (elbow, knee) bends at most this far either way from the handoff pose. */
export const HINGE_LIMIT_RAD = 1.4;
/** A ball joint (shoulder, hip, neck, waist) turns at most this far about each of its axes from the handoff pose. */
export const BALL_LIMIT_RAD = 1.0;
export const FIGURE_MASS_KG = 80;
export const RAGDOLL_FRICTION = 0.9;
export const RAGDOLL_RESTITUTION = 0.05;

/** Whole physics steps owed `simMs` after `t0Ms`: integer arithmetic on the sim's milliseconds. */
export function stepsOwed(simMs: number, t0Ms: number): number {
  return Math.max(0, Math.floor((PHYSICS_STEPS_PER_TICK * (simMs - t0Ms)) / MS_PER_TICK + 1e-9));
}

export interface RagdollCapsule {
  /** World centre and rotation (the capsule's axis is its local Y), metres. */
  readonly centre: V3;
  readonly rot: Q4;
  readonly halfHeight: number;
  readonly radius: number;
}

export interface RagdollBodySpec {
  /** The parent body's index in the same figure, or -1. */
  readonly parent: number;
  /** The body's origin: its bone's origin, the joint to its parent. World metres. */
  readonly at: V3;
  readonly capsule: RagdollCapsule;
  /** A hinge's axis (world), or null for a ball joint. Ignored on a root body. */
  readonly hinge: V3 | null;
  readonly linvel: V3;
  readonly angvel: V3;
}

export interface RagdollFigureSpec {
  readonly bodies: readonly RagdollBodySpec[];
}

export interface StaticBox {
  readonly centre: V3;
  readonly half: V3;
}

export interface IncidentSpec {
  /** Sim time (ms) of step 0: the handoff. */
  readonly t0Ms: number;
  readonly figures: readonly RagdollFigureSpec[];
  /** The drawn ground under the incident, a triangle mesh in world metres. */
  readonly ground: { readonly vertices: Float32Array; readonly indices: Uint32Array };
  readonly boxes: readonly StaticBox[];
}

/** Floats per body in a pose: x, y, z, qx, qy, qz, qw. */
export const POSE_STRIDE = 7;

const STATIC_GROUP = 15;

/** Collision groups: a figure never collides with itself (its capsules start touching), only with other figures and
 *  the static patch. */
function figureGroups(f: number): number {
  const bit = 1 << (f % STATIC_GROUP);
  return ((bit & 0xffff) << 16) | (0xffff & ~bit);
}
const STATIC_GROUPS = ((1 << STATIC_GROUP) << 16) | 0x7fff;

function capsuleVolume(c: RagdollCapsule): number {
  return Math.PI * c.radius * c.radius * (2 * c.halfHeight) + (4 / 3) * Math.PI * c.radius ** 3;
}

interface Tone {
  readonly joint: ImpulseJoint;
  readonly hinge: boolean;
}

export class RagdollIncident {
  readonly t0Ms: number;
  /** Steps taken. */
  steps = 0;
  frozen = false;
  readonly bodyCount: number;
  private world: World | null;
  private readonly bodies: RigidBody[] = [];
  private readonly tones: Tone[] = [];
  private prev: Float64Array;
  private cur: Float64Array;
  private quietSteps = 0;
  private readonly R: Rapier;

  constructor(R: Rapier, spec: IncidentSpec) {
    this.R = R;
    this.t0Ms = spec.t0Ms;
    const world = new R.World({ x: 0, y: GRAVITY_M_S2, z: 0 });
    world.timestep = PHYSICS_STEP_MS / 1000;
    this.world = world;
    world.createCollider(
      R.ColliderDesc.trimesh(spec.ground.vertices, spec.ground.indices).setCollisionGroups(STATIC_GROUPS).setFriction(RAGDOLL_FRICTION)
    );
    for (const b of spec.boxes) {
      world.createCollider(
        R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2])
          .setTranslation(b.centre[0], b.centre[1], b.centre[2])
          .setCollisionGroups(STATIC_GROUPS)
          .setFriction(RAGDOLL_FRICTION)
      );
    }
    spec.figures.forEach((fig, f) => {
      const volume = fig.bodies.reduce((v, b) => v + capsuleVolume(b.capsule), 0);
      const density = volume > 0 ? FIGURE_MASS_KG / volume : 1000;
      const own: RigidBody[] = [];
      for (const b of fig.bodies) {
        const rb = world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(b.at[0], b.at[1], b.at[2])
            .setLinvel(b.linvel[0], b.linvel[1], b.linvel[2])
            .setAngvel({ x: b.angvel[0], y: b.angvel[1], z: b.angvel[2] })
        );
        const c = b.capsule;
        world.createCollider(
          R.ColliderDesc.capsule(c.halfHeight, c.radius)
            .setTranslation(c.centre[0] - b.at[0], c.centre[1] - b.at[1], c.centre[2] - b.at[2])
            .setRotation({ x: c.rot[0], y: c.rot[1], z: c.rot[2], w: c.rot[3] })
            .setDensity(density)
            .setCollisionGroups(figureGroups(f))
            .setFriction(RAGDOLL_FRICTION)
            .setRestitution(RAGDOLL_RESTITUTION),
          rb
        );
        own.push(rb);
        this.bodies.push(rb);
      }
      fig.bodies.forEach((b, i) => {
        if (b.parent < 0) return;
        const p = fig.bodies[b.parent];
        const a1 = { x: b.at[0] - p.at[0], y: b.at[1] - p.at[1], z: b.at[2] - p.at[2] };
        const a2 = { x: 0, y: 0, z: 0 };
        const data = b.hinge !== null
          ? R.JointData.revolute(a1, a2, { x: b.hinge[0], y: b.hinge[1], z: b.hinge[2] })
          : R.JointData.spherical(a1, a2);
        const joint = world.createImpulseJoint(data, own[b.parent], own[i], true);
        joint.setContactsEnabled(false);
        if (b.hinge !== null) (joint as RevoluteImpulseJoint).setLimits(-HINGE_LIMIT_RAD, HINGE_LIMIT_RAD);
        else for (const axis of this.ballAxes()) rawJoint(joint).rawSet.jointSetLimits(rawJoint(joint).handle, axis, -BALL_LIMIT_RAD, BALL_LIMIT_RAD);
        this.tones.push({ joint, hinge: b.hinge !== null });
      });
    });
    this.bodyCount = this.bodies.length;
    this.cur = new Float64Array(this.bodyCount * POSE_STRIDE);
    this.readPose(this.cur);
    this.prev = this.cur.slice();
    this.applyTone();
  }

  /** Runs every step owed up to `simMs` (the presentation sim time), stopping at the freeze. Returns the steps run. */
  advanceTo(simMs: number): number {
    const want = Math.min(MAX_STEPS, stepsOwed(simMs, this.t0Ms));
    let ran = 0;
    while (!this.frozen && this.steps < want) {
      this.step();
      ran++;
    }
    return ran;
  }

  /**
   * The drawn pose at `simMs`, one step behind the simulation: the last two steps interpolated by how far `simMs` is
   * into the current one (a pure function of the sim time). After the freeze, the frozen pose.
   */
  poseAt(simMs: number, out: Float64Array): Float64Array {
    if (this.frozen || this.steps === 0) {
      out.set(this.cur);
      return out;
    }
    const into = (PHYSICS_STEPS_PER_TICK * (simMs - this.t0Ms)) / MS_PER_TICK - this.steps;
    const f = Math.min(1, Math.max(0, into));
    const a = this.prev;
    const b = this.cur;
    for (let k = 0; k < this.bodyCount; k++) {
      const o = k * POSE_STRIDE;
      for (let j = 0; j < 3; j++) out[o + j] = a[o + j] + (b[o + j] - a[o + j]) * f;
      const dot = a[o + 3] * b[o + 3] + a[o + 4] * b[o + 4] + a[o + 5] * b[o + 5] + a[o + 6] * b[o + 6];
      const s = dot < 0 ? -1 : 1;
      let n = 0;
      for (let j = 3; j < 7; j++) {
        out[o + j] = a[o + j] + (s * b[o + j] - a[o + j]) * f;
        n += out[o + j] * out[o + j];
      }
      n = Math.sqrt(n) || 1;
      for (let j = 3; j < 7; j++) out[o + j] /= n;
    }
    return out;
  }

  /** A copy of the latest stepped pose (the bits the determinism tests compare). */
  snapshot(): Float64Array {
    return this.cur.slice();
  }

  /** Frees the world (idempotent): at the freeze, or when the renderer is torn down. */
  dispose(): void {
    if (this.world !== null) {
      this.world.free();
      this.world = null;
    }
  }

  private step(): void {
    const world = this.world;
    if (world === null) return;
    world.step();
    this.steps++;
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
    this.readPose(this.cur);
    this.applyTone();
    let still = true;
    for (const b of this.bodies) {
      const v = b.linvel();
      const w = b.angvel();
      if (Math.hypot(v.x, v.y, v.z) >= FREEZE_LIN_M_S || Math.hypot(w.x, w.y, w.z) >= FREEZE_ANG_RAD_S) {
        still = false;
        break;
      }
    }
    this.quietSteps = still ? this.quietSteps + 1 : 0;
    if (this.quietSteps >= FREEZE_QUIET_STEPS || this.steps >= MAX_STEPS) {
      this.frozen = true;
      this.prev = this.cur.slice();
      this.dispose();
    }
  }

  private readPose(out: Float64Array): void {
    this.bodies.forEach((b, k) => {
      const p = b.translation();
      const q = b.rotation();
      const o = k * POSE_STRIDE;
      out[o] = p.x;
      out[o + 1] = p.y;
      out[o + 2] = p.z;
      out[o + 3] = q.x;
      out[o + 4] = q.y;
      out[o + 5] = q.z;
      out[o + 6] = q.w;
    });
  }

  private ballAxes(): number[] {
    const A = this.R.JointAxis;
    return [A.AngX, A.AngY, A.AngZ];
  }

  /** The decaying tone, written on step 0 and every step until it reaches 0 (then once more, at 0). */
  private applyTone(): void {
    if (this.steps > TONE_STEPS) return;
    const k = TONE_STIFFNESS * Math.max(0, 1 - this.steps / TONE_STEPS);
    const d = k > 0 ? TONE_DAMPING : 0;
    const R = this.R;
    for (const t of this.tones) {
      if (t.hinge) {
        const j = t.joint as RevoluteImpulseJoint;
        j.configureMotorModel(R.MotorModel.AccelerationBased);
        j.configureMotorPosition(0, k, d);
      } else {
        // Rapier 0.21's JS `SphericalImpulseJoint` declares per-axis motors but its runtime class has none: the
        // joint set's own entry points are what the typed methods call.
        const { rawSet, handle } = rawJoint(t.joint);
        for (const axis of this.ballAxes()) {
          rawSet.jointConfigureMotorModel(handle, axis, R.MotorModel.AccelerationBased);
          rawSet.jointConfigureMotorPosition(handle, axis, 0, k, d);
        }
      }
    }
  }
}

interface RawJointSet {
  jointSetLimits(handle: number, axis: number, min: number, max: number): void;
  jointConfigureMotorModel(handle: number, axis: number, model: number): void;
  jointConfigureMotorPosition(handle: number, axis: number, target: number, stiffness: number, damping: number): void;
}

function rawJoint(j: ImpulseJoint): { rawSet: RawJointSet; handle: number } {
  return j as unknown as { rawSet: RawJointSet; handle: number };
}

/** FNV-1a (32-bit) over the bytes of a pose: a short, platform-independent name for its exact bits. */
export function poseDigest(pose: Float64Array): string {
  const bytes = new Uint8Array(pose.buffer, pose.byteOffset, pose.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
