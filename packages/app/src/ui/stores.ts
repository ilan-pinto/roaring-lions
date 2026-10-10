// The Stores: the garage's second tab (GH-317, spec 2026-10-01 §2).
//
// Without `?testcoins` it is a PREVIEW: the balance reads 0, every coin Buy
// and every pack is disabled (`buyEnabled`, the one predicate they all ask),
// and one line says purchases open when online accounts arrive.
//
// With `?testcoins` (the lead's go-ahead, 2 Oct) a local TEST wallet buys
// what credits buy, at 1 coin = 10 credits. This screen only ASKS (`onBuy`,
// `onGrant`); the caller writes `lions.roar.test` and redraws it. Real-money
// packs stay disabled either way. A TEST TOOL: anyone with the link can
// unlock things free on the live site, so it goes before release.
//
// The lead's declutter (2 Oct, "the store is too dense"):
//   * the default view lists only what can be bought; owned items sit behind
//     a "Show owned (N)" toggle, and off-sale items are one counted line;
//   * a card is a portrait, a name, ONE price line (coins first, credits
//     small), a short earned-path line on locked items only, and one Buy;
//   * the co-op/skirmish rule is said once, in the shelf's one-line intro;
//   * the packs are a compact "Get Roar coins" row beside the balance;
//   * fewer, larger cards (at most 4 a row at 1920, 3 at 1400), grouped
//     under Units, Special forces and Upgrades.
//
// The disposer contract (CLAUDE.md, "The disposer contract"): everything this
// mounts lives inside `host`, every listener is on a node it owns, and the
// returned disposer removes the lot. Nothing goes on `document.body` or
// `window`.
import { t } from '../i18n/t';
import type { RoarReceipt } from '../roar-test';
import type { Disposer } from '../shell/router';
import {
  COIN_PACKS,
  PREVIEW_WALLET,
  buyEnabled,
  coinCost,
  packBonusPercent,
  storeItems,
  type CoinAsk,
  type CoinWallet,
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
  /** The unit's picture (the garage rail's portrait resolver). */
  portrait?: (unitId: string) => string | null;
  /** The shelf to open on (default `early`). */
  shelf?: StoresShelf;
  /** Told whenever the shelf changes, so a redraw can reopen on it. */
  onShelf?: (shelf: StoresShelf) => void;
  /** Whether owned items are shown (default no). */
  showOwned?: boolean;
  /** Told when the "Show owned" toggle flips, so a redraw keeps it. */
  onShowOwned?: (on: boolean) => void;
  /** The TEST wallet (`?testcoins`, `roar-test.ts`). Absent: the preview,
   *  with a zero balance and every Buy disabled. */
  test?: StoresTestWallet;
  /** A Buy pressed with TEST coins. The caller buys, saves, and redraws the
   *  Stores; this screen only asks. */
  onBuy?: (ask: CoinAsk) => void;
  /** The TEST "Grant" control. The caller adds coins and redraws. */
  onGrant?: () => void;
  /** The `data-buy`/`data-focus` key of the control to focus after a redraw. */
  focusKey?: string;
}

export interface StoresTestWallet {
  readonly coins: number;
  /** What one press of the Grant button adds (the `?testcoins` amount). */
  readonly grant: number;
  readonly receipts: readonly RoarReceipt[];
}

export type { CoinAsk };

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

/** The honest line as a full sentence (spec §2.4, G7): a card's tooltip. The
 *  model computes the numbers. */
