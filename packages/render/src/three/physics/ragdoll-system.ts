/**
 * GH-1223 slice 1: the renderer's ragdolls -- claims, handoffs, stepping, freezing -- behind ONE door
 * (`ThreeRenderer.ts` is the only file outside this folder that may import it; `tools/physics_fence.mjs`).
 *
 * - **Cap:** `RenderQuality.physics.ragdolls` active FIGURES. 0 on every preset today (shipped dark, design L4), and at
 *   0 Rapier is never requested, so `low` -- and every preset until the lead turns it on -- never loads the WASM.
 * - **Claim:** a death the caller deems eligible (seen, in view, not in a catch-up) while figures are free under the
 *   cap. Claims are served in (death tick, entity id) order.
 * - **Handoff:** at `deathTick x 50 + HANDOFF_MS` on the sim clock, the caller's death sequence is taken over: the start
 *   pose is sampled from the death clip (never read off the screen), one world is built for the incident, and the
 *   screen blends into it over `BLEND_MS`.
 * - **Freeze:** when the incident freezes, its last pose stays on the bones and the entity is handed back as a corpse
 *   (`MeshWreck`, through the caller).
 *
 * Presentation only. Nothing here is read by the sim, sent anywhere, or changes an outcome (invariant 4).
 */
import type * as THREE from 'three';
import { liveFigureRoots } from '../units/mesh-death';
import type { MeshUnitEntity, MeshUnitTemplate } from '../units/mesh-unit';
import { MS_PER_TICK } from '../decal-maths';
import { loadRapier, type Rapier } from './rapier';
import {
  BLEND_MS,
  HANDOFF_MS,
  blendFromScreen,
  buildFigures,
  captureScreenPose,
  groundPatch,
  writePose,
  type RagdollDriver,
  type ScreenPose,
} from './ragdoll-rig';
import { POSE_STRIDE, RagdollIncident, type StaticBox } from './ragdoll-world';

/** One death offered to the system. `handle` is the caller's own record of the death sequence (handed back at the
 *  handoff so the caller can drop it), or null for a death nothing else is animating (the showcase). */
export interface RagdollDeath<H> {
  readonly entityId: number;
  readonly deathTick: number;
  readonly entity: MeshUnitEntity;
  readonly template: MeshUnitTemplate;
  /** The sim's own position (tiles, the ground under it) and yaw: the frame the start pose is sampled in. */
  readonly at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  /** World (x, z) unit direction away from the killer. */
  readonly away: readonly [number, number];
  /** The push from the killing weapon's class, m/s; absent = the default (1.0 / 0.4). */
  readonly push?: { readonly horizontalMS: number; readonly upMS: number };
  readonly handle: H | null;
}

export interface RagdollEnv {
  /** The drawn ground's world Y at (x, z) tiles. */
  groundAt(x: number, z: number): number;
  /** Standing footprints near (x, z) tiles, as boxes in world metres. */
  boxesNear(x: number, z: number): StaticBox[];
}

interface Pending<H> {
  readonly death: RagdollDeath<H>;
  readonly tHandoffMs: number;
  readonly figures: number;
}

interface Active {
  readonly entity: MeshUnitEntity;
  readonly inc: RagdollIncident;
  readonly driver: RagdollDriver;
  readonly screen: ScreenPose;
  readonly target: ScreenPose;
  readonly tHandoffMs: number;
  readonly figures: number;
  readonly pose: Float64Array;
}

export interface RagdollUpdate<H> {
  /** Death sequences taken over this frame: the caller stops animating them. */
  readonly taken: H[];
  /** Incidents that froze this frame: their entities, now corpses at rest. */
  readonly settled: { readonly entity: MeshUnitEntity; readonly x: number; readonly z: number }[];
}

export class RagdollSystem<H> {
  readonly cap: number;
  private R: Rapier | null = null;
  private failed = false;
  private readonly pending: Pending<H>[] = [];
  private readonly active: Active[] = [];

  constructor(cap: number, private readonly env: RagdollEnv, load: () => Promise<Rapier> = loadRapier) {
    this.cap = Math.max(0, cap);
    if (this.cap === 0) return;
    load().then(
      (R) => {
        this.R = R;
      },
      (err: unknown) => {
        // No WASM, or it would not compile: every death keeps today's path.
        this.failed = true;
        console.warn('ragdolls: Rapier failed to load; deaths keep the animated fall', err);
      }
    );
  }

