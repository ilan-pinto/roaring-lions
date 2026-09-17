// packages/app/src/ui/pause.ts
/**
 * Escape's target while a battlefield is running: a modal over a world that
 * keeps drawing while the sim stops (`shell/clock.ts`'s `paused` input is
 * what actually stops it -- this module only decides when that flag is set).
 * Lists the mission's objectives, mounts the settings table (Task 4) inside
 * itself so a rebind or a volume change does not cost the player their
 * attempt, and hands Restart/Quit to the caller rather than acting on them
 * directly -- `bootBattlefield` wraps both in `confirmDialog` before doing
 * anything destructive, exactly as the strip's own "leave" button already
 * does.
 *
 * Mirrors `confirm.ts`'s modal skeleton on purpose: the scrim, `role=dialog`
 * + `aria-modal`, opener focus captured and restored, a bubble-phase
 * `keydown` for Escape and a capture-phase guard that `stopPropagation()`s
 * everything but Escape/Enter/Tab -- plus one exemption confirm.ts has no
 * need for, the pan keys (`deps.isPanKey`, see `onCaptureKey` below). See
 * that file's own header for why the guard is capture-phase (it has to run
 * before `main.ts`'s bubble-phase game listener, which is registered once at
 * boot) and why Escape/Enter/Tab pass through untouched (Escape is this
 * dialog's own cancel, Enter activates a focused button, Tab is native focus
 * movement).
 *
 * Fix round 1: `main.ts`'s bubble-phase game listener is the OLDEST one on
 * `window`, so it used to run BEFORE any dialog's own Escape handler and act
 * on Escape regardless of what was open -- opening this menu under a confirm
 * the HUD's "Leave the mission?" button had raised, or resuming the game
 * (and tearing this menu down) while the player was only cancelling a
 * "Restart the mission?" confirm stacked on top of it. The fix lives in
 * `main.ts`, not here: the game handler now only OPENS this menu, and only
 * when `!isDialogOpen()` (`ui/confirm.ts`) and the mission has not ended --
 * it never resumes. Resuming stays exclusively this module's own job (the
 * bubble `onKey` below and the Resume button), which is what makes it safe
 * for the game handler to stop trying.
 *
 * Two stacking cases fall out of reusing the same `window`-level, capture-vs-
 * bubble pattern everywhere, and both are exercised in `pause.test.ts` rather
 * than assumed:
 *
 * A `confirmDialog` opened from Restart/Quit registers its OWN capture guard
 * and bubble Escape handler AFTER this module's, on the same `window`. A
 * game-verb key is still swallowed either way -- both guards independently
 * `stopPropagation()` it, and calling `stopPropagation()` from an EARLIER
 * capture listener does not stop a LATER one on the same node from also
 * running (only `stopImmediatePropagation()` does that), so late
 * registration is never a problem there. Escape is the case that needs care:
 * this module's own bubble Escape listener is registered FIRST (at mount)
 * and same-node bubble listeners fire in REGISTRATION order, so without a
 * check it would resume the game out from under a confirm still asking "are
 * you sure". The fix is local -- `onKey` below no-ops while a `.rl-confirm`
 * is present, which is exactly as long as a confirm opened on top of this
 * menu is open.
 *
 * The settings table's Controls section (Task 5, `settings-keymap.ts`) arms
 * a ONE-SHOT capture-phase listener on "Change" that is registered LATER
 * still (when the button is clicked) and calls `stopImmediatePropagation()`
 * unconditionally, before it even looks at which key landed. Because capture
 * always finishes before bubble begins in a single dispatch, that listener
 * wins outright: a captured key never reaches this module's own bubble
 * Escape handler (or the game) at all, and Escape while a capture is pending
 * cancels only the capture -- `settings-keymap.ts`'s own `capture` already
 * calls `stopPropagation`/`stopImmediatePropagation` before branching on
 * `ev.key === 'Escape'`, so nothing needed to change there.
 */
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { panel } from './panel';
import { settingsPanel, type SettingsDeps } from './settings-panel';

export interface PauseDeps {
  objectives(): readonly { text: string; primary: boolean; status: string }[];
  onResume(): void;
  /** The caller confirms before actually restarting. */
  onRestart(): void;
  /** The caller confirms before actually leaving. */
  onQuit(): void;
  settings: SettingsDeps;
  build: string;
  /** Is this physical keydown currently bound to a pan action? Fix round 1:
   *  `bootBattlefield` supplies this from its live `bindings` through
   *  `input/keymap.ts`'s `resolveKey`, so a rebind is honoured immediately --
   *  a hardcoded WASD/arrow set (what this shipped with first) stays wrong
   *  the moment a player moves one of those four letters onto something
   *  else. See `onCaptureKey` below for why panning is exempted from the
   *  capture guard at all. */
  isPanKey(ev: KeyboardEvent): boolean;
}

type Tab = 'objectives' | 'settings';

function actionButton(label: string, act: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rl-btn';
  b.dataset.act = act;
  b.textContent = label;
  return b;
}

/**
 * Mounts the pause modal under `host`. Unlike `confirmDialog`, this does not
 * resolve a promise: Resume and Escape close it and call `deps.onResume()`
 * themselves (so a caller never has to remember to), while Restart/Settings/
 * Quit hand off to the caller and leave the menu open -- the caller decides
 * whether a confirm, a settings mount, or nothing else happens next.
 */
