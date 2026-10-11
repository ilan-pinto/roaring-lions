// packages/app/src/ui/intro.ts
/**
 * The intro's two entry points, over `intro-overlay.ts` and the pure decision
 * in `cinematics-model.ts`:
 *
 *  - `firstLaunchIntro`, called by the menu on every mount: plays the intro if
 *    this is a first launch (or marks it seen, unplayed, under reduced motion
 *    or save-data), and does nothing otherwise -- in particular nothing at all
 *    while no intro ships.
 *  - `replayIntro`, called by Settings' "Replay intro": plays it on request,
 *    whatever the motion or data preference says, and never touches `seen`
 *    (it is already set, or the player is about to set it by watching).
 *
 * Both return the overlay's disposer (or a no-op), which the CALLING screen
 * owns.
 */
import type { Disposer } from '../shell/router';
import type { Settings } from '../settings';
import { INTRO_VIDEO, introDecision, isShippedVideo, type VideoManifest } from './cinematics-model';
import { playIntro, type IntroEnd } from './intro-overlay';

export interface IntroDeps {
  readonly manifest: VideoManifest;
  /** `BASE`, ending in a slash. */
  readonly base: string;
  readonly settings: { get(): Settings; set(next: Settings): void };
  readonly reducedMotion: () => boolean;
  readonly saveData: () => boolean;
  /** Test seam; production is `playIntro`. */
  readonly play?: typeof playIntro;
}

const NOOP: Disposer = () => undefined;

function markSeen(settings: IntroDeps['settings']): void {
  const current = settings.get();
  if (current.intro.seen) return;
  const next = structuredClone(current);
  next.intro.seen = true;
  settings.set(next);
}

export function firstLaunchIntro(deps: IntroDeps): Disposer {
  const decision = introDecision({
    shipped: isShippedVideo(deps.manifest, INTRO_VIDEO),
    seen: deps.settings.get().intro.seen,
    reducedMotion: deps.reducedMotion(),
    saveData: deps.saveData(),
  });
  if (decision === 'none') return NOOP;
  if (decision === 'mark-seen') {
    markSeen(deps.settings);
    return NOOP;
  }
  return (deps.play ?? playIntro)({
    url: `${deps.base}${INTRO_VIDEO}`,
    // Watched or skipped is seen; a video that failed is neither, and gets
    // another try next launch.
    onFinish: (why: IntroEnd) => {
      if (why !== 'error') markSeen(deps.settings);
    },
  });
}

/** True when there is an intro to replay: the Settings row exists only then. */
export function introAvailable(deps: Pick<IntroDeps, 'manifest'>): boolean {
  return isShippedVideo(deps.manifest, INTRO_VIDEO);
}

export function replayIntro(deps: Pick<IntroDeps, 'manifest' | 'base' | 'play'>): Disposer {
  if (!introAvailable(deps)) return NOOP;
  return (deps.play ?? playIntro)({ url: `${deps.base}${INTRO_VIDEO}` });
}
