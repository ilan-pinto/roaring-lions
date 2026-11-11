/**
 * Defilade T4 (GH-705), Task 4: a GPU-instanced, GPU-aged billboard flipbook
 * for explosions, dirt kick-ups and smoke.
 *
 * One `InstancedBufferGeometry` drawn by TWO meshes with two copies of one
 * program: `mesh` (smoke and dirt, depth-tested, band 5) and `fireMesh`
 * (fire, `depthTest: false`, band 5.5 -- a fireball engulfs the hull it came
 * from). Each instance carries its own start time, duration, scale, type,
 * seed and tint; the vertex shader ages it off ONE uniform clock (the frame
 * clock the explosion-burst mesh already steps on, so hit-stop freezes it),
 * and an instance of the other pass's type is collapsed off-screen there. A
 * live puff costs the CPU nothing after spawn: `push` uploads only the slot
 * it wrote (`addUpdateRange`), never the 2048-slot buffers.
 *
 * Types:
 *   0 FIRE  -- dual-phase colour curve: HDR white_hot/fire x
 *              `HDR_GAINS.fireball` for the first ~16% of its life, through
 *              ember, to soot (`shadow.0`) and grey smoke (`gunmetal.1`).
 *   1 SMOKE -- lit soot -> grey (or, by its tint, dust), drifting, lingering.
 *   2 DIRT  -- ballistic kick-up in the ground's own dust tones, lit.
 *   3 SPARK -- an HDR ember dot thrown ballistically (lighter than dirt),
 *              white_hot -> fire -> ember x `HDR_GAINS.sparks` so its core
 *              blooms; no atlas, a procedural round dot. Drawn in the FIRE
 *              pass (no depth test, band 5.5) and settles on the ground.
 *
 * A SMOKE layer with `oil` is burning-fuel soot (a kill's column): it stays
 * near `uSoot`, greys only late (`0.45 * uSmoke` after 55% of life), is
 * nearly opaque and fades from 62% of life, carries a flickering ember glow
 * in the dense LOWER core of a young puff, and wears a sun-side grey crown
 * (`FLIPBOOK_OIL_CROWN`). It reaches the shader as a NEGATIVE tint.
 *
 * The billow itself is SAMPLED, not computed: FIRE reads
 * `assets/textures/vfx/flipbook_fire.png`, SMOKE and DIRT read
 * `flipbook_smoke.png` (Task 3, `tools/vfx/bake_flipbook_atlases.py`). Each is
 * an 8x8 atlas of 128 px frames, frame k at life k/63, row 0 at the TOP of the
 * image. Channels are DATA, not colour: R density, G/B the density gradient
 * (`(GB*2-1)*4` per unit of frame half-width, +B up), A heat for fire. So the
 * textures load `NoColorSpace` with `premultiplyAlpha` off (a premultiply
 * would zero R/G/B wherever A is 0, which is most of smoke's rim and every
 * fire frame past t~0.45). Each frame keeps an 8 px empty margin, so mips
 * 0-3 never bleed between frames.
 *
 * MATCHED TO THE MOCK, NOT TO THE BAKE (Task 6 fix round 1). The quad is the
 * mock's own (`uQuadScale` 1), and `FLIPBOOK_FIT` maps the atlas onto the
 * mock's procedural density: the baked billow fills only ~0.5 of a frame's
 * half-width (not the 0.85 the bake aims at) and bakes its OWN growth and
 * decay over the 64 frames, which doubled the vertex shader's growth and the
 * fragment fade -- the build drew a fire instance at 0.24 mean density inside
 * its disc at t = 0.1 where the mock draws 0.64. So each type reads a
 * zoomed-in (`zoom`) window of its MATURE frames only (`k0..k1` over life),
 * remaps density by the mock's own `* 1.8` and `0.55 t^2` erosion
 * (`d = gain * R - 0.99 t^2`), and takes fire's core as the mock does,
 * `smoothstep(0.25, 0.95, density)` (or the baked A where higher). The four
 * numbers per type were fitted against the mock's fbm over 16 seeds at eight
 * life fractions (mean squared density error 0.21 -> 0.011 for fire,
 * 0.28 -> 0.004 for smoke); the fit and its readings are in the Task 6
 * report. Until both atlases are in, a spawn is accepted (it ages like any
 * other) but nothing draws: no fallback billow.
 *
 * Authored colours are palette keys resolved to linear (`setColors`); the
 * fire phase is that colour times `HDR_GAINS.fireball` (the one gain table,
 * `hdr-gains.ts`), which is what lets it cross the bloom threshold. Smoke and
 * dirt are multiplied by `hazeRadiance` of the active light preset
 * (`setLighting`), so they sit at lit ground's scene-referred level and never
 * reach it. Each quad is lifted by 0.32 of its size so a puff stands ON the
 * ground rather than cutting into it (D10: soft ground intersection deferred).
 *
 * IDLE COSTS 0 DRAW CALLS, PER PASS. Each mesh keeps the latest expiry ever
 * spawned of its own types (`fireLiveUntilMs`, `smokeLiveUntilMs`); once the
 * clock passes it that mesh goes `visible = false`, and a spawn of its types
 * makes it visible again -- so a kill's fire mesh stops drawing when its
 * last cook-off is out, while the soot column's mesh draws on. `visible` is
 * DERIVED -- atlases in, not debug-hidden, something live -- in one place
 * (`syncVisible`), so the `flipbook` debug layer is a flag that derivation
 * consults rather than a `visible` write the next `step` would re-assert
 * (the `unitsDebugHidden` lesson, `../debug-layers.ts`).
 *
 * RECIPES ARE DATA (Task 5): an emitter's `flipbook` array in
 * `data/vfx/*.json` (`shell_impact`, `missile_impact`, `catastrophic_kill`,
 * `fire_apfsds`, `fire_heat`), interpreted by `spawnRecipe`. Their numbers
 * are the mock's (`mock/defilade-t4` @ `1bd2814b`) verbatim at D3/D4 = 1x,
 * pinned by `flipbook-fx.test.ts` against a literal transcription of it.
 */
import * as THREE from 'three';
import { COLLAPSE_FLASH_RENDER_ORDER, SMOKE_RENDER_ORDER } from './render-order';
import { HDR_GAINS } from './hdr-gains';
import type { FlipbookLayerSpec, ParticleSpec } from '../../vfx/emitters';
import type { Ops } from '../fog-ops';
import { vfxBillowOps, vfxFrameUvOps, vfxRotateOps, vfxSunShadeOps, vfxUnrotateOps, type V2 } from './vfx-noise';

// GH-943 P3 (T12): the shared billow noise, re-exported here beside the shader that carries its GLSL copy (the text below is
// unchanged and pinned by `flipbook-fx.test.ts`; `vfx-noise.test.ts` pins the body to a literal reading of it).
export { VFX_BILLOW, VFX_FBM, VFX_HASH, VFX_SHADE, vfxBillboardOps, vfxBillowOps, vfxFbmOps, vfxFrameUvOps, vfxHashOps, vfxSunShadeOps, vfxValueNoiseOps } from './vfx-noise';

