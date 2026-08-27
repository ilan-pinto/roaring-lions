/**
 * Task B4.2: fog on screen. `./fog.ts` (Task B4.1) is the pure computation --
 * `computeFog`/`hasSight`/`isFogVisible`, no `THREE.*`, no `Sim`. This module
 * is the draw: one quad per non-visible tile, built the same two-layer way
 * every other FX mesh in this backend is (`units/fx.ts`'s own split) -- plain
 * geometry/attribute arithmetic first (testable in `environment: 'node'`),
 * `THREE.*` GPU construction after the divider below.
 *
 * ## Ruling 1, restated for this file
 *
 * Pixi does not tint terrain to make fog. `fogG` is a separate `Graphics`
 * added to `world` LAST (`renderer.ts:551`), drawing a `#0A0A08` diamond over
 * every non-visible tile -- alpha 1 for never-seen, 0.55 for explored. It
 * sits above terrain AND units, which is what makes "unobserved ground and
 * anything standing on it are hidden together" true. `#0A0A08` is `shadow.2`,
 * a palette entry (per the plan's own Ruling 1) -- hardcoded here exactly as
 * Pixi hardcodes it in `drawFog` (no `resolveColor` call there either; fog's
 * colour is not authored per-map, unlike terrain tones).
 *
 * In three.js there is no screen-space diamond to draw: a tile's fog quad is
 * the same flat, ground-plane footprint `terrain/ground.ts`'s own tile-top
 * quad already is (`buildGround`'s `pushQuad([x,topY,y],[x+1,topY,y],
 * [x+1,topY,y+1],[x,topY,y+1], color, false)`), just translated to the
 * tile's own `groundWorldY` and given a per-instance alpha instead of a
 * baked vertex colour. The camera's own dimetric projection does the
 * "diamond on screen" work Pixi's `isoX`/`isoY` call did explicitly -- see
 * `fogQuadGeometry`'s own doc comment for the exact winding this reuses.
 *
 * ## "Above everything" means `depthTest: false`, not merely a high `renderOrder`
 *
 * A fog quad sits at its own tile's flat ground height. A hostile unit
 * standing on that same tile has a body that rises well above that flat
 * plane. With `depthTest: true`, the unit's own raised geometry would win
 * the depth comparison at every pixel its silhouette covers -- the fog quad
 * would correctly cover the BARE ground around a hidden unit while the unit
 * itself pokes straight through it, which is exactly backwards from "hides a
 * hostile standing in it." `depthTest: false` (matching the `above_units`
 * particle tier's own recipe, `units/fx.ts`'s "The `above_units` split") is
 * what makes fog an unconditional overlay regardless of what geometry
 * already committed a nearer depth at that pixel -- the same guarantee
 * Pixi's `fogG` gets for free by being the last thing painted, with no depth
 * buffer to argue with it at all.
 *
 * `FOG_RENDER_ORDER` (`units/render-order.ts`) sits above every FX tier, not
 * merely above units, because a BELOW-tier particle (`tunnel_collapse`,
 * genuinely depth-tested against terrain) must not shine through fog
 * covering the ground it was spawned into either. Pixi's own container
 * order agrees: `fxG` is added to `world` before `fogG` (`renderer.ts:540`
 * vs. `:551`), so fog already sat above every Pixi FX layer, not only above
 * units.
 *
 * It is not literally the very next band above `FX_RENDER_ORDER_ABOVE`
 * (`units/render-order.ts` reserves bands 4-9 as headroom for Phase C's
 * overlay tier and puts `FOG_RENDER_ORDER` at 10, not 4, to leave that tier
 * room underneath fog rather than above it) -- but "above every FX tier" is
 * a statement about ORDER, not about exactly how many bands separate the
 * two, and stays true regardless of the gap's width.
 */
import * as THREE from 'three';
import { pushPolygon, hexToUnit } from './terrain/shared';
import { groundWorldY } from './ground-height';
import { FOG_RENDER_ORDER } from './units/render-order';

