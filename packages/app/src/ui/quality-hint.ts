// The slow-frames suggestion (GH-1413): when the boot probe (`frame-probe.ts`) says frames run slow, the game ASKS once whether
// to switch to the Low preset. The player answers; nothing here changes a setting except the one button that says so.
//
// THE RULE. The lead's ruling of 10 Oct 2026 stands ("nothing automatic", `docs/PERFORMANCE.md`): the game suggests and never
// switches a preset by itself. So `setQuality` is called from the accept button's handler and from nowhere else; declining, Escape,
// a closed tab and a card that never shows all leave the saved setting as it was. A preset applies at the NEXT mission's boot
// (`packages/render/src/quality.ts`), never to a running mission, and the card says so.
//
// WHEN IT MAY SHOW. The same gate as the no-graphics notice and telemetry (`feedbackSends`: a production build on a real host,
// or `?qualityhint`), because CI and every harness run on SwiftShader and a card over their frames would swallow their keys. Not
// when the renderer is software (`no-gpu.ts` owns that player, and no preset rescues them: 0.6-1.9 fps at every preset), not when
// the saved preset is already `low` (nothing lower to suggest), not once the player has answered (asked ONCE, remembered in
// the browser store (`safeStorage`), in try/catch; a player who later raises the preset is not asked again), not while another dialog is open, and
// not while the player is in a mission.
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { feedbackSends } from '../feedback/gate';
import type { Quality } from '../settings';
import type { StorageLike } from '../brigade-account';
import { isDialogOpen } from './confirm';
import { framesRunSlow, sampleFrames, type ProbeDeps, type ProbeResult } from './frame-probe';
import { isSoftwareRenderer, type NoGpuEnv } from './no-gpu';
import { mountNotice, type NoticeHandle } from './notice-card';

/** Browser-store key: present once the player has answered the card (either way). */
export const QUALITY_HINT_ANSWERED_KEY = 'lions.qualityHint.answered';

/** The preset the card suggests. The lead asked for Low: it is the "it must run" preset (`quality.ts`). */
export const SUGGESTED_QUALITY: Quality = 'low';

/** May the suggestion be considered at all here? A production build on a real host, or `?qualityhint`. */
export function qualityHintAllowed(env: NoGpuEnv): boolean {
  return feedbackSends(env) || env.query.has('qualityhint');
}

export interface QualityHintDeps {
  env: NoGpuEnv;
  /** The unmasked renderer string, or null. Read once the gate has passed. */
  renderer: () => string | null;
  /** The saved preset. */
  quality: () => Quality;
  /** Save a preset the player chose. Called by the accept button only. */
  setQuality: (q: Quality) => void;
  /** False while the player is in a mission or anywhere else a sample means nothing. */
  inShell: () => boolean;
  frames: Pick<ProbeDeps, 'raf' | 'cancel' | 'now' | 'visible'>;
  /** Persistent store for "answered"; null when storage is blocked (the card then asks again next load). */
  store: StorageLike | null;
  win?: Window;
}

function answered(store: StorageLike | null): boolean {
  try {
    return store?.getItem(QUALITY_HINT_ANSWERED_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(store: StorageLike | null): void {
  try {
    store?.setItem(QUALITY_HINT_ANSWERED_KEY, '1');
  } catch {
    // Blocked site data: the card is asked once per page load at most, so nothing more is needed.
  }
}

/** Show the card for a slow verdict. Returns its handle, or null when another dialog owns the screen. */
function showCard(deps: QualityHintDeps, win: Window): NoticeHandle | null {
  if (isDialogOpen(win.document)) return null;
  let card: NoticeHandle | null = null;
  const close = (): void => {
    const c = card;
    card = null;
    c?.close();
  };
  const decline = (): void => {
    remember(deps.store);
    close();
  };
  const accept = (): void => {
    remember(deps.store);
    deps.setQuality(SUGGESTED_QUALITY);
    close();
  };
  card = mountNotice(win, {
    scrimClass: 'rl-boot-scrim rl-quality-hint',
    idBase: 'rl-quality-hint',
    title: t('qualityHint.title'),
    body: t('qualityHint.body'),
    next: t('qualityHint.next'),
    onEscape: decline,
    buttons: [
      { className: 'rl-btn rl-quality-hint__accept', label: t('qualityHint.accept'), onClick: accept },
      { className: 'rl-btn rl-quality-hint__keep', label: t('qualityHint.keep'), onClick: decline },
    ],
  });
  return card;
}

/**
 * Decide once at boot whether to probe, probe, and show the card on a slow verdict. Returns the disposer: it stops the probe and
 * takes the card away if it is up.
 */
export function watchQualityHint(deps: QualityHintDeps): Disposer {
  const win = deps.win ?? window;
  if (!qualityHintAllowed(deps.env)) return () => {};
  if (answered(deps.store)) return () => {};
  if (deps.quality() === SUGGESTED_QUALITY) return () => {};
  let name: string | null;
  try {
    name = deps.renderer();
  } catch {
    name = null;
  }
  if (isSoftwareRenderer(name)) return () => {};

  let card: NoticeHandle | null = null;
  let stopProbe: Disposer | null = null;
  const onResult = (r: ProbeResult): void => {
    stopProbe = null;
    if (r.kind !== 'sample' || !framesRunSlow(r.stats)) return;
    // The probe voids itself the moment `inShell` goes false (`steady`), so a sample that reaches here ended on a shell screen.
    if (deps.quality() === SUGGESTED_QUALITY) return;
    card = showCard(deps, win);
  };
  stopProbe = sampleFrames({ ...deps.frames, steady: deps.inShell }, onResult);
  return () => {
    stopProbe?.();
    stopProbe = null;
    card?.close();
    card = null;
  };
}
