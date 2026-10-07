// The force, as places to fill rather than a list to scroll (GH-417, H2,
// Field order). One card per body the mission's `from_ledger` placements
// demand, holding whoever `deploy-select.ts` has chosen for it; a click opens
// that type's bench -- every eligible body of the type, ranked by record --
// and a pick there swaps them in. Bodies the mission brings itself (non-ledger
// placements) sit at the end as fixed cards.
//
// Every RULE is `deploy-select.ts`'s, unchanged: `defaultSelection` is the
// opening state (the sim's own draw, so an untouched screen fields exactly
// what it always did), `toggleEntry` is the only way a body goes in or out,
// `slotsLeft` and `isComplete` say whether Deploy may go. A swap is two of
// those toggles, out then in -- never a second rule.
//
// What this does NOT show is the brigade's size (ruling L-4): the deploy
// screen's only reserve number is per place, "⇄ N", the other bodies of that
// type that could go instead. "119 in reserve" -- the whole cumulative pool
// minus five -- was a number nobody could act on. The brigade's total is the
// Brigade screen's line (`garage.brigade`).

import { t } from '../i18n/t';
import type { DeployEntry, DeployRosterView } from './deploy-roster';
import { defaultSelection, isComplete, toggleEntry, type DeploySelection } from './deploy-select';
import { unitIcon } from './portrait';
import { veteranEffect } from './veteran-effect';

/** A body the mission brings itself, not drawn from the roster. */
export interface AttachedUnit {
  type: string;
  name: string;
  count: number;
}

/** The bench's order: stripes, then missions, then kills, then pool order --
 *  `roster-cap.ts`'s `rosterOrder` with the pool index standing in for the
 *  slot it does not have here. A record before no record. */
export function benchOrder(a: DeployEntry, b: DeployEntry): number {
  return b.veterancy - a.veterancy || b.missions - a.missions || b.kills - a.kills || a.poolIndex - b.poolIndex;
}

const hasRecord = (e: DeployEntry): boolean => e.veterancy > 0 || e.missions > 0 || e.kills > 0 || e.name !== undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function stars(n: number): HTMLSpanElement {
  // The `★` here is the countable mark (validate_ui_palette.mjs's Q5
  // exception), drawn the way `loading.ts`'s `commendation` draws it.
  return el('span', 'rl-commend', '★'.repeat(n));
}

function picture(type: string): HTMLElement {
  const box = el('span', 'rl-force__pic');
  const icon = unitIcon(type, 'full');
  if (icon) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = icon.url;
    img.addEventListener('error', () => img.remove());
    box.appendChild(img);
  }
  return box;
}

export interface ForceBar {
  el: HTMLElement;
  /** The current pick. */
  selection(): DeploySelection;
  /** Close the bench if it is open; true when it was. The briefing's Escape
   *  asks this first. */
  dismiss(): boolean;
}

