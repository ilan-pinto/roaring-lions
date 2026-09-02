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

import { roleBadgeSvg } from './role';
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
}

/** The two fire-support calls, as the dock draws them. */
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
    word: 'sweep',
    name: 'Satellite sweep',
    blurb: 'Reveals what is on the ground in a circle, once. It shoots nothing.',
  },
  {
    kind: 'strike',
    glyph: '✸',
    word: 'strike',
    name: 'Precision strike',
    blurb: 'One round on one point. It does not ask whose building it is.',
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
  private readonly tip: HTMLDivElement;
  private readonly unitTiles: UnitTile[] = [];
  private readonly supportTiles: SupportTile[] = [];
  private armed: SupportKind | null = null;

  constructor(
    host: HTMLElement,
    private readonly opts: ProductionOptions
  ) {
    this.el = document.createElement('div');
    this.el.className = 'rl-dock';

    // Above the label, not merely above the grid, so it can never sit on top
    // of the band it belongs to. The spec's mock puts it level with the label
    // because its own hovered tile happened to be four columns right of it;
    // anchoring to the container's top edge is the same picture at two rows
    // and still correct at four, which is what the shipped KDF catalogue needs.
    this.tip = document.createElement('div');
    this.tip.className = 'rl-tip';
    this.tip.hidden = true;

    const label = document.createElement('div');
    label.className = 'rl-label rl-dock__label';
    // `B` focuses the first tile — see `focusFirst`. A label that named a key
    // doing nothing is the drift slice 2 refused for `Attack-move A`.
    label.textContent = 'Reinforcements · B';

    const grid = document.createElement('div');
    grid.className = 'rl-dock__grid';

    for (const unit of opts.units) grid.appendChild(this.buildUnitTile(unit));
    for (const spec of SUPPORT) {
      const cost = spec.kind === 'sweep' ? opts.runtime.sweepCost : opts.runtime.strikeCost;
      grid.appendChild(this.buildSupportTile(spec, cost));
    }

    this.el.append(this.tip, label, grid);
    host.appendChild(this.el);
    this.refresh();
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
      const why = this.opts.runtime.buildBlockedReason(unit.id);
      if (why !== null) {
        this.opts.note(`<b>${unit.name}</b> is locked — ${why}`, 'warn');
        return;
      }
      if (this.opts.runtime.requestBuild(unit.id)) {
        this.opts.note(`<b>building</b> ${unit.name} — deploys at the start line`, 'info');
      } else {
        this.opts.note(`cannot build ${unit.name} — insufficient logistics`, 'mute');
      }
      el.blur(); // keep the keyboard on the battlefield
      this.refresh(); // the bar starts now, not at the next 4 Hz beat
    });
    this.bindTip(el, () => this.unitTipHtml(unit));

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
      `<span class="rl-tile__word">${spec.word} ${cost}</span>`;

    el.addEventListener('click', () => {
      if (this.opts.runtime.intel < cost) {
        this.opts.note(`not enough intel for ${spec.name.toLowerCase()} — watch longer`, 'mute');
        return;
      }
      this.setArmed(this.armed === spec.kind ? null : spec.kind);
      this.opts.note(
        this.armed
          ? `<b>${spec.name} armed</b> — click the map to place it`
          : 'support call cancelled',
        'info'
      );
      el.blur();
    });
    this.bindTip(el, () => this.supportTipHtml(spec, cost));

    this.supportTiles.push({ el, kind: spec.kind, cost });
    return el;
  }

  // ------------------------------------------------------------------
  // The hover tooltip.
  // ------------------------------------------------------------------

  /** Shown on hover AND on keyboard focus. The two are the same event as far
   *  as the player is concerned — "I am about to spend on this" — and a
   *  tooltip only a mouse can reach makes `B` a worse way in than the mouse. */
  private bindTip(el: HTMLElement, html: () => string): void {
    const show = (): void => {
      this.tip.innerHTML = html();
      // Read off the tile itself rather than from a column count this file
      // would have to keep in step with the stylesheet's `repeat(...)`.
      this.tip.style.setProperty('--tip-x', `${el.offsetLeft}px`);
      this.tip.hidden = false;
    };
    const hide = (): void => {
      this.tip.hidden = true;
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
  }

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
      `<span class="rl-tip__name">${spec.name}</span>` +
      `<span class="rl-tip__cost">${cost} intel</span>` +
      `</div>` +
      `<div class="rl-tip__blurb">${spec.blurb}</div>`
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
    const open = this.unitTiles.find((t) => t.el.dataset.locked === '0' && t.el.dataset.poor === '0');
    (open ?? this.unitTiles[0]).el.focus();
    return true;
  }

  refresh(): void {
    const rt = this.opts.runtime;
    for (const tile of this.unitTiles) {
      const state = tileState(tile.unit, rt);
      tile.el.dataset.locked = state.lock === null ? '0' : '1';
      // A lock outranks the price: a type the campaign has not opened is not
      // "expensive", and dimming it twice would say two things at once.
      tile.el.dataset.poor = state.lock === null && !state.affordable ? '1' : '0';
      tile.el.dataset.queued = state.queue === null ? '0' : '1';

      tile.lock.textContent = state.lock?.short ?? '';
      tile.left.textContent = state.queue === null ? '' : `${state.queue.secs}s`;
      tile.bar.style.width = state.queue === null ? '0' : `${state.queue.percent.toFixed(1)}%`;

      const queued =
        state.queue === null
          ? ''
          : ` — ${state.queue.count} building, next in ${state.queue.secs}s`;
      const title =
        state.lock !== null
          ? `${tile.unit.name} — ${state.lock.full}`
          : `${tile.unit.name} — ${tile.unit.logistics} logistics${queued}`;
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
