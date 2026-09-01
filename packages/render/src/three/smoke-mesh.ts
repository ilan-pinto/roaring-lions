/**
 * Phase D readiness fix: smoke on screen. `sim.smoke` is a real, working
 * mechanic -- a player-driven ability (`canSmoke`, the `f` key), a genuine
 * line-of-sight block (`raySmoke`/`losRay`, `@lions/sim/sim.ts`) -- and until
 * this file existed, three.js drew nothing for it at all: `grep -rn smoke
 * packages/render/src/three/` returned zero hits. A player who pops smoke
 * paid the ability, got the LOS block, and saw no change on screen
 * whatsoever -- "the worst failure class available: a working mechanic
 * rendered invisible" (Phase D readiness audit, blocker #2). This module is
 * the fix: it draws what `sim.smoke` already computes, the same way
 * `fog-mesh.ts` draws `Sim`'s own fog array -- that file is this one's
 * direct structural template (per-tile `Uint8Array`, `groundWorldY`-lifted
 * instanced quad, pure write function separated from GPU construction), not
 * merely similar in spirit.
 *
 * ## Ported from `renderer.ts:2576-2591`, not redesigned
 *
 * Pixi's smoke loop:
 *
 *   for (y, x): const d = this.sim.smoke[y * w + x]; if (d === 0) continue;
 *   g.poly([diamond around (isoX,isoY)]).fill({ color: '#C9CBC4', alpha:
 *   (d / 255) * 0.72 });
 *
 * `d` is the raw `Uint8Array` byte (0-255, `SMOKE_MAX` in `@lions/sim` is
 * 255), and Pixi's own comment: "drawn over the ground and under the units
 * so troops inside one still read -- it obscures, it does not delete them."
 * `(d / 255) * 0.72` is reproduced verbatim below -- `writeSmokeInstances`'s
 * own alpha line is that same expression, not a rescaled or clamped variant.
 *
 * ## `'#C9CBC4'` is NOT run through `resolveColor`, and does NOT equal a
 * single palette swatch exactly -- ported as a literal anyway
 *
 * `fog-mesh.ts`'s own top comment already establishes the precedent this
 * follows: Pixi's smoke fill, like its fog fill, is a raw hex literal with
 * no `resolveColor` call at that line (`renderer.ts:2589` -- unlike terrain
 * tones, which genuinely vary per map theme, smoke's tint does not). Unlike
 * fog's `#0A0A08` (byte-identical to `shadow.2`), smoke's `#C9CBC4` is not
 * an exact palette entry -- the nearest ramp swatch (`gunmetal.0`,
 * `#C3C7C4`) sits a Euclidean RGB distance of ~7 away, not 0. That is a fact
 * about the ALREADY-SHIPPED Pixi renderer, which this phase's own brief
 * pins as the reference ("Pixi is the reference -- port, do not redesign"):
 * inventing a palette key this literal does not actually belong to would be
 * redesigning Pixi's colour choice, not porting it. `SMOKE_COLOR` below is
 * therefore hardcoded, exactly like `FOG_COLOR`, with this paragraph
 * standing in for a `resolveColor` call Pixi itself never makes.
 *
 * ## Band: `SMOKE_RENDER_ORDER` (5), not `OVERLAY_RENDER_ORDER` (4)
 *
 * See `units/render-order.ts`'s own band-5 row for the full argument: Pixi's
 * smoke block draws into the same `unitsG` container the whole overlay tier
 * does, but LATER in the same per-frame method, so on screen it paints OVER
 * HP bars/selection rings/order markers, not merely alongside them. A
 * dedicated band above `OVERLAY_RENDER_ORDER` (and below `FOG_RENDER_ORDER`,
 * matching `unitsG` sitting below `fogG`) reproduces that relationship
 * without relying on `Object3D.id` construction-order tiebreaking between
 * two independently-built meshes.
 *
 * ## GH #144: animation added on top, still a faithful port of the baseline
 *
 * The paragraphs above describe the ORIGINAL port, which was a static,
 * translation-only quad with alpha as its one channel -- no drift, no
 * billow, an instant full-radius pop-in, all flagged in GH #144 as
 * "the only visible motion is the sim's uniform lockstep decay." That
 * baseline (`writeSmokeInstances`'s position/alpha math, `SMOKE_COLOR`,
 * `SMOKE_ALPHA_MAX`) is UNCHANGED by this section -- still the verbatim
 * Pixi port the paragraphs above describe. What GH #144 added sits below,
 * in its own "Presentation animation (GH #144)" section comment: bob,
 * drift, a breathing scale pulse, bounded alpha noise, and a per-tile
 * grow-in, all driven by real frame time and all bounded so they can dim a
 * drawn tile but never make it invisible while `sim.smoke` still blocks
 * sight through it. Read that section's own comment for the full
 * desync-safety argument before touching either half.
 */