export const FLIPBOOK_CAPACITY = 2048;
export const FLIP_FIRE = 0;
export const FLIP_SMOKE = 1;
export const FLIP_DIRT = 2;
export const FLIP_SPARK = 3;
/** The sun-side grey an oily puff wears: `col += oil * FLIPBOOK_OIL_CROWN * uSmoke * uLight * smoothstep(0.95, 1.25, shade)`, about +15% of `gunmetal.1` on the lit side only. */
export const FLIPBOOK_OIL_CROWN = 0.15;
/** Frames per atlas side; the atlas holds `FLIPBOOK_GRID ** 2` frames. */
export const FLIPBOOK_GRID = 8;
/**
 * How each atlas is read so its billow matches the mock's procedural one
 * (top comment): `zoom` is the frame half-width a quad half-width samples,
 * `gain` the density remap, `k0`..`k1` the frames swept over life. Dirt reads
 * the smoke atlas and its fit, as the mock's dirt shares smoke's billow.
 *
 * `freq`, `disp` and `amp` (fix round 2) break the rim up with the mock's
 * own billow -- `fbm(q) * 0.7 + fbm(q * 2.3 + 5.1) * 0.3`, its sin-hash
 * value noise, 4 octaves each, at the mock's frequency (2.6 fire, 1.7
 * smoke), drifting up at its 0.45/s. The 2.3x term is the grain: with the
 * first fbm alone the rim was ragged in outline but still a clean, thin
 * dark line (the soot band, 0.13 quad half-widths wide against the mock's
 * 0.20, and smooth along its length). The atlas is
 * radially smooth, so without it every billow's rim (where its core falls
 * and the soot `cool` term takes over) drew as a clean circle: nested
 * contour rings where billows overlap. `disp` scales the sample radius by
 * `1 + (b - 0.5) * disp` (the mock's own edge displacement, 1.1 fire and
 * 0.7 smoke), `amp` modulates density by `1 + (b - 0.5) * amp`, about the
 * mock's `(0.55 + billow)` swing. Fitted on the rim's raggedness (std of the
 * d = 0.5 contour radius over 72 angles) against the mock's.
 */
export const FLIPBOOK_FIT = Object.freeze({
  fire: Object.freeze({ zoom: 0.675, gain: 1.5, k0: 12, k1: 28, freq: 2.6, disp: 1.1, amp: 1.0 }),
  smoke: Object.freeze({ zoom: 0.625, gain: 2.2, k0: 10, k1: 20, freq: 1.7, disp: 0.7, amp: 1.0 }),
});
/** Smoke alpha (D3, 1x). */
export const FLIPBOOK_SMOKE_ALPHA = 0.85;
/** The xorshift32 state a fresh `FlipbookFx` starts from. */
export const FLIPBOOK_RNG_SEED = 0x9e3779b9;

const FLIP_TYPE: Readonly<Record<FlipbookLayerSpec['type'], number>> = Object.freeze({
  fire: FLIP_FIRE,
  smoke: FLIP_SMOKE,
  dirt: FLIP_DIRT,
  spark: FLIP_SPARK,
});

