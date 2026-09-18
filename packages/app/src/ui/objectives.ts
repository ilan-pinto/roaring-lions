// packages/app/src/ui/objectives.ts
/**
 * The one objective tracker (§6, R-7: one component, three mounts). This task
 * mounts it once, on the briefing (`loading.ts`); task 6 mounts the SAME
 * component from the strip's `+N` and from the pause menu -- which is the
 * whole point of building it here rather than a fourth copy of `pause.ts`'s
 * own list.
 *
 * A thunk, not a snapshot: `deps.rows()` is read fresh on every `refresh()`,
 * so an in-mission mount (task 6) can call `refresh()` on the same tick
 * cadence the strip already repaints on, without this module knowing
 * anything about ticks, the sim, or the clock. The briefing calls it once
 * and never again -- nothing changes on a screen the player has not deployed
 * from yet.
 *
 * Primaries sort first, stable within each half -- the exact comparator
 * `pause.ts`'s own objective list already uses, so a player who opens this
 * panel mid-mission after having read the briefing sees the same order both
 * times.
 */
import type { ObjectiveStatus } from '@lions/sim';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { objectiveGlyph, clockText } from './hud-model';
import { objectiveStatusLabel } from './objective-status';
import { rewardFor } from './objective-reward';
import { panel } from './panel';

export interface ObjectiveRow {
  id: string;
  text: string;
  primary: boolean;
  carries: boolean;
  status: ObjectiveStatus;
  ticksLeft?: number;
}

export interface ObjectivesDeps {
  rows(): readonly ObjectiveRow[];
  /** Whether this mission pays credits at all (`ledger.produces.length > 0`)
   *  -- threaded straight through to `rewardFor` so a tutorial mount never
   *  promises a payout `main.ts`'s `payMission` gate will not make. */
  paysCredits: boolean;
  /** Renders a close control when given. The briefing passes none -- there
   *  is nothing else on that screen for Escape to mean, and the panel is
   *  read once, not dismissed. Task 6's popover and pause-menu mounts pass
   *  one. */
  onClose?: () => void;
}

export function objectivesPanel(
  host: HTMLElement,
  deps: ObjectivesDeps
): { el: HTMLElement; refresh(): void; dispose: Disposer } {
  const p = panel({ rank: 'inspect', title: t('objectives.title') });
  // `.rl-panel` is absolutely positioned and pointer-events:none by default --
  // right for a HUD panel pinned over the map, wrong wherever this mounts
  // inline in ordinary document flow (the briefing's beat column, a
  // popover's own box). `.rl-pause__panel` overrides the same two
  // properties for the same reason; this is that pattern's third user.
  p.el.classList.add('rl-obj-panel');

  if (deps.onClose) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rl-btn rl-obj-close';
    close.textContent = t('objectives.close');
    close.addEventListener('click', () => deps.onClose?.());
    p.body.appendChild(close);
  }

  const list = document.createElement('ul');
  list.className = 'rl-obj-list';
  p.body.appendChild(list);

  const paint = (): void => {
    list.innerHTML = '';
    // The same comparator pause.ts's own objective list sorts with --
    // `Array.prototype.sort` is stable (ES2019+), so units within a half
    // keep the order `rows()` handed them in.
    const sorted = [...deps.rows()].sort((a, b) => Number(b.primary) - Number(a.primary));
    for (const o of sorted) {
      const li = document.createElement('li');
      li.className = 'rl-obj';
      li.dataset.id = o.id;
      li.dataset.primary = o.primary ? '1' : '0';
      li.dataset.status = o.status;

      const glyph = document.createElement('span');
      glyph.className = 'rl-obj__glyph';
      glyph.textContent = objectiveGlyph(o.status);
      li.appendChild(glyph);

      const text = document.createElement('span');
      text.className = 'rl-obj__text';
      text.textContent = o.text;
      li.appendChild(text);

      const status = document.createElement('span');
      status.className = 'rl-obj__status';
      // I10's rule, unbroken here: the catalogue label, never `o.status`
      // (the sim's own enum) printed raw.
      status.textContent = objectiveStatusLabel(o.status);
      li.appendChild(status);

      if (o.ticksLeft !== undefined) {
        const clock = document.createElement('span');
        clock.className = 'rl-obj__clock';
        clock.textContent = clockText(o.ticksLeft);
        li.appendChild(clock);
      }

      // A primary is the mission, not a reward -- `rewardFor` already
      // returns null for one, but the primary case is checked here too so a
      // primary's row never even builds the (empty) span.
      if (!o.primary) {
        const reward = rewardFor({ primary: o.primary, carries: o.carries, paysCredits: deps.paysCredits });
        if (reward) {
          const rewardEl = document.createElement('span');
          rewardEl.className = 'rl-obj__reward';
          rewardEl.textContent = t(reward.key, reward.params);
          li.appendChild(rewardEl);
        }
      }

      list.appendChild(li);
    }
  };
  paint();

  host.appendChild(p.el);

  let disposed = false;
  return {
    el: p.el,
    refresh: paint,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      p.el.remove();
    },
  };
}
