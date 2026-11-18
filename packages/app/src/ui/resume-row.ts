/**
 * The Resume row of the campaign board (GH-1393 slice 2; design section 6): "Resume <mission>, saved 14 minutes ago, at 4:20" with Resume
 * and Discard, or, for a save that will not load, the one line that says why and Discard alone. Nothing is drawn when there is nothing to
 * resume. A refused save is never loaded and never deleted here: the player decides.
 *
 * Disposer contract: the row owns what it makes. Its confirm dialog is closed by the router's `closeOpenDialog()`; its own listeners die with
 * the element, and a Discard that completes after the row was disposed touches nothing (`disposed`).
 */
import type { ResumeRefusal } from '../mission-save';
import type { MovedWhat, PostureShift } from '../mission-resume';
import { t } from '../i18n/t';
import { confirmDialog } from './confirm';
import { resumeRefusalText, savedAgo } from './resume-copy';

export type ResumeView =
  | { state: 'none' }
  /** `note: 'failed'`: a resume was tried and could not be completed; the save is kept and Resume may be tried again. */
  | { state: 'ready'; missionId: string; savedAt: number; simTick: number; note?: 'failed' }
  /** `moved` (only with reason `moved`): which parts of the campaign changed since the save, so the line can name them; `posture`, the two
   *  postures when the posture is one of them (GH-1394). */
  | { state: 'refused'; reason: ResumeRefusal | 'moved'; moved?: readonly MovedWhat[]; posture?: PostureShift };

export interface ResumeRowDeps {
  /** What is stored right now (`readSuspended`). Read once when the row is built and again after a discard. */
  read(): ResumeView;
  /** The mission's display name, or undefined for an id the board does not know. */
  nameOf(missionId: string): string | undefined;
  /** Opens the saved mission. A soft navigation; the boot does the restoring and says if it cannot. */
  resume(missionId: string): void;
  /** Removes the save; false when the browser refused. */
  discard(): boolean;
  now(): number;
}

/** What the board is handed: builds the row (the code lives in the lazy kit). */
export type ResumeBlock = () => { el: HTMLElement | null; dispose(): void };

/** 4:20 for 5,200 ticks at 20 Hz. */
export function clockOfTicks(tick: number): string {
  const s = Math.floor(Math.max(0, tick) / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const button = (label: string, act: string, primary = false): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'rl-btn rl-menu__item' : 'rl-btn';
  if (primary) b.dataset.kind = 'primary';
  b.dataset.act = act;
  b.textContent = label;
  return b;
};

/** The row, or null when there is nothing to show. `dispose` is always safe to call. */
export function resumeRow(deps: ResumeRowDeps): { el: HTMLElement | null; dispose(): void } {
  const first = deps.read();
  if (first.state === 'none') return { el: null, dispose: () => undefined };
  let disposed = false;
  let dialog: { close(): void } | null = null;
  const el = document.createElement('section');
  el.className = 'rl-resume';
  const lead = document.createElement('h3');
  lead.className = 'rl-resume__lead';
  lead.textContent = t('resume.card.lead');
  const line = document.createElement('p');
  line.className = 'rl-resume__line';
  const actions = document.createElement('div');
  actions.className = 'rl-resume__actions';
  const msg = document.createElement('p');
  msg.className = 'rl-resume__msg';
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');
  el.append(lead, line, actions, msg);

  const paint = (): void => {
    actions.replaceChildren();
    msg.textContent = '';
    delete msg.dataset.tone;
    const v = deps.read();
    if (v.state === 'none') {
      el.remove();
      return;
    }
    if (v.state === 'ready') {
      const name = deps.nameOf(v.missionId) ?? v.missionId;
      line.textContent = t('resume.card.line', { name, ago: savedAgo(v.savedAt, deps.now()), clock: clockOfTicks(v.simTick) });
      actions.append(button(t('resume.card.resume', { name }), 'resume', true), button(t('resume.card.discard'), 'discard'));
      if (v.note === 'failed') {
        msg.dataset.tone = 'bad';
        msg.textContent = t('resume.failed');
      }
      actions.querySelector<HTMLButtonElement>('[data-act="resume"]')!.addEventListener('click', () => {
        const again = deps.read();
        if (again.state === 'ready') deps.resume(again.missionId);
        else paint();
      });
    } else {
      line.textContent = resumeRefusalText(v.reason, v.moved, v.posture);
      actions.append(button(t('resume.card.discard'), 'discard'));
    }
    actions.querySelector<HTMLButtonElement>('[data-act="discard"]')!.addEventListener('click', () => {
      if (dialog !== null) return;
      const h = confirmDialog(document.body, { title: t('resume.confirm.title'), body: t('resume.confirm.body'), confirm: t('resume.confirm.action'), danger: true });
      dialog = h;
      void h.answer.then((yes) => {
        if (dialog === h) dialog = null;
        if (!yes || disposed) return;
        if (deps.discard()) paint();
        else {
          msg.dataset.tone = 'bad';
          msg.textContent = t('resume.card.discardFailed');
        }
      });
    });
  };
  paint();
  return {
    el,
    dispose: () => {
      disposed = true;
      dialog?.close();
      dialog = null;
      el.remove();
    },
  };
}
