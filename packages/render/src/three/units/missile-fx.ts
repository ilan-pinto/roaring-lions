/**
 * GH-250 T5: `MissileFx`, one controller owning every draw for an ATGM/RPG/
 * HEAT round in flight -- the body streak (`./fx.ts`'s `liftedSegmentQuad`,
 * this task's own extraction), the halo+core glow and the smoke trail
 * (`./missile-trail.ts`, Task 3), and the flight model itself (`./missiles.ts`,
 * Task 2).
 *
 * This is a controller and not three more fields on `ThreeRenderer` for two
 * reasons, spec D5:
 *
 *  - **`ThreeRenderer` already owns a `TracerBatch`/`ShellBatch` pair per
 *    ground lane** (direct fire, indirect fire), each a single mesh with a
 *    single writer. A missile needs THREE meshes that share one flight list
 *    and one trail pool -- bolting that onto `ThreeRenderer` directly would
 *    mean three more fields, three more dispose calls, and the missile/trail
 *    bookkeeping (`missiles: MissileModel[]`, `trail: TrailPool`) spread
 *    across the renderer's own per-frame method instead of owned by the one
 *    thing that actually needs it.
 *  - **The ground lane's overlap.** `ShellBatch`'s own doc comment already
 *    lives beside `TracerBatch`/the below-tier `ParticleInstancer` because
 *    all three share `createTracerMaterial`/`tracerIndexBuffer`/
 *    `particleBillboardGeometry`/`createParticleMaterial` outright. A
 *    missile's own three meshes are built from the SAME four primitives
 *    (`liftedSegmentQuad` for the body, `particleBillboardGeometry` for the
 *    sprite/core instancers) -- a class that assembles them once, in the pooled-
 *    manager shape every other multi-mesh FX kind in this backend already
 *    uses, keeps that reuse in one place rather than duplicating the
 *    construction boilerplate inline in `ThreeRenderer`.
 *
 * `ThreeRenderer.ts` (Task 6) is expected to hold exactly one `MissileFx` and
 * add its three `meshes` to the scene, the same shape it already gives
 * `TracerBatch`/`ShellBatch`/`ParticleInstancer`.
 */
import * as THREE from 'three';
import type { EmitterSpec } from '../../vfx';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { hexToLinear } from '../terrain/shared';
import { groundWorldY, type ElevationSource } from '../ground-height';
import {
  liftedSegmentQuad,
  tracerIndexBuffer,
  createTracerMaterial,
  createParticleMaterial,
  particleBillboardGeometry,
} from './fx';
import { FX_RENDER_ORDER, FX_RENDER_ORDER_ADDITIVE } from './render-order';
import {
  MISSILE_CAPACITY,
  spawnMissile,
  pushMissile,
  stepMissiles,
  interceptMissiles,
  missileGroundDist,
  missilePointAt,
  missileProgress,
  type MissileModel,
  type MissileLaunch,
  type MissileLanding,
  type TargetTrack,
} from './missiles';
import {
  TrailPool,
  trailLookFrom,
  emitAlongFlight,
  missileIgnited,
  writeMissileSprites,
  TRAIL_CAPACITY,
  MISSILE_BODY_TILES,
  MISSILE_BODY_WIDTH_PX,
  MISSILE_BODY_COLOR_KEY,
  type TrailLook,
  type SpriteBuffers,
} from './missile-trail';

export const MISSILE_TRAIL_EMITTER_ID = 'missile_trail';
export const MISSILE_IMPACT_EMITTER_ID = 'missile_impact';
export const MISS_SCORCH_POWER = 0.15;

/**
 * The ONE ground-lerp-plus-lift formula every world-Y this file draws goes
 * through -- `shellSegmentQuad`'s own rule without `SHELL_LIFT_PX`, since a
 * missile's own `liftPx` (`missilePointAt`) already carries N7's ground/air
 * launch and impact lift. Fix round 1 (review finding): this used to be
 * written out three times (the `emitAlongFlight` callback, the body quad's
 * `aY`/`bY`, and `missileWorldY` below) -- one copy here, called from all
 * three, so a future change to the lift rule cannot update two of the three
 * and silently miss the third.
 */