export function honestText(h: Honest, missionName: (id: string) => string | undefined): string {
  switch (h.kind) {
    case 'earnedGate':
      return t('stores.honest.earnedGate');
    case 'earnedCredits':
      return t('stores.honest.earnedCredits');
    case 'earnedStart':
      return t('stores.honest.earnedStart');
    case 'coins':
      return t('stores.honest.coins');
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

/** The short earned-path line a LOCKED card carries ("Free at Conduct 85"),
 *  or `null` where there is nothing to say. */
export function shortPath(h: Honest, missionName: (id: string) => string | undefined): string | null {
  switch (h.kind) {
    case 'conduct':
      return t('stores.short.conduct', { floor: h.floor });
    case 'stars':
      return t('stores.short.stars', { n: h.missions });
    case 'mission':
      return t('stores.short.mission', { mission: missionName(h.missionId) ?? t('stores.honest.mission.unnamed') });
    case 'pay':
      return t('stores.short.pay', { n: h.missions });
    default:
      return null;
  }
}

/** Owned: earned, or bought with coins. Hidden behind the toggle. */
const isOwned = (state: string): boolean => state === 'earned' || state === 'coins';
/** What the default view lists: anything a coin could buy. */
const forSale = (state: string): boolean => state === 'affordable' || state === 'locked';

export function showStores(host: HTMLElement, opts: StoresOptions): Disposer {
  const root = el('section', 'rl-stores');
  root.setAttribute('aria-label', t('stores.tab'));

  // The wallet every Buy is asked against: the TEST one, or the preview's 0.
  const coinWallet: CoinWallet = opts.test !== undefined ? { test: true, coins: opts.test.coins } : PREVIEW_WALLET;
  const ctx: Ctx = { opts, wallet: coinWallet };
  if (opts.test !== undefined) root.dataset.test = '1';

  // --- head: the balance, Grant (TEST), and "Get Roar coins" beside them ----
  const head = el('div', 'rl-stores__head');
  const wallet = el('div', 'rl-stores__wallet');
  wallet.appendChild(coinImg(opts.coinSrc(48), 48, 'rl-stores__wallet-coin'));
  const walletN = el('span', 'rl-stores__wallet-n', String(coinWallet.coins));
  walletN.dataset.value = String(coinWallet.coins);
  wallet.append(walletN, el('span', 'rl-stores__wallet-word', t('stores.wallet.word', { n: coinWallet.coins })));
  if (opts.test !== undefined) wallet.appendChild(el('span', 'rl-stores__test', t('stores.test.badge')));
  head.appendChild(wallet);
  if (opts.test !== undefined && opts.onGrant !== undefined) {
    const grant = document.createElement('button');
    grant.type = 'button';
    grant.className = 'rl-stores__grant';
    grant.dataset.buy = 'grant';
    grant.textContent = t('stores.test.grant', { n: opts.test.grant });
    const onGrant = opts.onGrant;
    grant.addEventListener('click', () => onGrant());
    head.appendChild(grant);
  }

  // Packs: compact chips, all real money, all disabled.
  const packs = el('div', 'rl-stores__packs');
  packs.setAttribute('role', 'group');
  packs.setAttribute('aria-label', t('stores.packs.label'));
  packs.appendChild(el('span', 'rl-stores__packs-h', t('stores.packs.label')));
  for (const pack of COIN_PACKS) {
    const price = (pack.usdCents / 100).toFixed(2);
    const bonus = packBonusPercent(pack);
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'rl-stores__pack';
    buy.dataset.buy = `pack:${pack.id}`;
    buy.dataset.pack = pack.id;
    buy.appendChild(el('span', 'rl-stores__coin-n', String(pack.coins)));
    if (bonus > 0) buy.appendChild(el('span', 'rl-stores__pack-bonus', t('stores.pack.bonus', { n: bonus })));
    buy.appendChild(el('span', 'rl-stores__pack-price', t('stores.pack.price', { price })));
    buy.setAttribute('aria-label', t('stores.pack.aria', { name: t(`stores.pack.${pack.id}`), n: pack.coins, price }));
    buy.title = t(`stores.pack.${pack.id}`);
    buy.disabled = !buyEnabled(pack, coinWallet);
    packs.appendChild(buy);
  }
  head.appendChild(packs);
  root.appendChild(head);

  const notice = el('p', 'rl-stores__notice', opts.test !== undefined ? t('stores.test.notice') : t('stores.offline'));
  notice.setAttribute('role', 'note');
  root.appendChild(notice);

  // --- shelves: a tablist, Left/Right/Home/End, the garage's F8 pattern ----
  const bar = el('div', 'rl-stores__bar');
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
  bar.appendChild(tabs);

  // --- Early access: what can be bought, owned behind a toggle -------------
  const items = storeItems(opts);
  let showOwned = opts.showOwned === true;
  const ownedCount =
    items.units.filter((u) => isOwned(u.state)).length + items.tiers.filter((x) => isOwned(x.state)).length;
  const offSaleCount =
    items.units.filter((u) => u.state === 'offSale').length + items.tiers.filter((x) => x.state === 'offSale').length;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'rl-stores__owned';
  toggle.dataset.focus = 'owned';
  toggle.textContent = t('stores.owned.toggle', { n: ownedCount });
  toggle.addEventListener('click', () => {
    showOwned = !showOwned;
    opts.onShowOwned?.(showOwned);
    syncOwned();
  });
  bar.appendChild(toggle);
  root.append(bar, panels);

  function syncShelves(): void {
    opts.onShelf?.(shelf);
    for (const [s, tab] of tabEls) {
      const on = s === shelf;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      const panel = panelEls.get(s);
      if (panel !== undefined) panel.hidden = !on;
    }
    toggle.hidden = shelf !== 'early';
  }

  const early = panelEls.get('early');
  /** Every owned card and row: what the toggle shows and hides. */
  const ownedEls: HTMLElement[] = [];
  /** Each group, and how many of its cards show without the toggle. */
  const groups: { section: HTMLElement; always: number }[] = [];
  let nothing: HTMLElement | null = null;
  if (early !== undefined) {
    early.appendChild(el('p', 'rl-stores__lede', t('stores.lede')));
    if (offSaleCount > 0) {
      early.appendChild(el('p', 'rl-stores__offsale-count', t('stores.offSale.count', { n: offSaleCount })));
    }
    const group = (titleKey: string, cards: readonly HTMLElement[]): void => {
      if (cards.length === 0) return;
      const section = el('section', 'rl-stores__group');
      section.dataset.group = titleKey.split('.').pop() ?? '';
      section.appendChild(el('h3', 'rl-stores__shelf-h', t(titleKey)));
      const grid = el('div', 'rl-stores__cards');
      for (const c of cards) grid.appendChild(c);
      section.appendChild(grid);
      groups.push({ section, always: cards.filter((c) => c.dataset.owned !== '1').length });
      early.appendChild(section);
    };
    const card = (u: UnitItem): HTMLElement => {
      const c = unitCard(u, ctx);
      if (isOwned(u.state)) ownedEls.push(c);
      return c;
    };
    const listed = items.units.filter((u) => u.state !== 'offSale');
    group('stores.section.units', listed.filter((u) => !u.specialForces).map(card));
    group('stores.section.special', listed.filter((u) => u.specialForces).map(card));
    const byUnit = new Map<string, TierItem[]>();
    for (const tier of items.tiers) {
      // A tier of a unit not yet open has nothing to buy: the unit's own card
      // is where that unit is bought. Off-sale rungs are counted above.
      if (tier.state === 'offSale' || tier.honest.kind === 'unlockFirst') continue;
      const list = byUnit.get(tier.unitId) ?? [];
      list.push(tier);
      byUnit.set(tier.unitId, list);
    }
    const tierCards: HTMLElement[] = [];
    for (const list of byUnit.values()) {
      const c = tierCard(list, ctx, ownedEls);
      if (list.every((x) => isOwned(x.state))) {
        c.dataset.owned = '1';
        ownedEls.push(c);
      }
      tierCards.push(c);
    }
    group('stores.section.tiers', tierCards);
    nothing = el('p', 'rl-stores__empty', t('stores.empty.forSale'));
    early.appendChild(nothing);
  }
  function syncOwned(): void {
    toggle.setAttribute('aria-pressed', showOwned ? 'true' : 'false');
    for (const e of ownedEls) e.hidden = !showOwned;
    let anyVisible = false;
    for (const g of groups) {
      const on = showOwned || g.always > 0;
      g.section.hidden = !on;
      anyVisible ||= on;
    }
    if (nothing !== null) nothing.hidden = anyVisible;
  }

  // --- Cosmetics and Receipts ----------------------------------------------
  panelEls.get('cosmetics')?.appendChild(el('p', 'rl-stores__empty', t('stores.empty.cosmetics')));
  const receiptsPanel = panelEls.get('receipts');
  if (receiptsPanel !== undefined) {
    const receipts = opts.test?.receipts ?? [];
    if (receipts.length === 0) {
      receiptsPanel.appendChild(
        el('p', 'rl-stores__empty', opts.test !== undefined ? t('stores.empty.receipts.test') : t('stores.empty.receipts'))
      );
    } else {
      receiptsPanel.appendChild(receiptsTable(receipts, opts));
    }
  }

  syncShelves();
  syncOwned();
  host.appendChild(root);
  // After a redraw, focus goes back where the press was: the same control,
  // or -- a bought item has no Buy left -- its card, else the selected shelf
  // tab. Never <body>.
  if (opts.focusKey !== undefined) {
    const key = opts.focusKey;
    const usable = (e: HTMLElement): boolean => !(e as HTMLButtonElement).disabled && e.closest('[hidden]') === null;
    const byKey = (k: string): HTMLElement | undefined =>
      [...root.querySelectorAll<HTMLElement>('[data-buy], [data-focus]')].find(
        (e) => (e.dataset.buy ?? e.dataset.focus) === k && usable(e)
      );
    const unit = key.startsWith('unit:') ? key.slice(5) : key.startsWith('tier:') ? key.slice(5).split('.')[0] : null;
    const target =
      byKey(key) ?? (unit !== null ? (byKey(`card:${unit}`) ?? byKey(`card:tiers:${unit}`)) : undefined) ?? tabEls.get(shelf);
    target?.focus();
  }
  return () => {
    root.remove();
  };
}

interface Ctx {
  readonly opts: StoresOptions;
  readonly wallet: CoinWallet;
}

/** ONE price line: coins first, credits small beside them. */
function priceLine(credits: number, coins: number, opts: StoresOptions): HTMLElement {
  const line = el('div', 'rl-stores__price');
  const coin = el('span', 'rl-stores__coin-price');
  coin.appendChild(coinImg(opts.coinSrc(24), 24, 'rl-stores__coin'));
  coin.appendChild(el('span', 'rl-stores__coin-n', String(coins)));
  coin.appendChild(el('span', 'rl-stores__coin-word', t('stores.wallet.word', { n: coins })));
  line.appendChild(coin);
  line.appendChild(el('span', 'rl-stores__credits', t('stores.price.credits', { n: credits })));
  return line;
}

function coinBuy(coins: number, label: string, enabled: boolean, ctx: Ctx, key: string, ask: CoinAsk): HTMLButtonElement {
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'rl-stores__buy';
  buy.dataset.buy = key;
  buy.appendChild(coinImg(ctx.opts.coinSrc(24), 24, 'rl-stores__coin'));
  buy.appendChild(el('span', '', t('stores.buy.coins', { n: coins })));
  buy.setAttribute('aria-label', label);
  buy.disabled = !enabled;
  const onBuy = ctx.opts.onBuy;
  if (enabled && onBuy !== undefined) buy.addEventListener('click', () => onBuy(ask));
  return buy;
}

/** The aria label's last clause: why a Buy cannot be pressed, or nothing. */
function buyNote(cost: number | null, ctx: Ctx): string {
  if (!ctx.wallet.test) return t('stores.buy.note.preview');
  if (cost !== null && ctx.wallet.coins < cost) return t('stores.buy.note.short');
  return '';
}

function portraitEl(unitId: string, opts: StoresOptions): HTMLElement {
  const src = opts.portrait?.(unitId) ?? null;
  if (src === null) {
    const hatch = el('div', 'rl-stores__card-art');
    hatch.dataset.nosprite = '1';
    return hatch;
  }
  const img = document.createElement('img');
  img.className = 'rl-stores__card-art';
  img.src = src;
  img.alt = '';
  return img;
}

/** Receipts, newest first. Every row is a TEST purchase or grant. */
function receiptsTable(receipts: readonly RoarReceipt[], opts: StoresOptions): HTMLElement {
  const wrap = el('div', 'rl-stores__receipts-wrap');
  const table = document.createElement('table');
  table.className = 'rl-stores__receipts';
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const k of ['when', 'item', 'coins', 'replaced']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = t(`stores.receipt.${k}`);
    hr.appendChild(th);
  }
  head.appendChild(hr);
  table.appendChild(head);
  const body = document.createElement('tbody');
  const name = (id: string): string => opts.units.find((u) => u.id === id)?.name ?? id;
  for (const r of [...receipts].reverse()) {
    const tr = document.createElement('tr');
    tr.dataset.receipt = r.kind;
    const when = new Date(r.at);
    const cells: string[] = [
      `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      r.kind === 'grant'
        ? t('stores.receipt.grant')
        : r.kind === 'unit'
          ? name(r.unitId)
          : t('stores.receipt.tier', { name: name(r.unitId), track: t(`garage.track.${r.track}`), tier: r.tier }),
      r.kind === 'grant' ? t('stores.receipt.plus', { n: r.coins }) : String(r.coins),
      r.kind === 'grant' ? t('stores.receipt.none') : t('stores.price.credits', { n: r.credits }),
    ];
    for (const c of cells) tr.appendChild(el('td', '', c));
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

/** A unit's card: portrait, name, one price line, the short earned path on a
 *  locked item, and one Buy (owned: the state in its place). */
function unitCard(item: UnitItem, ctx: Ctx): HTMLElement {
  const { opts } = ctx;
  const card = el('article', 'rl-stores__card');
  card.dataset.item = item.id;
  card.dataset.state = item.state;
  card.dataset.focus = `card:${item.id}`;
  card.tabIndex = -1;
  if (isOwned(item.state)) card.dataset.owned = '1';
  card.title = honestText(item.honest, opts.missionName);
  card.appendChild(portraitEl(item.id, opts));
  const body = el('div', 'rl-stores__card-body');
  body.appendChild(el('h4', 'rl-stores__card-name', item.name));
  if (item.credits !== undefined && item.coins !== undefined) body.appendChild(priceLine(item.credits, item.coins, opts));
  if (item.state === 'locked') {
    const path = shortPath(item.honest, opts.missionName);
    if (path !== null) body.appendChild(el('div', 'rl-stores__path', path));
  }
  if (forSale(item.state) && item.coins !== undefined) {
    const label = t('stores.buy.aria', { name: item.name, n: item.coins, note: buyNote(coinCost(item), ctx) });
    body.appendChild(coinBuy(item.coins, label, buyEnabled(item, ctx.wallet), ctx, `unit:${item.id}`, { kind: 'unit', unitId: item.id }));
  } else {
    body.appendChild(el('span', `rl-stores__state rl-stores__state--${item.state}`, t(`stores.state.${item.state}`)));
  }
  card.appendChild(body);
  return card;
}

/** One unit's upgrades: portrait, name, and a compact row per track. A maxed
 *  track's row is owned, and hides with the toggle. */
function tierCard(list: readonly TierItem[], ctx: Ctx, ownedEls: HTMLElement[]): HTMLElement {
  const { opts } = ctx;
  const first = list[0];
  const card = el('article', 'rl-stores__card rl-stores__card--tiers');
  card.dataset.item = `tiers:${first.unitId}`;
  card.dataset.focus = `card:tiers:${first.unitId}`;
  card.tabIndex = -1;
  card.appendChild(portraitEl(first.unitId, opts));
  const body = el('div', 'rl-stores__card-body');
  body.appendChild(el('h4', 'rl-stores__card-name', first.unitName));
  for (const item of list) {
    const row = el('div', 'rl-stores__tier');
    row.dataset.track = item.track;
    row.dataset.state = item.state;
    if (isOwned(item.state)) {
      row.dataset.owned = '1';
      ownedEls.push(row);
    }
    const head = el('div', 'rl-stores__tier-head');
    head.appendChild(el('span', 'rl-stores__tier-track', t(`garage.track.${item.track}`)));
    const pips = el('span', 'rl-stores__pips');
    pips.setAttribute('role', 'img');
    pips.setAttribute('aria-label', t('garage.track.tierOf', { n: item.owned, m: item.length }));
    for (let i = 0; i < item.length; i++) {
      const cls = i < item.earned ? ' rl-stores__pip--earned' : i < item.owned ? ' rl-stores__pip--coins' : '';
      pips.appendChild(el('i', `rl-stores__pip${cls}`));
    }
    head.appendChild(pips);
    row.appendChild(head);
    if (item.next !== null && forSale(item.state)) {
      row.appendChild(priceLine(item.next.credits, item.next.coins, opts));
      const label = t('stores.buy.tier.aria', {
        name: item.unitName,
        track: t(`garage.track.${item.track}`),
        tier: item.next.tier,
        n: item.next.coins,
        note: buyNote(coinCost(item), ctx),
      });
      const ask: CoinAsk = { kind: 'tier', unitId: item.unitId, track: item.track, tier: item.next.tier };
      row.appendChild(
        coinBuy(item.next.coins, label, buyEnabled(item, ctx.wallet), ctx, `tier:${item.unitId}.${item.track}.${item.next.tier}`, ask)
      );
    } else {
      row.appendChild(el('span', `rl-stores__state rl-stores__state--${item.state}`, t(`stores.state.${item.state}`)));
    }
    body.appendChild(row);
  }
  card.appendChild(body);
  return card;
}
