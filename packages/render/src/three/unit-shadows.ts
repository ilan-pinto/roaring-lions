/**
 * Ground-unit shadows: a small, flat, opaque "blob" of real world-space
 * geometry under every living, non-air unit, shaded from `data/palette.json`'s
 * `shadow` ramp. The project lead's ask: "game is missing light, reflection,
 * wind" -- this is the ground half of "light" (see `flash-light.ts` for the
 * other half, and this file's own reasoning below for why a shadow cannot be
 * a light and stay on-palette either).
 *
 * ## Why this extends the existing air-shadow IDEA, but not its MECHANISM
 *
 * `ThreeRenderer.updateOverlays` already draws a shadow ellipse under every
 * airborne unit (search `isAir` there) -- a `OverlayBatch.ellipseFan` call:
 * a camera-facing BILLBOARD, alpha-blended at `0.28 * bodyAlpha`,
 * `depthTest: false` (deliberate Pixi parity for the WHOLE overlay tier,
 * `units/overlays.ts`'s own top comment). Reusing that literal mechanism for
 * EVERY ground unit -- hundreds of them, permanently on screen, not a
 * handful of aircraft -- would fail this task's own hard requirement twice
 * over:
 *
 *   1. Alpha-blended over arbitrary terrain produces a composited pixel that
 *      is provably NOT a `data/palette.json` entry (`vehicle-tracks.ts`'s own
 *      top comment already makes this exact argument and rejects blending for
 *      the identical reason, "Palette exactness: opaque, one colour, never
 *      blended"). A ground shadow needs to survive a live framebuffer sample
 *      against the palette, the same proof flash-light.ts and vehicle-tracks
 *      both pass; an alpha-blended billboard cannot.
 *   2. `depthTest: false` means it always draws on top, regardless of what
 *      is between the shadow and the camera. Pixi's own overlay tier gets
 *      away with this because it is UI-shaped (HP bars, rings) that Pixi
 *      itself never depth-sorts either -- faithful porting, not a shortcut,
 *      per that file's own top comment. A GROUND shadow is not UI: it is
 *      meant to read as a mark ON THE TERRAIN, and Pixi has no precedent for
 *      it at all (there is no ground-unit shadow in `renderer.ts`), so there
 *      is no parity obligation pulling toward `depthTest: false` here.
 *
 * So this file is not a second call into `OverlayBatch`. It reuses the OTHER
 * proven three-only ground-decal recipe already in this backend --
 * `vehicle-tracks.ts`'s `createTrackMaterial`: fully OPAQUE, one uniform
 * palette colour, `depthTest: true`, `depthWrite: true`, real ground-plane
 * geometry positioned via the same `groundWorldY` every mark in this backend
 * already stands on. What "extends the idea" is everything ELSE: same
 * palette key (`AIR_SHADOW_COLOR_KEY`, `shadow.2` -- a unit reads as casting
 * the identical shadow whether it flies or walks), same trigger site
 * (`ThreeRenderer.updateOverlays`'s existing per-entity loop, right next to
 * the `isAir` branch it already has an `anchor`/fog-gate for), same
 * garrison-roof lift (`anchor` already includes it).
 *
 * ## Full shadow-mapping: considered and rejected
 *
 * A real `THREE.PointLight`/`DirectionalLight` + `shadowMap` was the other
 * candidate the brief itself raised, and it fails at the first step:
 * `toonRampMaterial`/`toonRampSkinnedMaterial`/`terrainMaterial` do not
 * participate in three.js's lighting system at all (`palette-material.ts`'s
 * own "muzzle-flash 'light'" doc comment already establishes this for the
 * identical reason) -- a shadow map needs a `MeshStandardMaterial`-family
 * receiver to darken, and this backend has none. Even ignoring that, a real
 * shadow map's edge is a soft, filtered blend by construction (PCF or
 * similar) -- "a blended edge pixel is by definition not a palette colour"
 * is this backend's own antialiasing rule (`palette-material.ts`'s module
 * doc comment) and applies identically to a soft shadow edge. A flat, opaque,
 * hard-edged decal is not a compromise version of that; it is the only shape
 * that can pass this backend's actual constraint.
 *
 * ## Depth-tested, not billboarded -- why this is real ground geometry
 *
 * A true world-space circle of tile-radius `R`, lying flat on the ground
 * plane, projects through this fixed dimetric ORTHOGRAPHIC camera
 * (`three/camera.ts`) to a screen ellipse with `rightR = R * TILE_W * ISO_K`,
 * `upR = rightR * (TILE_H / TILE_W)` -- exactly `units/overlays.ts`'s own
 * `tileRadiusToEllipsePx`, and exactly the 2:1 ratio the air shadow's
 * billboard already hard-codes (`ellipseFan(shadowR, shadowR / 2, ...)`).
 * So a real, UNSQUISHED world-space circle reproduces the same on-screen
 * proportions as the existing billboard shadow with zero extra shaping code
 * -- `groundShadowRadiusTiles` below is that relationship run backward, from
 * the air shadow's own screen-pixel formula to a world-tile radius.
 *
 * Real geometry, depth-tested against terrain/buildings/units (all three
 * already write real depth, `units/instances.ts`'s own `depthWrite: true`
 * cutout-sprite recipe among them), is what lets a unit standing partly
 * behind a wall or another vehicle's hull have its shadow correctly
 * disappear where something nearer the camera already covers that ground --
 * a billboard with `depthTest: false` could never do this; real ground
 * geometry does it for free, the same way `vehicle-tracks.ts`'s marks
 * already interact correctly with unit sprites today.
 *
 * ## Fog: no separate gate, for a DIFFERENT reason than vehicle-tracks.ts's
 *
 * `vehicle-tracks.ts` needs no fog gate because it is opaque ground geometry
 * `FogMesh` unconditionally covers. This module gets the same property, but
 * more directly: it is only ever pushed from INSIDE `updateOverlays`'s
 * existing per-entity loop, which already skips any non-player entity the
 * player does not currently observe (`if (side !== 0 && !this.isVisible(ix,
 * iy)) continue`) before this module is ever called. An enemy shadow is
 * therefore never even offered to `push()` while unseen -- stricter than
 * "let fog cover it," and free: no new query, no new gate to write here.
 *
 * ## Ground epsilon: deliberately NOT `terrain/shared.ts`'s `MARK_EPSILON`
 *
 * `MARK_EPSILON` (0.01) is what `vehicle-tracks.ts` and `grove.ts`'s own
 * trunk shadow both already lift by. A ground unit's shadow shares a tile
 * with a vehicle's own track mark constantly (they are centred on the same
 * moving vehicle), and with a grove's baked trunk shadow occasionally (grove
 * tiles are decor, not blocked -- a unit can stand in one). Sharing the
 * IDENTICAL epsilon would coplanar-tie two independent, differently-coloured
 * decals and z-fight, flickering between them frame to frame. `SHADOW_EPSILON`
 * below is a distinct value, chosen to sit clear of every epsilon already in
 * use (`MARK_EPSILON` 0.01; `grove.ts`'s own ladder, 0.005/0.01/0.02/0.03/
 * 0.04) -- and above them, so a unit currently standing there reads as
 * casting a shadow onto the ground INCLUDING whatever mark is already there,
 * not the other way around.
 *
 * ## Determinism (invariant 4)
 *
 * Every input here (`Sim` position/type/side/alive state, already read
 * elsewhere in this backend) is presentation state derived from
 * already-emitted sim state; this module writes nothing back. `push()` is a
 * pure geometry write with no randomness and no clock of its own.
 */
