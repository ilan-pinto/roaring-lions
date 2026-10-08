// Campaign menu and mission end screen. Pure navigation — no sim, no state.

import type { LedgerData } from '@lions/sim';
// The picker enumerates the shipped maps from `@lions/data` itself rather than
// being handed a list. A list passed in is a list that can be passed WRONG --
// and the whole point of this screen is that adding a map to `data/maps/`
// makes it playable from the UI with no edit here. `terrain-parity.test.ts`
// takes `Object.keys(maps)` the same way, for the same reason.
import { maps, type MapJson } from '@lions/data';
import type { CommanderData, ParsedWorld, WorldCountry } from '../campaign';
import { t } from '../i18n/t';
import { symbolLabel } from './symbol';
import { CAMPAIGN_MESHES, dracoDecoderPath, meshUrl } from '../mesh-catalogue';
import { SANDBOX_FLAGS, type SandboxFlagName } from '../sandbox-help';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { confirmDialog } from './confirm';
import { stagger } from './motion';
import { wordmark } from './mark';
import { worldMap } from './worldmap';
import { worldMap3d } from './worldmap3d';
import { markConfirm } from './confirm-cue';

export interface MenuOptions {
  /** Deploy base ('/' locally, '/<repo>/' on Pages). */
  base: string;
  version: string;
  world: ParsedWorld;
  /** The tutorial is not on the map — it teaches the mouse, not the war. */
  tutorial: { id: string; name: string; done: boolean };
  /**
   * The mixer's mute, when the shell has one. The menu is where the music
   * first sounds, and a screen that plays music with no visible way to stop
   * it reads as a bug; the same toggle is `m` in a mission.
   */
  audio?: { isMuted(): boolean; toggle(): boolean };
  /**
   * Where the campaign is right now (Task 7, `continueTarget` in
   * `campaign.ts`), already resolved by the shell -- this screen has no
   * ledger of its own to compute it from. `kind: 'tutorial'` means nothing
   * has been played yet; `kind: 'next'` names the first open mission of
   * wherever the map is live. Absent once every authored mission is done,
   * which is when the first nav item reverts to a plain "Campaign" link.
   */
  continue?: { missionId: string; name: string; kind: 'tutorial' | 'next' };
  /** What "New campaign" does, confirmed first -- see `ui/confirm.ts`.
   *  Absent in tests that do not exercise the click; the shell purges the
   *  campaign ledger and the tutorial-done flag (the brigade account
   *  survives, on purpose) and re-mounts this screen. Replaces `reset`
   *  (Task 7) -- same button, new name and new confirm copy, since "reset
   *  campaign ledger" read like plumbing and said nothing about what it
   *  spared. */
  newCampaign?: () => void;
  /**
   * What stands behind the column -- the scene host (`ui/scene-host.ts`), in
   * the shell. Called once the column is in the stage, so the host can
   * measure it (spec §3.4's narrow test reads the column's box) and slot
   * itself under it; its disposer runs in this screen's own. Absent in tests
   * that do not exercise it, which is also the empty page the menu was
   * before the host existed.
   */
  backdrop?: (stage: HTMLElement, column: HTMLElement) => Disposer;
}

export interface CampaignOptions {
  base: string;
  world: ParsedWorld;
  /** Generated country geometry for the world render's overlay. */
  countries: readonly WorldCountry[];
  ledger: LedgerData;
  commander?: CommanderData;
  missionOf?: (id: string) => { objectives: readonly { type: string; primary: boolean }[]; name?: string } | undefined;
  /** Resolves a villain's bare portrait file name to a URL, threaded to both
   *  boards -- neither builds a `portraits/...` path itself. */
  portraitUrl?: (file: string) => string | undefined;
  /** Soft navigation for the 3D board's ground clicks, threaded down to
   *  `worldMap3d`. Absent means a real page load, which is that function's
   *  own default -- the flat board's town pins are anchors and go through the
   *  shell's link interception instead. */
  navigate?: (href: string) => void;
  /** The router's `req.signal` for this screen, aborted when it is left.
   *  Handed to the 3D board so a leave during its download makes no WebGL
   *  context (`worldmap3d.ts`, `World3dOptions.signal`). */
  signal?: AbortSignal;
}

