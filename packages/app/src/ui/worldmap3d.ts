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

import { t } from '../i18n/t';
import {
  nextMissionOf,
  regionProgress,
  townProgress,
  townStars,
  type CommanderData,
  type ParsedWorld,
  type RegionStatus,
  type WorldRegion,
} from '../campaign';
import { nudgeLabels, type LabelBox } from './label-layout';
import type { RendererChoice } from '../renderer-choice';
import { ledgerLine, regionCard } from './worldmap';
import { hoverLine, pickOutcome, type PinStatus } from './pin-hover';

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
  /** The region under the cursor right now -- the same id a click there
   *  would resolve through `onPick`, or `null` off the ground entirely.
   *  Read from `onFrame` (below) to preview it, never polled on its own:
   *  the ground is one canvas with no per-region DOM node of its own, so
   *  this is the only thing that knows what a hover is currently over. */
  readonly hovered: string | null;
}

export type MountWorldView = (
  host: HTMLElement,
  opts: {
    meshUrl: string;
    dracoDecoderPath?: string;
    statuses: Readonly<Record<string, RegionStatus>>;
    clickable: ReadonlySet<string>;
    onPick: (regionId: string | null) => void;
    onFrame: (towns: readonly TownPin[], bearingDegrees: number) => void;
    signal?: AbortSignal;
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
  /** Where the Draco decoder is fetched from -- `${BASE}draco/`. Every
   *  shipped GLB is Draco-compressed, and this screen does NOT construct a
   *  `ThreeRenderer`, so it is the only thing that can hand the decoder path
   *  to `@lions/render/three-campaign`. Omitting it fell back to the flat
   *  board with the reason only in the console -- the regression this field
   *  exists to make unrepresentable. */
  dracoDecoderPath: string;
  /** The flat PNG board, built lazily -- it is only ever needed if the
   *  diorama cannot be drawn, and building it eagerly would mean every
   *  player parsing an SVG overlay they will not see. */
  fallback: () => HTMLElement;
  commander?: CommanderData;
  missionOf?: (id: string) => { objectives: readonly { type: string; primary: boolean }[]; name?: string } | undefined;
  /** Resolves a villain's bare portrait file name to a URL, same as the flat
   *  board's `WorldMapOptions.portraitUrl` -- both boards get it from
   *  `main.ts`, never build a `portraits/...` path themselves. */
  portraitUrl?: (file: string) => string | undefined;
  /** `mount` defaults to the real dynamic import and `webgl` to a live
   *  context probe -- both are test seams. `navigate` is not: the shell
   *  passes the router's own soft navigation through `CampaignOptions`, and
   *  the default below is the hard one, for a caller with no router (a test,
   *  and any future host that mounts this board on its own). */
  mount?: MountWorldView;
  webgl?: () => boolean;
  navigate?: (href: string) => void;
  /**
   * Aborted when this screen is left -- the router's own `req.signal`, handed
   * through `showCampaign`. Passed to the view, which checks it after the GLB
   * arrives and before it makes a WebGL context, so leaving while the
   * diorama downloads costs no context at all. Optional: without it the
   * `isConnected` check after the mount still disposes a view that finished
   * mounting into a board already left.
   */
  signal?: AbortSignal;
}

export interface World3dHandle {
  el: HTMLElement;
  /** Which board actually ended up on screen. Never rejects: every failure
   *  path lands on `'flat'`. A board left before its view mounted resolves
   *  `'diorama'` -- the board this player gets -- with nothing on screen,
   *  because the screen is gone. */
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
 *
 * The probe's context is LOST before returning, as `atlas.ts`'s
 * `queryArrayLayerLimit` does with its own: otherwise it holds one of the
 * browser's ~16 context slots until the canvas is garbage-collected, and it
 * was measured still alive 7 s after a visit to this screen.
 */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
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
  // A gate's `afterMission` sentence names the mission rather than its id --
  // the same catalogue lookup the flat board's `worldMap` uses.
  const missionName = (id: string): string | undefined => opts.missionOf?.(id)?.name;

  // `rl-world__scroll`: the stable hook `.rl-menu:has(.rl-world)` (theme.css)
  // scrolls -- this element is the campaign screen's ONLY scrolling region,
  // with the back nav pinned outside it as a real footer row rather than an
  // overlay (fix round 1). `showCampaign` (menu.ts) nests the wordmark and
  // theatre label inside this same element for that reason, not in here.
  const wrap = el('div', 'rl-world rl-world--3d rl-world__scroll');
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
    const p = regionProgress(region, ledger, missionName);
    statuses[region.id] = p.status;
    if (p.status === 'live' && nextOf(region) !== null) clickable.add(region.id);
  }

  // --- the line that answers a click (built here; appended to `wrap` below,
  // in its original visual position, once the stage and rotate controls are
  // in the DOM) -- declared before the town pins so their hover listeners
  // can call `speak` directly rather than through a forward reference.
  const HINT = t('world3d.hint');
  const say = el('p', 'rl-world__say', HINT);
  say.setAttribute('role', 'status');
  say.setAttribute('aria-live', 'polite');
  say.dataset.tone = 'hint';
  const speak = (text: string, tone: 'hint' | 'good' | 'bad' | 'info'): void => {
    say.textContent = text;
    say.dataset.tone = tone;
  };

  // --- the ground's own preview: what a click at the cursor would say -----
  // Read from `view.hovered` (below) inside `onFrame`, the only place this
  // screen learns what is currently under the cursor -- the ground is one
  // canvas with no per-region DOM node of its own. Debounced to CHANGES
  // only: `onFrame` runs every animation frame, and rewriting an
  // `aria-live` region sixty times a second would make a screen reader
  // unusable. The debounce is also what keeps a just-committed click
  // sentence from being overwritten one frame later by a hover preview of
  // the same, unchanged, region.
  //
  // Declared here, before the town pins, for the same reason `speak` is
  // (see its own comment above): `enterPin` and `leavePin` below are called
  // from the pins' own handlers and share this state, and a forward
  // reference across the whole loop is worse than moving this block up.
  let lastGroundHover: string | null = null;
  const previewGround = (regionId: string | null): void => {
    if (regionId === null) {
      speak(HINT, 'hint');
      return;
    }
    const region = regionById.get(regionId);
    if (!region) {
      speak(t('world3d.hover.unmapped', { id: regionId }), 'info');
      return;
    }
    const p = regionProgress(region, ledger, missionName);
    const next = nextOf(region);
    const line = hoverLine({
      status: p.status,
      regionName: region.name,
      lockedBecause: p.lockedBecause ?? undefined,
      nextMissionName: next !== null ? (missionName(next) ?? region.name) : undefined,
    });
    speak(t(line.key, line.params), line.tone);
  };

  // Assigned once `mount()` resolves, far below -- declared here (rather
  // than beside that assignment) so the pin-ownership code below can read
  // it with no forward reference. `onFrame` is only ever CALLED by the
  // mounted view itself, always after that assignment has happened, so
  // this is never read `null` in practice there; it starts `null` rather
  // than asserted non-null because nothing here can prove that to the
  // compiler ahead of time.
  let mountedView: MountedView | null = null;

  // --- who owns the line: the ground, or a pin -----------------------------
  // A realistic mouse move onto a pin crosses bare board first, so ground
  // hover has already spoken by the time the cursor reaches it. A pin's own
  // `mouseenter` speaks its sentence (below), but the DOM pin overlay is
  // then topmost, so the very next `onFrame` sees the canvas's own hit test
  // read `null` -- a CHANGE from whatever region ground hover last spoke --
  // and the debounce above used to treat that as real and re-speak the hint
  // over the pin's sentence, ~25ms later in a real browser (found driving a
  // real mouse, 2026-09-24). Keyboard focus never showed it: it does not
  // touch `onFrame` at all.
  //
  // An ORDERED LIST of the markers currently owning the line, not a bare
  // counter: a mouse hover and a keyboard focus can land on two different
  // pins (or the same one) at once, each with its own enter/leave pair, and
  // when one lets go while the other still holds the line, the line must
  // show the REMAINING owner's sentence, not fall through to the ground.
  // Duplicates are allowed on purpose (the same marker entered twice, once
  // per input kind) and `leavePin` below removes one occurrence per leave.
  const pinOwners: HTMLElement[] = [];
  /** Every pin's own preview, keyed by its marker -- populated in the loop
   *  below as each pin's `previewThisPin` is built, so `leavePin` can
   *  re-assert whichever pin is still on top of `pinOwners` after one lets
   *  go, without a second copy of the hover-line logic. */
  const previewFor = new Map<HTMLElement, () => void>();

  // Set instead of read-and-speak: see `onFrame`'s own comment on why a
  // pin's leave handler must never read `mountedView.hovered` synchronously.
  // The short version -- `world-view.ts`'s canvas `pointerleave` zeroes
  // `hovered` to `null` the INSTANT the pin overlay becomes topmost
  // (entering the pin), and the canvas's own hit test is only recomputed
  // inside the next animation-frame tick, gated on a `pointermove` the
  // canvas has not had yet at the moment a marker's `mouseleave` fires. A
  // synchronous read here would therefore show a live region under the
  // cursor as bare ground for one frame, every time a pin is left onto one
  // -- the same bug class this file exists to guard against, one frame
  // long. Setting this flag instead defers the read to the NEXT `onFrame`,
  // by which point the view's own hover has had its chance to catch up.
  let forceGroundSpeak = false;

  const enterPin = (marker: HTMLElement): void => {
    pinOwners.push(marker);
  };
  /** The mirror of `enterPin`. If another pin (or the same one, via the
   *  other input kind) still owns the line afterward, re-speaks ITS
   *  sentence -- rather than leaving the line showing the pin that just
   *  left, now stale; otherwise hands the line back to the ground on the
   *  next frame. */
  const leavePin = (marker: HTMLElement): void => {
    const idx = pinOwners.lastIndexOf(marker);
    if (idx !== -1) pinOwners.splice(idx, 1);
    const stillOwns = pinOwners[pinOwners.length - 1];
    if (stillOwns !== undefined) {
      previewFor.get(stillOwns)?.();
    } else {
      forceGroundSpeak = true;
    }
  };

  // --- the town pins ------------------------------------------------------
  const pinFor = new Map<string, HTMLElement>();
  for (const region of world.regions) {
    const p = regionProgress(region, ledger, missionName);
    for (const town of region.towns) {
      const next = nextMissionOf(town, ledger);
      const { done, total } = townProgress(town, ledger);
      const marker = el('div', 'rl-world__town');
      marker.dataset.town = town.id;
      // The TOWN's own state, not the region's -- the flat board's own
      // comment has the argument: a region can be live while most of its
      // towns have nothing authored, and stamping the region status on an
      // empty town is a false completion signal.
      const pinStatus: PinStatus =
        total > 0 && done === total ? 'done' : total === 0 ? 'empty' : p.status;
      marker.dataset.status = pinStatus;
      // Nothing is placed until the board has drawn a frame. A pin at 0,0 in
      // the corner reads as a bug, so it is hidden until it has a position.
      marker.dataset.placed = '0';
      const stars = townStars(town, ledger);
      const label = `${town.name}${total > 0 ? ` ${done}/${total}` : ''}`;
      if (next !== null && p.status !== 'locked') {
        const a = document.createElement('a');
        a.className = 'rl-world__townlink';
        a.href = opts.href(next);
        a.textContent = label;
        marker.appendChild(a);
      } else {
        // No link -- but its hover preview is still worth having: a locked
        // pin's own reason is the single most useful preview on this screen.
        // `tabindex` is what lets a real Tab reach it at all, since a plain
        // <span> is not otherwise focusable (spec §6 Phase 4: no hover-only
        // affordance without a keyboard path).
        const name = el('span', 'rl-world__townname', label);
        name.tabIndex = 0;
        marker.appendChild(name);
      }
      if (stars.possible > 0) {
        marker.appendChild(el('span', 'rl-world__stars', ` ${stars.earned}/${stars.possible}★`));
      }

      // --- hover/focus preview: what THIS pin's own link would say -----
      // Never `point()`, never `navigate()` -- the `opening` outcome
      // navigates on click, and a hover that navigated would make the board
      // unusable. Gated on "the pin exists", broader than the `<a>` above:
      // a locked or empty pin has no link and the most useful preview of
      // all. `mouseenter`/`mouseleave`/`focusin`/`focusout` is the flat
      // board's own four-listener pattern (`worldmap.ts`), so a keyboard
      // Tab previews exactly what a mouse hover does.
      const previewThisPin = (): void => {
        const line = hoverLine({
          status: pinStatus,
          regionName: town.name,
          lockedBecause: p.lockedBecause ?? undefined,
          nextMissionName: next !== null ? (missionName(next) ?? town.name) : undefined,
        });
        speak(t(line.key, line.params), line.tone);
      };
      previewFor.set(marker, previewThisPin);
      const leaveThisPin = (): void => {
        delete marker.dataset.hover;
        // See `leavePin`'s own comment above -- it re-speaks whichever pin
        // still owns the line, or hands it back to the ground.
        leavePin(marker);
      };
      marker.addEventListener('mouseenter', () => {
        marker.dataset.hover = '1';
        enterPin(marker);
        previewThisPin();
      });
      marker.addEventListener('mouseleave', leaveThisPin);
      marker.addEventListener('focusin', () => {
        marker.dataset.hover = '1';
        enterPin(marker);
        previewThisPin();
      });
      marker.addEventListener('focusout', leaveThisPin);

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
  bearing.title = t('world3d.bearing.title');
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
  const ccw = spinButton('ccw', '↺', t('world3d.spin.left', { deg: NUDGE_DEGREES }));
  const cw = spinButton('cw', '↻', t('world3d.spin.right', { deg: NUDGE_DEGREES }));
  spin.append(ccw, bearing, cw);
  stage.appendChild(spin);
  wrap.appendChild(stage);

  // `say` was declared above the town pins; appended here, in its original
  // visual position, once the stage and rotate controls are already in the
  // DOM.
  wrap.appendChild(say);

  // --- the cards, identical to the flat board's ---------------------------
  const cards = el('div', 'rl-world__cards');
  const cardFor = new Map<string, HTMLElement>();
  for (const region of world.regions) {
    const card = regionCard(region, {
      ledger,
      commander: opts.commander,
      missionOf: opts.missionOf,
      portraitUrl: opts.portraitUrl,
    });
    cards.appendChild(card);
    cardFor.set(region.id, card);
  }
  wrap.appendChild(cards);
  wrap.appendChild(ledgerLine(ledger, world));

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
      speak(t('world3d.say.unmapped', { id: regionId }), 'info');
      return;
    }
    point(region.id);
    const p = regionProgress(region, ledger, missionName);
    const next = nextOf(region);
    // The one branch a hover preview resolves through too (`pin-hover.ts`) --
    // written once rather than as this function's own copy of the same
    // if-chain (pre-flight scan M11).
    const outcome = pickOutcome(p.status, next !== null);
    if (outcome === 'locked') {
      speak(t('world3d.say.locked', { region: region.name, reason: p.lockedBecause ?? t('world3d.locked.fallback') }), 'bad');
      return;
    }
    if (outcome === 'empty') {
      speak(t('world3d.say.empty', { region: region.name }), 'info');
      return;
    }
    if (next === null) {
      // `outcome` is `'cleared'` here -- the check is on `next` rather than
      // on `outcome` because only this one narrows its type for the
      // `navigate` call below, with no non-null assertion needed.
      speak(t('world3d.say.cleared', { region: region.name }), 'good');
      return;
    }
    // `outcome` is `'opening'` here. Names the mission, never its id -- the
    // same rule as the locked-region sentence just above. A catalogue with
    // no title for `next` still says something real (the region alone)
    // rather than falling through to the id.
    const nextName = missionName(next);
    speak(nextName ? t('world3d.say.opening', { region: region.name, mission: nextName }) : region.name, 'good');
    navigate(opts.href(next));
  };

  // A label's rendered size never changes frame to frame (the text and the
  // star count are fixed once the pin is built), so it is measured once --
  // the moment a pin first gets a real position -- rather than every frame.
  // `offsetWidth`/`offsetHeight` are the placed-and-visible size regardless
  // of `opacity`, which is all this pin ever animates.
  const labelSize = new Map<string, { w: number; h: number }>();
  const onFrame = (towns: readonly TownPin[], bearingDegrees: number): void => {
    const boxes: LabelBox[] = [];
    for (const t of towns) {
      const pin = pinFor.get(t.id);
      if (!pin) continue;
      pin.style.left = `${t.x.toFixed(1)}px`;
      pin.style.top = `${t.y.toFixed(1)}px`;
      if (pin.dataset.placed !== '1') {
        labelSize.set(t.id, { w: pin.offsetWidth, h: pin.offsetHeight });
        pin.dataset.placed = '1';
      }
      const size = labelSize.get(t.id) ?? { w: 0, h: 0 };
      boxes.push({ id: t.id, x: t.x, y: t.y, w: size.w, h: size.h });
    }
    // Collision avoidance over the PROJECTED positions, recomputed every
    // frame as the board turns -- cheap at a dozen towns (label-layout.ts).
    // The pin itself (`pin.style.left/top`, set above) never moves; only the
    // label's rendered offset does, via `--dy` on the CSS transform.
    const dy = nudgeLabels(boxes, 4);
    for (const box of boxes) {
      const pin = pinFor.get(box.id);
      if (!pin) continue;
      const d = dy.get(box.id) ?? 0;
      pin.style.setProperty('--dy', `${d}px`);
      pin.style.setProperty('--leader', `${Math.max(0, d - 4)}px`);
    }
    bearing.textContent = `${Math.round(bearingDegrees).toString().padStart(3, '0')}°`;

    // The ground's own preview, debounced to changes only -- see
    // `previewGround`'s own comment for why. Skipped entirely while a pin
    // owns the line (`pinOwners`, above): the DOM overlay being topmost
    // makes this read `null` the instant a pin is hovered, and that must
    // not clobber the pin's own sentence. `forceGroundSpeak` (also above)
    // makes this fire even when `hoveredId` has not changed from the
    // debounce's point of view -- the frame right after the last pin was
    // left, when the view's own hover has finally had a chance to catch up
    // to whatever is really under the cursor now.
    if (pinOwners.length === 0) {
      const hoveredId = mountedView?.hovered ?? null;
      if (hoveredId !== lastGroundHover || forceGroundSpeak) {
        lastGroundHover = hoveredId;
        previewGround(hoveredId);
        forceGroundSpeak = false;
      }
    }
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
        dracoDecoderPath: opts.dracoDecoderPath,
        statuses,
        clickable,
        onPick,
        onFrame,
        signal: opts.signal,
      });
      // Left while the view was mounting. The disconnect observer below is
      // attached only after this line and fires only on a LATER body
      // mutation, which an idle menu may never make -- measured holding the
      // context alive through a forced GC. With the router's signal the
      // view never gets this far (it rejects before making a context); this
      // is the same guarantee for a caller that passes none.
      if (!wrap.isConnected) {
        view.dispose();
        return 'diorama';
      }
      mountedView = view;
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
      // The screen was left and the view gave up on purpose, having made no
      // context. Nothing to fall back to and nothing to report: building the
      // flat board into a detached wrap would be work for nobody, and the
      // warning would read as a failure on every quick leave.
      if (opts.signal?.aborted) return 'diorama';
      return toFlat('could not draw the Sahar Basin diorama', err);
    }
  })();

  return { el: wrap, ready };
}
