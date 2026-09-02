// Campaign menu and mission end screen. Pure navigation — no sim, no state.

import type { LedgerData } from '@lions/sim';
// The picker enumerates the shipped maps from `@lions/data` itself rather than
// being handed a list. A list passed in is a list that can be passed WRONG --
// and the whole point of this screen is that adding a map to `data/maps/`
// makes it playable from the UI with no edit here. `terrain-parity.test.ts`
// takes `Object.keys(maps)` the same way, for the same reason.
import { maps, type MapJson } from '@lions/data';
import type { ParsedWorld, WorldCountry } from '../campaign';
import { SANDBOX_FLAGS, sandboxUrl, type SandboxFlagName } from '../sandbox-help';
import { panel } from './panel';
import { stagger } from './motion';
import { wordmark } from './mark';
import { worldMap } from './worldmap';

export interface MenuOptions {
  /** Deploy base ('/' locally, '/<repo>/' on Pages). */
  base: string;
  version: string;
  world: ParsedWorld;
  /** The tutorial is not on the map — it teaches the mouse, not the war. */
  tutorial: { id: string; name: string; done: boolean };
}

export interface CampaignOptions {
  base: string;
  world: ParsedWorld;
  /** Generated country geometry for the world render's overlay. */
  countries: readonly WorldCountry[];
  ledger: LedgerData;
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
  // Listed first until it is done, then demoted to the aside below rather than
  // removed. Taking it off the menu entirely made the tutorial unreachable for
  // good: the flag that hides it also suppresses the step panel, so the only
  // way back in was ?fresh=1, which pays for a replay with the whole campaign
  // ledger.
  if (!opts.tutorial.done) add(opts.tutorial.name, `?mission=${opts.tutorial.id}`, 'tutorial');
  // The war itself lives on its own page: the menu stays a landing, the map a
  // destination you can always come back to.
  add('Campaign', '?campaign', 'campaign');
  wrap.appendChild(nav);

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
  // `tutorial=1` asks for the lesson explicitly. Without it a finished player
  // replaying this mission gets it as a plain fight, which is the right default
  // when they reach it from the campaign — the flag should stop the tutorial
  // being pushed at them, not stop them asking for it.
  if (opts.tutorial.done) {
    addAside('replay the tutorial', `?mission=${opts.tutorial.id}&tutorial=1`);
  }
  // Was `?sandbox=1`, which is not a map id at all: it warned "unknown sandbox
  // map" and fell back to beit_sahwan_outskirts, so one of five shipped maps
  // and none of the four flags were reachable by anyone who used the menu.
  // Same defect as `&mesh`, which no menu link ever appended either.
  addAside('sandbox — pick a map', '?sandboxes');
  addAside('reset campaign ledger', '?fresh=1');
  wrap.appendChild(aside);

  // The menu introduces itself rather than simply existing.
  stagger(wrap);
  stage.appendChild(wrap);
}

/** The campaign map page: the world, its states, and a way back. Reached from the
 *  menu's Campaign entry, from every mission's return link, and from the end
 *  screen -- the map is the place the player can always come back to. */
export function showCampaign(stage: HTMLElement, opts: CampaignOptions): void {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu';

  const lockup = document.createElement('div');
  lockup.innerHTML = wordmark('');
  wrap.appendChild(lockup.firstElementChild as HTMLElement);

  const theatre = document.createElement('div');
  theatre.className = 'rl-menu__theatre';
  theatre.textContent = opts.world.name;
  wrap.appendChild(theatre);

  wrap.appendChild(
    worldMap({
      base: opts.base,
      world: opts.world,
      countries: opts.countries,
      ledger: opts.ledger,
      href: (id) => `?mission=${id}`,
    })
  );

  const nav = document.createElement('nav');
  nav.className = 'rl-menu__nav';
  const back = document.createElement('a');
  back.textContent = '← main menu';
  back.href = '?';
  back.className = 'rl-btn rl-menu__item';
  back.dataset.kind = 'back';
  nav.appendChild(back);
  wrap.appendChild(nav);

  stagger(wrap);
  stage.appendChild(wrap);
}

