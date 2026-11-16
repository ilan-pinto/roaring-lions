/**
 * The coin history table of the account page's Roar coins card (GH-1370 C4). Wording per journal kind, one row each;
 * every string goes through `t()` at call time (no label table at module load) and every dynamic value, a mission or
 * unit name and the admin's note included, is set with `textContent`. A raw id is never shown: an id this build no
 * longer knows gets the generic wording.
 */
import type { CoinRowView, CoinWhat, CoinsView } from '@lions/economy';
import type { CallResult } from '../account/client';
import { hasKey, t } from '../i18n/t';

/** The catalogue lookups the wording needs. Each returns undefined for an id this build does not know. */
export interface CoinNames {
  mission: (id: string) => string | undefined;
  unit: (id: string) => string | undefined;
}

const NO_NAMES: CoinNames = { mission: () => undefined, unit: () => undefined };

/** A row the table draws: any movement of coins, and the guest-to-account move even at 0 (D6). */
export function shownRow(r: CoinRowView): boolean {
  return r.delta !== 0 || r.what.kind === 'move';
}

/** The "what" cell's main line (the admin note is a second line, `noteOf`). */
export function coinWhatText(what: CoinWhat, delta: number, names: CoinNames = NO_NAMES): string {
  switch (what.kind) {
    case 'earn': {
      const mission = what.missionId === undefined ? undefined : names.mission(what.missionId);
      switch (what.source) {
        case 'welcome':
          return t('profile.coins.row.welcome');
        case 'first_win':
          return mission === undefined ? t('profile.coins.row.firstWin.unknown') : t('profile.coins.row.firstWin', { mission });
        case 'star':
          return mission === undefined ? t('profile.coins.row.star.unknown') : t('profile.coins.row.star', { mission });
        case 'campaign':
          return t('profile.coins.row.campaign');
        case 'challenge':
          return mission === undefined ? t('profile.coins.row.challenge.unknown') : t('profile.coins.row.challenge', { mission });
        default:
          return t('profile.coins.row.reward');
      }
    }
    case 'move':
      return t('profile.coins.row.move');
    case 'unit': {
      const unit = names.unit(what.unitId);
      if (what.moved) return unit === undefined ? t('profile.coins.row.moved.unknown') : t('profile.coins.row.moved', { item: unit });
      return unit === undefined ? t('profile.coins.row.unit.unknown') : t('profile.coins.row.unit', { unit });
    }
    case 'tier': {
      const unit = names.unit(what.unitId);
      const trackKey = `garage.track.${what.track}`;
      if (unit === undefined || !hasKey(trackKey)) return t(what.moved ? 'profile.coins.row.moved.unknown' : 'profile.coins.row.tier.unknown');
      const item = t('stores.receipt.tier', { name: unit, track: t(trackKey), tier: what.tier });
      return what.moved ? t('profile.coins.row.moved', { item }) : t('profile.coins.row.unit', { unit: item });
    }
    case 'coupon':
      return t('profile.coins.row.coupon');
    case 'reset':
      return t('profile.coins.row.reset');
    case 'team':
      return t(delta < 0 ? 'profile.coins.row.team.minus' : 'profile.coins.row.team.plus');
    case 'other':
      return t('profile.coins.row.other');
  }
}

/** The admin's player-facing note, or undefined. Admin-typed text: only ever a text node. */
export function noteOf(what: CoinWhat): string | undefined {
  return what.kind === 'team' && what.note !== undefined && what.note !== '' ? what.note : undefined;
}

/** `+n`, `−n` (U+2212) or `0`: the sign carries the meaning, colour is never the only signal. */
export function coinAmountText(delta: number): string {
  if (delta > 0) return t('profile.coins.plus', { n: delta });
  if (delta < 0) return t('profile.coins.minus', { n: -delta });
  return t('profile.coins.zero');
}

function cell(tag: 'td' | 'th', cls: string): HTMLTableCellElement {
  const c = document.createElement(tag);
  if (cls !== '') c.className = cls;
  return c;
}

export function coinRowElement(r: CoinRowView, names: CoinNames): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'rl-profile__coin-row';
  tr.dataset.kind = r.what.kind;
  const when = new Date(r.at);
  const whenCell = cell('td', 'rl-profile__coin-when');
  const date = document.createElement('span');
  date.className = 'rl-profile__coin-date';
  date.textContent = when.toLocaleDateString();
  const time = document.createElement('span');
  time.className = 'rl-profile__coin-time';
  time.textContent = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  whenCell.append(date, document.createTextNode(' '), time);
  const whatCell = cell('td', 'rl-profile__coin-what');
  const main = document.createElement('span');
  main.className = 'rl-profile__coin-main';
  main.textContent = coinWhatText(r.what, r.delta, names);
  whatCell.appendChild(main);
  const note = noteOf(r.what);
  if (note !== undefined) {
    const q = document.createElement('span');
    q.className = 'rl-profile__coin-note';
    q.textContent = t('profile.coins.note', { note });
    whatCell.appendChild(q);
  }
  const amount = cell('td', `rl-profile__coin-amount ${r.delta < 0 ? 'rl-profile__coin-amount--out' : 'rl-profile__coin-amount--in'}`);
  amount.textContent = coinAmountText(r.delta);
  tr.append(whenCell, whatCell, amount);
  return tr;
}

export interface CoinHistoryDeps {
  load: (before?: string) => Promise<CallResult<CoinsView>>;
  names: CoinNames;
  /** True once the screen has been disposed: a late answer is then ignored. */
  isDisposed: () => boolean;
  /** Called after each page lands, so the card can re-read the balance. */
  onPage?: () => void;
}

/** The history block: a status line, the table and "More". The first page is asked for at once. */
export function coinHistory(d: CoinHistoryDeps): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rl-profile__coin-history';
  const status = document.createElement('p');
  status.className = 'rl-profile__coin-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const table = document.createElement('table');
  table.className = 'rl-profile__coin-table';
  table.hidden = true;
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const k of ['when', 'what', 'coins'] as const) {
    const th = cell('th', 'rl-sr-only');
    th.scope = 'col';
    th.textContent = t(`profile.coins.col.${k}`);
    hr.appendChild(th);
  }
  head.appendChild(hr);
  const body = document.createElement('tbody');
  table.append(head, body);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'rl-btn rl-profile__more';
  more.textContent = t('profile.history.more');
  more.hidden = true;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'rl-btn rl-profile__coin-retry';
  retry.textContent = t('profile.coins.retry');
  retry.hidden = true;
  box.append(status, table, more, retry);

  /** The cursor of the page `more` and `retry` ask for next. */
  let cursor: string | undefined;
  let busy = false;
  const ask = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    more.disabled = true;
    retry.disabled = true;
    const r = await d.load(cursor);
    busy = false;
    if (d.isDisposed()) return;
    more.disabled = false;
    retry.disabled = false;
    if (!r.ok) {
      status.textContent = t(r.status === 429 ? 'profile.coins.limit' : 'profile.coins.needsConnection');
      retry.hidden = false;
      return;
    }
    status.textContent = '';
    retry.hidden = true;
    for (const row of r.body.rows) if (shownRow(row)) body.appendChild(coinRowElement(row, d.names));
    table.hidden = body.childElementCount === 0;
    cursor = r.body.next ?? undefined;
    more.hidden = r.body.next === null;
    if (r.body.next === null && body.childElementCount === 0) status.textContent = t('profile.coins.empty');
    d.onPage?.();
  };
  more.addEventListener('click', () => void ask());
  retry.addEventListener('click', () => void ask());
  void ask();
  return box;
}
