/**
 * Task B3.13: combat feedback on screen. `vfx/particles.ts`'s `ParticleSystem`
 * (Task B3.12) is already backend-agnostic -- `spawn`/`step`/`forEachLive` are
 * pure struct-of-arrays maths, and `forEachLive` is a read path that names no
 * graphics library at all. `./tracers.ts` (also B3.12) is the same pure port
 * of Pixi's tracer model. Neither is reimplemented here: this module is the
 * three.js *draw*, built the same way `units/instances.ts` is -- pure
 * geometry/attribute arithmetic first (testable in `environment: 'node'`),
 * `THREE.*` GPU construction after the divider below.
 *
 * ## What happened to `FX_LAYER_BELOW`/`FX_LAYER_ABOVE`
 *
 * Pixi's `fxG` (below `spriteLayer`) and `fxAboveG` (above it) exist because
 * Pixi has no depth buffer -- draw order IS depth there, so "does this effect
 * sit in front of or behind units" has to be decided by which Graphics a
 * particle lands on, once, at spawn time, and held for its whole life
 * regardless of where either the particle or the units around it move to.
 *
 * three.js has no such question to answer. A particle carries a real world
 * position (`writeParticleInstances` below writes it at the particle's own
 * `(x, y)` tile-space coordinates, height included); the particle material
 * below is `transparent: true, depthTest: true, depthWrite: true` -- the
 * IDENTICAL recipe `units/instances.ts`'s `createUnitMaterial` uses, for the
 * identical reason (see that file's own "unit-vs-tree tie" section): three.js
 * finishes every opaque draw (terrain) before any transparent one, and among
 * transparent draws (units, particles, tracers, all of them) the standard
 * `LessEqualDepth` test resolves each pixel by genuine proximity to the
 * camera, independent of which object happened to submit first. A below-layer
 * puff at a unit's feet and an above-layer streak passing over its head are
 * now the same case: whichever is actually nearer wins, per pixel, every
 * frame -- which is a STRICTLY more correct answer than "always behind" or
 * "always in front" for an effect that can move relative to what is around
 * it. So the two-layer split does not port. `ParticleSystem.forEachLive`
 * still takes a `layerIdx` (it is `particles.ts`'s contract, not this
 * module's to change), so `writeParticleInstances` below simply visits BOTH
 * layers into the same instance buffer -- one draw call, no layer distinction
 * surviving past that visit.
 *
 * ## The `trailG`/`fxG`/`wreckLayer`-below-`spriteLayer` debt does not exist here
 *
 * CLAUDE.md's "Known scaling debts" records that Pixi's `fxG` (tracers,
 * particles) sits below `spriteLayer` (raised terrain, buildings)
 * UNCONDITIONALLY -- a tracer genuinely in front of a ridge is still drawn
 * behind it, because "in front of" is never asked; the Graphics container
 * order already decided the answer before either object's position mattered.
 * That is precisely the class of bug a real depth buffer cannot have: this
 * module's tracers and particles are placed at real world positions (see
 * `tracerQuadPositions`, `writeParticleInstances`) and share the exact
 * transparent/depthTest/depthWrite recipe terrain and units already resolve
 * their own tie against, per the paragraph above. A tracer nearer the camera
 * than a ridge's own near face draws over it; one farther is correctly
 * hidden. Neither the debt nor a version of it was introduced writing this
 * file -- there is no unconditional container order left to reintroduce it
 * into.
 *
 * ## Elevation lift is deliberately NOT applied to particles or tracers
 *
 * Pixi's own particle/tracer/puff draw calls (`particles.ts`'s `draw`,
 * `renderer.ts`'s tracer and puff loops) never call `groundOffset` --
 * unlike every unit, mark and structure sprite, VFX in the shipping game
 * ignores elevation entirely and draws at a small FIXED screen-pixel lift
 * above flat ground (-3px for particles/puffs, -4px for tracers). CLAUDE.md's
 * own "Known scaling debts" names this directly: "VFX are not lifted to
 * terrain height" is one of the three gaps the E1-E3 elevation milestone
 * left inert on purpose, dormant only because no shipped map had authored
 * relief yet. This module reproduces that same flat lift (`PARTICLE_LIFT_PX`,
 * `TRACER_LIFT_PX`, run through `WORLD_Y_PER_LIFT_PIXEL` the same way every
 * other screen-pixel nudge in this backend is) rather than reaching for
 * `groundWorldY` -- fixing an acknowledged, tracked, out-of-scope gap here
 * would be a silent behaviour change relative to Pixi on the one map
 * (Tel Marum) where it would actually show, and "particles must appear where
 * Pixi's do" is this task's own browser-check bar.
 *
 * That gap turns out to be MORE visible here than the CLAUDE.md bullet
 * implies, and the B3.13 browser check found the concrete shape of it: since
 * every OTHER piece of terrain/unit geometry in this backend IS real depth,
 * a particle whose fixed lift sits below the actual ground it is drawn over
 * does not merely draw "at the wrong height" the way it would in Pixi's flat
 * 2D -- it is genuinely, physically buried by the opaque ground/terrace
 * geometry above it and does not render at all. Confirmed two ways in the
 * browser: (1) on flat ground (elevation 0, matching `PARTICLE_LIFT_PX`'s own
 * assumption), a particle whose own radius exceeds the ~3px lift still
 * partially sinks into the ground plane and shows a flat-bottomed silhouette
 * -- expected for a large burst (a 120mm hit, `catastrophic_kill.json`'s
 * `size_px` up to 52), invisible for the small-arms scale (`size_px` 2-3)
 * this system spends most of its particles on; (2) on Tel Marum, EVERY tile
 * this map authors is elevation >= 1, and one elevation level
 * (`WORLD_PER_LEVEL`, ~0.255 world units) already dwarfs the 3px lift
 * (~0.077 world units) by more than 3x -- so a particle spawned anywhere on
 * that map's own ground is buried under its own local terrace regardless of
 * any ridge, ranging from partial to total depending on the tile. Neither
 * finding changes the ruling above -- the fix is still `groundWorldY`, still
 * out of scope, still Tel Marum's alone to need -- but "dormant" undersells
 * it: the moment relief exists, particles on it do not degrade, they
 * disappear.
 */
