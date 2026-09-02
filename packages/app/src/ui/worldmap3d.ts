/**
 * The campaign screen's 3D board: the Sahar Basin diorama, turning, with the
 * towns pinned to it and the regions clickable.
 *
 * ## Two boards, and why both stay
 *
 * `worldmap.ts` draws the flat PNG board and is unchanged. This is the
 * three.js one. Which a player gets is `campaignBoard()` below, and the
 * answer is the renderer they already chose -- **the flat board IS the Pixi
 * path.**
 *
 * Forcing three for this one screen was the alternative and it is worse than
 * it sounds: the renderer choice persists per ORIGIN
 * (`localStorage['lions.renderer']`, see `renderer-choice.ts`) and survives
 * every link `menu.ts` builds, so a player who deliberately typed
 * `?renderer=pixi` -- the escape hatch someone reaches for precisely when
 * three has failed them -- would have three loaded behind their back for a
 * menu, and be handed back to Pixi for the mission. The 3D board is additive
 * and three-only, exactly as mesh units are, and `?renderer=pixi` having no
 * mesh path is a permanent property of that backend rather than a gap.
 *
 * It falls back to the flat board for three more reasons besides Pixi: no
 * WebGL2 at all, a GLB that will not fetch or parse, and a scene graph that
 * does not carry the campaign contract (`world-scene.ts` throws by node
 * name). None of those should cost a player their campaign screen, and each
 * warns by name in the console rather than silently degrading.
 *
 * ## What is DOM and what is canvas, and why the split is where it is
 *
 * The ground is canvas. Every word is DOM. The town pins in particular are
 * real anchors positioned over the canvas from the projected marker
 * positions the view hands back each frame -- not sprites, not canvas text.
 * That is what keeps them crisp at any board orientation and keeps
 * middle-click, copy-link and keyboard focus behaving the way they do on the
 * flat board. A canvas cannot be tabbed into, and a campaign screen that can
 * only be operated with a mouse is a worse screen than a flat PNG.
 *
 * The same reasoning is why a locked region SAYS something. On the flat
 * board a locked country is simply not a link and the reason is in its card.
 * Here the ground is a single canvas with no per-region hit target the
 * browser knows about, so a click on locked ground would otherwise be
 * swallowed in silence -- indistinguishable from a broken screen. It writes
 * the region's own `lockedBecause` into a live region instead.
 *
 * ## The restated view type, and what actually checks it
 *
 * `MountWorldView` below restates `mountWorldView`'s signature rather than
 * importing it: eslint forbids any static import of `@lions/render/three
 * -campaign` from this package, type-only included, for the bundle reason in
 * that rule's own message. It is the same trade `mesh-catalogue.ts` makes
 * for `MeshFactionName` -- and, as there, the restatement is not merely
 * trusted. `loadView()` assigns the real `mountWorldView` INTO a
 * `MountWorldView`, so `tsc` compares the two shapes at that line and a
 * drifted restatement is a compile error rather than a runtime surprise.
 */
import type { LedgerData } from '@lions/sim';

import {
  nextMissionOf,
  regionProgress,
  townProgress,
  type ParsedWorld,
  type RegionStatus,
  type WorldRegion,
} from '../campaign';
import type { RendererChoice } from '../renderer-choice';
import { ledgerLine, regionCard } from './worldmap';

/** Which board the campaign screen draws. */
export type CampaignBoardKind = 'diorama' | 'flat';

/**
 * The board this player gets.
 *
 * One line, named and tested rather than inlined, because the failure it
 * prevents is the one the brief called out: a Pixi player looking at a blank
 * rectangle. The flat board is not a degraded mode here -- it is the Pixi
 * path, and it is the only campaign screen `?renderer=pixi` has ever had.
 */
export function campaignBoard(renderer: RendererChoice): CampaignBoardKind {
  return renderer === 'three' ? 'diorama' : 'flat';
}

