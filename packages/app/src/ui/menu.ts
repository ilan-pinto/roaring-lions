// Campaign menu and mission end screen. Pure navigation — no sim, no state.

import { panel } from './panel';
import { stagger } from './motion';
import { wordmark } from './mark';

export interface MissionEntry {
  id: string;
  name: string;
}

export interface MenuOptions {
  /** Deploy base ('/' locally, '/<repo>/' on Pages). */
  base: string;
  version: string;
  missions: MissionEntry[];
  /** One-line campaign state — roster size, cumulative ROE. */
  campaign: string;
}

export function showMenu(stage: HTMLElement, opts: MenuOptions): void {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu';

  const banner = document.createElement('img');
  // Width-constrained rather than fixed, so the panel stays usable on a narrow
  // window; the intrinsic ratio is declared so the layout does not jump once
  // the image loads.
  banner.src = `${opts.base}ui/menu_banner.jpg`;
  banner.alt = '';
  banner.width = 800;
  banner.height = 339;
  banner.className = 'rl-menu__banner';
  wrap.appendChild(banner);

  const lockup = document.createElement('div');
  lockup.innerHTML = wordmark(opts.version);
  wrap.appendChild(lockup.firstElementChild as HTMLElement);

  const theatre = document.createElement('div');
  theatre.className = 'rl-menu__theatre';
  theatre.textContent = 'Beit Sahwan — M1';
  wrap.appendChild(theatre);

  const campaign = document.createElement('div');
  campaign.className = 'rl-menu__campaign rl-info';
  campaign.textContent = opts.campaign;
  wrap.appendChild(campaign);

  const nav = document.createElement('nav');
  nav.className = 'rl-menu__nav';
  const add = (label: string, href: string, kind = ''): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.className = 'rl-btn rl-menu__item';
    if (kind) a.dataset.kind = kind;
    nav.appendChild(a);
  };
  for (const m of opts.missions) add(m.name, `?mission=${m.id}`);
  add('M0 sandbox (no mission)', '?sandbox=1', 'aside');
  add('reset campaign ledger', '?fresh=1', 'aside');
  wrap.appendChild(nav);

  // The menu introduces itself rather than simply existing.
  stagger(wrap);
  stage.appendChild(wrap);
}

export interface EndScreenOptions {
  result: 'victory' | 'defeat';
  roe: number;
  survivors: number;
  missionId: string;
  /** Next mission in campaign order, if this one was won and one follows. */
  nextMissionId?: string;
}

export function showEndScreen(host: HTMLElement, opts: EndScreenOptions): void {
  const won = opts.result === 'victory';
  const p = panel({
    rank: 'alert',
    title: won ? 'Town is quiet' : 'Withdraw and regroup',
    tag: won ? 'Victory' : 'Defeat',
    place: 'top:62%;left:50%;transform:translateX(-50%);width:min(420px,90vw);text-align:center',
  });
  p.el.classList.add('rl-enter');

  const summary = document.createElement('div');
  summary.className = 'rl-dim';
  summary.textContent = `ROE ${opts.roe} · ${opts.survivors} unit(s) walking out`;
  p.body.appendChild(summary);

  const nav = document.createElement('div');
  nav.className = 'rl-endnav';
  const link = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.className = 'rl-btn';
    nav.appendChild(a);
  };
  if (won && opts.nextMissionId) link('next mission →', `?mission=${opts.nextMissionId}`);
  link(won ? 'replay' : 'try again', `?mission=${opts.missionId}`);
  link('menu', '?');
  p.body.appendChild(nav);

  host.appendChild(p.el);
}