const VERT = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec3 aVel;
  attribute vec4 aParams; // start ms, duration ms, scale (tiles), type
  attribute float aSeed;
  attribute float aTint;
  attribute float aWhite;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uFirePass;
  uniform float uQuadScale;
  varying float vTint;
  varying float vWhite;
  varying float vAlpha;
  varying vec2 vUv;
  varying float vT;
  varying float vType;
  varying float vSeed;
  varying float vAge;
  void main() {
    float ageMs = uTime - aParams.x;
    float t = ageMs / aParams.y;
    if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float age = ageMs / 1000.0;
    float type = aParams.w;
    bool isFire = type < 0.5 || type > 2.5;
    if ((uFirePass > 0.5) != isFire) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 p = aOrigin;
    float size;
    if (type < 0.5) {
      float grow = 1.0 - pow(1.0 - min(t * 4.0, 1.0), 3.0);
      size = aParams.z * (0.6 + 0.6 * grow + 0.5 * t);
      p += aVel * (1.0 - exp(-age * 4.0)) / 4.0 + vec3(0.0, 0.45 * age, 0.0);
    } else if (type < 1.5) {
      size = aParams.z * (0.55 + 1.3 * sqrt(t));
      p += aVel * (1.0 - exp(-age * 1.2)) / 1.2 + vec3(0.10, 0.22, 0.04) * age;
    } else if (type < 2.5) {
      size = aParams.z * (0.45 + 0.9 * sqrt(t));
      p += aVel * age + vec3(0.0, -4.9 * age * age, 0.0);
      p.y = max(p.y, aOrigin.y);
    } else {
      // A spark: ballistic like dirt but lighter, a constant-size dot that
      // settles on the ground rather than sinking.
      size = aParams.z;
      p += aVel * age + vec3(0.0, -3.2 * age * age, 0.0);
      p.y = max(p.y, aOrigin.y);
    }
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec2 c = position.xy;
    // The mock's quad and lift; uQuadScale stays a uniform (1) so a
    // capture can still resize the quad without a rebuild.
    vec3 world = p + (right * c.x + up * c.y) * size * uQuadScale + up * size * 0.32;
    vUv = c * 2.0;
    vT = t;
    vType = type;
    vSeed = aSeed;
    vAge = age;
    vTint = aTint;
    vWhite = aWhite;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uFireAtlas;
  uniform sampler2D uSmokeAtlas;
  uniform vec3 uHot;
  uniform vec3 uFire;
  uniform vec3 uEmber;
  uniform vec3 uSoot;
  uniform vec3 uSmoke;
  uniform vec3 uDirt;
  uniform vec3 uDirtDark;
  uniform vec3 uWhite;
  uniform vec3 uWhiteShade;
  uniform float uFireGain;
  uniform float uSparkGain;
  uniform float uLight;
  uniform float uSmokeAlpha;
  uniform float uOilCrown;
  uniform vec2 uSun;
  uniform vec4 uFireFit;  // zoom, gain, k0, k1
  uniform vec4 uSmokeFit;
  uniform vec3 uFireNoise;  // freq, disp, amp
  uniform vec3 uSmokeNoise;
  varying float vAge;
  varying vec2 vUv;
  varying float vT;
  varying float vType;
  varying float vSeed;
  varying float vTint;
  varying float vWhite;
  varying float vAlpha;

  const float GRID = ${FLIPBOOK_GRID.toFixed(1)};
  const float LAST = ${(FLIPBOOK_GRID * FLIPBOOK_GRID - 1).toFixed(1)};

  // Frame k's cell, row 0 at the TOP of the image: with flipY the image's top
  // row is v = 1, so the row index is inverted.
  vec4 frameSample(sampler2D atlas, float k, vec2 local) {
    float col = mod(k, GRID);
    float row = floor(k / GRID);
    vec2 uv = (vec2(col, GRID - 1.0 - row) + local) / GRID;
    return texture2D(atlas, uv);
  }

  // The mock's billow noise, verbatim (sin-hash value noise, 4 octaves).
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int k = 0; k < 4; k++) { v += amp * vnoise(p); p = p * 2.03 + 11.7; amp *= 0.5; }
    return v;
  }

  void main() {
    // The circle of radius 1 (in frame half-widths) survives any rotation
    // inside its own frame, so a rotated corner never samples a neighbour.
    if (dot(vUv, vUv) > 1.0) discard;
    if (vType > 2.5) {
      // A spark: a procedural round dot, white-hot to ember, HDR so it blooms.
      float dotDensity = 1.0 - smoothstep(0.35, 1.0, length(vUv));
      vec3 sparkCol = mix(uHot, uFire, smoothstep(0.0, 0.35, vT));
      sparkCol = mix(sparkCol, uEmber, smoothstep(0.35, 0.8, vT)) * uSparkGain;
      gl_FragColor = vec4(sparkCol, dotDensity * (1.0 - smoothstep(0.7, 1.0, vT)) * vAlpha);
      return;
    }
    float ang = vSeed * 6.2831853;
    float cs = cos(ang);
    float sn = sin(ang);
    // Per-instance rotation about the frame's centre.
    vec2 a = vec2(cs * vUv.x - sn * vUv.y, sn * vUv.x + cs * vUv.y);
    vec4 fit = vType < 0.5 ? uFireFit : uSmokeFit;
    vec3 nz = vType < 0.5 ? uFireNoise : uSmokeNoise;
    // b in 0..1 (fbm's 4 octaves sum to at most 0.9375).
    vec2 q = a * nz.x + vSeed * 31.0 + vec2(0.0, -vAge * 0.45);
    float b = (fbm(q) * 0.7 + fbm(q * 2.3 + 5.1) * 0.3) / 0.9375;
    vec2 local = a * (1.0 + (b - 0.5) * nz.y) * (0.5 * fit.x) + 0.5;
    float tc = clamp(vT, 0.0, 1.0);
    float f = fit.z + tc * (fit.w - fit.z);
    float k0 = floor(f);
    float k1 = min(k0 + 1.0, LAST);
    float w = f - k0;
    vec4 s;
    if (vType < 0.5) {
      s = mix(frameSample(uFireAtlas, k0, local), frameSample(uFireAtlas, k1, local), w);
    } else {
      s = mix(frameSample(uSmokeAtlas, k0, local), frameSample(uSmokeAtlas, k1, local), w);
    }
    // The mock's density: its own *1.8 gain and 0.55 t^2 erosion.
    float density = clamp(fit.y * s.r * (1.0 + (b - 0.5) * nz.z) - 0.99 * tc * tc, 0.0, 1.0);
    if (density < 0.01) discard;
    // The baked gradient is in the atlas frame; the screen sees the frame
    // rotated by ang, so the screen-space gradient is its inverse rotation,
    // and (chain rule) the zoom and the gain scale it.
    vec2 ga = (s.gb * 2.0 - 1.0) * 4.0 * fit.x * fit.y;
    vec2 g = vec2(cs * ga.x + sn * ga.y, -sn * ga.x + cs * ga.y);
    // Denser toward the sun is self-shadowed; the rim facing it is lit.
    float shade = clamp(0.85 - 0.12 * dot(g, uSun) + 0.30 * dot(vUv, uSun), 0.45, 1.3);
    vec3 col;
    float alpha;
    if (vType < 0.5) {
      float heat = clamp(1.0 - vT / 0.16, 0.0, 1.0);
      // The mock's core (dense = hot), or the baked hot core where higher.
      float core = max(smoothstep(0.25, 0.95, density), s.a);
      vec3 hot = mix(uFire, uHot, pow(core * heat, 4.0)) * uFireGain * (0.35 + 0.65 * core);
      vec3 ember = uEmber * (1.0 + 1.2 * core);
      vec3 fire = mix(ember, hot, heat);
      vec3 smoke = mix(uSoot, uSmoke, smoothstep(0.5, 1.0, vT)) * uLight * shade;
      // Embers survive a little longer in the hot core of the soot.
      float cool = smoothstep(0.10, 0.42, vT - 0.10 * core);
      col = mix(fire, smoke, cool);
      alpha = density * (1.0 - smoothstep(0.55, 1.0, vT));
    } else if (vType < 1.5) {
      // A negative tint is OIL -- burning-fuel soot that stays near black for
      // most of its life, carries an ember glow in its dense core while young,
      // and thins out late rather than early.
      float oil = clamp(-vTint, 0.0, 1.0);
      float dustT = max(vTint, 0.0);
      vec3 soot = mix(uSoot, uSmoke, smoothstep(0.1, 1.0, vT));
      vec3 oily = mix(uSoot, uSmoke * 0.45, smoothstep(0.55, 1.0, vT));
      soot = mix(soot, oily, oil);
      vec3 dusty = mix(uDirtDark, uDirt, smoothstep(0.0, 0.75, vT)) * 0.85;
      vec3 base = mix(soot, dusty, dustT);
      // HE smoke tone: a short dusty/grey birth, then white (limestone.0 lit,
      // gunmetal.1 shaded -- the player smoke screen's own pair). Still times
      // uLight and shade, so it sits at lit-ground level and never blooms.
      vec3 whiteCol = mix(uWhiteShade, uWhite, smoothstep(0.7, 1.15, shade));
      base = mix(base, whiteCol, vWhite * smoothstep(0.0, 0.18, vT));
      col = base * uLight * shade;
      // The lit crown: a sun-side grey on oily puffs only.
      col += oil * uOilCrown * uSmoke * uLight * smoothstep(0.95, 1.25, shade);
      // Ember glow: only the dense LOWER core of a young puff, flickering.
      float low = 1.0 - smoothstep(-0.3, 0.5, vUv.y);
      float flick = 0.7 + 0.3 * sin(vAge * 23.0 + vSeed * 40.0);
      float glow = oil * pow(density, 3.0) * low * flick * (1.0 - smoothstep(0.0, 0.12, vT));
      col += uEmber * 1.4 * glow;
      float late = mix(0.40, 0.62, oil);
      alpha = density * mix(uSmokeAlpha, 0.97, oil) * smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(late, 1.0, vT));
    } else {
      col = mix(uDirtDark, uDirt, smoothstep(0.0, 0.6, vT)) * uLight * shade;
      alpha = density * 0.95 * (1.0 - smoothstep(0.45, 1.0, vT));
    }
    gl_FragColor = vec4(col, alpha * vAlpha);
  }