function lerpMissileWorldY(launchY: number, impactY: number, u: number, liftPx: number): number {
  return launchY + (impactY - launchY) * u + liftPx * WORLD_Y_PER_LIFT_PIXEL;
}

/** Ground-relative world Y of a missile's flight at progress `u`, for
 *  `writeMissileSprites`'s own `worldYAt` callback. A puff stores the
 *  absolute `worldY` it was emitted at (`TrailPool.emit`), so it never
 *  bulges over a ridge it drifts across -- this function is only ever asked
 *  for the CURRENT flight position, never re-evaluated for a puff already
 *  laid down. */
function missileWorldY(m: MissileModel, u: number, elevation: ElevationSource, w: number, h: number): number {
  const launchY = groundWorldY(elevation, w, h, m.sx, m.sy);
  const impactY = groundWorldY(elevation, w, h, m.tx, m.ty);
  return lerpMissileWorldY(launchY, impactY, u, missilePointAt(m, u).liftPx);
}

export class MissileFx {
  readonly missiles: MissileModel[] = [];
  readonly trail: TrailPool = new TrailPool(TRAIL_CAPACITY);

  /** The body streak -- one batched `THREE.Mesh`, `liftedSegmentQuad`'s own
   *  shape, capacity `MISSILE_CAPACITY` quads (one per missile in flight). */
  readonly bodyMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Halo + smoke trail, one `InstancedMesh`, capacity `TRAIL_CAPACITY +
   *  MISSILE_CAPACITY` -- every live trail puff plus one halo per ignited
   *  missile. */
  readonly spriteMesh: THREE.InstancedMesh;
  /** The hot additive-tier core glow, one per ignited missile, capacity
   *  `MISSILE_CAPACITY`. */
  readonly coreMesh: THREE.InstancedMesh;

  private readonly bodyPositions: Float32Array;
  private readonly bodyColors: Float32Array;
  private readonly bodyAlphas: Float32Array;
  private readonly bodyPositionAttr: THREE.BufferAttribute;
  private readonly bodyColorAttr: THREE.BufferAttribute;
  private readonly bodyAlphaAttr: THREE.BufferAttribute;

  private readonly spriteColorAttr: THREE.InstancedBufferAttribute;
  private readonly spriteAlphaAttr: THREE.InstancedBufferAttribute;
  private readonly spriteSoftAttr: THREE.InstancedBufferAttribute;
  private readonly spriteScratch: SpriteBuffers;

  private readonly coreColorAttr: THREE.InstancedBufferAttribute;
  private readonly coreAlphaAttr: THREE.InstancedBufferAttribute;
  private readonly coreSoftAttr: THREE.InstancedBufferAttribute;
  private readonly coreScratch: SpriteBuffers;

  private readonly scratchMatrix = new THREE.Matrix4();

  private look: TrailLook | null = null;
  private bodyColor: readonly [number, number, number] = [0, 0, 0];
  private debugHidden = false;

  /** The CURRENT missile's own launch/impact ground height, set once per
   *  missile per `step()` call, just before that missile's `emitAlongFlight`
   *  call -- what `trailWorldYAt` below reads instead of closing over the
   *  missile or its ground height directly. See `trailWorldYAt`'s own doc
   *  comment for why. */
  private curLaunchY = 0;
  private curImpactY = 0;

