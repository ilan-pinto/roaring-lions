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
    place: 'bottom:16px;left:50%;transform:translateX(-50%);width:min(520px,92vw)',
  });

  const teach = document.createElement('div');
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