`;

// ---------------------------------------------------------------------------------------------------------------------------------
// GH-943 P3 (T12): the shader's maths written ONCE against `Ops<T>`, for the node twin (`flipbook-fx.node.ts`, handed these as
// VALUES through `material-maths.ts`). The GLSL above keeps its own text; `flipbook-fx.node.test.ts` evaluates these bodies on
// numbers against literal readings of it. A colour input `T` is one channel on numbers and a `vec3` node on the graph: every colour
// term below is channel-separable (a colour times, or mixed by, a scalar).
// ---------------------------------------------------------------------------------------------------------------------------------

/** The atlas frame of the last cell (`LAST` in the shader). */
export const FLIPBOOK_LAST_FRAME = FLIPBOOK_GRID * FLIPBOOK_GRID - 1;

/** A 3-vector as three scalars. */
export interface V3<T> {
  readonly x: T;
  readonly y: T;
  readonly z: T;
}

/** The vertex stage's inputs: the instance's life `t` (0..1), its age in seconds, `aParams.zw`, `aOrigin` and `aVel`. */
export interface FlipbookMotionIn<T> {
  readonly t: T;
  readonly age: T;
  readonly type: T;
  readonly scale: T;
  readonly origin: V3<T>;
  readonly vel: V3<T>;
}

/** The four motion models by type (fire, smoke, dirt, spark): the billow's centre and size. Every model is evaluated; the type selects. */
export function flipbookMotionOps<T>(o: Ops<T>, i: FlipbookMotionIn<T>): V3<T> & { readonly size: T } {
  const L = (n: number): T => o.lit(n);
  const { t, age, origin, vel } = i;
  const age2 = o.mul(age, age);
  // Fire: grows fast and rises.
  const grow = o.sub(L(1), o.pow(o.sub(L(1), o.min(o.mul(t, L(4)), L(1))), L(3)));
  const fireSize = o.mul(i.scale, o.add(o.add(L(0.6), o.mul(L(0.6), grow)), o.mul(L(0.5), t)));
  const fireDrag = o.div(o.sub(L(1), o.exp(o.mul(o.sub(L(0), age), L(4)))), L(4));
  // Smoke: drifts and lingers.
  const smokeSize = o.mul(i.scale, o.add(L(0.55), o.mul(L(1.3), o.sqrt(t))));
  const smokeDrag = o.div(o.sub(L(1), o.exp(o.mul(o.sub(L(0), age), L(1.2)))), L(1.2));
  // Dirt: ballistic, floored at its origin.
  const dirtSize = o.mul(i.scale, o.add(L(0.45), o.mul(L(0.9), o.sqrt(t))));
  const fire: V3<T> = {
    x: o.add(origin.x, o.mul(vel.x, fireDrag)),
    y: o.add(o.add(origin.y, o.mul(vel.y, fireDrag)), o.mul(L(0.45), age)),
    z: o.add(origin.z, o.mul(vel.z, fireDrag)),
  };
  const smoke: V3<T> = {
    x: o.add(o.add(origin.x, o.mul(vel.x, smokeDrag)), o.mul(L(0.1), age)),
    y: o.add(o.add(origin.y, o.mul(vel.y, smokeDrag)), o.mul(L(0.22), age)),
    z: o.add(o.add(origin.z, o.mul(vel.z, smokeDrag)), o.mul(L(0.04), age)),
  };
  const ballisticY = (g: number): T => o.max(o.add(o.add(origin.y, o.mul(vel.y, age)), o.mul(L(-g), age2)), origin.y);
  const thrownX = o.add(origin.x, o.mul(vel.x, age));
  const thrownZ = o.add(origin.z, o.mul(vel.z, age));
  const pick = (f: T, s: T, d: T, sp: T): T => o.selectLt(i.type, L(0.5), f, o.selectLt(i.type, L(1.5), s, o.selectLt(i.type, L(2.5), d, sp)));
  return {
    x: pick(fire.x, smoke.x, thrownX, thrownX),
    y: pick(fire.y, smoke.y, ballisticY(4.9), ballisticY(3.2)),
    z: pick(fire.z, smoke.z, thrownZ, thrownZ),
    size: pick(fireSize, smokeSize, dirtSize, i.scale),
  };
}

/** 1 when the instance draws in this pass, 0 when the vertex stage collapses it off-screen: dead (`t` outside 0..1), or the other
 *  pass's type (fire and spark draw in the fire pass, `firePass` 1; smoke and dirt in the smoke pass, `firePass` 0). */
export function flipbookAliveOps<T>(o: Ops<T>, t: T, type: T, firePass: T): T {
  const L = (n: number): T => o.lit(n);
  const isFire = o.selectLt(type, L(0.5), L(1), o.selectLt(L(2.5), type, L(1), L(0)));
  const inPass = o.sub(L(1), o.abs(o.sub(isFire, o.step(L(0.5), firePass))));
  return o.mul(o.mul(o.step(L(0), t), o.step(t, L(1))), inPass);
}

/** `uFireFit` / `uSmokeFit` (zoom, gain, k0, k1) and `uFireNoise` / `uSmokeNoise` (freq, disp, amp), as scalars. */
export interface FlipbookFit<T> {
  readonly zoom: T;
  readonly gain: T;
  readonly k0: T;
  readonly k1: T;
}
export interface FlipbookNoise<T> {
  readonly freq: T;
  readonly disp: T;
  readonly amp: T;
}

/** What the fragment needs BEFORE it samples: the varyings and the two fits. */
export interface FlipbookCoverIn<T> {
  readonly uv: V2<T>;
  readonly seed: T;
  readonly age: T;
  readonly t: T;
  readonly type: T;
  readonly fireFit: FlipbookFit<T>;
  readonly smokeFit: FlipbookFit<T>;
  readonly fireNoise: FlipbookNoise<T>;
  readonly smokeNoise: FlipbookNoise<T>;
}

/** The per-fragment read: the rotation, the billow, the type's fit, the two frames and their lerp weight, and where both are sampled. */
export interface FlipbookCover<T> {
  readonly cs: T;
  readonly sn: T;
  readonly b: T;
  readonly zoom: T;
  readonly gain: T;
  readonly amp: T;
  readonly tc: T;
  readonly k0: T;
  readonly k1: T;
  readonly w: T;
  readonly local: V2<T>;
  /** Frame `k0`'s and frame `k1`'s atlas coordinates: BOTH atlases are sampled at these, unconditionally. */
  readonly uv0: V2<T>;
  readonly uv1: V2<T>;
}

export function flipbookCoverOps<T>(o: Ops<T>, i: FlipbookCoverIn<T>): FlipbookCover<T> {
  const L = (n: number): T => o.lit(n);
  const ang = o.mul(i.seed, L(6.2831853));
  const cs = o.cos(ang);
  const sn = o.sin(ang);
  // Per-instance rotation about the frame's centre.
  const a = vfxRotateOps(o, cs, sn, i.uv);
  const byType = (f: T, s: T): T => o.selectLt(i.type, L(0.5), f, s);
  const zoom = byType(i.fireFit.zoom, i.smokeFit.zoom);
  const gain = byType(i.fireFit.gain, i.smokeFit.gain);
  const fk0 = byType(i.fireFit.k0, i.smokeFit.k0);
  const fk1 = byType(i.fireFit.k1, i.smokeFit.k1);
  const freq = byType(i.fireNoise.freq, i.smokeNoise.freq);
  const disp = byType(i.fireNoise.disp, i.smokeNoise.disp);
  const amp = byType(i.fireNoise.amp, i.smokeNoise.amp);
  const seed31 = o.mul(i.seed, L(31));
  const q: V2<T> = { x: o.add(o.mul(a.x, freq), seed31), y: o.add(o.add(o.mul(a.y, freq), seed31), o.mul(o.sub(L(0), i.age), L(0.45))) };
  const b = vfxBillowOps(o, q, 2);
  const spread = o.mul(o.add(L(1), o.mul(o.sub(b, L(0.5)), disp)), o.mul(L(0.5), zoom));
  const local: V2<T> = { x: o.add(o.mul(a.x, spread), L(0.5)), y: o.add(o.mul(a.y, spread), L(0.5)) };
  const tc = o.clamp01(i.t);
  const f = o.add(fk0, o.mul(tc, o.sub(fk1, fk0)));
  const k0 = o.floor(f);
  const k1 = o.min(o.add(k0, L(1)), L(FLIPBOOK_LAST_FRAME));
  const w = o.sub(f, k0);
  return {
    cs, sn, b, zoom, gain, amp, tc, k0, k1, w, local,
    uv0: vfxFrameUvOps(o, k0, local, FLIPBOOK_GRID),
    uv1: vfxFrameUvOps(o, k1, local, FLIPBOOK_GRID),
  };
}

/** One atlas tap, as four scalars. */
export interface Tap4<T> {
  readonly r: T;
  readonly g: T;
  readonly b: T;
  readonly a: T;
}

/** The flipbook's colours: one channel each on numbers, a `vec3` node each on the graph. */
export interface FlipbookColorsIn<T> {
  readonly hot: T;
  readonly fire: T;
  readonly ember: T;
  readonly soot: T;
  readonly smoke: T;
  readonly dirt: T;
  readonly dirtDark: T;
  readonly white: T;
  readonly whiteShade: T;
}

/** What the fragment needs AFTER it samples. */
export interface FlipbookShadeIn<T> {
  readonly cover: FlipbookCover<T>;
  /** The fire atlas at `uv0`, `uv1`, and the smoke atlas at the same two. */
  readonly fire0: Tap4<T>;
  readonly fire1: Tap4<T>;
  readonly smoke0: Tap4<T>;
  readonly smoke1: Tap4<T>;
  readonly uv: V2<T>;
  readonly t: T;
  readonly type: T;
  readonly tint: T;
  /** `aWhite`: how far a smoke puff turns white. */
  readonly whiteAmount: T;
  readonly age: T;
  readonly seed: T;
  readonly colors: FlipbookColorsIn<T>;
  readonly fireGain: T;
  readonly sparkGain: T;
  readonly light: T;
  readonly smokeAlpha: T;
  readonly oilCrown: T;
  readonly sun: V2<T>;
}

/** The fragment: `col`, `alpha`, and `keep` (0 where the legacy shader discards: outside the disc, or a non-spark density under 0.01). */
export function flipbookShadeOps<T>(o: Ops<T>, i: FlipbookShadeIn<T>): { col: T; alpha: T; keep: T; density: T } {
  const L = (n: number): T => o.lit(n);
  const ss = (e0: number, e1: number, x: T): T => o.smoothstep(L(e0), L(e1), x);
  const c = i.colors;
  const { t, cover } = i;
  const r2 = o.add(o.mul(i.uv.x, i.uv.x), o.mul(i.uv.y, i.uv.y));
  const isSpark = o.selectLt(L(2.5), i.type, L(1), L(0));

  // A spark: a procedural round dot, white-hot to ember, HDR so it blooms.
  const dotDensity = o.sub(L(1), ss(0.35, 1, o.length2(i.uv.x, i.uv.y)));
  const sparkCol = o.mul(o.mix(o.mix(c.hot, c.fire, ss(0, 0.35, t)), c.ember, ss(0.35, 0.8, t)), i.sparkGain);
  const sparkAlpha = o.mul(dotDensity, o.sub(L(1), ss(0.7, 1, t)));

  // The frame lerp, both atlases; the type picks one (a select: the legacy samples inside a varying branch).
  const lerp = (a: Tap4<T>, b: Tap4<T>): Tap4<T> => ({ r: o.mix(a.r, b.r, cover.w), g: o.mix(a.g, b.g, cover.w), b: o.mix(a.b, b.b, cover.w), a: o.mix(a.a, b.a, cover.w) });
  const fs = lerp(i.fire0, i.fire1);
  const ms = lerp(i.smoke0, i.smoke1);
  const pick = (f: T, s: T): T => o.selectLt(i.type, L(0.5), f, s);
  const s: Tap4<T> = { r: pick(fs.r, ms.r), g: pick(fs.g, ms.g), b: pick(fs.b, ms.b), a: pick(fs.a, ms.a) };

  // The mock's density: its own gain and 0.99 t^2 erosion.
  const density = o.clamp01(o.sub(o.mul(o.mul(cover.gain, s.r), o.add(L(1), o.mul(o.sub(cover.b, L(0.5)), cover.amp))), o.mul(L(0.99), o.mul(cover.tc, cover.tc))));
  const gk = o.mul(o.mul(L(4), cover.zoom), cover.gain);
  const ga: V2<T> = { x: o.mul(o.sub(o.mul(s.g, L(2)), L(1)), gk), y: o.mul(o.sub(o.mul(s.b, L(2)), L(1)), gk) };
  const g = vfxUnrotateOps(o, cover.cs, cover.sn, ga);
  const shade = vfxSunShadeOps(o, g, i.uv, i.sun);

  // FIRE: the dual-phase curve, the core hot, then ember, then soot.
  const heat = o.clamp01(o.sub(L(1), o.div(t, L(0.16))));
  const core = o.max(ss(0.25, 0.95, density), s.a);
  const hot = o.mul(o.mul(o.mix(c.fire, c.hot, o.pow(o.mul(core, heat), L(4))), i.fireGain), o.add(L(0.35), o.mul(L(0.65), core)));
  const ember = o.mul(c.ember, o.add(L(1), o.mul(L(1.2), core)));
  const fireMix = o.mix(ember, hot, heat);
  const sooty = o.mul(o.mul(o.mix(c.soot, c.smoke, ss(0.5, 1, t)), i.light), shade);
  const cool = ss(0.1, 0.42, o.sub(t, o.mul(L(0.1), core)));
  const fireCol = o.mix(fireMix, sooty, cool);
  const fireAlpha = o.mul(density, o.sub(L(1), ss(0.55, 1, t)));

  // SMOKE: soot, dust or oil (a negative tint), white HE smoke, the oily crown and the ember glow.
  const oil = o.clamp01(o.sub(L(0), i.tint));
  const dustT = o.max(i.tint, L(0));
  const soot0 = o.mix(c.soot, c.smoke, ss(0.1, 1, t));
  const oily = o.mix(c.soot, o.mul(c.smoke, L(0.45)), ss(0.55, 1, t));
  const soot = o.mix(soot0, oily, oil);
  const dusty = o.mul(o.mix(c.dirtDark, c.dirt, ss(0, 0.75, t)), L(0.85));
  const base0 = o.mix(soot, dusty, dustT);
  const whiteCol = o.mix(c.whiteShade, c.white, ss(0.7, 1.15, shade));
  const base = o.mix(base0, whiteCol, o.mul(i.whiteAmount, ss(0, 0.18, t)));
  const crown = o.mul(o.mul(o.mul(o.mul(oil, i.oilCrown), c.smoke), i.light), ss(0.95, 1.25, shade));
  const low = o.sub(L(1), ss(-0.3, 0.5, i.uv.y));
  const flick = o.add(L(0.7), o.mul(L(0.3), o.sin(o.add(o.mul(i.age, L(23)), o.mul(i.seed, L(40))))));
  const glow = o.mul(o.mul(o.mul(o.mul(oil, o.pow(density, L(3))), low), flick), o.sub(L(1), ss(0, 0.12, t)));
  const smokeCol = o.add(o.add(o.mul(o.mul(base, i.light), shade), crown), o.mul(o.mul(c.ember, L(1.4)), glow));
  const late = o.mix(L(0.4), L(0.62), oil);
  const smokeAlpha = o.mul(o.mul(o.mul(density, o.mix(i.smokeAlpha, L(0.97), oil)), ss(0, 0.06, t)), o.sub(L(1), o.smoothstep(late, L(1), t)));

  // DIRT: the ground's dust tones, lit.
  const dirtCol = o.mul(o.mul(o.mix(c.dirtDark, c.dirt, ss(0, 0.6, t)), i.light), shade);
  const dirtAlpha = o.mul(o.mul(density, L(0.95)), o.sub(L(1), ss(0.45, 1, t)));

  const byType = (f: T, sm: T, d: T): T => o.selectLt(i.type, L(0.5), f, o.selectLt(i.type, L(1.5), sm, d));
  const col = o.selectLt(L(2.5), i.type, sparkCol, byType(fireCol, smokeCol, dirtCol));
  const alpha = o.selectLt(L(2.5), i.type, sparkAlpha, byType(fireAlpha, smokeAlpha, dirtAlpha));
  const keep = o.mul(o.step(r2, L(1)), o.max(isSpark, o.step(L(0.01), density)));
  return { col, alpha, keep, density };
}

/** Palette keys for every colour the flipbook draws (resolved to linear). */
export interface FlipbookColors {
  hot: string;
  fire: string;
  ember: string;
  soot: string;
  smoke: string;
  dirt: string;
  dirtDark: string;
  white: string;
  whiteShade: string;
}

export const FLIPBOOK_COLOR_KEYS: Readonly<FlipbookColors> = Object.freeze({
  hot: 'vfx.white_hot',
  fire: 'vfx.fire',
  ember: 'vfx.ember',
  soot: 'shadow.0',
  smoke: 'gunmetal.1',
  dirt: 'dust.2',
  dirtDark: 'dust.5',
  white: 'limestone.0',
  whiteShade: 'gunmetal.1',
});

/** One instance, in world units (x east, y up, z south) and milliseconds. */
export interface FlipbookSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Start this long after now. */
  delayMs?: number;
  durationMs: number;
  /** Billow size, in world units. */
  scale: number;
  type: typeof FLIP_FIRE | typeof FLIP_SMOKE | typeof FLIP_DIRT | typeof FLIP_SPARK;
  /** SMOKE only: 0 soot, 1 dust; NEGATIVE is oil (-1..0, `-oil`), which overrides dust. */
  tint?: number;
  /** SMOKE only, 0..1: how far the puff turns white (HE smoke), beside `tint`. */
  white?: number;
  /** 0..1, a multiplier on the drawn alpha (GH-1197). Absent is 1. */
  alpha?: number;
}

/** A `FLIPBOOK_FIT` entry as the shader's two uniform vectors: the atlas fit, and the billow noise. */
function fitVec(f: { zoom: number; gain: number; k0: number; k1: number }): THREE.Vector4 {
  return new THREE.Vector4(f.zoom, f.gain, f.k0, f.k1);
}
function noiseVec(f: { freq: number; disp: number; amp: number }): THREE.Vector3 {
  return new THREE.Vector3(f.freq, f.disp, f.amp);
}

/**
 * The particle layers an emitter's `flipbook` recipe supersedes on three (D6):
 * the fireball mesh (`mesh_burst`), the smoke column (`mesh_plume`) and the flat
 * `smoke_puff` discs. Everything else -- shards, sparks, the muzzle's own
 * flash and ring -- still spawns beside the recipe. The renderer skips these
 * only while it actually spawns the recipe (atlases in); otherwise they are
 * the fallback the schema keeps them declared for.
 */
export function flipbookSupersedes(layer: Pick<ParticleSpec, 'mesh_burst' | 'mesh_plume' | 'sprite'>): boolean {
  return layer.mesh_burst === true || layer.mesh_plume === true || layer.sprite === 'smoke_puff';
}

/** Prepares an atlas as DATA: no colour decode, no premultiply, clamped,
 *  mipmapped, and flipped on upload -- the fragment shader's row inversion
 *  (`GRID - 1 - row`) assumes the image's top row lands at v = 1, so `flipY`
 *  is set here rather than inherited from whichever loader made the texture
 *  (`ImageBitmapLoader`'s bitmaps ignore it). */
export function prepareFlipbookAtlas(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = true;
  tex.premultiplyAlpha = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

type FlipbookMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

export class FlipbookFx {
  /** Smoke and dirt: depth-tested, so a building in front hides them. */
  readonly mesh: FlipbookMesh;
  /** Fire: the same instances, not depth-tested -- a fireball engulfs the hull it came from. */
  readonly fireMesh: FlipbookMesh;
  private readonly origin: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private readonly seed: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly white: THREE.InstancedBufferAttribute;
  /** GH-943 P3 (T12): the two LEGACY materials, held apart: every writer below writes their uniform records, never through
   *  `mesh.material`, which is the node twin once adopted (the twin reads these records). */
  private readonly smokeMaterial: THREE.ShaderMaterial;
  private readonly fireMaterial: THREE.ShaderMaterial;
  /** GH-1197: per-instance alpha multiplier, 1 for every recipe that does not author `alpha`. */
  private readonly alphaMul: THREE.InstancedBufferAttribute;
  private head = 0;
  private written = 0;
  private timeMs = 0;
  /** The latest `start + duration` ever spawned, PER PASS: fire for
   *  `fireMesh`, smoke and dirt for `mesh`. Each mesh's live window ends on
   *  its own, so a kill's fire mesh stops drawing once its last fireball is
   *  out even while the 9 s column lives on. */
  private fireLiveUntilMs = -Infinity;
  private smokeLiveUntilMs = -Infinity;
  private rngState = FLIPBOOK_RNG_SEED;
  private readonly capacity: number;
  private debugHidden = false;
  private atlases: { fire: THREE.Texture; smoke: THREE.Texture } | null = null;
  private disposed = false;
  /** Effects detail, `RenderQuality.fxDetail`: 0 drops sparks and thins `low_fraction` layers. */
  private fxDetail: 0 | 1 | 2;

  constructor(capacity = FLIPBOOK_CAPACITY, fxDetail: 0 | 1 | 2 = 2) {
    this.capacity = capacity;
    this.fxDetail = fxDetail;
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    // Start every slot long dead.
    for (let i = 0; i < capacity; i++) {
      this.params.array[i * 4] = -1e9;
      this.params.array[i * 4 + 1] = 1;
    }
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.white = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.alphaMul = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
    for (const a of [this.origin, this.vel, this.params, this.seed, this.tint, this.white, this.alphaMul]) a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aOrigin', this.origin);
    geometry.setAttribute('aVel', this.vel);
    geometry.setAttribute('aParams', this.params);
    geometry.setAttribute('aSeed', this.seed);
    geometry.setAttribute('aTint', this.tint);
    geometry.setAttribute('aWhite', this.white);
    geometry.setAttribute('aAlpha', this.alphaMul);
    geometry.instanceCount = 0;
    const uniforms = (firePass: number): Record<string, THREE.IUniform> => ({
      uTime: { value: 0 },
      uFirePass: { value: firePass },
      uQuadScale: { value: 1 },
      uFireFit: { value: fitVec(FLIPBOOK_FIT.fire) },
      uSmokeFit: { value: fitVec(FLIPBOOK_FIT.smoke) },
      uFireNoise: { value: noiseVec(FLIPBOOK_FIT.fire) },
      uSmokeNoise: { value: noiseVec(FLIPBOOK_FIT.smoke) },
      uFireAtlas: { value: null },
      uSmokeAtlas: { value: null },
      uHot: { value: new THREE.Color(1, 1, 1) },
      uFire: { value: new THREE.Color(1, 0.6, 0.2) },
      uEmber: { value: new THREE.Color(0.8, 0.1, 0.02) },
      uSoot: { value: new THREE.Color(0.03, 0.03, 0.03) },
      uSmoke: { value: new THREE.Color(0.3, 0.3, 0.3) },
      uDirt: { value: new THREE.Color(0.5, 0.4, 0.3) },
      uDirtDark: { value: new THREE.Color(0.3, 0.25, 0.2) },
      uWhite: { value: new THREE.Color(0.8, 0.8, 0.8) },
      uWhiteShade: { value: new THREE.Color(0.3, 0.3, 0.3) },
      uFireGain: { value: HDR_GAINS.fireball },
      uSparkGain: { value: HDR_GAINS.sparks },
      uOilCrown: { value: FLIPBOOK_OIL_CROWN },
      uLight: { value: 1 },
      uSmokeAlpha: { value: FLIPBOOK_SMOKE_ALPHA },
      uSun: { value: new THREE.Vector2(-0.7, 0.7) },
    });
    const material = (firePass: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        // GH-943 P3 (T1): the legacy name the node twin table and the census key it by (`material-names.ts`); no program moves.
        name: firePass === 0 ? 'rl-flipbook-smoke' : 'rl-flipbook-fire',
        uniforms: uniforms(firePass),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: firePass === 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
    this.smokeMaterial = material(0);
    this.fireMaterial = material(1);
    this.mesh = new THREE.Mesh(geometry, this.smokeMaterial);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = SMOKE_RENDER_ORDER;
    this.mesh.name = 'flipbook-smoke';
    this.fireMesh = new THREE.Mesh(geometry, this.fireMaterial);
    this.fireMesh.frustumCulled = false;
    this.fireMesh.renderOrder = COLLAPSE_FLASH_RENDER_ORDER;
    this.fireMesh.name = 'flipbook-fire';
    this.syncVisible();
  }

  /** Both meshes, for the caller's scene. */
  get meshes(): readonly [FlipbookMesh, FlipbookMesh] {
    return [this.mesh, this.fireMesh];
  }

  /** Sets the effects detail (the quality preset's `fxDetail`); read at the next spawn. */
  setFxDetail(detail: 0 | 1 | 2): void {
    this.fxDetail = detail;
  }

  /** The bound smoke atlas, or null until it lands (the smoke screen,
   *  `smoke-mesh.ts`, samples the same billows). */
  get smokeAtlas(): THREE.Texture | null {
    return this.atlases ? this.atlases.smoke : null;
  }

  /** True once both atlases are bound. */
  get ready(): boolean {
    return this.atlases !== null;
  }

  setColors(resolveLinear: (key: string) => THREE.Color, c: FlipbookColors = FLIPBOOK_COLOR_KEYS): void {
    for (const u of [this.smokeMaterial.uniforms, this.fireMaterial.uniforms]) {
      (u.uHot.value as THREE.Color).copy(resolveLinear(c.hot));
      (u.uFire.value as THREE.Color).copy(resolveLinear(c.fire));
      (u.uEmber.value as THREE.Color).copy(resolveLinear(c.ember));
      (u.uSoot.value as THREE.Color).copy(resolveLinear(c.soot));
      (u.uSmoke.value as THREE.Color).copy(resolveLinear(c.smoke));
      (u.uDirt.value as THREE.Color).copy(resolveLinear(c.dirt));
      (u.uDirtDark.value as THREE.Color).copy(resolveLinear(c.dirtDark));
      (u.uWhite.value as THREE.Color).copy(resolveLinear(c.white));
      (u.uWhiteShade.value as THREE.Color).copy(resolveLinear(c.whiteShade));
    }
  }

  /** `radiance`: `hazeRadiance` of the active lights. `sunScreen`: the sun's
   *  direction projected on the camera's right/up axes, normalised. */
  setLighting(radiance: number, sunScreen: THREE.Vector2): void {
    for (const u of [this.smokeMaterial.uniforms, this.fireMaterial.uniforms]) {
      u.uLight.value = radiance;
      (u.uSun.value as THREE.Vector2).copy(sunScreen);
    }
  }

  /** Binds both atlases (already prepared, or prepared here) and lets the
   *  meshes draw. */
  setAtlases(fire: THREE.Texture, smoke: THREE.Texture): void {
    if (this.disposed) return;
    prepareFlipbookAtlas(fire);
    prepareFlipbookAtlas(smoke);
    this.atlases = { fire, smoke };
    for (const u of [this.smokeMaterial.uniforms, this.fireMaterial.uniforms]) {
      u.uFireAtlas.value = fire;
      u.uSmokeAtlas.value = smoke;
    }
    this.syncVisible();
  }

  /** Fetches both atlases. Fail-soft: a missing one leaves the flipbook
   *  drawing nothing, with a warning naming the URL. Resolves either way. */
  load(fireUrl: string, smokeUrl: string): Promise<void> {
    const loader = new THREE.TextureLoader();
    const one = (url: string): Promise<THREE.Texture | null> =>
      new Promise((resolve) => {
        loader.load(
          url,
          (tex) => resolve(tex),
          undefined,
          () => {
            console.warn(`[lions] flipbook atlas ${url} failed to load; explosions and smoke draw no billows`);
            resolve(null);
          }
        );
      });
    return Promise.all([one(fireUrl), one(smokeUrl)]).then(([fire, smoke]) => {
      if (fire && smoke && !this.disposed) this.setAtlases(fire, smoke);
      else {
        fire?.dispose();
        smoke?.dispose();
      }
    });
  }

  /** The `flipbook` debug layer: a flag `syncVisible` consults, so a
   *  zero-time `step` cannot re-assert the meshes. Returns 2, the meshes. */
  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    this.syncVisible();
    return 2;
  }

  /** Slots still inside their life. Scans every slot: tests and debugging
   *  only, never the frame path. */
  get liveCount(): number {
    let n = 0;
    const a = this.params.array as Float32Array;
    for (let i = 0; i < Math.min(this.written, this.capacity); i++) {
      const age = this.timeMs - a[i * 4];
      if (age >= 0 && age <= a[i * 4 + 1]) n++;
    }
    return n;
  }

  /** The frame clock now, in ms. */
  get nowMs(): number {
    return this.timeMs;
  }

  step(dtMs: number): void {
    this.timeMs += dtMs;
    this.smokeMaterial.uniforms.uTime.value = this.timeMs;
    this.fireMaterial.uniforms.uTime.value = this.timeMs;
    this.syncVisible();
  }

  /** Restarts the presentation RNG (tests). */
  reseed(state: number): void {
    this.rngState = state >>> 0 || FLIPBOOK_RNG_SEED;
  }

  /** One instance. */
  spawn(o: FlipbookSpawn): void {
    this.push(o.x, o.y, o.z, o.vx ?? 0, o.vy ?? 0, o.vz ?? 0, o.delayMs ?? 0, o.durationMs, o.scale, o.type, o.tint ?? 0, o.white ?? 0, o.alpha ?? 1);
  }

  private syncVisible(): void {
    const can = this.atlases !== null && !this.debugHidden;
    this.mesh.visible = can && this.timeMs <= this.smokeLiveUntilMs;
    this.fireMesh.visible = can && this.timeMs <= this.fireLiveUntilMs;
  }

  private rand(): number {
    // xorshift32: presentation only, never the sim.
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  private push(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    delayMs: number, durMs: number, scale: number, type: number, tint = 0, white = 0, alpha = 1
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.written++;
    const o = this.origin.array as Float32Array;
    o[i * 3] = x; o[i * 3 + 1] = y; o[i * 3 + 2] = z;
    const v = this.vel.array as Float32Array;
    v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
    const p = this.params.array as Float32Array;
    const start = this.timeMs + delayMs;
    p[i * 4] = start; p[i * 4 + 1] = durMs; p[i * 4 + 2] = scale; p[i * 4 + 3] = type;
    (this.seed.array as Float32Array)[i] = this.rand();
    (this.tint.array as Float32Array)[i] = tint;
    (this.white.array as Float32Array)[i] = white;
    (this.alphaMul.array as Float32Array)[i] = alpha;
    // Upload only the touched slot.
    for (const [attr, size] of [[this.origin, 3], [this.vel, 3], [this.params, 4], [this.seed, 1], [this.tint, 1], [this.white, 1], [this.alphaMul, 1]] as const) {
      attr.addUpdateRange(i * size, size);
      attr.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = Math.min(this.written, this.capacity);
    const end = start + durMs;
    if (type === FLIP_FIRE || type === FLIP_SPARK) {
      if (end > this.fireLiveUntilMs) this.fireLiveUntilMs = end;
    } else if (end > this.smokeLiveUntilMs) this.smokeLiveUntilMs = end;
    this.syncVisible();
  }

  /**
   * Spawns a recipe authored as an emitter's `flipbook` array
   * (`vfx_emitter.schema.json`'s `flipbook_layer`), at origin (x, h, z) in
   * world units, at `power`, with the bore along `dirRad` (x = cos, z = sin)
   * and the ground at `groundH` for an `at_ground` layer. The numbers live in
   * `data/vfx/*.json`; this is the one interpreter. Returns the instance count.
   */
  spawnRecipe(
    layers: readonly FlipbookLayerSpec[],
    x: number, h: number, z: number, power: number,
    dirRad = 0, groundH = h
  ): number {
    const dx = Math.cos(dirRad);
    const dz = Math.sin(dirRad);
    const between = (r: readonly [number, number]): number => (r[0] === r[1] ? r[0] : r[0] + (r[1] - r[0]) * this.rand());
    const first = layers[0];
    const fireball = first ? first.scale.base + (first.scale.per_power ?? 0) * power : 0;
    let n = 0;
    for (const L of layers) {
      const type = FLIP_TYPE[L.type];
      if (type === undefined) throw new Error(`flipbook: unknown layer type "${String(L.type)}"`);
      // The lowest effects tier: sparks go, and a layer that declares
      // `low_fraction` spawns only that share of its count (rounded up).
      if (this.fxDetail === 0 && type === FLIP_SPARK) continue;
      const count = this.fxDetail === 0 && L.low_fraction !== undefined ? Math.ceil(L.count * L.low_fraction - 1e-9) : L.count;
      const off = L.offset ?? {};
      const v = L.velocity;
      const y0 = (L.at_ground ? groundH : h) + (off.up ?? 0);
      for (let k = 0; k < count; k++) {
        const a = v.ring
          ? (k / count) * Math.PI * 2 + (v.ring_jitter_rad ? this.rand() * v.ring_jitter_rad : 0)
          : this.rand() * Math.PI * 2;
        const radial = between(v.radial);
        const along = v.along_bore ? between(v.along_bore) : 0;
        const up = between(v.up);
        const bore = (off.along_bore ?? 0) + (off.along_bore_per_index ?? 0) * k;
        let px = x + dx * bore;
        let pz = z + dz * bore;
        if (off.scatter) {
          px += (this.rand() - 0.5) * off.scatter;
          pz += (this.rand() - 0.5) * off.scatter;
        }
        const s = L.scale;
        let scale = s.base + (s.per_power ?? 0) * power + (s.per_index_power ?? 0) * k * power + (s.rand ? s.rand * this.rand() : 0);
        if (L.scale_from === 'fireball') scale *= fireball;
        this.push(
          px, y0, pz,
          Math.cos(a) * radial + dx * along, up, Math.sin(a) * radial + dz * along,
          L.delay_ms[0] + L.delay_ms[1] * k, between(L.duration_ms), scale, type, L.oil ? -L.oil : (L.tint ?? 0), L.white ?? 0,
          L.alpha ?? 1
        );
        n++;
      }
    }
    return n;
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    // The legacy materials: disposing one frees its node twin too (adoption listens for it).
    this.smokeMaterial.dispose();
    this.fireMaterial.dispose();
    this.atlases?.fire.dispose();
    this.atlases?.smoke.dispose();
    this.atlases = null;
    this.syncVisible();
  }
}
