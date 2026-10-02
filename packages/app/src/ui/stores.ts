// The Stores: the garage's second tab (GH-317, spec 2026-10-01 §2), drawn as
// a PREVIEW. The lead asked to see it before the server account exists, so
// it is visible to everyone, and it sells nothing: the balance reads 0, every
// coin Buy and every pack is disabled (`buyEnabled`, the one predicate they
// all ask), and one line says purchases open when online accounts arrive.
// This module writes no storage, calls no network and never reaches the
// brigade account; the garage's own credit purchases are untouched.
//
// Three shelves (the lead's ruling): Early access (every unit unlock, special
// forces and upgrade tier, each with both prices and how far the earned path
// is), Cosmetics (empty until ST8's catalogue), and Receipts (empty, and says
// why). The coin pack row sits under the wallet on every shelf.
//
// The disposer contract (CLAUDE.md, "The disposer contract"): everything this
// mounts lives inside `host`, every listener is on a node it owns, and the
// returned disposer removes the lot. Nothing goes on `document.body` or
// `window`.
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import {
  COIN_PACKS,
  PREVIEW_BALANCE,
  buyEnabled,
  packBonusPercent,
  storeItems,
  type Honest,
  type StoreInput,
  type TierItem,
  type UnitItem,
} from './stores-model';
import { rovingStep } from './garage-model';

export type StoresShelf = 'early' | 'cosmetics' | 'receipts';
const SHELVES: readonly StoresShelf[] = ['early', 'cosmetics', 'receipts'];

