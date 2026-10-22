// The reinforcements dock: bottom-left, a grid of 60px tiles (GH-153 slice 3).
//
// Reinforcements deploy at the field camp after their build time, paid from
// mission logistics. Fire support is bought with intel: four calls (S-F), one
// tile each, in the sim's own order. Arming a purchase puts the cursor into
// targeting mode and the next click on the map spends it. A click the intel
// cannot pay for is denied -- a note and the deny cue -- never silently dropped.
//
// This replaced a column of text buttons (`Rifle Squad (120)`) and a separate
// `rl-queue` list underneath them. The list is gone on purpose rather than
// merely moved: a queue is a fact ABOUT a unit type, and drawing it anywhere
// but on that type's own tile means the player reads two places to answer one
// question. The bar along the bottom of the tile and the countdown in its
// corner say the same thing where the thing is.
//
// Nothing here decides anything. Every rule is in `dock-model.ts` and every
// action is a callback `main.ts` supplied — see the note on `onArm` for why
// that indirection is load-bearing and not ceremony.

import type { Command, Fx, LedgerData, WorksOffer, WorksRefusal } from '@lions/sim';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { escapeHtml } from './escape-html';
import { worksMarkSvg } from './mark';
import { roleBadgeSvg } from './role';
import { symbolSvg } from './symbol';
import { bindTip } from './tooltip';
import {
  buildLine,
  LINE_QUEUE_CHIPS,
  lineView,
  linesShown,
  rallyMarks as rallyMarksFor,
  RALLY_FLASH_MS,
  tileState,
  worksTileState,
  type WorksTileState,
  type DockUnit,
  type DockView,
  type LineSnapshot,
  type LineView,
  type RallyMark,
} from './dock-model';
import { kitIconSignHtml, kitLevelLabel } from './kit-sign';
import type { Tone } from './hud';
import { SUPPORT, SUPPORT_KINDS, type SupportKind as FireSupportKind } from './support-kinds';

/** A field work armed from the dock (GH-277): the structure type's id. */
export type WorksKind = { readonly works: string };

/** What the dock can arm: one of the four fire-support calls, or a field work. */
export type SupportKind = FireSupportKind | WorksKind;

export function isWorksKind(k: SupportKind | null): k is WorksKind {
  return k !== null && typeof k === 'object';
}

/** Two arms are the same arm. A works kind is an object, so `===` is false for
 *  two `{ works: 'a' }` built apart; every comparison of support kinds goes
 *  through here. */
export function sameSupport(a: SupportKind | null, b: SupportKind | null): boolean {
  if (a === null || b === null) return a === b;
  if (isWorksKind(a) || isWorksKind(b)) return isWorksKind(a) && isWorksKind(b) && a.works === b.works;
  return a === b;
}

/** What a tile needs to draw one buildable type. `DockUnit` is the shape;
 *  re-exported under the name `main.ts` and the ticket already use. */
export type BuildableUnit = DockUnit;

/** What production needs from the mission runtime, named so this module does
 *  not depend on MissionRuntime's whole surface. `DockView` is the read half —
 *  the three fields the tile states are computed from. */
export interface ProductionRuntime extends DockView {
  readonly intel: number;
  /** MissionRuntime's own method: what one call costs in intel. */
  supportCost(kind: FireSupportKind): number;
  /** MissionRuntime's click-time pre-check: would `requestBuild` accept now?
   *  (N2, D3.) The dock never spends: an accepted purchase is a `build`
   *  command, which the runtime re-checks and spends before the next tick. */
  canBuild(unitId: string, line?: number): boolean;
  /** F4: each production line of a side -- one per camp, in the order every
   *  `line` a command carries indexes. Optional so a view that predates F4
   *  reads as no lines (today's dock, no rows). */
  productionLines?(side: 0 | 1): readonly (LineSnapshot & { readonly anchor: number })[];
  /** F4: would `setRally(line, x, y)` accept now? Read-only; the armed
   *  cursor and the click's pre-check share it. */
  canSetRally?(line: number, x: Fx, y: Fx): boolean;
  /** Field works (GH-277): the "Field works" group's rows. Absent or empty: no
   *  group, and the dock's DOM is the one a mission without `field_works` has. */
  worksOffers?(): readonly WorksOffer[];
  /** Why a type cannot be raised now (no tile: the dock tile's own state). */
  constructReason?(typeId: string, tx?: number, ty?: number, builders?: readonly number[]): WorksRefusal | null;
}

export interface ProductionOptions {
  units: BuildableUnit[];
  runtime: ProductionRuntime;
  note(html: string, tone?: Tone): void;
  /** Field works: the selected units a `construct` order would take, so a selected engineer
   *  that is busy still unlocks the tiles. Absent or empty: the runtime's idle-carrier fallback. */
  worksBuilders?(): readonly number[];
  /** Arming is owned by the input layer — it decides what the next click means. */
  onArm(kind: SupportKind | null): void;
  /** Where an accepted purchase goes: the order sink, so it travels the frame path (N2). */
  dispatch(cmd: Command): void;
  /** A room's pause (spec §11b.4 follow-up, N3 Task 4; `dockHeld`): true when orders wait,
   *  and the caller has already said why. A unit tile's click then checks, sends, counts and
   *  notes nothing. Absent (single-player): never held. */
  held?(): boolean;
  /** Telemetry's count of bought units; never reaches the sim. Called exactly
   *  once per click the runtime's pre-check (`canBuild`) accepted -- never for
   *  a locked tile and never for one it refused. Two clicks in one frame that
   *  the purse covers once are both counted: the pre-check cannot see the
   *  first, unspent (D3's known gap). */
  onBought?: (unitId: string) => void;
  /** The campaign ledger, for `tileState`'s `gateSentence` recompute. Absent
   *  reads as an empty ledger -- every gate still closed, none open early. */
  ledger?: LedgerData;
  /** Resolves a mission id to its player-facing title, for an `afterMission`
   *  gate's sentence -- the same catalogue lookup the campaign map and
   *  brigade already take. */
  missionName?: (id: string) => string | undefined;
  /**
   * The brigade's credit balance on hand, read through the same
   * `ledgerStore.readAccount()` seam the garage uses -- GH-229. `undefined`
   * when the store is unavailable (no durable storage), the one state that
   * genuinely has no number to show; the caller reaches it only through that
   * one door, never the browser's storage directly. A locked tile's short
   * label (`dock.lock.price`) and its full
   * note (`gate.buy`) both name a credit PRICE without ever saying what the
   * player actually has on hand, which is bug 2 of GH-229 -- the header is
   * the one place in the dock that is on screen for the whole mission, so it
   * is where the balance goes rather than repeated beside every price.
   */
  credits?: number;
  /**
   * True while a unit type's model is still downloading (WP-A3.3, the lead's
   * ruling 1). A deferred KDF buildable's GLB is fetched after the mission
   * starts, and with the sprite placeholder retired a unit deployed before it
   * lands draws nothing until it does -- so once the player has bought one,
   * its tile says "deploying" rather than leaving an empty patch of ground
   * unexplained. Absent reads as never pending.
   */
  meshPending?: (unitId: string) => boolean;
  /**
   * GH-113: how far a support call is from affordable, for the tile's charge
   * bar -- `fraction` of the cost in hand, and the accessible `title` already
   * worded by the caller through `t()`. No clock: intel is earned by doing
   * (F1), so there is no rate to read a time off. Absent: the tile only dims.
   */
  supportCharge?: (kind: FireSupportKind) => { fraction: number; title: string };
  /** Plays the deny cue on every click the dock refuses: a support call the
   *  intel cannot pay for (click or `press`), and a unit tile that is locked,
   *  capped by population, or one the runtime declines to build -- one deny
   *  path for the whole dock. An accepted build never calls it. `main.ts`
   *  supplies `CRITICAL_CUES.uiDeny`. */
  onDeny?: () => void;
  /** The bound key's label for a call, for the tooltip's last line (Task 3
   *  wires it). Absent prints nothing. */
  hotkeyLabel?: (kind: FireSupportKind) => string | undefined;
  /** F4: Set rally is armed for `line`, or nothing is (`null`). Owned by the
   *  input layer like `onArm`: it decides what the next click on the map
   *  means, and arming a rally disarms a support call or an order. */
  onArmRally?: (line: number | null) => void;
}