import * as THREE from 'three';
import { hexToUnit } from './terrain/shared';
import { unitOverlayRadiusPx, ISO_K } from './units/overlays';
import { TRAIL_RENDER_ORDER } from './units/render-order';
import { TILE_W } from '../project';

/** Distinct from every other ground-decal epsilon already in this backend --
 *  see this file's own top comment, "Ground epsilon". */
export const SHADOW_EPSILON = 0.015;

/**
 * World-tile radius for a unit's ground shadow, derived from the EXISTING
 * air-unit shadow's own screen-pixel sizing formula
 * (`ThreeRenderer.updateOverlays`: `const shadowR = r * 0.7 + 2`, `r` =
 * `unitOverlayRadiusPx(isSoft)`) rather than an independently authored
 * number -- see this file's top comment, "Depth-tested, not billboarded",
 * for the projection identity (`tileRadiusToEllipsePx`'s own formula, run in
 * reverse) that makes this conversion exact rather than approximate.
 */
export function groundShadowRadiusTiles(isSoft: boolean): number {
  const screenR = unitOverlayRadiusPx(isSoft) * 0.7 + 2;
  return screenR / (TILE_W * ISO_K);
}

/** Triangles fanned per shadow blob -- an octagon, matching `grove.ts`'s own
 *  `CROWN_LOBE_SEGMENTS` choice and its stated reasoning: a 4-corner diamond
 *  reads hard-edged at this screen scale (the air shadow's own `shadowR`
 *  formula puts this blob's on-screen radius at ~7-10px, materially past
 *  the "2-4px fleck" size grove.ts reserves a diamond for), while doubling
 *  vertex count per unit is immaterial against `docs/PERFORMANCE.md`'s
 *  headroom (see this file's own report for the arithmetic). */
