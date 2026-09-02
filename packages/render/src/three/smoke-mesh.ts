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
 * drift, bounded alpha noise, and a per-tile grow-in, all driven by real
 * frame time and all bounded so they can dim a
 * drawn tile but never make it invisible while `sim.smoke` still blocks
 * sight through it. Read that section's own comment for the full
 * desync-safety argument before touching either half.
 */
import * as THREE from 'three';
import { hexToUnit } from './terrain/shared';
import { groundWorldY } from './ground-height';
import { fogQuadGeometry } from './fog-mesh';
import { SMOKE_RENDER_ORDER } from './units/render-order';

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
// Position motion (`smokeBobOffset`, `smokeDriftX/Z`) is purely cosmetic
// wobble bounded to a small fraction of one tile
// (`SMOKE_BOB_AMPLITUDE`/`SMOKE_DRIFT_AMPLITUDE` are both well under half a
// tile) -- a drawn quad never visually leaves the tile whose `sim.smoke`
// value it represents, so it never implies LOS coverage anywhere the sim
// doesn't also grant it. The one exception is the birth overshoot
// (`SMOKE_GROW_SCALE_OVERSHOOT`), which spills 9% of a tile past the
// footprint for the 350 ms of the grow ramp and at the faintest alpha of a
// tile's life; that constant's own doc comment has the trade.
//
// ## Geometry cannot carry the billow -- alpha can
//
// A quad is centred on its own tile, so a scale of anything but exactly 1
// puts a seam between it and its neighbour, uniformly, across the whole
// screen: a grid. That is what the steady-state scale pulse this file used
// to run actually drew, and zeroing it by hand and re-capturing is what
// identified it. So the geometry now moves only RIGIDLY -- a coherent drift
// and a nearly-coherent bob, which shift every quad by the same amount and
// leave the tiling intact -- and the billow lives entirely in alpha, where
// variation composites instead of tiling. See `SMOKE_BREATH_PERIOD_MS`.
//
// ## A smooth phase FIELD, not a per-tile hash
//
// `smokeTilePhase` lays a slow plane wave across the map, so every tile has
// its own phase (no lockstep) and neighbouring tiles have NEARLY THE SAME
// one. The distinction matters and the original got it wrong: an
// uncorrelated `tileHash` phase satisfies "not in lockstep" and produces a
// chequerboard, because `smokeAlphaNoise`'s own +/-15% then lands on
// adjacent tiles as unrelated values. Smoke is a continuum; what reads as
// billowing is slow variation ACROSS tiles, not independent variation
// within each. See `SMOKE_PHASE_FREQ_X`.
//
// ## Grow-in tracks the SPECIFIC 0->nonzero transition, not `d`'s magnitude
//
// The sim lays a screen at instant full density (`SMOKE_MAX`, one tick) and
// decays it uniformly (`SMOKE_DECAY` per tick) -- see `sim.ts`'s own smoke
// command handler and `stepFields`. `updateSmokeGrowStarts` below detects
// exactly that lay moment per tile (comparing this frame's `smoke` against
// the previous frame's) and stamps a start clock; `smokeGrowAlphaFactor`
// ramps up from its floor and `smokeGrowScaleFactor` settles DOWN from its
// overshoot to exactly 1, both over `SMOKE_GROW_DURATION_MS` from that
// stamp. This turns the sim's own
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

/**
 * Period of the density breath `smokeAlphaNoise` runs -- SLOW, because it is
 * now the only billow channel this effect has and a 900 ms cycle (what it
 * was) reads as a flicker rather than a swell once it is carrying that on
 * its own.
 *
 * THE SCALE PULSE IS GONE, and the measurement that killed it is worth
 * keeping. A quad is centred on its own tile, so ANY scale other than
 * exactly 1 puts a seam between it and its neighbour -- below 1 a gap
 * showing bare ground, above 1 a doubled-alpha overlap line -- and it does
 * so uniformly across the whole screen, which is a GRID. That is what a
 * laid screen photographed as. Zeroing `SMOKE_SCALE_PULSE_AMOUNT` by hand
 * and re-capturing (`.superpowers/queue/smoke-animation-report.md`) removed
 * every seam and left a clean continuous sheet, which is what identified
 * the pulse rather than the alpha noise as the cause.
 *
 * The lesson generalises: on a per-tile quad grid, GEOMETRY is the one
 * channel that cannot carry variation without drawing the grid, and ALPHA
 * is the one that can. So the breath moved to alpha, and the only motion
 * left on the geometry is rigid -- a coherent drift and a bob that shift
 * every quad by nearly the same amount, so the tiling survives them.
 */