/* The fire-support calls the dock draws are `support-kinds.ts`'s
 * `SUPPORT_KINDS`, the sim's own order. Everything else about a call -- its
 * catalogue KEYS (`word`/`name`/`blurb`), its glyph -- is a row of `SUPPORT`.
 * Keys, not text: a table resolved to text at import time freezes in whatever
 * locale was active before `main.ts`'s boot calls `setCatalogue`, so
 * `buildSupportTile` and `supportTipHtml` call `t()` at render time. */

/** The tile cost's logistics mark. Built once: it is the same markup on
 *  every tile, and a constant is what lets the price beside it stay a text
 *  node. The px is the attribute fallback -- theme.css draws `.rl-sym` at 1em
 *  of the cost's own type. */
const LOGISTICS_MARK = symbolSvg('logistics', 12);
/** The support tiles' mark; 1em of `.rl-tile__glyph`'s 1.125rem. */
const SUPPORT_GLYPH_PX = 18;
/** The tooltip's role badge. S3e (Q7): was 8, where an APP-6 mark is a smudge;
 *  10 is the floor wherever a unit is badged. */
const TIP_BADGE = 10;

interface UnitTile {
  el: HTMLButtonElement;
  unit: BuildableUnit;
  cost: HTMLElement;
  left: HTMLElement;
  bar: HTMLElement;
  lock: HTMLElement;
  /** The "deploying" chip -- see `ProductionOptions.meshPending`. */
  deploying: HTMLElement;
}

/** One camp's row (F4, direction B). Built once per line and repainted. */
interface LineRow {
  index: number;
  root: HTMLDivElement;
  pin: HTMLButtonElement;
  camp: HTMLElement;
  current: HTMLButtonElement;
  currentArt: HTMLElement;
  currentLeft: HTMLElement;
  currentBar: HTMLElement;
  chips: HTMLButtonElement[];
  more: HTMLElement;
  state: HTMLElement;
  rally: HTMLButtonElement;
  clear: HTMLButtonElement;
  /** What the row last drew, for the tips, the clicks and the cancel note. */
  view: LineView | null;
}

/** The queue chips' art. 1.375rem in theme.css; this is the attribute fallback. */
const CHIP_BADGE = 14;

interface SupportTile {
  el: HTMLButtonElement;
  kind: FireSupportKind;
  cost: number;
  bar: HTMLElement;
  /** Frame-clock ms until which the border says "ready" (GH-113). */
  flashUntil: number;
}

/** One "Field works" tile (GH-277). */
interface WorksTile {
  el: HTMLButtonElement;
  offer: WorksOffer;
  left: HTMLElement;
  lock: HTMLElement;
  state: WorksTileState['state'];
}

export class ReinforcementDock {
  private readonly el: HTMLDivElement;
  private readonly unitTiles: UnitTile[] = [];
  private readonly supportTiles: SupportTile[] = [];
  private readonly worksTiles: WorksTile[] = [];
  /** Types the player has bought this mission -- the deploying chip shows
   *  only for one of these, never for a tile nobody has touched. */
  private readonly bought = new Set<string>();
  private armed: SupportKind | null = null;
  /** Every `bindTip` disposer this dock registered, so `destroy()` has one
   *  list to release rather than a hand-kept count of tiles. `bindTip` itself
   *  lazily creates the tip element the first call needs (see `buildUnitTile`
   *  below) inside `this.el` -- the spec's own reasoning for anchoring above
   *  the container's top edge rather than the label -- so removing `this.el`
   *  already takes the tip's DOM node with it; these disposers are what
   *  additionally drop its listeners and the app-wide Escape hook if this
   *  dock's tip happens to be the one showing when the mission ends. */
  private readonly tipDisposers: Disposer[] = [];
  /** The header's population readout. Built once, hidden while the mission is
   *  uncapped; unlike the credit chip it CHANGES (units die, builds queue), so
   *  `refresh()` repaints it. `popShown` is what is painted, so the 4 Hz beat
   *  rewrites the DOM only when a number moved. */
  private readonly pop: HTMLElement;
  private popShown = '';
  /** F4: the camps' rows, above the grid; hidden while `linesShown` is false,
   *  which keeps a one-camp idle mission's dock exactly as it was. */
  private readonly linesEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly rows: LineRow[] = [];
  /** The runtime's lines as last read (`refresh`), side 0's. */
  private lines: readonly (LineSnapshot & { readonly anchor: number })[] = [];
  /** The pinned row: tiles build on its line. Null = the runtime's shortest
   *  queue, which is the default (the lead's ruling). */
  private pinned: number | null = null;
  private hovered: number | null = null;
  private armedRally: number | null = null;
  /** Frame-clock ms until which a newly set rally stays drawn, per line. */
  private readonly rallyFlash = new Map<number, number>();

