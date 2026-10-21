/**
 * The player's video-quality setting (`packages/app/src/settings.ts`'s
 * `Quality`), translated into the four knobs the renderer actually turns.
 *
 * Backend-neutral by construction -- no `three` import, so `packages/app`
 * can build a `RendererOptions.quality` without caring which backend is
 * live. `PixiRenderer` ignores the field entirely (it has no AO, no SMAA
 * and no shadow map to size), exactly like every other three-only field on
 * `RendererOptions` (`shellColors`, the ground texture URLs,
 * `dracoDecoderPath`).
 *
 * `high` is pinned to today's constants on purpose: before this file
 * existed, the renderer always ran ambient occlusion at
 * `AO_RESOLUTION_SCALE` and always built an SMAA pass, and the sun's shadow
 * map was always `lighting.ts`'s own `SHADOW_MAP_SIZE`. A player who never
 * touches the setting -- `DEFAULT_SETTINGS.video.quality` is `'high'` --
 * must see the identical frame this task shipped before it, which is also
 * the property the visual gate checks: the golden baselines were captured
 * at `high` and must not need re-blessing for this change alone.
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
   * The selective HDR bloom (`three/bloom.ts`, Defilade Task 4, ruling D8):
   * `'quarter'` builds three's `UnrealBloomPass` with its bright-pass and
   * blur targets at a QUARTER of the drawing buffer per axis, slotted after
   * AO and before `OutputPass`; `'off'` never builds it. `low` is the
   * "it must run" preset, so it pays nothing.
   *
   * Turning it on at `high` does not move a quiet frame: the threshold is a
   * scene-referred luminance of 1.0 and the census
   * (`tools/src/perf/bloom-census.ts`) holds every shipped map's quiet frame
   * under 0.9, so the high-pass writes exactly 0 and the additive blend adds
   * +0. That is a measured claim with a tool behind it, not a hope.
   */
  bloom: 'off' | 'quarter';
}

export const QUALITY_PRESETS: Readonly<Record<'low' | 'medium' | 'high', RenderQuality>> = {
  low: { ao: false, smaa: false, shadowMapSize: 1024, bloom: 'off' },
  medium: { ao: false, smaa: true, shadowMapSize: 2048, bloom: 'quarter' },
  high: { ao: true, smaa: true, shadowMapSize: 4096, bloom: 'quarter' },
};
