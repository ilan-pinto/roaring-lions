/**
 * GH-943 WebGPU-primary P1 (T4): what the fog pass's two implementations share. `fog-pass.ts` (the GLSL `Pass`) and
 * `fog-pass.node.ts` (the TSL twin) both read THIS file for the constants, the `uniforms.X.value` table and the three setters
 * (`setHaze`, `setShimmer`, `setFocus`), so a value is written once and the 21 `fogPass` call sites in `ThreeRenderer` work
 * unchanged on either backend: `FogUniforms` is the object they talk to.
 *
 * ADDON-FREE (imports `three` and pure modules only), because the twin may import nothing else.
 */
import * as THREE from 'three';
import { paletteHex } from './palette-hex';
import { hexToLinear } from './terrain/shared';
import { HAZE_LOW } from './haze';
import { SHIMMER_MAX_SITES, type ShimmerSite } from './shimmer';

export const FOG_NEVER_SEEN = 0.85;
export const FOG_EXPLORED = 0.4;
/** `shadow.1` -- the same key the app hands `RendererOptions.background`. */
export const FOG_TINT_HEX = paletteHex('shadow.1');
/**
 * The shader's `uTint * <this>` -- how far above `FOG_TINT_HEX` the shrouded
 * colour is allowed to sit before the per-pixel luminance scales it down.
 * The one knob this pass leaves open, and it is a WEAK one; the numbers
 * below are measured on `beit_sahwan_outskirts` at zoom 0.5, frame loop
 * frozen and every capture a zero-elapsed-time repaint, so the repaint
 * control moved 0.000 sRGB levels and every delta is real.
 *
 * Mean sRGB at one open, shadow-free tile per fog level, sweeping the gain:
 *
 * | gain | in sight (dim 0) | explored (0.40) | never seen (0.85) |
 * |------|------------------|-----------------|-------------------|
 * | 0    | 177.3/161.6/128.2 | 122.6/106.6/77.1 | 58.0/48.4/31.5 |
 * | 2    | 177.4/161.8/128.3 | 123.8/108.2/78.4 | 61.1/52.1/34.3 |
 * | 10   | 177.8/162.4/129.0 | 128.4/114.0/83.7 | 72.9/65.4/44.9 |
 * | 28   | 178.7/163.6/130.4 | 138.1/125.8/94.7 | 95.6/90.9/65.8 |
 *
 * Three things follow, and the first two correct the reasoning this
 * constant shipped with. **The tint is not what keeps explored ground
 * readable** -- the 60% of the terrain's own colour that survives a 0.40 mix
 * is; at 2.0 the tint adds 1.2 sRGB levels out of 123, about 1%. And **it
 * cannot be turned up into a real look change**: gain 0 and gain 10 are
 * near-indistinguishable by eye, and the tint only begins to dominate the
 * hue around 28.
 *
 * The third is why it stays low. The tint term is weighted by `dim`, so
 * raising it lifts never-seen ground 2.1x as much as explored ground and
 * COMPRESSES the very separation fog exists to communicate: the never-seen /
 * explored luma ratio goes from 0.48 at gain 2 to 0.71 at gain 28. So 2.0
 * sits where it should -- enough to desaturate, not enough to flatten the
 * tiers -- and 0 would remove the only term that desaturates at all.
 */
export const FOG_TINT_GAIN = 2.0;

/**
 * How far OUTSIDE the map, in tiles, ground fades from the map edge's own
 * shroud value to never-seen.
 *
 * Until the shell upgrade's Phase 0 there was no ground out there at all --
 * the frame ended in `scene.background` and the `depth >= 1.0` early-out
 * below returned it untouched. `terrain/skirt.ts` puts a lit quad three map
 * widths across under the whole frame, and the shroud is
 * `ClampToEdgeWrapping` (`shroud-texture.ts`), which means every sample
 * beyond the border returns its nearest EDGE tile's value. One visible tile
 * on the border therefore floods an entire quadrant of the skirt with a
 * searchlight wedge: photographed on `beit_sahwan_1_recon` at 1920x1080,
 * zoom 0.5, the wedge read (175, 171, 160) sRGB against the (55, 52, 45) of
 * the shrouded skirt beside it.
 *
 * Ground outside the map has never been seen by anyone, so the honest fix is
 * to say so. A FADE rather than a step, over one tile, for two reasons: it
 * continues the shroud's own feather outward instead of stopping it dead at
 * the border, and it leaves geometry that merely OVERHANGS the border -- a
 * mesh building's eaves at tile 0 -- almost exactly where it was, where a
 * hard cut would darken it by the full never-seen amount for being a
 * fraction of a tile out.
 */
