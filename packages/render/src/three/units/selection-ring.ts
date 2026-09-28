/**
 * A4 (GH-186, spec 2026-09-28 sec 2.2): the selection ring, drawn ON the
 * ground in team colour instead of as a screen-space billboard ellipse.
 *
 * One non-instanced `THREE.Mesh`, rewritten every frame: `beginFrame`, one
 * `push` per selected unit, `endFrame`. Each ring is an `n = 4` conforming
 * grid placed by `writeDecalGrid` -- the decal pool's PURE maths, not the
 * pool itself, whose sim-time-dated ring buffer and multiply blend are both
 * wrong for a bright mark rewritten every frame (spec sec 1) -- so a ring
 * lies on bicubic ground and slopes exactly as a crater does. The fragment
 * shader draws the annulus from the grid's own `aOffset`, with a feather,
 * since antialiasing is off in this renderer.
 *
 * **The ellipse is data, not a code path.** The spec draws a circle, and the
 * lead will be shown a hull-aligned ellipse beside it at G-MOCK. Both are the
 * same placement: two semi-axes (`alongTiles` along `headingRad`,
 * `acrossTiles` across it) that default to `radiusTiles`. The grid is rotated
 * by `writeDecalGrid`'s own `facingRad`, so the shader works in the ring's
 * local frame and never sees the heading. The annulus is measured by a signed
 * distance to the ellipse (`ringSignedDistance`): exact for a circle and on
 * both semi-axes, and a first-order approximation between them -- a constant
 * thickness to the eye at the aspect ratios a hull gives.
 *
 * **The pixel floor is measured on the ring's THIN axis.** A ground circle of
 * radius `r` tiles projects to an ellipse `r * TILE_W/sqrt2` px wide and
 * `r * TILE_H/sqrt2` tall (`tileRadiusToEllipsePx`), so the top and bottom of
 * a ring are half as thick on screen as its sides. The floor exists so a ring
 * never breaks up at the 0.35 zoom clamp, and that happens first on the thin
 * axis; `ringPxPerTile` reads that one. Consequence: the floor binds below
 * zoom ~1.1, so at zoom 1 the band is 0.066 tiles (1.5 px tall, 3.0 px wide)
 * rather than 0.06 (1.36 / 2.7). Swapping `upR` for `rightR` in
 * `ringPxPerTile` is the whole of the other reading.
 *
 * Unlit and fog-blind by construction: no light uniform, no fog read. It is
 * depth-tested and not depth-writing, so the post chain's fog pass reads the
 * ground's depth under it and dims it like that ground. Premultiplied "over".
 * No `normal` attribute, which is what keeps the AO pre-pass off it
 * (`post-chain.ts`, `isAoOccluder`), and no shadows either way.
 */
import * as THREE from 'three';
import {
  DECAL_POLYGON_OFFSET_FACTOR,
  DECAL_POLYGON_OFFSET_UNITS,
  glslFloat,
  gridTriangles,
  writeDecalGrid,
  writeDecalOffsets,
  writeGridIndices,
} from '../decal-pool';
import { TILE_H, TILE_W } from '../../project';
import { SELECTION_RING } from './readability';
import { SELECTION_RING_RENDER_ORDER } from './render-order';
import { tileRadiusToEllipsePx } from './overlays';

/** Vertices per side of a ring's conforming grid: 16 vertices, 18 tris. */
export const RING_GRID = 4;

type Rgb = readonly [number, number, number];

export interface RingPlacement {
  /** World X/Z of the ring's centre, tiles. */
  readonly x: number;
  readonly z: number;
  /** Outer edge of the core, tiles (`ringRadiusFor`). */
  readonly radiusTiles: number;
  /** LINEAR rgb, 0..1 -- `teamColors[side]` through `cachedHexToLinear`. */
  readonly color: Rgb;
  /** Ellipse option (G-MOCK): the semi-axis along `headingRad`. Defaults to `radiusTiles`. */
  readonly alongTiles?: number;
  /** Ellipse option: the semi-axis across `headingRad`. Defaults to `radiusTiles`. */
  readonly acrossTiles?: number;
  /** Ellipse option: the hull's heading, radians, in `writeDecalGrid`'s `facingRad` convention. Defaults to 0. */
  readonly headingRad?: number;
}

/** Screen px per tile of ground on the ring's thin (foreshortened) axis at
 *  `zoom` -- see this file's top comment, "The pixel floor". */
export function ringPxPerTile(zoom: number): number {
  return zoom * tileRadiusToEllipsePx(1, TILE_W, TILE_H).upR;
}

/** The core's solid thickness in tiles: `thicknessTiles`, or thicker where
 *  that would be under `minThicknessPx` on screen. The shader's own `w`. */
export function ringThicknessTiles(pxPerTile: number): number {
  return Math.max(SELECTION_RING.thicknessTiles, SELECTION_RING.minThicknessPx / pxPerTile);
}