// ---------------------------------------------------------------------------
// Pure: geometry and per-instance attribute arithmetic. No THREE.* GPU
// objects below this line yet -- mirrors units/fx.ts's own split, for the
// same reason: `FogMesh` construction needs nothing headless cannot provide,
// but nothing here needs even that much.
// ---------------------------------------------------------------------------

/** Pixi's `drawFog` literal (`renderer.ts:1186`), `#0A0A08` -- `shadow.2` in
 *  the palette, per the plan's own Ruling 1. Not run through `resolveColor`:
 *  Pixi's own fog fill isn't either, unlike terrain tones, which genuinely
 *  vary per map theme. */
export const FOG_COLOR = '#0A0A08';
/** Alpha for a fog level 0 tile (never seen) -- `renderer.ts:1186`'s
 *  `v === 0 ? 1 : 0.55`. */
export const FOG_ALPHA_NEVER_SEEN = 1;
/** Alpha for a fog level 1 tile (explored, not currently observed) -- same
 *  source line. Level 2 (in sight now) draws no quad at all. */
export const FOG_ALPHA_EXPLORED = 0.55;

/** The shared per-instance quad, in LOCAL space: a unit tile footprint
 *  (0,0)-(1,1) on the ground plane (local y = 0). `FogMesh` translates this
 *  per instance to `(x, groundWorldY(tile), y)` via `instanceMatrix` -- no
 *  scale needed, since every tile is exactly one unit square, unlike a
 *  particle's variable radius. */
