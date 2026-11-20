// The slow-frames suggestion (GH-1413): when the boot probe (`frame-probe.ts`) says frames run slow, the game ASKS once whether
// to switch to the Low preset. The player answers; nothing here changes a setting except the one button that says so.
//
// THE RULE. The lead's ruling of 10 Oct 2026 stands ("nothing automatic", `docs/PERFORMANCE.md`): the game suggests and never
// switches a preset by itself. So `setQuality` is called from the accept button's handler and from nowhere else; declining, Escape,
// a closed tab and a card that never shows all leave the saved setting as it was. A preset applies at the NEXT mission's boot
// (`packages/render/src/quality.ts`), never to a running mission, and the card says so.
//
// WHEN IT MAY SHOW. The same gate as the no-graphics notice (`playerHost`: a production build on a real host, or the desktop
// build, GH-1418; or `?qualityhint`), because CI and every harness run on SwiftShader and a card over their frames would swallow their keys. Not
// when the renderer is software (`no-gpu.ts` owns that player, and no preset rescues them: 0.6-1.9 fps at every preset), not when
// the saved preset is already `low` (nothing lower to suggest), not once the player has answered (asked ONCE, remembered in
// the browser store (`safeStorage`), in try/catch; a player who later raises the preset is not asked again), not while another dialog is open, and
// not while the player is in a mission.
//
// SOFTWARE RENDERING. The card never probes a software renderer; that player gets the software-rendering LINE instead
// (`software-hint.ts`, the same gate, loaded in this same lazy chunk), which suggests Low once and is remembered in
// `settings.hints.software`.
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { playerHost } from '../shell/player-host';
import type { Quality, Settings } from '../settings';
import type { StorageLike } from '../brigade-account';
import { isDialogOpen } from './confirm';
import { framesRunSlow, sampleFrames, type ProbeDeps, type ProbeResult } from './frame-probe';
import { isSoftwareRenderer, type NoGpuEnv } from './no-gpu';
import { mountNotice, type NoticeHandle } from './notice-card';
import { mountSoftwareHint, probeRendererName, resolveRenderer, softwareHintWanted, type SettingsAccess } from './software-hint';

/** Browser-store key: present once the player has answered the card (either way). */
export const QUALITY_HINT_ANSWERED_KEY = 'lions.qualityHint.answered';

/** The preset the card suggests. The lead asked for Low: it is the "it must run" preset (`quality.ts`). */
export const SUGGESTED_QUALITY: Quality = 'low';

/** May the suggestion be considered at all here? A player's real host (the web's, or the desktop build), or `?qualityhint`. */
export function qualityHintAllowed(env: NoGpuEnv): boolean {
  return playerHost(env) || env.query.has('qualityhint');
}

export interface QualityHintDeps {
  env: NoGpuEnv;
  /** The unmasked renderer string, or null. Read once the gate has passed. */
  renderer: () => string | null;
  /** A fresh renderer read for when `renderer` says nothing (masked or missing): `software-hint.ts`'s `probeRendererName`. */
  probeRenderer?: () => string | null;
  /** The saved settings, and their one writer (`main.ts`'s `settingsDeps`). `set` is called by an accept or dismiss button only. */
  settings: SettingsAccess;
  /** False while the player is in a mission or anywhere else a sample means nothing. */
  inShell: () => boolean;
  /**
   * True while the shell does not know its route yet (`router.current()` is null: a deep link before its mount resolves, the leave
   * animation of a click). The probe then waits instead of voiding on `inShell` (GH-1413's follow-up). Absent: never pending.
   */
  routePending?: () => boolean;
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

const quality = (deps: QualityHintDeps): Quality => deps.settings.get().video.quality;

/** Save a preset the player chose, through the settings dependency and nothing else. */
function setQuality(settings: SettingsAccess, q: Quality): void {
  const s: Settings = settings.get();
  settings.set({ ...s, video: { ...s.video, quality: q } });
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
    setQuality(deps.settings, SUGGESTED_QUALITY);
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
  if (quality(deps) === SUGGESTED_QUALITY) return () => {};
  const name = resolveRenderer(deps.renderer, deps.probeRenderer ?? (() => probeRendererName(win.document)));
  if (isSoftwareRenderer(name)) {
    // No probe and no card: the line, once (`software-hint.ts`).
    if (!softwareHintWanted({ allowed: true, renderer: name, settings: deps.settings.get() })) return () => {};
    return mountSoftwareHint({ settings: deps.settings, inShell: deps.inShell, win });
  }
  if (answered(deps.store)) return () => {};

  let card: NoticeHandle | null = null;
  let stopProbe: Disposer | null = null;
  const onResult = (r: ProbeResult): void => {
    stopProbe = null;
    if (r.kind !== 'sample' || !framesRunSlow(r.stats)) return;
    // The probe voids itself the moment `inShell` goes false (`steady`), so a sample that reaches here ended on a shell screen.
    if (quality(deps) === SUGGESTED_QUALITY) return;
    card = showCard(deps, win);
  };
  stopProbe = sampleFrames({ ...deps.frames, steady: deps.inShell, ...(deps.routePending === undefined ? {} : { pending: deps.routePending }) }, onResult);
  return () => {
    stopProbe?.();
    stopProbe = null;
    card?.close();
    card = null;
  };
}