/**
 * Signed distance, tiles, from the ring's outer edge (negative inside) for a
 * point `(px, pz)` in the ring's local frame, against semi-axes `a` (local X)
 * and `b` (local Z). `k0 (k0 - 1) / k1` with `k0 = |p/r|`, `k1 = |p/r^2|`:
 * exactly `|p| - R` for a circle and exact on both semi-axes of an ellipse.
 * The shader's `ringSd` is this function's transcription.
 */
export function ringSignedDistance(px: number, pz: number, a: number, b: number): number {
  const qx = px / a;
  const qz = pz / b;
  const k0 = Math.hypot(qx, qz);
  if (k0 < 1e-5) return -Math.min(a, b);
  const k1 = Math.hypot(qx / a, qz / b);
  return (k0 * (k0 - 1)) / k1;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The core's coverage at signed distance `s`: solid over `[-w, 0]`, one
 *  feather outside each edge. Mirrors the shader. */
export function ringCoreAlpha(s: number, w: number): number {
  const f = SELECTION_RING.featherTiles;
  return smoothstep(-w - f, -w, s) * (1 - smoothstep(0, f, s));
}

/** The halo's coverage: outside the ring only, fading in as the core's outer
 *  feather fades out, solid to `haloTiles`, gone by `haloTiles + feather` --
 *  which is the quad's own edge. Mirrors the shader. */
export function ringHaloAlpha(s: number): number {
  const f = SELECTION_RING.featherTiles;
  return smoothstep(0, f, s) * (1 - smoothstep(SELECTION_RING.haloTiles, SELECTION_RING.haloTiles + f, s));
}

const T = glslFloat(SELECTION_RING.thicknessTiles);
const PX = glslFloat(SELECTION_RING.minThicknessPx);
const F = glslFloat(SELECTION_RING.featherTiles);
const CORE_A = glslFloat(SELECTION_RING.coreAlpha);
const HALO = glslFloat(SELECTION_RING.haloTiles);
const HALO_END = glslFloat(SELECTION_RING.haloTiles + SELECTION_RING.featherTiles);
const HALO_A = glslFloat(SELECTION_RING.haloAlpha);

const RING_VERTEX_SHADER = /* glsl */ `
  attribute vec2 aOffset;
  attribute vec3 aRingColor;
  attribute vec2 aAxes;
  varying vec2 vLocal;
  varying vec2 vAxes;
  varying vec3 vColor;
  void main() {
    // The grid's half-extent is the semi-axes plus the halo and its feather,
    // so vLocal is the fragment's position in the ring's own frame, tiles.
    vLocal = aOffset * (aAxes + vec2(${HALO} + ${F}));
    vAxes = aAxes;
    vColor = aRingColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
  uniform float uPxPerTile;
  uniform vec3 uHaloColor;
  varying vec2 vLocal;
  varying vec2 vAxes;
  varying vec3 vColor;
  float ringSd(vec2 p, vec2 r) {
    vec2 q = p / r;
    float k0 = length(q);
    if (k0 < 0.00001) return -min(r.x, r.y);
    return k0 * (k0 - 1.0) / length(q / r);
  }
  void main() {
    float s = ringSd(vLocal, vAxes);
    float w = max(${T}, ${PX} / uPxPerTile);
    float core = smoothstep(-w - ${F}, -w, s) * (1.0 - smoothstep(0.0, ${F}, s));
    float halo = smoothstep(0.0, ${F}, s) * (1.0 - smoothstep(${HALO}, ${HALO_END}, s));
    float ca = core * ${CORE_A};
    float ha = halo * ${HALO_A};
    float a = ca + ha * (1.0 - ca);
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vColor * ca + uHaloColor * ha * (1.0 - ca), a);
  }
`;

/**
 * The ring's material: the annulus shader above, `uHaloColor` (LINEAR,
 * `shadow.1`) and `uPxPerTile` (`endFrame` sets it). Premultiplied "over";
 * depth-tested, not depth-writing, with the decal polygon offset so the grid
 * wins against the ground it was conformed to; `DoubleSide` like every flat
 * mark in this backend, since nothing here depends on winding.
 */
export function createSelectionRingMaterial(halo: Rgb): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPxPerTile: { value: ringPxPerTile(1) },
      uHaloColor: { value: new THREE.Vector3(halo[0], halo[1], halo[2]) },
    },
    vertexShader: RING_VERTEX_SHADER,
    fragmentShader: RING_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DECAL_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: DECAL_POLYGON_OFFSET_UNITS,
    side: THREE.DoubleSide,
  });
}

/** The mutable twin of `GridPlacement`, reused by every `push`. */
export interface GridScratch {
  cx: number;
  cz: number;
  halfLength: number;
  halfWidth: number;
  facingRad: number;
}

/**
 * Writes ring `slot`'s dynamic vertex data: positions (`writeDecalGrid`,
 * half-extents = semi-axes + halo + feather), the colour and the semi-axes,
 * each repeated on all `RING_GRID^2` vertices. Allocates nothing: `grid` is
 * the caller's scratch.
 */
