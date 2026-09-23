// The reinforcements dock: bottom-left, a grid of 60px tiles (GH-153 slice 3).
//
// Reinforcements deploy at the field camp after their build time, paid from
// mission logistics. Fire support is bought with intel; arming a purchase puts
// the cursor into targeting mode and the next click on the map spends it.
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

import type { LedgerData } from '@lions/sim';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { escapeHtml } from './escape-html';
import { roleBadgeSvg } from './role';
import { bindTip } from './tooltip';
import { tileState, type DockUnit, type DockView } from './dock-model';
import type { Tone } from './hud';

export type SupportKind = 'sweep' | 'strike';

/** What a tile needs to draw one buildable type. `DockUnit` is the shape;
 *  re-exported under the name `main.ts` and the ticket already use. */
export type BuildableUnit = DockUnit;

/** What production needs from the mission runtime, named so this module does
 *  not depend on MissionRuntime's whole surface. `DockView` is the read half —
 *  the three fields the tile states are computed from. */
export interface ProductionRuntime extends DockView {
  readonly intel: number;
  readonly sweepCost: number;
  readonly strikeCost: number;
  requestBuild(unitId: string): boolean;
}

export interface ProductionOptions {
  units: BuildableUnit[];
  runtime: ProductionRuntime;
  note(html: string, tone?: Tone): void;
  /** Arming is owned by the input layer — it decides what the next click means. */
  onArm(kind: SupportKind | null): void;
  /** The campaign ledger, for `tileState`'s `gateSentence` recompute. Absent
   *  reads as an empty ledger -- every gate still closed, none open early. */
  ledger?: LedgerData;
  /** Resolves a mission id to its player-facing title, for an `afterMission`
   *  gate's sentence -- the same catalogue lookup the campaign map and
   *  brigade already take. */
  missionName?: (id: string) => string | undefined;
}

/** The two fire-support calls, as the dock draws them. `word`/`name`/`blurb`
 *  are catalogue KEYS, not text -- the same `ORDERS[].label`/`ACTIONS[].label`
 *  convention (see either file's own doc comment): a module-level table
 *  resolved to text once, at import time, freezes in whatever locale was
 *  active before `main.ts`'s boot ever calls `setCatalogue`. Every reader
 *  below (`buildSupportTile`, `unitTipHtml`/`supportTipHtml`, the click
 *  handler's own notes) calls `t()` at render/use time instead. */
const SUPPORT: readonly {
  kind: SupportKind;
  glyph: string;
  word: string;
  name: string;
  blurb: string;
}[] = [
  {
    kind: 'sweep',
    glyph: '◎',
    word: 'dock.support.sweep.word',
    name: 'dock.support.sweep.name',
    blurb: 'dock.support.sweep.blurb',
  },
  {
    kind: 'strike',
    glyph: '✸',
    word: 'dock.support.strike.word',
    name: 'dock.support.strike.name',
    blurb: 'dock.support.strike.blurb',
  },
];

interface UnitTile {
  el: HTMLButtonElement;
  unit: BuildableUnit;
  cost: HTMLElement;
  left: HTMLElement;
  bar: HTMLElement;
  lock: HTMLElement;
}

interface SupportTile {
  el: HTMLButtonElement;
  kind: SupportKind;
  cost: number;
}

export class ReinforcementDock {
  private readonly el: HTMLDivElement;
  private readonly unitTiles: UnitTile[] = [];
  private readonly supportTiles: SupportTile[] = [];
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

