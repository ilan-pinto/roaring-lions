// The brigade: every KDF unit the campaign knows about, whether it is in reach
// yet, and — for the ones that are not — exactly what would open it. Pure DOM,
// no sim, the same shape as `debrief.ts` beside it.
import { conductAtLeast, starsEarned, unlockReason, type LedgerData, type UnlockGate } from '@lions/sim';
import { campaignRoe } from '../campaign';
import { panel } from './panel';

export interface BrigadeUnit {
  id: string;
  name: string;
  role: string;
  unlock?: UnlockGate;
}

export interface BrigadeOptions {
  units: BrigadeUnit[];
  ledger: LedgerData;
  /** Resolves a unit type to its selection-chip frame, the same lookup the
   *  HUD's own card uses (`ui/hud.ts`'s `portrait` dependency). `null` — for
   *  a type with no sheet, or when the caller has no resolver at all — draws
   *  the reserved hatch instead of a broken image. */
  portrait?: (typeId: string) => string | null;
  /** Every campaign mission grades to 3 stars; the tutorial carries none. */
  possibleStars: number;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * Which of `unlockReason`'s three checks is the one actually holding a unit
 * back, and the number that check reads by. Needed only to ORDER locked rows
 * "by the gate that opens soonest" — the reason sentence itself still comes
 * from `unlockReason`, unparsed. Mirrors that function's own precedence
 * (Conduct, then stars, then a named mission) so a row that is locked by its
 * stars gate is never mistaken for one locked by Conduct just because it also
 * declares a `roeMin` it has already cleared.
 *
 * The Conduct check uses `conductAtLeast` -- the exact `sum >= floor * count`
 * predicate `unlockReason` itself checks -- and not `campaignRoe`'s rounded
 * mean: two ratings of 39 and 40 against a floor of 40 round to a mean of 40
 * (reads as cleared) while the exact sum, 79, is short of 80 (still locked).
 * Sorting off the rounded figure could disagree with `unlockReason`'s own
 * verdict about which gate is binding.
 */
function bindingGate(unlock: UnlockGate, ledger: LedgerData): readonly [rank: number, value: number] {
  if (unlock.roeMin !== undefined && !conductAtLeast(ledger, unlock.roeMin)) {
    return [0, unlock.roeMin];
  }
  if (unlock.starsMin !== undefined) {
    if (starsEarned(ledger) < unlock.starsMin) return [1, unlock.starsMin];
  }
  return [2, 0]; // the mission gate — "last", and no threshold to sort within
}

export function showBrigade(host: HTMLElement, opts: BrigadeOptions): void {
  const p = panel({ rank: 'mission', title: 'The brigade', mark: true });
  const b = p.body;

  const head = el('div', 'rl-brigade__head');
  head.appendChild(el('div', 'rl-brigade__stars', `${starsEarned(opts.ledger)} of ${opts.possibleStars} stars`));
  const roe = campaignRoe(opts.ledger);
  head.appendChild(el('div', 'rl-brigade__conduct', roe !== null ? `Conduct ${roe.mean}` : 'no missions rated yet'));
  b.appendChild(head);

  // Available first; ties keep their given order (no gate to sort by).
  // Locked rows follow, ordered by the gate that opens soonest — a Conduct
  // floor, then a star count, then a named mission last — ties broken by name.
  const rows = opts.units.map((u) => ({ u, reason: unlockReason(u.unlock, opts.ledger) }));
  rows.sort((a, b2) => {
    const lockedA = a.reason !== null;
    const lockedB = b2.reason !== null;
    if (lockedA !== lockedB) return lockedA ? 1 : -1;
    if (!lockedA) return 0; // both available: stable, preserves input order
    const [rankA, valA] = bindingGate(a.u.unlock as UnlockGate, opts.ledger);
    const [rankB, valB] = bindingGate(b2.u.unlock as UnlockGate, opts.ledger);
    if (rankA !== rankB) return rankA - rankB;
    if (valA !== valB) return valA - valB;
    return a.u.name.localeCompare(b2.u.name);
  });

  const list = el('div', 'rl-brigade__list');
  for (const { u, reason } of rows) {
    const row = el('div', 'rl-brigade__row');
    row.dataset.unit = u.id;
    row.dataset.locked = reason !== null ? '1' : '0';

    const src = opts.portrait?.(u.id) ?? null;
    if (src !== null) {
      const img = document.createElement('img');
      img.className = 'rl-chip__art';
      img.src = src;
      img.alt = '';
      row.appendChild(img);
    } else {
      const art = document.createElement('div');
      art.className = 'rl-chip__art';
      art.dataset.nosprite = '1';
      art.title = `${u.id} — no sprite sheet`;
      row.appendChild(art);
    }

    row.appendChild(el('div', 'rl-brigade__name', u.name));
    row.appendChild(el('div', 'rl-brigade__role', u.role));
    row.appendChild(el('div', 'rl-brigade__why', reason ?? 'available'));
    if (u.unlock?.starsMin !== undefined) {
      row.appendChild(el('div', 'rl-brigade__gate', `★ ${u.unlock.starsMin}`));
    }
    list.appendChild(row);
  }
  b.appendChild(list);

  const nav = el('div', 'rl-endnav');
  const link = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.className = 'rl-btn';
    a.href = href;
    a.textContent = label;
    nav.appendChild(a);
  };
  link('campaign map', '?campaign');
  link('menu', '?');
  b.appendChild(nav);

  host.appendChild(p.el);
}