export function writeRingAttributes(
  positions: Float32Array,
  colors: Float32Array,
  axes: Float32Array,
  slot: number,
  p: RingPlacement,
  sampleY: (x: number, z: number) => number,
  grid: GridScratch
): void {
  const a = p.alongTiles ?? p.radiusTiles;
  const b = p.acrossTiles ?? p.radiusTiles;
  const extra = SELECTION_RING.haloTiles + SELECTION_RING.featherTiles;
  grid.cx = p.x;
  grid.cz = p.z;
  grid.halfLength = a + extra;
  grid.halfWidth = b + extra;
  grid.facingRad = p.headingRad ?? 0;
  writeDecalGrid(positions, slot, RING_GRID, grid, sampleY);
  const verts = RING_GRID * RING_GRID;
  const c3 = slot * verts * 3;
  const a2 = slot * verts * 2;
  for (let v = 0; v < verts; v++) {
    colors[c3 + v * 3] = p.color[0];
    colors[c3 + v * 3 + 1] = p.color[1];
    colors[c3 + v * 3 + 2] = p.color[2];
    axes[a2 + v * 2] = a;
    axes[a2 + v * 2 + 1] = b;
  }
}

interface UpdateRange {
  start: number;
  count: number;
}

/** Flags `[0, used)` of `attr` for upload through a range object reused every
 *  frame. Clearing first means a frame the renderer never drew cannot stack
 *  a second range; three consumes a lone range without mutating it. */
function markUsed(attr: THREE.BufferAttribute, range: UpdateRange, used: number): void {
  attr.clearUpdateRanges();
  range.start = 0;
  range.count = used * attr.itemSize;
  attr.updateRanges.push(range);
  attr.needsUpdate = true;
}

export class SelectionRingBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly axesAttr: THREE.BufferAttribute;
  private readonly capacity: number;
  private readonly resolveShadow: () => Rgb;
  private readonly grid: GridScratch = { cx: 0, cz: 0, halfLength: 0, halfWidth: 0, facingRad: 0 };
  private readonly ranges: readonly [UpdateRange, UpdateRange, UpdateRange] = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  private used = 0;

  constructor(opts: { capacity: number; resolveShadow: () => Rgb }) {
    const { capacity } = opts;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`SelectionRingBatch: capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.resolveShadow = opts.resolveShadow;
    const verts = RING_GRID * RING_GRID;
    const geometry = new THREE.BufferGeometry();

    this.positionAttr = new THREE.BufferAttribute(new Float32Array(capacity * verts * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);

    // STATIC: every slot's (s, t) is the same wherever its ring sits.
    const offsetAttr = new THREE.BufferAttribute(new Float32Array(capacity * verts * 2), 2);
    for (let slot = 0; slot < capacity; slot++) writeDecalOffsets(offsetAttr.array as Float32Array, slot, RING_GRID);
    geometry.setAttribute('aOffset', offsetAttr);

    this.colorAttr = new THREE.BufferAttribute(new Float32Array(capacity * verts * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRingColor', this.colorAttr);

    this.axesAttr = new THREE.BufferAttribute(new Float32Array(capacity * verts * 2), 2);
    this.axesAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aAxes', this.axesAttr);

    const perSlot = gridTriangles(RING_GRID) * 3;
    const indexCount = capacity * perSlot;
    const indices = capacity * verts <= 65536 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
    for (let slot = 0; slot < capacity; slot++) {
      writeGridIndices(indices.subarray(slot * perSlot, (slot + 1) * perSlot), slot, RING_GRID);
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createSelectionRingMaterial(this.resolveShadow()));
    this.mesh.name = 'selection-ring';
    this.mesh.renderOrder = SELECTION_RING_RENDER_ORDER;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Rewritten anywhere on the map every frame; its bounds are never current.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Rings written since the last `beginFrame`. */
  get count(): number {
    return this.used;
  }

  beginFrame(): void {
    this.used = 0;
  }

  /** false when full -- the caller then draws the billboard fallback. */
  push(p: RingPlacement, sampleY: (x: number, z: number) => number): boolean {
    if (this.used >= this.capacity) return false;
    writeRingAttributes(
      this.positionAttr.array as Float32Array,
      this.colorAttr.array as Float32Array,
      this.axesAttr.array as Float32Array,
      this.used,
      p,
      sampleY,
      this.grid
    );
    this.used++;
    return true;
  }

  /** Sets the draw range, hides the mesh when nothing was pushed (so the ring
   *  costs a draw call only while something is selected), sets the pixel
   *  floor from `zoom` and re-reads the halo colour. */
  endFrame(zoom: number): void {
    const n = this.used;
    const verts = n * RING_GRID * RING_GRID;
    this.mesh.geometry.setDrawRange(0, n * gridTriangles(RING_GRID) * 3);
    this.mesh.visible = n > 0;
    const u = this.mesh.material.uniforms;
    u.uPxPerTile.value = ringPxPerTile(zoom);
    const halo = this.resolveShadow();
    (u.uHaloColor.value as THREE.Vector3).set(halo[0], halo[1], halo[2]);
    if (n === 0) return;
    markUsed(this.positionAttr, this.ranges[0], verts);
    markUsed(this.colorAttr, this.ranges[1], verts);
    markUsed(this.axesAttr, this.ranges[2], verts);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
