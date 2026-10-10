/**
 * The debrief's one-line rating prompt (GH-464, spec §1, mocks 05-06): "How was
 * that mission?" 1-5, then one optional line. It sits in the after-action
 * report's foot, above the nav, so it never scrolls away, and it never takes
 * focus: Enter still answers the report's primary action until the player
 * reaches for the prompt themselves.
 *
 * A rating click alone is a deliberate act: leaving the report after picking
 * a number sends the rating without the line (`keepalive`, so the request
 * outlives the page). Leaving with nothing picked counts as one ignored ask
 * (`prompt-policy.ts`).
 *
 * A send already on its way when the report is left is NOT aborted: it is
 * one small request carrying a rating the player chose, and losing it would
 * be worse than letting it land. Its completion checks `disposed` and touches
 * nothing afterwards.
 *
 * Keys: the line's Enter sends it, and every key typed into it stops at the
 * field -- the report sits on no modal, so no capture guard stands in front
 * of the game's own listener (`main.ts` also skips text-field targets, D18).
 */
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import type { SendResult } from '../feedback/client';
import { LINE_MAX } from '../feedback/meta';

export interface RatingPromptDeps {
  send(rating: number, line: string, opts: { keepalive: boolean; signal?: AbortSignal }): Promise<SendResult>;
  /** The player picked a number (once). */
  onAnswered(): void;
  /** The report was left with no number picked. */
  onIgnored(): void;
}

export interface RatingPrompt {
  el: HTMLElement;
  dispose: Disposer;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function ratingPrompt(deps: RatingPromptDeps): RatingPrompt {
  const root = el('div', 'rl-rate');
  root.dataset.state = 'ask';
  const qId = `rl-rate-q-${Math.random().toString(36).slice(2, 8)}`;
  const q = el('span', 'rl-rate__q', t('feedback.rate.question'));
  q.id = qId;
  const scale = el('div', 'rl-rate__scale');
  scale.setAttribute('role', 'radiogroup');
  scale.setAttribute('aria-labelledby', qId);
  const buttons: HTMLButtonElement[] = [];
  scale.appendChild(el('span', 'rl-rate__end', t('feedback.rate.poor')));
  for (let n = 1; n <= 5; n++) {
    const b = el('button', 'rl-btn rl-rate__n', String(n));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.n = String(n);
    buttons.push(b);
    scale.appendChild(b);
  }
  scale.appendChild(el('span', 'rl-rate__end', t('feedback.rate.great')));

  const line = el('input', 'rl-rate__line');
  line.type = 'text';
  line.maxLength = LINE_MAX;
  line.placeholder = t('feedback.rate.line');
  line.setAttribute('aria-label', t('feedback.rate.line'));
  line.hidden = true;
  const send = el('button', 'rl-btn rl-rate__send', t('feedback.rate.send'));
  send.type = 'button';
  send.hidden = true;
  const note = el('p', 'rl-rate__note', t('feedback.rate.note'));
  note.hidden = true;
  const status = el('span', 'rl-rate__status');
  status.setAttribute('role', 'status');
  root.append(q, scale, line, send, status, note);

  let rating: number | null = null;
  let sent = false;
  let sending = false;
  let disposed = false;

  const pick = (n: number): void => {
    if (sent) return;
    if (rating === null) deps.onAnswered();
    rating = n;
    for (const b of buttons) b.setAttribute('aria-checked', String(Number(b.dataset.n) === n));
    line.hidden = false;
    send.hidden = false;
    note.hidden = false;
    root.dataset.state = 'rated';
  };
  for (const b of buttons) b.addEventListener('click', () => pick(Number(b.dataset.n)));

  const submit = async (): Promise<void> => {
    if (rating === null || sent || sending || disposed) return;
    sending = true;
    send.disabled = true;
    let r: SendResult;
    try {
      r = await deps.send(rating, line.value, { keepalive: false });
    } catch {
      r = { kind: 'failed', status: null };
    }
    sending = false;
    if (disposed) return;
    send.disabled = false;
    if (r.kind === 'sent' || r.kind === 'dry-run' || r.kind === 'closed') {
      // A closed switch reads as "thanks" too: the player did their part,
      // and there is nothing for them to do about it.
      sent = true;
      root.dataset.state = 'sent';
      root.replaceChildren(el('span', 'rl-rate__thanks', t(r.kind === 'dry-run' ? 'feedback.rate.dryRun' : 'feedback.rate.thanks')));
      return;
    }
    if (r.kind !== 'aborted') status.textContent = t('feedback.rate.failed');
  };
  send.addEventListener('click', () => void submit());
  line.addEventListener('keydown', (e) => {
    // Everything typed here is the line's (D18): stop it before `window`.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  return {
    el: root,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (rating === null) deps.onIgnored();
      else if (!sent && !sending) {
        // Leaving after a number is a deliberate act: the rating goes alone,
        // and outlives the page.
        void deps.send(rating, '', { keepalive: true }).catch(() => undefined);
      }
      root.remove();
    },
  };
}