  constructor(
    host: HTMLElement,
    private readonly opts: ProductionOptions
  ) {
    this.el = document.createElement('div');
    this.el.className = 'rl-dock';

    const label = document.createElement('div');
    label.className = 'rl-label rl-dock__label';
    // `B` focuses the first tile — see `focusFirst`. A label that named a key
    // doing nothing is the drift slice 2 refused for `Attack-move A`.
    label.textContent = t('dock.label');

    const grid = document.createElement('div');
    grid.className = 'rl-dock__grid';

    for (const unit of opts.units) grid.appendChild(this.buildUnitTile(unit));
    for (const spec of SUPPORT) {
      const cost = spec.kind === 'sweep' ? opts.runtime.sweepCost : opts.runtime.strikeCost;
      grid.appendChild(this.buildSupportTile(spec, cost));
    }

    this.el.append(label, grid);
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

    const cost = document.createElement('span');
    cost.className = 'rl-tile__cost';
    cost.textContent = String(unit.logistics);

    const left = document.createElement('span');
    left.className = 'rl-tile__left';

    const bar = document.createElement('i');
    bar.className = 'rl-tile__bar';

    const lock = document.createElement('span');
    lock.className = 'rl-tile__lock';

    el.append(cost, left, bar, lock);

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
      const state = tileState(unit, this.opts.runtime, this.opts.ledger, this.opts.missionName);
      const name = escapeHtml(unit.name);
      if (state.lock !== null) {
        this.opts.note(t('dock.note.locked', { name, reason: escapeHtml(state.lock.full) }), 'warn');
        return;
      }
      if (this.opts.runtime.requestBuild(unit.id)) {
        this.opts.note(t('dock.note.building', { name }), 'info');
      } else {
        this.opts.note(t('dock.note.cannotBuild', { name }), 'mute');
      }
      el.blur(); // keep the keyboard on the battlefield
      this.refresh(); // the bar starts now, not at the next 4 Hz beat
    });
    this.tipDisposers.push(bindTip(el, () => this.unitTipHtml(unit), { host: this.el }));

    this.unitTiles.push({ el, unit, cost, left, bar, lock });
    return el;
  }

  private buildSupportTile(
    spec: (typeof SUPPORT)[number],
    cost: number
  ): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rl-tile rl-tile--support';
    el.dataset.support = spec.kind;
    el.dataset.armed = '0';
    el.innerHTML =
      `<span class="rl-tile__glyph">${spec.glyph}</span>` +
      `<span class="rl-tile__word">${t(spec.word)} ${cost}</span>`;

    el.addEventListener('click', () => {
      if (this.opts.runtime.intel < cost) {
        this.opts.note(t('dock.note.noIntel', { name: t(spec.name).toLowerCase() }), 'mute');
        return;
      }
      this.setArmed(this.armed === spec.kind ? null : spec.kind);
      this.opts.note(
        this.armed ? t('dock.note.armed', { name: t(spec.name) }) : t('dock.note.cancelled'),
        'info'
      );
      el.blur();
    });
    this.tipDisposers.push(bindTip(el, () => this.supportTipHtml(spec, cost), { host: this.el }));

    this.supportTiles.push({ el, kind: spec.kind, cost });
    return el;
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

  private unitTipHtml(unit: BuildableUnit): string {
    const blurb =
      unit.blurb === undefined ? '' : `<div class="rl-tip__blurb">${unit.blurb}</div>`;
    return (
      `<div class="rl-tip__head">` +
      `<span class="rl-tip__name">${unit.name}</span>` +
      `<span class="rl-tip__cost">${unit.logistics} · ${unit.buildTimeS}s</span>` +
      `</div>` +
      `<div class="rl-tip__tags">${roleBadgeSvg(unit.bucket, 8)} ${unit.tags.join(' · ')}</div>` +
      blurb
    );
  }

  private supportTipHtml(spec: (typeof SUPPORT)[number], cost: number): string {
    return (
      `<div class="rl-tip__head">` +
      `<span class="rl-tip__name">${t(spec.name)}</span>` +
      `<span class="rl-tip__cost">${t('dock.tip.intelCost', { n: cost })}</span>` +
      `</div>` +
      `<div class="rl-tip__blurb">${t(spec.blurb)}</div>`
    );
  }

  // ------------------------------------------------------------------
  // State.
  // ------------------------------------------------------------------

  /** Cleared by the input layer once an armed purchase has been spent. */
  setArmed(kind: SupportKind | null): void {
    this.armed = kind;
    for (const { el, kind: k } of this.supportTiles) {
      el.dataset.armed = this.armed === k ? '1' : '0';
    }
    this.opts.onArm(kind);
  }

  /** What `b` reaches. The first tile the player could actually spend on, so
   *  the key lands somewhere useful on a mission whose first few types are
   *  campaign-locked; falls back to the first tile of all when nothing is
   *  affordable, because focusing nothing would read as a dead key. */
  focusFirst(): boolean {
    if (this.unitTiles.length === 0) return false;
    // Not named `t`: this file imports the catalogue's own `t()`.
    const open = this.unitTiles.find((tile) => tile.el.dataset.locked === '0' && tile.el.dataset.poor === '0');
    (open ?? this.unitTiles[0]).el.focus();
    return true;
  }

  refresh(): void {
    const rt = this.opts.runtime;
    for (const tile of this.unitTiles) {
      const state = tileState(tile.unit, rt, this.opts.ledger, this.opts.missionName);
      tile.el.dataset.locked = state.lock === null ? '0' : '1';
      // A lock outranks the price: a type the campaign has not opened is not
      // "expensive", and dimming it twice would say two things at once.
      tile.el.dataset.poor = state.lock === null && !state.affordable ? '1' : '0';
      tile.el.dataset.queued = state.queue === null ? '0' : '1';

      tile.lock.textContent = state.lock?.short ?? '';
      tile.left.textContent = state.queue === null ? '' : `${state.queue.secs}s`;
      tile.bar.style.width = state.queue === null ? '0' : `${state.queue.percent.toFixed(1)}%`;

      const queued =
        state.queue === null ? '' : t('dock.tile.queuedSuffix', { n: state.queue.count, secs: state.queue.secs });
      const title =
        state.lock !== null
          ? t('dock.tile.titleLocked', { name: tile.unit.name, reason: state.lock.full })
          : t('dock.tile.title', { name: tile.unit.name, logistics: tile.unit.logistics, queued });
      tile.el.title = title;
      // A button's accessible name comes from its own text, and this one's
      // text is the cost badge — so without this a screen reader announces a
      // tile as "292". `B` puts the keyboard here, so the name has to be a
      // sentence rather than a number.
      tile.el.setAttribute('aria-label', title);
    }
    for (const { el, cost } of this.supportTiles) {
      el.dataset.poor = rt.intel >= cost ? '0' : '1';
    }
  }
}
