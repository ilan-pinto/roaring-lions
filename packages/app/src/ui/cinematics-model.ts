// packages/app/src/ui/cinematics-model.ts
/**
 * The decisions behind cinematic playback, as pure functions so each is a
 * table a test can walk. No DOM, no storage, no clock.
 *
 * Two surfaces play video: the intro (full screen over the menu, first launch
 * only, `ui/intro.ts` + `ui/intro-overlay.ts`) and a town's briefing backdrop
 * (the deploy screen, `ui/briefing-video.ts`). Both share three rules, all from
 * the lead's ruling of 2026-10-11 (docs/cinematics/README.md, "Delivery"):
 *
 *  - A video plays only if `data/video.json` lists it. That file is held to
 *    `assets/video/` both ways by `pnpm validate:data`, so a listed path is a
 *    shipped file -- and an unlisted one is never requested: no overlay and no
 *    404 in the console while nothing has shipped.
 *  - Reduced motion and save-data never AUTO-play anything. An explicit
 *    "Replay intro" still plays whatever either says: the player asked.
 *  - A video that cannot be had leaves the screen exactly as it was before
 *    videos existed.
 */

/** The intro's path under `assets/`, the key it has in `data/video.json`. */
export const INTRO_VIDEO = 'video/intro.mp4';

/** `data/video.json`'s shape, as far as playback reads it. */
export interface VideoManifest {
  readonly files: Readonly<Record<string, unknown>>;
}

/** True when `path` (relative to `assets/`, e.g. `video/intro.mp4`) is a
 *  listed, i.e. shipped, cinematic. Own keys only: `toString` is not a video. */
export function isShippedVideo(manifest: VideoManifest, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest.files, path);
}

/** What the menu does about the intro on mount.
 *  - `none`: nothing. The video is not shipped, or the player has seen it.
 *  - `play`: mount the overlay.
 *  - `mark-seen`: a first launch that must not auto-play (reduced motion or
 *    save-data). The intro counts as seen, unplayed -- it is not queued up to
 *    ambush the player later -- and Settings' "Replay intro" still works. */
export type IntroDecision = 'none' | 'play' | 'mark-seen';

export interface IntroInputs {
  /** `isShippedVideo(manifest, INTRO_VIDEO)`. */
  readonly shipped: boolean;
  /** `settings.intro.seen`. */
  readonly seen: boolean;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
}

/** The first-launch decision. Not shipped wins over everything, including the
 *  mark: marking an intro nobody could have seen as seen would swallow it for
 *  good on the day it ships. */
export function introDecision(i: IntroInputs): IntroDecision {
  if (!i.shipped) return 'none';
  if (i.seen) return 'none';
  if (i.reducedMotion || i.saveData) return 'mark-seen';
  return 'play';
}

/** How a town's backdrop appears on the deploy screen.
 *  - `autoplay`: plays once (never loops) and holds its last frame.
 *  - `still`: reduced motion. The element is there, at its first frame, with
 *    controls, and plays only if the player presses play.
 *  - `none`: save-data. Not even fetched; the screen is as it was without one. */
export type BackdropPlan = 'autoplay' | 'still' | 'none';

export function backdropPlan(i: { readonly reducedMotion: boolean; readonly saveData: boolean }): BackdropPlan {
  if (i.saveData) return 'none';
  if (i.reducedMotion) return 'still';
  return 'autoplay';
}