/** Where one town marker landed on the canvas, in CSS pixels. */
export interface TownPin {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** The half of `@lions/render/three-campaign`'s `WorldView` this screen uses.
 *  See the file header for why it is restated and what checks it. */
export interface MountedView {
  nudge(deltaDegrees: number): void;
  reset(): void;
  dispose(): void;
}

export type MountWorldView = (
  host: HTMLElement,
  opts: {
    meshUrl: string;
    statuses: Readonly<Record<string, RegionStatus>>;
    clickable: ReadonlySet<string>;
    onPick: (regionId: string | null) => void;
    onFrame: (towns: readonly TownPin[], bearingDegrees: number) => void;
  }
) => Promise<MountedView>;

export interface World3dOptions {
  world: ParsedWorld;
  ledger: LedgerData;
  href: (missionId: string) => string;
  /** Resolved URL of the world GLB. Paths are `mesh-catalogue.ts`'s business;
   *  this screen takes the URL already resolved, the same way the renderer's
   *  own mesh loaders do. */
  meshUrl: string;
  /** The flat PNG board, built lazily -- it is only ever needed if the
   *  diorama cannot be drawn, and building it eagerly would mean every
   *  player parsing an SVG overlay they will not see. */
  fallback: () => HTMLElement;
  /** Test seams. `mount` defaults to the real dynamic import, `webgl` to a
   *  live context probe, `navigate` to a real navigation. */
  mount?: MountWorldView;
  webgl?: () => boolean;
  navigate?: (href: string) => void;
}

export interface World3dHandle {
  el: HTMLElement;
  /** Which board actually ended up on screen. Never rejects: every failure
   *  path lands on `'flat'`. */
  ready: Promise<CampaignBoardKind>;
}

/** How far one press of a rotate button turns the board. Matches the view's
 *  own `NUDGE_DEGREES`; restated for the same reason `MountWorldView` is,
 *  and harmless if it drifts -- the two are a button label and a rotation,
 *  not a contract. */
const NUDGE_DEGREES = 30;

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * Whether this browser can draw the board at all.
 *
 * Probed BEFORE the dynamic import, not after it fails: three.js is ~700 kB
 * and a browser with no WebGL2 will not draw a pixel of it. Cheap -- one
 * throwaway canvas -- and it is also what keeps this screen out of three in
 * a jsdom test run.
 */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

async function loadView(): Promise<MountWorldView> {
  const mod = await import('@lions/render/three-campaign');
  // This assignment is the type check. See the file header.
  const mount: MountWorldView = mod.mountWorldView;
  return mount;
}

/**
 * Build the 3D campaign board.
 *
 * Returns immediately with the overlay -- cards, ledger line, town pins,
 * rotate controls -- already in the DOM, and swaps the canvas (or the flat
 * board) in when the load settles. That order is deliberate: a rAF is
 * throttled to zero in a hidden tab, and everything a player can READ on
 * this screen is available without waiting for a 3.8 MiB download.
 */
export function worldMap3d(opts: World3dOptions): World3dHandle {
  const { world, ledger } = opts;
  const navigate = opts.navigate ?? ((href: string) => window.location.assign(href));
  const hasWebgl = opts.webgl ?? webglAvailable;

  const wrap = el('div', 'rl-world rl-world--3d');
  const stage = el('div', 'rl-world__stage');
  const host = el('div', 'rl-world__canvas');
  const pins = el('div', 'rl-world__pins');
  stage.append(host, pins);

  // --- state derived once, from the ledger --------------------------------
  const regionById = new Map(world.regions.map((r) => [r.id, r]));
  const statuses: Record<string, RegionStatus> = {};
  const clickable = new Set<string>();
  /** The first town, in authored order, still asking for a mission: what a
   *  click on the region's ground should start. Identical rule to the flat
   *  board's `nextMissionOfRegion`. */
  const nextOf = (region: WorldRegion): string | null => {
    for (const town of region.towns) {
      const next = nextMissionOf(town, ledger);
      if (next !== null) return next;
    }
    return null;
  };
  for (const region of world.regions) {
    const p = regionProgress(region, ledger);
    statuses[region.id] = p.status;
    if (p.status === 'live' && nextOf(region) !== null) clickable.add(region.id);
  }

  // --- the town pins ------------------------------------------------------
  const pinFor = new Map<string, HTMLElement>();
  for (const region of world.regions) {
    const p = regionProgress(region, ledger);
    for (const town of region.towns) {
      const next = nextMissionOf(town, ledger);
      const { done, total } = townProgress(town, ledger);
      const marker = el('div', 'rl-world__town');
      marker.dataset.town = town.id;
      // The TOWN's own state, not the region's -- the flat board's own
      // comment has the argument: a region can be live while most of its
      // towns have nothing authored, and stamping the region status on an
      // empty town is a false completion signal.
      marker.dataset.status =
        total > 0 && done === total ? 'done' : total === 0 ? 'empty' : p.status;
      // Nothing is placed until the board has drawn a frame. A pin at 0,0 in
      // the corner reads as a bug, so it is hidden until it has a position.
      marker.dataset.placed = '0';
      const label = `${town.name}${total > 0 ? ` ${done}/${total}` : ''}`;
      if (next !== null && p.status !== 'locked') {
        const a = document.createElement('a');
        a.className = 'rl-world__townlink';
        a.href = opts.href(next);
        a.textContent = label;
        marker.appendChild(a);
      } else {
        marker.appendChild(el('span', 'rl-world__townname', label));
      }
      pins.appendChild(marker);
      pinFor.set(town.id, marker);
    }
  }

  // --- the rotate controls ------------------------------------------------
  const spin = el('div', 'rl-world__spin');
  const bearing = document.createElement('button');
  bearing.type = 'button';
  bearing.className = 'rl-world__bearing';
  bearing.dataset.spin = 'north';
  bearing.title = 'face north again';
  bearing.textContent = '000°';
  const spinButton = (dir: 'ccw' | 'cw', glyph: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-world__spinbtn';
    b.dataset.spin = dir;
    b.title = title;
    b.textContent = glyph;
    return b;
  };
  const ccw = spinButton('ccw', '↺', `turn the board ${NUDGE_DEGREES}° left`);
  const cw = spinButton('cw', '↻', `turn the board ${NUDGE_DEGREES}° right`);
  spin.append(ccw, bearing, cw);
  stage.appendChild(spin);
  wrap.appendChild(stage);

  // --- the line that answers a click --------------------------------------
  const HINT = 'Drag the board to turn it. Click a front to open its next operation.';
  const say = el('p', 'rl-world__say', HINT);
  say.setAttribute('role', 'status');
  say.setAttribute('aria-live', 'polite');
  say.dataset.tone = 'hint';
  wrap.appendChild(say);

  // --- the cards, identical to the flat board's ---------------------------
  const cards = el('div', 'rl-world__cards');
  const cardFor = new Map<string, HTMLElement>();
  for (const region of world.regions) {
    const card = regionCard(region, { ledger });
    cards.appendChild(card);
    cardFor.set(region.id, card);
  }
  wrap.appendChild(cards);
  wrap.appendChild(ledgerLine(ledger));

  const speak = (text: string, tone: 'hint' | 'good' | 'bad' | 'info'): void => {
    say.textContent = text;
    say.dataset.tone = tone;
  };
  const point = (regionId: string | null): void => {
    for (const [id, card] of cardFor) {
      if (id === regionId) card.dataset.said = '1';
      else delete card.dataset.said;
    }
  };

  /**
   * What a click on the ground does.
   *
   * Every branch says something. Silence is the one outcome that is not
   * allowed: the canvas is a single element, so a click that resolved to
   * nothing and printed nothing is indistinguishable from a screen that does
   * not work.
   */
  const onPick = (regionId: string | null): void => {
    if (regionId === null) {
      point(null);
      speak(HINT, 'hint');
      return;
    }
    const region = regionById.get(regionId);
    if (!region) {
      // Ground the GLB carries and `world.json` does not. `textured-world
      // .test.ts` makes that unreachable on the shipped asset; it is handled
      // rather than assumed away because the alternative is a dead click.
      point(null);
      speak(`${regionId} — no campaign is authored for this ground`, 'info');
      return;
    }
    point(region.id);
    const p = regionProgress(region, ledger);
    if (p.status === 'locked') {
      speak(`${region.name} — ${p.lockedBecause ?? 'locked'}`, 'bad');
      return;
    }
    if (p.status === 'empty') {
      speak(`${region.name} — no operations authored yet`, 'info');
      return;
    }
    const next = nextOf(region);
    if (next === null) {
      speak(`${region.name} — cleared`, 'good');
      return;
    }
    speak(`${region.name} — opening ${next}`, 'good');
    navigate(opts.href(next));
  };

  const onFrame = (towns: readonly TownPin[], bearingDegrees: number): void => {
    for (const t of towns) {
      const pin = pinFor.get(t.id);
      if (!pin) continue;
      pin.style.left = `${t.x.toFixed(1)}px`;
      pin.style.top = `${t.y.toFixed(1)}px`;
      pin.dataset.placed = '1';
    }
    bearing.textContent = `${Math.round(bearingDegrees).toString().padStart(3, '0')}°`;
  };

  // --- swap in whichever board we can actually draw -----------------------
  const toFlat = (why: string, err?: unknown): CampaignBoardKind => {
    if (err !== undefined) console.warn(`campaign board: ${why}`, err);
    else console.warn(`campaign board: ${why}`);
    wrap.dataset.board = 'flat';
    stage.remove();
    say.remove();
    wrap.prepend(opts.fallback());
    return 'flat';
  };

  wrap.dataset.board = 'diorama';
  const ready: Promise<CampaignBoardKind> = (async () => {
    if (!hasWebgl()) {
      return toFlat('this browser has no WebGL2 — falling back to the flat map');
    }
    try {
      const mount = opts.mount ?? (await loadView());
      const view = await mount(host, {
        meshUrl: opts.meshUrl,
        statuses,
        clickable,
        onPick,
        onFrame,
      });
      ccw.addEventListener('click', () => view.nudge(-NUDGE_DEGREES));
      cw.addEventListener('click', () => view.nudge(NUDGE_DEGREES));
      bearing.addEventListener('click', () => view.reset());
      // The screen is torn down by `main.ts` replacing `#stage`'s contents,
      // which never tells anyone. A disconnect observer is what turns that
      // into a disposal, so the WebGL context and the 4096 texture do not
      // outlive the board.
      if (typeof MutationObserver !== 'undefined' && wrap.ownerDocument) {
        const watch = new MutationObserver(() => {
          if (!wrap.isConnected) {
            view.dispose();
            watch.disconnect();
          }
        });
        watch.observe(wrap.ownerDocument.body, { childList: true, subtree: true });
      }
      return 'diorama';
    } catch (err) {
      return toFlat('could not draw the Sahar Basin diorama', err);
    }
  })();

  return { el: wrap, ready };
}
