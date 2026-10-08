/**
 * The step panel.
 *
 * Rank `inspect`, not `mission`: the briefing owns `mission`, and panel.ts
 * documents the three ranks precisely so nothing on screen outranks the thing
 * it should not.
 *
 * Deliberately thin — every decision that can be wrong is in runtime.ts, which
 * is unit-tested. This file only paints.
 */

import { t } from '../i18n/t';
import { panel } from '../ui/panel';
import type { TutorialState } from './runtime';

export interface TutorialPanel {
  render(state: TutorialState): void;
  destroy(): void;
}

export function tutorialPanel(host: HTMLElement, opts: { onSkip: () => void }): TutorialPanel {
  const p = panel({
    // A lesson is read, so it wears the briefing's rank (VR-24), not the
    // machinery's.
    rank: 'mission',
    title: '',
    tag: '',
    // GH-345: in the radio's own slot, top left (`.rl-cmd` in theme.css:
    // the strip's height plus 0.625rem, one --s2 in from the edge, 32.5rem
    // wide). The radio is hidden for the whole tutorial, so the lesson takes
    // the place the player's eye already goes for orders -- and the two can
    // no longer overlap, which they did when the panel sat under the clock
    // and covered the radio's own text.
    place:
      'top:calc(var(--hud-strip-h) + 0.625rem);left:var(--s2);' +
      'width:min(32.5rem,calc(100vw - 2 * var(--s2)))',
  });
  p.el.classList.add('rl-tutorial');

  const teach = document.createElement('div');
  teach.className = 'rl-tutorial__teach';
  p.body.appendChild(teach);

  const nudge = document.createElement('div');
  nudge.className = 'rl-tutorial__nudge';
  p.body.appendChild(nudge);

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'rl-btn rl-tutorial__skip';
  skip.textContent = t('tutorial.skip');
  skip.addEventListener('click', opts.onSkip);
  p.body.appendChild(skip);

  host.appendChild(p.el);

  let paintedIndex = -1;
  let paintedNudging = false;

  return {
    render(state) {
      if (state.done) {
        p.hide();
        return;
      }
      const step = state.steps[state.index];
      if (step === undefined) return;
      if (state.index !== paintedIndex) {
        p.setTitle(step.title);
        p.setTag(`${state.index + 1} / ${state.steps.length}`);
        teach.textContent = step.teach;
        p.show();
        paintedIndex = state.index;
      }
      if (state.nudging !== paintedNudging) {
        nudge.textContent = state.nudging ? (step.nudge ?? '') : '';
        paintedNudging = state.nudging;
      }
    },
    destroy() {
      p.el.remove();
    },
  };
}