/** The sandbox picker: which map, and which of the opt-in extras.
 *
 *  Reached from the menu's sandbox entry. Same shape as `showCampaign` above --
 *  a second screen inside the same `.rl-menu` frame with a back link home.
 *
 *  Neither list is written here. The maps are `@lions/data`'s own enumeration
 *  and the flags are `SANDBOX_FLAGS`, which is also what `main.ts` parses,
 *  what the boot banner prints, and what `unknownParams` checks against; the
 *  URL itself is built by `sandboxUrl` from that same table. A copy of either
 *  list in this file could drift from the thing that actually runs, and the
 *  screen would then offer a map that does not load or a flag that does
 *  nothing -- which is exactly the silence this whole subsystem was built to
 *  remove.
 *
 *  The map entries stay real anchors with real hrefs, rewritten as the flag
 *  boxes change, so middle-click, copy-link and the browser's own history all
 *  behave. The URL is also shown: the picker is a dev instrument, and a dev
 *  who can see the URL it built can type the next one themselves. */
export function showSandbox(stage: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu';

  const lockup = document.createElement('div');
  lockup.innerHTML = wordmark('');
  wrap.appendChild(lockup.firstElementChild as HTMLElement);

  const theatre = document.createElement('div');
  theatre.className = 'rl-menu__theatre';
  theatre.textContent = 'Sandbox — no mission';
  wrap.appendChild(theatre);

  // --- the extras ---------------------------------------------------------
  const flagBox = document.createElement('div');
  flagBox.className = 'rl-sandbox__flags';
  const boxes: { name: SandboxFlagName; input: HTMLInputElement }[] = [];
  for (const f of SANDBOX_FLAGS) {
    const label = document.createElement('label');
    label.className = 'rl-sandbox__flag';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.flag = f.name;
    const name = document.createElement('b');
    name.textContent = `&${f.name}`;
    // The table's own blurb, not new prose: one description of a flag, in the
    // banner and on this screen alike.
    const blurb = document.createElement('span');
    blurb.className = 'rl-sandbox__blurb';
    blurb.textContent = f.blurb;
    label.append(input, name, blurb);
    flagBox.appendChild(label);
    boxes.push({ name: f.name, input });
  }
  wrap.appendChild(flagBox);

  const readout = document.createElement('div');
  readout.className = 'rl-sandbox__url';
  wrap.appendChild(readout);

  // --- the maps -----------------------------------------------------------
  const nav = document.createElement('nav');
  nav.className = 'rl-menu__nav';
  const catalogue = maps as Record<string, MapJson>;
  const links: { id: string; a: HTMLAnchorElement }[] = [];
  for (const id of Object.keys(catalogue)) {
    const a = document.createElement('a');
    a.className = 'rl-btn rl-menu__item';
    a.dataset.kind = 'sandbox';
    a.dataset.map = id;
    const title = document.createElement('span');
    title.textContent = catalogue[id].name;
    // The id as well as the name: it is what `?sandbox=` takes and what the
    // boot banner lists, so seeing the two together is how the URL stops
    // being a thing you have to look up.
    const slug = document.createElement('span');
    slug.className = 'rl-sandbox__mapid';
    slug.textContent = id;
    a.append(title, slug);
    nav.appendChild(a);
    links.push({ id, a });
  }
  wrap.appendChild(nav);

  const refresh = (): void => {
    const on: Partial<Record<SandboxFlagName, boolean>> = {};
    for (const b of boxes) on[b.name] = b.input.checked;
    for (const l of links) l.a.href = sandboxUrl(l.id, on);
    // MAP_ID rather than <map>: the readout is built by the same `sandboxUrl`
    // the links are, so whatever stands in for the id is percent-encoded like
    // a real one -- and `<map>` comes back as `%3Cmap%3E`. Underscores and
    // capitals are unreserved and pass through as themselves.
    readout.textContent = sandboxUrl('MAP_ID', on);
  };
  for (const b of boxes) b.input.addEventListener('change', refresh);
  refresh();

  const backNav = document.createElement('nav');
  backNav.className = 'rl-menu__nav';
  const back = document.createElement('a');
  back.textContent = '← main menu';
  back.href = '?';
  back.className = 'rl-btn rl-menu__item';
  back.dataset.kind = 'back';
  backNav.appendChild(back);
  wrap.appendChild(backNav);

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
  link('campaign map', '?campaign');
  link('menu', '?');
  p.body.appendChild(nav);

  host.appendChild(p.el);
}
