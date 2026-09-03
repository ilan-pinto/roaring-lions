/**
 * Phase C: tunnel trails on screen -- the last unported item CLAUDE.md's own
 * "Known scaling debts" names for this backend. `PixiRenderer.drawTrail`
 * (`renderer.ts:1121-1167`) and `./trail.ts`'s `trailTileAlpha` (already
 * backend-agnostic -- no Pixi import, ported nowhere because it never needed
 * porting) are the reference; this module is the three.js draw, built the
 * same two-layer way `fog-mesh.ts` is: pure geometry/attribute arithmetic
 * first (testable in `environment: 'node'`), `THREE.*` GPU construction
 * after the divider below.
 *
 * ## A trail is real depth-tested ground geometry, not an overlay band
 *
 * `units/render-order.ts`'s own closing paragraphs settle this explicitly,
 * because an earlier version of that file got Phase C's overlay tier wrong
 * once already: "trails are NOT part of this overlay tier... a trail is
 * flat, depth-tested ground geometry, and this table's own top comment
 * already says what settles that case: real `depthTest`/`depthWrite`
 * arbitration against terrain and units, not a `renderOrder` number... it
 * belongs at or below `HULL_RENDER_ORDER` -- never band 1." This mesh draws
 * at `TRAIL_RENDER_ORDER`, an alias of `HULL_RENDER_ORDER` exported for the
 * identical reason `STRUCTURE_RENDER_ORDER` is: relying on the bare numeric
 * default by coincidence leaves nothing to catch a future edit that moves
 * `HULL_RENDER_ORDER` and strands this mesh behind it.
 *
 * That is the mirror image of `fog-mesh.ts`'s own recipe, not a copy of it:
 * fog needs `depthTest: false` so it hides a hostile standing IN it (a unit's
 * own raised geometry must not win the depth test against flat ground). A
 * trail needs the opposite -- it is meant to sit UNDER a unit standing on it,
 * covered by the unit's own body the way real disturbed earth would be, and
 * hidden behind a ridge or a building the way real ground paint is. Real
 * `depthTest: true` against terrain/buildings (opaque, `depthWrite: true`,
 * already committed to the depth buffer before any transparent draw, exactly
 * `units/fx.ts`'s own "does this effect sit behind a ridge or a building"
 * argument for the below-tier particle mesh) answers that with no
 * `renderOrder` number needed at all.
 *
 * `depthWrite: false` matches that same below-tier particle recipe
 * (`units/fx.ts`'s `createParticleMaterial(true)`), for the identical
 * reason stated there: a trail tint is not near-binary alpha the way a
 * unit's sprite texel is (`LINE_ALPHA`/`SPOIL_ALPHA_FLOOR`/
 * `SPOIL_ALPHA_SCALE` in `./trail.ts` are all soft, graduated values,
 * 0.14-0.64), so writing depth would buy nothing units' own recipe buys
 * (their alpha is a hard cutout, `ALPHA_PADDING_DISCARD`-gated) while
 * costing the same "translucent draws over translucent don't blend, they
 * depth-reject" artifact `fx.ts`'s own top comment documents for particles.
 *
 * ## Why one mesh, one uniform colour, sized like fog
 *
 * Pixi's `drawTrail` fills every tile -- spoil rung AND identified-line rung
 * alike -- with the SAME `this.opts.terrainTones.spoil` tone, varying only
 * alpha (`trailTileAlpha`'s own two-rung split is entirely an alpha
 * decision, never a colour one). So, like `FogMesh`'s single `uColor`
 * uniform, one colour serves the whole mesh -- baked in at construction from
 * `RendererOptions.terrainTones.spoil` (a map-level config value, immutable
 * for the renderer's lifetime, unlike `FOG_COLOR`'s hardcoded literal) rather
 * than a per-instance colour attribute nothing would ever vary.
 *
 * Capacity is `width * height`, the same worst-case sizing `FogMesh` uses and
 * for the same reason: cheap, and the one ceiling that can never be
 * exceeded, however many routes a mission ever authors.
 *
 * ## The known cost is ported, not fixed
 *
 * CLAUDE.md already records `drawTrail` as O(width * height * routes) at
 * 5 Hz. `writeTrailInstances` below reproduces that exact shape --
 * `PixiRenderer.drawTrail`'s own per-tile route scan, `renderer.ts:1141-1166`
 * -- rather than a cheaper restructuring; this task ports the algorithm, it
 * does not resolve the scaling debt.
 */
import * as THREE from 'three';
import { pushPolygon, hexToUnit, MARK_EPSILON } from './terrain/shared';
import { tileGroundWorldY, type ElevationSource } from './ground-height';
import { trailTileAlpha } from '../trail';
import { TRAIL_RENDER_ORDER } from './units/render-order';

// ---------------------------------------------------------------------------
// Pure: geometry and per-instance attribute arithmetic. No THREE.* GPU
// objects below this line yet -- mirrors fog-mesh.ts's own split, for the
// same reason: TrailMesh construction needs nothing headless cannot provide,
// but nothing here needs even that much.
// ---------------------------------------------------------------------------