import * as THREE from 'three';
import type { ParticleSystem } from '../../vfx';
import { WORLD_Y_PER_LIFT_PIXEL, isoX, isoY } from '../../project';
import { screenOffsetToWorld, hexToUnit } from '../terrain/shared';
import { tracerAlpha, type TracerModel } from './tracers';

// ---------------------------------------------------------------------------
// Pure: geometry and per-instance attribute arithmetic. No THREE.* GPU
// objects below this line yet -- mirrors instances.ts's own split, for the
// same reason: `ParticleInstancer`/`TracerBatch` construction needs nothing
// headless cannot provide, but nothing here needs even that much.
// ---------------------------------------------------------------------------

/** Same capacity Pixi's `ParticleSystem` is built with, `renderer.ts:644`.
 *  Sizing the `InstancedMesh` to the identical number means a live particle
 *  can never outrun what this backend can draw -- the two capacities are the
 *  same pool by construction (`ParticleSystem`'s `layerIdx` is not a second,
 *  per-layer capacity; see `particles.ts`'s own doc comment), so this number
 *  is not a separate guess, it is the one true ceiling reused. */
export const PARTICLE_CAPACITY = 2048;

/**
 * Ceiling on simultaneously-live tracers this backend will draw.
 *
 * Unlike particles, Pixi's own `tracers` array is unbounded (nothing evicts
 * a tracer early; only `TRACER_LIFETIME_S` retires one). An `InstancedMesh`/
 * batched `BufferGeometry` needs a fixed capacity, so this picks one:
 * `TRACER_LIFETIME_S` (150 ms) times a deliberately generous fire cadence
 * (5 shots/s per shooter, well above any authored weapon's real rate) times
 * the GDD's 300-unit target gives ~225 concurrent tracers in the worst
 * physically-plausible case; 512 leaves better than 2x headroom over that
 * without being large enough to matter for the one draw call's vertex count
 * (512 * 4 verts = 2048, the same order of magnitude as the particle pool).
 */
export const TRACER_CAPACITY = 512;