export const FOG_OFFMAP_FADE_TILES = 1.0;

/** The names the node twin binds a uniform to, in the order of `uniforms`; `fog-pass.test.ts` pins the list against the GLSL. */
export type FogUniformTable = {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  tDepth: THREE.IUniform<THREE.Texture | null>;
  uShroud: THREE.IUniform<THREE.Texture>;
  uInvProjection: THREE.IUniform<THREE.Matrix4>;
  uCameraWorld: THREE.IUniform<THREE.Matrix4>;
  uMapSize: THREE.IUniform<THREE.Vector2>;
  uTint: THREE.IUniform<THREE.Vector3>;
  uNeverSeen: THREE.IUniform<number>;
  uExplored: THREE.IUniform<number>;
  uTintGain: THREE.IUniform<number>;
  uRevealAll: THREE.IUniform<number>;
  uOffMapSeen: THREE.IUniform<number>;
  uFocus: THREE.IUniform<THREE.Vector2>;
  uHazeTint: THREE.IUniform<THREE.Vector3>;
  uHazeFar: THREE.IUniform<number>;
  uHazeRef: THREE.IUniform<number>;
  uHazeAmp: THREE.IUniform<number>;
  uShimmer: THREE.IUniform<THREE.Vector4[]>;
  uShimmerCount: THREE.IUniform<number>;
  uShimmerAmp: THREE.IUniform<number>;
  uShimmerAspect: THREE.IUniform<number>;
  uShimmerTime: THREE.IUniform<number>;
  uShimmerPx: THREE.IUniform<THREE.Vector2>;
};

/** What `ThreeRenderer` hands the haze term (R-13): the tint already in
 *  the pass's scene-referred linear space (`hexToLinear` of the tone times
 *  `hazeRadiance`), the preset's amount at +20 tiles, and the map's median
 *  open-ground level (`hazeReferenceLevel`). */
export interface HazeSettings {
  readonly tint: readonly [number, number, number];
  readonly far: number;
  readonly refLevel: number;
}

/** Compile-time options of the fog pass. */
export interface FogPassOptions {
  /** The low-lying haze's strength; absent is `HAZE_LOW`, today's source. */
  readonly hazeLow?: number;
}

/** `uHazeRef`'s default: far below any level a map can author (0-9), so an
 *  unconfigured pass has no ground below its reference and no low-lying haze. */
export const HAZE_REF_UNSET = -1e4;

/**
 * The surface `ThreeRenderer` uses on either backend: the uniform table and the per-frame setters. The legacy `FogOfWarPass`
 * and the node twin both expose it, so `fogPass.uniforms.uRevealAll.value = 1` reads the same on both.
 */
export interface FogPassLike {
  readonly uniforms: FogUniformTable;
  readonly hazeLow: number;
  updateCamera(camera: THREE.Camera): void;
  setHaze(h: HazeSettings): void;
  setShimmer(sites: readonly ShimmerSite[], widthPx: number, heightPx: number, timeSec: number): void;
  setFocus(x: number, z: number): void;
  dispose(): void;
}

