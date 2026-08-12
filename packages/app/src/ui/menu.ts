// Campaign menu and mission end screen. Pure navigation — no sim, no state.

import type { LedgerData } from '@lions/sim';
import type { ParsedWorld, WorldCountry } from '../campaign';
import { panel } from './panel';
import { stagger } from './motion';
import { wordmark } from './mark';
import { worldMap } from './worldmap';

export interface MenuOptions {
  /** Deploy base ('/' locally, '/<repo>/' on Pages). */
  base: string;
  version: string;
  world: ParsedWorld;
  /** Generated country geometry for the world render's overlay. */
  countries: readonly WorldCountry[];
  ledger: LedgerData;
  /** The tutorial is not on the map — it teaches the mouse, not the war. */
  tutorial: { id: string; name: string; done: boolean };
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
  theatre.textContent = opts.world.name;
  wrap.appendChild(theatre);

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
  if (!opts.tutorial.done) add(opts.tutorial.name, `?mission=${opts.tutorial.id}`, 'tutorial');
  wrap.appendChild(nav);

  wrap.appendChild(
    worldMap({
      base: opts.base,
      world: opts.world,
      countries: opts.countries,
      ledger: opts.ledger,
      href: (id) => `?mission=${id}`,
    })
  );

  const aside = document.createElement('nav');
  aside.className = 'rl-menu__nav';
  const addAside = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.className = 'rl-btn rl-menu__item';
    a.dataset.kind = 'aside';
    aside.appendChild(a);
  };
  addAside('M0 sandbox (no mission)', '?sandbox=1');
  addAside('reset campaign ledger', '?fresh=1');
  wrap.appendChild(aside);

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