/** Screen-pixel lift a particle draws at above flat ground, matching
 *  `particles.ts`'s own `draw()`: `isoY(x, y) - 3`. See this file's top
 *  comment, "Elevation lift is deliberately NOT applied". Exported (like
 *  `TRACER_LIFT_PX`/`TRACER_WIDTH_PX` below) so `fx.test.ts` can check the
 *  actual documented relationship between the two lifts rather than
 *  hardcoding a duplicate literal. */
export const PARTICLE_LIFT_PX = 3;
/** Screen-pixel lift a tracer draws at, matching `renderer.ts:2599`'s
 *  `isoY(t.sx, t.sy) - 4`. */
export const TRACER_LIFT_PX = 4;
/** Tracer ribbon width in screen pixels, matching `renderer.ts:2601`'s
 *  `stroke({ width: 1.5, ... })`. */
export const TRACER_WIDTH_PX = 1.5;

/**
 * Below this alpha, a fragment is discarded outright rather than blended.
 *
 * Same mechanism and same value as `instances.ts`'s `ALPHA_PADDING_DISCARD`,
 * for an analogous (not identical) reason: with `depthWrite: true` -- needed
 * so a particle or tracer genuinely occludes what stands behind it, exactly
 * the depth-buffer story this file's top comment tells -- a fragment that
 * blended at alpha near 0 would still commit real depth, invisibly occluding
 * whatever is actually behind it. `particles.ts`'s own `forEachLive` already
 * skips `alpha <= 0` before this module ever sees it (`particles.ts:203`),
 * but a particle mid-fade at, say, alpha 0.005 would otherwise still pass
 * through and write depth nobody can see the consequence of not writing.
 */
const FX_ALPHA_DISCARD = 0.02;

/** Plain-array quad geometry for the particle billboard every particle
 *  instance shares, in "per one screen pixel of radius" units -- an
 *  instance's own `radius` (from `ParticleSystem.forEachLive`) scales it via
 *  the instance matrix, so this is built once, not per particle per frame. */
export interface ParticleBillboardGeometry {
  /** xyz triples, three.js world space, per 1px of the eventual instance
   *  radius. Four vertices: bottom-left, bottom-right, top-right, top-left. */
  positions: Float32Array;
  /** Local (-1..1, -1..1) coordinate per vertex, same order as `positions`
   *  -- the circle cutout test in the fragment shader below reads this
   *  directly rather than deriving it from `uv`, since there is no texture
   *  here for a `uv` to address. */
  local: Float32Array;
  indices: Uint32Array;
}

/**
 * The camera-facing quad every particle instance shares, built on the exact
 * two axes `unitBillboardGeometry` (`instances.ts`) uses -- `right =
 * screenOffsetToWorld(1, 0)` for the horizontal axis, `WORLD_Y_PER_LIFT_PIXEL`
 * for the vertical -- because both are already calibrated so that 1 unit
 * along either axis, in this convention, reprojects to 1 equal screen pixel
 * (that calibration is what lets `unitBillboardGeometry` draw a SQUARE sprite
 * frame without distortion; a particle's circle needs the identical
 * property, or it would render as an ellipse). Centred on (0, 0, 0) rather
 * than anchored at 0..drawPx the way a unit's feet are -- a particle's own
 * world position IS its centre, matching Pixi's `g.circle(cx, cy, r)`.
 */
export function particleBillboardGeometry(): ParticleBillboardGeometry {
  const right = screenOffsetToWorld(1, 0);
  const corner = (rightPx: number, upPx: number): [number, number, number] => [
    right.dx * rightPx,
    upPx * WORLD_Y_PER_LIFT_PIXEL,
    right.dy * rightPx,
  ];
  const bl = corner(-1, -1);
  const br = corner(1, -1);
  const tr = corner(1, 1);
  const tl = corner(-1, 1);
  return {
    positions: Float32Array.from([...bl, ...br, ...tr, ...tl]),
    local: Float32Array.from([-1, -1, 1, -1, 1, 1, -1, 1]),
    // Identical corner convention (bl, br, tr, tl) on the identical two axes
    // as unitBillboardGeometry -- the winding this camera needs was already
    // derived and tested there (instances.ts's own top comment, "The
    // unit-vs-tree tie"); centring the quad doesn't change which way it
    // faces, only where its own local origin sits.
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  };
}

/** Per-instance GPU attribute arrays `writeParticleInstances` fills, sized
 *  (by the caller) to `PARTICLE_CAPACITY`. */
