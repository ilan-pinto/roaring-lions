/**
 * The player's video-quality setting (`packages/app/src/settings.ts`'s
 * `Quality`), translated into the four knobs the renderer actually turns:
 * AO, SMAA, the shadow map size and, since Defilade T4, the bloom.
 *
 * Backend-neutral by construction -- no `three` import, so `packages/app`
 * can build a `RendererOptions.quality` without importing the backend,
 * which arrives by dynamic import (three.js is the only renderer since
 * WP-A3.3; the `PixiRenderer` that once ignored this field is deleted).
 *
 * `high` was pinned to the pre-preset constants on purpose: before this file
 * existed, the renderer always ran ambient occlusion at
 * `AO_RESOLUTION_SCALE` and always built an SMAA pass, and the sun's shadow
 * map was always `lighting.ts`'s own `SHADOW_MAP_SIZE`. A player who never
 * touches the setting -- `DEFAULT_SETTINGS.video.quality` is `'high'` --
 * must have seen the identical frame shipped before it, which is also the
 * property the visual gate checked: the golden baselines were captured at
 * `high` and did not need re-blessing for that change alone. The bloom
 * (below) is the one knob added since that is not a no-op at `high`.
 */
export interface RenderQuality {
  /** Whether the post chain builds and slots `WorldGTAOPass`. */
  ao: boolean;
  /** Whether the post chain builds and slots `SMAAPass`. */
  smaa: boolean;
  /** The sun's shadow map resolution, per edge -- `lighting.ts`'s
   *  `SHADOW_MAP_SIZE` at `high`, halved at each step down. */
  shadowMapSize: 1024 | 2048 | 4096;
  /**
   * The selective HDR bloom (`three/bloom.ts`, Defilade T4 Task 1, ruling D8):
   * `'quarter'` builds three's `UnrealBloomPass` with its bright-pass and
   * blur targets at a QUARTER of the drawing buffer per axis, slotted after
   * AO and before `OutputPass`; `'off'` never builds it. `low` is the
   * "it must run" preset, so it pays nothing.
   *
   * Turning it on at `high` does not move a quiet frame: the threshold is a
   * scene-referred luminance of 1.0 and the census
   * (`tools/src/perf/bloom-census.ts`) holds every shipped map's quiet frame
   * under 0.9, so the high-pass writes exactly 0 and the additive blend adds
   * +0. That is a measured claim with a tool behind it, not a hope. It is a
   * claim about QUIET frames: the gated `aftermath` frame is not one (at its
   * tick 300 the sandbox force is firing, and its pooled muzzle-flash lights
   * read 2.99-3.26 against 0.69 with them hidden), so that frame does bloom
   * -- an open item for the lead (`docs/PERFORMANCE.md`, "Defilade T4").
   */
  bloom: 'off' | 'quarter';
}

export const QUALITY_PRESETS: Readonly<Record<'low' | 'medium' | 'high', RenderQuality>> = {
  low: { ao: false, smaa: false, shadowMapSize: 1024, bloom: 'off' },
  medium: { ao: false, smaa: true, shadowMapSize: 2048, bloom: 'quarter' },
  high: { ao: true, smaa: true, shadowMapSize: 4096, bloom: 'quarter' },
};