  constructor(
    host: HTMLElement,
    private readonly opts: ProductionOptions
  ) {
    this.el = document.createElement('div');
    this.el.className = 'rl-dock';

    const head = document.createElement('div');
    head.className = 'rl-dock__head';

    const label = document.createElement('div');
    label.className = 'rl-label rl-dock__label';
    // `B` focuses the first tile — see `focusFirst`. A label that named a key
    // doing nothing is the drift slice 2 refused for `Attack-move A`.
    label.textContent = t('dock.label');
    head.appendChild(label);

    // GH-229 bug 2, fix round 2: the balance now gets its own chip, sized like
    // the top strip's own counters (`--t-strip`, the same size `.rl-info`
    // reads off `.rl-strip`) rather than riding along at the small label's
    // `--t-xs` -- a reviewer read "REINFORCEMENTS · B · 0 CR" at that size as
    // illegible on the first round. `--commend` is the colour, the one every
    // credit figure wears (VR-25), distinct from the logistics and intel
    // figures (`--info`, on the strip and on this dock's tile badges alike) --
    // those are THIS mission's currencies, and the brigade's credits are a
    // different one, earned across the whole campaign and spent only in the
    // garage. Static once at
    // construction: nothing in a mission ever spends or grants brigade
    // credits mid-mission, so unlike the tile countdowns this never needs a
    // 4 Hz refresh. The number carries no comma grouping -- nothing in this
    // codebase formats one (`i18n/format.ts` has no `{n, number}` support),
    // and every other credit figure shipped (the garage's own wallet, the
    // debrief's payout line) reads the same bare way.
    if (opts.credits !== undefined) {
      const credits = document.createElement('span');
      credits.className = 'rl-dock__credits';
      credits.tabIndex = 0;
      const n = document.createElement('b');
      n.textContent = String(opts.credits);
      credits.append(n, document.createTextNode(` ${t('dock.credits.word', { n: opts.credits })}`));
      head.appendChild(credits);
      this.tipDisposers.push(bindTip(credits, () => t('dock.credits.tip'), { host: this.el }));
    }

    // Population, beside the credits (the approved mock's 5h): `--info` with a
    // dim word, the warn tone at the cap. Not on the top strip, which has no
    // room for it at 1400 wide. Text only; the figures are numbers.
    this.pop = document.createElement('span');
    this.pop.className = 'rl-dock__pop';
    this.pop.hidden = true;
    head.appendChild(this.pop);

    const grid = document.createElement('div');
    grid.className = 'rl-dock__grid';

    for (const unit of opts.units) grid.appendChild(this.buildUnitTile(unit));
    for (const kind of SUPPORT_KINDS) {
      grid.appendChild(this.buildSupportTile(kind, opts.runtime.supportCost(kind)));
    }
    // Field works (GH-277): a third group, only when the mission lists any.
    const offers = opts.runtime.worksOffers?.() ?? [];
    if (offers.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'rl-dock__group';
      heading.textContent = t('dock.works.label');
      grid.appendChild(heading);
      for (const offer of offers) grid.appendChild(this.buildWorksTile(offer));
    }

    // F4: the camps' rows sit between the header and the grid, held to the
    // grid's width (theme.css: they contribute no width of their own).
    this.linesEl = document.createElement('div');
    this.linesEl.className = 'rl-dock__lines';
    this.linesEl.hidden = true;
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'rl-dock__hint';
    this.linesEl.appendChild(this.hintEl);

    this.el.append(head, this.linesEl, grid);
    host.appendChild(this.el);
    this.refresh();
  }

  /**
   * Take the dock off the host.
   *
   * Like the HUD and the minimap it mounts on `document.body`, not on the
   * stage the router clears, so leaving a `resources` mission strands it over
   * whatever screen comes next. One root: every tile, the label and the
   * tooltip are inside `this.el`, and their click/hover/focus listeners are on
   * its descendants, so removing it releases all of those. The one thing
   * `Element.remove()` cannot reach is `bindTip`'s app-wide Escape listener on
   * `window`, which is why the disposers are released explicitly first --
   * harmless if this dock's tip was not the one showing (`tooltip.ts`'s own
   * ownership guard makes that a no-op), necessary if it was.
   *
   * Idempotent -- `Element.remove()` on a detached node is a no-op, and
   * calling an already-called `bindTip` disposer a second time is too.
   */
  /** GH-345: on or off screen by the HUD disclosure set (`dock`). Off is
   *  inert too: a `display: none` dock takes no clicks, and `main.ts` gates
   *  the production key on the same set. */
  setShown(on: boolean): void {
    this.el.toggleAttribute('data-hud-hidden', !on);
  }

  destroy(): void {
    for (const off of this.tipDisposers) off();
    this.el.remove();
  }

  // ------------------------------------------------------------------
  // Construction. Tiles are built ONCE and only repainted afterwards.
  //
  // Same lesson `hud.ts` records for its order row: an innerHTML rebuild at
  // 4 Hz drops every listener four times a second, and the symptom is a build
  // button that fires only if you click it fast enough.
  // ------------------------------------------------------------------

  private buildUnitTile(unit: BuildableUnit): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rl-tile';
    el.dataset.unit = unit.id;

    // A type with no sheet draws the reserved hatch with its role mark, the
    // same degradation slice 2 gave the selection chips. Never an empty box:
    // a blank 56px hole reads as a broken image rather than as a known gap.
    if (unit.sprite === null) {
      const art = document.createElement('div');
      art.className = 'rl-tile__art';
      art.dataset.nosprite = '1';
      art.innerHTML = roleBadgeSvg(unit.bucket, 24);
      el.appendChild(art);
    } else {
      const art = document.createElement('img');
      art.className = 'rl-tile__art';
      art.src = unit.sprite;
      art.alt = '';
      // A cropped icon is already resampled at build time -- nearest-neighbour
      // here would re-alias a smooth Lanczos crop the same way it would any
      // other photograph. `theme.css` reads this to switch `image-rendering`.
      if (unit.spriteIsIcon === true) art.dataset.icon = '1';
      el.appendChild(art);
    }

    // R-8: the stylesheet hides the sign on a locked tile.
    el.insertAdjacentHTML('beforeend', kitIconSignHtml(unit.kit ?? 0));

    const cost = document.createElement('span');
    cost.className = 'rl-tile__cost';
    // GH-229 fix round 2: a bare number here read as credits once the dock's
    // header started showing a credit balance beside it. S3e: the prefix is
    // the G1 sheet's `logistics` mark, the SAME one the top strip's own
    // Logistics field draws (`hud.ts`) -- one id, so the two cannot drift.
    // The mark is a constant; the price goes in as a text node, so it never
    // passes through `innerHTML`.
    cost.innerHTML = LOGISTICS_MARK;
    cost.append(` ${unit.logistics}`);