export interface StoresOptions extends StoreInput {
  /** The Roar coin art (`assets/ui/roar_coin/`), by pixel size. */
  coinSrc: (size: 16 | 24 | 48) => string;
  /** A mission id to its player-facing title, for an `after mission` gate. */
  missionName: (id: string) => string | undefined;
  /** The rail portrait for a unit, as the garage resolves it. */
  portrait?: (unitId: string) => string | null;
  /** "Open in the brigade": the garage switches tab and selects the unit. */
  onOpenUnit?: (unitId: string) => void;
  /** The shelf to open on (default `early`). */
  shelf?: StoresShelf;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The coin, as an image. Decorative: the word beside it always names it. */
function coinImg(src: string, size: number, cls: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = cls;
  img.src = src;
  img.alt = '';
  img.width = size;
  img.height = size;
  img.decoding = 'async';
  return img;
}

/** The honest line as a sentence (spec §2.4, G7): the model computes the
 *  numbers, this only words them. */
export function honestText(h: Honest, missionName: (id: string) => string | undefined): string {
  switch (h.kind) {
    case 'earnedGate':
      return t('stores.honest.earnedGate');
    case 'earnedCredits':
      return t('stores.honest.earnedCredits');
    case 'earnedStart':
      return t('stores.honest.earnedStart');
    case 'owned':
      return t('stores.honest.owned');
    case 'conduct':
      return t('stores.honest.conduct', { floor: h.floor });
    case 'stars':
      return t('stores.honest.stars', { n: h.missions, have: h.have, need: h.need });
    case 'mission':
      return t('stores.honest.mission', { mission: missionName(h.missionId) ?? t('stores.honest.mission.unnamed') });
    case 'pay':
      return t('stores.honest.pay', { n: h.missions });
    case 'payNow':
      return t('stores.honest.payNow');
    case 'unlockFirst':
      return t('stores.honest.unlockFirst');
    case 'unreachable':
      return t('stores.honest.unreachable', { lifetime: h.lifetime });
  }
}

export function showStores(host: HTMLElement, opts: StoresOptions): Disposer {
  const root = el('section', 'rl-stores');
  root.setAttribute('aria-label', t('stores.tab'));

  // --- wallet: the 48 px coin, a zero balance, and the honest preview line ---
  const head = el('div', 'rl-stores__head');
  const wallet = el('div', 'rl-stores__wallet');
  wallet.appendChild(coinImg(opts.coinSrc(48), 48, 'rl-stores__wallet-coin'));
  const walletN = el('span', 'rl-stores__wallet-n', String(PREVIEW_BALANCE));
  walletN.dataset.value = String(PREVIEW_BALANCE);
  wallet.append(walletN, el('span', 'rl-stores__wallet-word', t('stores.wallet.word', { n: PREVIEW_BALANCE })));
  head.appendChild(wallet);
  const notice = el('p', 'rl-stores__notice', t('stores.offline'));
  notice.setAttribute('role', 'note');
  head.appendChild(notice);
  root.appendChild(head);

  // --- packs: price and bonus, every one disabled ---------------------------
  const packs = el('div', 'rl-stores__packs');
  packs.setAttribute('role', 'group');
  packs.setAttribute('aria-label', t('stores.packs.label'));
  for (const pack of COIN_PACKS) {
    const card = el('div', 'rl-stores__pack');
    card.dataset.pack = pack.id;
    card.appendChild(el('div', 'rl-stores__pack-name', t(`stores.pack.${pack.id}`)));
    const amount = el('div', 'rl-stores__pack-coins');
    amount.appendChild(coinImg(opts.coinSrc(24), 24, 'rl-stores__coin'));
    amount.appendChild(el('span', 'rl-stores__coin-n', String(pack.coins)));
    amount.appendChild(el('span', 'rl-stores__pack-word', t('stores.wallet.word', { n: pack.coins })));
    card.appendChild(amount);
    const bonus = packBonusPercent(pack);
    card.appendChild(
      el('div', 'rl-stores__pack-bonus', bonus > 0 ? t('stores.pack.bonus', { n: bonus }) : t('stores.pack.noBonus'))
    );
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'rl-stores__buy rl-stores__buy--pack';
    buy.dataset.buy = `pack:${pack.id}`;
    buy.textContent = t('stores.pack.price', { price: (pack.usdCents / 100).toFixed(2) });
    buy.disabled = !buyEnabled(pack);
    buy.setAttribute('aria-label', t('stores.pack.aria', { name: t(`stores.pack.${pack.id}`), n: pack.coins, price: (pack.usdCents / 100).toFixed(2) }));
    card.appendChild(buy);
    packs.appendChild(card);
  }
  root.appendChild(packs);

  // --- shelves: a tablist, Left/Right/Home/End, the garage's F8 pattern ----
  const tabs = el('div', 'rl-stores__shelves');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('stores.shelves.label'));
  const panels = el('div', 'rl-stores__panels');
  const tabEls = new Map<StoresShelf, HTMLButtonElement>();
  const panelEls = new Map<StoresShelf, HTMLElement>();
  let shelf: StoresShelf = opts.shelf ?? 'early';
  for (const s of SHELVES) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'rl-stores__shelf';
    tab.id = `rl-stores-tab-${s}`;
    tab.dataset.shelf = s;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `rl-stores-panel-${s}`);
    tab.textContent = t(`stores.shelf.${s}`);
    tab.addEventListener('click', () => {
      shelf = s;
      syncShelves();
    });
    tabEls.set(s, tab);
    tabs.appendChild(tab);
    const panel = el('div', 'rl-stores__panel');
    panel.id = `rl-stores-panel-${s}`;
    panel.dataset.shelf = s;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panelEls.set(s, panel);
    panels.appendChild(panel);
  }
  tabs.addEventListener('keydown', (ev: KeyboardEvent) => {
    const order = [...tabEls.entries()];
    const at = order.findIndex(([, tab]) => tab === document.activeElement);
    const to = rovingStep(ev.key, at, order.length);
    if (to === null || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') return;
    ev.preventDefault();
    shelf = order[to][0];
    syncShelves();
    order[to][1].focus();
  });
  function syncShelves(): void {
    for (const [s, tab] of tabEls) {
      const on = s === shelf;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      const panel = panelEls.get(s);
      if (panel !== undefined) panel.hidden = !on;
    }
  }
  root.append(tabs, panels);

  // --- Early access --------------------------------------------------------
  const items = storeItems(opts);
  const early = panelEls.get('early');
  if (early !== undefined) {
    early.appendChild(el('p', 'rl-stores__lede', t('stores.lede')));
    early.appendChild(el('h3', 'rl-stores__shelf-h', t('stores.section.units')));
    const unitGrid = el('div', 'rl-stores__cards');
    for (const item of items.units) unitGrid.appendChild(unitCard(item, opts));
    early.appendChild(unitGrid);
    early.appendChild(el('h3', 'rl-stores__shelf-h', t('stores.section.tiers')));
    const tierGrid = el('div', 'rl-stores__cards');
    const byUnit = new Map<string, TierItem[]>();
    for (const tier of items.tiers) {
      const list = byUnit.get(tier.unitId) ?? [];
      list.push(tier);
      byUnit.set(tier.unitId, list);
    }
    for (const list of byUnit.values()) tierGrid.appendChild(tierCard(list, opts));
    early.appendChild(tierGrid);
  }

  // --- Cosmetics and Receipts: empty, and each says why -------------------
  panelEls.get('cosmetics')?.appendChild(el('p', 'rl-stores__empty', t('stores.empty.cosmetics')));
  panelEls.get('receipts')?.appendChild(el('p', 'rl-stores__empty', t('stores.empty.receipts')));

  syncShelves();
  host.appendChild(root);
  return () => {
    root.remove();
  };
}

/** A price pair: the credit figure in its own colour, then the coin. */
function pricePair(credits: number, coins: number, opts: StoresOptions, have?: number): HTMLElement {
  const line = el('div', 'rl-stores__price');
  line.appendChild(el('span', 'rl-stores__credits', t('stores.price.credits', { n: credits })));
  if (have !== undefined) line.appendChild(el('span', 'rl-stores__have', t('stores.price.have', { n: have })));
  line.appendChild(el('span', 'rl-stores__or', t('stores.price.or')));
  const coin = el('span', 'rl-stores__coin-price');
  coin.appendChild(coinImg(opts.coinSrc(24), 24, 'rl-stores__coin'));
  coin.appendChild(el('span', 'rl-stores__coin-n', String(coins)));
  coin.appendChild(el('span', 'rl-stores__coin-word', t('stores.wallet.word', { n: coins })));
  line.appendChild(coin);
  return line;
}