export interface ParticleInstanceBuffers {
  /** xyz triples, world space -- the translation each instance's
   *  `instanceMatrix` gets. */
  positions: Float32Array;
  /** rgb triples in 0..1, one per instance. */
  colors: Float32Array;
  /** One alpha per instance. */
  alphas: Float32Array;
  /** World-space uniform scale per instance -- `particleBillboardGeometry`'s
   *  quad is built in "per 1px of radius" units, so this IS the particle's
   *  own screen-pixel radius, applied as `Matrix4.makeScale`. */
  scales: Float32Array;
}

/**
 * Visits every live particle across BOTH of `ParticleSystem`'s draw layers
 * (see this file's top comment for why the distinction does not survive
 * into a single instance buffer) and writes GPU-facing attributes. Pure
 * aside from the `forEachLive` callback boundary -- no `THREE.*` touched,
 * so this is exercised directly in `fx.test.ts` with a real `ParticleSystem`
 * (itself Pixi-free) rather than needing a `WebGLRenderer`.
 *
 * Returns the number of instances written, which the caller sets
 * `mesh.count` to -- the only "hide an instance" mechanism an
 * `InstancedMesh` has, exactly `writeUnitInstances`'s own contract.
 */
export function writeParticleInstances(particles: ParticleSystem, out: ParticleInstanceBuffers): number {
  const capacity = out.alphas.length;
  let count = 0;
  const liftY = PARTICLE_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
  const visit = (x: number, y: number, color: string, alpha: number, radius: number): void => {
    if (count >= capacity) return;
    const [r, g, b] = hexToUnit(color);
    out.positions[count * 3] = x;
    out.positions[count * 3 + 1] = liftY;
    out.positions[count * 3 + 2] = y;
    out.colors[count * 3] = r;
    out.colors[count * 3 + 1] = g;
    out.colors[count * 3 + 2] = b;
    out.alphas[count] = alpha;
    out.scales[count] = radius;
    count++;
  };
  particles.forEachLive(0, visit);
  particles.forEachLive(1, visit);
  return count;
}

/**
 * World-space corners of one tracer's ribbon quad -- a thin rectangle from
 * the shooter's position to the target's, `TRACER_WIDTH_PX` wide in SCREEN
 * pixels regardless of the shot's own bearing.
 *
 * World X/Z here are `t.sx`/`t.sy`/`t.tx`/`t.ty` directly, unprojected --
 * `camera.ts`'s own documented convention, "game tile (x, y) is three.js
 * (x, elevation, y)". `isoX`/`isoY` (`project.ts`) are used ONLY to find the
 * shot's on-SCREEN direction, so the perpendicular offset -- computed in
 * screen space, then converted back to a world delta via
 * `screenOffsetToWorld` -- keeps the ribbon's width constant on screen no
 * matter which way the shot points, the same guarantee `stroke({width:
 * 1.5})` gives Pixi for free from a 2D API this backend does not have.
 */
export function tracerQuadPositions(t: TracerModel): Float32Array {
  const dxScreen = isoX(t.tx, t.ty) - isoX(t.sx, t.sy);
  const dyScreen = isoY(t.tx, t.ty) - isoY(t.sx, t.sy);
  const len = Math.hypot(dxScreen, dyScreen);
  // A zero-length shot (source === target, e.g. a point-blank resolve with
  // no travel) has no defined bearing. Falling back to a fixed perpendicular
  // keeps the quad's area nonzero rather than collapsing it to an invisible
  // line; nobody can tell which way a 1.5px-wide, near-zero-length ribbon's
  // width axis points regardless.
  const nx = len > 0 ? -dyScreen / len : 1;
  const ny = len > 0 ? dxScreen / len : 0;
  const half = TRACER_WIDTH_PX / 2;
  const perp = screenOffsetToWorld(nx * half, ny * half);
  const liftY = TRACER_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;

  return Float32Array.from([
    t.sx - perp.dx, liftY, t.sy - perp.dy,
    t.sx + perp.dx, liftY, t.sy + perp.dy,
    t.tx + perp.dx, liftY, t.ty + perp.dy,
    t.tx - perp.dx, liftY, t.ty - perp.dy,
  ]);
}

