// packages/app/src/ui/briefing-video.ts
/**
 * A town's briefing backdrop on the deploy screen: plays ONCE, then holds its
 * last frame. Split out of `loading.ts` so the rule is one function a test can
 * hold to it.
 *
 * Once means no `loop` (the backdrops are generated as pinned loops, and
 * `docs/cinematics/README.md` leaves looping to the lead -- the ruling of
 * 2026-10-11 is once), and holding means nothing here reacts to `ended`: a
 * paused media element at its end keeps drawing its final frame, so the
 * absence of a handler IS the hold. Do not add a rewind, a `load()` or a
 * `loop` in an `ended` listener.
 *
 * The plan (`cinematics-model.ts`'s `backdropPlan`) says how it appears:
 * `autoplay` tries sound first and falls back to muted (the player reached the
 * screen by clicking a mission), `still` shows the first frame and waits for
 * the player's own play, and `none` builds nothing.
 */
import type { BackdropPlan } from './cinematics-model';

export interface BriefingVideoOptions {
  readonly plan: BackdropPlan;
  /** The element failed to load. It has already been removed from the DOM. */
  readonly onError?: () => void;
}

export function briefingVideo(url: string, opts: BriefingVideoOptions): HTMLVideoElement | null {
  if (opts.plan === 'none') return null;
  const video = document.createElement('video');
  video.className = 'rl-loading__video';
  video.loop = false;
  video.controls = true;
  video.playsInline = true;
  video.addEventListener('error', () => {
    video.remove();
    opts.onError?.();
  });
  if (opts.plan === 'still') {
    // `#t=` makes the browser decode and show a frame before any play; without
    // it a not-yet-played video is a black rectangle in several engines.
    video.src = `${url}#t=0.001`;
    video.autoplay = false;
    video.preload = 'metadata';
    return video;
  }
  video.src = url;
  video.autoplay = true;
  video.preload = 'auto';
  const attempt = video.play?.();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch(() => {
      video.muted = true;
      void video.play?.()?.catch(() => undefined);
    });
  }
  return video;
}