export const SHADOW_SEGMENTS = 8;
/** Non-indexed vertices per blob: `SHADOW_SEGMENTS` triangles, 3 vertices
 *  each, no shared verts -- the same non-indexed shape `units/overlays.ts`'s
 *  `OverlayBatch` already uses, for the identical "one rebuilt-per-frame
 *  soup, `setDrawRange`-trimmed" reason. */
export const SHADOW_VERTICES = SHADOW_SEGMENTS * 3;

/** Unit-circle corners, computed once at module load -- `push()` runs once
 *  per living ground unit, every frame, so precomputing the `cos`/`sin` pairs
 *  here (rather than recomputing them per call) avoids `SHADOW_SEGMENTS * 2`
 *  trig calls per unit per frame for a value that never changes, the same
 *  "bake the fixed-camera axis once" discipline `overlay-geometry.ts`'s own
 *  `RIGHT_PER_PX` uses. A TRUE (unsquished) circle -- see this file's top
 *  comment for why no 2:1 pre-squash belongs here. */
const UNIT_CIRCLE: readonly (readonly [number, number])[] = Array.from({ length: SHADOW_SEGMENTS }, (_, i) => {
  const t = (i / SHADOW_SEGMENTS) * Math.PI * 2;
  return [Math.cos(t), Math.sin(t)] as const;
});

/**
 * Writes one shadow blob's `SHADOW_VERTICES` vertices (xyz, world space)
 * into `out` at ring-buffer-shaped `slot` (`out[slot * SHADOW_VERTICES * 3
 * ..]`) -- the same "pure function fills the caller's own scratch buffer"
 * contract `vehicle-tracks.ts`'s `writeTrackMarkVertices` already uses.
 * Fanned from the blob's own centre `(cx, groundY, cz)`, matching
 * `overlay-geometry.ts`'s `pushEllipseFanPx`'s own fan order.
 */