/** Per-vertex GPU attribute arrays `writeTracerInstances` fills, sized (by
 *  the caller) to `TRACER_CAPACITY * 4` vertices -- four per tracer slot,
 *  not instanced (see `TracerBatch`'s own doc comment for why). */
export interface TracerInstanceBuffers {
  /** xyz triples, world space, `capacity * 4` long. */
  positions: Float32Array;
  /** rgb triples in 0..1, `capacity * 4` long -- all four vertices of one
   *  tracer share a colour, but this is per-vertex storage regardless,
   *  since the mesh is a single batched (not instanced) geometry. */
  colors: Float32Array;
  /** One alpha per vertex, `capacity * 4` long. */
  alphas: Float32Array;
}

/**
 * Writes every live tracer's quad into a flat, batched buffer. Pure aside
 * from calling `tracerQuadPositions`/`tracerAlpha` (both pure themselves) --
 * no `THREE.*`. Returns the number of QUADS written (not vertices or
 * indices); the caller derives `drawRange` from it.
 */
export function writeTracerInstances(
  tracers: readonly TracerModel[],
  tracerColors: readonly [string, string],
  out: TracerInstanceBuffers
): number {
  const capacity = out.alphas.length / 4;
  let count = 0;
  for (const t of tracers) {
    if (count >= capacity) break;
    const quad = tracerQuadPositions(t);
    const alpha = tracerAlpha(t);
    const [r, g, b] = hexToUnit(tracerColors[t.side] ?? tracerColors[0]);
    out.positions.set(quad, count * 12);
    for (let v = 0; v < 4; v++) {
      const ci = count * 12 + v * 3;
      out.colors[ci] = r;
      out.colors[ci + 1] = g;
      out.colors[ci + 2] = b;
      out.alphas[count * 4 + v] = alpha;
    }
    count++;
  }
  return count;
}

/** Index buffer for `capacity` batched tracer quads: two triangles per quad,
 *  `(4i, 4i+1, 4i+2)` and `(4i, 4i+2, 4i+3)` -- the same `[0,1,2,0,2,3]`
 *  pattern `particleBillboardGeometry`/`unitBillboardGeometry` use, just
 *  repeated at every quad's own vertex base. Built once at construction, not
 *  touched again -- only the positions/colors/alphas and the draw range
 *  change per frame. Plain `Uint32Array` arithmetic, no `THREE.*`. */
export function tracerIndexBuffer(capacity: number): Uint32Array {
  const indices = new Uint32Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    const base = i * 4;
    const o = i * 6;
    indices[o] = base;
    indices[o + 1] = base + 1;
    indices[o + 2] = base + 2;
    indices[o + 3] = base;
    indices[o + 4] = base + 2;
    indices[o + 5] = base + 3;
  }
  return indices;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, InstancedMesh, ShaderMaterial). Not exercised by
// fx.test.ts for the same reason instances.ts's own GPU half is not --
// three.js accepts these buffers under `environment: 'node'` (no
// WebGLRenderer needed merely to construct them, `instances.test.ts`'s own
// "render-order tie-break" suite already relies on this), but *using* them
// end to end needs a real WebGLRenderer. Covered by the browser verification
// in the B3.13 report instead.
// ---------------------------------------------------------------------------

/**
 * One draw call for every live particle, on both of Pixi's former layers at
 * once -- see this file's top comment for why that distinction dissolves.
 * `transparent`/`depthTest`/`depthWrite` all `true`, the identical recipe
 * `units/instances.ts`'s `createUnitMaterial` uses and for the identical
 * depth-resolution reason (see both files' top comments).
 */
function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec2 aLocal;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vLocal = aLocal;
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        // Hard-edged circle cutout -- matches Pixi's g.circle().fill(),
        // itself a flat fill with no soft falloff, rather than inventing
        // a smoother look Pixi's own particles do not have.
        if (dot(vLocal, vLocal) > 1.0) discard;
        if (vAlpha < ${FX_ALPHA_DISCARD}) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

/**
 * Every live particle, one `THREE.InstancedMesh`, one draw call -- the same
 * shape `UnitInstancer` gives units, sized to `PARTICLE_CAPACITY` so a live
 * particle can never outrun what this instancer can draw.
 */