export interface FogQuadGeometry {
  /** xyz triples, four vertices. */
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Built via the SAME `pushPolygon(points, color, flip: false)` call
 * `terrain/ground.ts`'s `buildGround` uses for a tile's TOP quad --
 * `[x,topY,y], [x+1,topY,y], [x+1,topY,y+1], [x,topY,y+1]`, `flip: false`,
 * documented there as giving "an up-facing (+Y) normal". Reproduced here at
 * local origin (drop `x`/`topY`/`y`, keep the same four-corner shape and
 * winding) rather than re-derived: `ground.ts`'s own winding was worked out
 * and proven against this camera's fixed dimetric convention once, and a fog
 * quad needs the identical up-facing orientation for the identical reason
 * (it lies flat on the ground plane, viewed from the same camera). `flip`
 * getting this backwards would not misplace anything -- a flat quad's back
 * face is invisible either way under `THREE.FrontSide` -- so a bug here
 * reads as "fog never renders," not "fog renders inside out"; `fog-mesh.
 * test.ts` asserts the exact index sequence against `pushPolygon`'s own
 * output rather than merely trusting the call.
 */
export function fogQuadGeometry(): FogQuadGeometry {
  const positions: number[] = [];
  // `pushPolygon` also writes a per-vertex colour; fog's colour is a
  // material uniform (every instance is the same `FOG_COLOR`, only alpha
  // varies per instance), so this output is built and discarded.
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

/** Per-instance GPU attribute arrays `writeFogInstances` fills, sized (by the
 *  caller) to the map's own tile count -- the worst case, every tile fogged
 *  at once, is also the boot state (an all-zero `fog` array), so that is the
 *  one capacity that can never be exceeded. */
export interface FogInstanceBuffers {
  /** xyz triples, world space -- the translation each instance's
   *  `instanceMatrix` gets: the tile's own `(x, groundWorldY, y)`. */
  positions: Float32Array;
  /** One alpha per instance: `FOG_ALPHA_NEVER_SEEN` or `FOG_ALPHA_EXPLORED`. */
  alphas: Float32Array;
}

/**
 * Visits every tile NOT currently in sight (`fog[t] !== 2`) and writes its
 * world position and alpha. Pure aside from `groundWorldY` (itself pure) --
 * no `THREE.*` -- so this is exercised directly in `fog-mesh.test.ts` with a
 * plain `Uint8Array` fog buffer, no `WebGLRenderer` needed.
 *
 * `isExplored` was deliberately not ported to `./fog` (Task B4.1's own top
 * comment names this as one of two decisions left to this task). It is not
 * added here either: this function already visits every tile's raw fog
 * VALUE once, in a full-array scan, to decide whether to draw a quad for it
 * at all (`v === 2` skip below) -- the never-seen-vs-explored alpha split is
 * one more comparison against a value already in hand (`v === 0`), not a
 * second array read through a `(fog, w, h, x, y) => boolean` predicate
 * `isVisible`-style. `./fog.ts`'s `isFogVisible` earns its existence as a
 * POINT query because `ThreeRenderer.isVisible` has no full-array scan to
 * piggyback on; this function's own scan makes an equivalent
 * `isExplored(fog, w, h, x, y)` point query strictly more expensive for no
 * behavioural gain, so it is inlined instead.
 *
 * Returns the number of instances written, which the caller sets
 * `mesh.count` to -- the only "hide an instance" mechanism an
 * `InstancedMesh` has, matching `writeParticleInstances`'s own contract.
 */
export function writeFogInstances(
  fog: Uint8Array,
  width: number,
  height: number,
  elevation: Uint8Array | null,
  out: FogInstanceBuffers
): number {
  const capacity = out.alphas.length;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fog[y * width + x];
      // In sight right now -- no overlay. The one case this loop skips.
      if (v === 2) continue;
      if (count >= capacity) return count;
      out.positions[count * 3] = x;
      out.positions[count * 3 + 1] = groundWorldY(elevation, width, height, x, y);
      out.positions[count * 3 + 2] = y;
      out.alphas[count] = v === 0 ? FOG_ALPHA_NEVER_SEEN : FOG_ALPHA_EXPLORED;
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, InstancedMesh, ShaderMaterial). Not exercised by
// fog-mesh.test.ts for the same reason units/fx.ts's own GPU half is not --
// three.js accepts these buffers under `environment: 'node'` (no
// WebGLRenderer needed merely to construct them), but *using* them end to
// end needs a real one. Covered by the browser verification in this task's
// own report instead.
// ---------------------------------------------------------------------------

/**
 * Flat-shaded, per-instance-alpha material -- structurally the fog
 * equivalent of `units/fx.ts`'s `createParticleMaterial`, minus the circle
 * cutout (a fog tile is a full quad, not a disc) and minus a per-instance
 * colour attribute (every instance shares the one `FOG_COLOR`, so a uniform
 * suffices -- cheaper than an `InstancedBufferAttribute` nothing would ever
 * vary).
 *
 * `depthTest: false`, `depthWrite: false`: see this file's own top comment,
 * "'Above everything' means `depthTest: false`, not merely a high
 * `renderOrder`", for why a depth-tested quad coplanar with the ground would
 * lose to the very unit geometry it exists to hide.
 */
function createFogMaterial(): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(FOG_COLOR);
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
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Every non-visible tile, one `THREE.InstancedMesh`, one draw call -- the
 * same shape `ParticleInstancer` gives particles, sized to the map's own
 * tile count (`width * height`) rather than a smaller guess, for the same
 * reason `PARTICLE_CAPACITY` is sized to the real ceiling: the worst case
 * (every tile fogged) is also the FIRST frame's actual state, not a rare
 * edge.
 */
export class FogMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(width: number, height: number) {
    const capacity = Math.max(1, width * height);
    const geo = fogQuadGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createFogMaterial(), capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = FOG_RENDER_ORDER;
    // Fog spans the whole map, exactly like units/particles/tracers -- see
    // UnitInstancer's identical field and comment.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
  }

  /** Rebuilds every instance from the current `fog` array. Called only when
   *  fog data actually changed (`ThreeRenderer`'s own 5 Hz cadence, matching
   *  Pixi's `fogDirty` gate) -- not every 60 Hz frame. */
  update(fog: Uint8Array, elevation: Uint8Array | null, width: number, height: number): void {
    const count = writeFogInstances(fog, width, height, elevation, {
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