function coinBuy(coins: number, label: string, enabled: boolean, opts: StoresOptions, key: string): HTMLButtonElement {
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'rl-stores__buy';
  buy.dataset.buy = key;
  buy.appendChild(coinImg(opts.coinSrc(24), 24, 'rl-stores__coin'));
  buy.appendChild(el('span', '', t('stores.buy.coins', { n: coins })));
  buy.setAttribute('aria-label', label);
  buy.disabled = !enabled;
  return buy;
}

function unitCard(item: UnitItem, opts: StoresOptions): HTMLElement {
  const card = el('article', 'rl-stores__card');
  card.dataset.item = item.id;
  card.dataset.state = item.state;
  const top = el('div', 'rl-stores__card-top');
  const name = el('h4', 'rl-stores__card-name', item.name);
  top.appendChild(name);
  top.appendChild(el('span', `rl-stores__state rl-stores__state--${item.state}`, t(`stores.state.${item.state}`)));
  card.appendChild(top);
  if (item.specialForces) card.appendChild(el('div', 'rl-stores__tag', t('garage.tag.special')));
  const src = opts.portrait?.(item.id) ?? null;
  if (src !== null) {
    const img = document.createElement('img');
    img.className = 'rl-stores__card-art';
    img.src = src;
    img.alt = '';
    card.appendChild(img);
  }
  if (item.credits !== undefined && item.coins !== undefined) {
    const showHave = item.state !== 'earned' && opts.credits !== undefined;
    card.appendChild(pricePair(item.credits, item.coins, opts, showHave ? opts.credits : undefined));
  }
  card.appendChild(el('div', 'rl-stores__honest', honestText(item.honest, opts.missionName)));
  const btns = el('div', 'rl-stores__btns');
  if (item.state === 'offSale') {
    btns.appendChild(el('span', 'rl-stores__offsale', t('stores.offSale')));
  } else if (item.state !== 'earned' && item.coins !== undefined) {
    btns.appendChild(
      coinBuy(item.coins, t('stores.buy.aria', { name: item.name, n: item.coins }), buyEnabled(item), opts, `unit:${item.id}`)
    );
  }
  if (opts.onOpenUnit !== undefined) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'rl-stores__open';
    open.textContent = t('stores.openInBrigade');
    open.setAttribute('aria-label', t('stores.openInBrigade.aria', { name: item.name }));
    const go = opts.onOpenUnit;
    open.addEventListener('click', () => go(item.id));
    btns.appendChild(open);
  }
  card.appendChild(btns);
  return card;
}

function tierCard(list: readonly TierItem[], opts: StoresOptions): HTMLElement {
  const first = list[0];
  const card = el('article', 'rl-stores__card rl-stores__card--tiers');
  card.dataset.item = `tiers:${first.unitId}`;
  card.appendChild(el('h4', 'rl-stores__card-name', first.unitName));
  for (const item of list) {
    const row = el('div', 'rl-stores__tier');
    row.dataset.track = item.track;
    row.dataset.state = item.state;
    const head = el('div', 'rl-stores__tier-head');
    head.appendChild(el('span', 'rl-stores__tier-track', t(`garage.track.${item.track}`)));
    const pips = el('span', 'rl-stores__pips');
    pips.setAttribute('role', 'img');
    pips.setAttribute('aria-label', t('garage.track.tierOf', { n: item.owned, m: item.length }));
    for (let i = 0; i < item.length; i++) {
      const pip = el('i', i < item.owned ? 'rl-stores__pip rl-stores__pip--earned' : 'rl-stores__pip');
      pips.appendChild(pip);
    }
    head.appendChild(pips);
    head.appendChild(el('span', `rl-stores__state rl-stores__state--${item.state}`, t(`stores.state.${item.state}`)));
    row.appendChild(head);
    if (item.next !== null) {
      row.appendChild(el('div', 'rl-stores__tier-next', t('stores.tier.next', { tier: item.next.tier })));
      row.appendChild(pricePair(item.next.credits, item.next.coins, opts));
    }
    row.appendChild(el('div', 'rl-stores__honest', honestText(item.honest, opts.missionName)));
    if (item.next !== null && item.state !== 'offSale') {
      const label = t('stores.buy.tier.aria', {
        name: item.unitName,
        track: t(`garage.track.${item.track}`),
        tier: item.next.tier,
        n: item.next.coins,
      });
      row.appendChild(coinBuy(item.next.coins, label, buyEnabled(item), opts, `tier:${item.unitId}.${item.track}.${item.next.tier}`));
    } else if (item.state === 'offSale') {
      row.appendChild(el('span', 'rl-stores__offsale', t('stores.offSale')));
    }
    card.appendChild(row);
  }
  return card;
}