  /** Rapier is loaded and the cap is above zero. */
  get ready(): boolean {
    return this.R !== null && !this.failed;
  }

  /** Figures in flight or waiting for their handoff. */
  get figuresInUse(): number {
    let n = 0;
    for (const p of this.pending) n += p.figures;
    for (const a of this.active) n += a.figures;
    return n;
  }

  get incidents(): number {
    return this.pending.length + this.active.length;
  }

  /** Offers a death; true when the system takes it (ready, and its figures fit under the cap). */
  claim(death: RagdollDeath<H>): boolean {
    if (!this.ready) return false;
    const figures = liveFigureRoots(death.entity.root).length;
    if (figures === 0 || this.figuresInUse + figures > this.cap) return false;
    this.pending.push({ death, tHandoffMs: death.deathTick * MS_PER_TICK + HANDOFF_MS, figures });
    this.pending.sort((a, b) => a.death.deathTick - b.death.deathTick || a.death.entityId - b.death.entityId);
    return true;
  }

  /** Hands over every death whose handoff has come, steps every incident to `simMs` (the presentation sim time),
   *  writes their poses, and reports what was taken and what froze. */
  update(simMs: number): RagdollUpdate<H> {
    const taken: H[] = [];
    const settled: { entity: MeshUnitEntity; x: number; z: number }[] = [];
    const R = this.R;
    if (R === null) return { taken, settled };
    while (this.pending.length > 0 && this.pending[0].tHandoffMs <= simMs) {
      const p = this.pending.shift()!;
      this.active.push(this.handOff(R, p));
      if (p.death.handle !== null) taken.push(p.death.handle);
    }
    for (let k = this.active.length - 1; k >= 0; k--) {
      const a = this.active[k];
      a.inc.advanceTo(simMs);
      this.draw(a, simMs);
      if (!a.inc.frozen) continue;
      this.active.splice(k, 1);
      settled.push({ entity: a.entity, x: a.entity.root.position.x, z: a.entity.root.position.z });
    }
    return { taken, settled };
  }

  /** Frees every world. Returns the entities only this system holds (in flight, or a showcase death still waiting);
   *  a pending death with a handle is still the caller's. */
  dispose(): MeshUnitEntity[] {
    const held = [...this.active.map((a) => a.entity), ...this.pending.filter((p) => p.death.handle === null).map((p) => p.death.entity)];
    for (const a of this.active) a.inc.dispose();
    this.active.length = 0;
    this.pending.length = 0;
    return held;
  }

  private handOff(R: Rapier, p: Pending<H>): Active {
    const d = p.death;
    const screen = captureScreenPose(d.entity.root);
    const { figures, driver } = buildFigures(d.entity, d.template, d.at, {
      entityId: d.entityId,
      deathTick: d.deathTick,
      away: d.away,
      push: d.push,
    });
    const target = captureScreenPose(d.entity.root);
    const inc = new RagdollIncident(R, {
      t0Ms: p.tHandoffMs,
      figures,
      ground: groundPatch(d.at.x, d.at.z, (x, z) => this.env.groundAt(x, z)),
      boxes: this.env.boxesNear(d.at.x, d.at.z),
    });
    return {
      entity: d.entity,
      inc,
      driver,
      screen,
      target,
      tHandoffMs: p.tHandoffMs,
      figures: p.figures,
      pose: new Float64Array(inc.bodyCount * POSE_STRIDE),
    };
  }

  /** The sampled pose (every bone), the bodies on it, then the blend from the screen while it lasts. */
  private draw(a: Active, simMs: number): void {
    const t = a.target;
    t.bones.forEach((b: THREE.Bone, i: number) => {
      b.position.copy(t.p[i]);
      b.quaternion.copy(t.q[i]);
      b.scale.copy(t.s[i]);
    });
    a.entity.root.position.copy(t.rootP);
    a.entity.root.rotation.y = t.rootYaw;
    a.entity.root.updateMatrixWorld(true);
    writePose(a.driver, a.inc.poseAt(simMs, a.pose));
    blendFromScreen(a.screen, a.entity.root, (simMs - a.tHandoffMs) / BLEND_MS);
  }
}