export function showMenu(stage: HTMLElement, opts: MenuOptions): Disposer {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu';

  // No key-art banner at the top of the column any more (spec Q1's default):
  // with the world drawn BEHIND the column by `backdrop` (the scene host), a
  // second photograph of it inside the column would be the same picture twice.
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
    // Continue is the menu's one primary action (A8).
    if (kind === 'primary') markConfirm(a);
    nav.appendChild(a);
  };
  // The FIRST thing a commander's eye lands on (Task 7): where the campaign
  // is right now, resolved by the shell's `continueTarget`. "Start" while
  // nothing has been played, "Continue" once something has; absent once
  // every mission is done, and the old plain "Campaign" link (added below
  // regardless) is what a finished player sees first instead.
  if (opts.continue) {
    const label = t('menu.continue.label', { kind: opts.continue.kind, name: opts.continue.name });
    add(label, routes.mission(opts.continue.missionId), 'primary');
  }
  // Listed second until it is done, then demoted to the aside below rather
  // than removed. Taking it off the menu entirely made the tutorial
  // unreachable for good: the flag that hides it also suppresses the step
  // panel, so the only way back in was ?fresh=1, which pays for a replay with
  // the whole campaign ledger. Dropped here specifically when the item above
  // already names the tutorial ("Start — ...") -- otherwise the same mission
  // would sit in this list twice.
  if (!opts.tutorial.done && opts.continue?.kind !== 'tutorial') {
    add(opts.tutorial.name, routes.mission(opts.tutorial.id), 'tutorial');
  }
  // The war itself lives on its own page: the menu stays a landing, the map a
  // destination you can always come back to.
  add(t('menu.nav.campaign'), routes.campaign(), 'secondary');
  add(t('menu.nav.brigade'), routes.brigade(), 'secondary');
  wrap.appendChild(nav);

  const aside = document.createElement('nav');
  aside.className = 'rl-menu__nav rl-menu__nav--grid';
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
    addAside(t('menu.aside.replayTutorial'), routes.mission(opts.tutorial.id, { tutorial: true }));
  }
  // Was `?sandbox=1`, which is not a map id at all: it warned "unknown sandbox
  // map" and fell back to beit_sahwan_outskirts, so one of five shipped maps
  // and none of the four flags were reachable by anyone who used the menu.
  // Same defect as `&mesh`, which no menu link ever appended either.
  addAside(t('menu.aside.freePlay'), routes.freePlay());
  addAside(t('menu.aside.saves'), routes.saves());
  addAside(t('menu.aside.settings'), routes.settings());
  // A button, not a link: this one destroys the campaign, so it is confirmed
  // first rather than a plain navigation (task 6 -- `?fresh=1` used to be one
  // click away with nothing standing in front of it). Same `rl-btn
  // rl-menu__item[data-kind='aside']` look the audio toggle below already
  // wears as the list's one <button>. Renamed from "reset campaign ledger"
  // (Task 7): a save slot is now the real answer to "I want to keep this
  // run", so the button's only honest job left is starting a new one -- and
  // its label should say what happens, not what storage key it touches.
  const newCampaignBtn = document.createElement('button');
  newCampaignBtn.type = 'button';
  newCampaignBtn.className = 'rl-btn rl-menu__item';
  newCampaignBtn.dataset.kind = 'aside';
  newCampaignBtn.textContent = t('menu.newCampaign.button');
  newCampaignBtn.addEventListener('click', () => {
    void confirmDialog(stage, {
      title: t('menu.newCampaign.confirm.title'),
      // Not "brigade account and tutorial completion are erased" -- the
      // account deliberately SURVIVES this (main.ts, spec 2026-09-15 §4.1:
      // "a second campaign starts with the brigade you built"). A confirm
      // that names the wrong casualty is worse than one that names none.
      body: t('menu.newCampaign.confirm.body'),
      confirm: t('menu.newCampaign.confirm.action'),
      danger: true,
    }).answer.then((ok) => {
      if (ok) opts.newCampaign?.();
    });
  });
  aside.appendChild(newCampaignBtn);
  if (opts.audio) aside.appendChild(audioToggle(opts.audio));
  // Last, deliberately: people, libraries, fonts and the licence split are
  // the least urgent thing on this screen, not the most.
  addAside(t('menu.aside.credits'), routes.credits());
  wrap.appendChild(aside);

  // The menu introduces itself rather than simply existing.
  stagger(wrap);
  stage.appendChild(wrap);
  const disposeBackdrop = opts.backdrop?.(stage, wrap);
  return () => {
    disposeBackdrop?.();
    wrap.remove();
  };
}

/**
 * The music/sound toggle on the menu. A button, not a link: it is the one
 * item here that changes state instead of leaving the page, and clicking it
 * is also the gesture a first visit needs before the browser lets the theme
 * sound at all -- so "turn the music on" and "let it start" are one click.
 */
