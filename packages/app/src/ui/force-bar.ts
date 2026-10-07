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
import { defaultSelection, isComplete, slotsLeft, toggleEntry, type DeploySelection } from './deploy-select';
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
  const closeBench = (): void => {
    bench?.remove();
    bench = null;
  };

  const demanded = view ? [...view.demand.entries()] : [];
  const totalPlaces = demanded.reduce((n, [, c]) => n + c, 0);
  const ofType = (type: string): DeployEntry[] => (view ? view.eligible.filter((e) => e.type === type) : []);

  /** Pick `entry` for the place `current` holds (null: an open place). */
  const pick = (type: string, current: DeployEntry | null, entry: DeployEntry): void => {
    if (!view) return;
    let next = sel;
    if (sel.chosen.has(entry.poolIndex)) {
      // The one already going: picking it again benches it, leaving the place open.
      next = toggleEntry(view, next, entry.poolIndex);
    } else {
      if (current && slotsLeft(view, next, type) <= 0) next = toggleEntry(view, next, current.poolIndex);
      next = toggleEntry(view, next, entry.poolIndex);
    }
    if (next === sel) return;
    sel = next;
    paint();
    opts.onChange(sel);
  };

  const openBench = (type: string, current: DeployEntry | null, anchor: HTMLElement): void => {
    closeBench();
    const all = ofType(type).sort(benchOrder);
    const recorded = all.filter(hasRecord);
    const fresh = all.filter((e) => !hasRecord(e));
    const typeName = all[0]?.typeName ?? type;
    const b = el('div', 'rl-force__bench');
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', t('deploy.bench.title', { type: typeName }));
    b.appendChild(el('div', 'rl-force__bench-title', t('deploy.bench.title', { type: typeName })));
    const list = el('ul', 'rl-force__bench-rows');
    const row = (e: DeployEntry): HTMLLIElement => {
      const li = document.createElement('li');
      const btn = el('button', 'rl-force__bench-row');
      btn.type = 'button';
      btn.dataset.poolIndex = String(e.poolIndex);
      const going = sel.chosen.has(e.poolIndex);
      btn.setAttribute('aria-pressed', String(going));
      btn.append(picture(e.type), el('span', 'rl-force__bench-name', e.name ?? e.typeName));
      if (e.veterancy > 0) btn.append(stars(e.veterancy));
      const rec = e.missions > 0 || e.kills > 0 ? t('hud.card.record', { missions: e.missions, kills: e.kills }) : '';
      btn.append(el('span', 'rl-force__bench-rec', rec), el('span', 'rl-force__bench-state', t(going ? 'deploy.bench.fielded' : 'deploy.bench.base')));
      btn.addEventListener('click', () => {
        pick(type, current, e);
        closeBench();
        anchor.focus({ preventScroll: true });
      });
      li.appendChild(btn);
      return li;
    };
    for (const e of recorded) list.appendChild(row(e));
    if (fresh.length > 0) {
      // Unrecorded bodies are interchangeable: one line, opened on demand.
      const li = document.createElement('li');
      const more = el('button', 'rl-force__bench-more', t('deploy.bench.fresh', { n: fresh.length, type: typeName }));
      more.type = 'button';
      more.addEventListener('click', () => {
        li.replaceWith(...fresh.map(row));
      });
      li.appendChild(more);
      list.appendChild(li);
    }
    b.appendChild(list);
    const close = el('button', 'rl-btn rl-force__bench-close', t('deploy.bench.close'));
    close.type = 'button';
    close.addEventListener('click', () => {
      closeBench();
      anchor.focus({ preventScroll: true });
    });
    b.appendChild(close);
    // Escape closes the bench, and only the bench: the briefing's own Escape
    // (back to the campaign map) listens on `window`, which this stops short of.
    b.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      closeBench();
      anchor.focus({ preventScroll: true });
    });
    bar.appendChild(b);
    bench = b;
    b.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
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
      const going = ofType(type).filter((e) => sel.chosen.has(e.poolIndex));
      const others = ofType(type).length - going.length;
      if (ofType(type).length === 0) {
        // Nobody of this type in the pool: the spawner fields a fresh remnant
        // for each place (`mission.ts`), and there is nothing to choose.
        for (let i = 0; i < count; i++) slots.appendChild(fixedCard(type, unitName(type), t('deploy.fresh')));
        filled += count;
        continue;
      }
      for (let i = 0; i < count; i++) {
        const entry = going[i] ?? null;
        if (entry) filled++;
        const li = document.createElement('li');
        const card = el('button', `rl-force__slot${entry && entry.veterancy > 0 ? ' rl-force__slot--vet' : ''}${entry ? '' : ' rl-force__slot--open'}`);
        card.type = 'button';
        card.dataset.type = type;
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
          card.setAttribute('aria-label', t('deploy.swap.aria', { name: entry.name ?? entry.typeName, n: others }));
        } else {
          const typeName = ofType(type)[0]?.typeName ?? type;
          body.append(el('span', 'rl-force__name', t('deploy.slot.open')), el('span', 'rl-force__type', typeName));
          card.setAttribute('aria-label', t('deploy.slot.open.aria', { type: typeName }));
        }
        card.appendChild(body);
        if (others > 0 || !entry) card.appendChild(el('span', 'rl-force__swap', t('deploy.swap', { n: others })));
        card.addEventListener('click', () => openBench(type, entry, card));
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

  return { el: bar, selection: () => sel };
}
