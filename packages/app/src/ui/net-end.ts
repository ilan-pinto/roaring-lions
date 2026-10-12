// The match-over panel (N1b task 10): Victory, Defeat or Draw from THIS
// seat's side, the reason, and two ways out -- "Play again" to `/versus` and
// "Main menu". Framed by `end-panel.ts` like the after-action report (centred,
// the action row in a foot, focus on the primary, a held Enter ignored).
//
// It writes nothing: no ledger, no account, no credits, no save. A friend
// match is not a campaign mission and pays nothing (spec §2.3); the test
// beside this file spies on storage to hold that.

import { t } from '../i18n/t';
import type { MatchResult } from '../net/outcome';
import type { Disposer } from '../shell/router';
import { mountEndPanel } from './end-panel';
import { focusTrap } from './focus-trap';
import { screenFoot } from './foot';
import { panel } from './panel';
import { symbolLabel } from './symbol';

export interface NetEndDeps {
  again(): void;
  menu(): void;
}

/** Won, lost or drawn, as `viewer` sees `o`. */
function verdictOf(o: MatchResult, viewer: 0 | 1): 'won' | 'lost' | 'draw' {
  if (o.kind === 'draw') return 'draw';
  return o.side === viewer ? 'won' : 'lost';
}

/** Mounts the panel on `host`; the disposer removes it and releases its focus trap. */
export function showNetEnd(host: HTMLElement, o: MatchResult, viewer: 0 | 1, deps: NetEndDeps): Disposer {
  const verdict = verdictOf(o, viewer);
  const p = panel({ rank: 'mission', title: t('versus.end.title', { verdict }), mark: true });
  p.el.classList.add('rl-net-end');
  p.el.dataset.result = verdict;

  const reason = document.createElement('p');
  reason.className = 'rl-net-end__reason';
  // The loser reads its own side of the same reason: "Your force is destroyed".
  reason.textContent = t(verdict === 'lost' ? 'versus.end.reason.lost' : 'versus.end.reason', { by: o.by });
  p.body.appendChild(reason);

  const foot = screenFoot();
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'rl-btn';
  menu.dataset.act = 'menu';
  menu.dataset.kind = 'back';
  menu.innerHTML = symbolLabel('back', t('nav.menu'));
  menu.addEventListener('click', () => deps.menu());
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'rl-btn';
  again.dataset.act = 'again';
  again.textContent = t('versus.end.again');
  again.addEventListener('click', () => deps.again());
  foot.start.append(menu);
  foot.end.append(again);

  mountEndPanel(host, p, foot.el, again);
  const releaseTrap = focusTrap(p.el);
  return () => {
    releaseTrap();
    p.el.remove();
  };
}