export const SMOKE_BREATH_PERIOD_MS = 3700;

/**
 * Spatial frequency of the phase field `smokeTilePhase` lays across the
 * map, in cycles per tile on X and on Y.
 *
 * WHAT THIS REPLACED, AND WHY. `smokeTilePhase` used to be `tileHash(x, y)`
 * -- an uncorrelated per-tile hash, chosen so "the 'dims like a single
 * dimmer switch' flatness GH #144 names is what a SHARED phase would still
 * produce, even with motion added." The reasoning is right and the
 * instrument was wrong: a hash gives every tile an INDEPENDENT phase, so
 * `smokeAlphaNoise`'s +/-15% lands on neighbouring tiles as unrelated
 * values and a laid screen reads as a chequerboard of light and dark
 * diamonds -- a tiled floor, photographed on `beit_sahwan_outskirts` (this
 * task's report). Smoke is a continuum: two points a metre apart are at
 * nearly the same density, and it is the SLOW variation across many metres
 * that reads as billowing.
 *
 * A plane wave gives exactly that and nothing else changes: phase is still
 * a pure deterministic function of `(x, y)` with no `Math.random()`, still
 * distinct tile to tile (the frequencies are deliberately not rational
 * multiples of each other or of 1, so no two tiles inside any plausible
 * map share a phase), and still cheap. The difference is that ADJACENT
 * tiles are now close in phase, so the density variation rolls across a
 * screen instead of flickering within it.
 *
 * 0.11 and 0.071: a full cycle every ~9 tiles on X and ~14 on Y, both
 * larger than `SMOKE_RADIUS`'s 3-tile screen, so one screen sees a piece of
 * the wave rather than several periods of it.
 */
export const SMOKE_PHASE_FREQ_X = 0.11;
export const SMOKE_PHASE_FREQ_Y = 0.071;

/** Alpha-noise floor -- the multiplier this channel applies never drops
 *  below this, so it alone can never zero a tile's alpha. Ranges
 *  `[SMOKE_ALPHA_NOISE_MIN, 1]`.
 *
 *  Deepened from 0.85 when the scale pulse was removed (see
 *  `SMOKE_BREATH_PERIOD_MS`): this is now the ONLY channel carrying the
 *  billow, so a +/-15% swing that was a subtle texture alongside a moving
 *  quad reads as nothing at all on its own. 0.72 is still comfortably above
 *  zero -- the desync guarantee this section's own comment makes is that a
 *  drawn tile stays visible while `d > 0`, and the worst-case product with
 *  `SMOKE_GROW_ALPHA_FLOOR` is 0.25, dim but plainly drawn. */
export const SMOKE_ALPHA_NOISE_MIN = 0.72;
export const SMOKE_ALPHA_NOISE_PERIOD_MS = SMOKE_BREATH_PERIOD_MS;

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
/**
 * Scale a freshly-laid quad OVERSHOOTS to before settling back to exactly 1
 * over `SMOKE_GROW_DURATION_MS` -- the screen bursts outward and settles,
 * rather than growing in from small.
 *
 * It used to be a floor of 0.6 growing UP to 1, and the direction is the
 * whole point. Every tile of one screen is born on the same tick, so
 * whatever the grow scale is, it is the same for all of them at once: below
 * 1 that is a lattice of gaps showing bare ground across the entire screen
 * for the first 350 ms (photographed), above 1 it is a lattice of
 * doubled-alpha overlap lines instead -- at the faintest alpha of a tile's
 * whole life, and reading as smoke that has not settled yet rather than as
 * holes in it. Overshooting is the cheaper artefact of the two, and it is
 * also the better read for a grenade.
 */