import * as THREE from 'three';
import { hexToUnit } from './terrain/shared';
import { groundWorldY } from './ground-height';
import { fogQuadGeometry } from './fog-mesh';
import { SMOKE_RENDER_ORDER } from './units/render-order';
import { tileHash } from '../tile-hash';

// ---------------------------------------------------------------------------
// Pure: no THREE.* below this line yet -- mirrors fog-mesh.ts's own split.
// ---------------------------------------------------------------------------

/** Pixi's own smoke-fill literal (`renderer.ts:2589`), `#C9CBC4` -- see this
 *  file's own top comment for why it is hardcoded, not resolved from a
 *  palette key, and why it is NOT the same case as `FOG_COLOR` (which does
 *  equal one exactly). */
export const SMOKE_COLOR = '#C9CBC4';

/** Pixi's own alpha multiplier -- `(d / 255) * SMOKE_ALPHA_MAX`, `d` the raw
 *  smoke byte (`renderer.ts:2589`'s `(d / 255) * 0.72`). */
export const SMOKE_ALPHA_MAX = 0.72;

/** Per-instance GPU attribute arrays `writeSmokeInstances` fills, sized (by
 *  the caller) to the map's own tile count -- the worst case, every tile
 *  smoked at once, is unlikely but not impossible (a full box barrage), and
 *  costs nothing to provision for up front, the identical reasoning
 *  `FogInstanceBuffers` already uses for the boot-state (all-fogged) case. */
export interface SmokeInstanceBuffers {
  /** xyz triples, world space -- the tile's own `(x, groundWorldY, y)`. */
  positions: Float32Array;
  /** One alpha per instance: `(d / 255) * SMOKE_ALPHA_MAX`. */
  alphas: Float32Array;
}

/**
 * Visits every tile with `smoke[t] !== 0` and writes its world position and
 * alpha. Pure aside from `groundWorldY` (itself pure) -- no `THREE.*` -- the
 * direct analogue of `writeFogInstances`, differing only in the source array
 * (`smoke`, not `fog`) and the alpha formula (a continuous `d/255` fade, not
 * `fog`'s two-value level switch).
 *
 * Returns the number of instances written, which the caller sets `mesh.count`
 * to -- the only "hide an instance" mechanism an `InstancedMesh` has,
 * matching `writeFogInstances`'s own contract.
 */