export function createFogUniformTable(shroud: THREE.Texture, mapWidth: number, mapHeight: number): FogUniformTable {
  // LINEAR, not sRGB-unit: the fog runs before the output transform, on the HalfFloat scene-referred target, so the tint has to
  // be in the same space as the colour it is mixed with. `hexToUnit` here would give a tint far too bright.
  const [r, g, b] = hexToLinear(FOG_TINT_HEX);
  return {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uShroud: { value: shroud },
    uInvProjection: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uMapSize: { value: new THREE.Vector2(mapWidth, mapHeight) },
    uTint: { value: new THREE.Vector3(r, g, b) },
    uNeverSeen: { value: FOG_NEVER_SEEN },
    uExplored: { value: FOG_EXPLORED },
    uTintGain: { value: FOG_TINT_GAIN },
    uRevealAll: { value: 0 },
    uOffMapSeen: { value: 0 },
    uFocus: { value: new THREE.Vector2() },
    uHazeTint: { value: new THREE.Vector3() },
    uHazeFar: { value: 0 },
    uHazeRef: { value: HAZE_REF_UNSET },
    uHazeAmp: { value: 1 },
    uShimmer: { value: Array.from({ length: SHIMMER_MAX_SITES }, () => new THREE.Vector4()) },
    uShimmerCount: { value: 0 },
    uShimmerAmp: { value: 1 },
    uShimmerAspect: { value: 1 },
    uShimmerTime: { value: 0 },
    uShimmerPx: { value: new THREE.Vector2(1, 1) },
  };
}

export function writeHaze(u: FogUniformTable, h: HazeSettings): void {
  u.uHazeTint.value.set(h.tint[0], h.tint[1], h.tint[2]);
  u.uHazeFar.value = h.far;
  u.uHazeRef.value = h.refLevel;
}

export function writeShimmer(u: FogUniformTable, sites: readonly ShimmerSite[], widthPx: number, heightPx: number, timeSec: number): void {
  const n = Math.min(sites.length, SHIMMER_MAX_SITES);
  for (let i = 0; i < n; i++) {
    const s = sites[i];
    u.uShimmer.value[i].set(s[0], s[1], s[2], s[3]);
  }
  u.uShimmerCount.value = n;
  u.uShimmerAspect.value = widthPx / Math.max(heightPx, 1);
  u.uShimmerPx.value.set(1 / Math.max(widthPx, 1), 1 / Math.max(heightPx, 1));
  u.uShimmerTime.value = timeSec;
}

export function writeCamera(u: FogUniformTable, camera: THREE.Camera): void {
  u.uInvProjection.value.copy(camera.projectionMatrixInverse);
  u.uCameraWorld.value.copy(camera.matrixWorld);
}

export function writeFocus(u: FogUniformTable, x: number, z: number): void {
  u.uFocus.value.set(x, z);
}

/** The compile-time low-lying strength: absent is `HAZE_LOW`. */
export function hazeLowOf(options?: FogPassOptions): number {
  return options?.hazeLow ?? HAZE_LOW;
}

/**
 * The uniform table and setters with NO GPU object, for a node boot: `ThreeRenderer` holds one as its `fogPass`, and the stage
 * factory below reads the same table. It lives in `fog-spec.ts`, not in the twin, so the shared chunk can build it without loading the twin.
 */
export class FogUniforms implements FogPassLike {
  readonly uniforms: FogUniformTable;
  readonly hazeLow: number;
  constructor(shroud: THREE.Texture, mapWidth: number, mapHeight: number, options?: FogPassOptions) {
    this.hazeLow = hazeLowOf(options);
    this.uniforms = createFogUniformTable(shroud, mapWidth, mapHeight);
  }
  updateCamera(camera: THREE.Camera): void {
    writeCamera(this.uniforms, camera);
  }
  setHaze(h: HazeSettings): void {
    writeHaze(this.uniforms, h);
  }
  setShimmer(sites: readonly ShimmerSite[], widthPx: number, heightPx: number, timeSec: number): void {
    writeShimmer(this.uniforms, sites, widthPx, heightPx, timeSec);
  }
  setFocus(x: number, z: number): void {
    writeFocus(this.uniforms, x, z);
  }
  dispose(): void {
    // Nothing owned: the stage's nodes are freed with the pipeline.
  }
}