export function writeShadowVertices(
  out: Float32Array,
  slot: number,
  cx: number,
  groundY: number,
  cz: number,
  radiusTiles: number
): void {
  const base = slot * SHADOW_VERTICES * 3;
  for (let i = 0; i < SHADOW_SEGMENTS; i++) {
    const [c0, s0] = UNIT_CIRCLE[i];
    const [c1, s1] = UNIT_CIRCLE[(i + 1) % SHADOW_SEGMENTS];
    const triBase = base + i * 9;
    out[triBase] = cx;
    out[triBase + 1] = groundY;
    out[triBase + 2] = cz;
    out[triBase + 3] = cx + c0 * radiusTiles;
    out[triBase + 4] = groundY;
    out[triBase + 5] = cz + s0 * radiusTiles;
    out[triBase + 6] = cx + c1 * radiusTiles;
    out[triBase + 7] = groundY;
    out[triBase + 8] = cz + s1 * radiusTiles;
  }
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction. Not
// exercised by unit-shadows.test.ts for the same reason vehicle-tracks.ts's
// own GPU half is not -- three.js accepts these buffers under
// `environment: 'node'`, but *using* them end to end needs a real
// WebGLRenderer. Covered by the browser verification in this task's report.
// ---------------------------------------------------------------------------

/**
 * Flat-shaded, single-uniform-colour, fully OPAQUE material -- byte-for-byte
 * the same recipe as `vehicle-tracks.ts`'s own `createTrackMaterial` (see
 * that function's doc comment for the palette-exactness argument: alpha
 * pinned to 1.0 unconditionally, no attribute, no blend, so every fragment
 * this material ever writes is exactly `color`). Not imported from there
 * because that file is frozen for today ("landed today... beyond reading"
 * per this task's own constraints); the two-line duplication is cheaper than
 * either exporting a new symbol from a frozen file or generalising a
 * same-day-shipped one.
 */
function createShadowMaterial(color: string): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    // DoubleSide for the same reason vehicle-tracks.ts's own material uses
    // it: this mesh's fan winding is authored once, correctly, but the
    // material carries no lighting term to depend on face direction either
    // way, so removing the "did I get the corner order right" risk costs
    // nothing real.
    side: THREE.DoubleSide,
  });
}

/**
 * Every living, visible, non-air unit's ground shadow, one batched (not
 * instanced) `THREE.Mesh`, one draw call -- rebuilt fully every frame
 * (`beginFrame`, then one `push` per unit, then `endFrame`), the same shape
 * `units/overlays.ts`'s `OverlayBatch` uses and for the identical reason: a
 * shadow tracks its own unit's CURRENT position continuously, so unlike
 * `vehicle-tracks.ts`'s ring buffer (marks are written once and persist),
 * nothing here should outlive the frame that placed it.
 */
export class UnitShadowMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly capacity: number;
  private count = 0;

  /** `entityCapacity` should be `sim.capacity` -- at most one shadow per
   *  living entity is ever pushed in a frame, so no "+ headroom" slack is
   *  needed the way `OverlayBatch` needs for its own variable-count extras
   *  (order markers, the tutorial ring). */
  constructor(entityCapacity: number, color: string) {
    this.capacity = entityCapacity;
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(entityCapacity * SHADOW_VERTICES * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createShadowMaterial(color));
    // Real, depth-tested ground geometry -- see this file's top comment,
    // "Depth-tested, not billboarded". Same band `vehicle-tracks.ts`'s own
    // marks use, for the identical reason (`render-order.ts`'s own closing
    // paragraphs: flat ground geometry belongs at or below
    // `HULL_RENDER_ORDER`, never the TURRET band above it).
    this.mesh.renderOrder = TRAIL_RENDER_ORDER;
    // Shadows can appear anywhere a ground unit stands, exactly like fog/
    // trail/vehicle-track span the whole map -- see those meshes' own
    // identical `frustumCulled = false` and comment.
    this.mesh.frustumCulled = false;
  }

  /** Clears last frame's blobs. Call once per `frame()`, before any `push`. */
  beginFrame(): void {
    this.count = 0;
  }

  /** One unit's shadow blob, centred at world `(cx, cz)`, `radiusTiles`
   *  wide, sitting `SHADOW_EPSILON` above `groundY` (the unit's own anchor
   *  height -- already includes garrison-roof lift when the caller passes
   *  it through, matching `ThreeRenderer.updateOverlays`'s own `anchor`).
   *  Silently dropped past `entityCapacity`, matching every other per-frame
   *  soup in this backend (`OverlayBatch`, `ParticleInstancer`). */
  push(cx: number, groundY: number, cz: number, radiusTiles: number): void {
    if (this.count >= this.capacity) return;
    writeShadowVertices(
      this.positionAttr.array as Float32Array,
      this.count,
      cx,
      groundY + SHADOW_EPSILON,
      cz,
      radiusTiles
    );
    this.count++;
  }

  /** Uploads this frame's blobs and trims the draw range to what was
   *  actually pushed. Call once per `frame()`, after every `push()`. */
  endFrame(): void {
    this.mesh.geometry.setDrawRange(0, this.count * SHADOW_VERTICES);
    this.positionAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