export function forceBar(opts: {
  view: DeployRosterView | null;
  attached: readonly AttachedUnit[];
  /** Lines the ledger hands this screen (`broughtFor`'s sentences). */
  notes?: readonly string[];
  deploy: HTMLButtonElement;
  back?: HTMLButtonElement | null;
  /** A unit type's display name, for a demanded place the pool cannot fill. */
  unitName?: (type: string) => string;
  onChange(sel: DeploySelection): void;
}): ForceBar {
  const { view } = opts;
  let sel: DeploySelection = view ? defaultSelection(view) : { chosen: new Set() };

  const bar = el('section', 'rl-force');
  bar.setAttribute('aria-labelledby', 'rl-force-title');
  const head = el('div', 'rl-force__head');
  const title = el('h2', 'rl-force__title', t('deploy.force'));
  title.id = 'rl-force-title';
  const placed = el('div', 'rl-force__placed');
  const hint = el('p', 'rl-force__hint', t(view !== null && view.eligible.length > 0 ? 'deploy.hint' : 'deploy.hint.fixed'));
  head.append(title, placed, hint);
  for (const n of opts.notes ?? []) head.appendChild(el('p', 'rl-force__note', n));

  const slots = el('ul', 'rl-force__slots');
  const go = el('div', 'rl-force__go');
  if (opts.back) go.appendChild(opts.back);
  go.appendChild(opts.deploy);
  bar.append(head, slots, go);

  let bench: HTMLElement | null = null;
  /** Where focus goes when the bench closes: the place it was opened from,
   *  found AFTER any repaint (the old card is gone by then), by its key. */
  let benchFrom: string | null = null;
  const focusPlace = (key: string | null): void => {
    if (key === null) return;
    slots.querySelector<HTMLElement>(`[data-place="${key}"]`)?.focus({ preventScroll: true });
  };
  const closeBench = (): boolean => {
    if (!bench) return false;
    bench.remove();
    bench = null;
    focusPlace(benchFrom);
    benchFrom = null;
    return true;
  };

  const demanded = view ? [...view.demand.entries()] : [];
  const totalPlaces = demanded.reduce((n, [, c]) => n + c, 0);
  const ofType = (type: string): DeployEntry[] => (view ? view.eligible.filter((e) => e.type === type) : []);

  /** Who stands in each place, by type and place index. The RULES stay
   *  `deploy-select.ts`'s (`sel`); this only keeps the cards from reshuffling
   *  when a swap changes who is chosen: a pick lands in the place that was
   *  clicked. Seeded from `defaultSelection` in pool order. */
  const places = new Map<string, (number | null)[]>();
  for (const [type, count] of demanded) {
    const going = ofType(type).filter((e) => sel.chosen.has(e.poolIndex)).map((e) => e.poolIndex);
    places.set(type, Array.from({ length: count }, (_, i) => going[i] ?? null));
  }

  /** Put `entry` in place `index` of `type` (swapping out whoever is there),
   *  or -- picking the body already in that place -- leave the place open. */
  const pick = (type: string, index: number, entry: DeployEntry): void => {
    if (!view) return;
    const row = places.get(type);
    if (!row) return;
    const current = row[index];
    let next = sel;
    if (current === entry.poolIndex) {
      next = toggleEntry(view, next, entry.poolIndex);
      if (next !== sel) row[index] = null;
    } else {
      if (current !== null) next = toggleEntry(view, next, current);
      next = toggleEntry(view, next, entry.poolIndex);
      if (next !== sel && next.chosen.has(entry.poolIndex)) row[index] = entry.poolIndex;
    }
    if (next === sel) return;
    sel = next;
    paint();
    opts.onChange(sel);
  };

  const openBench = (type: string, index: number): void => {
    if (bench) closeBench();
    const row = places.get(type) ?? [];
    const current = row[index] ?? null;
    const all = ofType(type).sort(benchOrder);
    const recorded = all.filter(hasRecord);
    const fresh = all.filter((e) => !hasRecord(e));
    const typeName = all[0]?.typeName ?? type;
    const b = el('div', 'rl-force__bench');
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', t('deploy.bench.title', { type: typeName }));
    b.appendChild(el('div', 'rl-force__bench-title', t('deploy.bench.title', { type: typeName })));
    const list = el('ul', 'rl-force__bench-rows');
    const benchRow = (e: DeployEntry): HTMLLIElement => {
      const li = document.createElement('li');
      const btn = el('button', 'rl-force__bench-row');
      btn.type = 'button';
      btn.dataset.poolIndex = String(e.poolIndex);
      const here = e.poolIndex === current;
      // Going in ANOTHER place of this type: not a pick from here -- it would
      // empty that place instead of filling this one.
      const elsewhere = !here && sel.chosen.has(e.poolIndex);
      btn.setAttribute('aria-pressed', String(here));
      if (elsewhere) btn.disabled = true;
      btn.append(picture(e.type), el('span', 'rl-force__bench-name', e.name ?? e.typeName));
      if (e.veterancy > 0) btn.append(stars(e.veterancy));
      const rec = e.missions > 0 || e.kills > 0 ? t('hud.card.record', { missions: e.missions, kills: e.kills }) : '';
      const state = here ? 'deploy.bench.here' : elsewhere ? 'deploy.bench.fielded' : 'deploy.bench.base';
      btn.append(el('span', 'rl-force__bench-rec', rec), el('span', 'rl-force__bench-state', t(state)));
      btn.addEventListener('click', () => {
        pick(type, index, e);
        closeBench();
      });
      li.appendChild(btn);
      return li;
    };
    for (const e of recorded) list.appendChild(benchRow(e));
    if (fresh.length > 0) {
      // Unrecorded bodies are interchangeable: one line, opened on demand.
      const li = document.createElement('li');
      const more = el('button', 'rl-force__bench-more', t('deploy.bench.fresh', { n: fresh.length }));
      more.type = 'button';
      more.addEventListener('click', () => {
        const rows = fresh.map(benchRow);
        li.replaceWith(...rows);
        // The button that had focus is gone: keep focus inside the bench.
        rows[0]?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
      });
      li.appendChild(more);
      list.appendChild(li);
    }
    b.appendChild(list);
    const close = el('button', 'rl-btn rl-force__bench-close', t('deploy.bench.close'));
    close.type = 'button';
    close.addEventListener('click', () => void closeBench());
    b.appendChild(close);
    // Escape closes the bench, and only the bench. The briefing's own Escape
    // (back to the campaign map) also asks `dismiss()` first, so a focus that
    // has wandered out of the bench still closes it rather than leaving.
    b.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      closeBench();
    });
    bar.appendChild(b);
    bench = b;
    benchFrom = `${type}:${index}`;
    b.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
  };

  /** Whether any place here is the player's to fill. */
  const choosing = view !== null && view.eligible.length > 0;
  const unitName = (type: string): string => opts.attached.find((a) => a.type === type)?.name ?? opts.unitName?.(type) ?? type;
  const fixedCard = (type: string, name: string, note: string | null): HTMLLIElement => {
    const li = document.createElement('li');
    const card = el('div', 'rl-force__slot rl-force__slot--fixed');
    card.dataset.type = type;
    card.appendChild(picture(type));
    const body = el('span', 'rl-force__body');
    body.append(el('span', 'rl-force__name', name));
    if (note) body.append(el('span', 'rl-force__type', note));
    card.appendChild(body);
    li.appendChild(card);
    return li;
  };

  const paint = (): void => {
    slots.innerHTML = '';
    let filled = 0;
    for (const [type, count] of demanded) {
      const pool = ofType(type);
      if (pool.length === 0) {
        // Nobody of this type in the pool: the spawner fields a fresh remnant
        // for each place (`mission.ts`), and there is nothing to choose.
        for (let i = 0; i < count; i++) slots.appendChild(fixedCard(type, unitName(type), t('deploy.fresh')));
        filled += count;
        continue;
      }
      const row = places.get(type) ?? [];
      const going = row.filter((x) => x !== null).length;
      const others = pool.length - going;
      for (let i = 0; i < count; i++) {
        const entry = pool.find((e) => e.poolIndex === row[i]) ?? null;
        if (entry) filled++;
        // A place with nobody else to put in it is not a control: there is no
        // choice to make (review: Sela alone opened a one-row bench).
        const interactive = !entry || others > 0;
        const li = document.createElement('li');
        const card = el(interactive ? 'button' : 'div', `rl-force__slot${entry && entry.veterancy > 0 ? ' rl-force__slot--vet' : ''}${entry ? '' : ' rl-force__slot--open'}${interactive ? '' : ' rl-force__slot--only'}`);
        if (card instanceof HTMLButtonElement) {
          card.type = 'button';
          card.setAttribute('aria-haspopup', 'dialog');
          card.addEventListener('click', () => openBench(type, i));
        }
        card.dataset.type = type;
        card.dataset.place = `${type}:${i}`;
        if (entry) card.dataset.poolIndex = String(entry.poolIndex);
        card.appendChild(picture(type));
        const body = el('span', 'rl-force__body');
        if (entry) {
          const name = el('span', 'rl-force__name', entry.name ?? entry.typeName);
          if (entry.veterancy > 0) name.append(' ', stars(entry.veterancy));
          body.append(name);
          if (entry.name !== undefined) body.append(el('span', 'rl-force__type', entry.typeName));
          if (entry.missions > 0 || entry.kills > 0) {
            body.append(el('span', 'rl-force__rec', t('hud.card.record', { missions: entry.missions, kills: entry.kills })));
          } else if (entry.name === undefined) {
            body.append(el('span', 'rl-force__rec', t('deploy.fresh')));
          }
          const fx = veteranEffect(entry.veterancy);
          if (fx) body.append(el('span', 'rl-force__fx', fx));
        } else {
          const typeName = pool[0]?.typeName ?? type;
          body.append(el('span', 'rl-force__name', t('deploy.slot.open')), el('span', 'rl-force__type', typeName));
        }
        card.appendChild(body);
        if (interactive) {
          const swap = el('span', 'rl-force__swap', t('deploy.swap', { n: others }));
          swap.setAttribute('aria-label', t('deploy.swap.aria', { n: others }));
          card.appendChild(swap);
        }
        li.appendChild(card);
        slots.appendChild(li);
      }
    }
    for (const a of opts.attached) {
      const note = choosing ? t('deploy.attached') : null;
      for (let i = 0; i < a.count; i++) slots.appendChild(fixedCard(a.type, a.name, note));
    }
    placed.textContent = totalPlaces > 0 ? t('deploy.placed', { n: filled, of: totalPlaces }) : '';
    placed.hidden = totalPlaces === 0;
    opts.deploy.disabled = view ? !isComplete(view, sel) : false;
  };
  paint();

  return { el: bar, selection: () => sel, dismiss: closeBench };
}