export function pauseMenu(host: HTMLElement, deps: PauseDeps): { close: Disposer } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const scrim = document.createElement('div');
  scrim.className = 'rl-pause';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');

  const p = panel({ rank: 'inspect', title: t('pause.title') });
  p.el.classList.add('rl-pause__panel');

  // --- tabs: Objectives | Settings ---------------------------------------
  const tabs = document.createElement('div');
  tabs.className = 'rl-pause__tabs';
  const objTabBtn = document.createElement('button');
  objTabBtn.type = 'button';
  objTabBtn.className = 'rl-btn';
  objTabBtn.dataset.tab = 'objectives';
  objTabBtn.textContent = t('pause.tab.objectives');
  const setTabBtn = document.createElement('button');
  setTabBtn.type = 'button';
  setTabBtn.className = 'rl-btn';
  setTabBtn.dataset.tab = 'settings';
  setTabBtn.textContent = t('pause.tab.settings');
  tabs.append(objTabBtn, setTabBtn);
  p.body.appendChild(tabs);

  // --- objectives pane -----------------------------------------------------
  // Read once at mount: nothing ticks while paused (that is the whole point
  // of `clock.ts`'s `paused` input), so the list cannot go stale under the
  // player while this menu is up.
  const list = document.createElement('ol');
  list.className = 'rl-pause__list';
  const sorted = [...deps.objectives()].sort((a, b) => Number(b.primary) - Number(a.primary));
  for (const o of sorted) {
    const li = document.createElement('li');
    li.className = 'rl-pause__obj';
    if (o.primary) li.dataset.primary = '1';
    const text = document.createElement('span');
    text.className = 'rl-pause__obj-text';
    text.textContent = o.text;
    const status = document.createElement('span');
    status.className = 'rl-pause__obj-status';
    status.textContent = o.status;
    li.append(text, status);
    list.appendChild(li);
  }
  p.body.appendChild(list);

  // --- settings pane: mounted lazily, on first open, and kept -------------
  const settingsPane = document.createElement('div');
  settingsPane.className = 'rl-pause__settings';
  p.body.appendChild(settingsPane);
  let mountedSettings: { el: HTMLElement; dispose: Disposer } | null = null;

  const showTab = (tab: Tab): void => {
    list.hidden = tab !== 'objectives';
    settingsPane.hidden = tab !== 'settings';
    objTabBtn.dataset.on = tab === 'objectives' ? '1' : '0';
    setTabBtn.dataset.on = tab === 'settings' ? '1' : '0';
    if (tab === 'settings' && !mountedSettings) {
      mountedSettings = settingsPanel(settingsPane, deps.settings);
    }
  };
  objTabBtn.addEventListener('click', () => showTab('objectives'));
  setTabBtn.addEventListener('click', () => showTab('settings'));
  showTab('objectives');

  // --- actions --------------------------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'rl-pause__actions';
  const resumeBtn = actionButton(t('pause.resume'), 'resume');
  const restartBtn = actionButton(t('pause.restart'), 'restart');
  const settingsActBtn = actionButton(t('pause.settings'), 'settings');
  const quitBtn = actionButton(t('pause.quit'), 'quit');
  actions.append(resumeBtn, restartBtn, settingsActBtn, quitBtn);
  p.body.appendChild(actions);

  const foot = document.createElement('p');
  foot.className = 'rl-settings__hint';
  foot.textContent = t('common.build', { build: deps.build });
  p.body.appendChild(foot);

  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onCaptureKey, true);
    mountedSettings?.dispose();
    scrim.remove();
    opener?.focus();
  };
  const resumeAndClose = (): void => {
    finish();
    deps.onResume();
  };

  resumeBtn.addEventListener('click', () => resumeAndClose());
  restartBtn.addEventListener('click', () => deps.onRestart());
  settingsActBtn.addEventListener('click', () => showTab('settings'));
  quitBtn.addEventListener('click', () => deps.onQuit());

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // See the file header: a confirmDialog opened from Restart/Quit sits on
    // top of this modal and must get this Escape, not us.
    if (document.querySelector('.rl-confirm')) return;
    resumeAndClose();
  };
  // See confirm.ts's own header for the phase reasoning this mirrors. The
  // pan keys are a deliberate SECOND exemption confirm.ts has no need for:
  // the commit message this modal ships under is "a modal over a world that
  // keeps drawing while the sim stops", and camera panning is presentation
  // only (`renderer.camera.x/y`) -- it dispatches nothing, touches no sim
  // state, and stays correct under invariant 4 whether or not the modal is
  // up. Blocking it here would mean the world keeps drawing but the player
  // cannot look at it. `deps.isPanKey` (fix round 1) is the live answer,
  // built by `bootBattlefield` from its own `bindings` through
  // `resolveKey` -- see `PauseDeps.isPanKey`'s own doc comment.
  const onCaptureKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return;
    if (deps.isPanKey(e)) return;
    e.stopPropagation();
  };
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) resumeAndClose();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onCaptureKey, true);

  scrim.appendChild(p.el);
  host.appendChild(scrim);
  resumeBtn.focus();

  return { close: finish };
}