    const left = document.createElement('span');
    left.className = 'rl-tile__left';

    const bar = document.createElement('i');
    bar.className = 'rl-tile__bar';

    const lock = document.createElement('span');
    lock.className = 'rl-tile__lock';

    const deploying = document.createElement('span');
    deploying.className = 'rl-tile__deploying';
    deploying.textContent = t('dock.tile.deploying');

    el.append(cost, left, bar, lock, deploying);

    el.addEventListener('click', () => {
      // I1: route through `tileState`, the same app-side sentence the
      // tile's own `title`/`aria-label` already show (`refresh()` above),
      // rather than the sim's raw `buildBlockedReason` string -- that
      // string is `requires campaign Conduct 55 (no missions rated yet)` or
      // `requires clearing <missionId>` verbatim, exactly the "bare wording
      // — a floor with a parenthetical, or an id verbatim" `dock-model.ts`'s
      // own comment says a tile can never show.
      //
      // Shell upgrade Phase 3, Task 10: a note is `hud.note` HTML, so the
      // unit's own `name` (free text in `data/units/*.json`) and the lock
      // sentence (which names a MISSION, through `missionName`) are escaped
      // before `t()` puts them beside the catalogue's `<b>`.
      if (this.opts.held?.() === true) {
        el.blur(); // keep the keyboard on the battlefield
        return;
      }
      const state = tileState(unit, this.opts.runtime, this.opts.ledger, this.opts.missionName);
      const name = escapeHtml(unit.name);
      if (state.lock !== null) {
        this.opts.note(t('dock.note.locked', { name, reason: escapeHtml(state.lock.full) }), 'warn');
        this.opts.onDeny?.();
        return;
      }
      // The cap: the line already carries the numbers (and, with room left
      // but not enough, the unit's name), so it is the note as it stands.
      if (state.capped !== null) {
        this.opts.note(escapeHtml(state.capped.full), 'warn');
        this.opts.onDeny?.();
        return;
      }
      // N2, D3 (lead, 16 Oct: "check, then send"): a read-only pre-check, then
      // a `build` command down the frame path. The runtime re-checks and
      // spends before the next tick (`applyQueued`).
      // F4: a pinned row names its line; otherwise `line` is omitted and the
      // runtime picks the shortest queue (its own default, the lead's ruling).
      const line = buildLine(this.pinned, this.lines);
      if (this.opts.runtime.canBuild(unit.id, line)) {
        this.opts.dispatch(
          line === undefined ? { kind: 'build', side: 0, unit: unit.id } : { kind: 'build', side: 0, unit: unit.id, line }
        );
        this.bought.add(unit.id);
        this.opts.onBought?.(unit.id);
        this.opts.note(t('dock.note.building', { name, ...this.deployWhere(line) }), 'info');
      } else {
        this.opts.note(t('dock.note.cannotBuild', { name }), 'mute');
        this.opts.onDeny?.();
      }
      el.blur(); // keep the keyboard on the battlefield
      // Repaints the tile now; the new bar itself lands on the next tick, when
      // the command has run (`main.ts` refreshes the dock on a tick that ran one).
      this.refresh();
    });
    // `clear: this.el` -- GH-229: vertical placement clears the whole dock,
    // not just this tile's own row, so a tip opened on row 2+ cannot land on
    // top of the row above it (`tooltip.ts`'s `computeTipPosition`).
    this.tipDisposers.push(bindTip(el, () => this.unitTipHtml(unit), { host: this.el, clear: this.el }));