  /**
   * Fix round 1 (review finding): bound ONCE, here, as a class field
   * initializer -- not a fresh arrow function built inside `step()`'s own
   * per-missile loop. The old shape built a new closure every missile every
   * frame, capturing that missile, `elevation`, `w` and `h` from the
   * enclosing scope purely to recompute `groundWorldY` on every one of
   * `emitAlongFlight`'s (possibly several) calls per missile -- exactly the
   * per-frame allocation the writers in this backend are built to avoid
   * (`fx.ts`'s own `cachedHexToLinear`, `missile-trail.ts`'s own, make the
   * identical argument for a hex-to-rgb conversion; this is the same
   * argument for a closure). This callback instead reads `curLaunchY`/
   * `curImpactY` -- two plain fields `step()` sets once per missile, right
   * before handing this SAME function reference to `emitAlongFlight` -- so
   * the missile and its ground height never need to be captured at all.
   * `missile-fx.test.ts`'s own identity test (added alongside this fix) pins
   * that the reference `emitAlongFlight` receives never changes, missile to
   * missile or frame to frame.
   */
  private readonly trailWorldYAt = (_m: MissileModel, liftPx: number, u: number): number =>
    lerpMissileWorldY(this.curLaunchY, this.curImpactY, u, liftPx);

  constructor() {
    // --- Body mesh: liftedSegmentQuad's own shape, one quad per missile. ---
    this.bodyPositions = new Float32Array(MISSILE_CAPACITY * 4 * 3);
    this.bodyColors = new Float32Array(MISSILE_CAPACITY * 4 * 3);
    this.bodyAlphas = new Float32Array(MISSILE_CAPACITY * 4);
    this.bodyPositionAttr = new THREE.BufferAttribute(this.bodyPositions, 3);
    this.bodyPositionAttr.setUsage(THREE.DynamicDrawUsage);
    this.bodyColorAttr = new THREE.BufferAttribute(this.bodyColors, 3);
    this.bodyColorAttr.setUsage(THREE.DynamicDrawUsage);
    this.bodyAlphaAttr = new THREE.BufferAttribute(this.bodyAlphas, 1);
    this.bodyAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    const bodyGeometry = new THREE.BufferGeometry();
    bodyGeometry.setAttribute('position', this.bodyPositionAttr);
    bodyGeometry.setAttribute('aColor', this.bodyColorAttr);
    bodyGeometry.setAttribute('aAlpha', this.bodyAlphaAttr);
    bodyGeometry.setIndex(new THREE.BufferAttribute(tracerIndexBuffer(MISSILE_CAPACITY), 1));
    bodyGeometry.setDrawRange(0, 0);
    this.bodyMesh = new THREE.Mesh(bodyGeometry, createTracerMaterial(true));
    this.bodyMesh.renderOrder = FX_RENDER_ORDER;
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.visible = false;

    // --- Sprite mesh: halo (per ignited missile) + smoke trail puffs. ---
    const spriteCapacity = TRAIL_CAPACITY + MISSILE_CAPACITY;
    const spriteGeo = particleBillboardGeometry();
    const spriteGeometry = new THREE.BufferGeometry();
    spriteGeometry.setAttribute('position', new THREE.BufferAttribute(spriteGeo.positions, 3));
    spriteGeometry.setAttribute('aLocal', new THREE.BufferAttribute(spriteGeo.local, 2));
    spriteGeometry.setIndex(new THREE.BufferAttribute(spriteGeo.indices, 1));
    this.spriteColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(spriteCapacity * 3), 3);
    this.spriteAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(spriteCapacity), 1);
    this.spriteSoftAttr = new THREE.InstancedBufferAttribute(new Float32Array(spriteCapacity), 1);
    spriteGeometry.setAttribute('aColor', this.spriteColorAttr);
    spriteGeometry.setAttribute('aAlpha', this.spriteAlphaAttr);
    spriteGeometry.setAttribute('aSoft', this.spriteSoftAttr);
    this.spriteMesh = new THREE.InstancedMesh(spriteGeometry, createParticleMaterial(true, false), spriteCapacity);
    this.spriteMesh.count = 0;
    this.spriteMesh.renderOrder = FX_RENDER_ORDER;
    this.spriteMesh.frustumCulled = false;
    this.spriteMesh.visible = false;
    this.spriteScratch = {
      positions: new Float32Array(spriteCapacity * 3),
      colors: this.spriteColorAttr.array as Float32Array,
      alphas: this.spriteAlphaAttr.array as Float32Array,
      scales: new Float32Array(spriteCapacity),
      softs: this.spriteSoftAttr.array as Float32Array,
    };

    // --- Core mesh: the hot additive-tier glow, one per ignited missile. ---
    const coreCapacity = MISSILE_CAPACITY;
    const coreGeo = particleBillboardGeometry();
    const coreGeometry = new THREE.BufferGeometry();
    coreGeometry.setAttribute('position', new THREE.BufferAttribute(coreGeo.positions, 3));
    coreGeometry.setAttribute('aLocal', new THREE.BufferAttribute(coreGeo.local, 2));
    coreGeometry.setIndex(new THREE.BufferAttribute(coreGeo.indices, 1));
    this.coreColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(coreCapacity * 3), 3);
    this.coreAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(coreCapacity), 1);
    this.coreSoftAttr = new THREE.InstancedBufferAttribute(new Float32Array(coreCapacity), 1);
    coreGeometry.setAttribute('aColor', this.coreColorAttr);
    coreGeometry.setAttribute('aAlpha', this.coreAlphaAttr);
    coreGeometry.setAttribute('aSoft', this.coreSoftAttr);
    this.coreMesh = new THREE.InstancedMesh(coreGeometry, createParticleMaterial(true, true), coreCapacity);
    this.coreMesh.count = 0;
    this.coreMesh.renderOrder = FX_RENDER_ORDER_ADDITIVE;
    this.coreMesh.frustumCulled = false;
    this.coreMesh.visible = false;
    this.coreScratch = {
      positions: new Float32Array(coreCapacity * 3),
      colors: this.coreColorAttr.array as Float32Array,
      alphas: this.coreAlphaAttr.array as Float32Array,
      scales: new Float32Array(coreCapacity),
      softs: this.coreSoftAttr.array as Float32Array,
    };
  }

  get meshes(): THREE.Object3D[] {
    return [this.bodyMesh, this.spriteMesh, this.coreMesh];
  }

  /** `em` is `null` before `ThreeRenderer.useEmitters` has wired the shipped
   *  `missile_trail` emitter in -- `trailLookFrom` itself returns `null` for
   *  that, and every write below is gated on `this.look !== null`. */
  setLook(em: EmitterSpec | null, resolve: (k: string) => string): void {
    this.look = trailLookFrom(em, resolve);
    this.bodyColor = hexToLinear(resolve(MISSILE_BODY_COLOR_KEY));
  }

  launch(l: MissileLaunch): MissileModel | null {
    const m = spawnMissile(l);
    if (m === null) return null;
    pushMissile(this.missiles, m);
    return m;
  }

  step(dt: number, track: TargetTrack, elevation: ElevationSource, w: number, h: number): MissileLanding[] {
    const landings = stepMissiles(this.missiles, dt, track);

    // --- Trail emission + body quads: ONE pass over the missiles, so each
    // missile's own launch/impact ground height (`curLaunchY`/`curImpactY`)
    // is computed exactly once per missile per step, not once per site that
    // used to need it (fix round 1 -- see `trailWorldYAt`'s own doc comment).
    // Emitting before `trail.step(dt)` (below, unchanged) still runs for every
    // missile before any puff is aged, preserving the original ordering: a
    // puff emitted this frame gets age 0, not `dt`.
    const look = this.look;
    let bodyQuadCount = 0;
    const [br, bg, bb] = this.bodyColor;
    for (const m of this.missiles) {
      this.curLaunchY = groundWorldY(elevation, w, h, m.sx, m.sy);
      this.curImpactY = groundWorldY(elevation, w, h, m.tx, m.ty);

      if (look !== null) {
        emitAlongFlight(this.trail, m, look, this.trailWorldYAt);
      }

      if (bodyQuadCount < MISSILE_CAPACITY && missileIgnited(m)) {
        const groundDist = missileGroundDist(m);
        const progress = missileProgress(m);
        const tailU = groundDist > 0 ? Math.max(0, progress - MISSILE_BODY_TILES / groundDist) : 0;
        const a = missilePointAt(m, tailU);
        const b = missilePointAt(m, progress);
        const aY = lerpMissileWorldY(this.curLaunchY, this.curImpactY, tailU, a.liftPx);
        const bY = lerpMissileWorldY(this.curLaunchY, this.curImpactY, progress, b.liftPx);
        const quad = liftedSegmentQuad(a.x, a.y, aY, b.x, b.y, bY, MISSILE_BODY_WIDTH_PX, MISSILE_BODY_WIDTH_PX);
        this.bodyPositions.set(quad, bodyQuadCount * 12);
        for (let v = 0; v < 4; v++) {
          const ci = bodyQuadCount * 12 + v * 3;
          this.bodyColors[ci] = br;
          this.bodyColors[ci + 1] = bg;
          this.bodyColors[ci + 2] = bb;
          this.bodyAlphas[bodyQuadCount * 4 + v] = 1;
        }
        bodyQuadCount++;
      }
    }

    this.trail.step(dt);

    this.bodyPositionAttr.needsUpdate = true;
    this.bodyColorAttr.needsUpdate = true;
    this.bodyAlphaAttr.needsUpdate = true;
    this.bodyMesh.geometry.setDrawRange(0, bodyQuadCount * 6);
    this.bodyMesh.visible = bodyQuadCount > 0 && !this.debugHidden;

    // --- Sprites: halo + core per ignited missile, then the trail puffs. ---
    let softCount = 0;
    let coreCount = 0;
    if (this.look !== null) {
      const counts = writeMissileSprites(
        this.missiles,
        this.trail,
        this.look,
        (m, u) => missileWorldY(m, u, elevation, w, h),
        this.spriteScratch,
        this.coreScratch
      );
      softCount = counts.soft;
      coreCount = counts.core;
      for (let i = 0; i < softCount; i++) {
        this.scratchMatrix.makeScale(this.spriteScratch.scales[i], this.spriteScratch.scales[i], this.spriteScratch.scales[i]);
        this.scratchMatrix.setPosition(
          this.spriteScratch.positions[i * 3],
          this.spriteScratch.positions[i * 3 + 1],
          this.spriteScratch.positions[i * 3 + 2]
        );
        this.spriteMesh.setMatrixAt(i, this.scratchMatrix);
      }
      for (let i = 0; i < coreCount; i++) {
        this.scratchMatrix.makeScale(this.coreScratch.scales[i], this.coreScratch.scales[i], this.coreScratch.scales[i]);
        this.scratchMatrix.setPosition(
          this.coreScratch.positions[i * 3],
          this.coreScratch.positions[i * 3 + 1],
          this.coreScratch.positions[i * 3 + 2]
        );
        this.coreMesh.setMatrixAt(i, this.scratchMatrix);
      }
    }
    this.spriteMesh.count = softCount;
    this.spriteMesh.instanceMatrix.needsUpdate = true;
    this.spriteColorAttr.needsUpdate = true;
    this.spriteAlphaAttr.needsUpdate = true;
    this.spriteSoftAttr.needsUpdate = true;
    this.spriteMesh.visible = softCount > 0 && !this.debugHidden;

    this.coreMesh.count = coreCount;
    this.coreMesh.instanceMatrix.needsUpdate = true;
    this.coreColorAttr.needsUpdate = true;
    this.coreAlphaAttr.needsUpdate = true;
    this.coreSoftAttr.needsUpdate = true;
    this.coreMesh.visible = coreCount > 0 && !this.debugHidden;

    return landings;
  }

  intercept(target: number): MissileLanding[] {
    return interceptMissiles(this.missiles, target);
  }

  /** Returns 3 -- the number of meshes this hides, matching P-5's debug-layer
   *  contract (`debug-layers.ts`, Task 6). Takes effect on the next `step`,
   *  not immediately: visibility is a `step`-time derived value, exactly like
   *  every other mesh's `count > 0` gate. */
  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    return 3;
  }

  dispose(): void {
    this.bodyMesh.geometry.dispose();
    this.bodyMesh.material.dispose();
    this.spriteMesh.geometry.dispose();
    (this.spriteMesh.material as THREE.Material).dispose();
    this.coreMesh.geometry.dispose();
    (this.coreMesh.material as THREE.Material).dispose();
  }
}