export class ParticleInstancer {
  readonly mesh: THREE.InstancedMesh;
  private readonly colorAttr: THREE.InstancedBufferAttribute;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchScales: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(capacity: number) {
    const geo = particleBillboardGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setAttribute('aLocal', new THREE.BufferAttribute(geo.local, 2));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createParticleMaterial(), capacity);
    this.mesh.count = 0;
    // Particles move continuously across the whole map, exactly like units
    // -- see UnitInstancer's own identical frustumCulled = false and its
    // comment for why an origin-centred bounding sphere would be wrong, not
    // merely unhelpful, here.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
    this.scratchScales = new Float32Array(capacity);
  }

  /**
   * `particles` is `null` before `ThreeRenderer.useEmitters` has wired a
   * `ParticleSystem` in. Truthfully nothing to draw yet -- `mesh.count`
   * drops to 0 rather than throwing or holding stale instances on screen.
   */
  update(particles: ParticleSystem | null): void {
    if (!particles) {
      this.mesh.count = 0;
      return;
    }
    const count = writeParticleInstances(particles, {
      positions: this.scratchPositions,
      colors: this.colorAttr.array as Float32Array,
      alphas: this.alphaAttr.array as Float32Array,
      scales: this.scratchScales,
    });
    for (let i = 0; i < count; i++) {
      this.scratchMatrix.makeScale(this.scratchScales[i], this.scratchScales[i], this.scratchScales[i]);
      this.scratchMatrix.setPosition(
        this.scratchPositions[i * 3],
        this.scratchPositions[i * 3 + 1],
        this.scratchPositions[i * 3 + 2]
      );
      this.mesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Flat-shaded, per-vertex-alpha material for the batched tracer mesh --
 *  the same depth recipe as `createParticleMaterial`, but no texture and no
 *  circle cutout: a tracer is a plain rectangle. */
function createTracerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        if (vAlpha < ${FX_ALPHA_DISCARD}) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    // DoubleSide, unlike every billboard elsewhere in this backend --
    // deliberate, not an oversight. unitBillboardGeometry/
    // particleBillboardGeometry are each built ONCE against this camera's
    // fixed azimuth and their winding proven correct for it (instances.ts's
    // own "unit-vs-tree tie" section, confirmed to float precision against
    // the real camera). A tracer's quad is rebuilt fresh EVERY FRAME from
    // two arbitrary world points whose bearing changes shot to shot
    // (`tracerQuadPositions`), so there is no fixed winding to prove once --
    // getting it backwards for some bearings and not others would make
    // tracers flicker depending on which way a unit happened to be facing
    // when it fired. instances.ts's own top comment already notes DoubleSide
    // "addresses back-face culling, not depth ordering" -- exactly why this
    // costs nothing: the depth resolution this file's top comment describes
    // (transparent + depthTest + depthWrite) is unaffected by which faces
    // get rasterised.
    side: THREE.DoubleSide,
  });
}

/**
 * Every live tracer, ONE batched (not instanced) `THREE.Mesh`, one draw
 * call. Not an `InstancedMesh` like `ParticleInstancer`/`UnitInstancer`:
 * both of those scale a SHARED base quad by a single per-instance factor
 * (radius, or nothing at all) via `Matrix4`. A tracer's quad varies in both
 * length AND direction per shot (`tracerQuadPositions` computes four
 * absolute world corners, not a scale+translate of a shared shape), so this
 * writes real per-vertex positions into one large `BufferGeometry` instead
 * -- still exactly one draw call, `drawRange`-trimmed to the live count each
 * frame, the same "hide the unused tail" idea `mesh.count` gives an
 * `InstancedMesh`.
 */
export class TracerBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;

  constructor(capacity: number) {
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setIndex(new THREE.BufferAttribute(tracerIndexBuffer(capacity), 1));
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createTracerMaterial());
    // Tracers span the whole map, exactly like units and particles -- see
    // ParticleInstancer's identical field and UnitInstancer's own comment.
    this.mesh.frustumCulled = false;
  }

  update(tracers: readonly TracerModel[], tracerColors: readonly [string, string]): void {
    const count = writeTracerInstances(tracers, tracerColors, {
      positions: this.positionAttr.array as Float32Array,
      colors: this.colorAttr.array as Float32Array,
      alphas: this.alphaAttr.array as Float32Array,
    });
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, count * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