export const SMOKE_GROW_SCALE_OVERSHOOT = 1.18;

/** Deterministic per-tile phase, radians -- a smooth plane wave across the
 *  map rather than an uncorrelated hash, so neighbouring tiles animate
 *  ALMOST together and a screen billows instead of flickering. See
 *  `SMOKE_PHASE_FREQ_X` for the full account of what this replaced and why.
 *  Still a pure function of `(x, y)`; still not `Math.random()`. */
export function smokeTilePhase(x: number, y: number): number {
  const cycles = x * SMOKE_PHASE_FREQ_X + y * SMOKE_PHASE_FREQ_Y;
  return (cycles - Math.floor(cycles)) * TWO_PI;
}

/** Small sine bob on world Y, phase-offset per tile so a whole screen does
 *  not bob in lockstep. */
export function smokeBobOffset(clockMs: number, phase: number): number {
  return SMOKE_BOB_AMPLITUDE * Math.sin((clockMs / SMOKE_BOB_PERIOD_MS) * TWO_PI + phase);
}

/**
 * Horizontal drift, X axis -- COHERENT, no per-tile phase.
 *
 * It used to take a phase and offset each tile independently. That is not
 * what wind does: a breeze moves a whole screen together, and giving each
 * quad its own drift both (a) reads as jitter rather than motion and (b)
 * opens and closes gaps between neighbouring quads, which is half of why a
 * laid screen photographed as a lattice of separate diamonds rather than a
 * sheet of smoke. One bearing for the whole field also matches what
 * `terrain/mesh.ts`'s `groveMaterial` already does for trees and what
 * `units/smoke-plume.ts`'s `SMOKE_PLUME_LEAN_DIR` now does for plumes.
 *
 * It takes NO phase at all now, and the missing parameter is the point:
 * a coherent channel that still accepted a per-tile phase would be one
 * refactor away from silently reading it again. `SmokeMesh.update`'s call
 * site not having a phase to hand it is the guard.
 */
export function smokeDriftX(clockMs: number): number {
  return SMOKE_DRIFT_AMPLITUDE * Math.sin((clockMs / SMOKE_DRIFT_PERIOD_MS) * TWO_PI);
}

/** Horizontal drift, Z axis -- coherent, see `smokeDriftX`. `cos` against
 *  its `sin` so the whole field traces a slow ellipse rather than sliding
 *  back and forth along one line: a screen that only ever moves on one
 *  diagonal reads as a scrolling texture. */
export function smokeDriftZ(clockMs: number): number {
  return SMOKE_DRIFT_AMPLITUDE * Math.cos((clockMs / SMOKE_DRIFT_PERIOD_MS) * TWO_PI);
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

/** Scale-side grow multiplier, `[1, SMOKE_GROW_SCALE_OVERSHOOT]`, settling
 *  DOWN to exactly 1 -- see `SMOKE_GROW_SCALE_OVERSHOOT` for why the ramp
 *  runs that way round, and why exactly 1 at rest is load-bearing rather
 *  than tidy. */
export function smokeGrowScaleFactor(ageMs: number): number {
  const t = smokeGrowEase(ageMs);
  return SMOKE_GROW_SCALE_OVERSHOOT + (1 - SMOKE_GROW_SCALE_OVERSHOOT) * t;
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

      const scale = smokeGrowScaleFactor(ageMs);
      // `fogQuadGeometry()`'s unit quad spans local (0,0) -> (1,1), anchored
      // at the tile's OWN corner, not its centre (see that function's doc
      // comment) -- so scaling it in place via `compose` would grow the
      // quad away from one corner rather than breathing symmetrically. This
      // offset re-centres the visible pulse/bloom on the tile regardless of
      // `scale`, at the one-line cost of `(1 - scale) * 0.5`.
      const centerAdjust = (1 - scale) * 0.5;

      this.scratchPos.set(
        x + centerAdjust + smokeDriftX(clockMs),
        groundY + smokeBobOffset(clockMs, phase),
        z + centerAdjust + smokeDriftZ(clockMs)
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