/** The shared per-instance quad, in LOCAL space: a unit tile footprint
 *  (0,0)-(1,1) on the ground plane (local y = 0). `TrailMesh` translates
 *  this per instance to `(x, groundWorldY(tile) + MARK_EPSILON, y)` via
 *  `instanceMatrix` -- the same shape `fog-mesh.ts`'s `fogQuadGeometry`
 *  builds (byte-identical output; reproduced independently here rather than
 *  imported, matching this backend's existing precedent of each GPU module
 *  owning its own small pure geometry helper -- `ground.ts`, `fog-mesh.ts`
 *  and this module all build the same tile-top quad shape from `pushPolygon`
 *  rather than a shared wrapper none of the three needed until now). */
export interface TrailQuadGeometry {
  /** xyz triples, four vertices. */
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Built via the SAME `pushPolygon(points, color, flip: false)` call
 * `ground.ts`'s `buildGround` uses for a tile's TOP quad, and `fog-mesh.ts`'s
 * `fogQuadGeometry` reproduces for the identical reason: an up-facing (+Y)
 * normal, proven against this camera's fixed dimetric convention once and
 * not re-derived here.
 */
export function trailQuadGeometry(): TrailQuadGeometry {
  const positions: number[] = [];
  // `pushPolygon` also writes a per-vertex colour; trail's colour is a
  // material uniform (every instance shares the one spoil tone, only alpha
  // varies per instance), so this output is built and discarded -- same
  // choice `fogQuadGeometry` makes for the identical reason.
  const colors: number[] = [];
  const indices: number[] = [];
  pushPolygon(
    positions,
    colors,
    indices,
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    [0, 0, 0],
    false
  );
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/**
 * `PixiRenderer.drawTrail`'s collapse-downgrade rule (`renderer.ts:1130-
 * 1134`), extracted so it is a stated, tested fact rather than an inline
 * ternary buried in `ThreeRenderer.buildTrailInput` -- Pixi's own comment:
 * "A collapsed route keeps drawing its residual spoil (the dirt is real)
 * but never the identified line -- there is nothing left to work." A
 * collapsed route (`alive: false`) can never report the identified line
 * (level 2 downgrades to 1, suspected-only); an un-collapsed route's level
 * passes through unchanged.
 */
export function collapsedRouteLevel(alive: boolean, level: 0 | 1 | 2): 0 | 1 | 2 {
  return !alive && level === 2 ? 1 : level;
}

/**
 * Everything `writeTrailInstances` needs for one rebuild, in the same
 * "raw arrays plus predicate callbacks" shape `./fog.ts`'s `FogInput` uses
 * (its own `isLowProfile` is the precedent: a predicate the caller derives
 * from state this module has no reason to depend on directly).
 *
 * `routeLevel`, `tunnelUnderTile`, `seenByAnyone` and `seenByCarrier` are all
 * `Sim` reads in `ThreeRenderer`'s own caller (`Sim.tunnelContactLevel`/
 * `tnAlive`, `Sim.tunnelUnderTile`, `Sim.sideSeesTile`, `Sim.markerSeesTile`)
 * -- kept out of this module's own signature so it stays testable with
 * plain arrays and closures, no `Sim` construction required, exactly like
 * `writeFogInstances`.
 */
export interface TrailInstanceInput {
  readonly width: number;
  readonly height: number;
  readonly elevation: ElevationSource;
  /** Spoil density per tile -- `Sim.trail` verbatim, `renderer.ts:1139`'s
   *  own read, 0..255 (`./trail.ts`'s `SPOIL_DENSITY_MAX`, restated there
   *  rather than imported past `@lions/sim`'s public surface). */
  readonly trail: Uint8Array;
  readonly routeCount: number;
  /**
   * Per-route contact level, ALREADY downgraded via `collapsedRouteLevel`
   * (above) for a collapsed route's residual-spoil-only state. The caller's
   * job, not this function's, since it needs `Sim.tnAlive` and
   * `Sim.tunnelContactLevel` both.
   */
  readonly routeLevel: (route: number) => 0 | 1 | 2;
  /** `Sim.tunnelUnderTile(route, x, y)`. */
  readonly tunnelUnderTile: (route: number, x: number, y: number) => boolean;
  /** `Sim.sideSeesTile(0, x, y)` -- ANY living side-0 unit's eyes; gates the
   *  spoil rung (`./trail.ts`'s own doc comment: "anyone can see disturbed
   *  earth"). */
  readonly seenByAnyone: (x: number, y: number) => boolean;
  /** `Sim.markerSeesTile(0, x, y)` -- `mark_tunnel` carriers only; gates the
   *  identified-line rung ("only a detector tells you what the dirt
   *  MEANS"). */
  readonly seenByCarrier: (x: number, y: number) => boolean;
}

/** Per-instance GPU attribute arrays `writeTrailInstances` fills, sized (by
 *  the caller) to the map's own tile count -- the same worst-case sizing
 *  `FogInstanceBuffers` uses. */
export interface TrailInstanceBuffers {
  /** xyz triples, world space. */
  positions: Float32Array;
  /** One alpha per instance, `trailTileAlpha`'s own return value. */
  alphas: Float32Array;
}

/**
 * `PixiRenderer.drawTrail`'s per-tile loop (`renderer.ts:1141-1166`), ported
 * line for line: for every tile, the strongest contact rung of any route
 * under it; if none, skip; otherwise gate each rung by the eyes that can
 * serve it (`trailTileAlpha`'s own split) and write an instance only when the
 * resulting alpha is non-zero. No `THREE.*` -- exercised directly with plain
 * arrays and closures, no `WebGLRenderer` needed.
 *
 * Returns the number of instances written, matching `writeFogInstances`'s
 * own contract -- the caller sets `mesh.count` to it.
 */
export function writeTrailInstances(input: TrailInstanceInput, out: TrailInstanceBuffers): number {
  const { width, height, elevation, trail, routeCount, routeLevel, tunnelUnderTile, seenByAnyone, seenByCarrier } =
    input;
  const capacity = out.alphas.length;
  let count = 0;
  if (routeCount === 0) return 0;

  // Resolved once per call, not once per tile -- `PixiRenderer.drawTrail`'s
  // own `level` array (`renderer.ts:1127-1135`). The per-tile scan below is
  // already O(width * height * routeCount) (CLAUDE.md's "Known scaling
  // debts" entry for `drawTrail`); re-deriving each route's level inside
  // that inner loop would multiply the cost again for nothing.
  const levels: (0 | 1 | 2)[] = new Array(routeCount);
  let any = false;
  for (let r = 0; r < routeCount; r++) {
    levels[r] = routeLevel(r);
    any = any || levels[r] > 0;
  }
  if (!any) return 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = trail[y * width + x];
      let lv: 0 | 1 | 2 = 0;
      for (let r = 0; r < routeCount; r++) {
        if (levels[r] === 0 || !tunnelUnderTile(r, x, y)) continue;
        if (levels[r] > lv) lv = levels[r];
      }
      if (lv === 0) continue;
      // The live gates, evaluated only for tiles the ladder already knows
      // about, each rung asking only the eyes that can serve it --
      // `./trail.ts`'s own doc comment has the full split.
      const seenC = lv === 2 && seenByCarrier(x, y);
      const seenA = d > 0 && seenByAnyone(x, y);
      const alpha = trailTileAlpha(lv, d, seenA, seenC);
      if (alpha === 0) continue;
      if (count >= capacity) return count;
      out.positions[count * 3] = x;
      // MARK_EPSILON above the tile's own top, like every other mark or
      // decal that would otherwise z-fight the terrain quad directly
      // beneath it (`terrain/shared.ts`'s own doc comment on the constant).
      out.positions[count * 3 + 1] = tileGroundWorldY(elevation, width, height, x, y) + MARK_EPSILON;
      out.positions[count * 3 + 2] = y;
      out.alphas[count] = alpha;
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, InstancedMesh, ShaderMaterial). Not exercised by
// trail-mesh.test.ts for the same reason fog-mesh.ts's own GPU half is not --
// three.js accepts these buffers under `environment: 'node'` (no
// WebGLRenderer needed merely to construct them), but *using* them end to
// end needs a real one. Covered by the browser verification in this task's
// own report instead.
// ---------------------------------------------------------------------------

/**
 * Flat-shaded, per-instance-alpha material -- the trail equivalent of
 * `fog-mesh.ts`'s `createFogMaterial`, with the two deliberate divergences
 * this file's own top comment argues for: `depthTest: true` (real ground
 * geometry, occluded correctly by terrain/buildings/units) and a colour
 * baked from the caller's own `spoilColor` rather than a hardcoded literal.
 */
function createTrailMaterial(spoilColor: string): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(spoilColor);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Every trail-marked tile, one `THREE.InstancedMesh`, one draw call -- the
 * same shape `FogMesh` gives fog, sized to the map's own tile count for the
 * same reason.
 */
export class TrailMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(width: number, height: number, spoilColor: string) {
    const capacity = Math.max(1, width * height);
    const geo = trailQuadGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createTrailMaterial(spoilColor), capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = TRAIL_RENDER_ORDER;
    // Trails can appear anywhere a route runs, exactly like fog spans the
    // whole map -- see UnitInstancer's identical field and comment.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
  }

  /** Rebuilds every instance from the current tunnel/trail state. Called
   *  only when that state was actually resampled (`ThreeRenderer`'s own 5 Hz
   *  cadence, matching Pixi's shared fog/trail refresh gate,
   *  `renderer.ts:733-735`) -- not every 60 Hz frame. */
  update(input: TrailInstanceInput): void {
    const count = writeTrailInstances(input, {
      positions: this.scratchPositions,
      alphas: this.alphaAttr.array as Float32Array,
    });
    for (let i = 0; i < count; i++) {
      this.scratchMatrix.makeTranslation(
        this.scratchPositions[i * 3],
        this.scratchPositions[i * 3 + 1],
        this.scratchPositions[i * 3 + 2]
      );
      this.mesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