    this.unitTiles.push({ el, unit, cost, left, bar, lock, deploying });
    return el;
  }

  private buildSupportTile(kind: FireSupportKind, cost: number): HTMLButtonElement {
    const spec = SUPPORT[kind];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rl-tile rl-tile--support';
    el.dataset.support = kind;
    el.dataset.armed = '0';
    el.innerHTML =
      `<span class="rl-tile__glyph">${symbolSvg(spec.mark, SUPPORT_GLYPH_PX)}</span>` +
      `<span class="rl-tile__word">${t(spec.word)} ${cost}</span>`;
    // GH-113: the charge, in the build bar's own language -- a bar along the
    // bottom. No clock beside it (S-F): intel arrives when the player earns
    // it, at no rate a time could be read from.
    const bar = document.createElement('span');
    bar.className = 'rl-tile__charge';
    el.append(bar);

    el.addEventListener('click', () => {
      this.press(kind);
      el.blur();
    });
    // Same `clear` reasoning as the unit tiles above -- the support calls sit
    // on their own rows, below every unit row.
    this.tipDisposers.push(bindTip(el, () => this.supportTipHtml(kind, cost), { host: this.el, clear: this.el }));

    this.supportTiles.push({ el, kind, cost, bar, flashUntil: 0 });
    return el;
  }

  private buildWorksTile(offer: WorksOffer): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rl-tile rl-tile--works';
    el.dataset.works = offer.typeId;
    el.dataset.armed = '0';
    el.dataset.state = 'ready';
    const glyph = document.createElement('span');
    glyph.className = 'rl-tile__glyph';
    glyph.innerHTML = worksMarkSvg(offer.typeId, SUPPORT_GLYPH_PX);
    const cost = document.createElement('span');
    cost.className = 'rl-tile__cost';
    cost.innerHTML = LOGISTICS_MARK;
    cost.append(` ${offer.logistics}`);
    const left = document.createElement('span');
    left.className = 'rl-tile__worksleft';
    const lock = document.createElement('span');
    lock.className = 'rl-tile__lock';
    el.append(glyph, cost, left, lock);
    el.addEventListener('click', () => {
      this.press({ works: offer.typeId });
      el.blur();
    });
    this.tipDisposers.push(bindTip(el, () => this.worksTipHtml(offer), { host: this.el, clear: this.el }));
    this.worksTiles.push({ el, offer, left, lock, state: 'ready' });
    return el;
  }

  private worksTipHtml(offer: WorksOffer): string {
    const blurbKey = `works.${offer.typeId}.blurb`;
    return (
      `<div class="rl-tip__head">` +
      `<span class="rl-tip__name">${escapeHtml(offer.name)}</span>` +
      `<span class="rl-tip__cost">${escapeHtml(t('dock.works.tip.cost', { n: offer.logistics }))}</span>` +
      `</div>` +
      `<div class="rl-tip__blurb">${escapeHtml(t(blurbKey))}</div>`
    );
  }

  /** The tile's click, callable from a hotkey: arms or disarms `kind`, or
   *  denies with a note and the cue when intel is short. Returns true if armed. */
  press(kind: SupportKind): boolean {
    if (isWorksKind(kind)) return this.pressWorks(kind);
    const spec = SUPPORT[kind];
    const tile = this.supportTiles.find((x) => x.kind === kind);
    if (tile === undefined || this.opts.runtime.intel < tile.cost) {
      this.opts.note(t('dock.note.noIntel', { name: t(spec.name).toLowerCase() }), 'mute');
      this.opts.onDeny?.();
      return false;
    }
    this.setArmed(sameSupport(this.armed, kind) ? null : kind);
    this.opts.note(
      this.armed ? t('dock.note.armed', { name: t(spec.name) }) : t('dock.note.cancelled'),
      'info'
    );
    return sameSupport(this.armed, kind);
  }

  private pressWorks(kind: WorksKind): boolean {
    const tile = this.worksTiles.find((x) => x.offer.typeId === kind.works);
    if (tile === undefined) return false;
    const name = escapeHtml(tile.offer.name);
    const state = worksTileState(tile.offer, this.opts.runtime.constructReason?.(kind.works, undefined, undefined, this.opts.worksBuilders?.()) ?? null);
    if (state.state !== 'ready') {
      const reason: Record<WorksTileState['state'], string> = {
        ready: '',
        locked: t('dock.lock.locked'),
        unaffordable: t('works.refuse.unaffordable'),
        none_left: t('works.refuse.none_left'),
        needs_engineers: t('works.refuse.needs_engineers'),
      };
      this.opts.note(t('dock.note.locked', { name, reason: escapeHtml(reason[state.state]) }), 'warn');
      this.opts.onDeny?.();
      return false;
    }
    this.setArmed(sameSupport(this.armed, kind) ? null : kind);
    this.opts.note(this.armed ? t('dock.note.worksArmed', { name }) : t('dock.note.cancelled'), 'info');
    return sameSupport(this.armed, kind);
  }

  // ------------------------------------------------------------------
  // The hover tooltip.
  //
  // `bindTip` (`./tooltip`) is the shared component the HUD's order row and
  // chip row now use too -- shown on hover AND on keyboard focus, since the
  // two are the same event as far as the player is concerned ("I am about to
  // spend on this") and a tooltip only a mouse can reach makes `B` a worse
  // way in than the mouse. `host: this.el` keeps this dock's tip inside its
  // own stacking context rather than sharing the HUD's document.body one --
  // the two never need to agree about where either draws.
  // ------------------------------------------------------------------

  // `bindTip` sets this as `innerHTML`, and the name, the blurb and the tags
  // are all catalogue data (`data/units/*.json`, and `doctrineTags` over it)
  // with no schema rule against `<` or `&` -- so each goes through the one
  // escaper, the way the tile's own notes already did (final review, ruling 5).
  private unitTipHtml(unit: BuildableUnit): string {
    const blurb =
      unit.blurb === undefined ? '' : `<div class="rl-tip__blurb">${escapeHtml(unit.blurb)}</div>`;
    // The rich tip covers the native `title`, so a mouse player would never see
    // why a capped tile is refused: the full line goes here too, as one warn line.
    // A locked tile gets the same line with its gate sentence; the two are
    // exclusive (`tileState`: a lock outranks the cap), so at most one shows.
    const state = tileState(unit, this.opts.runtime, this.opts.ledger, this.opts.missionName);
    const refusal = state.lock ?? state.capped;
    const capLine = refusal === null ? '' : `<div class="rl-warn">${escapeHtml(refusal.full)}</div>`;
    return (
      `<div class="rl-tip__head">` +
      `<span class="rl-tip__name">${escapeHtml(unit.name)}</span>` +
      `<span class="rl-tip__cost">${unit.logistics} · ${unit.buildTimeS}s</span>` +
      `</div>` +
      `<div class="rl-tip__tags">${roleBadgeSvg(unit.bucket, TIP_BADGE)} ${unit.tags.map(escapeHtml).join(' · ')}</div>` +
      blurb +
      capLine
    );
  }

  private supportTipHtml(kind: FireSupportKind, cost: number): string {
    const spec = SUPPORT[kind];
    const key = this.opts.hotkeyLabel?.(kind);
    const hotkey = key === undefined || key === '' ? '' : `<div class="rl-tip__tags">${escapeHtml(t('dock.tip.hotkey', { key }))}</div>`;
    return (
      `<div class="rl-tip__head">` +
      `<span class="rl-tip__name">${t(spec.name)}</span>` +
      `<span class="rl-tip__cost">${t('dock.tip.intelCost', { n: cost })}</span>` +
      `</div>` +
      `<div class="rl-tip__blurb">${t(spec.blurb)}</div>` +
      hotkey
    );
  }

  // ------------------------------------------------------------------
  // State.
  // ------------------------------------------------------------------

  /** GH-113: a call just became affordable -- the border says so for
   *  `ms`. Cleared by `refresh()` on its own cadence, so there is no timer
   *  to dispose. */
  flashReady(kind: FireSupportKind, nowMs: number, ms: number): void {
    for (const tile of this.supportTiles) {
      if (tile.kind !== kind) continue;
      tile.flashUntil = nowMs + ms;
      tile.el.dataset.readyFlash = '1';
    }
  }

  /** Cleared by the input layer once an armed purchase has been spent. */
  setArmed(kind: SupportKind | null): void {
    this.armed = kind;
    for (const { el, kind: k } of this.supportTiles) {
      el.dataset.armed = sameSupport(this.armed, k) ? '1' : '0';
    }
    for (const { el, offer } of this.worksTiles) {
      el.dataset.armed = sameSupport(this.armed, { works: offer.typeId }) ? '1' : '0';
    }
    this.opts.onArm(kind);
  }

  /** What `b` reaches. The first tile the player could actually spend on, so
   *  the key lands somewhere useful on a mission whose first few types are
   *  campaign-locked; falls back to the first tile of all when nothing is
   *  affordable, because focusing nothing would read as a dead key. */
  focusFirst(): boolean {
    // F4: a pinned camp is where the keyboard player is building, so `B`
    // lands on its row; unpinned, the first open tile as before.
    const pinnedRow = this.pinned === null || this.linesEl.hidden ? undefined : this.rows[this.pinned];
    if (pinnedRow !== undefined) {
      pinnedRow.pin.focus();
      return true;
    }
    if (this.unitTiles.length === 0) return false;
    // Not named `t`: this file imports the catalogue's own `t()`.
    const open = this.unitTiles.find(
      (tile) => tile.el.dataset.locked === '0' && tile.el.dataset.capped === '0' && tile.el.dataset.poor === '0'
    );
    (open ?? this.unitTiles[0]).el.focus();
    return true;
  }

  refresh(): void {
    const rt = this.opts.runtime;
    for (const tile of this.unitTiles) {
      const state = tileState(tile.unit, rt, this.opts.ledger, this.opts.missionName);
      tile.el.dataset.locked = state.lock === null ? '0' : '1';
      tile.el.dataset.capped = state.capped === null ? '0' : '1';
      // A lock outranks the price: a type the campaign has not opened is not
      // "expensive", and dimming it twice would say two things at once. A
      // capped tile is refused for a reason that is not the price either.
      tile.el.dataset.poor = state.lock === null && state.capped === null && !state.affordable ? '1' : '0';
      tile.el.dataset.queued = state.queue === null ? '0' : '1';
      // Ruling 1 (WP-A3.3): bought, and its model has not landed yet.
      const pending = this.bought.has(tile.unit.id) && (this.opts.meshPending?.(tile.unit.id) ?? false);
      tile.el.dataset.meshPending = pending ? '1' : '0';

      tile.lock.textContent = state.lock?.short ?? state.capped?.short ?? '';
      tile.left.textContent = state.queue === null ? '' : `${state.queue.secs}s`;
      tile.bar.style.width = state.queue === null ? '0' : `${state.queue.percent.toFixed(1)}%`;

      const queued =
        state.queue === null ? '' : t('dock.tile.queuedSuffix', { n: state.queue.count, secs: state.queue.secs });
      // The cap sentence that names the unit has its nameless twin (`title`):
      // the label opens with the name already.
      const refusal = state.lock !== null ? state.lock.full : state.capped?.title ?? null;
      const title =
        refusal !== null
          ? t('dock.tile.titleLocked', { name: tile.unit.name, reason: refusal })
          : t('dock.tile.title', { name: tile.unit.name, logistics: tile.unit.logistics, queued });
      tile.el.title = title;
      // A button's accessible name comes from its own text, and this one's
      // text is the cost badge — so without this a screen reader announces a
      // tile as "292". `B` puts the keyboard here, so the name has to be a
      // sentence rather than a number.
      //
      // The kit level is added to the ARIA name only, never to `title`: the
      // sign on the art already says it visually (`kitIconSignHtml` below),
      // and a hover tooltip repeating what is already on screen would be
      // noise. A screen reader has no equivalent of hovering the icon, so its
      // one text has to carry both facts. Locked out, same as the sign.
      const kit = state.lock === null ? (tile.unit.kit ?? 0) : 0;
      tile.el.setAttribute('aria-label', kit === 0 ? title : `${title}, ${kitLevelLabel(kit)}`);
    }
    this.paintPopulation();
    this.paintLines();
    const now = performance.now();
    for (const tile of this.supportTiles) {
      const poor = rt.intel < tile.cost;
      tile.el.dataset.poor = poor ? '1' : '0';
      const charge = this.opts.supportCharge?.(tile.kind);
      // Charging: the tile keeps full strength so the bar does --
      // the defect the build bar already fixed (`.rl-tile[data-poor='1']`'s
      // own comment) -- and only the glyph and the word dim.
      tile.el.dataset.charging = poor && charge !== undefined ? '1' : '0';
      tile.bar.style.width = charge === undefined || !poor ? '0' : `${(charge.fraction * 100).toFixed(1)}%`;
      if (charge !== undefined) tile.el.setAttribute('aria-label', charge.title);
      tile.el.dataset.readyFlash = now < tile.flashUntil ? '1' : '0';
    }
    this.paintWorks();
  }

  /** Field works: each tile's state, its `left/max` and its lock word. */
  private paintWorks(): void {
    for (const tile of this.worksTiles) {
      const st = worksTileState(tile.offer, this.opts.runtime.constructReason?.(tile.offer.typeId, undefined, undefined, this.opts.worksBuilders?.()) ?? null);
      tile.state = st.state;
      tile.el.dataset.state = st.state;
      tile.left.textContent = t('dock.works.left', { left: st.left, max: st.max });
      const word =
        st.state === 'locked'
          ? t('dock.lock.locked')
          : st.state === 'needs_engineers'
            ? t('dock.lock.engineers')
            : st.state === 'none_left'
              ? t('dock.lock.noneLeft')
              : '';
      tile.lock.textContent = word;
      tile.el.setAttribute('aria-label', word === '' ? tile.offer.name : `${tile.offer.name} — ${word}`);
    }
  }

  // ------------------------------------------------------------------
  // F4: the camps' rows (direction B).
  // ------------------------------------------------------------------

  /** "Camp 1", by line index. No authored name (the lead's ruling). */
  private campName(index: number): string {
    return t('dock.camp', { n: index + 1 });
  }

  /** Where a build just sent will deploy, as `dock.note.building`'s params. */
  private deployWhere(line: number | undefined): { where: string; camp: string } {
    if (line !== undefined) return { where: 'camp', camp: this.campName(line) };
    if (this.lines.length > 1) return { where: 'shortest', camp: '' };
    const only = this.lines[0];
    if (only !== undefined && only.anchor >= 0) return { where: 'camp', camp: this.campName(0) };
    return { where: 'start', camp: '' };
  }

  private unitOf(id: string): BuildableUnit | undefined {
    return this.opts.units.find((u) => u.id === id);
  }

  /** A queued or in-progress item's art: the tile's own portrait, or its role
   *  mark on the hatch, the same degradation the tile makes. */
  private paintArt(el: HTMLElement, unitId: string): void {
    // `data-art`, not `data-unit`: `[data-unit]` is the tile's own selector.
    if (el.dataset.art === unitId) return;
    el.dataset.art = unitId;
    const unit = this.unitOf(unitId);
    if (unit === undefined || unit.sprite === null) {
      el.dataset.nosprite = '1';
      el.style.backgroundImage = '';
      el.innerHTML = roleBadgeSvg(unit?.bucket ?? 'soft', CHIP_BADGE);
    } else {
      el.dataset.nosprite = '0';
      el.innerHTML = '';
      el.style.backgroundImage = `url("${unit.sprite}")`;
    }
  }

  private buildRow(index: number): LineRow {
    const root = document.createElement('div');
    root.className = 'rl-line';
    root.dataset.line = String(index);

    // The pin is the row's own face: a button under the whole row (theme.css),
    // so a click anywhere that is not a chip or a rally button pins it.
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'rl-line__pin';
    pin.setAttribute('aria-pressed', 'false');
    pin.addEventListener('click', () => {
      const line = this.lines[index];
      if (line === undefined || !line.alive) {
        this.opts.onDeny?.();
        return;
      }
      this.pinned = this.pinned === index ? null : index;
      this.paintLines();
    });

    const camp = document.createElement('span');
    camp.className = 'rl-label rl-line__camp';

    const current = document.createElement('button');
    current.type = 'button';
    current.className = 'rl-line__item';
    const currentArt = document.createElement('span');
    currentArt.className = 'rl-line__art';
    const currentLeft = document.createElement('span');
    currentLeft.className = 'rl-line__left';
    const currentBar = document.createElement('i');
    currentBar.className = 'rl-line__bar';
    current.append(currentArt, currentLeft, currentBar);
    current.addEventListener('click', () => this.cancel(index, -1));

    const chips: HTMLButtonElement[] = [];
    const chipsEl = document.createElement('span');
    chipsEl.className = 'rl-line__queue';
    for (let k = 0; k < LINE_QUEUE_CHIPS; k++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rl-line__chip';
      const art = document.createElement('span');
      art.className = 'rl-line__art';
      chip.appendChild(art);
      chip.addEventListener('click', () => this.cancel(index, k));
      this.tipDisposers.push(bindTip(chip, () => this.cancelTip(index, k), { host: this.el }));
      chips.push(chip);
      chipsEl.appendChild(chip);
    }
    const more = document.createElement('span');
    more.className = 'rl-line__more';
    chipsEl.appendChild(more);

    const state = document.createElement('span');
    state.className = 'rl-line__state';

    const rally = document.createElement('button');
    rally.type = 'button';
    rally.className = 'rl-btn rl-line__rally';
    rally.dataset.armed = '0';
    rally.textContent = t('dock.rally.set');
    rally.addEventListener('click', () => {
      this.pressRally(index);
      rally.blur();
    });
    this.tipDisposers.push(bindTip(rally, () => this.rallyTip(index), { host: this.el }));

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'rl-btn rl-line__clear';
    clear.textContent = t('dock.rally.clearShort');
    clear.addEventListener('click', () => {
      if (this.lines[index]?.rally == null) return;
      this.opts.dispatch({ kind: 'clearRally', side: 0, line: index });
      this.opts.note(t('dock.note.rallyCleared', { camp: this.campName(index) }), 'info');
      if (this.armedRally === index) this.setRallyArmed(null);
      clear.blur();
    });
    this.tipDisposers.push(bindTip(clear, () => escapeHtml(t('dock.rally.clear')), { host: this.el }));

    root.append(pin, camp, current, chipsEl, state, rally, clear);
    // What makes this line's rally show in the world (the lead's R3): the row
    // hovered or holding focus, beside pinned and armed.
    root.addEventListener('pointerenter', () => {
      this.hovered = index;
    });
    root.addEventListener('pointerleave', () => {
      if (this.hovered === index) this.hovered = null;
    });
    this.tipDisposers.push(bindTip(pin, () => this.rowTip(index), { host: this.el, clear: this.el }));

    const row: LineRow = { index, root, pin, camp, current, currentArt, currentLeft, currentBar, chips, more, state, rally, clear, view: null };
    this.linesEl.insertBefore(root, this.hintEl);
    return row;
  }

  /** Cancel a line's item (index -1 = the one in progress) through the frame
   *  path; the runtime refunds when it runs the command. */
  private cancel(line: number, index: number): void {
    const view = this.rows[line]?.view ?? null;
    const unitId = index < 0 ? view?.current?.unit : view?.chips[index]?.unit;
    if (unitId === undefined) return;
    const unit = this.unitOf(unitId);
    this.opts.dispatch({ kind: 'cancelBuild', side: 0, line, index });
    this.opts.note(
      t('dock.note.cancelBuild', { name: escapeHtml(unit?.name ?? unitId), n: unit?.logistics ?? 0, camp: this.campName(line) }),
      'info'
    );
  }

  private cancelTip(line: number, index: number): string {
    const view = this.rows[line]?.view ?? null;
    const unitId = index < 0 ? view?.current?.unit : view?.chips[index]?.unit;
    if (unitId === undefined) return '';
    const unit = this.unitOf(unitId);
    return escapeHtml(t('dock.cancel.tip', { name: unit?.name ?? unitId, n: unit?.logistics ?? 0 }));
  }

  /** The row's whole story, for its tip and its accessible name: the state
   *  in a sentence (the paused cause in full), the rally, and the pin. */
  private rowSentences(index: number): string[] {
    const line = this.lines[index];
    const view = this.rows[index]?.view ?? null;
    if (line === undefined || view === null) return [];
    const camp = this.campName(index);
    const out: string[] = [];
    if (view.state === 'lost') {
      out.push(t('dock.line.tipLost', { camp }));
      return out;
    }
    if (view.state === 'paused') out.push(t('dock.line.tipPaused', { camp }));
    else if (view.current !== null) {
      const name = this.unitOf(view.current.unit)?.name ?? view.current.unit;
      out.push(t('dock.line.tipBuilding', { camp, name, secs: view.current.secs }));
    } else out.push(t('dock.line.tipIdle', { camp }));
    const queued = view.chips.length + view.more;
    if (queued > 0) out.push(t('dock.line.tipQueued', { n: queued }));
    out.push(t(view.hasRally ? 'dock.rally.on' : 'dock.rally.none'));
    out.push(t(this.pinned === index ? 'dock.line.tipPinned' : 'dock.line.tipPin', { camp }));
    return out;
  }

  private rowTip(index: number): string {
    return this.rowSentences(index)
      .map((line, i) => `<div class="${i === 0 ? 'rl-tip__head' : 'rl-tip__blurb'}">${escapeHtml(line)}</div>`)
      .join('');
  }

  private rallyTip(index: number): string {
    const line = this.lines[index];
    const words = t(line?.rally != null ? 'dock.rally.on' : 'dock.rally.none');
    return `<div class="rl-tip__head">${escapeHtml(t('dock.rally.set'))}</div><div class="rl-tip__blurb">${escapeHtml(words)}</div>`;
  }

  /** Set rally's click: arm it for this line, or disarm it if it already is. */
  pressRally(index: number): void {
    const line = this.lines[index];
    if (line === undefined || !line.alive) {
      this.opts.onDeny?.();
      return;
    }
    if (this.armedRally === index) {
      this.setRallyArmed(null);
      this.opts.note(t('dock.note.rallyCancelled'), 'info');
      return;
    }
    this.setRallyArmed(index);
    this.opts.note(t('dock.note.rallyArmed', { camp: this.campName(index) }), 'info');
  }

  /** The armed rally, or null. Cleared by the input layer once a point is set,
   *  and on Escape or a right-click; arming support or an order clears it too. */
  setRallyArmed(line: number | null): void {
    const changed = this.armedRally !== line;
    this.armedRally = line;
    for (const row of this.rows) {
      row.rally.dataset.armed = row.index === line ? '1' : '0';
      row.rally.setAttribute('aria-pressed', row.index === line ? 'true' : 'false');
    }
    if (changed) this.opts.onArmRally?.(line);
  }

  get rallyArmed(): number | null {
    return this.armedRally;
  }

  /** A rally was just set on `line`: draw it for a few seconds. */
  flashRally(line: number, nowMs: number): void {
    this.rallyFlash.set(line, nowMs + RALLY_FLASH_MS);
  }

  /** The rally marks to draw this frame, for the renderer's `rallyMarks`
   *  seam -- or null when there are none, so the seam stays null by default. */
  rallyMarks(nowMs: number): RallyMark[] | null {
    if (this.lines.length === 0) return null;
    // Focus is READ, not tracked: a focused chip that a repaint hides fires no
    // reliable `focusout`, and a tracked index would then draw that rally
    // for ever (review finding 1).
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const focusedRow = active === null ? undefined : this.rows.find((r) => !r.root.hidden && r.root.contains(active));
    const marks = rallyMarksFor(
      this.lines,
      { pinned: this.pinned, hovered: this.hovered, focused: focusedRow?.index ?? null, armed: this.armedRally, flashUntil: this.rallyFlash },
      nowMs
    );
    return marks.length === 0 ? null : marks;
  }

  /** Can a rally for `line` stand at this point (Q16.16)? For the armed cursor. */
  canRallyAt(line: number, x: Fx, y: Fx): boolean {
    return this.opts.runtime.canSetRally?.(line, x, y) ?? false;
  }

  private paintLines(): void {
    const lines = this.opts.runtime.productionLines?.(0) ?? [];
    this.lines = lines;
    const shown = linesShown(lines);
    this.linesEl.hidden = !shown;
    if (this.armedRally !== null && lines[this.armedRally]?.alive !== true) this.setRallyArmed(null);
    if (!shown) {
      this.hovered = null;
      // Pinning one camp of one, then the queue running dry, must not leave a
      // pin the player cannot see sending every build to that line.
      this.pinned = null;
      return;
    }
    while (this.rows.length < lines.length) this.rows.push(this.buildRow(this.rows.length));
    // A pin on a fallen camp is dropped (and `buildLine` would ignore it anyway).
    if (this.pinned !== null && lines[this.pinned]?.alive !== true) this.pinned = null;
    for (const row of this.rows) {
      const line = lines[row.index];
      row.root.hidden = line === undefined;
      if (line === undefined) continue;
      const view = lineView(line, row.index);
      row.view = view;
      row.root.dataset.state = view.state;
      row.camp.textContent = this.campName(row.index);
      row.pin.setAttribute('aria-pressed', this.pinned === row.index ? 'true' : 'false');
      row.pin.setAttribute('aria-label', this.rowSentences(row.index).join(' '));

      row.current.hidden = view.current === null;
      if (view.current !== null) {
        this.paintArt(row.currentArt, view.current.unit);
        row.current.dataset.paused = view.state === 'paused' ? '1' : '0';
        row.currentLeft.textContent = `${view.current.secs}s`;
        row.currentBar.style.width = `${view.current.percent.toFixed(1)}%`;
        const unit = this.unitOf(view.current.unit);
        row.current.setAttribute('aria-label', t('dock.cancel.tip', { name: unit?.name ?? view.current.unit, n: unit?.logistics ?? 0 }));
      }
      row.chips.forEach((chip, k) => {
        const item = view.chips[k];
        chip.hidden = item === undefined;
        if (item === undefined) return;
        this.paintArt(chip.firstElementChild as HTMLElement, item.unit);
        const unit = this.unitOf(item.unit);
        chip.setAttribute('aria-label', t('dock.cancel.tip', { name: unit?.name ?? item.unit, n: unit?.logistics ?? 0 }));
      });
      row.more.textContent = view.more > 0 ? t('dock.line.more', { n: view.more }) : '';
      row.more.hidden = view.more === 0;

      // The state word: never colour alone -- the pause carries its glyph and
      // its word, and the cause is the row's tip.
      if (view.state === 'paused') {
        row.state.className = 'rl-line__state rl-warn';
        row.state.innerHTML = `${symbolSvg('pause', 10)} ${escapeHtml(t('dock.line.paused'))}`;
      } else if (view.state === 'idle' || view.state === 'lost') {
        row.state.className = 'rl-line__state rl-dim';
        row.state.textContent = t(view.state === 'idle' ? 'dock.line.idle' : 'dock.line.lost');
      } else {
        row.state.className = 'rl-line__state';
        row.state.textContent = '';
      }

      row.rally.disabled = !line.alive;
      row.rally.dataset.armed = this.armedRally === row.index ? '1' : '0';
      row.rally.setAttribute('aria-pressed', this.armedRally === row.index ? 'true' : 'false');
      row.rally.setAttribute('aria-label', t('dock.rally.setFor', { camp: this.campName(row.index) }));
      row.clear.setAttribute('aria-label', t('dock.rally.clearFor', { camp: this.campName(row.index) }));
      row.clear.hidden = line.rally === null;
    }
    this.hintEl.textContent =
      this.pinned === null ? t('dock.hint.shortest') : t('dock.hint.pinned', { camp: this.campName(this.pinned) });
  }

  /** The header readout: `used/cap population` while the mission is capped,
   *  gone while it is not. Warn at the cap, `--info` below it. */
  private paintPopulation(): void {
    const view = this.opts.runtime.populationView?.() ?? null;
    if (view === null) {
      this.pop.hidden = true;
      this.popShown = '';
      return;
    }
    this.pop.hidden = false;
    const at = view.used >= view.cap;
    const key = `${view.used}/${view.cap}`;
    if (key !== this.popShown) {
      this.popShown = key;
      this.pop.innerHTML = t('dock.pop', { used: view.used, cap: view.cap });
    }
    this.pop.classList.toggle('rl-warn', at);
    this.pop.classList.toggle('rl-info', !at);
  }
}