function audioToggle(audio: { isMuted(): boolean; toggle(): boolean }): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rl-btn rl-menu__item';
  b.dataset.kind = 'aside';
  b.title = t('menu.audio.hint');
  const paint = (): void => {
    const on = !audio.isMuted();
    // VR-15: a speaker, struck through when muted (the GH-261 bolt read as power).
    b.innerHTML = on ? symbolLabel('audioOn', t('menu.audio.on')) : symbolLabel('audioOff', t('menu.audio.off'));
    b.setAttribute('aria-pressed', String(on));
  };
  b.addEventListener('click', () => {
    audio.toggle();
    paint();
  });
  paint();
  return b;
}

/** The campaign map page: the world, its states, and a way back. Reached from the
 *  menu's Campaign entry, from every mission's return link, and from the end
 *  screen -- the map is the place the player can always come back to. */
export function showCampaign(stage: HTMLElement, opts: CampaignOptions): Disposer {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu';

  const wordmarkEl = (() => {
    const lockup = document.createElement('div');
    lockup.innerHTML = wordmark('');
    return lockup.firstElementChild as HTMLElement;
  })();

  const theatre = document.createElement('div');
  theatre.className = 'rl-menu__theatre';
  theatre.textContent = opts.world.name;

  // Which board: the Sahar Basin diorama, falling back to the flat PNG for
  // the three causes `worldmap3d.ts`'s header names (no WebGL2, a GLB that
  // will not load, a scene that fails the campaign contract) plus the one
  // decided here -- a world with no diorama GLB at all.
  const href = (id: string): string => routes.mission(id);
  const flat = (): HTMLElement =>
    worldMap({
      base: opts.base,
      world: opts.world,
      countries: opts.countries,
      ledger: opts.ledger,
      href,
      commander: opts.commander,
      missionOf: opts.missionOf,
      portraitUrl: opts.portraitUrl,
    });
  // A world with no GLB in the catalogue has no diorama to draw, and
  // `meshUrl` throws by name for a catalogue entry whose file is gone. Both
  // land on the flat board rather than on a broken screen -- there are
  // shipped worlds and there will be more, and only `sahar_basin` has been
  // built in 3D.
  const glb = CAMPAIGN_MESHES[opts.world.id];
  let boardUrl: string | null = null;
  if (glb !== undefined) {
    try {
      boardUrl = meshUrl(glb);
    } catch (err) {
      console.warn(`campaign board: ${opts.world.id} has no usable world mesh`, err);
    }
  }
  const boardEl: HTMLElement =
    boardUrl === null
      ? flat()
      : worldMap3d({
          world: opts.world,
          ledger: opts.ledger,
          href,
          meshUrl: boardUrl,
          // This screen constructs no `ThreeRenderer`, so nothing else can
          // hand it the decoder every shipped GLB now needs.
          dracoDecoderPath: dracoDecoderPath(),
          fallback: flat,
          commander: opts.commander,
          missionOf: opts.missionOf,
          portraitUrl: opts.portraitUrl,
          navigate: opts.navigate,
          signal: opts.signal,
        }).el;
  // The wordmark and theatre scroll away with the board rather than sitting
  // beside it: `.rl-menu:has(.rl-world)` (theme.css) is a two-row grid --
  // scrolling content, then a footer nav -- and `boardEl`, carrying
  // `rl-world__scroll` (worldmap3d.ts/worldmap.ts), has to be `.rl-menu`'s
  // ONLY other direct child for that grid to place the nav correctly, so
  // anything meant to scroll away with the board lives inside it. Nesting
  // them here keeps `worldMap`/`worldMap3d` themselves unaware of this
  // screen's layout.
  boardEl.prepend(wordmarkEl, theatre);
  wrap.appendChild(boardEl);

  const nav = document.createElement('nav');
  nav.className = 'rl-menu__nav';
  const back = document.createElement('a');
  back.innerHTML = symbolLabel('back', t('nav.backToMenu'));
  back.href = routes.menu();
  back.className = 'rl-btn';
  back.dataset.kind = 'back';
  nav.appendChild(back);
  wrap.appendChild(nav);

  stagger(wrap);
  stage.appendChild(wrap);
  return () => wrap.remove();
}