export function writeSmokeInstances(
  smoke: Uint8Array,
  width: number,
  height: number,
  elevation: Uint8Array | null,
  out: SmokeInstanceBuffers
): number {
  const capacity = out.alphas.length;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = smoke[y * width + x];
      if (d === 0) continue;
      if (count >= capacity) return count;
      out.positions[count * 3] = x;
      out.positions[count * 3 + 1] = groundWorldY(elevation, width, height, x, y);
      out.positions[count * 3 + 2] = y;
      out.alphas[count] = (d / 255) * SMOKE_ALPHA_MAX;
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Presentation animation (GH #144) -- still pure, still no THREE.*.
//
// GH #144: SmokeMesh had zero visual animation -- a fixed flat quad,
// translation-only, alpha the only channel, redrawn verbatim from the sim's
// own byte every frame. The functions below add drift/billow/breathing on
// top of that unchanged baseline, driven by REAL frame time (`clockMs`, an
// accumulated `dtMs` total the caller owns -- see `ThreeRenderer.smokeClockMs`
// -- never `Date.now()`/`performance.now()`, matching `windClockMs`/
// `trackClockMs`'s identical existing pattern and `Renderer.frame`'s
// documented contract that a backend must not read its own clock). None of
// this is sim-tick-driven and none of it can affect simulation outcomes: it
// only ever reads `sim.smoke`, never writes it.
//
// ## The desync guarantee this design protects, explicitly
//
// `raySmoke` (`packages/sim/src/sim.ts`) blocks sight off `sim.smoke[tile]`
// directly, independent of anything below. Two invariants keep the visual
// truthful to that:
//
//   1. WHETHER a tile draws at all is untouched. `writeSmokeInstances` above
//      is not modified by any of this -- a tile with `smoke[t] === 0` still
//      writes no instance, and a tile with `smoke[t] !== 0` still writes
//      exactly one, on the same `d !== 0` test `raySmoke` itself effectively
//      uses. The animation below only ever runs for instances that already
//      exist; it cannot make a blocking tile disappear or a clear tile
//      appear.
//   2. HOW VISIBLE a drawn tile is stays bounded away from zero for as long
//      as `d > 0`. The two cosmetic alpha multipliers this file adds --
//      `smokeAlphaNoise` (floor `SMOKE_ALPHA_NOISE_MIN`) and
//      `smokeGrowAlphaFactor` (floor `SMOKE_GROW_ALPHA_FLOOR`) -- both stay
//      strictly positive at every input, so their product against the
//      existing `(d/255)*SMOKE_ALPHA_MAX` baseline can dim a tile but never
//      zero it while `d > 0`. A tile is never rendered invisible while
//      `raySmoke` still counts it -- the specific failure mode the GH #144
//      brief calls "a WORSE bug than the one you are fixing."
//
// Position/scale motion (`smokeBobOffset`, `smokeDriftX/Z`,
// `smokeScalePulse`) is purely cosmetic wobble bounded to a small fraction
// of one tile (`SMOKE_BOB_AMPLITUDE`/`SMOKE_DRIFT_AMPLITUDE` are both well
// under half a tile, and the scale pulse is +/-5%) -- a drawn quad never
// visually leaves the tile whose `sim.smoke` value it represents, so it
// never implies LOS coverage anywhere the sim doesn't also grant it.
//
// ## Per-tile phase, not a global clock read
//
// `smokeTilePhase` hashes `(x, y)` through the SAME `tileHash` every other
// deterministic per-tile scatter effect in this backend already uses
// (`ThreeRenderer.ts`'s own `tileHash` imports for kill-yaw/collapse-yaw/
// spoil-jitter) -- not `Math.random()`, per this codebase's established
// presentation-PRNG convention. Every tile in one freshly-laid smoke screen
// therefore animates slightly out of phase with its neighbours: the "dims
// like a single dimmer switch" flatness GH #144 names is what a SHARED
// phase would still produce, even with motion added.
//
// ## Grow-in tracks the SPECIFIC 0->nonzero transition, not `d`'s magnitude
//
// The sim lays a screen at instant full density (`SMOKE_MAX`, one tick) and
// decays it uniformly (`SMOKE_DECAY` per tick) -- see `sim.ts`'s own smoke
// command handler and `stepFields`. `updateSmokeGrowStarts` below detects
// exactly that lay moment per tile (comparing this frame's `smoke` against
// the previous frame's) and stamps a start clock; `smokeGrowAlphaFactor`/
// `smokeGrowScaleFactor` ramp from their floor to 1 over
// `SMOKE_GROW_DURATION_MS` from that stamp. This turns the sim's own
// instant, uniform pop-in into a brief, per-tile bloom on screen without
// touching the sim's timing at all -- the ramp is read-only presentation
// layered on top of a `d` value that was already fully set the instant the
// command landed.

const TWO_PI = Math.PI * 2;

/** Vertical bob amplitude, in tile units -- comfortably under half a tile,
 *  so a smoked tile's quad never visually strays into a neighbour's
 *  footprint. */
export const SMOKE_BOB_AMPLITUDE = 0.08;
/** Full bob cycle length. A few seconds, not a fast flutter -- "billow", not
 *  a shiver. */
export const SMOKE_BOB_PERIOD_MS = 3200;

/** Horizontal drift amplitude, in tile units -- same "stays inside the
 *  tile" reasoning as the bob amplitude above. */
export const SMOKE_DRIFT_AMPLITUDE = 0.06;
/** Drift period, deliberately different from the bob period so the two
 *  motions don't lock into a single repeating Lissajous loop that would
 *  read as mechanical. */
export const SMOKE_DRIFT_PERIOD_MS = 5400;

/** Breathing scale amplitude: +/-5% -- a soft pulse, not a visible size
 *  pop. */
export const SMOKE_SCALE_PULSE_AMOUNT = 0.05;
export const SMOKE_SCALE_PULSE_PERIOD_MS = 4100;

/** Alpha-noise floor -- the multiplier this channel applies never drops
 *  below this, so it alone can never zero a tile's alpha. Ranges
 *  `[SMOKE_ALPHA_NOISE_MIN, 1]`. */
export const SMOKE_ALPHA_NOISE_MIN = 0.85;
export const SMOKE_ALPHA_NOISE_PERIOD_MS = 900;

/** How long a freshly-laid tile takes to bloom from its grow floor to full
 *  presentation strength. Brief -- "a few hundred ms", per the GH #144
 *  brief's own proposed approach -- not a slow fade a player would read as
 *  latency. */
export const SMOKE_GROW_DURATION_MS = 350;
/** Alpha-side grow floor. Combined with `SMOKE_ALPHA_NOISE_MIN` the worst
 *  case multiplier is `SMOKE_GROW_ALPHA_FLOOR * SMOKE_ALPHA_NOISE_MIN`
 *  (~0.30) -- dim, never zero, at the exact instant a tile is born, which
 *  is the one moment `ageMs` is smallest. */
export const SMOKE_GROW_ALPHA_FLOOR = 0.35;
/** Scale-side grow floor -- the quad starts visibly smaller and blooms
 *  outward to full footprint, independent of the alpha ramp above. */
export const SMOKE_GROW_SCALE_FLOOR = 0.6;

/** Deterministic per-tile phase, radians -- `tileHash`'s own `[0, 1)` output
 *  scaled to a full turn. Same hash every other per-tile scatter effect in
 *  this backend uses (see this section's own top comment); NOT
 *  `Math.random()`. */
export function smokeTilePhase(x: number, y: number): number {
  return tileHash(x, y) * TWO_PI;
}

/** Small sine bob on world Y, phase-offset per tile so a whole screen does
 *  not bob in lockstep. */
export function smokeBobOffset(clockMs: number, phase: number): number {
  return SMOKE_BOB_AMPLITUDE * Math.sin((clockMs / SMOKE_BOB_PERIOD_MS) * TWO_PI + phase);
}

/** Horizontal drift, X axis. A different phase multiplier than
 *  `smokeDriftZ` (and `sin`, not `cos`) so the two axes don't trace a
 *  perfect circle -- a slightly irregular drift reads less mechanical than
 *  a perfect orbit. */
export function smokeDriftX(clockMs: number, phase: number): number {
  return SMOKE_DRIFT_AMPLITUDE * Math.sin((clockMs / SMOKE_DRIFT_PERIOD_MS) * TWO_PI + phase * 1.3);
}

/** Horizontal drift, Z axis -- see `smokeDriftX`'s own doc comment for why
 *  this uses `cos` and a different phase multiplier. */
export function smokeDriftZ(clockMs: number, phase: number): number {
  return SMOKE_DRIFT_AMPLITUDE * Math.cos((clockMs / SMOKE_DRIFT_PERIOD_MS) * TWO_PI + phase * 0.7);
}

/** Uniform breathing scale, centred on 1.0. Multiplied by
 *  `smokeGrowScaleFactor` at the call site, not folded in here -- this
 *  function alone answers only "what does steady-state billow look like",
 *  independent of how old the tile's own smoke is. */
export function smokeScalePulse(clockMs: number, phase: number): number {
  return 1 + SMOKE_SCALE_PULSE_AMOUNT * Math.sin((clockMs / SMOKE_SCALE_PULSE_PERIOD_MS) * TWO_PI + phase * 1.7);
}

/** Bounded per-tile alpha texture, `[SMOKE_ALPHA_NOISE_MIN, 1]` -- a sine
 *  remapped into that range rather than a raw `[-1, 1]` oscillation, so the
 *  floor is reachable exactly and never crossed. */
export function smokeAlphaNoise(clockMs: number, phase: number): number {
  const s = Math.sin((clockMs / SMOKE_ALPHA_NOISE_PERIOD_MS) * TWO_PI + phase * 2.3);
  return SMOKE_ALPHA_NOISE_MIN + (1 - SMOKE_ALPHA_NOISE_MIN) * ((s + 1) / 2);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smoothstep ease, `[0, 1]` -> `[0, 1]`, clamped outside its domain. */
function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** 0 at the instant a tile is born (`ageMs === 0`), 1 once
 *  `SMOKE_GROW_DURATION_MS` has elapsed, eased -- the shared ramp both grow
 *  factors below lerp into their own floor. */
export function smokeGrowEase(ageMs: number): number {
  return smoothstep01(ageMs / SMOKE_GROW_DURATION_MS);
}

/** Alpha-side grow multiplier, `[SMOKE_GROW_ALPHA_FLOOR, 1]`. */
export function smokeGrowAlphaFactor(ageMs: number): number {
  const t = smokeGrowEase(ageMs);
  return SMOKE_GROW_ALPHA_FLOOR + (1 - SMOKE_GROW_ALPHA_FLOOR) * t;
}

/** Scale-side grow multiplier, `[SMOKE_GROW_SCALE_FLOOR, 1]`. */
export function smokeGrowScaleFactor(ageMs: number): number {
  const t = smokeGrowEase(ageMs);
  return SMOKE_GROW_SCALE_FLOOR + (1 - SMOKE_GROW_SCALE_FLOOR) * t;
}

/**
 * Stamps `growStart[tileIndex] = clockMs` for every tile that is nonzero
 * THIS call and was zero on the PREVIOUS call (`prevSmoke`), then copies
 * `smoke` into `prevSmoke` for the next call's diff. Mutates both `growStart`
 * and `prevSmoke` in place (the same "writes only to explicit
 * caller-supplied outputs, no hidden state" shape `writeSmokeInstances`
 * above already establishes as this file's definition of "pure").
 *
 * Deliberately does NOT restamp a tile that was already nonzero last call
 * (ongoing, decaying smoke keeps its original birth clock, so it does not
 * re-bloom every frame) and DOES restamp a tile that goes 0 -> nonzero ->
 * 0 -> nonzero again (a fresh screen laid where an old one just finished
 * decaying is, correctly, a new birth).
 */
export function updateSmokeGrowStarts(
  smoke: Uint8Array,
  prevSmoke: Uint8Array,
  growStart: Float64Array,
  clockMs: number,
  width: number,
  height: number
): void {
  const count = width * height;
  for (let i = 0; i < count; i++) {
    if (smoke[i] !== 0 && prevSmoke[i] === 0) {
      growStart[i] = clockMs;
    }
  }
  prevSmoke.set(smoke);
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction.
// ---------------------------------------------------------------------------

/**
 * Flat-shaded, per-instance-alpha material -- structurally `createFogMaterial`
 * verbatim (`fog-mesh.ts`), one shared `uColor` uniform and a per-instance
 * `aAlpha` attribute, `depthTest: false`/`depthWrite: false` for the same
 * "unconditional overlay" reason fog needs it: a flat quad coplanar with the
 * ground would lose the depth comparison to any unit standing on that same
 * tile, which is exactly backwards from "the smoke still shows over a unit
 * standing in it" (Pixi's own comment, "it obscures, it does not delete
 * them" -- alpha does that job, but only if the quad is not itself occluded
 * first).
 */
function createSmokeMaterial(): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(SMOKE_COLOR);
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
 * Every smoked tile, one `THREE.InstancedMesh`, one draw call -- `FogMesh`'s
 * own shape, sized to the map's own tile count. Reuses `fogQuadGeometry()`
 * directly rather than a second copy: a smoke quad is the identical unit
 * tile footprint a fog quad is, just translated and given a different
 * material/alpha.
 */
export class SmokeMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  /** Identity, and never mutated -- smoke quads never rotate (their
   *  footprint isn't elongated the way `smoke_plume.glb`'s is, so unlike
   *  `SmokePlumeManager` there is no visible axis for a yaw to orient). A
   *  single reused identity satisfies `THREE.Matrix4.compose`'s signature
   *  without allocating a fresh quaternion per instance per frame. */
  private readonly identityQuat = new THREE.Quaternion();
  /** GH #144: per-tile ms clock at which that tile last transitioned from
   *  smoke-free to smoked -- `updateSmokeGrowStarts`'s own output, read
   *  back here as `clockMs - growStart[tile]` to drive the grow-in ramp.
   *  Sized to the full grid (not merely the current instance count) because
   *  a tile's growth clock must survive frames where it draws zero
   *  instances on neither side of a transition. */
  private readonly growStart: Float64Array;
  /** GH #144: the previous call's `smoke` array, `updateSmokeGrowStarts`'s
   *  own diff input -- see that function's own doc comment for why this
   *  needs to persist across calls rather than being a local. */
  private readonly prevSmoke: Uint8Array;

  constructor(width: number, height: number) {
    const capacity = Math.max(1, width * height);
    const geo = fogQuadGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createSmokeMaterial(), capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = SMOKE_RENDER_ORDER;
    // Smoke can drift anywhere on the map, exactly like fog/units/particles
    // -- see UnitInstancer's identical field and comment.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
    this.growStart = new Float64Array(capacity);
    this.prevSmoke = new Uint8Array(capacity);
  }

  /**
   * Rebuilds every instance from the current `smoke` array. Called once per
   * `frame()`, matching Pixi's own per-frame smoke loop (smoke has no
   * `fogDirty`-style dirty flag in Pixi -- it is redrawn every frame there,
   * so it is here too, rather than gated to the 5 Hz fog cadence).
   *
   * `clockMs` is GH #144's animation clock -- an accumulated real `dtMs`
   * total the caller owns (`ThreeRenderer.smokeClockMs`), never a sim tick
   * and never `Date.now()`. Defaults to 0 so a caller that genuinely wants
   * the frozen-clock baseline (or a test exercising only
   * `writeSmokeInstances`'s own base position/alpha, unaffected by any of
   * this) still compiles and still gets a deterministic, if motionless,
   * result -- `smokeBobOffset(0, phase)` etc. all evaluate to their
   * phase-dependent value AT t=0, not a special-cased "off" branch.
   *
   * WHICH tiles draw at all is decided upstream, by `writeSmokeInstances`
   * alone, exactly as before this task -- everything below only adjusts
   * HOW an already-decided-to-exist instance looks. See this file's own
   * "Presentation animation (GH #144)" section comment for the full
   * desync-safety argument.
   */
  update(
    smoke: Uint8Array,
    elevation: Uint8Array | null,
    width: number,
    height: number,
    clockMs = 0
  ): void {
    updateSmokeGrowStarts(smoke, this.prevSmoke, this.growStart, clockMs, width, height);
    const alphas = this.alphaAttr.array as Float32Array;
    const count = writeSmokeInstances(smoke, width, height, elevation, {
      positions: this.scratchPositions,
      alphas,
    });
    for (let i = 0; i < count; i++) {
      const x = this.scratchPositions[i * 3];
      const groundY = this.scratchPositions[i * 3 + 1];
      const z = this.scratchPositions[i * 3 + 2];
      const tileIndex = z * width + x;
      const phase = smokeTilePhase(x, z);
      const ageMs = clockMs - this.growStart[tileIndex];

      const scale = smokeScalePulse(clockMs, phase) * smokeGrowScaleFactor(ageMs);
      // `fogQuadGeometry()`'s unit quad spans local (0,0) -> (1,1), anchored
      // at the tile's OWN corner, not its centre (see that function's doc
      // comment) -- so scaling it in place via `compose` would grow the
      // quad away from one corner rather than breathing symmetrically. This
      // offset re-centres the visible pulse/bloom on the tile regardless of
      // `scale`, at the one-line cost of `(1 - scale) * 0.5`.
      const centerAdjust = (1 - scale) * 0.5;

      this.scratchPos.set(
        x + centerAdjust + smokeDriftX(clockMs, phase),
        groundY + smokeBobOffset(clockMs, phase),
        z + centerAdjust + smokeDriftZ(clockMs, phase)
      );
      this.scratchScale.set(scale, scale, scale);
      this.scratchMatrix.compose(this.scratchPos, this.identityQuat, this.scratchScale);
      this.mesh.setMatrixAt(i, this.scratchMatrix);

      // Cosmetic-only alpha texture on top of `writeSmokeInstances`'s own
      // `(d/255)*SMOKE_ALPHA_MAX` baseline, already sitting in `alphas[i]`.
      // Both factors have a strictly-positive floor (see this file's own
      // "Presentation animation" section comment) -- this can dim a drawn
      // tile but never zero it while `d > 0`.
      alphas[i] *= smokeAlphaNoise(clockMs, phase) * smokeGrowAlphaFactor(ageMs);
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
