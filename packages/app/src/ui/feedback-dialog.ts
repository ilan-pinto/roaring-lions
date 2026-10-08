/**
 * The main menu's feedback modal (GH-464, spec §1): the same form as the pause
 * menu's Feedback tab, without the picture or the replay -- bugs on the
 * campaign board, in the garage or the brigade screen have no pause menu to
 * report them from.
 *
 * A `.rl-confirm`-family modal, built on `confirm.ts`'s skeleton: the scrim,
 * `role=dialog` + `aria-modal`, opener focus captured and restored, the focus
 * trap, Escape and a scrim click to close, and a capture-phase guard that
 * stops every key but Escape/Enter/Tab -- with the D18 rule on top: a
 * focused text field owns every key but Escape and Tab. It registers with
 * `closeOpenDialog()` (`trackOpenDialog`), so `Router.unmount()` takes it
 * down with the screen under it.
 */
import { t } from '../i18n/t';
import { isTextEntry } from '../input/keymap';
import type { Disposer } from '../shell/router';
import { trackOpenDialog } from './confirm';
import { feedbackForm, type FeedbackFormDeps } from './feedback-form';
import { focusTrap } from './focus-trap';
import { panel } from './panel';

export type FeedbackDialogDeps = Omit<FeedbackFormDeps, 'source' | 'onBack' | 'onCancel' | 'picture' | 'replay' | 'where'>;

export function feedbackDialog(host: HTMLElement, deps: FeedbackDialogDeps): { close: Disposer } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = document.createElement('div');
  scrim.className = 'rl-confirm rl-feedback-dialog';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  const p = panel({ rank: 'inspect', title: t('feedback.title') });
  p.el.classList.add('rl-confirm__panel', 'rl-feedback-dialog__panel');
  const disposeTrap = focusTrap(p.el);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    release();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onCaptureKey, true);
    disposeTrap();
    form.dispose();
    scrim.remove();
    opener?.focus();
  };
  const release = trackOpenDialog(close);

  const form = feedbackForm(p.body, { ...deps, source: 'menu', onBack: close, onCancel: close });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const onCaptureKey = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target) && e.key !== 'Escape' && e.key !== 'Tab') {
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return;
    e.stopPropagation();
  };
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onCaptureKey, true);

  scrim.appendChild(p.el);
  host.appendChild(scrim);
  form.focus();
  return { close };
}
