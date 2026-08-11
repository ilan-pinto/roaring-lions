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

import { panel } from '../ui/panel';
import type { TutorialState } from './runtime';

export interface TutorialPanel {
  render(state: TutorialState): void;
  destroy(): void;
}

export function tutorialPanel(host: HTMLElement, opts: { onSkip: () => void }): TutorialPanel {
  const p = panel({
    rank: 'inspect',
    title: '',
    tag: '',
    // Under the clock rather than along the bottom edge, where 11px of mono
    // went unread. Centred on the clock, so the width is capped at whatever
    // clears the briefing on the left — 648px is twice the briefing's right
    // edge (8 + 300) plus a gutter. A floor here would be a floor on how far
    // it may cover the objectives list, so there is none: on a narrow window
    // the lesson gets thin rather than covering what it is teaching about.
    place:
      'top:100px;left:50%;transform:translateX(-50%);' +
      'width:min(620px,calc(100vw - 648px))',
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
  skip.textContent = 'skip tutorial';
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