/** The sandbox picker: which map, and which of the opt-in extras.
 *
 *  Reached from the menu's sandbox entry. Same shape as `showCampaign` above --
 *  a second screen inside the same `.rl-menu` frame with a back link home.
 *
 *  Neither list is written here. The maps are `@lions/data`'s own enumeration
 *  and the flags are `SANDBOX_FLAGS`, which is also what `main.ts` parses,
 *  what the boot banner prints, and what `unknownParams` checks against. A
 *  copy of either list in this file could drift from the thing that actually
 *  runs, and the screen would then offer a map that does not load or a flag
 *  that does nothing -- which is exactly the silence this whole subsystem was
 *  built to remove. The URL is built by `routes.sandbox` (`shell/links.ts`),
 *  which iterates that same `SANDBOX_FLAGS` table.
 *
 *  The map entries stay real anchors with real hrefs, rewritten as the flag
 *  boxes change, so middle-click, copy-link and the browser's own history all
 *  behave. Titled "Free play" for a player: it is the same picker the dev
 *  banner and this file's own history call the sandbox, but nothing on the
 *  card should read like an internal name -- a map is shown by its human
 *  name alone, an opt-in extra by a player's sentence alone, and neither the map id
 *  nor the free-play URL it builds prints anywhere on the screen (the flag
 *  name is still on the label's `title`, for the curious who hover it). */
export function showSandbox(stage: HTMLElement): Disposer {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu';

  const lockup = document.createElement('div');
  lockup.innerHTML = wordmark('');
  wrap.appendChild(lockup.firstElementChild as HTMLElement);

  const theatre = document.createElement('div');
  theatre.className = 'rl-menu__theatre';
  theatre.textContent = t('menu.sandbox.title');
  wrap.appendChild(theatre);

  // --- the extras ---------------------------------------------------------
  // Behind a closed "Developer options" disclosure (WP-P2, PA-25): these are
  // test set-ups for the battlefield, not part of the mode a player came
  // for, so the picker opens on the maps alone. Each option reads in a
  // player's words through the catalogue (`freePlay.option.<flag>`); the
  // console banner keeps `SANDBOX_FLAGS`' own dev blurbs.
  const dev = document.createElement('details');
  dev.className = 'rl-sandbox__dev';
  const devSummary = document.createElement('summary');
  devSummary.className = 'rl-sandbox__dev-summary';
  devSummary.textContent = t('menu.sandbox.devOptions');
  dev.appendChild(devSummary);
  const flagBox = document.createElement('div');
  flagBox.className = 'rl-sandbox__flags';
  const devHint = document.createElement('p');
  devHint.className = 'rl-sandbox__dev-hint';
  devHint.textContent = t('menu.sandbox.devOptions.hint');
  flagBox.appendChild(devHint);
  const boxes: { name: SandboxFlagName; input: HTMLInputElement }[] = [];
  for (const f of SANDBOX_FLAGS) {
    const label = document.createElement('label');
    label.className = 'rl-sandbox__flag';
    // The flag's own name, e.g. "&roe" -- not read aloud on the card, but on
    // the label's title for whoever hovers it and wants the URL syntax.
    label.title = /* i18n-ok: dev tool */ `&${f.name}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.flag = f.name;
    // A player's sentence from the catalogue, not `SANDBOX_FLAGS`' own blurb:
    // that one is console text for a developer ("a synthesised 4×4", "the
    // kit sign ... to walk") and read as a dev build on this screen (PA-01).
    const blurb = document.createElement('span');
    blurb.className = 'rl-sandbox__blurb';
    blurb.textContent = t(`freePlay.option.${f.name}`);
    label.append(input, blurb);
    flagBox.appendChild(label);
    boxes.push({ name: f.name, input });
  }
  dev.appendChild(flagBox);
  wrap.appendChild(dev);

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
    // The name alone -- no id alongside it. The route carries the id and the
    // boot banner still lists it for a dev reading the console, but a player
    // clicking this card has no use for it and it read as leaked plumbing.
    a.textContent = catalogue[id].name;
    nav.appendChild(a);
    links.push({ id, a });
  }
  wrap.appendChild(nav);

  const refresh = (): void => {
    const on: Partial<Record<SandboxFlagName, boolean>> = {};
    for (const b of boxes) on[b.name] = b.input.checked;
    for (const l of links) l.a.href = routes.sandbox(l.id, on);
  };
  for (const b of boxes) b.input.addEventListener('change', refresh);
  refresh();

  const backNav = document.createElement('nav');
  backNav.className = 'rl-menu__nav';
  const back = document.createElement('a');
  back.innerHTML = symbolLabel('back', t('nav.backToMenu'));
  back.href = routes.menu();
  back.className = 'rl-btn';
  back.dataset.kind = 'back';
  backNav.appendChild(back);
  wrap.appendChild(backNav);

  stagger(wrap);
  stage.appendChild(wrap);
  return () => wrap.remove();
}

