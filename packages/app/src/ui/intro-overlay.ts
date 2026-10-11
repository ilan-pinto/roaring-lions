// packages/app/src/ui/intro-overlay.ts
/**
 * The intro cinematic: a full-screen overlay on `document.body`, over whatever
 * screen mounted it, skippable at any moment.
 *
 * It mounts on `document.body`, which the router's stage-emptying does not
 * reach, so the screen that called `playIntro` owns the disposer it returns and
 * must call it on the way out (CLAUDE.md, "The disposer contract"): the menu's
 * for the first-launch play, the settings panel's for "Replay intro". Leaving
 * the route mid-video tears it down; nothing of it survives in the document.
 *
 * Four ways to skip -- the Skip button, Escape, Space or Enter, and a click
 * anywhere -- and all four are the same `finish('skipped')`. While it is up a
 * key does nothing underneath it: the keydown listener is capture-phase on
 * `window` and swallows the event, which is also what stops Escape from
 * reaching the shell's own back handler.
 *
 * The overlay never fails loudly. A video that errors (including a 200 that is
 * really the SPA's index.html, which is how a missing file shows up under
 * Vite's fallback) or a `play()` the browser refuses just removes the overlay:
 * `onFinish('error')`, no console output from here.
 */
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';

/** Why an overlay ended on its own. `disposed` is not one of them: a screen
 *  that tears the overlay down is not a verdict on whether it was watched. */
export type IntroEnd = 'ended' | 'skipped' | 'error';

export interface IntroOverlayDeps {
  /** The resolved URL (`${BASE}video/intro.mp4`). */
  readonly url: string;
  /** Called at most once, when the overlay ends by itself. The overlay is
   *  already gone by then. */
  readonly onFinish?: (why: IntroEnd) => void;
}

const SKIP_KEYS: ReadonlySet<string> = new Set(['Escape', ' ', 'Spacebar', 'Enter']);

export function playIntro(deps: IntroOverlayDeps): Disposer {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const root = document.createElement('div');
  root.className = 'rl-intro';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', t('intro.label'));

  const video = document.createElement('video');
  video.className = 'rl-intro__video';
  video.src = deps.url;
  // The cut ships silent (docs/cinematics/README.md, "Format and encode"), and
  // a first launch has had no user gesture, so an unmuted autoplay would be
  // refused. Muted is the one setting that always plays.
  video.muted = true;
  video.autoplay = true;
  video.loop = false;
  video.controls = false;
  video.playsInline = true;
  video.preload = 'auto';

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'rl-btn rl-intro__skip';
  skip.textContent = t('intro.skip');

  root.append(video, skip);

  let done = false;

  const release = (): void => {
    window.removeEventListener('keydown', onKey, true);
    root.removeEventListener('click', onClick);
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('error', onError);
    try {
      video.pause?.();
      video.removeAttribute('src');
      // Drops the network request and the decoder; `pause` alone keeps both.
      video.load?.();
    } catch {
      // A media element that refuses to be torn down is still removed below.
    }
    root.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  };

  const finish = (why: IntroEnd): void => {
    if (done) return;
    done = true;
    release();
    deps.onFinish?.(why);
  };

  function onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Nothing under the cinematic hears a key.
    e.stopImmediatePropagation();
    if (SKIP_KEYS.has(e.key)) {
      e.preventDefault();
      finish('skipped');
    }
  }
  function onClick(): void {
    finish('skipped');
  }
  function onEnded(): void {
    finish('ended');
  }
  function onError(): void {
    finish('error');
  }

  window.addEventListener('keydown', onKey, true);
  root.addEventListener('click', onClick);
  video.addEventListener('ended', onEnded);
  video.addEventListener('error', onError);

  document.body.appendChild(root);
  skip.focus();

  const attempt = video.play?.();
  if (attempt && typeof attempt.catch === 'function') attempt.catch(() => finish('error'));

  return () => {
    if (done) return;
    done = true;
    release();
  };
}
